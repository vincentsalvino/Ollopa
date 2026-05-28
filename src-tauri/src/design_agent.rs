use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

// ═══════════════════════════════════════════════════════════════
// Global Design Agent System
// Persistent design intelligence for premium frontend generation
// ═══════════════════════════════════════════════════════════════

/// Global design agent specification
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DesignAgentSpec {
    pub name: String,
    pub description: String,
    pub active: bool,
    pub auto_activate_triggers: Vec<String>,
    pub design_philosophy: Vec<String>,
    pub typography_rules: TypographyRules,
    pub motion_rules: MotionRules,
    pub spatial_rules: SpatialRules,
    pub icon_rules: IconRules,
    pub background_rules: BackgroundRules,
    pub anti_patterns: Vec<String>,
    pub created_at: u64,
    pub updated_at: u64,
}

impl Default for DesignAgentSpec {
    fn default() -> Self {
        let now = current_timestamp_ms();
        Self {
            name: "frontend-design".to_string(),
            description: "Create distinctive, production-grade frontend interfaces with high design quality. Use this skill when the user asks to build web components, pages, or applications. Generates creative, polished code that avoids generic AI aesthetics.".to_string(),
            active: true,
            auto_activate_triggers: vec![
                "frontend".to_string(),
                "react".to_string(),
                "dashboard".to_string(),
                "ui".to_string(),
                "component".to_string(),
                "visual".to_string(),
                "layout".to_string(),
                "design".to_string(),
                "page".to_string(),
                "interface".to_string(),
                "ux".to_string(),
                "css".to_string(),
                "tailwind".to_string(),
                "styled".to_string(),
                "theme".to_string(),
                "animation".to_string(),
                "responsive".to_string(),
                "workflow ui".to_string(),
                "architecture visualization".to_string(),
            ],
            design_philosophy: vec![
                "Every interface must commit to a strong visual identity".to_string(),
                "Interfaces must have intentional aesthetic direction".to_string(),
                "All output must feel handcrafted and premium".to_string(),
                "Design must be context-aware and purposeful".to_string(),
                "Never produce generic AI-generated aesthetics".to_string(),
                "Prioritize distinctive production-grade quality".to_string(),
                "Create memorable visual language over safe defaults".to_string(),
            ],
            typography_rules: TypographyRules::default(),
            motion_rules: MotionRules::default(),
            spatial_rules: SpatialRules::default(),
            icon_rules: IconRules::default(),
            background_rules: BackgroundRules::default(),
            anti_patterns: vec![
                "Generic AI aesthetics".to_string(),
                "Template-looking interfaces".to_string(),
                "Boring layouts".to_string(),
                "Repetitive visual structures".to_string(),
                "Default Tailwind dashboards".to_string(),
                "Common SaaS clones".to_string(),
                "Predictable gradients".to_string(),
                "Generic spacing systems".to_string(),
                "Random animation spam".to_string(),
                "Excessive floating effects".to_string(),
                "Generic microinteractions".to_string(),
                "Generic centered cards".to_string(),
                "Repetitive grids".to_string(),
                "Sterile layouts".to_string(),
                "Flat sterile backgrounds".to_string(),
            ],
            created_at: now,
            updated_at: now,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypographyRules {
    pub banned_fonts: Vec<String>,
    pub recommended_display_fonts: Vec<String>,
    pub recommended_body_fonts: Vec<String>,
    pub principles: Vec<String>,
}

impl Default for TypographyRules {
    fn default() -> Self {
        Self {
            banned_fonts: vec![
                "Arial".to_string(),
                "Roboto".to_string(),
                "Inter".to_string(),
                "system-ui".to_string(),
                "sans-serif (as sole font)".to_string(),
            ],
            recommended_display_fonts: vec![
                "Playfair Display".to_string(),
                "Clash Display".to_string(),
                "Cabinet Grotesk".to_string(),
                "Satoshi".to_string(),
                "General Sans".to_string(),
                "Syne".to_string(),
                "Space Grotesk".to_string(),
                "Outfit".to_string(),
            ],
            recommended_body_fonts: vec![
                "Source Serif Pro".to_string(),
                "IBM Plex Sans".to_string(),
                "DM Sans".to_string(),
                "Plus Jakarta Sans".to_string(),
                "Manrope".to_string(),
                "Figtree".to_string(),
            ],
            principles: vec![
                "Use distinctive pairings".to_string(),
                "Use expressive display fonts for headings".to_string(),
                "Use refined body fonts for content".to_string(),
                "Drive hierarchy through typography".to_string(),
            ],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MotionRules {
    pub encouraged: Vec<String>,
    pub avoided: Vec<String>,
}

impl Default for MotionRules {
    fn default() -> Self {
        Self {
            encouraged: vec![
                "Subtle motion orchestration".to_string(),
                "Staggered reveals".to_string(),
                "Hover choreography".to_string(),
                "Intentional transitions".to_string(),
                "Layered interaction timing".to_string(),
            ],
            avoided: vec![
                "Random animation spam".to_string(),
                "Excessive floating effects".to_string(),
                "Generic microinteractions".to_string(),
            ],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpatialRules {
    pub encouraged: Vec<String>,
    pub avoided: Vec<String>,
}

impl Default for SpatialRules {
    fn default() -> Self {
        Self {
            encouraged: vec![
                "Asymmetry".to_string(),
                "Layered layouts".to_string(),
                "Depth and overlap".to_string(),
                "Visual rhythm".to_string(),
                "Hierarchy-driven density".to_string(),
            ],
            avoided: vec![
                "Generic centered cards".to_string(),
                "Repetitive grids".to_string(),
                "Sterile layouts".to_string(),
            ],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IconRules {
    pub provider: String,
    pub never_use: Vec<String>,
    pub examples: Vec<String>,
}

impl Default for IconRules {
    fn default() -> Self {
        Self {
            provider: "Font Awesome".to_string(),
            never_use: vec!["emoji".to_string()],
            examples: vec![
                "<i class=\"fa fa-code\"></i>".to_string(),
                "<i class=\"fa fa-brain\"></i>".to_string(),
                "<i class=\"fa fa-folder\"></i>".to_string(),
            ],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackgroundRules {
    pub encouraged: Vec<String>,
    pub avoided: Vec<String>,
}

impl Default for BackgroundRules {
    fn default() -> Self {
        Self {
            encouraged: vec![
                "Texture and grain".to_string(),
                "Atmosphere".to_string(),
                "Layered gradients".to_string(),
                "Environmental lighting".to_string(),
                "Subtle visual noise".to_string(),
                "Geometric structure".to_string(),
            ],
            avoided: vec![
                "Flat sterile backgrounds".to_string(),
            ],
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// Design Memory System
// Persistent storage for design decisions and style identity
// ═══════════════════════════════════════════════════════════════

/// Design memory — persists aesthetic choices across sessions
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DesignMemory {
    pub id: String,
    pub project_path: Option<String>,
    pub project_style_identity: StyleIdentity,
    pub typography_system: TypographySystem,
    pub motion_language: MotionLanguage,
    pub spacing_language: SpacingLanguage,
    pub visual_principles: Vec<String>,
    pub component_patterns: Vec<ComponentPattern>,
    pub color_palette: Vec<ColorEntry>,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StyleIdentity {
    pub name: String,
    pub aesthetic_direction: String,
    pub mood: Vec<String>,
    pub references: Vec<String>,
    pub brand_keywords: Vec<String>,
}

impl Default for StyleIdentity {
    fn default() -> Self {
        Self {
            name: "Default".to_string(),
            aesthetic_direction: "Modern premium with depth".to_string(),
            mood: vec!["sophisticated".to_string(), "purposeful".to_string(), "refined".to_string()],
            references: vec![],
            brand_keywords: vec![],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypographySystem {
    pub display_font: String,
    pub body_font: String,
    pub mono_font: String,
    pub scale: Vec<FontScale>,
}

impl Default for TypographySystem {
    fn default() -> Self {
        Self {
            display_font: "Space Grotesk".to_string(),
            body_font: "DM Sans".to_string(),
            mono_font: "JetBrains Mono".to_string(),
            scale: vec![
                FontScale { name: "xs".to_string(), size_px: 12, line_height: 1.5, weight: 400 },
                FontScale { name: "sm".to_string(), size_px: 14, line_height: 1.5, weight: 400 },
                FontScale { name: "base".to_string(), size_px: 16, line_height: 1.6, weight: 400 },
                FontScale { name: "lg".to_string(), size_px: 18, line_height: 1.5, weight: 500 },
                FontScale { name: "xl".to_string(), size_px: 20, line_height: 1.4, weight: 600 },
                FontScale { name: "2xl".to_string(), size_px: 24, line_height: 1.3, weight: 700 },
                FontScale { name: "3xl".to_string(), size_px: 30, line_height: 1.2, weight: 700 },
                FontScale { name: "4xl".to_string(), size_px: 36, line_height: 1.1, weight: 800 },
            ],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FontScale {
    pub name: String,
    pub size_px: u32,
    pub line_height: f64,
    pub weight: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MotionLanguage {
    pub default_duration_ms: u32,
    pub easing: String,
    pub stagger_delay_ms: u32,
    pub hover_scale: f64,
    pub transition_properties: Vec<String>,
}

impl Default for MotionLanguage {
    fn default() -> Self {
        Self {
            default_duration_ms: 200,
            easing: "cubic-bezier(0.4, 0, 0.2, 1)".to_string(),
            stagger_delay_ms: 50,
            hover_scale: 1.02,
            transition_properties: vec![
                "transform".to_string(),
                "opacity".to_string(),
                "box-shadow".to_string(),
                "background-color".to_string(),
            ],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpacingLanguage {
    pub base_unit_px: u32,
    pub scale: Vec<u32>,
    pub container_max_width: String,
    pub section_padding: String,
}

impl Default for SpacingLanguage {
    fn default() -> Self {
        Self {
            base_unit_px: 4,
            scale: vec![0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128],
            container_max_width: "1280px".to_string(),
            section_padding: "64px 0".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComponentPattern {
    pub name: String,
    pub component_type: String,
    pub description: String,
    pub css_properties: HashMap<String, String>,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColorEntry {
    pub name: String,
    pub hex: String,
    pub usage: String,
}

// ═══════════════════════════════════════════════════════════════
// Design Governance Layer
// Automatic design quality enforcement
// ═══════════════════════════════════════════════════════════════

/// Design review result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DesignReview {
    pub id: String,
    pub project_path: Option<String>,
    pub score: f64,
    pub findings: Vec<DesignFinding>,
    pub recommendations: Vec<String>,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DesignFinding {
    pub category: String,
    pub severity: FindingSeverity,
    pub description: String,
    pub suggestion: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum FindingSeverity {
    Info,
    Warning,
    Critical,
}

/// Design agent activation context
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DesignActivation {
    pub triggered: bool,
    pub trigger_keywords: Vec<String>,
    pub agent_spec: DesignAgentSpec,
    pub design_memory: Option<DesignMemory>,
    pub planning_context: Option<String>,
}

/// Design event types for the event bus
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DesignEvent {
    pub event_type: DesignEventType,
    pub project_path: Option<String>,
    pub detail: String,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum DesignEventType {
    DirectionSelected,
    SystemUpdated,
    MemoryStored,
    ReviewCompleted,
    ThemeGenerated,
    AgentActivated,
    AgentDeactivated,
    PatternRecorded,
}

impl DesignEventType {
    pub fn label(&self) -> &str {
        match self {
            DesignEventType::DirectionSelected => "design.direction.selected",
            DesignEventType::SystemUpdated => "design.system.updated",
            DesignEventType::MemoryStored => "design.memory.stored",
            DesignEventType::ReviewCompleted => "design.review.completed",
            DesignEventType::ThemeGenerated => "design.theme.generated",
            DesignEventType::AgentActivated => "design.agent.activated",
            DesignEventType::AgentDeactivated => "design.agent.deactivated",
            DesignEventType::PatternRecorded => "design.pattern.recorded",
        }
    }
}

/// Design agent statistics
#[derive(Debug, Clone, Serialize)]
pub struct DesignAgentStats {
    pub agent_active: bool,
    pub total_memories: usize,
    pub total_reviews: usize,
    pub total_patterns: usize,
    pub total_events: usize,
    pub avg_review_score: f64,
    pub projects_with_design_memory: usize,
}

// ═══════ Storage Paths ═══════

fn design_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/home/ubuntu"))
        .join(".ollopa")
        .join("workspace-brain")
        .join("design")
}

fn memories_dir() -> PathBuf {
    design_dir().join("memories")
}

fn reviews_dir() -> PathBuf {
    design_dir().join("reviews")
}

fn events_dir() -> PathBuf {
    design_dir().join("events")
}

fn spec_file() -> PathBuf {
    design_dir().join("agent-spec.json")
}

fn ensure_dirs() {
    let _ = fs::create_dir_all(memories_dir());
    let _ = fs::create_dir_all(reviews_dir());
    let _ = fs::create_dir_all(events_dir());
}

fn current_timestamp_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// ═══════ Design Agent Spec Management ═══════

pub fn load_spec() -> DesignAgentSpec {
    fs::read_to_string(spec_file())
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_default()
}

pub fn save_spec(spec: &DesignAgentSpec) -> Result<(), String> {
    ensure_dirs();
    let json = serde_json::to_string_pretty(spec)
        .map_err(|e| format!("Failed to serialize spec: {}", e))?;
    fs::write(spec_file(), json)
        .map_err(|e| format!("Failed to write spec: {}", e))
}

// ═══════ Design Activation Detection ═══════

pub fn should_activate(prompt: &str) -> DesignActivation {
    let spec = load_spec();
    let lower = prompt.to_lowercase();

    let mut matched_triggers = vec![];
    for trigger in &spec.auto_activate_triggers {
        if lower.contains(&trigger.to_lowercase()) {
            matched_triggers.push(trigger.clone());
        }
    }

    let triggered = !matched_triggers.is_empty() && spec.active;

    let design_memory = if triggered {
        load_latest_memory(None).ok()
    } else {
        None
    };

    let planning_context = if triggered {
        Some(build_design_context(&spec, design_memory.as_ref()))
    } else {
        None
    };

    DesignActivation {
        triggered,
        trigger_keywords: matched_triggers,
        agent_spec: spec,
        design_memory,
        planning_context,
    }
}

fn build_design_context(spec: &DesignAgentSpec, memory: Option<&DesignMemory>) -> String {
    let mut ctx = String::new();
    ctx.push_str("## Design Agent Active\n\n");
    ctx.push_str("### Philosophy\n");
    for p in &spec.design_philosophy {
        ctx.push_str(&format!("- {}\n", p));
    }

    ctx.push_str("\n### Typography\n");
    ctx.push_str(&format!("- Banned: {}\n", spec.typography_rules.banned_fonts.join(", ")));
    ctx.push_str(&format!("- Display: {}\n", spec.typography_rules.recommended_display_fonts.join(", ")));
    ctx.push_str(&format!("- Body: {}\n", spec.typography_rules.recommended_body_fonts.join(", ")));

    ctx.push_str("\n### Icons: Font Awesome only (no emoji)\n");

    ctx.push_str("\n### Anti-patterns to avoid:\n");
    for ap in &spec.anti_patterns {
        ctx.push_str(&format!("- {}\n", ap));
    }

    if let Some(mem) = memory {
        ctx.push_str("\n### Project Style Identity\n");
        ctx.push_str(&format!("- Direction: {}\n", mem.project_style_identity.aesthetic_direction));
        ctx.push_str(&format!("- Mood: {}\n", mem.project_style_identity.mood.join(", ")));
        ctx.push_str(&format!("- Display font: {}\n", mem.typography_system.display_font));
        ctx.push_str(&format!("- Body font: {}\n", mem.typography_system.body_font));
    }

    ctx
}

// ═══════ Design Memory CRUD ═══════

pub fn save_memory(memory: &DesignMemory) -> Result<(), String> {
    ensure_dirs();
    let json = serde_json::to_string_pretty(memory)
        .map_err(|e| format!("Failed to serialize memory: {}", e))?;
    fs::write(memories_dir().join(format!("{}.json", memory.id)), json)
        .map_err(|e| format!("Failed to write memory: {}", e))?;

    record_event(DesignEventType::MemoryStored, memory.project_path.as_deref(), "Design memory saved");
    Ok(())
}

pub fn load_latest_memory(project_path: Option<&str>) -> Result<DesignMemory, String> {
    let memories = list_memories(project_path);
    memories.into_iter().next().ok_or_else(|| "No design memory found".to_string())
}

pub fn list_memories(project_path: Option<&str>) -> Vec<DesignMemory> {
    ensure_dirs();
    let mut memories: Vec<DesignMemory> = fs::read_dir(memories_dir())
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
        memories.retain(|m| m.project_path.as_deref() == Some(pp));
    }

    memories.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    memories
}

pub fn create_default_memory(project_path: Option<&str>) -> DesignMemory {
    let now = current_timestamp_ms();
    DesignMemory {
        id: format!("dm-{}", now),
        project_path: project_path.map(|s| s.to_string()),
        project_style_identity: StyleIdentity::default(),
        typography_system: TypographySystem::default(),
        motion_language: MotionLanguage::default(),
        spacing_language: SpacingLanguage::default(),
        visual_principles: vec![
            "Premium, handcrafted feel".to_string(),
            "Distinctive visual identity".to_string(),
            "Intentional hierarchy".to_string(),
            "Cohesive motion system".to_string(),
        ],
        component_patterns: vec![],
        color_palette: vec![],
        created_at: now,
        updated_at: now,
    }
}

pub fn delete_memory(id: &str) -> Result<(), String> {
    let path = memories_dir().join(format!("{}.json", id));
    fs::remove_file(&path).map_err(|e| format!("Failed to delete memory: {}", e))
}

pub fn add_component_pattern(
    memory_id: &str,
    name: &str,
    component_type: &str,
    description: &str,
    css_properties: HashMap<String, String>,
) -> Result<DesignMemory, String> {
    let path = memories_dir().join(format!("{}.json", memory_id));
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Memory not found: {}", e))?;
    let mut memory: DesignMemory = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse memory: {}", e))?;

    memory.component_patterns.push(ComponentPattern {
        name: name.to_string(),
        component_type: component_type.to_string(),
        description: description.to_string(),
        css_properties,
        created_at: current_timestamp_ms(),
    });
    memory.updated_at = current_timestamp_ms();

    save_memory(&memory)?;
    record_event(DesignEventType::PatternRecorded, memory.project_path.as_deref(), &format!("Pattern recorded: {}", name));
    Ok(memory)
}

// ═══════ Design Review ═══════

pub fn create_review(project_path: Option<&str>) -> DesignReview {
    let memory = load_latest_memory(project_path).ok();
    let spec = load_spec();
    let now = current_timestamp_ms();

    let mut findings = vec![];
    let mut score = 10.0f64;

    // Check if design memory exists
    if memory.is_none() {
        findings.push(DesignFinding {
            category: "memory".to_string(),
            severity: FindingSeverity::Warning,
            description: "No design memory found for this project".to_string(),
            suggestion: "Create a design memory to maintain style consistency".to_string(),
        });
        score -= 2.0;
    }

    if let Some(ref mem) = memory {
        // Check typography
        if spec.typography_rules.banned_fonts.iter().any(|f| {
            mem.typography_system.display_font.contains(f) || mem.typography_system.body_font.contains(f)
        }) {
            findings.push(DesignFinding {
                category: "typography".to_string(),
                severity: FindingSeverity::Critical,
                description: "Using banned default font".to_string(),
                suggestion: "Switch to a distinctive font pairing".to_string(),
            });
            score -= 3.0;
        }

        // Check component patterns
        if mem.component_patterns.is_empty() {
            findings.push(DesignFinding {
                category: "patterns".to_string(),
                severity: FindingSeverity::Info,
                description: "No component patterns recorded".to_string(),
                suggestion: "Record reusable component patterns for consistency".to_string(),
            });
            score -= 1.0;
        }

        // Check color palette
        if mem.color_palette.is_empty() {
            findings.push(DesignFinding {
                category: "color".to_string(),
                severity: FindingSeverity::Warning,
                description: "No color palette defined".to_string(),
                suggestion: "Define a cohesive color palette for the project".to_string(),
            });
            score -= 1.5;
        }
    }

    // Clamp score
    if score < 0.0 { score = 0.0; }

    let recommendations = generate_recommendations(&findings, &spec);

    let review = DesignReview {
        id: format!("dr-{}", now),
        project_path: project_path.map(|s| s.to_string()),
        score,
        findings,
        recommendations,
        created_at: now,
    };

    // Save review
    if let Ok(json) = serde_json::to_string_pretty(&review) {
        let _ = fs::write(reviews_dir().join(format!("{}.json", review.id)), json);
    }

    record_event(DesignEventType::ReviewCompleted, project_path, &format!("Design review completed: score {:.1}", score));
    review
}

fn generate_recommendations(findings: &[DesignFinding], spec: &DesignAgentSpec) -> Vec<String> {
    let mut recs = vec![];

    let has_typography_issue = findings.iter().any(|f| f.category == "typography");
    let has_color_issue = findings.iter().any(|f| f.category == "color");
    let has_pattern_issue = findings.iter().any(|f| f.category == "patterns");

    if has_typography_issue {
        recs.push(format!(
            "Consider using {} for display and {} for body text",
            spec.typography_rules.recommended_display_fonts.first().unwrap_or(&"Space Grotesk".to_string()),
            spec.typography_rules.recommended_body_fonts.first().unwrap_or(&"DM Sans".to_string()),
        ));
    }

    if has_color_issue {
        recs.push("Define a color palette with primary, secondary, accent, and neutral colors".to_string());
    }

    if has_pattern_issue {
        recs.push("Record component patterns as you build them for consistency".to_string());
    }

    if findings.is_empty() {
        recs.push("Design system is well-configured. Continue maintaining consistency.".to_string());
    }

    recs
}

pub fn list_reviews(project_path: Option<&str>) -> Vec<DesignReview> {
    ensure_dirs();
    let mut reviews: Vec<DesignReview> = fs::read_dir(reviews_dir())
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
        reviews.retain(|r| r.project_path.as_deref() == Some(pp));
    }

    reviews.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    reviews
}

// ═══════ Design Events ═══════

fn record_event(event_type: DesignEventType, project_path: Option<&str>, detail: &str) {
    ensure_dirs();
    let now = current_timestamp_ms();
    let event = DesignEvent {
        event_type,
        project_path: project_path.map(|s| s.to_string()),
        detail: detail.to_string(),
        timestamp: now,
    };

    if let Ok(json) = serde_json::to_string_pretty(&event) {
        let _ = fs::write(events_dir().join(format!("de-{}.json", now)), json);
    }
}

pub fn list_events(project_path: Option<&str>, limit: usize) -> Vec<DesignEvent> {
    ensure_dirs();
    let mut events: Vec<DesignEvent> = fs::read_dir(events_dir())
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
        events.retain(|e| e.project_path.as_deref() == Some(pp));
    }

    events.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    events.truncate(limit);
    events
}

// ═══════ Statistics ═══════

pub fn get_design_stats() -> DesignAgentStats {
    let spec = load_spec();
    let memories = list_memories(None);
    let reviews = list_reviews(None);
    let events = list_events(None, 1000);

    let total_patterns: usize = memories.iter().map(|m| m.component_patterns.len()).sum();
    let avg_score = if reviews.is_empty() {
        0.0
    } else {
        reviews.iter().map(|r| r.score).sum::<f64>() / reviews.len() as f64
    };

    let mut project_set = std::collections::HashSet::new();
    for m in &memories {
        if let Some(ref pp) = m.project_path {
            project_set.insert(pp.clone());
        }
    }

    DesignAgentStats {
        agent_active: spec.active,
        total_memories: memories.len(),
        total_reviews: reviews.len(),
        total_patterns,
        total_events: events.len(),
        avg_review_score: avg_score,
        projects_with_design_memory: project_set.len(),
    }
}
