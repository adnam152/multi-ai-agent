/**
 * mcp-manager.js — MCP server registry + client
 *
 * Supports MCP Streamable HTTP transport (2025-03-26 spec).
 *
 * Monday.com uses the official Hosted MCP server at https://mcp.monday.com/mcp
 * — it is a standard MCP server, no special-casing needed.
 * Auth: Authorization: Bearer <token>  (standard bearer type)
 * Available tools: get_board_schema, get_board_items_by_name, create_item,
 *   delete_item, change_item_column_values, move_item_to_group, create_update,
 *   create_board, create_group, create_column, delete_column, list_users_and_teams
 *
 * Flow:
 *   1. create_mcp_server → register config
 *   2. mcp_connect → initialize + capture Mcp-Session-Id + discover tools
 *   3. mcp_call → invoke with EXACT tool name from step 2
 *   4. Session auto-reconnects on 400/session-expired errors
 */

const db = require('./db');
const logger = require('./logger');

let servers = [];
let wsClients = new Set();

// In-memory session store: serverId → sessionId
const sessionIds = new Map();

// ─── Persistence ──────────────────────────────────────────────────────────────

async function load() {
  try {
    const { data, error } = await db.from('mcp_servers').select('*').order('created_at', { ascending: false });
    if (error) {
      if (error.message?.includes('does not exist')) {
        logger.info('mcp', 'mcp_servers table not found — run migration');
        return;
      }
      throw error;
    }
    servers = (data || []).map(r => ({ ...r.data, id: r.id }));
    logger.info('mcp', `Loaded ${servers.length} MCP server(s)`);
  } catch (e) {
    logger.warn('mcp', `Failed to load: ${e.message}`);
  }
}

function persist(server) {
  (async () => {
    try {
      await db.from('mcp_servers').upsert({
        id: server.id, data: server, updated_at: new Date().toISOString(),
      });
    } catch (e) {
      logger.warn('mcp', `Persist failed: ${e.message}`);
    }
  })();
}

function broadcast(payload) {
  const str = JSON.stringify(payload);
  for (const ws of wsClients) { try { ws.send(str); } catch {} }
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

function getAll() { return servers; }
function getById(id) { return servers.find(s => s.id === id); }
function getByName(name) {
  const lower = (name || '').toLowerCase();
  return servers.find(s =>
    s.name.toLowerCase() === lower ||
    s.type.toLowerCase() === lower ||
    s.id === name
  );
}
function getMondayToken() {
  // Find Monday.com config by URL or type/name hint
  const s = servers.find(s =>
    s.url?.includes('monday.com') ||
    s.type === 'monday' ||
    s.name?.toLowerCase().includes('monday')
  );
  return s?.authToken || null;
}


function create(data) {
  const existing = getByName(data.name);
  if (existing) return existing;

  const server = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    name:        data.name,
    type:        data.type || 'custom',
    url:         data.url || '',
    authType:    data.authType || 'bearer',
    authToken:   data.authToken || '',
    description: data.description || '',
    enabled:     data.enabled !== false,
    connected:   false,
    tools:       [],
    toolCount:   0,
    createdAt:   Date.now(),
  };
  servers.unshift(server);
  persist(server);
  broadcast({ type: 'mcp_updated' });
  logger.info('mcp', `Created: "${server.name}" (${server.url})`);
  return server;
}

function update(id, data) {
  const idx = servers.findIndex(s => s.id === id);
  if (idx === -1) return null;
  servers[idx] = { ...servers[idx], ...data, id, updatedAt: Date.now() };
  persist(servers[idx]);
  return servers[idx];
}

function remove(id) {
  const idx = servers.findIndex(s => s.id === id);
  if (idx === -1) return false;
  servers.splice(idx, 1);
  sessionIds.delete(id);
  (async () => { try { await db.from('mcp_servers').delete().eq('id', id); } catch {} })();
  return true;
}

// ─── Headers ──────────────────────────────────────────────────────────────────

function buildHeaders(server, includeSession = true) {
  const h = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'User-Agent': 'Brain-OS/1.0',
  };

  const token = server.authToken;
  if (token) {
    switch (server.authType) {
      case 'bearer':
        h['Authorization'] = `Bearer ${token}`;
        break;
      case 'api_key':
        h['X-API-Key'] = token;
        break;
      case 'basic':
        h['Authorization'] = `Basic ${Buffer.from(token).toString('base64')}`;
        break;
    }
  }

  if (includeSession && sessionIds.has(server.id)) {
    h['Mcp-Session-Id'] = sessionIds.get(server.id);
  }

  return h;
}

// ─── JSON-RPC over HTTP ───────────────────────────────────────────────────────

let rpcId = 1;

