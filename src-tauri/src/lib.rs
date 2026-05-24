mod approval_manager;
mod claude_events;
mod claude_process;
mod event_bus;
mod memory;
mod multi_agent;
mod provider_router;
mod second_brain;
mod session_manager;
mod token_optimizer;
mod visual_memory;

use std::sync::Arc;
use tauri::{Manager, State};
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
async fn send_input(message: String, state: State<'_, AppState>) -> Result<(), String> {
    let session = state.session.lock().await;
    session.send_input(&message).await
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
    // With stream-json architecture, Claude CLI handles its own auth.
    // We just verify the CLI is available.
    match std::process::Command::new("claude")
        .arg("--version")
        .output()
    {
        Ok(output) if output.status.success() => Ok(()),
        Ok(output) => Err(format!(
            "claude CLI returned error: {}",
            String::from_utf8_lossy(&output.stderr)
        )),
        Err(e) => Err(format!(
            "claude CLI not found. Install Claude Code first. Error: {}",
            e
        )),
    }
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
            router_list_providers,
            router_save_provider,
            router_delete_provider,
            router_get_config,
            router_save_config,
            router_route,
            router_stats,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
