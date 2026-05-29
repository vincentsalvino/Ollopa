use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    #[serde(rename = "type")]
    pub tool_type: String,
    pub function: FunctionDef,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionDef {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

pub fn builtin_tools() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            tool_type: "function".to_string(),
            function: FunctionDef {
                name: "read_file".to_string(),
                description: "Read the contents of a file at the given path".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "File path to read" }
                    },
                    "required": ["path"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".to_string(),
            function: FunctionDef {
                name: "list_directory".to_string(),
                description: "List files and directories at the given path".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Directory path to list" }
                    },
                    "required": ["path"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".to_string(),
            function: FunctionDef {
                name: "search_code".to_string(),
                description: "Search for a pattern in files under a directory".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "pattern": { "type": "string", "description": "Search pattern (substring)" },
                        "path": { "type": "string", "description": "Directory to search in" }
                    },
                    "required": ["pattern", "path"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".to_string(),
            function: FunctionDef {
                name: "read_memory".to_string(),
                description: "Read the shared memory file content".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {}
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".to_string(),
            function: FunctionDef {
                name: "get_git_status".to_string(),
                description: "Get git status for a project directory".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Project directory path" }
                    },
                    "required": ["path"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".to_string(),
            function: FunctionDef {
                name: "web_search".to_string(),
                description: "Search the web for information".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "query": { "type": "string", "description": "Search query" }
                    },
                    "required": ["query"]
                }),
            },
        },
        // ═══════ Write Tools ═══════
        ToolDefinition {
            tool_type: "function".to_string(),
            function: FunctionDef {
                name: "write_file".to_string(),
                description: "Create or overwrite a file with the given content".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "File path to write" },
                        "content": { "type": "string", "description": "Content to write" }
                    },
                    "required": ["path", "content"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".to_string(),
            function: FunctionDef {
                name: "edit_file".to_string(),
                description: "Edit a file by replacing a search string with a replacement string".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "File path to edit" },
                        "search": { "type": "string", "description": "Exact text to find" },
                        "replace": { "type": "string", "description": "Text to replace with" }
                    },
                    "required": ["path", "search", "replace"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".to_string(),
            function: FunctionDef {
                name: "shell_execute".to_string(),
                description: "Execute a shell command and return stdout, stderr, and exit code".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "command": { "type": "string", "description": "Shell command to execute" },
                        "cwd": { "type": "string", "description": "Working directory (optional)" }
                    },
                    "required": ["command"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".to_string(),
            function: FunctionDef {
                name: "web_fetch".to_string(),
                description: "Fetch a URL and return its text content".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "url": { "type": "string", "description": "URL to fetch" }
                    },
                    "required": ["url"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".to_string(),
            function: FunctionDef {
                name: "git_command".to_string(),
                description: "Execute a git command (add, commit, diff, log, etc.)".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "args": { "type": "string", "description": "Git arguments (e.g. 'status', 'diff --staged')" },
                        "cwd": { "type": "string", "description": "Repository path (optional)" }
                    },
                    "required": ["args"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".to_string(),
            function: FunctionDef {
                name: "save_memory".to_string(),
                description: "Save a note to the Second Brain for future reference".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "content": { "type": "string", "description": "Content to remember" },
                        "tags": { "type": "string", "description": "Comma-separated tags (optional)" }
                    },
                    "required": ["content"]
                }),
            },
        },
    ]
}

/// Resolve a path argument against the working directory.
/// If the path is relative, it's resolved against working_dir.
/// If working_dir is None, the path is used as-is.
fn resolve_path(path_str: &str, working_dir: Option<&str>) -> PathBuf {
    let p = Path::new(path_str);
    if p.is_absolute() {
        p.to_path_buf()
    } else if let Some(wd) = working_dir {
        Path::new(wd).join(p)
    } else {
        p.to_path_buf()
    }
}

