import { useState } from "react";
import type { GlobalScript } from "../lib/types";

type Props = {
  scripts: GlobalScript[];
  attachedScriptIds: string[];
  onCancel: () => void;
  onAdd: (scriptIds: string[]) => void;
};

export function AddScriptsDialog({ scripts, attachedScriptIds, onAdd, onCancel }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelected(next);
  }

  return (
    <div>
      <div className="scriptCatalog">
        {scripts.map((script) => (
          <label className="scriptCard selectable" key={script.id}>
            <input
              type="checkbox"
              checked={selected.has(script.id)}
              onChange={() => toggle(script.id)}
              disabled={attachedScriptIds.includes(script.id)}
            />
            <span>
              <strong>{script.name}</strong>
              <span>{script.description || "No description"}</span>
              {attachedScriptIds.includes(script.id) && <small>Already attached</small>}
            </span>
          </label>
        ))}
      </div>
      <div className="modalActions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="primaryButton" onClick={() => onAdd([...selected])} disabled={selected.size === 0}>
          Add
        </button>
      </div>
    </div>
  );
}
