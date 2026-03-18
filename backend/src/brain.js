/**
 * brain.js — Central AI Orchestrator (Brain OS)
 *
 * v3 changes:
 *   - Updated KNOWN_MODELS with full Copilot model list (2026-03)
 *   - Added Orchestrator Powers section to BRAIN_SYSTEM
 *   - Increased TOKEN_BUDGET, STREAM_MAX_TOKENS for larger context models
 *   - Anti-loop guards: per-tool call counter + consecutive same-tool detection
 *   - Tracking integration: emits thought/tool_call/tool_result/http_request events
 */

const logger = require('./logger');
const tools  = require('./tools');
const memory = require('./memory');
const { APP_CONSTANTS, BRAIN_CONSTANTS } = require('./constants');

const COPILOT_BASE  = process.env.COPILOT_API_URL || APP_CONSTANTS.DEFAULT_COPILOT_API_URL;
const COPILOT_CHAT  = `${COPILOT_BASE}/v1/chat/completions`;
const COPILOT_MODELS = `${COPILOT_BASE}/v1/models`;

// ─── Config ───────────────────────────────────────────────────────────────────

const config = {
  available: false,
  model:     'gpt-5-mini',
  models:    [],
  provider:  'copilot',
  baseUrl:   COPILOT_BASE,
};

// Updated from Copilot model list 2026-03
const KNOWN_MODELS = [
  // Free / 0x quota
  { id: 'gpt-5-mini',         quota: '0x',    label: 'GPT-5 Mini (free)',         context: '192K' },
  { id: 'gpt-4.1',            quota: '0x',    label: 'GPT-4.1 (free)',            context: '128K' },
  { id: 'gpt-4o',             quota: '0x',    label: 'GPT-4o (free)',             context: '68K'  },
  { id: 'raptor-mini',        quota: '0x',    label: 'Raptor Mini (free)',        context: '264K' },
  // 0.25x
  { id: 'grok-code-fast-1',   quota: '0.25x', label: 'Grok Code Fast 1',          context: '173K' },
  // 0.33x
  { id: 'claude-haiku-4-5',   quota: '0.33x', label: 'Claude Haiku 4.5',          context: '160K' },
  { id: 'gemini-3-flash',     quota: '0.33x', label: 'Gemini 3 Flash',            context: '173K' },
  { id: 'gpt-5.1-codex-mini', quota: '0.33x', label: 'GPT-5.1 Codex Mini',        context: '256K' },
  { id: 'gpt-5.4-mini',       quota: '0.33x', label: 'GPT-5.4 Mini',              context: '400K' },
  // 1x
  { id: 'gpt-5.1',            quota: '1x',    label: 'GPT-5.1',                   context: '192K' },
  { id: 'gpt-5.2',            quota: '1x',    label: 'GPT-5.2',                   context: '192K' },
  { id: 'gpt-5.1-codex',      quota: '1x',    label: 'GPT-5.1 Codex',             context: '256K' },
  { id: 'gpt-5.1-codex-max',  quota: '1x',    label: 'GPT-5.1 Codex Max',         context: '256K' },
  { id: 'gpt-5.3-codex',      quota: '1x',    label: 'GPT-5.3 Codex',             context: '400K' },
  { id: 'gemini-2.5-pro',     quota: '1x',    label: 'Gemini 2.5 Pro',            context: '173K' },
  { id: 'gemini-3-pro',       quota: '1x',    label: 'Gemini 3 Pro',              context: '173K' },
  { id: 'gemini-3.1-pro',     quota: '1x',    label: 'Gemini 3.1 Pro',            context: '173K' },
  { id: 'claude-sonnet-4-5',  quota: '1x',    label: 'Claude Sonnet 4.5',         context: '160K' },
  { id: 'gpt-4.1-mini',       quota: '1x',    label: 'GPT-4.1 Mini',              context: '128K' },
];

// ─── Persistent Brain skills ───────────────────────────────────────────────────

let brainSkills = [];

