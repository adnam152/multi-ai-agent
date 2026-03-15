/**
 * agents.js — Manage specialized AI agents
 *
 * Each agent has:
 *   id, name, description, model, provider, systemPrompt
 *   apiKey?, apiKeyVar?, active
 *   skills[]        ← danh sách skill/instruction riêng của agent
 *   contextNotes    ← notes/context tích lũy qua các lần dùng
 *   autoUpdateContext ← tự động cập nhật contextNotes sau mỗi reply
 *
 * Providers: ollama | claude | gemini | openrouter | openai | copilot
 *
 * Copilot provider: gọi copilot-api local proxy tại http://localhost:4141
 *   Không cần API key — dùng chung auth của copilot-api
 */

const fs = require('fs');
const path = require('path');
const db = require('./db');
const logger = require('./logger');
const memory = require('./memory');
const { APP_CONSTANTS, AGENT_CONSTANTS } = require('./constants');

const AGENTS_FILE = path.join(__dirname, '../data/agents.json');

let agents = [];

// ─── Default built-in agents ──────────────────────────────────────────────────

const DEFAULT_AGENTS = [
  {
    id: 'dev-agent',
    name: 'Dev Agent',
    description: 'Specialized in coding, debugging, architecture, and technical tasks',
    provider: 'copilot',
    model: 'gpt-4.1',
    systemPrompt: 'You are an expert software engineer. Help with code, debugging, architecture decisions, and technical explanations. Be precise and provide working examples.',
    skills: [
      'Luôn cung cấp code examples đầy đủ, có thể chạy được',
      'Giải thích ngắn gọn trước khi code',
      'Ưu tiên Node.js/JavaScript trừ khi yêu cầu ngôn ngữ khác',
    ],
    contextNotes: '',
    autoUpdateContext: true,
    active: true,
    createdAt: Date.now(),
  },
  {
    id: 'search-agent',
    name: 'Search Agent',
    description: 'Specialized in web search, research, and finding current information',
    provider: 'gemini',
    model: 'gemini-2.0-flash',
    systemPrompt: 'You are a research assistant. Help find information, summarize topics, and provide well-sourced answers. Prioritize accuracy and recency.',
    skills: [],
    contextNotes: '',
    autoUpdateContext: false,
    apiKeyVar: 'GEMINI_API_KEY',
    active: true,
    createdAt: Date.now(),
  },
];

// ─── Persistence ──────────────────────────────────────────────────────────────

async function load() {
  if (db) {
    try {
      const { data, error } = await db.from('agents').select('*').order('created_at');
      if (!error && data) {
        agents = data.map(r => ({ ...r.data, id: r.id }));
        agents = agents.map(a => ({ skills: [], contextNotes: '', autoUpdateContext: false, ...a }));
        logger.info('system', `Agents loaded from Supabase: ${agents.length}`);
        return;
      }
    } catch (e) {
      console.warn('[agents] Supabase load failed, falling back to file:', e.message);
    }
  }
  // fallback to file
  try {
    if (fs.existsSync(AGENTS_FILE)) {
      agents = JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf8'));
      agents = agents.map(a => ({ skills: [], contextNotes: '', autoUpdateContext: false, ...a }));
    } else {
      agents = DEFAULT_AGENTS;
      saveToFile();
    }
  } catch {
    agents = DEFAULT_AGENTS;
  }
  logger.info('system', `Agents loaded: ${agents.length}`);
}

function saveToFile() {
  try { fs.writeFileSync(AGENTS_FILE, JSON.stringify(agents, null, 2)); } catch {}
}

function persistAgent(agent) {
  if (db) {
    db.from('agents').upsert({ id: agent.id, data: agent, updated_at: new Date().toISOString() })
      .then(({ error }) => { if (error) saveToFile(); });
  } else {
    saveToFile();
  }
}

