use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

// ═══════ Data Structures ═══════

/// A session summary — compressed representation of a session's key events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionSummary {
    pub session_id: String,
    pub project_path: Option<String>,
    pub created_at: u64,
    pub title: String,
    pub summary: String,
    pub key_actions: Vec<String>,
    pub files_touched: Vec<String>,
    pub decisions_made: Vec<String>,
    pub tags: Vec<String>,
    pub token_count: u32,
}

/// An architectural decision record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Decision {
    pub id: String,
    pub created_at: u64,
    pub project_path: Option<String>,
    pub title: String,
    pub context: String,
    pub decision: String,
    pub rationale: String,
    pub tags: Vec<String>,
    pub status: DecisionStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum DecisionStatus {
    Active,
    Superseded,
    Deprecated,
}

/// A memory entry in the semantic index
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexEntry {
    pub id: String,
    pub source_type: String, // "summary", "decision", "memory", "note"
    pub source_id: String,
    pub content: String,
    pub keywords: Vec<String>,
    pub project_path: Option<String>,
    pub created_at: u64,
    pub relevance_score: f64,
}

/// Search result from semantic retrieval
#[derive(Debug, Clone, Serialize)]
pub struct SearchResult {
    pub entry: IndexEntry,
    pub score: f64,
    pub snippet: String,
}

// ═══════ Skill Acquisition (Phase 3) ═══════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill {
    pub id: String,
    pub task_pattern: String,
    pub tool_sequence: Vec<String>,
    pub files_involved: Vec<String>,
    pub success_count: u32,
    pub created_at: u64,
    pub last_used: u64,
    pub project_path: Option<String>,
}

/// Workspace intelligence overview
#[derive(Debug, Clone, Serialize)]
pub struct BrainStats {
    pub total_summaries: usize,
    pub total_decisions: usize,
    pub total_index_entries: usize,
    pub total_memory_bytes: usize,
    pub projects_tracked: Vec<String>,
    pub recent_tags: Vec<String>,
}

// ═══════ Storage Paths ═══════

fn brain_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/home/ubuntu"))
        .join(".ollopa")
        .join("workspace-brain")
}

fn summaries_dir() -> PathBuf {
    brain_dir().join("summaries")
}

fn decisions_dir() -> PathBuf {
    brain_dir().join("decisions")
}

fn index_path() -> PathBuf {
    brain_dir().join("semantic-index.json")
}

fn skills_dir() -> PathBuf {
    brain_dir().join("skills")
}

fn ensure_dirs() {
    let _ = fs::create_dir_all(summaries_dir());
    let _ = fs::create_dir_all(decisions_dir());
    let _ = fs::create_dir_all(skills_dir());
}

fn current_timestamp_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// ═══════ Session Summaries ═══════

/// Save a session summary
#[allow(dead_code)]
pub fn save_summary(summary: &SessionSummary) -> Result<(), String> {
    ensure_dirs();
    let path = summaries_dir().join(format!("{}.json", summary.session_id));
    let json = serde_json::to_string_pretty(summary)
        .map_err(|e| format!("Failed to serialize summary: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("Failed to write summary: {}", e))?;

    // Auto-index the summary
    let entry = IndexEntry {
        id: format!("idx-{}", current_timestamp_ms()),
        source_type: "summary".to_string(),
        source_id: summary.session_id.clone(),
        content: format!("{}\n{}", summary.title, summary.summary),
        keywords: extract_keywords(&format!(
            "{} {} {} {}",
            summary.title,
            summary.summary,
            summary.key_actions.join(" "),
            summary.tags.join(" ")
        )),
        project_path: summary.project_path.clone(),
        created_at: summary.created_at,
        relevance_score: 1.0,
    };
    let _ = add_to_index(&entry);

    Ok(())
}

/// List all session summaries
pub fn list_summaries(project_path: Option<&str>) -> Vec<SessionSummary> {
    ensure_dirs();
    let mut summaries: Vec<SessionSummary> = fs::read_dir(summaries_dir())
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let content = fs::read_to_string(e.path()).ok()?;
            serde_json::from_str(&content).ok()
        })
        .collect();

    if let Some(pp) = project_path {
        summaries.retain(|s| s.project_path.as_deref() == Some(pp));
    }

    summaries.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    summaries
}

/// Get a specific summary
#[allow(dead_code)]
pub fn get_summary(session_id: &str) -> Result<SessionSummary, String> {
    let path = summaries_dir().join(format!("{}.json", session_id));
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Summary not found: {}", e))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse summary: {}", e))
}

/// Delete a summary
pub fn delete_summary(session_id: &str) -> Result<(), String> {
    let path = summaries_dir().join(format!("{}.json", session_id));
    fs::remove_file(&path).map_err(|e| format!("Failed to delete summary: {}", e))
}

