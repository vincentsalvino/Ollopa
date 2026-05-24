use crate::claude_events::AppEvent;
use crate::claude_process::ClaudeProcess;
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

/// Manages Claude process lifecycle and session persistence.
pub struct SessionManager {
    pub process: Option<ClaudeProcess>,
    pub working_dir: Option<String>,
    pub session_id: Option<String>,
    pub model: String,
    heartbeat_handle: Option<tokio::task::JoinHandle<()>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            process: None,
            working_dir: None,
            session_id: None,
            model: "unknown".to_string(),
            heartbeat_handle: None,
        }
    }

    /// Start a new Claude session with automatic snapshot creation.
    pub async fn start(
        &mut self,
        app_handle: AppHandle,
        working_dir: Option<String>,
        initial_prompt: Option<String>,
    ) -> Result<(), String> {
        // Kill existing process if any
        if let Some(ref mut proc) = self.process {
            let _ = proc.kill().await;
        }
        self.stop_heartbeat();

        self.working_dir = working_dir.clone();

        // Generate session ID
        let sid = format!("session-{}", current_timestamp_ms());
        self.session_id = Some(sid.clone());

        let process =
            ClaudeProcess::spawn(app_handle.clone(), working_dir.clone(), initial_prompt).await?;

        let _ = app_handle.emit(
            "app-event",
            AppEvent::StatusUpdate {
                status: "starting".to_string(),
                detail: "Claude process spawned, waiting for initialization...".to_string(),
            },
        );

        // Mark any previous crashed sessions
        mark_crashed_sessions();

        // Create initial snapshot
        let snapshot = SessionSnapshot {
            session_id: sid.clone(),
            project_path: self.working_dir.clone(),
            model: self.model.clone(),
            created_at: current_timestamp_ms(),
            updated_at: current_timestamp_ms(),
            message_count: 0,
            status: SessionStatus::Active,
            cost_usd: 0.0,
            duration_ms: 0,
            events: Vec::new(),
        };
        let _ = save_snapshot(self.working_dir.as_deref(), &snapshot);

        // Start heartbeat
        self.start_heartbeat(app_handle.clone());

        self.process = Some(process);
        Ok(())
    }

    /// Send user input to the running Claude process.
    pub async fn send_input(&self, message: &str) -> Result<(), String> {
        match &self.process {
            Some(proc) => proc.send_message(message).await,
            None => Err("No active session".to_string()),
        }
    }

    /// Restart the session (kill + spawn new).
    pub async fn restart(
        &mut self,
        app_handle: AppHandle,
        initial_prompt: Option<String>,
    ) -> Result<(), String> {
        let working_dir = self.working_dir.clone();
        self.stop().await?;
        self.start(app_handle, working_dir, initial_prompt).await
    }

    /// Stop the current session and finalize snapshot.
    pub async fn stop(&mut self) -> Result<(), String> {
        self.stop_heartbeat();

        if let Some(ref sid) = self.session_id {
            finalize_session(self.working_dir.as_deref(), sid, false);
        }

        if let Some(ref mut proc) = self.process {
            proc.kill().await?;
        }
        self.process = None;
        self.session_id = None;
        Ok(())
    }

    /// Check if a session is currently active.
    pub fn is_active(&self) -> bool {
        self.process.is_some()
    }

    /// Set the working directory for next session.
    pub fn set_working_dir(&mut self, dir: String) {
        self.working_dir = Some(dir);
    }

    /// Record an event to the current session's snapshot.
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
                .filter(|e| matches!(e.event, AppEvent::AssistantMessage { .. }))
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
            Some(SessionMeta {
                key,
                preview: format!("Model: {} | Events: {}", snapshot.model, snapshot.events.len()),
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
pub fn load_session_events(session_id: &str) -> Result<Vec<PersistedEvent>, String> {
    let dir = sessions_dir();
    let entries = fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read sessions dir: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(snapshot) = serde_json::from_str::<SessionSnapshot>(&content) {
                if snapshot.session_id == session_id {
                    return Ok(snapshot.events);
                }
            }
        }
    }

    Err(format!("Session not found: {}", session_id))
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
