import { useState } from "react";
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
}

export default function TimelineEntry({ entry }: Props) {
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
          <div className="tl-icon tl-icon-user">
            <span>U</span>
          </div>
          <div className="tl-content">
            <MessageBubble content={d.content} variant="user" />
            <div className="tl-time">{time}</div>
          </div>
        </div>
      );
    }

    case "assistant_message": {
      const d = entry.data as AssistantMessageData;
      return (
        <div className="timeline-entry tl-assistant">
          <div className="tl-icon tl-icon-assistant">
            <span>A</span>
          </div>
          <div className="tl-content">
            <MessageBubble content={d.text} variant="assistant" />
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
          <div className={`tl-icon tl-icon-tool tl-tool-${d.status}`}>
            <span>{d.status === "running" ? "\u2699" : d.status === "success" ? "\u2713" : "\u2717"}</span>
          </div>
          <div className="tl-content">
            <ToolCard tool={d} />
            <div className="tl-time">{time}</div>
          </div>
        </div>
      );
    }

    case "approval_request": {
      const d = entry.data as ApprovalRequestData;
      return (
        <div className="timeline-entry tl-approval">
          <div className="tl-icon tl-icon-approval">
            <span>!</span>
          </div>
          <div className="tl-content">
            <div className={`tl-approval-card risk-${d.risk_level.toLowerCase()}`}>
              <div className="tl-approval-header">
                <span className="tl-approval-tool">{d.tool_name}</span>
                <span className={`tl-risk-badge risk-${d.risk_level.toLowerCase()}`}>
                  {d.risk_level}
                </span>
                <span className={`tl-approval-status status-${d.status}`}>
                  {d.status}
                </span>
              </div>
              {d.risk_label && <div className="tl-approval-label">{d.risk_label}</div>}
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
          <div className="tl-icon tl-icon-status">
            <span>&bull;</span>
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
          <div className="tl-icon tl-icon-error">
            <span>!</span>
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
          <div className="tl-icon tl-icon-session">
            <span>&#9654;</span>
          </div>
          <div className="tl-content">
            <div className="tl-session-card">
              Session started &mdash; <strong>{d.model}</strong>
              <span className="tl-session-tools">
                {d.tools.length} tools available
              </span>
            </div>
          </div>
        </div>
      );
    }

    case "session_end": {
      const d = entry.data as SessionEndData;
      return (
        <div className="timeline-entry tl-session-marker">
          <div className="tl-icon tl-icon-session-end">
            <span>&#9632;</span>
          </div>
          <div className="tl-content">
            <div className="tl-session-card tl-session-end-card">
              Session complete &mdash; {d.num_turns} turns, $
              {d.cost_usd.toFixed(4)},{" "}
              {(d.duration_ms / 1000).toFixed(1)}s
              {d.is_error && <span className="tl-session-error"> (error)</span>}
            </div>
          </div>
        </div>
      );
    }

    default:
      return null;
  }
}
