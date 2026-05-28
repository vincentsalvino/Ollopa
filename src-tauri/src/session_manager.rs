use crate::ollopa_events::AppEvent;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

const DEFAULT_SYSTEM_PROMPT: &str = "You are a helpful assistant. Always respond in English unless the user explicitly writes in another language.";

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
    pub claude_session_id: Option<String>,
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

/// Conversation search result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationSearchResult {
    pub session_id: String,
    pub message_index: usize,
    pub role: String,
    pub snippet: String,
    pub score: f64,
}

/// Manages session lifecycle — snapshots, persistence, and model tracking.
/// The actual API calls are handled by DirectApiClient in lib.rs.
pub struct SessionManager {
    pub working_dir: Option<String>,
    pub session_id: Option<String>,
    pub model: String,
    pub system_prompt: String,
    heartbeat_handle: Option<tokio::task::JoinHandle<()>>,
}

impl SessionManager {
    pub fn new() -> Self {
        let model = std::env::var("ANTHROPIC_MODEL")
            .unwrap_or_else(|_| "deepseek-v4-pro".to_string());
        Self {
            working_dir: None,
            session_id: None,
            model,
            system_prompt: DEFAULT_SYSTEM_PROMPT.to_string(),
            heartbeat_handle: None,
        }
    }

    /// Start a new session.
    pub async fn start(
        &mut self,
        app_handle: AppHandle,
        working_dir: Option<String>,
        _initial_prompt: Option<String>,
    ) -> Result<(), String> {
        self.stop_heartbeat();
        self.working_dir = working_dir.clone();

        let sid = format!("session-{}", current_timestamp_ms());
        self.session_id = Some(sid.clone());

        mark_crashed_sessions();

        let _ = app_handle.emit(
            "app-event",
            AppEvent::StatusUpdate {
                status: "ready".to_string(),
                detail: "Session ready. Type a message to begin.".to_string(),
            },
        );

        self.start_heartbeat(app_handle.clone());
        Ok(())
    }

    /// Phase 1 of send: record user message in snapshot. Call under session lock (~5ms).
    pub fn prepare_send(&mut self, message: &str) {
        if let Some(ref sid) = self.session_id {
            ensure_snapshot_exists(self.working_dir.as_deref(), sid, &self.model);
            set_session_title_if_empty(self.working_dir.as_deref(), sid, message);
            append_event_to_snapshot(
                self.working_dir.as_deref(),
                sid,
                &AppEvent::UserMessage { text: message.to_string() },
            );
        }
    }

    /// Phase 4 of send: update model + snapshot after API response. Call under session lock (~5ms).
    pub fn finalize_send(&mut self, model: &str) {
        if model != "unknown" && !model.is_empty() {
            self.model = model.to_string();
        }
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
        self.session_id = None;
        Ok(())
    }

    /// Truncate conversation history. Clears API client history on next send.
    pub async fn truncate_at(&mut self, _message_index: usize) {}

    /// Set the working directory for next session.
    pub fn set_working_dir(&mut self, dir: String) {
        self.working_dir = Some(dir);
    }

    /// Set the system prompt.
    pub fn set_system_prompt(&mut self, prompt: &str) {
        self.system_prompt = prompt.to_string();
    }

    /// Get the current system prompt.
    pub fn system_prompt_value(&self) -> &str {
        &self.system_prompt
    }

    /// Set the model.
    pub fn set_model(&mut self, model: &str) {
        self.model = model.to_string();
    }

