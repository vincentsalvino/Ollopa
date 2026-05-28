use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

// ═══════ Constants ═══════

/// Approximate tokens per character (conservative estimate for English text)
const CHARS_PER_TOKEN: f64 = 3.5;

/// DeepSeek v4-pro promo pricing per million tokens (valid until 2026/05/31)
const INPUT_PRICE_PER_M: f64 = 0.435;
const OUTPUT_PRICE_PER_M: f64 = 0.87;

/// Default monthly budget in USD
const DEFAULT_MONTHLY_BUDGET: f64 = 10.0;

/// Default max context tokens for prompt injection
const DEFAULT_MAX_CONTEXT_TOKENS: usize = 4000;

// ═══════ Data Structures ═══════

/// Token budget configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenBudget {
    pub monthly_budget_usd: f64,
    pub max_context_tokens: usize,
    pub max_summary_tokens: usize,
    pub max_decision_tokens: usize,
    pub max_memory_tokens: usize,
    pub rolling_window_days: u32,
    pub cache_ttl_minutes: u32,
}

impl Default for TokenBudget {
    fn default() -> Self {
        Self {
            monthly_budget_usd: DEFAULT_MONTHLY_BUDGET,
            max_context_tokens: DEFAULT_MAX_CONTEXT_TOKENS,
            max_summary_tokens: 1500,
            max_decision_tokens: 1000,
            max_memory_tokens: 500,
            rolling_window_days: 30,
            cache_ttl_minutes: 15,
        }
    }
}

/// A chunk of text with token metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticChunk {
    pub id: String,
    pub content: String,
    pub token_count: usize,
    pub source_type: String,
    pub source_id: String,
    pub relevance_score: f64,
    pub created_at: u64,
}

/// Rolling summary — a compressed version of older session summaries
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RollingSummary {
    pub id: String,
    pub period_start: u64,
    pub period_end: u64,
    pub session_count: usize,
    pub content: String,
    pub token_count: usize,
    pub key_themes: Vec<String>,
    pub files_touched: Vec<String>,
    pub created_at: u64,
}

/// Cached prompt context with TTL
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedContext {
    pub key: String,
    pub content: String,
    pub token_count: usize,
    pub created_at: u64,
    pub expires_at: u64,
    pub hit_count: u32,
}

/// Token usage tracking for budget management
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenUsageRecord {
    pub date: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cost_usd: f64,
    pub session_count: u32,
}

/// Optimization statistics
#[derive(Debug, Clone, Serialize)]
pub struct OptimizationStats {
    pub budget: TokenBudget,
    pub current_month_usage: MonthUsage,
    pub cache_stats: CacheStats,
    pub rolling_summary_count: usize,
    pub total_chunks: usize,
    pub estimated_savings_pct: f64,
    pub budget_remaining_usd: f64,
    pub daily_average_cost: f64,
    pub projected_monthly_cost: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct MonthUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub total_cost_usd: f64,
    pub days_tracked: u32,
    pub session_count: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct CacheStats {
    pub total_entries: usize,
    pub active_entries: usize,
    pub total_hits: u32,
    pub total_token_savings: u64,
    pub cache_hit_rate: f64,
}

/// Result of an optimization pass
#[derive(Debug, Clone, Serialize)]
pub struct OptimizationResult {
    pub summaries_rolled: usize,
    pub chunks_created: usize,
    pub cache_entries_pruned: usize,
    pub tokens_saved: usize,
    pub new_context_tokens: usize,
}

// ═══════ Storage Paths ═══════

fn optimizer_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/home/ubuntu"))
        .join(".ollopa")
        .join("workspace-brain")
        .join("optimizer")
}

fn budget_path() -> PathBuf {
    optimizer_dir().join("budget.json")
}

fn rolling_dir() -> PathBuf {
    optimizer_dir().join("rolling")
}

fn cache_dir() -> PathBuf {
    optimizer_dir().join("cache")
}

