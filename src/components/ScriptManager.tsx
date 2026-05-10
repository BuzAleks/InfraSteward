import { useMemo, useState } from "react";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { createGlobalScript } from "../lib/appData";
import type { GlobalScript } from "../lib/types";

type Props = {
  scripts: GlobalScript[];
  attachmentCounts: Record<string, number>;
  onSave: (script: GlobalScript) => void;
  onDelete: (scriptId: string) => void;
};

export function ScriptManager({ scripts, attachmentCounts, onSave, onDelete }: Props) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<GlobalScript | null>(null);

  const filtered = useMemo(
    () =>
      scripts.filter((script) =>
        `${script.name} ${script.description} ${script.content}`.toLowerCase().includes(query.toLowerCase())
      ),
    [query, scripts]
  );

  function confirmDelete(script: GlobalScript) {
    const count = attachmentCounts[script.id] ?? 0;
    const message =
      count > 0
        ? `Delete "${script.name}"? It is attached to ${count} workspace script row(s), which will show a missing reference.`
        : `Delete "${script.name}"?`;
    if (confirm(message)) {
      onDelete(script.id);
    }
  }

  return (
    <div className="scriptManager">
      <div className="managerToolbar">
        <label className="searchBox">
          <Search size={16} />
          <span className="srOnly">Search scripts</span>
          <input value={query} placeholder="Search scripts" onChange={(event) => setQuery(event.target.value)} />
        </label>
        <button type="button" className="primaryButton" onClick={() => setEditing(createGlobalScript())}>
          <Plus size={16} /> Create
        </button>
      </div>

      <div className="scriptCatalog">
        {filtered.map((script) => (
          <article className="scriptCard" key={script.id}>
            <div>
              <h3>{script.name}</h3>
              <p>{script.description || "No description"}</p>
              <small>Attached to {attachmentCounts[script.id] ?? 0} workspace script row(s)</small>
            </div>
            <div className="rowActions">
              <button type="button" title="Edit" aria-label={`Edit ${script.name}`} onClick={() => setEditing(script)}>
                <Pencil size={16} /> Edit
              </button>
              <button type="button" className="dangerButton" title="Delete" aria-label={`Delete ${script.name}`} onClick={() => confirmDelete(script)}>
                <Trash2 size={16} /> Delete
              </button>
            </div>
          </article>
        ))}
      </div>

      {editing && (
        <ScriptEditor
          script={editing}
          onCancel={() => setEditing(null)}
          onSave={(script) => {
            onSave(script);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function ScriptEditor({
  script,
  onSave,
  onCancel
}: {
  script: GlobalScript;
  onSave: (script: GlobalScript) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(script);

  return (
    <div className="inlineEditor">
      <label>
        Name
        <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
      </label>
      <label>
        Description
        <input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
      </label>
      <label>
        Content
        <textarea rows={12} value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} />
      </label>
      <div className="modalActions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="primaryButton"
          onClick={() => onSave({ ...draft, updatedAt: new Date().toISOString() })}
          disabled={!draft.name.trim()}
        >
          Save
        </button>
      </div>
    </div>
  );
}