/// Generate a compressed summary from session events (auto-summarize)
#[allow(dead_code)]
pub fn auto_summarize_session(
    session_id: &str,
    project_path: Option<&str>,
    events: &[crate::ollopa_events::AppEvent],
) -> SessionSummary {
    let mut title = String::from("Untitled session");
    let mut key_actions: Vec<String> = Vec::new();
    let mut files_touched: Vec<String> = Vec::new();
    let mut assistant_texts: Vec<String> = Vec::new();
    let mut tags: Vec<String> = Vec::new();
    let mut tool_count = 0u32;
    let mut error_count = 0u32;

    for event in events {
        match event {
            crate::ollopa_events::AppEvent::AssistantMessage { text, .. } => {
                assistant_texts.push(text.clone());
                if title == "Untitled session" && text.len() > 10 {
                    title = truncate_str(text, 80);
                }
            }
            crate::ollopa_events::AppEvent::ToolStarted { tool_name, input, .. } => {
                tool_count += 1;
                let summary = format!("{}: {}", tool_name, compact_json_input(input));
                key_actions.push(truncate_str(&summary, 120));

                // Extract file paths from JSON Value
                if let Some(p) = input.get("path").and_then(|v| v.as_str()) {
                    if !files_touched.contains(&p.to_string()) {
                        files_touched.push(p.to_string());
                    }
                }
                if let Some(p) = input.get("file_path").and_then(|v| v.as_str()) {
                    if !files_touched.contains(&p.to_string()) {
                        files_touched.push(p.to_string());
                    }
                }

                tags.push(tool_name.clone());
            }
            crate::ollopa_events::AppEvent::ToolFinished { is_error, .. } => {
                if *is_error {
                    error_count += 1;
                }
            }
            _ => {}
        }
    }

    // Deduplicate tags
    tags.sort();
    tags.dedup();

    // Generate summary text
    let summary_parts: Vec<String> = vec![
        format!("{} tool executions", tool_count),
        format!("{} files touched", files_touched.len()),
        if error_count > 0 {
            format!("{} errors", error_count)
        } else {
            "no errors".to_string()
        },
    ];
    let summary = format!(
        "{}. First response: {}",
        summary_parts.join(", "),
        assistant_texts
            .first()
            .map(|t| truncate_str(t, 200))
            .unwrap_or_default()
    );

    // Estimate token count
    let total_text: usize = assistant_texts.iter().map(|t| t.len()).sum();
    let token_count = (total_text / 4) as u32;

    SessionSummary {
        session_id: session_id.to_string(),
        project_path: project_path.map(|s| s.to_string()),
        created_at: current_timestamp_ms(),
        title,
        summary,
        key_actions: key_actions.into_iter().take(20).collect(),
        files_touched: files_touched.into_iter().take(50).collect(),
        decisions_made: Vec::new(),
        tags,
        token_count,
    }
}

// ═══════ Decision Records ═══════

/// Save a decision
pub fn save_decision(decision: &Decision) -> Result<(), String> {
    ensure_dirs();
    let path = decisions_dir().join(format!("{}.json", decision.id));
    let json = serde_json::to_string_pretty(decision)
        .map_err(|e| format!("Failed to serialize decision: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("Failed to write decision: {}", e))?;

    // Auto-index
    let entry = IndexEntry {
        id: format!("idx-{}", current_timestamp_ms()),
        source_type: "decision".to_string(),
        source_id: decision.id.clone(),
        content: format!(
            "{}\n{}\n{}",
            decision.title, decision.context, decision.decision
        ),
        keywords: extract_keywords(&format!(
            "{} {} {} {} {}",
            decision.title,
            decision.context,
            decision.decision,
            decision.rationale,
            decision.tags.join(" ")
        )),
        project_path: decision.project_path.clone(),
        created_at: decision.created_at,
        relevance_score: 1.0,
    };
    let _ = add_to_index(&entry);

    Ok(())
}

/// List all decisions
pub fn list_decisions(project_path: Option<&str>) -> Vec<Decision> {
    ensure_dirs();
    let mut decisions: Vec<Decision> = fs::read_dir(decisions_dir())
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let content = fs::read_to_string(e.path()).ok()?;
            serde_json::from_str(&content).ok()
        })
        .collect();

    if let Some(pp) = project_path {
        decisions.retain(|d| d.project_path.as_deref() == Some(pp));
    }

    decisions.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    decisions
}

/// Delete a decision
pub fn delete_decision(id: &str) -> Result<(), String> {
    let path = decisions_dir().join(format!("{}.json", id));
    fs::remove_file(&path).map_err(|e| format!("Failed to delete decision: {}", e))
}

// ═══════ Semantic Index + Retrieval ═══════

/// Load the full index
fn load_index() -> Vec<IndexEntry> {
    let path = index_path();
    fs::read_to_string(&path)
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_default()
}

