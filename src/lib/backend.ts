import { invoke } from "@tauri-apps/api/core";
import { createDefaultAppData, normalizeAppData } from "./appData";
import type { AppData, ConnectionSaveRequest, ExecutionRequest, ExecutionResult } from "./types";

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

export async function runScript(request: ExecutionRequest): Promise<ExecutionResult> {
  if (isTauriRuntime()) {
    return invoke("run_script", { request });
  }
  return {
    status: "failed",
    stdout: "",
    stderr: "Remote SSH execution requires the Tauri desktop runtime.",
    exitCode: 1
  };
}
