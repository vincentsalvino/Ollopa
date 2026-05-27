use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

// ═══════ Data Structures ═══════

/// An agent definition — a specialized role with capabilities
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentDef {
    pub id: String,
    pub name: String,
    pub role: String,
    pub description: String,
    pub capabilities: Vec<String>,
    pub system_prompt: String,
    pub model_preference: Option<String>,
    pub max_tokens: usize,
    pub created_at: u64,
    pub is_builtin: bool,
}

/// A workflow step — a unit of work assigned to an agent
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowStep {
    pub id: String,
    pub agent_id: String,
    pub action: String,
    pub input: String,
    pub output: Option<String>,
    pub status: StepStatus,
    pub started_at: Option<u64>,
    pub completed_at: Option<u64>,
    pub depends_on: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum StepStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Skipped,
}

/// A workflow definition — a sequence of steps across agents
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workflow {
    pub id: String,
    pub name: String,
    pub description: String,
    pub steps: Vec<WorkflowStep>,
    pub status: WorkflowStatus,
    pub created_at: u64,
    pub updated_at: u64,
    pub project_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum WorkflowStatus {
    Draft,
    Running,
    Completed,
    Failed,
    Paused,
}

/// A task routed to a specific agent
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentTask {
    pub id: String,
    pub agent_id: String,
    pub description: String,
    pub context: String,
    pub priority: TaskPriority,
    pub status: StepStatus,
    pub result: Option<String>,
    pub created_at: u64,
    pub completed_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TaskPriority {
    Low,
    Normal,
    High,
    Critical,
}

/// Statistics about the multi-agent system
#[derive(Debug, Clone, Serialize)]
pub struct AgentStats {
    pub total_agents: usize,
    pub builtin_agents: usize,
    pub custom_agents: usize,
    pub total_workflows: usize,
    pub active_workflows: usize,
    pub total_tasks: usize,
    pub completed_tasks: usize,
}

// ═══════ Storage ═══════

fn agent_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/home/ubuntu"))
        .join(".ollopa")
        .join("workspace-brain")
        .join("agents")
}

fn workflows_dir() -> PathBuf {
    agent_dir().join("workflows")
}

fn tasks_dir() -> PathBuf {
    agent_dir().join("tasks")
}

fn agents_file() -> PathBuf {
    agent_dir().join("registry.json")
}

fn ensure_dirs() {
    let _ = fs::create_dir_all(workflows_dir());
    let _ = fs::create_dir_all(tasks_dir());
}

fn current_timestamp_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// ═══════ Built-in Agents ═══════

fn builtin_agents() -> Vec<AgentDef> {
    vec![
        AgentDef {
            id: "agent-coder".to_string(),
            name: "Coder".to_string(),
            role: "code_generation".to_string(),
            description: "Writes and refactors code based on specifications".to_string(),
            capabilities: vec![
                "code_generation".to_string(),
                "refactoring".to_string(),
                "bug_fixing".to_string(),
                "code_review".to_string(),
            ],
            system_prompt: "You are a skilled software engineer. Write clean, efficient, well-documented code.".to_string(),
            model_preference: None,
            max_tokens: 4000,
            created_at: 0,
            is_builtin: true,
        },
        AgentDef {
            id: "agent-reviewer".to_string(),
            name: "Reviewer".to_string(),
            role: "code_review".to_string(),
            description: "Reviews code for quality, bugs, and best practices".to_string(),
            capabilities: vec![
                "code_review".to_string(),
                "security_audit".to_string(),
                "performance_review".to_string(),
            ],
            system_prompt: "You are a thorough code reviewer. Identify bugs, security issues, and suggest improvements.".to_string(),
            model_preference: None,
            max_tokens: 3000,
            created_at: 0,
            is_builtin: true,
        },
        AgentDef {
            id: "agent-architect".to_string(),
            name: "Architect".to_string(),
            role: "architecture".to_string(),
            description: "Designs system architecture and makes technical decisions".to_string(),
            capabilities: vec![
                "architecture_design".to_string(),
                "system_design".to_string(),
                "decision_making".to_string(),
                "documentation".to_string(),
            ],
            system_prompt: "You are a software architect. Design scalable, maintainable systems.".to_string(),
            model_preference: None,
            max_tokens: 3000,
            created_at: 0,
            is_builtin: true,
        },
        AgentDef {
            id: "agent-tester".to_string(),
            name: "Tester".to_string(),
            role: "testing".to_string(),
            description: "Writes tests and validates code correctness".to_string(),
            capabilities: vec![
                "unit_testing".to_string(),
                "integration_testing".to_string(),
                "test_planning".to_string(),
            ],
            system_prompt: "You are a QA engineer. Write thorough tests that cover edge cases.".to_string(),
            model_preference: None,
            max_tokens: 3000,
            created_at: 0,
            is_builtin: true,
        },
        AgentDef {
            id: "agent-documenter".to_string(),
            name: "Documenter".to_string(),
            role: "documentation".to_string(),
            description: "Writes documentation, READMEs, and inline comments".to_string(),
            capabilities: vec![
                "documentation".to_string(),
                "readme_generation".to_string(),
                "api_docs".to_string(),
            ],
            system_prompt: "You are a technical writer. Write clear, comprehensive documentation.".to_string(),
            model_preference: None,
            max_tokens: 2000,
            created_at: 0,
            is_builtin: true,
        },
        AgentDef {
            id: "agent-hermes-reasoner".to_string(),
            name: "Hermes Reasoner".to_string(),
            role: "reasoning".to_string(),
            description: "Deep reasoning and chain-of-thought analysis using Hermes 3".to_string(),
            capabilities: vec![
                "reasoning".to_string(),
                "chain_of_thought".to_string(),
                "problem_decomposition".to_string(),
                "logic_analysis".to_string(),
                "decision_making".to_string(),
            ],
            system_prompt: "You are an advanced reasoning agent powered by Hermes 3. Break down complex problems step-by-step. Use chain-of-thought reasoning. Show your work clearly and arrive at well-justified conclusions.".to_string(),
            model_preference: Some("nousresearch/hermes-3-llama-3.1-405b".to_string()),
            max_tokens: 8000,
            created_at: 0,
            is_builtin: true,
        },
        AgentDef {
            id: "agent-openclaw-coder".to_string(),
            name: "OpenClaw Coder".to_string(),
            role: "fast_coding".to_string(),
            description: "Fast code generation and completion using OpenChat/OpenClaw".to_string(),
            capabilities: vec![
                "code_generation".to_string(),
                "code_completion".to_string(),
                "function_generation".to_string(),
                "quick_prototyping".to_string(),
            ],
            system_prompt: "You are a fast, efficient code generator. Produce clean, working code quickly. Focus on correctness and readability. Prefer concise implementations.".to_string(),
            model_preference: Some("openchat/openchat-3.6-8b".to_string()),
            max_tokens: 4000,
            created_at: 0,
            is_builtin: true,
        },
        AgentDef {
            id: "agent-hermes-analyst".to_string(),
            name: "Hermes Analyst".to_string(),
            role: "data_analysis".to_string(),
            description: "Data analysis, summarization, and research using Hermes 3".to_string(),
            capabilities: vec![
                "data_analysis".to_string(),
                "summarization".to_string(),
                "research".to_string(),
                "comparison".to_string(),
                "report_generation".to_string(),
            ],
            system_prompt: "You are an analytical agent powered by Hermes 3. Provide thorough data analysis, clear summaries, and well-researched insights. Use structured formats with headings, tables, and bullet points.".to_string(),
            model_preference: Some("nousresearch/hermes-3-llama-3.1-70b".to_string()),
            max_tokens: 6000,
            created_at: 0,
            is_builtin: true,
        },
    ]
}

// ═══════ Agent Registry ═══════

/// Load all agents (builtin + custom)
pub fn list_agents() -> Vec<AgentDef> {
    let mut agents = builtin_agents();

    // Load custom agents
    if let Ok(content) = fs::read_to_string(agents_file()) {
        if let Ok(custom) = serde_json::from_str::<Vec<AgentDef>>(&content) {
            agents.extend(custom);
        }
    }

    agents
}

/// Save a custom agent
pub fn save_agent(agent: &AgentDef) -> Result<(), String> {
    ensure_dirs();
    let mut customs = load_custom_agents();
    customs.retain(|a| a.id != agent.id);
    customs.push(agent.clone());
    save_custom_agents(&customs)
}

/// Delete a custom agent
pub fn delete_agent(id: &str) -> Result<(), String> {
    let mut customs = load_custom_agents();
    let len_before = customs.len();
    customs.retain(|a| a.id != id);
    if customs.len() == len_before {
        return Err("Agent not found or is a built-in agent".to_string());
    }
    save_custom_agents(&customs)
}

fn load_custom_agents() -> Vec<AgentDef> {
    fs::read_to_string(agents_file())
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_default()
}

fn save_custom_agents(agents: &[AgentDef]) -> Result<(), String> {
    ensure_dirs();
    let json = serde_json::to_string_pretty(agents)
        .map_err(|e| format!("Failed to serialize agents: {}", e))?;
    fs::write(agents_file(), json)
        .map_err(|e| format!("Failed to write agents: {}", e))
}

/// Route a task to the best matching agent based on capabilities
pub fn route_task(description: &str, capabilities_needed: &[String]) -> Option<AgentDef> {
    let agents = list_agents();
    let desc_lower = description.to_lowercase();

    let mut scored: Vec<(usize, &AgentDef)> = agents
        .iter()
        .map(|agent| {
            let mut score = 0;

            // Score by capability match
            for cap in capabilities_needed {
                if agent.capabilities.contains(cap) {
                    score += 10;
                }
            }

            // Score by keyword match in description
            for cap in &agent.capabilities {
                if desc_lower.contains(&cap.replace('_', " ")) {
                    score += 3;
                }
            }

            // Boost if role matches
            if capabilities_needed.iter().any(|c| c == &agent.role) {
                score += 15;
            }

            (score, agent)
        })
        .collect();

    scored.sort_by(|a, b| b.0.cmp(&a.0));
    scored.into_iter().next().filter(|(s, _)| *s > 0).map(|(_, a)| a.clone())
}

// ═══════ Workflow Management ═══════

/// Create a new workflow
pub fn create_workflow(
    name: &str,
    description: &str,
    steps: Vec<WorkflowStep>,
    project_path: Option<&str>,
) -> Result<Workflow, String> {
    ensure_dirs();
    let now = current_timestamp_ms();
    let workflow = Workflow {
        id: format!("wf-{}", now),
        name: name.to_string(),
        description: description.to_string(),
        steps,
        status: WorkflowStatus::Draft,
        created_at: now,
        updated_at: now,
        project_path: project_path.map(|s| s.to_string()),
    };

    let json = serde_json::to_string_pretty(&workflow)
        .map_err(|e| format!("Failed to serialize workflow: {}", e))?;
    let path = workflows_dir().join(format!("{}.json", workflow.id));
    fs::write(&path, json)
        .map_err(|e| format!("Failed to save workflow: {}", e))?;

    Ok(workflow)
}

/// Save/update an existing workflow
pub fn save_workflow(workflow: &Workflow) -> Result<(), String> {
    ensure_dirs();
    let json = serde_json::to_string_pretty(workflow)
        .map_err(|e| format!("Failed to serialize workflow: {}", e))?;
    let path = workflows_dir().join(format!("{}.json", workflow.id));
    fs::write(&path, json).map_err(|e| format!("Failed to save workflow: {}", e))
}

/// List all workflows
pub fn list_workflows(project_path: Option<&str>) -> Vec<Workflow> {
    let mut results: Vec<Workflow> = Vec::new();

    if let Ok(entries) = fs::read_dir(workflows_dir()) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |e| e == "json") {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(wf) = serde_json::from_str::<Workflow>(&content) {
                        if let Some(pp) = project_path {
                            if wf.project_path.as_deref() == Some(pp) {
                                results.push(wf);
                            }
                        } else {
                            results.push(wf);
                        }
                    }
                }
            }
        }
    }

    results.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    results
}

