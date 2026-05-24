use crate::claude_events::AppEvent;
use crate::claude_process::ClaudeProcess;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

/// Persisted session metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct SessionSnapshot {
    pub session_id: String,
    pub project_path: Option<String>,
    pub model: String,
    pub created_at: u64,
    pub message_count: u32,
}

/// Lightweight session metadata for the sidebar list
#[derive(Debug, Clone, Serialize)]
pub struct SessionMeta {
    pub key: String,
    pub preview: String,
    pub message_count: usize,
}

/// Manages Claude process lifecycle and session persistence.
#[allow(dead_code)]
pub struct SessionManager {
    pub process: Option<ClaudeProcess>,
    pub working_dir: Option<String>,
    pub session_id: Option<String>,
    pub model: String,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            process: None,
            working_dir: None,
            session_id: None,
            model: "unknown".to_string(),
        }
    }

    /// Start a new Claude session.
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

        self.working_dir = working_dir.clone();

        let process =
            ClaudeProcess::spawn(app_handle.clone(), working_dir, initial_prompt).await?;

        let _ = app_handle.emit(
            "app-event",
            AppEvent::StatusUpdate {
                status: "starting".to_string(),
                detail: "Claude process spawned, waiting for initialization...".to_string(),
            },
        );

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

    /// Stop the current session.
    pub async fn stop(&mut self) -> Result<(), String> {
        if let Some(ref mut proc) = self.process {
            proc.kill().await?;
        }
        self.process = None;
        self.session_id = None;
        Ok(())
    }

    /// Check if a session is currently active.
    #[allow(dead_code)]
    pub fn is_active(&self) -> bool {
        self.process.is_some()
    }

    /// Set the working directory for next session.
    pub fn set_working_dir(&mut self, dir: String) {
        self.working_dir = Some(dir);
    }
}

// ═══════ Session Persistence Utilities ═══════

fn sessions_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/home/ubuntu"))
        .join(".claude")
        .join("workspace-sessions")
}

#[allow(dead_code)]
fn sanitize_key(project_path: Option<&str>) -> String {
    project_path
        .map(|p| p.replace(['/', '\\', ':', ' '], "_"))
        .unwrap_or_else(|| "global".to_string())
}

/// List all saved session snapshots.
pub fn list_sessions() -> Vec<SessionMeta> {
    let dir = sessions_dir();
    fs::read_dir(&dir)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().map_or(true, |e| e != "json") {
                return None;
            }
            let key = path.file_stem()?.to_string_lossy().to_string();
            let content = fs::read_to_string(&path).ok()?;
            let snapshot: SessionSnapshot = serde_json::from_str(&content).ok()?;
            Some(SessionMeta {
                key,
                preview: format!("Model: {} | Messages: {}", snapshot.model, snapshot.message_count),
                message_count: snapshot.message_count as usize,
            })
        })
        .collect()
}

/// Save a session snapshot.
#[allow(dead_code)]
pub fn save_snapshot(project_path: Option<&str>, snapshot: &SessionSnapshot) -> Result<(), String> {
    let dir = sessions_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create sessions dir: {}", e))?;
    let key = sanitize_key(project_path);
    let path = dir.join(format!("{}.json", key));
    let json = serde_json::to_string_pretty(snapshot)
        .map_err(|e| format!("Failed to serialize snapshot: {}", e))?;
    fs::write(path, json).map_err(|e| format!("Failed to write snapshot: {}", e))
}

/// Delete a session snapshot.
pub fn delete_snapshot(key: &str) -> Result<(), String> {
    let path = sessions_dir().join(format!("{}.json", key));
    fs::remove_file(&path).map_err(|e| format!("Failed to delete snapshot: {}", e))
}
