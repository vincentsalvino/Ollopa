use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

// ═══════════════════════════════════════════════════════════════
// Background Intelligence Engine
// Uses MiMo for continuous cheap cognition tasks
// ═══════════════════════════════════════════════════════════════

/// A background intelligence task
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackgroundTask {
    pub id: String,
    pub task_type: BackgroundTaskType,
    pub status: BackgroundTaskStatus,
    pub priority: TaskPriority,
    pub input: String,
    pub output: Option<String>,
    pub provider_used: Option<String>,
    pub model_used: Option<String>,
    pub token_count: u64,
    pub cost_usd: f64,
    pub created_at: u64,
    pub started_at: Option<u64>,
    pub completed_at: Option<u64>,
    pub batch_id: Option<String>,
    pub project_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum BackgroundTaskType {
    RollingSummary,
    RepositoryIndexing,
    ArchitectureTagging,
    GraphMetadataGeneration,
    SemanticLabeling,
    RetrievalPreparation,
    DuplicateMemoryDetection,
    SessionCompression,
    VisualMemoryTagging,
    DesignMemoryUpdate,
}

impl BackgroundTaskType {
    pub fn label(&self) -> &str {
        match self {
            BackgroundTaskType::RollingSummary => "rolling_summary",
            BackgroundTaskType::RepositoryIndexing => "repository_indexing",
            BackgroundTaskType::ArchitectureTagging => "architecture_tagging",
            BackgroundTaskType::GraphMetadataGeneration => "graph_metadata_generation",
            BackgroundTaskType::SemanticLabeling => "semantic_labeling",
            BackgroundTaskType::RetrievalPreparation => "retrieval_preparation",
            BackgroundTaskType::DuplicateMemoryDetection => "duplicate_memory_detection",
            BackgroundTaskType::SessionCompression => "session_compression",
            BackgroundTaskType::VisualMemoryTagging => "visual_memory_tagging",
            BackgroundTaskType::DesignMemoryUpdate => "design_memory_update",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum BackgroundTaskStatus {
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TaskPriority {
    Low,
    Normal,
    High,
}

/// Background intelligence configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackgroundConfig {
    pub enabled: bool,
    pub max_concurrent_tasks: usize,
    pub max_daily_token_budget: u64,
    pub batch_size: usize,
    pub preferred_provider: String,
    pub auto_summarize: bool,
    pub auto_index: bool,
    pub auto_compress: bool,
    pub auto_detect_duplicates: bool,
}

impl Default for BackgroundConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            max_concurrent_tasks: 3,
            max_daily_token_budget: 100_000,
            batch_size: 5,
            preferred_provider: "mimo".to_string(),
            auto_summarize: true,
            auto_index: true,
            auto_compress: true,
            auto_detect_duplicates: true,
        }
    }
}

/// Batch of tasks for efficient processing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskBatch {
    pub id: String,
    pub tasks: Vec<String>,
    pub status: BackgroundTaskStatus,
    pub total_tokens: u64,
    pub total_cost: f64,
    pub created_at: u64,
    pub completed_at: Option<u64>,
}

/// Statistics for background intelligence
#[derive(Debug, Clone, Serialize)]
pub struct BackgroundStats {
    pub config: BackgroundConfig,
    pub total_tasks: usize,
    pub completed_tasks: usize,
    pub failed_tasks: usize,
    pub queued_tasks: usize,
    pub running_tasks: usize,
    pub total_tokens_used: u64,
    pub total_cost_usd: f64,
    pub daily_tokens_remaining: u64,
    pub task_type_counts: std::collections::HashMap<String, usize>,
    pub active_batches: usize,
}

// ═══════ Storage Paths ═══════

fn bg_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/home/ubuntu"))
        .join(".ollopa")
        .join("workspace-brain")
        .join("background")
}

fn tasks_dir() -> PathBuf {
    bg_dir().join("tasks")
}

