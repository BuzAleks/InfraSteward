import { createMcpToolDefinitions } from "../../src/lib/mcp";
import type { AppData, ExecutionResult, McpToolDefinition } from "../../src/lib/types";

export type McpToolArguments = Record<string, unknown>;

export type McpExecutionAdapter = (
  workspaceId: string,
  attachedScriptId: string,
  args: Record<string, string>
) => Promise<ExecutionResult>;

export type RegisteredMcpTool = McpToolDefinition & {
  execute: (args: McpToolArguments) => Promise<ExecutionResult>;
};

export function createMcpRegistry(appData: AppData, adapter: McpExecutionAdapter): RegisteredMcpTool[] {
  return createMcpToolDefinitions(appData).map((tool) => ({
    ...tool,
    execute: (args) => adapter(tool.workspaceId, tool.attachedScriptId, stringifyMcpArguments(args))
  }));
}

function stringifyMcpArguments(args: McpToolArguments): Record<string, string> {
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => [
      key,
      value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value)
    ])
  );
}
