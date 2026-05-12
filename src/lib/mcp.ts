import { extractScriptVariables } from "./parser";
import type { AppData, McpToolDefinition } from "./types";

export const MCP_TIMEOUT_PARAMETER = "timeoutSeconds";
export const MCP_DEFAULT_TIMEOUT_SECONDS = 30;
export const MCP_MAX_TIMEOUT_SECONDS = 60;

export function toToolSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

export function createMcpToolDefinitions(appData: AppData): McpToolDefinition[] {
  const tools: MpcToolDraft[] = [];

  for (const workspace of appData.workspaces) {
    const connectionName = workspace.connection.name.trim() || workspace.title;
    for (const attached of workspace.attachedScripts) {
      if (!attached.useInMcp) {
        continue;
      }

      const script = appData.globalScripts.find((candidate) => candidate.id === attached.globalScriptId);
      if (!script) {
        continue;
      }

      const variables = extractScriptVariables(script.content);
      const properties: MpcToolDraft["inputSchema"]["properties"] = {};
      for (const variable of variables) {
        properties[variable] = {
          type: "string",
          description: `Value for ${variable}. Omit to use the remote environment or script default.`
        };
      }
      properties[MCP_TIMEOUT_PARAMETER] = {
        type: "integer",
        description: `MCP execution timeout in seconds, from 1 to ${MCP_MAX_TIMEOUT_SECONDS}. Defaults to ${MCP_DEFAULT_TIMEOUT_SECONDS}.`
      };

      const scriptTag = attached.tag.trim() || "default";
      tools.push({
        baseName: toToolSlug(`${connectionName}_${script.name}_${scriptTag}`) || `script_${script.id}_${scriptTag}`,
        description: script.description || `Run ${script.name} (${scriptTag}) on ${connectionName}.`,
        workspaceId: workspace.id,
        workspaceTitle: connectionName,
        attachedScriptId: attached.id,
        globalScriptId: script.id,
        inputSchema: {
          type: "object",
          properties,
          additionalProperties: false
        }
      });
    }
  }

  return dedupeToolNames(tools);
}

type MpcToolDraft = Omit<McpToolDefinition, "name"> & { baseName: string };

function dedupeToolNames(drafts: MpcToolDraft[]): McpToolDefinition[] {
  const used = new Map<string, number>();

  return drafts.map(({ baseName, ...definition }) => {
    const count = used.get(baseName) ?? 0;
    used.set(baseName, count + 1);
    const name = count === 0 ? baseName : `${baseName}_${stableSuffix(definition.attachedScriptId)}`;
    return { ...definition, name };
  });
}

function stableSuffix(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36).slice(0, 6);
}
