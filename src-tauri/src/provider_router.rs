use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

// ═══════ Data Structures ═══════

/// A model provider configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub provider_type: ProviderType,
    pub base_url: Option<String>,
    pub models: Vec<ModelConfig>,
    pub enabled: bool,
    pub priority: u32,
    pub api_key_env: Option<String>,
    pub created_at: u64,
    pub is_builtin: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ProviderType {
    Claude,
    DeepSeek,
    OpenAI,
    Local,
    Custom,
}

/// A model available from a provider
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelConfig {
    pub id: String,
    pub name: String,
    pub max_tokens: usize,
    pub input_price_per_m: f64,
    pub output_price_per_m: f64,
    pub supports_streaming: bool,
    pub supports_tools: bool,
    pub context_window: usize,
}

/// Routing strategy for selecting providers
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum RoutingStrategy {
    CostOptimized,
    QualityFirst,
    LatencyFirst,
    RoundRobin,
    Failover,
    Manual,
}

/// Router configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouterConfig {
    pub strategy: RoutingStrategy,
    pub default_provider: String,
    pub default_model: String,
    pub fallback_provider: Option<String>,
    pub max_retries: u32,
    pub timeout_ms: u64,
    pub cost_threshold_usd: f64,
}

impl Default for RouterConfig {
    fn default() -> Self {
        Self {
            strategy: RoutingStrategy::CostOptimized,
            default_provider: "deepseek".to_string(),
            default_model: "deepseek-chat".to_string(),
            fallback_provider: Some("claude".to_string()),
            max_retries: 2,
            timeout_ms: 30000,
            cost_threshold_usd: 0.01,
        }
    }
}

/// A routing decision record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutingDecision {
    pub id: String,
    pub timestamp: u64,
    pub task_type: String,
    pub selected_provider: String,
    pub selected_model: String,
    pub reason: String,
    pub estimated_cost: f64,
    pub fallback_used: bool,
}

/// Provider health status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderHealth {
    pub provider_id: String,
    pub status: HealthStatus,
    pub last_checked: u64,
    pub avg_latency_ms: u64,
    pub error_rate: f64,
    pub requests_today: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum HealthStatus {
    Healthy,
    Degraded,
    Down,
    Unknown,
}

/// Router statistics
#[derive(Debug, Clone, Serialize)]
pub struct RouterStats {
    pub config: RouterConfig,
    pub total_providers: usize,
    pub enabled_providers: usize,
    pub total_models: usize,
    pub total_routing_decisions: usize,
    pub fallback_count: usize,
    pub provider_health: Vec<ProviderHealth>,
}

// ═══════ Storage ═══════

fn router_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/home/ubuntu"))
        .join(".claude")
        .join("workspace-brain")
        .join("router")
}

fn providers_file() -> PathBuf {
    router_dir().join("providers.json")
}

fn config_file() -> PathBuf {
    router_dir().join("config.json")
}

fn decisions_dir() -> PathBuf {
    router_dir().join("decisions")
}

fn health_file() -> PathBuf {
    router_dir().join("health.json")
}

fn ensure_dirs() {
    let _ = fs::create_dir_all(decisions_dir());
}

fn current_timestamp_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// ═══════ Built-in Providers ═══════

