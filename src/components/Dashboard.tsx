import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CostData, ToolEvent } from "../App";

interface DashboardProps {
  sessionCost: CostData;
  totalCost: CostData;
  memoryLines: string[];
  activeTools: ToolEvent[];
  projectPath: string | null;
  projectName: string | null;
  onMemoryReload: () => void;
}

function Dashboard({
  sessionCost,
  totalCost,
  memoryLines,
  activeTools,
  projectPath,
  projectName,
  onMemoryReload,
}: DashboardProps) {
  const [collapsed, setCollapsed] = useState(false);

  // Memory Editor
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

  const recentTools = activeTools.slice(-10).reverse();

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
          className={`mini-safety-dot ${activeTools.some((t) => t.status === "started") ? "yellow" : "green"}`}
          title={activeTools.some((t) => t.status === "started") ? "Tool Running" : "Idle"}
        />
      </div>

      {/* Full view (expanded) */}
      <div className="dashboard-full dashboard">
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
          <span className="mini-icon" onClick={toggleSidebar} title="Collapse sidebar">
            &#9776;
          </span>
        </div>

        {/* Project Info */}
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
                <p className="calibration-text">No memory entries</p>
              )}
              <button className="btn-edit-memory" onClick={handleEditMemory}>
                Edit Memory
              </button>
            </>
          )}
        </div>

        {/* Session Cost */}
        <div className="card">
          <h3 className="card-title">Session Cost</h3>
          <div className="cost-row">
            <span>Input:</span>
            <span>{sessionCost.input_tokens.toLocaleString()} tokens</span>
          </div>
          <div className="cost-row">
            <span>Output:</span>
            <span>{sessionCost.output_tokens.toLocaleString()} tokens</span>
          </div>
          <div className="cost-row cost-total">
            <span>Cost:</span>
            <span>${sessionCost.cost_usd.toFixed(4)}</span>
          </div>
        </div>

        {/* Total Cost */}
        <div className="card">
          <h3 className="card-title">All-Time Cost</h3>
          <div className="cost-row">
            <span>Input:</span>
            <span>{totalCost.input_tokens.toLocaleString()} tokens</span>
          </div>
          <div className="cost-row">
            <span>Output:</span>
            <span>{totalCost.output_tokens.toLocaleString()} tokens</span>
          </div>
          <div className="cost-row cost-total">
            <span>Total:</span>
            <span>${totalCost.cost_usd.toFixed(4)}</span>
          </div>
        </div>

        {/* Tool Activity */}
        {recentTools.length > 0 && (
          <div className="card">
            <h3 className="card-title">Recent Tools</h3>
            <div className="tool-activity-list">
              {recentTools.map((tool) => (
                <div key={tool.tool_use_id} className={`tool-activity-item ${tool.status}`}>
                  <span className="tool-activity-name">{tool.tool_name}</span>
                  <span className={`tool-activity-status ${tool.status}`}>
                    {tool.status === "started" ? "running" : tool.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Dashboard;
