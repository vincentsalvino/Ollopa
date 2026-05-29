import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ToastMessage, CostEstimate, Skill } from "../../types";

interface AgentExecutionPanelProps {
  visible: boolean;
  onClose: () => void;
  onToast: (text: string, type: ToastMessage["type"]) => void;
  agentPlan: string[] | null;
  agentCurrentStep: number | null;
  isAgentRunning: boolean;
}

export default function AgentExecutionPanel({
  visible,
  onClose,
  onToast,
  agentPlan,
  agentCurrentStep,
  isAgentRunning,
}: AgentExecutionPanelProps) {
  const [task, setTask] = useState("");
  const [maxIterations, setMaxIterations] = useState(25);
  const [isStarting, setIsStarting] = useState(false);
  const [planningModel, setPlanningModel] = useState("deepseek-v4-flash");
  const [codingModel, setCodingModel] = useState("deepseek-v4-pro");
  const [projectPath, setProjectPath] = useState("");
  const [costEstimate, setCostEstimate] = useState<CostEstimate | null>(null);
  const [matchingSkills, setMatchingSkills] = useState<Skill[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Estimate cost when task changes
  useEffect(() => {
    if (!task.trim() || task.trim().length < 10) {
      setCostEstimate(null);
      setMatchingSkills([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const estimate = await invoke<CostEstimate>("estimate_agent_cost", {
          task: task.trim(),
          model: codingModel,
        });
        setCostEstimate(estimate);
      } catch {
        setCostEstimate(null);
      }
      try {
        const skills = await invoke<Skill[]>("search_skills", {
          task: task.trim(),
          projectPath: projectPath || null,
        });
        setMatchingSkills(skills);
      } catch {
        setMatchingSkills([]);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [task, codingModel, projectPath]);

  const startAgentLoop = useCallback(async () => {
    if (!task.trim()) {
      onToast("Please enter a task description", "error");
      return;
    }
    setIsStarting(true);
    try {
      const result = await invoke<string>("agent_run_loop", {
        task: task.trim(),
        maxIterations: maxIterations,
        planningModel: planningModel || null,
        codingModel: codingModel || null,
        projectPath: projectPath || null,
      });
      onToast("Agent loop completed", "success");
      console.log("Agent result:", result);
    } catch (e) {
      onToast(`Agent loop failed: ${e}`, "error");
    } finally {
      setIsStarting(false);
    }
  }, [task, maxIterations, planningModel, codingModel, projectPath, onToast]);

  if (!visible) return null;

  const completedSteps =
    agentPlan && agentCurrentStep !== null
      ? Math.min(agentCurrentStep + 1, agentPlan.length)
      : 0;
  const totalSteps = agentPlan?.length ?? 0;
  const progressPct = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        width: "420px",
        height: "100vh",
        backgroundColor: "var(--bg-secondary)",
        borderLeft: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        zIndex: 50,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 600 }}>
          Agent Execution
        </h3>
        <button
          onClick={onClose}
          style={{
            background: "var(--bg-tertiary)",
            border: "1px solid var(--border-accent)",
            color: "var(--text-primary)",
            cursor: "pointer",
            fontSize: "16px",
            lineHeight: 1,
            borderRadius: "var(--radius)",
            width: "30px",
            height: "30px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "all 0.15s",
          }}
          title="Close Agent Panel"
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "var(--danger)";
            e.currentTarget.style.color = "var(--danger)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "var(--border-accent)";
            e.currentTarget.style.color = "var(--text-primary)";
          }}
        >
          &times;
        </button>
      </div>

      {/* Task Input */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
        <textarea
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder="Describe the task for the agent..."
          disabled={isAgentRunning || isStarting}
          style={{
            width: "100%",
            minHeight: "80px",
            padding: "8px",
            backgroundColor: "var(--bg-primary)",
            color: "var(--text-primary)",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            resize: "vertical",
            fontSize: "13px",
            fontFamily: "inherit",
          }}
        />

        {/* Cost Estimate */}
        {costEstimate && (
          <div
            style={{
              marginTop: "6px",
              padding: "6px 8px",
              backgroundColor: "rgba(var(--accent-rgb, 99, 102, 241), 0.08)",
              borderRadius: "4px",
              fontSize: "11px",
              color: "var(--text-secondary)",
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span>
              Est. {costEstimate.estimated_steps} steps, ~
              {(costEstimate.estimated_input_tokens / 1000).toFixed(1)}k tokens
            </span>
            <span style={{ fontWeight: 600 }}>
              ~${costEstimate.estimated_cost_usd.toFixed(4)}
            </span>
          </div>
        )}

        {/* Matching Skills */}
        {matchingSkills.length > 0 && (
          <div
            style={{
              marginTop: "6px",
              padding: "6px 8px",
              backgroundColor: "rgba(34, 197, 94, 0.08)",
              borderRadius: "4px",
              fontSize: "11px",
              color: "var(--text-secondary)",
            }}
          >
            <span style={{ fontWeight: 600 }}>Similar skills found:</span>
            {matchingSkills.slice(0, 2).map((skill) => (
              <div key={skill.id} style={{ marginTop: "2px" }}>
                {skill.task_pattern.substring(0, 60)}
                {skill.task_pattern.length > 60 ? "..." : ""} (used{" "}
                {skill.success_count}x)
              </div>
            ))}
          </div>
        )}

        {/* Advanced Settings Toggle */}
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: "11px",
            marginTop: "6px",
            padding: 0,
            textDecoration: "underline",
          }}
        >
          {showAdvanced ? "Hide" : "Show"} advanced settings
        </button>

        {showAdvanced && (
          <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "6px" }}>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <label style={{ fontSize: "11px", color: "var(--text-muted)", width: "80px" }}>
                Plan model:
              </label>
              <select
                value={planningModel}
                onChange={(e) => setPlanningModel(e.target.value)}
                disabled={isAgentRunning}
                style={{
                  flex: 1,
                  padding: "4px 6px",
                  backgroundColor: "var(--bg-primary)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border)",
                  borderRadius: "4px",
                  fontSize: "11px",
                }}
              >
                <option value="deepseek-v4-flash">DeepSeek v4 Flash (cheap)</option>
                <option value="deepseek-v4-pro">DeepSeek v4 Pro</option>
                <option value="mimo-v2.5">MiMo v2.5</option>
                <option value="mimo-v2-flash">MiMo v2 Flash</option>
              </select>
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <label style={{ fontSize: "11px", color: "var(--text-muted)", width: "80px" }}>
                Code model:
              </label>
              <select
                value={codingModel}
                onChange={(e) => setCodingModel(e.target.value)}
                disabled={isAgentRunning}
                style={{
                  flex: 1,
                  padding: "4px 6px",
                  backgroundColor: "var(--bg-primary)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border)",
                  borderRadius: "4px",
                  fontSize: "11px",
                }}
              >
                <option value="deepseek-v4-pro">DeepSeek v4 Pro (quality)</option>
                <option value="deepseek-v4-flash">DeepSeek v4 Flash</option>
                <option value="mimo-v2.5-pro">MiMo v2.5 Pro</option>
                <option value="mimo-v2.5">MiMo v2.5</option>
              </select>
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <label style={{ fontSize: "11px", color: "var(--text-muted)", width: "80px" }}>
                Project path:
              </label>
              <input
                type="text"
                value={projectPath}
                onChange={(e) => setProjectPath(e.target.value)}
                placeholder="/path/to/project"
                disabled={isAgentRunning}
                style={{
                  flex: 1,
                  padding: "4px 6px",
                  backgroundColor: "var(--bg-primary)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border)",
                  borderRadius: "4px",
                  fontSize: "11px",
                }}
              />
            </div>
          </div>
        )}

        <div
          style={{
            display: "flex",
            gap: "8px",
            marginTop: "8px",
            alignItems: "center",
          }}
        >
          <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>
            Max iterations:
          </label>
          <input
            type="number"
            value={maxIterations}
            onChange={(e) => setMaxIterations(Number(e.target.value))}
            min={1}
            max={100}
            disabled={isAgentRunning || isStarting}
            style={{
              width: "60px",
              padding: "4px 6px",
              backgroundColor: "var(--bg-primary)",
              color: "var(--text-primary)",
              border: "1px solid var(--border)",
              borderRadius: "4px",
              fontSize: "12px",
            }}
          />
          <button
            onClick={startAgentLoop}
            disabled={isAgentRunning || isStarting || !task.trim()}
            style={{
              marginLeft: "auto",
              padding: "6px 16px",
              backgroundColor: isAgentRunning ? "var(--text-muted)" : "var(--accent)",
              color: "white",
              border: "none",
              borderRadius: "6px",
              cursor: isAgentRunning ? "not-allowed" : "pointer",
              fontSize: "12px",
              fontWeight: 600,
            }}
          >
            {isAgentRunning ? "Running..." : isStarting ? "Starting..." : "Run Agent"}
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      {isAgentRunning && totalSteps > 0 && (
        <div style={{ padding: "0 16px" }}>
          <div
            style={{
              width: "100%",
              height: "4px",
              backgroundColor: "var(--border)",
              borderRadius: "2px",
              overflow: "hidden",
              marginTop: "8px",
            }}
          >
            <div
              style={{
                width: `${progressPct}%`,
                height: "100%",
                backgroundColor: "var(--accent)",
                borderRadius: "2px",
                transition: "width 0.3s ease",
              }}
            />
          </div>
          <div
            style={{
              fontSize: "10px",
              color: "var(--text-muted)",
              textAlign: "right",
              marginTop: "2px",
            }}
          >
            {completedSteps}/{totalSteps} steps
          </div>
        </div>
      )}

      {/* Plan Display */}
      <div style={{ flex: 1, overflow: "auto", padding: "12px 16px" }}>
        {agentPlan && agentPlan.length > 0 ? (
          <div>
            <h4
              style={{
                fontSize: "12px",
                fontWeight: 600,
                color: "var(--text-muted)",
                textTransform: "uppercase",
                marginBottom: "8px",
              }}
            >
              Execution Plan
            </h4>
            {agentPlan.map((step, idx) => {
              const isCurrent = agentCurrentStep === idx;
              const isCompleted = agentCurrentStep !== null && idx < agentCurrentStep;
              return (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    gap: "8px",
                    padding: "6px 8px",
                    marginBottom: "4px",
                    borderRadius: "4px",
                    backgroundColor: isCurrent
                      ? "rgba(var(--accent-rgb, 99, 102, 241), 0.1)"
                      : "transparent",
                    borderLeft: isCurrent
                      ? "3px solid var(--accent)"
                      : "3px solid transparent",
                  }}
                >
                  <span style={{ fontSize: "14px", width: "20px", textAlign: "center" }}>
                    {isCompleted ? "v" : isCurrent ? "~" : "o"}
                  </span>
                  <span
                    style={{
                      fontSize: "13px",
                      color: isCompleted
                        ? "var(--text-muted)"
                        : isCurrent
                        ? "var(--text-primary)"
                        : "var(--text-secondary)",
                      textDecoration: isCompleted ? "line-through" : "none",
                    }}
                  >
                    {step}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div
            style={{
              textAlign: "center",
              color: "var(--text-muted)",
              fontSize: "13px",
              marginTop: "40px",
            }}
          >
            {isAgentRunning ? (
              <>
                <div style={{ fontSize: "16px", marginBottom: "8px", animation: "spin 1s linear infinite" }}>~</div>
                <div>Agent is thinking...</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: "24px", marginBottom: "8px" }}>A</div>
                <div>Enter a task and click Run Agent</div>
                <div style={{ fontSize: "11px", marginTop: "4px" }}>
                  The agent will create a plan, select relevant files, and execute step by step
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