fn builtin_providers() -> Vec<Provider> {
    vec![
        Provider {
            id: "deepseek".to_string(),
            name: "DeepSeek".to_string(),
            provider_type: ProviderType::DeepSeek,
            base_url: Some("https://api.deepseek.com".to_string()),
            models: vec![
                ModelConfig {
                    id: "deepseek-chat".to_string(),
                    name: "DeepSeek Chat".to_string(),
                    max_tokens: 8192,
                    input_price_per_m: 0.27,
                    output_price_per_m: 1.10,
                    supports_streaming: true,
                    supports_tools: true,
                    context_window: 64000,
                },
                ModelConfig {
                    id: "deepseek-reasoner".to_string(),
                    name: "DeepSeek Reasoner".to_string(),
                    max_tokens: 8192,
                    input_price_per_m: 0.55,
                    output_price_per_m: 2.19,
                    supports_streaming: true,
                    supports_tools: true,
                    context_window: 64000,
                },
            ],
            enabled: true,
            priority: 1,
            api_key_env: Some("DEEPSEEK_API_KEY".to_string()),
            created_at: 0,
            is_builtin: true,
        },
        Provider {
            id: "claude".to_string(),
            name: "Anthropic Claude".to_string(),
            provider_type: ProviderType::Claude,
            base_url: Some("https://api.anthropic.com".to_string()),
            models: vec![
                ModelConfig {
                    id: "claude-sonnet-4-20250514".to_string(),
                    name: "Claude Sonnet 4".to_string(),
                    max_tokens: 16384,
                    input_price_per_m: 3.0,
                    output_price_per_m: 15.0,
                    supports_streaming: true,
                    supports_tools: true,
                    context_window: 200000,
                },
                ModelConfig {
                    id: "claude-3-5-haiku-20241022".to_string(),
                    name: "Claude 3.5 Haiku".to_string(),
                    max_tokens: 8192,
                    input_price_per_m: 0.80,
                    output_price_per_m: 4.0,
                    supports_streaming: true,
                    supports_tools: true,
                    context_window: 200000,
                },
            ],
            enabled: true,
            priority: 2,
            api_key_env: Some("ANTHROPIC_API_KEY".to_string()),
            created_at: 0,
            is_builtin: true,
        },
        Provider {
            id: "openai".to_string(),
            name: "OpenAI".to_string(),
            provider_type: ProviderType::OpenAI,
            base_url: Some("https://api.openai.com".to_string()),
            models: vec![
                ModelConfig {
                    id: "gpt-4o".to_string(),
                    name: "GPT-4o".to_string(),
                    max_tokens: 16384,
                    input_price_per_m: 2.50,
                    output_price_per_m: 10.0,
                    supports_streaming: true,
                    supports_tools: true,
                    context_window: 128000,
                },
                ModelConfig {
                    id: "gpt-4o-mini".to_string(),
                    name: "GPT-4o Mini".to_string(),
                    max_tokens: 16384,
                    input_price_per_m: 0.15,
                    output_price_per_m: 0.60,
                    supports_streaming: true,
                    supports_tools: true,
                    context_window: 128000,
                },
            ],
            enabled: false,
            priority: 3,
            api_key_env: Some("OPENAI_API_KEY".to_string()),
            created_at: 0,
            is_builtin: true,
        },
    ]
}

// ═══════ Provider Management ═══════

/// List all providers (builtin + custom)
pub fn list_providers() -> Vec<Provider> {
    let mut providers = builtin_providers();

    if let Ok(content) = fs::read_to_string(providers_file()) {
        if let Ok(custom) = serde_json::from_str::<Vec<Provider>>(&content) {
            // Merge: custom overrides builtin if same ID
            for cp in custom {
                if let Some(existing) = providers.iter_mut().find(|p| p.id == cp.id) {
                    existing.enabled = cp.enabled;
                    existing.priority = cp.priority;
                    if !cp.models.is_empty() {
                        existing.models = cp.models;
                    }
                } else {
                    providers.push(cp);
                }
            }
        }
    }

    providers.sort_by_key(|p| p.priority);
    providers
}

/// Save provider configuration (overrides)
pub fn save_provider(provider: &Provider) -> Result<(), String> {
    ensure_dirs();
    let mut customs = load_custom_providers();
    customs.retain(|p| p.id != provider.id);
    customs.push(provider.clone());
    save_custom_providers(&customs)
}

/// Delete a custom provider
pub fn delete_provider(id: &str) -> Result<(), String> {
    let mut customs = load_custom_providers();
    let before = customs.len();
    customs.retain(|p| p.id != id || p.is_builtin);
    if customs.len() == before {
        return Err("Provider not found or is built-in".to_string());
    }
    save_custom_providers(&customs)
}

fn load_custom_providers() -> Vec<Provider> {
    fs::read_to_string(providers_file())
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_default()
}

fn save_custom_providers(providers: &[Provider]) -> Result<(), String> {
    ensure_dirs();
    let json = serde_json::to_string_pretty(providers)
        .map_err(|e| format!("Failed to serialize providers: {}", e))?;
    fs::write(providers_file(), json)
        .map_err(|e| format!("Failed to write providers: {}", e))
}

// ═══════ Router Configuration ═══════

/// Load router config
pub fn load_config() -> RouterConfig {
    fs::read_to_string(config_file())
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_default()
}

/// Save router config
pub fn save_config(config: &RouterConfig) -> Result<(), String> {
    ensure_dirs();
    let json = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    fs::write(config_file(), json)
        .map_err(|e| format!("Failed to write config: {}", e))
}

// ═══════ Routing Logic ═══════