async function loadBrainSkills() {
  try {
    const db = require('./db');
    const { data } = await db.from('config').select('value').eq('key', 'brain_skills').single();
    if (data?.value) {
      brainSkills = JSON.parse(data.value);
      logger.info('brain', `Loaded ${brainSkills.length} persistent skill(s)`);
    }
  } catch { /* first run — no skills yet */ }
}

function getSkills() { return [...brainSkills]; }

async function setSkills(skills) {
  brainSkills = Array.isArray(skills) ? skills : [];
  try {
    const db = require('./db');
    await db.from('config').upsert({ key: 'brain_skills', value: JSON.stringify(brainSkills) });
    logger.info('brain', `Saved ${brainSkills.length} skill(s)`);
  } catch (e) {
    logger.warn('brain', `Failed to persist skills: ${e.message}`);
  }
}

// ─── BRAIN_SYSTEM prompt ───────────────────────────────────────────────────────

const BRAIN_SYSTEM = `You are Brain — the central AI orchestrator of Brain OS.

## CRITICAL: Task Completion Rules

1. **Do NOT announce what you're about to do** — execute immediately.
   - ❌ "Tôi sẽ tìm kiếm thông tin này, chờ một chút..."
   - ✅ [call search_web immediately, deliver results]

2. **Multi-step tasks**: call ALL required tools before writing the final answer.

3. **Never produce a partial response** — if a task needs 5 searches, run all 5, then respond once.

4. **Sequential research pattern**:
   - Broad search → specific lookups (parallel if independent) → synthesize → one response

5. **Parallel tool calls**: prefer parallel over sequential when tasks are independent.

## CRITICAL: Anti-Loop Rules

6. **NEVER call the same tool twice in a row** — if you just called list_agents or list_mcp_servers, you already have the data. USE IT, do not call again.

7. **list_agents / list_mcp_servers / list_cron_jobs / list_debates**: call ONCE per turn maximum.

8. **If a tool returns an error or empty result**: try a DIFFERENT approach or ask the user for clarification. Do NOT retry the exact same tool with the exact same arguments.

9. **Loop detection**: If you find yourself wanting to call a tool you already called this turn, STOP. Synthesize what you have and respond to the user.

## Core Responsibilities

- Answer conversational questions directly and concisely.
- Use tools for real data/actions — never fabricate.
- Delegate specialized work via call_agent only after verifying IDs with list_agents.
- NEVER call call_agent with a guessed agent ID — always list_agents first (but only ONCE).

## CRITICAL: When to use call_agent vs list_agents

**NEVER use call_agent to query an agent's own configuration, skills, rules, or lessons.**
list_agents already returns the full agent config including skills array.
Reading an agent's skills = use list_agents result directly. No call_agent needed.

call_agent is ONLY for: delegating a real task (translation, coding, analysis) to a specialist.

Wrong: call_agent({ agent_id: "my-agent", task: "what are your skills?" })
Right: list_agents() → read skills from the returned agents array

## Response Guidelines

- Default language: Vietnamese (unless user writes in another language).
- Be direct — deliver results, not commentary about the process.
- Use markdown for structured responses.
- When listing items: use a table or numbered list with consistent fields.
- All auto-generated skills, rules, and instructions MUST be in English.

## Orchestrator Powers (Full App Control)

You can manage ALL Brain OS features directly via tools. Use these when users ask you to create, modify, or delete things in the app.

### Agents
Tools: create_agent, update_agent, delete_agent
- Always call list_agents first to check for duplicates
- Write systemPrompt in English for best quality
- When creating: ask purpose → propose name+model → draft prompt → confirm → create_agent

### Cron Jobs
Tools: list_cron_jobs, create_cron_job, update_cron_job, delete_cron_job, run_cron_job
- Schedule format: "minute hour dom month dow"
- Common patterns: "0 9 * * *" (daily 9am), "*/30 * * * *" (every 30min), "0 9 * * 1-5" (weekdays 9am)
- Confirm schedule interpretation with user before creating
- Example: "Tạo cron job mỗi sáng 8h tóm tắt tin tức" → create_cron_job(name, "0 8 * * *", prompt, agent_id)

### Group Debates
Tools: list_debates, create_debate, start_debate, stop_debate, delete_debate
- Need ≥ 2 agents. Each agent needs: name, role, systemPrompt, provider, model
- Workflow: create_debate → start_debate
- Example: "Tạo debate về AI ethics với 2 agent" → create_debate với agents array → start_debate

### MCP Servers
Tools: create_mcp_server, connect_mcp_server, disconnect_mcp_server, delete_mcp_server
- Check list_mcp_servers first
- After create: must call connect_mcp_server to activate

### General orchestration workflow
1. If user asks to "tạo / create / thêm": use the appropriate create tool
2. If user asks to "xóa / delete / bỏ": use the appropriate delete tool
3. If user asks to "bật / enable / chạy": use update or run tools
4. Always confirm after completion: tell user where to find the new item in the UI

## MCP Tool Rules (CRITICAL)

Sub-agents do NOT have access to mcp_call or http_request.
**NEVER use call_agent for tasks requiring mcp_call — Brain calls it directly.**

Correct workflow for MCP data requests:
1. list_mcp_servers() → get exact available tool names (call ONCE only)
2. mcp_call() → fetch data using EXACT tool name from step 1
3. Format output applying Brain's formatting skills
4. Brain formats the output itself — never delegate MCP formatting to sub-agents

**NEVER guess tool names.** If mcp_call returns tool-not-found:
→ call mcp_connect to refresh, then retry with the correct name.
→ Do NOT call list_mcp_servers again.

## Monday.com Rules (CRITICAL)

Monday.com API is called via **http_request** directly to 'https://api.monday.com/v2'.
Token stored in MCP config — always call 'get_monday_token()' first to get headers.

**EXACT WORKFLOW — follow precisely:**

Step 1: 'get_monday_token()' → save 'result.headers' object.

Step 2: ITEMS QUERY — http_request(url: 'https://api.monday.com/v2', method: 'POST', headers: result.headers, body: JSON.stringify({query: 'query($b:ID!){boards(ids:[$b]){columns{id title type}groups{id title items_page(limit:50){cursor items{id name state created_at updated_at group{id title}column_values{id text value type}}}}}}}', variables: { b: 'BOARD_ID' }}))

Step 3: SUBITEMS QUERY — collect item IDs from step 2, then: http_request(url: 'https://api.monday.com/v2', method: 'POST', headers: result.headers, body: JSON.stringify({query: 'query($ids:[ID!]!){items(ids:$ids){id name subitems{id name column_values{id text value type}}}}', variables: { ids: ['ID1','ID2','ID3'] }}))

Step 4: Merge items + subitems. Render HTML per MONDAY DISPLAY RULE skill — **immediately, no questions**.

**DISPLAY RULE — always apply, never ask user what format:**
Use MONDAY DISPLAY RULE skill. Output HTML block only.

**If complexity error on step 2:** reduce limit 50→25→10, retry same query.

**FORBIDDEN:**
- ❌ NEVER ask user 'bạn muốn xuất theo dạng nào?' — always render HTML immediately
- ❌ NEVER use markdown table for Monday data
- ❌ NEVER call create_mcp_server for Monday
- ❌ NEVER use mcp_call or all_monday_api for Monday data fetching

## Skill Management Rules (CRITICAL)

Brain's skills (id: "brain") are **permanent configuration** — they apply to all sessions.
Sub-agent skills only affect that agent's LLM output (no tool access).

**When adding/updating skills:**
- Always call list_agents FIRST to read current skills (only ONCE)
- Merge: keep ALL existing skills + add/modify only what was requested
- NEVER pass an empty skills array to update_agent unless user explicitly says "remove all skills"
- Formatting skills (HTML tables, icons, layout) MUST be added to Brain, not sub-agents

**When user says "add skill X":**
1. list_agents() → read Brain's current skills array (call ONCE)
2. update_agent({ agent_id: "brain", skills: [...currentSkills, "X"] })
3. Confirm with the user what was added

## Agent Creation Wizard

When user wants to create an agent:
1. Ask purpose
2. Propose name + description + recommend provider/model (table format)
3. Draft system prompt
4. Suggest 3–5 skills (in English)
5. Confirm → call create_agent`;

