use serde::{Deserialize, Serialize};
use ssh2::Session;
use std::{
    collections::{HashMap, VecDeque},
    fs::{self, OpenOptions},
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    panic,
    path::{Path, PathBuf},
    process::Command,
    ptr,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use tauri::{AppHandle, Manager, State};
use tempfile::NamedTempFile;
use uuid::Uuid;
#[cfg(windows)]
use windows_sys::Win32::{
    Foundation::{GetLastError, ERROR_NOT_FOUND, FILETIME},
    Security::Credentials::{
        CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
    },
};
#[cfg(windows)]
use winreg::{enums::HKEY_CURRENT_USER, RegKey};

const SCHEMA_VERSION: u32 = 2;
const MAX_LOGS_PER_WORKSPACE: usize = 500;
const MAX_SYSTEM_LOG_BYTES: u64 = 2 * 1024 * 1024;
const SERVICE_NAME: &str = "InfraSteward";
const DATA_DIR_ENV_VAR: &str = "INFRASTEWARD_DATA_DIR";
const DATA_DIR_OVERRIDE_FILE: &str = "data-dir.txt";
const SCRIPTS_DIR_NAME: &str = "scripts";
const SCRIPT_FILE_EXTENSION: &str = "sh";
const DESCRIPTION_START_MARKER: &str = "# [description]";
const DESCRIPTION_END_MARKER: &str = "# [/description]";
const MCP_BRIDGE_PORT: u16 = 47321;
const MCP_TIMEOUT_PARAMETER: &str = "timeoutSeconds";
const MCP_DEFAULT_TIMEOUT_SECONDS: u64 = 30;
const MCP_MAX_TIMEOUT_SECONDS: u64 = 60;

type SharedAppData = Mutex<AppData>;
type ActiveExecutions = Mutex<HashMap<String, ActiveExecution>>;
type McpBridgeState = Mutex<Option<McpBridgeServer>>;

struct ActiveExecution {
    cancel_flag: Arc<AtomicBool>,
    events: Arc<Mutex<VecDeque<ScriptExecutionEvent>>>,
    finished: Arc<AtomicBool>,
}

struct McpBridgeServer {
    port: u16,
    shutdown: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl Drop for McpBridgeServer {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::SeqCst);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppData {
    schema_version: u32,
    active_tab_id: String,
    global_scripts: Vec<GlobalScript>,
    workspaces: Vec<WorkspaceTab>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GlobalScript {
    id: String,
    name: String,
    description: String,
    file_name: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    content: String,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTab {
    id: String,
    title: String,
    connection: SshConnectionConfig,
    attached_scripts: Vec<AttachedScript>,
    logs: Vec<LogEntry>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AttachedScript {
    id: String,
    global_script_id: String,
    #[serde(default = "default_script_tag")]
    tag: String,
    #[serde(default)]
    description: String,
    parameter_settings: HashMap<String, ScriptParameterSetting>,
    use_in_mcp: bool,
    selected: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScriptParameterSetting {
    value: String,
    use_from_environment: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SshConnectionConfig {
    id: String,
    name: String,
    host: String,
    port: u16,
    username: String,
    auth_type: AuthType,
    password_ref: Option<String>,
    private_key_path: Option<String>,
    private_key_content_ref: Option<String>,
    passphrase_ref: Option<String>,
    connection_timeout_seconds: Option<u64>,
    execution_timeout_seconds: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub enum AuthType {
    Password,
    PrivateKey,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    id: String,
    timestamp: String,
    level: String,
    message: String,
    script_id: Option<String>,
    execution_id: Option<String>,
    status: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretInput {
    password: Option<String>,
    private_key_content: Option<String>,
    passphrase: Option<String>,
    allow_insecure_secret_storage: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionSaveRequest {
    workspace_id: String,
    connection: SshConnectionConfig,
    secrets: SecretInput,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionRequest {
    workspace_id: String,
    attached_script_id: String,
    execution_id: Option<String>,
    parameter_overrides: Option<HashMap<String, String>>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelExecutionRequest {
    workspace_id: String,
    attached_script_id: String,
    execution_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionResult {
    status: String,
    stdout: String,
    stderr: String,
    exit_code: Option<i32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionStart {
    execution_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemLogEvent {
    level: String,
    message: String,
    target: Option<String>,
    details: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScriptExecutionEvent {
    kind: String,
    execution_id: String,
    workspace_id: String,
    attached_script_id: String,
    stream: Option<String>,
    chunk: Option<String>,
    status: Option<String>,
    exit_code: Option<i32>,
    message: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfo {
    working_data_dir: String,
    system_log_path: String,
    scripts_dir: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerStatus {
    running: bool,
    url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct McpToolDefinition {
    name: String,
    description: String,
    workspace_id: String,
    workspace_title: String,
    attached_script_id: String,
    global_script_id: String,
    input_schema: McpInputSchema,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct McpInputSchema {
    r#type: String,
    properties: HashMap<String, McpInputProperty>,
    additional_properties: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct McpInputProperty {
    r#type: String,
    description: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct McpBridgeExecuteRequest {
    workspace_id: String,
    attached_script_id: String,
    args: Option<HashMap<String, serde_json::Value>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemLogRecord<'a> {
    timestamp_ms: u128,
    level: &'a str,
    target: &'a str,
    message: String,
    details: Option<String>,
}

#[derive(Debug, thiserror::Error)]
enum InfraError {
    #[error("Storage error: {0}")]
    Storage(String),
    #[error("Secret storage error: {0}")]
    Secret(String),
    #[error("Workspace not found.")]
    MissingWorkspace,
    #[error("Script attachment not found.")]
    MissingAttachment,
    #[error("Global script not found.")]
    MissingScript,
    #[error("Connection validation error: {0}")]
    Validation(String),
    #[error("SSH error: {0}")]
    Ssh(String),
}

impl Serialize for InfraError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[tauri::command]
fn load_app_data(app: AppHandle, state: State<'_, SharedAppData>) -> Result<AppData, InfraError> {
    let mut data = state
        .lock()
        .map_err(|err| InfraError::Storage(err.to_string()))?
        .clone();
    match sync_scripts_from_files(&app, &mut data) {
        Ok(changed) => {
            if changed {
                write_app_data(&app, &data)?;
            }
        }
        Err(err) => {
            write_system_log(
                &app,
                "error",
                "storage",
                "Could not synchronize scripts directory while loading app data.",
                Some(err.to_string()),
            );
            hydrate_script_contents(&app, &mut data)?;
        }
    }
    *state
        .lock()
        .map_err(|err| InfraError::Storage(err.to_string()))? = data.clone();
    Ok(data)
}

#[tauri::command]
fn save_app_data(
    app: AppHandle,
    state: State<'_, SharedAppData>,
    app_data: AppData,
) -> Result<(), InfraError> {
    let mut normalized = normalize_app_data(app_data);
    sync_scripts_from_files(&app, &mut normalized)?;
    if let Err(err) = write_app_data(&app, &normalized) {
        write_system_log(
            &app,
            "error",
            "backend",
            "Failed to save app data.",
            Some(err.to_string()),
        );
        return Err(err);
    }
    *state
        .lock()
        .map_err(|err| InfraError::Storage(err.to_string()))? = normalized;
    Ok(())
}

#[tauri::command]
fn save_global_script(
    app: AppHandle,
    state: State<'_, SharedAppData>,
    script: GlobalScript,
) -> Result<AppData, InfraError> {
    let mut data = state
        .lock()
        .map_err(|err| InfraError::Storage(err.to_string()))?
        .clone();
    let mut next_script = script;
    next_script.name = next_script.name.trim().into();
    validate_script_file_name(&next_script.name)?;
    validate_unique_script_name(&data, &next_script.id, &next_script.name)?;
    next_script.file_name = script_file_name(&next_script.name)?;

    let existing = data
        .global_scripts
        .iter()
        .find(|candidate| candidate.id == next_script.id)
        .cloned();
    if let Some(existing_script) = existing.as_ref() {
        next_script.created_at = existing_script.created_at.clone();
    }

    write_script_file(&app, &next_script)?;
    if let Some(existing_script) = existing.as_ref() {
        let existing_file_name = normalized_script_file_name(existing_script)?;
        if existing_file_name != next_script.file_name {
            delete_script_file(&app, &existing_file_name)?;
        }
    }

    if data
        .global_scripts
        .iter()
        .any(|candidate| candidate.id == next_script.id)
    {
        data.global_scripts = data
            .global_scripts
            .into_iter()
            .map(|candidate| {
                if candidate.id == next_script.id {
                    next_script.clone()
                } else {
                    candidate
                }
            })
            .collect();
    } else {
        data.global_scripts.push(next_script);
    }

    let normalized = normalize_app_data(data);
    write_app_data(&app, &normalized)?;
    *state
        .lock()
        .map_err(|err| InfraError::Storage(err.to_string()))? = normalized.clone();
    Ok(normalized)
}

#[tauri::command]
fn delete_global_script(
    app: AppHandle,
    state: State<'_, SharedAppData>,
    script_id: String,
) -> Result<AppData, InfraError> {
    let mut data = state
        .lock()
        .map_err(|err| InfraError::Storage(err.to_string()))?
        .clone();
    let deleted = data
        .global_scripts
        .iter()
        .find(|candidate| candidate.id == script_id)
        .cloned();
    data.global_scripts
        .retain(|candidate| candidate.id != script_id);
    if let Some(script) = deleted {
        delete_script_file(&app, &normalized_script_file_name(&script)?)?;
    }

    let normalized = normalize_app_data(data);
    write_app_data(&app, &normalized)?;
    *state
        .lock()
        .map_err(|err| InfraError::Storage(err.to_string()))? = normalized.clone();
    Ok(normalized)
}

#[tauri::command]
fn read_global_script_content(
    app: AppHandle,
    state: State<'_, SharedAppData>,
    script_id: String,
) -> Result<String, InfraError> {
    let data = state
        .lock()
        .map_err(|err| InfraError::Storage(err.to_string()))?
        .clone();
    let script = data
        .global_scripts
        .iter()
        .find(|script| script.id == script_id)
        .ok_or(InfraError::MissingScript)?;
    read_script_file(&app, script)
}

#[tauri::command]
fn save_connection(
    app: AppHandle,
    state: State<'_, SharedAppData>,
    request: ConnectionSaveRequest,
) -> Result<AppData, InfraError> {
    write_system_log(
        &app,
        "info",
        "backend",
        "Saving SSH connection.",
        Some(format!("workspaceId={}", request.workspace_id)),
    );
    let mut data = state
        .lock()
        .map_err(|err| InfraError::Storage(err.to_string()))?
        .clone();
    validate_connection(&request.connection)?;
    validate_unique_connection_name(&data, &request.workspace_id, &request.connection.name)?;
    let workspace = data
        .workspaces
        .iter_mut()
        .find(|workspace| workspace.id == request.workspace_id)
        .ok_or(InfraError::MissingWorkspace)?;

    let mut connection = request.connection;
    connection.name = connection.name.trim().into();
    let secret_store = SecretStore::new(&app);

    if let Some(password) = request.secrets.password.filter(|value| !value.is_empty()) {
        let reference = format!("{}:password", connection.id);
        secret_store.set(
            &reference,
            &password,
            request
                .secrets
                .allow_insecure_secret_storage
                .unwrap_or(false),
        )?;
        connection.password_ref = Some(reference);
    }
    if let Some(private_key) = request
        .secrets
        .private_key_content
        .filter(|value| !value.is_empty())
    {
        let reference = format!("{}:private-key", connection.id);
        secret_store.set(
            &reference,
            &private_key,
            request
                .secrets
                .allow_insecure_secret_storage
                .unwrap_or(false),
        )?;
        connection.private_key_content_ref = Some(reference);
    }
    if let Some(passphrase) = request.secrets.passphrase.filter(|value| !value.is_empty()) {
        let reference = format!("{}:passphrase", connection.id);
        secret_store.set(
            &reference,
            &passphrase,
            request
                .secrets
                .allow_insecure_secret_storage
                .unwrap_or(false),
        )?;
        connection.passphrase_ref = Some(reference);
    }

    workspace.title = connection.name.clone();
    workspace.connection = connection;
    write_app_data(&app, &data)?;
    *state
        .lock()
        .map_err(|err| InfraError::Storage(err.to_string()))? = data.clone();
    Ok(data)
}

#[tauri::command]
async fn test_connection(
    app: AppHandle,
    state: State<'_, SharedAppData>,
    workspace_id: String,
) -> Result<String, InfraError> {
    write_system_log(
        &app,
        "info",
        "ssh",
        "Testing SSH connection.",
        Some(format!("workspaceId={workspace_id}")),
    );
    let data = state
        .lock()
        .map_err(|err| InfraError::Storage(err.to_string()))?
        .clone();
    let connection = find_workspace(&data, &workspace_id)?.connection.clone();
    tauri::async_runtime::spawn_blocking(move || {
        test_connection_blocking(app, workspace_id, connection)
    })
    .await
    .map_err(|err| InfraError::Ssh(format!("Connection test worker failed: {err}")))?
}

fn test_connection_blocking(
    app: AppHandle,
    workspace_id: String,
    connection: SshConnectionConfig,
) -> Result<String, InfraError> {
    let session = connect_session(&app, &connection).map_err(|err| {
        write_system_log(
            &app,
            "error",
            "ssh",
            "SSH connection test failed.",
            Some(err.to_string()),
        );
        err
    })?;
    session
        .disconnect(None, "InfraSteward connection test finished", None)
        .ok();
    write_system_log(
        &app,
        "info",
        "ssh",
        "SSH connection test succeeded.",
        Some(format!("workspaceId={workspace_id}")),
    );
    Ok(format!(
        "Connected to {} as {}.",
        connection.host, connection.username
    ))
}

#[tauri::command]
async fn run_script(
    app: AppHandle,
    state: State<'_, SharedAppData>,
    active_executions: State<'_, ActiveExecutions>,
    request: ExecutionRequest,
) -> Result<ExecutionStart, InfraError> {
    let workspace_id = request.workspace_id.clone();
    let attached_script_id = request.attached_script_id.clone();
    let execution_id = request
        .execution_id
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| execution_key(&workspace_id, &attached_script_id));
    write_system_log(
        &app,
        "info",
        "ssh",
        "Starting script execution.",
        Some(format!(
            "workspaceId={} attachedScriptId={}",
            workspace_id, attached_script_id
        )),
    );
    let data = state
        .lock()
        .map_err(|err| InfraError::Storage(err.to_string()))?
        .clone();
    let workspace = find_workspace(&data, &workspace_id)?.clone();
    let attached = workspace
        .attached_scripts
        .iter()
        .find(|attached| attached.id == attached_script_id)
        .ok_or(InfraError::MissingAttachment)?;
    let script = data
        .global_scripts
        .iter()
        .find(|script| script.id == attached.global_script_id)
        .ok_or(InfraError::MissingScript)?;
    let script_content = read_script_file(&app, script)?;

    let mut settings = attached.parameter_settings.clone();
    if let Some(overrides) = request.parameter_overrides {
        for (key, value) in overrides {
            settings.insert(
                key,
                ScriptParameterSetting {
                    value,
                    use_from_environment: false,
                },
            );
        }
    }

    let command = prepare_remote_command(&script_content, &settings);
    let connection = workspace.connection;
    let cancel_flag = Arc::new(AtomicBool::new(false));
    let events = Arc::new(Mutex::new(VecDeque::new()));
    let finished = Arc::new(AtomicBool::new(false));
    {
        let mut active = active_executions
            .lock()
            .map_err(|err| InfraError::Storage(err.to_string()))?;
        if active.contains_key(&execution_id) {
            return Err(InfraError::Validation("Script is already running.".into()));
        }
        active.insert(
            execution_id.clone(),
            ActiveExecution {
                cancel_flag: cancel_flag.clone(),
                events: events.clone(),
                finished: finished.clone(),
            },
        );
    }

    let background_execution_id = execution_id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        run_script_blocking(
            app,
            background_execution_id,
            workspace_id,
            attached_script_id,
            connection,
            command,
            cancel_flag,
            events,
            finished,
        )
    });

    Ok(ExecutionStart { execution_id })
}

#[tauri::command]
fn cancel_script(
    active_executions: State<'_, ActiveExecutions>,
    request: CancelExecutionRequest,
) -> Result<(), InfraError> {
    let execution_key = request
        .execution_id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| execution_key(&request.workspace_id, &request.attached_script_id));
    let active = active_executions
        .lock()
        .map_err(|err| InfraError::Storage(err.to_string()))?;
    let Some(cancel_flag) = active.get(&execution_key) else {
        return Err(InfraError::Validation("Script is not running.".into()));
    };
    cancel_flag.cancel_flag.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
fn drain_script_events(
    active_executions: State<'_, ActiveExecutions>,
    request: CancelExecutionRequest,
) -> Result<Vec<ScriptExecutionEvent>, InfraError> {
    let execution_key = request
        .execution_id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| execution_key(&request.workspace_id, &request.attached_script_id));
    let (events, finished) = {
        let active = active_executions
            .lock()
            .map_err(|err| InfraError::Storage(err.to_string()))?;
        let Some(execution) = active.get(&execution_key) else {
            return Ok(Vec::new());
        };
        (execution.events.clone(), execution.finished.clone())
    };

    let drained = {
        let mut queue = events
            .lock()
            .map_err(|err| InfraError::Storage(err.to_string()))?;
        queue.drain(..).collect::<Vec<_>>()
    };

    if finished.load(Ordering::SeqCst) {
        if let Ok(mut active) = active_executions.lock() {
            active.remove(&execution_key);
        }
    }

    Ok(drained)
}

fn execution_key(workspace_id: &str, attached_script_id: &str) -> String {
    format!("{workspace_id}:{attached_script_id}")
}

fn run_script_blocking(
    app: AppHandle,
    execution_id: String,
    workspace_id: String,
    attached_script_id: String,
    connection: SshConnectionConfig,
    command: String,
    cancel_flag: Arc<AtomicBool>,
    events: Arc<Mutex<VecDeque<ScriptExecutionEvent>>>,
    finished: Arc<AtomicBool>,
) {
    let result = execute_ssh_command(
        &app,
        &connection,
        &execution_id,
        &workspace_id,
        &attached_script_id,
        &command,
        &cancel_flag,
        &events,
    );
    match &result {
        Ok(execution) => write_system_log(
            &app,
            match execution.status.as_str() {
                "success" => "info",
                "cancelled" => "warn",
                _ => "error",
            },
            "ssh",
            "Script execution finished.",
            Some(format!(
                "workspaceId={} attachedScriptId={} status={} exitCode={:?}",
                workspace_id, attached_script_id, execution.status, execution.exit_code
            )),
        ),
        Err(err) => write_system_log(
            &app,
            "error",
            "ssh",
            "Script execution failed.",
            Some(err.to_string()),
        ),
    }
    push_execution_event(
        &events,
        ScriptExecutionEvent {
            kind: "finished".into(),
            execution_id,
            workspace_id,
            attached_script_id,
            stream: None,
            chunk: None,
            status: Some(
                result
                    .as_ref()
                    .map(|execution| execution.status.clone())
                    .unwrap_or_else(|_| "failed".into()),
            ),
            exit_code: result
                .as_ref()
                .ok()
                .and_then(|execution| execution.exit_code),
            message: result.err().map(|err| err.to_string()),
        },
    );
    finished.store(true, Ordering::SeqCst);
}

#[tauri::command]
fn log_system_event(app: AppHandle, event: SystemLogEvent) -> Result<(), InfraError> {
    write_system_log(
        &app,
        &event.level,
        event.target.as_deref().unwrap_or("frontend"),
        &event.message,
        event.details,
    );
    Ok(())
}

#[tauri::command]
fn get_runtime_info(app: AppHandle) -> Result<RuntimeInfo, InfraError> {
    Ok(RuntimeInfo {
        working_data_dir: working_data_dir(&app)?.display().to_string(),
        system_log_path: system_log_path(&app)?.display().to_string(),
        scripts_dir: scripts_dir(&app)?.display().to_string(),
    })
}

#[tauri::command]
fn get_mcp_server_status(state: State<'_, McpBridgeState>) -> Result<McpServerStatus, InfraError> {
    let server = state
        .lock()
        .map_err(|err| InfraError::Storage(err.to_string()))?;
    Ok(mcp_server_status(server.as_ref()))
}

#[tauri::command]
fn start_mcp_server(
    app: AppHandle,
    state: State<'_, McpBridgeState>,
) -> Result<McpServerStatus, InfraError> {
    let mut server = state
        .lock()
        .map_err(|err| InfraError::Storage(err.to_string()))?;
    if server.is_none() {
        *server = Some(start_mcp_bridge(app)?);
    }
    Ok(mcp_server_status(server.as_ref()))
}

#[tauri::command]
fn stop_mcp_server(state: State<'_, McpBridgeState>) -> Result<McpServerStatus, InfraError> {
    let mut server = state
        .lock()
        .map_err(|err| InfraError::Storage(err.to_string()))?;
    *server = None;
    Ok(mcp_server_status(None))
}

#[tauri::command]
fn open_working_data_dir(app: AppHandle) -> Result<(), InfraError> {
    let directory = working_data_dir(&app)?;
    open_directory(&directory).map_err(|err| InfraError::Storage(err.to_string()))?;
    write_system_log(
        &app,
        "info",
        "backend",
        "Opened working data directory.",
        Some(directory.display().to_string()),
    );
    Ok(())
}

fn connect_session(
    app: &AppHandle,
    connection: &SshConnectionConfig,
) -> Result<Session, InfraError> {
    validate_connection(connection)?;
    let address = format!("{}:{}", connection.host, connection.port);
    let timeout = Duration::from_secs(connection.connection_timeout_seconds.unwrap_or(15));
    let tcp = TcpStream::connect(address)
        .map_err(|err| InfraError::Ssh(format!("Host unreachable: {err}")))?;
    tcp.set_read_timeout(Some(timeout)).ok();
    tcp.set_write_timeout(Some(timeout)).ok();

    let mut session = Session::new().map_err(|err| InfraError::Ssh(err.to_string()))?;
    session.set_tcp_stream(tcp);
    session
        .handshake()
        .map_err(|err| InfraError::Ssh(format!("Handshake failed: {err}")))?;

    match connection.auth_type {
        AuthType::Password => {
            let reference = connection.password_ref.as_ref().ok_or_else(|| {
                InfraError::Validation("Missing saved password reference.".into())
            })?;
            let password = SecretStore::new(app).get(reference)?;
            session
                .userauth_password(&connection.username, &password)
                .map_err(|err| InfraError::Ssh(format!("Password authentication failed: {err}")))?;
        }
        AuthType::PrivateKey => {
            let passphrase = connection
                .passphrase_ref
                .as_ref()
                .and_then(|reference| SecretStore::new(app).get(reference).ok());
            if let Some(path) = connection
                .private_key_path
                .as_ref()
                .filter(|path| !path.is_empty())
            {
                if !Path::new(path).exists() {
                    return Err(InfraError::Validation(
                        "Private key file does not exist.".into(),
                    ));
                }
                session
                    .userauth_pubkey_file(
                        &connection.username,
                        None,
                        Path::new(path),
                        passphrase.as_deref(),
                    )
                    .map_err(|err| {
                        InfraError::Ssh(format!("Private key authentication failed: {err}"))
                    })?;
            } else if let Some(reference) = &connection.private_key_content_ref {
                let private_key = SecretStore::new(app).get(reference)?;
                let mut file =
                    NamedTempFile::new().map_err(|err| InfraError::Storage(err.to_string()))?;
                std::io::Write::write_all(&mut file, private_key.as_bytes())
                    .map_err(|err| InfraError::Storage(err.to_string()))?;
                session
                    .userauth_pubkey_file(
                        &connection.username,
                        None,
                        file.path(),
                        passphrase.as_deref(),
                    )
                    .map_err(|err| {
                        InfraError::Ssh(format!("Private key authentication failed: {err}"))
                    })?;
            } else {
                return Err(InfraError::Validation(
                    "Missing private key path or saved private key content.".into(),
                ));
            }
        }
    }

    if !session.authenticated() {
        return Err(InfraError::Ssh("Authentication failed.".into()));
    }

    Ok(session)
}

fn execute_ssh_command(
    app: &AppHandle,
    connection: &SshConnectionConfig,
    execution_id: &str,
    workspace_id: &str,
    attached_script_id: &str,
    command: &str,
    cancel_flag: &AtomicBool,
    events: &Arc<Mutex<VecDeque<ScriptExecutionEvent>>>,
) -> Result<ExecutionResult, InfraError> {
    let session = connect_session(app, connection)?;
    let mut channel = session
        .channel_session()
        .map_err(|err| InfraError::Ssh(err.to_string()))?;
    channel
        .exec(command)
        .map_err(|err| InfraError::Ssh(format!("Script start failed: {err}")))?;

    let mut stdout = String::new();
    let mut stderr = String::new();
    let timeout = Duration::from_secs(connection.execution_timeout_seconds.unwrap_or(300));
    let deadline = Instant::now() + timeout;
    let mut buffer = [0_u8; 8192];

    session.set_blocking(false);
    while !channel.eof() {
        if cancel_flag.load(Ordering::SeqCst) {
            let _ = channel.close();
            session.set_blocking(true);
            return Ok(ExecutionResult {
                status: "cancelled".into(),
                stdout,
                stderr,
                exit_code: None,
            });
        }

        if Instant::now() >= deadline {
            let _ = channel.close();
            session.set_blocking(true);
            let timeout_message = format!("Script timed out after {} seconds.", timeout.as_secs());
            if !stderr.is_empty() && !stderr.ends_with('\n') {
                stderr.push('\n');
            }
            stderr.push_str(&timeout_message);
            return Ok(ExecutionResult {
                status: "timeout".into(),
                stdout,
                stderr,
                exit_code: None,
            });
        }

        let mut read_any = false;
        read_any |= read_channel_stream(
            app,
            execution_id,
            workspace_id,
            attached_script_id,
            "stdout",
            events,
            &mut channel,
            &mut buffer,
            &mut stdout,
        )?;
        {
            let mut stderr_stream = channel.stderr();
            read_any |= read_channel_stream(
                app,
                execution_id,
                workspace_id,
                attached_script_id,
                "stderr",
                events,
                &mut stderr_stream,
                &mut buffer,
                &mut stderr,
            )?;
        }

        if !read_any {
            std::thread::sleep(Duration::from_millis(25));
        }
    }

    session.set_blocking(true);
    channel
        .wait_close()
        .map_err(|err| InfraError::Ssh(err.to_string()))?;
    let exit_code = channel.exit_status().ok();
    let status = if exit_code == Some(0) {
        "success"
    } else {
        "failed"
    };

    Ok(ExecutionResult {
        status: status.into(),
        stdout,
        stderr,
        exit_code,
    })
}

fn read_channel_stream<R: Read>(
    _app: &AppHandle,
    execution_id: &str,
    workspace_id: &str,
    attached_script_id: &str,
    stream_name: &str,
    events: &Arc<Mutex<VecDeque<ScriptExecutionEvent>>>,
    stream: &mut R,
    buffer: &mut [u8],
    output: &mut String,
) -> Result<bool, InfraError> {
    let mut read_any = false;
    loop {
        match stream.read(buffer) {
            Ok(0) => return Ok(read_any),
            Ok(read) => {
                read_any = true;
                let chunk = String::from_utf8_lossy(&buffer[..read]).to_string();
                output.push_str(&chunk);
                push_execution_event(
                    events,
                    ScriptExecutionEvent {
                        kind: "output".into(),
                        execution_id: execution_id.into(),
                        workspace_id: workspace_id.into(),
                        attached_script_id: attached_script_id.into(),
                        stream: Some(stream_name.into()),
                        chunk: Some(chunk),
                        status: None,
                        exit_code: None,
                        message: None,
                    },
                );
            }
            Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => return Ok(read_any),
            Err(err) => return Err(InfraError::Ssh(err.to_string())),
        }
    }
}

fn push_execution_event(
    events: &Arc<Mutex<VecDeque<ScriptExecutionEvent>>>,
    event: ScriptExecutionEvent,
) {
    if let Ok(mut queue) = events.lock() {
        queue.push_back(event);
    }
}

fn prepare_remote_command(
    script_content: &str,
    settings: &HashMap<String, ScriptParameterSetting>,
) -> String {
    let env_prefix = settings
        .iter()
        .filter(|(_, setting)| !setting.use_from_environment && !setting.value.is_empty())
        .map(|(name, setting)| format!("{name}={}", shell_single_quote(&setting.value)))
        .collect::<Vec<_>>()
        .join(" ");

    format!(
        "{}bash -s <<'INFRAS_EOF'\n{}\nINFRAS_EOF",
        if env_prefix.is_empty() {
            String::new()
        } else {
            format!("{env_prefix} ")
        },
        script_content
    )
}

fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn validate_connection(connection: &SshConnectionConfig) -> Result<(), InfraError> {
    if connection.name.trim().is_empty() {
        return Err(InfraError::Validation(
            "Connection name is required.".into(),
        ));
    }
    if connection.host.trim().is_empty() {
        return Err(InfraError::Validation("Host is required.".into()));
    }
    if connection.username.trim().is_empty() {
        return Err(InfraError::Validation("Username is required.".into()));
    }
    if connection.port == 0 {
        return Err(InfraError::Validation(
            "Port must be from 1 to 65535.".into(),
        ));
    }
    Ok(())
}

fn validate_unique_connection_name(
    data: &AppData,
    workspace_id: &str,
    connection_name: &str,
) -> Result<(), InfraError> {
    let normalized = normalize_connection_name(connection_name);
    if normalized.is_empty() {
        return Err(InfraError::Validation(
            "Connection name is required.".into(),
        ));
    }
    let duplicate = data.workspaces.iter().any(|workspace| {
        workspace.id != workspace_id
            && normalize_connection_name(&workspace.connection.name) == normalized
    });
    if duplicate {
        return Err(InfraError::Validation(
            "Connection name must be unique.".into(),
        ));
    }
    Ok(())
}

fn normalize_connection_name(value: &str) -> String {
    value.trim().to_lowercase()
}

fn validate_unique_script_name(
    data: &AppData,
    script_id: &str,
    script_name: &str,
) -> Result<(), InfraError> {
    let normalized = normalize_script_name(script_name);
    if normalized.is_empty() {
        return Err(InfraError::Validation("Script name is required.".into()));
    }
    let duplicate = data
        .global_scripts
        .iter()
        .any(|script| script.id != script_id && normalize_script_name(&script.name) == normalized);
    if duplicate {
        return Err(InfraError::Validation("Script name must be unique.".into()));
    }
    Ok(())
}

fn normalize_script_name(value: &str) -> String {
    value.trim().to_lowercase()
}

fn validate_script_file_name(script_name: &str) -> Result<(), InfraError> {
    let trimmed = script_name.trim();
    if trimmed.is_empty() {
        return Err(InfraError::Validation("Script name is required.".into()));
    }
    if trimmed == "." || trimmed == ".." {
        return Err(InfraError::Validation(
            "Script name cannot be . or ...".into(),
        ));
    }
    if trimmed.ends_with('.') || trimmed.ends_with(' ') {
        return Err(InfraError::Validation(
            "Script name cannot end with a dot or space.".into(),
        ));
    }
    if trimmed.chars().any(|character| {
        character.is_control()
            || matches!(
                character,
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
            )
    }) {
        return Err(InfraError::Validation(
            "Script name contains characters that cannot be used in a file name.".into(),
        ));
    }
    let reserved = [
        "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
        "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
    ];
    if reserved.contains(&trimmed.to_ascii_lowercase().as_str()) {
        return Err(InfraError::Validation(
            "Script name is reserved by Windows and cannot be used as a file name.".into(),
        ));
    }
    Ok(())
}

fn find_workspace<'a>(
    data: &'a AppData,
    workspace_id: &str,
) -> Result<&'a WorkspaceTab, InfraError> {
    data.workspaces
        .iter()
        .find(|workspace| workspace.id == workspace_id)
        .ok_or(InfraError::MissingWorkspace)
}

fn normalize_app_data(mut data: AppData) -> AppData {
    if data.schema_version != SCHEMA_VERSION {
        return default_app_data();
    }
    for script in &mut data.global_scripts {
        script.name = script.name.trim().into();
        if script.file_name.trim().is_empty() {
            script.file_name =
                script_file_name(&script.name).unwrap_or_else(|_| format!("{}.sh", script.id));
        }
    }
    if data.workspaces.is_empty() {
        let workspace = default_workspace();
        data.active_tab_id = workspace.id.clone();
        data.workspaces.push(workspace);
    }
    if !data
        .workspaces
        .iter()
        .any(|workspace| workspace.id == data.active_tab_id)
    {
        data.active_tab_id = data.workspaces[0].id.clone();
    }
    for workspace in &mut data.workspaces {
        for attached in &mut workspace.attached_scripts {
            if attached.tag.trim().is_empty() {
                attached.tag = default_script_tag();
            } else {
                attached.tag = attached.tag.trim().into();
            }
            attached.description = attached.description.trim().into();
        }
        if workspace.logs.len() > MAX_LOGS_PER_WORKSPACE {
            workspace.logs = workspace
                .logs
                .split_off(workspace.logs.len() - MAX_LOGS_PER_WORKSPACE);
        }
    }
    data
}

fn default_script_tag() -> String {
    "default".into()
}

fn default_app_data() -> AppData {
    let workspace = default_workspace();
    AppData {
        schema_version: SCHEMA_VERSION,
        active_tab_id: workspace.id.clone(),
        global_scripts: Vec::new(),
        workspaces: vec![workspace],
    }
}

fn default_workspace() -> WorkspaceTab {
    WorkspaceTab {
        id: format!("workspace_{}", Uuid::new_v4()),
        title: "New Workspace".into(),
        connection: SshConnectionConfig {
            id: format!("conn_{}", Uuid::new_v4()),
            name: String::new(),
            host: String::new(),
            port: 22,
            username: String::new(),
            auth_type: AuthType::PrivateKey,
            password_ref: None,
            private_key_path: None,
            private_key_content_ref: None,
            passphrase_ref: None,
            connection_timeout_seconds: Some(15),
            execution_timeout_seconds: Some(300),
        },
        attached_scripts: Vec::new(),
        logs: Vec::new(),
    }
}

fn app_data_path(app: &AppHandle) -> Result<PathBuf, InfraError> {
    let directory = working_data_dir(app)?;
    fs::create_dir_all(&directory).map_err(|err| InfraError::Storage(err.to_string()))?;
    Ok(directory.join("app-data.json"))
}

fn scripts_dir(app: &AppHandle) -> Result<PathBuf, InfraError> {
    let directory = working_data_dir(app)?.join(SCRIPTS_DIR_NAME);
    fs::create_dir_all(&directory).map_err(|err| InfraError::Storage(err.to_string()))?;
    Ok(directory)
}

fn script_file_name(script_name: &str) -> Result<String, InfraError> {
    validate_script_file_name(script_name)?;
    Ok(format!("{}.{}", script_name.trim(), SCRIPT_FILE_EXTENSION))
}

fn validate_script_file_reference(file_name: &str) -> Result<(), InfraError> {
    let path = Path::new(file_name);
    if path.components().count() != 1 {
        return Err(InfraError::Validation(
            "Script file reference must be a file name, not a path.".into(),
        ));
    }
    if script_name_from_file_path(path).is_none() {
        return Err(InfraError::Validation(
            "Script file reference must point to a .sh file.".into(),
        ));
    }
    Ok(())
}

fn normalized_script_file_name(script: &GlobalScript) -> Result<String, InfraError> {
    if script.file_name.trim().is_empty() {
        return script_file_name(&script.name);
    }
    validate_script_file_reference(&script.file_name)?;
    Ok(script.file_name.trim().into())
}

fn script_file_path(app: &AppHandle, file_name: &str) -> Result<PathBuf, InfraError> {
    validate_script_file_reference(file_name)?;
    Ok(scripts_dir(app)?.join(file_name.trim()))
}

fn write_script_file(app: &AppHandle, script: &GlobalScript) -> Result<(), InfraError> {
    let path = script_file_path(app, &normalized_script_file_name(script)?)?;
    fs::write(path, compose_script_file(script)).map_err(|err| InfraError::Storage(err.to_string()))
}

fn read_script_file(app: &AppHandle, script: &GlobalScript) -> Result<String, InfraError> {
    let path = script_file_path(app, &normalized_script_file_name(script)?)?;
    let raw = fs::read_to_string(path).map_err(|err| InfraError::Storage(err.to_string()))?;
    Ok(parse_script_file(&raw).content)
}

fn hydrate_script_contents(app: &AppHandle, data: &mut AppData) -> Result<(), InfraError> {
    for script in &mut data.global_scripts {
        let path = script_file_path(app, &normalized_script_file_name(script)?)?;
        let raw = fs::read_to_string(path).map_err(|err| InfraError::Storage(err.to_string()))?;
        let parsed = parse_script_file(&raw);
        script.description = parsed.description;
        script.content = parsed.content;
    }
    Ok(())
}

struct ParsedScriptFile {
    description: String,
    content: String,
}

fn parse_script_file(raw: &str) -> ParsedScriptFile {
    let normalized = raw.replace("\r\n", "\n").replace('\r', "\n");
    let lines = normalized.split('\n').collect::<Vec<_>>();
    let start_index = lines
        .iter()
        .position(|line| line.trim() == DESCRIPTION_START_MARKER);
    let Some(start_index) = start_index else {
        return ParsedScriptFile {
            description: String::new(),
            content: raw.into(),
        };
    };
    let end_index = lines
        .iter()
        .enumerate()
        .skip(start_index + 1)
        .find_map(|(index, line)| (line.trim() == DESCRIPTION_END_MARKER).then_some(index));
    let Some(end_index) = end_index else {
        return ParsedScriptFile {
            description: String::new(),
            content: raw.into(),
        };
    };

    let description = lines[start_index + 1..end_index]
        .iter()
        .map(|line| clean_description_line(line))
        .collect::<Vec<_>>()
        .join("\n")
        .trim_matches('\n')
        .to_string();
    let mut content_lines =
        Vec::with_capacity(lines.len().saturating_sub(end_index - start_index + 1));
    content_lines.extend_from_slice(&lines[..start_index]);
    content_lines.extend_from_slice(&lines[end_index + 1..]);
    let content = trim_extra_blank_lines(content_lines.join("\n"));
    ParsedScriptFile {
        description,
        content,
    }
}

fn clean_description_line(line: &str) -> String {
    let trimmed_start = line.trim_start();
    let Some(rest) = trimmed_start.strip_prefix('#') else {
        return line.to_string();
    };
    rest.strip_prefix(' ').unwrap_or(rest).to_string()
}

fn trim_extra_blank_lines(value: String) -> String {
    value.trim_matches('\n').to_string()
}

fn compose_script_file(script: &GlobalScript) -> String {
    let content = trim_extra_blank_lines(script.content.replace("\r\n", "\n").replace('\r', "\n"));
    let description =
        trim_extra_blank_lines(script.description.replace("\r\n", "\n").replace('\r', "\n"));
    let (shebang, body) = split_shebang(&content);
    let mut sections = Vec::new();
    if let Some(shebang) = shebang {
        sections.push(shebang.to_string());
    }
    if !description.is_empty() {
        let mut block = String::from(DESCRIPTION_START_MARKER);
        for line in description.split('\n') {
            block.push('\n');
            block.push_str("#");
            if !line.is_empty() {
                block.push(' ');
                block.push_str(line);
            }
        }
        block.push('\n');
        block.push_str(DESCRIPTION_END_MARKER);
        sections.push(block);
    }
    if !body.trim_matches('\n').is_empty() {
        sections.push(trim_extra_blank_lines(body.to_string()));
    }
    format!("{}\n", sections.join("\n\n"))
}

fn split_shebang(content: &str) -> (Option<&str>, &str) {
    if !content.starts_with("#!") {
        return (None, content);
    }
    match content.find('\n') {
        Some(index) => (Some(&content[..index]), &content[index + 1..]),
        None => (Some(content), ""),
    }
}

fn delete_script_file(app: &AppHandle, file_name: &str) -> Result<(), InfraError> {
    let path = script_file_path(app, file_name)?;
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(InfraError::Storage(err.to_string())),
    }
}

fn script_name_from_file_path(path: &Path) -> Option<String> {
    let extension = path.extension()?.to_str()?;
    if !extension.eq_ignore_ascii_case(SCRIPT_FILE_EXTENSION) {
        return None;
    }
    let stem = path.file_stem()?.to_str()?.trim();
    if stem.is_empty() {
        None
    } else {
        Some(stem.into())
    }
}

fn sync_scripts_from_files(app: &AppHandle, data: &mut AppData) -> Result<bool, InfraError> {
    let directory = working_data_dir(app)?.join(SCRIPTS_DIR_NAME);
    fs::create_dir_all(&directory).map_err(|err| InfraError::Storage(err.to_string()))?;

    let mut file_scripts = Vec::new();
    for entry in fs::read_dir(&directory).map_err(|err| InfraError::Storage(err.to_string()))? {
        let entry = entry.map_err(|err| InfraError::Storage(err.to_string()))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = script_name_from_file_path(&path) else {
            continue;
        };
        if let Err(err) = validate_script_file_name(&name) {
            write_system_log(
                app,
                "warn",
                "storage",
                "Ignoring script file with invalid name.",
                Some(format!("path={}: {err}", path.display())),
            );
            continue;
        }
        let raw = fs::read_to_string(&path).map_err(|err| InfraError::Storage(err.to_string()))?;
        file_scripts.push((name, parse_script_file(&raw)));
    }
    file_scripts.sort_by_key(|(name, _)| normalize_script_name(name));

    let timestamp = now_iso();
    let mut existing_by_file_name = data
        .global_scripts
        .iter()
        .cloned()
        .filter_map(|script| {
            normalized_script_file_name(&script)
                .ok()
                .map(|file_name| (file_name.to_ascii_lowercase(), script))
        })
        .collect::<HashMap<_, _>>();
    let mut seen_names = HashMap::<String, ()>::new();
    let mut next_scripts = Vec::new();

    for (name, parsed) in file_scripts {
        let key = normalize_script_name(&name);
        if seen_names.insert(key.clone(), ()).is_some() {
            write_system_log(
                app,
                "warn",
                "storage",
                "Ignoring duplicate script file name.",
                Some(name),
            );
            continue;
        }
        let file_name = script_file_name(&name)?;
        if let Some(mut script) = existing_by_file_name.remove(&file_name.to_ascii_lowercase()) {
            script.name = name;
            script.file_name = file_name;
            if script.content != parsed.content || script.description != parsed.description {
                script.description = parsed.description;
                script.content = parsed.content;
                script.updated_at = timestamp.clone();
            }
            next_scripts.push(script);
        } else {
            next_scripts.push(GlobalScript {
                id: format!("script_{}", Uuid::new_v4()),
                name,
                description: parsed.description,
                file_name,
                content: parsed.content,
                created_at: timestamp.clone(),
                updated_at: timestamp.clone(),
            });
        }
    }

    let changed = !scripts_equivalent_for_sync(&data.global_scripts, &next_scripts);
    data.global_scripts = next_scripts;
    if changed {
        write_system_log(
            app,
            "info",
            "storage",
            "Synchronized scripts directory.",
            Some(format!("scriptCount={}", data.global_scripts.len())),
        );
    }
    Ok(changed)
}

fn scripts_equivalent_for_sync(left: &[GlobalScript], right: &[GlobalScript]) -> bool {
    left.len() == right.len()
        && left.iter().zip(right).all(|(left, right)| {
            left.id == right.id
                && left.name == right.name
                && left.description == right.description
                && left.file_name == right.file_name
                && left.content == right.content
                && left.created_at == right.created_at
                && left.updated_at == right.updated_at
        })
}

fn read_app_data(app: &AppHandle) -> AppData {
    let Ok(path) = app_data_path(app) else {
        return default_app_data();
    };
    let mut data = match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content)
            .map(normalize_app_data)
            .unwrap_or_else(|err| {
                write_system_log(
                    app,
                    "error",
                    "storage",
                    "Could not parse app data. Falling back to defaults.",
                    Some(err.to_string()),
                );
                default_app_data()
            }),
        Err(err) => {
            if err.kind() != std::io::ErrorKind::NotFound {
                write_system_log(
                    app,
                    "warn",
                    "storage",
                    "Could not read app data. Falling back to defaults.",
                    Some(err.to_string()),
                );
            }
            default_app_data()
        }
    };

    match sync_scripts_from_files(app, &mut data) {
        Ok(changed) => {
            if changed {
                let _ = write_app_data(app, &data);
            }
        }
        Err(err) => write_system_log(
            app,
            "error",
            "storage",
            "Could not synchronize scripts directory.",
            Some(err.to_string()),
        ),
    }
    data
}

fn now_iso() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| format!("unix-ms:{}", duration.as_millis()))
        .unwrap_or_else(|_| "unix-ms:0".into())
}

fn write_app_data(app: &AppHandle, data: &AppData) -> Result<(), InfraError> {
    let path = app_data_path(app)?;
    let temp_path = path.with_extension("json.tmp");
    let mut persisted = data.clone();
    for script in &mut persisted.global_scripts {
        script.content.clear();
    }
    let content = serde_json::to_string_pretty(&persisted)
        .map_err(|err| InfraError::Storage(err.to_string()))?;
    fs::write(&temp_path, content).map_err(|err| InfraError::Storage(err.to_string()))?;
    fs::rename(temp_path, path).map_err(|err| InfraError::Storage(err.to_string()))?;
    Ok(())
}

fn system_log_path(app: &AppHandle) -> Result<PathBuf, InfraError> {
    let directory = working_data_dir(app)?.join("logs");
    fs::create_dir_all(&directory).map_err(|err| InfraError::Storage(err.to_string()))?;
    Ok(directory.join("infrasteward.log"))
}

fn working_data_dir(app: &AppHandle) -> Result<PathBuf, InfraError> {
    if let Some(directory) = configured_working_data_dir(app)? {
        fs::create_dir_all(&directory).map_err(|err| InfraError::Storage(err.to_string()))?;
        return Ok(directory);
    }

    let directory = app
        .path()
        .app_data_dir()
        .map_err(|err| InfraError::Storage(err.to_string()))?;
    fs::create_dir_all(&directory).map_err(|err| InfraError::Storage(err.to_string()))?;
    Ok(directory)
}

fn configured_working_data_dir(app: &AppHandle) -> Result<Option<PathBuf>, InfraError> {
    if let Some(path) = std::env::var_os(DATA_DIR_ENV_VAR)
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
    {
        return Ok(Some(path));
    }

    #[cfg(windows)]
    if let Some(path) = windows_registry_working_data_dir() {
        return Ok(Some(path));
    }

    let config_path = app
        .path()
        .app_config_dir()
        .map_err(|err| InfraError::Storage(err.to_string()))?
        .join(DATA_DIR_OVERRIDE_FILE);
    let Ok(content) = fs::read_to_string(config_path) else {
        return Ok(None);
    };
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    Ok(Some(PathBuf::from(trimmed)))
}

#[cfg(windows)]
fn windows_registry_working_data_dir() -> Option<PathBuf> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu.open_subkey("Software\\InfraSteward").ok()?;
    let value: String = key.get_value("WorkingDataDir").ok()?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(PathBuf::from(trimmed))
    }
}

fn initialize_system_logging(app: &AppHandle) -> Result<PathBuf, InfraError> {
    let path = system_log_path(app)?;
    let panic_log_path = path.clone();
    panic::set_hook(Box::new(move |panic_info| {
        let location = panic_info
            .location()
            .map(|location| format!("{}:{}", location.file(), location.line()))
            .unwrap_or_else(|| "unknown location".into());
        let payload = panic_info
            .payload()
            .downcast_ref::<&str>()
            .map(|message| (*message).to_string())
            .or_else(|| panic_info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "panic without string payload".into());
        write_system_log_at_path(
            &panic_log_path,
            "error",
            "panic",
            "Unhandled Rust panic.",
            Some(format!("{location}: {payload}")),
        );
    }));
    write_system_log_at_path(
        &path,
        "info",
        "backend",
        "System logging initialized.",
        None,
    );
    Ok(path)
}

fn write_system_log(
    app: &AppHandle,
    level: &str,
    target: &str,
    message: &str,
    details: Option<String>,
) {
    if let Ok(path) = system_log_path(app) {
        write_system_log_at_path(&path, level, target, message, details);
    }
}

fn write_system_log_at_path(
    path: &Path,
    level: &str,
    target: &str,
    message: &str,
    details: Option<String>,
) {
    if let Ok(metadata) = fs::metadata(path) {
        if metadata.len() > MAX_SYSTEM_LOG_BYTES {
            let rotated_path = path.with_extension("log.1");
            let _ = fs::rename(path, rotated_path);
        }
    }

    let record = SystemLogRecord {
        timestamp_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or_default(),
        level,
        target,
        message: truncate_log_value(message),
        details: details.map(|value| truncate_log_value(&value)),
    };

    if let Ok(line) = serde_json::to_string(&record) {
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(file, "{line}");
        }
    }
}

fn truncate_log_value(value: &str) -> String {
    const MAX_LOG_VALUE_CHARS: usize = 8_000;
    if value.chars().count() <= MAX_LOG_VALUE_CHARS {
        return value.into();
    }
    let mut truncated = value.chars().take(MAX_LOG_VALUE_CHARS).collect::<String>();
    truncated.push_str("... [truncated]");
    truncated
}

fn open_directory(path: &Path) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        Command::new("explorer").arg(path).spawn()?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open").arg(path).spawn()?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open").arg(path).spawn()?;
        return Ok(());
    }
}

fn mcp_server_status(server: Option<&McpBridgeServer>) -> McpServerStatus {
    McpServerStatus {
        running: server.is_some(),
        url: server.map(|server| format!("http://127.0.0.1:{}", server.port)),
    }
}

fn start_mcp_bridge(app: AppHandle) -> Result<McpBridgeServer, InfraError> {
    let listener = TcpListener::bind(("127.0.0.1", MCP_BRIDGE_PORT))
        .map_err(|err| InfraError::Storage(format!("Failed to start MCP server: {err}")))?;
    listener
        .set_nonblocking(true)
        .map_err(|err| InfraError::Storage(err.to_string()))?;
    let shutdown = Arc::new(AtomicBool::new(false));
    let thread_shutdown = shutdown.clone();
    let thread_app = app.clone();
    let handle = thread::spawn(move || {
        while !thread_shutdown.load(Ordering::SeqCst) {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let request_app = thread_app.clone();
                    thread::spawn(move || {
                        let _ = handle_mcp_bridge_request(&request_app, &mut stream);
                    });
                }
                Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(50));
                }
                Err(err) => {
                    write_system_log(
                        &thread_app,
                        "error",
                        "mcp",
                        "MCP server accept failed.",
                        Some(err.to_string()),
                    );
                    break;
                }
            }
        }
    });
    write_system_log(
        &app,
        "info",
        "mcp",
        "MCP server started.",
        Some(format!("url=http://127.0.0.1:{MCP_BRIDGE_PORT}")),
    );
    Ok(McpBridgeServer {
        port: MCP_BRIDGE_PORT,
        shutdown,
        handle: Some(handle),
    })
}

fn handle_mcp_bridge_request(app: &AppHandle, stream: &mut TcpStream) -> std::io::Result<()> {
    let request = read_http_request(stream)?;
    let response = match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/health") => http_json_response(
            200,
            &serde_json::json!({
                "status": "running",
                "name": "infrasteward",
                "version": "0.1.0"
            }),
        ),
        ("GET", "/tools") => match read_shared_app_data(app) {
            Ok(data) => http_json_response(200, &create_mcp_tool_definitions(&data)),
            Err(err) => http_error_response(500, &err.to_string()),
        },
        ("POST", "/execute") => {
            match serde_json::from_slice::<McpBridgeExecuteRequest>(&request.body) {
                Ok(request) => match execute_mcp_bridge_script(app, request) {
                    Ok(result) => http_json_response(200, &result),
                    Err(err) => http_error_response(500, &err.to_string()),
                },
                Err(err) => http_error_response(400, &format!("Invalid execute request: {err}")),
            }
        }
        _ => http_error_response(404, "Not found"),
    };
    stream.write_all(response.as_bytes())
}

