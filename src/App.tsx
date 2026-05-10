import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { CirclePlus, Play, Settings, Trash2, X, FileCog, ScrollText, Minus, Plus, RotateCcw, Square, ExternalLink } from "lucide-react";
import { AddScriptsDialog } from "./components/AddScriptsDialog";
import { ConnectionSettings } from "./components/ConnectionSettings";
import { Modal } from "./components/Modal";
import { ScriptManager } from "./components/ScriptManager";
import { ScriptSettings } from "./components/ScriptSettings";
import { createDefaultAppData, createWorkspace, MAX_LOGS_PER_WORKSPACE } from "./lib/appData";
import {
  saveAppData,
  loadAppData,
  runScript,
  saveConnection,
  testConnection,
  logSystemEvent,
  getRuntimeInfo,
  openWorkingDataDir,
  cancelScript,
  drainScriptEvents
} from "./lib/backend";
import { createId, nowIso } from "./lib/ids";
import type { AppData, AttachedScript, GlobalScript, LogEntry, ScriptExecutionEvent, WorkspaceTab } from "./lib/types";

type ModalState =
  | { kind: "none" }
  | { kind: "connection" }
  | { kind: "scripts" }
  | { kind: "addScripts" }
  | { kind: "scriptSettings"; attachedScriptId: string };

type RunningExecution = {
  executionId: string;
  workspaceId: string;
  attachedScriptId: string;
  scriptName: string;
};

export function App() {
  const params = new globalThis.URLSearchParams(window.location.search);
  if (params.get("view") === "script-log") {
    return <ScriptLogWindow params={params} />;
  }
  return <MainApp />;
}

