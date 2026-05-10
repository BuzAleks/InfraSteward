import { invoke } from "@tauri-apps/api/core";
import { createDefaultAppData, normalizeAppData } from "./appData";
import type { AppData, ConnectionSaveRequest, ExecutionRequest, ExecutionStart, ScriptExecutionEvent } from "./types";

const LOCAL_STORAGE_KEY = "infrasteward.appData";

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export async function loadAppData(): Promise<AppData> {
  if (isTauriRuntime()) {
    return normalizeAppData(await invoke("load_app_data"));
  }

  const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (!stored) {
    return createDefaultAppData();
  }

  try {
    return normalizeAppData(JSON.parse(stored));
  } catch {
    return createDefaultAppData();
  }
}

export async function saveAppData(appData: AppData): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("save_app_data", { appData });
    return;
  }
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(appData));
}

export async function saveConnection(request: ConnectionSaveRequest): Promise<AppData> {
  if (isTauriRuntime()) {
    return normalizeAppData(await invoke("save_connection", { request }));
  }
  const data = await loadAppData();
  return {
    ...data,
    workspaces: data.workspaces.map((workspace) =>
      workspace.id === request.workspaceId ? { ...workspace, connection: request.connection } : workspace
    )
  };
}

export async function testConnection(workspaceId: string): Promise<string> {
  if (isTauriRuntime()) {
    return invoke("test_connection", { workspaceId });
  }
  return `Connection test requires the Tauri desktop runtime. Workspace ${workspaceId} is in web preview mode.`;
}

export async function runScript(request: ExecutionRequest): Promise<ExecutionStart> {
  if (isTauriRuntime()) {
    return invoke("run_script", { request });
  }
  return {
    executionId: `${request.workspaceId}:${request.attachedScriptId}`
  };
}

export async function cancelScript(request: Pick<ExecutionRequest, "workspaceId" | "attachedScriptId" | "executionId">): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("cancel_script", { request });
  }
}

export async function drainScriptEvents(
  request: Pick<ExecutionRequest, "workspaceId" | "attachedScriptId" | "executionId">
): Promise<ScriptExecutionEvent[]> {
  if (isTauriRuntime()) {
    return invoke("drain_script_events", { request });
  }
  return [];
}

export async function logSystemEvent(event: {
  level: "info" | "warn" | "error";
  message: string;
  target?: string;
  details?: string;
}): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  try {
    await invoke("log_system_event", { event });
  } catch {
    // Logging must never become the reason the app fails.
  }
}

export type RuntimeInfo = {
  workingDataDir: string;
  systemLogPath: string;
};

export async function getRuntimeInfo(): Promise<RuntimeInfo> {
  if (isTauriRuntime()) {
    return invoke("get_runtime_info");
  }

  return {
    workingDataDir: "Browser localStorage preview",
    systemLogPath: "Browser console"
  };
}

export async function openWorkingDataDir(): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("open_working_data_dir");
  }
}
