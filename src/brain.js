/**
 * Brain — Local LLM via Ollama with Tool Calling
 *
 * The brain is a small local model whose job is:
 *  1. Routing: decide which agent should handle the request
 *  2. Tool calling: autonomously use tools (time, agents, system, CLI, etc.)
 *  3. Summarization: compress old context into summaries
 *  4. Direct chat: answer the user when no specialized agent is needed
 *
 * Tool calling flow:
 *  User input → Ollama (with tool definitions) → tool_calls?
 *    YES → execute tools → send results → Ollama generates final response
 *    NO  → direct response to user
 */

const logger = require('./logger');
const memory = require('./memory');
const tools = require('./tools');
const selfLearn = require('./self-learn');

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';
// API key: env var ưu tiên, fallback hardcoded (nên chuyển sang .env)
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// Groq models thực tế — không dùng format openrouter
const GROQ_MODELS = {
  fast: 'llama-3.1-8b-instant',        // routing nhanh, tool calling đơn giản
  smart: 'openai/gpt-oss-20b',     // reasoning, tool calling phức tạp
  default: 'openai/gpt-oss-20b',
};
const MAX_TOOL_ITERATIONS = 5;

const BRAIN_SYSTEM_PROMPT = `Bạn là Brain — bộ não AI trung tâm của hệ thống Brain OS, chạy local trên máy của Nam.

## Vai trò
1. **Điều phối tự động**: phân tích input, tự quyết định gọi tool hay agent nào
2. **Sử dụng tools**: BẠN CÓ TOOLS THỰC SỰ — hãy dùng khi cần thông tin thực tế
3. **Chat trực tiếp**: câu hỏi chung, lập kế hoạch, tư vấn — không cần tool
4. **KHÔNG BAO GIỜ BỊA** thông tin thời gian, hệ thống, agents — hãy gọi tool

## Khi nào gọi tool
- Hỏi thời gian/ngày → get_current_time
- Hỏi về agents → list_agents
- Hỏi về hệ thống → get_system_status
- Cần code/debug → call_agent (dev agent)
- Cần tìm kiếm → call_agent (search agent)
- Hỏi về memory → get_memory_stats
- Cần chạy lệnh → run_command
- Bật/tắt agent → manage_agent
- Có thể gọi NHIỀU tools cùng lúc nếu cần

## Nguyên tắc
- Tiếng Việt khi user viết tiếng Việt
- Ngắn gọn, thẳng vào vấn đề
- Ưu tiên giải pháp thực tế
- Chỉ gọi tool khi CẦN THIẾT, không gọi thừa`;


let config = {
  model: GROQ_MODELS.default,
  available: false,
};

// ─── Health check ─────────────────────────────────────────────────────────────

async function checkOllama() {
  selfLearn.init();
  if (GROQ_API_KEY) {
    config.available = true;
    config.models = [GROQ_MODELS.smart, GROQ_MODELS.fast];
    logger.info('brain', `Groq ready. Model: ${config.model}`);
    return true;
  } else {
    config.available = false;
    logger.warn('brain', 'GROQ_API_KEY not set');
    return false;
  }
}

// ─── Non-streaming call with tools ────────────────────────────────────────────

