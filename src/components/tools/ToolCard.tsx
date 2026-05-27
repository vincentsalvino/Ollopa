import { useState, memo } from "react";
import type { ToolUseData } from "../../types";

interface ToolCardProps {
  tool: ToolUseData;
  onViewOutput?: (tool: ToolUseData) => void;
}

const TOOL_ICONS: Record<string, string> = {
  read_file: "\uD83D\uDCC4",
  write: "\u270F\uFE0F",
  edit: "\u270F\uFE0F",
  str_replace_editor: "\u270F\uFE0F",
  create_file: "\u2795",
  delete_file: "\uD83D\uDDD1\uFE0F",
  bash: "\uD83D\uDCBB",
  execute_bash: "\uD83D\uDCBB",
  run_command: "\uD83D\uDCBB",
  list_directory: "\uD83D\uDCC2",
  search_files: "\uD83D\uDD0D",
  grep: "\uD83D\uDD0D",
  glob: "\uD83D\uDD0D",
  mcp__: "\u2699\uFE0F",
};

const TOOL_CATEGORIES: Record<string, string> = {
  read_file: "file", write: "file", edit: "file", str_replace_editor: "file",
  create_file: "file", delete_file: "file",
  bash: "command", execute_bash: "command", run_command: "command",
  list_directory: "fs", search_files: "search", grep: "search", glob: "search",
};

type TabId = "input" | "output" | "files";

