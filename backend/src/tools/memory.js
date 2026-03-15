/**
 * memory.js — Conversation Memory & Prompt Assembler (v2)
 *
 * Improvements over v1:
 *   - Head/tail preservation: cắt ở giữa thay vì cắt ngẫu nhiên (OpenClaw 70/20 ratio)
 *   - Turn-based cutting: luôn cắt tại ranh giới user/assistant, không bao giờ cắt giữa cặp
 *   - Tool result pruning: tự động shrink tool outputs dài trong context
 *   - Context health: getContextHealth() báo % usage + cảnh báo
 *   - Auto-compact trigger: khi messages > AUTO_COMPACT_THRESHOLD, gợi ý compact
 *   - assemblePrompt() trả về stats đầy đủ hơn để hiển thị trên UI
 */

const db = require('./db');
const { MEMORY_CONSTANTS } = require('./constants');

let history = [];
let summaries = [];

// ─── Thresholds ───────────────────────────────────────────────────────────────

const AUTO_COMPACT_THRESHOLD = 80;   // gợi ý compact khi > 80 messages
const TOOL_RESULT_MAX_CHARS  = 2000; // prune tool results dài hơn ngưỡng này
const TOOL_RESULT_HEAD_CHARS = 800;  // giữ 800 chars đầu
const TOOL_RESULT_TAIL_CHARS = 400;  // giữ 400 chars cuối

// ─── Persistence ──────────────────────────────────────────────────────────────

async function load() {
  const [{ data: msgs, error: msgError }, { data: sums, error: sumError }] = await Promise.all([
    db.from('messages').select('*').order('timestamp', { ascending: true }).limit(MEMORY_CONSTANTS.MAX_HISTORY),
    db.from('summaries').select('*').order('timestamp', { ascending: true }),
  ]);

  if (msgError) throw new Error(`[memory] Failed to load messages: ${msgError.message}`);
  if (sumError) throw new Error(`[memory] Failed to load summaries: ${sumError.message}`);

  history = (msgs || []).map(r => ({
    id: r.id, role: r.role, content: r.content,
    agentId: r.agent_id, timestamp: r.timestamp, ...r.meta,
  }));
  summaries = (sums || []).map(r => ({
    id: r.id, agentId: r.agent_id, summary: r.summary,
    coveredIds: r.covered_ids, timestamp: r.timestamp,
  }));
}

// ─── Store a message ──────────────────────────────────────────────────────────

function store(role, content, agentId = 'brain', meta = {}) {
  const msg = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    role,
    content,
    agentId,
    timestamp: Date.now(),
    ...meta,
  };
  history.push(msg);
  if (history.length > MEMORY_CONSTANTS.MAX_HISTORY) history.shift();

  db.from('messages').insert({
    id: msg.id, role: msg.role, content: msg.content,
    agent_id: msg.agentId, timestamp: msg.timestamp, meta,
  }).then(({ error }) => {
    if (error) console.warn(`[memory] Failed to persist ${msg.id}: ${error.message}`);
  });
  return msg;
}

// ─── Tool result pruning ──────────────────────────────────────────────────────

/**
 * Shrink tool result messages that are too long.
 * Keeps head + tail, trims the middle (same strategy as OpenClaw).
 */
function pruneToolResult(content) {
  if (!content || content.length <= TOOL_RESULT_MAX_CHARS) return content;

  const head = content.slice(0, TOOL_RESULT_HEAD_CHARS);
  const tail = content.slice(-TOOL_RESULT_TAIL_CHARS);
  const trimmed = content.length - TOOL_RESULT_HEAD_CHARS - TOOL_RESULT_TAIL_CHARS;
  return `${head}\n\n... [${trimmed} chars trimmed] ...\n\n${tail}`;
}

// ─── Keyword extraction ───────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'the','a','an','is','are','was','were','be','been','have','has','had',
  'do','does','did','will','would','could','should','may','might','to',
  'of','in','for','on','with','at','by','from','and','but','or','i',
  'my','me','you','your','we','our','it','its','this','that','not','no',
  'what','how','why','when','where','who','can','need','want','please',
  'tôi','bạn','và','của','là','có','được','cho','trong','với','này','đây',
]);

function extractKeywords(text) {
  return text.toLowerCase()
    .split(/\W+/)
    .filter(w => w.length > MEMORY_CONSTANTS.KEYWORD_MIN_LENGTH && !STOP_WORDS.has(w));
}

// ─── Score a single message ───────────────────────────────────────────────────

function scoreMessage(msg, keywords, msgIndex, total) {
  const recencyScore = total > 1 ? msgIndex / (total - 1) : 1;

  let keywordScore = 0;
  if (keywords.length > 0) {
    const msgWords = new Set(extractKeywords(msg.content));
    const matches = keywords.filter(k => msgWords.has(k)).length;
    keywordScore = matches / keywords.length;
  }

  const roleBonus = msg.role === 'user' ? 0.1 : 0;
  return 0.5 * recencyScore + 0.4 * keywordScore + 0.1 * roleBonus;
}

