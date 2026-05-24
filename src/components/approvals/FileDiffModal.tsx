import { useState, useMemo } from "react";

interface FileDiffModalProps {
  filePath: string;
  oldContent: string;
  newContent: string;
  onApprove: () => void;
  onDeny: () => void;
  onClose: () => void;
}

type ViewMode = "unified" | "split";

interface DiffLine {
  type: "same" | "added" | "removed";
  text: string;
  oldNum?: number;
  newNum?: number;
}

function computeDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const result: DiffLine[] = [];
  const maxLen = Math.max(oldLines.length, newLines.length);

  let oi = 0;
  let ni = 0;
  let oldNum = 1;
  let newNum = 1;

  while (oi < oldLines.length || ni < newLines.length) {
    if (
      oi < oldLines.length &&
      ni < newLines.length &&
      oldLines[oi] === newLines[ni]
    ) {
      result.push({ type: "same", text: oldLines[oi], oldNum: oldNum++, newNum: newNum++ });
      oi++;
      ni++;
    } else if (
      ni < newLines.length &&
      (oi >= oldLines.length || !oldLines.slice(oi, oi + 10).includes(newLines[ni]))
    ) {
      result.push({ type: "added", text: newLines[ni], newNum: newNum++ });
      ni++;
    } else if (
      oi < oldLines.length &&
      (ni >= newLines.length || !newLines.slice(ni, ni + 10).includes(oldLines[oi]))
    ) {
      result.push({ type: "removed", text: oldLines[oi], oldNum: oldNum++ });
      oi++;
    } else {
      result.push({ type: "removed", text: oldLines[oi], oldNum: oldNum++ });
      result.push({ type: "added", text: newLines[ni], newNum: newNum++ });
      oi++;
      ni++;
    }
    if (result.length > maxLen + 500) break;
  }
  return result;
}

const EXT_LANG: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  rs: "rust", py: "python", rb: "ruby", go: "go", java: "java",
  css: "css", html: "html", json: "json", yaml: "yaml", yml: "yaml",
  md: "markdown", sh: "bash", bash: "bash", toml: "toml", sql: "sql",
  c: "c", cpp: "cpp", h: "c", hpp: "cpp", cs: "csharp",
  swift: "swift", kt: "kotlin", r: "r", lua: "lua", zig: "zig",
};

function detectLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  return EXT_LANG[ext] || "text";
}

function highlightLine(text: string, lang: string): React.ReactNode {
  if (lang === "text") return text || "\u00A0";

  const tokens: { pattern: RegExp; className: string }[] = [
    { pattern: /(\/\/.*$|#.*$)/gm, className: "hl-comment" },
    { pattern: /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/g, className: "hl-string" },
    { pattern: /\b(true|false|null|undefined|None|nil|True|False)\b/g, className: "hl-literal" },
    { pattern: /\b(\d+\.?\d*(?:e[+-]?\d+)?)\b/g, className: "hl-number" },
    { pattern: /\b(fn|function|const|let|var|mut|pub|mod|use|import|export|from|return|if|else|for|while|loop|match|switch|case|break|continue|class|struct|enum|impl|trait|interface|type|async|await|try|catch|throw|new|self|this|super|default|yield|static|readonly|abstract|extends|implements)\b/g, className: "hl-keyword" },
  ];

  const parts: { start: number; end: number; className: string }[] = [];

  for (const { pattern, className } of tokens) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      parts.push({ start: m.index, end: m.index + m[0].length, className });
    }
  }

  parts.sort((a, b) => a.start - b.start);

  // Remove overlaps
  const filtered: typeof parts = [];
  let lastEnd = 0;
  for (const p of parts) {
    if (p.start >= lastEnd) {
      filtered.push(p);
      lastEnd = p.end;
    }
  }

  if (filtered.length === 0) return text || "\u00A0";

  const result: React.ReactNode[] = [];
  let pos = 0;
  for (let i = 0; i < filtered.length; i++) {
    const p = filtered[i];
    if (pos < p.start) {
      result.push(text.slice(pos, p.start));
    }
    result.push(
      <span key={i} className={p.className}>
        {text.slice(p.start, p.end)}
      </span>
    );
    pos = p.end;
  }
  if (pos < text.length) {
    result.push(text.slice(pos));
  }
  return <>{result}</>;
}

