import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEventStore } from "./hooks/useEventStore";
import TimelineView from "./components/timeline/TimelineView";
import InputBar from "./components/InputBar";
import Dashboard from "./components/Dashboard";
import Toast from "./components/Toast";
import ApprovalModal from "./components/approvals/ApprovalModal";
import FileDiffModal from "./components/approvals/FileDiffModal";
import SessionSidebar from "./components/sessions/SessionSidebar";
import ToolDetailPanel from "./components/tools/ToolDetailPanel";
import BrainPanel from "./components/memory/BrainPanel";
import GraphPanel from "./components/graphs/GraphPanel";
import TokenPanel from "./components/optimizer/TokenPanel";
import AgentPanel from "./components/agents/AgentPanel";
import type { AppEvent, CostData, ToastMessage, Theme, ToolUseData, PersistedEvent } from "./types";
import { SLASH_COMMANDS, EMPTY_COST } from "./types";

function App() {
  const {
    state,
    processEvent,
    addUserMessage,
    clearSession,
    resolveApproval,
    closeDiff,
    replayEvents,
    toolEntries,
    stats,
  } = useEventStore();

  const [totalCost, setTotalCost] = useState<CostData>(EMPTY_COST);
  const [memoryLines, setMemoryLines] = useState<string[]>([]);
  const [theme, setTheme] = useState<Theme>("dark");
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Project Switcher
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [recentProjects, setRecentProjects] = useState<string[]>([]);
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);

  // Session sidebar
  const [showSessionSidebar, setShowSessionSidebar] = useState(false);

  // Tool detail panel
  const [viewingTool, setViewingTool] = useState<ToolUseData | null>(null);

  // Brain panel
  const [showBrainPanel, setShowBrainPanel] = useState(false);

  // Graph panel
  const [showGraphPanel, setShowGraphPanel] = useState(false);

  // Token optimizer panel
  const [showTokenPanel, setShowTokenPanel] = useState(false);

  // Agent panel
  const [showAgentPanel, setShowAgentPanel] = useState(false);

  // Env / Status
  const [envWarning, setEnvWarning] = useState<string | null>(null);
  const [compactWarningDismissed, setCompactWarningDismissed] = useState(false);

  // ═══════ Theme ═══════

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // ═══════ Boot ═══════

  useEffect(() => {
    checkEnvVars();
    startSession();
    loadDashboardData();

    const unlistenAppEvent = listen<AppEvent>("app-event", (event) => {
      processEvent(event.payload);
      // Store claude's session ID for --resume on follow-up messages
      if (event.payload.type === "session_started" && event.payload.session_id) {
        invoke("set_claude_session_id", { sessionId: event.payload.session_id }).catch(() => {});
      }
    });

    const costInterval = setInterval(loadCost, 10000);

    return () => {
      unlistenAppEvent.then((f) => f());
      clearInterval(costInterval);
    };
  }, []);

  // ═══════ Toast ═══════

  const addToast = useCallback(
    (text: string, type: ToastMessage["type"] = "info") => {
      setToasts((prev) => [...prev, { id: Date.now(), text, type }]);
    },
    []
  );

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ═══════ Env Var Check ═══════

  const checkEnvVars = async () => {
    try {
      await invoke("check_env_vars");
    } catch (e) {
      setEnvWarning(String(e));
    }
  };

  // ═══════ Session Management ═══════

  const startSession = async () => {
    try {
      await invoke("start_session");
    } catch (e) {
      addToast(`Failed to start session: ${e}`, "error");
    }
  };

  const handleRestart = async () => {
    clearSession();
    try {
      await invoke("restart_session");
      loadDashboardData();
      addToast("Session restarted", "info");
    } catch (e) {
      addToast(`Restart failed: ${e}`, "error");
    }
  };

  // ═══════ Project Switcher ═══════

  const handlePickProject = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false });
      if (selected && typeof selected === "string") {
        await switchToProject(selected);
      }
    } catch (_) {
      const path = window.prompt("Enter project directory path:");
      if (path) {
        await switchToProject(path);
      }
    }
  };

  const switchToProject = async (path: string) => {
    try {
      clearSession();
      await invoke("switch_project", { path });
      setProjectPath(path);
      setRecentProjects((prev) => {
        const filtered = prev.filter((p) => p !== path);
        return [path, ...filtered].slice(0, 5);
      });
      setShowProjectDropdown(false);
      addToast(`Switched to project: ${path.split(/[/\\]/).pop()}`, "success");
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const name = path.split(/[/\\]/).pop() || path;
        await getCurrentWindow().setTitle(`Claude Desktop — ${name}`);
      } catch (_) {}
    } catch (e) {
      addToast(`Failed to switch project: ${e}`, "error");
    }
  };

  const projectName = projectPath
    ? projectPath.split(/[/\\]/).pop() || projectPath
    : null;

  // ═══════ Dashboard Data ═══════

  const loadDashboardData = async () => {
    try {
      const data = await invoke<{ claude_md: string; memory_lines: string[] }>(
        "get_memory_data"
      );
      setMemoryLines(data.memory_lines);
    } catch (_) {}
    loadCost();
  };

  const loadCost = async () => {
    try {
      const c = await invoke<CostData>("get_token_cost");
      setTotalCost(c);
    } catch (_) {}
  };

  // ═══════ Chat Actions ═══════

  const handleSend = async (input: string) => {
    addUserMessage(input);
    try {
      await invoke("send_input", { message: input });
    } catch (e) {
      addToast(`Error: ${e}`, "error");
    }
  };

  const handleSaveMemory = async () => {
    const date = new Date().toISOString().split("T")[0];
    const entry = `[${date}] [SESSION] [SAVE]: Manual memory save triggered`;
    try {
      await invoke("save_memory", { entry });
      loadDashboardData();
      addToast("Memory saved", "success");
    } catch (_) {}
  };

  const handleCompact = async () => {
    try {
      await invoke("send_input", { message: "/compact" });
      addToast("Compact requested", "info");
      setCompactWarningDismissed(true);
    } catch (_) {}
  };

  // ═══════ Approval Handlers ═══════

  const handleApprove = () => {
    resolveApproval("approved");
    // Send approval to backend
    invoke("send_input", { message: "y" }).catch(() => {});
  };

  const handleDeny = () => {
    resolveApproval("denied");
    invoke("send_input", { message: "n" }).catch(() => {});
  };

  const handleDiffApprove = () => {
    closeDiff();
    invoke("send_input", { message: "y" }).catch(() => {});
  };

  const handleDiffDeny = () => {
    closeDiff();
    invoke("send_input", { message: "n" }).catch(() => {});
  };

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  // ═══════ Auto-Compact Warning ═══════
  const showCompactWarning =
    !compactWarningDismissed &&
    (state.timeline.length > 30 ||
      totalCost.input_tokens > 80000 ||
      state.sessionCost.input_tokens > 80000);

  return (
    <div className="app-container">
      {/* ═══════ Main Panel ═══════ */}
      <div className="chat-panel">
        {/* Env var warning banner */}
        {envWarning && (
          <div className="env-warning-banner">
            <span>&#9888; {envWarning}</span>
            <button
              className="env-warning-close"
              onClick={() => setEnvWarning(null)}
            >
              &times;
            </button>
          </div>
        )}

        {/* Toolbar */}
        <div className="toolbar">
          <button
            className="toolbar-btn sessions-btn"
            onClick={() => setShowSessionSidebar(true)}
            title="Session history"
          >
            &#9776;
          </button>
          <span
            className="model-indicator"
            title={`Session: ${state.sessionId || "none"}`}
          >
            {state.sessionModel}
          </span>

          {/* Project Switcher */}
          <div className="project-switcher">
            <button
              className="toolbar-btn project-btn"
              onClick={() => setShowProjectDropdown((s) => !s)}
              title="Switch project"
            >
              &#128193; {projectName || "No project"}
            </button>
            {showProjectDropdown && (
              <div className="project-dropdown">
                <button
                  className="project-dropdown-item pick-folder"
                  onClick={handlePickProject}
                >
                  &#128194; Browse folder...
                </button>
                {recentProjects.length > 0 && (
                  <div className="project-dropdown-divider" />
                )}
                {recentProjects.map((p) => (
                  <button
                    key={p}
                    className={`project-dropdown-item ${
                      p === projectPath ? "active" : ""
                    }`}
                    onClick={() => switchToProject(p)}
                  >
                    {p.split(/[/\\]/).pop()}
                    <span className="project-path-hint">{p}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="token-bar">
            <div className="token-progress">
              <div
                className="token-progress-fill"
                style={{
                  width: `${Math.min(
                    (state.sessionCost.cost_usd / 1) * 100,
                    100
                  )}%`,
                }}
              />
            </div>
            <span className="token-label">
              ${state.sessionCost.cost_usd.toFixed(4)}
            </span>
          </div>

          <button className="toolbar-btn" onClick={handleSaveMemory}>
            Save Memory
          </button>
          <button
            className={`toolbar-btn ${
              showCompactWarning ? "compact-warning" : ""
            }`}
            onClick={handleCompact}
            title={
              showCompactWarning
                ? "Context getting full — consider /compact"
                : "Compact context"
            }
          >
            Compact
            {showCompactWarning && <span className="compact-badge" />}
          </button>
          <button
            className="toolbar-btn"
            onClick={() => setShowBrainPanel(true)}
            title="Workspace intelligence"
          >
            Brain
          </button>
          <button
            className="toolbar-btn"
            onClick={() => setShowGraphPanel(true)}
            title="Visual memory graphs"
          >
            Graphs
          </button>
          <button
            className="toolbar-btn"
            onClick={() => setShowTokenPanel(true)}
            title="Token optimization & budgeting"
          >
            Tokens
          </button>
          <button
            className="toolbar-btn"
            onClick={() => setShowAgentPanel(true)}
            title="Multi-agent workflows & provider routing"
          >
            Agents
          </button>
          <button
            className="toolbar-btn restart-btn"
            onClick={handleRestart}
            title="Restart session"
          >
            &#8634; Restart
          </button>
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            title="Toggle theme"
          >
            {theme === "dark" ? "\u263E" : "\u2600"}
          </button>
        </div>

        {/* Auto-compact warning bar */}
        {showCompactWarning && (
          <div className="compact-warning-bar">
            <span>Context at ~80% — run /compact to save tokens</span>
            <button className="compact-now-btn" onClick={handleCompact}>
              Compact now
            </button>
            <button
              className="compact-dismiss-btn"
              onClick={() => setCompactWarningDismissed(true)}
            >
              &times;
            </button>
          </div>
        )}

        {/* Timeline — replaces ChatPane messages */}
        <TimelineView
          entries={state.timeline}
          isTyping={state.isTyping}
          onViewToolDetail={(tool) => setViewingTool(tool)}
        />

        {/* Input */}
        <InputBar
          slashCommands={SLASH_COMMANDS}
          onSend={handleSend}
        />
      </div>

      {/* ═══════ Dashboard Sidebar ═══════ */}
      <Dashboard
        sessionCost={state.sessionCost}
        totalCost={totalCost}
        memoryLines={memoryLines}
        toolEntries={toolEntries}
        stats={stats}
        projectPath={projectPath}
        projectName={projectName}
        onMemoryReload={loadDashboardData}
      />

      {/* ═══════ Modals ═══════ */}
      {state.activeApproval && state.activeApproval.status === "pending" && (
        <ApprovalModal
          approval={state.activeApproval}
          onApprove={handleApprove}
          onDeny={handleDeny}
        />
      )}

      {state.activeDiff && (
        <FileDiffModal
          filePath={state.activeDiff.filePath}
          oldContent={state.activeDiff.oldContent}
          newContent={state.activeDiff.newContent}
          onApprove={handleDiffApprove}
          onDeny={handleDiffDeny}
          onClose={closeDiff}
        />
      )}

      {/* ═══════ Session Sidebar ═══════ */}
      <SessionSidebar
        visible={showSessionSidebar}
        onClose={() => setShowSessionSidebar(false)}
        onToast={addToast}
        onRestore={(events: PersistedEvent[]) => {
          replayEvents(events.map((e) => e.event));
          addToast(`Restored ${events.length} events from session`, "success");
        }}
      />

      {/* ═══════ Tool Detail Panel ═══════ */}
      {viewingTool && (
        <ToolDetailPanel
          tool={viewingTool}
          onClose={() => setViewingTool(null)}
        />
      )}

      {/* ═══════ Brain Panel ═══════ */}
      <BrainPanel
        visible={showBrainPanel}
        onClose={() => setShowBrainPanel(false)}
        onToast={addToast}
        projectPath={projectPath}
      />

      {/* ═══════ Graph Panel ═══════ */}
      <GraphPanel
        visible={showGraphPanel}
        onClose={() => setShowGraphPanel(false)}
        onToast={addToast}
        projectPath={projectPath}
      />

      {/* ═══════ Token Panel ═══════ */}
      <TokenPanel
        visible={showTokenPanel}
        onClose={() => setShowTokenPanel(false)}
        onToast={addToast}
        projectPath={projectPath}
      />

      {/* ═══════ Agent Panel ═══════ */}
      <AgentPanel
        visible={showAgentPanel}
        onClose={() => setShowAgentPanel(false)}
        onToast={addToast}
        projectPath={projectPath}
      />

      {/* ═══════ Toasts ═══════ */}
      <Toast toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

export default App;
