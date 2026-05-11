import { createId, nowIso } from "./ids";
import type { AppData, GlobalScript, SshConnectionConfig, WorkspaceTab } from "./types";

export const CURRENT_SCHEMA_VERSION = 1;
export const MAX_LOGS_PER_WORKSPACE = 500;

export function createDefaultConnection(): SshConnectionConfig {
  return {
    id: createId("conn"),
    name: "",
    host: "",
    port: 22,
    username: "",
    authType: "privateKey",
    connectionTimeoutSeconds: 15,
    executionTimeoutSeconds: 300
  };
}

export function createWorkspace(title = "New Workspace"): WorkspaceTab {
  return {
    id: createId("workspace"),
    title,
    connection: createDefaultConnection(),
    attachedScripts: [],
    logs: []
  };
}

export function createGlobalScript(fields?: Partial<GlobalScript>): GlobalScript {
  const timestamp = nowIso();
  return {
    id: createId("script"),
    name: fields?.name ?? "New Script",
    description: fields?.description ?? "",
    content: fields?.content ?? "",
    createdAt: fields?.createdAt ?? timestamp,
    updatedAt: fields?.updatedAt ?? timestamp
  };
}

export function createDefaultAppData(): AppData {
  const workspace = createWorkspace("New Workspace");
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    activeTabId: workspace.id,
    globalScripts: [
      createGlobalScript({
        name: "Check Disk Usage",
        description: "Show disk usage for the configured path.",
        content: "df -h \"${TARGET_PATH:-/}\""
      })
    ],
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
    globalScripts: globalScripts.filter(isGlobalScript),
    workspaces: workspaces.filter(isWorkspace).map((workspace) => ({
      ...workspace,
      logs: workspace.logs.slice(-MAX_LOGS_PER_WORKSPACE)
    }))
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isGlobalScript(value: unknown): value is GlobalScript {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    typeof value.content === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isWorkspace(value: unknown): value is WorkspaceTab {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    isRecord(value.connection) &&
    Array.isArray(value.attachedScripts) &&
    Array.isArray(value.logs)
  );
}
