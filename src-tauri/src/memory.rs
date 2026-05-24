use serde::Deserialize;
use std::fs;
use std::path::PathBuf;

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

/// Get the path to ~/.claude/
fn claude_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/home/ubuntu"))
        .join(".claude")
}

/// Read ~/.claude/CLAUDE.md
pub fn read_claude_md() -> String {
    let path = claude_dir().join("CLAUDE.md");
    fs::read_to_string(&path).unwrap_or_default()
}

/// Read <project_path>/CLAUDE.md if it exists
pub fn read_project_claude_md(project_path: &str) -> String {
    let path = PathBuf::from(project_path).join("CLAUDE.md");
    fs::read_to_string(&path).unwrap_or_default()
}

/// Read last 3 lines of ~/.claude/deepseek_memory.md
pub fn read_memory_last_lines() -> Vec<String> {
    let path = claude_dir().join("deepseek_memory.md");
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
    let path = claude_dir().join("deepseek_memory.md");
    fs::read_to_string(&path).unwrap_or_default()
}

/// Write full memory file content (memory editor)
pub fn write_memory_full(content: &str) -> Result<(), String> {
    let path = claude_dir().join("deepseek_memory.md");
    fs::write(&path, content).map_err(|e| format!("Failed to write memory: {}", e))
}

/// Build the initial injection message for the pty session.
/// If a project path is provided, also injects project-level CLAUDE.md.
pub fn build_initial_injection(project_path: Option<&str>) -> Option<String> {
    let claude_md = read_claude_md();
    let memory = read_memory_full();
    let project_md = project_path
        .map(|p| read_project_claude_md(p))
        .unwrap_or_default();

    if claude_md.is_empty() && memory.is_empty() && project_md.is_empty() {
        return None;
    }

    let mut injection = String::new();

    if !memory.is_empty() {
        injection.push_str("Context from my memory file (~/.claude/deepseek_memory.md):\n");
        injection.push_str(&memory);
        injection.push_str("\n\n");
    }

    if !project_md.is_empty() {
        injection.push_str("Project-level config (CLAUDE.md):\n");
        injection.push_str(&project_md);
        injection.push_str("\n\n");
    }

    if !claude_md.is_empty() {
        injection.push_str("My global config (~/.claude/CLAUDE.md):\n");
        injection.push_str(&claude_md);
        injection.push_str("\n\n");
    }

    injection.push_str("Acknowledge these silently and wait for my first task.");

    Some(injection)
}

/// Parse JSONL session logs from ~/.claude/projects/ to compute total token cost
pub fn compute_token_cost() -> CostData {
    let projects_dir = claude_dir().join("projects");
    let mut total_input: u64 = 0;
    let mut total_output: u64 = 0;

    if let Ok(entries) = fs::read_dir(&projects_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Ok(files) = fs::read_dir(&path) {
                    for file in files.flatten() {
                        let fpath = file.path();
                        if fpath.extension().map_or(false, |e| e == "jsonl") {
                            if let Ok(content) = fs::read_to_string(&fpath) {
                                for line in content.lines() {
                                    if let Ok(entry) =
                                        serde_json::from_str::<SessionLogEntry>(line)
                                    {
                                        if let Some(usage) = entry.usage {
                                            total_input += usage.input_tokens;
                                            total_output += usage.output_tokens;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

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
    let path = claude_dir().join("deepseek_memory.md");
    let mut content = fs::read_to_string(&path).unwrap_or_default();
    if !content.ends_with('\n') && !content.is_empty() {
        content.push('\n');
    }
    content.push_str(entry);
    content.push('\n');
    fs::write(&path, content).map_err(|e| format!("Failed to write memory: {}", e))
}
