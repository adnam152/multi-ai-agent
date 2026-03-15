#!/usr/bin/env node
/**
 * Brain OS — Main Server
 * Run: node server.js [--port 3333] [--model gpt-5-mini]
 *
 * Yêu cầu: copilot-api đang chạy tại http://localhost:4141
 *   npx copilot-api@latest start
 */

// Load .env from project root (one level above backend/)
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

// ─── Ensure data directory ────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ─── Modules ──────────────────────────────────────────────────────────────────
const logger = require('./src/logger');
const memory = require('./src/memory');
const brain = require('./src/brain');
const agents = require('./src/agents');
const telegram = require('./src/telegram');

// ─── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (flag, def) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
};
const PORT = parseInt(getArg('--port', process.env.PORT || '3333'));
const MODEL = getArg('--model', process.env.BRAIN_MODEL || 'gpt-5-mini');

// ─── Init (called at bottom in start()) ──────────────────────────────────────

// ─── Express ──────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../frontend/dist')));

// ── Self-learn (optional module) ──────────────────────────────────────────────
let selfLearn;
try { selfLearn = require('./src/self-learn'); } catch { selfLearn = null; }

// ── Status ────────────────────────────────────────────────────────────────────
app.get('/api/status', async (req, res) => {
  const brainConfig = brain.getConfig();
  res.json({
    brain: {
      available: brainConfig.available,
      model: brainConfig.model,
      models: brainConfig.models || brain.KNOWN_MODELS,
      provider: 'copilot',
      baseUrl: brainConfig.baseUrl,
    },
    telegram: telegram.getStatus(),
    memorySize: memory.getHistory().length,
    agentCount: agents.getAll().length,
    uptime: Math.round(process.uptime()),
  });
});

// ── Copilot check ─────────────────────────────────────────────────────────────
app.post('/api/brain/check', async (req, res) => {
  const ok = await brain.checkOllama();
  res.json({ available: ok, ...brain.getConfig() });
});

app.post('/api/brain/model', (req, res) => {
  const { model } = req.body;
  if (!model) return res.status(400).json({ error: 'model required' });
  brain.setModel(model);
  res.json({ ok: true, model });
});

// ── Agents ────────────────────────────────────────────────────────────────────
app.get('/api/agents', (req, res) => res.json(agents.getAll()));

app.post('/api/agents', (req, res) => {
  const agent = agents.create(req.body);
  res.status(201).json(agent);
});

app.put('/api/agents/:id', (req, res) => {
  const agent = agents.update(req.params.id, req.body);
  if (!agent) return res.status(404).json({ error: 'Not found' });
  res.json(agent);
});

app.delete('/api/agents/:id', (req, res) => {
  const ok = agents.remove(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// Agent skills management
app.get('/api/agents/:id/skills', (req, res) => {
  const agent = agents.getById(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Not found' });
  res.json({ skills: agent.skills || [] });
});

app.put('/api/agents/:id/skills', (req, res) => {
  const { skills } = req.body;
  if (!Array.isArray(skills)) return res.status(400).json({ error: 'skills must be array' });
  const agent = agents.update(req.params.id, { skills });
  if (!agent) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true, skills: agent.skills });
});

// Agent context notes management
app.get('/api/agents/:id/context', (req, res) => {
  const agent = agents.getById(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Not found' });
  res.json({
    contextNotes: agent.contextNotes || '',
    autoUpdateContext: agent.autoUpdateContext || false,
  });
});

app.put('/api/agents/:id/context', (req, res) => {
  const { contextNotes, autoUpdateContext } = req.body;
  const data = {};
  if (contextNotes !== undefined) data.contextNotes = contextNotes;
  if (autoUpdateContext !== undefined) data.autoUpdateContext = !!autoUpdateContext;
  const agent = agents.update(req.params.id, data);
  if (!agent) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true, contextNotes: agent.contextNotes, autoUpdateContext: agent.autoUpdateContext });
});

app.delete('/api/agents/:id/context', (req, res) => {
  const agent = agents.update(req.params.id, { contextNotes: '' });
  if (!agent) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true, message: 'Context notes cleared' });
});

// ── Memory ────────────────────────────────────────────────────────────────────
app.get('/api/memory', (req, res) => {
  const { agentId, limit } = req.query;
  res.json(memory.getHistory(agentId || null, parseInt(limit) || 100));
});

app.delete('/api/memory', (req, res) => {
  memory.clearHistory(req.query.agentId || null);
  res.json({ ok: true });
});

app.post('/api/memory/summarize', async (req, res) => {
  const summary = await brain.summarizeHistory(req.body.agentId || 'brain');
  res.json({ summary });
});

