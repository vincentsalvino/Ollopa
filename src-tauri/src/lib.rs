mod memory;
mod pty;

use parking_lot::Mutex;
use std::sync::Arc;
use tauri::{Manager, State};

struct AppState {
    pty_session: Arc<Mutex<Option<pty::PtySession>>>,
    working_dir: Arc<Mutex<Option<String>>>,
}

// ═══════ Helper ═══════

fn spawn_new_session(
    app_handle: &tauri::AppHandle,
    working_dir: Option<&str>,
) -> Result<pty::PtySession, String> {
    let initial = memory::build_initial_injection(working_dir);
    pty::PtySession::spawn(app_handle.clone(), initial, working_dir)
}

// ═══════ HIGH 1: Project Switcher ═══════

#[tauri::command]
fn switch_project(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut dir = state.working_dir.lock();
    *dir = Some(path);
    Ok(())
}

// ═══════ Session Management ═══════

#[tauri::command]
fn start_session(app_handle: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let dir = state.working_dir.lock().clone();
    let session = spawn_new_session(&app_handle, dir.as_deref())?;
    let mut guard = state.pty_session.lock();
    *guard = Some(session);
    Ok(())
}

// ═══════ HIGH 2: Session Restart ═══════

#[tauri::command]
fn restart_session(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Drop old session
    {
        let mut guard = state.pty_session.lock();
        *guard = None;
    }
    // Spawn new one
    let dir = state.working_dir.lock().clone();
    let session = spawn_new_session(&app_handle, dir.as_deref())?;
    let mut guard = state.pty_session.lock();
    *guard = Some(session);
    Ok(())
}

// ═══════ Input / Approval ═══════

#[tauri::command]
fn send_input(input: String, state: State<'_, AppState>) -> Result<(), String> {
    let guard = state.pty_session.lock();
    match guard.as_ref() {
        Some(session) => session.write_input(&input),
        None => Err("No active session".to_string()),
    }
}

#[tauri::command]
fn respond_approval(approved: bool, state: State<'_, AppState>) -> Result<(), String> {
    let guard = state.pty_session.lock();
    match guard.as_ref() {
        Some(session) => {
            session.respond_approval(approved);
            Ok(())
        }
        None => Err("No active session".to_string()),
    }
}

#[tauri::command]
fn approve_plan(state: State<'_, AppState>) -> Result<(), String> {
    let guard = state.pty_session.lock();
    match guard.as_ref() {
        Some(session) => {
            session.approve_plan();
            Ok(())
        }
        None => Err("No active session".to_string()),
    }
}

// ═══════ HIGH 3: Deny Plan ═══════

#[tauri::command]
fn deny_plan(state: State<'_, AppState>) -> Result<(), String> {
    let guard = state.pty_session.lock();
    match guard.as_ref() {
        Some(session) => {
            session.deny_plan();
            Ok(())
        }
        None => Err("No active session".to_string()),
    }
}

// ═══════ Cost / Memory ═══════

#[tauri::command]
fn get_token_cost() -> memory::CostData {
    memory::compute_token_cost()
}

#[tauri::command]
fn get_memory_data() -> memory::MemoryData {
    memory::MemoryData {
        claude_md: memory::read_claude_md(),
        memory_lines: memory::read_memory_last_lines(),
    }
}

#[tauri::command]
fn save_memory(entry: String) -> Result<(), String> {
    memory::append_memory(&entry)
}

// ═══════ MED 7: Memory Editor ═══════

#[tauri::command]
fn get_full_memory() -> String {
    memory::read_memory_full()
}

#[tauri::command]
fn write_full_memory(content: String) -> Result<(), String> {
    memory::write_memory_full(&content)
}

// ═══════ MED 9: Env Var Check ═══════

#[tauri::command]
fn check_env_vars() -> Result<(), String> {
    let base_url = std::env::var("ANTHROPIC_BASE_URL").ok();
    let api_key = std::env::var("ANTHROPIC_API_KEY")
        .or_else(|_| std::env::var("ANTHROPIC_KEY"))
        .ok();

    let mut missing = Vec::new();
    if base_url.is_none() {
        missing.push("ANTHROPIC_BASE_URL");
    }
    if api_key.is_none() {
        missing.push("ANTHROPIC_API_KEY");
    }

    if missing.is_empty() {
        Ok(())
    } else {
        Err(format!("Missing: {}", missing.join(", ")))
    }
}

// ═══════ App Entry ═══════

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            app.manage(AppState {
                pty_session: Arc::new(Mutex::new(None)),
                working_dir: Arc::new(Mutex::new(None)),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_session,
            restart_session,
            switch_project,
            send_input,
            respond_approval,
            approve_plan,
            deny_plan,
            get_token_cost,
            get_memory_data,
            save_memory,
            get_full_memory,
            write_full_memory,
            check_env_vars,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
