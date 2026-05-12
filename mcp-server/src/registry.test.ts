import { describe, expect, it } from "vitest";
import { createMcpRegistry } from "./registry";
import type { AppData } from "../../src/lib/types";

describe("createMcpRegistry", () => {
  it("routes execution to the provided adapter", async () => {
    const appData: AppData = {
      schemaVersion: 2,
      activeTabId: "workspace_1",
      globalScripts: [
        {
          id: "script_1",
          name: "Check Logs",
          description: "Check service logs",
          fileName: "Check Logs.sh",
          content: "journalctl -u ${SERVICE}",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        }
      ],
      workspaces: [
        {
          id: "workspace_1",
          title: "Prod",
          kind: "ssh",
          connection: {
            id: "conn_1",
            name: "Prod",
            host: "prod.example.com",
            port: 22,
            username: "deploy",
            authType: "privateKey"
          },
          localRunner: { kind: "bash", executionTimeoutSeconds: 300 },
          parameterSettings: {},
          attachedScripts: [
            {
              id: "attached_1",
              globalScriptId: "script_1",
              tag: "default",
              description: "Read nginx logs in production",
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

    expect(registry[0].name).toBe("prod_check_logs_default");
    expect(registry[0].description).toContain("Read nginx logs in production");
    await expect(registry[0].execute({ SERVICE: "nginx" })).resolves.toMatchObject({
      stdout: "workspace_1:attached_1:nginx"
    });
  });
});
