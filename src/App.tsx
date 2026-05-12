import { useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent as ReactClipboardEvent, CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  CirclePlus,
  GripVertical,
  Play,
  Settings,
  Trash2,
  X,
  FileCog,
  ScrollText,
  Minus,
  Plus,
  RotateCcw,
  Square,
  ExternalLink,
  Copy,
  Server,
  SlidersHorizontal
} from "lucide-react";
import { AddScriptsDialog } from "./components/AddScriptsDialog";
import { ConnectionSettings } from "./components/ConnectionSettings";
import { Modal } from "./components/Modal";
import { ScriptManager } from "./components/ScriptManager";
import { ScriptSettings } from "./components/ScriptSettings";
import { WorkspaceParameters } from "./components/WorkspaceParameters";
import { createDefaultAppData, createWorkspace, DEFAULT_SCRIPT_TAG, MAX_LOGS_PER_WORKSPACE } from "./lib/appData";
import {
  saveAppData,
  loadAppData,
  runScript,
  saveGlobalScript,
  deleteGlobalScript,
  readGlobalScriptContent,
  saveConnection,
  testConnection,
  logSystemEvent,
  getRuntimeInfo,
  openWorkingDataDir,
  getMcpServerStatus,
  startMcpServer,
  stopMcpServer,
  cancelScript,
  drainScriptEvents
} from "./lib/backend";
import { createId, nowIso } from "./lib/ids";
import { ensureWorkspaceParameterSettings, syncAllWorkspaceParameterSettings } from "./lib/workspaceParameters";
import type { McpServerStatus } from "./lib/backend";
import type { AppData, AttachedScript, GlobalScript, LogEntry, LogLevel, ScriptExecutionEvent, WorkspaceTab } from "./lib/types";

type ModalState =
  | { kind: "none" }
  | { kind: "connection" }
  | { kind: "scripts" }
  | { kind: "workspaceParameters" }
  | { kind: "addScripts" }
  | { kind: "scriptSettings"; attachedScriptId: string };

type RunningExecution = {
  executionId: string;
  workspaceId: string;
  attachedScriptId: string;
  scriptName: string;
};

type QueuedScript = {
  workspaceId: string;
  attachedScriptId: string;
};

type DropPosition = "before" | "after";

const LOG_LEVELS: LogLevel[] = ["info", "warn", "error", "stdout", "stderr"];

function createDefaultLogLevelFilter(): Record<LogLevel, boolean> {
  return {
    info: true,
    warn: true,
    error: true,
    stdout: true,
    stderr: true
  };
}

function filterLogsByLevel(logs: LogEntry[], filter: Record<LogLevel, boolean>) {
  return logs.filter((log) => filter[log.level]);
}

export function App() {
  const params = new globalThis.URLSearchParams(window.location.search);
  if (params.get("view") === "script-log") {
    return <ScriptLogWindow params={params} />;
  }
  return <MainApp />;
}

function logsToClipboardText(logs: LogEntry[]) {
  return logs.map((log) => log.message).join("\n");
}

function copySelectedLogs(event: ReactClipboardEvent<HTMLDivElement>) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return;
  }

  const text = getSelectedLogMessageText(event.currentTarget, selection).trimEnd();
  if (!text) {
    return;
  }

  event.preventDefault();
  event.clipboardData.setData("text/plain", text);
}

function getSelectedLogMessageText(container: HTMLElement, selection: globalThis.Selection) {
  const selectedLines: string[] = [];
  const messageNodes = Array.from(container.querySelectorAll<HTMLElement>("[data-log-message]"));

  for (const messageNode of messageNodes) {
    const selectedText = getSelectedTextFromNode(messageNode, selection);
    if (selectedText) {
      selectedLines.push(selectedText);
    }
  }

  return selectedLines.join("\n");
}

