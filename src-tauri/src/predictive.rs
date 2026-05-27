use serde::Serialize;
use std::collections::HashMap;

// ═══════════════════════════════════════════════════════════════
// UPGRADE PHASE F — Predictive Workflows
// Predictive suggestions, smart context assembly,
// workflow recommendations
// ═══════════════════════════════════════════════════════════════

/// A predictive suggestion for the user
#[derive(Debug, Clone, Serialize)]
pub struct PredictiveSuggestion {
    pub suggestion_type: String,
    pub title: String,
    pub description: String,
    pub confidence: f64,
    pub related_files: Vec<String>,
    pub related_decisions: Vec<String>,
    pub action: String,
}

/// Smart context assembled from workspace intelligence
#[derive(Debug, Clone, Serialize)]
pub struct SmartContext {
    pub relevant_files: Vec<String>,
    pub prior_decisions: Vec<String>,
    pub related_summaries: Vec<String>,
    pub architectural_context: String,
    pub workflow_hints: Vec<String>,
    pub total_tokens: usize,
}

/// Workflow recommendation
#[derive(Debug, Clone, Serialize)]
pub struct WorkflowRecommendation {
    pub recommendation_type: String,
    pub title: String,
    pub description: String,
    pub confidence: f64,
    pub steps: Vec<String>,
    pub estimated_tokens: usize,
}

/// Generate predictive suggestions based on current context
pub fn generate_suggestions(
    current_file: Option<&str>,
    recent_prompt: Option<&str>,
    project_path: Option<&str>,
) -> Vec<PredictiveSuggestion> {
    let mut suggestions: Vec<PredictiveSuggestion> = Vec::new();

    let summaries = crate::second_brain::list_summaries(project_path);
    let decisions = crate::second_brain::list_decisions(project_path);

    // Suggest related files based on co-modification history
    if let Some(file) = current_file {
        let mut co_files: HashMap<String, usize> = HashMap::new();
        for s in &summaries {
            if s.files_touched.iter().any(|f| f.contains(file) || file.contains(f)) {
                for f in &s.files_touched {
                    if !f.contains(file) && !file.contains(f) {
                        *co_files.entry(f.clone()).or_insert(0) += 1;
                    }
                }
            }
        }

        let mut related: Vec<(String, usize)> = co_files.into_iter().collect();
        related.sort_by(|a, b| b.1.cmp(&a.1));

        if !related.is_empty() {
            suggestions.push(PredictiveSuggestion {
                suggestion_type: "related_files".to_string(),
                title: "Related Files".to_string(),
                description: format!(
                    "Files commonly modified alongside {}",
                    file.rsplit('/').next().unwrap_or(file)
                ),
                confidence: 0.8,
                related_files: related.iter().take(5).map(|(f, _)| f.clone()).collect(),
                related_decisions: Vec::new(),
                action: "open_files".to_string(),
            });
        }
    }

    // Suggest relevant decisions based on prompt context
    if let Some(prompt) = recent_prompt {
        let results = crate::second_brain::query_decisions(prompt, project_path, 3);
        if !results.is_empty() {
            suggestions.push(PredictiveSuggestion {
                suggestion_type: "relevant_decisions".to_string(),
                title: "Relevant Decisions".to_string(),
                description: "Historical architectural decisions related to your query".to_string(),
                confidence: results[0].relevance,
                related_files: Vec::new(),
                related_decisions: results.iter().map(|r| r.decision.title.clone()).collect(),
                action: "view_decisions".to_string(),
            });
        }
    }

    // Suggest probable regressions based on change patterns
    if let Some(file) = current_file {
        if let Some(pp) = project_path {
            let impact = crate::repo_intelligence::predict_change_impact(pp, file);
            if !impact.regression_risk.is_empty() {
                suggestions.push(PredictiveSuggestion {
                    suggestion_type: "regression_risk".to_string(),
                    title: "Regression Risk".to_string(),
                    description: format!(
                        "{} risk: {} affected files",
                        impact.risk_level,
                        impact.affected_files.len()
                    ),
                    confidence: match impact.risk_level.as_str() {
                        "high" => 0.9,
                        "medium" => 0.6,
                        _ => 0.3,
                    },
                    related_files: impact.affected_files,
                    related_decisions: Vec::new(),
                    action: "review_impact".to_string(),
                });
            }
        }
    }

    // Suggest workflow patterns
    if let Some(pp) = project_path {
        let patterns = crate::repo_intelligence::detect_workflow_patterns(pp);
        for pattern in patterns.iter().take(2) {
            suggestions.push(PredictiveSuggestion {
                suggestion_type: "workflow_pattern".to_string(),
                title: format!("Pattern: {}", pattern.pattern_type),
                description: pattern.description.clone(),
                confidence: (pattern.frequency as f64 / 10.0).min(1.0),
                related_files: pattern.files_involved.clone(),
                related_decisions: Vec::new(),
                action: "apply_pattern".to_string(),
            });
        }
    }

    // Sort by confidence
    suggestions.sort_by(|a, b| b.confidence.partial_cmp(&a.confidence).unwrap_or(std::cmp::Ordering::Equal));
    suggestions
}

