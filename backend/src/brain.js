/**
 * brain.js — Central AI Orchestrator (Brain OS)
 *
 * Features:
 *   - GitHub Copilot via copilot-api local proxy
 *   - Tool calling loop with parallel execution
 *   - Persistent Brain skills (stored in Supabase config table)
 *   - Per-session memory isolation (agentId scoping)
 *   - Auto-compact context when sessions get long
 *   - Self-learning lesson injection
 *   - Retry on timeout with exponential backoff
 *   - Graceful degradation on consecutive network errors
 */

const logger = require('./logger');
const tools = require('./tools');
const memory = require('./memory');
const { APP_CONSTANTS, BRAIN_CONSTANTS } = require('./constants');

const COPILOT_BASE = process.env.COPILOT_API_URL || APP_CONSTANTS.DEFAULT_COPILOT_API_URL;
const COPILOT_CHAT = `${COPILOT_BASE}/v1/chat/completions`;
const COPILOT_MODELS = `${COPILOT_BASE}/v1/models`;

// ─── Config ───────────────────────────────────────────────────────────────────

const config = {
  available: false,
  model: 'gpt-5-mini',
  models: [],
  provider: 'copilot',
  baseUrl: COPILOT_BASE,
};

const KNOWN_MODELS = [
  { id: 'gpt-5-mini', quota: 'free', label: 'GPT-5 Mini (Free)' },
  { id: 'gpt-4.1-mini', quota: 'free', label: 'GPT-4.1 Mini (Free)' },
  { id: 'gpt-4o-mini', quota: 'free', label: 'GPT-4o Mini (Free)' },
  { id: 'gemini-2.0-flash', quota: 'free', label: 'Gemini 2.0 Flash (Free)' },
  { id: 'claude-haiku-4-5', quota: 'x0.33', label: 'Claude Haiku 4.5 (x0.33)' },
  { id: 'gpt-4.1', quota: 'x1', label: 'GPT-4.1 (x1)' },
  { id: 'gpt-4o', quota: 'x1', label: 'GPT-4o (x1)' },
  { id: 'gpt-5.1', quota: 'x1', label: 'GPT-5.1 (x1)' },
  { id: 'claude-sonnet-4.5', quota: 'x1', label: 'Claude Sonnet 4.5 (x1)' },
  { id: 'gemini-2.5-pro', quota: 'x1', label: 'Gemini 2.5 Pro (x1)' },
  { id: 'gpt-5.1-codex', quota: 'x1', label: 'GPT-5.1 Codex (x1)' },
  { id: 'o1-mini', quota: 'x3', label: 'o1 Mini (x3)' },
  { id: 'o3-mini', quota: 'x3', label: 'o3 Mini (x3)' },
  { id: 'o1', quota: 'x5', label: 'o1 (x5)' },
];

// ─── Persistent Brain skills ───────────────────────────────────────────────────

let brainSkills = [];

async function loadBrainSkills() {
  try {
    const db = require('./db');
    const { data } = await db
      .from('config')
      .select('value')
      .eq('key', 'brain_skills')
      .single();
    if (data?.value) {
      brainSkills = JSON.parse(data.value);
      logger.info('brain', `Loaded ${brainSkills.length} persistent skill(s)`);
    }
  } catch { /* first run — no skills yet */ }
}

function getSkills() {
  return [...brainSkills];
}