/// Save the full index
fn save_index(entries: &[IndexEntry]) -> Result<(), String> {
    ensure_dirs();
    let json = serde_json::to_string_pretty(entries)
        .map_err(|e| format!("Failed to serialize index: {}", e))?;
    fs::write(index_path(), json)
        .map_err(|e| format!("Failed to write index: {}", e))
}

/// Add an entry to the semantic index
fn add_to_index(entry: &IndexEntry) -> Result<(), String> {
    let mut index = load_index();
    index.push(entry.clone());

    // Cap index size
    if index.len() > 5000 {
        index.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        index.truncate(5000);
    }

    save_index(&index)
}

/// Index a free-form note/memory entry
pub fn index_note(
    content: &str,
    project_path: Option<&str>,
    tags: &[String],
) -> Result<(), String> {
    let entry = IndexEntry {
        id: format!("idx-{}", current_timestamp_ms()),
        source_type: "note".to_string(),
        source_id: format!("note-{}", current_timestamp_ms()),
        content: content.to_string(),
        keywords: {
            let mut kw = extract_keywords(content);
            kw.extend(tags.iter().cloned());
            kw.sort();
            kw.dedup();
            kw
        },
        project_path: project_path.map(|s| s.to_string()),
        created_at: current_timestamp_ms(),
        relevance_score: 1.0,
    };
    add_to_index(&entry)
}

/// Search the semantic index using keyword matching (BM25-inspired scoring)
pub fn search(query: &str, project_filter: Option<&str>, limit: usize) -> Vec<SearchResult> {
    let index = load_index();
    let query_keywords = extract_keywords(query);

    if query_keywords.is_empty() {
        return Vec::new();
    }

    // Compute IDF for query terms
    let total_docs = index.len() as f64;
    let mut idf: HashMap<String, f64> = HashMap::new();
    for kw in &query_keywords {
        let doc_freq = index
            .iter()
            .filter(|e| e.keywords.contains(kw) || e.content.to_lowercase().contains(&kw.to_lowercase()))
            .count() as f64;
        let idf_val = if doc_freq > 0.0 {
            ((total_docs - doc_freq + 0.5) / (doc_freq + 0.5) + 1.0).ln()
        } else {
            0.0
        };
        idf.insert(kw.clone(), idf_val);
    }

    let mut results: Vec<SearchResult> = index
        .into_iter()
        .filter(|e| {
            if let Some(pp) = project_filter {
                e.project_path.as_deref() == Some(pp)
            } else {
                true
            }
        })
        .filter_map(|entry| {
            let content_lower = entry.content.to_lowercase();
            let mut score = 0.0;

            for kw in &query_keywords {
                let kw_lower = kw.to_lowercase();
                let in_keywords = entry.keywords.iter().any(|k| k.to_lowercase() == kw_lower);
                let in_content = content_lower.contains(&kw_lower);

                if in_keywords || in_content {
                    let tf = if in_keywords { 2.0 } else { 1.0 };
                    let idf_val = idf.get(kw).copied().unwrap_or(0.0);
                    score += tf * idf_val;
                }
            }

            // Boost by recency (decay over 30 days)
            let age_days = (current_timestamp_ms().saturating_sub(entry.created_at)) as f64
                / 86_400_000.0;
            let recency_boost = 1.0 / (1.0 + age_days / 30.0);
            score *= 1.0 + 0.3 * recency_boost;

            if score > 0.0 {
                let snippet = extract_snippet(&entry.content, &query_keywords, 150);
                Some(SearchResult {
                    entry,
                    score,
                    snippet,
                })
            } else {
                None
            }
        })
        .collect();

    results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    results.truncate(limit);
    results
}

/// Get compressed context for injection into prompts
pub fn get_compressed_context(
    project_path: Option<&str>,
    max_tokens: usize,
) -> String {
    let mut parts: Vec<String> = Vec::new();
    let mut token_budget = max_tokens;

    // 1. Recent decisions (highest priority)
    let decisions = list_decisions(project_path);
    for d in decisions.iter().take(5) {
        let entry = format!(
            "Decision: {} — {} ({})",
            d.title,
            d.decision,
            d.tags.join(", ")
        );
        let tokens = entry.len() / 4;
        if tokens <= token_budget {
            parts.push(entry);
            token_budget -= tokens;
        }
    }

    // 2. Recent summaries
    let summaries = list_summaries(project_path);
    for s in summaries.iter().take(3) {
        let entry = format!(
            "Session: {} — {}",
            s.title,
            truncate_str(&s.summary, 200)
        );
        let tokens = entry.len() / 4;
        if tokens <= token_budget {
            parts.push(entry);
            token_budget -= tokens;
        }
    }

    // 3. Memory file
    let memory = crate::memory::read_memory_full();
    if !memory.is_empty() {
        let tokens = memory.len() / 4;
        if tokens <= token_budget {
            parts.push(format!("Memory:\n{}", memory));
        } else {
            // Compress: take last N lines that fit
            let lines: Vec<&str> = memory.lines().collect();
            let mut compressed = Vec::new();
            let mut used = 0;
            for line in lines.iter().rev() {
                let lt = line.len() / 4;
                if used + lt > token_budget {
                    break;
                }
                compressed.push(*line);
                used += lt;
            }
            compressed.reverse();
            if !compressed.is_empty() {
                parts.push(format!("Memory (recent):\n{}", compressed.join("\n")));
            }
        }
    }

    parts.join("\n\n---\n\n")
}

