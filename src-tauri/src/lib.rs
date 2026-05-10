use serde::{Deserialize, Serialize};
use ssh2::Session;
use std::{
    collections::HashMap,
    fs,
    io::Read,
    net::TcpStream,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
use tauri::{AppHandle, Manager, State};
use tempfile::NamedTempFile;
use uuid::Uuid;

const SCHEMA_VERSION: u32 = 1;
const MAX_LOGS_PER_WORKSPACE: usize = 500;
const SERVICE_NAME: &str = "InfraSteward";

type SharedAppData = Mutex<AppData>;

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
pub struct ExecutionResult {
    status: String,
    stdout: String,
    stderr: String,
    exit_code: Option<i32>,
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
    Ok(state.lock().map_err(|err| InfraError::Storage(err.to_string()))?.clone())
}

#[tauri::command]
fn save_app_data(app: AppHandle, state: State<'_, SharedAppData>, app_data: AppData) -> Result<(), InfraError> {
    let normalized = normalize_app_data(app_data);
    write_app_data(&app, &normalized)?;
    *state.lock().map_err(|err| InfraError::Storage(err.to_string()))? = normalized;
    Ok(())
}

#[tauri::command]
fn save_connection(
    app: AppHandle,
    state: State<'_, SharedAppData>,
    request: ConnectionSaveRequest,
) -> Result<AppData, InfraError> {
    let mut data = state.lock().map_err(|err| InfraError::Storage(err.to_string()))?.clone();
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
        secret_store.set(&reference, &password, request.secrets.allow_insecure_secret_storage.unwrap_or(false))?;
        connection.password_ref = Some(reference);
    }
    if let Some(private_key) = request.secrets.private_key_content.filter(|value| !value.is_empty()) {
        let reference = format!("{}:private-key", connection.id);
        secret_store.set(&reference, &private_key, request.secrets.allow_insecure_secret_storage.unwrap_or(false))?;
        connection.private_key_content_ref = Some(reference);
    }
    if let Some(passphrase) = request.secrets.passphrase.filter(|value| !value.is_empty()) {
        let reference = format!("{}:passphrase", connection.id);
        secret_store.set(&reference, &passphrase, request.secrets.allow_insecure_secret_storage.unwrap_or(false))?;
        connection.passphrase_ref = Some(reference);
    }

    workspace.connection = connection;
    write_app_data(&app, &data)?;
    *state.lock().map_err(|err| InfraError::Storage(err.to_string()))? = data.clone();
    Ok(data)
}

#[tauri::command]
fn test_connection(app: AppHandle, state: State<'_, SharedAppData>, workspace_id: String) -> Result<String, InfraError> {
    let data = state.lock().map_err(|err| InfraError::Storage(err.to_string()))?.clone();
    let workspace = find_workspace(&data, &workspace_id)?;
    let session = connect_session(&app, &workspace.connection)?;
    session.disconnect(None, "InfraSteward connection test finished", None).ok();
    Ok(format!("Connected to {} as {}.", workspace.connection.host, workspace.connection.username))
}

#[tauri::command]
fn run_script(app: AppHandle, state: State<'_, SharedAppData>, request: ExecutionRequest) -> Result<ExecutionResult, InfraError> {
    let data = state.lock().map_err(|err| InfraError::Storage(err.to_string()))?.clone();
    let workspace = find_workspace(&data, &request.workspace_id)?;
    let attached = workspace
        .attached_scripts
        .iter()
        .find(|attached| attached.id == request.attached_script_id)
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
    execute_ssh_command(&app, &workspace.connection, &command)
}

fn connect_session(app: &AppHandle, connection: &SshConnectionConfig) -> Result<Session, InfraError> {
    validate_connection(connection)?;
    let address = format!("{}:{}", connection.host, connection.port);
    let timeout = Duration::from_secs(connection.connection_timeout_seconds.unwrap_or(15));
    let tcp = TcpStream::connect(address).map_err(|err| InfraError::Ssh(format!("Host unreachable: {err}")))?;
    tcp.set_read_timeout(Some(timeout)).ok();
    tcp.set_write_timeout(Some(timeout)).ok();

    let mut session = Session::new().map_err(|err| InfraError::Ssh(err.to_string()))?;
    session.set_tcp_stream(tcp);
    session.handshake().map_err(|err| InfraError::Ssh(format!("Handshake failed: {err}")))?;

    match connection.auth_type {
        AuthType::Password => {
            let reference = connection
                .password_ref
                .as_ref()
                .ok_or_else(|| InfraError::Validation("Missing saved password reference.".into()))?;
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
            if let Some(path) = connection.private_key_path.as_ref().filter(|path| !path.is_empty()) {
                if !Path::new(path).exists() {
                    return Err(InfraError::Validation("Private key file does not exist.".into()));
                }
                session
                    .userauth_pubkey_file(&connection.username, None, Path::new(path), passphrase.as_deref())
                    .map_err(|err| InfraError::Ssh(format!("Private key authentication failed: {err}")))?;
            } else if let Some(reference) = &connection.private_key_content_ref {
                let private_key = SecretStore::new(app).get(reference)?;
                let mut file = NamedTempFile::new().map_err(|err| InfraError::Storage(err.to_string()))?;
                std::io::Write::write_all(&mut file, private_key.as_bytes()).map_err(|err| InfraError::Storage(err.to_string()))?;
                session
                    .userauth_pubkey_file(&connection.username, None, file.path(), passphrase.as_deref())
                    .map_err(|err| InfraError::Ssh(format!("Private key authentication failed: {err}")))?;
            } else {
                return Err(InfraError::Validation("Missing private key path or saved private key content.".into()));
            }
        }
    }

    if !session.authenticated() {
        return Err(InfraError::Ssh("Authentication failed.".into()));
    }

    Ok(session)
}

