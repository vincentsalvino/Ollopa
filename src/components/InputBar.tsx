import { useState, useRef, useCallback, useEffect } from "react";
import type { SlashCommand, PromptTemplate } from "../types";

interface InputBarProps {
  slashCommands: SlashCommand[];
  onSend: (input: string) => void;
  onSendWithFiles?: (input: string, files: File[]) => void;
  disabled?: boolean;
  isStreaming?: boolean;
  onStopGeneration?: () => void;
  transformEnabled?: boolean;
  onPreviewTransform?: (input: string) => void;
  onTogglePreview?: () => void;
  showTransformPreview?: boolean;
  promptTemplates?: PromptTemplate[];
  onSelectTemplate?: (t: PromptTemplate) => void;
}

export default function InputBar({
  slashCommands,
  onSend,
  onSendWithFiles,
  disabled,
  isStreaming,
  onStopGeneration,
  transformEnabled,
  onPreviewTransform,
  onTogglePreview,
  showTransformPreview,
  promptTemplates,
  onSelectTemplate,
}: InputBarProps) {
  const [input, setInput] = useState(() => {
    const saved = localStorage.getItem("ollopa-input-draft");
    return saved || "";
  });

  // Persist draft to localStorage (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (input.trim()) {
        localStorage.setItem("ollopa-input-draft", input);
      } else {
        localStorage.removeItem("ollopa-input-draft");
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [input]);
  const [showSlash, setShowSlash] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [templateFilter, setTemplateFilter] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredCommands = slashCommands.filter(
    (c) =>
      c.cmd.includes(slashFilter) ||
      c.desc.toLowerCase().includes(slashFilter)
  );

  const previewTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);

    if (val.startsWith("/")) {
      setSlashFilter(val.slice(1).toLowerCase());
      setShowSlash(true);
      setSelectedIdx(0);
    } else {
      setShowSlash(false);
    }

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, 120) + "px";
    }

    // Debounced transform preview
    if (transformEnabled && onPreviewTransform && showTransformPreview) {
      if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
      previewTimeoutRef.current = setTimeout(() => {
        onPreviewTransform(val);
      }, 500);
    }
  };

  const handleKeydown = (e: React.KeyboardEvent) => {
    if (showSlash) {
      if (e.key === "Escape") {
        setShowSlash(false);
        e.preventDefault();
        return;
      }
      if (e.key === "ArrowDown") {
        setSelectedIdx((i) => Math.min(i + 1, filteredCommands.length - 1));
        e.preventDefault();
        return;
      }
      if (e.key === "ArrowUp") {
        setSelectedIdx((i) => Math.max(i - 1, 0));
        e.preventDefault();
        return;
      }
      if (
        (e.key === "Enter" && !e.shiftKey) ||
        e.key === "Tab"
      ) {
        if (filteredCommands[selectedIdx]) {
          selectSlash(filteredCommands[selectedIdx].cmd);
          e.preventDefault();
          return;
        }
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const selectSlash = (cmd: string) => {
    setInput(cmd + " ");
    setShowSlash(false);
    textareaRef.current?.focus();
  };

  const handleSubmit = () => {
    if (!input.trim() || disabled) return;
    if (attachedFiles.length > 0 && onSendWithFiles) {
      onSendWithFiles(input.trim(), attachedFiles);
    } else {
      onSend(input.trim());
    }
    setInput("");
    localStorage.removeItem("ollopa-input-draft");
    setAttachedFiles([]);
    setShowSlash(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleFileSelect = useCallback((files: FileList | null) => {
    if (!files) return;
    const newFiles = Array.from(files);
    setAttachedFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    handleFileSelect(e.dataTransfer.files);
  }, [handleFileSelect]);

  const removeFile = useCallback((index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  return (
    <div
      className={`input-bar-wrapper ${isDragOver ? "drag-over" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      {showSlash && (
        <div className="slash-dropdown">
          {filteredCommands.map((c, i) => (
            <div
              key={c.cmd}
              className={`slash-item ${i === selectedIdx ? "selected" : ""}`}
              onClick={() => selectSlash(c.cmd)}
            >
              <span className="slash-cmd">{c.cmd}</span>
              <span className="slash-desc">{c.desc}</span>
            </div>
          ))}
        </div>
      )}

      {/* Attached files preview */}
      {attachedFiles.length > 0 && (
        <div className="attached-files">
          {attachedFiles.map((file, i) => (
            <div key={i} className="attached-file">
              <span className="attached-file-icon">
                {file.type.startsWith("image/") ? "\uD83D\uDDBC" : "\uD83D\uDCC4"}
              </span>
              <span className="attached-file-name">{file.name}</span>
              <span className="attached-file-size">
                ({(file.size / 1024).toFixed(1)}KB)
              </span>
              <button
                className="attached-file-remove"
                onClick={() => removeFile(i)}
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="input-controls">
        <button
          className="attach-btn"
          onClick={() => fileInputRef.current?.click()}
          title="Attach files"
        >
          &#128206;
        </button>
        {transformEnabled && onTogglePreview && (
          <button
            className={`preview-btn ${showTransformPreview ? "active" : ""}`}
            onClick={onTogglePreview}
            title={showTransformPreview ? "Hide transform preview" : "Show transform preview"}
          >
            &#128065;
          </button>
        )}
        {promptTemplates && promptTemplates.length > 0 && (
          <div style={{ position: "relative", display: "inline-block" }}>
            <button
              className="attach-btn"
              onClick={() => { setShowTemplates((s) => !s); setTemplateFilter(""); }}
              title="Prompt templates"
            >
              <i className="fa-solid fa-file-lines" />
            </button>
            {showTemplates && (
              <div className="slash-dropdown" style={{ bottom: "100%", left: 0, minWidth: 220 }}>
                <div style={{ padding: "4px 8px" }}>
                  <input
                    type="text"
                    placeholder="Filter templates..."
                    value={templateFilter}
                    onChange={(e) => setTemplateFilter(e.target.value)}
                    style={{ width: "100%", padding: "4px 6px", fontSize: 12, border: "1px solid var(--border, #555)", borderRadius: 4, background: "var(--bg-1, #222)", color: "inherit" }}
                    autoFocus
                  />
                </div>
                {promptTemplates
                  .filter((t) => t.name.toLowerCase().includes(templateFilter.toLowerCase()))
                  .map((t) => (
                    <div
                      key={t.id}
                      className="slash-item"
                      onClick={() => {
                        onSelectTemplate?.(t);
                        setShowTemplates(false);
                      }}
                    >
                      <span className="slash-cmd">{t.name}</span>
                      <span className="slash-desc">{t.mode}</span>
                    </div>
                  ))}
                {promptTemplates.filter((t) => t.name.toLowerCase().includes(templateFilter.toLowerCase())).length === 0 && (
                  <div className="slash-item" style={{ opacity: 0.5 }}>No matching templates</div>
                )}
              </div>
            )}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="file-input-hidden"
          onChange={(e) => handleFileSelect(e.target.files)}
        />
        <textarea
          ref={textareaRef}
          className="chat-input"
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeydown}
          placeholder={isDragOver ? "Drop files here..." : "Ask Ollopa anything... (/ for commands)"}
          rows={1}
          disabled={disabled}
        />
        {isStreaming ? (
          <button
            className="stop-btn"
            onClick={onStopGeneration}
            title="Stop generating"
          >
            &#9632;
          </button>
        ) : (
          <button
            className="send-btn"
            onClick={handleSubmit}
            disabled={!input.trim() || disabled}
          >
            &#9654;
          </button>
        )}
      </div>
    </div>
  );
}
