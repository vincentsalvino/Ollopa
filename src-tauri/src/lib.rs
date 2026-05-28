mod api_client;
mod api_keys;
mod approval_manager;
mod background_intelligence;
mod design_agent;
mod ollopa_events;
#[allow(dead_code)]
mod ollopa_process;
mod event_bus;
mod git_intelligence;
mod memory;
mod multi_agent;
mod prompt_transformer;
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

struct AppState {
    session: Arc<Mutex<session_manager::SessionManager>>,
    event_bus: Arc<event_bus::EventBus>,
}

// ═══════ Session Management ═══════

#[tauri::command]
async fn start_session(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
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
    let mut session = state.session.lock().await;
    state.event_bus.clear_history().await;
    session.restart(app_handle, None).await
}

#[tauri::command]
async fn stop_session(state: State<'_, AppState>) -> Result<(), String> {
    let mut session = state.session.lock().await;
    session.stop().await
}

#[tauri::command]
async fn send_input(
    message: String,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Check if design agent should activate for this message
    let design_active = design_agent::should_activate_for_message(&message);
    if design_active {
        let _ = app_handle.emit("app-event", ollopa_events::AppEvent::StatusUpdate {
            status: "design_agent_active".to_string(),
            detail: "Design Agent activated for frontend/UI task".to_string(),
        });
    }

    // Emit provider telemetry
    {
        let session = state.session.lock().await;
        let provider_info = if let Some(ref client) = session.api_client {
            let url = client.base_url();
            if url.contains("mimo.xiaomi.com") { "MiMo" } else if url.contains("deepseek.com") { "DeepSeek" } else { "Other" }
        } else { "None" };
        let _ = app_handle.emit("app-event", ollopa_events::AppEvent::StatusUpdate {
            status: "provider_active".to_string(),
            detail: format!("Provider: {} | Model: {}", provider_info, session.model),
        });
    }

    let mut session = state.session.lock().await;
    session.send_input(&message, app_handle).await
}



// ═══════ Conversation Persistence ═══════

#[tauri::command]
fn list_conversations() -> Vec<String> {
    api_client::DirectApiClient::list_saved_conversations()
}

#[tauri::command]
fn get_conversation_messages(session_id: String) -> Option<Vec<api_client::ChatMessage>> {
    api_client::DirectApiClient::load_messages(&session_id)
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

    // Start a fresh API client
    let working_dir = session.working_dir.clone();
    session.start(app_handle.clone(), working_dir, None).await?;

    // Override the session_id to the original so events append to the same snapshot
    session.session_id = Some(session_id.clone());

    // Resume the conversation history in the API client
    if let Some(ref mut client) = session.api_client {
        if !client.resume_session(&session_id) {
            // No saved conversation file, but we may still have snapshot events — that's ok
        }
    }

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
            tools: vec![],
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
    // Verify API key is available for direct API calls
    api_client::ApiConfig::from_env().map(|_| ())
}

// ═══════ Stop Generation ═══════

#[tauri::command]
async fn stop_generation(state: State<'_, AppState>) -> Result<(), String> {
    let session = state.session.lock().await;
    if let Some(ref client) = session.api_client {
        client.cancel_generation();
        Ok(())
    } else {
        Err("No active session".to_string())
    }
}

// ═══════ System Prompt ═══════

#[tauri::command]
async fn set_system_prompt(
    prompt: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut session = state.session.lock().await;
    if let Some(ref mut client) = session.api_client {
        client.set_system_prompt(&prompt);
        Ok(())
    } else {
        Err("No active session".to_string())
    }
}

#[tauri::command]
async fn get_system_prompt(
    state: State<'_, AppState>,
) -> Result<String, String> {
    let session = state.session.lock().await;
    if let Some(ref client) = session.api_client {
        Ok(client.system_prompt().to_string())
    } else {
        Ok("You are a helpful assistant. Always respond in English unless the user explicitly writes in another language.".to_string())
    }
}

// ═══════ Model Selector ═══════

#[tauri::command]
async fn set_model(
    model: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut session = state.session.lock().await;
    if let Some(ref mut client) = session.api_client {
        client.set_model(&model);
        session.model = model;
        Ok(())
    } else {
        Err("No active session".to_string())
    }
}