/// Get a specific workflow
pub fn get_workflow(id: &str) -> Result<Workflow, String> {
    let path = workflows_dir().join(format!("{}.json", id));
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read workflow: {}", e))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse workflow: {}", e))
}

/// Advance a workflow — mark current step complete and move to next
pub fn advance_workflow(id: &str, step_id: &str, output: &str, success: bool) -> Result<Workflow, String> {
    let mut wf = get_workflow(id)?;
    let now = current_timestamp_ms();

    // Update the completed step
    for step in &mut wf.steps {
        if step.id == step_id {
            step.output = Some(output.to_string());
            step.status = if success { StepStatus::Completed } else { StepStatus::Failed };
            step.completed_at = Some(now);
        }
    }

    // Start next pending step if dependencies are met
    for i in 0..wf.steps.len() {
        if wf.steps[i].status == StepStatus::Pending {
            let deps_met = wf.steps[i].depends_on.iter().all(|dep_id| {
                wf.steps.iter().any(|s| s.id == *dep_id && s.status == StepStatus::Completed)
            });
            if deps_met {
                wf.steps[i].status = StepStatus::Running;
                wf.steps[i].started_at = Some(now);
                break;
            }
        }
    }

    // Update workflow status
    let all_done = wf.steps.iter().all(|s| {
        s.status == StepStatus::Completed || s.status == StepStatus::Skipped
    });
    let any_failed = wf.steps.iter().any(|s| s.status == StepStatus::Failed);

    if all_done {
        wf.status = WorkflowStatus::Completed;
    } else if any_failed {
        wf.status = WorkflowStatus::Failed;
    } else {
        wf.status = WorkflowStatus::Running;
    }

    wf.updated_at = now;

    // Save
    let json = serde_json::to_string_pretty(&wf)
        .map_err(|e| format!("Failed to serialize workflow: {}", e))?;
    let path = workflows_dir().join(format!("{}.json", wf.id));
    fs::write(&path, json).map_err(|e| format!("Failed to save workflow: {}", e))?;

    Ok(wf)
}

