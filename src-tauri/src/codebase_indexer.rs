use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodebaseIndex {
    pub files: Vec<FileIndex>,
    pub symbols: Vec<Symbol>,
    pub last_indexed: u64,
}

// ═══════ Repo Map (Phase 3) ═══════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoMap {
    pub entries: Vec<RepoMapEntry>,
    pub project_path: String,
    pub generated_at: u64,
    pub total_files: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoMapEntry {
    pub path: String,
    pub language: String,
    pub exported_symbols: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileSelection {
    pub files: Vec<SelectedFile>,
    pub total_tokens: usize,
    pub budget_remaining: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelectedFile {
    pub path: String,
    pub relevance_score: f64,
    pub token_estimate: usize,
    pub content: String,
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

// ═══════ Repo Map Generation (Phase 3) ═══════

fn repo_map_cache_path(project_path: &str) -> PathBuf {
    let hash = project_path.bytes().fold(0u64, |acc, b| acc.wrapping_mul(31).wrapping_add(b as u64));
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/home/ubuntu"))
        .join(".ollopa")
        .join("repo-maps")
        .join(format!("{}.json", hash))
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Generate a compact repo map: path → [exported symbols] (~1-2 lines per file).
/// Cached and refreshed when stale (>5 min old).
pub fn generate_repo_map(project_path: &str) -> Result<RepoMap, String> {
    let cache_path = repo_map_cache_path(project_path);

    // Check cache freshness (5 min TTL)
    if let Ok(cached) = fs::read_to_string(&cache_path) {
        if let Ok(map) = serde_json::from_str::<RepoMap>(&cached) {
            if now_ms() - map.generated_at < 300_000 {
                return Ok(map);
            }
        }
    }

    let index = index_project(project_path)?;

    // Group symbols by file path
    let mut symbols_by_file: HashMap<String, Vec<String>> = HashMap::new();
    for sym in &index.symbols {
        // Only include exported/public symbols for the map
        symbols_by_file
            .entry(sym.file_path.clone())
            .or_default()
            .push(format!("{}:{}", sym.kind.chars().next().unwrap_or('?'), sym.name));
    }

    // Strip project path prefix for compact display
    let prefix = format!("{}/", project_path.trim_end_matches('/'));

    let entries: Vec<RepoMapEntry> = index.files.iter().map(|f| {
        let relative = f.path.strip_prefix(&prefix).unwrap_or(&f.path);
        let symbols = symbols_by_file
            .get(&f.path)
            .cloned()
            .unwrap_or_default();
        RepoMapEntry {
            path: relative.to_string(),
            language: f.language.clone(),
            exported_symbols: symbols,
        }
    }).collect();

    let map = RepoMap {
        total_files: entries.len(),
        entries,
        project_path: project_path.to_string(),
        generated_at: now_ms(),
    };

    // Cache the result
    let _ = fs::create_dir_all(cache_path.parent().unwrap_or(Path::new(".")));
    let _ = fs::write(&cache_path, serde_json::to_string(&map).unwrap_or_default());

    Ok(map)
}

/// Render repo map as compact text for LLM context injection.
pub fn repo_map_to_text(map: &RepoMap) -> String {
    let mut lines = Vec::with_capacity(map.entries.len() + 2);
    lines.push(format!("# Repo Map ({} files)", map.total_files));
    for entry in &map.entries {
        if entry.exported_symbols.is_empty() {
            lines.push(format!("  {} [{}]", entry.path, entry.language));
        } else {
            lines.push(format!(
                "  {} [{}] → {}",
                entry.path,
                entry.language,
                entry.exported_symbols.join(", ")
            ));
        }
    }
    lines.join("\n")
}

// ═══════ Task-Based File Selection (Phase 3) ═══════

/// Estimate tokens for a string (rough: ~4 chars per token).
fn estimate_tokens(text: &str) -> usize {
    text.len() / 4
}

/// Select the 5-15 most relevant files for a given task description.
/// Uses keyword matching against file paths and symbol names.
pub fn select_files_for_task(
    project_path: &str,
    task: &str,
    max_files: usize,
    token_budget: usize,
) -> Result<FileSelection, String> {
    let map = generate_repo_map(project_path)?;
    let task_lower = task.to_lowercase();
    let task_words: Vec<&str> = task_lower
        .split_whitespace()
        .filter(|w| w.len() > 2)
        .collect();

    // Score each file by relevance to the task
    let mut scored: Vec<(f64, &RepoMapEntry)> = map.entries.iter().map(|entry| {
        let path_lower = entry.path.to_lowercase();
        let mut score = 0.0_f64;

        // Path matching
        for word in &task_words {
            if path_lower.contains(word) {
                score += 3.0;
            }
        }

        // Symbol matching
        for sym in &entry.exported_symbols {
            let sym_lower = sym.to_lowercase();
            for word in &task_words {
                if sym_lower.contains(word) {
                    score += 2.0;
                }
            }
        }

        // Language bonus for code files vs config/docs
        match entry.language.as_str() {
            "rust" | "typescript" | "javascript" | "python" | "go" | "java" => score += 1.0,
            "json" | "toml" | "yaml" => score += 0.3,
            _ => {}
        }

        // Prefer shorter paths (likely more important)
        let depth = entry.path.matches('/').count();
        if depth <= 2 {
            score += 0.5;
        }

        (score, entry)
    }).collect();

    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

    let effective_max = max_files.min(15).max(5);
    let mut selected = Vec::new();
    let mut total_tokens = 0_usize;

    let prefix = format!("{}/", project_path.trim_end_matches('/'));

    for (score, entry) in scored.iter().take(effective_max * 2) {
        if *score <= 0.0 || selected.len() >= effective_max {
            break;
        }

        let full_path = if entry.path.starts_with('/') {
            entry.path.clone()
        } else {
            format!("{}{}", prefix, entry.path)
        };

        let content = match fs::read_to_string(&full_path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let tokens = estimate_tokens(&content);
        if total_tokens + tokens > token_budget {
            continue;
        }

        total_tokens += tokens;
        selected.push(SelectedFile {
            path: entry.path.clone(),
            relevance_score: *score,
            token_estimate: tokens,
            content,
        });
    }

    Ok(FileSelection {
        files: selected,
        total_tokens,
        budget_remaining: token_budget.saturating_sub(total_tokens),
    })
}

/// Invalidate cached repo map for a project (call on file change).
pub fn invalidate_repo_map(project_path: &str) {
    let cache_path = repo_map_cache_path(project_path);
    let _ = fs::remove_file(cache_path);
}
