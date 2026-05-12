import { useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { SecretInput, SshConnectionConfig } from "../lib/types";
import { validateConnection } from "../lib/validation";

type Props = {
  connection: SshConnectionConfig;
  connections: SshConnectionConfig[];
  onCancel: () => void;
  onSave: (connection: SshConnectionConfig, secrets: SecretInput) => Promise<void>;
  onTest: (connection: SshConnectionConfig, secrets: SecretInput) => Promise<string>;
  busy: boolean;
};

export function ConnectionSettings({ connection, connections, onCancel, onSave, onTest, busy }: Props) {
  const [draft, setDraft] = useState(connection);
  const [secrets, setSecrets] = useState<SecretInput>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [testResult, setTestResult] = useState<{ status: "success" | "error"; message: string } | null>(null);

  function validateDraft() {
    const hasSavedSecret =
      draft.authType === "password" ? Boolean(draft.passwordRef || secrets.password) : Boolean(draft.privateKeyPath || draft.privateKeyContentRef || secrets.privateKeyContent);
    const normalizedName = draft.name.trim().toLowerCase();
    const duplicateName = connections.some((candidate) => candidate.id !== draft.id && candidate.name.trim().toLowerCase() === normalizedName);
    const nextErrors = [
      ...validateConnection(draft, hasSavedSecret),
      ...(normalizedName ? [] : ["Connection name is required."]),
      ...(duplicateName ? ["Connection name must be unique."] : [])
    ];
    setErrors(nextErrors);
    return nextErrors.length === 0;
  }

  async function save() {
    if (validateDraft()) {
      await onSave(draft, secrets);
    }
  }

  async function test() {
    if (validateDraft()) {
      setTestResult(null);
      try {
        const message = await onTest(draft, secrets);
        setTestResult({ status: "success", message: message || "Connection OK" });
      } catch (reason) {
        setTestResult({ status: "error", message: String(reason) });
      }
    }
  }

  return (
    <form className="formGrid" onSubmit={(event) => event.preventDefault()}>
      {errors.length > 0 && (
        <div className="errorBox" role="alert">
          {errors.map((error) => (
            <div key={error}>{error}</div>
          ))}
        </div>
      )}
      {testResult && (
        <div className={`connectionTestResult ${testResult.status}`} role={testResult.status === "error" ? "alert" : "status"}>
          {testResult.status === "success" ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
          <div>
            <strong>{testResult.status === "success" ? "OK" : "Connection failed"}</strong>
            <span>{testResult.message}</span>
          </div>
        </div>
      )}
      <label>
        Name
        <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
      </label>
      <label>
        Host
        <input required value={draft.host} onChange={(event) => setDraft({ ...draft, host: event.target.value })} />
      </label>
      <label>
        Port
        <input
          type="number"
          min={1}
          max={65535}
          value={draft.port}
          onChange={(event) => setDraft({ ...draft, port: Number(event.target.value) })}
        />
      </label>
      <label>
        Username
        <input required value={draft.username} onChange={(event) => setDraft({ ...draft, username: event.target.value })} />
      </label>
      <label>
        Authentication type
        <select
          value={draft.authType}
          onChange={(event) => setDraft({ ...draft, authType: event.target.value as SshConnectionConfig["authType"] })}
        >
          <option value="password">Password</option>
          <option value="privateKey">Private key</option>
        </select>
      </label>
      {draft.authType === "password" ? (
        <label>
          Password
          <input
            type="password"
            placeholder={draft.passwordRef ? "Saved secret exists" : ""}
            value={secrets.password ?? ""}
            onChange={(event) => setSecrets({ ...secrets, password: event.target.value })}
          />
        </label>
      ) : (
        <>
          <label>
            Private key path
            <input value={draft.privateKeyPath ?? ""} onChange={(event) => setDraft({ ...draft, privateKeyPath: event.target.value })} />
          </label>
          <label>
            Private key content
            <textarea
              rows={5}
              placeholder={draft.privateKeyContentRef ? "Saved secret exists" : ""}
              value={secrets.privateKeyContent ?? ""}
              onChange={(event) => setSecrets({ ...secrets, privateKeyContent: event.target.value })}
            />
          </label>
          <label>
            Optional private key passphrase
            <input
              type="password"
              placeholder={draft.passphraseRef ? "Saved secret exists" : ""}
              value={secrets.passphrase ?? ""}
              onChange={(event) => setSecrets({ ...secrets, passphrase: event.target.value })}
            />
          </label>
        </>
      )}
      <label>
        Working directory
        <input
          placeholder="/opt/my-app"
          value={draft.workingDirectory ?? ""}
          onChange={(event) => setDraft({ ...draft, workingDirectory: event.target.value })}
        />
      </label>
      <label>
        Connection timeout
        <input
          type="number"
          min={1}
          value={draft.connectionTimeoutSeconds ?? 15}
          onChange={(event) => setDraft({ ...draft, connectionTimeoutSeconds: Number(event.target.value) })}
        />
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
      <label className="checkboxLine">
        <input
          type="checkbox"
          checked={Boolean(secrets.allowInsecureSecretStorage)}
          onChange={(event) => setSecrets({ ...secrets, allowInsecureSecretStorage: event.target.checked })}
        />
        Allow insecure fallback secret storage if OS keychain is unavailable
      </label>
      <div className="modalActions">
        <button type="button" onClick={test} disabled={busy}>
          Test Connection
        </button>
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