/// Select the best provider and model for a task
pub fn route(
    task_type: &str,
    needs_tools: bool,
    max_budget: Option<f64>,
) -> RoutingDecision {
    let config = load_config();
    let providers = list_providers();
    let now = current_timestamp_ms();

    let enabled: Vec<&Provider> = providers.iter().filter(|p| p.enabled).collect();

    if enabled.is_empty() {
        return RoutingDecision {
            id: format!("rd-{}", now),
            timestamp: now,
            task_type: task_type.to_string(),
            selected_provider: config.default_provider.clone(),
            selected_model: config.default_model.clone(),
            reason: "No enabled providers, using default".to_string(),
            estimated_cost: 0.0,
            fallback_used: false,
        };
    }

    match config.strategy {
        RoutingStrategy::CostOptimized => {
            route_by_cost(&enabled, task_type, needs_tools, max_budget, now)
        }
        RoutingStrategy::QualityFirst => {
            route_by_quality(&enabled, task_type, needs_tools, now)
        }
        RoutingStrategy::Failover => {
            route_failover(&enabled, &config, task_type, now)
        }
        _ => {
            // Default: use configured default
            RoutingDecision {
                id: format!("rd-{}", now),
                timestamp: now,
                task_type: task_type.to_string(),
                selected_provider: config.default_provider,
                selected_model: config.default_model,
                reason: format!("Using {:?} strategy default", config.strategy),
                estimated_cost: 0.0,
                fallback_used: false,
            }
        }
    }
}

fn route_by_cost(
    providers: &[&Provider],
    task_type: &str,
    needs_tools: bool,
    max_budget: Option<f64>,
    now: u64,
) -> RoutingDecision {
    let mut best: Option<(&Provider, &ModelConfig, f64)> = None;

    for provider in providers {
        for model in &provider.models {
            if needs_tools && !model.supports_tools {
                continue;
            }
            let cost_per_1k = (model.input_price_per_m + model.output_price_per_m) / 1000.0;
            if let Some(budget) = max_budget {
                if cost_per_1k > budget {
                    continue;
                }
            }
            if best.is_none() || cost_per_1k < best.as_ref().unwrap().2 {
                best = Some((provider, model, cost_per_1k));
            }
        }
    }

    match best {
        Some((provider, model, cost)) => RoutingDecision {
            id: format!("rd-{}", now),
            timestamp: now,
            task_type: task_type.to_string(),
            selected_provider: provider.id.clone(),
            selected_model: model.id.clone(),
            reason: format!(
                "Cost optimized: {} ({}) at ${:.4}/1K tokens",
                model.name, provider.name, cost
            ),
            estimated_cost: cost,
            fallback_used: false,
        },
        None => RoutingDecision {
            id: format!("rd-{}", now),
            timestamp: now,
            task_type: task_type.to_string(),
            selected_provider: providers[0].id.clone(),
            selected_model: providers[0].models.first().map(|m| m.id.clone()).unwrap_or_default(),
            reason: "No model matched criteria, using first available".to_string(),
            estimated_cost: 0.0,
            fallback_used: true,
        },
    }
}

fn route_by_quality(
    providers: &[&Provider],
    task_type: &str,
    needs_tools: bool,
    now: u64,
) -> RoutingDecision {
    // Quality = largest context window + highest price (proxy for capability)
    let mut best: Option<(&Provider, &ModelConfig, usize)> = None;

    for provider in providers {
        for model in &provider.models {
            if needs_tools && !model.supports_tools {
                continue;
            }
            let quality_score = model.context_window + (model.output_price_per_m * 1000.0) as usize;
            if best.is_none() || quality_score > best.as_ref().unwrap().2 {
                best = Some((provider, model, quality_score));
            }
        }
    }

    match best {
        Some((provider, model, _)) => RoutingDecision {
            id: format!("rd-{}", now),
            timestamp: now,
            task_type: task_type.to_string(),
            selected_provider: provider.id.clone(),
            selected_model: model.id.clone(),
            reason: format!(
                "Quality first: {} ({}) — {}K context",
                model.name, provider.name, model.context_window / 1000
            ),
            estimated_cost: (model.input_price_per_m + model.output_price_per_m) / 1000.0,
            fallback_used: false,
        },
        None => RoutingDecision {
            id: format!("rd-{}", now),
            timestamp: now,
            task_type: task_type.to_string(),
            selected_provider: providers[0].id.clone(),
            selected_model: providers[0].models.first().map(|m| m.id.clone()).unwrap_or_default(),
            reason: "No model matched, using first available".to_string(),
            estimated_cost: 0.0,
            fallback_used: true,
        },
    }
}