async function callWithTools(messages, model) {
  const res = await fetch(GROQ_API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: model || config.model,
      messages,
      tools: tools.TOOL_DEFINITIONS,
      stream: false
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq error: ${res.status} ${err}`);
  }
  const data = await res.json();
  return data.choices[0]; // Returns { message: { role: 'assistant', content: '...', tool_calls: [...] } }
}

// ─── Stream a response from Groq (no tools, for final response) ─────────────

async function streamChat({ messages, model, onToken, onDone, onError }) {
  const useModel = model || config.model;

  try {
    const res = await fetch(GROQ_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model: useModel, messages, stream: true }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Groq error: ${res.status} ${err}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value);
      const lines = text.split('\n').filter(l => l.startsWith('data: ') && !l.includes('[DONE]'));

      for (const line of lines) {
        try {
          const chunk = JSON.parse(line.slice(6));
          const token = chunk.choices?.[0]?.delta?.content || '';
          if (token) {
            fullContent += token;
            onToken(token);
          }
        } catch { }
      }
    }

    onDone(fullContent);
    return fullContent;
  } catch (e) {
    logger.error('brain', `Stream error: ${e.message}`);
    onError(e);
    throw e;
  }
}

// ─── Non-streaming single call (for internal tasks like summarization) ────────

async function call(messages, model = null) {
  const useModel = model || config.model;
  try {
    const res = await fetch(GROQ_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model: useModel, messages, stream: false }),
    });
    if (!res.ok) throw new Error(`Groq error: ${res.status}`);
    const data = await res.json();
    return data.choices[0]?.message?.content || '';
  } catch (e) {
    logger.error('brain', `Call error: ${e.message}`);
    return null;
  }
}

// ─── Main brain chat (with tool calling) ──────────────────────────────────────

async function chat({ userInput, agentId = 'brain', onToken, onDone, onError, onToolCall }) {
  if (!config.available) {
    await checkOllama();
    if (!config.available) {
      onError(new Error('Groq API Key is not set. Please set GROQ_API_KEY environment variable.'));
      return;
    }
  }

  // Self-learn: analyze nếu user đang correction
  selfLearn.analyzeConversation({ userInput, toolsUsed: [], errors: [] });

  // Assemble prompt với context + lessons từ kinh nghiệm
  const assembled = memory.assemblePrompt({
    currentInput: userInput,
    agentId,
    systemPrompt: BRAIN_SYSTEM_PROMPT + selfLearn.buildLessonsContext(userInput),
    tokenBudget: 3000,
  });

  logger.debug('brain', `Context: ${assembled.stats.selectedMessages}/${assembled.stats.totalMessages} msgs, ~${assembled.stats.estimatedTokens} tokens, lessons: ${selfLearn.getLessonCount()}`);

  const messages = [
    { role: 'system', content: assembled.systemPrompt },
    ...assembled.context,
    { role: 'user', content: userInput }
  ];

  memory.store('user', userInput, agentId);

  const toolErrors = [];

  try {
    let response = await callWithTools(messages, config.model);

    let iterations = 0;
    let toolsUsed = false;

    while (response.message?.tool_calls?.length > 0 && iterations < MAX_TOOL_ITERATIONS) {
      toolsUsed = true;
      iterations++;

      messages.push(response.message);

      const toolCalls = response.message.tool_calls;
      logger.info('brain', `Tool calls (round ${iterations}): ${toolCalls.map(tc => tc.function.name).join(', ')}`);

      const results = await Promise.all(
        toolCalls.map(async (tc) => {
          if (onToolCall) onToolCall(tc.function.name, tc.function.arguments);
          const result = await tools.executeTool(tc);

          // Self-learn: ghi nhận lỗi tool
          if (result?.error) {
            const args = typeof tc.function.arguments === 'string'
              ? JSON.parse(tc.function.arguments)
              : tc.function.arguments;
            toolErrors.push({ tool: tc.function.name, args, error: result.error, userInput });
            selfLearn.learnFromToolError({ toolName: tc.function.name, args, error: result.error, userInput });
          }
          return result;
        })
      );

      for (let i = 0; i < toolCalls.length; i++) {
        messages.push({
          role: 'tool',
          tool_call_id: toolCalls[i].id,
          name: toolCalls[i].function.name,
          content: JSON.stringify(results[i])
        });
      }

      response = await callWithTools(messages, config.model);
    }

    if (toolsUsed) {
      await streamChat({
        messages,
        model: config.model,
        onToken,
        onDone: (content) => {
          memory.store('assistant', content, agentId);
          logger.info('brain', `Responded with tools (${iterations} rounds, ${content.length} chars)`);
          onDone(content, { ...assembled.stats, toolsUsed: true, toolIterations: iterations });
        },
        onError
      });
    } else {
      const content = response.message?.content || '';
      onToken(content);
      memory.store('assistant', content, agentId);
      logger.info('brain', `Responded directly (${content.length} chars)`);
      onDone(content, { ...assembled.stats, toolsUsed: false });
    }

  } catch (e) {
    logger.error('brain', `Chat error: ${e.message}`);
    onError(e);
  }
}

// ─── Summarize old context ────────────────────────────────────────────────────

async function summarizeHistory(agentId = 'brain') {
  const hist = memory.getHistory(agentId, 50);
  if (hist.length < 20) return null;

  const toSummarize = hist.slice(0, -10);
  const prompt = `Summarize the following conversation history concisely (max 200 words). Extract key facts, decisions, and context that might be needed later:\n\n${toSummarize.map(m => `${m.role}: ${m.content}`).join('\n')}`;

  const summary = await call([
    { role: 'system', content: 'You are a summarization assistant. Be concise and factual.' },
    { role: 'user', content: prompt }
  ]);

  if (summary) {
    memory.storeSummary(agentId, summary, toSummarize.map(m => m.id));
    logger.info('brain', `Summarized ${toSummarize.length} messages → ${summary.length} chars`);
  }

  return summary;
}

// ─── Route: ask brain to decide which agent should handle input ───────────────

async function routeToAgent(userInput, availableAgents) {
  if (!availableAgents.length) return null;

  const agentList = availableAgents.map(a => `- ${a.id}: ${a.description}`).join('\n');
  const prompt = `Given this user message: "${userInput}"\n\nAvailable agents:\n${agentList}\n\nWhich agent ID is most appropriate? Reply with ONLY the agent ID, or "brain" if none fits.`;

  const result = await call([
    { role: 'system', content: 'You route user requests to the appropriate agent. Reply with only the agent ID.' },
    { role: 'user', content: prompt }
  ]);

  const agentId = result?.trim().toLowerCase();
  const valid = availableAgents.find(a => a.id === agentId);
  return valid ? agentId : null;
}

module.exports = {
  init: checkOllama,
  checkOllama,
  chat,
  streamChat,
  call,
  summarizeHistory,
  routeToAgent,
  getConfig: () => config,
  setModel: (model) => { config.model = model; },
  BRAIN_SYSTEM_PROMPT,
};