/**
 * group-chat.js v3 — Multi-agent debate orchestration
 *
 * Architecture:
 *   - Strict round-based: ALL agents speak once → round ends → Brain summarizes
 *   - Brain compares new round summary vs previous round summary to detect convergence
 *   - No streaming tokens over WS (eliminates race condition / text bugs)
 *   - Settings per-session: autoSynthesize, roundDelayMs
 *
 * WS events emitted:
 *   gc_round_start      { sessionId, roundNumber }
 *   gc_thinking         { sessionId, agentId, agentName, avatar, color }
 *   gc_tool_call        { sessionId, agentId, agentName, tool, args }
 *   gc_tool_result      { sessionId, agentId, agentName, tool, result }
 *   gc_message          { sessionId, message }
 *   gc_round_end        { sessionId, roundNumber }
 *   gc_brain_working    { sessionId, phase: 'summarizing'|'comparing'|'synthesizing' }
 *   gc_round_summary    { sessionId, roundNumber, message }   (Brain's round summary)
 *   gc_consensus_result { sessionId, consensus, reason, score, roundNumber }
 *   gc_synthesis        { sessionId, message }                (Brain's final synthesis)
 *   gc_synthesis_failed { sessionId, reason }
 *   gc_started / gc_stopped / gc_done / gc_error / gc_cleared
 *   gc_updated
 */

const db = require('./db');
const logger = require('./logger');
const { APP_CONSTANTS } = require('./constants');
const orchestrator = require('./tools/orchestrator');

const wsClients = new Set();
const sessions = new Map();

const COPILOT_BASE = process.env.COPILOT_API_URL || APP_CONSTANTS.DEFAULT_COPILOT_API_URL;
const COPILOT_CHAT = `${COPILOT_BASE}/v1/chat/completions`;

const MAX_HISTORY_CONTEXT = 30;   // messages fed per agent turn
const MAX_TOOL_LOOPS = 8;    // tool calls per agent per turn
const DEFAULT_ROUND_DELAY = 500;  // ms between agents (if not set by session)

// ─── Tool definitions ─────────────────────────────────────────────────────────

const GC_TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'search_web',
      description: 'Search the web for facts or current information to support your argument.',
      parameters: { type: 'object', properties: { query: { type: 'string' }, max_results: { type: 'number' } }, required: ['query'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'http_request',
      description: 'Fetch content from a URL to read an article or data source.',
      parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    },
  },
];

// ─── Execute tool ─────────────────────────────────────────────────────────────

async function executeTool(name, args) {
  try {
    if (orchestrator.TOOL_NAMES.has(name)) {
      return orchestrator.execute(name, args);
    }

    if (name === 'search_web') {
      const { search_web } = require('./tools/network');
      return await search_web({ query: args.query, max_results: args.max_results || 5 });
    }
    if (name === 'http_request') {
      const { http_request } = require('./tools/network');
      return await http_request({ url: args.url, method: 'GET' });
    }
    return { error: `Tool "${name}" not available` };
  } catch (e) {
    return { error: `${name} failed: ${e.message}` };
  }
}

// ─── LLM helpers ─────────────────────────────────────────────────────────────

