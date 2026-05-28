import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  ToastMessage,
  PredictiveAnalysis,
  PredictiveSuggestion,
  SmartContext,
  WorkflowRecommendation,
} from "../../types";

type PredictiveTab = "suggestions" | "context" | "workflows";

const TAB_META: Record<PredictiveTab, { icon: string; label: string }> = {
  suggestions: { icon: "fa-lightbulb", label: "Suggestions" },
  context: { icon: "fa-puzzle-piece", label: "Context" },
  workflows: { icon: "fa-route", label: "Workflows" },
};

interface PredictivePanelProps {
  visible: boolean;
  onClose: () => void;
  onToast: (text: string, type: ToastMessage["type"]) => void;
  projectPath: string | null;
}

export default function PredictivePanel({
  visible,
  onClose,
  onToast,
  projectPath,
}: PredictivePanelProps) {
  const [tab, setTab] = useState<PredictiveTab>("suggestions");
  const [prompt, setPrompt] = useState("");
  const [currentFile, setCurrentFile] = useState("");
  const [analysis, setAnalysis] = useState<PredictiveAnalysis | null>(null);
  const [loading, setLoading] = useState(false);

  const runAnalysis = useCallback(async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    try {
      const data = await invoke<PredictiveAnalysis>("predictive_analysis", {
        prompt,
        currentFile: currentFile || null,
        projectPath,
        maxContextTokens: 2000,
      });
      setAnalysis(data);
    } catch (e) {
      onToast(`Predictive analysis failed: ${e}`, "error");
    } finally {
      setLoading(false);
    }
  }, [prompt, currentFile, projectPath, onToast]);

  if (!visible) return null;

  const suggestions: PredictiveSuggestion[] = analysis?.suggestions ?? [];
  const context: SmartContext | null = analysis?.smart_context ?? null;
  const recommendations: WorkflowRecommendation[] = analysis?.recommendations ?? [];

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="panel-container panel-lg" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <h3><i className="fa-solid fa-wand-magic-sparkles" /> Predictive Workflows</h3>
          <button className="panel-close" onClick={onClose}><i className="fa-solid fa-xmark" /></button>
        </div>

        {/* Analysis Input */}
        <div className="predictive-input-section">
          <div className="predictive-input-row">
            <input
              type="text"
              className="predictive-prompt-input"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe what you're working on..."
              onKeyDown={(e) => e.key === "Enter" && runAnalysis()}
            />
            <button className="predictive-analyze-btn" onClick={runAnalysis} disabled={loading || !prompt.trim()}>
              {loading ? (
                <><i className="fa-solid fa-spinner fa-spin" /> Analyzing</>
              ) : (
                <><i className="fa-solid fa-bolt" /> Analyze</>
              )}
            </button>
          </div>
          <input
            type="text"
            className="predictive-file-input"
            value={currentFile}
            onChange={(e) => setCurrentFile(e.target.value)}
            placeholder="Current file path (optional)"
          />
        </div>

        {/* Tabs */}
        <div className="panel-tabs">
          {(["suggestions", "context", "workflows"] as PredictiveTab[]).map((t) => {
            const meta = TAB_META[t];
            const count = t === "suggestions" ? suggestions.length
              : t === "workflows" ? recommendations.length
              : 0;
            return (
              <button key={t} className={`tab-btn${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>
                <i className={`fa-solid ${meta.icon}`} />
                {meta.label}
                {count > 0 && <span className="tab-count">{count}</span>}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="panel-body">
          {/* Loading state */}
          {loading && (
            <div className="predictive-empty-state">
              <i className="fa-solid fa-spinner fa-spin predictive-empty-icon" />
              <p>Analyzing your workspace...</p>
            </div>
          )}

          {/* Empty state */}
          {!analysis && !loading && (
            <div className="predictive-empty-state">
              <i className="fa-solid fa-wand-magic-sparkles predictive-empty-icon" />
              <p className="predictive-empty-title">No analysis yet</p>
              <p className="predictive-empty-desc">
                Describe what you're working on above to get predictive suggestions, smart context assembly, and workflow recommendations.
              </p>
            </div>
          )}

          {/* Suggestions tab */}
          {!loading && tab === "suggestions" && analysis && (
            <div className="data-list">
              {suggestions.length === 0 ? (
                <div className="predictive-empty-state">
                  <i className="fa-solid fa-lightbulb predictive-empty-icon" />
                  <p className="predictive-empty-desc">No suggestions found. Try adding a file path or a more detailed prompt.</p>
                </div>
              ) : suggestions.map((s, i) => (
                <div key={i} className="predictive-card">
                  <div className="predictive-card-header">
                    <span className="predictive-card-title">{s.title}</span>
                    <span className={`predictive-confidence${s.confidence > 0.7 ? " high" : s.confidence > 0.4 ? " medium" : " low"}`}>
                      {(s.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                  <p className="predictive-card-desc">{s.description}</p>
                  {s.related_files.length > 0 && (
                    <div className="predictive-card-meta">
                      <i className="fa-solid fa-file-code" />
                      {s.related_files.slice(0, 3).join(", ")}
                    </div>
                  )}
                  {s.related_decisions.length > 0 && (
                    <div className="predictive-card-meta">
                      <i className="fa-solid fa-code-branch" />
                      {s.related_decisions.slice(0, 3).join(", ")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Context tab */}
          {!loading && tab === "context" && analysis && (
            <div className="data-list">
              {!context ? (
                <div className="predictive-empty-state">
                  <i className="fa-solid fa-puzzle-piece predictive-empty-icon" />
                  <p className="predictive-empty-desc">No context assembled yet.</p>
                </div>
              ) : (
                <>
                  <div className="predictive-context-header">
                    <span>Assembled Context</span>
                    <span className="predictive-token-badge">~{context.total_tokens} tokens</span>
                  </div>

                  {context.prior_decisions.length > 0 && (
                    <div className="predictive-section">
                      <h5><i className="fa-solid fa-gavel" /> Prior Decisions</h5>
                      {context.prior_decisions.map((d, i) => (
                        <div key={i} className="predictive-context-item">{d}</div>
                      ))}
                    </div>
                  )}

                  {context.related_summaries.length > 0 && (
                    <div className="predictive-section">
                      <h5><i className="fa-solid fa-layer-group" /> Related Context</h5>
                      {context.related_summaries.map((s, i) => (
                        <div key={i} className="predictive-context-item muted">{s}</div>
                      ))}
                    </div>
                  )}

                  {context.architectural_context && (
                    <div className="predictive-section">
                      <h5><i className="fa-solid fa-building" /> Architecture</h5>
                      <div className="predictive-context-item">{context.architectural_context}</div>
                    </div>
                  )}

                  {context.workflow_hints.length > 0 && (
                    <div className="predictive-section">
                      <h5><i className="fa-solid fa-route" /> Workflow Hints</h5>
                      {context.workflow_hints.map((h, i) => (
                        <div key={i} className="predictive-context-item muted">{h}</div>
                      ))}
                    </div>
                  )}

                  {context.relevant_files.length > 0 && (
                    <div className="predictive-section">
                      <h5><i className="fa-solid fa-file-code" /> Relevant Files</h5>
                      {context.relevant_files.map((f, i) => (
                        <div key={i} className="predictive-file-badge">{f}</div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Workflows tab */}
          {!loading && tab === "workflows" && analysis && (
            <div className="data-list">
              {recommendations.length === 0 ? (
                <div className="predictive-empty-state">
                  <i className="fa-solid fa-route predictive-empty-icon" />
                  <p className="predictive-empty-desc">No workflow recommendations found for this context.</p>
                </div>
              ) : recommendations.map((r, i) => (
                <div key={i} className="predictive-card">
                  <div className="predictive-card-header">
                    <span className="predictive-card-title">{r.title}</span>
                    <span className="predictive-token-badge">~{r.estimated_tokens} tokens</span>
                  </div>
                  <p className="predictive-card-desc">{r.description}</p>
                  <div className="predictive-steps">
                    {r.steps.map((step, si) => (
                      <div key={si} className="predictive-step">
                        <span className="predictive-step-num">{si + 1}</span>
                        <span>{step}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