fn route_failover(
    providers: &[&Provider],
    config: &RouterConfig,
    task_type: &str,
    now: u64,
) -> RoutingDecision {
    // Try default provider first, then fallback
    let default = providers.iter().find(|p| p.id == config.default_provider);
    let fallback = config.fallback_provider.as_ref()
        .and_then(|fb| providers.iter().find(|p| p.id == *fb));

    let health = load_health();
    let default_healthy = default.map_or(false, |p| {
        health.iter().find(|h| h.provider_id == p.id)
            .map_or(true, |h| h.status != HealthStatus::Down)
    });

    if default_healthy {
        if let Some(provider) = default {
            return RoutingDecision {
                id: format!("rd-{}", now),
                timestamp: now,
                task_type: task_type.to_string(),
                selected_provider: provider.id.clone(),
                selected_model: provider.models.first().map(|m| m.id.clone()).unwrap_or_default(),
                reason: format!("Failover: primary {} is healthy", provider.name),
                estimated_cost: 0.0,
                fallback_used: false,
            };
        }
    }

    if let Some(fb) = fallback {
        return RoutingDecision {
            id: format!("rd-{}", now),
            timestamp: now,
            task_type: task_type.to_string(),
            selected_provider: fb.id.clone(),
            selected_model: fb.models.first().map(|m| m.id.clone()).unwrap_or_default(),
            reason: format!("Failover: primary down, using fallback {}", fb.name),
            estimated_cost: 0.0,
            fallback_used: true,
        };
    }

    RoutingDecision {
        id: format!("rd-{}", now),
        timestamp: now,
        task_type: task_type.to_string(),
        selected_provider: providers[0].id.clone(),
        selected_model: providers[0].models.first().map(|m| m.id.clone()).unwrap_or_default(),
        reason: "Failover: no fallback configured, using first available".to_string(),
        estimated_cost: 0.0,
        fallback_used: true,
    }
}

/// Save a routing decision for auditing
#[allow(dead_code)]
pub fn save_routing_decision(decision: &RoutingDecision) -> Result<(), String> {
    ensure_dirs();
    let json = serde_json::to_string_pretty(decision)
        .map_err(|e| format!("Failed to serialize decision: {}", e))?;
    let path = decisions_dir().join(format!("{}.json", decision.id));
    fs::write(&path, json).map_err(|e| format!("Failed to save decision: {}", e))
}

// ═══════ Health Tracking ═══════

fn load_health() -> Vec<ProviderHealth> {
    fs::read_to_string(health_file())
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_default()
}

/// Update provider health status
#[allow(dead_code)]
pub fn update_health(
    provider_id: &str,
    status: HealthStatus,
    latency_ms: u64,
) -> Result<(), String> {
    ensure_dirs();
    let mut health = load_health();
    let now = current_timestamp_ms();

    if let Some(existing) = health.iter_mut().find(|h| h.provider_id == provider_id) {
        existing.status = status;
        existing.last_checked = now;
        existing.avg_latency_ms = (existing.avg_latency_ms + latency_ms) / 2;
        existing.requests_today += 1;
        if existing.status == HealthStatus::Down {
            existing.error_rate = (existing.error_rate + 1.0) / 2.0;
        } else {
            existing.error_rate = existing.error_rate * 0.9;
        }
    } else {
        health.push(ProviderHealth {
            provider_id: provider_id.to_string(),
            status,
            last_checked: now,
            avg_latency_ms: latency_ms,
            error_rate: 0.0,
            requests_today: 1,
        });
    }

    let json = serde_json::to_string_pretty(&health)
        .map_err(|e| format!("Failed to serialize health: {}", e))?;
    fs::write(health_file(), json)
        .map_err(|e| format!("Failed to write health: {}", e))
}

// ═══════ Stats ═══════

/// Get router statistics
pub fn get_router_stats() -> RouterStats {
    let config = load_config();
    let providers = list_providers();
    let health = load_health();

    let total_models: usize = providers.iter().map(|p| p.models.len()).sum();

    let mut decision_count = 0;
    let mut fallback_count = 0;
    if let Ok(entries) = fs::read_dir(decisions_dir()) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |e| e == "json") {
                decision_count += 1;
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(d) = serde_json::from_str::<RoutingDecision>(&content) {
                        if d.fallback_used {
                            fallback_count += 1;
                        }
                    }
                }
            }
        }
    }

    RouterStats {
        config,
        total_providers: providers.len(),
        enabled_providers: providers.iter().filter(|p| p.enabled).count(),
        total_models,
        total_routing_decisions: decision_count,
        fallback_count,
        provider_health: health,
    }
}