function deleteAgent(id) {
  if (db) {
    (async () => {
      try {
        await db.from('agents').delete().eq('id', id);
      } catch {
        saveToFile();
      }
    })();
  } else {
    saveToFile();
  }
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

function getAll() { return agents; }
function getById(id) { return agents.find(a => a.id === id); }

function create(data) {
  const agent = {
    id: data.id || data.name.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now().toString(36),
    name: data.name,
    description: data.description || '',
    provider: data.provider || 'copilot',
    model: data.model || APP_CONSTANTS.DEFAULT_BRAIN_MODEL,
    systemPrompt: data.systemPrompt || 'You are a helpful assistant.',
    apiKey: data.apiKey || '',
    apiKeyVar: data.apiKeyVar || '',
    skills: Array.isArray(data.skills) ? data.skills : [],
    contextNotes: data.contextNotes || '',
    autoUpdateContext: data.autoUpdateContext !== undefined ? !!data.autoUpdateContext : false,
    active: true,
    createdAt: Date.now(),
  };
  agents.push(agent);
  persistAgent(agent);
  logger.info('system', `Agent created: ${agent.name} (${agent.provider}/${agent.model})`);
  return agent;
}

function update(id, data) {
  const idx = agents.findIndex(a => a.id === id);
  if (idx === -1) return null;
  agents[idx] = { ...agents[idx], ...data, id, updatedAt: Date.now() };
  persistAgent(agents[idx]);
  return agents[idx];
}

function remove(id) {
  const idx = agents.findIndex(a => a.id === id);
  if (idx === -1) return false;
  agents.splice(idx, 1);
  deleteAgent(id);
  return true;
}

// ─── Update context notes after agent response ────────────────────────────────

function updateContextNotes(agentId, summary) {
  const agent = getById(agentId);
  if (!agent || !agent.autoUpdateContext) return;

  const maxLen = AGENT_CONSTANTS.CONTEXT_NOTES_MAX_LENGTH;
  const existing = agent.contextNotes || '';
  const timestamp = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  const newNote = `[${timestamp}] ${summary.slice(0, AGENT_CONSTANTS.CONTEXT_NOTE_SUMMARY_LENGTH)}`;

  const updated = (existing + '\n' + newNote).trim();
  agent.contextNotes = updated.length > maxLen
    ? '...(trimmed)\n' + updated.slice(-maxLen)
    : updated;

  update(agentId, { contextNotes: agent.contextNotes });
}

// ─── Resolve API key ──────────────────────────────────────────────────────────

function resolveApiKey(agent, defaultEnvVar) {
  if (agent.apiKey && agent.apiKey.length > AGENT_CONSTANTS.API_KEY_MIN_LENGTH) return agent.apiKey;
  if (agent.apiKeyVar) {
    const val = process.env[agent.apiKeyVar];
    if (val) return val;
  }
  return process.env[defaultEnvVar] || null;
}

// ─── Provider: GitHub Copilot (via copilot-api local proxy) ──────────────────

async function callCopilot({ model, messages, onToken, onDone, onError }) {
  const COPILOT_BASE = process.env.COPILOT_API_URL || APP_CONSTANTS.DEFAULT_COPILOT_API_URL;
  const url = `${COPILOT_BASE}/v1/chat/completions`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || 'gpt-5-mini',
        messages,
        stream: true,
        max_tokens: AGENT_CONSTANTS.PROVIDER_MAX_TOKENS,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      onError(new Error(`copilot-api: ${res.status} ${err}`));
      return;
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
          const data = JSON.parse(line.slice(6));
          const token = data.choices?.[0]?.delta?.content || '';
          if (token) { fullContent += token; onToken(token); }
          if (data.choices?.[0]?.finish_reason === 'stop') onDone(fullContent);
        } catch { }
      }
    }

    if (fullContent) onDone(fullContent);
  } catch (e) {
    onError(e);
  }
}

// ─── Provider: Anthropic Claude ───────────────────────────────────────────────

