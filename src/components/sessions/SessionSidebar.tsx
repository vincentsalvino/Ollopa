import { useEffect, useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SessionMeta, PersistedEvent, ClaudeCodeSessionMeta, ToastMessage } from "../../types";
import bgDashboard from "../../assets/bg-dashboard.png";

interface SessionSidebarProps {
  visible: boolean;
  onClose: () => void;
  onToast: (text: string, type: ToastMessage["type"]) => void;
  onRestore?: (events: PersistedEvent[]) => void;
}

type GroupedSessions = Record<string, SessionMeta[]>;
type TabId = "ollopa" | "claude-code";

const STATUS_ICONS: Record<string, string> = {
  active: "●",
  completed: "✓",
  crashed: "⚠",
  recovered: "↻",
};

const STATUS_CLASSES: Record<string, string> = {
  active: "ss-active",
  completed: "ss-completed",
  crashed: "ss-crashed",
  recovered: "ss-recovered",
};

function formatTime(ts: number): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays === 0) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } else if (diffDays === 1) {
    return "Yesterday";
  } else if (diffDays < 7) {
    return `${diffDays}d ago`;
  } else {
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return tokens.toString();
}

function groupByProject(sessions: SessionMeta[]): GroupedSessions {
  const groups: GroupedSessions = {};
  for (const s of sessions) {
    const project = s.project_path
      ? s.project_path.split(/[/\\]/).pop() || s.project_path
      : "Global";
    if (!groups[project]) groups[project] = [];
    groups[project].push(s);
  }
  return groups;
}

