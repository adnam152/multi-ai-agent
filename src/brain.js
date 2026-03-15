/**
 * brain.js — Orchestrator sử dụng GitHub Copilot (via copilot-api local proxy)
 *
 * Thay thế hoàn toàn Groq. Brain giao tiếp với copilot-api chạy local:
 *   npx copilot-api@latest start   →  http://localhost:4141
 *
 * copilot-api expose OpenAI-compatible endpoint nên request format giữ nguyên.
 *
 * Setup 1 lần:
 *   npx copilot-api@latest auth      ← đăng nhập GitHub (device flow)
 *   npx copilot-api@latest start     ← giữ chạy (hoặc dùng daemon)
 *
 * Model names (Copilot Pro):
 *   gpt-4o          — balanced, x1 premium
 *   gpt-4o-mini     — nhanh, FREE (unlimited)
 *   gpt-4.1         — mới, x1 premium
 *   gpt-4.1-mini    — nhanh, FREE (unlimited)
 *   claude-sonnet-4.5      — mạnh nhất Claude, x1 premium
 *   claude-haiku-3.5  — nhanh, x1 premium
 *   o1-mini         — reasoning, x3 premium
 *   o3-mini         — reasoning mạnh, x3 premium
 *   gemini-2.0-flash — nhanh, FREE (unlimited)
 */

const logger = require('./logger');
const tools = require('./tools');
const memory = require('./memory');

// ─── Config ───────────────────────────────────────────────────────────────────

const COPILOT_BASE = process.env.COPILOT_API_URL || 'http://localhost:4141';
const COPILOT_CHAT = `${COPILOT_BASE}/v1/chat/completions`;
const COPILOT_MODELS = `${COPILOT_BASE}/v1/models`;

const config = {
  available: false,
  model: 'gpt-5-mini',
  models: [],
  provider: 'copilot',
  baseUrl: COPILOT_BASE,
};

// ─── Known Copilot models with quota info ─────────────────────────────────────

const KNOWN_MODELS = [
  { id: 'gpt-5-mini',        quota: 'free',    label: 'GPT-5 Mini (Free)' },
  { id: 'gpt-4.1-mini',       quota: 'free',    label: 'GPT-4.1 Mini (Free)' },
  { id: 'gpt-4o-mini',        quota: 'free',    label: 'GPT-4o Mini (Free)' },
  { id: 'gemini-2.0-flash',   quota: 'free',    label: 'Gemini 2.0 Flash (Free)' },
  { id: 'gpt-4.1',            quota: 'x1',      label: 'GPT-4.1 (x1)' },
  { id: 'gpt-4o',             quota: 'x1',      label: 'GPT-4o (x1)' },
  { id: 'claude-sonnet-4.5',  quota: 'x1',      label: 'Claude Sonnet 4.5 (x1)' },
  { id: 'claude-haiku-3.5',   quota: 'x1',      label: 'Claude Haiku 3.5 (x1)' },
  { id: 'o1-mini',            quota: 'x3',      label: 'o1 Mini (x3 premium)' },
  { id: 'o3-mini',            quota: 'x3',      label: 'o3 Mini (x3 premium)' },
  { id: 'o1',                 quota: 'x5',      label: 'o1 (x5 premium)' },
];

// ─── Check copilot-api availability ───────────────────────────────────────────

async function checkOllama() { // kept as checkOllama for API compatibility
  try {
    const res = await fetch(COPILOT_MODELS, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = await res.json();
      // Merge discovered models with known quota info
      const discovered = (data.data || []).map(m => {
        const known = KNOWN_MODELS.find(k => k.id === m.id);
        return known || { id: m.id, quota: 'x1', label: m.id };
      });
      config.models = discovered.length ? discovered : KNOWN_MODELS;
      config.available = true;
      logger.info('brain', `✅ copilot-api connected at ${COPILOT_BASE}. Model: ${config.model}`);
      return true;
    }
  } catch (e) {
    // Not running
  }
  config.available = false;
  logger.warn('brain', `copilot-api not reachable at ${COPILOT_BASE}. Run: npx copilot-api@latest start`);
  return false;
}

