use crate::claude_events::AppEvent;
use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

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
}

fn conversations_dir() -> std::path::PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join(".claude")
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
                content: "You are a helpful assistant. Always respond in English unless the user explicitly writes in another language.".to_string(),
            }],
            session_id,
        })
    }

    #[allow(dead_code)]
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub fn model(&self) -> &str {
        &self.config.model
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

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.config.api_key))
            .header("Content-Type", "application/json")
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

        // Stream the response
        let mut full_response = String::new();
        let mut stream = response.bytes_stream();
        let mut buffer = String::new();

        while let Some(chunk_result) = stream.next().await {
            let chunk = chunk_result.map_err(|e| format!("Stream error: {}", e))?;
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
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

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
