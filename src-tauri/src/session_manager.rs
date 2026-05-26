use crate::api_client::DirectApiClient;
use crate::claude_events::AppEvent;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

/// Persisted session snapshot — full session state for recovery
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionSnapshot {
    pub session_id: String,
    pub project_path: Option<String>,
    pub model: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub message_count: u32,
    pub status: SessionStatus,
    pub cost_usd: f64,
    pub duration_ms: u64,
    pub title: Option<String>,
    #[serde(default)]
    pub api_session_id: Option<String>,
    pub events: Vec<PersistedEvent>,
}

/// Lightweight event record for session replay
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedEvent {
    pub timestamp_ms: u64,
    pub event: AppEvent,
}

/// Session lifecycle status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SessionStatus {
    Active,
    Completed,
    Crashed,
    Recovered,
}

/// Lightweight session metadata for sidebar listing
#[derive(Debug, Clone, Serialize)]
pub struct SessionMeta {
    pub key: String,
    pub preview: String,
    pub message_count: usize,
    pub status: String,
    pub project_path: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
    pub cost_usd: f64,
}

/// Manages session lifecycle and API communication.
pub struct SessionManager {
    pub api_client: Option<DirectApiClient>,
    pub working_dir: Option<String>,
    pub session_id: Option<String>,
    pub model: String,
    heartbeat_handle: Option<tokio::task::JoinHandle<()>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            api_client: None,
            working_dir: None,
            session_id: None,
            model: "unknown".to_string(),
            heartbeat_handle: None,
        }
    }

    /// Start a new session: initialize the direct API client.
    pub async fn start(
        &mut self,
        app_handle: AppHandle,
        working_dir: Option<String>,
        _initial_prompt: Option<String>,
    ) -> Result<(), String> {
        self.stop_heartbeat();
        self.working_dir = working_dir.clone();

        // Generate session ID
        let sid = format!("session-{}", current_timestamp_ms());
        self.session_id = Some(sid.clone());

        // Create direct API client
        match DirectApiClient::new(&app_handle) {
            Ok(client) => {
                self.model = client.model().to_string();
                self.api_client = Some(client);
            }
            Err(e) => {
                let _ = app_handle.emit(
                    "app-event",
                    AppEvent::Error {
                        message: format!("API client init failed: {}", e),
                        recoverable: true,
                    },
                );
            }
        }

        // Mark any previous crashed sessions
        mark_crashed_sessions();

        // Snapshot is created lazily on first message (see send_input)
        // so empty sessions don't clutter history

        // Emit session ready status
        let _ = app_handle.emit(
            "app-event",
            AppEvent::StatusUpdate {
                status: "ready".to_string(),
                detail: "Session ready. Type a message to begin.".to_string(),
            },
        );

        // Start heartbeat
        self.start_heartbeat(app_handle.clone());

        Ok(())
    }

    /// Send user input via direct API call.
    pub async fn send_input(
        &mut self,
        message: &str,
        app_handle: AppHandle,
    ) -> Result<(), String> {
        // Create snapshot lazily on first message
        if let Some(ref sid) = self.session_id {
            ensure_snapshot_exists(
                self.working_dir.as_deref(),
                sid,
                &self.model,
                self.api_client.as_ref().map(|c| c.session_id().to_string()),
            );
            set_session_title_if_empty(self.working_dir.as_deref(), sid, message);
        }

        // Record user message event to snapshot
        if let Some(ref sid) = self.session_id {
            append_event_to_snapshot(
                self.working_dir.as_deref(),
                sid,
                &AppEvent::UserMessage {
                    text: message.to_string(),
                },
            );
        }

        let result = match &mut self.api_client {
            Some(client) => client.send_message(message, &app_handle).await,
            None => {
                let mut client = DirectApiClient::new(&app_handle)?;
                let result = client.send_message(message, &app_handle).await;
                self.api_client = Some(client);
                result
            }
        };

        // Record assistant response event to snapshot
        if result.is_ok() {
            if let Some(ref client) = self.api_client {
                if let Some(last_msg) = client.last_assistant_message() {
                    if let Some(ref sid) = self.session_id {
                        append_event_to_snapshot(
                            self.working_dir.as_deref(),
                            sid,
                            &AppEvent::AssistantMessage {
                                text: last_msg,
                                model: self.model.clone(),
                            },
                        );
                    }
                }
            }
        }

        result
    }

    /// Restart the session.
    pub async fn restart(
        &mut self,
        app_handle: AppHandle,
        _initial_prompt: Option<String>,
    ) -> Result<(), String> {
        let working_dir = self.working_dir.clone();
        self.stop().await?;
        self.start(app_handle, working_dir, None).await
    }

    /// Stop the current session and finalize snapshot.
    pub async fn stop(&mut self) -> Result<(), String> {
        self.stop_heartbeat();

        if let Some(ref sid) = self.session_id {
            finalize_session(self.working_dir.as_deref(), sid, false);
        }

        self.api_client = None;
        self.session_id = None;
        Ok(())
    }

    /// Check if a session is currently active.
    #[allow(dead_code)]
    pub fn is_active(&self) -> bool {
        self.api_client.is_some()
    }

    /// Truncate conversation history at a given index.
    pub async fn truncate_at(&mut self, message_index: usize) {
        if let Some(ref mut client) = self.api_client {
            client.truncate_history(message_index);
        }
    }

    /// Set the working directory for next session.
    pub fn set_working_dir(&mut self, dir: String) {
        self.working_dir = Some(dir);
    }

    /// Record an event to the current session's snapshot.
    #[allow(dead_code)]
    pub fn record_event(&self, event: &AppEvent) {
        if let Some(ref sid) = self.session_id {
            append_event_to_snapshot(self.working_dir.as_deref(), sid, event);
        }
    }

    /// Start heartbeat task to periodically update snapshot timestamp.
    fn start_heartbeat(&mut self, app_handle: AppHandle) {
        let working_dir = self.working_dir.clone();
        let session_id = self.session_id.clone();

        let handle = tokio::spawn(async move {
            let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(30));
            loop {
                interval.tick().await;
                if let Some(ref sid) = session_id {
                    update_heartbeat(working_dir.as_deref(), sid);
                }
                // Emit heartbeat status to frontend
                let _ = app_handle.emit(
                    "session-heartbeat",
                    serde_json::json!({ "alive": true }),
                );
            }
        });

        self.heartbeat_handle = Some(handle);
    }

    fn stop_heartbeat(&mut self) {
        if let Some(handle) = self.heartbeat_handle.take() {
            handle.abort();
        }
    }
}

