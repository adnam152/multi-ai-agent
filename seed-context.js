#!/usr/bin/env node
/**
 * seed-context.js — Inject initial project context into Brain memory
 *
 * Chạy 1 lần sau khi cài đặt:
 *   node seed-context.js
 *
 * Hoặc reset và seed lại:
 *   node seed-context.js --reset
 *
 * Context này được lưu vào data/memory.json với agentId='brain'
 * và sẽ được Prompt Assembler chọn lọc khi liên quan.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const MEMORY_FILE = path.join(DATA_DIR, 'memory.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const reset = process.argv.includes('--reset');

// ─── Load existing memory ─────────────────────────────────────────────────────
let memory = [];
if (!reset && fs.existsSync(MEMORY_FILE)) {
  try { memory = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8')); } catch {}
}

// Remove old seed entries nếu có
memory = memory.filter(m => !m._seeded);

// ─── Seed entries ─────────────────────────────────────────────────────────────
// Format: { role, content, agentId, _seeded: true }
// Viết dưới dạng Q&A tự nhiên để scoring keyword hoạt động tốt nhất

const now = Date.now();
const ts = (offsetMinutes) => now - offsetMinutes * 60 * 1000;

const seeds = [

  // ── Project overview ──────────────────────────────────────────────────────
  {
    role: 'user',
    content: 'Brain OS là gì? Hệ thống này dùng để làm gì?',
    timestamp: ts(120),
  },
  {
    role: 'assistant',
    content: `Brain OS là hệ thống AI orchestration chạy local. Kiến trúc gồm:
- Brain (Ollama local): bộ não nhỏ, nhanh, làm nhiệm vụ routing + quản lý context
- Prompt Assembler: lọc context thông minh theo score (recency 50% + keyword 40% + role 10%), giới hạn 3000 tokens
- Agents: các AI chuyên biệt (Claude cho code, Gemini cho search, OpenRouter cho nhiều model)
- Memory: lưu toàn bộ lịch sử local, không gửi full context như OpenClaw
- Telegram: điều khiển từ xa
- Web UI: port 3333, 4 tab (Chat, Agents, Telegram, Logs)

Mục tiêu chính: tiết kiệm token, không bị giới hạn context window, mở rộng được.`,
    timestamp: ts(119),
  },

  // ── File structure ─────────────────────────────────────────────────────────
  {
    role: 'user',
    content: 'Cấu trúc file của Brain OS như thế nào?',
    timestamp: ts(110),
  },
  {
    role: 'assistant',
    content: `brain-os/
├── server.js          # Entry point: Express + WebSocket, port 3333
├── seed-context.js    # Script này — inject context ban đầu
├── package.json       # Dependencies: express, ws, node-telegram-bot-api
├── src/
│   ├── brain.js       # Ollama integration: streamChat, chat(), summarizeHistory(), routeToAgent()
│   ├── memory.js      # Prompt Assembler: store(), assemblePrompt(), clearHistory()
│   ├── agents.js      # CRUD agents + callClaude/callGemini/callOpenRouter()
│   ├── logger.js      # Log system: realtime broadcast qua WebSocket
│   └── telegram.js    # Telegram bot: auto-reconnect, forward đến brain
├── public/
│   └── index.html     # SPA toàn bộ UI (844 dòng, không có external framework)
└── data/              # Tự tạo khi chạy
    ├── memory.json    # Conversation history (max 500 msgs)
    ├── agents.json    # Agent configs (có apiKey trực tiếp)
    ├── summaries.json # Compressed context
    ├── logs.json      # System logs (max 1000 entries)
    └── config.json    # Telegram token, settings`,
    timestamp: ts(109),
  },

  // ── Agents config ──────────────────────────────────────────────────────────
  {
    role: 'user',
    content: 'Các agents hiện tại được cấu hình như thế nào?',
    timestamp: ts(100),
  },
  {
    role: 'assistant',
    content: `Agents hiện tại:

1. Brain (built-in, không cần config)
   - Provider: Ollama local
   - Model: qwen2.5:3b (hoặc llama3.2:3b)
   - Nhiệm vụ: routing, chat thông thường, summarize

2. Dev Agent
   - Provider: Claude (Anthropic) hoặc Gemini
   - Model: claude-opus-4-5 hoặc gemini-2.0-flash
   - Dùng khi: code, debug, architecture, technical questions
   - API key: lưu trực tiếp trong agents.json (field apiKey)

3. Search Agent
   - Provider: Gemini
   - Model: gemini-2.0-flash
   - Dùng khi: tìm kiếm thông tin, research, tin tức mới

4. OpenRouter agent (mới thêm)
   - Provider: openrouter
   - Model: openai/gpt-4o-mini (format phải có prefix provider/)
   - API key: nhập trực tiếp vào UI, không cần env var

Thêm agent mới: UI tab Agents → New Agent.`,
    timestamp: ts(99),
  },

  // ── Memory & context system ────────────────────────────────────────────────
  {
    role: 'user',
    content: 'Hệ thống memory và context filtering hoạt động thế nào?',
    timestamp: ts(90),
  },
  {
    role: 'assistant',
    content: `Prompt Assembler trong memory.js hoạt động theo 3 bước:

1. Score mỗi message trong history:
   - Recency score (50%): message mới hơn = score cao hơn
   - Keyword overlap (40%): extract keywords từ input hiện tại, so sánh với content message
   - Role bonus (10%): user messages ưu tiên nhẹ hơn assistant

2. Chọn messages trong token budget (3000 tokens ~ 12000 chars):
   - Sort by score descending
   - Pick cho đến khi đủ budget
   - Luôn giữ 6 messages gần nhất dù score thấp (alwaysIncludeLastN)

3. Re-sort by timestamp → gửi cho LLM theo thứ tự tự nhiên

Kết quả: conversation dài vẫn không bị lỗi context window, luôn giữ thông tin liên quan nhất.
Summarize: gọi /api/memory/summarize để brain tóm tắt 50 message cũ → lưu summaries.json.`,
    timestamp: ts(89),
  },

  // ── Known issues & fixes ───────────────────────────────────────────────────
  {
    role: 'user',
    content: 'Có bug nào đã được fix trong Brain OS không?',
    timestamp: ts(80),
  },
  {
    role: 'assistant',
    content: `Các bug đã fix:

1. AI reply vào đoạn hội thoại cũ (không tạo message mới)
   - Nguyên nhân: dùng getElementById('current-bubble') tìm nhầm bubble cũ trong DOM
   - Fix: dùng direct DOM reference (div.querySelector('.msg-bubble'))

2. API key OpenRouter "not set" dù đã nhập
   - Nguyên nhân: UI lưu apiKeyVar (tên env var) nhưng runAgent không đọc field đó
   - Fix: thêm resolveApiKey() với fallback chain: direct value → env var by name → default env

3. Model name OpenRouter sai format
   - Sai: GPT-4o-mini
   - Đúng: openai/gpt-4o-mini (phải có prefix provider/)

4. Lịch sử chat không hiển thị khi refresh
   - Fix: load từ /api/memory khi WS connect, render 30 message gần nhất
   - Load more: click button để xem thêm (pagination)`,
    timestamp: ts(79),
  },

  // ── Goals & roadmap ────────────────────────────────────────────────────────
  {
    role: 'user',
    content: 'Mục tiêu và roadmap của project này là gì?',
    timestamp: ts(70),
  },
  {
    role: 'assistant',
    content: `Mục tiêu của Nam:
- Xây dựng AI content pipeline tự động 24/7 (faceless YouTube/TikTok + affiliate marketing)
- Tạo thu nhập phụ từ AI tools trong 1-2 tháng thử nghiệm
- Setup không tốn chi phí ban đầu (dùng API keys có sẵn)

Roadmap Brain OS:
✅ Phase 1 (xong): Core system — chat, memory, agents, telegram, logs, web UI
⬜ Phase 2: Self-improvement — brain đọc error logs, tự update system prompt
⬜ Phase 3: CLI tools — brain chạy được lệnh local (cli-anything integration)
⬜ Phase 4: Content pipeline — kết nối workflow tạo video tự động
⬜ Phase 5: Multi-agent — nhiều brain instance song song, chuyên biệt hơn

Hardware: Windows (Brain OS) + Linux machine 8GB RAM (media processing, Veo3)`,
    timestamp: ts(69),
  },

  // ── Tech preferences ───────────────────────────────────────────────────────
  {
    role: 'user',
    content: 'Nam thích làm việc theo phong cách nào? Có preference gì không?',
    timestamp: ts(60),
  },
  {
    role: 'assistant',
    content: `Phong cách và preference của Nam:
- Thích CLI và hands-on hơn GUI config phức tạp
- Muốn hiểu cơ chế hoạt động, không chỉ dùng blackbox
- Prefer interactive approach (wizard, step-by-step) hơn manual editing
- Kỹ năng mạnh: Node.js, Linux, API integration, troubleshooting sâu
- Đã dùng: OpenClaw, OpenRouter, Claude Pro, Gemini Pro
- Đã bỏ OpenClaw vì full context forwarding → tốn token + giới hạn context window
- Ngôn ngữ giao tiếp: tiếng Việt

Khi giải thích technical: đi thẳng vào vấn đề, chỉ ra đúng file/dòng cần sửa, không cần giải thích dài dòng.`,
    timestamp: ts(59),
  },
];

// ─── Write to memory ──────────────────────────────────────────────────────────
const newEntries = seeds.map((s, i) => ({
  id: 'seed-' + i + '-' + Date.now().toString(36),
  role: s.role,
  content: s.content,
  agentId: 'brain',
  timestamp: s.timestamp,
  _seeded: true,
}));

memory = [...newEntries, ...memory];
fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log('\x1b[32m✓\x1b[0m Seed context xong!');
console.log(`  → Đã inject \x1b[36m${newEntries.length}\x1b[0m entries vào memory`);
console.log(`  → Total: \x1b[36m${memory.length}\x1b[0m messages trong data/memory.json`);
console.log('');
console.log('  Khởi động lại Brain OS:');
console.log('  \x1b[33mnode server.js\x1b[0m');
console.log('');