fn chunks_dir() -> PathBuf {
    optimizer_dir().join("chunks")
}

fn usage_dir() -> PathBuf {
    optimizer_dir().join("usage")
}

fn ensure_dirs() {
    let _ = fs::create_dir_all(rolling_dir());
    let _ = fs::create_dir_all(cache_dir());
    let _ = fs::create_dir_all(chunks_dir());
    let _ = fs::create_dir_all(usage_dir());
}

fn current_timestamp_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// ═══════ Token Estimation ═══════

/// Estimate token count from text
pub fn estimate_tokens(text: &str) -> usize {
    (text.len() as f64 / CHARS_PER_TOKEN).ceil() as usize
}

/// Estimate cost for given token counts
pub fn estimate_cost(input_tokens: u64, output_tokens: u64) -> f64 {
    (input_tokens as f64 / 1_000_000.0) * INPUT_PRICE_PER_M
        + (output_tokens as f64 / 1_000_000.0) * OUTPUT_PRICE_PER_M
}

// ═══════ Budget Management ═══════

/// Load the current token budget (or default)
pub fn load_budget() -> TokenBudget {
    fs::read_to_string(budget_path())
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_default()
}

/// Save token budget configuration
pub fn save_budget(budget: &TokenBudget) -> Result<(), String> {
    ensure_dirs();
    let json = serde_json::to_string_pretty(budget)
        .map_err(|e| format!("Failed to serialize budget: {}", e))?;
    fs::write(budget_path(), json)
        .map_err(|e| format!("Failed to write budget: {}", e))
}

