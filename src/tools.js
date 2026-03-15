/**
 * tools.js — Capabilities Brain can use autonomously
 *
 * Tools hiện có (12 tools):
 *   1.  get_current_time    — Thời gian hiện tại VN
 *   2.  list_agents         — Liệt kê agents
 *   3.  get_system_status   — System info
 *   4.  call_agent          — Gọi agent chuyên biệt
 *   5.  manage_agent        — Bật/tắt agent
 *   6.  get_memory_stats    — Thống kê memory
 *   7.  run_command         — Chạy lệnh shell (whitelist)
 *   8.  run_pipeline        — Chạy nhiều agents song song/tuần tự
 *   9.  save_lesson         — Lưu bài học vào self-learn
 *   10. send_telegram       — Gửi Telegram proactively
 *   11. read_file           — Đọc file local (whitelist paths)
 *   12. write_file          — Ghi file local (whitelist paths)
 *   13. http_request        — HTTP GET/POST tới external API
 *   14. search_web          — Tìm kiếm web qua DuckDuckGo
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const logger = require('./logger');

// ─── Tool Definitions (JSON Schema for OpenAI-compatible tool calling) ────────

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'get_current_time',
      description: 'Get the current date, time, day of week. Use when user asks about time, date, or schedule.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_agents',
      description: 'List all AI agents in the system with their status (active/disabled), provider, and model.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_system_status',
      description: 'Get system status: uptime, memory usage, CPU, platform info, brain model, agent count.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'call_agent',
      description: 'Delegate a task to a specialized agent. Use dev-agent for code/debug, search-agent for research.',
      parameters: {
        type: 'object',
        properties: {
          agent_id: { type: 'string', description: 'ID of the agent (e.g. dev-agent, search-agent)' },
          task: { type: 'string', description: 'The task description to send to the agent' },
        },
        required: ['agent_id', 'task'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'manage_agent',
      description: 'Enable or disable an agent.',
      parameters: {
        type: 'object',
        properties: {
          agent_id: { type: 'string' },
          action: { type: 'string', enum: ['enable', 'disable'] },
        },
        required: ['agent_id', 'action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_memory_stats',
      description: 'Get conversation memory statistics.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Execute a safe shell command on the local system. Only read-only commands are allowed.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to execute' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_pipeline',
      description: 'Run multiple agent tasks as a pipeline. Use "parallel" to run simultaneously, "sequential" to chain.',
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['parallel', 'sequential'] },
          steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                agent_id: { type: 'string' },
                task: { type: 'string', description: 'Use {step_0}, {step_1}... in sequential mode' },
              },
              required: ['agent_id', 'task'],
            },
          },
        },
        required: ['mode', 'steps'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_lesson',
      description: 'Save an important lesson or fact to remember in future conversations.',
      parameters: {
        type: 'object',
        properties: {
          lesson: { type: 'string' },
          type: { type: 'string', enum: ['pattern', 'user_preference', 'routing', 'fact', 'tool_error'] },
        },
        required: ['lesson'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_telegram',
      description: 'Proactively send a message to the owner via Telegram. Use for task completion notifications, alerts.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Message to send. Max 4000 chars.' },
        },
        required: ['message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read content of a local file. Only allowed in safe directories (workspace, data, home).',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Absolute or relative path to the file' },
          encoding: { type: 'string', enum: ['utf8', 'base64'], description: 'Encoding (default: utf8)' },
        },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a local file. Only allowed in safe directories (workspace, data, home).',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Path to write to' },
          content: { type: 'string', description: 'Content to write' },
          mode: { type: 'string', enum: ['overwrite', 'append'], description: 'Write mode (default: overwrite)' },
        },
        required: ['file_path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'http_request',
      description: 'Make HTTP GET or POST request to an external API. Use for fetching data, webhooks, etc.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to request' },
          method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'], description: 'HTTP method (default: GET)' },
          headers: { type: 'object', description: 'Request headers (optional)' },
          body: { type: 'string', description: 'Request body for POST/PUT (JSON string)' },
          timeout_ms: { type: 'number', description: 'Timeout in ms (default: 10000)' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_web',
      description: 'Search the web for information using DuckDuckGo. Returns top results with snippets.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          max_results: { type: 'number', description: 'Max results to return (default: 5, max: 10)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_agent',
      description: 'Create a new AI agent with specified configuration. Use when user asks to create an agent. This saves the agent immediately to the system.',
      parameters: {
        type: 'object',
        properties: {
          name:        { type: 'string', description: 'Agent name, e.g. "SEO Writer"' },
          description: { type: 'string', description: 'Short description of what the agent does' },
          provider:    { type: 'string', enum: ['copilot','claude','gemini','openrouter','openai'], description: 'AI provider' },
          model:       { type: 'string', description: 'Model ID, e.g. gpt-5-mini, claude-sonnet-4-5' },
          systemPrompt:{ type: 'string', description: 'Full system prompt for the agent' },
          skills:      { type: 'array', items: { type: 'string' }, description: 'List of specific skill/instruction strings' },
          apiKey:      { type: 'string', description: 'API key if needed (leave empty to use env var)' },
        },
        required: ['name', 'provider', 'model', 'systemPrompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_agent',
      description: 'Update an existing agent\'s configuration (name, prompt, model, skills, context).',
      parameters: {
        type: 'object',
        properties: {
          agent_id:     { type: 'string', description: 'ID of the agent to update' },
          name:         { type: 'string' },
          description:  { type: 'string' },
          provider:     { type: 'string', enum: ['copilot','claude','gemini','openrouter','openai'] },
          model:        { type: 'string' },
          systemPrompt: { type: 'string' },
          skills:       { type: 'array', items: { type: 'string' } },
          contextNotes: { type: 'string' },
          active:       { type: 'boolean' },
        },
        required: ['agent_id'],
      },
    },
  },
];

// ─── Safe command whitelist ────────────────────────────────────────────────────

const SAFE_PREFIXES = [
  'dir', 'ls', 'echo', 'type', 'cat', 'hostname', 'whoami',
  'date', 'time', 'systeminfo', 'tasklist', 'ipconfig',
  'node -v', 'node --version', 'npm -v', 'npm list',
  'ollama list', 'ollama ps', 'ollama show',
  'git status', 'git log', 'git branch', 'git diff',
  'powershell -c get-date', 'powershell -c get-process',
  'wmic', 'net time', 'ping', 'nslookup',
  'df', 'free', 'top -bn1', 'ps aux', 'uname', 'which',
];

// ─── Safe file path whitelist ──────────────────────────────────────────────────

const SAFE_FILE_DIRS = [
  path.join(os.homedir(), 'brain-os'),
  path.join(os.homedir(), 'workspace'),
  path.join(os.homedir(), 'Documents'),
  path.join(__dirname, '..', 'data'),
  path.join(__dirname, '..', 'workspace'),
];

function isSafeFilePath(filePath) {
  const abs = path.resolve(filePath);
  return SAFE_FILE_DIRS.some(safe => abs.startsWith(safe));
}

// ─── Tool Implementations ──────────────────────────────────────────────────────

const implementations = {

  get_current_time: async () => {
    const now = new Date();
    return {
      iso: now.toISOString(),
      local: now.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
      date: now.toLocaleDateString('vi-VN', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        timeZone: 'Asia/Ho_Chi_Minh',
      }),
      time: now.toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false }),
      timestamp: Date.now(),
      timezone: 'Asia/Ho_Chi_Minh (UTC+7)',
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
        description: a.description || '(no description)',
        skills_count: (a.skills || []).length,
        has_context: !!(a.contextNotes && a.contextNotes.trim()),
      })),
    };
  },

  get_system_status: async () => {
    const memory = require('./memory');
    const agents = require('./agents');
    const brain = require('./brain');
    const brainConfig = brain.getConfig();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    return {
      server_uptime: Math.round(process.uptime()) + 's',
      platform: `${os.platform()} ${os.release()}`,
      hostname: os.hostname(),
      cpu_cores: os.cpus().length,
      cpu_model: os.cpus()[0]?.model?.slice(0, 40) || 'unknown',
      ram_total: Math.round(totalMem / 1024 / 1024) + 'MB',
      ram_used: Math.round((totalMem - freeMem) / 1024 / 1024) + 'MB',
      ram_free: Math.round(freeMem / 1024 / 1024) + 'MB',
      brain_provider: 'copilot',
      brain_model: brainConfig.model,
      brain_available: brainConfig.available,
      memory_messages: memory.getHistory().length,
      active_agents: agents.getAll().filter(a => a.active).length,
      node_version: process.version,
    };
  },

  call_agent: async (args) => {
    const agents = require('./agents');
    const { agent_id, task } = args;
    const agent = agents.getById(agent_id);
    if (!agent) return { error: `Agent '${agent_id}' not found. Use list_agents to see available agents.` };
    if (!agent.active) return { error: `Agent '${agent_id}' is disabled.` };

    return new Promise((resolve) => {
      let result = '';
      const timeout = setTimeout(() => {
        resolve({ agent: agent.name, response: result || '(timeout)', partial: true });
      }, 60000);

      agents.runAgent({
        agentId: agent_id,
        userInput: task,
        onToken: (t) => { result += t; },
        onDone: (content) => { clearTimeout(timeout); resolve({ agent: agent.name, response: content }); },
        onError: (e) => { clearTimeout(timeout); resolve({ agent: agent.name, error: e.message }); },
      });
    });
  },

  manage_agent: async (args) => {
    const agents = require('./agents');
    const agent = agents.getById(args.agent_id);
    if (!agent) return { error: `Agent not found: ${args.agent_id}` };
    agents.update(args.agent_id, { active: args.action === 'enable' });
    return { ok: true, agent: agent.name, status: args.action === 'enable' ? 'enabled' : 'disabled' };
  },

  get_memory_stats: async () => {
    const memory = require('./memory');
    const history = memory.getHistory();
    const agents = require('./agents');
    const agentIds = [...new Set(history.map(m => m.agentId).filter(Boolean))];

    return {
      total_messages: history.length,
      brain_messages: history.filter(m => m.agentId === 'brain' || !m.agentId).length,
      agent_messages: history.filter(m => m.agentId && m.agentId !== 'brain').length,
      active_agent_contexts: agentIds.length,
      agent_context_breakdown: agentIds.map(id => ({
        id,
        messages: history.filter(m => m.agentId === id).length,
      })),
    };
  },

  run_command: async (args) => {
    const cmd = args.command?.trim() || '';
    const isAllowed = SAFE_PREFIXES.some(p => cmd.toLowerCase().startsWith(p.toLowerCase()));
    if (!isAllowed) {
      return { error: `Command blocked: "${cmd}". Only read-only commands allowed.`, blocked: true };
    }

    try {
      const output = execSync(cmd, {
        timeout: 15000,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
      });
      return { output: output.slice(0, 3000), command: cmd };
    } catch (e) {
      return { error: e.message.slice(0, 500), command: cmd };
    }
  },

  run_pipeline: async (args) => {
    const agents = require('./agents');
    const { mode, steps } = args;
    const previousOutputs = [];

    const runStep = async (step, prevOutputs = []) => {
      let task = step.task;
      prevOutputs.forEach((r, i) => {
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
          onError: (e) => { clearTimeout(timeout); resolve({ agent: agent.name, error: e.message }); },
        });
      });
    };

    if (mode === 'parallel') {
      return { mode: 'parallel', results: await Promise.all(steps.map(s => runStep(s))) };
    } else {
      const results = [];
      for (const step of steps) {
        const r = await runStep(step, results.map(r => r.response || r.error));
        results.push(r);
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
    if (!status.connected) return { error: 'Telegram bot chưa kết nối.' };
    if (!status.ownerChatId) return { error: 'Chưa có owner chat ID.' };
    try {
      const result = await telegram.sendToOwner(args.message);
      return { sent: true, chatId: result.chatId, preview: args.message.slice(0, 100) };
    } catch (e) {
      return { error: e.message };
    }
  },

  // ── New: read_file ──────────────────────────────────────────────────────────

  read_file: async (args) => {
    const filePath = args.file_path;
    const encoding = args.encoding || 'utf8';

    if (!isSafeFilePath(filePath)) {
      // Also allow relative paths from project root
      const projectRoot = path.join(__dirname, '..');
      const absPath = path.resolve(projectRoot, filePath);
      if (!absPath.startsWith(projectRoot)) {
        return { error: `Path not allowed: "${filePath}". Must be within project or workspace directories.` };
      }
    }

    try {
      const absPath = path.resolve(filePath);
      if (!fs.existsSync(absPath)) return { error: `File not found: ${filePath}` };

      const stat = fs.statSync(absPath);
      if (stat.size > 512 * 1024) return { error: `File too large (${Math.round(stat.size / 1024)}KB). Max 512KB.` };

      const content = fs.readFileSync(absPath, encoding);
      return {
        path: absPath,
        size: stat.size,
        content: encoding === 'utf8' ? content.slice(0, 8000) : content,
        truncated: encoding === 'utf8' && content.length > 8000,
      };
    } catch (e) {
      return { error: `Read error: ${e.message}` };
    }
  },

  // ── New: write_file ─────────────────────────────────────────────────────────

  write_file: async (args) => {
    const { file_path, content, mode = 'overwrite' } = args;
    const projectRoot = path.join(__dirname, '..');
    const absPath = path.resolve(projectRoot, file_path);

    // Must be within project root or workspace
    if (!absPath.startsWith(projectRoot) && !isSafeFilePath(absPath)) {
      return { error: `Path not allowed: "${file_path}".` };
    }

    try {
      const dir = path.dirname(absPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      if (mode === 'append') {
        fs.appendFileSync(absPath, content, 'utf8');
      } else {
        fs.writeFileSync(absPath, content, 'utf8');
      }

      return { ok: true, path: absPath, mode, bytes_written: content.length };
    } catch (e) {
      return { error: `Write error: ${e.message}` };
    }
  },

  // ── New: http_request ───────────────────────────────────────────────────────

  http_request: async (args) => {
    const { url, method = 'GET', headers = {}, body, timeout_ms = 10000 } = args;

    try {
      const opts = {
        method,
        headers: { 'User-Agent': 'Brain-OS/1.0', ...headers },
        signal: AbortSignal.timeout(timeout_ms),
      };

      if (body && (method === 'POST' || method === 'PUT')) {
        opts.body = body;
        if (!opts.headers['Content-Type']) opts.headers['Content-Type'] = 'application/json';
      }

      const res = await fetch(url, opts);
      const text = await res.text();

      // Try to parse JSON
      let parsed = null;
      try { parsed = JSON.parse(text); } catch { }

      return {
        status: res.status,
        ok: res.ok,
        url,
        body: parsed || text.slice(0, 4000),
        truncated: !parsed && text.length > 4000,
        headers: Object.fromEntries(res.headers.entries()),
      };
    } catch (e) {
      return { error: `HTTP request failed: ${e.message}`, url };
    }
  },

  // ── New: search_web (DuckDuckGo) ────────────────────────────────────────────

  search_web: async (args) => {
    const { query, max_results = 5 } = args;
    const limit = Math.min(max_results, 10);

    try {
      const encoded = encodeURIComponent(query);
      // DuckDuckGo Instant Answer API
      const url = `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`;

      const res = await fetch(url, {
        headers: { 'User-Agent': 'Brain-OS/1.0' },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) return { error: `Search API error: ${res.status}`, query };

      const data = await res.json();

      const results = [];

      // Abstract (main answer)
      if (data.Abstract) {
        results.push({
          title: data.Heading || query,
          snippet: data.Abstract,
          url: data.AbstractURL || '',
          source: data.AbstractSource || 'DuckDuckGo',
        });
      }

      // Related topics
      if (data.RelatedTopics) {
        for (const topic of data.RelatedTopics.slice(0, limit - 1)) {
          if (topic.Text && topic.FirstURL) {
            results.push({
              title: topic.Text.slice(0, 100),
              snippet: topic.Text.slice(0, 300),
              url: topic.FirstURL,
              source: 'DuckDuckGo',
            });
          }
        }
      }

      if (results.length === 0) {
        return {
          query,
          results: [],
          note: 'No results from DDG Instant API. Try a more specific query or use a search agent.',
        };
      }

      return { query, results: results.slice(0, limit), count: results.length };
    } catch (e) {
      return { error: `Search error: ${e.message}`, query };
    }
  },

  // ── create_agent ─────────────────────────────────────────────────────────────

  create_agent: async (args) => {
    const agents = require('./agents');
    const { name, description, provider, model, systemPrompt, skills, apiKey } = args;

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
      message: `Agent "${agent.name}" đã tạo xong! ID: ${agent.id}. Chọn trong dropdown Chat để dùng ngay.`,
    };
  },

  // ── update_agent ──────────────────────────────────────────────────────────────

  update_agent: async (args) => {
    const agents = require('./agents');
    const { agent_id, ...updates } = args;

    const agent = agents.getById(agent_id);
    if (!agent) return { error: `Agent not found: ${agent_id}. Use list_agents to check IDs.` };

    const clean = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined));
    const updated = agents.update(agent_id, clean);

    return {
      ok: true,
      id: updated.id,
      name: updated.name,
      message: `Agent "${updated.name}" đã cập nhật: ${Object.keys(clean).join(', ')}.`,
    };
  },
};

// ─── Tool Executor ────────────────────────────────────────────────────────────

async function executeTool(toolCall) {
  const name = toolCall.function?.name;
  const rawArgs = toolCall.function?.arguments || {};
  const args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
  const impl = implementations[name];

  if (!impl) {
    logger.warn('tools', `Unknown tool: ${name}`);
    return { error: `Unknown tool: ${name}` };
  }

  try {
    logger.debug('tools', `🔧 ${name}(${JSON.stringify(args).slice(0, 100)})`);
    const result = await impl(args);
    logger.debug('tools', `✅ ${name} → ${JSON.stringify(result).slice(0, 200)}`);
    return result;
  } catch (e) {
    logger.error('tools', `❌ ${name} failed: ${e.message}`);
    return { error: `Tool ${name} failed: ${e.message}` };
  }
}

async function executeToolsParallel(toolCalls) {
  return Promise.all(toolCalls.map(tc => executeTool(tc)));
}

module.exports = {
  TOOL_DEFINITIONS,
  executeTool,
  executeToolsParallel,
  getToolNames: () => TOOL_DEFINITIONS.map(t => t.function.name),
};