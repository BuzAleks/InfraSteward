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
  const [useInMcp, setUseInMcp] = useState(attached.useInMcp);
  const [tag, setTag] = useState(attached.tag.trim() || "default");
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
    onSave({ ...attached, tag: normalizedTag, parameterSettings: settings, useInMcp });
  }

  return (
    <div className="formGrid">
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
      {error && <div className="errorBox">{error}</div>}
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
      <label className="checkboxLine warningLine">
        <input
          type="checkbox"
          checked={useInMcp}
          onChange={(event) => {
            if (event.target.checked) {
              const accepted = confirm(
                "Use in MCP allows an LLM client to execute this script on the configured SSH server. Enable only for scripts you trust."
              );
              setUseInMcp(accepted);
            } else {
              setUseInMcp(false);
            }
          }}
        />
        Use in MCP
      </label>
      {useInMcp && <div className="warningBox">MCP tool calls can execute remote commands through this workspace.</div>}
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