/// Record daily token usage
pub fn record_usage(input_tokens: u64, output_tokens: u64) -> Result<(), String> {
    ensure_dirs();
    let today = chrono_today();
    let path = usage_dir().join(format!("{}.json", today));

    let mut record = if let Ok(content) = fs::read_to_string(&path) {
        serde_json::from_str::<TokenUsageRecord>(&content).unwrap_or(TokenUsageRecord {
            date: today.clone(),
            input_tokens: 0,
            output_tokens: 0,
            cost_usd: 0.0,
            session_count: 0,
        })
    } else {
        TokenUsageRecord {
            date: today,
            input_tokens: 0,
            output_tokens: 0,
            cost_usd: 0.0,
            session_count: 0,
        }
    };

    record.input_tokens += input_tokens;
    record.output_tokens += output_tokens;
    record.cost_usd = estimate_cost(record.input_tokens, record.output_tokens);
    record.session_count += 1;

    let json = serde_json::to_string_pretty(&record)
        .map_err(|e| format!("Failed to serialize usage: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("Failed to write usage: {}", e))
}

/// Get usage for current month
fn get_month_usage(window_days: u32) -> MonthUsage {
    let mut total_input: u64 = 0;
    let mut total_output: u64 = 0;
    let mut session_count: u32 = 0;
    let mut days_tracked: u32 = 0;

    if let Ok(entries) = fs::read_dir(usage_dir()) {
        let cutoff_ms = current_timestamp_ms().saturating_sub(window_days as u64 * 86_400_000);

        for entry in entries.flatten() {
            let fpath = entry.path();
            if fpath.extension().map_or(false, |e| e == "json") {
                if let Ok(content) = fs::read_to_string(&fpath) {
                    if let Ok(record) = serde_json::from_str::<TokenUsageRecord>(&content) {
                        // Parse date to check if within window
                        if is_date_in_window(&record.date, cutoff_ms) {
                            total_input += record.input_tokens;
                            total_output += record.output_tokens;
                            session_count += record.session_count;
                            days_tracked += 1;
                        }
                    }
                }
            }
        }
    }

    MonthUsage {
        input_tokens: total_input,
        output_tokens: total_output,
        total_cost_usd: estimate_cost(total_input, total_output),
        days_tracked,
        session_count,
    }
}

fn is_date_in_window(date_str: &str, cutoff_ms: u64) -> bool {
    // Parse YYYY-MM-DD format
    let parts: Vec<&str> = date_str.split('-').collect();
    if parts.len() != 3 {
        return false;
    }
    let year: i32 = parts[0].parse().unwrap_or(0);
    let month: u32 = parts[1].parse().unwrap_or(0);
    let day: u32 = parts[2].parse().unwrap_or(0);

    if year == 0 || month == 0 || day == 0 {
        return false;
    }

    // Approximate: days since epoch
    let approx_days = (year as u64 - 1970) * 365 + (month as u64 - 1) * 30 + day as u64;
    let approx_ms = approx_days * 86_400_000;
    approx_ms >= cutoff_ms
}

fn chrono_today() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let days = now / 86400;
    // Approximate date calculation
    let years = days / 365;
    let remaining = days % 365;
    let months = remaining / 30;
    let day = remaining % 30 + 1;
    format!("{:04}-{:02}-{:02}", 1970 + years, months + 1, day)
}

// ═══════ Auto-Compaction ═══════

pub fn should_compact(messages: &[crate::api_client::ChatMessage]) -> Option<usize> {
    let budget = load_budget();
    let total: usize = messages.iter().map(|m| estimate_tokens(&m.content)).sum();
    if total > budget.max_context_tokens {
        // Find index such that removing messages before it brings us under budget
        let mut running = 0;
        for (i, msg) in messages.iter().enumerate() {
            running += estimate_tokens(&msg.content);
            if total - running <= budget.max_context_tokens {
                return Some(i + 1);
            }
        }
        Some(messages.len() / 2)
    } else {
        None
    }
}

pub fn summarize_messages(messages: &[crate::api_client::ChatMessage]) -> String {
    let mut summary = String::from("Summary of earlier conversation:\n");
    for msg in messages {
        let role = &msg.role;
        let preview = if msg.content.len() > 150 {
            format!("{}...", &msg.content[..147])
        } else {
            msg.content.clone()
        };
        summary.push_str(&format!("- [{}]: {}\n", role, preview));
    }
    summary
}

// ═══════ Budget Alerts ═══════

#[derive(Debug, Clone, Serialize)]
pub enum BudgetAlertLevel {
    Ok,
    Warning,
    Critical,
    Exceeded,
}

pub fn check_budget_alert() -> (BudgetAlertLevel, f64, f64) {
    let budget = load_budget();
    let usage = get_month_usage(budget.rolling_window_days);
    let pct = if budget.monthly_budget_usd > 0.0 {
        (usage.total_cost_usd / budget.monthly_budget_usd) * 100.0
    } else {
        0.0
    };
    let remaining = (budget.monthly_budget_usd - usage.total_cost_usd).max(0.0);
    let level = if pct >= 95.0 {
        BudgetAlertLevel::Exceeded
    } else if pct >= 80.0 {
        BudgetAlertLevel::Critical
    } else if pct >= 50.0 {
        BudgetAlertLevel::Warning
    } else {
        BudgetAlertLevel::Ok
    };
    (level, pct, remaining)
}

// ═══════ Rolling Summaries ═══════

/// Generate rolling summaries from older session summaries
pub fn generate_rolling_summaries() -> Result<usize, String> {
    let summaries = crate::second_brain::list_summaries(None);
    let budget = load_budget();

    if summaries.is_empty() {
        return Ok(0);
    }

    // Group summaries by week (7-day windows)
    let now = current_timestamp_ms();
    let window_ms = 7 * 24 * 60 * 60 * 1000_u64;
    let mut weekly_groups: HashMap<u64, Vec<&crate::second_brain::SessionSummary>> = HashMap::new();

    for s in &summaries {
        // Only roll up summaries older than the rolling window
        let age_days = (now.saturating_sub(s.created_at)) / 86_400_000;
        if age_days < budget.rolling_window_days as u64 {
            continue;
        }
        let week_key = s.created_at / window_ms;
        weekly_groups.entry(week_key).or_default().push(s);
    }

    let existing_rolling = list_rolling_summaries();
    let existing_periods: Vec<(u64, u64)> = existing_rolling
        .iter()
        .map(|r| (r.period_start, r.period_end))
        .collect();

    let mut rolled = 0;

    for (week_key, group) in &weekly_groups {
        if group.len() < 2 {
            continue;
        }

        let period_start = group.iter().map(|s| s.created_at).min().unwrap_or(0);
        let period_end = group.iter().map(|s| s.created_at).max().unwrap_or(0);

        // Skip if we already have a rolling summary for this period
        if existing_periods.iter().any(|(s, e)| {
            (period_start >= *s && period_start <= *e) || (period_end >= *s && period_end <= *e)
        }) {
            continue;
        }

        // Compress: merge titles, combine key actions, deduplicate files
        let titles: Vec<String> = group.iter().map(|s| s.title.clone()).collect();
        let all_actions: Vec<String> = group.iter().flat_map(|s| s.key_actions.clone()).collect();
        let mut all_files: Vec<String> = group.iter().flat_map(|s| s.files_touched.clone()).collect();
        all_files.sort();
        all_files.dedup();

        let mut all_tags: Vec<String> = group.iter().flat_map(|s| s.tags.clone()).collect();
        all_tags.sort();
        all_tags.dedup();

        // Build compressed content
        let content = format!(
            "Week of {} sessions:\n\nTopics: {}\n\nKey actions: {}\n\nFiles: {}",
            group.len(),
            titles.join("; "),
            if all_actions.len() > 10 {
                format!("{} (and {} more)", all_actions[..10].join("; "), all_actions.len() - 10)
            } else {
                all_actions.join("; ")
            },
            if all_files.len() > 15 {
                format!("{} (and {} more)", all_files[..15].join(", "), all_files.len() - 15)
            } else {
                all_files.join(", ")
            }
        );

        let token_count = estimate_tokens(&content);

        let rolling = RollingSummary {
            id: format!("roll-{}-{}", week_key, current_timestamp_ms()),
            period_start,
            period_end,
            session_count: group.len(),
            content,
            token_count,
            key_themes: all_tags.into_iter().take(10).collect(),
            files_touched: all_files,
            created_at: current_timestamp_ms(),
        };

        if let Ok(json) = serde_json::to_string_pretty(&rolling) {
            let path = rolling_dir().join(format!("{}.json", rolling.id));
            let _ = fs::write(path, json);
            rolled += 1;
        }
    }

    Ok(rolled)
}

/// List all rolling summaries
pub fn list_rolling_summaries() -> Vec<RollingSummary> {
    let mut results: Vec<RollingSummary> = Vec::new();
    let dir = rolling_dir();

    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |e| e == "json") {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(rs) = serde_json::from_str::<RollingSummary>(&content) {
                        results.push(rs);
                    }
                }
            }
        }
    }

    results.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    results
}

