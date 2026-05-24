import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CostData, TimelineEntry, ToolUseData } from "../types";

interface DashboardProps {
  sessionCost: CostData;
  totalCost: CostData;
  memoryLines: string[];
  toolEntries: (TimelineEntry & { data: ToolUseData })[];
  stats: {
    totalTools: number;
    runningTools: number;
    successTools: number;
    errorTools: number;
    avgDuration: number;
  };
  projectPath: string | null;
  projectName: string | null;
  onMemoryReload: () => void;
}

export default function Dashboard({
  sessionCost,
  totalCost,
  memoryLines,
  toolEntries,
  stats,
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

  // Tool frequency map
  const toolFrequency: Record<string, number> = {};
  for (const entry of toolEntries) {
    const name = entry.data.tool_name;
    toolFrequency[name] = (toolFrequency[name] || 0) + 1;
  }
  const topTools = Object.entries(toolFrequency)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  const recentTools = toolEntries.slice(-8).reverse();

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
          className={`mini-safety-dot ${
            stats.runningTools > 0 ? "yellow" : "green"
          }`}
          title={
            stats.runningTools > 0
              ? `${stats.runningTools} tool(s) running`
              : "Idle"
          }
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

        {/* Execution Metrics */}
        <div className="card">
          <h3 className="card-title">Execution Metrics</h3>
          <div className="metrics-grid">
            <div className="metric-item">
              <div className="metric-value">{stats.totalTools}</div>
              <div className="metric-label">Total Tools</div>
            </div>
            <div className="metric-item">
              <div className="metric-value metric-running">{stats.runningTools}</div>
              <div className="metric-label">Running</div>
            </div>
            <div className="metric-item">
              <div className="metric-value metric-success">{stats.successTools}</div>
              <div className="metric-label">Success</div>
            </div>
            <div className="metric-item">
              <div className="metric-value metric-error">{stats.errorTools}</div>
              <div className="metric-label">Errors</div>
            </div>
          </div>
          {stats.avgDuration > 0 && (
            <div className="metric-avg">
              Avg duration: {stats.avgDuration < 1000
                ? `${Math.round(stats.avgDuration)}ms`
                : `${(stats.avgDuration / 1000).toFixed(1)}s`}
            </div>
          )}
        </div>

        {/* Tool Analytics */}
        {topTools.length > 0 && (
          <div className="card">
            <h3 className="card-title">Tool Analytics</h3>
            <div className="tool-analytics">
              {topTools.map(([name, count]) => (
                <div key={name} className="tool-analytics-row">
                  <span className="tool-analytics-name">{name}</span>
                  <div className="tool-analytics-bar-bg">
                    <div
                      className="tool-analytics-bar"
                      style={{
                        width: `${(count / Math.max(...topTools.map(([, c]) => c))) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="tool-analytics-count">{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

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
                <button
                  className="btn-memory-save"
                  onClick={handleSaveMemory}
                  disabled={memorySaving}
                >
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

        {/* Recent Tools */}
        {recentTools.length > 0 && (
          <div className="card">
            <h3 className="card-title">Recent Tools</h3>
            <div className="tool-activity-list">
              {recentTools.map((entry) => {
                const tool = entry.data;
                return (
                  <div
                    key={entry.id}
                    className={`tool-activity-item ${tool.status}`}
                  >
                    <span className="tool-activity-name">{tool.tool_name}</span>
                    <span className={`tool-activity-status ${tool.status}`}>
                      {tool.status === "running"
                        ? "running"
                        : tool.status === "success"
                        ? "done"
                        : "error"}
                    </span>
                    {tool.duration_ms && (
                      <span className="tool-activity-duration">
                        {tool.duration_ms < 1000
                          ? `${tool.duration_ms}ms`
                          : `${(tool.duration_ms / 1000).toFixed(1)}s`}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
