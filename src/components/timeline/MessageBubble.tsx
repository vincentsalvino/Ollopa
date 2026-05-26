import { useState, useCallback, useMemo } from "react";
import hljs from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import sql from 'highlight.js/lib/languages/sql';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import php from 'highlight.js/lib/languages/php';
import ruby from 'highlight.js/lib/languages/ruby';
import swift from 'highlight.js/lib/languages/swift';
import kotlin from 'highlight.js/lib/languages/kotlin';
import scala from 'highlight.js/lib/languages/scala';
import lua from 'highlight.js/lib/languages/lua';
import r from 'highlight.js/lib/languages/r';
import scss from 'highlight.js/lib/languages/scss';
import shell from 'highlight.js/lib/languages/shell';

hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('go', go);
hljs.registerLanguage('java', java);
hljs.registerLanguage('css', css);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('json', json);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('c', cpp);
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('php', php);
hljs.registerLanguage('ruby', ruby);
hljs.registerLanguage('swift', swift);
hljs.registerLanguage('kotlin', kotlin);
hljs.registerLanguage('scala', scala);
hljs.registerLanguage('lua', lua);
hljs.registerLanguage('r', r);
hljs.registerLanguage('scss', scss);
hljs.registerLanguage('shell', shell);

const HLJS_ALIASES: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  py: 'python', rs: 'rust', sh: 'bash', zsh: 'bash',
  yml: 'yaml', htm: 'html', 'c++': 'cpp', 'c#': 'csharp',
  rb: 'ruby', toml: 'json', sass: 'scss', less: 'css',
  mysql: 'sql', postgresql: 'sql', sqlite: 'sql',
};

interface MessageBubbleProps {
  content: string;
  variant: "user" | "assistant";
  onEdit?: (newContent: string) => void;
  onRegenerate?: () => void;
  messageIndex?: number;
}

export default function MessageBubble({
  content,
  variant,
  onEdit,
  onRegenerate,
  messageIndex,
}: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(content);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [content]);

  const handleSaveEdit = useCallback(() => {
    if (onEdit && editText.trim() !== content) {
      onEdit(editText.trim());
    }
    setEditing(false);
  }, [editText, content, onEdit]);

  const handleCancelEdit = useCallback(() => {
    setEditText(content);
    setEditing(false);
  }, [content]);

  if (editing) {
    return (
      <div className={`msg-bubble msg-${variant}`}>
        <textarea
          className="msg-edit-textarea"
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          autoFocus
          rows={3}
        />
        <div className="msg-edit-actions">
          <button className="msg-edit-save" onClick={handleSaveEdit}>
            Save & Resend
          </button>
          <button className="msg-edit-cancel" onClick={handleCancelEdit}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`msg-bubble msg-${variant}`}>
      <div className="msg-bubble-content">{renderMarkdown(content)}</div>
      <div className="msg-bubble-actions">
        <button
          className="msg-action-btn"
          onClick={handleCopy}
          title="Copy message"
        >
          {copied ? "\u2713 Copied" : "\u2398 Copy"}
        </button>
        {variant === "user" && onEdit && (
          <button
            className="msg-action-btn"
            onClick={() => setEditing(true)}
            title="Edit message"
          >
            &#9998; Edit
          </button>
        )}
        {variant === "assistant" && onRegenerate && (
          <button
            className="msg-action-btn"
            onClick={onRegenerate}
            title="Regenerate response"
          >
            &#8634; Regenerate
          </button>
        )}
      </div>
    </div>
  );
}

// Streaming bubble for in-progress responses
export function StreamingBubble({ content }: { content: string }) {
  return (
    <div className="msg-bubble msg-assistant msg-streaming">
      <div className="msg-bubble-content">{renderMarkdown(content)}</div>
      <span className="streaming-cursor" />
    </div>
  );
}

// Full markdown renderer
function renderMarkdown(content: string) {
  const blocks = parseBlocks(content);
  return blocks.map((block, i) => renderBlock(block, i));
}

type Block =
  | { type: "code"; lang: string; code: string }
  | { type: "table"; rows: string[][] }
  | { type: "heading"; level: number; text: string }
  | { type: "hr" }
  | { type: "blockquote"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "paragraph"; text: string };

function parseBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  const lines = content.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.trimStart().startsWith("```")) {
      const indent = line.indexOf("```");
      const lang = line.slice(indent + 3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push({ type: "code", lang, code: codeLines.join("\n") });
      i++; // skip closing ```
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length,
        text: headingMatch[2],
      });
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    // Table
    if (line.includes("|") && i + 1 < lines.length && /^\|?[\s-:|]+\|/.test(lines[i + 1])) {
      const tableRows: string[][] = [];
      while (i < lines.length && lines[i].includes("|")) {
        const cells = lines[i]
          .split("|")
          .map((c) => c.trim())
          .filter((c, idx, arr) => !(idx === 0 && c === "") && !(idx === arr.length - 1 && c === ""));
        if (!/^[\s-:|]+$/.test(lines[i].replace(/\|/g, ""))) {
          tableRows.push(cells);
        }
        i++;
      }
      if (tableRows.length > 0) {
        blocks.push({ type: "table", rows: tableRows });
      }
      continue;
    }

    // Blockquote
    if (line.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ type: "blockquote", text: quoteLines.join("\n") });
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s/, ""));
        i++;
      }
      blocks.push({ type: "list", ordered: true, items });
      continue;
    }

    // Unordered list
    if (/^\s*[-*+]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s/, ""));
        i++;
      }
      blocks.push({ type: "list", ordered: false, items });
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph (collect consecutive non-empty lines)
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].trimStart().startsWith("```") &&
      !lines[i].match(/^#{1,6}\s/) &&
      !lines[i].startsWith(">") &&
      !/^\s*[-*+]\s/.test(lines[i]) &&
      !/^\s*\d+\.\s/.test(lines[i]) &&
      !/^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: "paragraph", text: paraLines.join("\n") });
    }
  }

  return blocks;
}

function renderBlock(block: Block, key: number): JSX.Element {
  switch (block.type) {
    case "code":
      return <CodeBlock key={key} lang={block.lang} code={block.code} />;

    case "heading": {
      const Tag = `h${block.level}` as keyof JSX.IntrinsicElements;
      return (
        <Tag key={key} className="md-heading">
          {renderInline(block.text)}
        </Tag>
      );
    }

    case "hr":
      return <hr key={key} className="md-hr" />;

    case "table":
      return (
        <div key={key} className="md-table-wrapper">
          <table className="md-table">
            <thead>
              <tr>
                {block.rows[0]?.map((cell, j) => (
                  <th key={j}>{renderInline(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.slice(1).map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci}>{renderInline(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "blockquote":
      return (
        <blockquote key={key} className="md-blockquote">
          {renderInline(block.text)}
        </blockquote>
      );

    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag key={key} className="md-list">
          {block.items.map((item, j) => (
            <li key={j}>{renderInline(item)}</li>
          ))}
        </Tag>
      );
    }

    case "paragraph":
      return (
        <p key={key} className="md-paragraph">
          {renderInline(block.text)}
        </p>
      );
  }
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const highlighted = useMemo(() => highlightCode(code, lang), [code, lang]);

  return (
    <div className="code-block-wrapper">
      <div className="code-block-header">
        {lang && <span className="code-lang">{lang}</span>}
        <button
          className="code-copy-btn"
          onClick={() => {
            navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? "\u2713 Copied" : "Copy"}
        </button>
      </div>
      <pre className="code-block">
        <code dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
    </div>
  );
}

// Inline markdown rendering
function renderInline(text: string): (JSX.Element | string)[] {
  const elements: (JSX.Element | string)[] = [];
  // Combined regex for inline elements
  const regex =
    /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(_[^_]+_)|(~~[^~]+~~)|(\[([^\]]+)\]\(([^)]+)\))|(!\[([^\]]*)\]\(([^)]+)\))/g;
  let lastIndex = 0;
  let match;
  let keyIdx = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      elements.push(text.slice(lastIndex, match.index));
    }

    if (match[1]) {
      // Inline code
      elements.push(
        <code key={keyIdx++} className="inline-code">
          {match[1].slice(1, -1)}
        </code>
      );
    } else if (match[2]) {
      // Bold
      elements.push(<strong key={keyIdx++}>{match[2].slice(2, -2)}</strong>);
    } else if (match[3]) {
      // Italic *text*
      elements.push(<em key={keyIdx++}>{match[3].slice(1, -1)}</em>);
    } else if (match[4]) {
      // Italic _text_
      elements.push(<em key={keyIdx++}>{match[4].slice(1, -1)}</em>);
    } else if (match[5]) {
      // Strikethrough
      elements.push(<del key={keyIdx++}>{match[5].slice(2, -2)}</del>);
    } else if (match[9]) {
      // Image ![alt](url)
      elements.push(
        <img
          key={keyIdx++}
          src={match[11]}
          alt={match[10]}
          className="md-image"
        />
      );
    } else if (match[6]) {
      // Link [text](url)
      elements.push(
        <a
          key={keyIdx++}
          href={match[8]}
          target="_blank"
          rel="noopener noreferrer"
          className="md-link"
        >
          {match[7]}
        </a>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    elements.push(text.slice(lastIndex));
  }

  return elements.length > 0 ? elements : [text];
}

function highlightCode(code: string, lang: string): string {
  const resolved = HLJS_ALIASES[lang.toLowerCase()] || lang.toLowerCase();
  try {
    if (resolved && hljs.getLanguage(resolved)) {
      return hljs.highlight(code, { language: resolved }).value;
    }
    return hljs.highlightAuto(code).value;
  } catch {
    return code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
