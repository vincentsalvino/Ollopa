import { useReducer, useCallback, useMemo, useRef } from "react";
import type {
  EventStoreState,
  AppEvent,
  TimelineEntry,
  ToolUseData,
  CostData,
  ApprovalRequestData,
} from "../types";
import { EMPTY_COST } from "../types";

// ═══════ Actions ═══════

type Action =
  | { type: "PROCESS_EVENT"; event: AppEvent }
  | { type: "ADD_USER_MESSAGE"; content: string }
  | { type: "CLEAR_SESSION" }
  | { type: "RESOLVE_APPROVAL"; decision: "approved" | "denied" }
  | { type: "CLOSE_DIFF" }
  | { type: "REPLAY_EVENTS"; events: AppEvent[] }
  | { type: "STOP_STREAMING" }
  | { type: "SET_MODEL"; model: string }
  | { type: "TRUNCATE_AFTER"; entryId: string };

// ═══════ Helpers ═══════

let entryCounter = 0;
function nextId(): string {
  return `tl-${Date.now()}-${++entryCounter}`;
}

// Deduplication: track recent non-streaming event fingerprints
const DEDUP_WINDOW_MS = 100;
const recentEventHashes: Array<{ hash: string; ts: number }> = [];

function eventFingerprint(event: AppEvent): string {
  return `${event.type}:${JSON.stringify(event).substring(0, 200)}`;
}

function isDuplicate(event: AppEvent): boolean {
  // Streaming chunks are high-frequency and never duplicates by design
  if (event.type === "streaming_chunk") return false;

  const now = Date.now();
  const fp = eventFingerprint(event);

  // Prune old entries
  while (recentEventHashes.length > 0 && now - recentEventHashes[0].ts > DEDUP_WINDOW_MS) {
    recentEventHashes.shift();
  }

  if (recentEventHashes.some((e) => e.hash === fp)) {
    return true;
  }

  recentEventHashes.push({ hash: fp, ts: now });
  if (recentEventHashes.length > 50) {
    recentEventHashes.shift();
  }
  return false;
}

function addEntry(
  timeline: TimelineEntry[],
  kind: TimelineEntry["kind"],
  data: TimelineEntry["data"]
): TimelineEntry[] {
  return [
    ...timeline,
    { id: nextId(), kind, timestamp: Date.now(), data },
  ];
}

function updateToolEntry(
  timeline: TimelineEntry[],
  toolUseId: string,
  updater: (d: ToolUseData) => ToolUseData
): TimelineEntry[] {
  return timeline.map((entry) => {
    if (entry.kind === "tool_use") {
      const d = entry.data as ToolUseData;
      if (d.tool_use_id === toolUseId) {
        return { ...entry, data: updater(d) };
      }
    }
    return entry;
  });
}

function addCost(prev: CostData, delta: Partial<CostData>): CostData {
  return {
    input_tokens: prev.input_tokens + (delta.input_tokens || 0),
    output_tokens: prev.output_tokens + (delta.output_tokens || 0),
    cost_usd: prev.cost_usd + (delta.cost_usd || 0),
  };
}

// ═══════ Reducer ═══════

function reducer(state: EventStoreState, action: Action): EventStoreState {
  switch (action.type) {
    case "ADD_USER_MESSAGE":
      return {
        ...state,
        isTyping: true,
        timeline: addEntry(state.timeline, "user_message", {
          kind: "user_message",
          content: action.content,
        }),
      };

    case "CLEAR_SESSION":
      return { ...initialState };

    case "STOP_STREAMING":
      return {
        ...state,
        isStreaming: false,
        isTyping: false,
        streamingText: "",
      };

    case "RESOLVE_APPROVAL":
      return {
        ...state,
        activeApproval: state.activeApproval
          ? { ...state.activeApproval, status: action.decision }
          : null,
      };

    case "CLOSE_DIFF":
      return { ...state, activeDiff: null };

    case "REPLAY_EVENTS": {
      let s = { ...initialState };
      for (const event of action.events) {
        s = processAppEvent(s, event);
      }
      s.isTyping = false;
      return s;
    }

    case "SET_MODEL":
      return { ...state, sessionModel: action.model };

    case "TRUNCATE_AFTER": {
      const idx = state.timeline.findIndex((e) => e.id === action.entryId);
      if (idx >= 0) {
        return {
          ...state,
          timeline: state.timeline.slice(0, idx + 1),
          isStreaming: false,
          streamingText: "",
        };
      }
      return state;
    }

    case "PROCESS_EVENT": {
      if (isDuplicate(action.event)) return state;
      return processAppEvent(state, action.event);
    }

    default:
      return state;
  }
}