/// Get workspace intelligence stats
pub fn get_brain_stats() -> BrainStats {
    let summaries = list_summaries(None);
    let decisions = list_decisions(None);
    let index = load_index();

    let memory_size = fs::metadata(
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("/home/ubuntu"))
            .join(".ollopa")
            .join("deepseek_memory.md"),
    )
    .map(|m| m.len() as usize)
    .unwrap_or(0);

    let mut projects: Vec<String> = summaries
        .iter()
        .filter_map(|s| s.project_path.clone())
        .chain(decisions.iter().filter_map(|d| d.project_path.clone()))
        .collect();
    projects.sort();
    projects.dedup();

    let mut tags: Vec<String> = summaries
        .iter()
        .take(10)
        .flat_map(|s| s.tags.clone())
        .chain(decisions.iter().take(10).flat_map(|d| d.tags.clone()))
        .collect();
    tags.sort();
    tags.dedup();

    BrainStats {
        total_summaries: summaries.len(),
        total_decisions: decisions.len(),
        total_index_entries: index.len(),
        total_memory_bytes: memory_size,
        projects_tracked: projects,
        recent_tags: tags.into_iter().take(20).collect(),
    }
}

// ═══════ Keyword Extraction ═══════

/// Extract keywords from text (simple tokenization + stopword removal)
fn extract_keywords(text: &str) -> Vec<String> {
    let stopwords: &[&str] = &[
        "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
        "have", "has", "had", "do", "does", "did", "will", "would", "could",
        "should", "may", "might", "shall", "can", "to", "of", "in", "for",
        "on", "with", "at", "by", "from", "as", "into", "through", "during",
        "before", "after", "above", "below", "between", "out", "off", "over",
        "under", "again", "further", "then", "once", "and", "but", "or",
        "nor", "not", "so", "than", "too", "very", "just", "that", "this",
        "it", "its", "i", "me", "my", "we", "our", "you", "your", "he",
        "she", "they", "them", "his", "her", "their", "what", "which",
        "who", "whom", "when", "where", "why", "how", "all", "each",
        "every", "both", "few", "more", "most", "other", "some", "such",
        "no", "only", "own", "same", "up", "down", "here", "there",
    ];

    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric() && c != '_' && c != '-')
        .filter(|w| w.len() >= 3 && !stopwords.contains(w))
        .map(|w| w.to_string())
        .collect::<Vec<_>>()
        .into_iter()
        .take(50)
        .collect()
}

/// Extract a relevant snippet around query keywords
fn extract_snippet(content: &str, keywords: &[String], max_len: usize) -> String {
    let content_lower = content.to_lowercase();

    // Find first keyword occurrence
    let mut best_pos = 0;
    for kw in keywords {
        if let Some(pos) = content_lower.find(&kw.to_lowercase()) {
            best_pos = pos;
            break;
        }
    }

    // Extract snippet around the keyword
    let start = best_pos.saturating_sub(max_len / 2);
    let end = (start + max_len).min(content.len());
    let snippet = &content[start..end];

    if start > 0 {
        format!("...{}", snippet.trim())
    } else {
        snippet.trim().to_string()
    }
}

fn truncate_str(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}...", &s[..max])
    }
}

#[allow(dead_code)]
fn compact_json_input(input: &serde_json::Value) -> String {
    if let Some(cmd) = input.get("command").and_then(|v| v.as_str()) {
        return truncate_str(cmd, 60);
    }
    if let Some(p) = input
        .get("path")
        .or_else(|| input.get("file_path"))
        .and_then(|v| v.as_str())
    {
        return p.to_string();
    }
    if let Some(q) = input
        .get("pattern")
        .or_else(|| input.get("query"))
        .and_then(|v| v.as_str())
    {
        return truncate_str(q, 40);
    }
    String::new()
}

// ═══════════════════════════════════════════════════════════════
// UPGRADE PHASE A — Second-Brain Evolution
// Semantic embeddings (TF-IDF vectors), similarity search,
// memory ranking, knowledge compression, decision querying
// ═══════════════════════════════════════════════════════════════

