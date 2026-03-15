/**
 * Agents — Manage specialized AI agents
 *
 * Each agent has:
 *   id, name, description, model, provider, systemPrompt, apiKey?, active
 *
 * Providers: ollama | claude | gemini | openrouter | openai
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const memory = require('./memory');

const AGENTS_FILE = path.join(__dirname, '../data/agents.json');

let agents = [];

// ─── Default built-in agents ──────────────────────────────────────────────────

const DEFAULT_AGENTS = [
  {
    id: 'dev-agent',
    name: 'Dev Agent',
    description: 'Specialized in coding, debugging, architecture, and technical tasks',
    provider: 'claude',
    model: 'claude-opus-4-5',
    systemPrompt: 'You are an expert software engineer. Help with code, debugging, architecture decisions, and technical explanations. Be precise and provide working examples.',
    apiKeyVar: 'ANTHROPIC_API_KEY',
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
    apiKeyVar: 'GEMINI_API_KEY',
    active: true,
    createdAt: Date.now(),
  }
];

// ─── Persistence ──────────────────────────────────────────────────────────────

function load() {
  try {
    if (fs.existsSync(AGENTS_FILE)) {
      agents = JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf8'));
    } else {
      agents = DEFAULT_AGENTS;
      save();
    }
  } catch {
    agents = DEFAULT_AGENTS;
  }
  logger.info('system', `Agents loaded: ${agents.length}`);
}

function save() {
  fs.writeFileSync(AGENTS_FILE, JSON.stringify(agents, null, 2));
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

function getAll() { return agents; }

function getById(id) { return agents.find(a => a.id === id); }

function create(data) {
  const agent = {
    id: data.id || data.name.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now().toString(36),
    name: data.name,
    description: data.description || '',
    provider: data.provider || 'claude',
    model: data.model || 'claude-opus-4-5',
    systemPrompt: data.systemPrompt || 'You are a helpful assistant.',
    apiKeyVar: data.apiKeyVar || '',
    active: true,
    createdAt: Date.now(),
  };
  agents.push(agent);
  save();
  logger.info('system', `Agent created: ${agent.name} (${agent.provider}/${agent.model})`);
  return agent;
}

function update(id, data) {
  const idx = agents.findIndex(a => a.id === id);
  if (idx === -1) return null;
  agents[idx] = { ...agents[idx], ...data, id, updatedAt: Date.now() };
  save();
  return agents[idx];
}

function remove(id) {
  const idx = agents.findIndex(a => a.id === id);
  if (idx === -1) return false;
  agents.splice(idx, 1);
  save();
  return true;
}

// ─── External API call dispatchers ────────────────────────────────────────────

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
        'anthropic-beta': 'messages-2023-12-15'
      },
      body: JSON.stringify({
        model: model || 'claude-opus-4-5',
        max_tokens: 2048,
        system: systemMsg?.content || '',
        messages: chatMsgs,
        stream: true,
      })
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
          if (data.type === 'message_stop') {
            onDone(fullContent);
          }
        } catch {}
      }
    }
  } catch (e) {
    onError(e);
  }
}

async function callGemini({ model, messages, apiKey, onToken, onDone, onError }) {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) { onError(new Error('GEMINI_API_KEY not set')); return; }

  const systemMsg = messages.find(m => m.role === 'system')?.content || '';
  const chatMsgs = messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-2.0-flash'}:streamGenerateContent?alt=sse&key=${key}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: systemMsg ? { parts: [{ text: systemMsg }] } : undefined,
        contents: chatMsgs,
        generationConfig: { maxOutputTokens: 2048 }
      })
    });

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
        } catch {}
      }
    }
  } catch (e) {
    onError(e);
  }
}

// ─── OpenRouter auto model selection ──────────────────────────────────────────
// Khi model = 'auto', chọn model dựa trên context của request

const OR_AUTO_MODELS = {
  // Tasks → model phù hợp (theo cost/performance)
  code:    'anthropic/claude-opus-4-5',        // code, debug
  long:    'google/gemini-2.0-flash-001',      // long context, documents
  fast:    'openai/gpt-4o-mini',               // short, general
  reason:  'deepseek/deepseek-r1',             // reasoning, math, logic
  vision:  'openai/gpt-4o',                   // images
  default: 'openai/gpt-4o-mini',              // fallback
};

const CODE_KEYWORDS = ['code','function','bug','error','debug','npm','node','python','script','api','implement','refactor','class','array','loop','async'];
const REASON_KEYWORDS = ['calculate','math','formula','logic','reason','step by step','prove','analyze','compare','explain why','tại sao','phân tích','tính toán'];
const LONG_KEYWORDS = ['summarize','summary','document','file','translate','dịch','tóm tắt','toàn bộ','entire'];

function selectAutoModel(messages) {
  // Gộp text của 3 message gần nhất để phân tích intent
  const recentText = messages
    .slice(-3)
    .map(m => (m.content || '').toLowerCase())
    .join(' ');

  if (CODE_KEYWORDS.some(k => recentText.includes(k))) return OR_AUTO_MODELS.code;
  if (REASON_KEYWORDS.some(k => recentText.includes(k))) return OR_AUTO_MODELS.reason;
  if (LONG_KEYWORDS.some(k => recentText.includes(k))) return OR_AUTO_MODELS.long;
  if (recentText.length > 2000) return OR_AUTO_MODELS.long;
  return OR_AUTO_MODELS.default;
}

async function callOpenRouter({ model, messages, apiKey, onToken, onDone, onError, onModelSelected }) {
  const key = apiKey || process.env.OPENROUTER_API_KEY;
  if (!key) { onError(new Error('OPENROUTER_API_KEY not set')); return; }

  // Auto model: chọn dựa trên context
  const selectedModel = (!model || model === 'auto') ? selectAutoModel(messages) : model;
  if (onModelSelected) onModelSelected(selectedModel);
  logger.debug('agents', `OpenRouter model: ${selectedModel}${model === 'auto' ? ' (auto-selected)' : ''}`);

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
        'HTTP-Referer': 'http://localhost:3333',
        'X-Title': 'Brain OS'
      },
      body: JSON.stringify({ model: selectedModel, messages, stream: true, max_tokens: 2048 })
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
        } catch {}
      }
    }
  } catch (e) {
    onError(e);
  }
}

// ─── Resolve API key: direct value first, then env var by name, then default env ─

function resolveApiKey(agent, defaultEnvVar) {
  // 1. Direct key stored in agent config (user typed it in UI)
  if (agent.apiKey && agent.apiKey.length > 8) return agent.apiKey;
  // 2. Env var name stored in apiKeyVar field
  if (agent.apiKeyVar) {
    const val = process.env[agent.apiKeyVar];
    if (val) return val;
  }
  // 3. Default env var for provider
  return process.env[defaultEnvVar] || null;
}

// ─── Dispatch to correct provider ─────────────────────────────────────────────

async function runAgent({ agentId, userInput, onToken, onDone, onError }) {
  const agent = getById(agentId);
  if (!agent) { onError(new Error(`Agent not found: ${agentId}`)); return; }

  const assembled = memory.assemblePrompt({
    currentInput: userInput,
    agentId,
    systemPrompt: agent.systemPrompt,
    tokenBudget: 2500,
  });

  const messages = [
    { role: 'system', content: assembled.systemPrompt },
    ...assembled.context,
    { role: 'user', content: userInput }
  ];

  logger.info(`agent:${agent.name}`, `Running. Context: ${assembled.stats.selectedMessages} msgs, ~${assembled.stats.estimatedTokens} tokens`);
  memory.store('user', userInput, agentId);

  const wrappedDone = (content) => {
    memory.store('assistant', content, agentId);
    onDone(content, assembled.stats);
  };

  // Resolve API key với fallback chain
  const defaultEnvVars = {
    claude: 'ANTHROPIC_API_KEY',
    gemini: 'GEMINI_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
    openai: 'OPENAI_API_KEY',
  };
  const apiKey = resolveApiKey(agent, defaultEnvVars[agent.provider] || '');

  const dispatch = { claude: callClaude, gemini: callGemini, openrouter: callOpenRouter };
  const fn = dispatch[agent.provider];
  if (!fn) { onError(new Error(`Unknown provider: ${agent.provider}`)); return; }

  const onModelSelected = (m) => {
    logger.info(`agent:${agent.name}`, `Auto-selected model: ${m}`);
  };

  await fn({ model: agent.model, messages, apiKey, onToken, onDone: wrappedDone, onError, onModelSelected });
}

module.exports = { init: load, getAll, getById, create, update, remove, runAgent };