pub fn execute_tool(name: &str, args: &Value, working_dir: Option<&str>) -> Result<String, String> {
    match name {
        "read_file" => {
            let path_str = args["path"].as_str().ok_or("Missing 'path' argument")?;
            let path = resolve_path(path_str, working_dir);
            std::fs::read_to_string(&path)
                .map_err(|e| format!("Failed to read file '{}': {}", path.display(), e))
        }
        "list_directory" => {
            let path_str = args["path"].as_str().unwrap_or(".");
            let path = resolve_path(path_str, working_dir);
            let entries = std::fs::read_dir(&path)
                .map_err(|e| format!("Failed to read directory '{}': {}", path.display(), e))?;
            let mut listing = Vec::new();
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
                listing.push(if is_dir { format!("{}/", name) } else { name });
            }
            listing.sort();
            Ok(listing.join("\n"))
        }
        "search_code" => {
            let pattern = args["pattern"].as_str().ok_or("Missing 'pattern' argument")?;
            let path_str = args["path"].as_str().unwrap_or(".");
            let path = resolve_path(path_str, working_dir);
            let path_s = path.to_string_lossy().to_string();
            let mut results = Vec::new();
            search_files_recursive(&path_s, pattern, &mut results, 0, 5);
            if results.is_empty() {
                Ok("No matches found".to_string())
            } else {
                Ok(results.join("\n"))
            }
        }
        "read_memory" => {
            Ok(crate::memory::read_memory_full())
        }
        "get_git_status" => {
            let path_str = args["path"].as_str().unwrap_or(".");
            let path = resolve_path(path_str, working_dir);
            let path_s = path.to_string_lossy().to_string();
            let info = crate::git_intelligence::get_git_info(&path_s);
            serde_json::to_string_pretty(&info)
                .map_err(|e| format!("Failed to serialize git info: {}", e))
        }
        "web_search" => {
            let query = args["query"].as_str().ok_or("Missing 'query' argument")?;
            Ok(format!("[Web search for '{}' — use the web search toggle for live results]", query))
        }
        // ═══════ Write Tools ═══════
        "write_file" => {
            let path_str = args["path"].as_str().ok_or("Missing 'path' argument")?;
            let content = args["content"].as_str().ok_or("Missing 'content' argument")?;
            let path = resolve_path(path_str, working_dir);
            // Ensure parent directory exists
            if let Some(parent) = path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            std::fs::write(&path, content)
                .map_err(|e| format!("Failed to write file '{}': {}", path.display(), e))?;
            Ok(format!("File written: {} ({} bytes)", path.display(), content.len()))
        }
        "edit_file" => {
            let path_str = args["path"].as_str().ok_or("Missing 'path' argument")?;
            let search = args["search"].as_str().ok_or("Missing 'search' argument")?;
            let replace = args["replace"].as_str().ok_or("Missing 'replace' argument")?;
            let path = resolve_path(path_str, working_dir);
            let content = std::fs::read_to_string(&path)
                .map_err(|e| format!("Failed to read file '{}': {}", path.display(), e))?;
            if !content.contains(search) {
                return Err(format!("Search text not found in '{}'", path.display()));
            }
            let new_content = content.replacen(search, replace, 1);
            std::fs::write(&path, &new_content)
                .map_err(|e| format!("Failed to write file '{}': {}", path.display(), e))?;
            Ok(format!("File edited: {} (replaced 1 occurrence)", path.display()))
        }
        "shell_execute" => {
            let command = args["command"].as_str().ok_or("Missing 'command' argument")?;
            let cwd = args["cwd"].as_str().or(working_dir);
            let mut cmd = std::process::Command::new("sh");
            cmd.arg("-c").arg(command);
            if let Some(d) = cwd {
                cmd.current_dir(d);
            }
            let output = cmd.output()
                .map_err(|e| format!("Failed to execute command: {}", e))?;
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            let exit_code = output.status.code().unwrap_or(-1);
            Ok(format!("exit_code: {}\nstdout:\n{}\nstderr:\n{}", exit_code, stdout, stderr))
        }
        "web_fetch" => {
            let url = args["url"].as_str().ok_or("Missing 'url' argument")?;
            // Synchronous HTTP fetch using a blocking approach
            let output = std::process::Command::new("curl")
                .args(["--silent", "--max-time", "10", "-L", url])
                .output()
                .map_err(|e| format!("Failed to fetch URL: {}", e))?;
            let body = String::from_utf8_lossy(&output.stdout).to_string();
            if body.is_empty() {
                let err = String::from_utf8_lossy(&output.stderr).to_string();
                Err(format!("Failed to fetch URL: {}", err))
            } else {
                // Truncate to avoid overwhelming context
                let max = 10000;
                if body.len() > max {
                    Ok(format!("{}\n\n[Truncated, {} total bytes]", &body[..max], body.len()))
                } else {
                    Ok(body)
                }
            }
        }
        "git_command" => {
            let git_args = args["args"].as_str().ok_or("Missing 'args' argument")?;
            let cwd = args["cwd"].as_str().or(working_dir);
            let mut cmd = std::process::Command::new("git");
            for arg in git_args.split_whitespace() {
                cmd.arg(arg);
            }
            if let Some(d) = cwd {
                cmd.current_dir(d);
            }
            let output = cmd.output()
                .map_err(|e| format!("Failed to run git: {}", e))?;
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            if output.status.success() {
                Ok(stdout)
            } else {
                Err(format!("git error: {}", stderr))
            }
        }
        "save_memory" => {
            let content = args["content"].as_str().ok_or("Missing 'content' argument")?;
            let tags_str = args["tags"].as_str().unwrap_or("");
            let tags: Vec<String> = tags_str.split(',').map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).collect();
            crate::second_brain::index_note(content, working_dir, &tags)
                .map_err(|e| format!("Failed to save memory: {}", e))?;
            Ok("Memory saved to Second Brain".to_string())
        }
        _ => Err(format!("Unknown tool: {}", name)),
    }
}

fn search_files_recursive(dir: &str, pattern: &str, results: &mut Vec<String>, depth: usize, max_depth: usize) {
    if depth > max_depth || results.len() >= 50 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        if name.starts_with('.') || name == "node_modules" || name == "target" || name == "dist" {
            continue;
        }
        if path.is_dir() {
            search_files_recursive(&path.to_string_lossy(), pattern, results, depth + 1, max_depth);
        } else if path.is_file() {
            if let Ok(content) = std::fs::read_to_string(&path) {
                for (line_num, line) in content.lines().enumerate() {
                    if line.contains(pattern) {
                        results.push(format!("{}:{}: {}", path.display(), line_num + 1, line.trim()));
                        if results.len() >= 50 { return; }
                    }
                }
            }
        }
    }
}