struct HttpRequest {
    method: String,
    path: String,
    body: Vec<u8>,
}

fn read_http_request(stream: &mut TcpStream) -> std::io::Result<HttpRequest> {
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 1024];
    let header_end;
    loop {
        let read = stream.read(&mut chunk)?;
        if read == 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                "HTTP request ended before headers.",
            ));
        }
        buffer.extend_from_slice(&chunk[..read]);
        if let Some(position) = find_header_end(&buffer) {
            header_end = position;
            break;
        }
        if buffer.len() > 64 * 1024 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "HTTP headers are too large.",
            ));
        }
    }

    let header_text = String::from_utf8_lossy(&buffer[..header_end]);
    let mut lines = header_text.lines();
    let request_line = lines.next().unwrap_or_default();
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next().unwrap_or_default().to_string();
    let path = request_parts
        .next()
        .unwrap_or_default()
        .split('?')
        .next()
        .unwrap_or_default()
        .to_string();
    let content_length = lines
        .filter_map(|line| line.split_once(':'))
        .find(|(name, _)| name.eq_ignore_ascii_case("content-length"))
        .and_then(|(_, value)| value.trim().parse::<usize>().ok())
        .unwrap_or(0);
    let body_start = header_end + 4;
    while buffer.len() < body_start + content_length {
        let read = stream.read(&mut chunk)?;
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..read]);
    }
    let body = buffer
        .get(body_start..body_start + content_length)
        .unwrap_or_default()
        .to_vec();

    Ok(HttpRequest { method, path, body })
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn http_json_response<T: Serialize>(status: u16, value: &T) -> String {
    let body = serde_json::to_string(value).unwrap_or_else(|_| "{}".into());
    http_response(status, "application/json", &body)
}

