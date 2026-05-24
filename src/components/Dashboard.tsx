import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CostData, PlanGateData } from "../App";

interface DashboardProps {
  sessionCost: CostData;
  totalCost: CostData;
  memoryLines: string[];
  planGate: PlanGateData | null;
  onPlanApproval: () => void;
  onPlanDeny: () => void;
  hasApprovalPending: boolean;
  projectPath: string | null;
  projectName: string | null;
  onMemoryReload: () => void;
}

function Dashboard({
  sessionCost,
  totalCost,
  memoryLines,
  planGate,
  onPlanApproval,
  onPlanDeny,
  hasApprovalPending,
  projectPath,
  projectName,
  onMemoryReload,
}: DashboardProps) {
  const [collapsed, setCollapsed] = useState(false);

  // Feature 7: Memory Editor
  const [editingMemory, setEditingMemory] = useState(false);
  const [memoryContent, setMemoryContent] = useState("");
  const [memorySaving, setMemorySaving] = useState(false);

  const toggleSidebar = () => setCollapsed((c) => !c);

  const handleEditMemory = async () => {
    try {
      const content = await invoke<string>("get_full_memory");
      setMemoryContent(content);
      setEditingMemory(true);
    } catch (_) {}
  };

  const handleSaveMemory = async () => {
    setMemorySaving(true);
    try {
      await invoke("write_full_memory", { content: memoryContent });
      setEditingMemory(false);
      onMemoryReload();
    } catch (_) {}
    setMemorySaving(false);
  };

  const handleCancelMemory = () => {
    setEditingMemory(false);
    setMemoryContent("");
  };

  return (
    <div className={`dashboard-panel ${collapsed ? "collapsed" : ""}`}>
      {/* Mini view (collapsed) */}
      <div className="dashboard-mini">
        <span className="mini-icon" onClick={toggleSidebar} title="Expand sidebar">
          &#9776;
        </span>
        <div className="mini-divider" />
        <div className="mini-cost">${sessionCost.cost_usd.toFixed(4)}</div>
        <div className="mini-divider" />
        <div
          className={`mini-safety-dot ${hasApprovalPending ? "red" : "green"}`}
          title={hasApprovalPending ? "Approval Pending" : "Safe — Running"}
        />
      </div>

      {/* Full view (expanded) */}
      <div className="dashboard-full dashboard">
        {/* Toggle icon at top */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
          <span className="mini-icon" onClick={toggleSidebar} title="Collapse sidebar">
            &#9776;
          </span>
        </div>

        {planGate ? (
          <div className="card plan-review-card">
            <h3 className="card-title">Plan Review</h3>
            <p className="plan-meta">
              {planGate.file_count} files affected — review required
            </p>
            <div className="plan-content">
              {planGate.lines.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
            <div className="plan-buttons">
              <button className="btn-approve-plan" onClick={onPlanApproval}>
                Approve Plan
              </button>
              <button className="btn-deny-plan" onClick={onPlanDeny}>
                &#10005; Deny &amp; Revise
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Calibration — shows project info */}
            <div className="card">
              <h3 className="card-title">Project</h3>
              {projectName ? (
                <>
                  <p className="calibration-text">{projectName}</p>
                  <p className="project-path-display">{projectPath}</p>
                </>
              ) : (
                <p className="calibration-text">No project selected</p>
              )}
            </div>

            {/* Memory */}
            <div className="card">
              <h3 className="card-title">Memory</h3>
              {editingMemory ? (
                <div className="memory-editor">
                  <textarea
                    className="memory-textarea"
                    value={memoryContent}
                    onChange={(e) => setMemoryContent(e.target.value)}
                    rows={10}
                  />
                  <div className="memory-editor-buttons">
                    <button className="btn-memory-save" onClick={handleSaveMemory} disabled={memorySaving}>
                      {memorySaving ? "Saving..." : "Save"}
                    </button>
                    <button className="btn-memory-cancel" onClick={handleCancelMemory}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {memoryLines.length > 0 ? (
                    <div>
                      {memoryLines.map((line, i) => (
                        <div key={i} className="memory-line">
                          {line}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      No memory entries yet
                    </p>
                  )}
                  <button className="btn-edit-memory" onClick={handleEditMemory}>
                    Edit Memory
                  </button>
                </>
              )}
            </div>

            {/* Token Cost — session + all-time split */}
            <div className="card">
              <h3 className="card-title">Token Cost</h3>
              <div className="cost-row">
                <span className="cost-label">This session:</span>
                <span className="cost-main">${sessionCost.cost_usd.toFixed(4)}</span>
              </div>
              <div className="cost-detail">
                IN {(sessionCost.input_tokens / 1000).toFixed(1)}K &middot; OUT{" "}
                {(sessionCost.output_tokens / 1000).toFixed(1)}K
              </div>
              <div className="cost-divider" />
              <div className="cost-row">
                <span className="cost-label">All time:</span>
                <span className="cost-main cost-alltime">${totalCost.cost_usd.toFixed(4)}</span>
              </div>
              <div className="cost-detail">
                IN {(totalCost.input_tokens / 1000).toFixed(1)}K &middot; OUT{" "}
                {(totalCost.output_tokens / 1000).toFixed(1)}K
              </div>
            </div>

            {/* Safety Status */}
            <div className="card">
              <h3 className="card-title">Safety</h3>
              <div
                className={`safety-indicator ${hasApprovalPending ? "red" : "green"}`}
              >
                <span className="safety-dot" />
                <span>
                  {hasApprovalPending ? "Approval Pending" : "Safe — Running"}
                </span>
              </div>
            </div>

            {/* Shortcuts */}
            <div className="card">
              <h3 className="card-title">Shortcuts</h3>
              <div className="shortcuts-grid">
                <span className="shortcut-key">Enter</span>
                <span className="shortcut-desc">Send message</span>
                <span className="shortcut-key">Shift+Enter</span>
                <span className="shortcut-desc">New line</span>
                <span className="shortcut-key">/</span>
                <span className="shortcut-desc">Slash commands</span>
                <span className="shortcut-key">Esc</span>
                <span className="shortcut-desc">Close dropdown</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default Dashboard;
