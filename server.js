#!/usr/bin/env node
/**
 * Brain OS — Main Server
 * Run: node server.js [--port 3333] [--model qwen2.5:3b]
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

// ─── Ensure data directory ────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
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
const MODEL = getArg('--model', process.env.BRAIN_MODEL || 'openai/gpt-oss-20b');

// ─── Init ─────────────────────────────────────────────────────────────────────
logger.init();
memory.init();
agents.init();
telegram.init(brain);
brain.setModel(MODEL);

// ─── Express ──────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'src')));

// ── Status ──────────────────────────────────────────────────────────────────
app.get('/api/status', async (req, res) => {
  const brainConfig = brain.getConfig();
  res.json({
    brain: {
      available: brainConfig.available,
      model: brainConfig.model,
      models: brainConfig.models || [],
    },
    telegram: telegram.getStatus(),
    memorySize: memory.getHistory().length,
    agentCount: agents.getAll().length,
    uptime: Math.round(process.uptime()),
  });
});

// ── Agents ──────────────────────────────────────────────────────────────────
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

// ── Memory ───────────────────────────────────────────────────────────────────
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

// ── Tools ────────────────────────────────────────────────────────────────────
const brainTools = require('./src/tools');
app.get('/api/tools', (req, res) => {
  res.json({
    tools: brainTools.TOOL_DEFINITIONS.map(t => ({
      name: t.function.name,
      description: t.function.description,
    })),
    count: brainTools.TOOL_DEFINITIONS.length,
  });
});

// ── Self-learn ────────────────────────────────────────────────────────────────
const selfLearn = require('./src/self-learn');
app.get('/api/lessons', (req, res) => {
  res.json({ lessons: selfLearn.getLessons(), count: selfLearn.getLessonCount() });
});
app.delete('/api/lessons', (req, res) => {
  // Reset lessons
  const fs = require('fs'), path = require('path');
  const f = path.join(__dirname, 'data/lessons.json');
  try { fs.writeFileSync(f, '[]'); } catch { }
  res.json({ ok: true });
});

// ── Logs ─────────────────────────────────────────────────────────────────────
app.get('/api/logs', (req, res) => {
  res.json(logger.getLogs(parseInt(req.query.limit) || 200, req.query.level || null));
});

app.delete('/api/logs', (req, res) => {
  logger.clearLogs();
  res.json({ ok: true });
});

// ── Telegram ─────────────────────────────────────────────────────────────────
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

// ── Brain check ──────────────────────────────────────────────────────────────
app.post('/api/brain/check', async (req, res) => {
  const ok = await brain.checkOllama();
  res.json({ available: ok, ...brain.getConfig() });
});

// ─── HTTP + WebSocket Server ──────────────────────────────────────────────────
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  logger.registerClient(ws);
  telegram.registerClient(ws);

  // Send initial status
  ws.send(JSON.stringify({ type: 'connected', message: 'Brain OS WebSocket ready' }));

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'chat') {
      const { content, agentId = 'brain', requestId } = msg;
      if (!content?.trim()) return;

      logger.info(agentId === 'brain' ? 'brain' : `agent:${agentId}`, `User: ${content.slice(0, 80)}`);

      const sendToken = (token) => {
        if (ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ type: 'chat_token', token, requestId }));
      };

      const sendDone = (full, stats) => {
        if (ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ type: 'chat_done', content: full, stats, requestId }));
      };

      const sendError = (e) => {
        if (ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ type: 'chat_error', error: e.message, requestId }));
      };

      const sendToolCall = (toolName, toolArgs) => {
        if (ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ type: 'tool_call', tool: toolName, args: toolArgs, requestId }));
      };

      if (agentId === 'brain') {
        await brain.chat({ userInput: content, agentId: 'brain', onToken: sendToken, onDone: sendDone, onError: sendError, onToolCall: sendToolCall });
      } else {
        await agents.runAgent({ agentId, userInput: content, onToken: sendToken, onDone: sendDone, onError: sendError });
      }
    }

    if (msg.type === 'clear_chat') {
      memory.clearHistory(msg.agentId || null);
      ws.send(JSON.stringify({ type: 'chat_cleared' }));
    }

    if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
    }
  });

  ws.on('close', () => {
    logger.removeClient(ws);
    telegram.removeClient(ws);
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
server.listen(PORT, async () => {
  const c = {
    reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
    purple: '\x1b[35m', cyan: '\x1b[36m', green: '\x1b[32m',
    yellow: '\x1b[33m', red: '\x1b[31m', gray: '\x1b[90m',
  };

  console.log('');
  console.log(`${c.purple}${c.bold}  ╔══════════════════════════════════════════╗`);
  console.log(`  ║        🧠  BRAIN OS  v1.0.0              ║`);
  console.log(`  ║   Autonomous AI Orchestration System     ║`);
  console.log(`  ╚══════════════════════════════════════════╝${c.reset}`);
  console.log('');

  const groqOk = await brain.init();
  const agentList = agents.getAll();
  const tgStatus = telegram.getStatus();

  console.log(`  ${groqOk ? c.green + '✓' : c.red + '✗'} Brain:    Groq / ${MODEL}${groqOk ? '' : ' (check GROQ_API_KEY)'}${c.reset}`);
  console.log(`  ${c.green}✓${c.reset} Memory:   Context store initialized`);
  console.log(`  ${c.green}✓${c.reset} Agents:   ${agentList.length} agent(s) loaded`);
  console.log(`  ${c.green}✓${c.reset} Tools:    ${require('./src/tools').TOOL_DEFINITIONS.length} tools available`);
  console.log(`  ${c.green}✓${c.reset} Learn:    Self-learning active (${require('./src/self-learn').getLessonCount()} lessons)`);
  console.log(`  ${tgStatus.connected ? c.green + '✓' : c.yellow + '○'} Telegram: ${tgStatus.connected ? '@' + tgStatus.username : 'Not configured'}${c.reset}`);
  console.log('');
  console.log(`  ${c.bold}→ Web UI:   ${c.cyan}http://localhost:${PORT}${c.reset}`);
  console.log(`  ${c.dim}  Press Ctrl+C to stop${c.reset}`);
  console.log('');

  logger.info('system', `Server started on port ${PORT}`);
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────
process.on('SIGINT', () => {
  console.log('\n\n  👋  Shutting down Brain OS...\n');
  telegram.disconnect().finally(() => process.exit(0));
});