// ─── Copilot availability ──────────────────────────────────────────────────────

async function checkOllama() {
  try {
    const res = await fetch(COPILOT_MODELS, {
      signal: AbortSignal.timeout(BRAIN_CONSTANTS.MODEL_DISCOVERY_TIMEOUT_MS),
    });
    if (res.ok) {
      const data = await res.json();
      const discovered = (data.data || []).map(m => {
        const known = KNOWN_MODELS.find(k => k.id === m.id);
        return known || { id: m.id, quota: '?', label: m.id, context: '?' };
      });
      config.models   = discovered.length ? discovered : KNOWN_MODELS;
      config.available = true;
      logger.info('brain', `✅ copilot-api connected — model: ${config.model}`);
      return true;
    }
  } catch { /* not running */ }
  config.available = false;
  logger.warn('brain', `copilot-api not reachable at ${COPILOT_BASE}. Run: npx copilot-api@latest start`);
  return false;
}

function setModel(model) {
  config.model = model || 'gpt-5-mini';
  logger.info('brain', `Model set: ${config.model}`);
}

function getConfig() { return { ...config }; }

// ─── Classify error type ──────────────────────────────────────────────────────

function isNetworkError(e) {
  const msg   = (e.message || '').toLowerCase();
  const cause = (e.cause?.message || '').toLowerCase();
  return (
    msg.includes('fetch failed')       ||
    msg.includes('econnreset')         ||
    msg.includes('connect timeout')    ||
    msg.includes('connection refused') ||
    cause.includes('econnreset')       ||
    cause.includes('connect timeout')  ||
    cause.includes('read econnreset')
  );
}

