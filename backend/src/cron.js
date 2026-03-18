/**
 * cron.js — Scheduled task manager (no external dependencies)
 *
 * Supports cron expressions: "minute hour dom month dow"
 * Examples:
 *   "0 9 * * *"      — daily at 09:00
 *   "0 /2 * * *"    — every 2 hours
 *   "/30 * * * *"   — every 30 minutes
 *   "0 8 * * 1"      — every Monday at 08:00
 *
 * Jobs can target: Brain or any Agent
 * Results can optionally be sent to Telegram
 *
 * WS events:
 *   cron_job_start  { jobId, jobName }
 *   cron_job_done   { jobId, jobName, result, duration }
 *   cron_job_error  { jobId, jobName, error }
 *   cron_updated
 */

const db       = require('./db');
const logger   = require('./logger');
const tracking = require('./tracking');

const wsClients = new Set();
const jobs      = new Map();   // jobId → Job
let   tickTimer = null;
let   brain     = null;        // set via init()
let   telegram  = null;        // set via init()
let   agentsMod = null;        // set via init()

// ─── Cron expression parser ───────────────────────────────────────────────────

/**
 * Returns true if `value` matches `field` cron token.
 * Supports: *, N, /N, N-M, N,M,P
 */
function matchField(field, value, min, max) {
  if (field === '*') return true;

  // */N — every N
  if (field.startsWith('*/')) {
    const step = parseInt(field.slice(2));
    return step > 0 && value % step === 0;
  }

  // N,M,P — list
  if (field.includes(',')) {
    return field.split(',').some(f => matchField(f.trim(), value, min, max));
  }

  // N-M — range
  if (field.includes('-')) {
    const [a, b] = field.split('-').map(Number);
    return value >= a && value <= b;
  }

  // Plain number
  return parseInt(field) === value;
}

function matchCron(expr, date) {
  const parts = (expr || '').trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const [minF, hourF, domF, monF, dowF] = parts;
  return (
    matchField(minF,  date.getMinutes(),    0, 59) &&
    matchField(hourF, date.getHours(),      0, 23) &&
    matchField(domF,  date.getDate(),       1, 31) &&
    matchField(monF,  date.getMonth() + 1,  1, 12) &&
    matchField(dowF,  date.getDay(),        0,  6)
  );
}

