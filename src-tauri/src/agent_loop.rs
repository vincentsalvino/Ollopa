use crate::api_client::DirectApiClient;
use crate::ollopa_events::AppEvent;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

// ═══════ Agent Loop State Machine ═══════

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AgentState {
    Idle,
    Planning,
    Executing,
    Reflecting,
    Verifying,
    Done,
    Failed,
    Paused,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentStep {
    pub index: usize,
    pub description: String,
    pub status: StepStatus,
    pub tool_name: Option<String>,
    pub tool_output: Option<String>,
    pub reflection: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum StepStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Skipped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentPlan {
    pub task: String,
    pub steps: Vec<AgentStep>,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentLoopConfig {
    pub max_iterations: usize,
    pub auto_approve_safe: bool,
    pub auto_approve_medium: bool,
    pub planning_model: Option<String>,
    pub coding_model: Option<String>,
    pub project_path: Option<String>,
    pub token_budget: usize,
}

impl Default for AgentLoopConfig {
    fn default() -> Self {
        Self {
            max_iterations: 25,
            auto_approve_safe: true,
            auto_approve_medium: true,
            planning_model: None,
            coding_model: None,
            project_path: None,
            token_budget: 32_000,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[allow(dead_code)]
pub struct AgentLoopStatus {
    pub state: AgentState,
    pub current_iteration: usize,
    pub max_iterations: usize,
    pub plan: Option<AgentPlan>,
    pub current_step: Option<usize>,
    pub task: String,
}

/// The agent loop orchestrates Plan → Execute → Observe → Reflect cycles.
pub struct AgentLoop {
    pub state: AgentState,
    pub config: AgentLoopConfig,
    pub plan: Option<AgentPlan>,
    pub current_iteration: usize,
    pub task: String,
    paused: bool,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

impl AgentLoop {
    pub fn new(task: &str, config: AgentLoopConfig) -> Self {
        Self {
            state: AgentState::Idle,
            config,
            plan: None,
            current_iteration: 0,
            task: task.to_string(),
            paused: false,
        }
    }

    #[allow(dead_code)]
    pub fn status(&self) -> AgentLoopStatus {
        AgentLoopStatus {
            state: self.state.clone(),
            current_iteration: self.current_iteration,
            max_iterations: self.config.max_iterations,
            plan: self.plan.clone(),
            current_step: self.plan.as_ref().and_then(|p| {
                p.steps.iter().position(|s| s.status == StepStatus::Running)
            }),
            task: self.task.clone(),
        }
    }

    #[allow(dead_code)]
    pub fn pause(&mut self) {
        if self.state == AgentState::Executing || self.state == AgentState::Planning {
            self.paused = true;
            self.state = AgentState::Paused;
        }
    }

    #[allow(dead_code)]
    pub fn resume(&mut self) {
        if self.state == AgentState::Paused {
            self.paused = false;
            self.state = AgentState::Executing;
        }
    }

    /// Run the full agent loop: Plan → Execute → Observe → Reflect → Verify
    pub async fn run(
        &mut self,
        client: &mut DirectApiClient,
        app_handle: &AppHandle,
    ) -> Result<String, String> {
        self.state = AgentState::Planning;
        let original_model = client.model().to_string();

        let _ = app_handle.emit(
            "app-event",
            AppEvent::AgentLoopStarted {
                task: self.task.clone(),
                max_iterations: self.config.max_iterations,
            },
        );

        // Phase 3: Assemble smart context (repo map + skills + relevant files)
        let mut context_parts: Vec<String> = Vec::new();

        if let Some(ref project_path) = self.config.project_path {
            // Inject repo map
            if let Ok(map) = crate::codebase_indexer::generate_repo_map(project_path) {
                let map_text = crate::codebase_indexer::repo_map_to_text(&map);
                context_parts.push(map_text);
            }

            // Inject relevant file contents
            if let Ok(selection) = crate::codebase_indexer::select_files_for_task(
                project_path,
                &self.task,
                10,
                self.config.token_budget,
            ) {
                if !selection.files.is_empty() {
                    let mut file_context = String::from("# Relevant Files\n");
                    for f in &selection.files {
                        file_context.push_str(&format!(
                            "\n## {} (score: {:.1}, ~{} tokens)\n```\n{}\n```\n",
                            f.path, f.relevance_score, f.token_estimate,
                            if f.content.len() > 8000 { &f.content[..8000] } else { &f.content }
                        ));
                    }
                    context_parts.push(file_context);
                }
            }
        }

        // Inject matching skills from previous tasks
        let skills = crate::second_brain::search_skills(&self.task, self.config.project_path.as_deref());
        if !skills.is_empty() {
            context_parts.push(crate::second_brain::skills_to_context(&skills));
        }

        let context_block = context_parts.join("\n\n---\n\n");

        // Phase 3: Multi-model routing — use flash model for planning
        if let Some(ref planning_model) = self.config.planning_model {
            client.set_model(planning_model);
        }

        // PLAN: Ask the LLM to create a structured plan
        let plan_prompt = if context_block.is_empty() {
            format!(
                "You are an autonomous coding agent. Create a step-by-step plan to accomplish:\n\n\
                {}\n\n\
                Output ONLY a numbered list of specific steps. Each step should be a single action \
                (read a file, edit a file, run a command, etc.). Be concise.\n\
                Format: one step per line, numbered 1-N.",
                self.task
            )
        } else {
            format!(
                "You are an autonomous coding agent. Create a step-by-step plan to accomplish:\n\n\
                {}\n\n\
                Here is context about the codebase:\n\n{}\n\n\
                Output ONLY a numbered list of specific steps. Each step should be a single action \
                (read a file, edit a file, run a command, etc.). Be concise.\n\
                Format: one step per line, numbered 1-N.",
                self.task, context_block
            )
        };

        client.send_message(&plan_prompt, app_handle).await?;

        let plan_text = client.last_assistant_message().unwrap_or_default();
        let steps = parse_plan_steps(&plan_text);

        if steps.is_empty() {
            self.state = AgentState::Failed;
            return Err("Failed to generate a plan".to_string());
        }

        let step_descriptions: Vec<String> = steps.iter().map(|s| s.description.clone()).collect();

        let _ = app_handle.emit(
            "app-event",
            AppEvent::AgentPlanCreated {
                steps: step_descriptions.clone(),
            },
        );

        self.plan = Some(AgentPlan {
            task: self.task.clone(),
            steps,
            created_at: now_ms(),
        });

        self.state = AgentState::Executing;

        // Phase 3: Switch to coding model for execution
        if let Some(ref coding_model) = self.config.coding_model {
            client.set_model(coding_model);
        } else {
            client.set_model(&original_model);
        }

        // EXECUTE: Iterate through plan steps
        let plan_len = self.plan.as_ref().map(|p| p.steps.len()).unwrap_or(0);
        let mut summary_parts: Vec<String> = Vec::new();

        for step_idx in 0..plan_len {
            if self.paused {
                return Ok("Agent loop paused".to_string());
            }

            self.current_iteration += 1;
            if self.current_iteration > self.config.max_iterations {
                self.state = AgentState::Failed;
                let _ = app_handle.emit(
                    "app-event",
                    AppEvent::AgentLoopFinished {
                        task: self.task.clone(),
                        iterations: self.current_iteration,
                        success: false,
                        summary: "Max iterations exceeded".to_string(),
                    },
                );
                return Err(format!(
                    "Agent loop exceeded max iterations ({})",
                    self.config.max_iterations
                ));
            }

            // Mark step as running
            if let Some(ref mut plan) = self.plan {
                plan.steps[step_idx].status = StepStatus::Running;
            }

            let step_desc = self.plan.as_ref()
                .map(|p| p.steps[step_idx].description.clone())
                .unwrap_or_default();

            let _ = app_handle.emit(
                "app-event",
                AppEvent::AgentStepStarted {
                    step_index: step_idx,
                    description: step_desc.clone(),
                },
            );

            // Ask the LLM to execute this step using tools
            let execute_prompt = format!(
                "Execute step {} of the plan: {}\n\n\
                Use the available tools to complete this step. \
                If you need to read, write, edit files, run commands, or search code, \
                use the appropriate tool.",
                step_idx + 1,
                step_desc
            );

            let exec_result = client.send_message(&execute_prompt, app_handle).await;

            match exec_result {
                Ok(()) => {
                    let output = client.last_assistant_message().unwrap_or_default();

                    // Mark step completed
                    if let Some(ref mut plan) = self.plan {
                        plan.steps[step_idx].status = StepStatus::Completed;
                        plan.steps[step_idx].tool_output = Some(truncate_output(&output, 500));
                    }

                    summary_parts.push(format!("Step {}: {} - Done", step_idx + 1, step_desc));

                    // REFLECT: Switch to flash model for cheap reflection
                    self.state = AgentState::Reflecting;
                    if let Some(ref planning_model) = self.config.planning_model {
                        client.set_model(planning_model);
                    }
                    let reflect_prompt = format!(
                        "You just completed: {}\nResult: {}\n\n\
                        Was this step successful? If not, what should be adjusted? \
                        Answer briefly (1-2 sentences).",
                        step_desc,
                        truncate_output(&output, 300)
                    );

                    let _ = client.send_message(&reflect_prompt, app_handle).await;
                    let reflection = client.last_assistant_message().unwrap_or_default();

                    if let Some(ref mut plan) = self.plan {
                        plan.steps[step_idx].reflection = Some(truncate_output(&reflection, 200));
                    }

                    let _ = app_handle.emit(
                        "app-event",
                        AppEvent::AgentReflection {
                            step_index: step_idx,
                            result: truncate_output(&output, 200),
                            adjustment: None,
                        },
                    );

                    self.state = AgentState::Executing;
                    // Switch back to coding model for next step
                    if let Some(ref coding_model) = self.config.coding_model {
                        client.set_model(coding_model);
                    }
                }
                Err(e) => {
                    // Step failed — mark and continue
                    if let Some(ref mut plan) = self.plan {
                        plan.steps[step_idx].status = StepStatus::Failed;
                        plan.steps[step_idx].tool_output = Some(e.clone());
                    }
                    summary_parts.push(format!(
                        "Step {}: {} - FAILED: {}",
                        step_idx + 1,
                        step_desc,
                        e
                    ));

                    let _ = app_handle.emit(
                        "app-event",
                        AppEvent::AgentReflection {
                            step_index: step_idx,
                            result: format!("Failed: {}", e),
                            adjustment: Some("Continuing to next step".to_string()),
                        },
                    );
                }
            }
        }

        // VERIFY: Summary of what was done
        self.state = AgentState::Verifying;

        // Restore original model for verification
        client.set_model(&original_model);

        let summary = summary_parts.join("\n");

        let verify_prompt = format!(
            "The agent loop has completed all steps for: {}\n\n\
            Summary:\n{}\n\n\
            Provide a brief final summary of what was accomplished.",
            self.task, summary
        );

        let _ = client.send_message(&verify_prompt, app_handle).await;
        let final_summary = client.last_assistant_message().unwrap_or(summary.clone());

        self.state = AgentState::Done;

        let _ = app_handle.emit(
            "app-event",
            AppEvent::AgentLoopFinished {
                task: self.task.clone(),
                iterations: self.current_iteration,
                success: true,
                summary: truncate_output(&final_summary, 500),
            },
        );

        // Phase 3: Save skill with files collected from tool outputs
        let files_involved: Vec<String> = self.plan.as_ref()
            .map(|p| p.steps.iter()
                .filter_map(|s| s.tool_output.as_ref())
                .flat_map(|output| {
                    // Extract file paths from tool outputs
                    output.lines()
                        .filter(|l| l.contains('/') && (l.ends_with(".rs") || l.ends_with(".ts") || l.ends_with(".tsx") || l.ends_with(".js") || l.ends_with(".py")))
                        .map(|l| l.trim().to_string())
                        .collect::<Vec<_>>()
                })
                .collect())
            .unwrap_or_default();

        let _ = crate::second_brain::save_skill(
            &self.task,
            &step_descriptions,
            &files_involved,
        );

        // Invalidate repo map if we modified files
        if let Some(ref project_path) = self.config.project_path {
            crate::codebase_indexer::invalidate_repo_map(project_path);
        }

        Ok(final_summary)
    }
}

// ═══════ Helpers ═══════

fn parse_plan_steps(text: &str) -> Vec<AgentStep> {
    let mut steps = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        // Match numbered lines: "1. Do something" or "1) Do something"
        let desc = trimmed
            .trim_start_matches(|c: char| c.is_ascii_digit() || c == '.' || c == ')' || c == ' ')
            .trim();
        if !desc.is_empty() && desc.len() > 3 {
            steps.push(AgentStep {
                index: steps.len(),
                description: desc.to_string(),
                status: StepStatus::Pending,
                tool_name: None,
                tool_output: None,
                reflection: None,
            });
        }
    }
    steps
}

fn truncate_output(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}...", &s[..max])
    }
}
