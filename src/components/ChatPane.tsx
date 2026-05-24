import { useState, useRef, useEffect } from "react";
import type { Message, ApprovalData } from "../App";
import PinnedPrompts from "./PinnedPrompts";

interface SlashCommand {
  cmd: string;
  desc: string;
}

interface ChatPaneProps {
  messages: Message[];
  currentStream: string;
  approval: ApprovalData | null;
  isTyping: boolean;
  slashCommands: SlashCommand[];
  onApproval: (approved: boolean) => void;
  onSend: (input: string) => void;
}

function ChatPane({
  messages,
  currentStream,
  approval,
  isTyping,
  slashCommands,
  onApproval,
  onSend,
}: ChatPaneProps) {
  const [input, setInput] = useState("");
  const [showSlash, setShowSlash] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentStream, isTyping]);

  const filteredCommands = slashCommands.filter(
    (c) => c.cmd.includes(slashFilter) || c.desc.toLowerCase().includes(slashFilter)
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

    // Auto-resize
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
      if (e.key === "Enter" && !e.shiftKey && filteredCommands[selectedIdx]) {
        selectSlash(filteredCommands[selectedIdx].cmd);
        e.preventDefault();
        return;
      }
      if (e.key === "Tab" && filteredCommands[selectedIdx]) {
        selectSlash(filteredCommands[selectedIdx].cmd);
        e.preventDefault();
        return;
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
    if (!input.trim()) return;
    onSend(input.trim());
    setInput("");
    setShowSlash(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const renderContent = (content: string) => {
    const parts = content.split(/(```[\s\S]*?```)/g);
    return parts.map((part, i) => {
      if (part.startsWith("```") && part.endsWith("```")) {
        const code = part.slice(3, -3);
        const firstNewline = code.indexOf("\n");
        const lang = firstNewline >= 0 ? code.slice(0, firstNewline).trim() : "";
        const codeContent = firstNewline >= 0 ? code.slice(firstNewline + 1) : code;
        return (
          <div key={i} className="code-block-wrapper">
            {lang && <span className="code-lang">{lang}</span>}
            <button
              className="code-copy-btn"
              onClick={() => navigator.clipboard.writeText(codeContent)}
            >
              Copy
            </button>
            <pre className="code-block">
              <code>{codeContent}</code>
            </pre>
          </div>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div className="chat-pane">
      <div className="messages-container">
        {messages.map((msg) => (
          <div key={msg.id} className={`message ${msg.role}`}>
            <div className={`bubble ${msg.role}`}>{renderContent(msg.content)}</div>
            <div className="message-meta">{msg.timestamp}</div>
          </div>
        ))}

        {/* Typing indicator */}
        {isTyping && !currentStream && (
          <div className="message assistant">
            <div className="typing-indicator">
              <div className="typing-dot" />
              <div className="typing-dot" />
              <div className="typing-dot" />
            </div>
          </div>
        )}

        {currentStream && (
          <div className="message assistant">
            <div className="bubble assistant">{renderContent(currentStream)}</div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Approval Modal */}
      {approval && (
        <div className="approval-overlay">
          <div className="approval-modal">
            <h3 className="approval-title">&#9888;&#65039; Approval Required</h3>
            <div className="risk-label">{approval.risk_label}</div>
            <pre className="approval-command">{approval.command}</pre>
            <div className="approval-buttons">
              <button className="btn-approve" onClick={() => onApproval(true)}>
                Approve
              </button>
              <button className="btn-deny" onClick={() => onApproval(false)}>
                Deny
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pinned Prompts */}
      <PinnedPrompts onSend={onSend} />

      {/* Input Area */}
      <div className="input-wrapper">
        {showSlash && filteredCommands.length > 0 && (
          <div className="slash-dropdown">
            {filteredCommands.map((cmd, i) => (
              <div
                key={cmd.cmd}
                className={`slash-item ${i === selectedIdx ? "active" : ""}`}
                onClick={() => selectSlash(cmd.cmd)}
              >
                <span className="slash-cmd">{cmd.cmd}</span>
                <span className="slash-desc">{cmd.desc}</span>
              </div>
            ))}
          </div>
        )}
        <div className="input-bar">
          <textarea
            ref={textareaRef}
            className="chat-input"
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeydown}
            placeholder="Type a message... (/ for commands)"
            rows={1}
            autoFocus
          />
          <button className="send-btn" onClick={handleSubmit}>
            &#9654;
          </button>
        </div>
        <div className="keyboard-hint">
          Enter to send &middot; Shift+Enter for newline &middot; / for commands
        </div>
      </div>
    </div>
  );
}

export default ChatPane;
