import type {
  TimelineEntry as TEntry,
  UserMessageData,
  AssistantMessageData,
  ToolUseData,
  StatusData,
  ErrorData,
  SessionStartData,
  SessionEndData,
  ApprovalRequestData,
} from "../../types";
import ToolCard from "../tools/ToolCard";
import MessageBubble from "./MessageBubble";

interface Props {
  entry: TEntry;
  onViewToolDetail?: (tool: ToolUseData) => void;
  isLast?: boolean;
  onEditMessage?: (newContent: string) => void;
  onRegenerateMessage?: () => void;
}

export default function TimelineEntry({ entry, onViewToolDetail, isLast, onEditMessage, onRegenerateMessage }: Props) {
  const time = new Date(entry.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  switch (entry.kind) {
    case "user_message": {
      const d = entry.data as UserMessageData;
      return (
        <div className="timeline-entry tl-user">
          <div className="tl-rail">
            <div className="tl-icon tl-icon-user">
              <span>U</span>
            </div>
            {!isLast && <div className="tl-connector" />}
          </div>
          <div className="tl-content">
            <MessageBubble content={d.content} variant="user" onEdit={onEditMessage} />
            <div className="tl-time">{time}</div>
          </div>
        </div>
      );
    }

    case "assistant_message": {
      const d = entry.data as AssistantMessageData;
      return (
        <div className="timeline-entry tl-assistant">
          <div className="tl-rail">
            <div className="tl-icon tl-icon-assistant">
              <span>A</span>
            </div>
            {!isLast && <div className="tl-connector" />}
          </div>
          <div className="tl-content">
            <MessageBubble content={d.text} variant="assistant" onRegenerate={onRegenerateMessage} />
            <div className="tl-time">
              {time} &middot; {d.model}
            </div>
          </div>
        </div>
      );
    }

    case "tool_use": {
      const d = entry.data as ToolUseData;
      return (
        <div className="timeline-entry tl-tool">
          <div className="tl-rail">
            <div className={`tl-icon tl-icon-tool tl-tool-${d.status}`}>
              <span>
                {d.status === "running"
                  ? "\u2699"
                  : d.status === "success"
                  ? "\u2713"
                  : "\u2717"}
              </span>
            </div>
            {!isLast && <div className="tl-connector" />}
          </div>
          <div className="tl-content">
            <ToolCard tool={d} onViewOutput={onViewToolDetail} />
            <div className="tl-time">{time}</div>
          </div>
        </div>
      );
    }

    case "approval_request": {
      const d = entry.data as ApprovalRequestData;
      return (
        <div className="timeline-entry tl-approval">
          <div className="tl-rail">
            <div className="tl-icon tl-icon-approval">
              <span>!</span>
            </div>
            {!isLast && <div className="tl-connector" />}
          </div>
          <div className="tl-content">
            <div className={`tl-approval-card risk-${d.risk_level.toLowerCase()}`}>
              <div className="tl-approval-header">
                <span className="tl-approval-tool">{d.tool_name}</span>
                <span
                  className={`tl-risk-badge risk-${d.risk_level.toLowerCase()}`}
                >
                  {d.risk_level}
                </span>
                <span className={`tl-approval-status status-${d.status}`}>
                  {d.status}
                </span>
              </div>
              {d.risk_label && (
                <div className="tl-approval-label">{d.risk_label}</div>
              )}
              {Object.keys(d.input).length > 0 && (
                <details className="tl-approval-details">
                  <summary>View input</summary>
                  <pre className="tl-approval-input">
                    {JSON.stringify(d.input, null, 2)}
                  </pre>
                </details>
              )}
            </div>
            <div className="tl-time">{time}</div>
          </div>
        </div>
      );
    }

    case "status": {
      const d = entry.data as StatusData;
      return (
        <div className="timeline-entry tl-status">
          <div className="tl-rail">
            <div className="tl-icon tl-icon-status">
              <span>&bull;</span>
            </div>
            {!isLast && <div className="tl-connector tl-connector-dim" />}
          </div>
          <div className="tl-content">
            <div className="tl-status-text">{d.detail}</div>
          </div>
        </div>
      );
    }

    case "error": {
      const d = entry.data as ErrorData;
      return (
        <div className="timeline-entry tl-error">
          <div className="tl-rail">
            <div className="tl-icon tl-icon-error">
              <span>!</span>
            </div>
            {!isLast && <div className="tl-connector" />}
          </div>
          <div className="tl-content">
            <div className="tl-error-card">
              <div className="tl-error-text">{d.message}</div>
              {d.recoverable && (
                <span className="tl-error-recoverable">recoverable</span>
              )}
            </div>
          </div>
        </div>
      );
    }

    case "session_start": {
      const d = entry.data as SessionStartData;
      return (
        <div className="timeline-entry tl-session-marker">
          <div className="tl-rail">
            <div className="tl-icon tl-icon-session">
              <span>&#9654;</span>
            </div>
            {!isLast && <div className="tl-connector" />}
          </div>
          <div className="tl-content">
            <div className="tl-session-card">
              <div className="tl-session-title">
                Session started &mdash; <strong>{d.model}</strong>
              </div>
              <div className="tl-session-meta">
                <span className="tl-session-tools">
                  {d.tools.length} tools available
                </span>
                <span className="tl-session-cwd" title={d.cwd}>
                  {d.cwd.split("/").slice(-2).join("/")}
                </span>
              </div>
            </div>
          </div>
        </div>
      );
    }

    case "session_end": {
      const d = entry.data as SessionEndData;
      return (
        <div className="timeline-entry tl-session-marker">
          <div className="tl-rail">
            <div className="tl-icon tl-icon-session-end">
              <span>&#9632;</span>
            </div>
          </div>
          <div className="tl-content">
            <div className="tl-session-card tl-session-end-card">
              <div className="tl-session-title">
                Session complete
                {d.is_error && (
                  <span className="tl-session-error"> (error)</span>
                )}
              </div>
              <div className="tl-session-end-stats">
                <span>{d.num_turns} turns</span>
                <span>${d.cost_usd.toFixed(4)}</span>
                <span>{(d.duration_ms / 1000).toFixed(1)}s</span>
              </div>
            </div>
          </div>
        </div>
      );
    }

    default:
      return null;
  }
}
