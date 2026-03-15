#!/usr/bin/env node
/**
 * seed-context.js — Inject initial project context into Brain memory
 *
 * Chạy 1 lần sau khi cài đặt:
 *   node seed-context.js
 *
 * Hoặc reset và seed lại:
 *   node seed-context.js --reset
 */

const fs = require('fs');
const path = require('path');
const { MEMORY_CONSTANTS, LOGGER_CONSTANTS } = require('./src/constants');

const DATA_DIR = path.join(__dirname, 'data');
const MEMORY_FILE = path.join(DATA_DIR, 'memory.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const reset = process.argv.includes('--reset');

let memory = [];
if (!reset && fs.existsSync(MEMORY_FILE)) {
  try { memory = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8')); } catch {}
}

memory = memory.filter(m => !m._seeded);

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
    content: `Brain OS là hệ thống AI orchestration chạy local. Kiến trúc:

- **Orchestrator**: GitHub Copilot qua copilot-api (http://localhost:4141) — thay Groq/Ollama
- **Prompt Assembler**: lọc context thông minh (recency 50% + keyword 40% + role 10%), budget 10000 tokens
- **Agents**: AI chuyên biệt với skills + context riêng (Claude, Gemini, OpenRouter, OpenAI, Copilot)
- **14 Tools**: thời gian, agents, system, CLI, pipeline, file I/O, HTTP request, web search, Telegram
- **Memory**: DB-first, fallback file trong backend/data
- **Telegram**: điều khiển từ xa
- **Web UI**: React + Vite, backend serve frontend/dist

Không cần Ollama. Orchestrator dùng Copilot Pro (free models: gpt-4.1-mini, gpt-4o-mini, gemini-2.0-flash).`,
    timestamp: ts(119),
  },

  // ── File structure ────────────────────────────────────────────────────────
  {
    role: 'user',
    content: 'Cấu trúc file của Brain OS như thế nào?',
    timestamp: ts(110),
  },
  {
    role: 'assistant',
    content: `brain-os/
├── backend/
│   ├── server.js      # Express + WebSocket, port 3333
│   ├── seed-context.js
│   ├── src/
│   │   ├── brain.js
│   │   ├── tools.js
│   │   ├── memory.js
│   │   ├── agents.js
│   │   ├── self-learn.js
│   │   ├── logger.js
│   │   ├── telegram.js
│   │   ├── db.js
│   │   └── constants.js
│   └── data/          # fallback JSON khi không dùng DB
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── constants.js
│   │   ├── hooks/useWebSocket.js
│   │   └── components/*
│   └── dist/
├── context.md         # Context file import vào conversation mới
├── README.md          # Hướng dẫn setup
└── package.json`,
    timestamp: ts(109),
  },

  // ── Copilot provider ──────────────────────────────────────────────────────
  {
    role: 'user',
    content: 'Brain OS dùng Copilot như thế nào? Setup ra sao?',
    timestamp: ts(100),
  },
  {
    role: 'assistant',
    content: `Brain OS dùng GitHub Copilot qua copilot-api (open source: ericc-ch/copilot-api).

Setup 1 lần:
1. \`npx copilot-api@latest auth\` → đăng nhập GitHub (device flow, mở URL)
2. \`npx copilot-api@latest start\` → giữ chạy tại http://localhost:4141

copilot-api expose OpenAI-compatible API → Brain OS gọi như bình thường.

Models Copilot Pro:
- FREE (unlimited): gpt-4.1-mini, gpt-4o-mini, gemini-2.0-flash
- x1 premium: gpt-4.1, gpt-4o, claude-sonnet-4.5, claude-haiku-3.5
- x3 premium: o1-mini, o3-mini (reasoning models)

Brain dùng gpt-4.1-mini mặc định (free, nhanh).
Đổi model: \`node backend/server.js --model gpt-4.1\` hoặc qua API POST /api/brain/model.`,
    timestamp: ts(99),
  },

  // ── Agents with skills & context ──────────────────────────────────────────
  {
    role: 'user',
    content: 'Tính năng skills và context của agents hoạt động thế nào?',
    timestamp: ts(90),
  },
  {
    role: 'assistant',
    content: `Mỗi agent trong Brain OS nay có 3 phần system prompt:

1. systemPrompt: prompt cơ bản (giống cũ)

2. skills[]: danh sách instructions riêng, ví dụ:
   - "Luôn cung cấp code examples đầy đủ"
   - "Ưu tiên Node.js/JavaScript"
   Skills được append vào system prompt dưới dạng "## Skills & Instructions"

3. contextNotes: string tích lũy qua thời gian
   - Nếu autoUpdateContext=true: tự động update sau mỗi reply
   - Format: "[timestamp] Q: ... → A: ..."
   - Giúp agent "nhớ" preference và patterns của user

Cấu hình agents.json:
{
  id, name, provider, model, systemPrompt,
  skills: ["skill 1", "skill 2"],
  contextNotes: "...",
  autoUpdateContext: true
}

API mới:
- GET/PUT /api/agents/:id/skills
- GET/PUT/DELETE /api/agents/:id/context`,
    timestamp: ts(89),
  },

  // ── Tools ─────────────────────────────────────────────────────────────────
  {
    role: 'user',
    content: 'Brain OS có những tools gì mới?',
    timestamp: ts(80),
  },
  {
    role: 'assistant',
    content: `Brain OS nay có 14 tools (thêm 4 tools mới):

Tools mới:
11. read_file: Đọc file local (whitelist: project dir, workspace, Documents)
  - Giới hạn: 512KB, 10000 chars output
    
12. write_file: Ghi file local (whitelist paths)
    - mode: overwrite | append
    
13. http_request: HTTP GET/POST tới external API
    - Headers tùy chỉnh, timeout, auto-parse JSON
    
14. search_web: Tìm kiếm web qua DuckDuckGo Instant API
    - Trả về abstract + related topics
    - max_results: 1-10

Tools cũ vẫn còn: get_current_time, list_agents, get_system_status, call_agent,
manage_agent, get_memory_stats, run_command, run_pipeline, save_lesson, send_telegram.

Tool calling dùng OpenAI-compatible format (tool_calls trong response).`,
    timestamp: ts(79),
  },

  // ── Goals & roadmap ────────────────────────────────────────────────────────
  {
    role: 'user',
    content: 'Mục tiêu và roadmap hiện tại của Brain OS?',
    timestamp: ts(70),
  },
  {
    role: 'assistant',
    content: `Mục tiêu của Nam:
- AI content pipeline tự động 24/7 (faceless YouTube/TikTok + affiliate marketing)
- Không tốn chi phí (dùng Copilot Pro + free tiers)
- Setup đơn giản, hands-on

Roadmap:
✅ Phase 1: Core (chat + memory + agents + telegram + logs + web UI)
✅ Phase 2A: Tool Calling (14 tools — file I/O, HTTP, web search)
✅ Phase 2B: GitHub Copilot orchestrator (thay Groq)
✅ Phase 2C: Per-agent skills & context
⬜ Phase 3: Self-improvement (brain tự update system prompt từ error logs)
⬜ Phase 4: Content pipeline (kết nối tạo video tự động)
⬜ Phase 5: Multi-agent (nhiều brain song song)`,
    timestamp: ts(69),
  },

  // ── Nam preferences ────────────────────────────────────────────────────────
  {
    role: 'user',
    content: 'Nam thích làm việc theo phong cách nào?',
    timestamp: ts(60),
  },
  {
    role: 'assistant',
    content: `Phong cách làm việc của Nam:
- CLI/terminal, không thích UI phức tạp
- Hands-on: thích xem code thực tế, không phải mô tả chung chung
- Troubleshoot sâu: muốn hiểu rõ vấn đề trước khi fix
- Tiết kiệm: ưu tiên free/cheap solutions (Copilot Pro, API free tiers)
- Node.js/JavaScript là stack chính
- Windows desktop + Linux server (8GB RAM)`,
    timestamp: ts(59),
  },
];

// Append _seeded flag
const seededEntries = seeds.map(s => ({
  ...s,
  agentId: 'brain',
  id: Date.now().toString(36) + Math.random().toString(36).slice(2, 2 + LOGGER_CONSTANTS.RANDOM_ID_SUFFIX_LENGTH),
  _seeded: true,
}));

memory.push(...seededEntries);

if (memory.length > MEMORY_CONSTANTS.MAX_HISTORY) {
  memory = memory.filter(m => m._seeded).concat(
    memory.filter(m => !m._seeded).slice(-MEMORY_CONSTANTS.MAX_HISTORY + seededEntries.length)
  );
}

fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
console.log(`✅ Seeded ${seededEntries.length} entries into brain memory`);
console.log(`   Total messages: ${memory.length}`);
if (reset) console.log('   (Full reset performed)');