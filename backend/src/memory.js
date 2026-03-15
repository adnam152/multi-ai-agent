/**
 * Memory & Prompt Assembler
 *
 * Stores all conversation history locally.
 * When assembling a prompt, it SCORES each stored message by:
 *   - Recency  (50%): newer messages rank higher
 *   - Keyword overlap (40%): messages mentioning similar words to current input
 *   - Role bonus (10%): user messages slightly preferred
 *
 * Then picks top-N messages that fit within the TOKEN BUDGET (default 3000 tokens).
 * Messages are re-sorted by timestamp before being sent, so the LLM sees them in order.
 */

const db = require('./db');
const { MEMORY_CONSTANTS } = require('./constants');

let history = [];       // Full history array
let summaries = [];     // Periodic summaries to compress old context

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
    role,        // 'user' | 'assistant' | 'system'
    content,
    agentId,
    timestamp: Date.now(),
    ...meta
  };
  history.push(msg);
  if (history.length > MEMORY_CONSTANTS.MAX_HISTORY) history.shift();

  db.from('messages').insert({
    id: msg.id, role: msg.role, content: msg.content,
    agent_id: msg.agentId, timestamp: msg.timestamp, meta,
  }).then(({ error }) => {
    if (error) console.warn(`[memory] Failed to persist message ${msg.id}: ${error.message}`);
  });
  return msg;
}

// ─── Keyword extraction (removes stop words) ──────────────────────────────────

const STOP_WORDS = new Set([
  'the','a','an','is','are','was','were','be','been','have','has','had',
  'do','does','did','will','would','could','should','may','might','to',
  'of','in','for','on','with','at','by','from','and','but','or','i',
  'my','me','you','your','we','our','it','its','this','that','not','no',
  'what','how','why','when','where','who','can','need','want','please',
  'tôi','bạn','và','của','là','có','được','cho','trong','với','này','đây'
]);

function extractKeywords(text) {
  return text.toLowerCase()
    .split(/\W+/)
    .filter(w => w.length > MEMORY_CONSTANTS.KEYWORD_MIN_LENGTH && !STOP_WORDS.has(w));
}

// ─── Score a single message for relevance ─────────────────────────────────────

function scoreMessage(msg, keywords, msgIndex, total) {
  // Recency: 0..1 (most recent = 1)
  const recencyScore = total > 1 ? msgIndex / (total - 1) : 1;

  // Keyword overlap
  let keywordScore = 0;
  if (keywords.length > 0) {
    const msgWords = new Set(extractKeywords(msg.content));
    const matches = keywords.filter(k => msgWords.has(k)).length;
    keywordScore = matches / keywords.length;
  }

  // Role bonus
  const roleBonus = msg.role === 'user' ? 0.1 : 0;

  return 0.5 * recencyScore + 0.4 * keywordScore + 0.1 * roleBonus;
}

// ─── Prompt Assembler (core of the system) ────────────────────────────────────

function assemblePrompt({
  currentInput,
  agentId = 'brain',
  systemPrompt = '',
  tokenBudget = MEMORY_CONSTANTS.DEFAULT_TOKEN_BUDGET,
  alwaysIncludeLastN = MEMORY_CONSTANTS.ALWAYS_INCLUDE_LAST_N,
}) {
  const maxChars = tokenBudget * MEMORY_CONSTANTS.CHARS_PER_TOKEN;
  const keywords = extractKeywords(currentInput);

  // Filter by agentId (brain vs agent-specific history)
  const agentHistory = history.filter(m => m.agentId === agentId && m.role !== 'system');

  // Score messages
  const scored = agentHistory.map((msg, i) => ({
    ...msg,
    _score: scoreMessage(msg, keywords, i, agentHistory.length)
  }));

  // Always include last N messages (recency guarantee)
  const lastN = new Set(
    scored.slice(-alwaysIncludeLastN).map(m => m.id)
  );

  // Sort by score descending, pick within budget
  const byScore = [...scored].sort((a, b) => b._score - a._score);

  let selected = new Map();
  let usedChars = systemPrompt.length + currentInput.length + MEMORY_CONSTANTS.PROMPT_OVERHEAD_CHARS;

  for (const msg of byScore) {
    const cost = msg.content.length + MEMORY_CONSTANTS.MESSAGE_OVERHEAD_CHARS;
    if (usedChars + cost <= maxChars || lastN.has(msg.id)) {
      selected.set(msg.id, msg);
      usedChars += cost;
    }
    if (selected.size >= MEMORY_CONSTANTS.CONTEXT_MESSAGE_HARD_CAP) break;
  }

  // Re-sort selected by timestamp for coherent conversation flow
  const context = [...selected.values()].sort((a, b) => a.timestamp - b.timestamp);

  return {
    systemPrompt,
    context: context.map(m => ({ role: m.role, content: m.content })),
    currentInput,
    stats: {
      totalMessages: agentHistory.length,
      selectedMessages: context.length,
      estimatedTokens: Math.round(usedChars / MEMORY_CONSTANTS.CHARS_PER_TOKEN),
      keywords: keywords.slice(0, MEMORY_CONSTANTS.KEYWORD_STATS_LIMIT)
    }
  };
}

// ─── Store a summary of old messages ──────────────────────────────────────────

function storeSummary(agentId, summaryText, coveredIds) {
  const entry = { id: Date.now().toString(36), agentId, summary: summaryText, coveredIds, timestamp: Date.now() };
  summaries.push(entry);
  history = history.filter(m => !coveredIds.includes(m.id));

  Promise.all([
    db.from('summaries').insert({ id: entry.id, agent_id: entry.agentId, summary: entry.summary, covered_ids: entry.coveredIds, timestamp: entry.timestamp }),
    db.from('messages').delete().in('id', coveredIds),
  ]).catch((err) => {
    console.warn(`[memory] Failed to persist summary ${entry.id}: ${err.message}`);
  });
}

module.exports = {
  init: load,
  store,
  assemblePrompt,
  storeSummary,
  getHistory: (agentId = null, limit = MEMORY_CONSTANTS.DEFAULT_HISTORY_LIMIT) => {
    const safeLimit = limit || MEMORY_CONSTANTS.DEFAULT_HISTORY_LIMIT;
    let h = agentId ? history.filter(m => m.agentId === agentId) : history;
    return h.slice(-safeLimit);
  },
  clearHistory: (agentId = null) => {
    if (agentId) {
      const ids = history.filter(m => m.agentId === agentId).map(m => m.id);
      history = history.filter(m => m.agentId !== agentId);
      (async () => {
        try {
          await db.from('messages').delete().in('id', ids);
        } catch (err) {
          console.warn(`[memory] Failed to clear history for ${agentId}: ${err.message}`);
        }
      })();
    } else {
      const ids = history.map(m => m.id);
      history = [];
      (async () => {
        try {
          await db.from('messages').delete().in('id', ids);
        } catch (err) {
          console.warn(`[memory] Failed to clear global history: ${err.message}`);
        }
      })();
    }
  },
  getSummaries: () => summaries,
};
