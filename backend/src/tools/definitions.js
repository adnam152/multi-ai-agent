/**
 * tools/definitions.js — All TOOL_DEFINITIONS schemas
 */

const { TELEGRAM_CONSTANTS, TOOL_CONSTANTS } = require('../constants');

const TOOL_DEFINITIONS = [
  // ── System ──────────────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'get_current_time',
      description: 'Get the current date, time, and day of week in Vietnam timezone (UTC+7).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_system_status',
      description: 'Get system status: uptime, memory, CPU, brain model, active agents, search backend, browser availability.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_memory_stats',
      description: 'Get conversation memory statistics broken down per agent.',
      parameters: { type: 'object', properties: {} },
    },
  },

  // ── Agents ──────────────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'list_agents',
      description: 'List all AI agents with their status, provider, model, and skills count.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'call_agent',
      description: 'Delegate a task to a specialized agent. Always call list_agents first to verify agent IDs.',
      parameters: {
        type: 'object',
        properties: {
          agent_id: { type: 'string', description: 'Agent ID (verify with list_agents first)' },
          task: { type: 'string', description: 'Task to send to the agent' },
        },
        required: ['agent_id', 'task'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'manage_agent',
      description: 'Enable or disable an agent.',
      parameters: {
        type: 'object',
        properties: {
          agent_id: { type: 'string' },
          action: { type: 'string', enum: ['enable', 'disable'] },
        },
        required: ['agent_id', 'action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_pipeline',
      description: 'Run multiple agent tasks. Use "parallel" for simultaneous execution, "sequential" to chain outputs ({step_0}, {step_1}...).',
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['parallel', 'sequential'] },
          steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                agent_id: { type: 'string' },
                task: { type: 'string' },
              },
              required: ['agent_id', 'task'],
            },
          },
        },
        required: ['mode', 'steps'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_agent',
      description: 'Create a new AI agent. All skills MUST be written in English.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          provider: { type: 'string', enum: ['copilot', 'claude', 'gemini', 'openrouter', 'openai'] },
          model: { type: 'string', description: 'e.g. gpt-5-mini, claude-sonnet-4-5' },
          systemPrompt: { type: 'string' },
          skills: { type: 'array', items: { type: 'string' }, description: 'Instructions in English' },
          apiKey: { type: 'string', description: 'Leave empty to use env var' },
        },
        required: ['name', 'provider', 'model', 'systemPrompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_agent',
      description: 'Update an existing agent. Skills must be in English.',
      parameters: {
        type: 'object',
        properties: {
          agent_id: { type: 'string', description: 'Verify with list_agents first' },
          name: { type: 'string' },
          description: { type: 'string' },
          provider: { type: 'string', enum: ['copilot', 'claude', 'gemini', 'openrouter', 'openai'] },
          model: { type: 'string' },
          systemPrompt: { type: 'string' },
          skills: { type: 'array', items: { type: 'string' } },
          contextNotes: { type: 'string' },
          active: { type: 'boolean' },
        },
        required: ['agent_id'],
      },
    },
  },

  // ── Shell ───────────────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Execute a safe read-only shell command (whitelist enforced).',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' },
        },
        required: ['command'],
      },
    },
  },

  // ── Files ───────────────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a local file (project/workspace dirs only, 512KB max).',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string' },
          encoding: { type: 'string', enum: ['utf8', 'base64'], description: 'Default: utf8' },
        },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a local file (project/workspace dirs only).',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string' },
          content: { type: 'string' },
          mode: { type: 'string', enum: ['overwrite', 'append'], description: 'Default: overwrite' },
        },
        required: ['file_path', 'content'],
      },
    },
  },

  // ── Network ─────────────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'http_request',
      description: [
        'Make an HTTP request to an external URL.',
        'USE THIS for Monday.com API calls: POST to https://api.monday.com/v2 with headers',
        '{ "Authorization": "<token>", "Content-Type": "application/json", "API-Version": "2023-10" }',
        'and body { "query": "...", "variables": {...} }.',
        'NEVER use mcp_call for Monday.com data.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'], description: 'Default: GET' },
          headers: { type: 'object' },
          body: { type: 'string', description: 'JSON string for POST/PUT' },
          timeout_ms: { type: 'number', description: `Default: ${TOOL_CONSTANTS.HTTP_DEFAULT_TIMEOUT_MS}` },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_web',
      description: [
        'Search the web for current information.',
        'Backend priority: Brave (BRAVE_API_KEY) → Tavily (TAVILY_API_KEY) → DuckDuckGo HTML → DuckDuckGo Instant → browser.',
        'Set TAVILY_API_KEY or BRAVE_API_KEY in .env for best results.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          max_results: { type: 'number', description: 'Default: 5, max: 10' },
        },
        required: ['query'],
      },
    },
  },

  // ── Browser ─────────────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'browse_web',
      description: [
        'Navigate to a URL using a real headless browser and extract readable text content.',
        'Works on JavaScript-heavy pages that fetch() cannot handle.',
        'Requires: npm install -g agent-browser',
        'Use this for: reading web pages, articles, documentation, any URL that needs JS to render.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Full URL to navigate to' },
          extract: { type: 'string', enum: ['text', 'screenshot'], description: 'What to extract (default: text)' },
          wait_ms: { type: 'number', description: 'Milliseconds to wait for JS to load (default: 2000)' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browse_search',
      description: [
        'Search Google (or Bing/DuckDuckGo) using a real browser — no API key needed.',
        'Use this when search_web fails or returns no results.',
        'Requires: npm install -g agent-browser',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          engine: { type: 'string', enum: ['google', 'duckduckgo', 'bing'], description: 'Default: google' },
          max_results: { type: 'number', description: 'Max results to return (default: 5)' },
        },
        required: ['query'],
      },
    },
  },

  // ── Memory / Learning ────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'save_lesson',
      description: [
        'Save a lesson, pattern, error, or user preference for future sessions.',
        'Write lesson text in English.',
        'Lessons that recur 3+ times are auto-promoted into permanent context.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          lesson: {
            type: 'string',
            description: 'Lesson text in English. Be specific and actionable.',
          },
          type: {
            type: 'string',
            enum: [
              'pattern',
              'user_preference',
              'routing',
              'fact',
              'tool_error',
              'feature_request',
              'knowledge_gap',
              'best_practice',
            ],
          },
          priority: {
            type: 'string',
            enum: ['low', 'medium', 'high', 'critical'],
            description: 'Optional — auto-inferred from type and recurrence if not provided.',
          },
          area: {
            type: 'string',
            enum: ['routing', 'tool', 'memory', 'api', 'ui', 'content', 'config', 'unknown'],
            description: 'Optional — which part of the system this lesson applies to.',
          },
        },
        required: ['lesson'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_lessons',
      description: 'Query stored lessons. Use to review what Brain has learned, find promoted rules, or audit patterns.',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['pattern', 'user_preference', 'routing', 'fact', 'tool_error', 'feature_request', 'knowledge_gap', 'best_practice'],
            description: 'Filter by lesson type.',
          },
          priority: {
            type: 'string',
            enum: ['low', 'medium', 'high', 'critical'],
          },
          status: {
            type: 'string',
            enum: ['pending', 'promoted', 'resolved', 'wont_fix'],
          },
          limit: {
            type: 'number',
            description: 'Max lessons to return (default: 20)',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'resolve_lesson',
      description: 'Mark a lesson as resolved (no longer relevant) or wont_fix (known, not changing). Use lesson ID from get_lessons.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Lesson ID from get_lessons' },
          status: { type: 'string', enum: ['resolved', 'wont_fix'], description: 'Default: resolved' },
        },
        required: ['id'],
      },
    },
  },

  // ── Telegram ────────────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'send_telegram',
      description: 'Send a proactive message to the owner via Telegram.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: `Max ${TELEGRAM_CONSTANTS.MESSAGE_CHUNK_SIZE} chars` },
        },
        required: ['message'],
      },
    },
  },

  // ── Skills ──────────────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'import_skill',
      description: [
        'Import a skill from a SKILL.md file URL or raw content.',
        'For GitHub: open the file → click "Raw" → copy that URL.',
        'Optionally add parsed instructions to an existing agent via target_agent_id.',
        'Note: slug-based import is not supported — use direct raw URL instead.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Raw URL to a SKILL.md file.',
          },
          content: {
            type: 'string',
            description: 'Raw SKILL.md content to parse directly (paste the file contents)',
          },
          target_agent_id: {
            type: 'string',
            description: 'Agent ID to add the skill instructions to. Use list_agents to find IDs.',
          },
        },
      },
    },
  },

  // ── MCP ──────────────────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'list_mcp_servers',
      description: 'List all configured MCP servers, their connection status, and available tools.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_mcp_server',
      description: [
        'Register a new MCP server. For Monday.com use the official hosted MCP:',
        'url: "https://mcp.monday.com/mcp", authType: "bearer", authToken: "<monday_api_token>".',
        'Then call mcp_connect to authenticate and discover tools.',
        'Monday MCP tools include: get_board_schema, get_board_items_by_name, create_item, delete_item,',
        'change_item_column_values, move_item_to_group, create_update, create_board, create_group,',
        'create_column, delete_column, list_users_and_teams.',
        'After creating any MCP server, call mcp_connect to discover available tools.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Display name, e.g. "Monday.com" or "GitHub"' },
          url: { type: 'string', description: 'MCP server URL (NOT needed for Monday.com)' },
          authType: { type: 'string', enum: ['bearer', 'api_key', 'basic', 'none'], description: 'Auth method' },
          authToken: { type: 'string', description: 'API token. For Monday: paste token from monday.com > Profile > Developers > API' },
          description: { type: 'string', description: 'Optional description' },
          type: { type: 'string', description: 'Provider type hint: "monday", "slack", "github", "custom"' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mcp_connect',
      description: [
        'Connect to a configured MCP server and discover its available tools.',
        'Run after create_mcp_server. Works for Monday.com hosted MCP and all other MCP servers.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          server_id: { type: 'string', description: 'Server ID from list_mcp_servers' },
          server_name: { type: 'string', description: 'Server name (alternative to ID)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mcp_call',
      description: [
        'Call a tool on a connected MCP server.',
        'Use list_mcp_servers to see available servers and their tools.',
        'For Monday.com: use mcp_call with the monday MCP server tools (get_board_schema, get_board_items_by_name, etc.).',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          server: { type: 'string', description: 'Server name (from list_mcp_servers)' },
          tool: { type: 'string', description: 'Tool name to invoke' },
          args: { type: 'object', description: 'Arguments for the tool' },
        },
        required: ['server', 'tool'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'get_monday_token',
      description: 'Get the saved Monday.com API token and ready-to-use Authorization headers. Call this FIRST before any Monday API http_request. Returns full token string + headers object. Never call create_mcp_server for Monday.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

// ── ORCHESTRATOR_TOOL_DEFINITIONS ───────────────────────────────────────────
// Add these to TOOL_DEFINITIONS so Brain can call them

const ORCHESTRATOR_TOOL_DEFINITIONS = [

  // ── Agents ──────────────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'create_agent',
      description: 'Create a new specialist AI agent. Use this when user asks to create/add an agent.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Display name' },
          description: { type: 'string', description: 'What this agent specializes in' },
          provider: { type: 'string', enum: ['copilot', 'openai', 'claude', 'gemini', 'openrouter'] },
          model: { type: 'string', description: 'Model ID, e.g. gpt-5-mini, claude-haiku-4-5, gpt-5.1-codex' },
          systemPrompt: { type: 'string', description: 'System prompt / persona (write in English)' },
          skills: { type: 'array', items: { type: 'string' }, description: 'Array of skill instruction strings' },
        },
        required: ['name', 'systemPrompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_agent',
      description: 'Update an existing agent. Use list_agents first to get IDs.',
      parameters: {
        type: 'object',
        properties: {
          agent_id: { type: 'string', description: 'Agent ID from list_agents (use "brain" for Brain)' },
          name: { type: 'string' },
          description: { type: 'string' },
          provider: { type: 'string' },
          model: { type: 'string' },
          systemPrompt: { type: 'string' },
          skills: { type: 'array', items: { type: 'string' } },
        },
        required: ['agent_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_agent',
      description: 'Delete a specialist agent permanently. Cannot delete Brain.',
      parameters: {
        type: 'object',
        properties: {
          agent_id: { type: 'string', description: 'Agent ID to delete' },
        },
        required: ['agent_id'],
      },
    },
  },

  // ── Cron Jobs ─────────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'list_cron_jobs',
      description: 'List all scheduled cron jobs with schedules, status, last run info.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_cron_job',
      description: 'Create a scheduled job. Call ONCE per creation — do not call list_cron_jobs again after this succeeds.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Job name, e.g. "Morning News Summary"' },
          description: { type: 'string', description: 'What this job does' },
          schedule: { type: 'string', description: 'Cron expression. Examples: "0 9 * * *" (daily 9am), "*/30 * * * *" (every 30min), "0 8 * * 1-5" (Mon-Fri 8am)' },
          prompt: { type: 'string', description: 'Task prompt sent to agent when triggered' },
          agent_id: { type: 'string', description: 'Agent ID. Use "brain" for Brain orchestrator.' },
          sendToTelegram: { type: 'boolean', description: 'Send result to Telegram. Default: false' },
          enabled: { type: 'boolean', description: 'Enable immediately. Default: true' },
        },
        required: ['name', 'schedule', 'prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_cron_job',
      description: 'Update an existing cron job (change schedule, prompt, enable/disable). Use list_cron_jobs to get IDs.',
      parameters: {
        type: 'object',
        properties: {
          job_id: { type: 'string', description: 'Job ID from list_cron_jobs' },
          name: { type: 'string' },
          schedule: { type: 'string' },
          prompt: { type: 'string' },
          agent_id: { type: 'string' },
          sendToTelegram: { type: 'boolean' },
          enabled: { type: 'boolean' },
        },
        required: ['job_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_cron_job',
      description: 'Delete a cron job permanently.',
      parameters: {
        type: 'object',
        properties: {
          job_id: { type: 'string', description: 'Job ID to delete' },
        },
        required: ['job_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_cron_job',
      description: 'Run a cron job immediately (ignores schedule). Result appears in Tracking tab.',
      parameters: {
        type: 'object',
        properties: {
          job_id: { type: 'string', description: 'Job ID to trigger now' },
        },
        required: ['job_id'],
      },
    },
  },

  // ── Group Debates ─────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'list_debates',
      description: 'List all group debate sessions with status, topic, agent count.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_debate',
      description: 'Create a multi-agent debate session. After creating, call start_debate to begin.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Session name, e.g. "AI Policy Debate"' },
          topic: { type: 'string', description: 'The question or topic to debate' },
          agents: {
            type: 'array',
            description: 'At least 2 agents. Each needs name, role, systemPrompt, provider, model.',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                role: { type: 'string', description: 'e.g. "Climate Scientist", "Economist"' },
                avatar: { type: 'string', description: 'Emoji, e.g. "🧑‍🔬"' },
                systemPrompt: { type: 'string' },
                provider: { type: 'string', enum: ['copilot', 'openai', 'claude', 'gemini', 'openrouter'] },
                model: { type: 'string' },
                color: { type: 'string', description: 'Hex color e.g. "#4f72ff"' },
              },
              required: ['name', 'systemPrompt'],
            },
          },
          autoSynthesize: { type: 'boolean', description: 'Brain detects consensus and writes final synthesis. Default: true' },
          allowTools: { type: 'boolean', description: 'Agents can search web/http. Default: true' },
          roundDelayMs: { type: 'number', description: 'Ms between agent turns. Default: 500' },
        },
        required: ['name', 'topic', 'agents'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'start_debate',
      description: 'Start a debate session. Agents begin discussing immediately.',
      parameters: {
        type: 'object',
        properties: {
          session_id: { type: 'string', description: 'Debate session ID from list_debates or create_debate' },
        },
        required: ['session_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'stop_debate',
      description: 'Stop a running debate session.',
      parameters: {
        type: 'object',
        properties: {
          session_id: { type: 'string' },
        },
        required: ['session_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_debate',
      description: 'Delete a debate session and all its messages.',
      parameters: {
        type: 'object',
        properties: {
          session_id: { type: 'string' },
        },
        required: ['session_id'],
      },
    },
  },

  // ── MCP Servers ───────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'create_mcp_server',
      description: 'Register a new MCP server. After registering, call connect_mcp_server to activate it.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Display name e.g. "GitHub MCP"' },
          command: { type: 'string', description: 'Command to start server e.g. "npx @modelcontextprotocol/server-github"' },
          args: { type: 'array', items: { type: 'string' }, description: 'Command arguments' },
          env: { type: 'object', description: 'Environment variables e.g. {"GITHUB_TOKEN": "..."}' },
        },
        required: ['name', 'command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'connect_mcp_server',
      description: 'Connect to an MCP server and load its tools. Use list_mcp_servers to get IDs.',
      parameters: {
        type: 'object',
        properties: {
          server_id: { type: 'string', description: 'MCP server ID' },
        },
        required: ['server_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'disconnect_mcp_server',
      description: 'Disconnect from an MCP server.',
      parameters: {
        type: 'object',
        properties: {
          server_id: { type: 'string' },
        },
        required: ['server_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_mcp_server',
      description: 'Remove an MCP server registration entirely.',
      parameters: {
        type: 'object',
        properties: {
          server_id: { type: 'string' },
        },
        required: ['server_id'],
      },
    },
  },
];

module.exports = { TOOL_DEFINITIONS, ORCHESTRATOR_TOOL_DEFINITIONS };