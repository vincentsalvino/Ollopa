mod agent_loop;
mod api_client;
mod api_keys;
mod api_tools;
mod approval_manager;
mod codebase_indexer;
mod ollopa_events;
mod event_bus;
mod git_intelligence;
mod memory;
mod prompt_template;
mod provider_router;
mod repo_intelligence;
mod second_brain;
mod session_manager;
mod token_optimizer;
mod visual_memory;
mod web_search;
mod predictive;

use std::sync::Arc;
use tauri::{Emitter, Manager, State};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

struct AppState {
    session: Arc<Mutex<session_manager::SessionManager>>,
    event_bus: Arc<event_bus::EventBus>,
    api: Arc<Mutex<Option<api_client::DirectApiClient>>>,
    cancel_token: Arc<Mutex<CancellationToken>>,
}

// ═══════ Session Management ═══════

#[tauri::command]
async fn start_session(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Reset API client for new session
    {
        let mut guard = state.api.lock().await;
        *guard = None;
    }
    let mut session = state.session.lock().await;
    state.event_bus.clear_history().await;
    let working_dir = session.working_dir.clone();
    session.start(app_handle, working_dir, None).await
}

#[tauri::command]
async fn restart_session(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    {
        let mut guard = state.api.lock().await;
        *guard = None;
    }
    let mut session = state.session.lock().await;
    state.event_bus.clear_history().await;
    session.restart(app_handle, None).await
}

#[tauri::command]
async fn stop_session(state: State<'_, AppState>) -> Result<(), String> {
    let mut session = state.session.lock().await;
    session.stop().await
}

/// Classify a prompt to determine if it needs agent planning mode.
#[tauri::command]
fn classify_prompt(message: String) -> serde_json::Value {
    let lower = message.to_lowercase();
    let word_count = message.split_whitespace().count();

    // Explicit agent triggers
    let explicit = lower.starts_with("/plan")
        || lower.starts_with("/agent")
        || lower.contains("step by step")
        || lower.contains("step-by-step");

    // Complex task indicators
    let complex_keywords = [
        "implement", "refactor", "build", "create a", "set up", "migrate",
        "redesign", "restructure", "convert", "integrate", "deploy",
        "write a full", "add feature", "fix the bug", "debug",
        "optimize", "rewrite", "scaffold", "generate", "automate",
    ];
    let keyword_hits = complex_keywords.iter().filter(|k| lower.contains(**k)).count();

    let needs_planning = explicit || (word_count >= 20 && keyword_hits >= 1) || keyword_hits >= 2;

    serde_json::json!({
        "needs_planning": needs_planning,
        "word_count": word_count,
        "keyword_hits": keyword_hits,
        "explicit_trigger": explicit,
    })
}

#[tauri::command]
async fn send_input(
    message: String,
    agent_mode: Option<bool>,
    planning_model: Option<String>,
    coding_model: Option<String>,
    max_iterations: Option<usize>,
    project_path: Option<String>,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Phase 1: Lock session briefly to record user message in snapshot
    let (model, system_prompt, working_dir) = {
        let mut session = state.session.lock().await;
        session.prepare_send(&message);
        (
            session.model.clone(),
            session.system_prompt.clone(),
            session.working_dir.clone(),
        )
    };

    // Phase 2: Get or create API client (separate lock, ~5ms)
    let mut client = {
        let mut guard = state.api.lock().await;
        match guard.take() {
            Some(c) => c,
            None => api_client::DirectApiClient::new(&app_handle)?,
        }
    };
    client.set_model(&model);

    // Resolve effective project path (prefer explicit, fallback to working_dir)
    let effective_project = project_path.or(working_dir.clone());

    // Enhance system prompt with project context when a working directory is set
    let effective_prompt = if let Some(ref wd) = effective_project {
        format!(
            "{}\n\n## Project Context\nYou are working on a project located at: {}\n\
            When using tools like read_file, list_directory, or search_code, \
            you can use relative paths (they will be resolved against the project directory). \
            Use the available tools to explore and analyze the codebase.",
            system_prompt, wd
        )
    } else {
        system_prompt
    };
    client.set_system_prompt(&effective_prompt);
    client.set_working_dir(working_dir);

    // Share cancel token for stop_generation
    let token = CancellationToken::new();
    {
        let mut ct = state.cancel_token.lock().await;
        *ct = token.clone();
    }
    client.set_cancel_token(token);

    // Phase 3: Agent mode or direct send
    let use_agent = agent_mode.unwrap_or(false);

    let result = if use_agent {
        // Run agent loop inline (avoids separate IPC call + CORS issues)
        let config = agent_loop::AgentLoopConfig {
            max_iterations: max_iterations.unwrap_or(25),
            planning_model,
            coding_model,
            project_path: effective_project,
            ..Default::default()
        };
        let mut loop_instance = agent_loop::AgentLoop::new(&message, config);
        match loop_instance.run(&mut client, &app_handle).await {
            Ok(_summary) => Ok(()),
            Err(e) => Err(e),
        }
    } else {
        client.send_message(&message, &app_handle).await
    };

    // Clear cancel token
    {
        let mut ct = state.cancel_token.lock().await;
        *ct = CancellationToken::new();
    }

    // Phase 4: Lock session briefly to finalize (always, even on error)
    {
        let mut session = state.session.lock().await;
        session.finalize_send(client.model());
    }

    // On error, emit an error event to the timeline
    if let Err(ref err) = result {
        let _ = app_handle.emit(
            "app-event",
            ollopa_events::AppEvent::AssistantMessage {
                text: format!("**Error:** {}", err),
                model: client.model().to_string(),
            },
        );
    }

    // Put client back
    {
        let mut guard = state.api.lock().await;
        *guard = Some(client);
    }

    result
}

