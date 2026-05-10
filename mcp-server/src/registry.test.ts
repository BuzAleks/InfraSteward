import { describe, expect, it } from "vitest";
import { createMcpRegistry } from "./registry";
import type { AppData } from "../../src/lib/types";

describe("createMcpRegistry", () => {
  it("routes execution to the provided adapter", async () => {
    const appData: AppData = {
      schemaVersion: 1,
      activeTabId: "workspace_1",
      globalScripts: [
        {
          id: "script_1",
          name: "Check Logs",
          description: "Check service logs",
          content: "journalctl -u ${SERVICE}",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        }
      ],
      workspaces: [
        {
          id: "workspace_1",
          title: "Prod",
          connection: {
            id: "conn_1",
            name: "Prod",
            host: "prod.example.com",
            port: 22,
            username: "deploy",
            authType: "privateKey"
          },
          attachedScripts: [
            {
              id: "attached_1",
              globalScriptId: "script_1",
              parameterSettings: {},
              useInMcp: true
            }
          ],
          logs: []
        }
      ]
    };

    const registry = createMcpRegistry(appData, async (workspaceId, attachedScriptId, args) => ({
      status: "success",
      stdout: `${workspaceId}:${attachedScriptId}:${args.SERVICE}`,
      stderr: "",
      exitCode: 0
    }));

    expect(registry[0].name).toBe("prod_check_logs");
    await expect(registry[0].execute({ SERVICE: "nginx" })).resolves.toMatchObject({
      stdout: "workspace_1:attached_1:nginx"
    });
  });
});