    /// Get the current model.
    pub fn model_value(&self) -> &str {
        &self.model
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
        .join(".ollopa")
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
pub fn save_snapshot(
    project_path: Option<&str>,
    snapshot: &SessionSnapshot,
) -> Result<(), String> {
    let dir = sessions_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create sessions dir: {}", e))?;
    let path = snapshot_path(project_path, &snapshot.session_id);
    let json = serde_json::to_string_pretty(snapshot)
        .map_err(|e| format!("Failed to serialize snapshot: {}", e))?;
    // Atomic write
    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, &json)
        .map_err(|e| format!("Failed to write snapshot: {}", e))?;
    fs::rename(&tmp_path, &path)
        .map_err(|e| format!("Failed to rename snapshot: {}", e))
}

/// Append an event to the session snapshot for replay.
/// Uses atomic write to prevent corruption.
fn append_event_to_snapshot(project_path: Option<&str>, session_id: &str, event: &AppEvent) {
    let path = snapshot_path(project_path, session_id);
    if let Ok(content) = fs::read_to_string(&path) {
        if let Ok(mut snapshot) = serde_json::from_str::<SessionSnapshot>(&content) {
            let now = current_timestamp_ms();

            // Enforce monotonic timestamps (deterministic ordering)
            let last_ts = snapshot.events.last().map(|e| e.timestamp_ms).unwrap_or(0);
            let event_ts = now.max(last_ts + 1);

            snapshot.events.push(PersistedEvent {
                timestamp_ms: event_ts,
                event: event.clone(),
            });
            snapshot.updated_at = now;
            snapshot.message_count = snapshot
                .events
                .iter()
                .filter(|e| {
                    matches!(
                        e.event,
                        AppEvent::AssistantMessage { .. } | AppEvent::UserMessage { .. }
                    )
                })
                .count() as u32;

            if let AppEvent::TokenUsage { cost_usd, .. } = event {
                snapshot.cost_usd += cost_usd;
            }

            if let Ok(json) = serde_json::to_string_pretty(&snapshot) {
                let tmp_path = path.with_extension("json.tmp");
                if fs::write(&tmp_path, &json).is_ok() {
                    let _ = fs::rename(&tmp_path, &path);
                }
            }
        }
    }
}

/// Create a snapshot file if it doesn't already exist (lazy creation on first message).
fn ensure_snapshot_exists(
    project_path: Option<&str>,
    session_id: &str,
    model: &str,
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
        claude_session_id: None,
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
                let title = if message.len() > 60 {
                    format!("{}...", &message[..57])
                } else {
                    message.to_string()
                };
                snapshot.title = Some(title);
                let _ = serde_json::to_string_pretty(&snapshot)
                    .ok()
                    .and_then(|json| {
                        let tmp_path = path.with_extension("json.tmp");
                        fs::write(&tmp_path, &json).ok()?;
                        fs::rename(&tmp_path, &path).ok()
                    });
            }
        }
    }
}

/// Update heartbeat timestamp on a snapshot (atomic write).
fn update_heartbeat(project_path: Option<&str>, session_id: &str) {
    let path = snapshot_path(project_path, session_id);
    if let Ok(content) = fs::read_to_string(&path) {
        if let Ok(mut snapshot) = serde_json::from_str::<SessionSnapshot>(&content) {
            snapshot.updated_at = current_timestamp_ms();
            if let Ok(json) = serde_json::to_string_pretty(&snapshot) {
                let tmp_path = path.with_extension("json.tmp");
                if fs::write(&tmp_path, &json).is_ok() {
                    let _ = fs::rename(&tmp_path, &path);
                }
            }
        }
    }
}

/// Public wrapper for finalize_session (used by lib.rs resume_conversation).
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
                        snapshot.duration_ms =
                            snapshot.updated_at.saturating_sub(snapshot.created_at);
                        let _ = serde_json::to_string_pretty(&snapshot)
                            .ok()
                            .and_then(|json| {
                                let tmp_path = p.with_extension("json.tmp");
                                fs::write(&tmp_path, &json).ok()?;
                                fs::rename(&tmp_path, &p).ok()
                            });
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
                            .and_then(|json| {
                                let tmp_path = path.with_extension("json.tmp");
                                fs::write(&tmp_path, &json).ok()?;
                                fs::rename(&tmp_path, &path).ok()
                            });
                        return;
                    }
                }
            }
        }
    }
}

/// Finalize a session snapshot (mark as Completed or Crashed). Uses atomic write.
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
            if let Ok(json) = serde_json::to_string_pretty(&snapshot) {
                let tmp_path = path.with_extension("json.tmp");
                if fs::write(&tmp_path, &json).is_ok() {
                    let _ = fs::rename(&tmp_path, &path);
                }
            }
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
                        let age = current_timestamp_ms().saturating_sub(snapshot.updated_at);
                        if age > 60_000 {
                            snapshot.status = SessionStatus::Crashed;
                            let _ = serde_json::to_string_pretty(&snapshot)
                                .ok()
                                .and_then(|json| {
                                    let tmp_path = path.with_extension("json.tmp");
                                    fs::write(&tmp_path, &json).ok()?;
                                    fs::rename(&tmp_path, &path).ok()
                                });
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
                format!(
                    "Model: {} | Events: {}",
                    snapshot.model,
                    snapshot.events.len()
                )
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

    sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    sessions
}

