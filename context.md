# Brain OS — Conversation Context
> Import file này vào conversation mới để tiếp tục phát triển project

---

## Project tổng quan

**Brain OS** — hệ thống AI orchestration chạy hoàn toàn local trên máy Windows của Nam.

**Orchestrator**: GitHub Copilot (thay Groq/Ollama) — proxy qua `copilot-api` local tại `http://localhost:4141`.
Không cần Ollama. Brain dùng Copilot Pro (đã có sẵn) để routing + tool calling + chat.

---

## Stack & Files

```
brain-os/
├── server.js            # Express + WebSocket, port 3333
├── seed-context.js      # Inject initial project knowledge vào brain memory
├── package.json         # express, ws, node-telegram-bot-api
├── src/
│   ├── brain.js         # Copilot orchestrator + Tool Calling loop
│   ├── tools.js         # 14 tools (đọc/ghi file, HTTP, web search, v.v.)
│   ├── memory.js        # Prompt Assembler: score context (recency 50% + keyword 40% + role 10%)
│   ├── agents.js        # CRUD agents + skills/context per-agent + 5 providers
│   ├── self-learn.js    # Tự học từ lỗi + corrections
│   ├── logger.js        # Realtime log broadcast qua WebSocket
│   └── telegram.js      # Telegram bot polling
├── public/
│   └── index.html       # SPA: Chat / Agents / Telegram / Logs
└── data/                # memory.json, agents.json, logs.json, lessons.json
```

Khởi động:
```bash
npx copilot-api@latest start   # bắt buộc (giữ chạy)
node server.js [--port 3333] [--model gpt-4.1-mini]
```

---

## GitHub Copilot Provider

Brain OS dùng **copilot-api** (ericc-ch/copilot-api) làm local proxy:
- Expose OpenAI-compatible endpoint: `http://localhost:4141`
- Auth: GitHub device flow (1 lần): `npx copilot-api@latest auth`
- Không cần API key thêm — dùng Copilot Pro subscription

### Setup lần đầu
```bash
npm install -g copilot-api    # hoặc dùng npx
copilot-api auth              # đăng nhập GitHub
copilot-api start             # giữ chạy (cổng 4141)
```

### Models Copilot Pro

| Model | Quota | Ghi chú |
|-------|-------|---------|
| `gpt-4.1-mini` | Free (unlimited) | Mặc định cho Brain |
| `gpt-4o-mini` | Free (unlimited) | Nhanh |
| `gemini-2.0-flash` | Free (unlimited) | Google |
| `gpt-4.1` | x1 premium | Balanced |
| `gpt-4o` | x1 premium | |
| `claude-sonnet-4.5` | x1 premium | Claude |
| `claude-haiku-3.5` | x1 premium | Claude nhanh |
| `o1-mini` | x3 premium | Reasoning |
| `o3-mini` | x3 premium | Reasoning mạnh |

---

## Agents System (nâng cấp)

Mỗi agent có:
- `provider`: copilot | claude | gemini | openrouter | openai
- `model`: model name
- `systemPrompt`: prompt chính
- `skills[]`: danh sách instructions/skills riêng
- `contextNotes`: notes tích lũy (tự update sau mỗi reply)
- `autoUpdateContext`: bật thì tự update contextNotes

### Providers

| Provider | API Key | Endpoint |
|----------|---------|----------|
| copilot | ❌ (dùng copilot-api) | localhost:4141 |
| claude | ANTHROPIC_API_KEY | api.anthropic.com |
| gemini | GEMINI_API_KEY | generativelanguage.googleapis.com |
| openrouter | OPENROUTER_API_KEY | openrouter.ai |
| openai | OPENAI_API_KEY | api.openai.com |

### Default Agents

| Agent | Provider | Model |
|-------|----------|-------|
| Dev Agent | copilot | gpt-4.1 |
| Search Agent | gemini | gemini-2.0-flash |

---

## Tools (14 tools)

| Tool | Mô tả |
|------|-------|
| `get_current_time` | Thời gian hiện tại VN |
| `list_agents` | Liệt kê agents + status |
| `get_system_status` | CPU, RAM, uptime |
| `call_agent` | Gọi agent chuyên biệt |
| `manage_agent` | Bật/tắt agent |
| `get_memory_stats` | Thống kê memory |
| `run_command` | Shell (whitelist read-only) |
| `run_pipeline` | Parallel/sequential agents |
| `save_lesson` | Lưu bài học self-learn |
| `send_telegram` | Gửi Telegram chủ động |
| `read_file` | Đọc file local (whitelist) |
| `write_file` | Ghi file local (whitelist) |
| `http_request` | HTTP GET/POST external API |
| `search_web` | DuckDuckGo search |

---

## Memory & Context

Prompt Assembler (memory.js):
- Score = 0.5×recency + 0.4×keyword + 0.1×role
- Token budget: 4000 (tăng từ 3000)
- Always keep last 6 messages
- Mỗi agent có memory riêng (phân tách theo agentId)

---

## API Endpoints

```
GET  /api/status              — brain + system status
POST /api/brain/check         — kiểm tra copilot-api
POST /api/brain/model         — đổi model
GET  /api/agents              — danh sách agents
POST /api/agents              — tạo agent
PUT  /api/agents/:id          — sửa agent
GET  /api/agents/:id/skills   — xem skills
PUT  /api/agents/:id/skills   — cập nhật skills
GET  /api/agents/:id/context  — xem context notes
PUT  /api/agents/:id/context  — cập nhật context notes
DELETE /api/agents/:id/context — xóa context notes
GET  /api/tools               — danh sách tools
GET  /api/memory              — chat history
GET  /api/lessons             — self-learn lessons
GET  /api/logs                — system logs
```

---

## Về Nam (user)

- Mục tiêu: AI content pipeline tự động 24/7 (YouTube/TikTok faceless + affiliate marketing)
- Hardware: Windows (Brain OS) + Linux 8GB RAM/256GB (media processing)
- API: Claude Pro, Gemini Pro, **Copilot Pro** (orchestrator chính)
- Kỹ năng: Node.js, Linux, API integration, troubleshooting sâu
- Phong cách: CLI, hands-on, không thích config thủ công

---

## Roadmap Brain OS

- ✅ Phase 1: Core (chat + memory + agents + telegram + logs + web UI)
- ✅ Phase 2A: Tool Calling (14 tools — file I/O, HTTP, web search)
- ✅ Phase 2B: Copilot orchestrator (thay Groq/Ollama — free, mạnh hơn)
- ✅ Phase 2C: Per-agent skills & context (flexible agents)
- ⬜ Phase 3: Self-improvement (brain đọc error log, tự update system prompt)
- ⬜ Phase 4: Content pipeline (kết nối workflow tạo video tự động)
- ⬜ Phase 5: Multi-agent (nhiều brain song song, chuyên biệt)

---

## Cách dùng file này

Paste nội dung file này vào đầu conversation mới:
> "Đây là context của project Brain OS tôi đang xây dựng: [paste nội dung]. Hãy tiếp tục giúp tôi phát triển."