async function callClaude({ model, messages, apiKey, onToken, onDone, onError }) {
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) { onError(new Error('ANTHROPIC_API_KEY not set')); return; }

  const systemMsg = messages.find(m => m.role === 'system');
  const chatMsgs = messages.filter(m => m.role !== 'system');

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'messages-2023-12-15',
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-4-5',
        max_tokens: AGENT_CONSTANTS.PROVIDER_MAX_TOKENS,
        system: systemMsg?.content || '',
        messages: chatMsgs,
        stream: true,
      }),
    });

    if (!res.ok) { onError(new Error(`Claude API: ${res.status}`)); return; }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      const lines = text.split('\n').filter(l => l.startsWith('data: '));

      for (const line of lines) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === 'content_block_delta') {
            const token = data.delta?.text || '';
            fullContent += token;
            onToken(token);
          }
          if (data.type === 'message_stop') onDone(fullContent);
        } catch { }
      }
    }
  } catch (e) { onError(e); }
}

// ─── Provider: Google Gemini ──────────────────────────────────────────────────

async function callGemini({ model, messages, apiKey, onToken, onDone, onError }) {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) { onError(new Error('GEMINI_API_KEY not set')); return; }

  const useModel = model || 'gemini-2.0-flash';
  const systemMsg = messages.find(m => m.role === 'system')?.content || '';
  const chatMsgs = messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${useModel}:streamGenerateContent?alt=sse&key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: systemMsg ? { parts: [{ text: systemMsg }] } : undefined,
          contents: chatMsgs,
          generationConfig: { maxOutputTokens: AGENT_CONSTANTS.PROVIDER_MAX_TOKENS },
        }),
      }
    );

    if (!res.ok) { onError(new Error(`Gemini API: ${res.status}`)); return; }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      const lines = text.split('\n').filter(l => l.startsWith('data: '));

      for (const line of lines) {
        try {
          const data = JSON.parse(line.slice(6));
          const token = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (token) { fullContent += token; onToken(token); }
          if (data.candidates?.[0]?.finishReason) onDone(fullContent);
        } catch { }
      }
    }
  } catch (e) { onError(e); }
}

// ─── Provider: OpenRouter ─────────────────────────────────────────────────────

const OR_FREE_MODELS = [
  'google/gemini-2.0-flash-exp:free', 'meta-llama/llama-3.1-8b-instruct:free',
  'mistralai/mistral-7b-instruct:free',
];

function selectAutoModel(messages) {
  const totalLen = messages.reduce((a, m) => a + (m.content?.length || 0), 0);
  if (totalLen > AGENT_CONSTANTS.OPENROUTER_AUTO_MODEL_THRESHOLD) return 'google/gemini-flash-1.5';
  return OR_FREE_MODELS[0];
}

async function callOpenRouter({ model, messages, apiKey, onToken, onDone, onError, onModelSelected }) {
  const key = resolveApiKey({ apiKey }, 'OPENROUTER_API_KEY');
  if (!key) { onError(new Error('OPENROUTER_API_KEY not set')); return; }

  const selectedModel = model === 'auto' ? selectAutoModel(messages) : model;
  if (onModelSelected) onModelSelected(selectedModel);

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
        'HTTP-Referer': process.env.OPENROUTER_REFERER || APP_CONSTANTS.DEFAULT_OPENROUTER_REFERER,
        'X-Title': 'Brain OS',
      },
      body: JSON.stringify({ model: selectedModel, messages, stream: true, max_tokens: AGENT_CONSTANTS.PROVIDER_MAX_TOKENS }),
    });

    if (!res.ok) { onError(new Error(`OpenRouter: ${res.status}`)); return; }

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
          const data = JSON.parse(line.slice(6));
          const token = data.choices?.[0]?.delta?.content || '';
          if (token) { fullContent += token; onToken(token); }
          if (data.choices?.[0]?.finish_reason) onDone(fullContent);
        } catch { }
      }
    }
  } catch (e) { onError(e); }
}

// ─── Provider: OpenAI ─────────────────────────────────────────────────────────