/// Load a session's events for replay.
pub fn load_session_events(session_id: &str) -> Result<Vec<PersistedEvent>, String> {
    let dir = sessions_dir();
    let entries =
        fs::read_dir(&dir).map_err(|e| format!("Failed to read sessions dir: {}", e))?;

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

/// Search session snapshots for a query string.
pub fn search_sessions(query: &str) -> Vec<ConversationSearchResult> {
    let dir = sessions_dir();
    let query_lower = query.to_lowercase();
    let mut results = Vec::new();

    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(true, |e| e != "json") {
                continue;
            }
            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok(snapshot) = serde_json::from_str::<SessionSnapshot>(&content) {
                    for (i, persisted) in snapshot.events.iter().enumerate() {
                        let text = match &persisted.event {
                            AppEvent::UserMessage { text } => text.clone(),
                            AppEvent::AssistantMessage { text, .. } => text.clone(),
                            _ => continue,
                        };
                        if text.to_lowercase().contains(&query_lower) {
                            let snippet_start = text
                                .to_lowercase()
                                .find(&query_lower)
                                .unwrap_or(0)
                                .saturating_sub(50);
                            let end =
                                (snippet_start + query.len() + 50).min(text.len());
                            let role = match &persisted.event {
                                AppEvent::UserMessage { .. } => "user".to_string(),
                                AppEvent::AssistantMessage { .. } => "assistant".to_string(),
                                _ => "unknown".to_string(),
                            };
                            results.push(ConversationSearchResult {
                                session_id: snapshot.session_id.clone(),
                                message_index: i,
                                role,
                                snippet: text[snippet_start..end].to_string(),
                                score: 1.0,
                            });
                        }
                    }
                }
            }
        }
    }

    results.truncate(50);
    results
}

/// List all saved session IDs.
pub fn list_session_ids() -> Vec<String> {
    let dir = sessions_dir();
    let mut ids: Vec<String> = fs::read_dir(&dir)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().map_or(true, |e| e != "json") {
                return None;
            }
            fs::read_to_string(&path)
                .ok()
                .and_then(|c| serde_json::from_str::<SessionSnapshot>(&c).ok())
                .map(|s| s.session_id)
        })
        .collect();
    ids.sort();
    ids.dedup();
    ids
}

/// Export session events in the given format.
pub fn export_session_events(
    session_id: &str,
    format: &str,
) -> Result<String, String> {
    let events =
        load_session_events(session_id).map_err(|e| format!("Session not found: {}", e))?;

    match format {
        "json" => serde_json::to_string_pretty(&events)
            .map_err(|e| format!("JSON serialization failed: {}", e)),
        "markdown" => {
            let mut md = String::new();
            md.push_str("# Conversation Export\n\n");
            md.push_str(&format!("*Session: {}*\n\n---\n\n", session_id));
            for persisted in &events {
                match &persisted.event {
                    AppEvent::UserMessage { text } => {
                        md.push_str(&format!("## User\n\n{}\n\n---\n\n", text));
                    }
                    AppEvent::AssistantMessage { text, model } => {
                        md.push_str(&format!(
                            "## Assistant ({})\n\n{}\n\n---\n\n",
                            model, text
                        ));
                    }
                    _ => {}
                }
            }
            Ok(md)
        }
        "markdown-frontmatter" => {
            let mut md = String::new();
            md.push_str("---\n");
            md.push_str(&format!("session_id: \"{}\"\n", session_id));
            md.push_str(&format!("exported_at: \"{}\"\n", chrono_now_iso()));
            md.push_str("---\n\n");
            md.push_str("# Conversation Export\n\n");
            for persisted in &events {
                match &persisted.event {
                    AppEvent::UserMessage { text } => {
                        md.push_str(&format!("## User\n\n{}\n\n---\n\n", text));
                    }
                    AppEvent::AssistantMessage { text, model } => {
                        md.push_str(&format!(
                            "## Assistant ({})\n\n{}\n\n---\n\n",
                            model, text
                        ));
                    }
                    _ => {}
                }
            }
            Ok(md)
        }
        "pdf-html" => {
            let mut html = String::new();
            html.push_str("<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Conversation Export</title>");
            html.push_str("<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:800px;margin:0 auto;padding:20px;color:#333;}");
            html.push_str(".user{background:#e3f2fd;border-radius:8px;padding:12px;margin:8px 0;}");
            html.push_str(".assistant{background:#f5f5f5;border-radius:8px;padding:12px;margin:8px 0;}");
            html.push_str("h2{font-size:14px;color:#666;margin:4px 0;}pre{white-space:pre-wrap;word-break:break-word;}</style></head><body>");
            html.push_str(&format!("<h1>Session: {}</h1>", session_id));
            for persisted in &events {
                match &persisted.event {
                    AppEvent::UserMessage { text } => {
                        html.push_str(&format!("<div class=\"user\"><h2>User</h2><pre>{}</pre></div>", html_escape(text)));
                    }
                    AppEvent::AssistantMessage { text, model } => {
                        html.push_str(&format!("<div class=\"assistant\"><h2>Assistant ({})</h2><pre>{}</pre></div>", model, html_escape(text)));
                    }
                    _ => {}
                }
            }
            html.push_str("</body></html>");
            Ok(html)
        }
        "clipboard" => {
            let mut text = String::new();
            for persisted in &events {
                match &persisted.event {
                    AppEvent::UserMessage { text: t } => {
                        text.push_str(&format!("User: {}\n\n", t));
                    }
                    AppEvent::AssistantMessage { text: t, model } => {
                        text.push_str(&format!("Assistant ({}): {}\n\n", model, t));
                    }
                    _ => {}
                }
            }
            Ok(text)
        }
        _ => Err(format!("Unknown format: {}", format)),
    }
}