fn http_error_response(status: u16, message: &str) -> String {
    http_json_response(
        status,
        &serde_json::json!({
            "error": message
        }),
    )
}

fn http_response(status: u16, content_type: &str, body: &str) -> String {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        500 => "Internal Server Error",
        _ => "OK",
    };
    format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.as_bytes().len()
    )
}

fn read_shared_app_data(app: &AppHandle) -> Result<AppData, InfraError> {
    let state = app.state::<SharedAppData>();
    let mut data = state
        .lock()
        .map_err(|err| InfraError::Storage(err.to_string()))?
        .clone();
    hydrate_script_contents(app, &mut data)?;
    Ok(data)
}

fn execute_mcp_bridge_script(
    app: &AppHandle,
    request: McpBridgeExecuteRequest,
) -> Result<ExecutionResult, InfraError> {
    let data = read_shared_app_data(app)?;
    let workspace = find_workspace(&data, &request.workspace_id)?.clone();
    let attached = workspace
        .attached_scripts
        .iter()
        .find(|attached| attached.id == request.attached_script_id)
        .ok_or(InfraError::MissingAttachment)?;
    if !attached.use_in_mcp {
        return Err(InfraError::Validation(
            "This script is not enabled for MCP.".into(),
        ));
    }
    let script = data
        .global_scripts
        .iter()
        .find(|script| script.id == attached.global_script_id)
        .ok_or(InfraError::MissingScript)?;
    let script_content = read_script_file(app, script)?;
    let mut args = request.args.unwrap_or_default();
    let timeout_seconds = parse_mcp_timeout_seconds(args.remove(MCP_TIMEOUT_PARAMETER))?;
    let mut settings = attached.parameter_settings.clone();
    for (key, value) in args {
        settings.insert(
            key,
            ScriptParameterSetting {
                value: mcp_arg_to_string(value),
                use_from_environment: false,
            },
        );
    }
    let command = prepare_remote_command(&script_content, &settings);
    let mut connection = workspace.connection.clone();
    connection.execution_timeout_seconds = Some(timeout_seconds);
    let cancel_flag = Arc::new(AtomicBool::new(false));
    let events = Arc::new(Mutex::new(VecDeque::new()));
    execute_ssh_command(
        app,
        &connection,
        &format!("mcp_{}", Uuid::new_v4()),
        &request.workspace_id,
        &request.attached_script_id,
        &command,
        &cancel_flag,
        &events,
    )
}