// ═══════ Session Persistence ═══════

fn sessions_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/home/ubuntu"))
        .join(".claude")
        .join("workspace-sessions")
}

fn sanitize_key(project_path: Option<&str>) -> String {
    project_path
        .map(|p| p.replace(['/', '\\', ':', ' '], "_"))
        .unwrap_or_else(|| "global".to_string())
}

fn snapshot_path(project_path: Option<&str>, session_id: &str) -> PathBuf {
    let dir = sessions_dir();
    let key = sanitize_key(project_path);
    dir.join(format!("{}_{}.json", key, session_id))
}

/// Save a session snapshot.
pub fn save_snapshot(project_path: Option<&str>, snapshot: &SessionSnapshot) -> Result<(), String> {
    let dir = sessions_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create sessions dir: {}", e))?;
    let path = snapshot_path(project_path, &snapshot.session_id);
    let json = serde_json::to_string_pretty(snapshot)
        .map_err(|e| format!("Failed to serialize snapshot: {}", e))?;
    fs::write(path, json).map_err(|e| format!("Failed to write snapshot: {}", e))
}

/// Append an event to the session snapshot for replay.
fn append_event_to_snapshot(project_path: Option<&str>, session_id: &str, event: &AppEvent) {
    let path = snapshot_path(project_path, session_id);
    if let Ok(content) = fs::read_to_string(&path) {
        if let Ok(mut snapshot) = serde_json::from_str::<SessionSnapshot>(&content) {
            snapshot.events.push(PersistedEvent {
                timestamp_ms: current_timestamp_ms(),
                event: event.clone(),
            });
            snapshot.updated_at = current_timestamp_ms();
            snapshot.message_count = snapshot
                .events
                .iter()
                .filter(|e| matches!(e.event, AppEvent::AssistantMessage { .. } | AppEvent::UserMessage { .. }))
                .count() as u32;

            if let AppEvent::TokenUsage { cost_usd, .. } = event {
                snapshot.cost_usd += cost_usd;
            }

            let _ = serde_json::to_string_pretty(&snapshot)
                .ok()
                .and_then(|json| fs::write(&path, json).ok());
        }
    }
}