#[tauri::command]
async fn get_current_model(
    state: State<'_, AppState>,
) -> Result<String, String> {
    let session = state.session.lock().await;
    Ok(session.model.clone())
}

// ═══════ Message Editing ═══════

#[tauri::command]
async fn edit_message(
    index: usize,
    new_content: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let mut session = state.session.lock().await;
    if let Some(ref mut client) = session.api_client {
        Ok(client.edit_message_at(index, &new_content))
    } else {
        Err("No active session".to_string())
    }
}

// ═══════ Export Conversation ═══════

#[tauri::command]
async fn export_conversation(
    format: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let session = state.session.lock().await;
    if let Some(ref client) = session.api_client {
        let messages = client.get_messages();
        match format.as_str() {
            "json" => {
                serde_json::to_string_pretty(messages)
                    .map_err(|e| format!("JSON serialization failed: {}", e))
            }
            "markdown" => {
                let mut md = String::new();
                md.push_str("# Conversation Export\n\n");
                md.push_str(&format!("*Exported at: {}*\n\n---\n\n",
                    chrono_format_now()));
                for msg in messages {
                    match msg.role.as_str() {
                        "system" => {
                            md.push_str(&format!("## System\n\n{}\n\n---\n\n", msg.content));
                        }
                        "user" => {
                            md.push_str(&format!("## User\n\n{}\n\n---\n\n", msg.content));
                        }
                        "assistant" => {
                            md.push_str(&format!("## Assistant\n\n{}\n\n---\n\n", msg.content));
                        }
                        _ => {}
                    }
                }
                Ok(md)
            }
            _ => Err(format!("Unknown format: {}", format)),
        }
    } else {
        Err("No active session".to_string())
    }
}

fn chrono_format_now() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{}", now)
}

// ═══════ Search Conversations ═══════

