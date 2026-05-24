import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import ChatPane from "./components/ChatPane";
import Dashboard from "./components/Dashboard";

export interface Message {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
}

export interface ApprovalData {
  command: string;
  risk_label: string;
}

export interface PlanGateData {
  lines: string[];
  file_count: number;
}

export interface CostData {
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export type Theme = "dark" | "light";

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
  { cmd: "/model deepseek-v4-pro", desc: "Switch to deepseek-v4-pro (default)" },
  { cmd: "/model deepseek-r1", desc: "Switch to deepseek-r1 (R1 reasoning)" },
  { cmd: "/model deepseek-v4-flash", desc: "Switch to deepseek-v4-flash (fast/cheap)" },
  { cmd: "/permissions", desc: "View or update tool permissions" },
  { cmd: "/review", desc: "Review code changes in current project" },
  { cmd: "/status", desc: "Show current session status and model" },
  { cmd: "/terminal-setup", desc: "Setup terminal integration (Shift+Enter)" },
  { cmd: "/vim", desc: "Toggle vim mode for input" },
];

const EMPTY_COST: CostData = { input_tokens: 0, output_tokens: 0, cost_usd: 0 };

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [approval, setApproval] = useState<ApprovalData | null>(null);
  const [planGate, setPlanGate] = useState<PlanGateData | null>(null);
  const [totalCost, setTotalCost] = useState<CostData>(EMPTY_COST);
  const [sessionCost, setSessionCost] = useState<CostData>(EMPTY_COST);
  const [memoryLines, setMemoryLines] = useState<string[]>([]);
  const [currentAssistantMsg, setCurrentAssistantMsg] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [theme, setTheme] = useState<Theme>("dark");

  // Feature 1: Project Switcher
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [recentProjects, setRecentProjects] = useState<string[]>([]);
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);

  // Feature 5: Model Switcher
  const [currentModel, setCurrentModel] = useState<"deepseek-v4-pro" | "deepseek-r1" | "deepseek-v4-flash">("deepseek-v4-pro");

  // Feature 9: Env Var Warning
  const [envWarning, setEnvWarning] = useState<string | null>(null);

  // Feature 10: Auto-Compact Warning
  const [compactWarningDismissed, setCompactWarningDismissed] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    checkEnvVars();
    startSession();
    loadDashboardData();

    const unlisten1 = listen<{ line: string; is_error: boolean }>("pty-output", (event) => {
      const { line, is_error } = event.payload;
      setIsTyping(false);
      if (is_error) {
        addMessage("system", line);
      } else {
        setCurrentAssistantMsg((prev) => prev + line + "\n");
      }
    });

    const unlisten2 = listen<ApprovalData>("approval-request", (event) => {
      flushAssistantMessage();
      setApproval(event.payload);
    });

    const unlisten3 = listen<PlanGateData>("plan-gate", (event) => {
      flushAssistantMessage();
      setPlanGate(event.payload);
    });

    // Live token update — accumulates session cost
    const unlisten4 = listen<CostData>("token-update", (event) => {
      setSessionCost((prev) => ({
        input_tokens: prev.input_tokens + event.payload.input_tokens,
        output_tokens: prev.output_tokens + event.payload.output_tokens,
        cost_usd: prev.cost_usd + event.payload.cost_usd,
      }));
    });

    const costInterval = setInterval(loadCost, 10000);

    return () => {
      unlisten1.then((f) => f());
      unlisten2.then((f) => f());
      unlisten3.then((f) => f());
      unlisten4.then((f) => f());
      clearInterval(costInterval);
    };
  }, []);

  const getTimestamp = () =>
    new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const addMessage = useCallback((role: Message["role"], content: string) => {
    setMessages((prev) => [
      ...prev,
      { id: Date.now() + Math.random(), role, content, timestamp: getTimestamp() },
    ]);
  }, []);

  const flushAssistantMessage = useCallback(() => {
    setCurrentAssistantMsg((prev) => {
      if (prev.trim()) {
        setMessages((msgs) => [
          ...msgs,
          {
            id: Date.now(),
            role: "assistant",
            content: prev.trim(),
            timestamp: getTimestamp(),
          },
        ]);
      }
      return "";
    });
  }, []);

  // ═══════ Feature 9: Env Var Check ═══════

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
      addMessage("system", "Session started — memory injected");
    } catch (e) {
      addMessage("system", `Failed to start PTY: ${e}`);
    }
  };

  const handleRestart = async () => {
    setCurrentAssistantMsg("");
    setIsTyping(false);
    setSessionCost(EMPTY_COST);
    try {
      await invoke("restart_session");
      addMessage("system", "Session restarted");
      loadDashboardData();
    } catch (e) {
      addMessage("system", `Restart failed: ${e}`);
    }
  };

  // ═══════ Feature 1: Project Switcher ═══════

  const handlePickProject = async () => {
    try {
      // Use Tauri dialog API to pick a directory
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false });
      if (selected && typeof selected === "string") {
        await switchToProject(selected);
      }
    } catch (_) {
      // Fallback: prompt for path
      const path = window.prompt("Enter project directory path:");
      if (path) {
        await switchToProject(path);
      }
    }
  };

  const switchToProject = async (path: string) => {
    try {
      await invoke("switch_project", { path });
      setProjectPath(path);
      setRecentProjects((prev) => {
        const filtered = prev.filter((p) => p !== path);
        return [path, ...filtered].slice(0, 5);
      });
      setShowProjectDropdown(false);
      // Restart session in new directory
      await handleRestart();
      addMessage("system", `Switched to project: ${path}`);
      // Update window title
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
    flushAssistantMessage();
    addMessage("user", input);
    setIsTyping(true);
    try {
      await invoke("send_input", { input });
    } catch (e) {
      setIsTyping(false);
      addMessage("system", `Error: ${e}`);
    }
  };

  const handleApproval = async (approved: boolean) => {
    try {
      await invoke("respond_approval", { approved });
      setApproval(null);
      addMessage("system", approved ? "Command approved" : "Command denied");
    } catch (_) {}
  };

  const handlePlanApproval = async () => {
    try {
      await invoke("approve_plan");
      setPlanGate(null);
      addMessage("system", "Plan approved — proceeding");
    } catch (_) {}
  };

  const handlePlanDeny = async () => {
    try {
      await invoke("deny_plan");
      setPlanGate(null);
      addMessage("system", "Plan denied — describe what to change");
    } catch (_) {}
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
      await invoke("send_input", { input: "/compact" });
      addMessage("system", "Compact requested");
      setCompactWarningDismissed(true);
    } catch (_) {}
  };

  // ═══════ Feature 5: Model Switcher ═══════

  const handleModelToggle = async () => {
    const modelCycle: Record<string, "deepseek-v4-pro" | "deepseek-r1" | "deepseek-v4-flash"> = {
      "deepseek-v4-pro": "deepseek-r1",
      "deepseek-r1": "deepseek-v4-flash",
      "deepseek-v4-flash": "deepseek-v4-pro",
    };
    const next = modelCycle[currentModel] ?? "deepseek-v4-pro";
    try {
      await invoke("send_input", { input: `/model ${next}` });
      setCurrentModel(next);
      addMessage("system", `Switched to ${next}`);
    } catch (_) {}
  };

  const toggleTheme = () => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  };

  // ═══════ Feature 10: Auto-Compact Warning ═══════
  const messageCount = messages.length;
  const showCompactWarning =
    !compactWarningDismissed &&
    (messageCount > 20 || totalCost.input_tokens > 80000 || sessionCost.input_tokens > 80000);

  return (
    <div className="app-container">
      <div className="chat-panel">
        {/* Feature 9: Env var warning banner */}
        {envWarning && (
          <div className="env-warning-banner">
            <span>
              &#9888; DeepSeek env vars not set — Claude Code will fail. Set ANTHROPIC_BASE_URL and
              ANTHROPIC_API_KEY in your shell, then restart.
            </span>
            <button className="env-warning-close" onClick={() => setEnvWarning(null)}>
              &times;
            </button>
          </div>
        )}

        <div className="toolbar">
          {/* Feature 5: Clickable model switcher */}
          <button
            className={`model-toggle ${currentModel === "deepseek-r1" ? "reasoner" : currentModel === "deepseek-v4-flash" ? "flash" : ""}`}
            onClick={handleModelToggle}
            title={`Current: ${currentModel} — click to cycle models`}
          >
            {currentModel}
          </button>

          {/* Feature 1: Project Switcher */}
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
          {/* Feature 2: Restart button */}
          <button className="toolbar-btn restart-btn" onClick={handleRestart} title="Restart session">
            &#8634; Restart
          </button>
          <button className="theme-toggle" onClick={toggleTheme} title="Toggle theme">
            {theme === "dark" ? "\u263E" : "\u2600"}
          </button>
        </div>

        {/* Feature 10: Auto-compact warning bar */}
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
          approval={approval}
          isTyping={isTyping}
          slashCommands={SLASH_COMMANDS}
          onApproval={handleApproval}
          onSend={handleSend}
        />
      </div>
      <Dashboard
        sessionCost={sessionCost}
        totalCost={totalCost}
        memoryLines={memoryLines}
        planGate={planGate}
        onPlanApproval={handlePlanApproval}
        onPlanDeny={handlePlanDeny}
        hasApprovalPending={approval !== null}
        projectPath={projectPath}
        projectName={projectName}
        onMemoryReload={loadDashboardData}
      />
    </div>
  );
}

export default App;
