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
import type { AppEvent, CostData, ToastMessage, Theme, ToolUseData, PersistedEvent, ConversationSearchResult } from "./types";
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
    stopStreaming,
    toolEntries,
    stats,
  } = useEventStore();

  const [totalCost, setTotalCost] = useState<CostData>(EMPTY_COST);
  const [memoryLines, setMemoryLines] = useState<string[]>([]);
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("claude-desktop-theme");
    return (saved === "light" || saved === "dark") ? saved : "dark";
  });
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

  // Toolbar tools toggle
  const [showTools, setShowTools] = useState(false);

  // Env / Status
  const [envWarning, setEnvWarning] = useState<string | null>(null);
  const [compactWarningDismissed, setCompactWarningDismissed] = useState(false);

  // Model selector
  const [showModelSelector, setShowModelSelector] = useState(false);

  // Search
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ConversationSearchResult[]>([]);

  // System prompt
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState("");

  // Export
  const [showExportMenu, setShowExportMenu] = useState(false);

  // Available models
  const AVAILABLE_MODELS = [
    "deepseek-chat",
    "deepseek-coder",
    "deepseek-reasoner",
    "claude-sonnet-4-20250514",
    "claude-3-5-haiku-20241022",
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4-turbo",
  ];

  // ═══════ Theme (with persistence) ═══════

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("claude-desktop-theme", theme);
  }, [theme]);

  // ═══════ Boot ═══════

  useEffect(() => {
    checkEnvVars();
    startSession();
    loadDashboardData();

    const unlistenAppEvent = listen<AppEvent>("app-event", (event) => {
      processEvent(event.payload);
    });

    const costInterval = setInterval(loadCost, 10000);

    return () => {
      unlistenAppEvent.then((f) => f());
      clearInterval(costInterval);
    };
  }, []);

  // ═══════ Keyboard Shortcuts ═══════

  useEffect(() => {
    const handleKeyboard = (e: KeyboardEvent) => {
      // Ctrl+N: New chat
      if (e.ctrlKey && e.key === "n") {
        e.preventDefault();
        handleRestart();
      }
      // Ctrl+Shift+S: Search conversations
      if (e.ctrlKey && e.shiftKey && e.key === "S") {
        e.preventDefault();
        setShowSearch((s) => !s);
      }
      // Ctrl+Shift+E: Export
      if (e.ctrlKey && e.shiftKey && e.key === "E") {
        e.preventDefault();
        setShowExportMenu((s) => !s);
      }
      // Ctrl+,: System prompt settings
      if (e.ctrlKey && e.key === ",") {
        e.preventDefault();
        handleOpenSystemPrompt();
      }
      // Ctrl+Shift+M: Model selector
      if (e.ctrlKey && e.shiftKey && e.key === "M") {
        e.preventDefault();
        setShowModelSelector((s) => !s);
      }
      // Escape: Close modals
      if (e.key === "Escape") {
        setShowSearch(false);
        setShowModelSelector(false);
        setShowSystemPrompt(false);
        setShowExportMenu(false);
        setShowProjectDropdown(false);
      }
    };

    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, []);

  // ═══════ Toast ═══════

  const toastCounter = useState(() => ({ current: 0 }))[0];
  const addToast = useCallback(
    (text: string, type: ToastMessage["type"] = "info") => {
      toastCounter.current += 1;
      setToasts((prev) => [...prev, { id: toastCounter.current, text, type }]);
    },
    [toastCounter]
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

  const handleSendWithFiles = async (input: string, files: File[]) => {
    let message = input;
    if (files.length > 0) {
      const fileContents: string[] = [];
      for (const file of files) {
        if (file.type.startsWith("image/")) {
          fileContents.push(`[Image: ${file.name} (${(file.size / 1024).toFixed(1)}KB)]`);
        } else {
          const text = await file.text();
          fileContents.push(`--- File: ${file.name} ---\n${text}\n--- End: ${file.name} ---`);
        }
      }
      message = `${input}\n\n${fileContents.join("\n\n")}`;
    }
    addUserMessage(message);
    try {
      await invoke("send_input", { message });
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

  // ═══════ Stop Generation ═══════

  const handleStopGeneration = async () => {
    try {
      await invoke("stop_generation");
      stopStreaming();
      addToast("Generation stopped", "info");
    } catch (e) {
      addToast(`Stop failed: ${e}`, "error");
    }
  };

  // ═══════ Model Selector ═══════

  const handleSwitchModel = async (model: string) => {
    try {
      await invoke("set_model", { model });
      addToast(`Switched to ${model}`, "success");
      setShowModelSelector(false);
    } catch (e) {
      addToast(`Model switch failed: ${e}`, "error");
    }
  };

  // ═══════ System Prompt ═══════

  const handleOpenSystemPrompt = async () => {
    try {
      const prompt = await invoke<string>("get_system_prompt");
      setSystemPrompt(prompt);
    } catch (_) {
      setSystemPrompt("You are a helpful assistant.");
    }
    setShowSystemPrompt(true);
  };

  const handleSaveSystemPrompt = async () => {
    try {
      await invoke("set_system_prompt", { prompt: systemPrompt });
      addToast("System prompt updated", "success");
      setShowSystemPrompt(false);
    } catch (e) {
      addToast(`Failed: ${e}`, "error");
    }
  };

  // ═══════ Search ═══════

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    try {
      const results = await invoke<ConversationSearchResult[]>("search_conversations", {
        query: searchQuery,
      });
      setSearchResults(results);
    } catch (e) {
      addToast(`Search failed: ${e}`, "error");
    }
  };

  // ═══════ Export ═══════

  const handleExport = async (format: string) => {
    try {
      const content = await invoke<string>("export_conversation", { format });
      const blob = new Blob([content], { type: format === "json" ? "application/json" : "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `conversation.${format === "json" ? "json" : "md"}`;
      a.click();
      URL.revokeObjectURL(url);
      addToast(`Exported as ${format}`, "success");
      setShowExportMenu(false);
    } catch (e) {
      addToast(`Export failed: ${e}`, "error");
    }
  };

  // ═══════ Message Edit & Regenerate ═══════

  const handleEditMessage = async (_entryId: string, newContent: string) => {
    addUserMessage(newContent);
    try {
      await invoke("send_input", { message: newContent });
    } catch (e) {
      addToast(`Error: ${e}`, "error");
    }
  };

  const handleRegenerateMessage = async (_entryId: string) => {
    const lastUserMsg = state.timeline
      .filter((e) => e.kind === "user_message")
      .pop();
    if (lastUserMsg) {
      const content = (lastUserMsg.data as { kind: string; content: string }).content;
      addUserMessage(content);
      try {
        await invoke("send_input", { message: content });
      } catch (e) {
        addToast(`Error: ${e}`, "error");
      }
    }
  };

  // ═══════ Approval Handlers ═══════

  const handleApprove = () => {
    resolveApproval("approved");
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

          {/* Model Selector */}
          <div className="model-selector-wrapper">
            <button
              className="model-indicator model-selector-btn"
              onClick={() => setShowModelSelector((s) => !s)}
              title={`Model: ${state.sessionModel} (click to switch)`}
            >
              {state.sessionModel} &#9662;
            </button>
            {showModelSelector && (
              <div className="model-dropdown">
                {AVAILABLE_MODELS.map((m) => (
                  <button
                    key={m}
                    className={`model-dropdown-item ${m === state.sessionModel ? "active" : ""}`}
                    onClick={() => handleSwitchModel(m)}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
          </div>

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

          {/* Search button */}
          <button
            className="toolbar-btn"
            onClick={() => setShowSearch((s) => !s)}
            title="Search conversations (Ctrl+Shift+S)"
          >
            &#128269;
          </button>

          {/* Export button */}
          <div className="export-wrapper">
            <button
              className="toolbar-btn"
              onClick={() => setShowExportMenu((s) => !s)}
              title="Export conversation (Ctrl+Shift+E)"
            >
              &#128190;
            </button>
            {showExportMenu && (
              <div className="export-dropdown">
                <button className="export-dropdown-item" onClick={() => handleExport("markdown")}>
                  Export as Markdown
                </button>
                <button className="export-dropdown-item" onClick={() => handleExport("json")}>
                  Export as JSON
                </button>
              </div>
            )}
          </div>

          <button
            className="toolbar-btn tools-toggle-btn"
            onClick={() => setShowTools((s) => !s)}
            title={showTools ? "Hide tools" : "Show tools"}
          >
            &#9776;
          </button>

          {showTools && (
            <div className="toolbar-tools">
              <button className="toolbar-btn" onClick={handleSaveMemory} title="Save memory">
                &#128190; Memory
              </button>
              <button
                className={`toolbar-btn ${showCompactWarning ? "compact-warning" : ""}`}
                onClick={handleCompact}
                title={showCompactWarning ? "Context getting full" : "Compact context"}
              >
                &#128230; Compact
                {showCompactWarning && <span className="compact-badge" />}
              </button>
              <button className="toolbar-btn" onClick={() => setShowBrainPanel(true)} title="Workspace intelligence">
                &#129504; Brain
              </button>
              <button className="toolbar-btn" onClick={() => setShowGraphPanel(true)} title="Visual memory graphs">
                &#128200; Graphs
              </button>
              <button className="toolbar-btn" onClick={() => setShowTokenPanel(true)} title="Token optimization">
                &#127919; Tokens
              </button>
              <button className="toolbar-btn" onClick={() => setShowAgentPanel(true)} title="Multi-agent workflows">
                &#129302; Agents
              </button>
              <button className="toolbar-btn" onClick={handleOpenSystemPrompt} title="Custom instructions (Ctrl+,)">
                &#9881; Prompt
              </button>
            </div>
          )}

          <button
            className="toolbar-btn restart-btn"
            onClick={handleRestart}
            title="New chat (Ctrl+N)"
          >
            &#8634;
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

        {/* Search overlay */}
        {showSearch && (
          <div className="search-overlay">
            <div className="search-panel">
              <div className="search-header">
                <input
                  className="search-input"
                  type="text"
                  placeholder="Search conversations..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  autoFocus
                />
                <button className="search-btn" onClick={handleSearch}>Search</button>
                <button className="search-close" onClick={() => setShowSearch(false)}>&times;</button>
              </div>
              {searchResults.length > 0 && (
                <div className="search-results">
                  {searchResults.map((r, i) => (
                    <div key={i} className="search-result-item">
                      <span className="search-result-role">{r.role}</span>
                      <span className="search-result-session">{r.session_id}</span>
                      <p className="search-result-snippet">{r.snippet}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* System Prompt Modal */}
        {showSystemPrompt && (
          <div className="modal-overlay" onClick={() => setShowSystemPrompt(false)}>
            <div className="system-prompt-modal" onClick={(e) => e.stopPropagation()}>
              <h3>Custom Instructions</h3>
              <p className="system-prompt-desc">Set a system prompt to customize how the assistant behaves.</p>
              <textarea
                className="system-prompt-textarea"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={8}
                placeholder="You are a helpful assistant..."
              />
              <div className="system-prompt-actions">
                <button className="system-prompt-save" onClick={handleSaveSystemPrompt}>
                  Save
                </button>
                <button className="system-prompt-cancel" onClick={() => setShowSystemPrompt(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Timeline — replaces ChatPane messages */}
        <TimelineView
          entries={state.timeline}
          isTyping={state.isTyping}
          isStreaming={state.isStreaming}
          streamingText={state.streamingText}
          onViewToolDetail={(tool) => setViewingTool(tool)}
          onStopGeneration={handleStopGeneration}
          onEditMessage={handleEditMessage}
          onRegenerateMessage={handleRegenerateMessage}
        />

        {/* Input */}
        <InputBar
          slashCommands={SLASH_COMMANDS}
          onSend={handleSend}
          onSendWithFiles={handleSendWithFiles}
          isStreaming={state.isStreaming}
          onStopGeneration={handleStopGeneration}
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