function processAppEvent(state: EventStoreState, event: AppEvent): EventStoreState {
  switch (event.type) {
    case "session_started":
      return {
        ...state,
        sessionId: event.session_id,
        sessionModel: event.model,
        isTyping: false,
        timeline: addEntry(state.timeline, "session_start", {
          kind: "session_start",
          session_id: event.session_id,
          model: event.model,
          cwd: event.cwd,
          tools: event.tools,
        }),
      };

    case "user_message":
      return {
        ...state,
        timeline: addEntry(state.timeline, "user_message", {
          kind: "user_message",
          content: event.text,
        }),
      };

    case "streaming_chunk":
      return {
        ...state,
        isTyping: false,
        isStreaming: true,
        streamingText: state.streamingText + event.text,
      };

    case "generation_stopped":
      return {
        ...state,
        isTyping: false,
        isStreaming: false,
        streamingText: "",
        timeline: event.partial_text
          ? addEntry(state.timeline, "assistant_message", {
              kind: "assistant_message",
              text: event.partial_text + "\n\n*[Generation stopped]*",
              model: event.model,
            })
          : state.timeline,
      };

    case "assistant_message":
      return {
        ...state,
        isTyping: false,
        isStreaming: false,
        streamingText: "",
        timeline: addEntry(state.timeline, "assistant_message", {
          kind: "assistant_message",
          text: event.text,
          model: event.model,
        }),
      };

    case "tool_started":
      return {
        ...state,
        timeline: addEntry(state.timeline, "tool_use", {
          kind: "tool_use",
          tool_use_id: event.tool_use_id,
          tool_name: event.tool_name,
          input: event.input,
          status: "running",
          started_at: Date.now(),
        }),
      };

    case "tool_finished": {
      const now = Date.now();
      return {
        ...state,
        timeline: updateToolEntry(state.timeline, event.tool_use_id, (d) => ({
          ...d,
          status: event.is_error ? "error" : "success",
          output: event.output,
          is_error: event.is_error,
          finished_at: now,
          duration_ms: now - d.started_at,
        })),
      };
    }

    case "approval_required":
      return {
        ...state,
        activeApproval: {
          kind: "approval_request",
          tool_use_id: event.tool_use_id,
          tool_name: event.tool_name,
          input: event.input,
          risk_level: event.risk_level,
          risk_label: event.risk_label,
          status: "pending",
        },
        timeline: addEntry(state.timeline, "approval_request", {
          kind: "approval_request",
          tool_use_id: event.tool_use_id,
          tool_name: event.tool_name,
          input: event.input,
          risk_level: event.risk_level,
          risk_label: event.risk_label,
          status: "pending",
        }),
      };

    case "file_diff":
      return {
        ...state,
        activeDiff: {
          filePath: event.file_path,
          oldContent: event.old_content,
          newContent: event.new_content,
          toolUseId: event.tool_use_id,
        },
      };

    case "token_usage":
      return {
        ...state,
        sessionCost: addCost(state.sessionCost, {
          input_tokens: event.input_tokens,
          output_tokens: event.output_tokens,
          cost_usd: event.cost_usd,
        }),
      };

    case "status_update": {
      const newState = {
        ...state,
        timeline: addEntry(state.timeline, "status", {
          kind: "status" as const,
          status: event.status,
          detail: event.detail,
        }),
      };
      if (event.status === "process_exited") {
        newState.isTyping = false;
      }
      return newState;
    }

    case "session_finished":
      return {
        ...state,
        isTyping: false,
        timeline: addEntry(state.timeline, "session_end", {
          kind: "session_end",
          session_id: event.session_id,
          cost_usd: event.cost_usd,
          duration_ms: event.duration_ms,
          num_turns: event.num_turns,
          is_error: event.is_error,
        }),
      };

    case "error":
      return {
        ...state,
        isTyping: false,
        timeline: addEntry(state.timeline, "error", {
          kind: "error",
          message: event.message,
          recoverable: event.recoverable,
        }),
      };

    default:
      return state;
  }
}

// ═══════ Initial State ═══════

const initialState: EventStoreState = {
  timeline: [],
  sessionId: null,
  sessionModel: "unknown",
  sessionCost: { ...EMPTY_COST },
  isTyping: false,
  isStreaming: false,
  streamingText: "",
  activeApproval: null,
  activeDiff: null,
};

// ═══════ Hook ═══════

export function useEventStore() {
  const [state, dispatch] = useReducer(reducer, initialState);

  const processEvent = useCallback(
    (event: AppEvent) => dispatch({ type: "PROCESS_EVENT", event }),
    []
  );

  const addUserMessage = useCallback(
    (content: string) => dispatch({ type: "ADD_USER_MESSAGE", content }),
    []
  );

  const clearSession = useCallback(
    () => dispatch({ type: "CLEAR_SESSION" }),
    []
  );

  const resolveApproval = useCallback(
    (decision: "approved" | "denied") =>
      dispatch({ type: "RESOLVE_APPROVAL", decision }),
    []
  );

  const closeDiff = useCallback(
    () => dispatch({ type: "CLOSE_DIFF" }),
    []
  );

  const replayEvents = useCallback(
    (events: AppEvent[]) => dispatch({ type: "REPLAY_EVENTS", events }),
    []
  );

  const stopStreaming = useCallback(
    () => dispatch({ type: "STOP_STREAMING" }),
    []
  );

  const setModel = useCallback(
    (model: string) => dispatch({ type: "SET_MODEL", model }),
    []
  );

  const truncateAfter = useCallback(
    (entryId: string) => dispatch({ type: "TRUNCATE_AFTER", entryId }),
    []
  );

  // Memoized derived data to prevent unnecessary recalculations
  const toolEntries = useMemo(
    () =>
      state.timeline.filter(
        (e) => e.kind === "tool_use"
      ) as (TimelineEntry & { data: ToolUseData })[],
    [state.timeline]
  );

  const runningTools = useMemo(
    () => toolEntries.filter((e) => e.data.status === "running"),
    [toolEntries]
  );

  const stats = useMemo(() => {
    const completedTools = toolEntries.filter((e) => e.data.duration_ms);
    return {
      totalTools: toolEntries.length,
      runningTools: runningTools.length,
      successTools: toolEntries.filter((e) => e.data.status === "success").length,
      errorTools: toolEntries.filter((e) => e.data.status === "error").length,
      avgDuration:
        completedTools.length > 0
          ? completedTools.reduce((sum, e) => sum + (e.data.duration_ms || 0), 0) /
            completedTools.length
          : 0,
    };
  }, [toolEntries, runningTools]);

  return {
    state,
    processEvent,
    addUserMessage,
    clearSession,
    resolveApproval,
    closeDiff,
    replayEvents,
    stopStreaming,
    setModel,
    truncateAfter,
    toolEntries,
    runningTools,
    stats,
  };
}