/// TF-IDF based embedding vector for semantic similarity
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbeddingVector {
    pub id: String,
    pub source_id: String,
    pub source_type: String,
    pub terms: Vec<String>,
    pub weights: Vec<f64>,
    pub created_at: u64,
    pub project_path: Option<String>,
}

/// Semantic similarity result
#[derive(Debug, Clone, Serialize)]
pub struct SimilarityResult {
    pub source_id: String,
    pub source_type: String,
    pub similarity: f64,
    pub snippet: String,
}

/// Knowledge snapshot — compressed memory at a point in time
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeSnapshot {
    pub id: String,
    pub created_at: u64,
    pub project_path: Option<String>,
    pub layer: String,
    pub content: String,
    pub token_count: u32,
    pub source_count: u32,
    pub key_themes: Vec<String>,
}

/// Decision query result
#[derive(Debug, Clone, Serialize)]
pub struct DecisionQueryResult {
    pub decision: Decision,
    pub relevance: f64,
    pub related_decisions: Vec<String>,
}

/// Enhanced brain stats
#[derive(Debug, Clone, Serialize)]
pub struct EnhancedBrainStats {
    pub base: BrainStats,
    pub total_embeddings: usize,
    pub total_snapshots: usize,
    pub semantic_coverage: f64,
    pub oldest_memory_days: f64,
    pub knowledge_layers: Vec<String>,
}

fn embeddings_dir() -> PathBuf {
    brain_dir().join("embeddings")
}

fn snapshots_dir() -> PathBuf {
    brain_dir().join("snapshots")
}

fn ensure_evolution_dirs() {
    let _ = fs::create_dir_all(embeddings_dir());
    let _ = fs::create_dir_all(snapshots_dir());
}

/// Build TF-IDF vocabulary from all index entries
fn build_vocabulary() -> (Vec<String>, HashMap<String, f64>) {
    let index = load_index();
    let total_docs = index.len().max(1) as f64;
    let mut doc_freq: HashMap<String, usize> = HashMap::new();
    let mut all_terms: Vec<String> = Vec::new();

    for entry in &index {
        let terms = extract_keywords(&entry.content);
        let mut seen: Vec<String> = Vec::new();
        for t in &terms {
            if !seen.contains(t) {
                *doc_freq.entry(t.clone()).or_insert(0) += 1;
                seen.push(t.clone());
            }
        }
        for t in terms {
            if !all_terms.contains(&t) {
                all_terms.push(t);
            }
        }
    }

    let mut idf_map: HashMap<String, f64> = HashMap::new();
    for (term, df) in &doc_freq {
        let idf = ((total_docs + 1.0) / (*df as f64 + 1.0)).ln() + 1.0;
        idf_map.insert(term.clone(), idf);
    }

    all_terms.sort();
    (all_terms, idf_map)
}

/// Compute TF-IDF vector for a piece of text
fn compute_tfidf(text: &str, vocabulary: &[String], idf_map: &HashMap<String, f64>) -> Vec<f64> {
    let terms = extract_keywords(text);
    let total = terms.len().max(1) as f64;
    let mut tf: HashMap<String, f64> = HashMap::new();
    for t in &terms {
        *tf.entry(t.clone()).or_insert(0.0) += 1.0;
    }

    vocabulary
        .iter()
        .map(|term| {
            let term_freq = tf.get(term).copied().unwrap_or(0.0) / total;
            let idf = idf_map.get(term).copied().unwrap_or(1.0);
            term_freq * idf
        })
        .collect()
}

/// Cosine similarity between two vectors
fn cosine_similarity(a: &[f64], b: &[f64]) -> f64 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let dot: f64 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let mag_a: f64 = a.iter().map(|x| x * x).sum::<f64>().sqrt();
    let mag_b: f64 = b.iter().map(|x| x * x).sum::<f64>().sqrt();
    if mag_a == 0.0 || mag_b == 0.0 {
        return 0.0;
    }
    dot / (mag_a * mag_b)
}

/// Build embeddings for all indexed content
pub fn build_embeddings(project_path: Option<&str>) -> usize {
    ensure_evolution_dirs();
    let (vocabulary, idf_map) = build_vocabulary();
    if vocabulary.is_empty() {
        return 0;
    }

    let index = load_index();
    let mut count = 0usize;

    for entry in &index {
        if let Some(pp) = project_path {
            if entry.project_path.as_deref() != Some(pp) {
                continue;
            }
        }

        let weights = compute_tfidf(&entry.content, &vocabulary, &idf_map);
        let non_zero_terms: Vec<String> = vocabulary
            .iter()
            .zip(weights.iter())
            .filter(|(_, w)| **w > 0.0)
            .map(|(t, _)| t.clone())
            .collect();
        let non_zero_weights: Vec<f64> = weights.into_iter().filter(|w| *w > 0.0).collect();

        let embedding = EmbeddingVector {
            id: format!("emb-{}", entry.id),
            source_id: entry.source_id.clone(),
            source_type: entry.source_type.clone(),
            terms: non_zero_terms,
            weights: non_zero_weights,
            created_at: entry.created_at,
            project_path: entry.project_path.clone(),
        };

        let path = embeddings_dir().join(format!("{}.json", embedding.id));
        if let Ok(json) = serde_json::to_string(&embedding) {
            let _ = fs::write(path, json);
            count += 1;
        }
    }

    count
}

