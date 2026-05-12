import { useEffect, useMemo, useState } from "react";
import { getLocalEnvironment } from "../lib/backend";
import { extractScriptVariables } from "../lib/parser";
import { createDefaultAttachedParameterSetting, createDefaultParameterSetting } from "../lib/workspaceParameters";
import type { AttachedScript, GlobalScript, ScriptParameterSetting } from "../lib/types";

type Props = {
  script: GlobalScript;
  attached: AttachedScript;
  workspaceParameterSettings: Record<string, ScriptParameterSetting>;
  workspaceAttachedScripts: AttachedScript[];
  onCancel: () => void;
  onSave: (attached: AttachedScript) => void;
};

export function ScriptSettings({ script, attached, workspaceParameterSettings, workspaceAttachedScripts, onSave, onCancel }: Props) {
  const variables = useMemo(() => extractScriptVariables(script.content), [script.content]);
  const [settings, setSettings] = useState<Record<string, ScriptParameterSetting>>(attached.parameterSettings);
  const [tag, setTag] = useState(attached.tag.trim() || "default");
  const [description, setDescription] = useState(attached.description ?? "");
  const [localEnvironment, setLocalEnvironment] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    let disposed = false;
    if (variables.length === 0) {
      setLocalEnvironment({});
      return;
    }

    getLocalEnvironment(variables)
      .then((values) => {
        if (!disposed) {
          setLocalEnvironment(values);
        }
      })
      .catch(() => {
        if (!disposed) {
          setLocalEnvironment({});
        }
      });

    return () => {
      disposed = true;
    };
  }, [variables]);

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
          <div className="parameterTable scriptParameterTable">
            <div className="parameterHeader scriptParameterHeader">
              <span>Parameter</span>
              <span>Value</span>
              <span>WORKSPACE ENV</span>
              <span>Local ENV</span>
            </div>
            {variables.map((name) => {
              const attachedSetting = settings[name] ?? createDefaultAttachedParameterSetting();
              const useWorkspaceValue = attachedSetting.useWorkspaceValue ?? !settings[name];
              const workspaceSetting = workspaceParameterSettings[name] ?? createDefaultParameterSetting();
              const effectiveSetting = useWorkspaceValue ? workspaceSetting : attachedSetting;
              const localValue = localEnvironment[name];
              return (
                <div className="parameterRow scriptParameterRow" key={name}>
                  <input aria-label={`Parameter ${name}`} value={name} disabled />
                  <input
                    aria-label={`Value for ${name}`}
                    value={effectiveSetting.useFromEnvironment ? (localValue ?? "") : effectiveSetting.value}
                    disabled={useWorkspaceValue || effectiveSetting.useFromEnvironment}
                    placeholder={effectiveSetting.useFromEnvironment && localValue === undefined ? "Not set locally" : undefined}
                    onChange={(event) => updateParameter(name, { ...attachedSetting, value: event.target.value, useWorkspaceValue: false })}
                  />
                  <label className="envCheckboxCell" title="Use workspace parameter">
                    <input
                      type="checkbox"
                      checked={useWorkspaceValue}
                      onChange={(event) =>
                        updateParameter(name, {
                          ...attachedSetting,
                          useWorkspaceValue: event.target.checked
                        })
                      }
                    />
                    <span className="srOnly">Use workspace parameter for {name}</span>
                  </label>
                  <label className="envCheckboxCell" title="Use local environment">
                    <input
                      type="checkbox"
                      checked={!useWorkspaceValue && attachedSetting.useFromEnvironment}
                      disabled={useWorkspaceValue}
                      onChange={(event) =>
                        updateParameter(name, {
                          ...attachedSetting,
                          useFromEnvironment: event.target.checked,
                          useWorkspaceValue: false
                        })
                      }
                    />
                    <span className="srOnly">Use local environment for {name}</span>
                  </label>
                </div>
              );
            })}
          </div>
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
