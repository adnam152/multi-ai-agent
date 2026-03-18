# 🧠 Brain OS

**Local AI Orchestration System** — chạy hoàn toàn trên máy của bạn.

Orchestrator: **GitHub Copilot** (qua `copilot-api`) — không cần Ollama, không cần API key riêng cho Brain.

Kiến trúc: **backend + frontend tách riêng**.
- Backend: `backend/` (Express + WebSocket + tools + memory + telegram)
- Frontend: `frontend/` (React + Vite + Tailwind)
- Persistence: Supabase (bắt buộc)

---

## Tính năng

### Core
- 🤖 **Copilot Orchestrator** — Brain dùng GitHub Copilot Pro (free models sẵn có)
- 🔧 **Tool Calling** — file I/O, HTTP request, web search, shell, Telegram, MCP, agents...
- 🧠 **Smart Memory** — context scoring theo recency + keyword + role, auto-compact
- 👥 **Flexible Agents** — mỗi agent có skills + context notes riêng
- 📱 **Telegram Bot** — điều khiển từ xa, nhận kết quả từ Brain
- 🌐 **Web UI** — đầy đủ giao diện quản lý tại port 3333

### Tabs

| Tab | Mô tả |
|-----|-------|
| 💬 Chat | Chat với Brain hoặc bất kỳ agent nào. Multi-session, context isolation |
| 📡 Tracking | Xem real-time luồng suy nghĩ của Brain: tool calls, HTTP requests, timings |
| 🗣️ Group Debate | Multi-agent debate: các AI tranh luận theo vòng, Brain tổng hợp khi đạt consensus |
| ⏰ Cron Jobs | Lên lịch tự động: cron expression, chọn agent, tùy chọn gửi Telegram |
| 🤖 Agents | Tạo/quản lý chuyên gia AI với provider/model/skills riêng |
| 🔌 MCP | Kết nối MCP servers (Monday.com, GitHub, Slack...) |
| ✈️ Telegram | Quản lý Telegram bot |
| 📊 Dashboard | Tổng quan hệ thống với stats đầy đủ |

---

## Setup

### 1. Clone & cài dependencies

```bash
git clone <repo>
cd multi-ai-agent
npm install
npm run install:all
```

### 2. Setup GitHub Copilot proxy (bắt buộc)

```bash
npm install -g copilot-api

# Đăng nhập GitHub (chỉ làm 1 lần)
copilot-api auth

# Chạy proxy (giữ terminal này mở)
copilot-api start
# → Listening at http://localhost:4141
```

### 3. Cấu hình `.env`

```bash
cp .env.example .env
# Điền SUPABASE_URL và SUPABASE_SERVICE_KEY
```

### 4. Chạy migration Supabase

Vào **Supabase SQL Editor** và chạy lần lượt:
- `supabase-migration.sql`
- `supabase-migration-v2.sql`
- `supabase-migration-v3.sql`

### 5. Khởi động Brain OS

```bash
# Seed context ban đầu (optional)
node backend/seed-context.js

# Chạy server
npm run start

# Dev mode (hot reload)
npm run dev
```

### 6. Mở Web UI

Truy cập **http://localhost:3333**

---

## Cron Jobs

Tạo scheduled tasks chạy tự động theo lịch:

```
*/30 * * * *    — Every 30 minutes
0 9 * * *       — Daily at 09:00
0 9 * * 1-5     — Mon-Fri at 09:00
0 */2 * * *     — Every 2 hours
0 8 * * 1       — Every Monday at 08:00
```

Mỗi job gửi **prompt** đến **Brain hoặc bất kỳ agent nào**, và có thể:
- Tự động gửi kết quả đến **Telegram**
- Enable/Disable riêng từng job
- **Run Now** để test ngay lập tức

---

## Group Debate

Multi-agent debate với round-based orchestration:

1. Tạo session với 2+ agents (mỗi agent có persona riêng)
2. Set topic tranh luận
3. Click **▶ Start** — agents tranh luận theo vòng
4. Sau mỗi vòng, Brain tóm tắt và so sánh với vòng trước
5. Khi đạt consensus (score ≥ 7/10), Brain viết **Final Synthesis**
6. Hoặc bật **∞ Infinite Mode** để loop mãi mãi (không Brain)

**Settings per-session:**
- Toggle Auto-synthesize (Brain can thiệp) / Infinite loop
- Round delay: 0ms–10s giữa các agents

**Agents hỗ trợ tool calling** (Copilot/OpenAI/OpenRouter): có thể search_web và http_request trong khi tranh luận.

---

## Task Tracking

