import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import ChatPane from "./components/ChatPane";
import Dashboard from "./components/Dashboard";

// ═══════ Types ═══════

export interface Message {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
}

export interface ToolEvent {
  tool_use_id: string;
  tool_name: string;
  input: Record<string, unknown>;
  status: "started" | "finished" | "error";
  output?: string;
  risk_label?: string;
}

export interface CostData {
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export type Theme = "dark" | "light";

// ═══════ App Event Types (from backend) ═══════

interface SessionStartedEvent {
  type: "session_started";
  session_id: string;
  model: string;
  cwd: string;
  tools: string[];
}

interface AssistantMessageEvent {
  type: "assistant_message";
  text: string;
  model: string;
}

interface ToolStartedEvent {
  type: "tool_started";
  tool_use_id: string;
  tool_name: string;
  input: Record<string, unknown>;
}

interface ToolFinishedEvent {
  type: "tool_finished";
  tool_use_id: string;
  tool_name: string;
  output: string;
  is_error: boolean;
}

interface TokenUsageEvent {
  type: "token_usage";
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

interface StatusUpdateEvent {
  type: "status_update";
  status: string;
  detail: string;
}

interface SessionFinishedEvent {
  type: "session_finished";
  session_id: string;
  cost_usd: number;
  duration_ms: number;
  num_turns: number;
  is_error: boolean;
}

interface ErrorEvent {
  type: "error";
  message: string;
  recoverable: boolean;
}

type AppEvent =
  | SessionStartedEvent
  | AssistantMessageEvent
  | ToolStartedEvent
  | ToolFinishedEvent
  | TokenUsageEvent
  | StatusUpdateEvent
  | SessionFinishedEvent
  | ErrorEvent;

// ═══════ Constants ═══════

const SLASH_COMMANDS = [
  { cmd: "/compact", desc: "Compress context to save tokens" },
  { cmd: "/clear", desc: "Clear conversation history" },
  { cmd: "/config", desc: "View or set configuration options" },
  { cmd: "/cost", desc: "Show token usage and cost for this session" },
  { cmd: "/doctor", desc: "Check Claude Code health and connectivity" },
  { cmd: "/help", desc: "Show available commands and usage" },
  { cmd: "/init", desc: "Initialize CLAUDE.md in current project" },
  { cmd: "/login", desc: "Switch authentication or re-login" },
  { cmd: "/logout", desc: "Log out of current session" },
  { cmd: "/memory", desc: "Edit CLAUDE.md memory files" },
  { cmd: "/model", desc: "Switch model" },
  { cmd: "/permissions", desc: "View or update tool permissions" },
  { cmd: "/review", desc: "Review code changes in current project" },
  { cmd: "/status", desc: "Show current session status and model" },
  { cmd: "/vim", desc: "Toggle vim mode for input" },
];

const EMPTY_COST: CostData = { input_tokens: 0, output_tokens: 0, cost_usd: 0 };

// ═══════ App Component ═══════

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [totalCost, setTotalCost] = useState<CostData>(EMPTY_COST);
  const [sessionCost, setSessionCost] = useState<CostData>(EMPTY_COST);
  const [memoryLines, setMemoryLines] = useState<string[]>([]);
  const [currentAssistantMsg, setCurrentAssistantMsg] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [theme, setTheme] = useState<Theme>("dark");
  const [activeTools, setActiveTools] = useState<ToolEvent[]>([]);
  const [sessionModel, setSessionModel] = useState<string>("unknown");
  const [sessionId, setSessionId] = useState<string | null>(null);

  // Project Switcher
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [recentProjects, setRecentProjects] = useState<string[]>([]);
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);

  // Env / Status
  const [envWarning, setEnvWarning] = useState<string | null>(null);
  const [compactWarningDismissed, setCompactWarningDismissed] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    checkEnvVars();
    startSession();
    loadDashboardData();

