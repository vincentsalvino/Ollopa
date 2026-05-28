import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  TokenBudget,
  OptimizationStats,
  OptimizationResult,
  RollingSummary,
  ToastMessage,
} from "../../types";

type OptimizerTab = "overview" | "budget" | "cache" | "rolling" | "context";

interface TokenPanelProps {
  visible: boolean;
  onClose: () => void;
  onToast: (text: string, type: ToastMessage["type"]) => void;
  projectPath: string | null;
}

function formatCost(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function formatDate(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export default function TokenPanel({
  visible,
  onClose,
  onToast,
  projectPath,
}: TokenPanelProps) {
  const [tab, setTab] = useState<OptimizerTab>("overview");
  const [stats, setStats] = useState<OptimizationStats | null>(null);
  const [budget, setBudget] = useState<TokenBudget | null>(null);
  const [rolling, setRolling] = useState<RollingSummary[]>([]);
  const [optimizedContext, setOptimizedContext] = useState<string>("");
  const [contextQuery, setContextQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [optimizing, setOptimizing] = useState(false);

  const loadStats = useCallback(async () => {
    try {
      const s = await invoke<OptimizationStats>("optimizer_get_stats");
      setStats(s);
    } catch (_) {}
  }, []);

  const loadBudget = useCallback(async () => {
    try {
      const b = await invoke<TokenBudget>("optimizer_get_budget");
      setBudget(b);
    } catch (_) {}
  }, []);

  const loadRolling = useCallback(async () => {
    try {
      const r = await invoke<RollingSummary[]>("optimizer_list_rolling");
      setRolling(r);
    } catch (_) {}
  }, []);

  const loadContext = useCallback(async () => {
    setLoading(true);
    try {
      const ctx = await invoke<string>("optimizer_build_context", {
        projectPath,
        query: contextQuery || null,
      });
      setOptimizedContext(ctx);
    } catch (e) {
      onToast(`Failed to build context: ${e}`, "error");
    }
    setLoading(false);
  }, [projectPath, contextQuery, onToast]);

  useEffect(() => {
    if (!visible) return;
    loadStats();
    loadBudget();
  }, [visible, loadStats, loadBudget]);

  useEffect(() => {
    if (visible && tab === "rolling") loadRolling();
    if (visible && tab === "context") loadContext();
  }, [visible, tab, loadRolling, loadContext]);

  const handleSaveBudget = async () => {
    if (!budget) return;
    try {
      await invoke("optimizer_save_budget", { budget });
      onToast("Budget saved", "success");
      loadStats();
    } catch (e) {
      onToast(`Failed to save budget: ${e}`, "error");
    }
  };

  const handleRunOptimization = async () => {
    setOptimizing(true);
    try {
      const result = await invoke<OptimizationResult>("optimizer_run");
      onToast(
        `Optimization complete: ${result.summaries_rolled} rolled, ${result.tokens_saved} tokens saved`,
        "success"
      );
      loadStats();
    } catch (e) {
      onToast(`Optimization failed: ${e}`, "error");
    }
    setOptimizing(false);
  };

  const handlePruneCache = async () => {
    try {
      const pruned = await invoke<number>("optimizer_prune_cache");
      onToast(`Pruned ${pruned} expired cache entries`, "info");
      loadStats();
    } catch (e) {
      onToast(`Prune failed: ${e}`, "error");
    }
  };

  const handleClearData = async () => {
    try {
      await invoke("optimizer_clear_data");
      onToast("Optimization data cleared", "info");
      loadStats();
    } catch (e) {
      onToast(`Clear failed: ${e}`, "error");
    }
  };

  if (!visible) return null;

  const tabs: { key: OptimizerTab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "budget", label: "Budget" },
    { key: "cache", label: "Cache" },
    { key: "rolling", label: "Rolling Summaries" },
    { key: "context", label: "Context Preview" },
  ];

  const budgetUsedPct = stats
    ? Math.min(100, (stats.current_month_usage.total_cost_usd / stats.budget.monthly_budget_usd) * 100)
    : 0;

  return (
    <div className="token-panel-overlay" onClick={onClose}>
      <div className="token-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="token-panel-header">
          <h3 className="token-panel-title">Token Optimizer</h3>
          {stats && (
            <span className="token-panel-badge">
              {formatCost(stats.budget_remaining_usd)} remaining
            </span>
          )}
          <button className="token-panel-close" onClick={onClose}>
            &times;
          </button>
        </div>

        {/* Tabs */}
        <div className="token-tabs">
          {tabs.map((t) => (
            <button
              key={t.key}
              className={`token-tab ${tab === t.key ? "active" : ""}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="token-content">
          {/* ═══ Overview Tab ═══ */}
          {tab === "overview" && stats && (
            <div className="token-overview">
              {/* Budget meter */}
              <div className="token-meter-card">
                <div className="token-meter-header">
                  <span className="token-meter-label">Monthly Budget</span>
                  <span className="token-meter-value">
                    {formatCost(stats.current_month_usage.total_cost_usd)} /{" "}
                    {formatCost(stats.budget.monthly_budget_usd)}
                  </span>
                </div>
                <div className="token-meter-bar">
                  <div
                    className="token-meter-fill"
                    style={{
                      width: `${budgetUsedPct}%`,
                      background:
                        budgetUsedPct > 90
                          ? "var(--danger)"
                          : budgetUsedPct > 70
                          ? "var(--warning)"
                          : "var(--success)",
                    }}
                  />
                </div>
                <div className="token-meter-footer">
                  <span>{budgetUsedPct.toFixed(1)}% used</span>
                  <span>
                    {stats.current_month_usage.days_tracked}d tracked &middot;{" "}
                    {stats.current_month_usage.session_count} sessions
                  </span>
                </div>
              </div>

              {/* Stats grid */}
              <div className="token-stats-grid">
                <div className="token-stat-card">
                  <span className="token-stat-value">
                    {formatCost(stats.daily_average_cost)}
                  </span>
                  <span className="token-stat-label">Daily Average</span>
                </div>
                <div className="token-stat-card">
                  <span className="token-stat-value">
                    {formatCost(stats.projected_monthly_cost)}
                  </span>
                  <span className="token-stat-label">Projected Monthly</span>
                </div>
                <div className="token-stat-card">
                  <span className="token-stat-value">
                    {formatTokens(stats.current_month_usage.input_tokens)}
                  </span>
                  <span className="token-stat-label">Input Tokens</span>
                </div>
                <div className="token-stat-card">
                  <span className="token-stat-value">
                    {formatTokens(stats.current_month_usage.output_tokens)}
                  </span>
                  <span className="token-stat-label">Output Tokens</span>
                </div>
                <div className="token-stat-card">
                  <span className="token-stat-value">
                    {stats.estimated_savings_pct}%
                  </span>
                  <span className="token-stat-label">Est. Savings</span>
                </div>
                <div className="token-stat-card">
                  <span className="token-stat-value">
                    {stats.rolling_summary_count}
                  </span>
                  <span className="token-stat-label">Rolling Summaries</span>
                </div>
              </div>

              {/* Actions */}
              <div className="token-actions">
                <button
                  className="token-action-btn primary"
                  onClick={handleRunOptimization}
                  disabled={optimizing}
                >
                  {optimizing ? "Optimizing..." : "Run Optimization"}
                </button>
                <button
                  className="token-action-btn"
                  onClick={handlePruneCache}
                >
                  Prune Cache
                </button>
              </div>
            </div>
          )}

          {/* ═══ Budget Tab ═══ */}
          {tab === "budget" && budget && (
            <div className="token-budget-form">
              <div className="token-form-group">
                <label className="token-form-label">Monthly Budget (USD)</label>
                <input
                  type="number"
                  className="token-form-input"
                  value={budget.monthly_budget_usd}
                  onChange={(e) =>
                    setBudget({ ...budget, monthly_budget_usd: parseFloat(e.target.value) || 0 })
                  }
                  step={0.5}
                  min={0}
                />
                <span className="token-form-hint">
                  Maximum monthly spend on DeepSeek API calls
                </span>
              </div>

              <div className="token-form-group">
                <label className="token-form-label">Max Context Tokens</label>
                <input
                  type="number"
                  className="token-form-input"
                  value={budget.max_context_tokens}
                  onChange={(e) =>
                    setBudget({ ...budget, max_context_tokens: parseInt(e.target.value) || 0 })
                  }
                  step={500}
                  min={500}
                />
                <span className="token-form-hint">
                  Maximum tokens injected into each prompt as context
                </span>
              </div>

              <div className="token-form-row">
                <div className="token-form-group">
                  <label className="token-form-label">Summary Tokens</label>
                  <input
                    type="number"
                    className="token-form-input"
                    value={budget.max_summary_tokens}
                    onChange={(e) =>
                      setBudget({ ...budget, max_summary_tokens: parseInt(e.target.value) || 0 })
                    }
                    step={100}
                    min={100}
                  />
                </div>
                <div className="token-form-group">
                  <label className="token-form-label">Decision Tokens</label>
                  <input
                    type="number"
                    className="token-form-input"
                    value={budget.max_decision_tokens}
                    onChange={(e) =>
                      setBudget({ ...budget, max_decision_tokens: parseInt(e.target.value) || 0 })
                    }
                    step={100}
                    min={100}
                  />
                </div>
                <div className="token-form-group">
                  <label className="token-form-label">Memory Tokens</label>
                  <input
                    type="number"
                    className="token-form-input"
                    value={budget.max_memory_tokens}
                    onChange={(e) =>
                      setBudget({ ...budget, max_memory_tokens: parseInt(e.target.value) || 0 })
                    }
                    step={100}
                    min={100}
                  />
                </div>
              </div>

              <div className="token-form-row">
                <div className="token-form-group">
                  <label className="token-form-label">Rolling Window (days)</label>
                  <input
                    type="number"
                    className="token-form-input"
                    value={budget.rolling_window_days}
                    onChange={(e) =>
                      setBudget({ ...budget, rolling_window_days: parseInt(e.target.value) || 7 })
                    }
                    step={1}
                    min={7}
                    max={90}
                  />
                  <span className="token-form-hint">
                    Sessions older than this get rolled into compressed summaries
                  </span>
                </div>
                <div className="token-form-group">
                  <label className="token-form-label">Cache TTL (minutes)</label>
                  <input
                    type="number"
                    className="token-form-input"
                    value={budget.cache_ttl_minutes}
                    onChange={(e) =>
                      setBudget({ ...budget, cache_ttl_minutes: parseInt(e.target.value) || 5 })
                    }
                    step={5}
                    min={1}
                    max={120}
                  />
                  <span className="token-form-hint">
                    How long cached prompt contexts remain valid
                  </span>
                </div>
              </div>

              <div className="token-form-actions">
                <button
                  className="token-action-btn primary"
                  onClick={handleSaveBudget}
                >
                  Save Budget
                </button>
                <button
                  className="token-action-btn danger"
                  onClick={handleClearData}
                >
                  Clear All Data
                </button>
              </div>
            </div>
          )}

          {/* ═══ Cache Tab ═══ */}
          {tab === "cache" && stats && (
            <div className="token-cache-view">
              <div className="token-stats-grid small">
                <div className="token-stat-card">
                  <span className="token-stat-value">
                    {stats.cache_stats.total_entries}
                  </span>
                  <span className="token-stat-label">Total Entries</span>
                </div>
                <div className="token-stat-card">
                  <span className="token-stat-value">
                    {stats.cache_stats.active_entries}
                  </span>
                  <span className="token-stat-label">Active</span>
                </div>
                <div className="token-stat-card">
                  <span className="token-stat-value">
                    {stats.cache_stats.total_hits}
                  </span>
                  <span className="token-stat-label">Total Hits</span>
                </div>
                <div className="token-stat-card">
                  <span className="token-stat-value">
                    {formatTokens(stats.cache_stats.total_token_savings)}
                  </span>
                  <span className="token-stat-label">Tokens Saved</span>
                </div>
                <div className="token-stat-card">
                  <span className="token-stat-value">
                    {(stats.cache_stats.cache_hit_rate * 100).toFixed(0)}%
                  </span>
                  <span className="token-stat-label">Hit Rate</span>
                </div>
              </div>

              <div className="token-cache-info">
                <p>
                  Prompt cache stores pre-built context strings for{" "}
                  <strong>{stats.budget.cache_ttl_minutes} minutes</strong>.
                  Repeated queries within the TTL reuse cached context, avoiding
                  redundant token computation.
                </p>
              </div>

              <div className="token-actions">
                <button
                  className="token-action-btn"
                  onClick={handlePruneCache}
                >
                  Prune Expired Entries
                </button>
              </div>
            </div>
          )}

          {/* ═══ Rolling Summaries Tab ═══ */}
          {tab === "rolling" && (
            <div className="token-rolling-view">
              {rolling.length === 0 ? (
                <div className="token-empty">
                  <p>No rolling summaries yet.</p>
                  <p className="token-empty-hint">
                    Run optimization to generate compressed summaries from older sessions.
                  </p>
                  <button
                    className="token-action-btn primary"
                    onClick={handleRunOptimization}
                    disabled={optimizing}
                  >
                    {optimizing ? "Optimizing..." : "Run Optimization"}
                  </button>
                </div>
              ) : (
                <div className="token-rolling-list">
                  {rolling.map((rs) => (
                    <div key={rs.id} className="token-rolling-card">
                      <div className="token-rolling-header">
                        <span className="token-rolling-period">
                          {formatDate(rs.period_start)} — {formatDate(rs.period_end)}
                        </span>
                        <span className="token-rolling-meta">
                          {rs.session_count} sessions &middot; {rs.token_count} tokens
                        </span>
                      </div>
                      <p className="token-rolling-content">{rs.content}</p>
                      {rs.key_themes.length > 0 && (
                        <div className="token-rolling-themes">
                          {rs.key_themes.map((t) => (
                            <span key={t} className="token-rolling-tag">
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ═══ Context Preview Tab ═══ */}
          {tab === "context" && (
            <div className="token-context-view">
              <div className="token-context-controls">
                <input
                  type="text"
                  className="token-context-query"
                  placeholder="Optional query to influence context retrieval..."
                  value={contextQuery}
                  onChange={(e) => setContextQuery(e.target.value)}
                />
                <button
                  className="token-action-btn primary"
                  onClick={loadContext}
                  disabled={loading}
                >
                  {loading ? "Building..." : "Build Context"}
                </button>
              </div>

              {optimizedContext && (
                <div className="token-context-preview">
                  <div className="token-context-meta">
                    <span>
                      ~{Math.ceil(optimizedContext.length / 3.5)} tokens
                    </span>
                    <span>{optimizedContext.length} chars</span>
                  </div>
                  <pre className="token-context-text">{optimizedContext}</pre>
                </div>
              )}

              {!optimizedContext && !loading && (
                <div className="token-empty">
                  <p>Click "Build Context" to preview what gets injected into prompts.</p>
                </div>
              )}
            </div>
          )}

          {!stats && tab === "overview" && (
            <div className="token-loading">Loading optimization data...</div>
          )}
        </div>
      </div>
    </div>
  );
}