#[tauri::command]
fn search_conversations(query: String) -> Vec<api_client::ConversationSearchResult> {
    api_client::DirectApiClient::search_conversations(&query)
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

// ═══════ Multi-Agent ═══════

#[tauri::command]
fn agent_list() -> Vec<multi_agent::AgentDef> {
    multi_agent::list_agents()
}

#[tauri::command]
fn agent_save(agent: multi_agent::AgentDef) -> Result<(), String> {
    multi_agent::save_agent(&agent)
}

#[tauri::command]
fn agent_delete(id: String) -> Result<(), String> {
    multi_agent::delete_agent(&id)
}

#[tauri::command]
fn agent_stats() -> multi_agent::AgentStats {
    multi_agent::get_agent_stats()
}

#[tauri::command]
fn agent_route_task(
    description: String,
    capabilities: Vec<String>,
) -> Option<multi_agent::AgentDef> {
    multi_agent::route_task(&description, &capabilities)
}

#[tauri::command]
fn agent_create_task(
    description: String,
    context: String,
    capabilities: Vec<String>,
    priority: multi_agent::TaskPriority,
) -> Result<multi_agent::AgentTask, String> {
    multi_agent::create_task(&description, &context, &capabilities, priority)
}

#[tauri::command]
fn agent_list_tasks(agent_id: Option<String>) -> Vec<multi_agent::AgentTask> {
    multi_agent::list_tasks(agent_id.as_deref())
}

#[tauri::command]
fn agent_complete_task(
    id: String,
    result: String,
    success: bool,
) -> Result<multi_agent::AgentTask, String> {
    multi_agent::complete_task(&id, &result, success)
}

#[tauri::command]
fn agent_create_workflow(
    name: String,
    description: String,
    template: String,
    project_path: Option<String>,
) -> Result<multi_agent::Workflow, String> {
    let steps = match template.as_str() {
        "code_review" => multi_agent::template_code_review(&description),
        "feature_dev" => multi_agent::template_feature_dev(&description),
        _ => return Err(format!("Unknown template: {}", template)),
    };
    multi_agent::create_workflow(&name, &description, steps, project_path.as_deref())
}

#[tauri::command]
fn agent_list_workflows(project_path: Option<String>) -> Vec<multi_agent::Workflow> {
    multi_agent::list_workflows(project_path.as_deref())
}

#[tauri::command]
fn agent_advance_workflow(
    id: String,
    step_id: String,
    output: String,
    success: bool,
) -> Result<multi_agent::Workflow, String> {
    multi_agent::advance_workflow(&id, &step_id, &output, success)
}

#[tauri::command]
fn agent_delete_workflow(id: String) -> Result<(), String> {
    multi_agent::delete_workflow(&id)
}

// ═══════ Autonomous Workflow Execution ═══════

#[tauri::command]
async fn agent_execute_workflow(
    id: String,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<multi_agent::Workflow, String> {
    let mut workflow = multi_agent::list_workflows(None)
        .into_iter()
        .find(|w| w.id == id)
        .ok_or_else(|| format!("Workflow '{}' not found", id))?;

    for i in 0..workflow.steps.len() {
        if workflow.steps[i].status != multi_agent::StepStatus::Pending {
            continue;
        }

        // Check dependencies
        let deps = workflow.steps[i].depends_on.clone();
        let deps_met = deps.iter().all(|dep_id| {
            workflow.steps.iter().any(|s| s.id == *dep_id && s.status == multi_agent::StepStatus::Completed)
        });
        if !deps_met {
            continue;
        }

        // Mark step as running
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        workflow.steps[i].status = multi_agent::StepStatus::Running;
        workflow.steps[i].started_at = Some(now);

        // Build the prompt from agent + step
        let prompt = format!(
            "You are performing the '{}' action.\nTask: {}\nContext: Workflow '{}' - {}",
            workflow.steps[i].action, workflow.steps[i].input, workflow.name, workflow.description
        );

        // Execute via API client
        let mut session = state.session.lock().await;
        let result = session.send_input(&prompt, app_handle.clone()).await;
        drop(session);

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        match result {
            Ok(()) => {
                workflow.steps[i].status = multi_agent::StepStatus::Completed;
                workflow.steps[i].output = Some("Step executed successfully".to_string());
            }
            Err(e) => {
                workflow.steps[i].status = multi_agent::StepStatus::Failed;
                workflow.steps[i].output = Some(format!("Step failed: {}", e));
                workflow.status = multi_agent::WorkflowStatus::Failed;
                let _ = multi_agent::save_workflow(&workflow);
                return Ok(workflow);
            }
        }
        workflow.steps[i].completed_at = Some(now);
    }

    // Check if all steps completed
    let all_done = workflow.steps.iter().all(|s| s.status == multi_agent::StepStatus::Completed);
    if all_done {
        workflow.status = multi_agent::WorkflowStatus::Completed;
    }

    let _ = multi_agent::save_workflow(&workflow);
    Ok(workflow)
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

// ═══════ Codebase Reading ═══════

#[tauri::command]
fn read_file(file_path: String) -> Result<String, String> {
    let path = std::path::Path::new(&file_path);
    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }
    if !path.is_file() {
        return Err(format!("Not a file: {}", file_path));
    }
    let metadata = std::fs::metadata(path).map_err(|e| format!("Cannot read metadata: {}", e))?;
    if metadata.len() > 2 * 1024 * 1024 {
        return Err("File too large (>2MB). Use search or partial read instead.".to_string());
    }
    std::fs::read_to_string(path).map_err(|e| format!("Failed to read file: {}", e))
}

#[derive(serde::Serialize)]
struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
}

#[tauri::command]
fn list_directory(dir_path: String) -> Result<Vec<DirEntry>, String> {
    let path = std::path::Path::new(&dir_path);
    if !path.exists() {
        return Err(format!("Directory not found: {}", dir_path));
    }
    if !path.is_dir() {
        return Err(format!("Not a directory: {}", dir_path));
    }
    let mut entries = Vec::new();
    let reader = std::fs::read_dir(path).map_err(|e| format!("Cannot read directory: {}", e))?;
    for entry in reader.flatten() {
        let meta = entry.metadata().unwrap_or_else(|_| std::fs::metadata(entry.path()).unwrap());
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name == "node_modules" || name == "target" || name == ".git" {
            continue;
        }
        entries.push(DirEntry {
            name,
            path: entry.path().to_string_lossy().to_string(),
            is_dir: meta.is_dir(),
            size: meta.len(),
        });
    }
    entries.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then_with(|| a.name.cmp(&b.name))
    });
    Ok(entries)
}

