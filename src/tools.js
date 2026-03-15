/**
 * Tools — Capabilities that Brain can use autonomously
 *
 * Each tool has:
 *   - definition: JSON schema (sent to Ollama so the model knows what tools exist)
 *   - implementation: actual function that executes when Brain calls the tool
 *
 * Ollama tool calling flow:
 *   1. Brain receives user input + tool definitions
 *   2. Brain decides which tool(s) to call (or responds directly)
 *   3. Server executes tool(s) and sends results back
 *   4. Brain synthesizes final response
 */

const os = require('os');
const { execSync } = require('child_process');
const logger = require('./logger');

// ─── Tool Definitions (JSON Schema for Ollama) ───────────────────────────────

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'get_current_time',
      description: 'Get the current date, time, day of week. Use when user asks about time, date, or schedule.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_agents',
      description: 'List all AI agents in the system with their status (active/disabled), provider, and model. Use when user asks about agents.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_system_status',
      description: 'Get system status: uptime, memory usage, CPU, platform info, brain model, agent count.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'call_agent',
      description: 'Delegate a task to a specialized agent. Use dev-agent for code/debug, search-agent for research, or other agents by ID.',
      parameters: {
        type: 'object',
        properties: {
          agent_id: { type: 'string', description: 'ID of the agent to call (e.g. dev-agent, search-agent)' },
          task: { type: 'string', description: 'The task description to send to the agent' }
        },
        required: ['agent_id', 'task']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'manage_agent',
      description: 'Enable or disable an agent.',
      parameters: {
        type: 'object',
        properties: {
          agent_id: { type: 'string', description: 'ID of the agent' },
          action: { type: 'string', enum: ['enable', 'disable'], description: 'Action to perform' }
        },
        required: ['agent_id', 'action']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_memory_stats',
      description: 'Get conversation memory statistics: total messages, summaries, active agents in memory.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Execute a safe shell command on the local system. Only read-only commands are allowed.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to execute' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_pipeline',
      description: 'Run multiple agent tasks as a pipeline. Use "parallel" to run simultaneously, "sequential" to chain results. Best for complex multi-step workflows.',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['parallel', 'sequential'],
            description: 'parallel: all at same time. sequential: each step can use {step_N} from previous.'
          },
          steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                agent_id: { type: 'string' },
                task: { type: 'string', description: 'Use {step_0}, {step_1}... to reference previous outputs in sequential mode' }
              },
              required: ['agent_id', 'task']
            }
          }
        },
        required: ['mode', 'steps']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'save_lesson',
      description: 'Save an important lesson or fact to remember in future conversations.',
      parameters: {
        type: 'object',
        properties: {
          lesson: { type: 'string', description: 'The lesson to remember' },
          type: { type: 'string', enum: ['pattern', 'user_preference', 'routing', 'fact', 'tool_error'] }
        },
        required: ['lesson']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_telegram',
      description: 'Proactively send a message to the owner via Telegram. Use when you need to notify, alert, or report results to the user without them asking. Great for task completion notifications, alerts, scheduled reports.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Message to send. Can be multi-line. Max 4000 chars per message, longer content is split automatically.' }
        },
        required: ['message']
      }
    }
  }
];

// ─── Safe command whitelist for run_command ────────────────────────────────────

const SAFE_PREFIXES = [
  'dir', 'ls', 'echo', 'type', 'cat', 'hostname', 'whoami',
  'date', 'time', 'systeminfo', 'tasklist', 'ipconfig',
  'node -v', 'node --version', 'npm -v', 'npm list',
  'ollama list', 'ollama ps', 'ollama show',
  'git status', 'git log', 'git branch', 'git diff',
  'powershell -c get-date', 'powershell -c get-process',
  'wmic', 'net time', 'ping', 'nslookup',
];

// ─── Tool Implementations ─────────────────────────────────────────────────────

