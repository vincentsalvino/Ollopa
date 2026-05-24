use regex::Regex;
use serde::Serialize;
use serde_json::Value;

/// Risk level for a tool invocation
#[derive(Debug, Clone, Serialize, PartialEq)]
pub enum RiskLevel {
    Safe,
    Low,
    Medium,
    High,
    Critical,
}

/// Approval decision from the user
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub enum ApprovalDecision {
    Approved,
    Denied,
}

/// Dangerous command patterns that require user approval
const DANGEROUS_PATTERNS: &[(&str, &str, RiskLevel)] = &[
    (r"rm\s+-rf", "Recursive force delete", RiskLevel::Critical),
    (r"rm\s+-r", "Recursive delete", RiskLevel::High),
    (r"DROP\s+TABLE", "Drops database table", RiskLevel::Critical),
    (r"DROP\s+DATABASE", "Drops entire database", RiskLevel::Critical),
    (r"DELETE\s+FROM", "Deletes database records", RiskLevel::High),
    (r"sudo\s+", "Runs with elevated privileges", RiskLevel::High),
    (
        r"curl\s+.*\|\s*bash",
        "Pipes remote script to shell",
        RiskLevel::Critical,
    ),
    (
        r"curl\s+.*\|\s*sh",
        "Pipes remote script to shell",
        RiskLevel::Critical,
    ),
    (
        r"wget\s+.*\|\s*bash",
        "Pipes remote script to shell",
        RiskLevel::Critical,
    ),
    (
        r"wget\s+.*\|\s*sh",
        "Pipes remote script to shell",
        RiskLevel::Critical,
    ),
    (
        r"git\s+push\s+--force",
        "Force pushes, may overwrite remote history",
        RiskLevel::High,
    ),
    (
        r"chmod\s+777",
        "Sets world-writable permissions",
        RiskLevel::Medium,
    ),
];

/// Tools that always require approval
const APPROVAL_REQUIRED_TOOLS: &[&str] = &[
    "bash",
    "execute_bash",
    "run_command",
    "write",
    "edit",
    "str_replace_editor",
    "create_file",
    "delete_file",
];

/// Classify the risk of a tool invocation.
pub fn classify_risk(tool_name: &str, input: &Value) -> (RiskLevel, String) {
    // Check if tool itself requires approval
    let tool_requires_approval = APPROVAL_REQUIRED_TOOLS
        .iter()
        .any(|t| tool_name.eq_ignore_ascii_case(t));

    if !tool_requires_approval {
        return (RiskLevel::Safe, String::new());
    }

    // Check the input for dangerous patterns
    let input_text = match input {
        Value::String(s) => s.clone(),
        Value::Object(map) => {
            // Check common input fields
            let cmd = map.get("command").and_then(|v| v.as_str()).unwrap_or("");
            let content = map.get("content").and_then(|v| v.as_str()).unwrap_or("");
            let path = map.get("path").and_then(|v| v.as_str()).unwrap_or("");
            format!("{} {} {}", cmd, content, path)
        }
        _ => serde_json::to_string(input).unwrap_or_default(),
    };

    for (pattern, description, level) in DANGEROUS_PATTERNS {
        if let Ok(re) = Regex::new(pattern) {
            if re.is_match(&input_text) {
                return (level.clone(), description.to_string());
            }
        }
    }

    // Default risk for tools that require approval
    let risk_label = generate_risk_label(tool_name, input);
    (RiskLevel::Low, risk_label)
}

/// Generate a human-readable risk label for a tool invocation.
fn generate_risk_label(tool_name: &str, input: &Value) -> String {
    match tool_name {
        "bash" | "execute_bash" | "run_command" => {
            let cmd = input
                .get("command")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown command");
            format!("Will execute: {}", truncate(cmd, 100))
        }
        "write" | "create_file" | "str_replace_editor" => {
            let path = input
                .get("path")
                .or_else(|| input.get("file_path"))
                .and_then(|v| v.as_str())
                .unwrap_or("unknown file");
            format!("Will modify: {}", path)
        }
        "edit" => {
            let path = input
                .get("path")
                .or_else(|| input.get("file_path"))
                .and_then(|v| v.as_str())
                .unwrap_or("unknown file");
            format!("Will edit: {}", path)
        }
        "delete_file" => {
            let path = input
                .get("path")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown file");
            format!("Will delete: {}", path)
        }
        _ => format!("Tool: {} requires approval", tool_name),
    }
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}...", &s[..max])
    }
}

/// Check if a tool requires approval based on its name.
#[allow(dead_code)]
pub fn requires_approval(tool_name: &str) -> bool {
    APPROVAL_REQUIRED_TOOLS
        .iter()
        .any(|t| tool_name.eq_ignore_ascii_case(t))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_safe_tool() {
        let (risk, _) = classify_risk("read_file", &json!({"path": "src/main.rs"}));
        assert_eq!(risk, RiskLevel::Safe);
    }

    #[test]
    fn test_dangerous_bash() {
        let (risk, desc) = classify_risk("bash", &json!({"command": "rm -rf /tmp/stuff"}));
        assert_eq!(risk, RiskLevel::Critical);
        assert!(desc.contains("Recursive force delete"));
    }

    #[test]
    fn test_normal_bash() {
        let (risk, _) = classify_risk("bash", &json!({"command": "ls -la"}));
        assert_eq!(risk, RiskLevel::Low);
    }
}