fn parse_mcp_timeout_seconds(value: Option<serde_json::Value>) -> Result<u64, InfraError> {
    let Some(value) = value else {
        return Ok(MCP_DEFAULT_TIMEOUT_SECONDS);
    };
    let parsed = match value {
        serde_json::Value::Null => MCP_DEFAULT_TIMEOUT_SECONDS,
        serde_json::Value::Number(number) => number.as_u64().ok_or_else(|| {
            InfraError::Validation(format!(
                "{MCP_TIMEOUT_PARAMETER} must be a whole number from 1 to {MCP_MAX_TIMEOUT_SECONDS}."
            ))
        })?,
        serde_json::Value::String(value) => value.trim().parse::<u64>().map_err(|_| {
            InfraError::Validation(format!(
                "{MCP_TIMEOUT_PARAMETER} must be a whole number from 1 to {MCP_MAX_TIMEOUT_SECONDS}."
            ))
        })?,
        _ => {
            return Err(InfraError::Validation(format!(
                "{MCP_TIMEOUT_PARAMETER} must be a whole number from 1 to {MCP_MAX_TIMEOUT_SECONDS}."
            )));
        }
    };
    Ok(parsed.clamp(1, MCP_MAX_TIMEOUT_SECONDS))
}

fn mcp_arg_to_string(value: serde_json::Value) -> String {
    match value {
        serde_json::Value::String(value) => value,
        serde_json::Value::Null => String::new(),
        serde_json::Value::Bool(value) => value.to_string(),
        serde_json::Value::Number(value) => value.to_string(),
        value => value.to_string(),
    }
}

