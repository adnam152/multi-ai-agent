/**
 * brain.js — Orchestrator using GitHub Copilot (via copilot-api local proxy)
 *
 * Timeout fix (v2):
 *   - pruneLoopMessages(): shrink tool results in accumulated messages before each API call
 *   - callWithRetry(): retry on network timeout with exponential backoff
 *   - Max payload guard: hard cap on total chars sent per request
 */

const logger = require('./logger');
const tools = require('./tools');
const memory = require('./memory');
const { APP_CONSTANTS, BRAIN_CONSTANTS } = require('./constants');

const COPILOT_BASE = process.env.COPILOT_API_URL || APP_CONSTANTS.DEFAULT_COPILOT_API_URL;
const COPILOT_CHAT = `${COPILOT_BASE}/v1/chat/completions`;
const COPILOT_MODELS = `${COPILOT_BASE}/v1/models`;

const config = {
  available: false,
  model: 'gpt-5-mini',
  models: [],
  provider: 'copilot',
  baseUrl: COPILOT_BASE,
};

const KNOWN_MODELS = [
  { id: 'gpt-5-mini',        quota: 'free', label: 'GPT-5 Mini (Free)' },
  { id: 'gpt-4.1-mini',      quota: 'free', label: 'GPT-4.1 Mini (Free)' },
  { id: 'gpt-4o-mini',       quota: 'free', label: 'GPT-4o Mini (Free)' },
  { id: 'gemini-2.0-flash',  quota: 'free', label: 'Gemini 2.0 Flash (Free)' },
  { id: 'gpt-4.1',           quota: 'x1',   label: 'GPT-4.1 (x1)' },
  { id: 'gpt-4o',            quota: 'x1',   label: 'GPT-4o (x1)' },
  { id: 'claude-sonnet-4.5', quota: 'x1',   label: 'Claude Sonnet 4.5 (x1)' },
  { id: 'claude-haiku-3.5',  quota: 'x1',   label: 'Claude Haiku 3.5 (x1)' },
  { id: 'o1-mini',           quota: 'x3',   label: 'o1 Mini (x3 premium)' },
  { id: 'o3-mini',           quota: 'x3',   label: 'o3 Mini (x3 premium)' },
  { id: 'o1',                quota: 'x5',   label: 'o1 (x5 premium)' },
];

// ─── Payload limits ────────────────────────────────────────────────────────────

// copilot-api upstream timeout is 10s — keep payload small to stay under it
// These are conservative limits to avoid timeouts
const TOOL_RESULT_MAX_CHARS  = 1500;  // max chars per tool result in loopMessages
const TOOL_RESULT_HEAD_CHARS = 600;   // keep first N chars
const TOOL_RESULT_TAIL_CHARS = 300;   // keep last N chars
const MAX_LOOP_MESSAGES_CHARS = 12000; // hard cap on total loopMessages payload

// ─── Tool result pruning ──────────────────────────────────────────────────────

/**
 * Prune a single tool result string.
 * Head/tail preservation to keep most useful parts.
 */
function pruneContent(content, maxChars = TOOL_RESULT_MAX_CHARS) {
  if (!content || content.length <= maxChars) return content;
  const head = content.slice(0, TOOL_RESULT_HEAD_CHARS);
  const tail = content.slice(-TOOL_RESULT_TAIL_CHARS);
  const trimmed = content.length - TOOL_RESULT_HEAD_CHARS - TOOL_RESULT_TAIL_CHARS;
  return `${head}\n...[${trimmed} chars trimmed]...\n${tail}`;
}

/**
 * Prune loopMessages before sending to copilot-api.
 *
 * Strategy:
 *   1. Always keep: system message + last 2 user/assistant turns
 *   2. Shrink all tool result messages (role: 'tool')
 *   3. If total still too large: drop middle tool messages entirely,
 *      replace with a placeholder summary
 */