async function callLLM(provider, model, messages, apiKey, useTools = true) {
  const isOaiCompat = provider === 'copilot' || provider === 'openai' || provider === 'openrouter';

  if (isOaiCompat) {
    const url = provider === 'copilot' ? COPILOT_CHAT
      : provider === 'openai' ? 'https://api.openai.com/v1/chat/completions'
        : 'https://openrouter.ai/api/v1/chat/completions';

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const body = { model: model || 'gpt-5-mini', messages, stream: false, max_tokens: 2000 };
    if (useTools) { body.tools = GC_TOOL_DEFINITIONS; body.tool_choice = 'auto'; }

    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
    if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(`${provider} ${res.status}: ${t.slice(0, 80)}`); }
    const data = await res.json();
    const msg = data.choices?.[0]?.message;
    return { content: msg?.content || '', toolCalls: msg?.tool_calls || [], rawMessage: msg };
  }

  if (provider === 'claude') {
    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY not set');
    const system = messages.find(m => m.role === 'system')?.content || '';
    const chat = messages.filter(m => m.role !== 'system');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: model || 'claude-haiku-4-5', max_tokens: 2000, system, messages: chat }),
      signal: AbortSignal.timeout(90000),
    });
    if (!res.ok) throw new Error(`Claude ${res.status}`);
    const data = await res.json();
    return { content: data.content?.[0]?.text || '', toolCalls: [], rawMessage: null };
  }

  if (provider === 'gemini') {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY not set');
    const system = messages.find(m => m.role === 'system')?.content || '';
    const chat = messages.filter(m => m.role !== 'system')
      .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-2.0-flash'}:generateContent?key=${key}`,
      {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemInstruction: system ? { parts: [{ text: system }] } : undefined, contents: chat, generationConfig: { maxOutputTokens: 2000 } }),
        signal: AbortSignal.timeout(90000)
      }
    );
    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const data = await res.json();
    return { content: data.candidates?.[0]?.content?.parts?.[0]?.text || '', toolCalls: [], rawMessage: null };
  }

  throw new Error(`Unknown provider: ${provider}`);
}

// ─── Agent turn ───────────────────────────────────────────────────────────────

async function runAgentTurn(agent, session, sessionId) {
  const loopMsgs = buildAgentMessages(agent, session);
  // allowTools: default true; set false to disable web search/http for all agents
  const useTools = session.allowTools !== false;

  for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
    if (sessions.get(sessionId)?.status !== 'running') return null;

    let result;
    try {
      result = await callLLM(agent.provider, agent.model, loopMsgs, agent.apiKey, useTools);
    } catch (e) {
      logger.error('group-chat', `${agent.name} error loop ${loop}: ${e.message}`);
      if (e.message.includes('401') || e.message.includes('403')) return `[Auth error: ${e.message}]`;
      await sleep(2000);
      try { result = await callLLM(agent.provider, agent.model, loopMsgs, agent.apiKey, useTools); }
      catch (e2) { return `[Error: ${e2.message}]`; }
    }

    const { content, toolCalls, rawMessage } = result;
    // If tools disabled or no tool calls → final answer
    if (!useTools || !toolCalls || toolCalls.length === 0) return content.trim() || '(Không có phản hồi)';

    if (rawMessage) loopMsgs.push(rawMessage);

    // Broadcast tool calls
    for (const tc of toolCalls) {
      let args = {};
      try { args = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments || '{}') : (tc.function.arguments || {}); } catch { }
      broadcast({ type: 'gc_tool_call', sessionId, agentId: agent.id, agentName: agent.name, tool: tc.function.name, args });
    }

    // Execute tools in parallel
    const results = await Promise.all(toolCalls.map(async tc => {
      let args = {};
      try { args = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments || '{}') : (tc.function.arguments || {}); } catch { }
      const r = await executeTool(tc.function.name, args);
      return { id: tc.id, name: tc.function.name, result: r };
    }));

    for (const tr of results) {
      broadcast({ type: 'gc_tool_result', sessionId, agentId: agent.id, agentName: agent.name, tool: tr.name, result: tr.result });
      const str = JSON.stringify(tr.result);
      loopMsgs.push({ role: 'tool', tool_call_id: tr.id, content: str.length > 3000 ? str.slice(0, 2400) + '…[truncated]' : str });
    }
  }

  // Force plain response after max loops
  loopMsgs.push({ role: 'user', content: '[Tool limit reached. Give your final response now without calling any more tools.]' });
  try {
    const final = await callLLM(agent.provider, agent.model, loopMsgs, agent.apiKey, false);
    return final.content.trim() || '(Không có phản hồi)';
  } catch (e) { return `[Error: ${e.message}]`; }
}

// ─── Brain helpers (all non-streaming, use simple non-stream call) ────────────

