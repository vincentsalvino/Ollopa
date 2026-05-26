import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  AgentDef,
  AgentStats,
  Workflow,
  AgentTask,
  ProviderDef,
  RouterConfig,
  RouterStats,
  RoutingDecision,
  RoutingStrategy,
  ToastMessage,
} from "../../types";

type AgentTab = "agents" | "workflows" | "tasks" | "providers" | "router";

interface AgentPanelProps {
  visible: boolean;
  onClose: () => void;
  onToast: (text: string, type: ToastMessage["type"]) => void;
  projectPath: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  Pending: "var(--text-muted)",
  Running: "var(--accent)",
  Completed: "var(--success)",
  Failed: "var(--danger)",
  Skipped: "var(--text-muted)",
  Draft: "var(--text-muted)",
  Paused: "var(--warning)",
};

const STRATEGY_LABELS: Record<RoutingStrategy, string> = {
  CostOptimized: "Cost Optimized",
  QualityFirst: "Quality First",
  LatencyFirst: "Latency First",
  RoundRobin: "Round Robin",
  Failover: "Failover",
  Manual: "Manual",
};

export default function AgentPanel({
  visible,
  onClose,
  onToast,
  projectPath,
}: AgentPanelProps) {
  const [tab, setTab] = useState<AgentTab>("agents");
  const [agents, setAgents] = useState<AgentDef[]>([]);
  const [agentStats, setAgentStats] = useState<AgentStats | null>(null);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [providers, setProviders] = useState<ProviderDef[]>([]);
  const [routerConfig, setRouterConfig] = useState<RouterConfig | null>(null);
  const [routerStats, setRouterStats] = useState<RouterStats | null>(null);
  const [routeResult, setRouteResult] = useState<RoutingDecision | null>(null);

  // New workflow form
  const [wfName, setWfName] = useState("");
  const [wfDesc, setWfDesc] = useState("");
  const [wfTemplate, setWfTemplate] = useState("code_review");

  // Route test form
  const [routeTaskType, setRouteTaskType] = useState("code_generation");
  const [routeNeedsTools, setRouteNeedsTools] = useState(false);

  const loadAgents = useCallback(async () => {
    try {
      const [a, s] = await Promise.all([
        invoke<AgentDef[]>("agent_list"),
        invoke<AgentStats>("agent_stats"),
      ]);
      setAgents(a);
      setAgentStats(s);
    } catch (_) {}
  }, []);

  const loadWorkflows = useCallback(async () => {
    try {
      const wfs = await invoke<Workflow[]>("agent_list_workflows", { projectPath });
      setWorkflows(wfs);
    } catch (_) {}
  }, [projectPath]);

  const loadTasks = useCallback(async () => {
    try {
      const t = await invoke<AgentTask[]>("agent_list_tasks", { agentId: null });
      setTasks(t);
    } catch (_) {}
  }, []);

  const loadProviders = useCallback(async () => {
    try {
      const [p, c, s] = await Promise.all([
        invoke<ProviderDef[]>("router_list_providers"),
        invoke<RouterConfig>("router_get_config"),
        invoke<RouterStats>("router_stats"),
      ]);
      setProviders(p);
      setRouterConfig(c);
      setRouterStats(s);
    } catch (_) {}
  }, []);

  useEffect(() => {
    if (!visible) return;
    loadAgents();
  }, [visible, loadAgents]);

  useEffect(() => {
    if (!visible) return;
    if (tab === "workflows") loadWorkflows();
    if (tab === "tasks") loadTasks();
    if (tab === "providers" || tab === "router") loadProviders();
  }, [visible, tab, loadWorkflows, loadTasks, loadProviders]);

  const handleCreateWorkflow = async () => {
    if (!wfName.trim() || !wfDesc.trim()) {
      onToast("Name and description required", "error");
      return;
    }
    try {
      await invoke("agent_create_workflow", {
        name: wfName,
        description: wfDesc,
        template: wfTemplate,
        projectPath,
      });
      onToast("Workflow created", "success");
      setWfName("");
      setWfDesc("");
      loadWorkflows();
    } catch (e) {
      onToast(`Failed: ${e}`, "error");
    }
  };

  const handleDeleteWorkflow = async (id: string) => {
    try {
      await invoke("agent_delete_workflow", { id });
      onToast("Workflow deleted", "info");
      loadWorkflows();
    } catch (e) {
      onToast(`Failed: ${e}`, "error");
    }
  };

  const handleExecuteWorkflow = async (id: string) => {
    try {
      await invoke("agent_execute_workflow", { id, projectPath });
      onToast("Workflow execution started", "success");
      // Poll for updates
      const poll = setInterval(async () => {
        await loadWorkflows();
      }, 2000);
      setTimeout(() => clearInterval(poll), 30000);
    } catch (e) {
      onToast(`Execution failed: ${e}`, "error");
    }
  };

  const handleAdvanceWorkflow = async (id: string) => {
    try {
      await invoke("agent_advance_workflow", { id, projectPath });
      onToast("Workflow advanced", "success");
      loadWorkflows();
    } catch (e) {
      onToast(`Failed: ${e}`, "error");
    }
  };

  const handleToggleProvider = async (p: ProviderDef) => {
    try {
      await invoke("router_save_provider", {
        provider: { ...p, enabled: !p.enabled },
      });
      onToast(`${p.name} ${!p.enabled ? "enabled" : "disabled"}`, "info");
      loadProviders();
    } catch (e) {
      onToast(`Failed: ${e}`, "error");
    }
  };

  const handleSaveRouterConfig = async () => {
    if (!routerConfig) return;
    try {
      await invoke("router_save_config", { config: routerConfig });
      onToast("Router config saved", "success");
      loadProviders();
    } catch (e) {
      onToast(`Failed: ${e}`, "error");
    }
  };

  const handleTestRoute = async () => {
    try {
      const result = await invoke<RoutingDecision>("router_route", {
        taskType: routeTaskType,
        needsTools: routeNeedsTools,
        maxBudget: null,
      });
      setRouteResult(result);
    } catch (e) {
      onToast(`Route failed: ${e}`, "error");
    }
  };

  if (!visible) return null;

  const tabs: { key: AgentTab; label: string }[] = [
    { key: "agents", label: "Agents" },
    { key: "workflows", label: "Workflows" },
    { key: "tasks", label: "Tasks" },
    { key: "providers", label: "Providers" },
    { key: "router", label: "Router" },
  ];

  return (
    <div className="agent-panel-overlay" onClick={onClose}>
      <div className="agent-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="agent-panel-header">
          <h3 className="agent-panel-title">Multi-Agent &amp; Providers</h3>
          {agentStats && (
            <span className="agent-panel-badge">
              {agentStats.total_agents} agents &middot; {agentStats.total_workflows} workflows
            </span>
          )}
          <button className="agent-panel-close" onClick={onClose}>
            &times;
          </button>
        </div>

        {/* Tabs */}
        <div className="agent-tabs">
          {tabs.map((t) => (
            <button
              key={t.key}
              className={`agent-tab ${tab === t.key ? "active" : ""}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="agent-content">
          {/* ═══ Agents Tab ═══ */}
          {tab === "agents" && (
            <div className="agent-list-view">
              {agentStats && (
                <div className="agent-stats-row">
                  <span>{agentStats.builtin_agents} built-in</span>
                  <span>{agentStats.custom_agents} custom</span>
                  <span>{agentStats.completed_tasks} tasks completed</span>
                </div>
              )}
              <div className="agent-card-list">
                {agents.map((a) => (
                  <div key={a.id} className="agent-card">
                    <div className="agent-card-header">
                      <span className="agent-card-name">{a.name}</span>
                      <span className="agent-card-role">{a.role}</span>
                      {a.is_builtin && (
                        <span className="agent-card-badge">built-in</span>
                      )}
                    </div>
                    <p className="agent-card-desc">{a.description}</p>
                    <div className="agent-card-caps">
                      {a.capabilities.map((c) => (
                        <span key={c} className="agent-cap-tag">
                          {c.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                    <div className="agent-card-footer">
                      <span className="agent-card-tokens">
                        max {a.max_tokens} tokens
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ═══ Workflows Tab ═══ */}
          {tab === "workflows" && (
            <div className="agent-workflows-view">
              {/* Create form */}
              <div className="agent-wf-form">
                <div className="agent-wf-form-row">
                  <input
                    type="text"
                    className="agent-form-input"
                    placeholder="Workflow name"
                    value={wfName}
                    onChange={(e) => setWfName(e.target.value)}
                  />
                  <select
                    className="agent-form-select"
                    value={wfTemplate}
                    onChange={(e) => setWfTemplate(e.target.value)}
                  >
                    <option value="code_review">Code Review</option>
                    <option value="feature_dev">Feature Dev</option>
                  </select>
                </div>
                <input
                  type="text"
                  className="agent-form-input full"
                  placeholder="Describe the task..."
                  value={wfDesc}
                  onChange={(e) => setWfDesc(e.target.value)}
                />
                <button
                  className="agent-action-btn primary"
                  onClick={handleCreateWorkflow}
                >
                  Create Workflow
                </button>
              </div>

              {/* List */}
              {workflows.length === 0 ? (
                <div className="agent-empty">
                  No workflows yet. Create one above.
                </div>
              ) : (
                <div className="agent-wf-list">
                  {workflows.map((wf) => (
                    <div key={wf.id} className="agent-wf-card">
                      <div className="agent-wf-header">
                        <span className="agent-wf-name">{wf.name}</span>
                        <span
                          className="agent-wf-status"
                          style={{ color: STATUS_COLORS[wf.status] }}
                        >
                          {wf.status}
                        </span>
                        <button
                          className="agent-wf-delete"
                          onClick={() => handleDeleteWorkflow(wf.id)}
                        >
                          &times;
                        </button>
                      </div>
                      <p className="agent-wf-desc">{wf.description}</p>
                      <div className="agent-wf-actions">
                        {wf.status === "Draft" && (
                          <button
                            className="agent-action-btn primary"
                            onClick={() => handleExecuteWorkflow(wf.id)}
                          >
                            &#9654; Execute
                          </button>
                        )}
                        {wf.status === "Running" && (
                          <button
                            className="agent-action-btn"
                            onClick={() => handleAdvanceWorkflow(wf.id)}
                          >
                            &#9654; Advance Step
                          </button>
                        )}
                      </div>
                      <div className="agent-wf-steps">
                        {wf.steps.map((step, i) => (
                          <div key={step.id} className="agent-wf-step">
                            <span
                              className="agent-step-dot"
                              style={{
                                background: STATUS_COLORS[step.status],
                              }}
                            />
                            <span className="agent-step-num">{i + 1}</span>
                            <span className="agent-step-agent">
                              {step.agent_id.replace("agent-", "")}
                            </span>
                            <span className="agent-step-action">
                              {step.action}
                            </span>
                            <span
                              className="agent-step-status"
                              style={{ color: STATUS_COLORS[step.status] }}
                            >
                              {step.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ═══ Tasks Tab ═══ */}
          {tab === "tasks" && (
            <div className="agent-tasks-view">
              {tasks.length === 0 ? (
                <div className="agent-empty">
                  No tasks yet. Tasks are created when workflows run or manually
                  via the API.
                </div>
              ) : (
                <div className="agent-task-list">
                  {tasks.map((t) => (
                    <div key={t.id} className="agent-task-card">
                      <div className="agent-task-header">
                        <span className="agent-task-agent">
                          {t.agent_id.replace("agent-", "")}
                        </span>
                        <span className="agent-task-priority">{t.priority}</span>
                        <span
                          className="agent-task-status"
                          style={{ color: STATUS_COLORS[t.status] }}
                        >
                          {t.status}
                        </span>
                      </div>
                      <p className="agent-task-desc">{t.description}</p>
                      {t.result && (
                        <pre className="agent-task-result">{t.result}</pre>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ═══ Providers Tab ═══ */}
          {tab === "providers" && (
            <div className="agent-providers-view">
              <div className="agent-provider-list">
                {providers.map((p) => (
                  <div
                    key={p.id}
                    className={`agent-provider-card ${!p.enabled ? "disabled" : ""}`}
                  >
                    <div className="agent-provider-header">
                      <span className="agent-provider-name">{p.name}</span>
                      <span className="agent-provider-type">
                        {p.provider_type}
                      </span>
                      <button
                        className={`agent-toggle-btn ${p.enabled ? "on" : "off"}`}
                        onClick={() => handleToggleProvider(p)}
                      >
                        {p.enabled ? "ON" : "OFF"}
                      </button>
                    </div>
                    <div className="agent-provider-models">
                      {p.models.map((m) => (
                        <div key={m.id} className="agent-model-row">
                          <span className="agent-model-name">{m.name}</span>
                          <span className="agent-model-price">
                            ${m.input_price_per_m.toFixed(2)}/{m.output_price_per_m.toFixed(2)} per M
                          </span>
                          <span className="agent-model-ctx">
                            {(m.context_window / 1000).toFixed(0)}K ctx
                          </span>
                          <span className="agent-model-features">
                            {m.supports_streaming ? "stream" : ""}{" "}
                            {m.supports_tools ? "tools" : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                    {p.api_key_env && (
                      <div className="agent-provider-env">
                        Env: <code>{p.api_key_env}</code>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ═══ Router Tab ═══ */}
          {tab === "router" && routerConfig && (
            <div className="agent-router-view">
              {/* Config */}
              <div className="agent-router-config">
                <h4 className="agent-section-title">Routing Configuration</h4>
                <div className="agent-form-row">
                  <div className="agent-form-group">
                    <label className="agent-form-label">Strategy</label>
                    <select
                      className="agent-form-select"
                      value={routerConfig.strategy}
                      onChange={(e) =>
                        setRouterConfig({
                          ...routerConfig,
                          strategy: e.target.value as RoutingStrategy,
                        })
                      }
                    >
                      {Object.entries(STRATEGY_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="agent-form-group">
                    <label className="agent-form-label">Default Provider</label>
                    <select
                      className="agent-form-select"
                      value={routerConfig.default_provider}
                      onChange={(e) =>
                        setRouterConfig({
                          ...routerConfig,
                          default_provider: e.target.value,
                        })
                      }
                    >
                      {providers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="agent-form-group">
                    <label className="agent-form-label">Fallback</label>
                    <select
                      className="agent-form-select"
                      value={routerConfig.fallback_provider || ""}
                      onChange={(e) =>
                        setRouterConfig({
                          ...routerConfig,
                          fallback_provider: e.target.value || null,
                        })
                      }
                    >
                      <option value="">None</option>
                      {providers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="agent-form-row">
                  <div className="agent-form-group">
                    <label className="agent-form-label">Max Retries</label>
                    <input
                      type="number"
                      className="agent-form-input"
                      value={routerConfig.max_retries}
                      onChange={(e) =>
                        setRouterConfig({
                          ...routerConfig,
                          max_retries: parseInt(e.target.value) || 0,
                        })
                      }
                      min={0}
                      max={10}
                    />
                  </div>
                  <div className="agent-form-group">
                    <label className="agent-form-label">Timeout (ms)</label>
                    <input
                      type="number"
                      className="agent-form-input"
                      value={routerConfig.timeout_ms}
                      onChange={(e) =>
                        setRouterConfig({
                          ...routerConfig,
                          timeout_ms: parseInt(e.target.value) || 30000,
                        })
                      }
                      step={5000}
                    />
                  </div>
                  <div className="agent-form-group">
                    <label className="agent-form-label">Cost Threshold</label>
                    <input
                      type="number"
                      className="agent-form-input"
                      value={routerConfig.cost_threshold_usd}
                      onChange={(e) =>
                        setRouterConfig({
                          ...routerConfig,
                          cost_threshold_usd:
                            parseFloat(e.target.value) || 0.01,
                        })
                      }
                      step={0.01}
                    />
                  </div>
                </div>
                <button
                  className="agent-action-btn primary"
                  onClick={handleSaveRouterConfig}
                >
                  Save Config
                </button>
              </div>

              {/* Route tester */}
              <div className="agent-route-test">
                <h4 className="agent-section-title">Test Routing</h4>
                <div className="agent-form-row">
                  <input
                    type="text"
                    className="agent-form-input"
                    placeholder="Task type (e.g. code_generation)"
                    value={routeTaskType}
                    onChange={(e) => setRouteTaskType(e.target.value)}
                  />
                  <label className="agent-checkbox-label">
                    <input
                      type="checkbox"
                      checked={routeNeedsTools}
                      onChange={(e) => setRouteNeedsTools(e.target.checked)}
                    />
                    Needs tools
                  </label>
                  <button
                    className="agent-action-btn primary"
                    onClick={handleTestRoute}
                  >
                    Route
                  </button>
                </div>
                {routeResult && (
                  <div className="agent-route-result">
                    <div className="agent-route-result-row">
                      <span className="agent-route-label">Provider:</span>
                      <span>{routeResult.selected_provider}</span>
                    </div>
                    <div className="agent-route-result-row">
                      <span className="agent-route-label">Model:</span>
                      <span>{routeResult.selected_model}</span>
                    </div>
                    <div className="agent-route-result-row">
                      <span className="agent-route-label">Reason:</span>
                      <span>{routeResult.reason}</span>
                    </div>
                    {routeResult.fallback_used && (
                      <div className="agent-route-fallback">Fallback used</div>
                    )}
                  </div>
                )}
              </div>

              {/* Stats */}
              {routerStats && (
                <div className="agent-router-stats">
                  <h4 className="agent-section-title">Router Stats</h4>
                  <div className="agent-stats-grid">
                    <div className="agent-stat-card">
                      <span className="agent-stat-value">
                        {routerStats.total_providers}
                      </span>
                      <span className="agent-stat-label">Providers</span>
                    </div>
                    <div className="agent-stat-card">
                      <span className="agent-stat-value">
                        {routerStats.enabled_providers}
                      </span>
                      <span className="agent-stat-label">Enabled</span>
                    </div>
                    <div className="agent-stat-card">
                      <span className="agent-stat-value">
                        {routerStats.total_models}
                      </span>
                      <span className="agent-stat-label">Models</span>
                    </div>
                    <div className="agent-stat-card">
                      <span className="agent-stat-value">
                        {routerStats.total_routing_decisions}
                      </span>
                      <span className="agent-stat-label">Decisions</span>
                    </div>
                    <div className="agent-stat-card">
                      <span className="agent-stat-value">
                        {routerStats.fallback_count}
                      </span>
                      <span className="agent-stat-label">Fallbacks</span>
                    </div>
                  </div>

                  {/* Health */}
                  {routerStats.provider_health.length > 0 && (
                    <div className="agent-health-list">
                      <h4 className="agent-section-title">Provider Health</h4>
                      {routerStats.provider_health.map((h) => (
                        <div key={h.provider_id} className="agent-health-row">
                          <span className="agent-health-name">
                            {h.provider_id}
                          </span>
                          <span
                            className="agent-health-status"
                            style={{
                              color:
                                h.status === "Healthy"
                                  ? "var(--success)"
                                  : h.status === "Degraded"
                                  ? "var(--warning)"
                                  : "var(--danger)",
                            }}
                          >
                            {h.status}
                          </span>
                          <span className="agent-health-latency">
                            {h.avg_latency_ms}ms
                          </span>
                          <span className="agent-health-reqs">
                            {h.requests_today} reqs
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
