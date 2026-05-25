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

export interface UserMessageEvent {
  type: "user_message";
  text: string;
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

export interface StreamingChunkEvent {
  type: "streaming_chunk";
  text: string;
  model: string;
}

export interface GenerationStoppedEvent {
  type: "generation_stopped";
  partial_text: string;
  model: string;
}

export type AppEvent =
  | SessionStartedEvent
  | UserMessageEvent
  | AssistantMessageEvent
  | ToolStartedEvent
  | ToolFinishedEvent
  | ApprovalRequiredEvent
  | FileDiffEvent
  | TokenUsageEvent
  | StatusUpdateEvent
  | SessionFinishedEvent
  | ErrorEvent
  | StreamingChunkEvent
  | GenerationStoppedEvent;

// ═══════ Event Store State ═══════

export interface EventStoreState {
  timeline: TimelineEntry[];
  sessionId: string | null;
  sessionModel: string;
  sessionCost: CostData;
  isTyping: boolean;
  isStreaming: boolean;
  streamingText: string;
  activeApproval: ApprovalRequestData | null;
  activeDiff: { filePath: string; oldContent: string; newContent: string; toolUseId: string } | null;
}

// ═══════ Session Meta (from backend) ═══════

export interface SessionMeta {
  key: string;
  preview: string;
  message_count: number;
  status: string;
  project_path: string | null;
  created_at: number;
  updated_at: number;
  cost_usd: number;
}

// ═══════ Session Replay (from backend) ═══════

export interface PersistedEvent {
  timestamp_ms: number;
  event: AppEvent;
}

export interface SessionSnapshot {
  session_id: string;
  project_path: string | null;
  model: string;
  created_at: number;
  updated_at: number;
  message_count: number;
  status: string;
  cost_usd: number;
  duration_ms: number;
  events: PersistedEvent[];
}

// ═══════ Second Brain Types ═══════

export interface SessionSummaryData {
  session_id: string;
  project_path: string | null;
  created_at: number;
  title: string;
  summary: string;
  key_actions: string[];
  files_touched: string[];
  decisions_made: string[];
  tags: string[];
  token_count: number;
}

export interface DecisionData {
  id: string;
  created_at: number;
  project_path: string | null;
  title: string;
  context: string;
  decision: string;
  rationale: string;
  tags: string[];
  status: "Active" | "Superseded" | "Deprecated";
}

export interface BrainSearchResult {
  entry: {
    id: string;
    source_type: string;
    source_id: string;
    content: string;
    keywords: string[];
    project_path: string | null;
    created_at: number;
    relevance_score: number;
  };
  score: number;
  snippet: string;
}

export interface BrainStats {
  total_summaries: number;
  total_decisions: number;
  total_index_entries: number;
  total_memory_bytes: number;
  projects_tracked: string[];
  recent_tags: string[];
}

// ═══════ Visual Memory Types ═══════

export interface GraphNode {
  id: string;
  label: string;
  node_type: string;
  metadata: Record<string, string>;
}

export interface GraphEdge {
  source: string;
  target: string;
  label: string;
  edge_type: string;
  weight: number;
}

export interface GraphData {
  id: string;
  title: string;
  graph_type: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  created_at: number;
  project_path: string | null;
}

export interface TimelineEvent {
  id: string;
  session_id: string;
  timestamp: number;
  event_type: string;
  label: string;
  detail: string;
  duration_ms: number | null;
  status: string;
}

export interface SessionTimelineData {
  session_id: string;
  title: string;
  events: TimelineEvent[];
  total_duration_ms: number;
  created_at: number;
}

export interface VisualStats {
  total_graphs: number;
  total_timelines: number;
  graph_types: Record<string, number>;
}

// ═══════ Token Optimizer Types ═══════

export interface TokenBudget {
  monthly_budget_usd: number;
  max_context_tokens: number;
  max_summary_tokens: number;
  max_decision_tokens: number;
  max_memory_tokens: number;
  rolling_window_days: number;
  cache_ttl_minutes: number;
}

export interface MonthUsage {
  input_tokens: number;
  output_tokens: number;
  total_cost_usd: number;
  days_tracked: number;
  session_count: number;
}

export interface CacheStats {
  total_entries: number;
  active_entries: number;
  total_hits: number;
  total_token_savings: number;
  cache_hit_rate: number;
}

export interface OptimizationStats {
  budget: TokenBudget;
  current_month_usage: MonthUsage;
  cache_stats: CacheStats;
  rolling_summary_count: number;
  total_chunks: number;
  estimated_savings_pct: number;
  budget_remaining_usd: number;
  daily_average_cost: number;
  projected_monthly_cost: number;
}

export interface OptimizationResult {
  summaries_rolled: number;
  chunks_created: number;
  cache_entries_pruned: number;
  tokens_saved: number;
  new_context_tokens: number;
}

export interface RollingSummary {
  id: string;
  period_start: number;
  period_end: number;
  session_count: number;
  content: string;
  token_count: number;
  key_themes: string[];
  files_touched: string[];
  created_at: number;
}

// ═══════ Multi-Agent Types ═══════

export interface AgentDef {
  id: string;
  name: string;
  role: string;
  description: string;
  capabilities: string[];
  system_prompt: string;
  model_preference: string | null;
  max_tokens: number;
  created_at: number;
  is_builtin: boolean;
}

export type StepStatus = "Pending" | "Running" | "Completed" | "Failed" | "Skipped";
export type WorkflowStatus = "Draft" | "Running" | "Completed" | "Failed" | "Paused";
export type TaskPriority = "Low" | "Normal" | "High" | "Critical";

export interface WorkflowStep {
  id: string;
  agent_id: string;
  action: string;
  input: string;
  output: string | null;
  status: StepStatus;
  started_at: number | null;
  completed_at: number | null;
  depends_on: string[];
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  status: WorkflowStatus;
  created_at: number;
  updated_at: number;
  project_path: string | null;
}

export interface AgentTask {
  id: string;
  agent_id: string;
  description: string;
  context: string;
  priority: TaskPriority;
  status: StepStatus;
  result: string | null;
  created_at: number;
  completed_at: number | null;
}

export interface AgentStats {
  total_agents: number;
  builtin_agents: number;
  custom_agents: number;
  total_workflows: number;
  active_workflows: number;
  total_tasks: number;
  completed_tasks: number;
}

// ═══════ Provider Router Types ═══════

export type ProviderType = "Claude" | "DeepSeek" | "OpenAI" | "OpenRouter" | "NousResearch" | "Local" | "Custom";
export type RoutingStrategy = "CostOptimized" | "QualityFirst" | "LatencyFirst" | "RoundRobin" | "Failover" | "Manual";
export type HealthStatus = "Healthy" | "Degraded" | "Down" | "Unknown";

export interface ModelConfig {
  id: string;
  name: string;
  max_tokens: number;
  input_price_per_m: number;
  output_price_per_m: number;
  supports_streaming: boolean;
  supports_tools: boolean;
  context_window: number;
}

export interface ProviderDef {
  id: string;
  name: string;
  provider_type: ProviderType;
  base_url: string | null;
  models: ModelConfig[];
  enabled: boolean;
  priority: number;
  api_key_env: string | null;
  created_at: number;
  is_builtin: boolean;
}

export interface RouterConfig {
  strategy: RoutingStrategy;
  default_provider: string;
  default_model: string;
  fallback_provider: string | null;
  max_retries: number;
  timeout_ms: number;
  cost_threshold_usd: number;
}

export interface RoutingDecision {
  id: string;
  timestamp: number;
  task_type: string;
  selected_provider: string;
  selected_model: string;
  reason: string;
  estimated_cost: number;
  fallback_used: boolean;
}

export interface ProviderHealth {
  provider_id: string;
  status: HealthStatus;
  last_checked: number;
  avg_latency_ms: number;
  error_rate: number;
  requests_today: number;
}

export interface RouterStats {
  config: RouterConfig;
  total_providers: number;
  enabled_providers: number;
  total_models: number;
  total_routing_decisions: number;
  fallback_count: number;
  provider_health: ProviderHealth[];
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

// ═══════ Prompt Transformer Types ═══════

export type TransformMode = "AutoEnhance" | "CodeTask" | "Analysis" | "Creative" | "Debug" | "Raw";

export interface TransformSettings {
  enabled: boolean;
  default_mode: TransformMode;
  show_preview: boolean;
  web_search_enabled: boolean;
}

export interface PromptTemplate {
  id: string;
  name: string;
  mode: TransformMode;
  template: string;
  is_builtin: boolean;
  created_at: number;
}

export interface TransformResult {
  original: string;
  transformed: string;
  mode: TransformMode;
  web_search_triggered: boolean;
  search_query: string | null;
}

// ═══════ Web Search Types ═══════

export type SearchProvider = "DuckDuckGo" | "Tavily" | "SearXNG";

export interface WebSearchSettings {
  enabled: boolean;
  provider: SearchProvider;
  max_results: number;
  auto_trigger: boolean;
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

export interface WebSearchResponse {
  query: string;
  results: WebSearchResult[];
  summary: string;
  timestamp: number;
}

// ═══════ Conversation Search ═══════

export interface ConversationSearchResult {
  session_id: string;
  message_index: number;
  role: string;
  snippet: string;
  score: number;
}