function MainApp() {
  const [data, setData] = useState<AppData>(createDefaultAppData);
  const [modal, setModal] = useState<ModalState>({ kind: "none" });
  const [error, setError] = useState("");
  const [runningExecution, setRunningExecution] = useState<RunningExecution | null>(null);
  const [stoppingScriptId, setStoppingScriptId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [logsPanelHeight, setLogsPanelHeight] = useState(260);
  const [logsAutoscroll, setLogsAutoscroll] = useState(true);
  const [runtimePath, setRuntimePath] = useState("");
  const [systemLogPath, setSystemLogPath] = useState("");
  const mainPaneRef = useRef<HTMLElement | null>(null);
  const logsListRef = useRef<HTMLDivElement | null>(null);
  const streamBuffersRef = useRef<Record<string, string>>({});

  useEffect(() => {
    getRuntimeInfo()
      .then((info) => {
        setRuntimePath(info.workingDataDir);
        setSystemLogPath(info.systemLogPath);
      })
      .catch((reason) => {
        const message = String(reason);
        setError(message);
        void logSystemEvent({ level: "error", target: "frontend", message: "Failed to read runtime info.", details: message });
      });
    loadAppData()
      .then(setData)
      .catch((reason) => {
        const message = String(reason);
        setError(message);
        void logSystemEvent({ level: "error", target: "frontend", message: "Failed to load app data.", details: message });
      });
  }, []);

  useEffect(() => {
    saveAppData(data).catch((reason) => {
      const message = String(reason);
      setError(`Storage error: ${message}`);
      void logSystemEvent({ level: "error", target: "frontend", message: "Failed to save app data.", details: message });
    });
  }, [data]);

  useEffect(() => {
    if (!runningExecution) {
      return;
    }

    let disposed = false;
    let polling = false;

    async function poll() {
      if (disposed || polling || !runningExecution) {
        return;
      }
      polling = true;
      try {
        const events = await drainScriptEvents({
          executionId: runningExecution.executionId,
          workspaceId: runningExecution.workspaceId,
          attachedScriptId: runningExecution.attachedScriptId
        });
        for (const event of events) {
          handleScriptExecutionEvent(event);
        }
      } catch (reason) {
        const message = String(reason);
        setError(`Log polling error: ${message}`);
        void logSystemEvent({ level: "error", target: "frontend", message: "Failed to poll script logs.", details: message });
      } finally {
        polling = false;
      }
    }

    void poll();
    const intervalId = window.setInterval(() => {
      void poll();
    }, 250);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
    // Polling intentionally binds to the current execution; log helpers use functional state updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningExecution]);

  const activeWorkspace = useMemo(
    () => data.workspaces.find((workspace) => workspace.id === data.activeTabId) ?? data.workspaces[0],
    [data.activeTabId, data.workspaces]
  );
  const latestLogId = activeWorkspace?.logs.at(-1)?.id;

  useEffect(() => {
    if (!logsAutoscroll) {
      return;
    }
    const logsList = logsListRef.current;
    if (!logsList) {
      return;
    }
    const frameId = window.requestAnimationFrame(() => {
      logsList.scrollTop = logsList.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [activeWorkspace?.id, latestLogId, logsAutoscroll]);

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

  function clampLogsPanelHeight(nextHeight: number) {
    const mainPaneHeight = mainPaneRef.current?.getBoundingClientRect().height ?? window.innerHeight;
    const maxHeight = Math.max(180, mainPaneHeight - 280);
    return Math.min(Math.max(nextHeight, 140), maxHeight);
  }

  function startLogsResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      const rect = mainPaneRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      setLogsPanelHeight(clampLogsPanelHeight(rect.bottom - moveEvent.clientY));
    };
    const stopResize = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
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

  async function openRuntimePath() {
    try {
      await openWorkingDataDir();
    } catch (reason) {
      const message = String(reason);
      setError(`Could not open working directory: ${message}`);
      void logSystemEvent({ level: "error", target: "frontend", message: "Failed to open working directory.", details: message });
    }
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
    if (!script || runningExecution?.attachedScriptId === attached.id) {
      return;
    }

    const executionId = createId("execution");
    const execution: RunningExecution = {
      executionId,
      workspaceId: activeWorkspace.id,
      attachedScriptId: attached.id,
      scriptName: script.name
    };
    setRunningExecution(execution);
    delete streamBuffersRef.current[`${activeWorkspace.id}:${attached.id}:stdout`];
    delete streamBuffersRef.current[`${activeWorkspace.id}:${attached.id}:stderr`];
    appendLog(activeWorkspace.id, {
      level: "info",
      message: `starting ${script.name}`,
      scriptId: attached.id,
      status: "starting"
    });

    try {
      await runScript({ executionId, workspaceId: activeWorkspace.id, attachedScriptId: attached.id });
    } catch (reason) {
      flushStreamBuffer(activeWorkspace.id, attached.id, "stdout", "failed");
      flushStreamBuffer(activeWorkspace.id, attached.id, "stderr", "failed");
      setRunningExecution(null);
      void logSystemEvent({
        level: "error",
        target: "frontend",
        message: "Script execution failed in UI flow.",
        details: String(reason)
      });
      appendLog(activeWorkspace.id, {
        level: "error",
        message: String(reason),
        scriptId: attached.id,
        status: "failed"
      });
      setStoppingScriptId(null);
    }
  }

  async function stopExecution(attached: AttachedScript) {
    if (runningExecution?.attachedScriptId !== attached.id || stoppingScriptId === attached.id) {
      return;
    }

    setStoppingScriptId(attached.id);
    appendLog(activeWorkspace.id, {
      level: "warn",
      message: "stop requested",
      scriptId: attached.id,
      status: "cancelled"
    });

    try {
      await cancelScript({ executionId: runningExecution.executionId, workspaceId: runningExecution.workspaceId, attachedScriptId: attached.id });
    } catch (reason) {
      const message = String(reason);
      setStoppingScriptId(null);
      void logSystemEvent({ level: "error", target: "frontend", message: "Failed to stop script.", details: message });
      appendLog(activeWorkspace.id, {
        level: "error",
        message,
        scriptId: attached.id,
        status: "failed"
      });
    }
  }

  async function openScriptLogWindow(attached: AttachedScript, script: GlobalScript | undefined) {
    if (!script) {
      return;
    }
    if (!("__TAURI_INTERNALS__" in window)) {
      setError("New log windows require the Tauri desktop runtime.");
      return;
    }

    const executionId = createId("execution");
    const params = new globalThis.URLSearchParams({
      view: "script-log",
      executionId,
      workspaceId: activeWorkspace.id,
      attachedScriptId: attached.id,
      scriptName: script.name,
      workspaceTitle: activeWorkspace.title
    });
    const label = `script_logs_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const logWindow = new WebviewWindow(label, {
      url: `index.html?${params.toString()}`,
      title: `${script.name} logs`,
      width: 980,
      height: 680,
      minWidth: 620,
      minHeight: 420
    });
    await logWindow.once("tauri://error", (event) => {
      setError(`Could not open log window: ${String(event.payload)}`);
    });
  }

  function flushStreamBuffer(workspaceId: string, attachedScriptId: string, stream: "stdout" | "stderr", status: LogEntry["status"]) {
    const key = `${workspaceId}:${attachedScriptId}:${stream}`;
    const pending = streamBuffersRef.current[key];
    if (pending?.trim()) {
      appendLog(workspaceId, {
        level: stream,
        message: pending,
        scriptId: attachedScriptId,
        status
      });
    }
    delete streamBuffersRef.current[key];
  }

  function handleScriptExecutionEvent(event: ScriptExecutionEvent) {
    if (event.kind === "output" && event.stream && event.chunk) {
      appendOutputChunk(event.workspaceId, event.attachedScriptId, event.stream, event.chunk);
      return;
    }

    if (event.kind === "finished") {
      const status = event.status ?? "failed";
      flushStreamBuffer(event.workspaceId, event.attachedScriptId, "stdout", status);
      flushStreamBuffer(event.workspaceId, event.attachedScriptId, "stderr", status);
      appendLog(event.workspaceId, {
        level: status === "success" ? "info" : status === "cancelled" ? "warn" : "error",
        message: `${runningExecution?.scriptName ?? "Script"} finished with status ${status}${event.exitCode === undefined ? "" : ` and exit code ${event.exitCode}`}${event.message ? `: ${event.message}` : ""}`,
        scriptId: event.attachedScriptId,
        status
      });
      setRunningExecution(null);
      setStoppingScriptId(null);
    }
  }

  function appendOutputChunk(workspaceId: string, attachedScriptId: string, stream: "stdout" | "stderr", chunk: string) {
    const key = `${workspaceId}:${attachedScriptId}:${stream}`;
    const nextText = `${streamBuffersRef.current[key] ?? ""}${chunk}`;
    const lines = nextText.split(/\r?\n/);
    streamBuffersRef.current[key] = lines.pop() ?? "";

    for (const line of lines.filter(Boolean)) {
      appendLog(workspaceId, {
        level: stream,
        message: line,
        scriptId: attachedScriptId,
        status: "running"
      });
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

      <main
        className="mainPane"
        ref={mainPaneRef}
        style={{ "--logs-panel-height": `${logsPanelHeight}px` } as CSSProperties}
      >
        <nav className="toolbar" aria-label="Main toolbar">
          <button type="button" onClick={() => setModal({ kind: "connection" })}>
            <Settings size={17} /> Connection Settings
          </button>
          <button type="button" onClick={() => setModal({ kind: "scripts" })}>
            <FileCog size={17} /> Script Manager
          </button>
          {runtimePath && (
            <button
              type="button"
              className="runtimePath"
              title={`Open working directory\n${runtimePath}\nSystem log: ${systemLogPath}`}
              onClick={openRuntimePath}
            >
              <span>Working directory</span>
              <code>{runtimePath}</code>
            </button>
          )}
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
              const isRunning = runningExecution?.workspaceId === activeWorkspace.id && runningExecution.attachedScriptId === attached.id;
              const isAnyScriptRunning = Boolean(runningExecution);
              const isBlockedByAnotherScript = isAnyScriptRunning && !isRunning;
              const isStopping = stoppingScriptId === attached.id;
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
                      <Settings size={16} />
                    </button>
                    <button
                      type="button"
                      className="primaryButton"
                      title={isRunning ? "Running" : isBlockedByAnotherScript ? "Blocked while another script is running" : "Run"}
                      aria-label={`Run ${script?.name ?? "missing script"}`}
                      disabled={!script || isAnyScriptRunning}
                      onClick={() => execute(attached, script)}
                    >
                      <Play size={16} />
                    </button>
                    {isRunning && (
                      <button
                        type="button"
                        className="dangerButton"
                        title={isStopping ? "Stopping" : "Stop"}
                        aria-label={`Stop ${script?.name ?? "running script"}`}
                        disabled={isStopping}
                        onClick={() => stopExecution(attached)}
                      >
                        <Square size={15} />
                      </button>
                    )}
                    <button
                      type="button"
                      title="Запуск в новом окне"
                      aria-label={`Запуск ${script?.name ?? "missing script"} в новом окне`}
                      disabled={!script}
                      onClick={() => {
                        void openScriptLogWindow(attached, script);
                      }}
                    >
                      <ExternalLink size={16} />
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

        <div
          className="panelResizeHandle"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize logs panel"
          tabIndex={0}
          onPointerDown={startLogsResize}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setLogsPanelHeight((height) => clampLogsPanelHeight(height + 24));
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setLogsPanelHeight((height) => clampLogsPanelHeight(height - 24));
            }
          }}
        />

        <section className="logsPanel" aria-label="Logs">
          <div className="logsHeader">
            <h2><ScrollText size={17} /> Logs</h2>
            <div className="logsHeaderActions">
              <label className="checkboxLine logAutoscrollToggle">
                <input type="checkbox" checked={logsAutoscroll} onChange={(event) => setLogsAutoscroll(event.target.checked)} />
                <span>Autoscroll</span>
              </label>
              <button type="button" title="Clear Logs" aria-label="Clear Logs" onClick={() => updateActiveWorkspace((workspace) => ({ ...workspace, logs: [] }))}>
                <Trash2 size={16} /> Clear Logs
              </button>
            </div>
          </div>
          <div className="logsList" ref={logsListRef}>
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
                void logSystemEvent({
                  level: "error",
                  target: "frontend",
                  message: "Connection test failed in UI flow.",
                  details: String(reason)
                });
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

function ScriptLogWindow({ params }: { params: globalThis.URLSearchParams }) {
  const workspaceId = params.get("workspaceId") ?? "";
  const attachedScriptId = params.get("attachedScriptId") ?? "";
  const scriptName = params.get("scriptName") ?? "Script";
  const workspaceTitle = params.get("workspaceTitle") ?? "Workspace";
  const [executionId, setExecutionId] = useState(params.get("executionId") ?? createId("execution"));
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [started, setStarted] = useState(false);
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [logsAutoscroll, setLogsAutoscroll] = useState(true);
  const [error, setError] = useState("");
  const logsListRef = useRef<HTMLDivElement | null>(null);
  const logsEndRef = useRef<HTMLDivElement | null>(null);
  const streamBuffersRef = useRef<Record<string, string>>({});
  const runningRef = useRef(false);
  const executionIdRef = useRef(executionId);

  useEffect(() => {
    if (!logsAutoscroll) {
      return;
    }
    const logsList = logsListRef.current;
    if (!logsList) {
      return;
    }
    const frameId = window.requestAnimationFrame(() => {
      logsList.scrollTop = logsList.scrollHeight;
      logsEndRef.current?.scrollIntoView({ block: "end" });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [logs, logsAutoscroll]);

  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  useEffect(() => {
    executionIdRef.current = executionId;
  }, [executionId]);

  useEffect(() => {
    return () => {
      if (runningRef.current) {
        void cancelScript({ executionId: executionIdRef.current, workspaceId, attachedScriptId });
      }
    };
    // This window is bound to immutable URL params.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!running) {
      return;
    }

    let disposed = false;
    let polling = false;

    async function poll() {
      if (disposed || polling) {
        return;
      }
      polling = true;
      try {
        const events = await drainScriptEvents({ executionId, workspaceId, attachedScriptId });
        for (const event of events) {
          handleWindowExecutionEvent(event);
        }
      } catch (reason) {
        const message = String(reason);
        setError(`Log polling error: ${message}`);
      } finally {
        polling = false;
      }
    }

    void poll();
    const intervalId = window.setInterval(() => {
      void poll();
    }, 250);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
    // Polling intentionally binds to immutable URL params and current running state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, executionId]);

  function appendWindowLog(entry: Omit<LogEntry, "id" | "timestamp">) {
    setLogs((current) =>
      [
        ...current,
        {
          ...entry,
          id: createId("log"),
          timestamp: nowIso()
        }
      ].slice(-MAX_LOGS_PER_WORKSPACE)
    );
  }

  function appendOutputChunk(stream: "stdout" | "stderr", chunk: string) {
    const key = `${executionId}:${stream}`;
    const nextText = `${streamBuffersRef.current[key] ?? ""}${chunk}`;
    const lines = nextText.split(/\r?\n/);
    streamBuffersRef.current[key] = lines.pop() ?? "";

    for (const line of lines.filter(Boolean)) {
      appendWindowLog({
        level: stream,
        message: line,
        scriptId: attachedScriptId,
        executionId,
        status: "running"
      });
    }
  }

  function flushStreamBuffer(stream: "stdout" | "stderr", status: LogEntry["status"]) {
    const key = `${executionId}:${stream}`;
    const pending = streamBuffersRef.current[key];
    if (pending?.trim()) {
      appendWindowLog({
        level: stream,
        message: pending,
        scriptId: attachedScriptId,
        executionId,
        status
      });
    }
    delete streamBuffersRef.current[key];
  }

  function handleWindowExecutionEvent(event: ScriptExecutionEvent) {
    if (event.executionId !== executionId) {
      return;
    }

    if (event.kind === "output" && event.stream && event.chunk) {
      appendOutputChunk(event.stream, event.chunk);
      return;
    }

    if (event.kind === "finished") {
      const status = event.status ?? "failed";
      flushStreamBuffer("stdout", status);
      flushStreamBuffer("stderr", status);
      appendWindowLog({
        level: status === "success" ? "info" : status === "cancelled" ? "warn" : "error",
        message: `${scriptName} finished with status ${status}${event.exitCode === undefined ? "" : ` and exit code ${event.exitCode}`}${event.message ? `: ${event.message}` : ""}`,
        scriptId: attachedScriptId,
        executionId,
        status
      });
      setRunning(false);
      setStopping(false);
    }
  }

  async function startWindowExecution() {
    if (running) {
      return;
    }

    const nextExecutionId = createId("execution");
    streamBuffersRef.current = {};
    setExecutionId(nextExecutionId);
    setStarted(true);
    setRunning(true);
    setStopping(false);
    setError("");
    appendWindowLog({
      level: "info",
      message: `starting ${scriptName}`,
      scriptId: attachedScriptId,
      executionId: nextExecutionId,
      status: "starting"
    });

    try {
      await runScript({ executionId: nextExecutionId, workspaceId, attachedScriptId });
    } catch (reason) {
      const message = String(reason);
      setError(message);
      setRunning(false);
      appendWindowLog({
        level: "error",
        message,
        scriptId: attachedScriptId,
        executionId: nextExecutionId,
        status: "failed"
      });
    }
  }

  async function stopWindowExecution() {
    if (!running || stopping) {
      return;
    }
    setStopping(true);
    appendWindowLog({
      level: "warn",
      message: "stop requested",
      scriptId: attachedScriptId,
      executionId,
      status: "cancelled"
    });

    try {
      await cancelScript({ executionId, workspaceId, attachedScriptId });
    } catch (reason) {
      const message = String(reason);
      setStopping(false);
      setError(message);
      appendWindowLog({
        level: "error",
        message,
        scriptId: attachedScriptId,
        executionId,
        status: "failed"
      });
    }
  }

  return (
    <div className="logWindowShell">
      <header className="logWindowHeader">
        <div>
          <h1>{scriptName}</h1>
          <span>{workspaceTitle}</span>
        </div>
        <div className="rowActions">
          <label className="checkboxLine logAutoscrollToggle">
            <input type="checkbox" checked={logsAutoscroll} onChange={(event) => setLogsAutoscroll(event.target.checked)} />
            <span>Autoscroll</span>
          </label>
          <button type="button" className="primaryButton" title="Start" aria-label={`Start ${scriptName}`} disabled={running} onClick={startWindowExecution}>
            <Play size={15} /> Start
          </button>
          <button type="button" className="dangerButton" disabled={!running || stopping} onClick={stopWindowExecution}>
            <Square size={15} /> {stopping ? "Stopping" : "Stop"}
          </button>
          <button type="button" onClick={() => setLogs([])}>
            <Trash2 size={15} /> Clear
          </button>
        </div>
      </header>
      {error && <div className="topError logWindowError">{error}</div>}
      <section className="logsPanel logWindowLogs" aria-label="Script logs">
        <div className="logsList" ref={logsListRef}>
          {logs.length === 0 && <div className="emptyState">{started ? "Waiting for logs..." : "Ready to start."}</div>}
          {logs.map((log) => (
            <div className={`logLine ${log.level}`} key={log.id}>
              <time>{new Date(log.timestamp).toLocaleTimeString()}</time>
              <span>{log.level}</span>
              <p>{log.message}</p>
            </div>
          ))}
          <div className="logsEndAnchor" ref={logsEndRef} />
        </div>
      </section>
    </div>
  );
}
