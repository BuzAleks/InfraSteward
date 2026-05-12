import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { createGlobalScript } from "../lib/appData";
import type { GlobalScript } from "../lib/types";

type Props = {
  scripts: GlobalScript[];
  attachmentCounts: Record<string, number>;
  onReadContent: (scriptId: string) => Promise<string>;
  onSave: (script: GlobalScript) => Promise<void>;
  onDelete: (scriptId: string) => Promise<void>;
};

export function ScriptManager({ scripts, attachmentCounts, onReadContent, onSave, onDelete }: Props) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<GlobalScript | null>(null);

  const filtered = useMemo(
    () =>
      scripts.filter((script) =>
        `${script.name} ${script.description} ${script.fileName}`.toLowerCase().includes(query.toLowerCase())
      ),
    [query, scripts]
  );

  async function confirmDelete(script: GlobalScript) {
    const count = attachmentCounts[script.id] ?? 0;
    const message =
      count > 0
        ? `Delete "${script.name}"? It is attached to ${count} workspace script row(s), which will show a missing reference.`
        : `Delete "${script.name}"?`;
    if (confirm(message)) {
      try {
        await onDelete(script.id);
      } catch {
        // The app shell displays the backend error.
      }
    }
  }

  if (editing) {
    const isNewScript = !scripts.some((script) => script.id === editing.id);
    return (
      <ScriptEditor
        script={editing}
        title={isNewScript ? "Create script" : "Edit script"}
        scripts={scripts}
        onReadContent={onReadContent}
        onBack={() => setEditing(null)}
        onSave={async (script) => {
          await onSave(script);
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
              <button type="button" className="dangerButton" title="Delete" aria-label={`Delete ${script.name}`} onClick={() => void confirmDelete(script)}>
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
  onReadContent,
  onSave,
  onBack
}: {
  script: GlobalScript;
  title: string;
  scripts: GlobalScript[];
  onReadContent: (scriptId: string) => Promise<string>;
  onSave: (script: GlobalScript) => Promise<void>;
  onBack: () => void;
}) {
  const [draft, setDraft] = useState(script);
  const [loadingContent, setLoadingContent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isNewScript = !scripts.some((candidate) => candidate.id === script.id);
  const normalizedName = draft.name.trim().toLowerCase();
  const duplicateName = scripts.some((candidate) => candidate.id !== draft.id && candidate.name.trim().toLowerCase() === normalizedName);
  const invalidFileName = isInvalidScriptFileName(draft.name);
  const canSave = Boolean(normalizedName) && !duplicateName && !invalidFileName && !saving && !loadingContent;

  useEffect(() => {
    if (isNewScript) {
      return;
    }
    let disposed = false;
    setLoadingContent(true);
    setError("");
    onReadContent(script.id)
      .then((content) => {
        if (!disposed) {
          setDraft((current) => ({ ...current, content }));
        }
      })
      .catch((reason) => {
        if (!disposed) {
          setError(String(reason));
        }
      })
      .finally(() => {
        if (!disposed) {
          setLoadingContent(false);
        }
      });
    return () => {
      disposed = true;
    };
  }, [isNewScript, onReadContent, script.id]);

  async function saveDraft() {
    setSaving(true);
    setError("");
    try {
      await onSave({ ...draft, name: draft.name.trim(), updatedAt: new Date().toISOString() });
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  }

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
        {invalidFileName && <span className="fieldError">Script name must be a valid file name.</span>}
      </label>
      <label>
        Description
        <input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
      </label>
      <label>
        Content
        <textarea
          rows={12}
          value={loadingContent ? "Loading script file..." : draft.content}
          disabled={loadingContent}
          onChange={(event) => setDraft({ ...draft, content: event.target.value })}
        />
      </label>
      <div className="modalActions">
        {error && <span className="fieldError">{error}</span>}
        <button type="button" onClick={onBack}>
          Cancel
        </button>
        <button
          type="button"
          className="primaryButton"
          onClick={() => void saveDraft()}
          disabled={!canSave}
        >
          {saving ? "Saving" : "Save"}
        </button>
      </div>
    </div>
  );
}

function isInvalidScriptFileName(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "." || trimmed === ".." || trimmed.endsWith(".") || trimmed.endsWith(" ")) {
    return true;
  }
  const invalidCharacters = new Set(["<", ">", ":", "\"", "/", "\\", "|", "?", "*"]);
  return Array.from(trimmed).some((character) => invalidCharacters.has(character) || character.charCodeAt(0) < 32);
}
