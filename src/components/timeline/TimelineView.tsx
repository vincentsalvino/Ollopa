import { useRef, useEffect, useState } from "react";
import type { TimelineEntry as TEntry, ToolUseData } from "../../types";
import TimelineEntry from "./TimelineEntry";
import { StreamingBubble } from "./MessageBubble";

interface TimelineViewProps {
  entries: TEntry[];
  isTyping: boolean;
  isStreaming?: boolean;
  streamingText?: string;
  onViewToolDetail?: (tool: ToolUseData) => void;
  onStopGeneration?: () => void;
  onEditMessage?: (entryId: string, newContent: string) => void;
  onRegenerateMessage?: (entryId: string) => void;
}

export default function TimelineView({
  entries,
  isTyping,
  isStreaming,
  streamingText,
  onViewToolDetail,
  onStopGeneration,
  onEditMessage,
  onRegenerateMessage,
}: TimelineViewProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length, isTyping, isStreaming, streamingText]);

  return (
    <div className="timeline-view">
      {entries.length === 0 && !isTyping && !isStreaming && (
        <div className="timeline-empty">
          <div className="timeline-empty-icon">&#9662;</div>
          <div className="timeline-empty-text">
            Start a conversation to see the execution timeline
          </div>
        </div>
      )}

      {entries.map((entry, i) => (
        <TimelineEntry
          key={entry.id}
          entry={entry}
          isLast={i === entries.length - 1 && !isTyping && !isStreaming}
          onViewToolDetail={onViewToolDetail}
          onEditMessage={onEditMessage ? (newContent) => onEditMessage(entry.id, newContent) : undefined}
          onRegenerateMessage={onRegenerateMessage ? () => onRegenerateMessage(entry.id) : undefined}
        />
      ))}

      {isStreaming && streamingText && (
        <StreamingSection
          streamingText={streamingText}
          onStopGeneration={onStopGeneration}
        />
      )}

      {isTyping && !isStreaming && (
        <div className="timeline-entry timeline-typing">
          <div className="tl-rail">
            <div className="tl-icon tl-icon-assistant">
              <span>A</span>
            </div>
          </div>
          <div className="tl-content">
            <div className="typing-indicator">
              <div className="typing-dot" />
              <div className="typing-dot" />
              <div className="typing-dot" />
            </div>
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}

function StreamingSection({
  streamingText,
  onStopGeneration,
}: {
  streamingText: string;
  onStopGeneration?: () => void;
}) {
  const [startTime] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setElapsed(Date.now() - startTime), 500);
    return () => clearInterval(interval);
  }, [startTime]);

  const estimatedTokens = Math.ceil(streamingText.length / 4);
  const elapsedSec = Math.max(0.1, elapsed / 1000);
  const tokPerSec = (estimatedTokens / elapsedSec).toFixed(1);

  return (
    <div className="timeline-entry tl-assistant">
      <div className="tl-rail">
        <div className="tl-icon tl-icon-assistant">
          <span>A</span>
        </div>
        <div className="tl-connector" />
      </div>
      <div className="tl-content">
        <StreamingBubble content={streamingText} />
        <div className="streaming-stats-row">
          <span className="streaming-counter">
            ~{estimatedTokens} tokens &middot; {tokPerSec} tok/s &middot; {elapsedSec.toFixed(1)}s
          </span>
          {onStopGeneration && (
            <button className="stop-generation-btn" onClick={onStopGeneration}>
              &#9632; Stop generating
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