/// Create a snapshot file if it doesn't already exist (lazy creation on first message).
fn ensure_snapshot_exists(
    project_path: Option<&str>,
    session_id: &str,
    model: &str,
    api_session_id: Option<String>,
) {
    let path = snapshot_path(project_path, session_id);
    if path.exists() {
        return;
    }
    let snapshot = SessionSnapshot {
        session_id: session_id.to_string(),
        project_path: project_path.map(|s| s.to_string()),
        model: model.to_string(),
        created_at: current_timestamp_ms(),
        updated_at: current_timestamp_ms(),
        message_count: 0,
        status: SessionStatus::Active,
        cost_usd: 0.0,
        duration_ms: 0,
        title: None,
        api_session_id,
        events: Vec::new(),
    };
    let _ = save_snapshot(project_path, &snapshot);
}

/// Set the session title from the first user message (only if not yet set).
fn set_session_title_if_empty(project_path: Option<&str>, session_id: &str, message: &str) {
    let path = snapshot_path(project_path, session_id);
    if let Ok(content) = fs::read_to_string(&path) {
        if let Ok(mut snapshot) = serde_json::from_str::<SessionSnapshot>(&content) {
            if snapshot.title.is_none() {
                // Truncate to reasonable length for display
                let title = if message.len() > 60 {
                    format!("{}...", &message[..57])
                } else {
                    message.to_string()
                };
                snapshot.title = Some(title);
                let _ = serde_json::to_string_pretty(&snapshot)
                    .ok()
                    .and_then(|json| fs::write(&path, json).ok());
            }
        }
    }
}

/// Update heartbeat timestamp on a snapshot.
fn update_heartbeat(project_path: Option<&str>, session_id: &str) {
    let path = snapshot_path(project_path, session_id);
    if let Ok(content) = fs::read_to_string(&path) {
        if let Ok(mut snapshot) = serde_json::from_str::<SessionSnapshot>(&content) {
            snapshot.updated_at = current_timestamp_ms();
            let _ = serde_json::to_string_pretty(&snapshot)
                .ok()
                .and_then(|json| fs::write(&path, json).ok());
        }
    }
}

/// Public wrapper for finalize_session (used by lib.rs resume_conversation).
/// First tries with project_path, then scans all snapshots by session_id.
pub fn finalize_session_pub(project_path: Option<&str>, session_id: &str, is_crash: bool) {
    let path = snapshot_path(project_path, session_id);
    if path.exists() {
        finalize_session(project_path, session_id, is_crash);
        return;
    }
    // Scan all snapshots
    let dir = sessions_dir();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.extension().map_or(true, |e| e != "json") {
                continue;
            }
            if let Ok(content) = fs::read_to_string(&p) {
                if let Ok(mut snapshot) = serde_json::from_str::<SessionSnapshot>(&content) {
                    if snapshot.session_id == session_id {
                        snapshot.status = if is_crash {
                            SessionStatus::Crashed
                        } else {
                            SessionStatus::Completed
                        };
                        snapshot.updated_at = current_timestamp_ms();
                        snapshot.duration_ms = snapshot.updated_at.saturating_sub(snapshot.created_at);
                        let _ = serde_json::to_string_pretty(&snapshot)
                            .ok()
                            .and_then(|json| fs::write(&p, json).ok());
                        return;
                    }
                }
            }
        }
    }
}