Mỗi câu chat với Brain hoặc agent tự động tạo **tracking task**:
- Xem tool calls real-time (tên tool, arguments, results)
- Xem HTTP requests (URL, method, headers ẩn token, body, response)
- Xem "thoughts" (intermediate reasoning)
- Nút **■ Stop** để dừng task đang chạy
- Auto-select task mới nhất

---

## Models GitHub Copilot (2026-03)

| Model | Context | Quota |
|-------|---------|-------|
| `gpt-5-mini` | 192K | Free (0x) |
| `gpt-4.1` | 128K | Free (0x) |
| `gpt-4o` | 68K | Free (0x) |
| `raptor-mini` | 264K | Free (0x) |
| `grok-code-fast-1` | 173K | 0.25x |
| `claude-haiku-4-5` | 160K | 0.33x |
| `gemini-3-flash` | 173K | 0.33x |
| `gpt-5.1-codex-mini` | 256K | 0.33x |
| `gpt-5.4-mini` | 400K | 0.33x |
| `gpt-5.1` | 192K | 1x |
| `gpt-5.2` | 192K | 1x |
| `gpt-5.1-codex` | 256K | 1x |
| `gpt-5.1-codex-max` | 256K | 1x |
| `gpt-5.3-codex` | 400K | 1x |
| `gemini-2.5-pro` | 173K | 1x |
| `gemini-3-pro` | 173K | 1x |
| `claude-sonnet-4-5` | 160K | 1x |

---

## Tools (22+)

| Tool | Mô tả |
|------|-------|
| `get_current_time` | Thời gian VN (UTC+7) |
| `list_agents` | Liệt kê agents + skills |
| `call_agent` | Delegate task đến agent |
| `create_agent` | Tạo agent mới từ chat |
| `update_agent` | Sửa agent (model, skills, prompt) |
| `delete_agent` | Xóa agent |
| `run_pipeline` | Parallel/sequential agents |
| `get_system_status` | System info |
| `get_memory_stats` | Memory stats |
| `run_command` | Shell read-only |
| `read_file` / `write_file` | File I/O (whitelist) |
| `http_request` | HTTP GET/POST |
| `search_web` | Brave → Tavily → DuckDuckGo |
| `browse_web` / `browse_search` | Headless browser |
| `save_lesson` / `get_lessons` | Self-learning |
| `send_telegram` | Gửi Telegram |
| `import_skill` | Import SKILL.md từ URL |
| `list_mcp_servers` / `mcp_call` | MCP tools |
| `get_monday_token` | Monday.com API token |
| `list_cron_jobs` | Xem cron jobs |
| `create_cron_job` | Tạo cron job từ chat |
| `update_cron_job` | Sửa cron job |
| `delete_cron_job` / `run_cron_job` | Xóa/chạy ngay cron job |
| `list_debates` | Xem group debates |
| `create_debate` | Tạo debate từ chat |
| `start_debate` / `stop_debate` | Điều khiển debate |
| `delete_debate` | Xóa debate session |
| `create_mcp_server` | Đăng ký MCP server mới |
| `connect_mcp_server` / `disconnect_mcp_server` | Kết nối/ngắt MCP |
| `delete_mcp_server` | Xóa MCP server |

---

## Orchestrator Powers (Chat-driven control)

Bạn có thể điều khiển **toàn bộ Brain OS** chỉ qua lệnh chat:

```
"Tạo cron job mỗi sáng 8h tóm tắt tin tức AI và gửi Telegram"
→ Brain gọi create_cron_job() với schedule "0 8 * * *"

"Tạo debate về Next.js vs Remix với 2 agent: 1 người ủng hộ Next.js, 1 người ủng hộ Remix"
→ Brain gọi create_debate() + start_debate()

"Tạo agent chuyên viết TypeScript, dùng GPT-5.1-Codex 400K context"
→ Brain gọi create_agent() với provider copilot, model gpt-5.1-codex

"Kết nối MCP server GitHub"
→ Brain gọi create_mcp_server() + connect_mcp_server()

"Disable cron job morning news"
→ Brain gọi list_cron_jobs() + update_cron_job(enabled: false)
```

---

## API Endpoints

