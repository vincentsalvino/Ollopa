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

        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe what you're working on..."
              onKeyDown={(e) => e.key === "Enter" && runAnalysis()}
              style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text)" }}
            />
            <button className="tab-btn active" onClick={runAnalysis} disabled={loading}>
              {loading ? "..." : "Analyze"}
            </button>
          </div>
          <input
            type="text"
            value={currentFile}
            onChange={(e) => setCurrentFile(e.target.value)}
            placeholder="Current file (optional)..."
            style={{ width: "100%", padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text)", fontSize: "0.85em" }}
          />
        </div>

        <div className="panel-tabs">
          {(["suggestions", "context", "workflows"] as PredictiveTab[]).map((t) => (
            <button key={t} className={`tab-btn ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
              {t === "suggestions" && suggestions.length > 0 && ` (${suggestions.length})`}
              {t === "workflows" && recommendations.length > 0 && ` (${recommendations.length})`}
            </button>
          ))}
        </div>

        <div className="panel-body">
          {!analysis && !loading && (
            <p style={{ color: "var(--text-muted)", textAlign: "center", padding: 20 }}>
              Enter a prompt to get predictive suggestions, context assembly, and workflow recommendations.
            </p>
          )}

          {tab === "suggestions" && suggestions.length > 0 && (
            <div className="data-list">
              {suggestions.map((s, i) => (
                <div key={i} style={{
                  padding: "10px 12px",
                  marginBottom: 8,
                  borderRadius: 6,
                  background: "var(--bg-secondary)",
                  border: "1px solid var(--border)",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <strong>{s.title}</strong>
                    <span style={{
                      fontSize: "0.75em",
                      padding: "2px 6px",
                      borderRadius: 4,
                      background: s.confidence > 0.7 ? "var(--success)" : "var(--warning)",
                      color: "#fff",
                    }}>
                      {(s.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div style={{ fontSize: "0.85em", color: "var(--text-muted)", marginTop: 4 }}>
                    {s.description}
                  </div>
                  {s.related_files.length > 0 && (
                    <div style={{ fontSize: "0.8em", marginTop: 4 }}>
                      Files: {s.related_files.slice(0, 3).join(", ")}
                    </div>
                  )}
                  {s.related_decisions.length > 0 && (
                    <div style={{ fontSize: "0.8em", marginTop: 2 }}>
                      Decisions: {s.related_decisions.slice(0, 3).join(", ")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {tab === "context" && context && (
            <div className="data-list">
              <div style={{ padding: "8px 12px", background: "var(--bg-secondary)", borderRadius: 6, marginBottom: 12 }}>
                <strong>Assembled Context</strong>
                <span style={{ float: "right", fontSize: "0.8em", color: "var(--text-muted)" }}>
                  ~{context.total_tokens} tokens
                </span>
              </div>

              {context.prior_decisions.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <h5>Prior Decisions</h5>
                  {context.prior_decisions.map((d, i) => (
                    <div key={i} style={{ fontSize: "0.85em", padding: "4px 0", borderBottom: "1px solid var(--border)" }}>{d}</div>
                  ))}
                </div>
              )}

              {context.related_summaries.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <h5>Related Context</h5>
                  {context.related_summaries.map((s, i) => (
                    <div key={i} style={{ fontSize: "0.85em", padding: "4px 0", color: "var(--text-muted)" }}>{s}</div>
                  ))}
                </div>
              )}

              {context.architectural_context && (
                <div style={{ marginBottom: 12 }}>
                  <h5>Architecture</h5>
                  <div style={{ fontSize: "0.85em" }}>{context.architectural_context}</div>
                </div>
              )}

              {context.workflow_hints.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <h5>Workflow Hints</h5>
                  {context.workflow_hints.map((h, i) => (
                    <div key={i} style={{ fontSize: "0.85em", color: "var(--text-muted)" }}>{h}</div>
                  ))}
                </div>
              )}

              {context.relevant_files.length > 0 && (
                <div>
                  <h5>Relevant Files</h5>
                  {context.relevant_files.map((f, i) => (
                    <div key={i} style={{ fontSize: "0.85em", fontFamily: "monospace" }}>{f}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "workflows" && recommendations.length > 0 && (
            <div className="data-list">
              {recommendations.map((r, i) => (
                <div key={i} style={{
                  padding: "10px 12px",
                  marginBottom: 10,
                  borderRadius: 6,
                  background: "var(--bg-secondary)",
                  border: "1px solid var(--border)",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <strong>{r.title}</strong>
                    <span style={{ fontSize: "0.8em", color: "var(--text-muted)" }}>
                      ~{r.estimated_tokens} tokens
                    </span>
                  </div>
                  <div style={{ fontSize: "0.85em", color: "var(--text-muted)", marginTop: 4 }}>
                    {r.description}
                  </div>
                  <div style={{ marginTop: 8 }}>
                    {r.steps.map((step, si) => (
                      <div key={si} style={{ fontSize: "0.8em", padding: "2px 0", paddingLeft: 12 }}>
                        {si + 1}. {step}
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
