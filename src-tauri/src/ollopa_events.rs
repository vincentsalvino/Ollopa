use serde::{Deserialize, Serialize};
use serde_json::Value;

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

    #[serde(rename = "streaming_chunk")]
    StreamingChunk {
        text: String,
        model: String,
    },

    #[serde(rename = "generation_stopped")]
    GenerationStopped {
        partial_text: String,
        model: String,
    },
}
