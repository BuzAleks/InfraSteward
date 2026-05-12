import { describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, createDefaultAppData, normalizeAppData } from "./appData";

describe("normalizeAppData", () => {
  it("creates valid default data for corrupted storage", () => {
    const data = normalizeAppData({ broken: true });
    expect(data.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(data.workspaces).toHaveLength(1);
    expect(data.activeTabId).toBe(data.workspaces[0].id);
  });

  it("keeps active tab valid", () => {
    const data = createDefaultAppData();
    const normalized = normalizeAppData({ ...data, activeTabId: "missing" });
    expect(normalized.activeTabId).toBe(data.workspaces[0].id);
  });

  it("trims persisted logs", () => {
    const data = createDefaultAppData();
    data.workspaces[0].logs = Array.from({ length: 520 }, (_, index) => ({
      id: `log_${index}`,
      timestamp: new Date(index).toISOString(),
      level: "info",
      message: String(index)
    }));

    expect(normalizeAppData(data).workspaces[0].logs).toHaveLength(500);
  });

  it("normalizes empty attachment tags", () => {
    const data = createDefaultAppData();
    data.globalScripts.push({
      id: "script_1",
      name: "Deploy",
      description: "",
      fileName: "Deploy.sh",
      content: "",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    data.workspaces[0].attachedScripts = [
      {
        id: "attached_1",
        globalScriptId: "script_1",
        tag: "",
        description: "",
        parameterSettings: {},
        useInMcp: false
      }
    ];

    expect(normalizeAppData(data).workspaces[0].attachedScripts[0].tag).toBe("default");
  });

  it("defaults missing attachment descriptions", () => {
    const data = createDefaultAppData();
    data.workspaces[0].attachedScripts = [
      {
        id: "attached_1",
        globalScriptId: "script_1",
        tag: "default",
        parameterSettings: {},
        useInMcp: false
      } as (typeof data.workspaces)[number]["attachedScripts"][number]
    ];

    expect(normalizeAppData(data).workspaces[0].attachedScripts[0].description).toBe("");
  });
});
