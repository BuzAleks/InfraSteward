import { useState } from "react";
import type { LocalRunnerConfig, LocalRunnerKind } from "../lib/types";

type Props = {
  runner: LocalRunnerConfig;
  onCancel: () => void;
  onSave: (runner: LocalRunnerConfig) => void;
};

const RUNNER_LABELS: Record<LocalRunnerKind, string> = {
  bash: "bash",
  sh: "sh",
  zsh: "zsh",
  gitBash: "Git Bash",
  wsl: "WSL bash",
  custom: "Custom"
};

export function LocalRunnerSettings({ runner, onCancel, onSave }: Props) {
  const [draft, setDraft] = useState<LocalRunnerConfig>({
    ...runner,
    executionTimeoutSeconds: runner.executionTimeoutSeconds ?? 300
  });
  const [argsText, setArgsText] = useState((runner.args ?? []).join("\n"));
  const [error, setError] = useState("");
  const usesCustomCommand = draft.kind === "custom" || Boolean(draft.command?.trim());

  function save() {
    if (draft.kind === "custom" && !draft.command?.trim()) {
      setError("Command is required for custom runner.");
      return;
    }
    onSave({
      ...draft,
      command: draft.command?.trim() || undefined,
      args: argsText
        .split(/\r?\n/)
        .map((arg) => arg.trim())
        .filter(Boolean),
      workingDirectory: draft.workingDirectory?.trim() || undefined,
      executionTimeoutSeconds: Math.max(1, Number(draft.executionTimeoutSeconds ?? 300))
    });
  }

  return (
    <form className="formGrid" onSubmit={(event) => event.preventDefault()}>
      {error && <div className="errorBox">{error}</div>}
      <label>
        Runner
        <select
          value={draft.kind}
          onChange={(event) => {
            setDraft({ ...draft, kind: event.target.value as LocalRunnerKind });
            setError("");
          }}
        >
          {Object.entries(RUNNER_LABELS).map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Command override
        <input
          placeholder={draft.kind === "gitBash" ? "Auto-detect Git Bash" : draft.kind === "wsl" ? "wsl.exe" : RUNNER_LABELS[draft.kind]}
          value={draft.command ?? ""}
          onChange={(event) => setDraft({ ...draft, command: event.target.value })}
        />
      </label>
      <label>
        Arguments
        <textarea
          rows={4}
          placeholder={usesCustomCommand ? "One argument per line. Leave empty to use runner defaults." : "Optional, one argument per line."}
          value={argsText}
          onChange={(event) => setArgsText(event.target.value)}
        />
      </label>
      <label>
        Working directory
        <input value={draft.workingDirectory ?? ""} onChange={(event) => setDraft({ ...draft, workingDirectory: event.target.value })} />
      </label>
      <label>
        Execution timeout
        <input
          type="number"
          min={1}
          value={draft.executionTimeoutSeconds ?? 300}
          onChange={(event) => setDraft({ ...draft, executionTimeoutSeconds: Number(event.target.value) })}
        />
      </label>
      <div className="modalActions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="primaryButton" onClick={save}>
          Save
        </button>
      </div>
    </form>
  );
}
