#!/usr/bin/env node
/**
 * Brain OS — Main Server (v2)
 *
 * Changes:
 *   - Added /api/tracking endpoints
 *   - Added /api/group-chat endpoints
 *   - Logs: in-memory only (no DB persistence), kept for debugging
 *   - WS: tracking + group-chat events forwarded to clients
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const path = require('path');

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { APP_CONSTANTS, PATH_CONSTANTS, BRAIN_CONSTANTS } = require('./src/constants');
const db = require('./src/db');
const sessions = require('./src/sessions');

const logger = require('./src/logger');
const memory = require('./src/memory');
const brain = require('./src/brain');
const agents = require('./src/agents');
const telegram = require('./src/telegram');
const tracking = require('./src/tracking');
const groupChat = require('./src/group-chat');
const cron = require('./src/cron');

const args = process.argv.slice(2);
const getArg = (flag, def) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
};
const PORT = parseInt(getArg('--port', process.env.PORT || String(APP_CONSTANTS.DEFAULT_PORT)));
const MODEL = getArg('--model', process.env.BRAIN_MODEL || APP_CONSTANTS.DEFAULT_BRAIN_MODEL);

const app = express();
app.use(express.json({ limit: APP_CONSTANTS.JSON_BODY_LIMIT }));
app.use(express.static(PATH_CONSTANTS.FRONTEND_DIST_DIR));

let selfLearn;
try { selfLearn = require('./src/self-learn'); } catch { selfLearn = null; }

// ── Status ─────────────────────────────────────────────────────────────────────
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
    supabase: db.getStatus(),
    telegram: telegram.getStatus(),
    memorySize: memory.getHistory().length,
    agentCount: agents.getAll().length,
    uptime: Math.round(process.uptime()),
    searchBackend: process.env.BRAVE_API_KEY ? 'Brave Search' : 'DuckDuckGo',
    contextHealth: memory.getContextHealth('brain', BRAIN_CONSTANTS.TOKEN_BUDGET),
  });
});

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

// ── Agents ─────────────────────────────────────────────────────────────────────
app.get('/api/agents', (req, res) => {
  const brainConfig = brain.getConfig();
  const brainAgent = {
    id: 'brain', name: 'Brain',
    description: 'Central AI orchestrator. Manages tools, agents, and MCP servers.',
    provider: 'copilot', model: brainConfig.model,
    active: brainConfig.available,
    skills: [], contextNotes: '', autoUpdateContext: false,
    _isBrain: true, createdAt: 0,
  };
  res.json([brainAgent, ...agents.getAll()]);
});
app.put('/api/agents/brain', (req, res) => {
  const { model } = req.body;
  if (model) brain.setModel(model);
  const brainConfig = brain.getConfig();
  res.json({ id: 'brain', name: 'Brain', model: brainConfig.model, _isBrain: true, ok: true });
});
app.post('/api/agents', (req, res) => res.status(201).json(agents.create(req.body)));
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
app.get('/api/agents/:id/context', (req, res) => {
  const agent = agents.getById(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Not found' });
  res.json({ contextNotes: agent.contextNotes || '', autoUpdateContext: agent.autoUpdateContext || false });
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
  res.json({ ok: true });
});

// ── Skills ─────────────────────────────────────────────────────────────────────
const skillsModule = require('./src/tools/skills');
app.post('/api/skills/import', async (req, res) => {
  const { slug, url, content, target_agent_id } = req.body;
  if (!slug && !url && !content) return res.status(400).json({ error: 'Provide slug, url, or content' });
  try {
    let rawContent;
    if (content) rawContent = content;
    else if (url) rawContent = await skillsModule.fetchSkillFromUrl(url);
    else rawContent = await skillsModule.fetchSkillContent(slug);
    const skillData = skillsModule.parseSkillMd(rawContent, slug || '');
    if (target_agent_id) {
      const agent = agents.getById(target_agent_id);
      if (!agent) return res.status(404).json({ error: `Agent not found: ${target_agent_id}` });
      const newSkills = [...new Set([...(agent.skills || []), ...skillData.skills])];
      agents.update(target_agent_id, { skills: newSkills });
      return res.json({ ok: true, action: 'added_to_agent', agent_id: target_agent_id, agent_name: agent.name, skill_name: skillData.name, instructions_added: skillData.skills.length });
    }
    res.json({ ok: true, action: 'skill_parsed', ...skillData });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.get('/api/skills/search', async (req, res) => {
  const { q, limit = '10' } = req.query;
  if (!q) return res.status(400).json({ error: 'q is required' });
  try {
    const encoded = encodeURIComponent(q);
    const url = `https://api.github.com/search/code?q=${encoded}+repo:openclaw/skills+filename:SKILL.md&per_page=${Math.min(parseInt(limit), 20)}`;
    const res2 = await fetch(url, { headers: { 'User-Agent': 'Brain-OS/1.0', 'Accept': 'application/vnd.github.v3+json' }, signal: AbortSignal.timeout(8000) });
    if (res2.ok) {
      const data = await res2.json();
      const results = (data.items || []).map(item => {
        const parts = item.path.split('/');
        const author = parts[1] || ''; const slug = parts[2] || '';
        return { slug: `${author}/${slug}`, name: slug, author, pageUrl: `https://clawhub.ai/${author}/${slug}`, rawUrl: `https://raw.githubusercontent.com/openclaw/skills/main/${item.path}` };
      });
      return res.json({ results, total: data.total_count || results.length, source: 'GitHub Search' });
    }
  } catch { }
  res.json({ results: [], note: 'GitHub search unavailable. Import skills directly by slug.' });
});
app.get('/api/skills/preview', async (req, res) => {
  const { url, slug } = req.query;
  if (!url && !slug) return res.status(400).json({ error: 'url or slug required' });
  try {
    const rawContent = url ? await skillsModule.fetchSkillFromUrl(url) : await skillsModule.fetchSkillContent(slug);
    const parsed = skillsModule.parseSkillMd(rawContent, slug || '');
    res.json({ ok: true, ...parsed, raw: rawContent.slice(0, 3000) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── Memory ─────────────────────────────────────────────────────────────────────
app.get('/api/memory', (req, res) => {
  const { agentId, limit } = req.query;
  res.json(memory.getHistory(agentId || null, parseInt(limit) || APP_CONSTANTS.DEFAULT_MEMORY_API_LIMIT));
});
app.delete('/api/memory', (req, res) => {
  memory.clearHistory(req.query.agentId || null);
  res.json({ ok: true });
});
app.post('/api/memory/summarize', async (req, res) => {
  const summary = await brain.summarizeHistory(req.body.agentId || 'brain');
  res.json({ summary });
});
app.get('/api/context/health', (req, res) => {
  const { agentId = 'brain' } = req.query;
  res.json(memory.getContextHealth(agentId, BRAIN_CONSTANTS.TOKEN_BUDGET));
});

// ── Tools ──────────────────────────────────────────────────────────────────────
const brainTools = require('./src/tools');
app.get('/api/tools', (req, res) => {
  res.json({
    tools: brainTools.TOOL_DEFINITIONS.map(t => ({ name: t.function.name, description: t.function.description, parameters: t.function.parameters })),
    count: brainTools.TOOL_DEFINITIONS.length,
  });
});

// ── Self-learn ─────────────────────────────────────────────────────────────────
app.get('/api/lessons', (req, res) => {
  if (!selfLearn) return res.json({ lessons: [], count: 0, stats: {} });
  const { type, priority, status, limit = '50' } = req.query;
  let results = selfLearn.getLessons();
  if (type) results = results.filter(l => l.type === type);
  if (priority) results = results.filter(l => l.priority === priority);
  if (status) results = results.filter(l => l.status === status);
  results = results.sort((a, b) => b.recurrenceCount - a.recurrenceCount || b.lastSeen - a.lastSeen).slice(0, parseInt(limit));
  res.json({ lessons: results, count: results.length, stats: selfLearn.getStats ? selfLearn.getStats() : {} });
});
app.get('/api/lessons/stats', (req, res) => res.json(selfLearn?.getStats ? selfLearn.getStats() : {}));
app.patch('/api/lessons/:id', (req, res) => {
  if (!selfLearn) return res.status(503).json({ error: 'self-learn not available' });
  const { status = 'resolved' } = req.body;
  if (!['resolved', 'wont_fix'].includes(status)) return res.status(400).json({ error: 'status must be resolved or wont_fix' });
  const updated = selfLearn.resolvelesson(req.params.id, status);
  if (!updated) return res.status(404).json({ error: 'Lesson not found' });
  res.json({ ok: true, lesson: updated });
});
app.delete('/api/lessons', (req, res) => {
  if (selfLearn?.clearLessons) selfLearn.clearLessons();
  res.json({ ok: true });
});

// ── Logs (in-memory only — no DB) ─────────────────────────────────────────────
app.get('/api/logs', (req, res) => {
  res.json(logger.getLogs(parseInt(req.query.limit) || APP_CONSTANTS.DEFAULT_LOGS_API_LIMIT, req.query.level || null));
});
app.delete('/api/logs', (req, res) => { logger.clearLogs(); res.json({ ok: true }); });

// ── Tracking ──────────────────────────────────────────────────────────────────
app.get('/api/tracking/tasks', (req, res) => {
  res.json({ tasks: tracking.getAll() });
});
app.get('/api/tracking/tasks/:id', (req, res) => {
  const task = tracking.getTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});
app.post('/api/tracking/tasks/:id/stop', (req, res) => {
  const ok = tracking.stopTask(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Task not found' });
  res.json({ ok: true });
});
app.delete('/api/tracking/finished', (req, res) => {
  tracking.clearFinished();
  res.json({ ok: true });
});

// ── Group Chat ────────────────────────────────────────────────────────────────
app.get('/api/group-chat/sessions', (req, res) => {
  res.json({ sessions: groupChat.getAll() });
});
app.post('/api/group-chat/sessions', (req, res) => {
  const session = groupChat.create(req.body);
  res.status(201).json(session);
});
app.get('/api/group-chat/sessions/:id', (req, res) => {
  const session = groupChat.getById(req.params.id);
  if (!session) return res.status(404).json({ error: 'Not found' });
  // Support ?limit=N to paginate messages (returns last N messages)
  const limit = parseInt(req.query.limit) || 0;
  if (limit > 0 && Array.isArray(session.messages) && session.messages.length > limit) {
    return res.json({ ...session, messages: session.messages.slice(-limit) });
  }
  res.json(session);
});
app.put('/api/group-chat/sessions/:id', (req, res) => {
  const session = groupChat.update(req.params.id, req.body);
  if (!session) return res.status(404).json({ error: 'Not found' });
  res.json(session);
});
app.delete('/api/group-chat/sessions/:id', (req, res) => {
  const ok = groupChat.remove(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});
app.post('/api/group-chat/sessions/:id/start', (req, res) => {
  const result = groupChat.startDebate(req.params.id);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});
app.post('/api/group-chat/sessions/:id/stop', (req, res) => {
  const ok = groupChat.stopDebate(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});
app.delete('/api/group-chat/sessions/:id/messages', (req, res) => {
  const ok = groupChat.clearMessages(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// ── Cron Jobs ─────────────────────────────────────────────────────────────────
app.get('/api/cron/jobs', (req, res) => res.json({ jobs: cron.getAll() }));
app.post('/api/cron/jobs', (req, res) => res.status(201).json(cron.create(req.body)));
app.get('/api/cron/jobs/:id', (req, res) => {
  const job = cron.getById(req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  res.json(job);
});
app.put('/api/cron/jobs/:id', (req, res) => {
  const job = cron.update(req.params.id, req.body);
  if (!job) return res.status(404).json({ error: 'Not found' });
  res.json(job);
});
app.delete('/api/cron/jobs/:id', (req, res) => {
  const ok = cron.remove(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});
app.post('/api/cron/jobs/:id/run', async (req, res) => {
  const result = await cron.runNow(req.params.id);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// ── Telegram ───────────────────────────────────────────────────────────────────
app.get('/api/telegram', (req, res) => res.json(telegram.getStatus()));
app.get('/api/telegram/messages', (req, res) => res.json(telegram.getMessages()));
app.post('/api/telegram/connect', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token required' });
  try { const info = await telegram.connect(token); res.json({ ok: true, username: info.username }); }
  catch (e) { res.status(400).json({ error: e.message }); }
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
  try { res.json(await telegram.sendToOwner(message)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/telegram/disconnect', async (req, res) => {
  await telegram.disconnect();
  res.json({ ok: true });
});

// ── MCP ────────────────────────────────────────────────────────────────────────
const mcp = require('./src/mcp-manager');
app.get('/api/mcp/servers', (req, res) => res.json(mcp.getAll()));
app.post('/api/mcp/servers', (req, res) => { const server = mcp.create(req.body); res.status(201).json(server); });
app.put('/api/mcp/servers/:id', (req, res) => {
  const server = mcp.update(req.params.id, req.body);
  if (!server) return res.status(404).json({ error: 'Not found' });
  res.json(server);
});
app.delete('/api/mcp/servers/:id', (req, res) => {
  const ok = mcp.remove(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});
app.post('/api/mcp/servers/:id/connect', async (req, res) => {
  try { const result = await mcp.connect(req.params.id); res.json(result); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/mcp/servers/:id/disconnect', async (req, res) => {
  try { await mcp.disconnect(req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/mcp/servers/:id/tools', async (req, res) => {
  const server = mcp.getById(req.params.id);
  if (!server) return res.status(404).json({ error: 'Not found' });
  res.json({ tools: server.tools || [], toolCount: server.toolCount || 0 });
});

// ── Sessions ───────────────────────────────────────────────────────────────────
app.get('/api/sessions', (req, res) => res.json(sessions.getAll()));
app.post('/api/sessions', (req, res) => { const session = sessions.create({ name: req.body.name }); res.status(201).json(session); });
app.put('/api/sessions/:id', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const s = sessions.rename(req.params.id, name);
  if (!s) return res.status(404).json({ error: 'Not found' });
  res.json(s);
});
app.delete('/api/sessions/:id', (req, res) => {
  const { id } = req.params;
  const ok = sessions.remove(id);
  if (!ok) return res.status(id === 'brain' ? 403 : 404).json({ error: id === 'brain' ? 'Cannot delete default session' : 'Not found' });
  memory.clearHistory(id);
  res.json({ ok: true });
});
app.put('/api/sessions/:id/context', (req, res) => {
  const { systemContext } = req.body;
  if (systemContext === undefined) return res.status(400).json({ error: 'systemContext required' });
  const s = sessions.update(req.params.id, { systemContext });
  if (!s) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true, systemContext: s.systemContext });
});

// ─── WebSocket ─────────────────────────────────────────────────────────────────
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  logger.registerClient(ws);
  telegram.registerClient(ws);
  mcp.registerClient(ws);
  tracking.registerClient(ws);
  groupChat.registerClient(ws);
  cron.registerClient(ws);

  ws.send(JSON.stringify({ type: 'connected', message: 'Brain OS WebSocket ready' }));

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'chat') {
      const { content, agentId = 'brain', requestId } = msg;
      if (!content?.trim()) return;

      logger.info(agentId === 'brain' || agentId.startsWith('session-') ? 'brain' : `agent:${agentId}`, `→ ${content.slice(0, APP_CONSTANTS.LOG_PREVIEW_LENGTH)}`);

      // Create tracking task
      let taskId;
      if (agentId === 'brain' || agentId.startsWith('session-')) {
        taskId = tracking.createTask({
          agentId,
          agentName: 'Brain',
          sessionId: agentId,
          input: content,
        });
      } else {
        const agent = agents.getById(agentId);
        if (agent) {
          taskId = tracking.createTask({
            agentId,
            agentName: agent.name,
            sessionId: agentId,
            input: content,
          });
        }
      }

      const send = (payload) => ws.send(JSON.stringify({ ...payload, requestId }));
      const onToken = (token) => send({ type: 'chat_token', token });
      const onDone = (c, stats) => {
        send({ type: 'chat_done', stats });
        if (agentId.startsWith('session-')) sessions.touch(agentId);
        if (taskId) tracking.finishTask(taskId, 'done', c || null);
      };
      const onError = (err) => {
        send({ type: 'chat_error', error: err.message });
        if (taskId) tracking.finishTask(taskId, 'error');
      };
      const onToolCall = (info) => {
        send({ type: 'tool_call', ...info });
      };

      if (agentId === 'brain' || agentId.startsWith('session-')) {
        await brain.chat({ userInput: content, agentId, onToken, onDone, onError, onToolCall, taskId });
      } else {
        const agent = agents.getById(agentId);
        if (!agent) { onError(new Error(`Agent '${agentId}' not found`)); return; }
        await agents.runAgent({ agentId, userInput: content, onToken, onDone, onError });
      }
    }

    if (msg.type === 'clear_chat') {
      memory.clearHistory(msg.agentId || null);
      ws.send(JSON.stringify({ type: 'chat_cleared' }));
    }

    if (msg.type === 'load_history') {
      const history = memory.getHistory(msg.agentId || null, msg.limit || APP_CONSTANTS.DEFAULT_WS_HISTORY_LIMIT);
      ws.send(JSON.stringify({ type: 'history', messages: history }));
    }
  });

  ws.on('close', () => {
    logger.removeClient(ws);
    mcp.removeClient(ws);
    tracking.removeClient(ws);
    groupChat.removeClient(ws);
    cron.removeClient(ws);
  });
});

// ─── Start ─────────────────────────────────────────────────────────────────────
async function start() {
  try { await db.assertConnection(); }
  catch (err) { console.error('[startup] Supabase required.', err.message); process.exit(1); }

  await sessions.init();
  await logger.init();   // no-op now (in-memory), but keep for API consistency
  await memory.init();
  await agents.init();
  await telegram.init(brain);
  await mcp.init();
  await groupChat.init();
  await cron.init(brain, telegram, agents);
  brain.setModel(MODEL);
  await brain.loadBrainSkills();
  brain.checkOllama().catch(() => { });

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    const fs = require('fs');
    const indexPath = path.join(PATH_CONSTANTS.FRONTEND_DIST_DIR, 'index.html');
    if (!fs.existsSync(indexPath)) return res.status(404).send('Frontend not built. Run: npm run build:frontend');
    res.sendFile(indexPath);
  });

  server.listen(PORT, () => {
    logger.info('system', `Brain OS on http://localhost:${PORT}`);
    logger.info('system', `Model: ${MODEL} | Search: ${process.env.BRAVE_API_KEY ? 'Brave' : 'DuckDuckGo'}`);
  });
}

start().catch(err => { console.error('Fatal:', err); process.exit(1); });