fn batches_dir() -> PathBuf {
    bg_dir().join("batches")
}

fn config_file() -> PathBuf {
    bg_dir().join("config.json")
}

fn ensure_dirs() {
    let _ = fs::create_dir_all(tasks_dir());
    let _ = fs::create_dir_all(batches_dir());
}

fn current_timestamp_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// ═══════ Configuration ═══════

pub fn load_config() -> BackgroundConfig {
    fs::read_to_string(config_file())
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_default()
}

pub fn save_config(config: &BackgroundConfig) -> Result<(), String> {
    ensure_dirs();
    let json = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    fs::write(config_file(), json)
        .map_err(|e| format!("Failed to write config: {}", e))
}

// ═══════ Task Management ═══════

pub fn create_task(
    task_type: BackgroundTaskType,
    input: &str,
    priority: TaskPriority,
    project_path: Option<&str>,
) -> Result<BackgroundTask, String> {
    ensure_dirs();
    let now = current_timestamp_ms();
    let task = BackgroundTask {
        id: format!("bg-{}", now),
        task_type,
        status: BackgroundTaskStatus::Queued,
        priority,
        input: input.to_string(),
        output: None,
        provider_used: None,
        model_used: None,
        token_count: 0,
        cost_usd: 0.0,
        created_at: now,
        started_at: None,
        completed_at: None,
        batch_id: None,
        project_path: project_path.map(|s| s.to_string()),
    };

    save_task(&task)?;
    Ok(task)
}

fn save_task(task: &BackgroundTask) -> Result<(), String> {
    let json = serde_json::to_string_pretty(task)
        .map_err(|e| format!("Failed to serialize task: {}", e))?;
    fs::write(tasks_dir().join(format!("{}.json", task.id)), json)
        .map_err(|e| format!("Failed to write task: {}", e))
}

pub fn list_tasks(status: Option<&str>) -> Vec<BackgroundTask> {
    ensure_dirs();
    let mut tasks: Vec<BackgroundTask> = fs::read_dir(tasks_dir())
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let content = fs::read_to_string(e.path()).ok()?;
            serde_json::from_str(&content).ok()
        })
        .collect();

    if let Some(s) = status {
        tasks.retain(|t| match s {
            "queued" => t.status == BackgroundTaskStatus::Queued,
            "running" => t.status == BackgroundTaskStatus::Running,
            "completed" => t.status == BackgroundTaskStatus::Completed,
            "failed" => t.status == BackgroundTaskStatus::Failed,
            _ => true,
        });
    }

    tasks.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    tasks
}

pub fn complete_task(
    id: &str,
    output: &str,
    tokens: u64,
    cost: f64,
    provider: &str,
    model: &str,
    success: bool,
) -> Result<BackgroundTask, String> {
    let path = tasks_dir().join(format!("{}.json", id));
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Task not found: {}", e))?;
    let mut task: BackgroundTask = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse task: {}", e))?;

    let now = current_timestamp_ms();
    task.status = if success { BackgroundTaskStatus::Completed } else { BackgroundTaskStatus::Failed };
    task.output = Some(output.to_string());
    task.token_count = tokens;
    task.cost_usd = cost;
    task.provider_used = Some(provider.to_string());
    task.model_used = Some(model.to_string());
    task.completed_at = Some(now);

    save_task(&task)?;
    Ok(task)
}

pub fn delete_task(id: &str) -> Result<(), String> {
    let path = tasks_dir().join(format!("{}.json", id));
    fs::remove_file(&path).map_err(|e| format!("Failed to delete task: {}", e))
}

// ═══════ Batch Management ═══════

