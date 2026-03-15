# Brain OS — Conversation Context
> Paste this file at the start of a new conversation to continue developing this project.

---

## Project Overview

**Brain OS** is a local AI orchestration system running entirely on your machine.

- **Orchestrator**: GitHub Copilot via `copilot-api` at `http://localhost:4141`
- **Persistence**: Supabase (required)
- **Architecture**: `backend/` (Express + WebSocket) + `frontend/` (React + Vite + Tailwind)
- **No default agents** — users create agents via UI or by asking Brain in chat

---

## Directory Structure

```
multi-ai-agent/
├── backend/
│   ├── server.js            # Express + WebSocket + API routes
│   ├── seed-context.js      # Optional: seed initial Brain memory
│   └── src/
│       ├── brain.js         # Copilot orchestrator + BRAIN_SYSTEM prompt
│       ├── tools.js         # 17 tools incl. multi-backend search + import_skill
│       ├── memory.js        # Context scoring + prompt assembly
│       ├── agents.js        # Agent CRUD + provider dispatch (no default agents)
│       ├── self-learn.js    # Behavioral learning from corrections/errors
│       ├── skill-importer.js # SKILL.md parser + ClawHub registry integration
│       ├── logger.js        # Supabase-backed logging + WS broadcast
│       ├── telegram.js      # Telegram bot (per-chat isolated memory)
│       ├── db.js            # Supabase client singleton
│       └── constants.js     # All magic numbers centralized
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── constants.js
│   │   ├── hooks/useWebSocket.js
│   │   └── components/
│   │       ├── ChatTab.jsx      # Fixed summarize button + streaming markdown
│   │       ├── AgentsTab.jsx
│   │       ├── AgentModal.jsx   # ClawHub import UI, no Ollama
│   │       ├── TelegramTab.jsx
│   │       ├── LogsTab.jsx
│   │       ├── Sidebar.jsx
│   │       └── Skeleton.jsx
│   └── dist/
├── .env
├── .env.example
├── context.md       # ← this file
├── README.md
└── package.json
```

---

## How to Run

```bash
# 1. Copilot proxy (keep this terminal open)
npx copilot-api@latest start

# 2. Install dependencies
npm run install:all

# 3. Optionally seed initial Brain memory
node backend/seed-context.js

# 4. Start backend (serves frontend/dist at same port)
npm run start
# or with custom port/model:
node backend/server.js --port 3399 --model gpt-4.1
```

---

## Storage Model

Supabase-only (no local fallback):
- **Required**: `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` in `.env`
- Backend exits on startup if Supabase is unavailable
- Tables: `agents`, `messages`, `summaries`, `lessons`, `logs`, `config`

---

## Tools (17)

| Tool | Description |
|------|-------------|
| `get_current_time` | VN timezone |
| `list_agents` | All agents with status |
| `get_system_status` | System info + search backend |
| `call_agent` | Delegate to specialist agent |
| `manage_agent` | Enable/disable agent |
| `get_memory_stats` | Memory per agent |
| `run_command` | Shell (read-only whitelist) |
| `run_pipeline` | Parallel/sequential pipeline |
| `save_lesson` | Self-learning |
| `send_telegram` | Proactive Telegram message |
| `read_file` | Read local file (whitelist) |
| `write_file` | Write local file (whitelist) |
| `http_request` | HTTP GET/POST |
| `search_web` | Multi-backend: Brave → DDG HTML → DDG Instant |
| `create_agent` | Create new agent (skills in English) |
| `update_agent` | Update existing agent |
| `import_skill` | Import from ClawHub/SKILL.md URL/content |

---

## Web Search Backends

Priority order (first one with results wins):
1. **Brave Search API** — set `BRAVE_API_KEY` in `.env` (free: 2K/month at api.search.brave.com)
2. **DuckDuckGo HTML scraping** — no key needed, reliable fallback
3. **DuckDuckGo Instant API** — last resort, often rate-limited

---

## Skill Import (ClawHub / SKILL.md)

```
# Via chat:
"Import the web-search skill from clawhub and add it to dev-agent"
→ Brain calls import_skill({ slug: "web-search", target_agent_id: "dev-agent" })

# Via UI:
Agents → Edit agent → Skills tab → "Import from ClawHub"
- Paste a SKILL.md URL, or
- Search ClawHub registry and click "+ Add"

# Via API:
POST /api/skills/import  { url, slug, content, target_agent_id }
GET  /api/skills/search  ?q=web-search&limit=10
GET  /api/skills/preview ?url=...  or  ?slug=...
```

---

## Agents

- **No default agents on first run** — start fresh
- Create via UI (`+ New Agent`) or via chat ("Create a coding agent")
- All auto-generated skills/instructions must be in **English**
- Providers: `copilot | claude | gemini | openrouter | openai`

---

## API Endpoints

```
GET  /api/status
POST /api/brain/check
POST /api/brain/model

GET/POST/PUT/DELETE /api/agents
GET/PUT             /api/agents/:id/skills
GET/PUT/DELETE      /api/agents/:id/context

POST /api/skills/import
GET  /api/skills/search
GET  /api/skills/preview

GET/DELETE          /api/memory
POST                /api/memory/summarize

GET  /api/tools
GET/DELETE          /api/logs
GET/DELETE          /api/lessons

GET/POST/DELETE     /api/telegram/...
```

---

## WebSocket Protocol

```json
// Client → Server
{ "type": "chat",         "content": "...", "agentId": "brain", "requestId": "abc" }
{ "type": "clear_chat",   "agentId": "brain" }
{ "type": "load_history", "agentId": "brain", "limit": 30 }

// Server → Client
{ "type": "chat_token",  "token": "...", "requestId": "abc" }
{ "type": "chat_done",   "requestId": "abc", "stats": {...} }
{ "type": "chat_error",  "error": "...", "requestId": "abc" }
{ "type": "tool_call",   "tool": "search_web", "args": {}, "requestId": "abc" }
{ "type": "log",         "entry": {...} }
{ "type": "history",     "messages": [...] }
{ "type": "chat_cleared" }
{ "type": "telegram_status" | "telegram_message" }
```

---

## Known Issues & Notes

- `EADDRINUSE`: Change port with `--port 3399`
- Telegram token is stored via `/api/telegram/connect` flow → Supabase `config` table (not from `.env` at runtime)
- Frontend must be built (`npm run build:frontend`) for production; dev mode uses Vite proxy at `:5173`
- `seed-context.js` is optional — only needed if you want pre-seeded Brain memory

---

## How to Use This File

Paste contents at the start of a new Claude conversation:

> "This is the context for my Brain OS project. Continue development based on this."