// ═══════ Semantic Chunking ═══════

/// Break text into semantically coherent chunks within a token budget
pub fn chunk_text(
    text: &str,
    source_type: &str,
    source_id: &str,
    max_chunk_tokens: usize,
) -> Vec<SemanticChunk> {
    let mut chunks = Vec::new();

    // Split by paragraph boundaries first
    let paragraphs: Vec<&str> = text.split("\n\n").collect();
    let mut current_chunk = String::new();
    let mut chunk_idx = 0;

    for paragraph in paragraphs {
        let para_tokens = estimate_tokens(paragraph);

        // If single paragraph exceeds limit, split by sentences
        if para_tokens > max_chunk_tokens {
            // Flush current buffer first
            if !current_chunk.is_empty() {
                chunks.push(make_chunk(
                    &current_chunk,
                    source_type,
                    source_id,
                    chunk_idx,
                ));
                chunk_idx += 1;
                current_chunk.clear();
            }

            // Split paragraph by sentence boundaries
            let sentences: Vec<&str> = paragraph
                .split(|c: char| c == '.' || c == '!' || c == '?')
                .filter(|s| !s.trim().is_empty())
                .collect();

            let mut sentence_buf = String::new();
            for sentence in sentences {
                let combined_tokens = estimate_tokens(&format!("{} {}", sentence_buf, sentence));
                if combined_tokens > max_chunk_tokens && !sentence_buf.is_empty() {
                    chunks.push(make_chunk(
                        &sentence_buf,
                        source_type,
                        source_id,
                        chunk_idx,
                    ));
                    chunk_idx += 1;
                    sentence_buf = sentence.trim().to_string();
                } else {
                    if !sentence_buf.is_empty() {
                        sentence_buf.push_str(". ");
                    }
                    sentence_buf.push_str(sentence.trim());
                }
            }
            if !sentence_buf.is_empty() {
                chunks.push(make_chunk(
                    &sentence_buf,
                    source_type,
                    source_id,
                    chunk_idx,
                ));
                chunk_idx += 1;
            }
        } else {
            let combined_tokens = estimate_tokens(&format!("{}\n\n{}", current_chunk, paragraph));
            if combined_tokens > max_chunk_tokens && !current_chunk.is_empty() {
                chunks.push(make_chunk(
                    &current_chunk,
                    source_type,
                    source_id,
                    chunk_idx,
                ));
                chunk_idx += 1;
                current_chunk = paragraph.to_string();
            } else {
                if !current_chunk.is_empty() {
                    current_chunk.push_str("\n\n");
                }
                current_chunk.push_str(paragraph);
            }
        }
    }

    // Flush remaining
    if !current_chunk.is_empty() {
        chunks.push(make_chunk(
            &current_chunk,
            source_type,
            source_id,
            chunk_idx,
        ));
    }

    chunks
}

