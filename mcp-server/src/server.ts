import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { normalizeAppData } from "../../src/lib/appData";
import type { AppData, ExecutionResult } from "../../src/lib/types";
import { createMcpRegistry } from "./registry";

async function main() {
  const appData = await loadAppData();
  const server = new McpServer({
    name: "infrasteward",
    version: "0.1.0"
  });

  const registry = createMcpRegistry(appData, executeViaAdapter);
  for (const tool of registry) {
    const shape: Record<string, z.ZodOptional<z.ZodString>> = {};
    for (const parameter of Object.keys(tool.inputSchema.properties)) {
      shape[parameter] = z.string().optional();
    }

    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: z.object(shape)
      },
      async (args) => {
        const result = await tool.execute(args as Record<string, string>);
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
