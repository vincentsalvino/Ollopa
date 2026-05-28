import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ToastMessage } from "../../types";

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
      });
      onToast("Agent loop completed", "success");
      console.log("Agent result:", result);
    } catch (e) {
      onToast(`Agent loop failed: ${e}`, "error");
    } finally {
      setIsStarting(false);
    }
  }, [task, maxIterations, onToast]);

  if (!visible) return null;

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
          🤖 Agent Execution
        </h3>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: "18px",
          }}
        >
          ×
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
            {isAgentRunning ? "Running..." : isStarting ? "Starting..." : "▶ Run Agent"}
          </button>
        </div>
      </div>

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
                    {isCompleted ? "✓" : isCurrent ? "⟳" : "○"}
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
                <div style={{ fontSize: "24px", marginBottom: "8px" }}>⟳</div>
                <div>Agent is planning...</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: "24px", marginBottom: "8px" }}>🤖</div>
                <div>Enter a task and click Run Agent</div>
                <div style={{ fontSize: "11px", marginTop: "4px" }}>
                  The agent will create a plan and execute it step by step
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