fn make_chunk(content: &str, source_type: &str, source_id: &str, idx: usize) -> SemanticChunk {
    SemanticChunk {
        id: format!("chunk-{}-{}-{}", source_type, source_id, idx),
        content: content.to_string(),
        token_count: estimate_tokens(content),
        source_type: source_type.to_string(),
        source_id: source_id.to_string(),
        relevance_score: 1.0,
        created_at: current_timestamp_ms(),
    }
}

/// Save semantic chunks to disk
pub fn save_chunks(chunks: &[SemanticChunk]) -> Result<usize, String> {
    ensure_dirs();
    let mut saved = 0;
    for chunk in chunks {
        if let Ok(json) = serde_json::to_string_pretty(chunk) {
            let path = chunks_dir().join(format!("{}.json", chunk.id));
            if fs::write(&path, json).is_ok() {
                saved += 1;
            }
        }
    }
    Ok(saved)
}

/// List all chunks (optionally filtered by source)
pub fn list_chunks(source_type: Option<&str>) -> Vec<SemanticChunk> {
    let mut results: Vec<SemanticChunk> = Vec::new();
    let dir = chunks_dir();

    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |e| e == "json") {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(chunk) = serde_json::from_str::<SemanticChunk>(&content) {
                        if let Some(st) = source_type {
                            if chunk.source_type == st {
                                results.push(chunk);
                            }
                        } else {
                            results.push(chunk);
                        }
                    }
                }
            }
        }
    }

    results.sort_by(|a, b| b.relevance_score.partial_cmp(&a.relevance_score).unwrap_or(std::cmp::Ordering::Equal));
    results
}

// ═══════ Prompt Cache ═══════

