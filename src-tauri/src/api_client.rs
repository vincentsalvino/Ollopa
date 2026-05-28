use crate::ollopa_events::AppEvent;
use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
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

fn is_mimo_model(model: &str) -> bool {
    model.starts_with("mimo-")
}

/// Get pricing constants for a given model
fn pricing_for_model(model: &str) -> (f64, f64) {
    if is_mimo_model(model) {
        (0.05, 0.10) // MiMo pricing
    } else if model.starts_with("gpt-4o") {
        (2.50, 10.0)
    } else if model.starts_with("claude-") {
        (3.0, 15.0)
    } else {
        (INPUT_PRICE_PER_M, OUTPUT_PRICE_PER_M) // DeepSeek default
    }
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

    /// Create config for a MiMo model
    pub fn for_mimo(model: &str) -> Result<Self, String> {
        let api_key = std::env::var("MIMO_API_KEY").map_err(|_| {
            "MIMO_API_KEY not set. Add it via Settings > API Keys.".to_string()
        })?;
        Ok(Self {
            base_url: "https://api.mimo.xiaomi.com/v1".to_string(),
            api_key,
            model: model.to_string(),
        })
    }

    /// Auto-detect provider config from model name
    pub fn from_model(model: &str) -> Result<Self, String> {
        if is_mimo_model(model) {
            Self::for_mimo(model)
        } else {
            let mut config = Self::from_env()?;
            config.model = model.to_string();
            Ok(config)
        }
    }

    pub fn from_env() -> Result<Self, String> {
        let api_key = std::env::var("ANTHROPIC_API_KEY")
            .or_else(|_| std::env::var("ANTHROPIC_AUTH_TOKEN"))
            .or_else(|_| std::env::var("DEEPSEEK_API_KEY"))
            .map_err(|_| {
                "No API key found. Set ANTHROPIC_API_KEY or DEEPSEEK_API_KEY environment variable.".to_string()
            })?;

        let base_url = std::env::var("ANTHROPIC_BASE_URL")
            .unwrap_or_else(|_| "https://api.deepseek.com".to_string());

        // Strip /anthropic suffix if present (DeepSeek uses OpenAI-compatible format)
        let base_url = base_url
            .trim_end_matches('/')
            .trim_end_matches("/anthropic")
            .to_string();

        let model = std::env::var("ANTHROPIC_MODEL")
            .unwrap_or_else(|_| "deepseek-chat".to_string())
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
}

#[derive(Debug, Deserialize)]
struct StreamChunk {
    choices: Option<Vec<StreamChoice>>,
}

#[derive(Debug, Deserialize)]
struct StreamChoice {
    delta: Option<Delta>,
    #[allow(dead_code)]
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Delta {
    content: Option<String>,
}

/// Direct API client that calls OpenAI-compatible endpoints (DeepSeek, etc.)
pub struct DirectApiClient {
    client: Client,
    config: ApiConfig,
    messages: Vec<ChatMessage>,
    session_id: String,
    cancel_token: Arc<CancellationToken>,
    system_prompt: String,
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
            cancel_token: Arc::new(CancellationToken::new()),
            system_prompt: default_system_prompt,
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
    pub fn new_cancel_token(&mut self) -> Arc<CancellationToken> {
        let token = Arc::new(CancellationToken::new());
        self.cancel_token = token.clone();
        token
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

    /// Get the current model name.
    #[allow(dead_code)]
    pub fn current_model(&self) -> &str {
        &self.config.model
    }

    /// Set the model, auto-switching provider endpoint if needed.
    pub fn set_model(&mut self, model: &str) {
        if is_mimo_model(model) && !self.config.base_url.contains("mimo.xiaomi.com") {
            if let Ok(mimo_config) = ApiConfig::for_mimo(model) {
                self.config = mimo_config;
                return;
            }
        } else if !is_mimo_model(model) && self.config.base_url.contains("mimo.xiaomi.com") {
            if let Ok(mut env_config) = ApiConfig::from_env() {
                env_config.model = model.to_string();
                self.config = env_config;
                return;
            }
        }
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
    pub fn get_messages(&self) -> &[ChatMessage] {
        &self.messages
    }

    /// Search conversations for a query string.
    pub fn search_conversations(query: &str) -> Vec<ConversationSearchResult> {
        let dir = conversations_dir();
        let query_lower = query.to_lowercase();
        let mut results = Vec::new();

        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if let Some(session_id) = name.strip_suffix(".json") {
                    if let Ok(content) = std::fs::read_to_string(entry.path()) {
                        if let Ok(messages) = serde_json::from_str::<Vec<ChatMessage>>(&content) {
                            for (i, msg) in messages.iter().enumerate() {
                                if msg.content.to_lowercase().contains(&query_lower) {
                                    let snippet_start = msg.content.to_lowercase().find(&query_lower).unwrap_or(0);
                                    let start = snippet_start.saturating_sub(50);
                                    let end = (snippet_start + query.len() + 50).min(msg.content.len());
                                    results.push(ConversationSearchResult {
                                        session_id: session_id.to_string(),
                                        message_index: i,
                                        role: msg.role.clone(),
                                        snippet: msg.content[start..end].to_string(),
                                        score: 1.0,
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }

        results.truncate(50);
        results
    }

    /// List all saved conversation session IDs.
    pub fn list_saved_conversations() -> Vec<String> {
        let dir = conversations_dir();
        std::fs::read_dir(dir)
            .ok()
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|e| {
                let name = e.file_name().to_string_lossy().to_string();
                name.strip_suffix(".json").map(|s| s.to_string())
            })
            .collect()
    }

    /// Send a user message and stream the response back via events.
    pub async fn send_message(
        &mut self,
        user_message: &str,
        app_handle: &AppHandle,
    ) -> Result<(), String> {
        let start = std::time::Instant::now();

        // Add user message to history
        self.messages.push(ChatMessage {
            role: "user".to_string(),
            content: user_message.to_string(),
        });

        let url = format!("{}/chat/completions", self.config.base_url);

        let request = ChatRequest {
            model: self.config.model.clone(),
            messages: self.messages.clone(),
            stream: true,
            max_tokens: 4096,
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
            // Remove the user message since it failed
            self.messages.pop();
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
                                            for choice in choices {
                                                if let Some(delta) = choice.delta {
                                                    if let Some(content) = delta.content {
                                                        if !content.is_empty() {
                                                            full_response.push_str(&content);
                                                            // Emit streaming chunk for real-time display
                                                            let _ = app_handle.emit(
                                                                "app-event",
                                                                AppEvent::StreamingChunk {
                                                                    text: content,
                                                                    model: self.config.model.clone(),
                                                                },
                                                            );
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

        // Reset cancel token for next request
        self.cancel_token = Arc::new(CancellationToken::new());

        let duration = start.elapsed();

        // Rough token estimation (4 chars per token)
        let input_chars: usize = self.messages.iter().map(|m| m.content.len()).sum();
        let est_input_tokens = (input_chars / 4).max(1) as u64;
        let est_output_tokens = (full_response.len() / 4).max(1) as u64;
        let (inp_price, out_price) = pricing_for_model(&self.config.model);
        let cost = (est_input_tokens as f64 * inp_price
            + est_output_tokens as f64 * out_price)
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

    /// Send a message with automatic fallback to MiMo on failure.
    pub async fn send_message_with_fallback(
        &mut self,
        user_message: &str,
        app_handle: &AppHandle,
    ) -> Result<(), String> {
        let result = self.send_message(user_message, app_handle).await;

        if result.is_err() && !is_mimo_model(&self.config.model) {
            // Try MiMo fallback
            if let Ok(mimo_config) = ApiConfig::for_mimo("MiMo-7B-RL") {
                let original_config = self.config.clone();
                self.config = mimo_config;

                let _ = app_handle.emit(
                    "app-event",
                    AppEvent::StatusUpdate {
                        status: "fallback".to_string(),
                        detail: format!(
                            "Primary provider failed, falling back to MiMo: {}",
                            result.as_ref().unwrap_err()
                        ),
                    },
                );

                // Remove the user message that was added then removed by the failed call
                // (send_message pops it on failure, but we need to re-add it)
                let fallback_result = self.send_message(user_message, app_handle).await;

                if fallback_result.is_err() {
                    // Fallback also failed, restore original config
                    self.config = original_config;
                    return fallback_result;
                }
                return fallback_result;
            }
        }

        result
    }

    /// Get the base URL of the current provider
    pub fn base_url(&self) -> &str {
        &self.config.base_url
    }

    /// Clear conversation history.
    #[allow(dead_code)]
    pub fn clear_history(&mut self) {
        self.messages.clear();
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationSearchResult {
    pub session_id: String,
    pub message_index: usize,
    pub role: String,
    pub snippet: String,
    pub score: f64,
}