fn chrono_now_iso() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let secs_per_day = 86400u64;
    let days = now / secs_per_day;
    let rem = now % secs_per_day;
    let hours = rem / 3600;
    let mins = (rem % 3600) / 60;
    let secs = rem % 60;
    // Approximate date
    let mut y = 1970u64;
    let mut d = days;
    loop {
        let yd = if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) { 366 } else { 365 };
        if d < yd { break; }
        d -= yd;
        y += 1;
    }
    let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let mdays = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut m = 0usize;
    while m < 12 && d >= mdays[m] {
        d -= mdays[m];
        m += 1;
    }
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", y, m + 1, d + 1, hours, mins, secs)
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// Get a session's snapshot for restore.
pub fn get_session_snapshot(session_id: &str) -> Result<SessionSnapshot, String> {
    let dir = sessions_dir();
    let entries =
        fs::read_dir(&dir).map_err(|e| format!("Failed to read sessions dir: {}", e))?;

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
    let entries =
        fs::read_dir(&dir).map_err(|e| format!("Failed to read sessions dir: {}", e))?;

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

// ═══════ Claude Code Session Browser ═══════

/// Metadata for a Claude Code session discovered on disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeCodeSessionMeta {
    pub session_id: String,
    pub project_name: String,
    pub title: Option<String>,
    pub model: String,
    pub cwd: String,
    pub message_count: u32,
    pub created_at: u64,
    pub updated_at: u64,
    pub preview: String,
    pub total_tokens: u64,
}

/// A parsed entry from a Claude Code JSONL log.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeCodeLogEntry {
    pub timestamp_ms: u64,
    pub event_type: String,
    pub role: Option<String>,
    pub content: String,
    pub model: Option<String>,
    pub usage: Option<ClaudeCodeUsage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeCodeUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
}

fn claude_projects_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/home/ubuntu"))
        .join(".claude")
        .join("projects")
}

