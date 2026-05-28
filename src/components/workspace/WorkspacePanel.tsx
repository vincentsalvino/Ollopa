import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  ToastMessage,
  WorkspaceIntelligence,
  ChangeImpact,
  RepoMap,
  DriftReport,
  WorkflowPatternInfo,
} from "../../types";

type WorkspaceTab = "overview" | "modules" | "drift" | "patterns" | "impact" | "indexer";

interface WorkspacePanelProps {
  visible: boolean;
  onClose: () => void;
  onToast: (text: string, type: ToastMessage["type"]) => void;
  projectPath: string | null;
}

export default function WorkspacePanel({
  visible,
  onClose,
  onToast,
  projectPath,
}: WorkspacePanelProps) {
  const [tab, setTab] = useState<WorkspaceTab>("overview");
  const [intel, setIntel] = useState<WorkspaceIntelligence | null>(null);
  const [impact, setImpact] = useState<ChangeImpact | null>(null);
  const [impactFile, setImpactFile] = useState("");
  const [loading, setLoading] = useState(false);

  // Indexer state
  const [indexData, setIndexData] = useState<{ files: { path: string; language: string }[]; symbols: { name: string; kind: string; file_path: string; line: number }[]; last_indexed: number } | null>(null);
  const [indexing, setIndexing] = useState(false);

  const loadIntelligence = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    try {
      const data = await invoke<WorkspaceIntelligence>("workspace_intelligence", {
        projectPath,
      });
      setIntel(data);
    } catch (e) {
      onToast(`Failed to load workspace intelligence: ${e}`, "error");
    } finally {
      setLoading(false);
    }
  }, [projectPath, onToast]);

  useEffect(() => {
    if (visible && projectPath) loadIntelligence();
  }, [visible, projectPath, loadIntelligence]);

  const handleCheckImpact = useCallback(async () => {
    if (!projectPath || !impactFile) return;
    try {
      const data = await invoke<ChangeImpact>("workspace_predict_impact", {
        projectPath,
        targetFile: impactFile,
      });
      setImpact(data);
    } catch (e) {
      onToast(`Impact analysis failed: ${e}`, "error");
    }
  }, [projectPath, impactFile, onToast]);

  const handleReindex = useCallback(async () => {
    if (!projectPath) return;
    setIndexing(true);
    try {
      const data = await invoke<typeof indexData>("codebase_index", { projectPath });
      setIndexData(data);
      onToast("Indexing complete", "success");
    } catch (e) {
      onToast(`Indexing failed: ${e}`, "error");
    } finally {
      setIndexing(false);
    }
  }, [projectPath, onToast]);

  if (!visible) return null;

  const map: RepoMap | null = intel?.repo_map ?? null;
  const drift: DriftReport | null = intel?.drift_report ?? null;
  const patterns: WorkflowPatternInfo[] = intel?.workflow_patterns ?? [];

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="panel-container panel-lg" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <h3><i className="fa-solid fa-building" /> Workspace Intelligence</h3>
          <button className="panel-close" onClick={onClose}><i className="fa-solid fa-xmark" /></button>
        </div>

        <div className="panel-tabs">
          {(["overview", "modules", "drift", "patterns", "impact", "indexer"] as WorkspaceTab[]).map((t) => (
            <button key={t} className={`tab-btn ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        <div className="panel-body">
          {loading && <div className="loading-indicator">Analyzing workspace...</div>}

          {tab === "overview" && intel && (
            <div className="stat-grid">
              <div className="stat-card">
                <div className="stat-label">Modules</div>
                <div className="stat-value">{intel.total_modules}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Health Score</div>
                <div className="stat-value" style={{
                  color: intel.health_score >= 80 ? "var(--success)" : intel.health_score >= 50 ? "var(--warning)" : "var(--danger)"
                }}>
                  {intel.health_score.toFixed(0)}%
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Hot Files</div>
                <div className="stat-value">{intel.hot_files_count}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Patterns</div>
                <div className="stat-value">{intel.workflow_patterns.length}</div>
              </div>
              {drift && (
                <div className="stat-card">
                  <div className="stat-label">Coupling Score</div>
                  <div className="stat-value">{drift.coupling_score.toFixed(1)}</div>
                </div>
              )}
              {drift && (
                <div className="stat-card">
                  <div className="stat-label">Drift Violations</div>
                  <div className="stat-value" style={{
                    color: drift.violations.length > 0 ? "var(--warning)" : "var(--success)"
                  }}>
                    {drift.violations.length}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "modules" && map && (
            <div className="data-list">
              <h4>Repository Modules ({map.modules.length})</h4>
              {map.modules.map((m) => (
                <div key={m.name} className="list-item" style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                  <div>
                    <strong>{m.name}</strong>
                    <span style={{ color: "var(--text-muted)", marginLeft: 8, fontSize: "0.85em" }}>{m.language}</span>
                  </div>
                  <div style={{ fontSize: "0.85em", color: "var(--text-muted)" }}>
                    {m.file_count} files / {m.line_count.toLocaleString()} lines
                    {m.dependencies.length > 0 && (
                      <span style={{ marginLeft: 8 }}>deps: {m.dependencies.join(", ")}</span>
                    )}
                  </div>
                </div>
              ))}
              {map.boundaries.length > 0 && (
                <>
                  <h4 style={{ marginTop: 16 }}>Architectural Boundaries</h4>
                  {map.boundaries.map((b) => (
                    <div key={b.name} style={{ padding: "4px 0" }}>
                      <strong>{b.name}</strong> ({b.boundary_type}): {b.modules.join(", ")}
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {tab === "drift" && drift && (
            <div className="data-list">
              <h4>Architecture Health: {drift.health_score.toFixed(0)}%</h4>
              <p style={{ color: "var(--text-muted)", fontSize: "0.85em" }}>
                Coupling score: {drift.coupling_score.toFixed(2)}
              </p>
              {drift.violations.length === 0 ? (
                <p style={{ color: "var(--success)" }}>No drift violations detected.</p>
              ) : (
                drift.violations.map((v, i) => (
                  <div key={i} style={{
                    padding: "8px 12px",
                    marginBottom: 8,
                    borderRadius: 6,
                    background: v.severity === "warning" ? "rgba(255,170,0,0.1)" : "rgba(150,150,150,0.1)",
                    border: `1px solid ${v.severity === "warning" ? "var(--warning)" : "var(--border)"}`,
                  }}>
                    <div style={{ fontWeight: 600, fontSize: "0.9em" }}>
                      [{v.severity.toUpperCase()}] {v.violation_type}
                    </div>
                    <div style={{ fontSize: "0.85em", marginTop: 4 }}>{v.description}</div>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === "patterns" && (
            <div className="data-list">
              <h4>Detected Workflow Patterns</h4>
              {patterns.length === 0 ? (
                <p style={{ color: "var(--text-muted)" }}>No patterns detected yet.</p>
              ) : (
                patterns.map((p, i) => (
                  <div key={i} style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                    <div style={{ fontWeight: 600 }}>{p.pattern_type}</div>
                    <div style={{ fontSize: "0.85em", color: "var(--text-muted)" }}>{p.description}</div>
                    <div style={{ fontSize: "0.8em", marginTop: 4 }}>
                      Frequency: {p.frequency} | Files: {p.files_involved.slice(0, 3).join(", ")}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === "impact" && (
            <div className="data-list">
              <h4>Change Impact Analysis</h4>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <input
                  type="text"
                  value={impactFile}
                  onChange={(e) => setImpactFile(e.target.value)}
                  placeholder="Enter file path to analyze..."
                  style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text)" }}
                />
                <button className="tab-btn active" onClick={handleCheckImpact}>Analyze</button>
              </div>
              {impact && (
                <div>
                  <div style={{ padding: "8px 12px", borderRadius: 6, background: "var(--bg-secondary)", marginBottom: 12 }}>
                    <div>Risk Level: <strong style={{
                      color: impact.risk_level === "high" ? "var(--danger)" : impact.risk_level === "medium" ? "var(--warning)" : "var(--success)"
                    }}>{impact.risk_level.toUpperCase()}</strong></div>
                    <div style={{ fontSize: "0.85em", marginTop: 4 }}>
                      {impact.affected_files.length} affected files, {impact.affected_modules.length} affected modules
                    </div>
                  </div>
                  {impact.regression_risk.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <strong>Regression Risks:</strong>
                      {impact.regression_risk.map((r, i) => (
                        <div key={i} style={{ fontSize: "0.85em", color: "var(--warning)", paddingLeft: 12 }}>{r}</div>
                      ))}
                    </div>
                  )}
                  <div>
                    <strong>Affected Files:</strong>
                    {impact.affected_files.map((f, i) => (
                      <div key={i} style={{ fontSize: "0.85em", paddingLeft: 12, color: "var(--text-muted)" }}>{f}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "indexer" && (
            <div className="data-list">
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <h4 style={{ margin: 0 }}>Codebase Indexer</h4>
                <button
                  className="tab-btn active"
                  onClick={handleReindex}
                  disabled={indexing || !projectPath}
                  style={{ fontSize: 12, padding: "4px 10px" }}
                >
                  {indexing ? "Indexing..." : "Re-index"}
                </button>
              </div>
              {indexData ? (
                <>
                  <div className="stat-grid" style={{ marginBottom: 12 }}>
                    <div className="stat-card">
                      <div className="stat-label">Files</div>
                      <div className="stat-value">{indexData.files.length}</div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-label">Symbols</div>
                      <div className="stat-value">{indexData.symbols.length}</div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-label">Last Indexed</div>
                      <div className="stat-value" style={{ fontSize: 12 }}>
                        {new Date(indexData.last_indexed).toLocaleTimeString()}
                      </div>
                    </div>
                  </div>
                  <div style={{ maxHeight: 300, overflow: "auto" }}>
                    <strong>Languages:</strong>
                    {Object.entries(
                      indexData.files.reduce((acc: Record<string, number>, f) => {
                        acc[f.language] = (acc[f.language] || 0) + 1;
                        return acc;
                      }, {})
                    ).sort((a, b) => b[1] - a[1]).map(([lang, count]) => (
                      <div key={lang} style={{ fontSize: "0.85em", paddingLeft: 12 }}>
                        {lang}: {count} files
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div style={{ opacity: 0.5, textAlign: "center", padding: 20 }}>
                  {projectPath ? "Click Re-index to scan the project" : "Select a project first"}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
