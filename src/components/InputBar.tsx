import { useState, useRef } from "react";
import type { SlashCommand } from "../types";

interface InputBarProps {
  slashCommands: SlashCommand[];
  onSend: (input: string) => void;
  disabled?: boolean;
}

export default function InputBar({ slashCommands, onSend, disabled }: InputBarProps) {
  const [input, setInput] = useState("");
  const [showSlash, setShowSlash] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const filteredCommands = slashCommands.filter(
    (c) =>
      c.cmd.includes(slashFilter) ||
      c.desc.toLowerCase().includes(slashFilter)
  );

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
    onSend(input.trim());
    setInput("");
    setShowSlash(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  return (
    <div className="input-bar-wrapper">
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
      <div className="input-area">
        <textarea
          ref={textareaRef}
          className="chat-input"
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeydown}
          placeholder="Ask Claude anything... (/ for commands)"
          rows={1}
          disabled={disabled}
        />
        <button
          className="send-btn"
          onClick={handleSubmit}
          disabled={!input.trim() || disabled}
        >
          &#9654;
        </button>
      </div>
    </div>
  );
}