/// List all Claude Code sessions from ~/.claude/projects/*/
pub fn list_claude_code_sessions() -> Vec<ClaudeCodeSessionMeta> {
    let dir = claude_projects_dir();
    let mut sessions: Vec<ClaudeCodeSessionMeta> = Vec::new();

    let Ok(project_dirs) = fs::read_dir(&dir) else {
        return sessions;
    };

    for project_entry in project_dirs.flatten() {
        let project_path = project_entry.path();
        if !project_path.is_dir() {
            continue;
        }
        let project_name = project_entry
            .file_name()
            .to_string_lossy()
            .to_string();
        let Ok(jsonl_files) = fs::read_dir(&project_path) else {
            continue;
        };

        for file_entry in jsonl_files.flatten() {
            let fpath = file_entry.path();
            if fpath.extension().map_or(true, |e| e != "jsonl") {
                continue;
            }
            let session_id = fpath
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();

            let meta = file_meta(&fpath);
            let Ok(content) = fs::read_to_string(&fpath) else {
                continue;
            };

            let mut model = String::new();
            let mut cwd = String::new();
            let mut title: Option<String> = None;
            let mut message_count: u32 = 0;
            let mut preview = String::new();
            let mut total_tokens: u64 = 0;

            for line in content.lines().take(200) {
                let Ok(val) = serde_json::from_str::<serde_json::Value>(line) else {
                    continue;
                };
                let event_type = val["type"].as_str().unwrap_or("");

                match event_type {
                    "user" => {
                        message_count += 1;
                        if preview.is_empty() {
                            if let Some(content_val) = val["message"]["content"].as_str() {
                                preview = content_val.to_string();
                            } else if let Some(content_arr) = val["message"]["content"].as_array() {
                                preview = content_arr
                                    .iter()
                                    .filter_map(|c| c["text"].as_str())
                                    .collect::<Vec<_>>()
                                    .join(" ");
                            }
                        }
                        if cwd.is_empty() {
                            cwd = val["cwd"].as_str().unwrap_or("").to_string();
                        }
                    }
                    "assistant" => {
                        message_count += 1;
                        if model.is_empty() {
                            model = val["message"]["model"]
                                .as_str()
                                .unwrap_or("")
                                .to_string();
                        }
                        if let Some(usage) = val["message"]["usage"].as_object() {
                            total_tokens += usage.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                            total_tokens += usage.get("output_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                        }
                        if cwd.is_empty() {
                            cwd = val["cwd"].as_str().unwrap_or("").to_string();
                        }
                    }
                    "ai-title" => {
                        title = val["aiTitle"].as_str().map(|s| s.to_string());
                    }
                    _ => {
                        if cwd.is_empty() {
                            cwd = val["cwd"].as_str().unwrap_or("").to_string();
                        }
                    }
                }
            }

            let preview_text = if preview.is_empty() {
                "(empty session)".to_string()
            } else {
                preview.chars().take(200).collect()
            };

            sessions.push(ClaudeCodeSessionMeta {
                session_id,
                project_name: project_name.clone(),
                title,
                model,
                cwd,
                message_count,
                created_at: meta.created,
                updated_at: meta.modified,
                preview: preview_text,
                total_tokens,
            });
        }
    }

    sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    sessions
}

fn file_meta(path: &std::path::Path) -> FileMeta {
    let default = FileMeta { created: 0, modified: 0 };
    let Ok(meta) = path.metadata() else {
        return default;
    };
    FileMeta {
        created: meta
            .created()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
        modified: meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
    }
}

struct FileMeta {
    created: u64,
    modified: u64,
}

/// Get the full transcript of a Claude Code session as structured log entries.
pub fn get_claude_code_session(uuid: &str) -> Result<Vec<ClaudeCodeLogEntry>, String> {
    let dir = claude_projects_dir();
    let Ok(project_dirs) = fs::read_dir(&dir) else {
        return Err("No Claude Code projects directory found".to_string());
    };

    for project_entry in project_dirs.flatten() {
        let project_path = project_entry.path();
        if !project_path.is_dir() {
            continue;
        }
        let jsonl_path = project_path.join(format!("{}.jsonl", uuid));
        if !jsonl_path.exists() {
            continue;
        }
        let content = fs::read_to_string(&jsonl_path)
            .map_err(|e| format!("Failed to read session: {}", e))?;

        let mut entries: Vec<ClaudeCodeLogEntry> = Vec::new();
        for line in content.lines() {
            let Ok(val) = serde_json::from_str::<serde_json::Value>(line) else {
                continue;
            };
            let event_type = val["type"].as_str().unwrap_or("").to_string();

            let timestamp_ms = val["timestamp"]
                .as_str()
                .and_then(parse_iso_timestamp)
                .unwrap_or(0);

            let (role, content, model, usage) = match event_type.as_str() {
                "user" => {
                    let text = extract_text_content(&val["message"]["content"]);
                    ("user".to_string(), text, None, None)
                }
                "assistant" => {
                    let text = extract_text_content(&val["message"]["content"]);
                    let mdl = val["message"]["model"].as_str().map(|s| s.to_string());
                    let usage_data = val["message"]["usage"].as_object().map(|u| {
                        ClaudeCodeUsage {
                            input_tokens: u.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0),
                            output_tokens: u.get("output_tokens").and_then(|v| v.as_u64()).unwrap_or(0),
                        }
                    });
                    (String::new(), text, mdl, usage_data)
                }
                _ => {
                    let summary = serde_json::to_string(&val).unwrap_or_default();
                    (String::new(), summary, None, None)
                }
            };

            entries.push(ClaudeCodeLogEntry {
                timestamp_ms,
                event_type,
                role: if role.is_empty() { None } else { Some(role) },
                content,
                model,
                usage,
            });
        }

        return Ok(entries);
    }

    Err(format!("Claude Code session not found: {}", uuid))
}

/// Import a Claude Code session into Ollopa as a session snapshot.
pub fn import_claude_code_session(uuid: &str) -> Result<String, String> {
    let entries = get_claude_code_session(uuid)?;
    let session_id = format!("imported-{}", uuid.chars().take(8).collect::<String>());
    let now = current_timestamp_ms();

    let mut events: Vec<PersistedEvent> = Vec::new();
    let mut cost_usd = 0.0;
    let mut model = "unknown".to_string();

    for entry in &entries {
        let ts = if entry.timestamp_ms > 0 { entry.timestamp_ms } else { now };
        match entry.event_type.as_str() {
            "user" => {
                events.push(PersistedEvent {
                    timestamp_ms: ts,
                    event: AppEvent::UserMessage { text: entry.content.clone() },
                });
            }
            "assistant" => {
                if let Some(ref m) = entry.model {
                    model = m.clone();
                }
                events.push(PersistedEvent {
                    timestamp_ms: ts,
                    event: AppEvent::AssistantMessage {
                        text: entry.content.clone(),
                        model: entry.model.clone().unwrap_or_else(|| "claude".to_string()),
                    },
                });
                if let Some(ref usage) = entry.usage {
                    let c = (usage.input_tokens as f64 * 0.003 + usage.output_tokens as f64 * 0.015) / 1000.0;
                    cost_usd += c;
                    events.push(PersistedEvent {
                        timestamp_ms: ts + 1,
                        event: AppEvent::TokenUsage {
                            input_tokens: usage.input_tokens,
                            output_tokens: usage.output_tokens,
                            cost_usd: c,
                        },
                    });
                }
            }
            _ => {}
        }
    }

    let message_count = events.iter().filter(|e| {
        matches!(e.event, AppEvent::UserMessage { .. } | AppEvent::AssistantMessage { .. })
    }).count() as u32;

    let snapshot = SessionSnapshot {
        session_id: session_id.clone(),
        project_path: None,
        model,
        created_at: events.first().map(|e| e.timestamp_ms).unwrap_or(now),
        updated_at: now,
        message_count,
        status: SessionStatus::Completed,
        cost_usd,
        duration_ms: 0,
        title: Some(format!("Imported: {}", &uuid[..8.min(uuid.len())])),
        claude_session_id: Some(uuid.to_string()),
        events,
    };

    save_snapshot(None, &snapshot)?;
    Ok(session_id)
}

/// Parse an ISO 8601 timestamp like "2026-05-28T05:37:01.878Z" to milliseconds since epoch.
fn parse_iso_timestamp(ts: &str) -> Option<u64> {
    // Format: 2026-05-28T05:37:01.878Z or 2026-05-28T05:37:01Z
    let ts = ts.strip_suffix('Z').unwrap_or(ts);
    let (date_part, time_part) = ts.split_once('T')?;
    let date: Vec<u64> = date_part.split('-').filter_map(|s| s.parse().ok()).collect();
    if date.len() != 3 { return None; }

    let time_clean = time_part.split(['+', '-'].as_ref()).next().unwrap_or(time_part);
    let time_nums: Vec<&str> = time_clean.split(':').collect();
    if time_nums.len() < 2 { return None; }

    let hour: u64 = time_nums[0].parse().ok()?;
    let min: u64 = time_nums[1].parse().ok()?;
    let sec_str = time_nums.get(2).copied().unwrap_or("0");
    let sec_parts: Vec<&str> = sec_str.split('.').collect();
    let sec: u64 = sec_parts[0].parse().ok()?;
    let ms: u64 = sec_parts.get(1).unwrap_or(&"0").chars()
        .take(3)
        .collect::<String>()
        .parse()
        .unwrap_or(0);

    // Days since epoch for the given date (approximate, good enough for ordering)
    let year = date[0];
    let month = date[1];
    let day = date[2];
    let mut days = 0u64;
    for y in 1970..year {
        days += if is_leap(y) { 366 } else { 365 };
    }
    let month_days = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    days += month_days[(month - 1) as usize];
    if month > 2 && is_leap(year) { days += 1; }
    days += day - 1;

    Some(days * 86_400_000 + hour * 3_600_000 + min * 60_000 + sec * 1000 + ms)
}

fn is_leap(y: u64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

fn extract_text_content(content_val: &serde_json::Value) -> String {
    if let Some(s) = content_val.as_str() {
        return s.to_string();
    }
    if let Some(arr) = content_val.as_array() {
        return arr
            .iter()
            .filter_map(|c| c["text"].as_str())
            .collect::<Vec<_>>()
            .join("\n");
    }
    String::new()
}
