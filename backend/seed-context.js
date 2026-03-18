#!/usr/bin/env node
/**
 * seed-context.js — Inject initial project context into Brain memory
 *
 *   node seed-context.js         # add/replace seeded entries
 *   node seed-context.js --reset # delete ALL messages first, then seed
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { MEMORY_CONSTANTS, LOGGER_CONSTANTS } = require('./src/constants');
const db = require('./src/db');

const reset = process.argv.includes('--reset');
const now   = Date.now();
const ts    = (offsetMinutes) => now - offsetMinutes * 60 * 1000;

const seeds = [

  // ── System overview ────────────────────────────────────────────────────────────
  {
    role: 'user',
    content: 'What is Brain OS and what tabs/features does it have?',
    timestamp: ts(120),
  },
  {
    role: 'assistant',
    content: `Brain OS is a local AI orchestration system. Architecture:

**Orchestrator**: GitHub Copilot via copilot-api (http://localhost:4141)
**Backend**: Express + WebSocket server (port 3333)
**Frontend**: React + Vite + Tailwind
**Persistence**: Supabase (required)

## Tabs / Features

1. **💬 Chat** — Multi-session chat with Brain or any agent. Each session has isolated memory. Load older messages with pagination.

2. **📡 Tracking** — Real-time task monitor. Shows tool calls, HTTP requests (headers sanitized), thoughts, timings. Stop button per task.

3. **🗣️ Group Debate** — Multi-agent debate sessions. Agents take turns, Brain summarizes each round and compares with previous round. Consensus detection (score 0-10). Final synthesis when score ≥ 7. Toggle: auto-synthesize ON/OFF. Per-session delay setting.

4. **⏰ Cron Jobs** — Scheduled tasks via cron expressions. Each job: prompt, agent, Telegram notification option, enable/disable. Run Now button for testing.

5. **🤖 Agents** — Create/manage specialist AI agents with custom providers (copilot/claude/gemini/openrouter/openai), models, system prompts, skills, context notes.

6. **🔌 MCP** — Connect MCP servers (Monday.com, GitHub, Slack, etc.) for tool calling.

7. **✈️ Telegram** — Telegram bot integration for remote control and receiving results.

8. **📊 Dashboard** — System overview with 4-column stats grid: agents, MCP, memory, rules, cron, debates, errors, Telegram.`,
    timestamp: ts(119),
  },

  // ── Cron Jobs ──────────────────────────────────────────────────────────────────
  {
    role: 'user',
    content: 'How do Cron Jobs work?',
    timestamp: ts(100),
  },
  {
    role: 'assistant',
    content: `Cron Jobs run scheduled tasks automatically.

**Schedule format**: standard 5-field cron \`minute hour dom month dow\`
- \`0 9 * * *\` — daily at 09:00
- \`*/30 * * * *\` — every 30 minutes
- \`0 9 * * 1-5\` — Mon-Fri at 09:00

**Each job has**:
- name, description
- schedule (cron expression)
- prompt (sent to the agent)
- agent (Brain or any custom agent)
- sendToTelegram (bool) — forwards result to owner chat
- enabled (bool)

**API**:
- \`GET /api/cron/jobs\` — list all jobs
- \`POST /api/cron/jobs\` — create job
- \`PUT /api/cron/jobs/:id\` — update
- \`DELETE /api/cron/jobs/:id\` — delete
- \`POST /api/cron/jobs/:id/run\` — run immediately

**WS events**: cron_job_start, cron_job_done, cron_job_error, cron_updated

The scheduler ticks every minute aligned to minute boundaries. Jobs are stored in Supabase \`cron_jobs\` table.`,
    timestamp: ts(99),
  },

  // ── Group Debate ───────────────────────────────────────────────────────────────
  {
    role: 'user',
    content: 'How does Group Debate work? What is the round-based architecture?',
    timestamp: ts(90),
  },
  {
    role: 'assistant',
    content: `Group Debate is a multi-agent discussion system.

**Architecture (round-based)**:
1. All agents speak once → 1 round completes
2. Brain summarizes the round (5-8 bullets)
3. Brain compares with previous round summary
4. If convergence score ≥ 7/10 → Brain writes Final Synthesis → session done
5. Otherwise → next round begins

**Settings per session**:
- \`autoSynthesize\`: true = Brain moderates, false = infinite loop (agents keep going forever)
- \`roundDelayMs\`: pause between agents (0–10000ms)

**Tool calling**: Agents with Copilot/OpenAI/OpenRouter providers can call \`search_web\` and \`http_request\` during their turn to find evidence. Claude/Gemini agents reason from training data only.

**WS events**:
- gc_round_start, gc_thinking, gc_tool_call, gc_message
- gc_round_summary (Brain's collapsible summary)
- gc_consensus_result (score + reason)
- gc_synthesis (final conclusion)
- gc_done / gc_stopped / gc_error

**Language detection**: Brain auto-detects debate language and synthesizes in the same language.

**Persistence**: Sessions + messages + roundSummaries saved to Supabase \`group_chat_sessions\`.`,
    timestamp: ts(89),
  },

  // ── Task Tracking ──────────────────────────────────────────────────────────────
  {
    role: 'user',
    content: 'How does Task Tracking work?',
    timestamp: ts(80),
  },
  {
    role: 'assistant',
    content: `Every chat interaction creates a tracking task automatically.

**Events tracked per task**:
- \`thought\` — intermediate LLM output
- \`tool_call\` — tool name + args
- \`tool_result\` — tool output
- \`http_request\` — URL, method, headers (tokens hidden), body, response
- \`agent_call\` / \`agent_response\`

**Frontend**:
- Task list (left panel) — status dot, agent name, duration, event count
- Task detail (right panel) — event timeline, expandable rows for HTTP/tool details
- Stop button — POST /api/tracking/tasks/:id/stop
- Auto-scroll toggle
- Clear finished button

**Data**: In-memory only (ephemeral). Not saved to DB. Tasks auto-clean after 30 minutes.

**Anti-loop guards in Brain**:
- Per-tool call counter: max 3 calls per tool per turn
- Loop-prone tools (list_agents, list_mcp_servers): max 1 call per turn
- Consecutive same-tool detection: if called twice with same args → force final answer`,
    timestamp: ts(79),
  },

  // ── File structure ─────────────────────────────────────────────────────────────
  {
    role: 'user',
    content: 'What is the file structure of Brain OS?',
    timestamp: ts(70),
  },
  {
    role: 'assistant',
    content: `\`\`\`
multi-ai-agent/
├── backend/
│   ├── server.js              # Express + WebSocket + all routes
│   ├── seed-context.js        # Optional memory seeding
│   └── src/
│       ├── brain.js           # Copilot orchestrator + anti-loop guards
│       ├── tools.js           # 18+ tool definitions + executor
│       ├── memory.js          # Context scoring + auto-compact
│       ├── agents.js          # Specialist agent management
│       ├── group-chat.js      # Multi-agent debate (round-based)
│       ├── tracking.js        # Real-time task monitor
│       ├── cron.js            # Cron job scheduler
│       ├── self-learn.js      # Behavioral learning engine
│       ├── mcp-manager.js     # MCP server registry
│       ├── sessions.js        # Chat session manager
│       ├── logger.js          # In-memory logger + WS broadcast
│       ├── telegram.js        # Telegram bot
│       ├── db.js              # Supabase client
│       └── constants.js       # All constants
├── frontend/src/
│   ├── App.jsx                # Routes + WS + queries
│   ├── index.css              # Design system (DM Sans, variables)
│   ├── components/
│   │   ├── Dashboard.jsx      # 4-col stats grid
│   │   ├── ChatTab.jsx        # Multi-session chat + pagination
│   │   ├── TrackingTab.jsx    # Task tracking UI
│   │   ├── GroupChatTab.jsx   # Multi-agent debate UI
│   │   ├── CronTab.jsx        # Cron job management
│   │   ├── AgentsTab.jsx      # Agent management
│   │   ├── McpTab.jsx         # MCP server management
│   │   ├── TelegramTab.jsx    # Telegram setup
│   │   └── Sidebar.jsx        # Navigation
│   └── hooks/useWebSocket.js  # WS with auto-reconnect
├── .env
├── README.md
├── supabase-migration.sql     # v1 tables
├── supabase-migration-v2.sql  # group_chat_sessions
└── supabase-migration-v3.sql  # cron_jobs
\`\`\``,
    timestamp: ts(69),
  },

  // ── Orchestrator powers ────────────────────────────────────────────────────────
  {
    role: 'user',
    content: 'What can I ask you to do to control Brain OS itself?',
    timestamp: ts(55),
  },
  {
    role: 'assistant',
    content: `I can manage every part of Brain OS directly from chat:

**Agents**
- create_agent(name, systemPrompt, provider, model, skills)
- update_agent(agent_id, ...fields)  — use list_agents first for IDs
- delete_agent(agent_id)

**Cron Jobs**
- list_cron_jobs() — see all jobs with schedule and last result
- create_cron_job(name, schedule, prompt, agent_id, sendToTelegram, enabled)
- update_cron_job(job_id, ...fields)
- delete_cron_job(job_id)
- run_cron_job(job_id) — trigger immediately

**Group Debates**
- list_debates()
- create_debate(name, topic, agents[], autoSynthesize, allowTools, roundDelayMs)
- start_debate(session_id) — agents begin talking
- stop_debate(session_id)
- delete_debate(session_id)

**MCP Servers**
- create_mcp_server(name, command, args, env)
- connect_mcp_server(server_id)
- disconnect_mcp_server(server_id)
- delete_mcp_server(server_id)

**Example requests you can give me:**
- "Tạo cron job mỗi sáng 8h tìm tin tức AI và gửi telegram"
- "Tạo debate về biến đổi khí hậu với 3 agent: nhà khoa học, nhà kinh tế, nhà hoạt động"
- "Tạo agent chuyên viết code React, dùng GPT-5.1-Codex"
- "Kết nối MCP server GitHub của tôi"`,
    timestamp: ts(54),
  },
  {
    role: 'user',
    content: 'How do I work with Monday.com data?',
    timestamp: ts(60),
  },
  {
    role: 'assistant',
    content: `Monday.com integration uses http_request directly (NOT mcp_call).

**Workflow**:
1. \`get_monday_token()\` → get headers object with Authorization token
2. POST https://api.monday.com/v2 with items_page query
3. Fetch subitems separately in a second call
4. Render HTML table per MONDAY DISPLAY RULE skill

**CRITICAL**: Never put column_values inside items_page query — causes complexity explosion. Always use 3 separate queries:
1. items_page with NO column_values (get IDs cheaply)
2. items(ids:[batch10]){column_values(ids:[safe_ids])} for column data
3. items(ids:all){subitems{}} for subitems

**Safe column IDs for board 5027230907**: task_status, task_owner, task_estimation

**AVOID in ids filter**: mirror, mirror__1, task_epic, task_sprint, monday_doc_v2 (lookup/relation types)

**Display rule**: Always render as HTML table with scrollable container. Never use markdown tables.`,
    timestamp: ts(59),
  },

];