fn create_mcp_tool_definitions(data: &AppData) -> Vec<McpToolDefinition> {
    let mut drafts = Vec::new();
    for workspace in &data.workspaces {
        let connection_name = if workspace.connection.name.trim().is_empty() {
            workspace.title.as_str()
        } else {
            workspace.connection.name.as_str()
        };
        for attached in &workspace.attached_scripts {
            if !attached.use_in_mcp {
                continue;
            }
            let Some(script) = data
                .global_scripts
                .iter()
                .find(|script| script.id == attached.global_script_id)
            else {
                continue;
            };
            let mut properties = extract_script_variables(&script.content)
                .into_iter()
                .map(|variable| {
                    (
                        variable.clone(),
                        McpInputProperty {
                            r#type: "string".into(),
                            description: format!(
                                "Value for {variable}. Omit to use the remote environment or script default."
                            ),
                        },
                    )
                })
                .collect::<HashMap<_, _>>();
            properties.insert(
                MCP_TIMEOUT_PARAMETER.into(),
                McpInputProperty {
                    r#type: "integer".into(),
                    description: format!(
                        "MCP execution timeout in seconds, from 1 to {MCP_MAX_TIMEOUT_SECONDS}. Defaults to {MCP_DEFAULT_TIMEOUT_SECONDS}."
                    ),
                },
            );
            let script_tag = if attached.tag.trim().is_empty() {
                "default"
            } else {
                attached.tag.trim()
            };
            drafts.push((
                to_tool_slug(&format!("{connection_name}_{}_{}", script.name, script_tag)),
                McpToolDefinition {
                    name: String::new(),
                    description: mcp_tool_description(
                        &script.description,
                        &attached.description,
                        &script.name,
                        script_tag,
                        connection_name,
                    ),
                    workspace_id: workspace.id.clone(),
                    workspace_title: connection_name.into(),
                    attached_script_id: attached.id.clone(),
                    global_script_id: script.id.clone(),
                    input_schema: McpInputSchema {
                        r#type: "object".into(),
                        properties,
                        additional_properties: false,
                    },
                },
            ));
        }
    }
    dedupe_mcp_tool_names(drafts)
}

