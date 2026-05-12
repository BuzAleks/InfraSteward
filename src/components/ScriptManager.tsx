import { useMemo, useState } from "react";
import { ArrowLeft, Pencil, Plus, Search, Trash2 } from "lucide-react";
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

  if (editing) {
    const isNewScript = !scripts.some((script) => script.id === editing.id);
    return (
      <ScriptEditor
        script={editing}
        title={isNewScript ? "Create script" : "Edit script"}
        scripts={scripts}
        onBack={() => setEditing(null)}
        onSave={(script) => {
          onSave(script);
          setEditing(null);
        }}
      />
    );
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

    </div>
  );
}

function ScriptEditor({
  script,
  title,
  scripts,
  onSave,
  onBack
}: {
  script: GlobalScript;
  title: string;
  scripts: GlobalScript[];
  onSave: (script: GlobalScript) => void;
  onBack: () => void;
}) {
  const [draft, setDraft] = useState(script);
  const normalizedName = draft.name.trim().toLowerCase();
  const duplicateName = scripts.some((candidate) => candidate.id !== draft.id && candidate.name.trim().toLowerCase() === normalizedName);
  const canSave = Boolean(normalizedName) && !duplicateName;

  return (
    <div className="scriptEditorScreen">
      <div className="editorToolbar">
        <button type="button" onClick={onBack}>
          <ArrowLeft size={16} /> Back
        </button>
        <h3>{title}</h3>
      </div>
      <label>
        Name
        <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        {duplicateName && <span className="fieldError">Script name must be unique.</span>}
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
        <button type="button" onClick={onBack}>
          Cancel
        </button>
        <button
          type="button"
          className="primaryButton"
          onClick={() => onSave({ ...draft, updatedAt: new Date().toISOString() })}
          disabled={!canSave}
        >
          Save
        </button>
      </div>
    </div>
  );
}