/// Assemble smart context from workspace intelligence
pub fn assemble_smart_context(
    prompt: &str,
    project_path: Option<&str>,
    max_tokens: usize,
) -> SmartContext {
    let mut token_budget = max_tokens;

    // 1. Get relevant brain search results
    let search_results = crate::second_brain::search(prompt, project_path, 5);
    let related_summaries: Vec<String> = search_results
        .iter()
        .take(3)
        .map(|r| r.snippet.clone())
        .collect();
    for s in &related_summaries {
        token_budget = token_budget.saturating_sub(s.len() / 4);
    }

    // 2. Get relevant decisions
    let decision_results = crate::second_brain::query_decisions(prompt, project_path, 3);
    let prior_decisions: Vec<String> = decision_results
        .iter()
        .map(|r| format!("{}: {}", r.decision.title, r.decision.decision))
        .collect();
    for d in &prior_decisions {
        token_budget = token_budget.saturating_sub(d.len() / 4);
    }

    // 3. Get relevant files from semantic search
    let sim_results = crate::second_brain::semantic_search(prompt, project_path, 5);
    let relevant_files: Vec<String> = sim_results
        .iter()
        .filter(|r| r.source_type == "summary")
        .flat_map(|r| {
            crate::second_brain::list_summaries(project_path)
                .iter()
                .find(|s| s.session_id == r.source_id)
                .map(|s| s.files_touched.clone())
                .unwrap_or_default()
        })
        .take(10)
        .collect();

    // 4. Get architectural context
    let arch_context = if let Some(pp) = project_path {
        let drift = crate::repo_intelligence::detect_drift(pp);
        if drift.violations.is_empty() {
            format!("Architecture health: {:.0}%", drift.health_score)
        } else {
            let warnings: Vec<String> = drift
                .violations
                .iter()
                .take(3)
                .map(|v| v.description.clone())
                .collect();
            format!(
                "Architecture health: {:.0}% — Warnings: {}",
                drift.health_score,
                warnings.join("; ")
            )
        }
    } else {
        String::new()
    };

    // 5. Workflow hints
    let workflow_hints = if let Some(pp) = project_path {
        crate::repo_intelligence::detect_workflow_patterns(pp)
            .iter()
            .take(2)
            .map(|p| p.description.clone())
            .collect()
    } else {
        Vec::new()
    };

    let total_tokens = max_tokens - token_budget;

    SmartContext {
        relevant_files,
        prior_decisions,
        related_summaries,
        architectural_context: arch_context,
        workflow_hints,
        total_tokens,
    }
}

