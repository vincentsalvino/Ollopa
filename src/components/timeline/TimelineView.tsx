import { useRef, useEffect } from "react";
import type { TimelineEntry as TEntry } from "../../types";
import TimelineEntry from "./TimelineEntry";

interface TimelineViewProps {
  entries: TEntry[];
  isTyping: boolean;
}

export default function TimelineView({ entries, isTyping }: TimelineViewProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length, isTyping]);

  return (
    <div className="timeline-view">
      {entries.map((entry) => (
        <TimelineEntry key={entry.id} entry={entry} />
      ))}

      {isTyping && (
        <div className="timeline-entry timeline-typing">
          <div className="tl-icon tl-icon-assistant">
            <span>A</span>
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
