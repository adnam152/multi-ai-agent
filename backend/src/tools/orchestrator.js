/**
 * tools/orchestrator.js — Brain OS Orchestrator Tools
 *
 * Implements tool executors for managing:
 *   - Agents (create, update, delete)
 *   - Cron Jobs (list, create, update, delete, run now)
 *   - Group Debates (list, create, start, stop, delete)
 *   - MCP Servers (create, connect, disconnect, delete)
 *
 * These are called from the main tools executor when Brain calls
 * any of the ORCHESTRATOR_TOOL_DEFINITIONS.
 *
 * INTEGRATION:
 *   In backend/src/tools/index.js (or tools.js), import this file
 *   and call executeOrchestratorTool(name, args) from your tool executor.
 *
 *   Example in tools/index.js:
 *
 *     const orchestrator = require('./orchestrator');
 *     // In executeToolsParallel or executeTool:
 *     if (orchestrator.TOOL_NAMES.has(name)) {
 *       return orchestrator.execute(name, args);
 *     }
 */

const logger = require('../logger');

// Set of all orchestrator tool names for fast lookup
const TOOL_NAMES = new Set([
  'create_agent', 'update_agent', 'delete_agent',
  'list_cron_jobs', 'create_cron_job', 'update_cron_job', 'delete_cron_job', 'run_cron_job',
  'list_debates', 'create_debate', 'start_debate', 'stop_debate', 'delete_debate',
  'create_mcp_server', 'connect_mcp_server', 'disconnect_mcp_server', 'delete_mcp_server',
]);

// ─── Execute ──────────────────────────────────────────────────────────────────

async function execute(name, args) {
  try {
    switch (name) {
      // ── Agents ──────────────────────────────────────────────────────────────
      case 'create_agent':   return await createAgent(args);
      case 'update_agent':   return await updateAgent(args);
      case 'delete_agent':   return await deleteAgent(args);

      // ── Cron Jobs ─────────────────────────────────────────────────────────
      case 'list_cron_jobs':   return await listCronJobs();
      case 'create_cron_job':  return await createCronJob(args);
      case 'update_cron_job':  return await updateCronJob(args);
      case 'delete_cron_job':  return await deleteCronJob(args);
      case 'run_cron_job':     return await runCronJob(args);

      // ── Group Debates ──────────────────────────────────────────────────────
      case 'list_debates':    return await listDebates();
      case 'create_debate':   return await createDebate(args);
      case 'start_debate':    return await startDebate(args);
      case 'stop_debate':     return await stopDebate(args);
      case 'delete_debate':   return await deleteDebate(args);

      // ── MCP Servers ────────────────────────────────────────────────────────
      case 'create_mcp_server':     return await createMcpServer(args);
      case 'connect_mcp_server':    return await connectMcpServer(args);
      case 'disconnect_mcp_server': return await disconnectMcpServer(args);
      case 'delete_mcp_server':     return await deleteMcpServer(args);

      default:
        return { error: `Unknown orchestrator tool: ${name}` };
    }
  } catch (e) {
    logger.error('orchestrator', `Tool ${name} failed: ${e.message}`);
    return { error: e.message };
  }
}

// ─── Agents ───────────────────────────────────────────────────────────────────

async function createAgent({ name, description, provider, model, systemPrompt, skills }) {
  const agents = require('../agents');
  const agent = agents.create({
    name,
    description:  description || '',
    provider:     provider    || 'copilot',
    model:        model       || 'gpt-5-mini',
    systemPrompt: systemPrompt || `You are ${name}, a specialist AI assistant.`,
    skills:       Array.isArray(skills) ? skills : [],
  });
  logger.info('orchestrator', `Created agent: ${name} (${agent.id})`);
  return { ok: true, agent_id: agent.id, name: agent.name, provider: agent.provider, model: agent.model };
}