export default function FileDiffModal({
  filePath,
  oldContent,
  newContent,
  onApprove,
  onDeny,
  onClose,
}: FileDiffModalProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("unified");
  const isNewFile = !oldContent;
  const lang = detectLanguage(filePath);

  const lines = useMemo(
    () =>
      isNewFile
        ? newContent.split("\n").map((text, i) => ({
            type: "added" as const,
            text,
            newNum: i + 1,
          }))
        : computeDiff(oldContent, newContent),
    [oldContent, newContent, isNewFile]
  );

  const addedCount = lines.filter((l) => l.type === "added").length;
  const removedCount = lines.filter((l) => l.type === "removed").length;
  const fileName = filePath.split("/").pop() || filePath;

  // Split view pairs
  const splitPairs = useMemo(() => {
    if (viewMode !== "split") return [];
    const pairs: { left: DiffLine | null; right: DiffLine | null }[] = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (line.type === "same") {
        pairs.push({ left: line, right: line });
        i++;
      } else if (line.type === "removed") {
        // Look ahead for paired addition
        if (i + 1 < lines.length && lines[i + 1].type === "added") {
          pairs.push({ left: line, right: lines[i + 1] });
          i += 2;
        } else {
          pairs.push({ left: line, right: null });
          i++;
        }
      } else {
        pairs.push({ left: null, right: line });
        i++;
      }
    }
    return pairs;
  }, [lines, viewMode]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal diff-modal diff-modal-v2"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="diff-modal-header">
          <div className="diff-header-top">
            <h3>
              {isNewFile ? "Create File" : "Edit File"}: {fileName}
            </h3>
            <div className="diff-header-controls">
              <div className="diff-stats">
                {addedCount > 0 && (
                  <span className="diff-stat-added">+{addedCount}</span>
                )}
                {removedCount > 0 && (
                  <span className="diff-stat-removed">-{removedCount}</span>
                )}
              </div>
              <div className="diff-view-toggle">
                <button
                  className={`diff-view-btn ${viewMode === "unified" ? "active" : ""}`}
                  onClick={() => setViewMode("unified")}
                >
                  Unified
                </button>
                <button
                  className={`diff-view-btn ${viewMode === "split" ? "active" : ""}`}
                  onClick={() => setViewMode("split")}
                >
                  Split
                </button>
              </div>
            </div>
          </div>
          <div className="diff-file-info">
            <span className="diff-filepath">{filePath}</span>
            <span className="diff-lang-badge">{lang}</span>
          </div>
        </div>

        {/* Diff Content */}
        <div className="diff-content">
          {viewMode === "unified" ? (
            <table className="diff-table">
              <tbody>
                {lines.map((line, i) => (
                  <tr key={i} className={`diff-row diff-${line.type}`}>
                    <td className="diff-line-num diff-num-old">
                      {line.type !== "added" ? line.oldNum : ""}
                    </td>
                    <td className="diff-line-num diff-num-new">
                      {line.type !== "removed" ? line.newNum : ""}
                    </td>
                    <td className="diff-marker-cell">
                      {line.type === "added"
                        ? "+"
                        : line.type === "removed"
                        ? "-"
                        : ""}
                    </td>
                    <td className="diff-code">
                      <span className="diff-code-inner">
                        {highlightLine(line.text, lang)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="diff-table diff-table-split">
              <tbody>
                {splitPairs.map((pair, i) => (
                  <tr key={i} className="diff-row-split">
                    {/* Left (old) */}
                    <td className="diff-line-num">
                      {pair.left?.oldNum || ""}
                    </td>
                    <td
                      className={`diff-code diff-split-cell ${
                        pair.left?.type === "removed" ? "diff-removed" : ""
                      }`}
                    >
                      {pair.left ? (
                        <span className="diff-code-inner">
                          {highlightLine(pair.left.text, lang)}
                        </span>
                      ) : (
                        "\u00A0"
                      )}
                    </td>
                    {/* Right (new) */}
                    <td className="diff-line-num">
                      {pair.right?.newNum || ""}
                    </td>
                    <td
                      className={`diff-code diff-split-cell ${
                        pair.right?.type === "added" ? "diff-added" : ""
                      }`}
                    >
                      {pair.right ? (
                        <span className="diff-code-inner">
                          {highlightLine(pair.right.text, lang)}
                        </span>
                      ) : (
                        "\u00A0"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Actions */}
        <div className="diff-modal-actions">
          <button className="btn-revert" onClick={onDeny} title="Revert changes">
            Revert
          </button>
          <div className="diff-actions-right">
            <button className="btn-deny" onClick={onDeny}>
              Deny
            </button>
            <button className="btn-approve" onClick={onApprove}>
              Approve {isNewFile ? "Create" : "Edit"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