const seededEntries = seeds.map(s => ({
  id: Date.now().toString(36) + Math.random().toString(36).slice(2, 2 + LOGGER_CONSTANTS.RANDOM_ID_SUFFIX_LENGTH),
  role: s.role,
  content: s.content,
  agent_id: 'brain',
  timestamp: s.timestamp,
  meta: { _seeded: true },
}));

async function run() {
  try {
    await db.assertConnection();
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }

  if (reset) {
    const { error } = await db.from('messages').delete().neq('id', '');
    if (error) { console.error(`❌ Failed to reset: ${error.message}`); process.exit(1); }
    console.log('🗑️  All messages deleted.');
  } else {
    const { error } = await db.from('messages').delete().eq('agent_id', 'brain').contains('meta', { _seeded: true });
    if (error) { console.error(`❌ Failed to remove old seeds: ${error.message}`); process.exit(1); }
  }

  const { error: insertError } = await db.from('messages').insert(seededEntries);
  if (insertError) { console.error(`❌ Failed to seed: ${insertError.message}`); process.exit(1); }

  const { count, error: countError } = await db.from('messages').select('id', { head: true, count: 'exact' });
  if (countError) { console.error(`❌ Count failed: ${countError.message}`); process.exit(1); }

  if (count > MEMORY_CONSTANTS.MAX_HISTORY) {
    console.warn(`⚠️  Message count (${count}) exceeds MAX_HISTORY (${MEMORY_CONSTANTS.MAX_HISTORY})`);
  }

  console.log(`✅ Seeded ${seededEntries.length} entries`);
  console.log(`   Total messages in Supabase: ${count}`);
  if (reset) console.log('   (Full reset was performed)');
}

run();