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

  it("adds default tags to legacy attachments", () => {
    const data = createDefaultAppData();
    data.globalScripts[0].id = "script_1";
    data.workspaces[0].attachedScripts = [
      {
        id: "attached_1",
        globalScriptId: "script_1",
        tag: "",
        parameterSettings: {},
        useInMcp: false
      }
    ];

    expect(normalizeAppData(data).workspaces[0].attachedScripts[0].tag).toBe("default");
  });
});