export default function SessionSidebar({
  visible,
  onClose,
  onToast,
  onRestore,
}: SessionSidebarProps) {
  const [tab, setTab] = useState<TabId>("ollopa");
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [claudeSessions, setClaudeSessions] = useState<ClaudeCodeSessionMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");

  const refresh = async () => {
    setLoading(true);
    try {
      const list = await invoke<SessionMeta[]>("list_sessions");
      setSessions(list);
    } catch (_) {
      setSessions([]);
    }
    setLoading(false);
  };

  const refreshClaudeSessions = async () => {
    setLoading(true);
    try {
      const list = await invoke<ClaudeCodeSessionMeta[]>("list_claude_code_sessions");
      setClaudeSessions(list);
    } catch (_) {
      setClaudeSessions([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!visible) return;
    if (tab === "ollopa") refresh();
    else refreshClaudeSessions();
  }, [visible, tab]);

  const handleDelete = async (key: string) => {
    try {
      await invoke("delete_session_by_key", { key });
      onToast("Session deleted", "info");
      refresh();
    } catch (e) {
      onToast(`Failed to delete: ${e}`, "error");
    }
  };

  const handleRestore = async (sessionId: string) => {
    if (!onRestore) return;
    setRestoringId(sessionId);
    try {
      await invoke<string>("resume_conversation", { sessionId });
      const events = await invoke<PersistedEvent[]>("get_session_events", { sessionId });
      onRestore(events);
      onToast(`Session restored (${events.length} events)`, "success");
      onClose();
    } catch (e) {
      onToast(`Failed to restore: ${e}`, "error");
    }
    setRestoringId(null);
  };

  const handleViewClaudeSession = async (sessionId: string) => {
    try {
      const entries = await invoke("get_claude_code_session", { uuid: sessionId });
      onToast(`Session ${sessionId.slice(0, 8)}... loaded (${(entries as any[]).length} entries)`, "info");
    } catch (e) {
      onToast(`Failed to load: ${e}`, "error");
    }
  };

  const filtered = useMemo(() => {
    if (filter === "all") return sessions;
    return sessions.filter((s) => s.status === filter);
  }, [sessions, filter]);

  const grouped = useMemo(() => groupByProject(filtered), [filtered]);
  const projectNames = Object.keys(grouped).sort();

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: sessions.length };
    for (const s of sessions) {
      counts[s.status] = (counts[s.status] || 0) + 1;
    }
    return counts;
  }, [sessions]);

  if (!visible) return null;

  return (
    <div className="sidebar-overlay" onClick={onClose}>
      <div className="session-sidebar ss-v2" onClick={(e) => e.stopPropagation()}>
        <div className="panel-bg panel-bg--sidebar" style={{ backgroundImage: `url(${bgDashboard})` }} />

        {/* Header */}
        <div className="sidebar-header">
          <h3>Session History</h3>
          <button className="sidebar-close" onClick={onClose}>&times;</button>
        </div>

        {/* Tabs */}
        <div className="ss-tabs">
          <button
            className={`ss-tab-btn ${tab === "ollopa" ? "active" : ""}`}
            onClick={() => { setTab("ollopa"); setFilter("all"); }}
          >
            Ollopa Sessions
          </button>
          <button
            className={`ss-tab-btn ${tab === "claude-code" ? "active" : ""}`}
            onClick={() => setTab("claude-code")}
          >
            Claude Code
            {claudeSessions.length > 0 && ` (${claudeSessions.length})`}
          </button>
        </div>

        {tab === "ollopa" ? (
          <>
            {/* Status filter */}
            <div className="ss-filters">
              {["all", "active", "completed", "crashed"].map((f) => (
                <button
                  key={f}
                  className={`ss-filter-btn ${filter === f ? "active" : ""} ${
                    f !== "all" ? STATUS_CLASSES[f] || "" : ""
                  }`}
                  onClick={() => setFilter(f)}
                >
                  {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
                  {statusCounts[f] ? ` (${statusCounts[f]})` : ""}
                </button>
              ))}
            </div>

            {/* Ollopa session list */}
            <div className="sidebar-list">
              {loading && <div className="sidebar-loading">Loading sessions...</div>}

              {!loading && filtered.length === 0 && (
                <div className="sidebar-empty">
                  {filter === "all" ? "No saved sessions" : `No ${filter} sessions`}
                </div>
              )}

              {!loading &&
                projectNames.map((project) => (
                  <div key={project} className="ss-project-group">
                    <div className="ss-project-header">
                      <span className="ss-project-icon">{"📁"}</span>
                      <span className="ss-project-name">{project}</span>
                      <span className="ss-project-count">{grouped[project].length}</span>
                    </div>

                    {grouped[project].map((s) => (
                      <div
                        key={s.key}
                        className={`session-item ss-item-v2 ${STATUS_CLASSES[s.status] || ""}`}
                        onClick={() => handleRestore(s.key)}
                        title={onRestore ? "Click to restore" : s.project_path || undefined}
                      >
                        <div className={`ss-status-dot ${STATUS_CLASSES[s.status] || ""}`}>
                          {STATUS_ICONS[s.status] || "○"}
                        </div>
                        <div className="ss-item-body">
                          <div className="ss-item-top">
                            <span className="ss-item-id" title={s.key}>
                              {s.preview || s.key.replace("session-", "").slice(0, 8) + "..."}
                            </span>
                            <span className="ss-item-time">{formatTime(s.updated_at)}</span>
                          </div>
                          <div className="ss-item-stats">
                            <span>{s.message_count} msgs</span>
                            {s.cost_usd > 0 && <span>${s.cost_usd.toFixed(4)}</span>}
                            <span className={`ss-status-label ${STATUS_CLASSES[s.status] || ""}`}>
                              {s.status}
                            </span>
                          </div>
                        </div>
                        <div className="ss-item-actions">
                          {restoringId === s.key && <span className="ss-restoring">Restoring...</span>}
                          <button
                            className="session-delete"
                            onClick={(e) => { e.stopPropagation(); handleDelete(s.key); }}
                            title="Delete session"
                          >
                            &times;
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
            </div>
          </>
        ) : (
          /* Claude Code sessions — read-only */
          <div className="sidebar-list">
            {loading && <div className="sidebar-loading">Loading Claude Code sessions...</div>}

            {!loading && claudeSessions.length === 0 && (
              <div className="sidebar-empty">
                No Claude Code sessions found
                <div className="sidebar-hint">Run Claude Code in terminal to create sessions</div>
              </div>
            )}

            {!loading &&
              claudeSessions.map((s) => (
                <div
                  key={s.session_id}
                  className="session-item ss-item-v2 ss-claude"
                  onClick={() => handleViewClaudeSession(s.session_id)}
                  title={s.cwd}
                >
                  <div className="ss-status-dot ss-claude-dot">{"◉"}</div>
                  <div className="ss-item-body">
                    <div className="ss-item-top">
                      <span className="ss-item-id">
                        {s.title || s.preview.slice(0, 60)}
                      </span>
                      <span className="ss-item-time">{formatTime(s.updated_at)}</span>
                    </div>
                    <div className="ss-item-stats">
                      <span>{s.message_count} msgs</span>
                      <span>{formatTokenCount(s.total_tokens)} tok</span>
                      <span className="ss-model-tag">{s.model || "unknown"}</span>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
