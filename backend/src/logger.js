const fs = require('fs');
const path = require('path');
const db = require('./db');

const LOG_FILE = path.join(__dirname, '../data/logs.json');
const MAX_LOGS = 1000;

let logs = [];
let wsClients = new Set();

async function loadLogs() {
  if (db) {
    try {
      const { data } = await db.from('logs').select('*').order('timestamp', { ascending: false }).limit(MAX_LOGS);
      if (data) { logs = data.reverse(); return; }
    } catch (e) {
      console.warn('[logger] Supabase load failed:', e.message);
    }
  }
  try {
    if (fs.existsSync(LOG_FILE)) logs = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
  } catch { logs = []; }
}

function saveLog(entry) {
  if (db) {
    db.from('logs').insert({ id: entry.id, timestamp: entry.timestamp, level: entry.level, source: entry.source, message: entry.message, data: entry.data || null })
      .catch(() => {}); // fire-and-forget
  } else {
    try { fs.writeFileSync(LOG_FILE, JSON.stringify(logs.slice(-MAX_LOGS), null, 2)); } catch {}
  }
}

function log(level, source, message, data = null) {
  const entry = {
    id: Date.now() + Math.random().toString(36).slice(2, 6),
    timestamp: new Date().toISOString(),
    level,    // info | warn | error | debug
    source,   // brain | agent:{name} | telegram | system
    message,
    data
  };

  logs.push(entry);
  if (logs.length > MAX_LOGS) logs.shift();
  saveLog(entry);

  // Broadcast to all connected WS clients
  const payload = JSON.stringify({ type: 'log', entry });
  for (const client of wsClients) {
    try { client.send(payload); } catch {}
  }

  // Console output with color
  const colors = { info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m', debug: '\x1b[90m' };
  const reset = '\x1b[0m';
  const c = colors[level] || '';
  console.log(`${c}[${level.toUpperCase()}] [${source}]${reset} ${message}`);

  return entry;
}

module.exports = {
  init: loadLogs,
  registerClient: (ws) => wsClients.add(ws),
  removeClient: (ws) => wsClients.delete(ws),
  getLogs: (limit = 200, levelFilter = null) => {
    let result = logs;
    if (levelFilter) result = result.filter(l => l.level === levelFilter);
    return result.slice(-limit);
  },
  clearLogs: () => {
    logs = [];
    if (db) {
      db.from('logs').delete().neq('id', '').catch(() => {});
    } else {
      try { fs.writeFileSync(LOG_FILE, '[]'); } catch {}
    }
  },
  info:  (source, msg, data) => log('info',  source, msg, data),
  warn:  (source, msg, data) => log('warn',  source, msg, data),
  error: (source, msg, data) => log('error', source, msg, data),
  debug: (source, msg, data) => log('debug', source, msg, data),
};
