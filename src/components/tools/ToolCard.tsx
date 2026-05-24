import { useState } from "react";
import type { ToolUseData } from "../../types";

interface ToolCardProps {
  tool: ToolUseData;
}

const TOOL_ICONS: Record<string, string> = {
  read_file: "\uD83D\uDCC4",
  write: "\u270F",
  edit: "\u270F",
  str_replace_editor: "\u270F",
  create_file: "\u2795",
  delete_file: "\uD83D\uDDD1",
  bash: "\uD83D\uDCBB",
  execute_bash: "\uD83D\uDCBB",
  run_command: "\uD83D\uDCBB",
  list_directory: "\uD83D\uDCC2",
  search_files: "\uD83D\uDD0D",
  grep: "\uD83D\uDD0D",
  glob: "\uD83D\uDD0D",
};

export default function ToolCard({ tool }: ToolCardProps) {
  const [expanded, setExpanded] = useState(false);
  const icon = TOOL_ICONS[tool.tool_name] || "\u2699";

  const statusClass =
    tool.status === "running"
      ? "tc-running"
      : tool.status === "success"
      ? "tc-success"
      : "tc-error";

  const durationText = tool.duration_ms
    ? tool.duration_ms < 1000
      ? `${tool.duration_ms}ms`
      : `${(tool.duration_ms / 1000).toFixed(1)}s`
    : null;

  // Extract key info from input for the summary line
  const summary = getToolSummary(tool.tool_name, tool.input);

  return (
    <div className={`tool-card-v2 ${statusClass}`}>
      <div
        className="tc-header"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="tc-icon">{icon}</span>
        <span className="tc-name">{tool.tool_name}</span>
        <span className="tc-summary">{summary}</span>
        <div className="tc-right">
          {durationText && <span className="tc-duration">{durationText}</span>}
          <span className={`tc-status-dot ${statusClass}`} />
          <span className="tc-expand">{expanded ? "\u25B2" : "\u25BC"}</span>
        </div>
      </div>

      {expanded && (
        <div className="tc-body">
          {/* Input */}
          {Object.keys(tool.input).length > 0 && (
            <div className="tc-section">
              <div className="tc-section-label">Input</div>
              <pre className="tc-pre">{JSON.stringify(tool.input, null, 2)}</pre>
            </div>
          )}

          {/* Output */}
          {tool.output && (
            <div className="tc-section">
              <div className="tc-section-label">
                Output{tool.is_error ? " (error)" : ""}
              </div>
              <pre className={`tc-pre ${tool.is_error ? "tc-pre-error" : ""}`}>
                {tool.output.length > 2000
                  ? tool.output.slice(0, 2000) + "\n... (truncated)"
                  : tool.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function getToolSummary(
  name: string,
  input: Record<string, unknown>
): string {
  const path =
    (input.path as string) ||
    (input.file_path as string) ||
    (input.file as string) ||
    "";
  const cmd = (input.command as string) || "";

  switch (name) {
    case "read_file":
      return path ? shortenPath(path) : "";
    case "write":
    case "create_file":
    case "str_replace_editor":
    case "edit":
      return path ? shortenPath(path) : "";
    case "delete_file":
      return path ? shortenPath(path) : "";
    case "bash":
    case "execute_bash":
    case "run_command":
      return cmd ? truncate(cmd, 60) : "";
    case "list_directory":
      return path || ".";
    case "search_files":
    case "grep":
    case "glob": {
      const pattern = (input.pattern as string) || (input.query as string) || "";
      return pattern ? truncate(pattern, 40) : "";
    }
    default:
      return "";
  }
}

function shortenPath(p: string): string {
  const parts = p.split("/");
  if (parts.length <= 3) return p;
  return ".../" + parts.slice(-2).join("/");
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}
