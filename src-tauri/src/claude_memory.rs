use std::fs;
use std::path::PathBuf;

/// Get the path to ~/.claude/
fn claude_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/home/ubuntu"))
        .join(".claude")
}

/// Read ~/.claude/CLAUDE.md (global instructions, managed by Claude Code)
pub fn read_claude_md() -> String {
    let path = claude_dir().join("CLAUDE.md");
    fs::read_to_string(&path).unwrap_or_default()
}

/// Read ~/.claude/deepseek_memory.md (shared memory file)
pub fn read_claude_memory() -> String {
    let path = claude_dir().join("deepseek_memory.md");
    fs::read_to_string(&path).unwrap_or_default()
}

/// Write to ~/.claude/deepseek_memory.md
pub fn write_claude_memory(content: &str) -> Result<(), String> {
    let path = claude_dir().join("deepseek_memory.md");
    fs::write(&path, content).map_err(|e| format!("Failed to write Claude memory: {}", e))
}

/// Append to ~/.claude/deepseek_memory.md
pub fn append_claude_memory(entry: &str) -> Result<(), String> {
    let path = claude_dir().join("deepseek_memory.md");
    let mut content = fs::read_to_string(&path).unwrap_or_default();
    if !content.ends_with('\n') && !content.is_empty() {
        content.push('\n');
    }
    content.push_str(entry);
    content.push('\n');
    fs::write(&path, content).map_err(|e| format!("Failed to write Claude memory: {}", e))
}

/// Combined memory data for the dashboard — merges Ollopa + Claude Code
#[derive(Clone, serde::Serialize)]
pub struct SharedMemoryData {
    pub ollopa_md: String,
    pub claude_md: String,
    pub ollopa_memory: String,
    pub claude_memory: String,
    pub memory_lines: Vec<String>,
}

/// Get merged memory data from both Ollopa and Claude Code locations
pub fn get_shared_memory_data() -> SharedMemoryData {
    let ollopa_md = crate::memory::read_ollopa_md();
    let claude_md = read_claude_md();
    let ollopa_memory = crate::memory::read_memory_full();
    let claude_memory = read_claude_memory();

    // Merge memory lines from both sources, deduplicated
    let mut lines: Vec<String> = Vec::new();
    for line in ollopa_memory.lines().chain(claude_memory.lines()) {
        let trimmed = line.trim();
        if !trimmed.is_empty() && !lines.contains(&trimmed.to_string()) {
            lines.push(trimmed.to_string());
        }
    }

    SharedMemoryData {
        ollopa_md,
        claude_md,
        ollopa_memory,
        claude_memory,
        memory_lines: lines,
    }
}