fn execute_ssh_command(app: &AppHandle, connection: &SshConnectionConfig, command: &str) -> Result<ExecutionResult, InfraError> {
    let session = connect_session(app, connection)?;
    let mut channel = session.channel_session().map_err(|err| InfraError::Ssh(err.to_string()))?;
    channel.exec(command).map_err(|err| InfraError::Ssh(format!("Script start failed: {err}")))?;

    let mut stdout = String::new();
    channel.read_to_string(&mut stdout).map_err(|err| InfraError::Ssh(err.to_string()))?;
    let mut stderr = String::new();
    channel.stderr().read_to_string(&mut stderr).map_err(|err| InfraError::Ssh(err.to_string()))?;
    channel.wait_close().map_err(|err| InfraError::Ssh(err.to_string()))?;
    let exit_code = channel.exit_status().ok();
    let status = if exit_code == Some(0) { "success" } else { "failed" };

    Ok(ExecutionResult {
        status: status.into(),
        stdout,
        stderr,
        exit_code,
    })
}

fn prepare_remote_command(script_content: &str, settings: &HashMap<String, ScriptParameterSetting>) -> String {
    let env_prefix = settings
        .iter()
        .filter(|(_, setting)| !setting.use_from_environment && !setting.value.is_empty())
        .map(|(name, setting)| format!("{name}={}", shell_single_quote(&setting.value)))
        .collect::<Vec<_>>()
        .join(" ");

    format!(
        "{}bash -s <<'INFRAS_EOF'\n{}\nINFRAS_EOF",
        if env_prefix.is_empty() { String::new() } else { format!("{env_prefix} ") },
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
        return Err(InfraError::Validation("Port must be from 1 to 65535.".into()));
    }
    Ok(())
}

fn find_workspace<'a>(data: &'a AppData, workspace_id: &str) -> Result<&'a WorkspaceTab, InfraError> {
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
    if !data.workspaces.iter().any(|workspace| workspace.id == data.active_tab_id) {
        data.active_tab_id = data.workspaces[0].id.clone();
    }
    for workspace in &mut data.workspaces {
        if workspace.logs.len() > MAX_LOGS_PER_WORKSPACE {
            workspace.logs = workspace.logs.split_off(workspace.logs.len() - MAX_LOGS_PER_WORKSPACE);
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
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|err| InfraError::Storage(err.to_string()))?;
    fs::create_dir_all(&directory).map_err(|err| InfraError::Storage(err.to_string()))?;
    Ok(directory.join("app-data.json"))
}

fn read_app_data(app: &AppHandle) -> AppData {
    let Ok(path) = app_data_path(app) else {
        return default_app_data();
    };
    let Ok(content) = fs::read_to_string(path) else {
        return default_app_data();
    };
    serde_json::from_str(&content).map(normalize_app_data).unwrap_or_else(|_| default_app_data())
}

fn write_app_data(app: &AppHandle, data: &AppData) -> Result<(), InfraError> {
    let path = app_data_path(app)?;
    let temp_path = path.with_extension("json.tmp");
    let content = serde_json::to_string_pretty(data).map_err(|err| InfraError::Storage(err.to_string()))?;
    fs::write(&temp_path, content).map_err(|err| InfraError::Storage(err.to_string()))?;
    fs::rename(temp_path, path).map_err(|err| InfraError::Storage(err.to_string()))?;
    Ok(())
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
        let directory = self
            .app
            .path()
            .app_data_dir()
            .map_err(|err| InfraError::Storage(err.to_string()))?;
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

    fn get_insecure(&self, reference: &str, keychain_error: Option<String>) -> Result<String, InfraError> {
        let path = self.insecure_path()?;
        let content = fs::read_to_string(path).map_err(|_| InfraError::Secret(missing_secret_message(reference, keychain_error.as_deref())))?;
        let values: HashMap<String, String> = serde_json::from_str(&content).map_err(|err| InfraError::Secret(err.to_string()))?;
        values
            .get(reference)
            .cloned()
            .ok_or_else(|| InfraError::Secret(missing_secret_message(reference, keychain_error.as_deref())))
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
            let data = read_app_data(app.handle());
            app.manage(Mutex::new(data));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_app_data,
            save_app_data,
            save_connection,
            test_connection,
            run_script
        ])
        .run(tauri::generate_context!())
        .expect("error while running InfraSteward");
}