async function brainCall(systemContent, userContent, maxTokens = 300) {
  const res = await fetch(COPILOT_CHAT, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-5-mini',
      messages: [{ role: 'system', content: systemContent }, { role: 'user', content: userContent }],
      stream: false, max_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Brain API ${res.status}`);
  const data = await res.json();
  return (data.choices?.[0]?.message?.content || '').trim();
}

/**
 * Summarize one round of messages into a concise summary.
 */
async function summarizeRound(roundMessages, topic, roundNumber, lang) {
  const text = roundMessages.map(m => `${m.agentName}: ${(m.content || '').slice(0, 500)}`).join('\n\n');
  const langNote = lang && lang !== 'English' ? ` Respond in ${lang}.` : '';
  return brainCall(
    `You are a debate moderator. Summarize the key points made in this round of debate concisely (5-8 bullet points max). Focus on distinct arguments, not repetition.${langNote}`,
    `Topic: "${topic}"\nRound ${roundNumber} messages:\n\n${text}\n\nSummarize the main points:`,
    600,
  );
}

/**
 * Compare this round's summary vs previous round's summary.
 * Returns { converging: boolean, reason: string, score: 0-10 }
 */
async function compareRounds(prevSummary, currSummary, topic, lang) {
  const langNote = lang && lang !== 'English' ? ` Write "reason" in ${lang}.` : '';
  try {
    const text = await brainCall(
      `You compare two consecutive debate round summaries to assess convergence.
Return ONLY valid JSON, no markdown: {"converging": boolean, "reason": "one sentence", "score": 0-10}
score: 0=still far apart, 10=fully agreed. converging=true when score>=7.${langNote}`,
      `Topic: "${topic}"\n\nPrev round summary:\n${prevSummary || '(first round — no previous)'}\n\nCurrent round summary:\n${currSummary}\n\nConverging?`,
      150,
    );
    const parsed = JSON.parse(text.replace(/```[a-z]*|```/g, '').trim());
    return {
      converging: parsed.converging === true || (parsed.score || 0) >= 7,
      reason: parsed.reason || '',
      score: parsed.score || 0,
    };
  } catch (e) {
    logger.warn('group-chat', `compareRounds failed: ${e.message}`);
    return { converging: false, reason: 'Comparison failed', score: 0 };
  }
}

/**
 * Synthesize the full debate into a final conclusion.
 */
async function synthesizeFinal(session, lang) {
  const allMsgs = (session.messages || []).filter(m => !m.isSummary && !m.isSynthesis);
  const summaries = (session.roundSummaries || []);

  // Use round summaries if available (more compact), fall back to last 20 messages
  let contextText;
  if (summaries.length > 0) {
    contextText = summaries.map((s, i) => `Round ${i + 1} summary:\n${s}`).join('\n\n---\n\n');
  } else {
    const msgs = allMsgs.slice(-20);
    contextText = msgs.map(m => `${m.agentName}: ${(m.content || '').slice(0, 500)}`).join('\n\n');
  }

  const agentList = (session.agents || []).map(a => `${a.name} (${a.role || 'Agent'})`).join(', ');
  const langNote = lang && lang !== 'English' ? `\n\nCRITICAL: Write the ENTIRE synthesis in ${lang}. Do NOT use English.` : '';

  const MAX_RETRIES = 2;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) { logger.info('group-chat', `Synthesis retry ${attempt}...`); await sleep(3000 * attempt); }
    try {
      return await brainCall(
        `You are Brain — debate moderator. Synthesize into a clear, actionable final conclusion.

Structure (markdown):
## Tổng quan / Overview
Each participant's key position.

## Điểm đồng thuận / Points of Consensus
What all/most agents agreed on — specific.

## Điểm khác biệt / Remaining Differences
Unresolved disagreements (if any).

## Kết luận & Khuyến nghị / Conclusion & Recommendation
Concrete, actionable recommendations based on the debate.${langNote}`,
        `Topic: "${session.topic}"\nParticipants: ${agentList}\n\n${contextText}\n\nSynthesize now:`,
        1400,
      );
    } catch (e) {
      logger.warn('group-chat', `Synthesis attempt ${attempt + 1} failed: ${e.message}`);
      if (attempt === MAX_RETRIES) return null;
    }
  }
  return null;
}

// ─── Language detection ───────────────────────────────────────────────────────

function detectLanguage(messages) {
  const sample = messages
    .filter(m => !m.isSummary && !m.isSynthesis && m.agentId !== 'brain')
    .slice(-6)
    .map(m => (m.content || '').slice(0, 200))
    .join(' ');
  if (!sample.trim()) return 'English';
  const viChars = (sample.match(/[àáâãèéêìíòóôõùúýăđơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/gi) || []).length;
  if (viChars / (sample.replace(/\s/g, '').length || 1) > 0.03) return 'Vietnamese (Tiếng Việt)';
  if ((sample.match(/[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]/g) || []).length > 10) return 'CJK';
  return 'English';
}

// ─── Main debate loop ─────────────────────────────────────────────────────────

async function runDebateLoop(sessionId) {
  const session = sessions.get(sessionId);
  if (!session || session.status !== 'running') return;
  logger.info('group-chat', `Debate started: "${session.name}" (${session.agents.length} agents)`);

  // Ensure round summaries array exists
  if (!Array.isArray(session.roundSummaries)) session.roundSummaries = [];

  let roundNumber = Math.floor((session.roundCount || 0) / session.agents.length) + 1;

  while (true) {
    const s = sessions.get(sessionId);
    if (!s || s.status !== 'running') break;

    const roundDelay = typeof s.roundDelayMs === 'number' ? s.roundDelayMs : DEFAULT_ROUND_DELAY;

    // ── Broadcast round start ─────────────────────────────────────────────────
    broadcast({ type: 'gc_round_start', sessionId, roundNumber });
    logger.info('group-chat', `Round ${roundNumber} starting...`);

    // ── All agents speak once ─────────────────────────────────────────────────
    const roundMessages = [];

    for (let i = 0; i < s.agents.length; i++) {
      // Re-check stop condition before each agent
      if (sessions.get(sessionId)?.status !== 'running') break;

      const agent = s.agents[i];
      if (!agent) continue;

      // Small pause before sending gc_thinking so previous gc_message has time to arrive at frontend
      await sleep(100);

      broadcast({ type: 'gc_thinking', sessionId, agentId: agent.id, agentName: agent.name, avatar: agent.avatar || '🤖', color: agent.color || '#4f72ff' });

      let response = '';
      try {
        response = await runAgentTurn(agent, s, sessionId) || '(Không có phản hồi)';
      } catch (e) {
        logger.error('group-chat', `Agent ${agent.name} failed: ${e.message}`);
        response = `[Lỗi: ${e.message}]`;
      }

      if (sessions.get(sessionId)?.status !== 'running') break;

      const msg = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 4),
        agentId: agent.id,
        agentName: agent.name,
        avatar: agent.avatar || '🤖',
        color: agent.color || '#4f72ff',
        content: response,
        ts: Date.now(),
        round: roundNumber,
      };

      s.messages.push(msg);
      roundMessages.push(msg);
      s.roundCount = (s.roundCount || 0) + 1;
      s.updatedAt = Date.now();

      // Guarantee gc_message is broadcast AFTER message is saved
      broadcast({ type: 'gc_message', sessionId, message: msg });

      // Delay between agents
      if (i < s.agents.length - 1 && roundDelay > 0) await sleep(roundDelay);
    }

    // Check if stopped during agent turns
    if (sessions.get(sessionId)?.status !== 'running') break;

    broadcast({ type: 'gc_round_end', sessionId, roundNumber });
    persistSession(s);

    // ── Brain work: only if autoSynthesize is enabled ─────────────────────────
    const autoSynthesize = s.autoSynthesize !== false; // default true

    if (autoSynthesize && roundMessages.length > 0) {
      // Small delay to ensure all gc_message events have been processed by frontend
      await sleep(500);

      if (sessions.get(sessionId)?.status !== 'running') break;

      const lang = detectLanguage(s.messages);

      // 1. Summarize this round
      broadcast({ type: 'gc_brain_working', sessionId, phase: 'summarizing' });
      logger.info('group-chat', `Summarizing round ${roundNumber}...`);

      let currSummary = '';
      try {
        currSummary = await summarizeRound(roundMessages, s.topic, roundNumber, lang);
      } catch (e) {
        logger.warn('group-chat', `Round summary failed: ${e.message}`);
        currSummary = roundMessages.map(m => `${m.agentName}: ${(m.content || '').slice(0, 200)}`).join('\n');
      }

      const prevSummary = s.roundSummaries[s.roundSummaries.length - 1] || '';
      s.roundSummaries.push(currSummary);

      // Broadcast round summary as a Brain message
      const summaryMsg = {
        id: 'round_summary_' + roundNumber + '_' + Date.now().toString(36),
        agentId: 'brain',
        agentName: 'Brain',
        avatar: '🧠',
        color: '#4f72ff',
        content: currSummary,
        isSummary: true,
        roundNumber,
        ts: Date.now(),
      };
      s.messages.push(summaryMsg);
      broadcast({ type: 'gc_round_summary', sessionId, roundNumber, message: summaryMsg });

      if (sessions.get(sessionId)?.status !== 'running') break;

      // 2. Compare with previous round OR synthesize directly on round 1
      const isFirstRound = s.roundSummaries.length === 1; // just pushed currSummary, so length=1 means first

      if (isFirstRound) {
        // Round 1: no previous summary to compare against — synthesize directly from agents
        logger.info('group-chat', `Round 1 complete — synthesizing directly (no previous round to compare)`);
        broadcast({ type: 'gc_consensus_result', sessionId, consensus: false, reason: 'Vòng đầu tiên — Brain tổng hợp sơ bộ các quan điểm ban đầu.', score: 0, roundNumber });

        // Don't end the debate on round 1 — just let it continue to round 2
        // (unless there are only enough agents for 1 round and all agree)
        // We skip synthesis on round 1; keep debating until round 2+ for real convergence check
      } else {
        // Round 2+: compare current vs previous
        broadcast({ type: 'gc_brain_working', sessionId, phase: 'comparing' });
        logger.info('group-chat', `Comparing round ${roundNumber} with previous...`);

        const { converging, reason, score } = await compareRounds(prevSummary, currSummary, s.topic, lang);

        broadcast({ type: 'gc_consensus_result', sessionId, consensus: converging, reason, score, roundNumber });
        logger.info('group-chat', `Convergence: ${converging ? 'YES' : 'NO'} (score=${score})`);

        if (converging) {
          // 3. Final synthesis
          broadcast({ type: 'gc_brain_working', sessionId, phase: 'synthesizing' });
          logger.info('group-chat', `Synthesizing final result for "${s.topic}"...`);

          const content = await synthesizeFinal(s, lang);

          if (content) {
            const synthMsg = {
              id: 'synthesis_' + Date.now().toString(36),
              agentId: 'brain',
              agentName: 'Brain',
              avatar: '🧠',
              color: '#4f72ff',
              content,
              isSynthesis: true,
              ts: Date.now(),
            };
            s.messages.push(synthMsg);
            broadcast({ type: 'gc_synthesis', sessionId, message: synthMsg });
          } else {
            broadcast({ type: 'gc_synthesis_failed', sessionId, reason: 'Synthesis could not be generated.' });
          }

          s.status = 'done';
          s._loop = null;
          persistSession(s);
          broadcast({ type: 'gc_done', sessionId });
          break;
        }
      }
    } // End of if (autoSynthesize && roundMessages.length > 0)

    roundNumber++;
    // Short pause before next round starts
    await sleep(300);
  }

  const sFinal = sessions.get(sessionId);
  if (sFinal && sFinal.status === 'running') {
    sFinal.status = 'stopped';
    sFinal._loop = null;
    persistSession(sFinal);
    broadcast({ type: 'gc_stopped', sessionId });
  }

  logger.info('group-chat', `Debate ended: ${sessionId}`);
}

// ─── Build agent messages ─────────────────────────────────────────────────────

function buildAgentMessages(agent, session) {
  // Give agents: last round summary (if any) + recent raw messages from current round
  const allMsgs = (session.messages || []).filter(m => !m.isSummary && !m.isSynthesis);
  const summaries = session.roundSummaries || [];
  const lastSummary = summaries[summaries.length - 1] || '';

  // Recent messages: only this round's messages (last N)
  const agentCount = (session.agents || []).length || 1;
  const currentRound = allMsgs.slice(-agentCount * 2); // last 2 rounds max
  const recentText = currentRound.length > 0
    ? currentRound.map(m => `**${m.agentName}**: ${m.content}`).join('\n\n')
    : '(No messages yet — you are the first to speak)';

  const contextSection = lastSummary
    ? `## Summary of previous rounds\n${lastSummary}\n\n## Current round messages\n${recentText}`
    : `## Debate so far\n${recentText}`;

  const systemPrompt = `${agent.systemPrompt}

## Debate Topic
${session.topic || '(No topic set)'}

## Your Identity
You are ${agent.name} — ${agent.role || 'a debate participant'}.

## Debate Rules
- Respond from your unique perspective and role
- RESPOND DIRECTLY to what others said in the current round
- If someone made a claim you disagree with, challenge it with evidence
- Use tools (search_web, http_request) to find facts BEFORE making claims
- If you partially agree, acknowledge it and add your nuance
- Be concise (2-4 paragraphs). Do NOT repeat previous turns
- Do NOT greet. Do NOT end with "Thank you"`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `${contextSection}\n\n---\n\nYour turn (${agent.name}). Respond:` },
  ];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, Math.max(0, ms))); }

