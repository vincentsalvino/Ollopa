mod api_client;
mod approval_manager;
mod claude_events;
#[allow(dead_code)]
mod claude_process;
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
        claude_events::AppEvent::SessionStarted {
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
        claude_md: memory::read_claude_md(),
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

// ═══════ App Entry ═══════

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