// ─── Retry wrapper ────────────────────────────────────────────────────────────

async function fetchWithRetry(url, opts, maxRetries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fetch(url, opts);
    } catch (e) {
      lastError = e;
      if (!isNetworkError(e) || attempt === maxRetries) throw e;
      const delay = 1500 * Math.pow(2, attempt);
      logger.warn('brain', `Network error (attempt ${attempt + 1}/${maxRetries + 1}): ${e.message}. Retry in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError;
}

// ─── Prune large tool results ─────────────────────────────────────────────────

function pruneLoopMessages(messages) {
  const TOOL_MAX  = 4000;
  const HEAD      = 1600;
  const TAIL      = 800;
  const RESP_MAX  = 2000;
  const SEARCH_MAX = 5;

  return messages.map(m => {
    if (m.role !== 'tool') return m;

    let content = m.content;
    if (typeof content === 'string' && content.length > TOOL_MAX) {
      try {
        const parsed = JSON.parse(content);
        if (parsed?.results?.length > SEARCH_MAX) {
          parsed.results = parsed.results.slice(0, SEARCH_MAX).map(r => ({
            ...r, snippet: r.snippet?.slice(0, 300),
          }));
          content = JSON.stringify(parsed);
        }
      } catch { /* not JSON — truncate raw */ }

      if (content.length > TOOL_MAX) {
        content = `${content.slice(0, HEAD)}\n...[${content.length - HEAD - TAIL} chars trimmed]...\n${content.slice(-TAIL)}`;
      }
    }

    if (typeof m.content === 'object') {
      const str = JSON.stringify(m.content);
      if (str.length > RESP_MAX) content = str.slice(0, RESP_MAX) + '...[trimmed]';
    }

    return { ...m, content };
  });
}

// ─── Non-streaming call with tools ───────────────────────────────────────────

async function callWithTools(messages, model) {
  const useModel = model || config.model;
  const pruned   = pruneLoopMessages(messages);

  logger.debug('brain', `callWithTools: ${pruned.length} msgs, ~${JSON.stringify(pruned).length} chars`);

  const res = await fetchWithRetry(COPILOT_CHAT, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:       useModel,
      messages:    pruned,
      tools:       tools.TOOL_DEFINITIONS,
      tool_choice: 'auto',
      stream:      false,
      max_tokens:  BRAIN_CONSTANTS.STREAM_MAX_TOKENS,
    }),
  });

  if (!res.ok) {
    const err   = await res.text();
    const error = new Error(`copilot-api error ${res.status}: ${err.slice(0, 200)}`);
    error.statusCode = res.status;
    throw error;
  }
  const data = await res.json();
  return data.choices[0];
}

// ─── Streaming final response ─────────────────────────────────────────────────

async function streamChat({ messages, model, onToken, onDone, onError }) {
  const useModel = model || config.model;
  const pruned   = pruneLoopMessages(messages);

  try {
    const res = await fetchWithRetry(COPILOT_CHAT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:      useModel,
        messages:   pruned,
        stream:     true,
        max_tokens: BRAIN_CONSTANTS.STREAM_MAX_TOKENS,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Stream error ${res.status}: ${err.slice(0, 200)}`);
    }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const lines = decoder.decode(value).split('\n')
        .filter(l => l.startsWith('data: ') && !l.includes('[DONE]'));
      for (const line of lines) {
        try {
          const token = JSON.parse(line.slice(6)).choices?.[0]?.delta?.content || '';
          if (token) { fullContent += token; onToken(token); }
        } catch { /* skip malformed chunk */ }
      }
    }
    onDone(fullContent);
    return fullContent;
  } catch (e) {
    logger.error('brain', `Stream error: ${e.message}`);
    onError(e);
    throw e;
  }
}

