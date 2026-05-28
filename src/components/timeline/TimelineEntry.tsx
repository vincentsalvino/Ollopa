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
  ReasoningData,
  AgentPlanData,
  AgentStepData,
  AgentReflectionData,
  ShellOutputData,
  FileEditedData,
  AgentLoopData,
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

    case "reasoning": {
      const d = entry.data as ReasoningData;
      return (
        <div className="timeline-entry tl-reasoning">
          <div className="tl-rail">
            <div className="tl-icon" style={{ background: "var(--accent)" }}>
              <span>💭</span>
            </div>
            {!isLast && <div className="tl-connector" />}
          </div>
          <div className="tl-content">
            <details className="tl-reasoning-card">
              <summary style={{ cursor: "pointer", fontSize: "12px", color: "var(--text-muted)" }}>
                Thinking... ({d.text.length} chars)
              </summary>
              <pre style={{ fontSize: "12px", whiteSpace: "pre-wrap", opacity: 0.7, marginTop: "4px" }}>
                {d.text}
              </pre>
            </details>
            <div className="tl-time">{time}</div>
          </div>
        </div>
      );
    }

    case "agent_plan": {
      const d = entry.data as AgentPlanData;
      return (
        <div className="timeline-entry tl-agent-plan">
          <div className="tl-rail">
            <div className="tl-icon" style={{ background: "#6366f1" }}>
              <span>📋</span>
            </div>
            {!isLast && <div className="tl-connector" />}
          </div>
          <div className="tl-content">
            <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>Agent Plan</div>
            <ol style={{ margin: 0, paddingLeft: "20px", fontSize: "12px" }}>
              {d.steps.map((step, i) => <li key={i}>{step}</li>)}
            </ol>
            <div className="tl-time">{time}</div>
          </div>
        </div>
      );
    }

    case "agent_step": {
      const d = entry.data as AgentStepData;
      const icon = d.status === "completed" ? "✓" : d.status === "failed" ? "✗" : "⟳";
      return (
        <div className="timeline-entry tl-agent-step">
          <div className="tl-rail">
            <div className="tl-icon" style={{ background: d.status === "failed" ? "var(--danger)" : "#6366f1" }}>
              <span>{icon}</span>
            </div>
            {!isLast && <div className="tl-connector" />}
          </div>
          <div className="tl-content">
            <div style={{ fontSize: "12px" }}>
              <strong>Step {d.step_index + 1}:</strong> {d.description}
            </div>
            <div className="tl-time">{time}</div>
          </div>
        </div>
      );
    }

    case "agent_reflection": {
      const d = entry.data as AgentReflectionData;
      return (
        <div className="timeline-entry tl-reflection">
          <div className="tl-rail">
            <div className="tl-icon" style={{ background: "#8b5cf6" }}>
              <span>🔍</span>
            </div>
            {!isLast && <div className="tl-connector" />}
          </div>
          <div className="tl-content">
            <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
              <em>Reflection (step {d.step_index + 1}):</em> {d.result}
              {d.adjustment && <div style={{ marginTop: "2px" }}>Adjustment: {d.adjustment}</div>}
            </div>
            <div className="tl-time">{time}</div>
          </div>
        </div>
      );
    }

    case "shell_output": {
      const d = entry.data as ShellOutputData;
      return (
        <div className="timeline-entry tl-shell">
          <div className="tl-rail">
            <div className="tl-icon" style={{ background: d.exit_code === 0 ? "var(--success)" : "var(--danger)" }}>
              <span>$</span>
            </div>
            {!isLast && <div className="tl-connector" />}
          </div>
          <div className="tl-content">
            <div style={{ fontFamily: "monospace", fontSize: "12px" }}>
              <div style={{ fontWeight: 600 }}>$ {d.command}</div>
              {d.stdout && <pre style={{ margin: "4px 0", whiteSpace: "pre-wrap", opacity: 0.9 }}>{d.stdout.slice(0, 500)}</pre>}
              {d.stderr && <pre style={{ margin: "4px 0", whiteSpace: "pre-wrap", color: "var(--danger)" }}>{d.stderr.slice(0, 300)}</pre>}
              <div style={{ color: "var(--text-muted)" }}>exit: {d.exit_code}</div>
            </div>
            <div className="tl-time">{time}</div>
          </div>
        </div>
      );
    }

    case "file_edited": {
      const d = entry.data as FileEditedData;
      return (
        <div className="timeline-entry tl-file-edit">
          <div className="tl-rail">
            <div className="tl-icon" style={{ background: "#f59e0b" }}>
              <span>📝</span>
            </div>
            {!isLast && <div className="tl-connector" />}
          </div>
          <div className="tl-content">
            <div style={{ fontSize: "12px" }}>
              <strong>{d.path}</strong>
              <div style={{ color: "var(--text-muted)", marginTop: "2px" }}>{d.diff_summary}</div>
            </div>
            <div className="tl-time">{time}</div>
          </div>
        </div>
      );
    }

    case "agent_loop": {
      const d = entry.data as AgentLoopData;
      return (
        <div className="timeline-entry tl-agent-loop">
          <div className="tl-rail">
            <div className="tl-icon" style={{ background: d.status === "finished" && d.success ? "var(--success)" : "#6366f1" }}>
              <span>{d.status === "started" ? "🚀" : d.success ? "✓" : "✗"}</span>
            </div>
            {!isLast && <div className="tl-connector" />}
          </div>
          <div className="tl-content">
            <div style={{ fontSize: "12px" }}>
              {d.status === "started" ? (
                <span>Agent loop started: <strong>{d.task}</strong> (max {d.max_iterations} iterations)</span>
              ) : (
                <span>Agent loop {d.success ? "completed" : "failed"}: <strong>{d.task}</strong> ({d.iterations} iterations)</span>
              )}
              {d.summary && <div style={{ marginTop: "4px", color: "var(--text-muted)" }}>{d.summary}</div>}
            </div>
            <div className="tl-time">{time}</div>
          </div>
        </div>
      );
    }

    default:
      return null;
  }
}