// ── Tools ─────────────────────────────────────────────────────────────────────
const brainTools = require('./src/tools');
app.get('/api/tools', (req, res) => {
  res.json({
    tools: brainTools.TOOL_DEFINITIONS.map(t => ({
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    })),
    count: brainTools.TOOL_DEFINITIONS.length,
  });
});

// ── Self-learn ────────────────────────────────────────────────────────────────
app.get('/api/lessons', (req, res) => {
  if (!selfLearn) return res.json({ lessons: [], count: 0 });
  res.json({ lessons: selfLearn.getLessons(), count: selfLearn.getLessonCount() });
});
app.delete('/api/lessons', (req, res) => {
  const f = path.join(DATA_DIR, 'lessons.json');
  try { fs.writeFileSync(f, '[]'); } catch { }
  res.json({ ok: true });
});

// ── Logs ──────────────────────────────────────────────────────────────────────
app.get('/api/logs', (req, res) => {
  res.json(logger.getLogs(parseInt(req.query.limit) || 200, req.query.level || null));
});
app.delete('/api/logs', (req, res) => {
  logger.clearLogs();
  res.json({ ok: true });
});

// ── Telegram ──────────────────────────────────────────────────────────────────
app.get('/api/telegram', (req, res) => res.json(telegram.getStatus()));
app.get('/api/telegram/messages', (req, res) => res.json(telegram.getMessages()));

app.post('/api/telegram/connect', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token required' });
  try {
    const info = await telegram.connect(token);
    res.json({ ok: true, username: info.username });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/telegram/owner', (req, res) => {
  const { chatId } = req.body;
  if (!chatId) return res.status(400).json({ error: 'chatId required' });
  telegram.setOwnerChatId(chatId);
  res.json({ ok: true, chatId: String(chatId) });
});

app.post('/api/telegram/send', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });
  try {
    const result = await telegram.sendToOwner(message);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/telegram/disconnect', async (req, res) => {
  await telegram.disconnect();
  res.json({ ok: true });
});

// ─── HTTP + WebSocket Server ──────────────────────────────────────────────────
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
wss.on('connection', (ws) => {
  logger.registerClient(ws);
  telegram.registerClient(ws);

  ws.send(JSON.stringify({ type: 'connected', message: 'Brain OS WebSocket ready' }));

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'chat') {
      const { content, agentId = 'brain', requestId } = msg;
      if (!content?.trim()) return;

      logger.info(agentId === 'brain' ? 'brain' : `agent:${agentId}`, `→ ${content.slice(0, 80)}`);

      const sendToken = (token) => {
        ws.send(JSON.stringify({ type: 'chat_token', token, requestId }));
      };
      const sendDone = (fullContent, stats) => {
        ws.send(JSON.stringify({ type: 'chat_done', requestId, stats }));
      };
      const sendError = (err) => {
        ws.send(JSON.stringify({ type: 'chat_error', error: err.message, requestId }));
      };
      const sendToolCall = (info) => {
        ws.send(JSON.stringify({ type: 'tool_call', ...info, requestId }));
      };

      if (agentId === 'brain') {
        await brain.chat({
          userInput: content,
          agentId: 'brain',
          onToken: sendToken,
          onDone: sendDone,
          onError: sendError,
          onToolCall: sendToolCall,
        });
      } else {
        const agent = agents.getById(agentId);
        if (!agent) {
          sendError(new Error(`Agent '${agentId}' not found`));
          return;
        }
        await agents.runAgent({
          agentId,
          userInput: content,
          onToken: sendToken,
          onDone: sendDone,
          onError: sendError,
        });
      }
    }

    if (msg.type === 'clear_chat') {
      memory.clearHistory(msg.agentId || null);
      ws.send(JSON.stringify({ type: 'chat_cleared' }));
    }

    if (msg.type === 'load_history') {
      const history = memory.getHistory(msg.agentId || null, msg.limit || 30);
      ws.send(JSON.stringify({ type: 'history', messages: history }));
    }
  });

  ws.on('close', () => {
    logger.removeClient(ws);
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
async function start() {
  await logger.init();
  await memory.init();
  await agents.init();
  await telegram.init(brain);
  brain.setModel(MODEL);
  brain.checkOllama().catch(() => {});

  server.listen(PORT, () => {
    logger.info('system', `Brain OS running on http://localhost:${PORT}`);
    logger.info('system', `Provider: GitHub Copilot via copilot-api (${brain.getConfig().baseUrl})`);
    logger.info('system', `Brain model: ${MODEL}`);
    logger.info('system', `Run 'npx copilot-api@latest start' if not already running`);
  });
}

start().catch(err => { console.error('Fatal startup error:', err); process.exit(1); });