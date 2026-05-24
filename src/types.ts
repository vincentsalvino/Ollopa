// ═══════ Shared Types ═══════

export interface CostData {
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export type Theme = "dark" | "light";

// ═══════ Timeline Entry Types ═══════

export type TimelineEntryKind =
  | "user_message"
  | "assistant_message"
  | "tool_use"
  | "tool_result"
  | "approval_request"
  | "status"
  | "error"
  | "session_start"
  | "session_end";

export interface TimelineEntry {
  id: string;
  kind: TimelineEntryKind;
  timestamp: number;
  data: TimelineData;
}

export type TimelineData =
  | UserMessageData
  | AssistantMessageData
  | ToolUseData
  | ToolResultData
  | ApprovalRequestData
  | StatusData
  | ErrorData
  | SessionStartData
  | SessionEndData;

export interface UserMessageData {
  kind: "user_message";
  content: string;
}

export interface AssistantMessageData {
  kind: "assistant_message";
  text: string;
  model: string;
}

export interface ToolUseData {
  kind: "tool_use";
  tool_use_id: string;
  tool_name: string;
  input: Record<string, unknown>;
  status: "running" | "success" | "error";
  output?: string;
  is_error?: boolean;
  started_at: number;
  finished_at?: number;
  duration_ms?: number;
}

export interface ToolResultData {
  kind: "tool_result";
  tool_use_id: string;
  tool_name: string;
  output: string;
  is_error: boolean;
}

export interface ApprovalRequestData {
  kind: "approval_request";
  tool_use_id: string;
  tool_name: string;
  input: Record<string, unknown>;
  risk_level: string;
  risk_label: string;
  status: "pending" | "approved" | "denied";
}

export interface StatusData {
  kind: "status";
  status: string;
  detail: string;
}

export interface ErrorData {
  kind: "error";
  message: string;
  recoverable: boolean;
}

export interface SessionStartData {
  kind: "session_start";
  session_id: string;
  model: string;
  cwd: string;
  tools: string[];
}

export interface SessionEndData {
  kind: "session_end";
  session_id: string;
  cost_usd: number;
  duration_ms: number;
  num_turns: number;
  is_error: boolean;
}

// ═══════ App Event Types (from Rust backend) ═══════

export interface SessionStartedEvent {
  type: "session_started";
  session_id: string;
  model: string;
  cwd: string;
  tools: string[];
}

export interface AssistantMessageEvent {
  type: "assistant_message";
  text: string;
  model: string;
}

export interface ToolStartedEvent {
  type: "tool_started";
  tool_use_id: string;
  tool_name: string;
  input: Record<string, unknown>;
}

export interface ToolFinishedEvent {
  type: "tool_finished";
  tool_use_id: string;
  tool_name: string;
  output: string;
  is_error: boolean;
}

export interface ApprovalRequiredEvent {
  type: "approval_required";
  tool_use_id: string;
  tool_name: string;
  input: Record<string, unknown>;
  risk_level: string;
  risk_label: string;
}

export interface FileDiffEvent {
  type: "file_diff";
  tool_use_id: string;
  file_path: string;
  old_content: string;
  new_content: string;
}

export interface TokenUsageEvent {
  type: "token_usage";
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export interface StatusUpdateEvent {
  type: "status_update";
  status: string;
  detail: string;
}

export interface SessionFinishedEvent {
  type: "session_finished";
  session_id: string;
  cost_usd: number;
  duration_ms: number;
  num_turns: number;
  is_error: boolean;
}

export interface ErrorEvent {
  type: "error";
  message: string;
  recoverable: boolean;
}

export type AppEvent =
  | SessionStartedEvent
  | AssistantMessageEvent
  | ToolStartedEvent
  | ToolFinishedEvent
  | ApprovalRequiredEvent
  | FileDiffEvent
  | TokenUsageEvent
  | StatusUpdateEvent
  | SessionFinishedEvent
  | ErrorEvent;

// ═══════ Event Store State ═══════

export interface EventStoreState {
  timeline: TimelineEntry[];
  sessionId: string | null;
  sessionModel: string;
  sessionCost: CostData;
  isTyping: boolean;
  activeApproval: ApprovalRequestData | null;
  activeDiff: { filePath: string; oldContent: string; newContent: string; toolUseId: string } | null;
}

// ═══════ Session Meta (from backend) ═══════

export interface SessionMeta {
  key: string;
  preview: string;
  message_count: number;
}

// ═══════ Toast ═══════

export interface ToastMessage {
  id: number;
  text: string;
  type: "success" | "info" | "error";
}

// ═══════ Slash Commands ═══════

export interface SlashCommand {
  cmd: string;
  desc: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: "/compact", desc: "Compress context to save tokens" },
  { cmd: "/clear", desc: "Clear conversation history" },
  { cmd: "/config", desc: "View or set configuration options" },
  { cmd: "/cost", desc: "Show token usage and cost for this session" },
  { cmd: "/doctor", desc: "Check Claude Code health and connectivity" },
  { cmd: "/help", desc: "Show available commands and usage" },
  { cmd: "/init", desc: "Initialize CLAUDE.md in current project" },
  { cmd: "/login", desc: "Switch authentication or re-login" },
  { cmd: "/logout", desc: "Log out of current session" },
  { cmd: "/memory", desc: "Edit CLAUDE.md memory files" },
  { cmd: "/model", desc: "Switch model" },
  { cmd: "/permissions", desc: "View or update tool permissions" },
  { cmd: "/review", desc: "Review code changes in current project" },
  { cmd: "/status", desc: "Show current session status and model" },
  { cmd: "/vim", desc: "Toggle vim mode for input" },
];

export const EMPTY_COST: CostData = { input_tokens: 0, output_tokens: 0, cost_usd: 0 };
