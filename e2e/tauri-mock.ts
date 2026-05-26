import { Page } from "@playwright/test";

/**
 * Injects mock __TAURI_INTERNALS__ into the page so the React app
 * boots without a real Tauri runtime.  Every `invoke()` call is
 * intercepted and returns sensible defaults.
 */
export async function injectTauriMock(page: Page) {
  await page.addInitScript(() => {
    const mockApiKeys = [
      { provider_id: "deepseek", provider_name: "DeepSeek", env_var: "DEEPSEEK_API_KEY", is_set: false, masked_key: "" },
      { provider_id: "claude", provider_name: "Anthropic Claude", env_var: "ANTHROPIC_API_KEY", is_set: true, masked_key: "sk-a****xyz1" },
      { provider_id: "openai", provider_name: "OpenAI", env_var: "OPENAI_API_KEY", is_set: false, masked_key: "" },
      { provider_id: "openrouter", provider_name: "OpenRouter", env_var: "OPENROUTER_API_KEY", is_set: false, masked_key: "" },
      { provider_id: "nous", provider_name: "Nous Research", env_var: "NOUS_API_KEY", is_set: false, masked_key: "" },
      { provider_id: "tavily", provider_name: "Tavily (Web Search)", env_var: "TAVILY_API_KEY", is_set: false, masked_key: "" },
    ];

    const handlers: Record<string, (args?: any) => any> = {
      // API Key Management
      list_api_keys: () => mockApiKeys,
      save_api_key: () => null,
      delete_api_key: () => null,

      // Cost
      get_token_cost: () => ({ input_tokens: 0, output_tokens: 0, cost_usd: 0 }),

      // Environment
      check_env_vars: () => null,

      // Dashboard / Memory
      get_memory_data: () => ({ ollopa_md: "", memory_lines: [] }),


      // Session Management
      list_sessions: () => [],
      list_conversations: () => [],
      get_conversation_messages: () => [],
      get_session_events: () => [],
      get_session_snapshot: () => null,
      get_recent_events: () => [],
      get_current_model: () => "deepseek-chat",
      get_system_prompt: () => "You are a helpful assistant.",
      set_model: () => null,
      start_session: () => "mock-session-id",
      restart_session: () => "mock-session-id",
      stop_session: () => null,
      send_input: () => null,
      switch_project: () => null,
      resume_conversation: () => "mock-session-id",
      delete_session_by_key: () => null,
      edit_message: () => null,
      export_conversation: () => "# Mock export\n\nNo data.",
      search_conversations: () => [],

      // Brain
      brain_search: (args?: any) => {
        if (args?.query) {
          return [
            {
              entry: {
                id: "brain-1",
                source_type: "conversation",
                source_id: "session-1",
                content: "Mock brain search result content",
                keywords: ["test", "mock", "brain"],
                project_path: null,
                created_at: Date.now(),
                relevance_score: 0.95,
              },
              score: 0.95,
              snippet: "Mock brain search result for: " + args.query,
            },
          ];
        }
        return [];
      },
      brain_stats: () => ({ total_summaries: 0, total_decisions: 0, total_notes: 0 }),
      brain_save_decision: () => null,
      brain_list_decisions: () => [],
      brain_delete_decision: () => null,
      brain_list_summaries: () => [],
      brain_delete_summary: () => null,
      brain_get_context: () => "",
      brain_index_note: () => null,

      // Visual
      visual_build_relationship_graph: () => ({ nodes: [], edges: [] }),
      visual_build_architecture_graph: () => ({ nodes: [], edges: [] }),
      visual_build_workflow_dag: () => ({ nodes: [], edges: [] }),
      visual_build_dependency_graph: () => ({ nodes: [], edges: [] }),
      visual_build_session_timeline: () => ({ nodes: [], edges: [] }),
      visual_save_graph: () => null,
      visual_list_graphs: () => [],
      visual_delete_graph: () => null,
      visual_get_stats: () => ({ total_graphs: 0 }),
      visual_list_sessions_for_timeline: () => [],

      // Optimizer
      optimizer_get_stats: () => ({ total_tokens: 0, cached_tokens: 0, savings_pct: 0 }),
      optimizer_get_budget: () => ({ monthly_usd: 10, used_usd: 0 }),
      optimizer_save_budget: () => null,
      optimizer_run: () => null,
      optimizer_build_context: () => "",
      optimizer_record_usage: () => null,
      optimizer_prune_cache: () => null,
      optimizer_list_rolling: () => [],
      optimizer_clear_data: () => null,
      optimizer_estimate_tokens: () => 0,

      // Agents
      agent_list: () => [],
      agent_save: () => null,
      agent_delete: () => null,
      agent_stats: () => ({ total_agents: 0, total_workflows: 0, active_tasks: 0 }),
      agent_route_task: () => null,
      agent_create_task: () => null,
      agent_list_tasks: () => [],
      agent_complete_task: () => null,
      agent_create_workflow: () => null,
      agent_list_workflows: () => [],
      agent_advance_workflow: () => null,
      agent_delete_workflow: () => null,
      agent_execute_workflow: () => null,

      // Router
      router_list_providers: () => [],
      router_save_provider: () => null,
      router_delete_provider: () => null,
      router_get_config: () => ({}),
      router_save_config: () => null,
      router_route: () => null,
      router_stats: () => ({ total_requests: 0 }),

      // Git/Repo
      git_info: () => ({
        is_git_repo: true,
        branch: "main",
        remote_url: "https://github.com/test/repo.git",
        ahead: 2,
        behind: 0,
        staged: 1,
        modified: 3,
        untracked: 2,
        recent_commits: [
          { hash: "abc1234567", short_hash: "abc1234", message: "feat: add tests", author: "Test User", date: "2025-01-01" },
          { hash: "def5678901", short_hash: "def5678", message: "fix: resolve bug", author: "Test User", date: "2025-01-01" },
        ],
        contributors: ["Test User"],
      }),
      repo_analyze: () => ({ files: 0, languages: [] }),
      switch_provider: () => null,

      // Transform
      transform_preview: () => ({ mode: "AutoEnhance", original: "", transformed: "", changes: [] }),
      transform_get_settings: () => ({ enabled: true, mode: "AutoEnhance", show_preview: true }),
      transform_save_settings: () => null,
      transform_list_templates: () => [
        {
          id: "builtin-1",
          name: "Code Assistant",
          mode: "AutoEnhance",
          template: "You are a helpful code assistant.",
          is_builtin: true,
          created_at: Date.now(),
        },
      ],
      transform_save_template: () => null,
      transform_delete_template: () => null,

      // Web Search
      web_search_query: () => ({ query: "", results: [], provider: "DuckDuckGo" }),
      web_search_format: () => "",
      web_search_get_settings: () => ({ enabled: true, provider: "DuckDuckGo", auto_trigger: true }),
      web_search_save_settings: () => null,
      web_search_list_cache: () => [],
      web_search_clear_cache: () => null,

      // New feature commands
      get_model_context_window: () => 128000,
      truncate_conversation: () => null,
      get_full_memory: () => "Memory line 1\nMemory line 2",
      write_full_memory: () => null,

      // Event plugin — listen returns an event ID, unlisten is a no-op
      "plugin:event|listen": () => Math.floor(Math.random() * 1e9),
      "plugin:event|unlisten": () => null,
    };

    // Callback registry for transformCallback
    let cbCounter = 0;
    const callbacks: Record<number, Function> = {};

    // Minimal Tauri IPC shim
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args?: any) => {
        const handler = handlers[cmd];
        if (handler) return handler(args);
        console.warn(`[tauri-mock] unhandled invoke: ${cmd}`, args);
        return null;
      },
      transformCallback: (cb: Function, once?: boolean) => {
        const id = ++cbCounter;
        callbacks[id] = (...args: any[]) => {
          cb(...args);
          if (once) delete callbacks[id];
        };
        (window as any)[`_${id}`] = callbacks[id];
        return id;
      },
      unregisterCallback: (id: number) => {
        delete callbacks[id];
        delete (window as any)[`_${id}`];
      },
      convertFileSrc: (path: string) => path,
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main" },
      },
    };

    // Event plugin internals — stub for unlisten
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: (_event: string, _eventId: number) => {},
    };
  });
}