function pruneLoopMessages(messages) {
  if (!messages || messages.length === 0) return messages;

  // Step 1: Shrink all tool results
  const shrunk = messages.map(m => {
    if (m.role === 'tool') {
      let content = m.content;
      // Parse JSON tool results and prune the inner content
      try {
        const parsed = JSON.parse(content);
        // If it has a 'results' array (search), prune each snippet
        if (parsed.results && Array.isArray(parsed.results)) {
          parsed.results = parsed.results.slice(0, 5).map(r => ({
            title: r.title,
            snippet: (r.snippet || '').slice(0, 200),
            url: r.url,
            source: r.source,
          }));
          content = JSON.stringify(parsed);
        }
        // If it has a 'content' string (browse/read), prune it
        if (parsed.content && typeof parsed.content === 'string') {
          parsed.content = pruneContent(parsed.content, 1000);
          content = JSON.stringify(parsed);
        }
        // If it has a 'response' string (agent call), prune it
        if (parsed.response && typeof parsed.response === 'string') {
          parsed.response = pruneContent(parsed.response, 800);
          content = JSON.stringify(parsed);
        }
      } catch {
        // Not JSON — prune as plain text
        content = pruneContent(content);
      }
      return { ...m, content };
    }
    return m;
  });

  // Step 2: Check total size
  const totalChars = shrunk.reduce((a, m) => a + (m.content?.length || 0), 0);
  if (totalChars <= MAX_LOOP_MESSAGES_CHARS) return shrunk;

  // Step 3: Still too large — drop intermediate tool exchanges from the middle
  // Keep: system (index 0), first user message, last 6 messages
  const system = shrunk.filter(m => m.role === 'system');
  const nonSystem = shrunk.filter(m => m.role !== 'system');
  const firstUser = nonSystem.find(m => m.role === 'user');
  const lastSix = nonSystem.slice(-6);
  const lastSixIds = new Set(lastSix.map((_, i) => nonSystem.length - 6 + i));

  // Count what we dropped
  const middle = nonSystem.slice(1, -6);
  const droppedToolCount = middle.filter(m => m.role === 'tool').length;

  const kept = [
    ...system,
    ...(firstUser ? [firstUser] : []),
    // Placeholder so model knows context was trimmed
    ...(droppedToolCount > 0 ? [{
      role: 'tool',
      tool_call_id: 'context_trim',
      content: JSON.stringify({
        note: `[${droppedToolCount} intermediate tool results trimmed to reduce payload size. Key findings were already processed in earlier turns.]`,
      }),
    }] : []),
    ...lastSix,
  ];

  const keptChars = kept.reduce((a, m) => a + (m.content?.length || 0), 0);
  logger.debug('brain', `pruneLoopMessages: ${totalChars} → ${keptChars} chars (dropped ${droppedToolCount} tool results)`);

  return kept;
}

// ─── Retry wrapper ────────────────────────────────────────────────────────────

/**
 * Retry a fetch request on timeout/network errors.
 * copilot-api has a 10s upstream timeout — if we hit it, wait briefly and retry.
 */