async function updateAgent({ agent_id, ...rest }) {
  if (!agent_id) return { error: 'agent_id required' };
  if (agent_id === 'brain') {
    // Brain only supports model update
    if (rest.model) {
      const brain = require('../brain');
      brain.setModel(rest.model);
      return { ok: true, agent_id: 'brain', message: `Brain model updated to ${rest.model}` };
    }
    return { error: 'Brain only supports model updates via update_agent' };
  }
  const agents = require('../agents');
  const updated = agents.update(agent_id, rest);
  if (!updated) return { error: `Agent ${agent_id} not found` };
  logger.info('orchestrator', `Updated agent: ${agent_id}`);
  return { ok: true, agent_id, ...updated };
}

async function deleteAgent({ agent_id }) {
  if (!agent_id) return { error: 'agent_id required' };
  if (agent_id === 'brain') return { error: 'Cannot delete Brain orchestrator' };
  const agents = require('../agents');
  const ok = agents.remove(agent_id);
  if (!ok) return { error: `Agent ${agent_id} not found` };
  logger.info('orchestrator', `Deleted agent: ${agent_id}`);
  return { ok: true, agent_id, message: 'Agent deleted' };
}

// ─── Cron Jobs ────────────────────────────────────────────────────────────────

async function listCronJobs() {
  const cron = require('../cron');
  const jobs = cron.getAll();
  return {
    count: jobs.length,
    jobs: jobs.map(j => ({
      id:             j.id,
      name:           j.name,
      schedule:       j.schedule,
      scheduleDesc:   j.scheduleDesc,
      agentName:      j.agentName,
      enabled:        j.enabled,
      sendToTelegram: j.sendToTelegram,
      lastRun:        j.lastRun,
      lastStatus:     j.lastStatus,
      runCount:       j.runCount,
      isRunning:      j.isRunning,
    })),
  };
}

async function createCronJob({ name, description, schedule, prompt, agent_id, sendToTelegram, enabled }) {
  const cron   = require('../cron');
  const agents = require('../agents');

  // Resolve agent name
  let agentName = 'Brain';
  const agentId = agent_id || 'brain';
  if (agentId !== 'brain') {
    const agent = agents.getById(agentId);
    if (!agent) return { error: `Agent ${agentId} not found. Use list_agents to see available agents.` };
    agentName = agent.name;
  }

  const job = cron.create({
    name,
    description:    description || '',
    schedule,
    prompt,
    agentId:        agentId,
    agentName,
    sendToTelegram: sendToTelegram === true,
    enabled:        enabled !== false,
  });

  logger.info('orchestrator', `Created cron job: "${name}" (${job.id}) schedule=${schedule}`);
  return { ok: true, job_id: job.id, name: job.name, schedule: job.schedule, scheduleDesc: job.scheduleDesc };
}

async function updateCronJob({ job_id, ...rest }) {
  if (!job_id) return { error: 'job_id required' };
  const cron = require('../cron');
  // Map agent_id → agentId for the cron module
  if (rest.agent_id) { rest.agentId = rest.agent_id; delete rest.agent_id; }
  const updated = cron.update(job_id, rest);
  if (!updated) return { error: `Cron job ${job_id} not found` };
  logger.info('orchestrator', `Updated cron job: ${job_id}`);
  return { ok: true, job_id, ...updated };
}

async function deleteCronJob({ job_id }) {
  if (!job_id) return { error: 'job_id required' };
  const cron = require('../cron');
  const ok   = cron.remove(job_id);
  if (!ok) return { error: `Cron job ${job_id} not found` };
  logger.info('orchestrator', `Deleted cron job: ${job_id}`);
  return { ok: true, job_id, message: 'Cron job deleted' };
}

async function runCronJob({ job_id }) {
  if (!job_id) return { error: 'job_id required' };
  const cron = require('../cron');
  const result = await cron.runNow(job_id);
  if (result.error) return result;
  logger.info('orchestrator', `Triggered cron job: ${job_id}`);
  return { ok: true, job_id, message: 'Job started — check Tracking tab for progress' };
}

// ─── Group Debates ────────────────────────────────────────────────────────────