/// Semantic similarity search using TF-IDF cosine similarity
pub fn semantic_search(
    query: &str,
    project_path: Option<&str>,
    limit: usize,
) -> Vec<SimilarityResult> {
    let (vocabulary, idf_map) = build_vocabulary();
    if vocabulary.is_empty() {
        return Vec::new();
    }

    let query_vector = compute_tfidf(query, &vocabulary, &idf_map);
    let index = load_index();

    let mut results: Vec<SimilarityResult> = index
        .iter()
        .filter(|e| {
            if let Some(pp) = project_path {
                e.project_path.as_deref() == Some(pp)
            } else {
                true
            }
        })
        .map(|entry| {
            let entry_vector = compute_tfidf(&entry.content, &vocabulary, &idf_map);
            let sim = cosine_similarity(&query_vector, &entry_vector);

            // Recency boost
            let age_days =
                (current_timestamp_ms().saturating_sub(entry.created_at)) as f64 / 86_400_000.0;
            let recency = 1.0 / (1.0 + age_days / 60.0);
            let boosted = sim * (1.0 + 0.2 * recency);

            let snippet = extract_snippet(
                &entry.content,
                &extract_keywords(query),
                150,
            );

            SimilarityResult {
                source_id: entry.source_id.clone(),
                source_type: entry.source_type.clone(),
                similarity: boosted,
                snippet,
            }
        })
        .filter(|r| r.similarity > 0.01)
        .collect();

    results.sort_by(|a, b| b.similarity.partial_cmp(&a.similarity).unwrap_or(std::cmp::Ordering::Equal));
    results.truncate(limit);
    results
}

/// Query decisions with semantic relevance ranking
pub fn query_decisions(
    query: &str,
    project_path: Option<&str>,
    limit: usize,
) -> Vec<DecisionQueryResult> {
    let decisions = list_decisions(project_path);
    let query_kw = extract_keywords(query);

    let mut results: Vec<DecisionQueryResult> = decisions
        .iter()
        .map(|d| {
            let text = format!("{} {} {} {}", d.title, d.context, d.decision, d.rationale);
            let d_kw = extract_keywords(&text);
            let overlap = query_kw.iter().filter(|k| d_kw.contains(k)).count() as f64;
            let relevance = if query_kw.is_empty() {
                0.0
            } else {
                overlap / query_kw.len() as f64
            };

            // Find related decisions by tag overlap
            let related: Vec<String> = decisions
                .iter()
                .filter(|other| other.id != d.id)
                .filter(|other| {
                    other.tags.iter().any(|t| d.tags.contains(t))
                })
                .map(|other| other.id.clone())
                .take(3)
                .collect();

            DecisionQueryResult {
                decision: d.clone(),
                relevance,
                related_decisions: related,
            }
        })
        .filter(|r| r.relevance > 0.0 || query.is_empty())
        .collect();

    results.sort_by(|a, b| b.relevance.partial_cmp(&a.relevance).unwrap_or(std::cmp::Ordering::Equal));
    results.truncate(limit);
    results
}

