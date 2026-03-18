/**
 * logger.js (v2) — In-memory only, no DB persistence
 *
 * Logs tab has been replaced by TrackingTab.
 * Logger is still used internally for console output and WS broadcasting,
 * but no longer writes to Supabase 'logs' table.
 */

const { APP_CONSTANTS, LOGGER_CONSTANTS } = require('./constants');

let logs = [];
let wsClients = new Set();

function log(level, source, message, data = null) {
  const entry = {
    id: Date.now() + Math.random().toString(36).slice(2, 2 + LOGGER_CONSTANTS.RANDOM_ID_SUFFIX_LENGTH),
    timestamp: new Date().toISOString(),
    level,
    source,
    message,
    data,
  };

  logs.push(entry);
  if (logs.length > LOGGER_CONSTANTS.MAX_LOGS) logs.shift();

  // Broadcast to all connected WS clients
  const payload = JSON.stringify({ type: 'log', entry });
  for (const client of wsClients) {
    try { client.send(payload); } catch { wsClients.delete(client); }
  }

  // Console output with color
  const colors = { info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m', debug: '\x1b[90m' };
  const reset = '\x1b[0m';
  const c = colors[level] || '';
  console.log(`${c}[${level.toUpperCase()}] [${source}]${reset} ${message}`);

  return entry;
}

// init is now a no-op (no DB load needed)
async function init() {
  // No-op: logs are ephemeral
}

module.exports = {
  init,
  registerClient: (ws) => wsClients.add(ws),
  removeClient: (ws) => wsClients.delete(ws),
  getLogs: (limit = APP_CONSTANTS.DEFAULT_LOGS_API_LIMIT, levelFilter = null) => {
    let result = logs;
    if (levelFilter) result = result.filter(l => l.level === levelFilter);
    return result.slice(-limit);
  },
  clearLogs: () => { logs = []; },
  info:  (source, msg, data) => log('info',  source, msg, data),
  warn:  (source, msg, data) => log('warn',  source, msg, data),
  error: (source, msg, data) => log('error', source, msg, data),
  debug: (source, msg, data) => log('debug', source, msg, data),
};