pub fn create_batch(task_ids: &[String]) -> Result<TaskBatch, String> {
    ensure_dirs();
    let now = current_timestamp_ms();
    let batch = TaskBatch {
        id: format!("batch-{}", now),
        tasks: task_ids.to_vec(),
        status: BackgroundTaskStatus::Queued,
        total_tokens: 0,
        total_cost: 0.0,
        created_at: now,
        completed_at: None,
    };

    let json = serde_json::to_string_pretty(&batch)
        .map_err(|e| format!("Failed to serialize batch: {}", e))?;
    fs::write(batches_dir().join(format!("{}.json", batch.id)), json)
        .map_err(|e| format!("Failed to write batch: {}", e))?;

    // Update tasks with batch_id
    for task_id in task_ids {
        let path = tasks_dir().join(format!("{}.json", task_id));
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(mut task) = serde_json::from_str::<BackgroundTask>(&content) {
                task.batch_id = Some(batch.id.clone());
                let _ = save_task(&task);
            }
        }
    }

    Ok(batch)
}

pub fn list_batches() -> Vec<TaskBatch> {
    ensure_dirs();
    let mut batches: Vec<TaskBatch> = fs::read_dir(batches_dir())
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let content = fs::read_to_string(e.path()).ok()?;
            serde_json::from_str(&content).ok()
        })
        .collect();

    batches.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    batches
}

// ═══════ Queue Next Tasks ═══════

pub fn queue_next_tasks(project_path: Option<&str>) -> Vec<BackgroundTask> {
    let config = load_config();
    if !config.enabled {
        return vec![];
    }

    let mut created = vec![];
    let now = current_timestamp_ms();

    if config.auto_summarize {
        if let Ok(task) = create_task(
            BackgroundTaskType::RollingSummary,
            &format!("Generate rolling summary for recent sessions at {}", now),
            TaskPriority::Normal,
            project_path,
        ) {
            created.push(task);
        }
    }

    if config.auto_index {
        if let Ok(task) = create_task(
            BackgroundTaskType::RepositoryIndexing,
            "Index repository for semantic retrieval",
            TaskPriority::Normal,
            project_path,
        ) {
            created.push(task);
        }
    }

    if config.auto_compress {
        if let Ok(task) = create_task(
            BackgroundTaskType::SessionCompression,
            "Compress older session data to reduce storage",
            TaskPriority::Low,
            project_path,
        ) {
            created.push(task);
        }
    }

    if config.auto_detect_duplicates {
        if let Ok(task) = create_task(
            BackgroundTaskType::DuplicateMemoryDetection,
            "Detect and flag duplicate memory entries",
            TaskPriority::Low,
            project_path,
        ) {
            created.push(task);
        }
    }

    created
}

// ═══════ Statistics ═══════

pub fn get_background_stats() -> BackgroundStats {
    let config = load_config();
    let tasks = list_tasks(None);
    let batches = list_batches();

    let mut task_type_counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    let mut total_tokens = 0u64;
    let mut total_cost = 0.0f64;
    let mut completed = 0usize;
    let mut failed = 0usize;
    let mut queued = 0usize;
    let mut running = 0usize;

    for task in &tasks {
        *task_type_counts.entry(task.task_type.label().to_string()).or_insert(0) += 1;
        total_tokens += task.token_count;
        total_cost += task.cost_usd;
        match task.status {
            BackgroundTaskStatus::Completed => completed += 1,
            BackgroundTaskStatus::Failed => failed += 1,
            BackgroundTaskStatus::Queued => queued += 1,
            BackgroundTaskStatus::Running => running += 1,
            BackgroundTaskStatus::Cancelled => {}
        }
    }

    let daily_remaining = config.max_daily_token_budget.saturating_sub(total_tokens);
    let active_batches = batches.iter()
        .filter(|b| b.status == BackgroundTaskStatus::Running || b.status == BackgroundTaskStatus::Queued)
        .count();

    BackgroundStats {
        config,
        total_tasks: tasks.len(),
        completed_tasks: completed,
        failed_tasks: failed,
        queued_tasks: queued,
        running_tasks: running,
        total_tokens_used: total_tokens,
        total_cost_usd: total_cost,
        daily_tokens_remaining: daily_remaining,
        task_type_counts,
        active_batches,
    }
}
