/**
 * tools/agents.js — Agent management tools
 *   - list_agents
 *   - call_agent
 *   - manage_agent
 *   - run_pipeline
 *   - create_agent
 *   - update_agent
 */

const logger = require('../logger');
const { TOOL_CONSTANTS } = require('../constants');

async function list_agents() {
  const agents = require('../agents');
  const all = agents.getAll();
  return {
    total: all.length,
    active: all.filter(a => a.active).length,
    disabled: all.filter(a => !a.active).length,
    agents: all.map(a => ({
      id: a.id,
      name: a.name,
      provider: a.provider,
      model: a.model,
      active: a.active,
      description: a.description || '(no description)',
      skills_count: (a.skills || []).length,
      has_context: !!(a.contextNotes && a.contextNotes.trim()),
    })),
  };
}

async function call_agent({ agent_id, task }) {
  const agents = require('../agents');
  const agent = agents.getById(agent_id);
  if (!agent) return { error: `Agent '${agent_id}' not found. Use list_agents to see available agents.` };
  if (!agent.active) return { error: `Agent '${agent_id}' is disabled.` };

  return new Promise((resolve) => {
    let result = '';
    const timeout = setTimeout(() => {
      resolve({ agent: agent.name, response: result || '(timeout)', partial: true });
    }, TOOL_CONSTANTS.PIPELINE_STEP_TIMEOUT_MS);

    agents.runAgent({
      agentId: agent_id,
      userInput: task,
      onToken: (t) => { result += t; },
      onDone: (content) => { clearTimeout(timeout); resolve({ agent: agent.name, response: content }); },
      onError: (e) => { clearTimeout(timeout); resolve({ agent: agent.name, error: e.message }); },
    });
  });
}

async function manage_agent({ agent_id, action }) {
  const agents = require('../agents');
  const agent = agents.getById(agent_id);
  if (!agent) return { error: `Agent not found: ${agent_id}` };
  agents.update(agent_id, { active: action === 'enable' });
  return { ok: true, agent: agent.name, status: action === 'enable' ? 'enabled' : 'disabled' };
}

async function run_pipeline({ mode, steps }) {
  const agents = require('../agents');

  const runStep = (step, prevOutputs = []) => {
    let task = step.task;
    prevOutputs.forEach((r, i) => {
      const out = typeof r === 'object'
        ? JSON.stringify(r).slice(0, TOOL_CONSTANTS.ERROR_OUTPUT_PREVIEW_LENGTH)
        : String(r);
      task = task.replace(`{step_${i}}`, out);
    });

    return new Promise((resolve) => {
      let result = '';
      const agent = agents.getById(step.agent_id);
      if (!agent) { resolve({ agent: step.agent_id, error: 'Agent not found' }); return; }
      if (!agent.active) { resolve({ agent: step.agent_id, error: 'Agent disabled' }); return; }

      const timeout = setTimeout(() => {
        resolve({ agent: agent.name, response: result || '(timeout)', partial: true });
      }, TOOL_CONSTANTS.PIPELINE_STEP_TIMEOUT_MS);

      agents.runAgent({
        agentId: step.agent_id,
        userInput: task,
        onToken: (t) => { result += t; },
        onDone: (content) => { clearTimeout(timeout); resolve({ agent: agent.name, response: content }); },
        onError: (e) => { clearTimeout(timeout); resolve({ agent: agent.name, error: e.message }); },
      });
    });
  };

  if (mode === 'parallel') {
    return { mode: 'parallel', results: await Promise.all(steps.map(s => runStep(s))) };
  }

  const results = [];
  for (const step of steps) {
    const r = await runStep(step, results.map(r => r.response || r.error));
    results.push(r);
  }
  return { mode: 'sequential', results };
}

async function create_agent({ name, description, provider, model, systemPrompt, skills, apiKey }) {
  const agents = require('../agents');

  if (!name || !provider || !model || !systemPrompt) {
    return { error: 'Missing required fields: name, provider, model, systemPrompt' };
  }

  const existing = agents.getAll().find(a => a.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    return { error: `Agent "${name}" already exists (id: ${existing.id}). Use update_agent to modify it.` };
  }

  const agent = agents.create({
    name,
    description: description || '',
    provider,
    model,
    systemPrompt,
    skills: Array.isArray(skills) ? skills : [],
    apiKey: apiKey || '',
    autoUpdateContext: false,
  });

  logger.info('tools', `Agent created via chat: "${agent.name}" (${agent.id})`);
  return {
    ok: true,
    id: agent.id,
    name: agent.name,
    provider: agent.provider,
    model: agent.model,
    message: `Agent "${agent.name}" created! ID: ${agent.id}. Select it in the Chat dropdown to use.`,
  };
}

async function update_agent({ agent_id, ...updates }) {
  const agents = require('../agents');
  const agent = agents.getById(agent_id);
  if (!agent) return { error: `Agent not found: ${agent_id}. Use list_agents to check IDs.` };

  const clean = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined));
  const updated = agents.update(agent_id, clean);

  return {
    ok: true,
    id: updated.id,
    name: updated.name,
    message: `Agent "${updated.name}" updated: ${Object.keys(clean).join(', ')}.`,
  };
}

module.exports = { list_agents, call_agent, manage_agent, run_pipeline, create_agent, update_agent };