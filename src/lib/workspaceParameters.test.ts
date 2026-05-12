import { describe, expect, it } from "vitest";
import { createDefaultAppData } from "./appData";
import { collectWorkspaceParameterNames, ensureWorkspaceParameterSettings, settingsForAttachedScript } from "./workspaceParameters";

describe("workspace parameters", () => {
  it("collects unique parameters and removes parameters after detach when no script uses them", () => {
    const data = createDefaultAppData();
    data.globalScripts = [
      {
        id: "script_1",
        name: "Deploy",
        description: "",
        fileName: "Deploy.sh",
        content: "echo ${APP_DIR} ${SERVICE}",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      },
      {
        id: "script_2",
        name: "Logs",
        description: "",
        fileName: "Logs.sh",
        content: "echo ${SERVICE} ${LINES}",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    ];
    data.workspaces[0].parameterSettings.APP_DIR = { value: "/srv/app", useFromEnvironment: false };
    data.workspaces[0].attachedScripts = [
      {
        id: "attached_1",
        globalScriptId: "script_1",
        tag: "default",
        description: "",
        parameterSettings: {},
        useInMcp: false
      },
      {
        id: "attached_2",
        globalScriptId: "script_2",
        tag: "default",
        description: "",
        parameterSettings: {},
        useInMcp: false
      }
    ];

    const synced = ensureWorkspaceParameterSettings(data.workspaces[0], data.globalScripts);
    expect(Object.keys(synced.parameterSettings).sort()).toEqual(["APP_DIR", "LINES", "SERVICE"]);
    expect(synced.parameterSettings.APP_DIR.value).toBe("/srv/app");

    const detached = ensureWorkspaceParameterSettings({ ...synced, attachedScripts: [] }, data.globalScripts);
    expect(collectWorkspaceParameterNames(detached, data.globalScripts)).toEqual([]);
    expect(detached.parameterSettings).toEqual({});
  });

  it("uses workspace settings by default and allows script-specific overrides", () => {
    const data = createDefaultAppData();
    const script = {
      id: "script_1",
      name: "Deploy",
      description: "",
      fileName: "Deploy.sh",
      content: "echo ${APP_DIR}",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    };
    const attached = {
      id: "attached_1",
      globalScriptId: "script_1",
      tag: "default",
      description: "",
      parameterSettings: {
        APP_DIR: { value: "/script/app", useFromEnvironment: false, useWorkspaceValue: false }
      },
      useInMcp: false
    };
    data.globalScripts = [script];
    data.workspaces[0].parameterSettings.APP_DIR = { value: "/workspace/app", useFromEnvironment: false };
    data.workspaces[0].attachedScripts = [attached];

    expect(settingsForAttachedScript(data.workspaces[0], { ...attached, parameterSettings: {} }, script).APP_DIR.value).toBe("/workspace/app");
    expect(settingsForAttachedScript(data.workspaces[0], attached, script).APP_DIR.value).toBe("/script/app");
  });
});
