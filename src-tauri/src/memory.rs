use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};

/// DeepSeek pricing per million tokens
const INPUT_PRICE_PER_M: f64 = 0.27;
const OUTPUT_PRICE_PER_M: f64 = 1.10;

#[derive(Clone, serde::Serialize)]
pub struct CostData {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cost_usd: f64,
}

#[derive(Clone, serde::Serialize)]
pub struct MemoryData {
    pub ollopa_md: String,
    pub claude_md: String,
    pub memory_lines: Vec<String>,
}

#[derive(Deserialize)]
struct SessionLogEntry {
    #[serde(default)]
    usage: Option<UsageEntry>,
}

#[derive(Deserialize)]
struct UsageEntry {
    #[serde(default)]
    input_tokens: u64,
    #[serde(default)]
    output_tokens: u64,
}

/// Get the path to ~/.ollopa/
fn ollopa_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/home/ubuntu"))
        .join(".ollopa")
}

/// Read ~/.ollopa/OLLOPA.md
pub fn read_ollopa_md() -> String {
    let path = ollopa_dir().join("OLLOPA.md");
    fs::read_to_string(&path).unwrap_or_default()
}

/// Read <project_path>/OLLOPA.md if it exists
#[allow(dead_code)]
pub fn read_project_ollopa_md(project_path: &str) -> String {
    let path = PathBuf::from(project_path).join("OLLOPA.md");
    fs::read_to_string(&path).unwrap_or_default()
}

/// Read last 3 lines of ~/.ollopa/deepseek_memory.md
pub fn read_memory_last_lines() -> Vec<String> {
    let path = ollopa_dir().join("deepseek_memory.md");
    match fs::read_to_string(&path) {
        Ok(content) => {
            let lines: Vec<&str> = content.lines().collect();
            let start = if lines.len() > 3 { lines.len() - 3 } else { 0 };
            lines[start..].iter().map(|s| s.to_string()).collect()
        }
        Err(_) => vec![],
    }
}

/// Read full memory file for injection
pub fn read_memory_full() -> String {
    let path = ollopa_dir().join("deepseek_memory.md");
    fs::read_to_string(&path).unwrap_or_default()
}

/// Write full memory file content (memory editor)
pub fn write_memory_full(content: &str) -> Result<(), String> {
    let path = ollopa_dir().join("deepseek_memory.md");
    fs::write(&path, content).map_err(|e| format!("Failed to write memory: {}", e))
}

/// Parse JSONL session logs from a directory tree, accumulating tokens.
fn accumulate_jsonl_tokens(dir: &Path, input: &mut u64, output: &mut u64) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                accumulate_jsonl_tokens(&path, input, output);
            } else if path.extension().map_or(false, |e| e == "jsonl") {
                if let Ok(content) = fs::read_to_string(&path) {
                    for line in content.lines() {
                        if let Ok(entry) = serde_json::from_str::<SessionLogEntry>(line) {
                            if let Some(usage) = entry.usage {
                                *input += usage.input_tokens;
                                *output += usage.output_tokens;
                            }
                        }
                    }
                }
            }
        }
    }
}

/// Compute total token cost from both Ollopa (~/.ollopa/projects/) and Claude Code (~/.claude/projects/) logs.
pub fn compute_token_cost() -> CostData {
    let mut total_input: u64 = 0;
    let mut total_output: u64 = 0;

    accumulate_jsonl_tokens(&ollopa_dir().join("projects"), &mut total_input, &mut total_output);

    let claude_projects = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/home/ubuntu"))
        .join(".claude")
        .join("projects");
    accumulate_jsonl_tokens(&claude_projects, &mut total_input, &mut total_output);

    let cost = (total_input as f64 / 1_000_000.0) * INPUT_PRICE_PER_M
        + (total_output as f64 / 1_000_000.0) * OUTPUT_PRICE_PER_M;

    CostData {
        input_tokens: total_input,
        output_tokens: total_output,
        cost_usd: (cost * 10000.0).round() / 10000.0,
    }
}

/// Append a decision to the memory file
pub fn append_memory(entry: &str) -> Result<(), String> {
    let path = ollopa_dir().join("deepseek_memory.md");
    let mut content = fs::read_to_string(&path).unwrap_or_default();
    if !content.ends_with('\n') && !content.is_empty() {
        content.push('\n');
    }
    content.push_str(entry);
    content.push('\n');
    fs::write(&path, content).map_err(|e| format!("Failed to write memory: {}", e))
}

// ═══════ Project File Tree ═══════

pub fn read_project_tree(project_path: &str) -> String {
    let mut lines = vec!["Project files:".to_string()];
    tree_recursive(Path::new(project_path), 0, 3, &mut lines);
    lines.join("\n")
}

fn tree_recursive(dir: &Path, depth: usize, max: usize, out: &mut Vec<String>) {
    if depth >= max {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let path = entry.path();
        let name = path.file_name().unwrap_or_default().to_string_lossy();
        if name.starts_with('.')
            || name == "node_modules"
            || name == "target"
            || name == "vendor"
            || name == "dist"
        {
            continue;
        }
        let indent = "  ".repeat(depth);
        if path.is_dir() {
            out.push(format!("{}{}/", indent, name));
            tree_recursive(&path, depth + 1, max, out);
        } else {
            out.push(format!("{}{}", indent, name));
        }
    }
}