// ═══════ Conversation Persistence ═══════

#[tauri::command]
fn list_conversations() -> Vec<String> {
    session_manager::list_session_ids()
}

#[tauri::command]
fn get_conversation_messages(session_id: String) -> Option<Vec<session_manager::PersistedEvent>> {
    session_manager::load_session_events(&session_id).ok()
}

#[tauri::command]
async fn resume_conversation(
    session_id: String,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let mut session = state.session.lock().await;

    // Finalize current session if active
    if let Some(ref sid) = session.session_id {
        session_manager::finalize_session_pub(session.working_dir.as_deref(), sid, false);
    }

    // Look up the model from the snapshot so we can restore it
    let snapshot_model = session_manager::get_session_model(&session_id);

    // Start a fresh session
    let working_dir = session.working_dir.clone();
    session.start(app_handle.clone(), working_dir, None).await?;

    // Override the session_id to the original so events append to the same snapshot
    session.session_id = Some(session_id.clone());

    // Restore the model from the snapshot (not "unknown")
    let model = snapshot_model.unwrap_or_else(|| session.model.clone());
    session.model = model.clone();

    // Re-activate the snapshot so new messages append to it
    session_manager::reactivate_session(session.working_dir.as_deref(), &session_id);

    // Emit session_started with correct model so frontend picks it up
    let _ = app_handle.emit(
        "app-event",
        ollopa_events::AppEvent::SessionStarted {
            session_id: session_id.clone(),
            model: model.clone(),
            cwd: std::env::current_dir()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default(),
            tools: vec![
                "bash".to_string(),
                "read".to_string(),
                "write".to_string(),
                "edit".to_string(),
                "glob".to_string(),
                "grep".to_string(),
            ],
        },
    );

    Ok(model)
}

// ═══════ Project Switcher ═══════

#[tauri::command]
async fn switch_project(
    path: String,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut session = state.session.lock().await;
    session.set_working_dir(path);
    state.event_bus.clear_history().await;
    session.restart(app_handle, None).await
}

// ═══════ Session History ═══════

#[tauri::command]
fn list_sessions() -> Vec<session_manager::SessionMeta> {
    session_manager::list_sessions()
}

#[tauri::command]
fn delete_session_by_key(key: String) -> Result<(), String> {
    session_manager::delete_snapshot(&key)
}

#[tauri::command]
fn get_session_events(
    session_id: String,
) -> Result<Vec<session_manager::PersistedEvent>, String> {
    session_manager::load_session_events(&session_id)
}

#[tauri::command]
fn get_session_snapshot(
    session_id: String,
) -> Result<session_manager::SessionSnapshot, String> {
    session_manager::get_session_snapshot(&session_id)
}



// ═══════ Event History (for session recovery) ═══════