/// Get a cached prompt context, or None if expired/missing
pub fn get_cached_context(key: &str) -> Option<CachedContext> {
    let path = cache_dir().join(format!("{}.json", key));
    let content = fs::read_to_string(&path).ok()?;
    let mut cached: CachedContext = serde_json::from_str(&content).ok()?;

    let now = current_timestamp_ms();
    if now > cached.expires_at {
        let _ = fs::remove_file(&path);
        return None;
    }

    // Update hit count
    cached.hit_count += 1;
    if let Ok(json) = serde_json::to_string_pretty(&cached) {
        let _ = fs::write(&path, json);
    }

    Some(cached)
}

/// Store a prompt context in cache
pub fn cache_context(key: &str, content: &str) -> Result<(), String> {
    ensure_dirs();
    let budget = load_budget();
    let ttl_ms = budget.cache_ttl_minutes as u64 * 60 * 1000;
    let now = current_timestamp_ms();

    let cached = CachedContext {
        key: key.to_string(),
        content: content.to_string(),
        token_count: estimate_tokens(content),
        created_at: now,
        expires_at: now + ttl_ms,
        hit_count: 0,
    };

    let json = serde_json::to_string_pretty(&cached)
        .map_err(|e| format!("Failed to serialize cache entry: {}", e))?;
    let path = cache_dir().join(format!("{}.json", key));
    fs::write(&path, json).map_err(|e| format!("Failed to write cache: {}", e))
}

/// Prune expired cache entries
pub fn prune_cache() -> usize {
    let now = current_timestamp_ms();
    let mut pruned = 0;

    if let Ok(entries) = fs::read_dir(cache_dir()) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |e| e == "json") {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(cached) = serde_json::from_str::<CachedContext>(&content) {
                        if now > cached.expires_at {
                            let _ = fs::remove_file(&path);
                            pruned += 1;
                        }
                    }
                }
            }
        }
    }

    pruned
}

/// Get cache statistics
fn get_cache_stats() -> CacheStats {
    let now = current_timestamp_ms();
    let mut total_entries = 0;
    let mut active_entries = 0;
    let mut total_hits: u32 = 0;
    let mut total_token_savings: u64 = 0;

    if let Ok(entries) = fs::read_dir(cache_dir()) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |e| e == "json") {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(cached) = serde_json::from_str::<CachedContext>(&content) {
                        total_entries += 1;
                        if now <= cached.expires_at {
                            active_entries += 1;
                        }
                        total_hits += cached.hit_count;
                        total_token_savings += cached.hit_count as u64 * cached.token_count as u64;
                    }
                }
            }
        }
    }

    let cache_hit_rate = if total_entries > 0 {
        total_hits as f64 / total_entries as f64
    } else {
        0.0
    };

    CacheStats {
        total_entries,
        active_entries,
        total_hits,
        total_token_savings,
        cache_hit_rate,
    }
}

// ═══════ Optimized Context Generation ═══════

