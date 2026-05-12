import { useEffect, useMemo, useState } from "react";
import { getLocalEnvironment } from "../lib/backend";
import { collectWorkspaceParameterNames, createDefaultParameterSetting } from "../lib/workspaceParameters";
import type { GlobalScript, ScriptParameterSetting, WorkspaceTab } from "../lib/types";

type Props = {
  workspace: WorkspaceTab;
  scripts: GlobalScript[];
  onCancel: () => void;
  onSave: (parameterSettings: Record<string, ScriptParameterSetting>) => void;
};

export function WorkspaceParameters({ workspace, scripts, onCancel, onSave }: Props) {
  const names = useMemo(() => collectWorkspaceParameterNames(workspace, scripts), [workspace, scripts]);
  const [settings, setSettings] = useState<Record<string, ScriptParameterSetting>>(() => {
    const nextSettings: Record<string, ScriptParameterSetting> = {};
    for (const name of names) {
      nextSettings[name] = workspace.parameterSettings[name] ?? createDefaultParameterSetting();
    }
    return nextSettings;
  });
  const [localEnvironment, setLocalEnvironment] = useState<Record<string, string>>({});

  useEffect(() => {
    setSettings((current) => {
      const nextSettings: Record<string, ScriptParameterSetting> = {};
      for (const name of names) {
        nextSettings[name] = current[name] ?? workspace.parameterSettings[name] ?? createDefaultParameterSetting();
      }
      return nextSettings;
    });
  }, [names, workspace.parameterSettings]);

  useEffect(() => {
    let disposed = false;
    if (names.length === 0) {
      setLocalEnvironment({});
      return;
    }

    getLocalEnvironment(names)
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
  }, [names]);

  function updateParameter(name: string, setting: ScriptParameterSetting) {
    setSettings((current) => ({ ...current, [name]: setting }));
  }

  return (
    <div className="workspaceParametersForm">
      <div className="scriptSettingsVariables">
        {names.length === 0 ? (
          <p className="emptyState">No parameters yet.</p>
        ) : (
          <div className="parameterTable">
            <div className="parameterHeader">
              <span>Parameter</span>
              <span>Value</span>
              <span>Local ENV</span>
            </div>
            {names.map((name) => {
              const setting = settings[name] ?? createDefaultParameterSetting();
              const localValue = localEnvironment[name];
              return (
                <div className="parameterRow" key={name}>
                  <input aria-label={`Parameter ${name}`} value={name} disabled />
                  <input
                    aria-label={`Value for ${name}`}
                    value={setting.useFromEnvironment ? (localValue ?? "") : setting.value}
                    disabled={setting.useFromEnvironment}
                    placeholder={setting.useFromEnvironment && localValue === undefined ? "Not set locally" : undefined}
                    onChange={(event) => updateParameter(name, { ...setting, value: event.target.value })}
                  />
                  <label className="envCheckboxCell" title="Use local environment">
                    <input
                      type="checkbox"
                      checked={setting.useFromEnvironment}
                      onChange={(event) => updateParameter(name, { ...setting, useFromEnvironment: event.target.checked })}
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
        <button type="button" className="primaryButton" onClick={() => onSave(settings)}>
          Save
        </button>
      </div>
    </div>
  );
}