async function setSkills(skills) {
  brainSkills = Array.isArray(skills) ? skills : [];
  try {
    const db = require('./db');
    await db.from('config').upsert({
      key: 'brain_skills',
      value: JSON.stringify(brainSkills),
    });
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

## Core Responsibilities

- Answer conversational questions directly and concisely.
- Use tools for real data/actions — never fabricate.
- Delegate specialized work via call_agent only after verifying IDs with list_agents.
- NEVER call call_agent with a guessed agent ID — always list_agents first.

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

## Agent Creation Wizard

When user wants to create an agent, follow these steps:
1. Ask purpose
2. Propose name + description
3. Recommend provider/model (table format)
4. Draft system prompt
5. Suggest 3–5 skills (in English)
6. Confirm → call create_agent

## Tool Usage

- search_web + browse_web: for current/external information
- call_agent: route specialized WORK tasks (translation, coding, research) — NOT config queries
- run_pipeline: parallel research across multiple agents
- save_lesson: record patterns that should persist across sessions
- Always prefer parallel tool calls when tasks are independent

## MCP Tool Rules (CRITICAL)

Sub-agents do NOT have access to mcp_call or http_request.
**NEVER use call_agent for tasks requiring mcp_call — Brain calls it directly.**

Correct workflow for MCP data requests:
1. list_mcp_servers() → get exact available tool names
2. mcp_call() → fetch data using EXACT tool name from step 1
3. Format output applying Brain's formatting skills
4. Brain formats the output itself — never delegate MCP formatting to sub-agents

**NEVER guess tool names.** If mcp_call returns tool-not-found:
→ call mcp_connect to refresh, then retry with the correct name.

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
- Always call list_agents FIRST to read current skills
- Merge: keep ALL existing skills + add/modify only what was requested
- NEVER pass an empty skills array to update_agent unless user explicitly says "remove all skills"
- Formatting skills (HTML tables, icons, layout) MUST be added to Brain, not sub-agents

**When user says "add skill X":**
1. list_agents() → read Brain's current skills array
2. update_agent({ agent_id: "brain", skills: [...currentSkills, "X"] })
3. Confirm with the user what was added`;

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
        return known || { id: m.id, quota: 'x1', label: m.id };
      });
      config.models = discovered.length ? discovered : KNOWN_MODELS;
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
  const msg = (e.message || '').toLowerCase();
  const cause = (e.cause?.message || '').toLowerCase();
  return (
    msg.includes('fetch failed') ||
    msg.includes('econnreset') ||
    msg.includes('connect timeout') ||
    msg.includes('connection refused') ||
    cause.includes('econnreset') ||
    cause.includes('connect timeout') ||
    cause.includes('read econnreset')
  );
}

function isRetryable500(e) {
  return e.message?.includes('500') && isNetworkError(e);
}

// ─── Retry wrapper with exponential backoff ───────────────────────────────────

async function fetchWithRetry(url, opts, maxRetries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fetch(url, opts);
    } catch (e) {
      lastError = e;
      const shouldRetry = isNetworkError(e);
      if (!shouldRetry || attempt === maxRetries) throw e;
      const delay = 1500 * Math.pow(2, attempt); // 1.5s, 3s
      logger.warn('brain', `Network error (attempt ${attempt + 1}/${maxRetries + 1}): ${e.message}. Retry in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError;
}

// ─── Prune large tool results before sending to API ──────────────────────────

function pruneLoopMessages(messages) {
  const TOOL_MAX = 1500;
  const HEAD = 600;
  const TAIL = 400;
  const RESP_MAX = 800;
  const SEARCH_MAX = 5;

  return messages.map(m => {
    if (m.role !== 'tool') return m;

    let content = m.content;
    if (typeof content === 'string' && content.length > TOOL_MAX) {
      try {
        const parsed = JSON.parse(content);
        if (parsed?.results?.length > SEARCH_MAX) {
          parsed.results = parsed.results.slice(0, SEARCH_MAX).map(r => ({
            ...r,
            snippet: r.snippet?.slice(0, 200),
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
      if (str.length > RESP_MAX) {
        content = str.slice(0, RESP_MAX) + '...[trimmed]';
      }
    }

    return { ...m, content };
  });
}

// ─── Non-streaming call with tools ────────────────────────────────────────────

async function callWithTools(messages, model) {
  const useModel = model || config.model;
  const pruned = pruneLoopMessages(messages);

  logger.debug('brain', `callWithTools: ${pruned.length} msgs, payload ~${JSON.stringify(pruned).length} chars`);

  const res = await fetchWithRetry(COPILOT_CHAT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: useModel,
      messages: pruned,
      tools: tools.TOOL_DEFINITIONS,
      tool_choice: 'auto',
      stream: false,
      max_tokens: BRAIN_CONSTANTS.STREAM_MAX_TOKENS,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    const error = new Error(`copilot-api error ${res.status}: ${err.slice(0, 200)}`);
    // Attach status for caller to inspect
    error.statusCode = res.status;
    throw error;
  }
  const data = await res.json();
  return data.choices[0];
}

// ─── Streaming final response ──────────────────────────────────────────────────

async function streamChat({ messages, model, onToken, onDone, onError }) {
  const useModel = model || config.model;
  const pruned = pruneLoopMessages(messages);

  try {
    const res = await fetchWithRetry(COPILOT_CHAT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: useModel,
        messages: pruned,
        stream: true,
        max_tokens: BRAIN_CONSTANTS.STREAM_MAX_TOKENS,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Stream error ${res.status}: ${err.slice(0, 200)}`);
    }

    const reader = res.body.getReader();
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

// ─── Simple one-shot call (no tools, no streaming) ────────────────────────────

async function call(messages, model = null) {
  const useModel = model || config.model;
  try {
    const res = await fetchWithRetry(COPILOT_CHAT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: useModel,
        messages,
        stream: false,
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

// ─── Main chat entry point ─────────────────────────────────────────────────────

async function chat({ userInput, agentId = 'brain', onToken, onDone, onError, onToolCall }) {
  // Ensure copilot-api is reachable
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

  // Auto-compact context silently if session is getting long
  await memory.autoCompactIfNeeded(agentId, (msgs) => call(msgs));

  // Build system prompt
  let selfLearn;
  try { selfLearn = require('./self-learn'); } catch { selfLearn = null; }

  const lessonsContext = selfLearn ? selfLearn.buildLessonsContext(userInput) : '';

  const skillsSection = brainSkills.length > 0
    ? '\n\n## Persistent Brain Skills\n' +
    brainSkills.map((s, i) => `${i + 1}. ${s}`).join('\n')
    : '';

  const session = require('./sessions').getById(agentId);
  const sessionCtx = session?.systemContext?.trim()
    ? `\n\n## Session Context\n${session.systemContext}` : '';

  const fullSystemPrompt = BRAIN_SYSTEM + skillsSection + sessionCtx + lessonsContext;

  // Assemble prompt with context
  const assembled = memory.assemblePrompt({
    currentInput: userInput,
    agentId,
    systemPrompt: fullSystemPrompt,
    tokenBudget: BRAIN_CONSTANTS.TOKEN_BUDGET,
  });

  logger.debug('brain', `Chat start. agentId=${agentId}, ctx=${assembled.stats.selectedMessages} msgs, ~${assembled.stats.estimatedTokens} tokens`);

  memory.store('user', userInput, agentId);

  const loopMessages = [
    { role: 'system', content: assembled.systemPrompt },
    ...assembled.context,
    { role: 'user', content: userInput },
  ];

  // ─── Tool calling loop ─────────────────────────────────────────────────────
  const MAX_LOOPS = BRAIN_CONSTANTS.TOOL_LOOP_LIMIT;

  // Track consecutive network errors — stop early if copilot-api is down
  let consecutiveNetworkErrors = 0;
  const MAX_CONSECUTIVE_NETWORK_ERRORS = 2;

  for (let loop = 1; loop <= MAX_LOOPS; loop++) {
    logger.debug('brain', `Tool loop ${loop}/${MAX_LOOPS}`);

    let choice;
    try {
      choice = await callWithTools(loopMessages, config.model);
      // Reset counter on success
      consecutiveNetworkErrors = 0;
    } catch (e) {
      logger.error('brain', `Loop ${loop} error: ${e.message}`);

      // Network/copilot-api down — don't keep looping
      if (isNetworkError(e) || isRetryable500(e)) {
        consecutiveNetworkErrors++;
        if (consecutiveNetworkErrors >= MAX_CONSECUTIVE_NETWORK_ERRORS) {
          logger.warn('brain', `${consecutiveNetworkErrors} consecutive network errors — stopping loop`);
          onError(new Error(
            `copilot-api không phản hồi (${consecutiveNetworkErrors} lần liên tiếp).\n` +
            `Nguyên nhân: ${e.cause?.message || e.message}\n` +
            `Thử lại sau vài giây hoặc kiểm tra kết nối mạng.`
          ));
          return;
        }
        // Wait before retrying this loop iteration
        const delay = 2000 * consecutiveNetworkErrors;
        logger.warn('brain', `Network error, waiting ${delay}ms before continuing...`);
        await new Promise(r => setTimeout(r, delay));
        continue; // retry same loop index
      }

      onError(e);
      return;
    }

    const msg = choice.message;
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
          model: config.model,
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

    // ── Has tool calls → execute, continue loop ───────────────────────────────
    if (msg.content) {
      logger.debug('brain', `Intermediate thought (${msg.content.length}c) + ${msg.tool_calls.length} tool calls`);
    }

    const toolNames = msg.tool_calls.map(t => t.function.name).join(', ');
    logger.debug('brain', `Executing: ${toolNames}`);

    if (onToolCall) {
      msg.tool_calls.forEach(tc =>
        onToolCall({ tool: tc.function.name, args: tc.function.arguments })
      );
    }

    loopMessages.push(msg);

    // Execute all tool calls in parallel
    const results = await tools.executeToolsParallel(
      msg.tool_calls.map(tc => ({
        id: tc.id,
        function: {
          name: tc.function.name,
          arguments: typeof tc.function.arguments === 'string'
            ? JSON.parse(tc.function.arguments || '{}')
            : (tc.function.arguments || {}),
        },
      }))
    );

    msg.tool_calls.forEach((tc, i) => {
      loopMessages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(results[i]),
      });
    });
  }

  // ── Loop limit hit → force final response ─────────────────────────────────
  logger.warn('brain', `Tool loop limit (${MAX_LOOPS}) reached — forcing final stream`);
  await streamChat({
    messages: loopMessages,
    model: config.model,
    onToken,
    onDone: (content) => {
      memory.store('assistant', content, agentId);
      onDone(content, assembled.stats);
    },
    onError,
  });
}

// ─── Summarize history ────────────────────────────────────────────────────────

async function summarizeHistory(agentId = 'brain') {
  const history = memory.getHistory(agentId, BRAIN_CONSTANTS.SUMMARY_HISTORY_LIMIT);
  if (history.length < BRAIN_CONSTANTS.SUMMARY_MIN_HISTORY) {
    return 'Chưa đủ lịch sử để tóm tắt.';
  }

  const text = history
    .slice(-BRAIN_CONSTANTS.SUMMARY_HISTORY_LIMIT)
    .map(m => `${m.role}: ${m.content.slice(0, 400)}`)
    .join('\n');

  const result = await call([{
    role: 'user',
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