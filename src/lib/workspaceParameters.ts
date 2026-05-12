import { extractScriptVariables } from "./parser";
import type { AppData, AttachedScript, GlobalScript, ScriptParameterSetting, WorkspaceTab } from "./types";

export function createDefaultParameterSetting(): ScriptParameterSetting {
  return { value: "", useFromEnvironment: false };
}

export function createDefaultAttachedParameterSetting(): ScriptParameterSetting {
  return { value: "", useFromEnvironment: false, useWorkspaceValue: true };
}

export function collectWorkspaceParameterNames(workspace: WorkspaceTab, scripts: GlobalScript[]) {
  const names = new Set<string>();
  for (const attached of workspace.attachedScripts) {
    const script = scripts.find((candidate) => candidate.id === attached.globalScriptId);
    if (!script) {
      continue;
    }
    for (const name of extractScriptVariables(script.content)) {
      names.add(name);
    }
  }
  return Array.from(names).sort((left, right) => left.localeCompare(right));
}

export function ensureWorkspaceParameterSettings(workspace: WorkspaceTab, scripts: GlobalScript[]): WorkspaceTab {
  const parameterSettings: Record<string, ScriptParameterSetting> = {};
  for (const name of collectActiveWorkspaceParameterNames(workspace, scripts)) {
    parameterSettings[name] = workspace.parameterSettings[name] ?? createDefaultParameterSetting();
  }
  const changed = !sameParameterNames(workspace.parameterSettings, parameterSettings);
  return changed ? { ...workspace, parameterSettings } : workspace;
}

export function syncAllWorkspaceParameterSettings(data: AppData): AppData {
  let changed = false;
  const workspaces = data.workspaces.map((workspace) => {
    const nextWorkspace = ensureWorkspaceParameterSettings(workspace, data.globalScripts);
    if (nextWorkspace !== workspace) {
      changed = true;
    }
    return nextWorkspace;
  });
  return changed ? { ...data, workspaces } : data;
}

export function settingsForAttachedScript(workspace: WorkspaceTab, attached: AttachedScript, script: GlobalScript) {
  const settings: Record<string, ScriptParameterSetting> = {};
  for (const name of extractScriptVariables(script.content)) {
    const attachedSetting = attached.parameterSettings[name];
    const useWorkspaceValue = attachedSetting?.useWorkspaceValue ?? !attachedSetting;
    settings[name] = useWorkspaceValue
      ? (workspace.parameterSettings[name] ?? createDefaultParameterSetting())
      : (attachedSetting ?? createDefaultAttachedParameterSetting());
  }
  return settings;
}

function sameParameterNames(left: Record<string, ScriptParameterSetting>, right: Record<string, ScriptParameterSetting>) {
  const leftNames = Object.keys(left).sort();
  const rightNames = Object.keys(right).sort();
  return leftNames.length === rightNames.length && leftNames.every((name, index) => name === rightNames[index]);
}

function collectActiveWorkspaceParameterNames(workspace: WorkspaceTab, scripts: GlobalScript[]) {
  const names = new Set<string>();
  for (const attached of workspace.attachedScripts) {
    const script = scripts.find((candidate) => candidate.id === attached.globalScriptId);
    if (!script) {
      continue;
    }
    for (const name of extractScriptVariables(script.content)) {
      names.add(name);
    }
  }
  return names;
}
