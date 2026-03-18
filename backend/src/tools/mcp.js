/**
 * tools/mcp.js — MCP tools for Brain
 *
 * Monday.com uses the official Hosted MCP server at https://mcp.monday.com/mcp
 * — treat it as any other standard MCP server, use mcp_call normally.
 * Auth: bearer (Authorization: Bearer <token>)
 */

async function list_mcp_servers() {
  const mcp = require('../mcp-manager');
  const all = mcp.getAll();

  // Auto-reconnect servers with 0 tools
  for (const s of all) {
    if (s.connected && s.toolCount === 0) {
      try { await mcp.connect(s.id); } catch { /* ignore */ }
    }
  }

  const refreshed = mcp.getAll();
  return {
    total: refreshed.length,
    connected: refreshed.filter(s => s.connected).length,
    servers: refreshed.map(s => ({
      id: s.id,
      name: s.name,
      type: s.type,
      connected: s.connected,
      enabled: s.enabled,
      toolCount: s.toolCount || 0,
      tools: s.tools || [],
    })),
    instruction: refreshed.some(s => s.tools?.length > 0)
      ? 'Use EXACT tool names listed above in mcp_call.'
      : 'No tools discovered yet. Use mcp_connect to connect a server.',
  };
}

async function create_mcp_server({
  name, url, authType = 'bearer', authToken = '',
  description = '', type = 'custom',
}) {
  const mcp = require('../mcp-manager');

  if (!name) return { error: 'name is required' };
  if (!url)  return { error: 'url is required' };

  const existing = mcp.getByName(name);
  if (existing) {
    return {
      ok: true,
      already_exists: true,
      id: existing.id,
      name: existing.name,
      connected: existing.connected,
      tools: existing.tools || [],
      message: `Server "${name}" already exists. Use mcp_connect to refresh its tool list.`,
    };
  }

  const server = mcp.create({ name, url, authType, authToken, description, type, enabled: true });
  return {
    ok: true,
    id: server.id,
    name: server.name,
    url: server.url,
    message: `Server "${server.name}" created. Call mcp_connect next to discover its tools.`,
  };
}

async function mcp_connect({ server_id, server_name }) {
  const mcp = require('../mcp-manager');

  const srv = server_id
    ? mcp.getById(server_id)
    : mcp.getByName(server_name || '');

  if (!srv) {
    return {
      error: `Server not found: "${server_id || server_name}". Use create_mcp_server to add it first.`,
    };
  }

  try {
    const result = await mcp.connect(srv.id);
    return {
      ok: true,
      server: srv.name,
      connected: result.connected,
      toolCount: result.toolCount,
      tools: result.tools,
      available_tools: result.tools?.length > 0
        ? `Available tools (use EXACTLY these names in mcp_call): ${result.tools.join(', ')}`
        : 'No tools returned — check token permissions or server URL',
    };
  } catch (e) {
    return { error: `Connect failed: ${e.message}` };
  }
}

async function mcp_call({ server, tool, args = {} }) {
  const mcp = require('../mcp-manager');

  const srv = mcp.getByName(server);
  if (srv && srv.tools?.length > 0 && !srv.tools.includes(tool)) {
    return {
      error: `Tool "${tool}" not found on "${server}".`,
      available_tools: srv.tools,
      hint: `Use one of: ${srv.tools.join(', ')}`,
    };
  }

  return mcp.callTool({ serverName: server, toolName: tool, args });
}


async function get_monday_token() {
  const mcp = require('../mcp-manager');
  const token = mcp.getMondayToken();
  if (!token) {
    return {
      error: 'No Monday.com token saved.',
      fix: 'Go to McpTab → find Monday.com entry → Edit → paste API token → Save.',
    };
  }
  return {
    token,
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
      'API-Version': '2023-10',
    },
  };
}

module.exports = { list_mcp_servers, create_mcp_server, mcp_connect, mcp_call, get_monday_token };