    // ═══════ Unified Event Listener ═══════
    const unlistenAppEvent = listen<AppEvent>("app-event", (event) => {
      handleAppEvent(event.payload);
    });

    const costInterval = setInterval(loadCost, 10000);

    return () => {
      unlistenAppEvent.then((f) => f());
      clearInterval(costInterval);
    };
  }, []);

  // ═══════ Event Handler ═══════

  const handleAppEvent = useCallback((event: AppEvent) => {
    switch (event.type) {
      case "session_started":
        setSessionId(event.session_id);
        setSessionModel(event.model);
        setIsTyping(false);
        addMessage("system", `Session started — ${event.model} (${event.tools.length} tools available)`);
        break;

      case "assistant_message":
        setIsTyping(false);
        setCurrentAssistantMsg((prev) => {
          if (prev.trim()) {
            addMessage("assistant", prev.trim());
          }
          return "";
        });
        addMessage("assistant", event.text);
        break;

      case "tool_started":
        setActiveTools((prev) => [
          ...prev,
          {
            tool_use_id: event.tool_use_id,
            tool_name: event.tool_name,
            input: event.input,
            status: "started",
          },
        ]);
        addMessage("system", `Tool: ${event.tool_name} started`);
        break;

      case "tool_finished":
        setActiveTools((prev) =>
          prev.map((t) =>
            t.tool_use_id === event.tool_use_id
              ? { ...t, status: event.is_error ? "error" as const : "finished" as const, output: event.output }
              : t
          )
        );
        if (event.output) {
          const preview = event.output.length > 200
            ? event.output.slice(0, 200) + "..."
            : event.output;
          addMessage("system", `Tool ${event.tool_name}: ${preview}`);
        }
        break;

      case "token_usage":
        setSessionCost((prev) => ({
          input_tokens: prev.input_tokens + event.input_tokens,
          output_tokens: prev.output_tokens + event.output_tokens,
          cost_usd: prev.cost_usd + event.cost_usd,
        }));
        break;

      case "status_update":
        if (event.status === "process_exited") {
          setIsTyping(false);
          setCurrentAssistantMsg((prev) => {
            if (prev.trim()) {
              addMessage("assistant", prev.trim());
            }
            return "";
          });
        }
        addMessage("system", event.detail);
        break;

      case "session_finished":
        setIsTyping(false);
        setCurrentAssistantMsg((prev) => {
          if (prev.trim()) {
            addMessage("assistant", prev.trim());
          }
          return "";
        });
        addMessage(
          "system",
          `Session complete — ${event.num_turns} turns, $${event.cost_usd.toFixed(4)}, ${(event.duration_ms / 1000).toFixed(1)}s`
        );
        break;

      case "error":
        setIsTyping(false);
        addMessage("system", `Error: ${event.message}`);
        break;
    }
  }, []);

  // ═══════ Helpers ═══════

  const getTimestamp = () =>
    new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const addMessage = useCallback((role: Message["role"], content: string) => {
    setMessages((prev) => [
      ...prev,
      { id: Date.now() + Math.random(), role, content, timestamp: getTimestamp() },
    ]);
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
      addMessage("system", `Failed to start session: ${e}`);
    }
  };

  const handleRestart = async () => {
    setCurrentAssistantMsg("");
    setIsTyping(false);
    setSessionCost(EMPTY_COST);
    setActiveTools([]);
    try {
      await invoke("restart_session");
      loadDashboardData();
    } catch (e) {
      addMessage("system", `Restart failed: ${e}`);
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
      setCurrentAssistantMsg("");
      setIsTyping(false);
      setSessionCost(EMPTY_COST);
      setActiveTools([]);
      await invoke("switch_project", { path });
      setProjectPath(path);
      setRecentProjects((prev) => {
        const filtered = prev.filter((p) => p !== path);
        return [path, ...filtered].slice(0, 5);
      });
      setShowProjectDropdown(false);
      addMessage("system", `Switched to project: ${path}`);
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const name = path.split(/[/\\]/).pop() || path;
        await getCurrentWindow().setTitle(`Claude Desktop — ${name}`);
      } catch (_) {}
    } catch (e) {
      addMessage("system", `Failed to switch project: ${e}`);
    }
  };

  const projectName = projectPath ? projectPath.split(/[/\\]/).pop() || projectPath : null;

  // ═══════ Dashboard Data ═══════

  const loadDashboardData = async () => {
    try {
      const data = await invoke<{ claude_md: string; memory_lines: string[] }>("get_memory_data");
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
    setCurrentAssistantMsg("");
    addMessage("user", input);
    setIsTyping(true);
    try {
      await invoke("send_input", { message: input });
    } catch (e) {
      setIsTyping(false);
      addMessage("system", `Error: ${e}`);
    }
  };

  const handleSaveMemory = async () => {
    const date = new Date().toISOString().split("T")[0];
    const entry = `[${date}] [SESSION] [SAVE]: Manual memory save triggered`;
    try {
      await invoke("save_memory", { entry });
      loadDashboardData();
      addMessage("system", "Memory saved");
    } catch (_) {}
  };

  const handleCompact = async () => {
    try {
      await invoke("send_input", { message: "/compact" });
      addMessage("system", "Compact requested");
      setCompactWarningDismissed(true);
    } catch (_) {}
  };

  const toggleTheme = () => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  };

  // ═══════ Auto-Compact Warning ═══════
  const messageCount = messages.length;
  const showCompactWarning =
    !compactWarningDismissed &&
    (messageCount > 20 || totalCost.input_tokens > 80000 || sessionCost.input_tokens > 80000);

  return (
    <div className="app-container">
      <div className="chat-panel">
        {/* Env var warning banner */}
        {envWarning && (
          <div className="env-warning-banner">
            <span>
              &#9888; {envWarning}
            </span>
            <button className="env-warning-close" onClick={() => setEnvWarning(null)}>
              &times;
            </button>
          </div>
        )}

        <div className="toolbar">
          {/* Model indicator */}
          <span className="model-indicator" title={`Session: ${sessionId || "none"}`}>
            {sessionModel}
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
                <button className="project-dropdown-item pick-folder" onClick={handlePickProject}>
                  &#128194; Browse folder...
                </button>
                {recentProjects.length > 0 && <div className="project-dropdown-divider" />}
                {recentProjects.map((p) => (
                  <button
                    key={p}
                    className={`project-dropdown-item ${p === projectPath ? "active" : ""}`}
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
                style={{ width: `${Math.min((sessionCost.cost_usd / 1) * 100, 100)}%` }}
              />
            </div>
            <span className="token-label">${sessionCost.cost_usd.toFixed(4)}</span>
          </div>
          <button className="toolbar-btn" onClick={handleSaveMemory}>
            Save Memory
          </button>
          <button
            className={`toolbar-btn ${showCompactWarning ? "compact-warning" : ""}`}
            onClick={handleCompact}
            title={showCompactWarning ? "Context getting full — consider /compact" : "Compact context"}
          >
            Compact
            {showCompactWarning && <span className="compact-badge" />}
          </button>
          <button className="toolbar-btn restart-btn" onClick={handleRestart} title="Restart session">
            &#8634; Restart
          </button>
          <button className="theme-toggle" onClick={toggleTheme} title="Toggle theme">
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

        <ChatPane
          messages={messages}
          currentStream={currentAssistantMsg}
          activeTools={activeTools}
          isTyping={isTyping}
          slashCommands={SLASH_COMMANDS}
          onSend={handleSend}
        />
      </div>
      <Dashboard
        sessionCost={sessionCost}
        totalCost={totalCost}
        memoryLines={memoryLines}
        activeTools={activeTools}
        projectPath={projectPath}
        projectName={projectName}
        onMemoryReload={loadDashboardData}
      />
    </div>
  );
}

export default App;
