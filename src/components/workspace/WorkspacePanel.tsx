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

type WorkspaceTab = "overview" | "modules" | "drift" | "patterns" | "impact" | "code";

interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
}

interface SearchMatchItem {
  file: string;
  line_number: number;
  line: string;
}

interface FileTreeNode {
  name: string;
  path: string;
  is_dir: boolean;
  children: FileTreeNode[];
}

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

  // Code browsing state
  const [currentDir, setCurrentDir] = useState<string | null>(null);
  const [dirEntries, setDirEntries] = useState<DirEntry[]>([]);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [viewingFilePath, setViewingFilePath] = useState<string | null>(null);
  const [codeSearchQuery, setCodeSearchQuery] = useState("");
  const [codeSearchResults, setCodeSearchResults] = useState<SearchMatchItem[]>([]);
  const [codeSearching, setCodeSearching] = useState(false);
  const [fileTree, setFileTree] = useState<FileTreeNode | null>(null);

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
    if (visible && projectPath) {
      loadIntelligence();
      setCurrentDir(projectPath);
    }
  }, [visible, projectPath, loadIntelligence]);

  useEffect(() => {
    if (currentDir && tab === "code") {
      loadDirectory(currentDir);
    }
  }, [currentDir, tab]);

  const loadDirectory = useCallback(async (dir: string) => {
    try {
      const entries = await invoke<DirEntry[]>("list_directory", { dirPath: dir });
      setDirEntries(entries);
      setFileContent(null);
      setViewingFilePath(null);
    } catch (e) {
      onToast(`Failed to list directory: ${e}`, "error");
    }
  }, [onToast]);

  const handleOpenFile = useCallback(async (filePath: string) => {
    try {
      const content = await invoke<string>("read_file", { filePath });
      setFileContent(content);
      setViewingFilePath(filePath);
    } catch (e) {
      onToast(`Failed to read file: ${e}`, "error");
    }
  }, [onToast]);

  const handleNavigateDir = useCallback((dirPath: string) => {
    setCurrentDir(dirPath);
    setFileContent(null);
    setViewingFilePath(null);
  }, []);

  const handleGoUp = useCallback(() => {
    if (!currentDir || !projectPath) return;
    const parent = currentDir.replace(/[\\/][^\\/]+$/, "");
    if (parent.length >= projectPath.length) {
      setCurrentDir(parent);
    }
  }, [currentDir, projectPath]);

  const handleCodeSearch = useCallback(async () => {
    if (!projectPath || !codeSearchQuery.trim()) return;
    setCodeSearching(true);
    try {
      const results = await invoke<SearchMatchItem[]>("search_files", {
        projectPath,
        query: codeSearchQuery,
        fileExtensions: null,
      });
      setCodeSearchResults(results);
    } catch (e) {
      onToast(`Code search failed: ${e}`, "error");
    } finally {
      setCodeSearching(false);
    }
  }, [projectPath, codeSearchQuery, onToast]);

  const handleLoadTree = useCallback(async () => {
    if (!projectPath) return;
    try {
      const tree = await invoke<FileTreeNode>("get_file_tree", { projectPath, maxDepth: 3 });
      setFileTree(tree);
    } catch (e) {
      onToast(`Failed to load file tree: ${e}`, "error");
    }
  }, [projectPath, onToast]);

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
          {(["overview", "modules", "drift", "patterns", "impact", "code"] as WorkspaceTab[]).map((t) => (
            <button key={t} className={`tab-btn ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
              {t === "code" ? "Code" : t.charAt(0).toUpperCase() + t.slice(1)}
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
          {tab === "code" && (
            <div className="data-list">
              {/* Search bar */}
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <input
                  type="text"
                  value={codeSearchQuery}
                  onChange={(e) => setCodeSearchQuery(e.target.value)}
                  placeholder="Search in codebase..."
                  onKeyDown={(e) => e.key === "Enter" && handleCodeSearch()}
                  style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text)" }}
                />
                <button className="tab-btn active" onClick={handleCodeSearch} disabled={codeSearching}>
                  {codeSearching ? "Searching..." : "Search"}
                </button>
                <button className="tab-btn" onClick={handleLoadTree} title="Load file tree">
                  <i className="fa-solid fa-sitemap" />
                </button>
              </div>

              {/* Search results */}
              {codeSearchResults.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <h4>Search Results ({codeSearchResults.length})</h4>
                  <div style={{ maxHeight: 300, overflow: "auto" }}>
                    {codeSearchResults.map((r, i) => (
                      <div key={i}
                        style={{ padding: "4px 8px", cursor: "pointer", borderBottom: "1px solid var(--border)", fontSize: "0.85em" }}
                        onClick={() => handleOpenFile(r.file)}
                      >
                        <span style={{ color: "var(--accent)" }}>{r.file.split(/[\\/]/).pop()}</span>
                        <span style={{ color: "var(--text-muted)", marginLeft: 4 }}>:{r.line_number}</span>
                        <div style={{ color: "var(--text-muted)", whiteSpace: "pre", overflow: "hidden", textOverflow: "ellipsis" }}>{r.line}</div>
                      </div>
                    ))}
                  </div>
                  <button className="tab-btn" onClick={() => setCodeSearchResults([])} style={{ marginTop: 8 }}>Clear Results</button>
                </div>
              )}

              {/* File tree view */}
              {fileTree && !viewingFilePath && (
                <div style={{ marginBottom: 16 }}>
                  <h4>File Tree</h4>
                  <TreeView node={fileTree} onOpen={handleOpenFile} onNavigate={handleNavigateDir} depth={0} />
                </div>
              )}

              {/* Directory browser */}
              {!viewingFilePath && (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <button className="tab-btn" onClick={handleGoUp} disabled={!currentDir || currentDir === projectPath}>
                      <i className="fa-solid fa-arrow-up" />
                    </button>
                    <span style={{ fontSize: "0.85em", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {currentDir || projectPath || "No project"}
                    </span>
                  </div>
                  {dirEntries.map((entry) => (
                    <div
                      key={entry.path}
                      style={{ padding: "4px 8px", cursor: "pointer", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}
                      onClick={() => entry.is_dir ? handleNavigateDir(entry.path) : handleOpenFile(entry.path)}
                    >
                      <i className={`fa-solid ${entry.is_dir ? "fa-folder" : "fa-file-code"}`}
                        style={{ color: entry.is_dir ? "var(--accent)" : "var(--text-muted)", width: 16 }} />
                      <span>{entry.name}</span>
                      {!entry.is_dir && <span style={{ marginLeft: "auto", fontSize: "0.8em", color: "var(--text-muted)" }}>{formatSize(entry.size)}</span>}
                    </div>
                  ))}
                </div>
              )}

              {/* File content viewer */}
              {viewingFilePath && fileContent !== null && (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <button className="tab-btn" onClick={() => { setViewingFilePath(null); setFileContent(null); }}>
                      <i className="fa-solid fa-arrow-left" /> Back
                    </button>
                    <span style={{ fontSize: "0.85em", fontWeight: 600 }}>{viewingFilePath.split(/[\\/]/).pop()}</span>
                    <span style={{ fontSize: "0.8em", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis" }}>{viewingFilePath}</span>
                  </div>
                  <pre style={{
                    background: "var(--bg-secondary)",
                    padding: 12,
                    borderRadius: 8,
                    overflow: "auto",
                    maxHeight: 500,
                    fontSize: "0.82em",
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    border: "1px solid var(--border)",
                  }}>
                    {fileContent}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function TreeView({ node, onOpen, onNavigate, depth }: {
  node: FileTreeNode;
  onOpen: (path: string) => void;
  onNavigate: (path: string) => void;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(depth < 1);
  if (!node.is_dir) {
    return (
      <div
        style={{ paddingLeft: depth * 16, padding: "2px 4px", cursor: "pointer", fontSize: "0.85em" }}
        onClick={() => onOpen(node.path)}
      >
        <i className="fa-solid fa-file-code" style={{ color: "var(--text-muted)", marginRight: 6, width: 12 }} />
        {node.name}
      </div>
    );
  }
  return (
    <div>
      <div
        style={{ paddingLeft: depth * 16, padding: "2px 4px", cursor: "pointer", fontSize: "0.85em", fontWeight: 500 }}
        onClick={() => setExpanded(!expanded)}
      >
        <i className={`fa-solid ${expanded ? "fa-folder-open" : "fa-folder"}`} style={{ color: "var(--accent)", marginRight: 6, width: 12 }} />
        {node.name}
        <span style={{ color: "var(--text-muted)", marginLeft: 6, fontSize: "0.8em" }}>({node.children.length})</span>
      </div>
      {expanded && node.children.map((child) => (
        <TreeView key={child.path} node={child} onOpen={onOpen} onNavigate={onNavigate} depth={depth + 1} />
      ))}
    </div>
  );
}
