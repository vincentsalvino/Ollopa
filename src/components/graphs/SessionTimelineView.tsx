import { useState } from "react";
import type { TimelineEvent } from "../../types";

interface SessionTimelineViewProps {
  events: TimelineEvent[];
  title: string;
  totalDurationMs: number;
}

const EVENT_ICONS: Record<string, string> = {
  session_start: "\u25B6",
  session_end: "\u25A0",
  assistant_message: "\u{1F4AC}",
  tool_start: "\u2699",
  tool_finish: "\u2714",
  error: "\u26A0",
};

const STATUS_COLORS: Record<string, string> = {
  success: "var(--success)",
  running: "var(--warning)",
  error: "var(--danger)",
};

function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatTime(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function SessionTimelineView({
  events,
  title,
  totalDurationMs,
}: SessionTimelineViewProps) {
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);

  if (events.length === 0) {
    return (
      <div className="graph-empty">
        <p>No events in this session timeline.</p>
      </div>
    );
  }

  return (
    <div className="session-timeline-view">
      <div className="stl-header">
        <h4 className="stl-title">{title}</h4>
        <span className="stl-duration">
          Total: {formatDuration(totalDurationMs)}
        </span>
        <span className="stl-event-count">{events.length} events</span>
      </div>

      <div className="stl-rail">
        {events.map((evt, i) => {
          const icon = EVENT_ICONS[evt.event_type] || "\u2022";
          const color = STATUS_COLORS[evt.status] || "var(--text-muted)";
          const isExpanded = expandedEvent === evt.id;
          const isLast = i === events.length - 1;

          return (
            <div
              key={evt.id}
              className={`stl-event ${isExpanded ? "expanded" : ""}`}
              onClick={() => setExpandedEvent(isExpanded ? null : evt.id)}
            >
              {/* Vertical connector */}
              <div className="stl-connector">
                <div
                  className="stl-dot"
                  style={{ borderColor: color, background: isExpanded ? color : "var(--bg-primary)" }}
                />
                {!isLast && <div className="stl-line" />}
              </div>

              {/* Event content */}
              <div className="stl-content">
                <div className="stl-event-header">
                  <span className="stl-icon">{icon}</span>
                  <span className="stl-label">{evt.label}</span>
                  {evt.duration_ms !== null && (
                    <span className="stl-evt-duration" style={{ color }}>
                      {formatDuration(evt.duration_ms)}
                    </span>
                  )}
                  <span className="stl-time">{formatTime(evt.timestamp)}</span>
                </div>

                {isExpanded && (
                  <div className="stl-detail">
                    <div className="stl-detail-row">
                      <span className="stl-detail-label">Type:</span>
                      <span className="stl-detail-value">{evt.event_type}</span>
                    </div>
                    <div className="stl-detail-row">
                      <span className="stl-detail-label">Status:</span>
                      <span className="stl-detail-value" style={{ color }}>{evt.status}</span>
                    </div>
                    {evt.detail && (
                      <div className="stl-detail-row">
                        <span className="stl-detail-label">Detail:</span>
                        <span className="stl-detail-value stl-detail-mono">{evt.detail}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