fn mcp_tool_description(
    script_description: &str,
    attachment_description: &str,
    script_name: &str,
    script_tag: &str,
    connection_name: &str,
) -> String {
    let specific_description = attachment_description.trim();
    let base_description = script_description.trim();
    if !specific_description.is_empty() && !base_description.is_empty() {
        return format!("{specific_description}\n\nBase script: {base_description}");
    }
    if !specific_description.is_empty() {
        return specific_description.into();
    }
    if !base_description.is_empty() {
        return base_description.into();
    }
    format!("Run {script_name} ({script_tag}) on {connection_name}.")
}

fn dedupe_mcp_tool_names(drafts: Vec<(String, McpToolDefinition)>) -> Vec<McpToolDefinition> {
    let mut used = HashMap::<String, usize>::new();
    drafts
        .into_iter()
        .map(|(base_name, mut definition)| {
            let base_name = if base_name.is_empty() {
                format!("script_{}", definition.global_script_id)
            } else {
                base_name
            };
            let count = *used.get(&base_name).unwrap_or(&0);
            used.insert(base_name.clone(), count + 1);
            definition.name = if count == 0 {
                base_name
            } else {
                format!(
                    "{}_{}",
                    base_name,
                    stable_suffix(&definition.attached_script_id)
                )
            };
            definition
        })
        .collect()
}

