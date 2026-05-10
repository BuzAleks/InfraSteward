import { extractScriptVariables } from "./parser";
import type { AppData, McpToolDefinition } from "./types";

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

      tools.push({
        baseName: toToolSlug(`${workspace.title}_${script.name}`) || `script_${script.id}`,
        description: script.description || `Run ${script.name} on ${workspace.title}.`,
        workspaceId: workspace.id,
        workspaceTitle: workspace.title,
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
