export type AuthType = "password" | "privateKey";

export type ExecutionStatus =
  | "starting"
  | "connecting"
  | "connected"
  | "running"
  | "success"
  | "failed"
  | "cancelled"
  | "timeout";

export type LogLevel = "info" | "warn" | "error" | "stdout" | "stderr";

export type GlobalScript = {
  id: string;
  name: string;
  description: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type ScriptParameterSetting = {
  value: string;
  useFromEnvironment: boolean;
};

export type AttachedScript = {
  id: string;
  globalScriptId: string;
  parameterSettings: Record<string, ScriptParameterSetting>;
  useInMcp: boolean;
  selected?: boolean;
};

export type SshConnectionConfig = {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  passwordRef?: string;
  privateKeyPath?: string;
  privateKeyContentRef?: string;
  passphraseRef?: string;
  connectionTimeoutSeconds?: number;
  executionTimeoutSeconds?: number;
};

export type LogEntry = {
  id: string;
  timestamp: string;
  level: LogLevel;
  message: string;
  scriptId?: string;
  executionId?: string;
  status?: ExecutionStatus;
};

export type WorkspaceTab = {
  id: string;
  title: string;
  connection: SshConnectionConfig;
  attachedScripts: AttachedScript[];
  logs: LogEntry[];
};

export type AppData = {
  schemaVersion: number;
  activeTabId: string;
  globalScripts: GlobalScript[];
  workspaces: WorkspaceTab[];
};

export type SecretInput = {
  password?: string;
  privateKeyContent?: string;
  passphrase?: string;
  allowInsecureSecretStorage?: boolean;
};

export type ConnectionSaveRequest = {
  workspaceId: string;
  connection: SshConnectionConfig;
  secrets: SecretInput;
};

export type PreparedCommand = {
  command: string;
  environment: Record<string, string>;
};

export type ExecutionRequest = {
  workspaceId: string;
  attachedScriptId: string;
  parameterOverrides?: Record<string, string>;
};

export type ExecutionResult = {
  status: ExecutionStatus;
  stdout: string;
  stderr: string;
  exitCode?: number;
};

export type ExecutionStart = {
  executionId: string;
};

export type ScriptExecutionEvent = {
  kind: "output" | "finished";
  workspaceId: string;
  attachedScriptId: string;
  stream?: "stdout" | "stderr";
  chunk?: string;
  status?: ExecutionStatus;
  exitCode?: number;
  message?: string;
};

export type McpToolDefinition = {
  name: string;
  description: string;
  workspaceId: string;
  workspaceTitle: string;
  attachedScriptId: string;
  globalScriptId: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: "string"; description: string }>;
    additionalProperties: false;
  };
};
