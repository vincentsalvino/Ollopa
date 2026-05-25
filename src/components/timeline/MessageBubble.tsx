import { useState, useCallback, useMemo } from "react";

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

// Syntax highlighting (keyword-based, no external dependency)
const KEYWORD_SETS: Record<string, { keywords: string[]; types: string[]; builtins: string[] }> = {
  javascript: {
    keywords: ["const", "let", "var", "function", "return", "if", "else", "for", "while", "switch", "case", "break", "continue", "try", "catch", "finally", "throw", "new", "class", "extends", "import", "export", "default", "from", "async", "await", "yield", "of", "in", "typeof", "instanceof", "this", "super", "do"],
    types: ["string", "number", "boolean", "void", "null", "undefined", "any", "never", "object", "symbol", "bigint"],
    builtins: ["console", "Math", "JSON", "Array", "Object", "String", "Number", "Boolean", "Promise", "Map", "Set", "Date", "RegExp", "Error", "parseInt", "parseFloat", "setTimeout", "setInterval", "fetch", "document", "window"],
  },
  typescript: {
    keywords: ["const", "let", "var", "function", "return", "if", "else", "for", "while", "switch", "case", "break", "continue", "try", "catch", "finally", "throw", "new", "class", "extends", "import", "export", "default", "from", "async", "await", "yield", "of", "in", "typeof", "instanceof", "this", "super", "type", "interface", "enum", "implements", "abstract", "readonly", "private", "protected", "public", "static", "as", "is", "keyof", "infer", "declare", "namespace", "module", "do"],
    types: ["string", "number", "boolean", "void", "null", "undefined", "any", "never", "object", "symbol", "bigint", "unknown", "Record", "Partial", "Required", "Pick", "Omit"],
    builtins: ["console", "Math", "JSON", "Array", "Object", "String", "Number", "Boolean", "Promise", "Map", "Set", "Date", "RegExp", "Error", "parseInt", "parseFloat", "setTimeout", "setInterval", "fetch", "document", "window"],
  },
  python: {
    keywords: ["def", "class", "return", "if", "elif", "else", "for", "while", "try", "except", "finally", "raise", "import", "from", "as", "with", "pass", "break", "continue", "yield", "lambda", "and", "or", "not", "in", "is", "global", "nonlocal", "assert", "del", "async", "await"],
    types: ["int", "float", "str", "bool", "list", "dict", "tuple", "set", "None", "True", "False", "bytes", "complex"],
    builtins: ["print", "len", "range", "enumerate", "zip", "map", "filter", "sorted", "reversed", "open", "type", "isinstance", "hasattr", "getattr", "setattr", "super", "property", "staticmethod", "classmethod", "input", "abs", "min", "max", "sum", "any", "all"],
  },
  rust: {
    keywords: ["fn", "let", "mut", "const", "struct", "enum", "impl", "trait", "pub", "use", "mod", "match", "if", "else", "for", "while", "loop", "return", "break", "continue", "where", "async", "await", "move", "ref", "self", "super", "crate", "as", "in", "unsafe", "extern", "type", "dyn", "static"],
    types: ["i8", "i16", "i32", "i64", "i128", "u8", "u16", "u32", "u64", "u128", "f32", "f64", "bool", "char", "str", "String", "Vec", "Option", "Result", "Box", "Rc", "Arc", "HashMap", "HashSet", "usize", "isize"],
    builtins: ["println", "eprintln", "format", "vec", "todo", "unimplemented", "panic", "assert", "assert_eq", "assert_ne", "dbg", "cfg", "include", "include_str", "env"],
  },
  go: {
    keywords: ["func", "return", "if", "else", "for", "range", "switch", "case", "break", "continue", "go", "defer", "select", "chan", "type", "struct", "interface", "map", "var", "const", "import", "package", "default", "fallthrough", "goto"],
    types: ["int", "int8", "int16", "int32", "int64", "uint", "uint8", "uint16", "uint32", "uint64", "float32", "float64", "string", "bool", "byte", "rune", "error", "any", "comparable"],
    builtins: ["fmt", "make", "new", "len", "cap", "append", "copy", "delete", "close", "panic", "recover", "print", "println", "nil", "true", "false", "iota"],
  },
  java: {
    keywords: ["public", "private", "protected", "static", "final", "abstract", "class", "interface", "extends", "implements", "return", "if", "else", "for", "while", "do", "switch", "case", "break", "continue", "try", "catch", "finally", "throw", "throws", "new", "import", "package", "this", "super", "void", "synchronized", "volatile", "transient", "native", "instanceof", "default", "enum", "assert"],
    types: ["int", "long", "short", "byte", "float", "double", "boolean", "char", "String", "Integer", "Long", "Double", "Float", "Boolean", "Character", "Object", "List", "Map", "Set", "ArrayList", "HashMap", "HashSet"],
    builtins: ["System", "Math", "Arrays", "Collections", "Optional", "Stream", "Thread", "Runnable", "Callable", "Future", "null", "true", "false"],
  },
  css: {
    keywords: ["@import", "@media", "@keyframes", "@font-face", "@supports", "@layer", "@container", "!important"],
    types: ["px", "em", "rem", "%", "vh", "vw", "fr", "ch", "deg", "s", "ms"],
    builtins: ["var", "calc", "min", "max", "clamp", "rgb", "rgba", "hsl", "hsla", "url", "linear-gradient", "radial-gradient", "repeat", "grid", "flex", "none", "auto", "inherit", "initial", "unset"],
  },
  html: {
    keywords: ["DOCTYPE", "html", "head", "body", "div", "span", "p", "a", "img", "ul", "ol", "li", "table", "tr", "td", "th", "form", "input", "button", "select", "option", "textarea", "script", "style", "link", "meta", "title", "header", "footer", "nav", "main", "section", "article", "aside"],
    types: ["class", "id", "href", "src", "alt", "type", "name", "value", "placeholder", "action", "method", "target", "rel", "charset", "content"],
    builtins: [],
  },
  json: { keywords: ["true", "false", "null"], types: [], builtins: [] },
  bash: {
    keywords: ["if", "then", "else", "elif", "fi", "for", "while", "do", "done", "case", "esac", "in", "function", "return", "exit", "export", "source", "local", "readonly", "declare", "unset", "shift", "break", "continue", "trap", "set"],
    types: [],
    builtins: ["echo", "cd", "ls", "cat", "grep", "sed", "awk", "find", "xargs", "sort", "uniq", "wc", "head", "tail", "cut", "tr", "tee", "mkdir", "rm", "cp", "mv", "chmod", "chown", "curl", "wget", "git", "docker", "npm", "yarn", "pip", "python", "node", "cargo", "make", "sudo", "apt", "brew"],
  },
  sql: {
    keywords: ["SELECT", "FROM", "WHERE", "JOIN", "LEFT", "RIGHT", "INNER", "OUTER", "ON", "AND", "OR", "NOT", "IN", "EXISTS", "BETWEEN", "LIKE", "ORDER", "BY", "GROUP", "HAVING", "LIMIT", "OFFSET", "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE", "CREATE", "TABLE", "ALTER", "DROP", "INDEX", "VIEW", "AS", "DISTINCT", "UNION", "ALL", "CASE", "WHEN", "THEN", "ELSE", "END", "IS", "NULL", "TRUE", "FALSE", "PRIMARY", "KEY", "FOREIGN", "REFERENCES", "CONSTRAINT", "DEFAULT", "AUTO_INCREMENT", "NOT", "UNIQUE", "CASCADE"],
    types: ["INT", "INTEGER", "BIGINT", "SMALLINT", "VARCHAR", "TEXT", "BOOLEAN", "DATE", "TIMESTAMP", "FLOAT", "DOUBLE", "DECIMAL", "BLOB", "JSON", "UUID", "SERIAL"],
    builtins: ["COUNT", "SUM", "AVG", "MIN", "MAX", "COALESCE", "IFNULL", "CONCAT", "LENGTH", "SUBSTRING", "TRIM", "UPPER", "LOWER", "NOW", "CURRENT_TIMESTAMP", "CAST", "CONVERT"],
  },
};

