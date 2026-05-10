use serde::{Deserialize, Serialize};
use ssh2::Session;
use std::{
    collections::{HashMap, VecDeque},
    fs::{self, OpenOptions},
    io::{Read, Write},
    net::TcpStream,
    panic,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State};
use tempfile::NamedTempFile;
use uuid::Uuid;
#[cfg(windows)]
use winreg::{enums::HKEY_CURRENT_USER, RegKey};

const SCHEMA_VERSION: u32 = 1;
const MAX_LOGS_PER_WORKSPACE: usize = 500;
const MAX_SYSTEM_LOG_BYTES: u64 = 2 * 1024 * 1024;
const SERVICE_NAME: &str = "InfraSteward";
const DATA_DIR_ENV_VAR: &str = "INFRASTEWARD_DATA_DIR";
const DATA_DIR_OVERRIDE_FILE: &str = "data-dir.txt";

type SharedAppData = Mutex<AppData>;
type ActiveExecutions = Mutex<HashMap<String, ActiveExecution>>;

struct ActiveExecution {
    cancel_flag: Arc<AtomicBool>,
    events: Arc<Mutex<VecDeque<ScriptExecutionEvent>>>,
    finished: Arc<AtomicBool>,
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
    parameter_overrides: Option<HashMap<String, String>>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelExecutionRequest {
    workspace_id: String,
    attached_script_id: String,
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
fn load_app_data(state: State<'_, SharedAppData>) -> Result<AppData, InfraError> {
    Ok(state
        .lock()
        .map_err(|err| InfraError::Storage(err.to_string()))?
        .clone())
}

#[tauri::command]
fn save_app_data(
    app: AppHandle,
    state: State<'_, SharedAppData>,
    app_data: AppData,
) -> Result<(), InfraError> {
    let normalized = normalize_app_data(app_data);
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
    let workspace = data
        .workspaces
        .iter_mut()
        .find(|workspace| workspace.id == request.workspace_id)
        .ok_or(InfraError::MissingWorkspace)?;

    validate_connection(&request.connection)?;
    let mut connection = request.connection;
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

    let command = prepare_remote_command(&script.content, &settings);
    let connection = workspace.connection;
    let execution_key = execution_key(&workspace_id, &attached_script_id);
    let cancel_flag = Arc::new(AtomicBool::new(false));
    let events = Arc::new(Mutex::new(VecDeque::new()));
    let finished = Arc::new(AtomicBool::new(false));
    {
        let mut active = active_executions
            .lock()
            .map_err(|err| InfraError::Storage(err.to_string()))?;
        if active.contains_key(&execution_key) {
            return Err(InfraError::Validation("Script is already running.".into()));
        }
        active.insert(
            execution_key.clone(),
            ActiveExecution {
                cancel_flag: cancel_flag.clone(),
                events: events.clone(),
                finished: finished.clone(),
            },
        );
    }

    tauri::async_runtime::spawn_blocking(move || {
        run_script_blocking(
            app,
            workspace_id,
            attached_script_id,
            connection,
            command,
            cancel_flag,
            events,
            finished,
        )
    });

    Ok(ExecutionStart {
        execution_id: execution_key,
    })
}

#[tauri::command]
fn cancel_script(
    active_executions: State<'_, ActiveExecutions>,
    request: CancelExecutionRequest,
) -> Result<(), InfraError> {
    let execution_key = execution_key(&request.workspace_id, &request.attached_script_id);
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
    let execution_key = execution_key(&request.workspace_id, &request.attached_script_id);
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
    })
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
            return Err(InfraError::Ssh(format!(
                "Script timed out after {} seconds.",
                timeout.as_secs()
            )));
        }

        let mut read_any = false;
        read_any |= read_channel_stream(
            app,
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
        if workspace.logs.len() > MAX_LOGS_PER_WORKSPACE {
            workspace.logs = workspace
                .logs
                .split_off(workspace.logs.len() - MAX_LOGS_PER_WORKSPACE);
        }
    }
    data
}

fn default_app_data() -> AppData {
    let workspace = default_workspace();
    AppData {
        schema_version: SCHEMA_VERSION,
        active_tab_id: workspace.id.clone(),
        global_scripts: vec![GlobalScript {
            id: format!("script_{}", Uuid::new_v4()),
            name: "Check Disk Usage".into(),
            description: "Show disk usage for the configured path.".into(),
            content: "df -h \"${TARGET_PATH:-/}\"".into(),
            created_at: "2026-01-01T00:00:00.000Z".into(),
            updated_at: "2026-01-01T00:00:00.000Z".into(),
        }],
        workspaces: vec![workspace],
    }
}

fn default_workspace() -> WorkspaceTab {
    WorkspaceTab {
        id: format!("workspace_{}", Uuid::new_v4()),
        title: "Local Server".into(),
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

fn read_app_data(app: &AppHandle) -> AppData {
    let Ok(path) = app_data_path(app) else {
        return default_app_data();
    };
    let content = match fs::read_to_string(&path) {
        Ok(content) => content,
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
            return default_app_data();
        }
    };
    serde_json::from_str(&content)
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
        })
}

fn write_app_data(app: &AppHandle, data: &AppData) -> Result<(), InfraError> {
    let path = app_data_path(app)?;
    let temp_path = path.with_extension("json.tmp");
    let content =
        serde_json::to_string_pretty(data).map_err(|err| InfraError::Storage(err.to_string()))?;
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

struct SecretStore<'a> {
    app: &'a AppHandle,
}

impl<'a> SecretStore<'a> {
    fn new(app: &'a AppHandle) -> Self {
        Self { app }
    }

    fn set(&self, reference: &str, value: &str, allow_insecure: bool) -> Result<(), InfraError> {
        match keyring::Entry::new(SERVICE_NAME, reference).and_then(|entry| entry.set_password(value)) {
            Ok(()) => {
                if let Err(err) = keyring::Entry::new(SERVICE_NAME, reference).and_then(|entry| entry.get_password()) {
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
        match keyring::Entry::new(SERVICE_NAME, reference).and_then(|entry| entry.get_password()) {
            Ok(value) => Ok(value),
            Err(keychain_err) => self.get_insecure(reference, Some(keychain_err.to_string())),
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_app_data,
            save_app_data,
            save_connection,
            test_connection,
            run_script,
            cancel_script,
            drain_script_events,
            log_system_event,
            get_runtime_info,
            open_working_data_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running InfraSteward");
}