function ToolCard({ tool, onViewOutput }: ToolCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("input");
  const icon = TOOL_ICONS[tool.tool_name] || "\u2699\uFE0F";
  const category = TOOL_CATEGORIES[tool.tool_name] || "other";

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

  const summary = getToolSummary(tool.tool_name, tool.input);
  const affectedFiles = extractAffectedFiles(tool.tool_name, tool.input, tool.output);
  const isCommand = category === "command";

  const hasOutput = !!tool.output;
  const hasInput = Object.keys(tool.input).length > 0;

  return (
    <div className={`tool-card-v2 ${statusClass}`}>
      {/* Header */}
      <div className="tc-header" onClick={() => setExpanded(!expanded)}>
        <span className="tc-icon">{icon}</span>
        <span className="tc-name">{tool.tool_name}</span>
        <span className={`tc-category tc-cat-${category}`}>{category}</span>
        <span className="tc-summary">{summary}</span>
        <div className="tc-right">
          {durationText && <span className="tc-duration">{durationText}</span>}
          <span className={`tc-status-badge ${statusClass}`}>
            {tool.status === "running"
              ? "Running"
              : tool.status === "success"
              ? "Done"
              : "Error"}
          </span>
          <span className="tc-expand">{expanded ? "\u25B2" : "\u25BC"}</span>
        </div>
      </div>

      {/* Command Preview (for bash/run_command tools) */}
      {isCommand && !expanded && (
        <CommandPreviewBar
          command={(tool.input.command as string) || ""}
          status={tool.status}
        />
      )}

      {/* Expanded Body */}
      {expanded && (
        <div className="tc-body">
          {/* Tabs */}
          <div className="tc-tabs">
            {hasInput && (
              <button
                className={`tc-tab ${activeTab === "input" ? "active" : ""}`}
                onClick={() => setActiveTab("input")}
              >
                Input
              </button>
            )}
            {hasOutput && (
              <button
                className={`tc-tab ${activeTab === "output" ? "active" : ""}`}
                onClick={() => setActiveTab("output")}
              >
                Output{tool.is_error ? " (error)" : ""}
              </button>
            )}
            {affectedFiles.length > 0 && (
              <button
                className={`tc-tab ${activeTab === "files" ? "active" : ""}`}
                onClick={() => setActiveTab("files")}
              >
                Files ({affectedFiles.length})
              </button>
            )}

            {/* Full view button */}
            {onViewOutput && hasOutput && (
              <button
                className="tc-tab tc-tab-expand"
                onClick={(e) => {
                  e.stopPropagation();
                  onViewOutput(tool);
                }}
                title="View full output"
              >
                &#x2197;
              </button>
            )}
          </div>

          {/* Tab Content */}
          {activeTab === "input" && hasInput && (
            <div className="tc-tab-content">
              {isCommand ? (
                <CommandPreview
                  command={(tool.input.command as string) || ""}
                  tool={tool}
                />
              ) : (
                <pre className="tc-pre">
                  {JSON.stringify(tool.input, null, 2)}
                </pre>
              )}
            </div>
          )}

          {activeTab === "output" && hasOutput && (
            <div className="tc-tab-content">
              <pre className={`tc-pre ${tool.is_error ? "tc-pre-error" : ""}`}>
                {tool.output && tool.output.length > 3000
                  ? tool.output.slice(0, 3000) + "\n... (truncated)"
                  : tool.output}
              </pre>
            </div>
          )}

          {activeTab === "files" && affectedFiles.length > 0 && (
            <div className="tc-tab-content">
              <div className="tc-files-list">
                {affectedFiles.map((f, i) => (
                  <div key={i} className={`tc-file-item tc-file-${f.action}`}>
                    <span className="tc-file-action">{f.action}</span>
                    <span className="tc-file-path">{f.path}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════ Command Preview Bar (collapsed) ═══════

function CommandPreviewBar({
  command,
  status,
}: {
  command: string;
  status: string;
}) {
  if (!command) return null;
  return (
    <div className="tc-cmd-preview-bar">
      <span className="tc-cmd-prompt">$</span>
      <code className="tc-cmd-text">{truncate(command, 80)}</code>
      {status === "running" && <span className="tc-cmd-spinner" />}
    </div>
  );
}

// ═══════ Command Preview (expanded, full) ═══════

function CommandPreview({
  command,
  tool,
}: {
  command: string;
  tool: ToolUseData;
}) {
  const riskClass = classifyCommandRisk(command);

  return (
    <div className="tc-cmd-preview">
      <div className="tc-cmd-header">
        <span className={`tc-cmd-risk ${riskClass}`}>
          {riskClass === "cmd-safe"
            ? "safe"
            : riskClass === "cmd-caution"
            ? "caution"
            : "danger"}
        </span>
        <button
          className="tc-cmd-copy"
          onClick={() => navigator.clipboard.writeText(command)}
          title="Copy command"
        >
          Copy
        </button>
      </div>
      <pre className="tc-cmd-full">
        <span className="tc-cmd-prompt-full">$ </span>
        {highlightCommand(command)}
      </pre>
    </div>
  );
}

function classifyCommandRisk(cmd: string): string {
  const dangerous = [
    /rm\s+-rf/i,
    /sudo/i,
    /chmod\s+777/i,
    /mkfs/i,
    /dd\s+if=/i,
    /curl.*\|\s*(bash|sh)/i,
    /wget.*\|\s*(bash|sh)/i,
    /> \/dev\//i,
  ];
  const caution = [
    /rm\s+/i,
    /mv\s+/i,
    /git\s+(push|reset|rebase)/i,
    /npm\s+publish/i,
    /pip\s+install/i,
    /apt(-get)?\s+install/i,
    /chmod/i,
    /chown/i,
  ];

  for (const p of dangerous) {
    if (p.test(cmd)) return "cmd-danger";
  }
  for (const p of caution) {
    if (p.test(cmd)) return "cmd-caution";
  }
  return "cmd-safe";
}

function highlightCommand(cmd: string): React.ReactNode {
  const parts = cmd.split(/(\s+)/);
  return parts.map((p, i) => {
    if (i === 0) return <span key={i} className="cmd-hl-bin">{p}</span>;
    if (p.startsWith("-")) return <span key={i} className="cmd-hl-flag">{p}</span>;
    if (p.startsWith("/") || p.startsWith("./") || p.includes("."))
      return <span key={i} className="cmd-hl-path">{p}</span>;
    if (p.startsWith("$")) return <span key={i} className="cmd-hl-var">{p}</span>;
    if (p === "|" || p === ">" || p === ">>" || p === "&&" || p === "||" || p === ";")
      return <span key={i} className="cmd-hl-op">{p}</span>;
    return <span key={i}>{p}</span>;
  });
}

// ═══════ Extract Affected Files ═══════

interface AffectedFile {
  path: string;
  action: "read" | "write" | "create" | "delete" | "search";
}

function extractAffectedFiles(
  name: string,
  input: Record<string, unknown>,
  output?: string
): AffectedFile[] {
  const files: AffectedFile[] = [];
  const path =
    (input.path as string) ||
    (input.file_path as string) ||
    (input.file as string) ||
    "";

  switch (name) {
    case "read_file":
      if (path) files.push({ path, action: "read" });
      break;
    case "write":
    case "str_replace_editor":
    case "edit":
      if (path) files.push({ path, action: "write" });
      break;
    case "create_file":
      if (path) files.push({ path, action: "create" });
      break;
    case "delete_file":
      if (path) files.push({ path, action: "delete" });
      break;
    case "search_files":
    case "grep":
    case "glob":
      if (output) {
        const lines = output.split("\n").slice(0, 10);
        for (const line of lines) {
          const match = line.match(/^([^\s:]+\.\w+)/);
          if (match) {
            files.push({ path: match[1], action: "search" });
          }
        }
      }
      break;
    case "bash":
    case "execute_bash":
    case "run_command": {
      const cmd = (input.command as string) || "";
      const editMatches = cmd.match(/(?:>\s*|tee\s+)([^\s|;&]+\.\w+)/g);
      if (editMatches) {
        for (const m of editMatches) {
          const fpath = m.replace(/^[>|\s]+/, "").replace(/^tee\s+/, "").trim();
          if (fpath) files.push({ path: fpath, action: "write" });
        }
      }
      break;
    }
  }

  return files;
}

// ═══════ Utilities ═══════

function getToolSummary(name: string, input: Record<string, unknown>): string {
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
      const pattern =
        (input.pattern as string) || (input.query as string) || "";
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

export default memo(ToolCard);