// Alias map
const LANG_ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  rs: "rust",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  yml: "yaml",
  htm: "html",
  xml: "html",
  c: "java",
  cpp: "java",
  "c++": "java",
  csharp: "java",
  "c#": "java",
  kotlin: "java",
  swift: "java",
  scala: "java",
  rb: "python",
  ruby: "python",
  php: "python",
  lua: "python",
  r: "python",
  sass: "css",
  scss: "css",
  less: "css",
  mysql: "sql",
  postgresql: "sql",
  sqlite: "sql",
  toml: "json",
  yaml: "json",
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function highlightCode(code: string, lang: string): string {
  const normalizedLang = LANG_ALIASES[lang.toLowerCase()] || lang.toLowerCase();
  const langDef = KEYWORD_SETS[normalizedLang];

  if (!langDef) {
    return highlightGeneric(code);
  }

  let result = escapeHtml(code);

  // Strings (single and double quoted)
  result = result.replace(
    /(&quot;(?:[^&]|&(?!quot;))*?&quot;)|('(?:[^'\\]|\\.)*?')|(`(?:[^`\\]|\\.)*?`)/g,
    '<span class="hl-string">$&</span>'
  );

  // Comments
  result = result.replace(
    /(\/\/.*$)|(#(?!\s*!).*$)/gm,
    '<span class="hl-comment">$&</span>'
  );

  // Multi-line comments
  result = result.replace(
    /\/\*[\s\S]*?\*\//g,
    '<span class="hl-comment">$&</span>'
  );

  // Numbers
  result = result.replace(
    /\b(\d+\.?\d*(?:e[+-]?\d+)?|0x[0-9a-fA-F]+|0b[01]+|0o[0-7]+)\b/g,
    '<span class="hl-number">$1</span>'
  );

  // Keywords
  for (const kw of langDef.keywords) {
    const re = new RegExp(`\\b(${escapeRegex(kw)})\\b`, "g");
    result = result.replace(re, '<span class="hl-keyword">$1</span>');
  }

  // Types
  for (const t of langDef.types) {
    const re = new RegExp(`\\b(${escapeRegex(t)})\\b`, "g");
    result = result.replace(re, '<span class="hl-type">$1</span>');
  }

  // Builtins
  for (const b of langDef.builtins) {
    const re = new RegExp(`\\b(${escapeRegex(b)})\\b`, "g");
    result = result.replace(re, '<span class="hl-builtin">$1</span>');
  }

  return result;
}

function highlightGeneric(code: string): string {
  let result = escapeHtml(code);

  // Strings
  result = result.replace(
    /(&quot;(?:[^&]|&(?!quot;))*?&quot;)|('(?:[^'\\]|\\.)*?')/g,
    '<span class="hl-string">$&</span>'
  );

  // Comments
  result = result.replace(
    /(\/\/.*$)|(#.*$)/gm,
    '<span class="hl-comment">$&</span>'
  );

  // Numbers
  result = result.replace(
    /\b(\d+\.?\d*)\b/g,
    '<span class="hl-number">$1</span>'
  );

  return result;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