function nextRunDescription(expr) {
  try {
    const parts = (expr || '').trim().split(/\s+/);
    if (parts.length !== 5) return 'Invalid expression';
    const [minF, hourF, domF, , dowF] = parts;

    if (hourF !== '*' && minF !== '*' && !minF.startsWith('*/') && !hourF.startsWith('*/')) {
      const h = parseInt(hourF);
      const m = parseInt(minF);
      const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      const dayStr = dowF !== '*' && !dowF.includes('/') ? ` on ${days[parseInt(dowF)]}` : (domF !== '*' && !domF.includes('/') ? ` on day ${domF}` : ' daily');
      return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}${dayStr}`;
    }
    if (minF.startsWith('*/')) return `Every ${minF.slice(2)} minutes`;
    if (hourF.startsWith('*/')) return `Every ${hourF.slice(2)} hours`;
    return expr;
  } catch { return expr; }
}

// ─── Job execution ────────────────────────────────────────────────────────────

async function executeJob(job) {
  const startedAt = Date.now();
  logger.info('cron', `Running job: "${job.name}"`);
  broadcast({ type: 'cron_job_start', jobId: job.id, jobName: job.name });

  // Create a tracking task so it appears in the Tracking tab
  const agentName = job.agentId === 'brain' || !job.agentId
    ? 'Brain'
    : (agentsMod?.getAll()?.find(a => a.id === job.agentId)?.name || job.agentName || job.agentId)
  const taskId = tracking.createTask({
    agentId:   `cron_${job.id}`,
    agentName: `⏰ ${job.name}`,
    sessionId: `cron_${job.id}`,
    input:     `[Cron: ${job.scheduleDesc || job.schedule}] ${job.prompt}`,
    source:    'cron',
  })

  try {
    let result = '';

    if (job.agentId === 'brain' || !job.agentId) {
      // Use Brain directly
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout after 5 minutes')), 5 * 60 * 1000);
        brain.chat({
          userInput: job.prompt,
          agentId:   `cron_${job.id}`,
          taskId,
          onToken:   (t) => { result += t; },
          onDone:    (content) => { clearTimeout(timeout); result = content || result; resolve(); },
          onError:   (e) => { clearTimeout(timeout); reject(e); },
          onToolCall: () => {},
        });
      });
    } else {
      // Use a specific agent
      const agentList = agentsMod?.getAll() || [];
      const agent = agentList.find(a => a.id === job.agentId);
      if (!agent) throw new Error(`Agent "${job.agentId}" not found`);

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout after 5 minutes')), 5 * 60 * 1000);
        agentsMod.runAgent({
          agentId:   job.agentId,
          userInput: job.prompt,
          taskId,
          onToken:   (t) => { result += t; },
          onDone:    (content) => { clearTimeout(timeout); result = content || result; resolve(); },
          onError:   (e) => { clearTimeout(timeout); reject(e); },
        });
      });
    }

    const duration = Date.now() - startedAt;
    const truncated = result.slice(0, 2000);

    tracking.finishTask(taskId, 'done', truncated)

    // Update job record
    const j = jobs.get(job.id);
    if (j) {
      j.lastRun    = new Date().toISOString();
      j.lastResult = truncated;
      j.lastStatus = 'success';
      j.runCount   = (j.runCount || 0) + 1;
      persistJob(j);
    }

    broadcast({ type: 'cron_job_done', jobId: job.id, jobName: job.name, result: truncated, duration });
    logger.info('cron', `Job "${job.name}" done in ${(duration/1000).toFixed(1)}s`);

    // Always store result in brain's memory so user can ask "summarize last cron result"
    try {
      const memory = require('./memory');
      const agentId = `cron_${job.id}`;
      memory.store('user',      `[Cron job "${job.name}" triggered — schedule: ${job.schedule}]\n${job.prompt}`, agentId);
      memory.store('assistant', truncated, agentId);
      // Also store a brief note in brain's main context so it's searchable
      memory.store('system', `[Cron job "${job.name}" completed at ${new Date().toLocaleString('vi-VN')}. Result stored in agent context cron_${job.id}]`, 'brain');
    } catch (e) {
      logger.warn('cron', `Could not store result in memory: ${e.message}`);
    }

    // Send to Telegram if enabled
    if (job.sendToTelegram && telegram) {
      try {
        const msg = `⏰ **Cron: ${job.name}**\n\n${truncated.slice(0, 3800)}`;
        await telegram.sendToOwner(msg);
        // Store the telegram send as a message in brain memory so Brain knows what was sent
        try {
          const memory = require('./memory');
          memory.store('assistant', `[Đã gửi kết quả cron job "${job.name}" đến Telegram lúc ${new Date().toLocaleString('vi-VN')}]\n\nNội dung:\n${truncated.slice(0, 1000)}`, 'brain');
        } catch {}
      } catch (e) {
        logger.warn('cron', `Telegram send failed for job "${job.name}": ${e.message}`);
      }
    }

  } catch (e) {
    logger.error('cron', `Job "${job.name}" failed: ${e.message}`);

    tracking.finishTask(taskId, 'error')

    const j = jobs.get(job.id);
    if (j) {
      j.lastRun    = new Date().toISOString();
      j.lastResult = `Error: ${e.message}`;
      j.lastStatus = 'error';
      j.runCount   = (j.runCount || 0) + 1;
      persistJob(j);
    }

    broadcast({ type: 'cron_job_error', jobId: job.id, jobName: job.name, error: e.message });

    if (job.sendToTelegram && telegram) {
      try { await telegram.sendToOwner(`❌ Cron job "${job.name}" failed:\n${e.message}`); } catch {}
    }
  }
}

// ─── Tick (runs every minute) ─────────────────────────────────────────────────

function tick() {
  const now = new Date();
  // Zero out seconds for clean cron matching
  now.setSeconds(0, 0);

  for (const job of jobs.values()) {
    if (!job.enabled) continue;
    if (matchCron(job.schedule, now)) {
      // Fire and forget; avoid duplicate if already running
      if (!job._running) {
        job._running = true;
        executeJob(job).finally(() => { const j = jobs.get(job.id); if (j) j._running = false; });
      }
    }
  }
}

function startTick() {
  if (tickTimer) return;
  // Align to next minute boundary
  const ms = (60 - new Date().getSeconds()) * 1000 - new Date().getMilliseconds();
  setTimeout(() => {
    tick();
    tickTimer = setInterval(tick, 60 * 1000);
  }, ms);
  logger.info('cron', `Scheduler started — next tick in ${(ms/1000).toFixed(0)}s`);
}

// ─── Persistence ──────────────────────────────────────────────────────────────

async function loadJobs() {
  try {
    const { data, error } = await db.from('cron_jobs').select('*').order('created_at', { ascending: false });
    if (error) {
      if (error.message?.includes('does not exist')) { logger.info('cron', 'cron_jobs table not found — skipping'); return; }
      throw error;
    }
    for (const row of (data || [])) {
      const j = { ...row.data, id: row.id, _running: false };
      jobs.set(j.id, j);
    }
    logger.info('cron', `Loaded ${jobs.size} job(s)`);
  } catch (e) { logger.warn('cron', `Load failed: ${e.message}`); }
}

async function persistJob(job) {
  const { _running, ...data } = job;
  try { await db.from('cron_jobs').upsert({ id: job.id, data, updated_at: new Date().toISOString() }); }
  catch (e) { logger.warn('cron', `Persist failed: ${e.message}`); }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function broadcast(payload) {
  const str = JSON.stringify(payload);
  for (const ws of wsClients) { try { ws.send(str); } catch { wsClients.delete(ws); } }
}

function safeJob(j) {
  return {
    id:          j.id,
    name:        j.name || 'Untitled',
    description: j.description || '',
    schedule:    j.schedule || '0 9 * * *',
    scheduleDesc: nextRunDescription(j.schedule || '0 9 * * *'),
    prompt:      j.prompt || '',
    agentId:     j.agentId || 'brain',
    agentName:   j.agentName || 'Brain',
    sendToTelegram: j.sendToTelegram === true,
    enabled:     j.enabled !== false,
    lastRun:     j.lastRun  || null,
    lastResult:  j.lastResult || null,
    lastStatus:  j.lastStatus || null,
    runCount:    j.runCount  || 0,
    createdAt:   j.createdAt || Date.now(),
    isRunning:   j._running === true,
  };
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

function getAll()  { return [...jobs.values()].map(safeJob); }
function getById(id) { const j = jobs.get(id); return j ? safeJob(j) : null; }

function create(data) {
  const id = 'cron_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const job = {
    id,
    name:          data.name          || 'New Job',
    description:   data.description   || '',
    schedule:      data.schedule      || '0 9 * * *',
    prompt:        data.prompt        || '',
    agentId:       data.agentId       || 'brain',
    agentName:     data.agentName     || 'Brain',
    sendToTelegram: data.sendToTelegram === true,
    enabled:       data.enabled !== false,
    lastRun:       null,
    lastResult:    null,
    lastStatus:    null,
    runCount:      0,
    createdAt:     Date.now(),
    _running:      false,
  };
  jobs.set(id, job);
  persistJob(job);
  broadcast({ type: 'cron_updated' });
  return safeJob(job);
}

function update(id, data) {
  const job = jobs.get(id);
  if (!job) return null;
  const { _running, id: _id, ...rest } = data;
  Object.assign(job, rest, { updatedAt: Date.now() });
  persistJob(job);
  broadcast({ type: 'cron_updated' });
  return safeJob(job);
}

function remove(id) {
  if (!jobs.has(id)) return false;
  jobs.delete(id);
  (async () => { try { await db.from('cron_jobs').delete().eq('id', id); } catch {} })();
  broadcast({ type: 'cron_updated' });
  return true;
}

async function runNow(id) {
  const job = jobs.get(id);
  if (!job) return { error: 'Job not found' };
  if (job._running) return { error: 'Job is already running' };
  job._running = true;
  executeJob(job).finally(() => { const j = jobs.get(id); if (j) j._running = false; });
  return { ok: true, jobId: id };
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init(brainModule, telegramModule, agentsModule) {
  brain     = brainModule;
  telegram  = telegramModule;
  agentsMod = agentsModule;
  await loadJobs();
  startTick();
}

module.exports = {
  init, getAll, getById, create, update, remove, runNow,
  registerClient: (ws) => wsClients.add(ws),
  removeClient:   (ws) => wsClients.delete(ws),
};