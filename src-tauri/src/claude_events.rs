use serde::{Deserialize, Serialize};
use serde_json::Value;

// ═══════ Claude stream-json event types (from `claude --output-format stream-json`) ═══════

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type")]
#[allow(dead_code)]
pub enum ClaudeStreamEvent {
    #[serde(rename = "system")]
    System {
        subtype: String,
        #[serde(default)]
        cwd: Option<String>,
        #[serde(default)]
        session_id: Option<String>,
        #[serde(default)]
        tools: Option<Vec<String>>,
        #[serde(default)]
        model: Option<String>,
        #[serde(default)]
        mcp_servers: Option<Vec<Value>>,
    },

    #[serde(rename = "assistant")]
    Assistant {
        message: AssistantMessage,
        #[serde(default)]
        session_id: Option<String>,
    },

    #[serde(rename = "user")]
    User {
        message: UserMessage,
        #[serde(default)]
        session_id: Option<String>,
    },

    #[serde(rename = "result")]
    Result {
        subtype: String,
        #[serde(default)]
        cost_usd: Option<f64>,
        #[serde(default)]
        duration_ms: Option<u64>,
        #[serde(default)]
        duration_api_ms: Option<u64>,
        #[serde(default)]
        is_error: bool,
        #[serde(default)]
        num_turns: Option<u32>,
        #[serde(default)]
        session_id: Option<String>,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
pub struct AssistantMessage {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub role: Option<String>,
    pub content: Vec<ContentBlock>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub stop_reason: Option<String>,
    #[serde(default)]
    pub usage: Option<Usage>,
}

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
pub struct UserMessage {
    #[serde(default)]
    pub role: Option<String>,
    pub content: Vec<ContentBlock>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type")]
pub enum ContentBlock {
    #[serde(rename = "text")]
    Text {
        text: String,
    },

    #[serde(rename = "tool_use")]
    ToolUse {
        id: String,
        name: String,
        input: Value,
    },

    #[serde(rename = "tool_result")]
    ToolResult {
        tool_use_id: String,
        #[serde(default)]
        content: Option<String>,
        #[serde(default)]
        is_error: Option<bool>,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[allow(dead_code)]
pub struct Usage {
    #[serde(default)]
    pub input_tokens: u64,
    #[serde(default)]
    pub output_tokens: u64,
    #[serde(default)]
    pub cache_creation_input_tokens: Option<u64>,
    #[serde(default)]
    pub cache_read_input_tokens: Option<u64>,
}

// ═══════ Internal App Events (emitted to frontend) ═══════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
#[allow(dead_code)]
pub enum AppEvent {
    #[serde(rename = "session_started")]
    SessionStarted {
        session_id: String,
        model: String,
        cwd: String,
        tools: Vec<String>,
    },

    #[serde(rename = "user_message")]
    UserMessage {
        text: String,
    },

    #[serde(rename = "assistant_message")]
    AssistantMessage {
        text: String,
        model: String,
    },

    #[serde(rename = "tool_started")]
    ToolStarted {
        tool_use_id: String,
        tool_name: String,
        input: Value,
    },

    #[serde(rename = "tool_finished")]
    ToolFinished {
        tool_use_id: String,
        tool_name: String,
        output: String,
        is_error: bool,
    },

    #[serde(rename = "approval_required")]
    ApprovalRequired {
        tool_use_id: String,
        tool_name: String,
        input: Value,
        risk_label: String,
    },

    #[serde(rename = "file_diff")]
    FileDiff {
        tool_use_id: String,
        file_path: String,
        proposed_content: String,
        current_content: String,
        is_new_file: bool,
    },

    #[serde(rename = "token_usage")]
    TokenUsage {
        input_tokens: u64,
        output_tokens: u64,
        cost_usd: f64,
    },

    #[serde(rename = "status_update")]
    StatusUpdate {
        status: String,
        detail: String,
    },

    #[serde(rename = "session_finished")]
    SessionFinished {
        session_id: String,
        cost_usd: f64,
        duration_ms: u64,
        num_turns: u32,
        is_error: bool,
    },

    #[serde(rename = "error")]
    Error {
        message: String,
        recoverable: bool,
    },
}

// ═══════ Parsing ═══════

pub fn parse_stream_line(line: &str) -> Option<ClaudeStreamEvent> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    serde_json::from_str::<ClaudeStreamEvent>(trimmed).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_system_init() {
        let json = r#"{"type":"system","subtype":"init","cwd":"/home/user/project","session_id":"abc123","tools":["bash","read_file"],"model":"claude-sonnet-4-20250514","mcp_servers":[]}"#;
        let event = parse_stream_line(json);
        assert!(event.is_some());
        if let Some(ClaudeStreamEvent::System { subtype, cwd, .. }) = event {
            assert_eq!(subtype, "init");
            assert_eq!(cwd, Some("/home/user/project".to_string()));
        }
    }

    #[test]
    fn parse_assistant_text() {
        let json = r#"{"type":"assistant","message":{"id":"msg_1","role":"assistant","content":[{"type":"text","text":"Hello!"}],"model":"claude-sonnet-4-20250514","stop_reason":"end_turn","usage":{"input_tokens":100,"output_tokens":10}}}"#;
        let event = parse_stream_line(json);
        assert!(event.is_some());
        if let Some(ClaudeStreamEvent::Assistant { message, .. }) = event {
            assert_eq!(message.content.len(), 1);
        }
    }

    #[test]
    fn parse_result() {
        let json = r#"{"type":"result","subtype":"success","cost_usd":0.005,"duration_ms":1234,"duration_api_ms":1000,"is_error":false,"num_turns":3,"session_id":"abc"}"#;
        let event = parse_stream_line(json);
        assert!(event.is_some());
        if let Some(ClaudeStreamEvent::Result { subtype, cost_usd, .. }) = event {
            assert_eq!(subtype, "success");
            assert_eq!(cost_usd, Some(0.005));
        }
    }
}
