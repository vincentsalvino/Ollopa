import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { BrainSearchResult } from "../../types";

interface BrainSearchModalProps {
  visible: boolean;
  onClose: () => void;
  projectPath: string | null;
  onInsert?: (text: string) => void;
}

export default function BrainSearchModal({
  visible,
  onClose,
  projectPath,
  onInsert,
}: BrainSearchModalProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BrainSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (visible) {
      setQuery("");
      setResults([]);
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [visible]);

  const handleSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const res = await invoke<BrainSearchResult[]>("brain_search", {
        query: q,
        projectPath,
      });
      setResults(res);
      setSelectedIdx(0);
    } catch (_) {
      setResults([]);
    }
    setLoading(false);
  }, [projectPath]);

  useEffect(() => {
    const timer = setTimeout(() => handleSearch(query), 300);
    return () => clearTimeout(timer);
  }, [query, handleSearch]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[selectedIdx]) {
      e.preventDefault();
      if (onInsert) {
        onInsert(results[selectedIdx].snippet);
      }
      onClose();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  if (!visible) return null;

  return (
    <div className="brain-search-overlay" onClick={onClose}>
      <div className="brain-search-modal" onClick={(e) => e.stopPropagation()}>
        <div className="brain-search-input-row">
          <span className="brain-search-icon">&#128269;</span>
          <input
            ref={inputRef}
            className="brain-search-input"
            type="text"
            placeholder="Search your Second Brain... (Ctrl+K)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {loading && <span className="brain-search-spinner" />}
        </div>
        {results.length > 0 && (
          <div className="brain-search-results">
            {results.map((r, i) => (
              <div
                key={r.entry.id}
                className={`brain-search-result ${i === selectedIdx ? "selected" : ""}`}
                onClick={() => {
                  if (onInsert) onInsert(r.snippet);
                  onClose();
                }}
                onMouseEnter={() => setSelectedIdx(i)}
              >
                <div className="brain-result-header">
                  <span className="brain-result-type">{r.entry.source_type}</span>
                  <span className="brain-result-score">{(r.score * 100).toFixed(0)}%</span>
                </div>
                <p className="brain-result-snippet">{r.snippet}</p>
                <div className="brain-result-keywords">
                  {r.entry.keywords.slice(0, 4).map((kw) => (
                    <span key={kw} className="brain-result-keyword">{kw}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {query.trim() && !loading && results.length === 0 && (
          <div className="brain-search-empty">No results found</div>
        )}
      </div>
    </div>
  );
}