/// Build a compressed knowledge snapshot
pub fn build_knowledge_snapshot(
    project_path: Option<&str>,
    layer: &str,
    max_tokens: usize,
) -> KnowledgeSnapshot {
    ensure_evolution_dirs();
    let mut content_parts: Vec<String> = Vec::new();
    let mut token_budget = max_tokens;
    let mut source_count = 0u32;
    let mut themes: Vec<String> = Vec::new();

    match layer {
        "decisions" => {
            let decisions = list_decisions(project_path);
            for d in decisions.iter().take(20) {
                let entry = format!("[{}] {} → {} ({})", d.status_label(), d.title, d.decision, d.rationale);
                let tokens = entry.len() / 4;
                if tokens <= token_budget {
                    content_parts.push(entry);
                    token_budget -= tokens;
                    source_count += 1;
                    themes.extend(d.tags.clone());
                }
            }
        }
        "summaries" => {
            let summaries = list_summaries(project_path);
            for s in summaries.iter().take(30) {
                let entry = format!(
                    "{}: {} [{}]",
                    s.title,
                    truncate_str(&s.summary, 200),
                    s.tags.join(", ")
                );
                let tokens = entry.len() / 4;
                if tokens <= token_budget {
                    content_parts.push(entry);
                    token_budget -= tokens;
                    source_count += 1;
                    themes.extend(s.tags.clone());
                }
            }
        }
        "architecture" => {
            let decisions = list_decisions(project_path);
            let summaries = list_summaries(project_path);

            // Extract architectural patterns
            let arch_decisions: Vec<&Decision> = decisions
                .iter()
                .filter(|d| {
                    d.tags.iter().any(|t| {
                        t.contains("arch") || t.contains("design") || t.contains("refactor")
                            || t.contains("migration") || t.contains("infrastructure")
                    })
                })
                .collect();

            for d in arch_decisions.iter().take(10) {
                let entry = format!("ARCH: {} → {}", d.title, d.decision);
                let tokens = entry.len() / 4;
                if tokens <= token_budget {
                    content_parts.push(entry);
                    token_budget -= tokens;
                    source_count += 1;
                }
            }

            // Add file relationship patterns
            let mut file_freq: HashMap<String, usize> = HashMap::new();
            for s in &summaries {
                for f in &s.files_touched {
                    *file_freq.entry(f.clone()).or_insert(0) += 1;
                }
            }
            let mut top_files: Vec<(&String, &usize)> = file_freq.iter().collect();
            top_files.sort_by(|a, b| b.1.cmp(a.1));
            for (file, count) in top_files.iter().take(15) {
                let entry = format!("HOT FILE: {} (modified {} times)", file, count);
                let tokens = entry.len() / 4;
                if tokens <= token_budget {
                    content_parts.push(entry);
                    token_budget -= tokens;
                    source_count += 1;
                }
            }
        }
        _ => {
            // "full" layer — combine everything
            let snapshot_d = build_knowledge_snapshot(project_path, "decisions", token_budget / 3);
            let snapshot_s = build_knowledge_snapshot(project_path, "summaries", token_budget / 3);
            let snapshot_a = build_knowledge_snapshot(project_path, "architecture", token_budget / 3);

            content_parts.push(snapshot_d.content);
            content_parts.push(snapshot_s.content);
            content_parts.push(snapshot_a.content);
            source_count = snapshot_d.source_count + snapshot_s.source_count + snapshot_a.source_count;
            themes.extend(snapshot_d.key_themes);
            themes.extend(snapshot_s.key_themes);
            themes.extend(snapshot_a.key_themes);
        }
    }

    themes.sort();
    themes.dedup();

    let content = content_parts.join("\n");
    let token_count = (content.len() / 4) as u32;

    let snapshot = KnowledgeSnapshot {
        id: format!("snap-{}", current_timestamp_ms()),
        created_at: current_timestamp_ms(),
        project_path: project_path.map(|s| s.to_string()),
        layer: layer.to_string(),
        content,
        token_count,
        source_count,
        key_themes: themes.into_iter().take(20).collect(),
    };

    // Persist
    let path = snapshots_dir().join(format!("{}.json", snapshot.id));
    if let Ok(json) = serde_json::to_string_pretty(&snapshot) {
        let _ = fs::write(path, json);
    }

    snapshot
}

/// List knowledge snapshots
pub fn list_snapshots(project_path: Option<&str>) -> Vec<KnowledgeSnapshot> {
    ensure_evolution_dirs();
    let mut snapshots: Vec<KnowledgeSnapshot> = fs::read_dir(snapshots_dir())
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let content = fs::read_to_string(e.path()).ok()?;
            serde_json::from_str(&content).ok()
        })
        .collect();

    if let Some(pp) = project_path {
        snapshots.retain(|s| s.project_path.as_deref() == Some(pp));
    }

    snapshots.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    snapshots
}

/// Get enhanced brain stats
pub fn get_enhanced_stats() -> EnhancedBrainStats {
    ensure_evolution_dirs();
    let base = get_brain_stats();

    let embedding_count = fs::read_dir(embeddings_dir())
        .ok()
        .map(|d| d.count())
        .unwrap_or(0);
    let snapshot_count = fs::read_dir(snapshots_dir())
        .ok()
        .map(|d| d.count())
        .unwrap_or(0);

    let index = load_index();
    let total = index.len().max(1) as f64;
    let with_keywords = index.iter().filter(|e| !e.keywords.is_empty()).count() as f64;
    let coverage = with_keywords / total;

    let oldest = index.iter().map(|e| e.created_at).min().unwrap_or(current_timestamp_ms());
    let oldest_days = (current_timestamp_ms().saturating_sub(oldest)) as f64 / 86_400_000.0;

    let mut layers = vec!["decisions".to_string(), "summaries".to_string(), "architecture".to_string(), "full".to_string()];
    layers.sort();

    EnhancedBrainStats {
        base,
        total_embeddings: embedding_count,
        total_snapshots: snapshot_count,
        semantic_coverage: coverage,
        oldest_memory_days: oldest_days,
        knowledge_layers: layers,
    }
}