function broadcast(payload) {
  const str = JSON.stringify(payload);
  for (const ws of wsClients) { try { ws.send(str); } catch { wsClients.delete(ws); } }
}

// ─── Persistence ──────────────────────────────────────────────────────────────

async function loadSessions() {
  try {
    const { data, error } = await db.from('group_chat_sessions').select('*').order('created_at', { ascending: false });
    if (error) {
      if (error.message?.includes('does not exist')) { logger.info('group-chat', 'Table not found — skipping'); return; }
      throw error;
    }
    for (const row of (data || [])) {
      const s = { ...row.data, id: row.id };
      s.status = s.status === 'running' ? 'stopped' : (s.status || 'idle');
      s._loop = null;
      s.agents = Array.isArray(s.agents) ? s.agents : [];
      s.messages = Array.isArray(s.messages) ? s.messages : [];
      s.roundSummaries = Array.isArray(s.roundSummaries) ? s.roundSummaries : [];
      sessions.set(s.id, s);
    }
    logger.info('group-chat', `Loaded ${sessions.size} group chat session(s)`);
  } catch (e) { logger.warn('group-chat', `Load failed: ${e.message}`); }
}

async function persistSession(session) {
  const { _loop, ...data } = session;
  try { await db.from('group_chat_sessions').upsert({ id: session.id, data, updated_at: new Date().toISOString() }); }
  catch (e) { logger.warn('group-chat', `Persist failed: ${e.message}`); }
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

function normalizeAgent(a) {
  return {
    id: a.id || 'gca_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 4),
    name: a.name || 'Agent',
    role: a.role || '',
    avatar: a.avatar || '🤖',
    systemPrompt: a.systemPrompt || `You are ${a.name || 'an AI assistant'}.`,
    provider: a.provider || 'copilot',
    model: a.model || 'gpt-5-mini',
    color: a.color || '#4f72ff',
  };
}

function safeSession(s) {
  return {
    id: s.id,
    name: s.name || 'Untitled',
    topic: s.topic || '',
    status: s.status || 'idle',
    agents: Array.isArray(s.agents) ? s.agents : [],
    messageCount: Array.isArray(s.messages) ? s.messages.length : 0,
    autoSynthesize: s.autoSynthesize !== false,
    allowTools: s.allowTools !== false,          // default true
    roundDelayMs: typeof s.roundDelayMs === 'number' ? s.roundDelayMs : DEFAULT_ROUND_DELAY,
    createdAt: s.createdAt || Date.now(),
    updatedAt: s.updatedAt || Date.now(),
  };
}

function getAll() { return [...sessions.values()].map(safeSession); }

function getById(id) {
  const s = sessions.get(id);
  if (!s) return null;
  return { ...safeSession(s), messages: Array.isArray(s.messages) ? s.messages : [] };
}

function create({ name, agents = [], topic = '', autoSynthesize = true, allowTools = true, roundDelayMs = DEFAULT_ROUND_DELAY }) {
  const id = 'gc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const session = {
    id,
    name: name || 'New Debate',
    topic: topic || '',
    agents: (Array.isArray(agents) ? agents : []).map(normalizeAgent),
    messages: [],
    roundSummaries: [],
    status: 'idle',
    currentAgentIndex: 0,
    roundCount: 0,
    autoSynthesize,
    allowTools,
    roundDelayMs: Number(roundDelayMs) || DEFAULT_ROUND_DELAY,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    _loop: null,
  };
  sessions.set(id, session);
  persistSession(session);
  broadcast({ type: 'gc_updated' });
  return { ...safeSession(session), messages: [] };
}

