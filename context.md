# Brain OS — Conversation Context
> Import file này vào conversation mới để tiếp tục phát triển project

---

## Project tổng quan

**Brain OS** là hệ thống AI orchestration chạy local.

- Orchestrator: GitHub Copilot qua `copilot-api` tại `http://localhost:4141`
- Không cần Ollama
- Kiến trúc hiện tại: tách `backend/` và `frontend/`

---

## Cấu trúc hiện tại

```text
multi-ai-agent/
├── backend/
│   ├── server.js
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
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── constants.js
│   │   ├── hooks/useWebSocket.js
│   │   └── components/*
│   └── dist/                  # build output được backend serve
├── .env
├── .env.example
├── README.md
└── package.json
```

---

## Cách chạy

```bash
# 1) Copilot proxy
npx copilot-api@latest start

# 2) Install deps cho 2 app
npm run install:all

# 3) Seed context (optional)
node backend/seed-context.js

# 4) Start backend (serve cả frontend dist)
npm run start
# hoặc custom port
node backend/server.js --port 3399
```

---

## Storage model

Hiện tại là mô hình **Supabase-only**:

- Bắt buộc có `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`
- Backend fail-fast khi thiếu env hoặc không kết nối được Supabase
- Toàn bộ dữ liệu runtime đọc/ghi qua Supabase tables: `agents`, `messages`, `summaries`, `lessons`, `logs`, `config`

---

## Memory & token budgets

Các limit vận hành đã gom vào `backend/src/constants.js`:

- Brain token budget: `BRAIN_CONSTANTS.TOKEN_BUDGET` (4000)
- Agent token budget: `AGENT_CONSTANTS.TOKEN_BUDGET` (3000)
- Memory default token budget: `MEMORY_CONSTANTS.DEFAULT_TOKEN_BUDGET` (3000)
- HTTP text preview length: `TOOL_CONSTANTS.HTTP_TEXT_PREVIEW_LENGTH` (10000)

Mục tiêu: không hardcode magic number rải rác nữa.

---

## API chính

- `GET /api/status`
- `POST /api/brain/check`
- `POST /api/brain/model`
- `GET/POST/PUT/DELETE /api/agents...`
- `GET/DELETE /api/memory`, `POST /api/memory/summarize`
- `GET /api/tools`
- `GET/DELETE /api/logs`
- `GET/DELETE /api/lessons`
- `GET /api/telegram`
- `GET /api/telegram/messages`
- `POST /api/telegram/connect`
- `POST /api/telegram/owner`
- `POST /api/telegram/send`
- `POST /api/telegram/disconnect`

---

## WebSocket events

Client -> Server:
- `chat`
- `clear_chat`
- `load_history`

Server -> Client:
- `chat_token`
- `chat_done`
- `chat_error`
- `tool_call`
- `log`
- `telegram_status`
- `telegram_message`
- `chat_cleared`
- `history`

---

## Lưu ý hiện trạng

- Frontend build có thể fail nếu chưa cài deps trong `frontend/node_modules`.
- `EADDRINUSE` xuất hiện nếu cổng 3333 đang bị chiếm; đổi cổng qua `--port`.
- Telegram token lưu qua flow API/UI (`/api/telegram/connect`) vào Supabase `config`, không lấy trực tiếp từ env ở runtime.

---

## Cách dùng file này

Paste nội dung file này vào đầu conversation mới:

"Đây là context của project Brain OS tôi đang làm. Hãy tiếp tục dựa trên context này."
