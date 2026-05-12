import { useMemo, useState } from "react";
import { extractScriptVariables } from "../lib/parser";
import type { AttachedScript, GlobalScript, ScriptParameterSetting } from "../lib/types";

type Props = {
  script: GlobalScript;
  attached: AttachedScript;
  workspaceAttachedScripts: AttachedScript[];
  onCancel: () => void;
  onSave: (attached: AttachedScript) => void;
};

export function ScriptSettings({ script, attached, workspaceAttachedScripts, onSave, onCancel }: Props) {
  const variables = useMemo(() => extractScriptVariables(script.content), [script.content]);
  const [settings, setSettings] = useState<Record<string, ScriptParameterSetting>>(attached.parameterSettings);
  const [tag, setTag] = useState(attached.tag.trim() || "default");
  const [description, setDescription] = useState(attached.description ?? "");
  const [error, setError] = useState("");

  function updateParameter(name: string, setting: ScriptParameterSetting) {
    setSettings((current) => ({ ...current, [name]: setting }));
  }

  function save() {
    const normalizedTag = tag.trim();
    if (!normalizedTag) {
      setError("Tag is required.");
      return;
    }
    const duplicate = workspaceAttachedScripts.some(
      (candidate) =>
        candidate.id !== attached.id &&
        candidate.globalScriptId === attached.globalScriptId &&
        candidate.tag.trim().toLowerCase() === normalizedTag.toLowerCase()
    );
    if (duplicate) {
      setError("Tag must be unique for this script in the workspace.");
      return;
    }
    onSave({ ...attached, tag: normalizedTag, description: description.trim(), parameterSettings: settings });
  }

  return (
    <div className="scriptSettingsForm">
      <div className="scriptSettingsTop">
        <label>
          Tag
          <input
            value={tag}
            onChange={(event) => {
              setTag(event.target.value);
              setError("");
            }}
          />
        </label>
        <label>
          Description
          <textarea value={description} rows={3} onChange={(event) => setDescription(event.target.value)} />
        </label>
        {error && <div className="errorBox">{error}</div>}
      </div>
      <div className="scriptSettingsVariables">
        {variables.length === 0 ? (
          <p className="emptyState">This script has no detected parameters.</p>
        ) : (
          variables.map((name) => {
            const setting = settings[name] ?? { value: "", useFromEnvironment: false };
            return (
              <div className="parameterRow" key={name}>
                <label>
                  Parameter name
                  <input value={name} disabled />
                </label>
                <label>
                  Value
                  <input
                    value={setting.value}
                    disabled={setting.useFromEnvironment}
                    onChange={(event) => updateParameter(name, { ...setting, value: event.target.value })}
                  />
                </label>
                <label className="checkboxLine">
                  <input
                    type="checkbox"
                    checked={setting.useFromEnvironment}
                    onChange={(event) => updateParameter(name, { ...setting, useFromEnvironment: event.target.checked })}
                  />
                  Use from environment
                </label>
              </div>
            );
          })
        )}
      </div>
      <div className="modalActions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="primaryButton" onClick={save}>
          Save
        </button>
      </div>
    </div>
  );
}
