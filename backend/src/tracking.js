/**
 * tracking.js — Real-time task tracking store
 *
 * Now with DB persistence: tasks are saved to Supabase `tracking_tasks`
 * and loaded on startup so history survives server restarts.
 *
 * Ephemeral events (tool calls, HTTP requests) are stored in-memory and
 * in the `events` JSONB column of each task row.
 */

const { EventEmitter } = require('events');

const emitter   = new EventEmitter();
const tasks     = new Map();     // taskId → Task
const wsClients = new Set();

let   taskSeq = 0;
let   db      = null;  // set via init()

const DB_TASK_KEEP_DAYS = 7;   // auto-clean tasks older than 7 days

// ─── Init (load from DB) ──────────────────────────────────────────────────────

async function init() {
  try {
    db = require('./db');
    const cutoff = new Date(Date.now() - DB_TASK_KEEP_DAYS * 86400 * 1000).toISOString();
    const { data, error } = await db.from('tracking_tasks')
      .select('*')
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      if (error.message?.includes('does not exist')) {
        const logger = require('./logger');
        logger.info('tracking', 'tracking_tasks table not found — in-memory only');
        return;
      }
      throw error;
    }

    for (const row of (data || [])) {
      const t = {
        ...row.data,
        id:        row.id,
        startedAt: Number(row.data.startedAt || 0),
        endedAt:   row.data.endedAt ? Number(row.data.endedAt) : null,
        events:    Array.isArray(row.data.events) ? row.data.events : [],
        _aborted:  false,
      };
      tasks.set(t.id, t);
    }

    const logger = require('./logger');
    logger.info('tracking', `Loaded ${tasks.size} task(s) from DB`);
  } catch (e) {
    const logger = require('./logger');
    logger.warn('tracking', `DB load failed: ${e.message} — in-memory only`);
  }
}

async function persistTask(task) {
  if (!db) return;
  try {
    const { _aborted, ...data } = task;
    await db.from('tracking_tasks').upsert({ id: task.id, data, updated_at: new Date().toISOString() });
  } catch { /* non-fatal */ }
}

// ─── Task structure ───────────────────────────────────────────────────────────

function createTask({ agentId, agentName, sessionId, input, source }) {
  const id = `task_${Date.now().toString(36)}_${++taskSeq}`;
  const task = {
    id,
    agentId,
    agentName: agentName || agentId,
    sessionId: sessionId || agentId,
    input:     input?.slice(0, 200) || '',
    source:    source || 'chat',     // 'chat' | 'cron'
    status:    'running',
    startedAt: Date.now(),
    endedAt:   null,
    result:    null,
    events:    [],
    _aborted:  false,
  };
  tasks.set(id, task);
  broadcast({ type: 'tracking_task_start', task: sanitizeTask(task) });
  persistTask(task);
  return id;
}

function addEvent(taskId, event) {
  const task = tasks.get(taskId);
  if (!task) return;

  const sanitized = sanitizeEvent(event);
  task.events.push(sanitized);

  // Keep max 500 events per task
  if (task.events.length > 500) task.events.shift();

  broadcast({ type: 'tracking_event', taskId, event: sanitized });

  // Persist every 10 events (batch to avoid hammering DB)
  if (task.events.length % 10 === 0) persistTask(task);
}

function finishTask(taskId, status = 'done', result = null) {
  const task = tasks.get(taskId);
  if (!task) return;
  task.status  = status;
  task.endedAt = Date.now();
  if (result !== null) task.result = typeof result === 'string' ? result.slice(0, 8000) : result;
  broadcast({ type: 'tracking_task_done', taskId, status, result: task.result || null, duration: task.endedAt - task.startedAt });
  persistTask(task);

  // Keep finished tasks for 30 minutes in memory, then evict (DB keeps them longer)
  setTimeout(() => tasks.delete(taskId), 30 * 60 * 1000);
}

function stopTask(taskId) {
  const task = tasks.get(taskId);
  if (!task || task.status !== 'running') return false;
  task._aborted = true;
  task.status   = 'stopped';
  task.endedAt  = Date.now();
  broadcast({ type: 'tracking_task_done', taskId, status: 'stopped', duration: task.endedAt - task.startedAt });
  persistTask(task);
  return true;
}

function isAborted(taskId) {
  return tasks.get(taskId)?._aborted === true;
}

function getAll() {
  return [...tasks.values()].map(sanitizeTask);
}

function getTask(taskId) {
  const t = tasks.get(taskId);
  return t ? sanitizeTask(t) : null;
}

function clearFinished() {
  const toDelete = [];
  for (const [id, task] of tasks) {
    if (task.status !== 'running') toDelete.push(id);
  }
  toDelete.forEach(id => tasks.delete(id));
  if (db) {
    (async () => {
      try { await db.from('tracking_tasks').delete().in('id', toDelete); } catch {}
    })();
  }
  broadcast({ type: 'tracking_updated' });
}

// ─── Sanitize ─────────────────────────────────────────────────────────────────

const SENSITIVE_HEADER_KEYS = ['authorization', 'x-api-key', 'api-key', 'cookie', 'set-cookie'];

function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== 'object') return headers;
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE_HEADER_KEYS.includes(k.toLowerCase()) ? '***' : v;
  }
  return out;
}

function sanitizeEvent(event) {
  if (event.type === 'http_request') return { ...event, headers: sanitizeHeaders(event.headers) };
  return event;
}

function sanitizeTask(task) {
  const { _aborted, ...rest } = task;
  // Ensure timestamps are always numbers
  return {
    ...rest,
    startedAt: Number(rest.startedAt || 0),
    endedAt:   rest.endedAt ? Number(rest.endedAt) : null,
  };
}

// ─── WebSocket broadcast ──────────────────────────────────────────────────────

function broadcast(payload) {
  const str = JSON.stringify(payload);
  for (const ws of wsClients) {
    try { ws.send(str); } catch { wsClients.delete(ws); }
  }
}

module.exports = {
  init,
  createTask,
  addEvent,
  finishTask,
  stopTask,
  isAborted,
  getAll,
  getTask,
  clearFinished,
  registerClient: (ws) => wsClients.add(ws),
  removeClient:   (ws) => wsClients.delete(ws),
  emitter,
};