/// Delete a workflow
pub fn delete_workflow(id: &str) -> Result<(), String> {
    let path = workflows_dir().join(format!("{}.json", id));
    fs::remove_file(&path).map_err(|e| format!("Failed to delete workflow: {}", e))
}

// ═══════ Task Management ═══════

/// Create and route a task
pub fn create_task(
    description: &str,
    context: &str,
    capabilities: &[String],
    priority: TaskPriority,
) -> Result<AgentTask, String> {
    ensure_dirs();
    let agent = route_task(description, capabilities)
        .ok_or_else(|| "No suitable agent found for task".to_string())?;

    let now = current_timestamp_ms();
    let task = AgentTask {
        id: format!("task-{}", now),
        agent_id: agent.id,
        description: description.to_string(),
        context: context.to_string(),
        priority,
        status: StepStatus::Pending,
        result: None,
        created_at: now,
        completed_at: None,
    };

    let json = serde_json::to_string_pretty(&task)
        .map_err(|e| format!("Failed to serialize task: {}", e))?;
    let path = tasks_dir().join(format!("{}.json", task.id));
    fs::write(&path, json).map_err(|e| format!("Failed to save task: {}", e))?;

    Ok(task)
}

/// List tasks (optionally filtered by agent)
pub fn list_tasks(agent_id: Option<&str>) -> Vec<AgentTask> {
    let mut results: Vec<AgentTask> = Vec::new();

    if let Ok(entries) = fs::read_dir(tasks_dir()) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |e| e == "json") {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(task) = serde_json::from_str::<AgentTask>(&content) {
                        if let Some(aid) = agent_id {
                            if task.agent_id == aid {
                                results.push(task);
                            }
                        } else {
                            results.push(task);
                        }
                    }
                }
            }
        }
    }

    results.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    results
}

