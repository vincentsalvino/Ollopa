import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import ForceGraph from "./ForceGraph";
import DAGView from "./DAGView";
import SessionTimelineView from "./SessionTimelineView";
import NodeDetail from "./NodeDetail";
import type {
  GraphData,
  GraphNode,
  SessionTimelineData,
  SessionMeta,
  ToastMessage,
  VisualStats,
} from "../../types";

type GraphTab =
  | "relationships"
  | "architecture"
  | "workflow"
  | "dependencies"
  | "timeline";

interface GraphPanelProps {
  visible: boolean;
  onClose: () => void;
  onToast: (text: string, type: ToastMessage["type"]) => void;
  projectPath: string | null;
}

export default function GraphPanel({
  visible,
  onClose,
  onToast,
  projectPath,
}: GraphPanelProps) {
  const [tab, setTab] = useState<GraphTab>("relationships");
  const [loading, setLoading] = useState(false);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [timelineData, setTimelineData] = useState<SessionTimelineData | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [stats, setStats] = useState<VisualStats | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 700, height: 450 });
  const [searchFilter, setSearchFilter] = useState("");
  const [zoomLevel, setZoomLevel] = useState(1);

  // Measure container
  useEffect(() => {
    if (!visible || !containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setDimensions({
          width: Math.max(400, Math.floor(width)),
          height: Math.max(300, Math.floor(height) - 10),
        });
      }
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [visible]);

  const loadStats = useCallback(async () => {
    try {
      const s = await invoke<VisualStats>("visual_get_stats");
      setStats(s);
    } catch (_) {}
  }, []);

  const loadGraph = useCallback(
    async (type: GraphTab) => {
      if (type === "timeline") return;
      setLoading(true);
      setSelectedNode(null);
      try {
        let command = "";
        switch (type) {
          case "relationships":
            command = "visual_build_relationship_graph";
            break;
          case "architecture":
            command = "visual_build_architecture_graph";
            break;
          case "workflow":
            command = "visual_build_workflow_dag";
            break;
          case "dependencies":
            command = "visual_build_dependency_graph";
            break;
        }
        const data = await invoke<GraphData>(command, { projectPath });
        setGraphData(data);
      } catch (e) {
        onToast(`Failed to load graph: ${e}`, "error");
      }
      setLoading(false);
    },
    [projectPath, onToast]
  );

  const loadTimeline = useCallback(
    async (sessionId: string) => {
      setLoading(true);
      setTimelineData(null);
      try {
        const data = await invoke<SessionTimelineData>(
          "visual_build_session_timeline",
          { sessionId }
        );
        setTimelineData(data);
      } catch (e) {
        onToast(`Failed to load timeline: ${e}`, "error");
      }
      setLoading(false);
    },
    [onToast]
  );

  const loadSessions = useCallback(async () => {
    try {
      const s = await invoke<SessionMeta[]>("visual_list_sessions_for_timeline");
      setSessions(s);
      if (s.length > 0 && !selectedSession) {
        setSelectedSession(s[0].key);
      }
    } catch (_) {}
  }, [selectedSession]);

  useEffect(() => {
    if (!visible) return;
    loadStats();
    if (tab === "timeline") {
      loadSessions();
    } else {
      loadGraph(tab);
    }
  }, [visible, tab, loadStats, loadGraph, loadSessions]);

  useEffect(() => {
    if (tab === "timeline" && selectedSession) {
      loadTimeline(selectedSession);
    }
  }, [tab, selectedSession, loadTimeline]);

  const handleSaveGraph = async () => {
    if (!graphData) return;
    try {
      await invoke("visual_save_graph", { graph: graphData });
      onToast("Graph saved", "success");
      loadStats();
    } catch (e) {
      onToast(`Failed to save graph: ${e}`, "error");
    }
  };

  if (!visible) return null;

  // Filter nodes and edges by search
  const filteredNodes = graphData
    ? searchFilter.trim()
      ? graphData.nodes.filter(
          (n) =>
            n.label.toLowerCase().includes(searchFilter.toLowerCase()) ||
            n.node_type.toLowerCase().includes(searchFilter.toLowerCase())
        )
      : graphData.nodes
    : [];
  const filteredNodeIds = new Set(filteredNodes.map((n) => n.id));
  const filteredEdges = graphData
    ? graphData.edges.filter(
        (e) => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target)
      )
    : [];

  const tabs: { key: GraphTab; label: string; icon: string }[] = [
    { key: "relationships", label: "Relationships", icon: "\u{1F517}" },
    { key: "architecture", label: "Architecture", icon: "\u{1F3D7}" },
    { key: "workflow", label: "Workflow DAG", icon: "\u{1F500}" },
    { key: "dependencies", label: "Dependencies", icon: "\u{1F4E6}" },
    { key: "timeline", label: "Timeline", icon: "\u{1F552}" },
  ];

  return (
    <div className="graph-panel-overlay" onClick={onClose}>
      <div className="graph-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="graph-panel-header">
          <h3 className="graph-panel-title">Visual Memory</h3>
          {stats && (
            <span className="graph-panel-stats">
              {stats.total_graphs} graphs &middot; {stats.total_timelines} timelines
            </span>
          )}
          <button className="graph-panel-close" onClick={onClose}>
            &times;
          </button>
        </div>

        {/* Tabs */}
        <div className="graph-tabs">
          {tabs.map((t) => (
            <button
              key={t.key}
              className={`graph-tab ${tab === t.key ? "active" : ""}`}
              onClick={() => setTab(t.key)}
            >
              <span className="graph-tab-icon">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="graph-content" ref={containerRef}>
          {loading && (
            <div className="graph-loading">
              <div className="graph-spinner" />
              <span>Building visualization...</span>
            </div>
          )}

          {!loading && tab !== "timeline" && graphData && (
            <>
              <div className="graph-toolbar">
                <input
                  className="graph-search-input"
                  type="text"
                  placeholder="Search nodes..."
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                />
                <span className="graph-info">
                  {filteredNodes.length}/{graphData.nodes.length} nodes &middot; {filteredEdges.length} edges
                </span>
                <div className="graph-zoom-controls">
                  <button className="graph-zoom-btn" onClick={() => setZoomLevel((z) => Math.max(0.3, z - 0.1))}>-</button>
                  <span className="graph-zoom-label">{Math.round(zoomLevel * 100)}%</span>
                  <button className="graph-zoom-btn" onClick={() => setZoomLevel((z) => Math.min(3, z + 0.1))}>+</button>
                  <button className="graph-zoom-btn" onClick={() => setZoomLevel(1)}>Reset</button>
                </div>
                <button className="graph-action-btn" onClick={() => loadGraph(tab)}>
                  Refresh
                </button>
                <button className="graph-action-btn" onClick={handleSaveGraph}>
                  Save Snapshot
                </button>
              </div>

              <div className="graph-canvas-wrapper">
                <div className="graph-canvas" style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'center center' }}>
                  {tab === "workflow" ? (
                    <DAGView
                      nodes={filteredNodes}
                      edges={filteredEdges}
                      width={dimensions.width}
                      height={dimensions.height}
                      onNodeClick={setSelectedNode}
                    />
                  ) : (
                    <ForceGraph
                      nodes={filteredNodes}
                      edges={filteredEdges}
                      width={dimensions.width}
                      height={dimensions.height}
                      onNodeClick={setSelectedNode}
                    />
                  )}
                </div>
              </div>

              {/* Legend */}
              <div className="graph-legend">
                {Array.from(
                  new Set(graphData.nodes.map((n) => n.node_type))
                ).map((type) => (
                  <span key={type} className="graph-legend-item">
                    <span
                      className="graph-legend-dot"
                      data-type={type}
                    />
                    {type}
                  </span>
                ))}
              </div>
            </>
          )}

          {!loading && tab === "timeline" && (
            <div className="graph-timeline-container">
              {/* Session picker */}
              <div className="graph-timeline-picker">
                <label className="graph-timeline-label">Session:</label>
                <select
                  className="graph-timeline-select"
                  value={selectedSession || ""}
                  onChange={(e) => setSelectedSession(e.target.value)}
                >
                  {sessions.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.preview || s.key} ({s.message_count} msgs)
                    </option>
                  ))}
                </select>
              </div>

              {timelineData && (
                <SessionTimelineView
                  events={timelineData.events}
                  title={timelineData.title}
                  totalDurationMs={timelineData.total_duration_ms}
                />
              )}

              {!timelineData && sessions.length === 0 && (
                <div className="graph-empty">
                  <p>No sessions available for timeline visualization.</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Node detail sidebar */}
        <NodeDetail
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
        />
      </div>
    </div>
  );
}