function getSelectedTextFromNode(node: HTMLElement, selection: globalThis.Selection) {
  const selectedParts: string[] = [];
  const nodeRange = document.createRange();
  nodeRange.selectNodeContents(node);

  for (let index = 0; index < selection.rangeCount; index += 1) {
    const selectionRange = selection.getRangeAt(index);
    if (!selectionRange.intersectsNode(node)) {
      continue;
    }

    const intersection = selectionRange.cloneRange();
    if (intersection.compareBoundaryPoints(globalThis.Range.START_TO_START, nodeRange) < 0) {
      intersection.setStart(nodeRange.startContainer, nodeRange.startOffset);
    }
    if (intersection.compareBoundaryPoints(globalThis.Range.END_TO_END, nodeRange) > 0) {
      intersection.setEnd(nodeRange.endContainer, nodeRange.endOffset);
    }
    selectedParts.push(intersection.toString());
  }

  nodeRange.detach();
  return selectedParts.join("");
}

async function copyTextToClipboard(text: string) {
  const value = text.trimEnd();
  if (!value) {
    return;
  }

  if (globalThis.navigator.clipboard?.writeText) {
    await globalThis.navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!copied) {
    throw new Error("Clipboard API is unavailable.");
  }
}

function MainApp() {
  const [data, setData] = useState<AppData>(createDefaultAppData);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [modal, setModal] = useState<ModalState>({ kind: "none" });
  const [error, setError] = useState("");
  const [runningExecution, setRunningExecution] = useState<RunningExecution | null>(null);
  const [queuedScripts, setQueuedScripts] = useState<QueuedScript[]>([]);
  const [draggingAttachedId, setDraggingAttachedId] = useState<string | null>(null);
  const [dragOverAttachedId, setDragOverAttachedId] = useState<string | null>(null);
  const [dragOverPosition, setDragOverPosition] = useState<DropPosition | null>(null);
  const [stoppingScriptId, setStoppingScriptId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [logsPanelHeight, setLogsPanelHeight] = useState(260);
  const [logsAutoscroll, setLogsAutoscroll] = useState(true);
  const [logLevelFilter, setLogLevelFilter] = useState<Record<LogLevel, boolean>>(createDefaultLogLevelFilter);
  const [mcpServerStatus, setMcpServerStatus] = useState<McpServerStatus>({ running: false });
  const [mcpServerBusy, setMcpServerBusy] = useState(false);
  const [runtimePath, setRuntimePath] = useState("");
  const [systemLogPath, setSystemLogPath] = useState("");
  const [scriptsDir, setScriptsDir] = useState("");
  const mainPaneRef = useRef<HTMLElement | null>(null);
  const logsListRef = useRef<HTMLDivElement | null>(null);
  const selectedMcpCheckboxRef = useRef<globalThis.HTMLInputElement | null>(null);
  const streamBuffersRef = useRef<Record<string, string>>({});
  const scriptDragRef = useRef<{ attachedId: string; pointerId: number } | null>(null);

  useEffect(() => {
    getRuntimeInfo()
      .then((info) => {
        setRuntimePath(info.workingDataDir);
        setSystemLogPath(info.systemLogPath);
        setScriptsDir(info.scriptsDir);
      })
      .catch((reason) => {
        const message = String(reason);
        setError(message);
        void logSystemEvent({ level: "error", target: "frontend", message: "Failed to read runtime info.", details: message });
      });
    loadAppData()
      .then((loadedData) => {
        setData(syncAllWorkspaceParameterSettings(loadedData));
        setDataLoaded(true);
      })
      .catch((reason) => {
        const message = String(reason);
        setError(message);
        setDataLoaded(true);
        void logSystemEvent({ level: "error", target: "frontend", message: "Failed to load app data.", details: message });
      });
  }, []);

  useEffect(() => {
    getMcpServerStatus()
      .then(setMcpServerStatus)
      .catch((reason) => {
        const message = String(reason);
        setError(`MCP status error: ${message}`);
        void logSystemEvent({ level: "error", target: "frontend", message: "Failed to read MCP server status.", details: message });
      });
  }, []);

  useEffect(() => {
    if (!dataLoaded) {
      return;
    }
    saveAppData(data).catch((reason) => {
      const message = String(reason);
      setError(`Storage error: ${message}`);
      void logSystemEvent({ level: "error", target: "frontend", message: "Failed to save app data.", details: message });
    });
  }, [data, dataLoaded]);

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

  useEffect(() => {
    if (runningExecution || queuedScripts.length === 0) {
      return;
    }
    const [nextScript, ...remaining] = queuedScripts;
    setQueuedScripts(remaining);
    void executeQueuedScript(nextScript);
    // Queue execution intentionally reacts to the current data snapshot after the previous run ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningExecution, queuedScripts, data]);

  const activeWorkspace = useMemo(
    () => data.workspaces.find((workspace) => workspace.id === data.activeTabId) ?? data.workspaces[0],
    [data.activeTabId, data.workspaces]
  );
  const workspaceTabTitle = (workspace: WorkspaceTab) => workspace.connection.name.trim() || workspace.title || "New Workspace";
  const connectionTitle = activeWorkspace.connection.name.trim() || activeWorkspace.connection.host || "No connection configured";
  const connectionSubtitle = activeWorkspace.connection.host
    ? `${activeWorkspace.connection.username}@${activeWorkspace.connection.host}:${activeWorkspace.connection.port}`
    : "No host configured";
  const visibleLogs = useMemo(() => filterLogsByLevel(activeWorkspace?.logs ?? [], logLevelFilter), [activeWorkspace?.logs, logLevelFilter]);
  const latestLogId = activeWorkspace?.logs.at(-1)?.id;
  const selectedAttachedScripts = useMemo(
    () => activeWorkspace?.attachedScripts.filter((attached) => attached.selected) ?? [],
    [activeWorkspace?.attachedScripts]
  );
  const selectedScriptsUseInMcp =
    selectedAttachedScripts.length > 0 && selectedAttachedScripts.every((attached) => attached.useInMcp);
  const selectedScriptsMcpMixed =
    selectedAttachedScripts.some((attached) => attached.useInMcp) && selectedAttachedScripts.some((attached) => !attached.useInMcp);

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

  useEffect(() => {
    if (selectedMcpCheckboxRef.current) {
      selectedMcpCheckboxRef.current.indeterminate = selectedScriptsMcpMixed;
    }
  }, [selectedScriptsMcpMixed]);

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

  function reorderAttachedScript(draggedId: string, targetId: string, position: DropPosition) {
    if (draggedId === targetId || runningExecution) {
      return;
    }
    updateActiveWorkspace((workspace) => {
      const fromIndex = workspace.attachedScripts.findIndex((attached) => attached.id === draggedId);
      const toIndex = workspace.attachedScripts.findIndex((attached) => attached.id === targetId);
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
        return workspace;
      }
      const attachedScripts = [...workspace.attachedScripts];
      const [moved] = attachedScripts.splice(fromIndex, 1);
      const rawInsertIndex = position === "after" ? toIndex + 1 : toIndex;
      const insertIndex = fromIndex < rawInsertIndex ? rawInsertIndex - 1 : rawInsertIndex;
      attachedScripts.splice(Math.max(0, Math.min(insertIndex, attachedScripts.length)), 0, moved);
      return { ...workspace, attachedScripts };
    });
  }

  function toggleSelectedScriptsMcp(nextUseInMcp: boolean) {
    const selectedIds = activeWorkspace.attachedScripts.filter((attached) => attached.selected).map((attached) => attached.id);
    if (selectedIds.length === 0) {
      return;
    }
    if (
      nextUseInMcp &&
      !confirm("Use in MCP allows an LLM client to execute selected scripts on the configured SSH server. Enable only for scripts you trust.")
    ) {
      return;
    }

    const selectedIdSet = new Set(selectedIds);
    updateActiveWorkspace((workspace) => ({
      ...workspace,
      attachedScripts: workspace.attachedScripts.map((attached) =>
        selectedIdSet.has(attached.id) ? { ...attached, useInMcp: nextUseInMcp } : attached
      )
    }));
  }

  function getScriptRowAtPoint(clientX: number, clientY: number) {
    return document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-attached-script-id]") ?? null;
  }

  function getDropPosition(row: HTMLElement, clientY: number): DropPosition {
    const rect = row.getBoundingClientRect();
    return clientY < rect.top + rect.height / 2 ? "before" : "after";
  }

  function resetScriptDrag() {
    scriptDragRef.current = null;
    setDraggingAttachedId(null);
    setDragOverAttachedId(null);
    setDragOverPosition(null);
  }

  function startScriptDrag(event: ReactPointerEvent<HTMLDivElement>, attachedId: string) {
    if (runningExecution || event.button !== 0) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    scriptDragRef.current = { attachedId, pointerId: event.pointerId };
    setDraggingAttachedId(attachedId);
    setDragOverAttachedId(null);
    setDragOverPosition(null);
  }

  function moveScriptDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const activeDrag = scriptDragRef.current;
    if (!activeDrag || activeDrag.pointerId !== event.pointerId || runningExecution) {
      return;
    }
    event.preventDefault();
    const row = getScriptRowAtPoint(event.clientX, event.clientY);
    const targetId = row?.dataset.attachedScriptId;
    if (!row || !targetId || targetId === activeDrag.attachedId) {
      setDragOverAttachedId(null);
      setDragOverPosition(null);
      return;
    }
    setDragOverAttachedId(targetId);
    setDragOverPosition(getDropPosition(row, event.clientY));
  }

  function endScriptDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const activeDrag = scriptDragRef.current;
    if (!activeDrag || activeDrag.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const row = getScriptRowAtPoint(event.clientX, event.clientY);
    const targetId = row?.dataset.attachedScriptId;
    if (row && targetId && targetId !== activeDrag.attachedId) {
      reorderAttachedScript(activeDrag.attachedId, targetId, getDropPosition(row, event.clientY));
    }
    resetScriptDrag();
  }

  function clampLogsPanelHeight(nextHeight: number) {
    const mainPane = mainPaneRef.current;
    const mainPaneHeight = mainPane?.getBoundingClientRect().height ?? window.innerHeight;
    const toolbarHeight = mainPane?.querySelector(".toolbar")?.getBoundingClientRect().height ?? 0;
    const resizeHandleHeight = 8;
    const minScriptsPanelHeight = 96;
    const minLogsPanelHeight = 96;
    const maxHeight = Math.max(minLogsPanelHeight, mainPaneHeight - toolbarHeight - resizeHandleHeight - minScriptsPanelHeight);
    return Math.min(Math.max(nextHeight, minLogsPanelHeight), maxHeight);
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

  async function copyMainLogs() {
    try {
      await copyTextToClipboard(logsToClipboardText(visibleLogs));
    } catch (reason) {
      const message = String(reason);
      setError(`Copy error: ${message}`);
      void logSystemEvent({ level: "error", target: "frontend", message: "Failed to copy logs.", details: message });
    }
  }

  function toggleMainLogLevel(level: LogLevel, checked: boolean) {
    setLogLevelFilter((current) => ({ ...current, [level]: checked }));
  }

  function scriptDisplayName(script: GlobalScript | undefined, attached: AttachedScript) {
    const tag = attached.tag?.trim() || DEFAULT_SCRIPT_TAG;
    return `${script?.name ?? "Missing global script"} (${tag})`;
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

  async function toggleMcpServer() {
    if (mcpServerBusy) {
      return;
    }
    setMcpServerBusy(true);
    try {
      const nextStatus = mcpServerStatus.running ? await stopMcpServer() : await startMcpServer();
      setMcpServerStatus(nextStatus);
      void logSystemEvent({
        level: "info",
        target: "frontend",
        message: nextStatus.running ? "MCP server enabled from UI." : "MCP server disabled from UI.",
        details: nextStatus.url
      });
    } catch (reason) {
      const message = String(reason);
      setError(`MCP server error: ${message}`);
      void logSystemEvent({ level: "error", target: "frontend", message: "Failed to toggle MCP server.", details: message });
    } finally {
      setMcpServerBusy(false);
    }
  }

  async function persistGlobalScript(script: GlobalScript) {
    setBusy(true);
    try {
      const nextData = await saveGlobalScript(script);
      setData(syncAllWorkspaceParameterSettings(nextData));
    } catch (reason) {
      const message = String(reason);
      setError(message);
      void logSystemEvent({ level: "error", target: "frontend", message: "Failed to save script.", details: message });
      throw reason;
    } finally {
      setBusy(false);
    }
  }

  async function removeGlobalScript(scriptId: string) {
    setBusy(true);
    try {
      const nextData = await deleteGlobalScript(scriptId);
      setData(syncAllWorkspaceParameterSettings(nextData));
    } catch (reason) {
      const message = String(reason);
      setError(message);
      void logSystemEvent({ level: "error", target: "frontend", message: "Failed to delete script.", details: message });
      throw reason;
    } finally {
      setBusy(false);
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

  async function execute(workspace: WorkspaceTab, attached: AttachedScript, script: GlobalScript | undefined) {
    if (!script || runningExecution) {
      return false;
    }

    const executionId = createId("execution");
    const execution: RunningExecution = {
      executionId,
      workspaceId: workspace.id,
      attachedScriptId: attached.id,
      scriptName: scriptDisplayName(script, attached)
    };
    setRunningExecution(execution);
    delete streamBuffersRef.current[`${workspace.id}:${attached.id}:stdout`];
    delete streamBuffersRef.current[`${workspace.id}:${attached.id}:stderr`];
    appendLog(workspace.id, {
      level: "info",
      message: `starting ${scriptDisplayName(script, attached)}`,
      scriptId: attached.id,
      status: "starting"
    });

    try {
      await runScript({ executionId, workspaceId: workspace.id, attachedScriptId: attached.id });
      return true;
    } catch (reason) {
      flushStreamBuffer(workspace.id, attached.id, "stdout", "failed");
      flushStreamBuffer(workspace.id, attached.id, "stderr", "failed");
      setRunningExecution(null);
      void logSystemEvent({
        level: "error",
        target: "frontend",
        message: "Script execution failed in UI flow.",
        details: String(reason)
      });
      appendLog(workspace.id, {
        level: "error",
        message: String(reason),
        scriptId: attached.id,
        status: "failed"
      });
      setStoppingScriptId(null);
      return false;
    }
  }

  async function executeQueuedScript(item: QueuedScript) {
    const workspace = data.workspaces.find((candidate) => candidate.id === item.workspaceId);
    const attached = workspace?.attachedScripts.find((candidate) => candidate.id === item.attachedScriptId);
    const script = data.globalScripts.find((candidate) => candidate.id === attached?.globalScriptId);
    if (!workspace || !attached || !script) {
      if (workspace) {
        appendLog(workspace.id, {
          level: "error",
          message: "Queued script could not be started because its attachment or global script is missing.",
          scriptId: item.attachedScriptId,
          status: "failed"
        });
      }
      return false;
    }
    return execute(workspace, attached, script);
  }

  function runSelectedScriptsSequentially() {
    if (runningExecution) {
      return;
    }
    const selected = activeWorkspace.attachedScripts
      .filter((attached) => attached.selected)
      .map((attached) => ({ workspaceId: activeWorkspace.id, attachedScriptId: attached.id }));
    if (selected.length === 0) {
      return;
    }
    setQueuedScripts(selected);
  }

  async function stopExecution(attached: AttachedScript) {
    if (runningExecution?.attachedScriptId !== attached.id || stoppingScriptId === attached.id) {
      return;
    }

    setQueuedScripts([]);
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
    const displayName = scriptDisplayName(script, attached);
    const params = new globalThis.URLSearchParams({
      view: "script-log",
      executionId,
      workspaceId: activeWorkspace.id,
      attachedScriptId: attached.id,
      scriptName: displayName,
      workspaceTitle: activeWorkspace.title
    });
    const label = `script_logs_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const logWindow = new WebviewWindow(label, {
      url: `index.html?${params.toString()}`,
      title: `${displayName} logs`,
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
      if (status === "cancelled") {
        setQueuedScripts([]);
      }
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
            <span>{workspaceTabTitle(workspace)}</span>
            <span
              role="button"
              tabIndex={0}
              aria-label={`Close tab ${workspaceTabTitle(workspace)}`}
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
        <div className="tabStripActions">
          <button type="button" className="newTabButton" onClick={addTab} aria-label="Add tab" title="Add">
            <CirclePlus size={17} /> Add
          </button>
          <button
            type="button"
            className="mcpToggle"
            onClick={() => void toggleMcpServer()}
            disabled={mcpServerBusy}
            title={mcpServerStatus.running ? `MCP server is running\n${mcpServerStatus.url}` : "Start MCP server"}
            aria-label={mcpServerStatus.running ? "Stop MCP server" : "Start MCP server"}
            aria-pressed={mcpServerStatus.running}
          >
            <Server size={17} /> MCP
          </button>
        </div>
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
          <button type="button" onClick={() => setModal({ kind: "workspaceParameters" })}>
            <SlidersHorizontal size={17} /> Workspace Parameters
          </button>
          <button type="button" onClick={() => setModal({ kind: "scripts" })}>
            <FileCog size={17} /> Script Manager
          </button>
          {runtimePath && (
            <button
              type="button"
              className="runtimePath"
              title={`Open working directory\n${runtimePath}\nScripts: ${scriptsDir}\nSystem log: ${systemLogPath}`}
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
            <h1>{connectionTitle}</h1>
            <span>{connectionSubtitle}</span>
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
                <article
                  className={`scriptRow ${attached.selected ? "selected" : ""} ${draggingAttachedId === attached.id ? "dragging" : ""} ${dragOverAttachedId === attached.id ? `dropTarget drop-${dragOverPosition}` : ""}`}
                  key={attached.id}
                  data-attached-script-id={attached.id}
                >
                  <div
                    className="dragHandle"
                    title={isAnyScriptRunning ? "Reordering is disabled while a script is running" : "Drag to reorder"}
                    aria-label={`Drag ${scriptDisplayName(script, attached)} to reorder`}
                    aria-disabled={isAnyScriptRunning}
                    onPointerDown={(event) => startScriptDrag(event, attached.id)}
                    onPointerMove={moveScriptDrag}
                    onPointerUp={endScriptDrag}
                    onPointerCancel={resetScriptDrag}
                  >
                    <GripVertical size={16} />
                  </div>
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
                    <strong>{scriptDisplayName(script, attached)}</strong>
                  </div>
                  <div className="rowActions">
                    {attached.useInMcp && (
                      <span className="mcpBadge" title="Use in MCP enabled">
                        MCP
                      </span>
                    )}
                    <button
                      type="button"
                      title="Script settings"
                      aria-label={`Settings for ${scriptDisplayName(script, attached)}`}
                      disabled={!script}
                      onClick={() => setModal({ kind: "scriptSettings", attachedScriptId: attached.id })}
                    >
                      <Settings size={16} />
                    </button>
                    <button
                      type="button"
                      className="primaryButton"
                      title={isRunning ? "Running" : isBlockedByAnotherScript ? "Blocked while another script is running" : "Run"}
                      aria-label={`Run ${scriptDisplayName(script, attached)}`}
                      disabled={!script || isAnyScriptRunning}
                      onClick={() => {
                        void execute(activeWorkspace, attached, script);
                      }}
                    >
                      <Play size={16} />
                    </button>
                    {isRunning && (
                      <button
                        type="button"
                        className="dangerButton"
                        title={isStopping ? "Stopping" : "Stop"}
                        aria-label={`Stop ${scriptDisplayName(script, attached)}`}
                        disabled={isStopping}
                        onClick={() => stopExecution(attached)}
                      >
                        <Square size={15} />
                      </button>
                    )}
                    <button
                      type="button"
                      title="Run in new window"
                      aria-label={`Open ${scriptDisplayName(script, attached)} in a new log window`}
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
            <button
              type="button"
              className="primaryButton"
              title="Run selected scripts sequentially"
              aria-label="Run selected scripts sequentially"
              disabled={Boolean(runningExecution) || activeWorkspace.attachedScripts.every((attached) => !attached.selected)}
              onClick={runSelectedScriptsSequentially}
            >
              <Play size={17} /> Play
            </button>
            <label
              className={`mcpSelectionToggle ${selectedAttachedScripts.length === 0 ? "disabled" : ""}`}
              title={selectedAttachedScripts.length === 0 ? "Select scripts to change MCP access" : "Toggle MCP access for selected scripts"}
            >
              <input
                ref={selectedMcpCheckboxRef}
                type="checkbox"
                checked={selectedScriptsUseInMcp}
                disabled={selectedAttachedScripts.length === 0}
                onChange={(event) => toggleSelectedScriptsMcp(event.target.checked)}
              />
              <span>MCP</span>
            </label>
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
                  ...ensureWorkspaceParameterSettings(
                    {
                      ...workspace,
                      attachedScripts: workspace.attachedScripts.filter((item) => !item.selected)
                    },
                    data.globalScripts
                  )
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
            <div className="logLevelFilters" aria-label="Log level filters">
              {LOG_LEVELS.map((level) => (
                <label className={`levelFilter ${level}`} key={level}>
                  <input type="checkbox" checked={logLevelFilter[level]} onChange={(event) => toggleMainLogLevel(level, event.target.checked)} />
                  <span>{level}</span>
                </label>
              ))}
            </div>
            <div className="logsHeaderActions">
              <label className="checkboxLine logAutoscrollToggle">
                <input type="checkbox" checked={logsAutoscroll} onChange={(event) => setLogsAutoscroll(event.target.checked)} />
                <span>Autoscroll</span>
              </label>
              <button type="button" title="Copy Logs" aria-label="Copy Logs" disabled={visibleLogs.length === 0} onClick={() => void copyMainLogs()}>
                <Copy size={16} /> Copy
              </button>
              <button type="button" title="Clear Logs" aria-label="Clear Logs" onClick={() => updateActiveWorkspace((workspace) => ({ ...workspace, logs: [] }))}>
                <Trash2 size={16} /> Clear
              </button>
            </div>
          </div>
          <div className="logsList" ref={logsListRef} onCopy={copySelectedLogs}>
            {activeWorkspace.logs.length === 0 && <div className="emptyState">No logs yet.</div>}
            {activeWorkspace.logs.length > 0 && visibleLogs.length === 0 && <div className="emptyState">No logs match the selected levels.</div>}
            {visibleLogs.map((log) => (
              <div className={`logLine ${log.level}`} key={log.id}>
                <time>{new Date(log.timestamp).toLocaleTimeString()}</time>
                <span>{log.level}</span>
                <p data-log-message="true">{log.message}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      {modal.kind === "connection" && (
        <Modal title="Connection Settings" onClose={() => setModal({ kind: "none" })} width="wide">
          <ConnectionSettings
            connection={activeWorkspace.connection}
            connections={data.workspaces.map((workspace) => workspace.connection)}
            busy={busy}
            onCancel={() => setModal({ kind: "none" })}
            onTest={async (connection, secrets) => {
              setBusy(true);
              try {
                const nextData = await saveConnection({ workspaceId: activeWorkspace.id, connection, secrets });
                setData(nextData);
                const message = await testConnection(activeWorkspace.id);
                appendLog(activeWorkspace.id, { level: "info", message, status: "connected" });
                return message;
              } catch (reason) {
                void logSystemEvent({
                  level: "error",
                  target: "frontend",
                  message: "Connection test failed in UI flow.",
                  details: String(reason)
                });
                appendLog(activeWorkspace.id, { level: "error", message: String(reason), status: "failed" });
                throw reason;
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
            onReadContent={readGlobalScriptContent}
            onDelete={removeGlobalScript}
            onSave={persistGlobalScript}
          />
        </Modal>
      )}

      {modal.kind === "addScripts" && (
        <Modal title="Add Scripts" onClose={() => setModal({ kind: "none" })}>
          <AddScriptsDialog
            scripts={data.globalScripts}
            attachedScripts={activeWorkspace.attachedScripts}
            onCancel={() => setModal({ kind: "none" })}
            onAdd={(scriptId, tag) => {
              updateActiveWorkspace((workspace) => ({
                ...ensureWorkspaceParameterSettings(
                  {
                    ...workspace,
                    attachedScripts: [
                      ...workspace.attachedScripts,
                      {
                        id: createId("attached"),
                        globalScriptId: scriptId,
                        tag,
                        description: "",
                        parameterSettings: {},
                        useInMcp: false
                      }
                    ]
                  },
                  data.globalScripts
                )
              }));
            }}
          />
        </Modal>
      )}

      {modal.kind === "workspaceParameters" && (
        <Modal title="Workspace Parameters" onClose={() => setModal({ kind: "none" })} width="wide">
          <WorkspaceParameters
            workspace={activeWorkspace}
            scripts={data.globalScripts}
            onCancel={() => setModal({ kind: "none" })}
            onSave={(parameterSettings) => {
              updateActiveWorkspace((workspace) => ensureWorkspaceParameterSettings({ ...workspace, parameterSettings }, data.globalScripts));
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
                workspaceParameterSettings={activeWorkspace.parameterSettings}
                workspaceAttachedScripts={activeWorkspace.attachedScripts}
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
  const [logLevelFilter, setLogLevelFilter] = useState<Record<LogLevel, boolean>>(createDefaultLogLevelFilter);
  const [error, setError] = useState("");
  const logsListRef = useRef<HTMLDivElement | null>(null);
  const logsEndRef = useRef<HTMLDivElement | null>(null);
  const streamBuffersRef = useRef<Record<string, string>>({});
  const runningRef = useRef(false);
  const executionIdRef = useRef(executionId);
  const visibleLogs = useMemo(() => filterLogsByLevel(logs, logLevelFilter), [logs, logLevelFilter]);

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

  async function copyWindowLogs() {
    try {
      await copyTextToClipboard(logsToClipboardText(visibleLogs));
    } catch (reason) {
      setError(`Copy error: ${String(reason)}`);
    }
  }

  function toggleWindowLogLevel(level: LogLevel, checked: boolean) {
    setLogLevelFilter((current) => ({ ...current, [level]: checked }));
  }

  return (
    <div className="logWindowShell">
      <header className="logWindowHeader">
        <div>
          <h1>{scriptName}</h1>
          <span>{workspaceTitle}</span>
        </div>
        <div className="logLevelFilters" aria-label="Log level filters">
          {LOG_LEVELS.map((level) => (
            <label className={`levelFilter ${level}`} key={level}>
              <input type="checkbox" checked={logLevelFilter[level]} onChange={(event) => toggleWindowLogLevel(level, event.target.checked)} />
              <span>{level}</span>
            </label>
          ))}
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
          <button type="button" title="Copy Logs" aria-label="Copy Logs" disabled={visibleLogs.length === 0} onClick={() => void copyWindowLogs()}>
            <Copy size={15} /> Copy
          </button>
          <button type="button" onClick={() => setLogs([])}>
            <Trash2 size={15} /> Clear
          </button>
        </div>
      </header>
      {error && <div className="topError logWindowError">{error}</div>}
      <section className="logsPanel logWindowLogs" aria-label="Script logs">
        <div className="logsList" ref={logsListRef} onCopy={copySelectedLogs}>
          {logs.length === 0 && <div className="emptyState">{started ? "Waiting for logs..." : "Ready to start."}</div>}
          {logs.length > 0 && visibleLogs.length === 0 && <div className="emptyState">No logs match the selected levels.</div>}
          {visibleLogs.map((log) => (
            <div className={`logLine ${log.level}`} key={log.id}>
              <time>{new Date(log.timestamp).toLocaleTimeString()}</time>
              <span>{log.level}</span>
              <p data-log-message="true">{log.message}</p>
            </div>
          ))}
          <div className="logsEndAnchor" ref={logsEndRef} />
        </div>
      </section>
    </div>
  );
}