#[tauri::command]
async fn get_recent_events(
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<event_bus::TimestampedEvent>, String> {
    let events = state.event_bus.recent_events(limit.unwrap_or(100)).await;
    Ok(events)
}

// ═══════ Cost / Memory ═══════

#[tauri::command]
fn get_token_cost() -> memory::CostData {
    memory::compute_token_cost()
}

#[tauri::command]
fn get_memory_data() -> memory::MemoryData {
    memory::MemoryData {
        ollopa_md: memory::read_ollopa_md(),
        claude_md: String::new(),
        memory_lines: memory::read_memory_last_lines(),
    }
}

#[tauri::command]
fn save_memory(entry: String) -> Result<(), String> {
    memory::append_memory(&entry)
}

#[tauri::command]
fn get_full_memory() -> String {
    memory::read_memory_full()
}

#[tauri::command]
fn write_full_memory(content: String) -> Result<(), String> {
    memory::write_memory_full(&content)
}

#[tauri::command]
fn get_project_tree(path: Option<String>) -> String {
    match path {
        Some(p) => memory::read_project_tree(&p),
        None => String::new(),
    }
}

// ═══════ Env Var Check ═══════

#[tauri::command]
fn check_env_vars() -> Result<(), String> {
    // Check API key is configured (not CLI)
    let key = std::env::var("ANTHROPIC_API_KEY")
        .or_else(|_| std::env::var("ANTHROPIC_AUTH_TOKEN"))
        .unwrap_or_default();
    if key.is_empty() {
        return Err("No API key configured. Open Settings > Manage API Keys to add one.".to_string());
    }
    Ok(())
}

// ═══════ Stop Generation ═══════

#[tauri::command]
async fn stop_generation(state: State<'_, AppState>) -> Result<(), String> {
    let token = state.cancel_token.lock().await;
    token.cancel();
    Ok(())
}

// ═══════ System Prompt ═══════

#[tauri::command]
async fn set_system_prompt(
    prompt: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut session = state.session.lock().await;
    session.set_system_prompt(&prompt);
    drop(session);
    let mut guard = state.api.lock().await;
    if let Some(ref mut client) = *guard {
        client.set_system_prompt(&prompt);
    }
    Ok(())
}

#[tauri::command]
async fn get_system_prompt(
    state: State<'_, AppState>,
) -> Result<String, String> {
    let session = state.session.lock().await;
    Ok(session.system_prompt_value().to_string())
}

// ═══════ Model Selector ═══════

#[tauri::command]
async fn set_model(
    model: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut session = state.session.lock().await;
    session.set_model(&model);
    drop(session);
    // Also update active API client
    let mut guard = state.api.lock().await;
    if let Some(ref mut client) = *guard {
        client.set_model(&model);
    }
    Ok(())
}

#[tauri::command]
async fn get_current_model(
    state: State<'_, AppState>,
) -> Result<String, String> {
    let session = state.session.lock().await;
    Ok(session.model_value().to_string())
}

// ═══════ Codebase Indexer ═══════

#[tauri::command]
fn codebase_index(project_path: String) -> Result<serde_json::Value, String> {
    let index = codebase_indexer::index_project(&project_path)?;
    serde_json::to_value(&index).map_err(|e| format!("Serialization error: {}", e))
}



// ═══════ Manual Compaction ═══════

#[tauri::command]
async fn compact_now(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let mut guard = state.api.lock().await;
    if let Some(ref mut client) = *guard {
        if let Some(detail) = client.compact() {
            let _ = app_handle.emit(
                "app-event",
                crate::ollopa_events::AppEvent::StatusUpdate {
                    status: "compacted".to_string(),
                    detail: detail.clone(),
                },
            );
            return Ok(detail);
        }
    }
    Ok("Nothing to compact".to_string())
}

// ═══════ Smart Context ═══════

#[tauri::command]
async fn set_smart_context(
    enabled: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut guard = state.api.lock().await;
    if let Some(ref mut client) = *guard {
        client.set_smart_context(enabled);
    }
    Ok(())
}

// ═══════ Thinking Mode ═══════

#[tauri::command]
async fn set_thinking_mode(
    enabled: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut guard = state.api.lock().await;
    if let Some(ref mut client) = *guard {
        client.set_thinking_mode(enabled);
    }
    Ok(())
}

// ═══════ Message Editing ═══════

#[tauri::command]
async fn edit_message(
    index: usize,
    new_content: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let mut session = state.session.lock().await;
    session.truncate_at(index).await;
    drop(session);
    // Also truncate API client history
    let mut guard = state.api.lock().await;
    if let Some(ref mut client) = *guard {
        client.edit_message_at(index, &new_content);
    }
    Ok(true)
}

// ═══════ Export Conversation ═══════

#[tauri::command]
async fn export_conversation(
    format: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let session = state.session.lock().await;
    if let Some(ref sid) = session.session_id {
        session_manager::export_session_events(sid, &format)
    } else {
        Err("No active session".to_string())
    }
}

// ═══════ Search Conversations ═══════

#[tauri::command]
fn search_conversations(query: String) -> Vec<session_manager::ConversationSearchResult> {
    session_manager::search_sessions(&query)
}

// ═══════ Second Brain ═══════

#[tauri::command]
fn brain_search(query: String, project_path: Option<String>) -> Vec<second_brain::SearchResult> {
    second_brain::search(&query, project_path.as_deref(), 20)
}

#[tauri::command]
fn brain_stats() -> second_brain::BrainStats {
    second_brain::get_brain_stats()
}

#[tauri::command]
fn brain_save_decision(
    title: String,
    context: String,
    decision: String,
    rationale: String,
    tags: Vec<String>,
    project_path: Option<String>,
) -> Result<(), String> {
    let d = second_brain::Decision {
        id: format!("dec-{}", std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()),
        created_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
        project_path,
        title,
        context,
        decision,
        rationale,
        tags,
        status: second_brain::DecisionStatus::Active,
    };
    second_brain::save_decision(&d)
}

#[tauri::command]
fn brain_list_decisions(project_path: Option<String>) -> Vec<second_brain::Decision> {
    second_brain::list_decisions(project_path.as_deref())
}

#[tauri::command]
fn brain_delete_decision(id: String) -> Result<(), String> {
    second_brain::delete_decision(&id)
}

#[tauri::command]
fn brain_list_summaries(project_path: Option<String>) -> Vec<second_brain::SessionSummary> {
    second_brain::list_summaries(project_path.as_deref())
}

#[tauri::command]
fn brain_delete_summary(session_id: String) -> Result<(), String> {
    second_brain::delete_summary(&session_id)
}

#[tauri::command]
fn brain_get_context(project_path: Option<String>, max_tokens: Option<usize>) -> String {
    second_brain::get_compressed_context(project_path.as_deref(), max_tokens.unwrap_or(2000))
}

#[tauri::command]
fn brain_index_note(
    content: String,
    project_path: Option<String>,
    tags: Vec<String>,
) -> Result<(), String> {
    second_brain::index_note(&content, project_path.as_deref(), &tags)
}

// ═══════ Visual Memory ═══════

#[tauri::command]
fn visual_build_relationship_graph(
    project_path: Option<String>,
) -> visual_memory::Graph {
    visual_memory::build_relationship_graph(project_path.as_deref())
}

#[tauri::command]
fn visual_build_architecture_graph(
    project_path: Option<String>,
) -> visual_memory::Graph {
    visual_memory::build_architecture_graph(project_path.as_deref())
}

#[tauri::command]
fn visual_build_workflow_dag(
    project_path: Option<String>,
) -> visual_memory::Graph {
    visual_memory::build_workflow_dag(project_path.as_deref())
}

#[tauri::command]
fn visual_build_dependency_graph(
    project_path: Option<String>,
) -> visual_memory::Graph {
    visual_memory::build_dependency_graph(project_path.as_deref())
}

#[tauri::command]
fn visual_build_session_timeline(
    session_id: String,
) -> Result<visual_memory::SessionTimelineData, String> {
    visual_memory::build_session_timeline(&session_id)
}

#[tauri::command]
fn visual_save_graph(graph: visual_memory::Graph) -> Result<(), String> {
    visual_memory::save_graph(&graph)
}

#[tauri::command]
fn visual_list_graphs(
    project_path: Option<String>,
    graph_type: Option<String>,
) -> Vec<visual_memory::Graph> {
    visual_memory::list_graphs(project_path.as_deref(), graph_type.as_deref())
}

#[tauri::command]
fn visual_delete_graph(graph_id: String) -> Result<(), String> {
    visual_memory::delete_graph(&graph_id)
}

#[tauri::command]
fn visual_get_stats() -> visual_memory::VisualStats {
    visual_memory::get_visual_stats()
}

#[tauri::command]
fn visual_list_sessions_for_timeline() -> Vec<session_manager::SessionMeta> {
    session_manager::list_sessions()
}

// ═══════ Token Optimizer ═══════

#[tauri::command]
fn optimizer_get_stats() -> token_optimizer::OptimizationStats {
    token_optimizer::get_optimization_stats()
}

#[tauri::command]
fn optimizer_get_budget() -> token_optimizer::TokenBudget {
    token_optimizer::load_budget()
}

#[tauri::command]
fn optimizer_save_budget(budget: token_optimizer::TokenBudget) -> Result<(), String> {
    token_optimizer::save_budget(&budget)
}

#[tauri::command]
fn optimizer_run() -> Result<token_optimizer::OptimizationResult, String> {
    token_optimizer::run_optimization()
}

#[tauri::command]
fn optimizer_build_context(
    project_path: Option<String>,
    query: Option<String>,
) -> String {
    token_optimizer::build_optimized_context(
        project_path.as_deref(),
        query.as_deref(),
    )
}

#[tauri::command]
fn optimizer_record_usage(
    input_tokens: u64,
    output_tokens: u64,
) -> Result<(), String> {
    token_optimizer::record_usage(input_tokens, output_tokens)
}

#[tauri::command]
fn optimizer_prune_cache() -> usize {
    token_optimizer::prune_cache()
}

#[tauri::command]
fn optimizer_list_rolling() -> Vec<token_optimizer::RollingSummary> {
    token_optimizer::list_rolling_summaries()
}

#[tauri::command]
fn optimizer_clear_data() -> Result<(), String> {
    token_optimizer::clear_optimization_data()
}

#[tauri::command]
fn optimizer_estimate_tokens(text: String) -> usize {
    token_optimizer::estimate_tokens(&text)
}

// ═══════ Agent Loop ═══════

#[tauri::command]
async fn agent_run_loop(
    task: String,
    max_iterations: Option<usize>,
    planning_model: Option<String>,
    coding_model: Option<String>,
    project_path: Option<String>,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let config = agent_loop::AgentLoopConfig {
        max_iterations: max_iterations.unwrap_or(25),
        planning_model,
        coding_model,
        project_path,
        ..Default::default()
    };

    let mut loop_instance = agent_loop::AgentLoop::new(&task, config);

    // Get or create API client
    let (model, system_prompt, working_dir) = {
        let session = state.session.lock().await;
        (session.model.clone(), session.system_prompt.clone(), session.working_dir.clone())
    };
    let mut client = {
        let mut guard = state.api.lock().await;
        guard.take().unwrap_or_else(|| {
            api_client::DirectApiClient::new(&app_handle).unwrap()
        })
    };
    client.set_model(&model);
    client.set_system_prompt(&system_prompt);
    client.set_working_dir(working_dir);

    let result = loop_instance.run(&mut client, &app_handle).await;

    // Return client
    {
        let mut guard = state.api.lock().await;
        *guard = Some(client);
    }

    result
}

#[tauri::command]
async fn agent_loop_status(
    _state: State<'_, AppState>,
) -> Result<String, String> {
    Ok("Agent loop status check - no active loop".to_string())
}

// ═══════ Phase 3 — Smart Context + Learning ═══════

#[tauri::command]
fn generate_repo_map(project_path: String) -> Result<codebase_indexer::RepoMap, String> {
    codebase_indexer::generate_repo_map(&project_path)
}

#[tauri::command]
fn repo_map_text(project_path: String) -> Result<String, String> {
    let map = codebase_indexer::generate_repo_map(&project_path)?;
    Ok(codebase_indexer::repo_map_to_text(&map))
}

#[tauri::command]
fn select_files_for_task(
    project_path: String,
    task: String,
    max_files: Option<usize>,
    token_budget: Option<usize>,
) -> Result<codebase_indexer::FileSelection, String> {
    codebase_indexer::select_files_for_task(
        &project_path,
        &task,
        max_files.unwrap_or(10),
        token_budget.unwrap_or(32_000),
    )
}

#[tauri::command]
fn search_skills(task: String, project_path: Option<String>) -> Vec<second_brain::Skill> {
    second_brain::search_skills(&task, project_path.as_deref())
}

#[tauri::command]
fn list_skills() -> Vec<second_brain::Skill> {
    second_brain::list_skills()
}

#[tauri::command]
fn estimate_agent_cost(
    task: String,
    model: Option<String>,
) -> Result<serde_json::Value, String> {
    let model_id = model.unwrap_or_else(|| "deepseek-v4-flash".to_string());
    let estimated_steps = 5_usize;
    let tokens_per_step = 2000_usize;
    let planning_tokens = 1500_usize;
    let reflect_tokens = 500_usize;

    let total_input = planning_tokens + (tokens_per_step * estimated_steps) + (reflect_tokens * estimated_steps);
    let total_output = 500 + (1000 * estimated_steps) + (200 * estimated_steps);

    let (input_price, output_price) = match model_id.as_str() {
        m if m.contains("flash") => (0.14, 0.28),
        m if m.contains("pro") => (0.435, 0.87),
        _ => (0.14, 0.28),
    };

    let estimated_cost = (total_input as f64 * input_price / 1_000_000.0)
        + (total_output as f64 * output_price / 1_000_000.0);

    Ok(serde_json::json!({
        "task": task,
        "model": model_id,
        "estimated_steps": estimated_steps,
        "estimated_input_tokens": total_input,
        "estimated_output_tokens": total_output,
        "estimated_cost_usd": estimated_cost,
    }))
}

// ═══════ Provider Router ═══════

#[tauri::command]
fn router_list_providers() -> Vec<provider_router::Provider> {
    provider_router::list_providers()
}

#[tauri::command]
fn router_save_provider(provider: provider_router::Provider) -> Result<(), String> {
    provider_router::save_provider(&provider)
}

#[tauri::command]
fn router_delete_provider(id: String) -> Result<(), String> {
    provider_router::delete_provider(&id)
}

#[tauri::command]
fn router_get_config() -> provider_router::RouterConfig {
    provider_router::load_config()
}

#[tauri::command]
fn router_save_config(config: provider_router::RouterConfig) -> Result<(), String> {
    provider_router::save_config(&config)
}

#[tauri::command]
fn router_route(
    task_type: String,
    needs_tools: bool,
    max_budget: Option<f64>,
) -> provider_router::RoutingDecision {
    provider_router::route(&task_type, needs_tools, max_budget)
}

#[tauri::command]
fn router_stats() -> provider_router::RouterStats {
    provider_router::get_router_stats()
}

// ═══════ Conversation Truncation ═══════

#[tauri::command]
async fn truncate_conversation(index: usize, state: State<'_, AppState>) -> Result<(), String> {
    let mut session = state.session.lock().await;
    session.truncate_at(index).await;
    drop(session);
    let mut guard = state.api.lock().await;
    if let Some(ref mut client) = *guard {
        client.truncate_history(index);
    }
    Ok(())
}

// ═══════ Context Window ═══════

#[tauri::command]
fn get_model_context_window(model: String) -> usize {
    provider_router::get_context_window(&model)
}

// ═══════ Git Intelligence ═══════

#[tauri::command]
fn git_info(project_path: String) -> git_intelligence::GitInfo {
    git_intelligence::get_git_info(&project_path)
}

// ═══════ Repository Intelligence ═══════

#[tauri::command]
fn repo_analyze(project_path: String) -> repo_intelligence::RepoAnalysis {
    repo_intelligence::analyze_repo(&project_path)
}

// ═══════ Provider Switch (updates env vars for next CLI spawn) ═══════

#[tauri::command]
async fn switch_provider(
    base_url: String,
    api_key_env: String,
    model: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Update env vars for next API client creation
    std::env::set_var("ANTHROPIC_BASE_URL", &base_url);
    std::env::set_var("ANTHROPIC_MODEL", &model);
    if let Ok(key) = std::env::var(&api_key_env) {
        std::env::set_var("ANTHROPIC_API_KEY", &key);
    }
    // Update the active API client if present
    {
        let mut guard = state.api.lock().await;
        if let Some(ref mut client) = *guard {
            let _ = client.switch_provider(&base_url, &api_key_env, &model);
        }
    }
    let mut session = state.session.lock().await;
    session.set_model(&model);
    Ok(())
}

// ═══════ API Key Management ═══════

#[tauri::command]
fn list_api_keys() -> Vec<api_keys::ApiKeyInfo> {
    api_keys::list_api_keys()
}

#[tauri::command]
fn save_api_key(env_var: String, key_value: String) -> Result<(), String> {
    api_keys::save_api_key(&env_var, &key_value)
}

#[tauri::command]
fn delete_api_key(env_var: String) -> Result<(), String> {
    api_keys::delete_api_key(&env_var)
}

// ═══════ Prompt Transformer ═══════

#[tauri::command]
fn transform_preview(
    raw: String,
    model: Option<String>,
    project_path: Option<String>,
) -> prompt_template::TransformResult {
    let settings = prompt_template::load_settings();
    let context = prompt_template::TransformContext {
        model,
        project_path,
        recent_messages: vec![],
        detected_language: None,
    };
    prompt_template::transform_prompt(&raw, &context, &settings)
}

#[tauri::command]
fn transform_get_settings() -> prompt_template::TransformSettings {
    prompt_template::load_settings()
}

#[tauri::command]
fn transform_save_settings(
    settings: prompt_template::TransformSettings,
) -> Result<(), String> {
    prompt_template::save_settings(&settings)
}

#[tauri::command]
fn transform_list_templates() -> Vec<prompt_template::PromptTemplate> {
    prompt_template::list_templates()
}

#[tauri::command]
fn transform_save_template(
    template: prompt_template::PromptTemplate,
) -> Result<(), String> {
    prompt_template::save_template(&template)
}

#[tauri::command]
fn transform_delete_template(id: String) -> Result<(), String> {
    prompt_template::delete_template(&id)
}

// ═══════ Web Search ═══════

#[tauri::command]
async fn web_search_query(query: String) -> web_search::SearchResponse {
    let settings = web_search::load_settings();
    web_search::web_search(&query, &settings).await
}

#[tauri::command]
fn web_search_format(response: web_search::SearchResponse) -> String {
    web_search::format_search_for_prompt(&response)
}

#[tauri::command]
fn web_search_get_settings() -> web_search::WebSearchSettings {
    web_search::load_settings()
}

#[tauri::command]
fn web_search_save_settings(
    settings: web_search::WebSearchSettings,
) -> Result<(), String> {
    web_search::save_settings(&settings)
}

#[tauri::command]
fn web_search_list_cache() -> Vec<web_search::SearchResponse> {
    web_search::list_cached_searches()
}

#[tauri::command]
fn web_search_clear_cache() -> usize {
    web_search::clear_search_cache()
}

// ═══════ Approval ═══════

#[tauri::command]
fn classify_tool_risk(
    tool_name: String,
    input: serde_json::Value,
) -> (String, String) {
    let (risk, label) = approval_manager::classify_risk(&tool_name, &input);
    (format!("{:?}", risk), label)
}

// ═══════ Phase A — Second-Brain Evolution Commands ═══════

#[tauri::command]
fn brain_build_embeddings(project_path: Option<String>) -> usize {
    second_brain::build_embeddings(project_path.as_deref())
}

#[tauri::command]
fn brain_semantic_search(
    query: String,
    project_path: Option<String>,
    limit: Option<usize>,
) -> Vec<second_brain::SimilarityResult> {
    second_brain::semantic_search(&query, project_path.as_deref(), limit.unwrap_or(10))
}

#[tauri::command]
fn brain_query_decisions(
    query: String,
    project_path: Option<String>,
    limit: Option<usize>,
) -> Vec<second_brain::DecisionQueryResult> {
    second_brain::query_decisions(&query, project_path.as_deref(), limit.unwrap_or(5))
}

#[tauri::command]
fn brain_build_snapshot(
    project_path: Option<String>,
    layer: Option<String>,
    max_tokens: Option<usize>,
) -> second_brain::KnowledgeSnapshot {
    second_brain::build_knowledge_snapshot(
        project_path.as_deref(),
        layer.as_deref().unwrap_or("full"),
        max_tokens.unwrap_or(2000),
    )
}

#[tauri::command]
fn brain_list_snapshots(
    project_path: Option<String>,
) -> Vec<second_brain::KnowledgeSnapshot> {
    second_brain::list_snapshots(project_path.as_deref())
}

#[tauri::command]
fn brain_enhanced_stats() -> second_brain::EnhancedBrainStats {
    second_brain::get_enhanced_stats()
}

// ═══════ Phase B — Visual Intelligence Commands ═══════

#[tauri::command]
fn visual_build_memory_graph(
    project_path: Option<String>,
) -> visual_memory::Graph {
    visual_memory::build_memory_graph(project_path.as_deref())
}

#[tauri::command]
fn visual_build_lazy_graph(
    graph_type: String,
    project_path: Option<String>,
    root_node: Option<String>,
    max_depth: Option<usize>,
    max_nodes: Option<usize>,
) -> visual_memory::Graph {
    visual_memory::build_lazy_graph(
        &graph_type,
        project_path.as_deref(),
        root_node.as_deref(),
        max_depth.unwrap_or(3),
        max_nodes.unwrap_or(50),
    )
}

#[tauri::command]
fn visual_enhanced_stats(
    project_path: Option<String>,
) -> visual_memory::EnhancedVisualStats {
    visual_memory::get_enhanced_visual_stats(project_path.as_deref())
}

// ═══════ Phase C — Intelligent Orchestration Commands ═══════

#[tauri::command]
fn router_smart_route(
    prompt: String,
    needs_tools: Option<bool>,
    budget_remaining: Option<f64>,
) -> provider_router::TaskRouteRecommendation {
    provider_router::smart_route(&prompt, needs_tools.unwrap_or(false), budget_remaining)
}

#[tauri::command]
fn router_detect_task_type(prompt: String) -> String {
    provider_router::detect_task_type(&prompt).label().to_string()
}

#[tauri::command]
fn router_check_budget(
    estimated_tokens: usize,
    model_id: String,
) -> provider_router::BudgetCheck {
    provider_router::check_budget(estimated_tokens, &model_id)
}

#[tauri::command]
fn router_route_by_latency(
    needs_tools: Option<bool>,
    max_budget: Option<f64>,
) -> provider_router::RoutingDecision {
    provider_router::route_by_latency(needs_tools.unwrap_or(false), max_budget)
}

#[tauri::command]
fn router_workflow_routes() -> Vec<provider_router::WorkflowRoute> {
    provider_router::get_workflow_routes()
}

#[tauri::command]
fn router_enhanced_stats() -> provider_router::EnhancedRouterStats {
    provider_router::get_enhanced_router_stats()
}

// Phase D removed — multi_agent replaced by agent_loop

// ═══════ Phase E — Workspace Intelligence Commands ═══════

#[tauri::command]
fn workspace_build_map(project_path: String) -> repo_intelligence::RepoMap {
    repo_intelligence::build_repo_map(&project_path)
}

#[tauri::command]
fn workspace_predict_impact(
    project_path: String,
    target_file: String,
) -> repo_intelligence::ChangeImpact {
    repo_intelligence::predict_change_impact(&project_path, &target_file)
}

#[tauri::command]
fn workspace_detect_drift(project_path: String) -> repo_intelligence::DriftReport {
    repo_intelligence::detect_drift(&project_path)
}

#[tauri::command]
fn workspace_detect_patterns(
    project_path: String,
) -> Vec<repo_intelligence::WorkflowPattern> {
    repo_intelligence::detect_workflow_patterns(&project_path)
}

#[tauri::command]
fn workspace_intelligence(
    project_path: String,
) -> repo_intelligence::WorkspaceIntelligence {
    repo_intelligence::get_workspace_intelligence(&project_path)
}

// ═══════ Phase F — Predictive Workflows Commands ═══════

#[tauri::command]
fn predictive_suggestions(
    current_file: Option<String>,
    recent_prompt: Option<String>,
    project_path: Option<String>,
) -> Vec<predictive::PredictiveSuggestion> {
    predictive::generate_suggestions(
        current_file.as_deref(),
        recent_prompt.as_deref(),
        project_path.as_deref(),
    )
}

#[tauri::command]
fn predictive_smart_context(
    prompt: String,
    project_path: Option<String>,
    max_tokens: Option<usize>,
) -> predictive::SmartContext {
    predictive::assemble_smart_context(
        &prompt,
        project_path.as_deref(),
        max_tokens.unwrap_or(2000),
    )
}

#[tauri::command]
fn predictive_recommendations(
    prompt: String,
    project_path: Option<String>,
) -> Vec<predictive::WorkflowRecommendation> {
    predictive::recommend_workflows(&prompt, project_path.as_deref())
}

#[tauri::command]
fn predictive_analysis(
    prompt: String,
    current_file: Option<String>,
    project_path: Option<String>,
    max_context_tokens: Option<usize>,
) -> predictive::PredictiveAnalysis {
    predictive::get_predictive_analysis(
        &prompt,
        current_file.as_deref(),
        project_path.as_deref(),
        max_context_tokens.unwrap_or(2000),
    )
}

// ═══════ App Entry ═══════

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            // Load saved API keys into env vars before anything else
            api_keys::load_keys_into_env();

            let event_bus = Arc::new(event_bus::EventBus::new());
            let session = Arc::new(Mutex::new(session_manager::SessionManager::new()));

            app.manage(AppState {
                session,
                event_bus,
                api: Arc::new(Mutex::new(None)),
                cancel_token: Arc::new(Mutex::new(CancellationToken::new())),
            });

            // Build system tray
            use tauri::menu::{MenuBuilder, MenuItemBuilder};
            use tauri::tray::TrayIconBuilder;

            let show_item = MenuItemBuilder::with_id("show_hide", "Show/Hide").build(app)?;
            let new_item = MenuItemBuilder::with_id("new_session", "New Session").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app)?;

            let tray_menu = MenuBuilder::new(app)
                .item(&show_item)
                .item(&new_item)
                .separator()
                .item(&quit_item)
                .build()?;

            let tray_handle = app.handle().clone();
            TrayIconBuilder::new()
                .menu(&tray_menu)
                .tooltip("Ollopa")
                .on_menu_event(move |_app, event| {
                    match event.id().as_ref() {
                        "show_hide" => {
                            if let Some(window) = tray_handle.get_webview_window("main") {
                                if window.is_visible().unwrap_or(false) {
                                    let _ = window.hide();
                                } else {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                            }
                        }
                        "new_session" => {
                            let _ = tray_handle.emit(
                                "app-event",
                                ollopa_events::AppEvent::StatusUpdate {
                                    status: "new_session".to_string(),
                                    detail: String::new(),
                                },
                            );
                        }
                        "quit" => {
                            std::process::exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click { .. } = event {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Handle close event: minimize to tray instead of quitting
            let close_handle = app.handle().clone();
            if let Some(window) = app.get_webview_window("main") {
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        if let Some(w) = close_handle.get_webview_window("main") {
                            let _ = w.hide();
                        }
                    }
                });
            }

            // Register global shortcuts
            use tauri_plugin_global_shortcut::GlobalShortcutExt;
            let app_handle = app.handle().clone();

            // Ctrl+Shift+O: Toggle main window
            let toggle_handle = app_handle.clone();
            let _ = app.global_shortcut().on_shortcut("ctrl+shift+o", move |_app, _shortcut, _event| {
                if let Some(window) = toggle_handle.get_webview_window("main") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            });

            // Ctrl+Shift+K: Emit global search event
            let search_handle = app_handle.clone();
            let _ = app.global_shortcut().on_shortcut("ctrl+shift+k", move |_app, _shortcut, _event| {
                let _ = search_handle.emit(
                    "app-event",
                    ollopa_events::AppEvent::StatusUpdate {
                        status: "global_search".to_string(),
                        detail: String::new(),
                    },
                );
            });

            // Ctrl+Shift+N: Emit new session event
            let new_handle = app_handle.clone();
            let _ = app.global_shortcut().on_shortcut("ctrl+shift+n", move |_app, _shortcut, _event| {
                let _ = new_handle.emit(
                    "app-event",
                    ollopa_events::AppEvent::StatusUpdate {
                        status: "new_session".to_string(),
                        detail: String::new(),
                    },
                );
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_session,
            restart_session,
            stop_session,
            send_input,
            list_conversations,
            get_conversation_messages,
            resume_conversation,
            switch_project,
            list_sessions,
            delete_session_by_key,
            get_session_events,
            get_session_snapshot,
            get_recent_events,
            get_token_cost,
            get_memory_data,
            save_memory,
            get_full_memory,
            write_full_memory,
            get_project_tree,
            check_env_vars,
            classify_tool_risk,
            stop_generation,
            set_system_prompt,
            get_system_prompt,
            set_model,
            get_current_model,
            codebase_index,
            compact_now,
            set_smart_context,
            set_thinking_mode,
            edit_message,
            export_conversation,
            search_conversations,
            brain_search,
            brain_stats,
            brain_save_decision,
            brain_list_decisions,
            brain_delete_decision,
            brain_list_summaries,
            brain_delete_summary,
            brain_get_context,
            brain_index_note,
            visual_build_relationship_graph,
            visual_build_architecture_graph,
            visual_build_workflow_dag,
            visual_build_dependency_graph,
            visual_build_session_timeline,
            visual_save_graph,
            visual_list_graphs,
            visual_delete_graph,
            visual_get_stats,
            visual_list_sessions_for_timeline,
            optimizer_get_stats,
            optimizer_get_budget,
            optimizer_save_budget,
            optimizer_run,
            optimizer_build_context,
            optimizer_record_usage,
            optimizer_prune_cache,
            optimizer_list_rolling,
            optimizer_clear_data,
            optimizer_estimate_tokens,
            classify_prompt,
            agent_run_loop,
            agent_loop_status,
            // Phase 3 — Smart Context + Learning
            generate_repo_map,
            repo_map_text,
            select_files_for_task,
            search_skills,
            list_skills,
            estimate_agent_cost,
            router_list_providers,
            router_save_provider,
            router_delete_provider,
            router_get_config,
            router_save_config,
            router_route,
            router_stats,
            truncate_conversation,
            get_model_context_window,
            git_info,
            repo_analyze,
            switch_provider,
            transform_preview,
            transform_get_settings,
            transform_save_settings,
            transform_list_templates,
            transform_save_template,
            transform_delete_template,
            web_search_query,
            web_search_format,
            web_search_get_settings,
            web_search_save_settings,
            web_search_list_cache,
            web_search_clear_cache,
            list_api_keys,
            save_api_key,
            delete_api_key,
            // Phase A — Second-Brain Evolution
            brain_build_embeddings,
            brain_semantic_search,
            brain_query_decisions,
            brain_build_snapshot,
            brain_list_snapshots,
            brain_enhanced_stats,
            // Phase B — Visual Intelligence
            visual_build_memory_graph,
            visual_build_lazy_graph,
            visual_enhanced_stats,
            // Phase C — Intelligent Orchestration
            router_smart_route,
            router_detect_task_type,
            router_check_budget,
            router_route_by_latency,
            router_workflow_routes,
            router_enhanced_stats,

            // Phase E — Workspace Intelligence
            workspace_build_map,
            workspace_predict_impact,
            workspace_detect_drift,
            workspace_detect_patterns,
            workspace_intelligence,
            // Phase F — Predictive Workflows
            predictive_suggestions,
            predictive_smart_context,
            predictive_recommendations,
            predictive_analysis,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
