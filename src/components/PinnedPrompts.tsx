import { useState } from "react";

interface PinnedPromptsProps {
  onSend: (input: string) => void;
}

const DEFAULT_PROMPTS = [
  { label: "new session", prompt: "new session" },
  { label: "save memory", prompt: "wrap up and save memory" },
  { label: "/compact", prompt: "/compact" },
  { label: "/cost", prompt: "/cost" },
];

function PinnedPrompts({ onSend }: PinnedPromptsProps) {
  const [customPrompts, setCustomPrompts] = useState<{ label: string; prompt: string }[]>([]);

  const allPrompts = [...DEFAULT_PROMPTS, ...customPrompts];

  const handleAddCustom = () => {
    const input = window.prompt("Enter a pinned prompt:");
    if (input && input.trim()) {
      const trimmed = input.trim();
      const label = trimmed.length > 20 ? trimmed.slice(0, 20) + "..." : trimmed;
      setCustomPrompts((prev) => [...prev, { label, prompt: trimmed }]);
    }
  };

  return (
    <div className="pinned-prompts">
      {allPrompts.map((p, i) => (
        <button
          key={i}
          className="pinned-pill"
          onClick={() => onSend(p.prompt)}
          title={p.prompt}
        >
          {p.label}
        </button>
      ))}
      <button className="pinned-pill pinned-add" onClick={handleAddCustom} title="Add custom prompt">
        +
      </button>
    </div>
  );
}

export default PinnedPrompts;
