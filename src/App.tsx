import { useEffect, useState, useCallback, useRef } from "react";
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
import bgChat from "./assets/bg-chat.png";
import bgDashboard from "./assets/bg-dashboard.png";
import ToolDetailPanel from "./components/tools/ToolDetailPanel";
import BrainPanel from "./components/memory/BrainPanel";
import GraphPanel from "./components/graphs/GraphPanel";
import TokenPanel from "./components/optimizer/TokenPanel";
import AgentPanel from "./components/agents/AgentPanel";
import BrainSearchModal from "./components/memory/BrainSearchModal";
import type { AppEvent, CostData, ToastMessage, Theme, ToolUseData, PersistedEvent, ConversationSearchResult, TransformSettings, TransformResult, WebSearchSettings, WebSearchResponse, ApiKeyInfo, PromptTemplate, ProviderDef } from "./types";
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
    setModel,
    truncateAfter,
    toolEntries,
    stats,
  } = useEventStore();

  const [totalCost, setTotalCost] = useState<CostData>(EMPTY_COST);
  const [memoryLines, setMemoryLines] = useState<string[]>([]);
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("ollopa-desktop-theme");
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

  // Brain search (Ctrl+K)
  const [showBrainSearch, setShowBrainSearch] = useState(false);

  // Settings popover
  const [showSettingsPopover, setShowSettingsPopover] = useState(false);

  // Dashboard collapsed
  const [dashboardCollapsed, setDashboardCollapsed] = useState(false);

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
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplate[]>([]);
  const [saveTemplateName, setSaveTemplateName] = useState("");

  // Export
  const [showExportMenu, setShowExportMenu] = useState(false);

  // Prompt transformer state
  const [transformSettings, setTransformSettings] = useState<TransformSettings>({
    enabled: true, default_mode: "AutoEnhance", show_preview: true, web_search_enabled: true,
  });
  const [transformPreview, setTransformPreview] = useState<TransformResult | null>(null);
  const [showTransformPreview, setShowTransformPreview] = useState(false);

  // Web search state
  const [webSearchSettings, setWebSearchSettings] = useState<WebSearchSettings>({
    enabled: true, provider: "DuckDuckGo", max_results: 5, auto_trigger: true,
  });
  const [webSearchResults, setWebSearchResults] = useState<WebSearchResponse | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  // Template editor
  const [showTemplateEditor, setShowTemplateEditor] = useState(false);

  // API Key management
  const [showApiKeys, setShowApiKeys] = useState(false);
  const [apiKeys, setApiKeys] = useState<ApiKeyInfo[]>([]);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");

  // Provider state (for model dropdown filtering)
  const [providers, setProviders] = useState<ProviderDef[]>([]);

  // Context window tracking
  const [contextWindow, setContextWindow] = useState(64000);

  // Drag-to-resize panels
  const [dashboardWidth, setDashboardWidth] = useState(() => {
    const saved = localStorage.getItem("ollopa-dashboard-width");
    return saved ? parseInt(saved, 10) : 280;
  });
  const resizing = useRef(false);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizing.current = true;
    const startX = e.clientX;
    const startWidth = dashboardWidth;
    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      const delta = startX - ev.clientX;
      const newWidth = Math.min(600, Math.max(180, startWidth + delta));
      setDashboardWidth(newWidth);
    };
    const onUp = () => {
      resizing.current = false;
      setDashboardWidth((w) => {
        localStorage.setItem("ollopa-dashboard-width", String(w));
        return w;
      });
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [dashboardWidth]);

  // Sound notification
  const [soundEnabled, setSoundEnabled] = useState(() =>
    localStorage.getItem("ollopa-sound") !== "false"
  );
  const prevStreaming = useRef(false);

  useEffect(() => {
    if (prevStreaming.current && !state.isStreaming && soundEnabled) {
      new Audio('/notification.wav').play().catch(() => {});
    }
    prevStreaming.current = !!state.isStreaming;
  }, [state.isStreaming, soundEnabled]);

  const toggleSound = useCallback(() => {
    setSoundEnabled((prev) => {
      const next = !prev;
      localStorage.setItem("ollopa-sound", String(next));
      return next;
    });
  }, []);

  // Available models (grouped by provider)
  const AVAILABLE_MODELS = [
    { group: "DeepSeek", models: ["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-chat", "deepseek-coder", "deepseek-reasoner"] },
    { group: "Anthropic", models: ["claude-sonnet-4-20250514", "claude-opus-4-20250514"] },
    { group: "OpenAI", models: ["gpt-4o", "o3-mini"] },
  ];
  const ALL_MODELS = AVAILABLE_MODELS.flatMap((g) => g.models);

  // Map provider group name to ProviderDef enabled status
  const getProviderEnabled = (groupName: string): boolean => {
    if (providers.length === 0) return true;
    const match = providers.find(
      (p) => p.name.toLowerCase() === groupName.toLowerCase() ||
             p.provider_type.toLowerCase() === groupName.toLowerCase()
    );
    return match ? match.enabled : true;
  };

  // Determine the provider name for the currently selected model
  const getModelProvider = (model: string): string | null => {
    for (const g of AVAILABLE_MODELS) {
      if (g.models.includes(model)) return g.group;
    }
    return null;
  };

  const currentProvider = getModelProvider(state.sessionModel);

  // Check if API key is set for a provider
  const isApiKeySet = (providerName: string): boolean => {
    const match = apiKeys.find(
      (k) => k.provider_name.toLowerCase() === providerName.toLowerCase()
    );
    return match ? match.is_set : false;
  };

  // ═══════ Theme (with persistence) ═══════

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("ollopa-desktop-theme", theme);
  }, [theme]);

  // ═══════ Boot ═══════

  useEffect(() => {
    checkEnvVars();
    startSession();
    loadDashboardData();
    loadTransformSettings();
    loadWebSearchSettings();
    loadProvidersList();
    loadApiKeys();

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
      // Ctrl+K: Brain search
      if (e.ctrlKey && e.key === "k") {
        e.preventDefault();
        setShowBrainSearch((s) => !s);
      }
      // Escape: Close modals
      if (e.key === "Escape") {
        setShowSearch(false);
        setShowModelSelector(false);
        setShowSystemPrompt(false);
        setShowExportMenu(false);
        setShowProjectDropdown(false);
        setShowTransformPreview(false);
        setShowTemplateEditor(false);
        setShowApiKeys(false);
        setShowBrainSearch(false);
      }
    };

    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, []);

  // ═══════ Click-outside to close dropdowns & popovers ═══════

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".dropdown-wrapper") && !target.closest(".dropdown")) {
        setShowModelSelector(false);
        setShowProjectDropdown(false);
        setShowExportMenu(false);
      }
      if (!target.closest(".popover-wrapper") && !target.closest(".settings-popover")) {
        setShowSettingsPopover(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
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
        await getCurrentWindow().setTitle(`Ollopa — ${name}`);
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
      const data = await invoke<{ ollopa_md: string; memory_lines: string[] }>(
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

  const enhanceAndSend = async (rawMessage: string) => {
    let finalMessage = rawMessage;

    // Prompt transformer
    if (transformSettings.enabled) {
      try {
        const result = await invoke<TransformResult>("transform_preview", {
          raw: rawMessage,
          model: state.sessionModel,
          projectPath: projectPath,
        });
        if (result.transformed !== rawMessage) {
          finalMessage = result.transformed;
        }

        // Web search auto-trigger
        if (result.web_search_triggered && result.search_query && webSearchSettings.enabled) {
          const searchContext = await handleWebSearch(result.search_query);
          if (searchContext) {
            finalMessage = `${searchContext}\n\n${finalMessage}`;
          }
        }
      } catch (_) {}
    }

    try {
      await invoke("send_input", { message: finalMessage });
    } catch (e) {
      addToast(`Error: ${e}`, "error");
    }
  };

  const handleSend = async (input: string) => {
    addUserMessage(input);
    await enhanceAndSend(input);
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
    await enhanceAndSend(message);
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
      // Update context window for the new model
      try {
        const cw = await invoke<number>("get_model_context_window", { model });
        setContextWindow(cw);
      } catch (_) {}
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
    try {
      const templates = await invoke<PromptTemplate[]>("transform_list_templates");
      setPromptTemplates(templates);
    } catch (_) {}
    setSaveTemplateName("");
    setShowSystemPrompt(true);
  };

  const handleSaveAsTemplate = async () => {
    if (!saveTemplateName.trim() || !systemPrompt.trim()) return;
    const template: PromptTemplate = {
      id: `custom-${Date.now()}`,
      name: saveTemplateName.trim(),
      mode: "AutoEnhance",
      template: systemPrompt,
      is_builtin: false,
      created_at: Date.now(),
    };
    try {
      await invoke("transform_save_template", { template });
      addToast("Template saved", "success");
      const templates = await invoke<PromptTemplate[]>("transform_list_templates");
      setPromptTemplates(templates);
      setSaveTemplateName("");
    } catch (e) {
      addToast(`Failed to save template: ${e}`, "error");
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    try {
      await invoke("transform_delete_template", { id });
      const templates = await invoke<PromptTemplate[]>("transform_list_templates");
      setPromptTemplates(templates);
      addToast("Template deleted", "info");
    } catch (e) {
      addToast(`Failed to delete template: ${e}`, "error");
    }
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

  // ═══════ Prompt Transformer ═══════

  const loadTransformSettings = async () => {
    try {
      const s = await invoke<TransformSettings>("transform_get_settings");
      setTransformSettings(s);
    } catch (_) {}
  };

  const handleToggleTransform = async () => {
    const updated = { ...transformSettings, enabled: !transformSettings.enabled };
    setTransformSettings(updated);
    try {
      await invoke("transform_save_settings", { settings: updated });
    } catch (_) {}
  };

  const handleToggleWebSearch = async () => {
    const updated = { ...webSearchSettings, enabled: !webSearchSettings.enabled };
    setWebSearchSettings(updated);
    try {
      await invoke("web_search_save_settings", { settings: updated });
    } catch (_) {}
  };

  const handlePreviewTransform = async (input: string) => {
    if (!transformSettings.enabled || !input.trim()) {
      setTransformPreview(null);
      return;
    }
    try {
      const result = await invoke<TransformResult>("transform_preview", {
        raw: input,
        model: state.sessionModel,
        projectPath: projectPath,
      });
      setTransformPreview(result);
    } catch (_) {
      setTransformPreview(null);
    }
  };

  // ═══════ Web Search ═══════

  const loadWebSearchSettings = async () => {
    try {
      const s = await invoke<WebSearchSettings>("web_search_get_settings");
      setWebSearchSettings(s);
    } catch (_) {}
  };

  const handleWebSearch = async (query: string): Promise<string> => {
    setIsSearching(true);
    try {
      const response = await invoke<WebSearchResponse>("web_search_query", { query });
      setWebSearchResults(response);
      const formatted = await invoke<string>("web_search_format", { response });
      return formatted;
    } catch (e) {
      addToast(`Web search failed: ${e}`, "error");
      return "";
    } finally {
      setIsSearching(false);
    }
  };

  // ═══════ Provider List (for model dropdown filtering) ═══════

  const loadProvidersList = async () => {
    try {
      const p = await invoke<ProviderDef[]>("router_list_providers");
      setProviders(p);
    } catch (_) {}
  };

  // ═══════ API Key Management ═══════

  const loadApiKeys = async () => {
    try {
      const keys = await invoke<ApiKeyInfo[]>("list_api_keys");
      setApiKeys(keys);
    } catch (_) {}
  };

  const handleSaveApiKey = async (envVar: string) => {
    if (!keyInput.trim()) return;
    try {
      await invoke("save_api_key", { envVar, keyValue: keyInput.trim() });
      addToast("API key saved", "success");
      setEditingKey(null);
      setKeyInput("");
      loadApiKeys();
    } catch (e) {
      addToast(`Failed to save key: ${e}`, "error");
    }
  };

  const handleDeleteApiKey = async (envVar: string) => {
    try {
      await invoke("delete_api_key", { envVar });
      addToast("API key removed", "info");
      loadApiKeys();
    } catch (e) {
      addToast(`Failed to delete key: ${e}`, "error");
    }
  };

  // ═══════ Message Edit & Regenerate ═══════

  const handleEditMessage = async (entryId: string, newContent: string) => {
    // Count messages up to (and including) the edited one for backend truncation
    const idx = state.timeline.findIndex((e) => e.id === entryId);
    const msgIndex = state.timeline
      .slice(0, idx + 1)
      .filter((e) => e.kind === "user_message" || e.kind === "assistant_message").length;
    try {
      await invoke("truncate_conversation", { index: msgIndex });
    } catch (_) {}
    truncateAfter(entryId);
    addUserMessage(newContent);
    try {
      await invoke("send_input", { message: newContent });
    } catch (e) {
      addToast(`Error: ${e}`, "error");
    }
  };

  const handleRegenerateMessage = async (entryId: string) => {
    // Find the last user message before this assistant message
    const idx = state.timeline.findIndex((e) => e.id === entryId);
    let lastUserContent = "";
    for (let i = idx - 1; i >= 0; i--) {
      if (state.timeline[i].kind === "user_message") {
        lastUserContent = (state.timeline[i].data as { kind: string; content: string }).content;
        break;
      }
    }
    if (!lastUserContent) return;
    // Truncate to remove this assistant response
    const msgIndex = state.timeline
      .slice(0, idx)
      .filter((e) => e.kind === "user_message" || e.kind === "assistant_message").length;
    try {
      await invoke("truncate_conversation", { index: msgIndex });
    } catch (_) {}
    // Remove timeline entries from this point onward
    const prevEntry = state.timeline[idx - 1];
    if (prevEntry) truncateAfter(prevEntry.id);
    addUserMessage(lastUserContent);
    try {
      await invoke("send_input", { message: lastUserContent });
    } catch (e) {
      addToast(`Error: ${e}`, "error");
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

  const usedTokens = state.sessionCost.input_tokens + state.sessionCost.output_tokens;
  const ctxPercentage = Math.min(100, (usedTokens / contextWindow) * 100);
  const ctxClass = ctxPercentage >= 80 ? "danger" : ctxPercentage >= 50 ? "warning" : "";
  const CIRC = 106.81;
  const ringOffset = CIRC * (1 - ctxPercentage / 100);

  return (
    <div className="app">
      {/* ═══════ TOOLBAR ═══════ */}
      <header className="toolbar">
        <div className="toolbar-left">
          <button className="tbtn" onClick={() => setShowSessionSidebar(true)} title="Session history">
            <i className="fa-solid fa-bars" />
          </button>

          {/* Model Pill Dropdown */}
          <div className="dropdown-wrapper">
            <button
              className={`model-pill model-indicator${showModelSelector ? " open" : ""}`}
              onClick={() => { setShowModelSelector((s) => !s); setShowProjectDropdown(false); setShowExportMenu(false); setShowSettingsPopover(false); }}
            >
              {currentProvider && <span className="model-provider-badge">{currentProvider}</span>}
              <span>{state.sessionModel}</span>
              {currentProvider && isApiKeySet(currentProvider) && <span className="model-apikey-dot" title="API key active" />}
              <i className="fa-solid fa-chevron-down" />
            </button>
            {showModelSelector && (
              <div className="dropdown model-dropdown">
                {AVAILABLE_MODELS.map((group) => {
                  const enabled = getProviderEnabled(group.group);
                  const keySet = isApiKeySet(group.group);
                  return (
                    <div key={group.group} className={!enabled ? "provider-group-disabled" : ""}>
                      <div className="dropdown-section-label">
                        <span>{group.group}</span>
                        {!enabled && <span className="provider-off-badge">OFF</span>}
                        {enabled && keySet && <span className="provider-key-badge" title="API key set"><i className="fa-solid fa-key" /></span>}
                        {enabled && !keySet && <span className="provider-nokey-badge" title="No API key"><i className="fa-solid fa-key" /></span>}
                      </div>
                      {group.models.map((m) => (
                        <button
                          key={m}
                          className={`dropdown-item${m === state.sessionModel ? " active" : ""}${!enabled ? " disabled" : ""}`}
                          onClick={() => { if (enabled) handleSwitchModel(m); }}
                          disabled={!enabled}
                          title={!enabled ? `${group.group} provider is turned off` : m}
                        >
                          {m}
                          {m === state.sessionModel && <span className="model-active-indicator"><i className="fa-solid fa-circle-check" /></span>}
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Project Pill */}
          <div className="dropdown-wrapper">
            <button
              className="project-pill"
              onClick={() => { setShowProjectDropdown((s) => !s); setShowModelSelector(false); setShowExportMenu(false); setShowSettingsPopover(false); }}
            >
              <i className="fa-solid fa-folder-open" />
              <span>{projectName || "No project"}</span>
            </button>
            {showProjectDropdown && (
              <div className="dropdown">
                <button className="dropdown-item" onClick={handlePickProject}>
                  <i className="fa-solid fa-folder-plus" /> Browse folder…
                </button>
                {recentProjects.length > 0 && <div className="dropdown-divider" />}
                {recentProjects.map((p) => (
                  <div
                    key={p}
                    className={`dropdown-item${p === projectPath ? " active" : ""}`}
                    onClick={() => switchToProject(p)}
                  >
                    <i className="fa-solid fa-folder" /> {p.split(/[/\\]/).pop()}
                    <button
                      className="project-remove-btn"
                      title="Remove from recent projects"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRecentProjects((prev) => prev.filter((x) => x !== p));
                        if (p === projectPath) {
                          setProjectPath(null);
                        }
                        addToast("Project removed from list", "info");
                      }}
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* CENTER: token/cost bar */}
        <div className="toolbar-center">
          <div className="token-bar">
            <div className="token-track">
              <div className="token-fill" style={{ width: `${Math.min((state.sessionCost.cost_usd / 1) * 100, 100)}%` }} />
            </div>
            <span className="token-cost">${state.sessionCost.cost_usd.toFixed(4)}</span>
          </div>
        </div>

        {/* RIGHT: toggles + actions */}
        <div className="toolbar-right">
          <button
            className={`tbtn toggle enhance-toggle${transformSettings.enabled ? " active" : ""}`}
            onClick={handleToggleTransform}
            title={transformSettings.enabled ? "Auto-enhance ON" : "Auto-enhance OFF"}
          >
            <i className="fa-solid fa-wand-magic-sparkles" />
          </button>
          <button
            className={`tbtn toggle sound-toggle${soundEnabled ? " active" : ""}`}
            onClick={toggleSound}
            title={soundEnabled ? "Sound ON" : "Sound OFF"}
          >
            <i className={`fa-solid ${soundEnabled ? "fa-volume-high" : "fa-volume-xmark"}`} />
          </button>
          <button
            className={`tbtn toggle web-search-toggle${webSearchSettings.enabled ? " active" : ""}`}
            onClick={handleToggleWebSearch}
            title={webSearchSettings.enabled ? "Web Search ON" : "Web Search OFF"}
          >
            <i className="fa-solid fa-globe" />
          </button>
          <div className="toolbar-divider" />
          <button className="tbtn" onClick={() => setShowSearch((s) => !s)} title="Search conversations">
            <i className="fa-solid fa-magnifying-glass" />
          </button>

          {/* Export Dropdown */}
          <div className="dropdown-wrapper">
            <button
              className="tbtn"
              onClick={() => { setShowExportMenu((s) => !s); setShowModelSelector(false); setShowProjectDropdown(false); setShowSettingsPopover(false); }}
              title="Export"
            >
              <i className="fa-solid fa-file-export" />
            </button>
            {showExportMenu && (
              <div className="dropdown" style={{ minWidth: 176, right: 0, left: "auto" }}>
                <button className="dropdown-item" onClick={() => handleExport("markdown")}>
                  <i className="fa-brands fa-markdown" /> Export as Markdown
                </button>
                <button className="dropdown-item" onClick={() => handleExport("json")}>
                  <i className="fa-solid fa-code" /> Export as JSON
                </button>
              </div>
            )}
          </div>
          <div className="toolbar-divider" />

          {/* Settings Popover */}
          <div className="popover-wrapper">
            <button
              className="tbtn"
              onClick={() => { setShowSettingsPopover((s) => !s); setShowModelSelector(false); setShowProjectDropdown(false); setShowExportMenu(false); }}
              title="Settings & Tools"
            >
              <i className="fa-solid fa-gear" style={{ transition: "transform 0.3s ease", transform: showSettingsPopover ? "rotate(55deg)" : "" }} />
            </button>
            {showSettingsPopover && (
              <div className="settings-popover">
                <div className="popover-title">Tools &amp; Settings</div>
                <button className="popover-item" onClick={() => { handleSaveMemory(); setShowSettingsPopover(false); }}>
                  <i className="fa-solid fa-floppy-disk" /><span>Memory</span>
                </button>
                <button className={`popover-item${showCompactWarning ? " compact-item warn" : ""}`} onClick={() => { handleCompact(); setShowSettingsPopover(false); }}>
                  <i className="fa-solid fa-compress" /><span>Compact Context</span>
                  {showCompactWarning && <span className="compact-badge">!</span>}
                </button>
                <div className="popover-divider" />
                <button className="popover-item" onClick={() => { setShowBrainPanel(true); setShowSettingsPopover(false); }}>
                  <i className="fa-solid fa-brain" /><span>Brain</span>
                </button>
                <button className="popover-item" onClick={() => { setShowGraphPanel(true); setShowSettingsPopover(false); }}>
                  <i className="fa-solid fa-diagram-project" /><span>Graphs</span>
                </button>
                <button className="popover-item" onClick={() => { setShowTokenPanel(true); setShowSettingsPopover(false); }}>
                  <i className="fa-solid fa-microchip" /><span>Tokens</span>
                </button>
                <button className="popover-item" onClick={() => { setShowAgentPanel(true); setShowSettingsPopover(false); }}>
                  <i className="fa-solid fa-robot" /><span>Agents</span>
                </button>
                <button className="popover-item" onClick={() => { handleOpenSystemPrompt(); setShowSettingsPopover(false); }}>
                  <i className="fa-solid fa-terminal" /><span>Prompt</span>
                </button>
                <div className="popover-divider" />
                <button className="popover-item" onClick={() => { setShowApiKeys(true); loadApiKeys(); loadProvidersList(); setShowSettingsPopover(false); }}>
                  <i className="fa-solid fa-key" /><span>Manage API Keys</span>
                </button>
              </div>
            )}
          </div>

          <button className="tbtn restart-btn" onClick={handleRestart} title="New Chat (Ctrl+N)">
            <i className="fa-solid fa-rotate-right" />
          </button>
          <button className="tbtn theme-toggle" onClick={toggleTheme} title="Toggle theme">
            <i className={`fa-solid ${theme === "dark" ? "fa-moon" : "fa-sun"}`} />
          </button>
        </div>
      </header>

      {/* ═══════ COMPACT BANNER ═══════ */}
      {showCompactWarning && !compactWarningDismissed && (
        <div className="compact-banner">
          <i className="fa-solid fa-triangle-exclamation" />
          <span>Context at ~{Math.round(ctxPercentage)}% — compact now to preserve the window</span>
          <button className="compact-now-btn" onClick={handleCompact}>Compact now</button>
          <button className="compact-dismiss" onClick={() => setCompactWarningDismissed(true)}>&times;</button>
        </div>
      )}

      {/* ═══════ ENV WARNING ═══════ */}
      {envWarning && (
        <div className="compact-banner" style={{ background: "rgba(245,166,35,0.09)", borderColor: "rgba(245,166,35,0.28)", color: "var(--warning)" }}>
          <i className="fa-solid fa-triangle-exclamation" />
          <span>{envWarning}</span>
          <button className="compact-dismiss" onClick={() => setEnvWarning(null)}>&times;</button>
        </div>
      )}

      {/* ═══════ MAIN ROW ═══════ */}
      <div className="main-row">
        {/* CHAT AREA */}
        <main className="chat-area chat-panel">
          <div className="panel-bg panel-bg--chat" style={{ backgroundImage: `url(${bgChat})` }} />

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
                {promptTemplates.length > 0 && (
                  <div className="template-picker">
                    <select
                      className="template-select"
                      onChange={(e) => { const t = promptTemplates.find((t) => t.id === e.target.value); if (t) setSystemPrompt(t.template); }}
                      defaultValue=""
                    >
                      <option value="" disabled>Load template...</option>
                      {promptTemplates.map((t) => (
                        <option key={t.id} value={t.id}>{t.name} {t.is_builtin ? "(built-in)" : ""}</option>
                      ))}
                    </select>
                    {promptTemplates.filter((t) => !t.is_builtin).map((t) => (
                      <button key={t.id} className="template-delete-btn" onClick={() => handleDeleteTemplate(t.id)} title={`Delete "${t.name}"`}>
                        &times; {t.name}
                      </button>
                    ))}
                  </div>
                )}
                <textarea className="system-prompt-textarea" value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={8} placeholder="You are a helpful assistant..." />
                <div className="template-save-row">
                  <input className="template-name-input" type="text" placeholder="Template name..." value={saveTemplateName} onChange={(e) => setSaveTemplateName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSaveAsTemplate()} />
                  <button className="template-save-btn" onClick={handleSaveAsTemplate} disabled={!saveTemplateName.trim() || !systemPrompt.trim()}>Save as Template</button>
                </div>
                <div className="system-prompt-actions">
                  <button className="system-prompt-save" onClick={handleSaveSystemPrompt}>Save</button>
                  <button className="system-prompt-cancel" onClick={() => setShowSystemPrompt(false)}>Cancel</button>
                </div>
              </div>
            </div>
          )}

          {/* API Key Management Modal */}
          {showApiKeys && (
            <div className="modal-overlay" onClick={() => { setShowApiKeys(false); setEditingKey(null); setKeyInput(""); }}>
              <div className="api-keys-modal" onClick={(e) => e.stopPropagation()}>
                <div className="api-keys-header">
                  <h3><i className="fa-solid fa-key" /> API Keys</h3>
                  <button className="api-keys-close" onClick={() => { setShowApiKeys(false); setEditingKey(null); setKeyInput(""); }}>&times;</button>
                </div>
                <p className="api-keys-desc">Add API keys for each provider. Keys are saved locally and loaded automatically on startup.</p>
                <div className="api-keys-list">
                  {apiKeys.map((k) => {
                    const isCurrentProvider = currentProvider?.toLowerCase() === k.provider_name.toLowerCase();
                    const providerDef = providers.find((p) => p.name.toLowerCase() === k.provider_name.toLowerCase());
                    const providerEnabled = providerDef ? providerDef.enabled : true;
                    return (
                    <div key={k.env_var} className={`api-key-row${isCurrentProvider ? " api-key-row--active" : ""}${!providerEnabled ? " api-key-row--disabled" : ""}`}>
                      <div className="api-key-info">
                        <span className="api-key-provider">
                          {k.provider_name}
                          {isCurrentProvider && <span className="api-key-active-badge">In Use</span>}
                          {!providerEnabled && <span className="api-key-off-badge">Provider OFF</span>}
                        </span>
                        <span className="api-key-envvar">{k.env_var}</span>
                      </div>
                      {editingKey === k.env_var ? (
                        <div className="api-key-edit">
                          <input type="password" className="api-key-input" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} placeholder={`Enter ${k.env_var}...`} autoFocus onKeyDown={(e) => { if (e.key === "Enter") handleSaveApiKey(k.env_var); if (e.key === "Escape") { setEditingKey(null); setKeyInput(""); } }} />
                          <button className="api-key-save-btn" onClick={() => handleSaveApiKey(k.env_var)}>Save</button>
                          <button className="api-key-cancel-btn" onClick={() => { setEditingKey(null); setKeyInput(""); }}>Cancel</button>
                        </div>
                      ) : (
                        <div className="api-key-actions">
                          {k.is_set ? (<><span className="api-key-masked">{k.masked_key}</span><span className="api-key-status set">Active</span></>) : (<span className="api-key-status not-set">Not set</span>)}
                          <button className="api-key-edit-btn" onClick={() => { setEditingKey(k.env_var); setKeyInput(""); }}>{k.is_set ? "Update" : "Add Key"}</button>
                          {k.is_set && (<button className="api-key-delete-btn" onClick={() => handleDeleteApiKey(k.env_var)}>Remove</button>)}
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Timeline */}
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

          {/* Web search results indicator */}
          {webSearchResults && (
            <div className="web-search-results-bar">
              <span className="web-search-indicator"><i className="fa-solid fa-globe" /> Web results for: <em>{webSearchResults.query}</em></span>
              <span className="web-search-count">{webSearchResults.results.length} results</span>
              <button className="web-search-dismiss" onClick={() => setWebSearchResults(null)}>&times;</button>
            </div>
          )}

          {/* Transform preview */}
          {showTransformPreview && transformPreview && (
            <div className="transform-preview-bar">
              <div className="transform-preview-header">
                <span className="transform-mode-badge">{transformPreview.mode}</span>
                {transformPreview.web_search_triggered && (<span className="transform-search-badge"><i className="fa-solid fa-globe" /> Web search</span>)}
                <button className="transform-preview-close" onClick={() => setShowTransformPreview(false)}>&times;</button>
              </div>
              <pre className="transform-preview-content">{transformPreview.transformed}</pre>
            </div>
          )}

        </main>

        {/* ═══════ Resize Handle ═══════ */}
        <div className="resize-handle" onMouseDown={handleResizeStart} />

        {/* ═══════ Dashboard ═══════ */}
        <Dashboard
          sessionCost={state.sessionCost}
          totalCost={totalCost}
          memoryLines={memoryLines}
          toolEntries={toolEntries}
          stats={stats}
          projectPath={projectPath}
          projectName={projectName}
          onMemoryReload={loadDashboardData}
          bgImage={bgDashboard}
          width={dashboardCollapsed ? 50 : dashboardWidth}
          collapsed={dashboardCollapsed}
          onToggleCollapse={() => setDashboardCollapsed((c) => !c)}
        />
      </div>

      {/* ═══════ Input Area with Context Ring ═══════ */}
      <footer className="input-area">
        <button
          className={`ctx-ring-btn${ctxClass ? ` ${ctxClass}` : ""}`}
          onClick={handleCompact}
          title={`${Math.round(ctxPercentage)}% of context used · Click to compact`}
        >
          <svg viewBox="0 0 44 44" className="ctx-ring-svg">
            <circle className="ring-bg" cx="22" cy="22" r="17" />
            <circle className="ring-progress" cx="22" cy="22" r="17" style={{ strokeDasharray: CIRC, strokeDashoffset: ringOffset }} />
          </svg>
          <div className="ring-center">
            <i className="fa-solid fa-compress ring-icon" />
            <span className="ring-pct">{Math.round(ctxPercentage)}%</span>
          </div>
        </button>
        <InputBar
          slashCommands={SLASH_COMMANDS}
          onSend={handleSend}
          onSendWithFiles={handleSendWithFiles}
          isStreaming={state.isStreaming}
          onStopGeneration={handleStopGeneration}
          transformEnabled={transformSettings.enabled}
          onPreviewTransform={handlePreviewTransform}
          onTogglePreview={() => setShowTransformPreview((s) => !s)}
          showTransformPreview={showTransformPreview}
        />
      </footer>

      {/* ═══════ Modals ═══════ */}
      {state.activeApproval && state.activeApproval.status === "pending" && (
        <ApprovalModal approval={state.activeApproval} onApprove={handleApprove} onDeny={handleDeny} />
      )}
      {state.activeDiff && (
        <FileDiffModal filePath={state.activeDiff.filePath} oldContent={state.activeDiff.oldContent} newContent={state.activeDiff.newContent} onApprove={handleDiffApprove} onDeny={handleDiffDeny} onClose={closeDiff} />
      )}

      {/* ═══════ Session Sidebar Overlay ═══════ */}
      <SessionSidebar
        visible={showSessionSidebar}
        onClose={() => setShowSessionSidebar(false)}
        onToast={addToast}
        onRestore={async (events: PersistedEvent[]) => {
          replayEvents(events.map((e) => e.event));
          try { const model = await invoke<string>("get_current_model"); if (model && model !== "unknown") setModel(model); } catch (_) {}
        }}
      />

      {/* ═══════ Panels ═══════ */}
      {viewingTool && <ToolDetailPanel tool={viewingTool} onClose={() => setViewingTool(null)} />}
      <BrainPanel visible={showBrainPanel} onClose={() => setShowBrainPanel(false)} onToast={addToast} projectPath={projectPath} />
      <GraphPanel visible={showGraphPanel} onClose={() => setShowGraphPanel(false)} onToast={addToast} projectPath={projectPath} />
      <TokenPanel visible={showTokenPanel} onClose={() => setShowTokenPanel(false)} onToast={addToast} projectPath={projectPath} />
      <AgentPanel visible={showAgentPanel} onClose={() => setShowAgentPanel(false)} onToast={addToast} projectPath={projectPath} />
      <BrainSearchModal visible={showBrainSearch} onClose={() => setShowBrainSearch(false)} projectPath={projectPath} />
      <Toast toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

export default App;
