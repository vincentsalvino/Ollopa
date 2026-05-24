interface MessageBubbleProps {
  content: string;
  variant: "user" | "assistant";
}

export default function MessageBubble({ content, variant }: MessageBubbleProps) {
  return (
    <div className={`msg-bubble msg-${variant}`}>{renderContent(content)}</div>
  );
}

function renderContent(content: string) {
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

    // Inline code
    const inlineParts = part.split(/(`[^`]+`)/g);
    return (
      <span key={i}>
        {inlineParts.map((ip, j) => {
          if (ip.startsWith("`") && ip.endsWith("`")) {
            return (
              <code key={j} className="inline-code">
                {ip.slice(1, -1)}
              </code>
            );
          }
          // Bold
          const boldParts = ip.split(/(\*\*[^*]+\*\*)/g);
          return boldParts.map((bp, k) => {
            if (bp.startsWith("**") && bp.endsWith("**")) {
              return <strong key={`${j}-${k}`}>{bp.slice(2, -2)}</strong>;
            }
            return <span key={`${j}-${k}`}>{bp}</span>;
          });
        })}
      </span>
    );
  });
}