impl Decision {
    fn status_label(&self) -> &str {
        match self.status {
            DecisionStatus::Active => "ACTIVE",
            DecisionStatus::Superseded => "SUPERSEDED",
            DecisionStatus::Deprecated => "DEPRECATED",
        }
    }
}

// ═══════ Skill Acquisition (Phase 3) ═══════

/// Save a skill learned from an agent loop execution.
pub fn save_skill(
    task: &str,
    steps: &[String],
    files_involved: &[String],
) -> Result<(), String> {
    ensure_dirs();

    // Check if a similar skill already exists (update success_count if so)
    let existing = search_skills(task, None);
    for mut skill in existing {
        if skill_similarity(&skill.task_pattern, task) > 0.7 {
            skill.success_count += 1;
            skill.last_used = current_timestamp_ms();
            skill.tool_sequence = steps.to_vec();
            skill.files_involved = files_involved.to_vec();
            return persist_skill(&skill);
        }
    }

    let skill = Skill {
        id: format!("skill-{}", current_timestamp_ms()),
        task_pattern: task.to_string(),
        tool_sequence: steps.to_vec(),
        files_involved: files_involved.to_vec(),
        success_count: 1,
        created_at: current_timestamp_ms(),
        last_used: current_timestamp_ms(),
        project_path: None,
    };

    persist_skill(&skill)?;

    // Also index in semantic index for searchability
    let content = format!(
        "Skill: {}\nSteps:\n{}\nFiles: {}",
        task,
        steps.iter().enumerate()
            .map(|(i, s)| format!("  {}. {}", i + 1, s))
            .collect::<Vec<_>>()
            .join("\n"),
        if files_involved.is_empty() { "none".to_string() } else { files_involved.join(", ") }
    );
    let tags = vec!["skill".to_string(), "agent-loop".to_string()];
    let _ = index_note(&content, None, &tags);

    Ok(())
}

fn persist_skill(skill: &Skill) -> Result<(), String> {
    let path = skills_dir().join(format!("{}.json", skill.id));
    let json = serde_json::to_string_pretty(skill)
        .map_err(|e| format!("Failed to serialize skill: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("Failed to write skill: {}", e))
}

/// Search for skills matching a task description.
pub fn search_skills(task: &str, project_path: Option<&str>) -> Vec<Skill> {
    ensure_dirs();
    let mut skills = list_skills();

    // Filter by project if specified
    if let Some(pp) = project_path {
        skills.retain(|s| s.project_path.is_none() || s.project_path.as_deref() == Some(pp));
    }

    // Score and sort by relevance
    let task_lower = task.to_lowercase();
    let mut scored: Vec<(f64, Skill)> = skills
        .into_iter()
        .map(|s| {
            let sim = skill_similarity(&s.task_pattern, &task_lower);
            let boost = (s.success_count as f64).ln_1p() * 0.1;
            (sim + boost, s)
        })
        .filter(|(score, _)| *score > 0.2)
        .collect();

    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    scored.into_iter().map(|(_, s)| s).take(5).collect()
}

/// List all saved skills.
pub fn list_skills() -> Vec<Skill> {
    let dir = skills_dir();
    let Ok(entries) = fs::read_dir(&dir) else { return Vec::new() };
    entries
        .flatten()
        .filter_map(|e| {
            let content = fs::read_to_string(e.path()).ok()?;
            serde_json::from_str::<Skill>(&content).ok()
        })
        .collect()
}

/// Format skills as context for LLM injection.
pub fn skills_to_context(skills: &[Skill]) -> String {
    if skills.is_empty() {
        return String::new();
    }
    let mut lines = vec!["# Relevant Skills from Previous Tasks".to_string()];
    for skill in skills {
        lines.push(format!(
            "\n## Skill: {} (used {} times)\nSteps: {}\nFiles: {}",
            skill.task_pattern,
            skill.success_count,
            skill.tool_sequence.join(" → "),
            if skill.files_involved.is_empty() { "none".to_string() } else { skill.files_involved.join(", ") }
        ));
    }
    lines.join("\n")
}

/// Compute similarity between two task descriptions (word overlap).
fn skill_similarity(a: &str, b: &str) -> f64 {
    let a_lower = a.to_lowercase();
    let b_lower = b.to_lowercase();
    let a_words: std::collections::HashSet<&str> = a_lower
        .split_whitespace()
        .filter(|w| w.len() > 2)
        .collect();
    let b_words: std::collections::HashSet<&str> = b_lower
        .split_whitespace()
        .filter(|w| w.len() > 2)
        .collect();

    if a_words.is_empty() || b_words.is_empty() {
        return 0.0;
    }

    let intersection = a_words.intersection(&b_words).count() as f64;
    let union = a_words.union(&b_words).count() as f64;
    intersection / union
}
