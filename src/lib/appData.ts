import { createId, nowIso } from "./ids";
import type { AppData, GlobalScript, LocalRunnerConfig, SshConnectionConfig, WorkspaceTab } from "./types";

export const CURRENT_SCHEMA_VERSION = 2;
export const MAX_LOGS_PER_WORKSPACE = 500;
export const DEFAULT_SCRIPT_TAG = "default";
export const LOCAL_WORKSPACE_ID = "workspace_local";

export function createDefaultConnection(): SshConnectionConfig {
  return {
    id: createId("conn"),
    name: "",
    host: "",
    port: 22,
    username: "",
    authType: "privateKey",
    workingDirectory: "",
    connectionTimeoutSeconds: 15,
    executionTimeoutSeconds: 300
  };
}

export function createDefaultLocalRunner(): LocalRunnerConfig {
  const userAgent = typeof globalThis.navigator === "undefined" ? "" : globalThis.navigator.userAgent.toLowerCase();
  const platform = typeof globalThis.navigator === "undefined" ? "" : globalThis.navigator.platform.toLowerCase();
  if (platform.includes("win") || userAgent.includes("windows")) {
    return { kind: "gitBash", executionTimeoutSeconds: 300 };
  }
  if (platform.includes("mac") || userAgent.includes("mac os")) {
    return { kind: "zsh", executionTimeoutSeconds: 300 };
  }
  return { kind: "bash", executionTimeoutSeconds: 300 };
}

export function createWorkspace(title = "New Workspace"): WorkspaceTab {
  return {
    id: createId("workspace"),
    title,
    kind: "ssh",
    connection: createDefaultConnection(),
    localRunner: createDefaultLocalRunner(),
    parameterSettings: {},
    attachedScripts: [],
    logs: []
  };
}

export function createLocalWorkspace(): WorkspaceTab {
  return {
    id: LOCAL_WORKSPACE_ID,
    title: "LOCAL",
    kind: "local",
    connection: { ...createDefaultConnection(), id: "conn_local", name: "LOCAL" },
    localRunner: createDefaultLocalRunner(),
    parameterSettings: {},
    attachedScripts: [],
    logs: []
  };
}

export function createGlobalScript(fields?: Partial<GlobalScript>): GlobalScript {
  const timestamp = nowIso();
  const name = fields?.name ?? "New Script";
  return {
    id: createId("script"),
    name,
    description: fields?.description ?? "",
    fileName: fields?.fileName ?? scriptFileName(name),
    content: fields?.content ?? "",
    createdAt: fields?.createdAt ?? timestamp,
    updatedAt: fields?.updatedAt ?? timestamp
  };
}

export function createDefaultAppData(): AppData {
  const workspace = createLocalWorkspace();
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    activeTabId: workspace.id,
    globalScripts: [],
    workspaces: [workspace]
  };
}

export function normalizeAppData(input: unknown): AppData {
  if (!isRecord(input) || input.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    return createDefaultAppData();
  }

  const globalScripts = Array.isArray(input.globalScripts) ? input.globalScripts : [];
  const workspaces = Array.isArray(input.workspaces) ? input.workspaces : [];
  const normalized: AppData = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    activeTabId: typeof input.activeTabId === "string" ? input.activeTabId : "",
    globalScripts: globalScripts
      .filter(isGlobalScript)
      .map((script) => ({
        ...script,
        fileName: script.fileName.trim(),
        content: script.content ?? ""
      }))
      .filter((script) => script.fileName),
    workspaces: ensureLocalWorkspace(
      workspaces.filter(isWorkspace).map((workspace) => ({
        ...workspace,
        kind: workspace.kind === "local" ? "local" : "ssh",
        title: workspace.kind === "local" ? "LOCAL" : workspace.title,
        connection:
          workspace.kind === "local"
            ? { ...createDefaultConnection(), id: "conn_local", name: "LOCAL" }
            : workspace.connection,
        localRunner: normalizeLocalRunner(workspace.localRunner),
        parameterSettings: isRecord(workspace.parameterSettings) ? normalizeParameterSettings(workspace.parameterSettings) : {},
        attachedScripts: workspace.attachedScripts.map((attached) => ({
          ...attached,
          tag: normalizeScriptTag(attached.tag),
          description: typeof attached.description === "string" ? attached.description : ""
        })),
        logs: workspace.logs.slice(-MAX_LOGS_PER_WORKSPACE)
      }))
    )
  };

  if (normalized.workspaces.length === 0) {
    const workspace = createWorkspace();
    normalized.workspaces.push(workspace);
    normalized.activeTabId = workspace.id;
  }

  if (!normalized.workspaces.some((workspace) => workspace.id === normalized.activeTabId)) {
    normalized.activeTabId = normalized.workspaces[0].id;
  }

  return normalized;
}

export function normalizeScriptTag(value: unknown): string {
  if (typeof value !== "string") {
    return DEFAULT_SCRIPT_TAG;
  }
  const trimmed = value.trim();
  return trimmed || DEFAULT_SCRIPT_TAG;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function scriptFileName(scriptName: string) {
  return `${scriptName.trim() || "New Script"}.sh`;
}

function ensureLocalWorkspace(workspaces: WorkspaceTab[]) {
  const local = workspaces.find((workspace) => workspace.kind === "local" || workspace.id === LOCAL_WORKSPACE_ID);
  const normalizedLocal = {
    ...(local ?? createLocalWorkspace()),
    id: LOCAL_WORKSPACE_ID,
    title: "LOCAL",
    kind: "local" as const,
    connection: { ...createDefaultConnection(), id: "conn_local", name: "LOCAL" }
  };
  return [normalizedLocal, ...workspaces.filter((workspace) => workspace.id !== normalizedLocal.id && workspace.kind !== "local")];
}

function normalizeLocalRunner(value: unknown): LocalRunnerConfig {
  if (!isRecord(value)) {
    return createDefaultLocalRunner();
  }
  const allowedKinds: LocalRunnerConfig["kind"][] = ["bash", "sh", "zsh", "gitBash", "wsl", "custom"];
  const kind = typeof value.kind === "string" && allowedKinds.includes(value.kind as LocalRunnerConfig["kind"])
    ? (value.kind as LocalRunnerConfig["kind"])
    : createDefaultLocalRunner().kind;
  return {
    kind,
    command: typeof value.command === "string" ? value.command : undefined,
    args: Array.isArray(value.args) ? value.args.filter((arg): arg is string => typeof arg === "string") : undefined,
    workingDirectory: typeof value.workingDirectory === "string" ? value.workingDirectory : undefined,
    executionTimeoutSeconds: typeof value.executionTimeoutSeconds === "number" ? value.executionTimeoutSeconds : 300
  };
}

function isGlobalScript(value: unknown): value is GlobalScript {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    typeof value.fileName === "string" &&
    (typeof value.content === "string" || value.content === undefined) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isWorkspace(value: unknown): value is WorkspaceTab {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    (value.kind === undefined || value.kind === "local" || value.kind === "ssh") &&
    isRecord(value.connection) &&
    Array.isArray(value.attachedScripts) &&
    Array.isArray(value.logs)
  );
}

function normalizeParameterSettings(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]))
      .map(([name, setting]) => [
        name,
        {
          value: typeof setting.value === "string" ? setting.value : "",
          useFromEnvironment: Boolean(setting.useFromEnvironment),
          ...(typeof setting.useWorkspaceValue === "boolean" ? { useWorkspaceValue: setting.useWorkspaceValue } : {})
        }
      ])
  );
}
