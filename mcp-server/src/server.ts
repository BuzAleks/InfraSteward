import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { normalizeAppData } from "../../src/lib/appData";
import type { AppData, ExecutionResult, McpToolDefinition } from "../../src/lib/types";
import { createMcpRegistry, type McpToolArguments, type RegisteredMcpTool } from "./registry";

const DEFAULT_BRIDGE_URL = "http://127.0.0.1:47321";

async function main() {
  const server = new McpServer({
    name: "infrasteward",
    version: "0.1.0"
  });

  const registry = await loadRegistry();
  for (const tool of registry) {
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const [parameter, property] of Object.entries(tool.inputSchema.properties)) {
      shape[parameter] =
        property.type === "integer"
          ? z.union([z.number().int(), z.string().regex(/^\d+$/)]).optional()
          : z.string().optional();
    }

    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: z.object(shape)
      },
      async (args) => {
        const result = await tool.execute(args as McpToolArguments);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ],
          isError: result.status !== "success"
        };
      }
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function loadRegistry(): Promise<RegisteredMcpTool[]> {
  const bridgeUrl = bridgeBaseUrl();
  try {
    return await loadBridgeRegistry(bridgeUrl);
  } catch (bridgeError) {
    if (!process.env.INFRASTEWARD_APP_DATA) {
      throw new Error(
        `InfraSteward desktop MCP server is not available at ${bridgeUrl}. Open InfraSteward and enable MCP server on the main screen. ${String(bridgeError)}`
      );
    }

    const appData = await loadAppData();
    return createMcpRegistry(appData, executeViaAdapter);
  }
}

function bridgeBaseUrl(): string {
  return (process.env.INFRASTEWARD_MCP_BRIDGE_URL ?? DEFAULT_BRIDGE_URL).replace(/\/+$/, "");
}

async function loadBridgeRegistry(bridgeUrl: string): Promise<RegisteredMcpTool[]> {
  const tools = await fetchBridgeJson<McpToolDefinition[]>(`${bridgeUrl}/tools`);
  return tools.map((tool) => ({
    ...tool,
    execute: (args) => executeViaBridge(bridgeUrl, tool.workspaceId, tool.attachedScriptId, args)
  }));
}

async function loadAppData(): Promise<AppData> {
  const explicitPath = process.env.INFRASTEWARD_APP_DATA;
  const appDataPath = explicitPath ?? defaultAppDataPath();
  const content = await readFile(appDataPath, "utf8");
  return normalizeAppData(JSON.parse(content));
}

function defaultAppDataPath(): string {
  if (platform() === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "dev.infrasteward.desktop", "app-data.json");
  }
  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", "dev.infrasteward.desktop", "app-data.json");
  }
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "dev.infrasteward.desktop", "app-data.json");
}

async function executeViaBridge(
  bridgeUrl: string,
  workspaceId: string,
  attachedScriptId: string,
  args: McpToolArguments
): Promise<ExecutionResult> {
  try {
    const response = await globalThis.fetch(`${bridgeUrl}/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, attachedScriptId, args })
    });
    if (response.ok) {
      return (await response.json()) as ExecutionResult;
    }

    return {
      status: "failed",
      stdout: "",
      stderr: await readBridgeError(response),
      exitCode: 1
    };
  } catch (error) {
    return {
      status: "failed",
      stdout: "",
      stderr: `InfraSteward MCP server is not running at ${bridgeUrl}. Enable it in the desktop app and retry. ${String(error)}`,
      exitCode: 1
    };
  }
}

async function fetchBridgeJson<T>(url: string): Promise<T> {
  const response = await globalThis.fetch(url);
  if (!response.ok) {
    throw new Error(await readBridgeError(response));
  }
  return (await response.json()) as T;
}

async function readBridgeError(response: globalThis.Response): Promise<string> {
  const text = await response.text();
  if (!text) {
    return `HTTP ${response.status} ${response.statusText}`;
  }
  try {
    const body = JSON.parse(text) as { error?: string };
    return body.error ?? text;
  } catch {
    return text;
  }
}

async function executeViaAdapter(
  workspaceId: string,
  attachedScriptId: string,
  args: Record<string, string>
): Promise<ExecutionResult> {
  const command = process.env.INFRASTEWARD_MCP_EXECUTOR;
  if (!command) {
    return {
      status: "failed",
      stdout: "",
      stderr:
        "INFRASTEWARD_MCP_EXECUTOR is not configured. Start the desktop app executor or provide a compatible adapter command.",
      exitCode: 1
    };
  }

  return new Promise((resolve) => {
    const child = spawn(command, [workspaceId, attachedScriptId, JSON.stringify(args)], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: platform() === "win32"
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code) => {
      try {
        resolve(JSON.parse(stdout) as ExecutionResult);
      } catch {
        resolve({
          status: code === 0 ? "success" : "failed",
          stdout,
          stderr,
          exitCode: code ?? undefined
        });
      }
    });
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
