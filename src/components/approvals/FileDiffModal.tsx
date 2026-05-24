interface FileDiffModalProps {
  filePath: string;
  oldContent: string;
  newContent: string;
  onApprove: () => void;
  onDeny: () => void;
  onClose: () => void;
}

interface DiffLine {
  type: "same" | "added" | "removed";
  text: string;
}

function diffLines(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const result: DiffLine[] = [];
  const maxLen = Math.max(oldLines.length, newLines.length);

  let oi = 0;
  let ni = 0;
  while (oi < oldLines.length || ni < newLines.length) {
    if (
      oi < oldLines.length &&
      ni < newLines.length &&
      oldLines[oi] === newLines[ni]
    ) {
      result.push({ type: "same", text: oldLines[oi] });
      oi++;
      ni++;
    } else if (
      ni < newLines.length &&
      (oi >= oldLines.length || !oldLines.slice(oi).includes(newLines[ni]))
    ) {
      result.push({ type: "added", text: newLines[ni] });
      ni++;
    } else if (
      oi < oldLines.length &&
      (ni >= newLines.length || !newLines.slice(ni).includes(oldLines[oi]))
    ) {
      result.push({ type: "removed", text: oldLines[oi] });
      oi++;
    } else {
      result.push({ type: "removed", text: oldLines[oi] });
      result.push({ type: "added", text: newLines[ni] });
      oi++;
      ni++;
    }
    if (result.length > maxLen + 500) break;
  }
  return result;
}

export default function FileDiffModal({
  filePath,
  oldContent,
  newContent,
  onApprove,
  onDeny,
  onClose,
}: FileDiffModalProps) {
  const isNewFile = !oldContent;
  const lines = isNewFile
    ? newContent.split("\n").map((text) => ({ type: "added" as const, text }))
    : diffLines(oldContent, newContent);

  const addedCount = lines.filter((l) => l.type === "added").length;
  const removedCount = lines.filter((l) => l.type === "removed").length;
  const fileName = filePath.split("/").pop() || filePath;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal diff-modal" onClick={(e) => e.stopPropagation()}>
        <div className="diff-modal-header">
          <h3>
            {isNewFile ? "Create File" : "Edit File"}: {fileName}
          </h3>
          <div className="diff-stats">
            <span className="diff-stat-added">+{addedCount}</span>
            <span className="diff-stat-removed">-{removedCount}</span>
          </div>
          <span className="diff-filepath">{filePath}</span>
        </div>

        <div className="diff-content">
          {lines.map((line, i) => (
            <div key={i} className={`diff-line diff-${line.type}`}>
              <span className="diff-line-num">{i + 1}</span>
              <span className="diff-marker">
                {line.type === "added"
                  ? "+"
                  : line.type === "removed"
                  ? "-"
                  : " "}
              </span>
              <span className="diff-text">{line.text || "\u00A0"}</span>
            </div>
          ))}
        </div>

        <div className="diff-modal-actions">
          <button className="btn-approve" onClick={onApprove}>
            Approve {isNewFile ? "Create" : "Edit"}
          </button>
          <button className="btn-deny" onClick={onDeny}>
            Deny
          </button>
        </div>
      </div>
    </div>
  );
}
