import { useMemo, useState } from "react";
import { extractScriptVariables } from "../lib/parser";
import type { AttachedScript, GlobalScript, ScriptParameterSetting } from "../lib/types";

type Props = {
  script: GlobalScript;
  attached: AttachedScript;
  onCancel: () => void;
  onSave: (attached: AttachedScript) => void;
};

export function ScriptSettings({ script, attached, onSave, onCancel }: Props) {
  const variables = useMemo(() => extractScriptVariables(script.content), [script.content]);
  const [settings, setSettings] = useState<Record<string, ScriptParameterSetting>>(attached.parameterSettings);
  const [useInMcp, setUseInMcp] = useState(attached.useInMcp);

  function updateParameter(name: string, setting: ScriptParameterSetting) {
    setSettings((current) => ({ ...current, [name]: setting }));
  }

  function save() {
    onSave({ ...attached, parameterSettings: settings, useInMcp });
  }

  return (
    <div className="formGrid">
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