/// Get the model from a session snapshot.
pub fn get_session_model(session_id: &str) -> Option<String> {
    let dir = sessions_dir();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Ok(content) = std::fs::read_to_string(&path) {
                if let Ok(snapshot) = serde_json::from_str::<SessionSnapshot>(&content) {
                    if snapshot.session_id == session_id {
                        return Some(snapshot.model);
                    }
                }
            }
        }
    }
    None
}

/// Re-activate a session snapshot (set status back to Active for continued use).
/// Searches all snapshot files by session_id to handle different project paths.
pub fn reactivate_session(_project_path: Option<&str>, session_id: &str) {
    let dir = sessions_dir();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(true, |e| e != "json") {
                continue;
            }
            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok(mut snapshot) = serde_json::from_str::<SessionSnapshot>(&content) {
                    if snapshot.session_id == session_id {
                        snapshot.status = SessionStatus::Active;
                        snapshot.updated_at = current_timestamp_ms();
                        let _ = serde_json::to_string_pretty(&snapshot)
                            .ok()
                            .and_then(|json| fs::write(&path, json).ok());
                        return;
                    }
                }
            }
        }
    }
}

/// Finalize a session snapshot (mark as Completed or Crashed).
fn finalize_session(project_path: Option<&str>, session_id: &str, is_crash: bool) {
    let path = snapshot_path(project_path, session_id);
    if let Ok(content) = fs::read_to_string(&path) {
        if let Ok(mut snapshot) = serde_json::from_str::<SessionSnapshot>(&content) {
            snapshot.status = if is_crash {
                SessionStatus::Crashed
            } else {
                SessionStatus::Completed
            };
            snapshot.updated_at = current_timestamp_ms();
            snapshot.duration_ms = snapshot.updated_at.saturating_sub(snapshot.created_at);
            let _ = serde_json::to_string_pretty(&snapshot)
                .ok()
                .and_then(|json| fs::write(&path, json).ok());
        }
    }
}

/// Mark any Active sessions as Crashed (startup recovery).
fn mark_crashed_sessions() {
    let dir = sessions_dir();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(true, |e| e != "json") {
                continue;
            }
            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok(mut snapshot) = serde_json::from_str::<SessionSnapshot>(&content) {
                    if snapshot.status == SessionStatus::Active {
                        // Check heartbeat staleness (>60s = crashed)
                        let age = current_timestamp_ms().saturating_sub(snapshot.updated_at);
                        if age > 60_000 {
                            snapshot.status = SessionStatus::Crashed;
                            let _ = serde_json::to_string_pretty(&snapshot)
                                .ok()
                                .and_then(|json| fs::write(&path, json).ok());
                        }
                    }
                }
            }
        }
    }
}

/// List all saved session snapshots with enriched metadata.
pub fn list_sessions() -> Vec<SessionMeta> {
    let dir = sessions_dir();
    let mut sessions: Vec<SessionMeta> = fs::read_dir(&dir)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().map_or(true, |e| e != "json") {
                return None;
            }
            let content = fs::read_to_string(&path).ok()?;
            let snapshot: SessionSnapshot = serde_json::from_str(&content).ok()?;
            let key = snapshot.session_id.clone();
            let status_str = match snapshot.status {
                SessionStatus::Active => "active",
                SessionStatus::Completed => "completed",
                SessionStatus::Crashed => "crashed",
                SessionStatus::Recovered => "recovered",
            };
            let title = snapshot.title.clone().unwrap_or_else(|| {
                format!("Model: {} | Events: {}", snapshot.model, snapshot.events.len())
            });
            Some(SessionMeta {
                key,
                preview: title,
                message_count: snapshot.message_count as usize,
                status: status_str.to_string(),
                project_path: snapshot.project_path.clone(),
                created_at: snapshot.created_at,
                updated_at: snapshot.updated_at,
                cost_usd: snapshot.cost_usd,
            })
        })
        .collect();

    // Sort by most recent first
    sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    sessions
}

