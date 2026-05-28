use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodebaseIndex {
    pub files: Vec<FileIndex>,
    pub symbols: Vec<Symbol>,
    pub last_indexed: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileIndex {
    pub path: String,
    pub language: String,
    pub last_modified: u64,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Symbol {
    pub name: String,
    pub kind: String,
    pub file_path: String,
    pub line: usize,
}

const SKIP_DIRS: &[&str] = &[
    ".git", "node_modules", "target", "dist", "build", ".next",
    "__pycache__", ".venv", "venv", ".idea", ".vscode",
];

const MAX_DEPTH: usize = 10;

pub fn index_project(project_path: &str) -> Result<CodebaseIndex, String> {
    let path = Path::new(project_path);
    if !path.is_dir() {
        return Err(format!("Not a directory: {}", project_path));
    }

    let mut files = Vec::new();
    let mut symbols = Vec::new();
    walk_dir(path, &mut files, &mut symbols, 0);

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    Ok(CodebaseIndex {
        files,
        symbols,
        last_indexed: now,
    })
}

fn walk_dir(dir: &Path, files: &mut Vec<FileIndex>, symbols: &mut Vec<Symbol>, depth: usize) {
    if depth > MAX_DEPTH || files.len() > 5000 {
        return;
    }

    let Ok(entries) = fs::read_dir(dir) else { return };

    for entry in entries.flatten() {
        let path = entry.path();
        let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();

        if name.starts_with('.') || SKIP_DIRS.contains(&name.as_str()) {
            continue;
        }

        if path.is_dir() {
            walk_dir(&path, files, symbols, depth + 1);
        } else if path.is_file() {
            let lang = detect_language(&name);
            if lang.is_empty() {
                continue;
            }

            let meta = fs::metadata(&path).ok();
            let modified = meta.as_ref()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            let size = meta.map(|m| m.len()).unwrap_or(0);

            files.push(FileIndex {
                path: path.to_string_lossy().to_string(),
                language: lang.clone(),
                last_modified: modified,
                size_bytes: size,
            });

            // Extract symbols from source files (only for small files)
            if size < 500_000 {
                if let Ok(content) = fs::read_to_string(&path) {
                    extract_symbols(&content, &lang, &path.to_string_lossy(), symbols);
                }
            }
        }
    }
}

fn detect_language(filename: &str) -> String {
    let ext = filename.rsplit('.').next().unwrap_or("");
    match ext {
        "rs" => "rust".to_string(),
        "ts" | "tsx" => "typescript".to_string(),
        "js" | "jsx" => "javascript".to_string(),
        "py" => "python".to_string(),
        "go" => "go".to_string(),
        "java" => "java".to_string(),
        "css" | "scss" => "css".to_string(),
        "html" => "html".to_string(),
        "json" => "json".to_string(),
        "toml" => "toml".to_string(),
        "yaml" | "yml" => "yaml".to_string(),
        "md" => "markdown".to_string(),
        _ => String::new(),
    }
}

fn extract_symbols(content: &str, lang: &str, file_path: &str, symbols: &mut Vec<Symbol>) {
    for (line_num, line) in content.lines().enumerate() {
        let trimmed = line.trim();
        match lang {
            "rust" => {
                if trimmed.starts_with("pub fn ") || trimmed.starts_with("fn ") {
                    if let Some(name) = extract_fn_name(trimmed, "fn ") {
                        symbols.push(Symbol { name, kind: "function".to_string(), file_path: file_path.to_string(), line: line_num + 1 });
                    }
                } else if trimmed.starts_with("pub struct ") || trimmed.starts_with("struct ") {
                    if let Some(name) = extract_after(trimmed, "struct ") {
                        symbols.push(Symbol { name, kind: "struct".to_string(), file_path: file_path.to_string(), line: line_num + 1 });
                    }
                } else if trimmed.starts_with("pub enum ") || trimmed.starts_with("enum ") {
                    if let Some(name) = extract_after(trimmed, "enum ") {
                        symbols.push(Symbol { name, kind: "enum".to_string(), file_path: file_path.to_string(), line: line_num + 1 });
                    }
                }
            }
            "typescript" | "javascript" => {
                if trimmed.starts_with("export function ") || trimmed.starts_with("function ") {
                    if let Some(name) = extract_fn_name(trimmed, "function ") {
                        symbols.push(Symbol { name, kind: "function".to_string(), file_path: file_path.to_string(), line: line_num + 1 });
                    }
                } else if trimmed.starts_with("export interface ") || trimmed.starts_with("interface ") {
                    if let Some(name) = extract_after(trimmed, "interface ") {
                        symbols.push(Symbol { name, kind: "interface".to_string(), file_path: file_path.to_string(), line: line_num + 1 });
                    }
                } else if trimmed.starts_with("export class ") || trimmed.starts_with("class ") {
                    if let Some(name) = extract_after(trimmed, "class ") {
                        symbols.push(Symbol { name, kind: "class".to_string(), file_path: file_path.to_string(), line: line_num + 1 });
                    }
                } else if trimmed.starts_with("export type ") || (trimmed.starts_with("type ") && trimmed.contains('=')) {
                    if let Some(name) = extract_after(trimmed, "type ") {
                        symbols.push(Symbol { name, kind: "type".to_string(), file_path: file_path.to_string(), line: line_num + 1 });
                    }
                }
            }
            "python" => {
                if trimmed.starts_with("def ") {
                    if let Some(name) = extract_fn_name(trimmed, "def ") {
                        symbols.push(Symbol { name, kind: "function".to_string(), file_path: file_path.to_string(), line: line_num + 1 });
                    }
                } else if trimmed.starts_with("class ") {
                    if let Some(name) = extract_after(trimmed, "class ") {
                        symbols.push(Symbol { name, kind: "class".to_string(), file_path: file_path.to_string(), line: line_num + 1 });
                    }
                }
            }
            "go" => {
                if trimmed.starts_with("func ") {
                    if let Some(name) = extract_fn_name(trimmed, "func ") {
                        symbols.push(Symbol { name, kind: "function".to_string(), file_path: file_path.to_string(), line: line_num + 1 });
                    }
                } else if trimmed.starts_with("type ") && trimmed.contains("struct") {
                    if let Some(name) = extract_after(trimmed, "type ") {
                        symbols.push(Symbol { name, kind: "struct".to_string(), file_path: file_path.to_string(), line: line_num + 1 });
                    }
                }
            }
            _ => {}
        }
    }
}

fn extract_fn_name(line: &str, prefix: &str) -> Option<String> {
    let after = line.split(prefix).nth(1)?;
    let name: String = after.chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect();
    if name.is_empty() { None } else { Some(name) }
}

fn extract_after(line: &str, prefix: &str) -> Option<String> {
    let after = line.split(prefix).nth(1)?;
    let name: String = after.chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect();
    if name.is_empty() { None } else { Some(name) }
}