fn to_tool_slug(value: &str) -> String {
    let mut output = String::new();
    let mut previous_was_separator = false;
    for character in value.trim().to_lowercase().chars() {
        if character.is_ascii_alphanumeric() {
            output.push(character);
            previous_was_separator = false;
        } else if !previous_was_separator && !output.is_empty() {
            output.push('_');
            previous_was_separator = true;
        }
    }
    while output.ends_with('_') {
        output.pop();
    }
    output
}

fn stable_suffix(value: &str) -> String {
    let mut hash = 0_u32;
    for byte in value.bytes() {
        hash = hash.wrapping_mul(31).wrapping_add(byte as u32);
    }
    to_base36(hash).chars().take(6).collect()
}

fn to_base36(mut value: u32) -> String {
    if value == 0 {
        return "0".into();
    }
    let mut output = Vec::new();
    while value > 0 {
        let digit = (value % 36) as u8;
        output.push(match digit {
            0..=9 => (b'0' + digit) as char,
            _ => (b'a' + digit - 10) as char,
        });
        value /= 36;
    }
    output.iter().rev().collect()
}

fn extract_script_variables(content: &str) -> Vec<String> {
    let chars = content.chars().collect::<Vec<_>>();
    let mut variables = Vec::new();
    for index in 0..chars.len().saturating_sub(1) {
        if chars[index] != '$' || chars[index + 1] != '{' || is_escaped_dollar(&chars, index) {
            continue;
        }
        let mut end = index + 2;
        while end < chars.len() && chars[end] != '}' {
            end += 1;
        }
        if end >= chars.len() {
            continue;
        }
        let expression = chars[index + 2..end].iter().collect::<String>();
        let variable = expression
            .chars()
            .take_while(|character| character.is_ascii_alphanumeric() || *character == '_')
            .collect::<String>();
        if variable
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_alphabetic() || character == '_')
            && !variables.contains(&variable)
        {
            variables.push(variable);
        }
    }
    variables
}

