import { describe, expect, it } from "vitest";
import { createMcpToolDefinitions, toToolSlug } from "./mcp";
import type { AppData } from "./types";

const appData: AppData = {
  schemaVersion: 1,
  activeTabId: "workspace_1",
  globalScripts: [
    {
      id: "script_1",
      name: "Deploy Backend",
      description: "Deploy backend service",
      content: 'cd "${APP_DIR}" && docker compose up -d "${SERVICE_NAME}"',
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
        },
        {
          id: "attached_2",
          globalScriptId: "script_1",
          parameterSettings: {},
          useInMcp: true
        }
      ],
      logs: []
    }
  ]
};

describe("toToolSlug", () => {
  it("normalizes names", () => {
    expect(toToolSlug("Prod Deploy Backend!")).toBe("prod_deploy_backend");
  });
});

describe("createMcpToolDefinitions", () => {
  it("generates schemas from script variables", () => {
    const [tool] = createMcpToolDefinitions(appData);
    expect(tool.name).toBe("prod_deploy_backend");
    expect(Object.keys(tool.inputSchema.properties)).toEqual(["APP_DIR", "SERVICE_NAME"]);
  });

  it("handles name collisions with deterministic suffixes", () => {
    const tools = createMcpToolDefinitions(appData);
    expect(tools).toHaveLength(2);
    expect(tools[1].name).toMatch(/^prod_deploy_backend_[a-z0-9]+$/);
  });
});