#[derive(serde::Serialize)]
struct SearchMatch {
    file: String,
    line_number: usize,
    line: String,
}

#[tauri::command]
fn search_files(
    project_path: String,
    query: String,
    file_extensions: Option<Vec<String>>,
) -> Result<Vec<SearchMatch>, String> {
    let root = std::path::Path::new(&project_path);
    if !root.exists() || !root.is_dir() {
        return Err(format!("Invalid project path: {}", project_path));
    }
    let query_lower = query.to_lowercase();
    let mut matches = Vec::new();
    let max_results = 200;

    fn walk_dir(
        dir: &std::path::Path,
        query: &str,
        exts: &Option<Vec<String>>,
        matches: &mut Vec<SearchMatch>,
        max: usize,
        depth: usize,
    ) {
        if depth > 10 || matches.len() >= max {
            return;
        }
        let Ok(reader) = std::fs::read_dir(dir) else { return };
        for entry in reader.flatten() {
            if matches.len() >= max { return; }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || name == "node_modules" || name == "target" || name == "dist" || name == "build" {
                continue;
            }
            let path = entry.path();
            if path.is_dir() {
                walk_dir(&path, query, exts, matches, max, depth + 1);
            } else if path.is_file() {
                if let Some(ref ext_list) = exts {
                    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
                    if !ext_list.iter().any(|e| e == ext) {
                        continue;
                    }
                }
                if let Ok(meta) = std::fs::metadata(&path) {
                    if meta.len() > 1024 * 1024 { continue; }
                }
                if let Ok(content) = std::fs::read_to_string(&path) {
                    for (i, line) in content.lines().enumerate() {
                        if matches.len() >= max { return; }
                        if line.to_lowercase().contains(query) {
                            matches.push(SearchMatch {
                                file: path.to_string_lossy().to_string(),
                                line_number: i + 1,
                                line: if line.len() > 300 { line[..300].to_string() } else { line.to_string() },
                            });
                        }
                    }
                }
            }
        }
    }

    walk_dir(root, &query_lower, &file_extensions, &mut matches, max_results, 0);
    Ok(matches)
}

#[derive(serde::Serialize)]
struct FileTreeNode {
    name: String,
    path: String,
    is_dir: bool,
    children: Vec<FileTreeNode>,
}

#[tauri::command]
fn get_file_tree(project_path: String, max_depth: Option<usize>) -> Result<FileTreeNode, String> {
    let root = std::path::Path::new(&project_path);
    if !root.exists() || !root.is_dir() {
        return Err(format!("Invalid project path: {}", project_path));
    }
    let max_d = max_depth.unwrap_or(4);

    fn build_tree(dir: &std::path::Path, depth: usize, max_depth: usize) -> Vec<FileTreeNode> {
        if depth >= max_depth { return Vec::new(); }
        let Ok(reader) = std::fs::read_dir(dir) else { return Vec::new() };
        let mut nodes: Vec<FileTreeNode> = Vec::new();
        for entry in reader.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || name == "node_modules" || name == "target" || name == "dist" {
                continue;
            }
            let path = entry.path();
            let is_dir = path.is_dir();
            let children = if is_dir { build_tree(&path, depth + 1, max_depth) } else { Vec::new() };
            nodes.push(FileTreeNode {
                name,
                path: path.to_string_lossy().to_string(),
                is_dir,
                children,
            });
        }
        nodes.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.cmp(&b.name)));
        nodes
    }

    let root_name = root.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| project_path.clone());
    let children = build_tree(root, 0, max_d);
    Ok(FileTreeNode {
        name: root_name,
        path: project_path,
        is_dir: true,
        children,
    })
}

// ═══════ Provider Switch (wires router to API client) ═══════