// ─── Simple one-shot call (no tools, no streaming) ───────────────────────────

async function call(messages, model = null) {
  const useModel = model || config.model;
  try {
    const res = await fetchWithRetry(COPILOT_CHAT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:      useModel,
        messages,
        stream:     false,
        max_tokens: BRAIN_CONSTANTS.CALL_MAX_TOKENS,
      }),
    });
    if (!res.ok) throw new Error(`copilot-api ${res.status}`);
    const data = await res.json();
    return data.choices[0]?.message?.content || '';
  } catch (e) {
    logger.error('brain', `call() error: ${e.message}`);
    return null;
  }
}

// ─── Main chat entry point ────────────────────────────────────────────────────

async function chat({ userInput, agentId = 'brain', onToken, onDone, onError, onToolCall, taskId }) {
  if (!config.available) {
    await checkOllama();
    if (!config.available) {
      onError(new Error(
        'copilot-api chưa chạy.\n' +
        'Khởi động: npx copilot-api@latest start\n' +
        '(Lần đầu: npx copilot-api@latest auth)'
      ));
      return;
    }
  }

  await memory.autoCompactIfNeeded(agentId, (msgs) => call(msgs));

  let selfLearn;
  try { selfLearn = require('./self-learn'); } catch { selfLearn = null; }

  const lessonsContext = selfLearn ? selfLearn.buildLessonsContext(userInput) : '';

  const skillsSection = brainSkills.length > 0
    ? '\n\n## Persistent Brain Skills\n' + brainSkills.map((s, i) => `${i + 1}. ${s}`).join('\n')
    : '';

  const session    = require('./sessions').getById(agentId);
  const sessionCtx = session?.systemContext?.trim()
    ? `\n\n## Session Context\n${session.systemContext}` : '';

  const fullSystemPrompt = BRAIN_SYSTEM + skillsSection + sessionCtx + lessonsContext;

  const assembled = memory.assemblePrompt({
    currentInput: userInput,
    agentId,
    systemPrompt: fullSystemPrompt,
    tokenBudget:  BRAIN_CONSTANTS.TOKEN_BUDGET,
  });

  logger.debug('brain', `Chat start. agentId=${agentId}, ctx=${assembled.stats.selectedMessages} msgs, ~${assembled.stats.estimatedTokens} tokens`);

  memory.store('user', userInput, agentId);

  const loopMessages = [
    { role: 'system', content: assembled.systemPrompt },
    ...assembled.context,
    { role: 'user',   content: userInput },
  ];

  // ── Tracking integration ───────────────────────────────────────────────────
  let tracking;
  try { tracking = require('./tracking'); } catch { tracking = null; }
  const emitEvent = (event) => { if (tracking && taskId) tracking.addEvent(taskId, event); };

  // ── Anti-loop guards ───────────────────────────────────────────────────────
  const toolCallCounts = new Map();
  let lastToolSignature     = null;
  let consecutiveSameCount  = 0;

  const MAX_SAME_TOOL_PER_TURN = 3;
  const MAX_CONSECUTIVE_SAME   = 2;
  const LOOP_PRONE_TOOLS = new Set(['list_agents', 'list_mcp_servers', 'get_monday_token', 'list_cron_jobs', 'list_debates']);
  const MAX_LOOP_PRONE_CALLS = 1;

  // ── Tool calling loop ──────────────────────────────────────────────────────
  const MAX_LOOPS = BRAIN_CONSTANTS.TOOL_LOOP_LIMIT;
  let consecutiveNetworkErrors = 0;
  const MAX_CONSECUTIVE_NETWORK = 2;

  for (let loop = 1; loop <= MAX_LOOPS; loop++) {
    logger.debug('brain', `Tool loop ${loop}/${MAX_LOOPS}`);

    let choice;
    try {
      choice = await callWithTools(loopMessages, config.model);
      consecutiveNetworkErrors = 0;
    } catch (e) {
      logger.error('brain', `Loop ${loop} error: ${e.message}`);
      if (isNetworkError(e)) {
        consecutiveNetworkErrors++;
        if (consecutiveNetworkErrors >= MAX_CONSECUTIVE_NETWORK) {
          onError(new Error(
            `copilot-api không phản hồi (${consecutiveNetworkErrors} lần liên tiếp).\n` +
            `Nguyên nhân: ${e.cause?.message || e.message}`
          ));
          return;
        }
        await new Promise(r => setTimeout(r, 2000 * consecutiveNetworkErrors));
        continue;
      }
      onError(e);
      return;
    }

    const msg      = choice.message;
    const hasTools = msg.tool_calls?.length > 0;

    // ── No tool calls → final answer ─────────────────────────────────────────
    if (!hasTools) {
      if (msg.content) {
        for (const ch of msg.content) onToken(ch);
        memory.store('assistant', msg.content, agentId);
        onDone(msg.content, assembled.stats);
      } else {
        await streamChat({
          messages: loopMessages,
          model:    config.model,
          onToken,
          onDone: (content) => {
            memory.store('assistant', content, agentId);
            onDone(content, assembled.stats);
          },
          onError,
        });
      }
      return;
    }

    // ── Has tool calls — apply anti-loop guards ───────────────────────────────
    if (msg.content) {
      emitEvent({ type: 'thought', content: msg.content, ts: Date.now() });
      logger.debug('brain', `Thought (${msg.content.length}c) + ${msg.tool_calls.length} tool calls`);
    }

    const currentSig = msg.tool_calls
      .map(tc => `${tc.function.name}:${JSON.stringify(tc.function.arguments)}`).join('|');

    if (currentSig === lastToolSignature) {
      consecutiveSameCount++;
    } else {
      consecutiveSameCount = 1;
      lastToolSignature    = currentSig;
    }

    const filteredToolCalls = [];
    const syntheticResults  = [];

    for (const tc of msg.tool_calls) {
      const name       = tc.function.name;
      const prevCount  = toolCallCounts.get(name) || 0;
      const maxAllowed = LOOP_PRONE_TOOLS.has(name) ? MAX_LOOP_PRONE_CALLS : MAX_SAME_TOOL_PER_TURN;

      if (prevCount >= maxAllowed) {
        logger.warn('brain', `Anti-loop: blocking ${name} (called ${prevCount}x, max ${maxAllowed})`);
        syntheticResults.push({
          role: 'tool', tool_call_id: tc.id,
          content: JSON.stringify({
            _loop_guard: true,
            error: `Tool "${name}" has already been called ${prevCount} time(s) this turn. DO NOT call it again. Use the results you already have.`,
          }),
        });
      } else {
        toolCallCounts.set(name, prevCount + 1);
        filteredToolCalls.push(tc);
      }
    }

    if (filteredToolCalls.length === 0) {
      logger.warn('brain', `Anti-loop: all blocked — forcing final answer`);
      loopMessages.push(msg);
      for (const sr of syntheticResults) loopMessages.push(sr);
      loopMessages.push({ role: 'user', content: '[SYSTEM] Loop detected. You MUST now synthesize your existing results and provide a final answer. Do not call any more tools.' });
      await streamChat({ messages: loopMessages, model: config.model, onToken, onDone: (c) => { memory.store('assistant', c, agentId); onDone(c, assembled.stats); }, onError });
      return;
    }

    if (consecutiveSameCount > MAX_CONSECUTIVE_SAME) {
      logger.warn('brain', `Anti-loop: same signature ${consecutiveSameCount}x — forcing answer`);
      loopMessages.push(msg);
      loopMessages.push({ role: 'user', content: '[SYSTEM] You keep calling the same tools. STOP and provide a final answer using what you already have.' });
      await streamChat({ messages: loopMessages, model: config.model, onToken, onDone: (c) => { memory.store('assistant', c, agentId); onDone(c, assembled.stats); }, onError });
      return;
    }

    logger.debug('brain', `Executing: ${filteredToolCalls.map(t => t.function.name).join(', ')}`);

    if (onToolCall) filteredToolCalls.forEach(tc => onToolCall({ tool: tc.function.name, args: tc.function.arguments }));

    filteredToolCalls.forEach(tc => {
      emitEvent({
        type: 'tool_call',
        tool: tc.function.name,
        args: typeof tc.function.arguments === 'string'
          ? JSON.parse(tc.function.arguments || '{}')
          : (tc.function.arguments || {}),
        ts: Date.now(),
      });
    });

    loopMessages.push(msg);
    for (const sr of syntheticResults) loopMessages.push(sr);

    const results = await tools.executeToolsParallel(
      filteredToolCalls.map(tc => ({
        id: tc.id,
        function: {
          name:      tc.function.name,
          arguments: typeof tc.function.arguments === 'string'
            ? JSON.parse(tc.function.arguments || '{}')
            : (tc.function.arguments || {}),
        },
      }))
    );

    filteredToolCalls.forEach((tc, i) => {
      const result = results[i];
      loopMessages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });

      emitEvent({ type: 'tool_result', tool: tc.function.name, result, ts: Date.now() });

      if (tc.function.name === 'http_request') {
        const args = typeof tc.function.arguments === 'string'
          ? JSON.parse(tc.function.arguments || '{}')
          : (tc.function.arguments || {});
        emitEvent({ type: 'http_request', url: args.url, method: args.method || 'GET', headers: args.headers, body: args.body, response: result, ts: Date.now() });
      }
    });
  }

  logger.warn('brain', `Tool loop limit (${MAX_LOOPS}) reached — forcing final stream`);
  await streamChat({
    messages: loopMessages,
    model:    config.model,
    onToken,
    onDone: (content) => { memory.store('assistant', content, agentId); onDone(content, assembled.stats); },
    onError,
  });
}

// ─── Summarize history ────────────────────────────────────────────────────────

async function summarizeHistory(agentId = 'brain') {
  const history = memory.getHistory(agentId, BRAIN_CONSTANTS.SUMMARY_HISTORY_LIMIT);
  if (history.length < BRAIN_CONSTANTS.SUMMARY_MIN_HISTORY) return 'Chưa đủ lịch sử để tóm tắt.';

  const text = history
    .slice(-BRAIN_CONSTANTS.SUMMARY_HISTORY_LIMIT)
    .map(m => `${m.role}: ${m.content.slice(0, 400)}`)
    .join('\n');

  const result = await call([{
    role:    'user',
    content: `Summarize this conversation concisely in 4–6 bullet points. Preserve key facts, decisions, and user preferences:\n\n${text}`,
  }]);

  if (result) memory.storeSummary(agentId, result, []);
  return result || 'Unable to summarize.';
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  checkOllama,
  setModel,
  getConfig,
  getSkills,
  setSkills,
  loadBrainSkills,
  chat,
  call,
  streamChat,
  summarizeHistory,
  KNOWN_MODELS,
};