// ─── Head/Tail content preservation ──────────────────────────────────────────

/**
 * When we must trim context, use head/tail preservation instead of pure
 * score-based selection:
 *   - Always keep the first N messages (session opener / bootstrap)
 *   - Always keep the last N messages (recent context)
 *   - Fill remaining budget with score-based selection from the middle
 *
 * This mirrors OpenClaw's 70/20 split principle adapted for chat.
 */
function selectMessagesWithHeadTail(scoredMessages, maxChars, systemLen, currentInputLen) {
  if (!scoredMessages.length) return [];

  const overhead = systemLen + currentInputLen + MEMORY_CONSTANTS.PROMPT_OVERHEAD_CHARS;
  let budgetLeft = maxChars - overhead;
  if (budgetLeft <= 0) return [];

  const msgCost = (m) => m.content.length + MEMORY_CONSTANTS.MESSAGE_OVERHEAD_CHARS;

  const HEAD_N = 2; // always keep first 2 messages (session context)
  const TAIL_N = MEMORY_CONSTANTS.ALWAYS_INCLUDE_LAST_N; // always keep last N

  // Separate head, tail, middle
  const head   = scoredMessages.slice(0, HEAD_N);
  const tail   = scoredMessages.slice(-TAIL_N);
  const tailIds = new Set(tail.map(m => m.id));
  const headIds = new Set(head.map(m => m.id));
  const middle  = scoredMessages.filter(m => !headIds.has(m.id) && !tailIds.has(m.id));

  const selected = new Map();

  // First: fit tail (always include — most recent = most important)
  for (const m of tail) {
    const cost = msgCost(m);
    if (budgetLeft >= cost) {
      selected.set(m.id, m);
      budgetLeft -= cost;
    }
  }

  // Second: fit head (session bootstrap — only if budget allows)
  for (const m of head) {
    if (selected.has(m.id)) continue;
    const cost = msgCost(m);
    if (budgetLeft >= cost) {
      selected.set(m.id, m);
      budgetLeft -= cost;
    }
  }

  // Third: fill remaining budget with best-scored middle messages
  const middleByScore = [...middle].sort((a, b) => b._score - a._score);
  for (const m of middleByScore) {
    if (selected.has(m.id)) continue;
    if (selected.size >= MEMORY_CONSTANTS.CONTEXT_MESSAGE_HARD_CAP) break;
    const cost = msgCost(m);
    if (budgetLeft >= cost) {
      selected.set(m.id, m);
      budgetLeft -= cost;
    }
  }

  // Re-sort by timestamp for coherent conversation flow
  return [...selected.values()].sort((a, b) => a.timestamp - b.timestamp);
}

// ─── Ensure turn completeness ─────────────────────────────────────────────────

/**
 * Never cut mid-exchange: if we have a user message, ensure the following
 * assistant message is included too (and vice versa).
 * Prevents the model from seeing a question without its answer.
 */
function ensureTurnCompleteness(selectedMessages, allMessages) {
  const selectedIds = new Set(selectedMessages.map(m => m.id));
  const toAdd = [];

  for (let i = 0; i < selectedMessages.length; i++) {
    const msg = selectedMessages[i];
    if (msg.role !== 'user') continue;

    // Find the next assistant message in allMessages
    const msgIdx = allMessages.findIndex(m => m.id === msg.id);
    const nextAssistant = allMessages.slice(msgIdx + 1).find(m => m.role === 'assistant' && m.agentId === msg.agentId);

    if (nextAssistant && !selectedIds.has(nextAssistant.id)) {
      toAdd.push(nextAssistant);
      selectedIds.add(nextAssistant.id);
    }
  }

  if (!toAdd.length) return selectedMessages;
  return [...selectedMessages, ...toAdd].sort((a, b) => a.timestamp - b.timestamp);
}

// ─── Main Prompt Assembler ────────────────────────────────────────────────────