function setModel(model) {
  config.model = model || 'gpt-5-mini';
  logger.info('brain', `Model set: ${config.model}`);
}

function getConfig() { return { ...config }; }

// ─── Brain system prompt ───────────────────────────────────────────────────────

const BRAIN_SYSTEM = `Bạn là Brain — bộ não AI trung tâm của hệ thống Brain OS.

NHIỆM VỤ CHÍNH:
- Trả lời câu hỏi thông thường trực tiếp và ngắn gọn
- Tự quyết định khi nào cần gọi tool (không gọi thừa)
- Giao task phức tạp cho đúng agent chuyên biệt qua call_agent
- KHÔNG BAO GIỜ BỊA thông tin — gọi tool khi cần dữ liệu thực

TOOLS có thể dùng song song (parallel) khi cần nhiều thông tin cùng lúc.

─── TẠO AGENT MỚI ───
Khi user muốn tạo agent mới, hãy làm wizard từng bước:

Bước 1 — Hỏi mục đích:
"Bạn muốn agent này làm gì? (VD: viết nội dung, dịch thuật, phân tích dữ liệu, coding...)"

Bước 2 — Đề xuất tên + description, xác nhận với user.

Bước 3 — Hỏi provider/model, đưa ra gợi ý phù hợp:
• Copilot gpt-5-mini — miễn phí, tốt cho hầu hết tác vụ
• Copilot gpt-4.1 — mạnh hơn, tốt cho writing/analysis
• Copilot claude-sonnet-4-5 — tốt nhất cho coding/analysis (x1 quota)
• Gemini gemini-2.0-flash — nhanh, miễn phí, tốt cho search/research
Hỏi: "Bạn muốn dùng provider nào? [1] Copilot gpt-5-mini (free) [2] Copilot gpt-4.1 [3] Copilot claude-sonnet-4-5 [4] Gemini"

Bước 4 — Tự soạn system prompt chuyên nghiệp dựa trên mục đích, hỏi user có muốn chỉnh không.

Bước 5 — Hỏi có muốn thêm skills cụ thể không (VD: "Luôn trả lời tiếng Việt", "Dùng markdown tables khi so sánh").

Bước 6 — Xác nhận lần cuối rồi gọi tool create_agent.

Sau khi tạo xong, thông báo rõ: agent đã sẵn sàng, hướng dẫn chọn trong dropdown Chat.

Trả lời bằng tiếng Việt trừ khi user dùng ngôn ngữ khác.`;

// ─── Non-streaming call with tools ────────────────────────────────────────────

async function callWithTools(messages, model) {
  const useModel = model || config.model;
  const res = await fetch(COPILOT_CHAT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: useModel,
      messages,
      tools: tools.TOOL_DEFINITIONS,
      tool_choice: 'auto',
      stream: false,
      max_tokens: 4096,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`copilot-api error: ${res.status} ${err}`);
  }
  const data = await res.json();
  return data.choices[0];
}

// ─── Stream response (no tools, for final answer) ─────────────────────────────

async function streamChat({ messages, model, onToken, onDone, onError }) {
  const useModel = model || config.model;

  try {
    const res = await fetch(COPILOT_CHAT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: useModel, messages, stream: true, max_tokens: 4096 }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`copilot-api stream error: ${res.status} ${err}`);
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

// ─── Non-streaming single call (summarization, internal tasks) ────────────────

async function call(messages, model = null) {
  const useModel = model || config.model;
  try {
    const res = await fetch(COPILOT_CHAT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: useModel, messages, stream: false, max_tokens: 2048 }),
    });
    if (!res.ok) throw new Error(`copilot-api: ${res.status}`);
    const data = await res.json();
    return data.choices[0]?.message?.content || '';
  } catch (e) {
    logger.error('brain', `Call error: ${e.message}`);
    return null;
  }
}

// ─── Main brain chat (with tool calling loop) ─────────────────────────────────

