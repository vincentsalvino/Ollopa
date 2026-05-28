use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

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
    ]
}

pub fn execute_tool(name: &str, args: &Value) -> Result<String, String> {
    match name {
        "read_file" => {
            let path = args["path"].as_str().ok_or("Missing 'path' argument")?;
            std::fs::read_to_string(path)
                .map_err(|e| format!("Failed to read file: {}", e))
        }
        "list_directory" => {
            let path = args["path"].as_str().ok_or("Missing 'path' argument")?;
            let entries = std::fs::read_dir(path)
                .map_err(|e| format!("Failed to read directory: {}", e))?;
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
            let path = args["path"].as_str().ok_or("Missing 'path' argument")?;
            let mut results = Vec::new();
            search_files_recursive(path, pattern, &mut results, 0, 5);
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
            let path = args["path"].as_str().ok_or("Missing 'path' argument")?;
            let info = crate::git_intelligence::get_git_info(path);
            serde_json::to_string_pretty(&info)
                .map_err(|e| format!("Failed to serialize git info: {}", e))
        }
        "web_search" => {
            let query = args["query"].as_str().ok_or("Missing 'query' argument")?;
            // Web search is async; return a placeholder for sync context
            Ok(format!("[Web search for '{}' — use the web search toggle for live results]", query))
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
