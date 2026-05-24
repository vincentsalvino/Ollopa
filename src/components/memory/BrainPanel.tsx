import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  BrainStats,
  BrainSearchResult,
  SessionSummaryData,
  DecisionData,
  ToastMessage,
} from "../../types";

type Tab = "overview" | "search" | "decisions" | "summaries";

interface BrainPanelProps {
  visible: boolean;
  onClose: () => void;
  onToast: (text: string, type: ToastMessage["type"]) => void;
  projectPath: string | null;
}

function formatTime(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export default function BrainPanel({
  visible,
  onClose,
  onToast,
  projectPath,
}: BrainPanelProps) {
  const [tab, setTab] = useState<Tab>("overview");
  const [stats, setStats] = useState<BrainStats | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<BrainSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [decisions, setDecisions] = useState<DecisionData[]>([]);
  const [summaries, setSummaries] = useState<SessionSummaryData[]>([]);

  // Decision form
  const [showDecisionForm, setShowDecisionForm] = useState(false);
  const [decTitle, setDecTitle] = useState("");
  const [decContext, setDecContext] = useState("");
  const [decDecision, setDecDecision] = useState("");
  const [decRationale, setDecRationale] = useState("");
  const [decTags, setDecTags] = useState("");

  // Note form
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [noteContent, setNoteContent] = useState("");
  const [noteTags, setNoteTags] = useState("");

  const loadStats = useCallback(async () => {
    try {
      const s = await invoke<BrainStats>("brain_stats");
      setStats(s);
    } catch (_) {}
  }, []);

  const loadDecisions = useCallback(async () => {
    try {
      const d = await invoke<DecisionData[]>("brain_list_decisions", {
        projectPath,
      });
      setDecisions(d);
    } catch (_) {}
  }, [projectPath]);

  const loadSummaries = useCallback(async () => {
    try {
      const s = await invoke<SessionSummaryData[]>("brain_list_summaries", {
        projectPath,
      });
      setSummaries(s);
    } catch (_) {}
  }, [projectPath]);

  useEffect(() => {
    if (!visible) return;
    loadStats();
    if (tab === "decisions") loadDecisions();
    if (tab === "summaries") loadSummaries();
  }, [visible, tab, loadStats, loadDecisions, loadSummaries]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const results = await invoke<BrainSearchResult[]>("brain_search", {
        query: searchQuery,
        projectPath,
      });
      setSearchResults(results);
    } catch (e) {
      onToast(`Search failed: ${e}`, "error");
    }
    setSearching(false);
  };

  const handleSaveDecision = async () => {
    if (!decTitle.trim() || !decDecision.trim()) {
      onToast("Title and decision are required", "error");
      return;
    }
    try {
      await invoke("brain_save_decision", {
        title: decTitle,
        context: decContext,
        decision: decDecision,
        rationale: decRationale,
        tags: decTags
          .split(",")
          .map((t) => t.trim())
          .filter((t) => t.length > 0),
        projectPath,
      });
      onToast("Decision saved", "success");
      setShowDecisionForm(false);
      setDecTitle("");
      setDecContext("");
      setDecDecision("");
      setDecRationale("");
      setDecTags("");
      loadDecisions();
      loadStats();
    } catch (e) {
      onToast(`Failed to save: ${e}`, "error");
    }
  };

  const handleDeleteDecision = async (id: string) => {
    try {
      await invoke("brain_delete_decision", { id });
      onToast("Decision deleted", "info");
      loadDecisions();
      loadStats();
    } catch (e) {
      onToast(`Failed to delete: ${e}`, "error");
    }
  };

  const handleDeleteSummary = async (sessionId: string) => {
    try {
      await invoke("brain_delete_summary", { sessionId });
      onToast("Summary deleted", "info");
      loadSummaries();
      loadStats();
    } catch (e) {
      onToast(`Failed to delete: ${e}`, "error");
    }
  };

  const handleSaveNote = async () => {
    if (!noteContent.trim()) return;
    try {
      await invoke("brain_index_note", {
        content: noteContent,
        projectPath,
        tags: noteTags
          .split(",")
          .map((t) => t.trim())
          .filter((t) => t.length > 0),
      });
      onToast("Note indexed", "success");
      setShowNoteForm(false);
      setNoteContent("");
      setNoteTags("");
      loadStats();
    } catch (e) {
      onToast(`Failed to index note: ${e}`, "error");
    }
  };

  if (!visible) return null;

  return (
    <div className="brain-overlay" onClick={onClose}>
      <div className="brain-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="brain-header">
          <h3>Second Brain</h3>
          <button className="brain-close" onClick={onClose}>
            &times;
          </button>
        </div>

        {/* Tabs */}
        <div className="brain-tabs">
          {(["overview", "search", "decisions", "summaries"] as Tab[]).map(
            (t) => (
              <button
                key={t}
                className={`brain-tab ${tab === t ? "active" : ""}`}
                onClick={() => setTab(t)}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            )
          )}
        </div>

        <div className="brain-body">
          {/* Overview Tab */}
          {tab === "overview" && stats && (
            <div className="brain-overview">
              <div className="brain-stat-grid">
                <div className="brain-stat-card">
                  <div className="brain-stat-val">{stats.total_summaries}</div>
                  <div className="brain-stat-lbl">Summaries</div>
                </div>
                <div className="brain-stat-card">
                  <div className="brain-stat-val">{stats.total_decisions}</div>
                  <div className="brain-stat-lbl">Decisions</div>
                </div>
                <div className="brain-stat-card">
                  <div className="brain-stat-val">
                    {stats.total_index_entries}
                  </div>
                  <div className="brain-stat-lbl">Index Entries</div>
                </div>
                <div className="brain-stat-card">
                  <div className="brain-stat-val">
                    {formatBytes(stats.total_memory_bytes)}
                  </div>
                  <div className="brain-stat-lbl">Memory Size</div>
                </div>
              </div>

              {stats.projects_tracked.length > 0 && (
                <div className="brain-section">
                  <h4>Projects Tracked</h4>
                  <div className="brain-tag-list">
                    {stats.projects_tracked.map((p) => (
                      <span key={p} className="brain-tag">
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {stats.recent_tags.length > 0 && (
                <div className="brain-section">
                  <h4>Recent Tags</h4>
                  <div className="brain-tag-list">
                    {stats.recent_tags.map((t) => (
                      <span key={t} className="brain-tag">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="brain-actions">
                <button
                  className="brain-action-btn"
                  onClick={() => {
                    setShowNoteForm(true);
                    setTab("overview");
                  }}
                >
                  + Add Note
                </button>
              </div>

              {showNoteForm && (
                <div className="brain-form">
                  <textarea
                    className="brain-input brain-textarea"
                    placeholder="Note content..."
                    value={noteContent}
                    onChange={(e) => setNoteContent(e.target.value)}
                    rows={4}
                  />
                  <input
                    className="brain-input"
                    placeholder="Tags (comma-separated)"
                    value={noteTags}
                    onChange={(e) => setNoteTags(e.target.value)}
                  />
                  <div className="brain-form-actions">
                    <button className="brain-btn-save" onClick={handleSaveNote}>
                      Save Note
                    </button>
                    <button
                      className="brain-btn-cancel"
                      onClick={() => setShowNoteForm(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Search Tab */}
          {tab === "search" && (
            <div className="brain-search">
              <div className="brain-search-bar">
                <input
                  className="brain-input brain-search-input"
                  placeholder="Search workspace intelligence..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                />
                <button
                  className="brain-btn-search"
                  onClick={handleSearch}
                  disabled={searching}
                >
                  {searching ? "..." : "Search"}
                </button>
              </div>

              {searchResults.length > 0 && (
                <div className="brain-results">
                  {searchResults.map((r) => (
                    <div key={r.entry.id} className="brain-result-card">
                      <div className="brain-result-header">
                        <span className="brain-result-type">
                          {r.entry.source_type}
                        </span>
                        <span className="brain-result-score">
                          {r.score.toFixed(2)}
                        </span>
                      </div>
                      <div className="brain-result-snippet">{r.snippet}</div>
                      <div className="brain-result-meta">
                        {formatTime(r.entry.created_at)}
                        {r.entry.project_path && ` | ${r.entry.project_path}`}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {searchResults.length === 0 && searchQuery && !searching && (
                <div className="brain-empty">No results found</div>
              )}
            </div>
          )}

          {/* Decisions Tab */}
          {tab === "decisions" && (
            <div className="brain-decisions">
              <button
                className="brain-action-btn"
                onClick={() => setShowDecisionForm(!showDecisionForm)}
              >
                + Record Decision
              </button>

              {showDecisionForm && (
                <div className="brain-form">
                  <input
                    className="brain-input"
                    placeholder="Decision title"
                    value={decTitle}
                    onChange={(e) => setDecTitle(e.target.value)}
                  />
                  <textarea
                    className="brain-input brain-textarea"
                    placeholder="Context — what prompted this decision?"
                    value={decContext}
                    onChange={(e) => setDecContext(e.target.value)}
                    rows={2}
                  />
                  <textarea
                    className="brain-input brain-textarea"
                    placeholder="Decision — what was decided?"
                    value={decDecision}
                    onChange={(e) => setDecDecision(e.target.value)}
                    rows={2}
                  />
                  <textarea
                    className="brain-input brain-textarea"
                    placeholder="Rationale — why this approach?"
                    value={decRationale}
                    onChange={(e) => setDecRationale(e.target.value)}
                    rows={2}
                  />
                  <input
                    className="brain-input"
                    placeholder="Tags (comma-separated)"
                    value={decTags}
                    onChange={(e) => setDecTags(e.target.value)}
                  />
                  <div className="brain-form-actions">
                    <button
                      className="brain-btn-save"
                      onClick={handleSaveDecision}
                    >
                      Save Decision
                    </button>
                    <button
                      className="brain-btn-cancel"
                      onClick={() => setShowDecisionForm(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              <div className="brain-list">
                {decisions.length === 0 && (
                  <div className="brain-empty">
                    No decisions recorded yet
                  </div>
                )}
                {decisions.map((d) => (
                  <div key={d.id} className="brain-decision-card">
                    <div className="brain-dec-header">
                      <span className="brain-dec-title">{d.title}</span>
                      <span className={`brain-dec-status ${d.status.toLowerCase()}`}>
                        {d.status}
                      </span>
                    </div>
                    {d.context && (
                      <div className="brain-dec-field">
                        <strong>Context:</strong> {d.context}
                      </div>
                    )}
                    <div className="brain-dec-field">
                      <strong>Decision:</strong> {d.decision}
                    </div>
                    {d.rationale && (
                      <div className="brain-dec-field">
                        <strong>Rationale:</strong> {d.rationale}
                      </div>
                    )}
                    <div className="brain-dec-footer">
                      <div className="brain-dec-tags">
                        {d.tags.map((t) => (
                          <span key={t} className="brain-tag">
                            {t}
                          </span>
                        ))}
                      </div>
                      <div className="brain-dec-meta">
                        {formatTime(d.created_at)}
                        <button
                          className="brain-del-btn"
                          onClick={() => handleDeleteDecision(d.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Summaries Tab */}
          {tab === "summaries" && (
            <div className="brain-summaries">
              <div className="brain-list">
                {summaries.length === 0 && (
                  <div className="brain-empty">
                    No session summaries yet
                  </div>
                )}
                {summaries.map((s) => (
                  <div key={s.session_id} className="brain-summary-card">
                    <div className="brain-sum-header">
                      <span className="brain-sum-title">{s.title}</span>
                      <span className="brain-sum-date">
                        {formatTime(s.created_at)}
                      </span>
                    </div>
                    <div className="brain-sum-text">{s.summary}</div>
                    {s.key_actions.length > 0 && (
                      <div className="brain-sum-actions">
                        <strong>Key actions:</strong>
                        <ul>
                          {s.key_actions.slice(0, 5).map((a, i) => (
                            <li key={i}>{a}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {s.files_touched.length > 0 && (
                      <div className="brain-sum-files">
                        <strong>Files:</strong>{" "}
                        {s.files_touched.slice(0, 5).join(", ")}
                        {s.files_touched.length > 5 &&
                          ` (+${s.files_touched.length - 5} more)`}
                      </div>
                    )}
                    <div className="brain-sum-footer">
                      <div className="brain-tag-list">
                        {s.tags.slice(0, 6).map((t) => (
                          <span key={t} className="brain-tag">
                            {t}
                          </span>
                        ))}
                      </div>
                      <div className="brain-sum-meta">
                        ~{s.token_count} tokens
                        <button
                          className="brain-del-btn"
                          onClick={() => handleDeleteSummary(s.session_id)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