async function chat({ userInput, agentId = 'brain', onToken, onDone, onError, onToolCall }) {
  if (!config.available) {
    await checkOllama();
    if (!config.available) {
      onError(new Error(
        'copilot-api chưa chạy. Hãy chạy: npx copilot-api@latest start\n' +
        '(Lần đầu: npx copilot-api@latest auth để đăng nhập GitHub)'
      ));
      return;
    }
  }

  // Assemble context from memory
  const assembled = memory.assemblePrompt({
    currentInput: userInput,
    agentId,
    systemPrompt: BRAIN_SYSTEM,
    tokenBudget: 4000,
  });

  const messages = [
    { role: 'system', content: assembled.systemPrompt },
    ...assembled.context,
    { role: 'user', content: userInput },
  ];

  logger.debug('brain', `Chat start. Context: ${assembled.stats.selectedMessages} msgs, ~${assembled.stats.estimatedTokens} tokens`);

  // Store user input
  memory.store('user', userInput, agentId);

  // Tool calling loop (max 5 iterations)
  let loopMessages = [...messages];
  let loopCount = 0;
  const MAX_LOOPS = 5;

  while (loopCount < MAX_LOOPS) {
    loopCount++;

    let choice;
    try {
      choice = await callWithTools(loopMessages, config.model);
    } catch (e) {
      logger.error('brain', `Tool loop error: ${e.message}`);
      onError(e);
      return;
    }

    const msg = choice.message;

    // No tool calls → stream final response
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      // If content already exists, stream it
      if (msg.content) {
        // Stream word by word for smooth UX
        const words = msg.content.split('');
        for (const char of words) onToken(char);
        memory.store('assistant', msg.content, agentId);
        onDone(msg.content, assembled.stats);
      } else {
        // Re-call without tools for streaming
        const finalMessages = [...loopMessages, msg];
        await streamChat({
          messages: finalMessages,
          model: config.model,
          onToken,
          onDone: (content) => {
            memory.store('assistant', content, agentId);
            onDone(content, assembled.stats);
          },
          onError,
        });
      }
      return;
    }

    // Execute tools
    logger.debug('brain', `Tool calls: ${msg.tool_calls.map(t => t.function.name).join(', ')}`);

    // Notify UI about tool calls
    if (onToolCall) {
      msg.tool_calls.forEach(tc => {
        onToolCall({
          tool: tc.function.name,
          args: tc.function.arguments,
        });
      });
    }

    loopMessages.push(msg);

    // Execute tools in parallel
    const toolResults = await tools.executeToolsParallel(
      msg.tool_calls.map(tc => ({
        id: tc.id,
        function: {
          name: tc.function.name,
          arguments: typeof tc.function.arguments === 'string'
            ? JSON.parse(tc.function.arguments || '{}')
            : tc.function.arguments,
        },
      }))
    );

    // Add tool results to messages
    for (let i = 0; i < msg.tool_calls.length; i++) {
      loopMessages.push({
        role: 'tool',
        tool_call_id: msg.tool_calls[i].id,
        content: JSON.stringify(toolResults[i]),
      });
    }
  }

  // Max loops reached — stream whatever we have
  await streamChat({
    messages: loopMessages,
    model: config.model,
    onToken,
    onDone: (content) => {
      memory.store('assistant', content, agentId);
      onDone(content, assembled.stats);
    },
    onError,
  });
}

// ─── Summarize history ─────────────────────────────────────────────────────────

async function summarizeHistory(agentId = 'brain') {
  const history = memory.getHistory(agentId, 50);
  if (history.length < 10) return 'Chưa đủ lịch sử để tóm tắt.';

  const text = history
    .slice(-50)
    .map(m => `${m.role}: ${m.content}`)
    .join('\n');

  const result = await call([
    {
      role: 'user',
      content: `Tóm tắt ngắn gọn cuộc hội thoại sau, giữ các thông tin quan trọng:\n\n${text}`,
    },
  ]);

  if (result) memory.storeSummary(agentId, result, []);
  return result || 'Không thể tóm tắt.';
}

module.exports = {
  checkOllama,
  setModel,
  getConfig,
  chat,
  call,
  streamChat,
  summarizeHistory,
  KNOWN_MODELS,
};