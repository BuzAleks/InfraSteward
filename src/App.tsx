import { useEffect, useMemo, useState } from "react";
import { CirclePlus, Play, Settings, Trash2, X, FileCog, ScrollText, Minus, Plus, RotateCcw } from "lucide-react";
import { AddScriptsDialog } from "./components/AddScriptsDialog";
import { ConnectionSettings } from "./components/ConnectionSettings";
import { Modal } from "./components/Modal";
import { ScriptManager } from "./components/ScriptManager";
import { ScriptSettings } from "./components/ScriptSettings";
import { createDefaultAppData, createWorkspace, MAX_LOGS_PER_WORKSPACE } from "./lib/appData";
import { saveAppData, loadAppData, runScript, saveConnection, testConnection } from "./lib/backend";
import { createId, nowIso } from "./lib/ids";
import type { AppData, AttachedScript, GlobalScript, LogEntry, WorkspaceTab } from "./lib/types";

type ModalState =
  | { kind: "none" }
  | { kind: "connection" }
  | { kind: "scripts" }
  | { kind: "addScripts" }
  | { kind: "scriptSettings"; attachedScriptId: string };

export function App() {
  const [data, setData] = useState<AppData>(createDefaultAppData);
  const [modal, setModal] = useState<ModalState>({ kind: "none" });
  const [error, setError] = useState("");
  const [runningScriptId, setRunningScriptId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadAppData().then(setData).catch((reason) => setError(String(reason)));
  }, []);

  useEffect(() => {
    saveAppData(data).catch((reason) => setError(`Storage error: ${String(reason)}`));
  }, [data]);

  const activeWorkspace = useMemo(
    () => data.workspaces.find((workspace) => workspace.id === data.activeTabId) ?? data.workspaces[0],
    [data.activeTabId, data.workspaces]
  );

  const attachmentCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const workspace of data.workspaces) {
      for (const attached of workspace.attachedScripts) {
        counts[attached.globalScriptId] = (counts[attached.globalScriptId] ?? 0) + 1;
      }
    }
    return counts;
  }, [data.workspaces]);

  function updateActiveWorkspace(updater: (workspace: WorkspaceTab) => WorkspaceTab) {
    setData((current) => ({
      ...current,
      workspaces: current.workspaces.map((workspace) => (workspace.id === current.activeTabId ? updater(workspace) : workspace))
    }));
  }

  function appendLog(workspaceId: string, entry: Omit<LogEntry, "id" | "timestamp">) {
    setData((current) => ({
      ...current,
      workspaces: current.workspaces.map((workspace) =>
        workspace.id === workspaceId
          ? {
              ...workspace,
              logs: [
                ...workspace.logs,
                {
                  ...entry,
                  id: createId("log"),
                  timestamp: nowIso()
                }
              ].slice(-MAX_LOGS_PER_WORKSPACE)
            }
          : workspace
      )
    }));
  }

  function addTab() {
    const workspace = createWorkspace("New Workspace");
    setData((current) => ({ ...current, activeTabId: workspace.id, workspaces: [...current.workspaces, workspace] }));
  }

  function closeTab(id: string) {
    if (data.workspaces.length === 1) {
      setError("At least one workspace tab is required.");
      return;
    }
    if (!confirm("Remove this workspace tab? Connection metadata, attached scripts, parameters, and logs for this tab will be removed.")) {
      return;
    }
    setData((current) => {
      const workspaces = current.workspaces.filter((workspace) => workspace.id !== id);
      return {
        ...current,
        workspaces,
        activeTabId: current.activeTabId === id ? workspaces[0].id : current.activeTabId
      };
    });
  }

  function renameTab(id: string) {
    const workspace = data.workspaces.find((candidate) => candidate.id === id);
    const title = prompt("Name", workspace?.title ?? "");
    if (title?.trim()) {
      setData((current) => ({
        ...current,
        workspaces: current.workspaces.map((item) => (item.id === id ? { ...item, title: title.trim() } : item))
      }));
    }
  }

  async function execute(attached: AttachedScript, script: GlobalScript | undefined) {
    if (!script || runningScriptId === attached.id) {
      return;
    }

    setRunningScriptId(attached.id);
    appendLog(activeWorkspace.id, {
      level: "info",
      message: `starting ${script.name}`,
      scriptId: attached.id,
      status: "starting"
    });

    try {
      const result = await runScript({ workspaceId: activeWorkspace.id, attachedScriptId: attached.id });
      for (const line of result.stdout.split(/\r?\n/).filter(Boolean)) {
        appendLog(activeWorkspace.id, { level: "stdout", message: line, scriptId: attached.id, status: result.status });
      }
      for (const line of result.stderr.split(/\r?\n/).filter(Boolean)) {
        appendLog(activeWorkspace.id, { level: "stderr", message: line, scriptId: attached.id, status: result.status });
      }
      appendLog(activeWorkspace.id, {
        level: result.status === "success" ? "info" : "error",
        message: `${script.name} finished with status ${result.status}${result.exitCode === undefined ? "" : ` and exit code ${result.exitCode}`}`,
        scriptId: attached.id,
        status: result.status
      });
    } catch (reason) {
      appendLog(activeWorkspace.id, {
        level: "error",
        message: String(reason),
        scriptId: attached.id,
        status: "failed"
      });
    } finally {
      setRunningScriptId(null);
    }
  }

  if (!activeWorkspace) {
    return <div className="appShell">Loading InfraSteward...</div>;
  }

  return (
    <div className="appShell">
      <header className="tabStrip" aria-label="Workspace tabs">
        {data.workspaces.map((workspace) => (
          <button
            key={workspace.id}
            type="button"
            className={`tabButton ${workspace.id === activeWorkspace.id ? "active" : ""}`}
            onClick={() => setData((current) => ({ ...current, activeTabId: workspace.id }))}
            onDoubleClick={() => renameTab(workspace.id)}
            title="Double-click to rename"
          >
            <span>{workspace.title || workspace.connection.name || workspace.connection.host || "Workspace"}</span>
            <span
              role="button"
              tabIndex={0}
              aria-label={`Close tab ${workspace.title}`}
              title="Close tab"
              className="tabClose"
              onClick={(event) => {
                event.stopPropagation();
                closeTab(workspace.id);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  closeTab(workspace.id);
                }
              }}
            >
              <X size={14} />
            </span>
          </button>
        ))}
        <button type="button" className="newTabButton" onClick={addTab} aria-label="Add tab" title="Add">
          <CirclePlus size={17} /> Add
        </button>
      </header>

      <main className="mainPane">
        <nav className="toolbar" aria-label="Main toolbar">
          <button type="button" onClick={() => setModal({ kind: "connection" })}>
            <Settings size={17} /> Connection Settings
          </button>
          <button type="button" onClick={() => setModal({ kind: "scripts" })}>
            <FileCog size={17} /> Script Manager
          </button>
          {error && <div className="topError" role="alert">{error}</div>}
        </nav>

        <section className="scriptsPanel" aria-label="Attached scripts">
          <div className="sectionHeading">
            <h1>{activeWorkspace.title}</h1>
            <span>{activeWorkspace.connection.host || "No host configured"}</span>
          </div>
          <div className="scriptRows">
            {activeWorkspace.attachedScripts.length === 0 && <div className="emptyState">No scripts attached.</div>}
            {activeWorkspace.attachedScripts.map((attached) => {
              const script = data.globalScripts.find((candidate) => candidate.id === attached.globalScriptId);
              const isRunning = runningScriptId === attached.id;
              return (
                <article className={`scriptRow ${attached.selected ? "selected" : ""}`} key={attached.id}>
                  <label className="selectCell">
                    <input
                      type="checkbox"
                      checked={Boolean(attached.selected)}
                      onChange={(event) =>
                        updateActiveWorkspace((workspace) => ({
                          ...workspace,
                          attachedScripts: workspace.attachedScripts.map((item) =>
                            item.id === attached.id ? { ...item, selected: event.target.checked } : item
                          )
                        }))
                      }
                    />
                    <span className="srOnly">Selection state for removal</span>
                  </label>
                  <div className="scriptSummary">
                    <strong>{script?.name ?? "Missing global script"}</strong>
                    <span>{script?.description ?? "This global script was deleted or is unavailable."}</span>
                    {attached.useInMcp && <small>Use in MCP enabled</small>}
                  </div>
                  <div className="rowActions">
                    <button
                      type="button"
                      title="Script settings"
                      aria-label={`Settings for ${script?.name ?? "missing script"}`}
                      disabled={!script}
                      onClick={() => setModal({ kind: "scriptSettings", attachedScriptId: attached.id })}
                    >
                      <Settings size={16} /> Settings
                    </button>
                    <button
                      type="button"
                      className="primaryButton"
                      title="Run"
                      aria-label={`Run ${script?.name ?? "missing script"}`}
                      disabled={!script || isRunning}
                      onClick={() => execute(attached, script)}
                    >
                      <Play size={16} /> {isRunning ? "Running" : "Run"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          <div className="listControls">
            <button type="button" onClick={() => setModal({ kind: "addScripts" })} title="Add" aria-label="Add scripts">
              <Plus size={17} /> Add
            </button>
            <button
              type="button"
              className="dangerButton"
              title="Remove"
              aria-label="Remove selected scripts"
              onClick={() => {
                const selected = activeWorkspace.attachedScripts.filter((item) => item.selected);
                if (selected.length === 0) {
                  return;
                }
                if (selected.length > 1 && !confirm(`Remove ${selected.length} selected scripts from this tab?`)) {
                  return;
                }
                updateActiveWorkspace((workspace) => ({
                  ...workspace,
                  attachedScripts: workspace.attachedScripts.filter((item) => !item.selected)
                }));
              }}
            >
              <Minus size={17} /> Remove
            </button>
          </div>
        </section>

        <section className="logsPanel" aria-label="Logs">
          <div className="logsHeader">
            <h2><ScrollText size={17} /> Logs</h2>
            <button type="button" title="Clear Logs" aria-label="Clear Logs" onClick={() => updateActiveWorkspace((workspace) => ({ ...workspace, logs: [] }))}>
              <Trash2 size={16} /> Clear Logs
            </button>
          </div>
          <div className="logsList">
            {activeWorkspace.logs.length === 0 && <div className="emptyState">No logs yet.</div>}
            {activeWorkspace.logs.map((log) => (
              <div className={`logLine ${log.level}`} key={log.id}>
                <time>{new Date(log.timestamp).toLocaleTimeString()}</time>
                <span>{log.level}</span>
                <p>{log.message}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      {modal.kind === "connection" && (
        <Modal title="Connection Settings" onClose={() => setModal({ kind: "none" })} width="wide">
          <ConnectionSettings
            connection={activeWorkspace.connection}
            busy={busy}
            onCancel={() => setModal({ kind: "none" })}
            onTest={async (connection, secrets) => {
              setBusy(true);
              try {
                const nextData = await saveConnection({ workspaceId: activeWorkspace.id, connection, secrets });
                setData(nextData);
                const message = await testConnection(activeWorkspace.id);
                appendLog(activeWorkspace.id, { level: "info", message, status: "connected" });
              } catch (reason) {
                appendLog(activeWorkspace.id, { level: "error", message: String(reason), status: "failed" });
              } finally {
                setBusy(false);
              }
            }}
            onSave={async (connection, secrets) => {
              setData(await saveConnection({ workspaceId: activeWorkspace.id, connection, secrets }));
              setModal({ kind: "none" });
            }}
          />
        </Modal>
      )}

      {modal.kind === "scripts" && (
        <Modal title="Script Manager" onClose={() => setModal({ kind: "none" })} width="wide">
          <ScriptManager
            scripts={data.globalScripts}
            attachmentCounts={attachmentCounts}
            onDelete={(scriptId) =>
              setData((current) => ({
                ...current,
                globalScripts: current.globalScripts.filter((script) => script.id !== scriptId)
              }))
            }
            onSave={(script) =>
              setData((current) => ({
                ...current,
                globalScripts: current.globalScripts.some((candidate) => candidate.id === script.id)
                  ? current.globalScripts.map((candidate) => (candidate.id === script.id ? script : candidate))
                  : [...current.globalScripts, script]
              }))
            }
          />
        </Modal>
      )}

      {modal.kind === "addScripts" && (
        <Modal title="Add Scripts" onClose={() => setModal({ kind: "none" })}>
          <AddScriptsDialog
            scripts={data.globalScripts}
            attachedScriptIds={activeWorkspace.attachedScripts.map((attached) => attached.globalScriptId)}
            onCancel={() => setModal({ kind: "none" })}
            onAdd={(scriptIds) => {
              updateActiveWorkspace((workspace) => ({
                ...workspace,
                attachedScripts: [
                  ...workspace.attachedScripts,
                  ...scriptIds.map((scriptId) => ({
                    id: createId("attached"),
                    globalScriptId: scriptId,
                    parameterSettings: {},
                    useInMcp: false
                  }))
                ]
              }));
              setModal({ kind: "none" });
            }}
          />
        </Modal>
      )}

      {modal.kind === "scriptSettings" && (
        <Modal title="Script Settings" onClose={() => setModal({ kind: "none" })} width="wide">
          {(() => {
            const attached = activeWorkspace.attachedScripts.find((item) => item.id === modal.attachedScriptId);
            const script = data.globalScripts.find((item) => item.id === attached?.globalScriptId);
            if (!attached || !script) {
              return <div className="errorBox">Missing global script reference.</div>;
            }
            return (
              <ScriptSettings
                script={script}
                attached={attached}
                onCancel={() => setModal({ kind: "none" })}
                onSave={(nextAttached) => {
                  updateActiveWorkspace((workspace) => ({
                    ...workspace,
                    attachedScripts: workspace.attachedScripts.map((item) => (item.id === nextAttached.id ? nextAttached : item))
                  }));
                  setModal({ kind: "none" });
                }}
              />
            );
          })()}
        </Modal>
      )}

      {busy && (
        <div className="busyToast" role="status">
          <RotateCcw size={16} /> Working
        </div>
      )}
    </div>
  );
}
