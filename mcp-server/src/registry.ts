import { createMcpToolDefinitions } from "../../src/lib/mcp";
import type { AppData, ExecutionResult, McpToolDefinition } from "../../src/lib/types";

export type McpExecutionAdapter = (
  workspaceId: string,
  attachedScriptId: string,
  args: Record<string, string>
) => Promise<ExecutionResult>;

export type RegisteredMcpTool = McpToolDefinition & {
  execute: (args: Record<string, string>) => Promise<ExecutionResult>;
};

export function createMcpRegistry(appData: AppData, adapter: McpExecutionAdapter): RegisteredMcpTool[] {
  return createMcpToolDefinitions(appData).map((tool) => ({
    ...tool,
    execute: (args) => adapter(tool.workspaceId, tool.attachedScriptId, args)
  }));
}
