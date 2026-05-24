import type { ToolUseData } from "../../types";

interface ToolDetailPanelProps {
  tool: ToolUseData;
  onClose: () => void;
}

export default function ToolDetailPanel({ tool, onClose }: ToolDetailPanelProps) {
  const durationText = tool.duration_ms
    ? tool.duration_ms < 1000
      ? `${tool.duration_ms}ms`
      : `${(tool.duration_ms / 1000).toFixed(1)}s`
    : "—";

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal tool-detail-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="td-header">
          <h3>{tool.tool_name}</h3>
          <div className="td-header-meta">
            <span
              className={`td-status ${
                tool.status === "running"
                  ? "td-running"
                  : tool.status === "success"
                  ? "td-success"
                  : "td-error"
              }`}
            >
              {tool.status}
            </span>
            <span className="td-duration">{durationText}</span>
            <span className="td-id">{tool.tool_use_id}</span>
          </div>
          <button className="td-close" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="td-body">
          {/* Input section */}
          <div className="td-section">
            <h4>Input</h4>
            <pre className="td-pre">
              {JSON.stringify(tool.input, null, 2)}
            </pre>
          </div>

          {/* Output section */}
          {tool.output && (
            <div className="td-section">
              <h4>
                Output{tool.is_error ? " (error)" : ""}
              </h4>
              <pre className={`td-pre ${tool.is_error ? "td-pre-error" : ""}`}>
                {tool.output}
              </pre>
              <div className="td-output-actions">
                <button
                  className="td-copy-btn"
                  onClick={() => navigator.clipboard.writeText(tool.output || "")}
                >
                  Copy Output
                </button>
              </div>
            </div>
          )}

          {/* Timing */}
          <div className="td-section td-timing">
            <div className="td-timing-row">
              <span>Started</span>
              <span>{new Date(tool.started_at).toLocaleTimeString()}</span>
            </div>
            {tool.finished_at && (
              <div className="td-timing-row">
                <span>Finished</span>
                <span>{new Date(tool.finished_at).toLocaleTimeString()}</span>
              </div>
            )}
            <div className="td-timing-row">
              <span>Duration</span>
              <span>{durationText}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