async function fetchWithRetry(url, opts, maxRetries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fetch(url, opts);
    } catch (e) {
      lastError = e;
      const isTimeout = e.message?.includes('timeout') ||
                        e.message?.includes('fetch failed') ||
                        e.cause?.message?.includes('Connect Timeout') ||
                        e.cause?.message?.includes('fetch failed');

      if (!isTimeout || attempt === maxRetries) throw e;

      const delay = 1500 * (attempt + 1); // 1.5s, 3s
      logger.warn('brain', `Request timeout (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError;
}

// ─── Copilot availability check ───────────────────────────────────────────────

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
      logger.info('brain', `✅ copilot-api connected. Model: ${config.model}`);
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

// ─── Brain system prompt ───────────────────────────────────────────────────────

const BRAIN_SYSTEM = `You are Brain — the central AI orchestrator of Brain OS.

## CRITICAL: Task Completion Rules

**You MUST complete every task fully before sending a final response.**

1. **Do NOT announce what you're about to do** — just do it immediately.
   - ❌ WRONG: "Tôi sẽ tìm kiếm thông tin này, chờ một chút..."
   - ✅ RIGHT: [immediately call search_web, then deliver results]

2. **Multi-step tasks require multiple tool calls** — call ALL needed tools before writing your answer.
   - For research tasks: search → read → synthesize → respond in ONE message
   - Never stop after one tool call and wait for the user to ask again

3. **Never produce a partial response** — if a task requires 5 searches, do all 5, then respond once with the complete answer.

4. **Sequential research pattern**:
   - First call: broad search for overview
   - Follow-up calls: specific lookups per item (in parallel if possible)
   - Final message: complete synthesized answer

5. **When using run_pipeline or parallel tool calls**, wait for ALL results before writing your response.

## Core Responsibilities

- Answer conversational questions directly and concisely
- Use tools when real data or actions are needed — call them without announcing first
- Delegate specialized tasks to the right agent via call_agent
- NEVER fabricate information — use tools when you need real data
- Tools can be called in parallel for efficiency

## Response Guidelines

- Default language: Vietnamese (unless user writes in another language)
- Be direct — deliver results, not commentary about the process
- Use markdown for structured responses (tables, headers, bullet lists)
- When listing items (repos, articles, products): use a table or numbered list with consistent fields per item
- Always verify agent IDs with list_agents before calling call_agent

## Skill & Rule Standards

All auto-generated agent skills, rules, and instructions MUST be in English.

## Agent Creation Wizard

When user wants to create an agent, follow 6 steps:
1. Ask purpose
2. Propose name + description
3. Recommend provider/model (table format)
4. Draft system prompt
5. Suggest 3-5 skills (in English)
6. Confirm then call create_agent

## Tool Usage

- search_web + browse_web: for any current/external information
- call_agent: route specialized work
- run_pipeline: parallel research (use this for "top N" tasks — run N searches at once)
- save_lesson: record useful patterns
- Always prefer parallel calls over sequential when tasks are independent`;

// ─── Non-streaming call with tools ────────────────────────────────────────────

async function callWithTools(messages, model) {
  const useModel = model || config.model;

  // Prune messages before sending to avoid timeout
  const pruned = pruneLoopMessages(messages);

  const body = JSON.stringify({
    model: useModel,
    messages: pruned,
    tools: tools.TOOL_DEFINITIONS,
    tool_choice: 'auto',
    stream: false,
    max_tokens: BRAIN_CONSTANTS.STREAM_MAX_TOKENS,
  });

  logger.debug('brain', `callWithTools: payload ${body.length} chars, ${pruned.length} messages`);

  const res = await fetchWithRetry(COPILOT_CHAT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`copilot-api error: ${res.status} ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.choices[0];
}

// ─── Streaming response ────────────────────────────────────────────────────────

async function streamChat({ messages, model, onToken, onDone, onError }) {
  const useModel = model || config.model;

  // Prune before streaming too
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
      throw new Error(`copilot-api stream error: ${res.status} ${err.slice(0, 200)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      const lines = text.split('\n').filter(l => l.startsWith('data: ') && !l.includes('[DONE]'));
      for (const line of lines) {
        try {
          const chunk = JSON.parse(line.slice(6));
          const token = chunk.choices?.[0]?.delta?.content || '';
          if (token) { fullContent += token; onToken(token); }
        } catch { }
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
    if (!res.ok) throw new Error(`copilot-api: ${res.status}`);
    const data = await res.json();
    return data.choices[0]?.message?.content || '';
  } catch (e) {
    logger.error('brain', `Call error: ${e.message}`);
    return null;
  }
}

// ─── Main chat with tool loop ──────────────────────────────────────────────────

async function chat({ userInput, agentId = 'brain', onToken, onDone, onError, onToolCall }) {
  if (!config.available) {
    await checkOllama();
    if (!config.available) {
      onError(new Error(
        'copilot-api chưa chạy. Hãy chạy: npx copilot-api@latest start\n' +
        '(Lần đầu: npx copilot-api@latest auth để đăng nhập GitHub)'
      ));
      return;
    }
  }

  // Inject promoted lessons
  let selfLearn;
  try { selfLearn = require('./self-learn'); } catch { selfLearn = null; }
  const lessonsContext = selfLearn ? selfLearn.buildLessonsContext(userInput) : '';
  const fullSystemPrompt = BRAIN_SYSTEM + lessonsContext;

  const assembled = memory.assemblePrompt({
    currentInput: userInput,
    agentId,
    systemPrompt: fullSystemPrompt,
    tokenBudget: BRAIN_CONSTANTS.TOKEN_BUDGET,
  });

  const messages = [
    { role: 'system', content: assembled.systemPrompt },
    ...assembled.context,
    { role: 'user', content: userInput },
  ];

  logger.debug('brain', `Chat start. Context: ${assembled.stats.selectedMessages} msgs, ~${assembled.stats.estimatedTokens} tokens`);

  memory.store('user', userInput, agentId);

  let loopMessages = [...messages];
  let loopCount = 0;
  const MAX_LOOPS = BRAIN_CONSTANTS.TOOL_LOOP_LIMIT;

  while (loopCount < MAX_LOOPS) {
    loopCount++;
    logger.debug('brain', `Tool loop ${loopCount}/${MAX_LOOPS}`);

    let choice;
    try {
      // pruneLoopMessages is called inside callWithTools
      choice = await callWithTools(loopMessages, config.model);
    } catch (e) {
      logger.error('brain', `Tool loop error (attempt ${loopCount}): ${e.message}`);

      // On timeout after retries: try to deliver partial response
      if (e.message?.includes('timeout') || e.message?.includes('fetch failed') || e.cause?.message?.includes('timeout')) {
        const fallback = 'Xin lỗi, kết nối tới Copilot bị timeout. Có thể thử lại hoặc chia nhỏ task hơn.';
        onError(new Error(fallback));
      } else {
        onError(e);
      }
      return;
    }

    const msg = choice.message;
    const hasToolCalls = msg.tool_calls && msg.tool_calls.length > 0;

    // No tool calls → final answer
    if (!hasToolCalls) {
      if (msg.content) {
        const chars = msg.content.split('');
        for (const char of chars) onToken(char);
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

    // Has tool_calls (content is intermediate thought, not final answer)
    if (msg.content) {
      logger.debug('brain', `Intermediate thought + ${msg.tool_calls.length} tool calls`);
    }

    logger.debug('brain', `Executing: ${msg.tool_calls.map(t => t.function.name).join(', ')}`);

    if (onToolCall) {
      msg.tool_calls.forEach(tc => {
        onToolCall({ tool: tc.function.name, args: tc.function.arguments });
      });
    }

    loopMessages.push(msg);

    const toolResults = await tools.executeToolsParallel(
      msg.tool_calls.map(tc => ({
        id: tc.id,
        function: {
          name: tc.function.name,
          arguments: typeof tc.function.arguments === 'string'
            ? JSON.parse(tc.function.arguments || '{}')
            : tc.function.arguments,
        },
      }))
    );

    for (let i = 0; i < msg.tool_calls.length; i++) {
      loopMessages.push({
        role: 'tool',
        tool_call_id: msg.tool_calls[i].id,
        content: JSON.stringify(toolResults[i]),
      });
    }
  }

  // Max loops reached
  logger.warn('brain', `Tool loop limit (${MAX_LOOPS}) reached`);
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

// ─── Summarize history ─────────────────────────────────────────────────────────

async function summarizeHistory(agentId = 'brain') {
  const history = memory.getHistory(agentId, BRAIN_CONSTANTS.SUMMARY_HISTORY_LIMIT);
  if (history.length < BRAIN_CONSTANTS.SUMMARY_MIN_HISTORY) return 'Chưa đủ lịch sử để tóm tắt.';

  const text = history
    .slice(-BRAIN_CONSTANTS.SUMMARY_HISTORY_LIMIT)
    .map(m => `${m.role}: ${m.content}`)
    .join('\n');

  const result = await call([{
    role: 'user',
    content: `Summarize the following conversation concisely, preserving key information:\n\n${text}`,
  }]);

  if (result) memory.storeSummary(agentId, result, []);
  return result || 'Unable to summarize.';
}

module.exports = {
  checkOllama,
  setModel,
  getConfig,
  chat,
  call,
  streamChat,
  summarizeHistory,
  KNOWN_MODELS,
};