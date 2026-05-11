import { Plus } from "lucide-react";
import { DEFAULT_SCRIPT_TAG } from "../lib/appData";
import type { AttachedScript, GlobalScript } from "../lib/types";

type Props = {
  scripts: GlobalScript[];
  attachedScripts: AttachedScript[];
  onCancel: () => void;
  onAdd: (scriptId: string, tag: string) => void;
};

export function AddScriptsDialog({ scripts, attachedScripts, onAdd, onCancel }: Props) {
  function add(script: GlobalScript) {
    const existingTags = attachedScripts
      .filter((attached) => attached.globalScriptId === script.id)
      .map((attached) => normalizeTag(attached.tag));
    const tag = existingTags.length === 0 ? DEFAULT_SCRIPT_TAG : askForTag(script.name, existingTags);
    if (!tag) {
      return;
    }
    onAdd(script.id, tag);
  }

  return (
    <div>
      <div className="scriptCatalog">
        {scripts.map((script) => {
          const existingCount = attachedScripts.filter((attached) => attached.globalScriptId === script.id).length;
          return (
            <div className="scriptCard selectable addScriptCard" key={script.id}>
              <button type="button" className="iconButton" title={`Add ${script.name}`} aria-label={`Add ${script.name}`} onClick={() => add(script)}>
                <Plus size={17} />
              </button>
              <span>
                <strong>{script.name}</strong>
                <span>{script.description || "No description"}</span>
                {existingCount > 0 && <small>Attached {existingCount}x</small>}
              </span>
            </div>
          );
        })}
      </div>
      <div className="modalActions">
        <button type="button" onClick={onCancel}>
          Close
        </button>
      </div>
    </div>
  );
}

function askForTag(scriptName: string, existingTags: string[]) {
  const message = `Tag for another "${scriptName}" attachment`;
  while (true) {
    const value = prompt(message, suggestNextTag(existingTags));
    if (value === null) {
      return null;
    }
    const tag = normalizeTag(value);
    if (!tag) {
      globalThis.alert("Tag is required.");
      continue;
    }
    if (existingTags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) {
      globalThis.alert("Tag must be unique for this script in the workspace.");
      continue;
    }
    return tag;
  }
}

function normalizeTag(value: string) {
  return value.trim();
}

function suggestNextTag(existingTags: string[]) {
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `copy-${index}`;
    if (!existingTags.some((tag) => tag.toLowerCase() === candidate)) {
      return candidate;
    }
  }
  return "";
}
