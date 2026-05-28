use crate::ollopa_events::AppEvent;
use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio_util::sync::CancellationToken;

/// Configuration for the API client, read from environment variables.
#[derive(Debug, Clone)]
pub struct ApiConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

/// Pricing constants (DeepSeek defaults)
const INPUT_PRICE_PER_M: f64 = 0.27;
const OUTPUT_PRICE_PER_M: f64 = 1.10;

fn is_openrouter_url(url: &str) -> bool {
    url.contains("openrouter.ai")
}

impl ApiConfig {
    /// Create config from a provider router decision.
    pub fn from_provider(
        base_url: &str,
        api_key_env: &str,
        model: &str,
    ) -> Result<Self, String> {
        let api_key = std::env::var(api_key_env).map_err(|_| {
            format!("API key env var '{}' not set", api_key_env)
        })?;
        let base_url = base_url
            .trim_end_matches('/')
            .trim_end_matches("/anthropic")
            .to_string();
        Ok(Self {
            base_url,
            api_key,
            model: model.to_string(),
        })
    }

    pub fn from_env() -> Result<Self, String> {
        let api_key = std::env::var("ANTHROPIC_API_KEY")
            .or_else(|_| std::env::var("ANTHROPIC_AUTH_TOKEN"))
            .map_err(|_| {
                "No API key found. Set ANTHROPIC_API_KEY environment variable.".to_string()
            })?;

        let base_url = std::env::var("ANTHROPIC_BASE_URL")
            .unwrap_or_else(|_| "https://api.deepseek.com".to_string());

        // Strip /anthropic suffix if present (DeepSeek uses OpenAI-compatible format)
        let base_url = base_url
            .trim_end_matches('/')
            .trim_end_matches("/anthropic")
            .to_string();

        let model = std::env::var("ANTHROPIC_MODEL")
            .unwrap_or_else(|_| "deepseek-v4-pro".to_string())
            // Strip ANSI escape codes that may have been accidentally embedded
            .replace("[1m]", "")
            .replace("\x1b[1m", "");

        Ok(Self {
            base_url,
            api_key,
            model,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    stream: bool,
    max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<crate::api_tools::ToolDefinition>>,
}

#[derive(Debug, Deserialize)]
struct StreamChunk {
    choices: Option<Vec<StreamChoice>>,
}

#[derive(Debug, Deserialize)]
struct StreamChoice {
    delta: Option<Delta>,
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Delta {
    content: Option<String>,
    tool_calls: Option<Vec<DeltaToolCall>>,
}

#[derive(Debug, Deserialize)]
struct DeltaToolCall {
    #[allow(dead_code)]
    index: Option<u32>,
    id: Option<String>,
    function: Option<DeltaFunction>,
}

#[derive(Debug, Deserialize)]
struct DeltaFunction {
    name: Option<String>,
    arguments: Option<String>,
}

/// Direct API client that calls OpenAI-compatible endpoints (DeepSeek, etc.)
pub struct DirectApiClient {
    client: Client,
    config: ApiConfig,
    messages: Vec<ChatMessage>,
    session_id: String,
    cancel_token: CancellationToken,
    system_prompt: String,
    smart_context_enabled: bool,
    tools_enabled: bool,
}

fn conversations_dir() -> std::path::PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join(".ollopa")
        .join("conversations")
}

fn conversation_path(session_id: &str) -> std::path::PathBuf {
    conversations_dir().join(format!("{}.json", session_id))
}

#[allow(dead_code)]
impl DirectApiClient {
    pub fn new(app_handle: &AppHandle) -> Result<Self, String> {
        let config = ApiConfig::from_env()?;

        let session_id = format!(
            "direct-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
        );

        let default_system_prompt = "You are a helpful assistant. Always respond in English unless the user explicitly writes in another language.".to_string();

        // Emit session started
        let _ = app_handle.emit(
            "app-event",
            AppEvent::SessionStarted {
                session_id: session_id.clone(),
                model: config.model.clone(),
                cwd: std::env::current_dir()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_default(),
                tools: vec![],
            },
        );

        Ok(Self {
            client: Client::new(),
            config,
            messages: vec![ChatMessage {
                role: "system".to_string(),
                content: default_system_prompt.clone(),
            }],
            session_id,
            cancel_token: CancellationToken::new(),
            system_prompt: default_system_prompt,
            smart_context_enabled: false,
            tools_enabled: true,
        })
    }

    #[allow(dead_code)]
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub fn model(&self) -> &str {
        &self.config.model
    }

    /// Get the last assistant message from conversation history.
    pub fn last_assistant_message(&self) -> Option<String> {
        self.messages
            .iter()
            .rev()
            .find(|m| m.role == "assistant")
            .map(|m| m.content.clone())
    }

    /// Persist conversation messages to disk.
    pub fn save_messages(&self) {
        let dir = conversations_dir();
        let _ = std::fs::create_dir_all(&dir);
        let path = conversation_path(&self.session_id);
        if let Ok(json) = serde_json::to_string_pretty(&self.messages) {
            let _ = std::fs::write(path, json);
        }
    }

    /// Load conversation messages from a previous session.
    pub fn load_messages(session_id: &str) -> Option<Vec<ChatMessage>> {
        let path = conversation_path(session_id);
        let content = std::fs::read_to_string(path).ok()?;
        serde_json::from_str(&content).ok()
    }

    /// Resume a previous conversation by loading its messages.
    pub fn resume_session(&mut self, session_id: &str) -> bool {
        if let Some(messages) = Self::load_messages(session_id) {
            self.messages = messages;
            self.session_id = session_id.to_string();
            true
        } else {
            false
        }
    }

    /// Switch to a different provider (from router decision).
    pub fn switch_provider(
        &mut self,
        base_url: &str,
        api_key_env: &str,
        model: &str,
    ) -> Result<(), String> {
        self.config = ApiConfig::from_provider(base_url, api_key_env, model)?;
        Ok(())
    }

    /// Truncate message history, keeping only the first `keep_count` messages.
    pub fn truncate_history(&mut self, keep_count: usize) {
        self.messages.truncate(keep_count);
    }

    /// Cancel in-progress generation.
    pub fn cancel_generation(&self) {
        self.cancel_token.cancel();
    }

    /// Get a fresh cancellation token for the next request.
    #[allow(dead_code)]
    pub fn new_cancel_token(&mut self) -> CancellationToken {
        let token = CancellationToken::new();
        self.cancel_token = token.clone();
        token
    }

    /// Replace the internal cancel token with an external one (for AppState sharing).
    pub fn set_cancel_token(&mut self, token: CancellationToken) {
        self.cancel_token = token;
    }

    /// Set the system prompt.
    pub fn set_system_prompt(&mut self, prompt: &str) {
        self.system_prompt = prompt.to_string();
        // Update the first message if it's a system message
        if let Some(first) = self.messages.first_mut() {
            if first.role == "system" {
                first.content = prompt.to_string();
            }
        }
    }

    /// Get the current system prompt.
    pub fn system_prompt(&self) -> &str {
        &self.system_prompt
    }

    /// Enable or disable smart context assembly.
    pub fn set_smart_context(&mut self, enabled: bool) {
        self.smart_context_enabled = enabled;
    }

    /// Get the current model name.
    #[allow(dead_code)]
    pub fn current_model(&self) -> &str {
        &self.config.model
    }

    /// Set the model.
    pub fn set_model(&mut self, model: &str) {
        self.config.model = model.to_string();
    }

    /// Edit a message at a specific index and truncate history after it.
    pub fn edit_message_at(&mut self, index: usize, new_content: &str) -> bool {
        if index < self.messages.len() && self.messages[index].role == "user" {
            self.messages[index].content = new_content.to_string();
            self.messages.truncate(index + 1);
            true
        } else {
            false
        }
    }

    /// Get conversation history for export.
    #[allow(dead_code)]
    pub fn get_messages(&self) -> &[ChatMessage] {
        &self.messages
    }

    /// Compact the conversation history by summarizing old messages.
    pub fn compact(&mut self) -> Option<String> {
        if let Some(idx) = crate::token_optimizer::should_compact(&self.messages) {
            // Keep system prompt (index 0) and compact messages from 1..idx
            let start = if !self.messages.is_empty() && self.messages[0].role == "system" { 1 } else { 0 };
            if idx > start && idx < self.messages.len() {
                let to_compact: Vec<_> = self.messages[start..idx].to_vec();
                let summary = crate::token_optimizer::summarize_messages(&to_compact);
                let mut new_messages = Vec::new();
                if start > 0 {
                    new_messages.push(self.messages[0].clone());
                }
                new_messages.push(ChatMessage {
                    role: "system".to_string(),
                    content: summary.clone(),
                });
                new_messages.extend_from_slice(&self.messages[idx..]);
                self.messages = new_messages;
                return Some(format!("Compacted {} messages", idx - start));
            }
        }
        None
    }

    /// Send a user message and stream the response back via events.
    pub async fn send_message(
        &mut self,
        user_message: &str,
        app_handle: &AppHandle,
    ) -> Result<(), String> {
        let start = std::time::Instant::now();

        // Auto-compact if context exceeds budget
        if let Some(detail) = self.compact() {
            let _ = app_handle.emit(
                "app-event",
                AppEvent::StatusUpdate {
                    status: "compacted".to_string(),
                    detail,
                },
            );
        }

        // Add user message to history (skip for tool follow-up calls)
        if !user_message.is_empty() {
            self.messages.push(ChatMessage {
                role: "user".to_string(),
                content: user_message.to_string(),
            });
        }

        // Smart context: inject optimized context as a system message after the primary system prompt
        if self.smart_context_enabled && !user_message.is_empty() {
            let context = crate::token_optimizer::build_optimized_context(None, Some(user_message));
            if !context.is_empty() {
                // Insert after system prompt (index 1) and before conversation history
                let insert_pos = if !self.messages.is_empty() && self.messages[0].role == "system" { 1 } else { 0 };
                self.messages.insert(insert_pos, ChatMessage {
                    role: "system".to_string(),
                    content: format!("[Context from memory & decisions]\n{}", context),
                });
            }
        }

        let url = format!("{}/chat/completions", self.config.base_url);

        let tools = if self.tools_enabled {
            Some(crate::api_tools::builtin_tools())
        } else {
            None
        };

        let request = ChatRequest {
            model: self.config.model.clone(),
            messages: self.messages.clone(),
            stream: true,
            max_tokens: 4096,
            tools,
        };

        let mut req_builder = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.config.api_key))
            .header("Content-Type", "application/json");

        // Add OpenRouter-specific headers
        if is_openrouter_url(&self.config.base_url) {
            req_builder = req_builder
                .header("HTTP-Referer", "https://ollopa.app")
                .header("X-Title", "Ollopa");
        }

        let response = req_builder
            .json(&request)
            .send()
            .await
            .map_err(|e| format!("API request failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            let err = format!("API error {}: {}", status, body);
            let _ = app_handle.emit(
                "app-event",
                AppEvent::Error {
                    message: err.clone(),
                    recoverable: true,
                },
            );
            // Keep user message in history, push error as assistant message for consistency
            self.messages.push(ChatMessage {
                role: "assistant".to_string(),
                content: format!("[Error: {}]", err),
            });
            return Err(err);
        }

        // Get a cancellation token for this request
        let cancel_token = self.cancel_token.clone();
        let mut was_cancelled = false;

        // Stream timeout: if no data received for 60 seconds, abort
        const STREAM_IDLE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

        // Stream the response with real-time chunk emission
        let mut full_response = String::new();
        let mut stream = response.bytes_stream();
        let mut buffer = String::new();
        let mut consecutive_errors: u32 = 0;
        const MAX_CONSECUTIVE_ERRORS: u32 = 5;

        // Tool call accumulation
        let mut pending_tool_id = String::new();
        let mut pending_tool_name = String::new();
        let mut pending_tool_args = String::new();
        let mut has_tool_call = false;
        let mut _finish_reason_str = String::new();

        loop {
            tokio::select! {
                _ = cancel_token.cancelled() => {
                    was_cancelled = true;
                    break;
                }
                _ = tokio::time::sleep(STREAM_IDLE_TIMEOUT) => {
                    let _ = app_handle.emit(
                        "app-event",
                        AppEvent::Error {
                            message: "Stream idle timeout — no data received for 60 seconds".to_string(),
                            recoverable: true,
                        },
                    );
                    break;
                }
                chunk_opt = stream.next() => {
                    match chunk_opt {
                        Some(Ok(chunk)) => {
                            consecutive_errors = 0;
                            let text = String::from_utf8_lossy(&chunk);
                            buffer.push_str(&text);

                            // Process complete SSE lines
                            while let Some(newline_pos) = buffer.find('\n') {
                                let line = buffer[..newline_pos].trim().to_string();
                                buffer = buffer[newline_pos + 1..].to_string();

                                if line.is_empty() || line.starts_with(':') {
                                    continue;
                                }

                                if let Some(data) = line.strip_prefix("data: ") {
                                    if data.trim() == "[DONE]" {
                                        continue;
                                    }

                                    if let Ok(chunk) = serde_json::from_str::<StreamChunk>(data) {
                                        if let Some(choices) = chunk.choices {
                                            for choice in &choices {
                                                if let Some(ref fr) = choice.finish_reason {
                                                    _finish_reason_str = fr.clone();
                                                }
                                                if let Some(ref delta) = choice.delta {
                                                    if let Some(ref content) = delta.content {
                                                        if !content.is_empty() {
                                                            full_response.push_str(content);
                                                            let _ = app_handle.emit(
                                                                "app-event",
                                                                AppEvent::StreamingChunk {
                                                                    text: content.clone(),
                                                                    model: self.config.model.clone(),
                                                                },
                                                            );
                                                        }
                                                    }
                                                    // Accumulate tool call deltas
                                                    if let Some(ref tool_calls) = delta.tool_calls {
                                                        for tc in tool_calls {
                                                            if let Some(ref id) = tc.id {
                                                                pending_tool_id = id.clone();
                                                            }
                                                            if let Some(ref func) = tc.function {
                                                                if let Some(ref name) = func.name {
                                                                    pending_tool_name = name.clone();
                                                                }
                                                                if let Some(ref args) = func.arguments {
                                                                    pending_tool_args.push_str(args);
                                                                }
                                                            }
                                                            has_tool_call = true;
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                    // Silently skip malformed SSE data lines
                                }
                            }
                        }
                        Some(Err(e)) => {
                            consecutive_errors += 1;
                            if consecutive_errors >= MAX_CONSECUTIVE_ERRORS {
                                let _ = app_handle.emit(
                                    "app-event",
                                    AppEvent::Error {
                                        message: format!("Stream failed after {} consecutive errors: {}", consecutive_errors, e),
                                        recoverable: true,
                                    },
                                );
                                break;
                            }
                            // Continue on transient errors
                        }
                        None => break,
                    }
                }
            }
        }

        // If cancelled, emit generation_stopped event
        if was_cancelled {
            let _ = app_handle.emit(
                "app-event",
                AppEvent::GenerationStopped {
                    partial_text: full_response.clone(),
                    model: self.config.model.clone(),
                },
            );
        }

        // Execute tool calls if the model requested them
        if has_tool_call && !was_cancelled && !pending_tool_name.is_empty() {
            let tool_id = if pending_tool_id.is_empty() {
                format!("tool-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis())
            } else {
                pending_tool_id.clone()
            };

            let args: serde_json::Value = serde_json::from_str(&pending_tool_args).unwrap_or(serde_json::json!({}));

            let _ = app_handle.emit(
                "app-event",
                AppEvent::ToolStarted {
                    tool_use_id: tool_id.clone(),
                    tool_name: pending_tool_name.clone(),
                    input: args.clone(),
                },
            );

            let tool_result = crate::api_tools::execute_tool(&pending_tool_name, &args);
            let (output, is_error) = match tool_result {
                Ok(result) => (result, false),
                Err(e) => (e, true),
            };

            let _ = app_handle.emit(
                "app-event",
                AppEvent::ToolFinished {
                    tool_use_id: tool_id.clone(),
                    tool_name: pending_tool_name.clone(),
                    output: output.clone(),
                    is_error,
                },
            );

            // Push tool result into messages and make a follow-up API call
            self.messages.push(ChatMessage {
                role: "assistant".to_string(),
                content: format!("[Tool call: {}({})]", pending_tool_name, pending_tool_args),
            });
            self.messages.push(ChatMessage {
                role: "user".to_string(),
                content: format!("[Tool result for {}]:\n{}", pending_tool_name, output),
            });

            // Recursive call for follow-up (max 3 rounds handled by the caller)
            // We do one follow-up here
            return Box::pin(self.send_message("", app_handle)).await;
        }

        // Reset cancel token for next request
        self.cancel_token = CancellationToken::new();

        let duration = start.elapsed();

        // Rough token estimation (4 chars per token)
        let input_chars: usize = self.messages.iter().map(|m| m.content.len()).sum();
        let est_input_tokens = (input_chars / 4).max(1) as u64;
        let est_output_tokens = (full_response.len() / 4).max(1) as u64;
        let cost = (est_input_tokens as f64 * INPUT_PRICE_PER_M
            + est_output_tokens as f64 * OUTPUT_PRICE_PER_M)
            / 1_000_000.0;

        // Store assistant response in history
        if !full_response.is_empty() {
            self.messages.push(ChatMessage {
                role: "assistant".to_string(),
                content: full_response.clone(),
            });

            // Emit the assistant message
            let _ = app_handle.emit(
                "app-event",
                AppEvent::AssistantMessage {
                    text: full_response,
                    model: self.config.model.clone(),
                },
            );

            // Persist conversation to disk
            self.save_messages();
        }

        // Remove injected smart context message to prevent accumulation
        if self.smart_context_enabled {
            self.messages.retain(|m| {
                !(m.role == "system" && m.content.starts_with("[Context from memory & decisions]"))
            });
        }

        // Record usage for historical cost tracking (budget alerts, dashboard)
        let _ = crate::token_optimizer::record_usage(est_input_tokens, est_output_tokens);

        // Check budget and emit alert if threshold crossed
        let (alert_level, pct, remaining) = crate::token_optimizer::check_budget_alert();
        match alert_level {
            crate::token_optimizer::BudgetAlertLevel::Warning |
            crate::token_optimizer::BudgetAlertLevel::Critical |
            crate::token_optimizer::BudgetAlertLevel::Exceeded => {
                let _ = app_handle.emit(
                    "app-event",
                    AppEvent::StatusUpdate {
                        status: "budget_alert".to_string(),
                        detail: format!("{:.0}% of budget used — ${:.4} remaining", pct, remaining),
                    },
                );
            }
            _ => {}
        }

        // Emit token usage
        let _ = app_handle.emit(
            "app-event",
            AppEvent::TokenUsage {
                input_tokens: est_input_tokens,
                output_tokens: est_output_tokens,
                cost_usd: cost,
            },
        );

        // Emit session finished
        let _ = app_handle.emit(
            "app-event",
            AppEvent::SessionFinished {
                session_id: self.session_id.clone(),
                cost_usd: cost,
                duration_ms: duration.as_millis() as u64,
                num_turns: 1,
                is_error: false,
            },
        );

        Ok(())
    }

    /// Clear conversation history.
    #[allow(dead_code)]
    pub fn clear_history(&mut self) {
        self.messages.clear();
    }
}