/// Build an optimized context string for prompt injection
/// This is the key optimization: it respects token budgets, uses caching,
/// prefers rolling summaries over raw summaries, and chunks semantically
pub fn build_optimized_context(
    project_path: Option<&str>,
    query: Option<&str>,
) -> String {
    let budget = load_budget();

    // Check cache first
    let cache_key = format!(
        "ctx-{}-{}",
        project_path.unwrap_or("global"),
        query.unwrap_or("default")
    );
    if let Some(cached) = get_cached_context(&cache_key) {
        return cached.content;
    }

    let mut parts: Vec<String> = Vec::new();
    let mut remaining_tokens = budget.max_context_tokens;
    // Track content fingerprints to prevent duplicate injection
    let mut seen_content: std::collections::HashSet<u64> = std::collections::HashSet::new();

    let content_fingerprint = |s: &str| -> u64 {
        use std::hash::{Hash, Hasher};
        use std::collections::hash_map::DefaultHasher;
        let normalized = s.to_lowercase().split_whitespace().collect::<Vec<_>>().join(" ");
        let mut h = DefaultHasher::new();
        normalized.hash(&mut h);
        h.finish()
    };

    // 1. Recent decisions (highest priority, capped)
    let decisions = crate::second_brain::list_decisions(project_path);
    let decision_budget = budget.max_decision_tokens.min(remaining_tokens);
    let mut decision_tokens = 0;
    for d in decisions.iter().take(5) {
        let entry = format!("[Decision] {} — {} ({})", d.title, d.decision, d.tags.join(", "));
        let fp = content_fingerprint(&entry);
        if seen_content.contains(&fp) { continue; }
        let tokens = estimate_tokens(&entry);
        if decision_tokens + tokens > decision_budget {
            break;
        }
        seen_content.insert(fp);
        parts.push(entry);
        decision_tokens += tokens;
    }
    remaining_tokens = remaining_tokens.saturating_sub(decision_tokens);

    // 2. Rolling summaries first (cheaper), then recent individual summaries
    let rolling = list_rolling_summaries();
    let summary_budget = budget.max_summary_tokens.min(remaining_tokens);
    let mut summary_tokens = 0;

    for rs in rolling.iter().take(3) {
        let entry = format!(
            "[Rolling Summary] {} sessions: {}",
            rs.session_count,
            truncate(&rs.content, 300)
        );
        let fp = content_fingerprint(&entry);
        if seen_content.contains(&fp) { continue; }
        let tokens = estimate_tokens(&entry);
        if summary_tokens + tokens > summary_budget {
            break;
        }
        seen_content.insert(fp);
        parts.push(entry);
        summary_tokens += tokens;
    }

    // Fill remaining summary budget with recent individual summaries
    let summaries = crate::second_brain::list_summaries(project_path);
    for s in summaries.iter().take(3) {
        let entry = format!("[Session] {} — {}", s.title, truncate(&s.summary, 150));
        let fp = content_fingerprint(&entry);
        if seen_content.contains(&fp) { continue; }
        let tokens = estimate_tokens(&entry);
        if summary_tokens + tokens > summary_budget {
            break;
        }
        seen_content.insert(fp);
        parts.push(entry);
        summary_tokens += tokens;
    }
    remaining_tokens = remaining_tokens.saturating_sub(summary_tokens);

    // 3. Relevant search results if query provided
    if let Some(q) = query {
        if !q.is_empty() {
            let results = crate::second_brain::search(q, project_path, 5);
            let search_budget = remaining_tokens / 2;
            let mut search_tokens = 0;
            for r in results {
                let entry = format!("[Relevant] {}", truncate(&r.snippet, 100));
                let fp = content_fingerprint(&entry);
                if seen_content.contains(&fp) { continue; }
                let tokens = estimate_tokens(&entry);
                if search_tokens + tokens > search_budget {
                    break;
                }
                seen_content.insert(fp);
                parts.push(entry);
                search_tokens += tokens;
            }
            remaining_tokens = remaining_tokens.saturating_sub(search_tokens);
        }
    }

    // 4. Memory file (lowest priority, gets remaining budget)
    let memory_budget = budget.max_memory_tokens.min(remaining_tokens);
    let memory = crate::memory::read_memory_full();
    if !memory.is_empty() {
        let mem_tokens = estimate_tokens(&memory);
        if mem_tokens <= memory_budget {
            parts.push(format!("[Memory]\n{}", memory));
        } else {
            // Take last N lines that fit
            let lines: Vec<&str> = memory.lines().collect();
            let mut compressed = Vec::new();
            let mut used = 0;
            for line in lines.iter().rev() {
                let lt = estimate_tokens(line);
                if used + lt > memory_budget {
                    break;
                }
                compressed.push(*line);
                used += lt;
            }
            compressed.reverse();
            if !compressed.is_empty() {
                parts.push(format!("[Memory (recent)]\n{}", compressed.join("\n")));
            }
        }
    }

    let context = parts.join("\n\n---\n\n");

    // Cache the result
    let _ = cache_context(&cache_key, &context);

    context
}

// ═══════ Full Optimization Pass ═══════