function update(id, data) {
  const session = sessions.get(id);
  if (!session) return null;
  const { _loop, messages, roundSummaries, ...rest } = data;
  if (Array.isArray(rest.agents)) rest.agents = rest.agents.map(normalizeAgent);
  if (typeof rest.roundDelayMs !== 'undefined') rest.roundDelayMs = Number(rest.roundDelayMs) || 0;
  Object.assign(session, rest, { updatedAt: Date.now() });
  persistSession(session);
  broadcast({ type: 'gc_updated' });
  return safeSession(session);
}

function remove(id) {
  const session = sessions.get(id);
  if (!session) return false;
  if (session.status === 'running') stopDebate(id);
  sessions.delete(id);
  (async () => { try { await db.from('group_chat_sessions').delete().eq('id', id); } catch { } })();
  broadcast({ type: 'gc_updated' });
  return true;
}

function startDebate(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return { error: 'Session not found' };
  if (session.agents.length < 2) return { error: 'Need at least 2 agents' };
  if (!session.topic?.trim()) return { error: 'Topic is required' };
  if (session.status === 'running') return { error: 'Already running' };

  session.status = 'running';
  session.updatedAt = Date.now();
  broadcast({ type: 'gc_started', sessionId });

  runDebateLoop(sessionId).catch(e => {
    logger.error('group-chat', `Loop crashed: ${e.message}`);
    const s = sessions.get(sessionId);
    if (s) { s.status = 'error'; s._loop = null; }
    broadcast({ type: 'gc_error', sessionId, error: e.message });
  });

  return { ok: true };
}

function stopDebate(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return false;
  session.status = 'stopped';
  session._loop = null;
  persistSession(session);
  broadcast({ type: 'gc_stopped', sessionId });
  return true;
}

function clearMessages(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return false;
  session.messages = [];
  session.roundSummaries = [];
  session.currentAgentIndex = 0;
  session.roundCount = 0;
  session.status = 'idle';
  persistSession(session);
  broadcast({ type: 'gc_cleared', sessionId });
  return true;
}

module.exports = {
  init: loadSessions,
  getAll, getById, create, update, remove,
  startDebate, stopDebate, clearMessages,
  registerClient: (ws) => wsClients.add(ws),
  removeClient: (ws) => wsClients.delete(ws),
};