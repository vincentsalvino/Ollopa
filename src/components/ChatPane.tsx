import { useState, useRef, useEffect } from "react";
import type { Message, ToolEvent } from "../App";

interface SlashCommand {
  cmd: string;
  desc: string;
}

interface ChatPaneProps {
  messages: Message[];
  currentStream: string;
  activeTools: ToolEvent[];
  isTyping: boolean;
  slashCommands: SlashCommand[];
  onSend: (input: string) => void;
}

function ChatPane({
  messages,
  currentStream,
  activeTools,
  isTyping,
  slashCommands,
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
  }, [messages, currentStream, isTyping, activeTools]);

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

  // Active tool cards (running tools)
  const runningTools = activeTools.filter((t) => t.status === "started");

  return (
    <div className="chat-pane">
      <div className="messages-container">
        {messages.map((msg) => (
          <div key={msg.id} className={`message ${msg.role}`}>
            <div className={`bubble ${msg.role}`}>{renderContent(msg.content)}</div>
            <div className="message-meta">{msg.timestamp}</div>
          </div>
        ))}

        {/* Active tool cards */}
        {runningTools.map((tool) => (
          <div key={tool.tool_use_id} className="tool-card">
            <div className="tool-card-header">
              <span className="tool-card-icon">&#9881;</span>
              <span className="tool-card-name">{tool.tool_name}</span>
              <span className="tool-card-status running">running</span>
            </div>
            {tool.input && Object.keys(tool.input).length > 0 && (
              <div className="tool-card-input">
                <pre>{JSON.stringify(tool.input, null, 2)}</pre>
              </div>
            )}
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

      {/* Slash command dropdown */}
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

      {/* Input area */}
      <div className="input-area">
        <textarea
          ref={textareaRef}
          className="chat-input"
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeydown}
          placeholder="Ask Claude anything... (/ for commands)"
          rows={1}
        />
        <button className="send-btn" onClick={handleSubmit} disabled={!input.trim()}>
          &#9654;
        </button>
      </div>
    </div>
  );
}

export default ChatPane;
