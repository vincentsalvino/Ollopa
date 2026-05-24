import { useRef, useEffect } from "react";
import type { TimelineEntry as TEntry, ToolUseData } from "../../types";
import TimelineEntry from "./TimelineEntry";

interface TimelineViewProps {
  entries: TEntry[];
  isTyping: boolean;
  onViewToolDetail?: (tool: ToolUseData) => void;
}

export default function TimelineView({
  entries,
  isTyping,
  onViewToolDetail,
}: TimelineViewProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length, isTyping]);

  return (
    <div className="timeline-view">
      {entries.length === 0 && !isTyping && (
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
          isLast={i === entries.length - 1 && !isTyping}
          onViewToolDetail={onViewToolDetail}
        />
      ))}

      {isTyping && (
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
