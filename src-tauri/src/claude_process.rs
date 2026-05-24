use crate::claude_events::{
    parse_stream_line, AppEvent, ClaudeStreamEvent, ContentBlock, Usage,
};
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, Mutex};

/// Pricing constants (DeepSeek defaults)
const INPUT_PRICE_PER_M: f64 = 0.27;
const OUTPUT_PRICE_PER_M: f64 = 1.10;

pub struct ClaudeProcess {
    child: Child,
    stdin_tx: mpsc::Sender<String>,
    session_id: Arc<Mutex<Option<String>>>,
    model: Arc<Mutex<String>>,
}

impl ClaudeProcess {
    /// Spawn `claude --output-format stream-json` and start streaming events.
    pub async fn spawn(
        app_handle: AppHandle,
        working_dir: Option<String>,
        initial_prompt: Option<String>,
    ) -> Result<Self, String> {
        let mut cmd = Command::new("claude");
        cmd.arg("--output-format")
            .arg("stream-json")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Some(ref dir) = working_dir {
            cmd.current_dir(dir);
        }

        // If initial prompt provided, pass via --print flag (non-interactive single turn)
        // Otherwise launch in interactive mode by passing -p with stdin
        if let Some(ref prompt) = initial_prompt {
            cmd.arg("-p").arg(prompt);
        }

        // Remove conflicting auth token
        cmd.env_remove("ANTHROPIC_AUTH_TOKEN");

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn claude: {}", e))?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to capture stdout".to_string())?;

        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Failed to capture stderr".to_string())?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Failed to capture stdin".to_string())?;

        let (stdin_tx, stdin_rx) = mpsc::channel::<String>(64);
        let session_id = Arc::new(Mutex::new(None::<String>));
        let model = Arc::new(Mutex::new("unknown".to_string()));

        // Spawn stdin writer task
        let stdin_mutex = Arc::new(Mutex::new(stdin));
        let stdin_clone = stdin_mutex.clone();
        tokio::spawn(async move {
            Self::stdin_writer(stdin_clone, stdin_rx).await;
        });

        // Spawn stdout reader task
        let app_clone = app_handle.clone();
        let session_id_clone = session_id.clone();
        let model_clone = model.clone();
        tokio::spawn(async move {
            Self::stdout_reader(app_clone, stdout, session_id_clone, model_clone).await;
        });

        // Spawn stderr reader task
        let app_clone2 = app_handle.clone();
        tokio::spawn(async move {
            Self::stderr_reader(app_clone2, stderr).await;
        });

        Ok(Self {
            child,
            stdin_tx,
            session_id,
            model,
        })
    }

    /// Send a message to Claude's stdin (for interactive sessions).
    pub async fn send_message(&self, message: &str) -> Result<(), String> {
        self.stdin_tx
            .send(message.to_string())
            .await
            .map_err(|e| format!("Failed to send to stdin: {}", e))
    }

    /// Get the current session ID.
    #[allow(dead_code)]
    pub async fn session_id(&self) -> Option<String> {
        self.session_id.lock().await.clone()
    }

    /// Get the current model.
    #[allow(dead_code)]
    pub async fn model(&self) -> String {
        self.model.lock().await.clone()
    }

    /// Kill the claude process.
    pub async fn kill(&mut self) -> Result<(), String> {
        self.child
            .kill()
            .await
            .map_err(|e| format!("Failed to kill process: {}", e))
    }

    /// Check if the process is still running.
    #[allow(dead_code)]
    pub fn try_wait(&mut self) -> Option<std::process::ExitStatus> {
        self.child.try_wait().ok().flatten()
    }

    // ═══════ Internal tasks ═══════

    async fn stdin_writer(
        stdin: Arc<Mutex<tokio::process::ChildStdin>>,
        mut rx: mpsc::Receiver<String>,
    ) {
        while let Some(msg) = rx.recv().await {
            let mut guard = stdin.lock().await;
            let payload = format!("{}\n", msg);
            if guard.write_all(payload.as_bytes()).await.is_err() {
                break;
            }
            if guard.flush().await.is_err() {
                break;
            }
        }
    }

    async fn stdout_reader(
        app: AppHandle,
        stdout: tokio::process::ChildStdout,
        session_id: Arc<Mutex<Option<String>>>,
        model: Arc<Mutex<String>>,
    ) {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();

        while let Ok(Some(line)) = lines.next_line().await {
            if let Some(event) = parse_stream_line(&line) {
                Self::process_event(&app, event, &session_id, &model).await;
            }
        }

        // Process exited
        let _ = app.emit(
            "app-event",
            AppEvent::StatusUpdate {
                status: "process_exited".to_string(),
                detail: "Claude process has exited".to_string(),
            },
        );
    }

    async fn stderr_reader(app: AppHandle, stderr: tokio::process::ChildStderr) {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();

        while let Ok(Some(line)) = lines.next_line().await {
            let trimmed = line.trim().to_string();
            if !trimmed.is_empty() {
                let _ = app.emit(
                    "app-event",
                    AppEvent::Error {
                        message: trimmed,
                        recoverable: true,
                    },
                );
            }
        }
    }

    async fn process_event(
        app: &AppHandle,
        event: ClaudeStreamEvent,
        session_id: &Arc<Mutex<Option<String>>>,
        model: &Arc<Mutex<String>>,
    ) {
        match event {
            ClaudeStreamEvent::System {
                subtype,
                cwd,
                session_id: sid,
                tools,
                model: m,
                ..
            } => {
                if subtype == "init" {
                    let sid_val = sid.unwrap_or_default();
                    let model_val = m.unwrap_or_else(|| "unknown".to_string());
                    let cwd_val = cwd.unwrap_or_default();
                    let tools_val = tools.unwrap_or_default();

                    *session_id.lock().await = Some(sid_val.clone());
                    *model.lock().await = model_val.clone();

                    let _ = app.emit(
                        "app-event",
                        AppEvent::SessionStarted {
                            session_id: sid_val,
                            model: model_val,
                            cwd: cwd_val,
                            tools: tools_val,
                        },
                    );
                }
            }

            ClaudeStreamEvent::Assistant { message, .. } => {
                Self::process_assistant_message(app, &message).await;
            }

            ClaudeStreamEvent::User { .. } => {
                // User messages are echoed back; no action needed
            }

            ClaudeStreamEvent::Result {
                subtype,
                cost_usd,
                duration_ms,
                num_turns,
                is_error,
                session_id: sid,
                ..
            } => {
                let _ = app.emit(
                    "app-event",
                    AppEvent::SessionFinished {
                        session_id: sid.unwrap_or_default(),
                        cost_usd: cost_usd.unwrap_or(0.0),
                        duration_ms: duration_ms.unwrap_or(0),
                        num_turns: num_turns.unwrap_or(0),
                        is_error,
                    },
                );

                if is_error {
                    let _ = app.emit(
                        "app-event",
                        AppEvent::Error {
                            message: format!("Session ended with error (subtype: {})", subtype),
                            recoverable: false,
                        },
                    );
                }
            }
        }
    }

    async fn process_assistant_message(
        app: &AppHandle,
        message: &crate::claude_events::AssistantMessage,
    ) {
        let model_name = message
            .model
            .as_deref()
            .unwrap_or("unknown")
            .to_string();

        // Emit token usage if available
        if let Some(ref usage) = message.usage {
            Self::emit_token_usage(app, usage);
        }

        for block in &message.content {
            match block {
                ContentBlock::Text { text } => {
                    let _ = app.emit(
                        "app-event",
                        AppEvent::AssistantMessage {
                            text: text.clone(),
                            model: model_name.clone(),
                        },
                    );
                }

                ContentBlock::ToolUse { id, name, input } => {
                    let _ = app.emit(
                        "app-event",
                        AppEvent::ToolStarted {
                            tool_use_id: id.clone(),
                            tool_name: name.clone(),
                            input: input.clone(),
                        },
                    );
                }

                ContentBlock::ToolResult {
                    tool_use_id,
                    content,
                    is_error,
                } => {
                    let _ = app.emit(
                        "app-event",
                        AppEvent::ToolFinished {
                            tool_use_id: tool_use_id.clone(),
                            tool_name: String::new(),
                            output: content.clone().unwrap_or_default(),
                            is_error: is_error.unwrap_or(false),
                        },
                    );
                }
            }
        }
    }

    fn emit_token_usage(app: &AppHandle, usage: &Usage) {
        let cost = (usage.input_tokens as f64 / 1_000_000.0) * INPUT_PRICE_PER_M
            + (usage.output_tokens as f64 / 1_000_000.0) * OUTPUT_PRICE_PER_M;

        let _ = app.emit(
            "app-event",
            AppEvent::TokenUsage {
                input_tokens: usage.input_tokens,
                output_tokens: usage.output_tokens,
                cost_usd: (cost * 10000.0).round() / 10000.0,
            },
        );
    }
}