/// Run a complete optimization pass: roll up summaries, prune cache, rebuild chunks
pub fn run_optimization() -> Result<OptimizationResult, String> {
    ensure_dirs();

    // 1. Generate rolling summaries for old data
    let summaries_rolled = generate_rolling_summaries()?;

    // 2. Chunk any large summaries
    let summaries = crate::second_brain::list_summaries(None);
    let budget = load_budget();
    let mut chunks_created = 0;
    for s in &summaries {
        if estimate_tokens(&s.summary) > budget.max_summary_tokens {
            let chunks = chunk_text(
                &s.summary,
                "summary",
                &s.session_id,
                budget.max_summary_tokens / 2,
            );
            chunks_created += save_chunks(&chunks)?;
        }
    }

    // 3. Prune expired cache
    let cache_entries_pruned = prune_cache();

    // 4. Compute savings estimate
    let raw_token_count: usize = summaries
        .iter()
        .map(|s| estimate_tokens(&s.summary))
        .sum::<usize>()
        + crate::second_brain::list_decisions(None)
            .iter()
            .map(|d| estimate_tokens(&d.decision) + estimate_tokens(&d.context))
            .sum::<usize>();

    let optimized_context = build_optimized_context(None, None);
    let new_context_tokens = estimate_tokens(&optimized_context);
    let tokens_saved = raw_token_count.saturating_sub(new_context_tokens);

    Ok(OptimizationResult {
        summaries_rolled,
        chunks_created,
        cache_entries_pruned,
        tokens_saved,
        new_context_tokens,
    })
}

// ═══════ Stats ═══════

/// Get comprehensive optimization statistics
pub fn get_optimization_stats() -> OptimizationStats {
    let budget = load_budget();
    let month_usage = get_month_usage(budget.rolling_window_days);
    let cache_stats = get_cache_stats();
    let rolling_count = list_rolling_summaries().len();
    let chunk_count = list_chunks(None).len();

    let daily_avg = if month_usage.days_tracked > 0 {
        month_usage.total_cost_usd / month_usage.days_tracked as f64
    } else {
        0.0
    };

    let projected = daily_avg * 30.0;
    let remaining = (budget.monthly_budget_usd - month_usage.total_cost_usd).max(0.0);

    // Estimate savings: compare raw context size vs optimized
    let raw_decisions: usize = crate::second_brain::list_decisions(None)
        .iter()
        .map(|d| estimate_tokens(&d.decision) + estimate_tokens(&d.context))
        .sum();
    let raw_summaries: usize = crate::second_brain::list_summaries(None)
        .iter()
        .map(|s| estimate_tokens(&s.summary))
        .sum();
    let raw_total = raw_decisions + raw_summaries;
    let optimized_total = budget.max_context_tokens.min(raw_total);
    let savings_pct = if raw_total > 0 {
        ((raw_total - optimized_total) as f64 / raw_total as f64) * 100.0
    } else {
        0.0
    };

    OptimizationStats {
        budget,
        current_month_usage: month_usage,
        cache_stats,
        rolling_summary_count: rolling_count,
        total_chunks: chunk_count,
        estimated_savings_pct: (savings_pct * 10.0).round() / 10.0,
        budget_remaining_usd: (remaining * 10000.0).round() / 10000.0,
        daily_average_cost: (daily_avg * 10000.0).round() / 10000.0,
        projected_monthly_cost: (projected * 100.0).round() / 100.0,
    }
}

/// Clear all optimization data
pub fn clear_optimization_data() -> Result<(), String> {
    let dirs = [rolling_dir(), cache_dir(), chunks_dir(), usage_dir()];
    for dir in &dirs {
        if dir.exists() {
            if let Ok(entries) = fs::read_dir(dir) {
                for entry in entries.flatten() {
                    let _ = fs::remove_file(entry.path());
                }
            }
        }
    }
    Ok(())
}

// ═══════ Helpers ═══════

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}...", &s[..max.min(s.len())])
    }
}