async function listDebates() {
  const gc = require('../group-chat');
  const sessions = gc.getAll();
  return {
    count: sessions.length,
    sessions: sessions.map(s => ({
      id:           s.id,
      name:         s.name,
      topic:        s.topic,
      status:       s.status,
      agentCount:   (s.agents || []).length,
      messageCount: s.messageCount,
      autoSynthesize: s.autoSynthesize,
      allowTools:   s.allowTools,
    })),
  };
}

async function createDebate({ name, topic, agents, autoSynthesize, allowTools, roundDelayMs }) {
  if (!agents || agents.length < 2) return { error: 'Need at least 2 agents to create a debate' };

  const gc = require('../group-chat');
  const session = gc.create({
    name,
    topic:          topic          || '',
    agents:         agents         || [],
    autoSynthesize: autoSynthesize !== false,
    allowTools:     allowTools     !== false,
    roundDelayMs:   Number(roundDelayMs) || 500,
  });

  logger.info('orchestrator', `Created debate: "${name}" (${session.id}) topic="${topic}"`);
  return {
    ok:         true,
    session_id: session.id,
    name:       session.name,
    topic:      session.topic,
    agents:     (session.agents || []).map(a => ({ id: a.id, name: a.name, role: a.role })),
    message:    'Debate created. Call start_debate to begin.',
  };
}

async function startDebate({ session_id }) {
  if (!session_id) return { error: 'session_id required' };
  const gc = require('../group-chat');
  const result = gc.startDebate(session_id);
  if (result.error) return result;
  logger.info('orchestrator', `Started debate: ${session_id}`);
  return { ok: true, session_id, message: 'Debate started — agents are now discussing in the Group Debate tab' };
}

async function stopDebate({ session_id }) {
  if (!session_id) return { error: 'session_id required' };
  const gc = require('../group-chat');
  const ok = gc.stopDebate(session_id);
  if (!ok) return { error: `Debate session ${session_id} not found` };
  logger.info('orchestrator', `Stopped debate: ${session_id}`);
  return { ok: true, session_id, message: 'Debate stopped' };
}

async function deleteDebate({ session_id }) {
  if (!session_id) return { error: 'session_id required' };
  const gc = require('../group-chat');
  const ok = gc.remove(session_id);
  if (!ok) return { error: `Debate session ${session_id} not found` };
  logger.info('orchestrator', `Deleted debate: ${session_id}`);
  return { ok: true, session_id, message: 'Debate session deleted' };
}

// ─── MCP Servers ──────────────────────────────────────────────────────────────

async function createMcpServer({ name, command, args, env }) {
  const mcp = require('../mcp-manager');
  const server = mcp.create({
    name,
    command,
    args: Array.isArray(args) ? args : [],
    env:  env || {},
  });
  logger.info('orchestrator', `Created MCP server: "${name}" (${server.id})`);
  return { ok: true, server_id: server.id, name: server.name, message: 'MCP server registered. Call connect_mcp_server to connect.' };
}

async function connectMcpServer({ server_id }) {
  if (!server_id) return { error: 'server_id required' };
  const mcp = require('../mcp-manager');
  try {
    const result = await mcp.connect(server_id);
    logger.info('orchestrator', `Connected MCP server: ${server_id}`);
    return { ok: true, server_id, tools: result.tools || [], toolCount: result.toolCount || 0 };
  } catch (e) {
    return { error: `Failed to connect: ${e.message}` };
  }
}

async function disconnectMcpServer({ server_id }) {
  if (!server_id) return { error: 'server_id required' };
  const mcp = require('../mcp-manager');
  try {
    await mcp.disconnect(server_id);
    logger.info('orchestrator', `Disconnected MCP server: ${server_id}`);
    return { ok: true, server_id };
  } catch (e) {
    return { error: e.message };
  }
}

async function deleteMcpServer({ server_id }) {
  if (!server_id) return { error: 'server_id required' };
  const mcp = require('../mcp-manager');
  const ok  = mcp.remove(server_id);
  if (!ok) return { error: `MCP server ${server_id} not found` };
  logger.info('orchestrator', `Deleted MCP server: ${server_id}`);
  return { ok: true, server_id, message: 'MCP server removed' };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { TOOL_NAMES, execute };