async function rpcPost(server, method, params = {}, timeoutMs = 15000) {
  const id = rpcId++;
  const body = JSON.stringify({ jsonrpc: '2.0', method, params, id });

  const res = await fetch(server.url, {
    method: 'POST',
    headers: buildHeaders(server),
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });

  const sessionId = res.headers.get('mcp-session-id') || res.headers.get('Mcp-Session-Id');
  if (sessionId) {
    sessionIds.set(server.id, sessionId);
    logger.debug('mcp', `${server.name}: session captured`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('text/event-stream')) {
    return readSSE(res, id);
  }

  const data = await res.json();
  if (data.error) {
    throw new Error(data.error.message || JSON.stringify(data.error));
  }
  return data.result;
}

async function readSSE(res, targetId) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    const lines = buf.split('\n');
    buf = lines[lines.length - 1];

    for (const line of lines.slice(0, -1)) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (!raw || raw === '[DONE]') continue;
      try {
        const msg = JSON.parse(raw);
        if (msg.id === targetId) {
          if (msg.error) throw new Error(msg.error.message || JSON.stringify(msg.error));
          return msg.result;
        }
      } catch (e) {
        if (e.message && !e.message.startsWith('Unexpected')) throw e;
      }
    }
  }
  return null;
}

// ─── Connect ──────────────────────────────────────────────────────────────────

async function connect(id) {
  const server = getById(id);
  if (!server) throw new Error(`Server not found: ${id}`);

  sessionIds.delete(id);
  logger.info('mcp', `Connecting to "${server.name}"...`);

  try {
    await rpcPost(server, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      clientInfo: { name: 'brain-os', version: '1.0' },
    }, 10000);
    rpcPost(server, 'notifications/initialized', {}).catch(() => {});
    logger.debug('mcp', `${server.name}: initialize OK`);
  } catch (e) {
    logger.debug('mcp', `${server.name}: initialize: ${e.message.slice(0, 100)}`);
  }

  logger.debug('mcp', `${server.name}: session ${sessionIds.has(id) ? 'active ✓' : 'not required'}`);

  let tools = [];
  try {
    const result = await rpcPost(server, 'tools/list', {}, 10000);
    tools = (result?.tools || []).map(t => typeof t === 'string' ? t : (t.name || t));
    logger.info('mcp', `${server.name}: ${tools.length} tools — ${tools.slice(0, 8).join(', ')}`);
  } catch (e) {
    logger.warn('mcp', `${server.name}: tools/list — ${e.message.slice(0, 120)}`);
  }

  update(id, { connected: true, tools, toolCount: tools.length, lastConnected: Date.now() });
  broadcast({ type: 'mcp_updated' });

  return { connected: true, tools, toolCount: tools.length, sessionActive: sessionIds.has(id) };
}

async function disconnect(id) {
  const server = getById(id);
  if (!server) throw new Error(`Server not found: ${id}`);
  sessionIds.delete(id);
  update(id, { connected: false });
  broadcast({ type: 'mcp_updated' });
  logger.info('mcp', `Disconnected "${server.name}"`);
}

// ─── Call a tool ──────────────────────────────────────────────────────────────

async function callTool({ serverId, serverName, toolName, args = {} }) {
  const server = serverId ? getById(serverId) : getByName(serverName || '');

  if (!server) {
    return {
      error: `MCP server "${serverId || serverName}" not found.`,
      available: servers.map(s => `"${s.name}"`).join(', ') || 'none',
    };
  }

  if (!server.enabled) return { error: `Server "${server.name}" is disabled.` };

  if (!server.connected || !sessionIds.has(server.id)) {
    try {
      await connect(server.id);
    } catch (e) {
      return { error: `"${server.name}" connect failed: ${e.message}` };
    }
  }

  logger.debug('mcp', `${server.name}.${toolName}(${JSON.stringify(args).slice(0, 100)})`);

  try {
    const result = await rpcPost(server, 'tools/call', { name: toolName, arguments: args }, 20000);
    return { ok: true, server: server.name, tool: toolName, result };
  } catch (e) {
    if (e.message.includes('400') || e.message.toLowerCase().includes('session')) {
      logger.info('mcp', `${server.name}: session expired, reconnecting...`);
      try {
        await connect(server.id);
        const result = await rpcPost(server, 'tools/call', { name: toolName, arguments: args }, 20000);
        return { ok: true, server: server.name, tool: toolName, result };
      } catch (e2) {
        return { error: `${server.name}/${toolName} failed after reconnect: ${e2.message}` };
      }
    }
    return { error: `${server.name}/${toolName}: ${e.message}` };
  }
}

// ─── Summary for Brain context ─────────────────────────────────────────────────

function getMcpToolsSummary() {
  const connected = servers.filter(s => s.connected && s.enabled && s.tools?.length > 0);
  if (!connected.length) return '';
  const lines = connected.map(s =>
    `- ${s.name}: ${s.tools.slice(0, 8).join(', ')}${s.tools.length > 8 ? '...' : ''}`
  );
  return `\n\n## Connected MCP Servers\nUse mcp_call to invoke:\n${lines.join('\n')}`;
}

module.exports = {
  init: load,
  getAll, getById, getByName, getMondayToken,
  create, update, remove,
  connect, disconnect, callTool,
  getMcpToolsSummary,
  registerClient: (ws) => wsClients.add(ws),
  removeClient:   (ws) => wsClients.delete(ws),
};