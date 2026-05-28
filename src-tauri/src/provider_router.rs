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
    OpenRouter,
    NousResearch,
    MiMo,
    Local,
    Custom,
}

/// Role a provider plays in the routing topology
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ProviderRole {
    Primary,
    Fallback,
    Background,
    Compression,
    Design,
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
    PrimaryOnly,
    InlineFallback,
    BackgroundIntelligence,
    DesignFocused,
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
            strategy: RoutingStrategy::InlineFallback,
            default_provider: "deepseek".to_string(),
            default_model: "deepseek-chat".to_string(),
            fallback_provider: Some("mimo".to_string()),
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
    #[serde(default)]
    pub provider_role: Option<String>,
    #[serde(default)]
    pub fallback_reason: Option<String>,
    #[serde(default)]
    pub routing_strategy: Option<String>,
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
        .join(".ollopa")
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
            name: "Anthropic (via DeepSeek)".to_string(),
            provider_type: ProviderType::Claude,
            base_url: Some("https://api.deepseek.com".to_string()),
            models: vec![
                ModelConfig {
                    id: "claude-sonnet-4-20250514".to_string(),
                    name: "Claude Sonnet 4".to_string(),
                    max_tokens: 16384,
                    input_price_per_m: 2.0,
                    output_price_per_m: 8.0,
                    supports_streaming: true,
                    supports_tools: true,
                    context_window: 200000,
                },
                ModelConfig {
                    id: "claude-opus-4-20250514".to_string(),
                    name: "Claude Opus 4".to_string(),
                    max_tokens: 32768,
                    input_price_per_m: 2.0,
                    output_price_per_m: 8.0,
                    supports_streaming: true,
                    supports_tools: true,
                    context_window: 200000,
                },
            ],
            enabled: true,
            priority: 2,
            api_key_env: Some("DEEPSEEK_API_KEY".to_string()),
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
        Provider {
            id: "openrouter".to_string(),
            name: "OpenRouter".to_string(),
            provider_type: ProviderType::OpenRouter,
            base_url: Some("https://openrouter.ai/api/v1".to_string()),
            models: vec![
                ModelConfig {
                    id: "nousresearch/hermes-3-llama-3.1-405b".to_string(),
                    name: "Hermes 3 405B".to_string(),
                    max_tokens: 16384,
                    input_price_per_m: 5.32,
                    output_price_per_m: 5.32,
                    supports_streaming: true,
                    supports_tools: true,
                    context_window: 131072,
                },
                ModelConfig {
                    id: "nousresearch/hermes-3-llama-3.1-70b".to_string(),
                    name: "Hermes 3 70B".to_string(),
                    max_tokens: 16384,
                    input_price_per_m: 0.40,
                    output_price_per_m: 0.40,
                    supports_streaming: true,
                    supports_tools: true,
                    context_window: 131072,
                },
                ModelConfig {
                    id: "openchat/openchat-3.6-8b".to_string(),
                    name: "OpenChat 3.6 8B".to_string(),
                    max_tokens: 8192,
                    input_price_per_m: 0.06,
                    output_price_per_m: 0.06,
                    supports_streaming: true,
                    supports_tools: false,
                    context_window: 8192,
                },
                ModelConfig {
                    id: "meta-llama/llama-3.1-405b-instruct".to_string(),
                    name: "Llama 3.1 405B".to_string(),
                    max_tokens: 16384,
                    input_price_per_m: 2.70,
                    output_price_per_m: 2.70,
                    supports_streaming: true,
                    supports_tools: true,
                    context_window: 131072,
                },
                ModelConfig {
                    id: "mistralai/mistral-large-2411".to_string(),
                    name: "Mistral Large".to_string(),
                    max_tokens: 16384,
                    input_price_per_m: 2.00,
                    output_price_per_m: 6.00,
                    supports_streaming: true,
                    supports_tools: true,
                    context_window: 128000,
                },
            ],
            enabled: false,
            priority: 4,
            api_key_env: Some("OPENROUTER_API_KEY".to_string()),
            created_at: 0,
            is_builtin: true,
        },
        Provider {
            id: "nous".to_string(),
            name: "Nous Research".to_string(),
            provider_type: ProviderType::NousResearch,
            base_url: Some("https://inference.nous.hermes.dev/v1".to_string()),
            models: vec![
                ModelConfig {
                    id: "hermes-3-llama-3.1-70b".to_string(),
                    name: "Hermes 3 70B (Direct)".to_string(),
                    max_tokens: 16384,
                    input_price_per_m: 0.40,
                    output_price_per_m: 0.40,
                    supports_streaming: true,
                    supports_tools: true,
                    context_window: 131072,
                },
            ],
            enabled: false,
            priority: 5,
            api_key_env: Some("NOUS_API_KEY".to_string()),
            created_at: 0,
            is_builtin: true,
        },
        // ═══════ MiMo Provider (Xiaomi) ═══════
        Provider {
            id: "mimo".to_string(),
            name: "Xiaomi MiMo".to_string(),
            provider_type: ProviderType::MiMo,
            base_url: Some("https://api.mimo.xiaomi.com/v1".to_string()),
            models: vec![
                ModelConfig {
                    id: "mimo-7b".to_string(),
                    name: "MiMo 7B".to_string(),
                    max_tokens: 8192,
                    input_price_per_m: 0.05,
                    output_price_per_m: 0.10,
                    supports_streaming: true,
                    supports_tools: false,
                    context_window: 32000,
                },
                ModelConfig {
                    id: "mimo-7b-rl".to_string(),
                    name: "MiMo 7B RL".to_string(),
                    max_tokens: 8192,
                    input_price_per_m: 0.06,
                    output_price_per_m: 0.12,
                    supports_streaming: true,
                    supports_tools: true,
                    context_window: 32000,
                },
            ],
            enabled: true,
            priority: 6,
            api_key_env: Some("MIMO_API_KEY".to_string()),
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
            provider_role: None,
            fallback_reason: None,
            routing_strategy: None,
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
                provider_role: None,
                fallback_reason: None,
                routing_strategy: None,
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
            provider_role: None,
            fallback_reason: None,
            routing_strategy: Some("CostOptimized".to_string()),
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
            provider_role: None,
            fallback_reason: None,
            routing_strategy: Some("CostOptimized".to_string()),
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
            provider_role: None,
            fallback_reason: None,
            routing_strategy: Some("QualityFirst".to_string()),
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
            provider_role: None,
            fallback_reason: None,
            routing_strategy: Some("QualityFirst".to_string()),
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
                provider_role: Some("Primary".to_string()),
                fallback_reason: None,
                routing_strategy: Some("Failover".to_string()),
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
            provider_role: Some("Fallback".to_string()),
            fallback_reason: Some("primary_down".to_string()),
            routing_strategy: Some("Failover".to_string()),
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
        provider_role: None,
        fallback_reason: None,
        routing_strategy: Some("Failover".to_string()),
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
pub fn get_context_window(model: &str) -> usize {
    let providers = list_providers();
    for provider in &providers {
        for m in &provider.models {
            if m.id == model {
                return m.context_window;
            }
        }
    }
    64000
}

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

// ═══════════════════════════════════════════════════════════════
// UPGRADE PHASE C — Intelligent Orchestration
// Task-aware routing, budget-aware execution, latency-aware
// routing, workflow routing templates
// ═══════════════════════════════════════════════════════════════

/// Detected task type for intelligent routing
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TaskType {
    Debugging,
    CodeGeneration,
    Analysis,
    Search,
    Refactoring,
    Documentation,
    Architecture,
    Testing,
    QuickQuestion,
    General,
}

impl TaskType {
    pub fn label(&self) -> &str {
        match self {
            TaskType::Debugging => "debugging",
            TaskType::CodeGeneration => "code_generation",
            TaskType::Analysis => "analysis",
            TaskType::Search => "search",
            TaskType::Refactoring => "refactoring",
            TaskType::Documentation => "documentation",
            TaskType::Architecture => "architecture",
            TaskType::Testing => "testing",
            TaskType::QuickQuestion => "quick_question",
            TaskType::General => "general",
        }
    }
}

/// Detect task type from prompt text
pub fn detect_task_type(prompt: &str) -> TaskType {
    let lower = prompt.to_lowercase();

    let patterns: &[(&[&str], TaskType)] = &[
        (&["debug", "fix", "bug", "error", "crash", "broken", "failing", "trace", "stacktrace"], TaskType::Debugging),
        (&["write", "create", "implement", "build", "generate", "add function", "new feature", "scaffold"], TaskType::CodeGeneration),
        (&["analyze", "explain", "review", "understand", "what does", "how does", "describe"], TaskType::Analysis),
        (&["search", "find", "look up", "grep", "where is", "locate"], TaskType::Search),
        (&["refactor", "rename", "restructure", "reorganize", "clean up", "simplify"], TaskType::Refactoring),
        (&["document", "readme", "jsdoc", "comment", "docstring", "changelog"], TaskType::Documentation),
        (&["architect", "design", "system design", "schema", "migration", "infrastructure"], TaskType::Architecture),
        (&["test", "spec", "unit test", "integration test", "e2e", "coverage"], TaskType::Testing),
        (&["what is", "how to", "quick", "short", "brief", "one liner"], TaskType::QuickQuestion),
    ];

    for (keywords, task_type) in patterns {
        if keywords.iter().any(|kw| lower.contains(kw)) {
            return task_type.clone();
        }
    }

    TaskType::General
}

/// Routing recommendation based on task type
#[derive(Debug, Clone, Serialize)]
pub struct TaskRouteRecommendation {
    pub task_type: TaskType,
    pub task_label: String,
    pub recommended_provider: String,
    pub recommended_model: String,
    pub reason: String,
    pub estimated_cost: f64,
    pub use_reasoning: bool,
    pub budget_ok: bool,
}

/// Intelligent task-aware routing
pub fn smart_route(
    prompt: &str,
    needs_tools: bool,
    budget_remaining: Option<f64>,
) -> TaskRouteRecommendation {
    let task_type = detect_task_type(prompt);
    let providers = list_providers();
    let enabled: Vec<&Provider> = providers.iter().filter(|p| p.enabled).collect();
    let health = load_health();

    // Task-type to model preference mapping
    let (preferred_quality, use_reasoning) = match &task_type {
        TaskType::Debugging => ("high", true),
        TaskType::CodeGeneration => ("high", false),
        TaskType::Analysis => ("high", true),
        TaskType::Architecture => ("high", true),
        TaskType::Refactoring => ("medium", false),
        TaskType::Testing => ("medium", false),
        TaskType::Documentation => ("low", false),
        TaskType::Search => ("low", false),
        TaskType::QuickQuestion => ("low", false),
        TaskType::General => ("medium", false),
    };

    // Filter by health
    let healthy: Vec<&&Provider> = enabled
        .iter()
        .filter(|p| {
            health
                .iter()
                .find(|h| h.provider_id == p.id)
                .map_or(true, |h| h.status != HealthStatus::Down)
        })
        .collect();
    let candidates: Vec<&&Provider> = if healthy.is_empty() { enabled.iter().collect() } else { healthy };

    // Select best model based on task quality needs
    let mut best: Option<(String, String, f64, String)> = None;

    for provider in &candidates {
        for model in &provider.models {
            if needs_tools && !model.supports_tools {
                continue;
            }

            let cost = (model.input_price_per_m + model.output_price_per_m) / 2000.0;
            let score = match preferred_quality {
                "high" => model.context_window as f64 * 0.001 + model.output_price_per_m * 10.0,
                "low" => 1.0 / (cost + 0.0001),
                _ => model.context_window as f64 * 0.0005 + 1.0 / (cost + 0.0001),
            };

            if best.is_none() || score > best.as_ref().unwrap().2 {
                best = Some((
                    provider.id.clone(),
                    model.id.clone(),
                    score,
                    format!("{} ({})", model.name, provider.name),
                ));
            }
        }
    }

    let (provider_id, model_id, _, reason_detail) = best.unwrap_or_else(|| {
        ("deepseek".to_string(), "deepseek-chat".to_string(), 0.0, "fallback".to_string())
    });

    // Estimate cost
    let estimated = providers
        .iter()
        .find(|p| p.id == provider_id)
        .and_then(|p| p.models.iter().find(|m| m.id == model_id))
        .map(|m| (m.input_price_per_m + m.output_price_per_m) / 2000.0)
        .unwrap_or(0.0);

    let budget_ok = budget_remaining.map_or(true, |b| estimated <= b);

    TaskRouteRecommendation {
        task_label: task_type.label().to_string(),
        task_type,
        recommended_provider: provider_id,
        recommended_model: model_id,
        reason: format!("{} routing: {} [{}]", preferred_quality, reason_detail, if use_reasoning { "reasoning" } else { "standard" }),
        estimated_cost: estimated,
        use_reasoning,
        budget_ok,
    }
}

/// Budget-aware execution check
#[derive(Debug, Clone, Serialize)]
pub struct BudgetCheck {
    pub within_budget: bool,
    pub budget_remaining_usd: f64,
    pub estimated_cost_usd: f64,
    pub suggestion: String,
}

pub fn check_budget(estimated_tokens: usize, model_id: &str) -> BudgetCheck {
    let budget = crate::token_optimizer::load_budget();
    let stats = crate::token_optimizer::get_optimization_stats();
    let remaining = stats.budget_remaining_usd;

    let providers = list_providers();
    let model_cost = providers
        .iter()
        .flat_map(|p| &p.models)
        .find(|m| m.id == model_id)
        .map(|m| {
            (estimated_tokens as f64 / 1_000_000.0)
                * (m.input_price_per_m + m.output_price_per_m) / 2.0
        })
        .unwrap_or(0.0);

    let within = model_cost <= remaining;
    let suggestion = if within {
        "Within budget".to_string()
    } else if remaining > 0.0 {
        format!(
            "Over budget by ${:.4}. Consider using a cheaper model.",
            model_cost - remaining
        )
    } else {
        format!(
            "Monthly budget of ${:.2} exhausted. Budget resets next month.",
            budget.monthly_budget_usd
        )
    };

    BudgetCheck {
        within_budget: within,
        budget_remaining_usd: remaining,
        estimated_cost_usd: model_cost,
        suggestion,
    }
}

/// Latency-aware routing — picks the fastest healthy provider
pub fn route_by_latency(
    needs_tools: bool,
    max_budget: Option<f64>,
) -> RoutingDecision {
    let providers = list_providers();
    let enabled: Vec<&Provider> = providers.iter().filter(|p| p.enabled).collect();
    let health = load_health();
    let now = current_timestamp_ms();

    let mut best: Option<(&Provider, &ModelConfig, u64)> = None;

    for provider in &enabled {
        let latency = health
            .iter()
            .find(|h| h.provider_id == provider.id)
            .map(|h| h.avg_latency_ms)
            .unwrap_or(5000); // Default high latency for unknown

        for model in &provider.models {
            if needs_tools && !model.supports_tools {
                continue;
            }
            let cost = (model.input_price_per_m + model.output_price_per_m) / 2000.0;
            if let Some(budget) = max_budget {
                if cost > budget {
                    continue;
                }
            }
            if best.is_none() || latency < best.as_ref().unwrap().2 {
                best = Some((provider, model, latency));
            }
        }
    }

    match best {
        Some((provider, model, latency)) => RoutingDecision {
            id: format!("rd-{}", now),
            timestamp: now,
            task_type: "latency_optimized".to_string(),
            selected_provider: provider.id.clone(),
            selected_model: model.id.clone(),
            reason: format!("Latency first: {} ({}ms avg)", provider.name, latency),
            estimated_cost: (model.input_price_per_m + model.output_price_per_m) / 2000.0,
            fallback_used: false,
            provider_role: None,
            fallback_reason: None,
            routing_strategy: Some("LatencyFirst".to_string()),
        },
        None => RoutingDecision {
            id: format!("rd-{}", now),
            timestamp: now,
            task_type: "latency_optimized".to_string(),
            selected_provider: "deepseek".to_string(),
            selected_model: "deepseek-chat".to_string(),
            reason: "No providers available for latency routing".to_string(),
            estimated_cost: 0.0,
            fallback_used: true,
            provider_role: None,
            fallback_reason: None,
            routing_strategy: Some("LatencyFirst".to_string()),
        },
    }
}

/// Workflow routing template — predefined routing for workflow steps
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowRoute {
    pub step_action: String,
    pub recommended_task_type: String,
    pub recommended_model_tier: String,
    pub max_tokens: usize,
}

pub fn get_workflow_routes() -> Vec<WorkflowRoute> {
    vec![
        WorkflowRoute {
            step_action: "analyze".to_string(),
            recommended_task_type: "analysis".to_string(),
            recommended_model_tier: "high".to_string(),
            max_tokens: 4000,
        },
        WorkflowRoute {
            step_action: "code".to_string(),
            recommended_task_type: "code_generation".to_string(),
            recommended_model_tier: "high".to_string(),
            max_tokens: 8000,
        },
        WorkflowRoute {
            step_action: "review".to_string(),
            recommended_task_type: "analysis".to_string(),
            recommended_model_tier: "medium".to_string(),
            max_tokens: 3000,
        },
        WorkflowRoute {
            step_action: "test".to_string(),
            recommended_task_type: "testing".to_string(),
            recommended_model_tier: "medium".to_string(),
            max_tokens: 4000,
        },
        WorkflowRoute {
            step_action: "document".to_string(),
            recommended_task_type: "documentation".to_string(),
            recommended_model_tier: "low".to_string(),
            max_tokens: 2000,
        },
        WorkflowRoute {
            step_action: "debug".to_string(),
            recommended_task_type: "debugging".to_string(),
            recommended_model_tier: "high".to_string(),
            max_tokens: 6000,
        },
        WorkflowRoute {
            step_action: "search".to_string(),
            recommended_task_type: "search".to_string(),
            recommended_model_tier: "low".to_string(),
            max_tokens: 1000,
        },
    ]
}

/// Enhanced router stats including intelligent orchestration
#[derive(Debug, Clone, Serialize)]
pub struct EnhancedRouterStats {
    pub base: RouterStats,
    pub task_type_distribution: std::collections::HashMap<String, usize>,
    pub avg_routing_cost: f64,
    pub budget_status: BudgetCheck,
    pub workflow_routes_count: usize,
}

pub fn get_enhanced_router_stats() -> EnhancedRouterStats {
    let base = get_router_stats();
    let budget = check_budget(1000, &base.config.default_model);

    // Analyze task type distribution from routing decisions
    let mut distribution: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    let mut total_cost = 0.0;
    let mut count = 0usize;

    if let Ok(entries) = fs::read_dir(decisions_dir()) {
        for entry in entries.flatten() {
            if let Ok(content) = fs::read_to_string(entry.path()) {
                if let Ok(d) = serde_json::from_str::<RoutingDecision>(&content) {
                    *distribution.entry(d.task_type).or_insert(0) += 1;
                    total_cost += d.estimated_cost;
                    count += 1;
                }
            }
        }
    }

    let avg_cost = if count > 0 { total_cost / count as f64 } else { 0.0 };

    EnhancedRouterStats {
        base,
        task_type_distribution: distribution,
        avg_routing_cost: avg_cost,
        budget_status: budget,
        workflow_routes_count: get_workflow_routes().len(),
    }
}

// ═══════════════════════════════════════════════════════════════
// MiMo Integration — Inline Fallback + Background Intelligence
// ═══════════════════════════════════════════════════════════════

/// Failure type that triggers inline fallback
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum FallbackTrigger {
    RateLimit,
    Timeout,
    TransientError,
    QuotaExhausted,
    DegradedLatency,
    PartialGenerationFailure,
}

impl FallbackTrigger {
    pub fn label(&self) -> &str {
        match self {
            FallbackTrigger::RateLimit => "rate_limit",
            FallbackTrigger::Timeout => "timeout",
            FallbackTrigger::TransientError => "transient_error",
            FallbackTrigger::QuotaExhausted => "quota_exhausted",
            FallbackTrigger::DegradedLatency => "degraded_latency",
            FallbackTrigger::PartialGenerationFailure => "partial_generation_failure",
        }
    }
}

/// Result of an inline fallback routing decision
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InlineFallbackDecision {
    pub original_provider: String,
    pub original_model: String,
    pub fallback_provider: String,
    pub fallback_model: String,
    pub trigger: String,
    pub timestamp: u64,
    pub transparent: bool,
    pub estimated_cost_savings: f64,
}

/// Route with inline fallback: try primary, return fallback if primary unhealthy
pub fn route_inline_fallback(
    task_type: &str,
    needs_tools: bool,
    trigger: Option<FallbackTrigger>,
) -> RoutingDecision {
    let config = load_config();
    let providers = list_providers();
    let health = load_health();
    let now = current_timestamp_ms();

    let primary = providers.iter().find(|p| p.id == config.default_provider && p.enabled);
    let mimo = providers.iter().find(|p| p.id == "mimo" && p.enabled);

    let primary_healthy = primary.map_or(false, |p| {
        health.iter().find(|h| h.provider_id == p.id)
            .map_or(true, |h| h.status != HealthStatus::Down && h.error_rate < 0.5)
    });

    let should_fallback = trigger.is_some() || !primary_healthy;

    if should_fallback {
        if let Some(fb) = mimo {
            let model = select_model_for_task(fb, task_type, needs_tools);
            return RoutingDecision {
                id: format!("rd-fb-{}", now),
                timestamp: now,
                task_type: task_type.to_string(),
                selected_provider: fb.id.clone(),
                selected_model: model.id.clone(),
                reason: format!(
                    "Inline fallback to MiMo: {}",
                    trigger.as_ref().map_or("primary unhealthy", |t| t.label())
                ),
                estimated_cost: (model.input_price_per_m + model.output_price_per_m) / 2000.0,
                fallback_used: true,
                provider_role: Some("Fallback".to_string()),
                fallback_reason: trigger.map(|t| t.label().to_string()),
                routing_strategy: Some("InlineFallback".to_string()),
            };
        }
    }

    // Primary is healthy — use it
    if let Some(p) = primary {
        let model = select_model_for_task(p, task_type, needs_tools);
        return RoutingDecision {
            id: format!("rd-{}", now),
            timestamp: now,
            task_type: task_type.to_string(),
            selected_provider: p.id.clone(),
            selected_model: model.id.clone(),
            reason: format!("Primary provider {} healthy", p.name),
            estimated_cost: (model.input_price_per_m + model.output_price_per_m) / 2000.0,
            fallback_used: false,
            provider_role: Some("Primary".to_string()),
            fallback_reason: None,
            routing_strategy: Some("InlineFallback".to_string()),
        };
    }

    // Absolute fallback
    RoutingDecision {
        id: format!("rd-{}", now),
        timestamp: now,
        task_type: task_type.to_string(),
        selected_provider: config.default_provider,
        selected_model: config.default_model,
        reason: "No providers available for inline fallback".to_string(),
        estimated_cost: 0.0,
        fallback_used: true,
        provider_role: None,
        fallback_reason: None,
        routing_strategy: Some("InlineFallback".to_string()),
    }
}

/// Route for background intelligence tasks (summaries, indexing, compression)
pub fn route_background_intelligence(task_type: &str) -> RoutingDecision {
    let providers = list_providers();
    let now = current_timestamp_ms();

    // Prefer MiMo for background tasks (cheapest)
    let mimo = providers.iter().find(|p| p.id == "mimo" && p.enabled);

    if let Some(provider) = mimo {
        let model = provider.models.first().cloned().unwrap_or(ModelConfig {
            id: "mimo-7b".to_string(),
            name: "MiMo 7B".to_string(),
            max_tokens: 8192,
            input_price_per_m: 0.05,
            output_price_per_m: 0.10,
            supports_streaming: true,
            supports_tools: false,
            context_window: 32000,
        });

        return RoutingDecision {
            id: format!("rd-bg-{}", now),
            timestamp: now,
            task_type: task_type.to_string(),
            selected_provider: provider.id.clone(),
            selected_model: model.id.clone(),
            reason: format!("Background intelligence: {} via MiMo (cost-optimized)", task_type),
            estimated_cost: (model.input_price_per_m + model.output_price_per_m) / 2000.0,
            fallback_used: false,
            provider_role: Some("Background".to_string()),
            fallback_reason: None,
            routing_strategy: Some("BackgroundIntelligence".to_string()),
        };
    }

    // Fall back to cheapest enabled provider
    let cheapest = providers.iter()
        .filter(|p| p.enabled)
        .flat_map(|p| p.models.iter().map(move |m| (p, m)))
        .min_by(|a, b| {
            let cost_a = a.1.input_price_per_m + a.1.output_price_per_m;
            let cost_b = b.1.input_price_per_m + b.1.output_price_per_m;
            cost_a.partial_cmp(&cost_b).unwrap_or(std::cmp::Ordering::Equal)
        });

    match cheapest {
        Some((provider, model)) => RoutingDecision {
            id: format!("rd-bg-{}", now),
            timestamp: now,
            task_type: task_type.to_string(),
            selected_provider: provider.id.clone(),
            selected_model: model.id.clone(),
            reason: format!("Background intelligence via {} (MiMo unavailable)", provider.name),
            estimated_cost: (model.input_price_per_m + model.output_price_per_m) / 2000.0,
            fallback_used: true,
            provider_role: Some("Background".to_string()),
            fallback_reason: Some("mimo_unavailable".to_string()),
            routing_strategy: Some("BackgroundIntelligence".to_string()),
        },
        None => RoutingDecision {
            id: format!("rd-bg-{}", now),
            timestamp: now,
            task_type: task_type.to_string(),
            selected_provider: "deepseek".to_string(),
            selected_model: "deepseek-chat".to_string(),
            reason: "No providers available for background intelligence".to_string(),
            estimated_cost: 0.0,
            fallback_used: true,
            provider_role: Some("Background".to_string()),
            fallback_reason: None,
            routing_strategy: Some("BackgroundIntelligence".to_string()),
        },
    }
}

/// Route for design-focused tasks
pub fn route_design_focused(task_type: &str, needs_tools: bool) -> RoutingDecision {
    let providers = list_providers();
    let health = load_health();
    let now = current_timestamp_ms();

    // Design tasks need high-quality providers
    let enabled: Vec<&Provider> = providers.iter()
        .filter(|p| p.enabled)
        .filter(|p| {
            health.iter().find(|h| h.provider_id == p.id)
                .map_or(true, |h| h.status != HealthStatus::Down)
        })
        .collect();

    // Prefer high context + quality for design tasks
    let mut best: Option<(&Provider, &ModelConfig, f64)> = None;
    for provider in &enabled {
        for model in &provider.models {
            if needs_tools && !model.supports_tools {
                continue;
            }
            let score = model.context_window as f64 * 0.001
                + model.output_price_per_m * 5.0
                + model.max_tokens as f64 * 0.01;
            if best.is_none() || score > best.as_ref().unwrap().2 {
                best = Some((provider, model, score));
            }
        }
    }

    match best {
        Some((provider, model, _)) => RoutingDecision {
            id: format!("rd-design-{}", now),
            timestamp: now,
            task_type: task_type.to_string(),
            selected_provider: provider.id.clone(),
            selected_model: model.id.clone(),
            reason: format!("Design-focused routing: {} ({}) — quality-first for UI/UX tasks", model.name, provider.name),
            estimated_cost: (model.input_price_per_m + model.output_price_per_m) / 2000.0,
            fallback_used: false,
            provider_role: Some("Design".to_string()),
            fallback_reason: None,
            routing_strategy: Some("DesignFocused".to_string()),
        },
        None => RoutingDecision {
            id: format!("rd-design-{}", now),
            timestamp: now,
            task_type: task_type.to_string(),
            selected_provider: "deepseek".to_string(),
            selected_model: "deepseek-chat".to_string(),
            reason: "No providers available for design-focused routing".to_string(),
            estimated_cost: 0.0,
            fallback_used: true,
            provider_role: Some("Design".to_string()),
            fallback_reason: None,
            routing_strategy: Some("DesignFocused".to_string()),
        },
    }
}

fn select_model_for_task<'a>(provider: &'a Provider, task_type: &str, needs_tools: bool) -> &'a ModelConfig {
    let candidates: Vec<&ModelConfig> = provider.models.iter()
        .filter(|m| !needs_tools || m.supports_tools)
        .collect();

    if candidates.is_empty() {
        return provider.models.first().unwrap_or_else(|| {
            // This should never happen but provides a safe fallback
            &provider.models[0]
        });
    }

    match task_type {
        "summary" | "compression" | "indexing" | "labeling" | "tagging" => {
            // Cheapest model for background tasks
            candidates.iter()
                .min_by(|a, b| {
                    let cost_a = a.input_price_per_m + a.output_price_per_m;
                    let cost_b = b.input_price_per_m + b.output_price_per_m;
                    cost_a.partial_cmp(&cost_b).unwrap_or(std::cmp::Ordering::Equal)
                })
                .unwrap_or(&candidates[0])
        }
        _ => {
            // Best model for other tasks
            candidates.iter()
                .max_by(|a, b| {
                    let q_a = a.context_window as f64 + a.output_price_per_m * 1000.0;
                    let q_b = b.context_window as f64 + b.output_price_per_m * 1000.0;
                    q_a.partial_cmp(&q_b).unwrap_or(std::cmp::Ordering::Equal)
                })
                .unwrap_or(&candidates[0])
        }
    }
}

/// Get provider role mapping
pub fn get_provider_roles() -> Vec<(String, ProviderRole)> {
    vec![
        ("deepseek".to_string(), ProviderRole::Primary),
        ("claude".to_string(), ProviderRole::Primary),
        ("mimo".to_string(), ProviderRole::Fallback),
        ("openai".to_string(), ProviderRole::Primary),
        ("openrouter".to_string(), ProviderRole::Primary),
        ("nous".to_string(), ProviderRole::Primary),
    ]
}

/// MiMo-specific task suitability check
pub fn is_mimo_suitable(task_type: &str) -> bool {
    matches!(task_type,
        "summary" | "compression" | "indexing" | "labeling"
        | "tagging" | "retrieval_metadata" | "memory_compression"
        | "duplicate_detection" | "session_compression"
        | "graph_labeling" | "visual_memory_tagging"
        | "background" | "lightweight_reasoning"
    )
}

/// Check if task should NOT use MiMo (critical tasks)
pub fn is_mimo_excluded(task_type: &str) -> bool {
    matches!(task_type,
        "architecture" | "debugging" | "security"
        | "critical_refactor" | "complex_orchestration"
    )
}
