use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

// ═══════ Data Structures ═══════

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TransformMode {
    AutoEnhance,
    CodeTask,
    Analysis,
    Creative,
    Debug,
    Raw,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransformSettings {
    pub enabled: bool,
    pub default_mode: TransformMode,
    pub show_preview: bool,
    pub web_search_enabled: bool,
}

impl Default for TransformSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            default_mode: TransformMode::AutoEnhance,
            show_preview: true,
            web_search_enabled: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptTemplate {
    pub id: String,
    pub name: String,
    pub mode: TransformMode,
    pub template: String,
    pub is_builtin: bool,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransformContext {
    pub model: Option<String>,
    pub project_path: Option<String>,
    pub recent_messages: Vec<String>,
    pub detected_language: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransformResult {
    pub original: String,
    pub transformed: String,
    pub mode: TransformMode,
    pub web_search_triggered: bool,
    pub search_query: Option<String>,
}

// ═══════ Storage ═══════

fn transformer_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/home/ubuntu"))
        .join(".claude")
        .join("workspace-brain")
        .join("transformer")
}

fn templates_file() -> PathBuf {
    transformer_dir().join("templates.json")
}

fn settings_file() -> PathBuf {
    transformer_dir().join("settings.json")
}

fn ensure_dirs() {
    let _ = fs::create_dir_all(transformer_dir());
}

fn current_timestamp_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// ═══════ Intent Detection ═══════

fn detect_mode(input: &str) -> TransformMode {
    let lower = input.to_lowercase();

    let debug_keywords = [
        "fix", "bug", "error", "crash", "broken", "fail", "issue", "debug",
        "wrong", "not working", "doesn't work", "exception", "stack trace",
    ];
    let code_keywords = [
        "write", "create", "implement", "build", "code", "function", "class",
        "component", "api", "endpoint", "module", "refactor", "add feature",
        "generate", "scaffold", "setup",
    ];
    let analysis_keywords = [
        "analyze", "explain", "compare", "review", "evaluate", "summarize",
        "what is", "how does", "why does", "describe", "break down",
        "pros and cons", "difference between",
    ];
    let creative_keywords = [
        "write me a", "draft", "compose", "story", "email", "letter",
        "blog", "article", "essay", "poem", "script", "copy",
    ];

    let mut debug_score = 0u32;
    let mut code_score = 0u32;
    let mut analysis_score = 0u32;
    let mut creative_score = 0u32;

    for kw in &debug_keywords {
        if lower.contains(kw) {
            debug_score += 1;
        }
    }
    for kw in &code_keywords {
        if lower.contains(kw) {
            code_score += 1;
        }
    }
    for kw in &analysis_keywords {
        if lower.contains(kw) {
            analysis_score += 1;
        }
    }
    for kw in &creative_keywords {
        if lower.contains(kw) {
            creative_score += 1;
        }
    }

    let max = debug_score.max(code_score).max(analysis_score).max(creative_score);

    if max == 0 {
        return TransformMode::AutoEnhance;
    }

    if debug_score == max {
        TransformMode::Debug
    } else if code_score == max {
        TransformMode::CodeTask
    } else if analysis_score == max {
        TransformMode::Analysis
    } else {
        TransformMode::Creative
    }
}

fn detect_language(input: &str) -> Option<String> {
    let lower = input.to_lowercase();
    let lang_hints = [
        ("rust", "Rust"), ("python", "Python"), ("javascript", "JavaScript"),
        ("typescript", "TypeScript"), ("react", "TypeScript/React"), ("java", "Java"),
        ("go ", "Go"), ("golang", "Go"), ("c++", "C++"), ("c#", "C#"),
        ("ruby", "Ruby"), ("php", "PHP"), ("swift", "Swift"), ("kotlin", "Kotlin"),
        ("sql", "SQL"), ("html", "HTML"), ("css", "CSS"),
    ];

    for (keyword, lang) in &lang_hints {
        if lower.contains(keyword) {
            return Some(lang.to_string());
        }
    }
    None
}

/// Detect whether a prompt should trigger a web search
pub fn should_web_search(input: &str) -> Option<String> {
    let lower = input.to_lowercase();

    let search_triggers = [
        "search for", "look up", "find out", "google", "search the web",
        "what's the latest", "current", "today", "2024", "2025", "2026",
        "news about", "recent", "up to date", "latest version",
        "how much does", "price of", "cost of", "weather",
        "who is", "where is", "when did", "what happened",
    ];

    let knowledge_gaps = [
        "documentation for", "docs for", "api reference",
        "how to install", "npm package", "crate for", "library for",
        "best practice for", "tutorial for", "guide for",
    ];

    for trigger in &search_triggers {
        if lower.contains(trigger) {
            return Some(extract_search_query(input, trigger));
        }
    }

    for trigger in &knowledge_gaps {
        if lower.contains(trigger) {
            return Some(extract_search_query(input, trigger));
        }
    }

    None
}

fn extract_search_query(input: &str, _trigger: &str) -> String {
    let cleaned = input
        .replace("search for", "")
        .replace("look up", "")
        .replace("find out", "")
        .replace("google", "")
        .replace("search the web for", "")
        .trim()
        .to_string();

    if cleaned.len() > 200 {
        cleaned[..200].to_string()
    } else if cleaned.is_empty() {
        input.to_string()
    } else {
        cleaned
    }
}

// ═══════ Built-in Templates ═══════

fn builtin_templates() -> Vec<PromptTemplate> {
    vec![
        PromptTemplate {
            id: "tpl-code".to_string(),
            name: "Code Task".to_string(),
            mode: TransformMode::CodeTask,
            template: r#"## Task: Code Generation

**Language**: {language}
**Context**: {project_context}

### Requirements
{user_message}

### Guidelines
- Follow existing code conventions and style
- Include proper error handling
- Add brief comments for complex logic
- Consider edge cases

### Expected Output
Provide the code implementation with a brief explanation of the approach."#.to_string(),
            is_builtin: true,
            created_at: 0,
        },
        PromptTemplate {
            id: "tpl-debug".to_string(),
            name: "Debug / Bug Fix".to_string(),
            mode: TransformMode::Debug,
            template: r#"## Bug Analysis & Fix

**Problem Description**:
{user_message}

**Context**: {project_context}

### Diagnostic Steps
1. Identify the root cause of the issue
2. Explain why this behavior occurs
3. Provide a targeted fix
4. Suggest prevention measures

### Constraints
- Maintain backward compatibility
- Minimize changes to existing code
- Preserve existing test coverage"#.to_string(),
            is_builtin: true,
            created_at: 0,
        },
        PromptTemplate {
            id: "tpl-analysis".to_string(),
            name: "Analysis".to_string(),
            mode: TransformMode::Analysis,
            template: r#"## Analysis Request

**Topic**: {user_message}

**Context**: {project_context}

### Approach
- Provide a structured, thorough analysis
- Include relevant examples or comparisons
- Consider multiple perspectives
- Highlight key insights and trade-offs

### Output Format
Provide a clear, organized response with headings and bullet points where appropriate."#.to_string(),
            is_builtin: true,
            created_at: 0,
        },
        PromptTemplate {
            id: "tpl-creative".to_string(),
            name: "Creative Writing".to_string(),
            mode: TransformMode::Creative,
            template: r#"## Creative Task

**Request**: {user_message}

### Guidelines
- Match the appropriate tone and style for the content type
- Be engaging and well-structured
- Consider the target audience
- Use clear, concise language

### Format
Provide the content in a polished, ready-to-use format."#.to_string(),
            is_builtin: true,
            created_at: 0,
        },
        PromptTemplate {
            id: "tpl-auto".to_string(),
            name: "Auto-Enhanced".to_string(),
            mode: TransformMode::AutoEnhance,
            template: r#"{user_message}

---
*Context: {project_context}*
*Please provide a clear, well-structured response. If code is involved, follow best practices and include error handling.*"#.to_string(),
            is_builtin: true,
            created_at: 0,
        },
    ]
}

// ═══════ Transform Engine ═══════

pub fn transform_prompt(
    raw: &str,
    context: &TransformContext,
    settings: &TransformSettings,
) -> TransformResult {
    if !settings.enabled || settings.default_mode == TransformMode::Raw {
        return TransformResult {
            original: raw.to_string(),
            transformed: raw.to_string(),
            mode: TransformMode::Raw,
            web_search_triggered: false,
            search_query: None,
        };
    }

    let mode = if settings.default_mode == TransformMode::AutoEnhance {
        detect_mode(raw)
    } else {
        settings.default_mode.clone()
    };

    let web_search_triggered = settings.web_search_enabled && should_web_search(raw).is_some();
    let search_query = if web_search_triggered {
        should_web_search(raw)
    } else {
        None
    };

    let templates = list_templates();
    let template = templates
        .iter()
        .find(|t| t.mode == mode)
        .or_else(|| templates.iter().find(|t| t.mode == TransformMode::AutoEnhance));

    let language = context.detected_language.clone()
        .or_else(|| detect_language(raw))
        .unwrap_or_else(|| "Not specified".to_string());

    let project_context = context.project_path.clone().unwrap_or_else(|| "General".to_string());

    let transformed = match template {
        Some(tpl) => {
            tpl.template
                .replace("{user_message}", raw)
                .replace("{language}", &language)
                .replace("{project_context}", &project_context)
                .replace("{recent_context}", &context.recent_messages.join("\n"))
        }
        None => raw.to_string(),
    };

    TransformResult {
        original: raw.to_string(),
        transformed,
        mode,
        web_search_triggered,
        search_query,
    }
}

// ═══════ Template Management ═══════

pub fn list_templates() -> Vec<PromptTemplate> {
    let mut templates = builtin_templates();

    if let Ok(content) = fs::read_to_string(templates_file()) {
        if let Ok(custom) = serde_json::from_str::<Vec<PromptTemplate>>(&content) {
            for ct in custom {
                if let Some(existing) = templates.iter_mut().find(|t| t.id == ct.id) {
                    *existing = ct;
                } else {
                    templates.push(ct);
                }
            }
        }
    }

    templates
}

pub fn save_template(template: &PromptTemplate) -> Result<(), String> {
    ensure_dirs();
    let mut customs = load_custom_templates();
    customs.retain(|t| t.id != template.id);
    customs.push(template.clone());
    save_custom_templates(&customs)
}

pub fn delete_template(id: &str) -> Result<(), String> {
    let mut customs = load_custom_templates();
    let before = customs.len();
    customs.retain(|t| t.id != id || t.is_builtin);
    if customs.len() == before {
        return Err("Template not found or is built-in".to_string());
    }
    save_custom_templates(&customs)
}

fn load_custom_templates() -> Vec<PromptTemplate> {
    fs::read_to_string(templates_file())
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_default()
}

fn save_custom_templates(templates: &[PromptTemplate]) -> Result<(), String> {
    ensure_dirs();
    let json = serde_json::to_string_pretty(templates)
        .map_err(|e| format!("Failed to serialize templates: {}", e))?;
    fs::write(templates_file(), json)
        .map_err(|e| format!("Failed to write templates: {}", e))
}

// ═══════ Settings ═══════

pub fn load_settings() -> TransformSettings {
    fs::read_to_string(settings_file())
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_default()
}

pub fn save_settings(settings: &TransformSettings) -> Result<(), String> {
    ensure_dirs();
    let json = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;
    fs::write(settings_file(), json)
        .map_err(|e| format!("Failed to write settings: {}", e))
}