async function callOpenAI({ model, messages, apiKey, onToken, onDone, onError }) {
  const key = apiKey || process.env.OPENAI_API_KEY;
  if (!key) { onError(new Error('OPENAI_API_KEY not set')); return; }

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({ model: model || 'gpt-4o', messages, stream: true, max_tokens: AGENT_CONSTANTS.PROVIDER_MAX_TOKENS }),
    });

    if (!res.ok) { onError(new Error(`OpenAI: ${res.status}`)); return; }

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
          const data = JSON.parse(line.slice(6));
          const token = data.choices?.[0]?.delta?.content || '';
          if (token) { fullContent += token; onToken(token); }
          if (data.choices?.[0]?.finish_reason === 'stop') onDone(fullContent);
        } catch { }
      }
    }
  } catch (e) { onError(e); }
}

// ─── Run agent ────────────────────────────────────────────────────────────────

async function runAgent({ agentId, userInput, onToken, onDone, onError }) {
  const agent = getById(agentId);
  if (!agent) { onError(new Error(`Agent not found: ${agentId}`)); return; }

  // Build system prompt: base + skills + context notes
  let fullSystemPrompt = agent.systemPrompt || 'You are a helpful assistant.';

  if (agent.skills && agent.skills.length > 0) {
    fullSystemPrompt += '\n\n## Skills & Instructions\n' +
      agent.skills.map((s, i) => `${i + 1}. ${s}`).join('\n');
  }

  if (agent.contextNotes && agent.contextNotes.trim()) {
    fullSystemPrompt += '\n\n## Context Notes (accumulated knowledge)\n' + agent.contextNotes;
  }

  // Assemble context from memory (per-agent history)
  const assembled = memory.assemblePrompt({
    currentInput: userInput,
    agentId,
    systemPrompt: fullSystemPrompt,
    tokenBudget: AGENT_CONSTANTS.TOKEN_BUDGET,
  });

  const messages = [
    { role: 'system', content: assembled.systemPrompt },
    ...assembled.context,
    { role: 'user', content: userInput },
  ];

  logger.info(`agent:${agent.name}`, `Running. Context: ${assembled.stats.selectedMessages} msgs`);

  // Store user input in this agent's memory
  memory.store('user', userInput, agentId);

  const wrappedDone = (content) => {
    // Store response in agent's memory
    memory.store('assistant', content, agentId);

    // Auto-update context notes if enabled
    if (agent.autoUpdateContext && content.length > AGENT_CONSTANTS.AUTO_UPDATE_MIN_RESPONSE_LENGTH) {
      const summary = `Q: ${userInput.slice(0, AGENT_CONSTANTS.AUTO_UPDATE_QUESTION_PREVIEW_LENGTH)} → A: ${content.slice(0, AGENT_CONSTANTS.AUTO_UPDATE_ANSWER_PREVIEW_LENGTH)}`;
      updateContextNotes(agentId, summary);
    }

    onDone(content, assembled.stats);
  };

  // Dispatch to provider
  const defaultEnvVars = {
    claude: 'ANTHROPIC_API_KEY',
    gemini: 'GEMINI_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
    openai: 'OPENAI_API_KEY',
    copilot: null, // no key needed
  };

  const apiKey = defaultEnvVars[agent.provider] !== null
    ? resolveApiKey(agent, defaultEnvVars[agent.provider] || '')
    : null;

  const dispatch = {
    claude: callClaude,
    gemini: callGemini,
    openrouter: callOpenRouter,
    openai: callOpenAI,
    copilot: callCopilot,
    ollama: async (opts) => {
      // Fallback: use brain's copilot
      await callCopilot({ ...opts });
    },
  };

  const fn = dispatch[agent.provider];
  if (!fn) { onError(new Error(`Unknown provider: ${agent.provider}`)); return; }

  const onModelSelected = (m) => {
    logger.info(`agent:${agent.name}`, `Auto-selected model: ${m}`);
  };

  await fn({ model: agent.model, messages, apiKey, onToken, onDone: wrappedDone, onError, onModelSelected });
}

module.exports = {
  init: load,
  getAll,
  getById,
  create,
  update,
  remove,
  runAgent,
  updateContextNotes,
};