const implementations = {

  get_current_time: async () => {
    const now = new Date();
    return {
      iso: now.toISOString(),
      local: now.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
      date: now.toLocaleDateString('vi-VN', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        timeZone: 'Asia/Ho_Chi_Minh'
      }),
      time: now.toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false }),
      timestamp: Date.now(),
      timezone: 'Asia/Ho_Chi_Minh (UTC+7)'
    };
  },

  list_agents: async () => {
    const agents = require('./agents');
    const all = agents.getAll();
    return {
      total: all.length,
      active: all.filter(a => a.active).length,
      disabled: all.filter(a => !a.active).length,
      agents: all.map(a => ({
        id: a.id, name: a.name,
        provider: a.provider, model: a.model,
        active: a.active,
        description: a.description || '(no description)'
      }))
    };
  },

  get_system_status: async () => {
    const memory = require('./memory');
    const agents = require('./agents');
    const brain = require('./brain'); // lazy require OK — no circular at runtime
    const brainConfig = brain.getConfig();

    return {
      server_uptime: Math.round(process.uptime()) + 's',
      platform: `${os.platform()} ${os.release()}`,
      hostname: os.hostname(),
      node_version: process.version,
      memory_system: {
        total: Math.round(os.totalmem() / 1024 / 1024) + ' MB',
        free: Math.round(os.freemem() / 1024 / 1024) + ' MB',
        usage: Math.round((1 - os.freemem() / os.totalmem()) * 100) + '%'
      },
      brain: {
        model: brainConfig.model,
        available: brainConfig.available,
        models_loaded: brainConfig.models || []
      },
      agents: agents.getAll().length,
      conversation_messages: memory.getHistory().length,
      cpus: os.cpus().length + ' cores'
    };
  },

  call_agent: async (args) => {
    const agents = require('./agents');
    const agent = agents.getById(args.agent_id);
    if (!agent) {
      // Try fuzzy match by name
      const all = agents.getAll();
      const match = all.find(a =>
        a.name.toLowerCase().includes(args.agent_id.toLowerCase()) ||
        a.id.toLowerCase().includes(args.agent_id.toLowerCase())
      );
      if (!match) return { error: `Agent not found: ${args.agent_id}. Available: ${all.map(a => a.id).join(', ')}` };
      args.agent_id = match.id;
    }

    const targetAgent = agents.getById(args.agent_id);
    if (!targetAgent.active) return { error: `Agent "${targetAgent.name}" is disabled. Enable it first.` };

    logger.info('tools', `📡 Delegating to ${targetAgent.name}: "${args.task.slice(0, 80)}..."`);

    return new Promise((resolve) => {
      let result = '';
      const timeout = setTimeout(() => {
        resolve({ agent: targetAgent.name, response: result || '(timeout — no response after 60s)', partial: true });
      }, 60000);

      agents.runAgent({
        agentId: args.agent_id,
        userInput: args.task,
        onToken: (token) => { result += token; },
        onDone: (content) => {
          clearTimeout(timeout);
          resolve({ agent: targetAgent.name, response: content });
        },
        onError: (e) => {
          clearTimeout(timeout);
          resolve({ agent: targetAgent.name, error: e.message });
        }
      });
    });
  },

  manage_agent: async (args) => {
    const agents = require('./agents');
    const agent = agents.getById(args.agent_id);
    if (!agent) return { error: `Agent not found: ${args.agent_id}` };

    const updated = agents.update(args.agent_id, { active: args.action === 'enable' });
    logger.info('tools', `Agent ${updated.name} → ${updated.active ? '🟢 enabled' : '🔴 disabled'}`);
    return { success: true, agent: updated.name, active: updated.active };
  },

  get_memory_stats: async () => {
    const memory = require('./memory');
    const history = memory.getHistory();
    const summaries = memory.getSummaries();
    const agentIds = [...new Set(history.map(m => m.agentId))];

    return {
      total_messages: history.length,
      summaries: summaries.length,
      agents_in_memory: agentIds,
      oldest: history.length > 0 ? new Date(history[0].timestamp).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : null,
      newest: history.length > 0 ? new Date(history[history.length - 1].timestamp).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : null,
    };
  },

  run_command: async (args) => {
    const cmd = (args.command || '').trim();
    if (!cmd) return { error: 'Empty command' };

    const isSafe = SAFE_PREFIXES.some(p => cmd.toLowerCase().startsWith(p.toLowerCase()));
    if (!isSafe) {
      return { error: `Command blocked: "${cmd}". Only safe read-only commands are permitted. Allowed prefixes: ${SAFE_PREFIXES.slice(0, 10).join(', ')}...` };
    }

    try {
      const output = execSync(cmd, { timeout: 15000, encoding: 'utf8', maxBuffer: 1024 * 100 });
      logger.info('tools', `Command: ${cmd}`);
      return { command: cmd, output: output.trim().slice(0, 3000) };
    } catch (e) {
      return { command: cmd, error: e.stderr || e.message };
    }
  },

  run_pipeline: async (args) => {
    const { mode, steps } = args;
    const agents = require('./agents');

    if (!steps?.length) return { error: 'No steps provided' };

    logger.info('tools', `Pipeline ${mode}: ${steps.map(s => s.agent_id).join(' → ')}`);

    const runStep = (step, previousResults = []) => {
      // Replace {step_N} placeholders with previous results
      let task = step.task;
      previousResults.forEach((r, i) => {
        const output = typeof r === 'object' ? JSON.stringify(r).slice(0, 500) : String(r);
        task = task.replace(`{step_${i}}`, output);
      });

      return new Promise((resolve) => {
        let result = '';
        const agent = agents.getById(step.agent_id);
        if (!agent) { resolve({ agent: step.agent_id, error: 'Agent not found' }); return; }
        if (!agent.active) { resolve({ agent: step.agent_id, error: 'Agent disabled' }); return; }

        const timeout = setTimeout(() => {
          resolve({ agent: agent.name, response: result || '(timeout)', partial: true });
        }, 60000);

        agents.runAgent({
          agentId: step.agent_id,
          userInput: task,
          onToken: (t) => { result += t; },
          onDone: (content) => { clearTimeout(timeout); resolve({ agent: agent.name, response: content }); },
          onError: (e) => { clearTimeout(timeout); resolve({ agent: agent.name, error: e.message }); }
        });
      });
    };

    if (mode === 'parallel') {
      const results = await Promise.all(steps.map(s => runStep(s)));
      return { mode: 'parallel', results };
    } else {
      // Sequential: chain outputs
      const results = [];
      for (const step of steps) {
        const r = await runStep(step, results.map(r => r.response || r.error));
        results.push(r);
        logger.debug('tools', `Pipeline step done: ${step.agent_id}`);
      }
      return { mode: 'sequential', results };
    }
  },

  save_lesson: async (args) => {
    const selfLearn = require('./self-learn');
    const entry = selfLearn.storeLesson({
      type: args.type || 'fact',
      trigger: args.lesson.slice(0, 60),
      lesson: args.lesson,
    });
    return { saved: true, id: entry.id, total_lessons: selfLearn.getLessonCount() };
  },

  send_telegram: async (args) => {
    const telegram = require('./telegram');
    const status = telegram.getStatus();
    if (!status.connected) return { error: 'Telegram bot chưa kết nối. Vào tab Telegram để connect.' };
    if (!status.ownerChatId) return { error: 'Chưa có owner chat ID. Nhắn 1 tin cho bot trên Telegram để auto-detect, hoặc điền thủ công trong tab Telegram.' };
    try {
      const result = await telegram.sendToOwner(args.message);
      return { sent: true, chatId: result.chatId, preview: args.message.slice(0, 100) };
    } catch (e) {
      return { error: e.message };
    }
  }
};

// ─── Tool Executor ────────────────────────────────────────────────────────────

async function executeTool(toolCall) {
  const name = toolCall.function?.name;
  const args = toolCall.function?.arguments || {};
  const impl = implementations[name];

  if (!impl) {
    logger.warn('tools', `Unknown tool: ${name}`);
    return { error: `Unknown tool: ${name}` };
  }

  try {
    logger.debug('tools', `🔧 Executing: ${name}(${JSON.stringify(args).slice(0, 100)})`);
    const result = await impl(typeof args === 'string' ? JSON.parse(args) : args);
    logger.debug('tools', `✅ ${name} → ${JSON.stringify(result).slice(0, 200)}`);
    return result;
  } catch (e) {
    logger.error('tools', `❌ ${name} failed: ${e.message}`);
    return { error: `Tool ${name} failed: ${e.message}` };
  }
}

// ─── Execute multiple tools in parallel ───────────────────────────────────────

async function executeToolsParallel(toolCalls) {
  return Promise.all(toolCalls.map(tc => executeTool(tc)));
}

module.exports = {
  TOOL_DEFINITIONS,
  executeTool,
  executeToolsParallel,
  getToolNames: () => TOOL_DEFINITIONS.map(t => t.function.name),
};