#[tauri::command]
async fn switch_provider(
    base_url: String,
    api_key_env: String,
    model: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut session = state.session.lock().await;
    match &mut session.api_client {
        Some(client) => client.switch_provider(&base_url, &api_key_env, &model),
        None => Err("No active session to switch provider on".to_string()),
    }
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
) -> prompt_transformer::TransformResult {
    let settings = prompt_transformer::load_settings();
    let context = prompt_transformer::TransformContext {
        model,
        project_path,
        recent_messages: vec![],
        detected_language: None,
    };
    prompt_transformer::transform_prompt(&raw, &context, &settings)
}

#[tauri::command]
fn transform_get_settings() -> prompt_transformer::TransformSettings {
    prompt_transformer::load_settings()
}

#[tauri::command]
fn transform_save_settings(
    settings: prompt_transformer::TransformSettings,
) -> Result<(), String> {
    prompt_transformer::save_settings(&settings)
}

#[tauri::command]
fn transform_list_templates() -> Vec<prompt_transformer::PromptTemplate> {
    prompt_transformer::list_templates()
}

#[tauri::command]
fn transform_save_template(
    template: prompt_transformer::PromptTemplate,
) -> Result<(), String> {
    prompt_transformer::save_template(&template)
}

#[tauri::command]
fn transform_delete_template(id: String) -> Result<(), String> {
    prompt_transformer::delete_template(&id)
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

// ═══════ Phase D — Multi-Agent Commands ═══════

#[tauri::command]
fn agent_create_delegation(
    agent_id: String,
    scope: String,
    context: String,
    parent_task_id: Option<String>,
    max_tokens: Option<usize>,
) -> Result<multi_agent::Delegation, String> {
    multi_agent::create_delegation(
        &agent_id,
        &scope,
        &context,
        parent_task_id.as_deref(),
        max_tokens.unwrap_or(2000),
    )
}

#[tauri::command]
fn agent_complete_delegation(
    id: String,
    summary: String,
    success: bool,
) -> Result<multi_agent::Delegation, String> {
    multi_agent::complete_delegation(&id, &summary, success)
}

#[tauri::command]
fn agent_list_delegations(
    parent_task_id: Option<String>,
) -> Vec<multi_agent::Delegation> {
    multi_agent::list_delegations(parent_task_id.as_deref())
}

#[tauri::command]
fn agent_get_memory(agent_id: String) -> multi_agent::AgentMemory {
    multi_agent::get_agent_memory(&agent_id)
}

#[tauri::command]
fn agent_add_context(
    agent_id: String,
    entry: String,
) -> Result<multi_agent::AgentMemory, String> {
    multi_agent::add_agent_context(&agent_id, &entry)
}

#[tauri::command]
fn agent_clear_memory(agent_id: String) -> Result<(), String> {
    multi_agent::clear_agent_memory(&agent_id)
}

#[tauri::command]
fn agent_summarize(task_id: String) -> Result<multi_agent::AgentSummary, String> {
    multi_agent::summarize_agent_execution(&task_id)
}

#[tauri::command]
fn agent_safety_config() -> multi_agent::SafetyConfig {
    multi_agent::load_safety_config()
}

#[tauri::command]
fn agent_save_safety_config(
    config: multi_agent::SafetyConfig,
) -> Result<(), String> {
    multi_agent::save_safety_config(&config)
}

#[tauri::command]
fn agent_check_safety(workflow_id: String) -> multi_agent::SafetyCheckResult {
    multi_agent::check_workflow_safety(&workflow_id)
}

#[tauri::command]
fn agent_enhanced_stats() -> multi_agent::EnhancedAgentStats {
    multi_agent::get_enhanced_agent_stats()
}

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

// ═══════ MiMo Provider + Inline Fallback ═══════

#[tauri::command]
fn router_inline_fallback(
    task_type: String,
    needs_tools: bool,
    trigger: Option<String>,
) -> provider_router::RoutingDecision {
    let fallback_trigger = trigger.and_then(|t| match t.as_str() {
        "rate_limit" => Some(provider_router::FallbackTrigger::RateLimit),
        "timeout" => Some(provider_router::FallbackTrigger::Timeout),
        "transient_error" => Some(provider_router::FallbackTrigger::TransientError),
        "quota_exhausted" => Some(provider_router::FallbackTrigger::QuotaExhausted),
        "degraded_latency" => Some(provider_router::FallbackTrigger::DegradedLatency),
        "partial_generation_failure" => Some(provider_router::FallbackTrigger::PartialGenerationFailure),
        _ => None,
    });
    provider_router::route_inline_fallback(&task_type, needs_tools, fallback_trigger)
}

#[tauri::command]
fn router_background_intelligence(task_type: String) -> provider_router::RoutingDecision {
    provider_router::route_background_intelligence(&task_type)
}

#[tauri::command]
fn router_design_focused(
    task_type: String,
    needs_tools: bool,
) -> provider_router::RoutingDecision {
    provider_router::route_design_focused(&task_type, needs_tools)
}

#[tauri::command]
fn router_mimo_suitable(task_type: String) -> bool {
    provider_router::is_mimo_suitable(&task_type)
}

#[tauri::command]
fn router_mimo_excluded(task_type: String) -> bool {
    provider_router::is_mimo_excluded(&task_type)
}

// ═══════ Background Intelligence ═══════

#[tauri::command]
fn bg_get_config() -> background_intelligence::BackgroundConfig {
    background_intelligence::load_config()
}

#[tauri::command]
fn bg_save_config(
    config: background_intelligence::BackgroundConfig,
) -> Result<(), String> {
    background_intelligence::save_config(&config)
}

#[tauri::command]
fn bg_create_task(
    task_type: String,
    input: String,
    priority: String,
    project_path: Option<String>,
) -> Result<background_intelligence::BackgroundTask, String> {
    let tt = match task_type.as_str() {
        "rolling_summary" => background_intelligence::BackgroundTaskType::RollingSummary,
        "repository_indexing" => background_intelligence::BackgroundTaskType::RepositoryIndexing,
        "architecture_tagging" => background_intelligence::BackgroundTaskType::ArchitectureTagging,
        "graph_metadata_generation" => background_intelligence::BackgroundTaskType::GraphMetadataGeneration,
        "semantic_labeling" => background_intelligence::BackgroundTaskType::SemanticLabeling,
        "retrieval_preparation" => background_intelligence::BackgroundTaskType::RetrievalPreparation,
        "duplicate_memory_detection" => background_intelligence::BackgroundTaskType::DuplicateMemoryDetection,
        "session_compression" => background_intelligence::BackgroundTaskType::SessionCompression,
        "visual_memory_tagging" => background_intelligence::BackgroundTaskType::VisualMemoryTagging,
        "design_memory_update" => background_intelligence::BackgroundTaskType::DesignMemoryUpdate,
        _ => return Err(format!("Unknown task type: {}", task_type)),
    };
    let p = match priority.as_str() {
        "low" => background_intelligence::TaskPriority::Low,
        "high" => background_intelligence::TaskPriority::High,
        _ => background_intelligence::TaskPriority::Normal,
    };
    background_intelligence::create_task(tt, &input, p, project_path.as_deref())
}

#[tauri::command]
fn bg_list_tasks(
    status: Option<String>,
) -> Vec<background_intelligence::BackgroundTask> {
    background_intelligence::list_tasks(status.as_deref())
}

#[tauri::command]
fn bg_complete_task(
    id: String,
    output: String,
    tokens: u64,
    cost: f64,
    provider: String,
    model: String,
    success: bool,
) -> Result<background_intelligence::BackgroundTask, String> {
    background_intelligence::complete_task(&id, &output, tokens, cost, &provider, &model, success)
}

#[tauri::command]
fn bg_delete_task(id: String) -> Result<(), String> {
    background_intelligence::delete_task(&id)
}

#[tauri::command]
fn bg_queue_next(
    project_path: Option<String>,
) -> Vec<background_intelligence::BackgroundTask> {
    background_intelligence::queue_next_tasks(project_path.as_deref())
}

#[tauri::command]
fn bg_create_batch(
    task_ids: Vec<String>,
) -> Result<background_intelligence::TaskBatch, String> {
    background_intelligence::create_batch(&task_ids)
}

#[tauri::command]
fn bg_list_batches() -> Vec<background_intelligence::TaskBatch> {
    background_intelligence::list_batches()
}

#[tauri::command]
fn bg_stats() -> background_intelligence::BackgroundStats {
    background_intelligence::get_background_stats()
}

// ═══════ Design Agent ═══════

#[tauri::command]
fn design_get_spec() -> design_agent::DesignAgentSpec {
    design_agent::load_spec()
}

#[tauri::command]
fn design_save_spec(
    spec: design_agent::DesignAgentSpec,
) -> Result<(), String> {
    design_agent::save_spec(&spec)
}

#[tauri::command]
fn design_should_activate(prompt: String) -> design_agent::DesignActivation {
    design_agent::should_activate(&prompt)
}

#[tauri::command]
fn design_save_memory(
    memory: design_agent::DesignMemory,
) -> Result<(), String> {
    design_agent::save_memory(&memory)
}

#[tauri::command]
fn design_list_memories(
    project_path: Option<String>,
) -> Vec<design_agent::DesignMemory> {
    design_agent::list_memories(project_path.as_deref())
}

#[tauri::command]
fn design_create_default_memory(
    project_path: Option<String>,
) -> design_agent::DesignMemory {
    design_agent::create_default_memory(project_path.as_deref())
}

#[tauri::command]
fn design_delete_memory(id: String) -> Result<(), String> {
    design_agent::delete_memory(&id)
}

#[tauri::command]
fn design_add_pattern(
    memory_id: String,
    name: String,
    component_type: String,
    description: String,
    css_properties: std::collections::HashMap<String, String>,
) -> Result<design_agent::DesignMemory, String> {
    design_agent::add_component_pattern(&memory_id, &name, &component_type, &description, css_properties)
}

#[tauri::command]
fn design_create_review(
    project_path: Option<String>,
) -> design_agent::DesignReview {
    design_agent::create_review(project_path.as_deref())
}

#[tauri::command]
fn design_list_reviews(
    project_path: Option<String>,
) -> Vec<design_agent::DesignReview> {
    design_agent::list_reviews(project_path.as_deref())
}

#[tauri::command]
fn design_list_events(
    project_path: Option<String>,
    limit: Option<usize>,
) -> Vec<design_agent::DesignEvent> {
    design_agent::list_events(project_path.as_deref(), limit.unwrap_or(50))
}

#[tauri::command]
fn design_stats() -> design_agent::DesignAgentStats {
    design_agent::get_design_stats()
}

// ═══════ App Entry ═══════

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Load saved API keys into env vars before anything else
            api_keys::load_keys_into_env();

            let event_bus = Arc::new(event_bus::EventBus::new());
            let session = Arc::new(Mutex::new(session_manager::SessionManager::new()));

            app.manage(AppState {
                session,
                event_bus,
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
            agent_list,
            agent_save,
            agent_delete,
            agent_stats,
            agent_route_task,
            agent_create_task,
            agent_list_tasks,
            agent_complete_task,
            agent_create_workflow,
            agent_list_workflows,
            agent_advance_workflow,
            agent_delete_workflow,
            agent_execute_workflow,
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
            // Codebase Reading
            read_file,
            list_directory,
            search_files,
            get_file_tree,
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
            // Phase D — Multi-Agent Systems
            agent_create_delegation,
            agent_complete_delegation,
            agent_list_delegations,
            agent_get_memory,
            agent_add_context,
            agent_clear_memory,
            agent_summarize,
            agent_safety_config,
            agent_save_safety_config,
            agent_check_safety,
            agent_enhanced_stats,
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
            // Phase G — MiMo Provider + Inline Fallback
            router_inline_fallback,
            router_background_intelligence,
            router_design_focused,
            router_mimo_suitable,
            router_mimo_excluded,
            // Phase G — Background Intelligence
            bg_get_config,
            bg_save_config,
            bg_create_task,
            bg_list_tasks,
            bg_complete_task,
            bg_delete_task,
            bg_queue_next,
            bg_create_batch,
            bg_list_batches,
            bg_stats,
            // Phase G — Design Agent
            design_get_spec,
            design_save_spec,
            design_should_activate,
            design_save_memory,
            design_list_memories,
            design_create_default_memory,
            design_delete_memory,
            design_add_pattern,
            design_create_review,
            design_list_reviews,
            design_list_events,
            design_stats,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