```
# Status
GET  /api/status
POST /api/brain/model

# Agents
GET/POST        /api/agents
PUT/DELETE      /api/agents/:id
GET/PUT         /api/agents/:id/skills
GET/PUT/DELETE  /api/agents/:id/context

# Chat & Memory
GET    /api/sessions
POST   /api/sessions
PUT    /api/sessions/:id
DELETE /api/sessions/:id
GET    /api/memory
POST   /api/memory/summarize
GET    /api/context/health

# Tracking
GET    /api/tracking/tasks
GET    /api/tracking/tasks/:id
POST   /api/tracking/tasks/:id/stop
DELETE /api/tracking/finished

# Group Debate
GET/POST        /api/group-chat/sessions
GET/PUT/DELETE  /api/group-chat/sessions/:id
POST            /api/group-chat/sessions/:id/start
POST            /api/group-chat/sessions/:id/stop
DELETE          /api/group-chat/sessions/:id/messages

# Cron Jobs
GET/POST        /api/cron/jobs
GET/PUT/DELETE  /api/cron/jobs/:id
POST            /api/cron/jobs/:id/run

# MCP
GET/POST        /api/mcp/servers
PUT/DELETE      /api/mcp/servers/:id
POST            /api/mcp/servers/:id/connect
POST            /api/mcp/servers/:id/disconnect

# Telegram
GET    /api/telegram
POST   /api/telegram/connect
POST   /api/telegram/owner
POST   /api/telegram/send
POST   /api/telegram/disconnect

# Self-learning
GET    /api/lessons
PATCH  /api/lessons/:id
DELETE /api/lessons

# Tools
GET    /api/tools
```

---

## WebSocket Protocol

```json
// Client → Server
{ "type": "chat",         "content": "...", "agentId": "brain", "requestId": "abc" }
{ "type": "clear_chat",   "agentId": "brain" }
{ "type": "load_history", "agentId": "brain", "limit": 50 }

// Server → Client (chat)
{ "type": "chat_token",  "token": "...",    "requestId": "abc" }
{ "type": "chat_done",   "stats": {...},    "requestId": "abc" }
{ "type": "chat_error",  "error": "...",    "requestId": "abc" }
{ "type": "tool_call",   "tool": "...",     "args": {} }

// Server → Client (tracking)
{ "type": "tracking_task_start",  "task": {...} }
{ "type": "tracking_event",       "taskId": "...", "event": {...} }
{ "type": "tracking_task_done",   "taskId": "...", "status": "done" }

// Server → Client (group debate)
{ "type": "gc_round_start",       "sessionId": "...", "roundNumber": 1 }
{ "type": "gc_thinking",          "sessionId": "...", "agentId": "...", ... }
{ "type": "gc_tool_call",         "sessionId": "...", "tool": "...", "args": {} }
{ "type": "gc_message",           "sessionId": "...", "message": {...} }
{ "type": "gc_round_summary",     "sessionId": "...", "message": {...} }
{ "type": "gc_consensus_result",  "sessionId": "...", "score": 8, "reason": "..." }
{ "type": "gc_synthesis",         "sessionId": "...", "message": {...} }
{ "type": "gc_done",              "sessionId": "..." }

// Server → Client (cron)
{ "type": "cron_job_start",  "jobId": "...", "jobName": "..." }
{ "type": "cron_job_done",   "jobId": "...", "result": "...", "duration": 1234 }
{ "type": "cron_job_error",  "jobId": "...", "error": "..." }
{ "type": "cron_updated" }
```

---

## Environment Variables

```bash
# Supabase (bắt buộc)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key

# Copilot API URL (mặc định: http://localhost:4141)
COPILOT_API_URL=http://localhost:4141

# Port và model
PORT=3333
BRAIN_MODEL=gpt-5-mini

# Web Search (optional — tăng chất lượng)
BRAVE_API_KEY=      # api.search.brave.com — 2K req/month free
TAVILY_API_KEY=     # tavily.com — 1K req/month free

# Agent providers (chỉ cần nếu dùng làm agent riêng)
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
OPENROUTER_API_KEY=
OPENAI_API_KEY=
```

---

## Troubleshooting

**copilot-api không chạy:**
```
→ Chạy: npx copilot-api@latest start
→ Lần đầu: npx copilot-api@latest auth
```

**Port bị chiếm (EADDRINUSE):**
```
node backend/server.js --port 3399
```

**Supabase connection failed:**
```
→ Kiểm tra SUPABASE_URL và SUPABASE_SERVICE_KEY trong .env
→ Đảm bảo đã chạy tất cả migration SQL
```

**Cron jobs không chạy:**
```
→ Cron tick chạy mỗi phút theo server time
→ Kiểm tra cron expression tại crontab.guru
→ Dùng "Run ▶" để test ngay lập tức
```

**Group debate timeout:**
```
→ Copilot-api cần thời gian cho tool calls
→ Synthesis dùng 2 retries với 120s timeout
→ Kiểm tra log: [INFO] [group-chat] ...
```

---

## Roadmap

- ✅ Phase 1: Core system + Brain orchestrator
- ✅ Phase 2: Tool calling (18 tools), MCP integration
- ✅ Phase 3: Task Tracking, Group Debate, Cron Jobs
- ✅ Phase 4: Self-learning, per-agent skills, context notes
- ⬜ Phase 5: Multi-modal (image input)
- ⬜ Phase 6: Content pipeline automation