/// Load a session's events for replay.
/// Falls back to conversation messages if snapshot events are empty.
pub fn load_session_events(session_id: &str) -> Result<Vec<PersistedEvent>, String> {
    let dir = sessions_dir();
    let entries = fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read sessions dir: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(snapshot) = serde_json::from_str::<SessionSnapshot>(&content) {
                if snapshot.session_id == session_id {
                    // If snapshot has events, use them
                    if !snapshot.events.is_empty() {
                        return Ok(snapshot.events);
                    }

                    // Fallback: try loading from conversation persistence
                    if let Some(ref api_sid) = snapshot.api_session_id {
                        if let Some(messages) = crate::api_client::DirectApiClient::load_messages(api_sid) {
                            return Ok(convert_messages_to_events(&messages, &snapshot.model));
                        }
                    }

                    // Second fallback: scan conversation files by timestamp
                    let ts_str = session_id.strip_prefix("session-").unwrap_or("");
                    if let Ok(ts) = ts_str.parse::<u64>() {
                        if let Some(events) = find_conversation_by_timestamp(ts, &snapshot.model) {
                            return Ok(events);
                        }
                    }

                    return Ok(Vec::new());
                }
            }
        }
    }

    Err(format!("Session not found: {}", session_id))
}

/// Convert ChatMessage list into PersistedEvent list for replay.
fn convert_messages_to_events(messages: &[crate::api_client::ChatMessage], model: &str) -> Vec<PersistedEvent> {
    let mut events = Vec::new();
    let base_ts = current_timestamp_ms();
    for (i, msg) in messages.iter().enumerate() {
        // Skip system messages
        if msg.role == "system" {
            continue;
        }
        let event = if msg.role == "user" {
            AppEvent::UserMessage {
                text: msg.content.clone(),
            }
        } else {
            AppEvent::AssistantMessage {
                text: msg.content.clone(),
                model: model.to_string(),
            }
        };
        events.push(PersistedEvent {
            timestamp_ms: base_ts + i as u64,
            event,
        });
    }
    events
}

/// Scan conversation files to find one created near the given timestamp.
fn find_conversation_by_timestamp(session_ts: u64, model: &str) -> Option<Vec<PersistedEvent>> {
    let conv_dir = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".claude")
        .join("conversations");
    let entries = fs::read_dir(&conv_dir).ok()?;

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if let Some(ts_str) = name.strip_prefix("direct-").and_then(|s| s.strip_suffix(".json")) {
            if let Ok(conv_ts) = ts_str.parse::<u64>() {
                // Match if timestamps are within 5 seconds of each other
                if conv_ts.abs_diff(session_ts) < 5000 {
                    if let Some(messages) = crate::api_client::DirectApiClient::load_messages(&format!("direct-{}", ts_str)) {
                        if messages.len() > 1 {
                            return Some(convert_messages_to_events(&messages, model));
                        }
                    }
                }
            }
        }
    }
    None
}

/// Get a session's snapshot for restore.
pub fn get_session_snapshot(session_id: &str) -> Result<SessionSnapshot, String> {
    let dir = sessions_dir();
    let entries = fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read sessions dir: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(snapshot) = serde_json::from_str::<SessionSnapshot>(&content) {
                if snapshot.session_id == session_id {
                    return Ok(snapshot);
                }
            }
        }
    }

    Err(format!("Session not found: {}", session_id))
}

/// Delete a session snapshot by session_id.
pub fn delete_snapshot(key: &str) -> Result<(), String> {
    let dir = sessions_dir();
    let entries = fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read sessions dir: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(snapshot) = serde_json::from_str::<SessionSnapshot>(&content) {
                if snapshot.session_id == key {
                    return fs::remove_file(&path)
                        .map_err(|e| format!("Failed to delete snapshot: {}", e));
                }
            }
        }
    }

    // Fallback: try old-style key-based deletion
    let path = sessions_dir().join(format!("{}.json", key));
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Failed to delete snapshot: {}", e))
    } else {
        Err(format!("Session not found: {}", key))
    }
}

fn current_timestamp_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