/// Generate workflow recommendations based on context
pub fn recommend_workflows(
    prompt: &str,
    project_path: Option<&str>,
) -> Vec<WorkflowRecommendation> {
    let mut recommendations: Vec<WorkflowRecommendation> = Vec::new();
    let lower = prompt.to_lowercase();

    // Detect testing need
    if lower.contains("test") || lower.contains("coverage") || lower.contains("spec") {
        recommendations.push(WorkflowRecommendation {
            recommendation_type: "testing".to_string(),
            title: "Testing Strategy".to_string(),
            description: "Comprehensive testing workflow for your changes".to_string(),
            confidence: 0.8,
            steps: vec![
                "Analyze changed files and their dependencies".to_string(),
                "Generate unit tests for modified functions".to_string(),
                "Run existing test suite to check regressions".to_string(),
                "Review coverage gaps".to_string(),
            ],
            estimated_tokens: 4000,
        });
    }

    // Detect debugging need
    if lower.contains("bug") || lower.contains("fix") || lower.contains("debug") || lower.contains("error") {
        let mut steps = vec![
            "Reproduce the issue".to_string(),
            "Trace error to root cause".to_string(),
            "Implement fix".to_string(),
            "Verify fix resolves the issue".to_string(),
        ];

        // Check if there are related decisions
        if let Some(pp) = project_path {
            let patterns = crate::repo_intelligence::detect_workflow_patterns(pp);
            if patterns.iter().any(|p| p.pattern_type == "debugging_flow") {
                steps.push("Review related debugging history".to_string());
            }
        }

        recommendations.push(WorkflowRecommendation {
            recommendation_type: "debugging".to_string(),
            title: "Debugging Flow".to_string(),
            description: "Systematic debugging workflow".to_string(),
            confidence: 0.85,
            steps,
            estimated_tokens: 6000,
        });
    }

    // Detect architecture review need
    if lower.contains("refactor") || lower.contains("architect") || lower.contains("design")
        || lower.contains("restructure")
    {
        recommendations.push(WorkflowRecommendation {
            recommendation_type: "architecture_review".to_string(),
            title: "Architecture Review".to_string(),
            description: "Review current architecture before making changes".to_string(),
            confidence: 0.75,
            steps: vec![
                "Analyze current module structure".to_string(),
                "Check for architectural drift".to_string(),
                "Review dependency graph".to_string(),
                "Propose changes with impact analysis".to_string(),
                "Document architectural decisions".to_string(),
            ],
            estimated_tokens: 5000,
        });
    }

    // General coding recommendation
    if lower.contains("implement") || lower.contains("create") || lower.contains("build")
        || lower.contains("add")
    {
        recommendations.push(WorkflowRecommendation {
            recommendation_type: "implementation".to_string(),
            title: "Implementation Workflow".to_string(),
            description: "Structured approach to implementing new functionality".to_string(),
            confidence: 0.7,
            steps: vec![
                "Review existing architecture and patterns".to_string(),
                "Design the implementation approach".to_string(),
                "Implement core functionality".to_string(),
                "Add tests".to_string(),
                "Review and document".to_string(),
            ],
            estimated_tokens: 5000,
        });
    }

    // Sort by confidence
    recommendations.sort_by(|a, b| b.confidence.partial_cmp(&a.confidence).unwrap_or(std::cmp::Ordering::Equal));
    recommendations
}

/// Full predictive analysis
#[derive(Debug, Clone, Serialize)]
pub struct PredictiveAnalysis {
    pub suggestions: Vec<PredictiveSuggestion>,
    pub smart_context: SmartContext,
    pub recommendations: Vec<WorkflowRecommendation>,
}

pub fn get_predictive_analysis(
    prompt: &str,
    current_file: Option<&str>,
    project_path: Option<&str>,
    max_context_tokens: usize,
) -> PredictiveAnalysis {
    let suggestions = generate_suggestions(current_file, Some(prompt), project_path);
    let smart_context = assemble_smart_context(prompt, project_path, max_context_tokens);
    let recommendations = recommend_workflows(prompt, project_path);

    PredictiveAnalysis {
        suggestions,
        smart_context,
        recommendations,
    }
}