/// Complete a task with result
pub fn complete_task(id: &str, result: &str, success: bool) -> Result<AgentTask, String> {
    let path = tasks_dir().join(format!("{}.json", id));
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read task: {}", e))?;
    let mut task: AgentTask = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse task: {}", e))?;

    task.result = Some(result.to_string());
    task.status = if success { StepStatus::Completed } else { StepStatus::Failed };
    task.completed_at = Some(current_timestamp_ms());

    let json = serde_json::to_string_pretty(&task)
        .map_err(|e| format!("Failed to serialize task: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("Failed to save task: {}", e))?;

    Ok(task)
}

/// Delete a task
#[allow(dead_code)]
pub fn delete_task(id: &str) -> Result<(), String> {
    let path = tasks_dir().join(format!("{}.json", id));
    fs::remove_file(&path).map_err(|e| format!("Failed to delete task: {}", e))
}

// ═══════ Workflow Templates ═══════

/// Generate a code review workflow template
pub fn template_code_review(description: &str) -> Vec<WorkflowStep> {
    let now = current_timestamp_ms();
    vec![
        WorkflowStep {
            id: format!("step-{}-1", now),
            agent_id: "agent-coder".to_string(),
            action: "implement".to_string(),
            input: description.to_string(),
            output: None,
            status: StepStatus::Pending,
            started_at: None,
            completed_at: None,
            depends_on: vec![],
        },
        WorkflowStep {
            id: format!("step-{}-2", now),
            agent_id: "agent-reviewer".to_string(),
            action: "review".to_string(),
            input: "Review the implementation for bugs, style, and best practices".to_string(),
            output: None,
            status: StepStatus::Pending,
            started_at: None,
            completed_at: None,
            depends_on: vec![format!("step-{}-1", now)],
        },
        WorkflowStep {
            id: format!("step-{}-3", now),
            agent_id: "agent-tester".to_string(),
            action: "test".to_string(),
            input: "Write tests for the implementation".to_string(),
            output: None,
            status: StepStatus::Pending,
            started_at: None,
            completed_at: None,
            depends_on: vec![format!("step-{}-1", now)],
        },
    ]
}

/// Generate a feature development workflow template
pub fn template_feature_dev(description: &str) -> Vec<WorkflowStep> {
    let now = current_timestamp_ms();
    vec![
        WorkflowStep {
            id: format!("step-{}-1", now),
            agent_id: "agent-architect".to_string(),
            action: "design".to_string(),
            input: format!("Design the architecture for: {}", description),
            output: None,
            status: StepStatus::Pending,
            started_at: None,
            completed_at: None,
            depends_on: vec![],
        },
        WorkflowStep {
            id: format!("step-{}-2", now),
            agent_id: "agent-coder".to_string(),
            action: "implement".to_string(),
            input: "Implement the feature based on the architecture design".to_string(),
            output: None,
            status: StepStatus::Pending,
            started_at: None,
            completed_at: None,
            depends_on: vec![format!("step-{}-1", now)],
        },
        WorkflowStep {
            id: format!("step-{}-3", now),
            agent_id: "agent-tester".to_string(),
            action: "test".to_string(),
            input: "Write comprehensive tests".to_string(),
            output: None,
            status: StepStatus::Pending,
            started_at: None,
            completed_at: None,
            depends_on: vec![format!("step-{}-2", now)],
        },
        WorkflowStep {
            id: format!("step-{}-4", now),
            agent_id: "agent-reviewer".to_string(),
            action: "review".to_string(),
            input: "Review the complete feature implementation".to_string(),
            output: None,
            status: StepStatus::Pending,
            started_at: None,
            completed_at: None,
            depends_on: vec![format!("step-{}-2", now), format!("step-{}-3", now)],
        },
        WorkflowStep {
            id: format!("step-{}-5", now),
            agent_id: "agent-documenter".to_string(),
            action: "document".to_string(),
            input: "Write documentation for the new feature".to_string(),
            output: None,
            status: StepStatus::Pending,
            started_at: None,
            completed_at: None,
            depends_on: vec![format!("step-{}-4", now)],
        },
    ]
}

// ═══════ Stats ═══════

/// Get multi-agent system statistics
pub fn get_agent_stats() -> AgentStats {
    let agents = list_agents();
    let workflows = list_workflows(None);
    let tasks = list_tasks(None);

    AgentStats {
        total_agents: agents.len(),
        builtin_agents: agents.iter().filter(|a| a.is_builtin).count(),
        custom_agents: agents.iter().filter(|a| !a.is_builtin).count(),
        total_workflows: workflows.len(),
        active_workflows: workflows.iter().filter(|w| w.status == WorkflowStatus::Running).count(),
        total_tasks: tasks.len(),
        completed_tasks: tasks.iter().filter(|t| t.status == StepStatus::Completed).count(),
    }
}

// ═══════════════════════════════════════════════════════════════
// UPGRADE PHASE D — Lightweight Multi-Agent Systems
// Scoped delegation, agent memory isolation, agent summarization,
// safety rules (recursion limits, budget ceilings, inactivity)
// ═══════════════════════════════════════════════════════════════

/// A scoped delegation — bounded subtask for an agent
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Delegation {
    pub id: String,
    pub parent_task_id: Option<String>,
    pub agent_id: String,
    pub scope: String,
    pub context: String,
    pub max_tokens: usize,
    pub max_retries: u32,
    pub timeout_ms: u64,
    pub status: StepStatus,
    pub result_summary: Option<String>,
    pub created_at: u64,
    pub completed_at: Option<u64>,
    pub depth: u32,
}

/// Agent memory context — isolated per-agent context
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentMemory {
    pub agent_id: String,
    pub context_entries: Vec<String>,
    pub total_tokens: usize,
    pub max_tokens: usize,
    pub created_at: u64,
    pub updated_at: u64,
}

/// Agent execution summary
#[derive(Debug, Clone, Serialize)]
pub struct AgentSummary {
    pub agent_id: String,
    pub agent_name: String,
    pub task_description: String,
    pub findings: Vec<String>,
    pub recommendations: Vec<String>,
    pub files_affected: Vec<String>,
    pub token_usage: usize,
    pub duration_ms: u64,
    pub success: bool,
}

/// Safety configuration for multi-agent execution
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SafetyConfig {
    pub max_recursion_depth: u32,
    pub max_retries_per_step: u32,
    pub max_budget_usd: f64,
    pub inactivity_timeout_ms: u64,
    pub max_concurrent_agents: u32,
    pub max_delegations_per_task: u32,
}

impl Default for SafetyConfig {
    fn default() -> Self {
        Self {
            max_recursion_depth: 3,
            max_retries_per_step: 2,
            max_budget_usd: 1.0,
            inactivity_timeout_ms: 120_000,
            max_concurrent_agents: 3,
            max_delegations_per_task: 5,
        }
    }
}

/// Safety check result
#[derive(Debug, Clone, Serialize)]
pub struct SafetyCheckResult {
    pub safe: bool,
    pub violations: Vec<String>,
    pub warnings: Vec<String>,
}

fn delegations_dir() -> PathBuf {
    agent_dir().join("delegations")
}

fn agent_memory_dir() -> PathBuf {
    agent_dir().join("memory")
}

fn safety_config_path() -> PathBuf {
    agent_dir().join("safety.json")
}

fn ensure_phase_d_dirs() {
    let _ = fs::create_dir_all(delegations_dir());
    let _ = fs::create_dir_all(agent_memory_dir());
}

/// Create a scoped delegation
pub fn create_delegation(
    agent_id: &str,
    scope: &str,
    context: &str,
    parent_task_id: Option<&str>,
    max_tokens: usize,
) -> Result<Delegation, String> {
    ensure_phase_d_dirs();
    let safety = load_safety_config();

    // Check delegation limits
    if let Some(parent_id) = parent_task_id {
        let existing = list_delegations(Some(parent_id));
        if existing.len() >= safety.max_delegations_per_task as usize {
            return Err(format!(
                "Max delegations ({}) reached for task {}",
                safety.max_delegations_per_task, parent_id
            ));
        }

        // Check recursion depth
        let depth = compute_delegation_depth(parent_id);
        if depth >= safety.max_recursion_depth {
            return Err(format!(
                "Max recursion depth ({}) exceeded",
                safety.max_recursion_depth
            ));
        }
    }

    let now = current_timestamp_ms();
    let delegation = Delegation {
        id: format!("del-{}", now),
        parent_task_id: parent_task_id.map(|s| s.to_string()),
        agent_id: agent_id.to_string(),
        scope: scope.to_string(),
        context: context.to_string(),
        max_tokens,
        max_retries: safety.max_retries_per_step,
        timeout_ms: safety.inactivity_timeout_ms,
        status: StepStatus::Pending,
        result_summary: None,
        created_at: now,
        completed_at: None,
        depth: parent_task_id.map_or(0, |pid| compute_delegation_depth(pid) + 1),
    };

    let json = serde_json::to_string_pretty(&delegation)
        .map_err(|e| format!("Failed to serialize delegation: {}", e))?;
    let path = delegations_dir().join(format!("{}.json", delegation.id));
    fs::write(&path, json).map_err(|e| format!("Failed to save delegation: {}", e))?;

    Ok(delegation)
}

/// Complete a delegation with summary
pub fn complete_delegation(
    id: &str,
    summary: &str,
    success: bool,
) -> Result<Delegation, String> {
    let path = delegations_dir().join(format!("{}.json", id));
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Delegation not found: {}", e))?;
    let mut delegation: Delegation = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse delegation: {}", e))?;

    delegation.status = if success { StepStatus::Completed } else { StepStatus::Failed };
    delegation.result_summary = Some(summary.to_string());
    delegation.completed_at = Some(current_timestamp_ms());

    let json = serde_json::to_string_pretty(&delegation)
        .map_err(|e| format!("Failed to serialize: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("Failed to save: {}", e))?;

    Ok(delegation)
}

/// List delegations for a parent task
pub fn list_delegations(parent_task_id: Option<&str>) -> Vec<Delegation> {
    ensure_phase_d_dirs();
    let mut results: Vec<Delegation> = fs::read_dir(delegations_dir())
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let content = fs::read_to_string(e.path()).ok()?;
            serde_json::from_str(&content).ok()
        })
        .collect();

    if let Some(pid) = parent_task_id {
        results.retain(|d| d.parent_task_id.as_deref() == Some(pid));
    }

    results.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    results
}

fn compute_delegation_depth(task_id: &str) -> u32 {
    let delegations = list_delegations(None);
    let mut depth = 0u32;
    let mut current = task_id.to_string();

    for _ in 0..10 {
        if let Some(del) = delegations.iter().find(|d| d.id == current) {
            if let Some(ref parent) = del.parent_task_id {
                depth += 1;
                current = parent.clone();
            } else {
                break;
            }
        } else {
            break;
        }
    }

    depth
}

/// Get or create isolated agent memory
pub fn get_agent_memory(agent_id: &str) -> AgentMemory {
    ensure_phase_d_dirs();
    let path = agent_memory_dir().join(format!("{}.json", agent_id));

    if let Ok(content) = fs::read_to_string(&path) {
        if let Ok(mem) = serde_json::from_str(&content) {
            return mem;
        }
    }

    let agents = list_agents();
    let max_tokens = agents
        .iter()
        .find(|a| a.id == agent_id)
        .map(|a| a.max_tokens)
        .unwrap_or(4000);

    AgentMemory {
        agent_id: agent_id.to_string(),
        context_entries: Vec::new(),
        total_tokens: 0,
        max_tokens,
        created_at: current_timestamp_ms(),
        updated_at: current_timestamp_ms(),
    }
}

/// Add context to agent memory (with isolation and token limits)
pub fn add_agent_context(agent_id: &str, entry: &str) -> Result<AgentMemory, String> {
    ensure_phase_d_dirs();
    let mut memory = get_agent_memory(agent_id);
    let entry_tokens = entry.len() / 4;

    // Evict old entries if over budget
    while memory.total_tokens + entry_tokens > memory.max_tokens && !memory.context_entries.is_empty() {
        let removed = memory.context_entries.remove(0);
        memory.total_tokens = memory.total_tokens.saturating_sub(removed.len() / 4);
    }

    memory.context_entries.push(entry.to_string());
    memory.total_tokens += entry_tokens;
    memory.updated_at = current_timestamp_ms();

    let path = agent_memory_dir().join(format!("{}.json", agent_id));
    let json = serde_json::to_string_pretty(&memory)
        .map_err(|e| format!("Failed to serialize: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("Failed to save: {}", e))?;

    Ok(memory)
}

/// Clear an agent's isolated memory
pub fn clear_agent_memory(agent_id: &str) -> Result<(), String> {
    let path = agent_memory_dir().join(format!("{}.json", agent_id));
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Failed to clear: {}", e))?;
    }
    Ok(())
}

/// Generate an agent execution summary from a completed task
pub fn summarize_agent_execution(
    task_id: &str,
) -> Result<AgentSummary, String> {
    let task_path = tasks_dir().join(format!("{}.json", task_id));
    let task_content = fs::read_to_string(&task_path)
        .map_err(|e| format!("Task not found: {}", e))?;
    let task: AgentTask = serde_json::from_str(&task_content)
        .map_err(|e| format!("Failed to parse task: {}", e))?;

    let agents = list_agents();
    let agent_name = agents
        .iter()
        .find(|a| a.id == task.agent_id)
        .map(|a| a.name.clone())
        .unwrap_or_else(|| "Unknown".to_string());

    let result_text = task.result.as_deref().unwrap_or("");

    // Extract findings and recommendations from result
    let findings: Vec<String> = result_text
        .lines()
        .filter(|l| !l.trim().is_empty())
        .take(5)
        .map(|l| l.trim().to_string())
        .collect();

    let duration = task.completed_at.unwrap_or(0).saturating_sub(task.created_at);

    Ok(AgentSummary {
        agent_id: task.agent_id.clone(),
        agent_name,
        task_description: task.description.clone(),
        findings,
        recommendations: Vec::new(),
        files_affected: Vec::new(),
        token_usage: result_text.len() / 4,
        duration_ms: duration,
        success: task.status == StepStatus::Completed,
    })
}

/// Load safety configuration
pub fn load_safety_config() -> SafetyConfig {
    fs::read_to_string(safety_config_path())
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_default()
}

/// Save safety configuration
pub fn save_safety_config(config: &SafetyConfig) -> Result<(), String> {
    ensure_phase_d_dirs();
    let json = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize: {}", e))?;
    fs::write(safety_config_path(), json)
        .map_err(|e| format!("Failed to save: {}", e))
}

/// Run safety check for a workflow
pub fn check_workflow_safety(workflow_id: &str) -> SafetyCheckResult {
    let safety = load_safety_config();
    let workflows = list_workflows(None);
    let mut violations: Vec<String> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();

    if let Some(workflow) = workflows.iter().find(|w| w.id == workflow_id) {
        // Check step count
        if workflow.steps.len() > 20 {
            warnings.push(format!("Workflow has {} steps (recommend < 20)", workflow.steps.len()));
        }

        // Check for circular dependencies
        for step in &workflow.steps {
            for dep in &step.depends_on {
                if *dep == step.id {
                    violations.push(format!("Step {} depends on itself", step.id));
                }
            }
        }

        // Check running steps
        let running = workflow.steps.iter().filter(|s| s.status == StepStatus::Running).count();
        if running > safety.max_concurrent_agents as usize {
            violations.push(format!(
                "{} agents running concurrently (max {})",
                running, safety.max_concurrent_agents
            ));
        }

        // Check delegation depth
        let delegations = list_delegations(None);
        let max_depth = delegations.iter().map(|d| d.depth).max().unwrap_or(0);
        if max_depth >= safety.max_recursion_depth {
            violations.push(format!(
                "Delegation depth {} exceeds limit {}",
                max_depth, safety.max_recursion_depth
            ));
        }
    } else {
        violations.push(format!("Workflow {} not found", workflow_id));
    }

    SafetyCheckResult {
        safe: violations.is_empty(),
        violations,
        warnings,
    }
}

/// Enhanced agent stats with Phase D info
#[derive(Debug, Clone, Serialize)]
pub struct EnhancedAgentStats {
    pub base: AgentStats,
    pub total_delegations: usize,
    pub active_delegations: usize,
    pub agents_with_memory: usize,
    pub total_memory_tokens: usize,
    pub safety_config: SafetyConfig,
}

pub fn get_enhanced_agent_stats() -> EnhancedAgentStats {
    let base = get_agent_stats();
    let delegations = list_delegations(None);

    let active_delegations = delegations
        .iter()
        .filter(|d| d.status == StepStatus::Running || d.status == StepStatus::Pending)
        .count();

    let agents = list_agents();
    let mut agents_with_memory = 0usize;
    let mut total_memory_tokens = 0usize;

    for agent in &agents {
        let mem = get_agent_memory(&agent.id);
        if !mem.context_entries.is_empty() {
            agents_with_memory += 1;
            total_memory_tokens += mem.total_tokens;
        }
    }

    EnhancedAgentStats {
        base,
        total_delegations: delegations.len(),
        active_delegations,
        agents_with_memory,
        total_memory_tokens,
        safety_config: load_safety_config(),
    }
}
