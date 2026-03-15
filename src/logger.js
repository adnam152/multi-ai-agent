const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '../data/logs.json');
const MAX_LOGS = 1000;

let logs = [];
let wsClients = new Set();

function loadLogs() {
  try {
    if (fs.existsSync(LOG_FILE)) {
      logs = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
    }
  } catch { logs = []; }
}

function saveLogs() {
  try {
    fs.writeFileSync(LOG_FILE, JSON.stringify(logs.slice(-MAX_LOGS), null, 2));
  } catch {}
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
  saveLogs();

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
  clearLogs: () => { logs = []; saveLogs(); },
  info:  (source, msg, data) => log('info',  source, msg, data),
  warn:  (source, msg, data) => log('warn',  source, msg, data),
  error: (source, msg, data) => log('error', source, msg, data),
  debug: (source, msg, data) => log('debug', source, msg, data),
};