function assemblePrompt({
  currentInput,
  agentId = 'brain',
  systemPrompt = '',
  tokenBudget = MEMORY_CONSTANTS.DEFAULT_TOKEN_BUDGET,
}) {
  const maxChars = tokenBudget * MEMORY_CONSTANTS.CHARS_PER_TOKEN;
  const keywords = extractKeywords(currentInput);

  // Filter by agentId
  const agentHistory = history.filter(m => m.agentId === agentId && m.role !== 'system');

  // Prune tool results in-memory (don't modify stored history)
  const prunedHistory = agentHistory.map(m => {
    if (m.role === 'tool' || (m.role === 'assistant' && m._toolResult)) {
      return { ...m, content: pruneToolResult(m.content) };
    }
    return m;
  });

  // Score all messages
  const scored = prunedHistory.map((msg, i) => ({
    ...msg,
    _score: scoreMessage(msg, keywords, i, prunedHistory.length),
  }));

  // Select with head/tail preservation
  const selected = selectMessagesWithHeadTail(
    scored, maxChars, systemPrompt.length, currentInput.length
  );

  // Ensure turn completeness (don't cut mid-exchange)
  const complete = ensureTurnCompleteness(selected, prunedHistory);

  // Build context for model
  const context = complete.map(m => ({
    role: m.role === 'tool' ? 'user' : m.role, // normalize tool role for providers
    content: m.content,
  }));

  // Calculate actual token estimate
  const usedChars = systemPrompt.length + currentInput.length +
    complete.reduce((a, m) => a + m.content.length + MEMORY_CONSTANTS.MESSAGE_OVERHEAD_CHARS, 0) +
    MEMORY_CONSTANTS.PROMPT_OVERHEAD_CHARS;
  const estimatedTokens = Math.round(usedChars / MEMORY_CONSTANTS.CHARS_PER_TOKEN);

  // Context health
  const utilizationPct = Math.round((estimatedTokens / tokenBudget) * 100);
  const shouldCompact = agentHistory.length > AUTO_COMPACT_THRESHOLD;
  const health = utilizationPct >= 90 ? 'critical'
    : utilizationPct >= 75 ? 'warning'
    : utilizationPct >= 50 ? 'ok'
    : 'good';

  return {
    systemPrompt,
    context,
    currentInput,
    stats: {
      totalMessages: agentHistory.length,
      selectedMessages: complete.length,
      droppedMessages: agentHistory.length - complete.length,
      estimatedTokens,
      tokenBudget,
      utilizationPct,
      health,               // 'good' | 'ok' | 'warning' | 'critical'
      shouldCompact,        // true when approaching limits
      keywords: keywords.slice(0, MEMORY_CONSTANTS.KEYWORD_STATS_LIMIT),
    },
  };
}

// ─── Context health (for UI) ──────────────────────────────────────────────────

function getContextHealth(agentId = 'brain', tokenBudget = MEMORY_CONSTANTS.DEFAULT_TOKEN_BUDGET) {
  const agentHistory = history.filter(m => m.agentId === agentId);
  const estimatedChars = agentHistory.reduce((a, m) => a + m.content.length, 0);
  const estimatedTokens = Math.round(estimatedChars / MEMORY_CONSTANTS.CHARS_PER_TOKEN);
  const utilizationPct = Math.round((estimatedTokens / tokenBudget) * 100);

  return {
    messageCount: agentHistory.length,
    estimatedTokens,
    utilizationPct: Math.min(utilizationPct, 100),
    health: utilizationPct >= 90 ? 'critical'
      : utilizationPct >= 75 ? 'warning'
      : utilizationPct >= 50 ? 'ok'
      : 'good',
    shouldCompact: agentHistory.length > AUTO_COMPACT_THRESHOLD,
    autoCompactThreshold: AUTO_COMPACT_THRESHOLD,
  };
}

// ─── Store a summary ──────────────────────────────────────────────────────────

function storeSummary(agentId, summaryText, coveredIds) {
  const entry = {
    id: Date.now().toString(36),
    agentId,
    summary: summaryText,
    coveredIds,
    timestamp: Date.now(),
  };
  summaries.push(entry);
  history = history.filter(m => !coveredIds.includes(m.id));

  Promise.all([
    db.from('summaries').insert({
      id: entry.id, agent_id: entry.agentId, summary: entry.summary,
      covered_ids: entry.coveredIds, timestamp: entry.timestamp,
    }),
    coveredIds.length ? db.from('messages').delete().in('id', coveredIds) : Promise.resolve(),
  ]).catch(err => console.warn(`[memory] Failed to persist summary: ${err.message}`));
}

// ─── Clear history ────────────────────────────────────────────────────────────

function clearHistory(agentId = null) {
  if (agentId) {
    const ids = history.filter(m => m.agentId === agentId).map(m => m.id);
    history = history.filter(m => m.agentId !== agentId);
    if (ids.length) {
      db.from('messages').delete().in('id', ids).catch(() => {});
    }
  } else {
    const ids = history.map(m => m.id);
    history = [];
    if (ids.length) {
      db.from('messages').delete().in('id', ids).catch(() => {});
    }
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  init: load,
  store,
  assemblePrompt,
  storeSummary,
  clearHistory,
  getContextHealth,
  getHistory: (agentId = null, limit = MEMORY_CONSTANTS.DEFAULT_HISTORY_LIMIT) => {
    const safeLimit = limit || MEMORY_CONSTANTS.DEFAULT_HISTORY_LIMIT;
    let h = agentId ? history.filter(m => m.agentId === agentId) : history;
    return h.slice(-safeLimit);
  },
  getSummaries: () => summaries,
};