fn is_escaped_dollar(chars: &[char], dollar_index: usize) -> bool {
    let mut slash_count = 0;
    let mut index = dollar_index;
    while index > 0 {
        index -= 1;
        if chars[index] != '\\' {
            break;
        }
        slash_count += 1;
    }
    slash_count % 2 == 1
}

struct SecretStore<'a> {
    app: &'a AppHandle,
}

impl<'a> SecretStore<'a> {
    fn new(app: &'a AppHandle) -> Self {
        Self { app }
    }

    fn set(&self, reference: &str, value: &str, allow_insecure: bool) -> Result<(), InfraError> {
        match self.set_os_secret(reference, value) {
            Ok(()) => {
                if let Err(err) = self.get_preferred_keyring_with_retry(reference) {
                    if allow_insecure {
                        self.set_insecure(reference, value).map_err(|fallback_err| {
                            InfraError::Secret(format!("OS keychain saved but could not be read back ({err}); insecure fallback failed ({fallback_err})"))
                        })?;
                        return Ok(());
                    }
                    return Err(InfraError::Secret(format!(
                        "OS keychain saved the secret but could not read it back: {err}. Enable insecure fallback explicitly if you accept the risk."
                    )));
                }

                if allow_insecure {
                    self.set_insecure(reference, value).map_err(|fallback_err| {
                        InfraError::Secret(format!("OS keychain saved the secret, but insecure fallback also requested and failed ({fallback_err})"))
                    })?;
                }

                Ok(())
            }
            Err(err) if allow_insecure => self.set_insecure(reference, value).map_err(|fallback_err| {
                InfraError::Secret(format!("OS keychain failed ({err}); insecure fallback failed ({fallback_err})"))
            }),
            Err(err) => Err(InfraError::Secret(format!(
                "OS keychain is unavailable: {err}. Enable insecure fallback explicitly if you accept the risk."
            ))),
        }
    }

    fn get(&self, reference: &str) -> Result<String, InfraError> {
        match self.get_from_keyring(reference) {
            Ok(value) => Ok(value),
            Err(keychain_err) => self.get_insecure(reference, Some(keychain_err.to_string())),
        }
    }

    fn set_os_secret(&self, reference: &str, value: &str) -> Result<(), String> {
        #[cfg(windows)]
        {
            windows_set_secret(reference, value)
        }

        #[cfg(not(windows))]
        {
            keyring::Entry::new(SERVICE_NAME, reference)
                .and_then(|entry| entry.set_password(value))
                .map_err(|err| err.to_string())
        }
    }

    fn get_os_secret(&self, reference: &str) -> Result<String, String> {
        #[cfg(windows)]
        {
            windows_get_secret(reference)
        }

        #[cfg(not(windows))]
        {
            keyring::Entry::new(SERVICE_NAME, reference)
                .and_then(|entry| entry.get_password())
                .map_err(|err| err.to_string())
        }
    }

    fn get_preferred_keyring_with_retry(&self, reference: &str) -> Result<String, String> {
        let mut last_error = None;
        for attempt in 0..10 {
            match self.get_os_secret(reference) {
                Ok(value) => return Ok(value),
                Err(err) => {
                    last_error = Some(err);
                    if attempt < 9 {
                        std::thread::sleep(Duration::from_millis(50));
                    }
                }
            }
        }

        Err(last_error.expect("keyring read retry must record an error"))
    }

    fn get_from_keyring(&self, reference: &str) -> Result<String, String> {
        match self.get_os_secret(reference) {
            Ok(value) => Ok(value),
            Err(preferred_err) => match keyring::Entry::new(SERVICE_NAME, reference)
                .and_then(|entry| entry.get_password())
            {
                Ok(value) => {
                    let _ = self.set_os_secret(reference, &value);
                    Ok(value)
                }
                Err(_) => Err(preferred_err),
            },
        }
    }

    fn insecure_path(&self) -> Result<PathBuf, InfraError> {
        let directory = working_data_dir(self.app)?;
        fs::create_dir_all(&directory).map_err(|err| InfraError::Storage(err.to_string()))?;
        Ok(directory.join("insecure-secrets.json"))
    }

    fn set_insecure(&self, reference: &str, value: &str) -> Result<(), String> {
        let path = self.insecure_path().map_err(|err| err.to_string())?;
        let mut values: HashMap<String, String> = fs::read_to_string(&path)
            .ok()
            .and_then(|content| serde_json::from_str(&content).ok())
            .unwrap_or_default();
        values.insert(reference.into(), value.into());
        let content = serde_json::to_string_pretty(&values).map_err(|err| err.to_string())?;
        fs::write(path, content).map_err(|err| err.to_string())
    }

    fn get_insecure(
        &self,
        reference: &str,
        keychain_error: Option<String>,
    ) -> Result<String, InfraError> {
        let path = self.insecure_path()?;
        let content = fs::read_to_string(path).map_err(|_| {
            InfraError::Secret(missing_secret_message(reference, keychain_error.as_deref()))
        })?;
        let values: HashMap<String, String> =
            serde_json::from_str(&content).map_err(|err| InfraError::Secret(err.to_string()))?;
        values.get(reference).cloned().ok_or_else(|| {
            InfraError::Secret(missing_secret_message(reference, keychain_error.as_deref()))
        })
    }
}

fn missing_secret_message(reference: &str, keychain_error: Option<&str>) -> String {
    let detail = keychain_error
        .map(|error| format!(" OS keychain read failed with: {error}."))
        .unwrap_or_default();
    format!("Saved secret '{reference}' could not be resolved.{detail} Re-enter the credential in Connection Settings, enable insecure fallback if the OS keychain is unavailable, and save the connection.")
}

#[cfg(windows)]
fn windows_keyring_target(reference: &str) -> String {
    let sanitized = reference
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    format!("{SERVICE_NAME}.{sanitized}")
}

#[cfg(windows)]
fn windows_set_secret(reference: &str, value: &str) -> Result<(), String> {
    let target = windows_keyring_target(reference);
    let mut target_name = windows_wide_null(&target);
    let mut user_name = windows_wide_null(reference);
    let mut comment = windows_wide_null("InfraSteward SSH secret");
    let mut blob = value.as_bytes().to_vec();
    let credential = CREDENTIALW {
        Flags: 0,
        Type: CRED_TYPE_GENERIC,
        TargetName: target_name.as_mut_ptr(),
        Comment: comment.as_mut_ptr(),
        LastWritten: FILETIME {
            dwLowDateTime: 0,
            dwHighDateTime: 0,
        },
        CredentialBlobSize: blob.len() as u32,
        CredentialBlob: blob.as_mut_ptr(),
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        AttributeCount: 0,
        Attributes: ptr::null_mut(),
        TargetAlias: ptr::null_mut(),
        UserName: user_name.as_mut_ptr(),
    };

    let result = unsafe { CredWriteW(&credential, 0) };
    if result == 0 {
        return Err(windows_credential_error("CredWriteW"));
    }

    Ok(())
}

#[cfg(windows)]
fn windows_get_secret(reference: &str) -> Result<String, String> {
    let target = windows_keyring_target(reference);
    let target_name = windows_wide_null(&target);
    let mut credential: *mut CREDENTIALW = ptr::null_mut();
    let result = unsafe { CredReadW(target_name.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) };

    if result == 0 {
        return Err(windows_credential_error("CredReadW"));
    }

    let read_result = unsafe {
        let credential_ref = &*credential;
        let blob = std::slice::from_raw_parts(
            credential_ref.CredentialBlob,
            credential_ref.CredentialBlobSize as usize,
        );
        String::from_utf8(blob.to_vec()).map_err(|err| err.to_string())
    };
    unsafe { CredFree(credential as *const _) };

    read_result
}

#[cfg(windows)]
fn windows_wide_null(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
fn windows_credential_error(operation: &str) -> String {
    let code = unsafe { GetLastError() };
    if code == ERROR_NOT_FOUND {
        return "No matching entry found in secure storage.".into();
    }
    format!("{operation} failed with Windows error {code}.")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if let Err(err) = initialize_system_logging(app.handle()) {
                eprintln!("InfraSteward system logging initialization failed: {err}");
            }
            let data = read_app_data(app.handle());
            app.manage(Mutex::new(data));
            app.manage(Mutex::new(HashMap::<String, ActiveExecution>::new()));
            app.manage(Mutex::new(None::<McpBridgeServer>));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_app_data,
            save_app_data,
            save_global_script,
            delete_global_script,
            read_global_script_content,
            save_connection,
            test_connection,
            run_script,
            cancel_script,
            drain_script_events,
            log_system_event,
            get_runtime_info,
            get_mcp_server_status,
            start_mcp_server,
            stop_mcp_server,
            open_working_data_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running InfraSteward");
}
