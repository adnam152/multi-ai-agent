# Brain OS — Conversation Context
> Import file này vào conversation mới để tiếp tục phát triển project

---

## Project tổng quan

**Brain OS** — hệ thống AI orchestration chạy hoàn toàn local trên máy Windows của Nam.

Ý tưởng cốt lõi: thay vì gửi full context lên AI mỗi request (như OpenClaw), Brain OS có một **local brain (Ollama)** làm bộ lọc — chọn lọc context liên quan, giới hạn token, rồi mới gọi external AI.

**Brain có tool calling** — tự đọc input, tự quyết định gọi tool nào (thời gian, agents list, system status, chạy lệnh, gọi agent khác...) mà không cần user chỉ định.

---

## Stack & Files

```
brain-os/
├── server.js          # Express + WebSocket, port 3333
├── seed-context.js    # Inject initial project knowledge vào brain memory
├── package.json       # express, ws, node-telegram-bot-api
├── src/
│   ├── brain.js       # Ollama integration + Tool Calling loop (qwen2.5:3b)
│   ├── tools.js       # Tool definitions + implementations (7 tools)
│   ├── memory.js      # Prompt Assembler: score context (recency 50% + keyword 40% + role 10%), token budget 3000
│   ├── agents.js      # CRUD agents + callClaude / callGemini / callOpenRouter
│   ├── logger.js      # Realtime log broadcast qua WebSocket
│   └── telegram.js    # Telegram bot polling
├── public/
│   └── index.html     # SPA: Chat / Agents / Telegram / Logs tabs
└── data/              # memory.json, agents.json, logs.json, config.json, summaries.json
```

Khởi động: `node server.js [--port 3333] [--model qwen2.5:3b]`

---

## Tool Calling (MỚI — Phase 2A)

Brain sử dụng **Ollama Native Tool Calling** — tự quyết định gọi tool nào dựa trên user input.

### Flow hoạt động
```
User input
    ↓
Ollama (non-streaming, có tools definitions)
    ↓
Response có tool_calls?
  YES → Execute tools song song (Promise.all)
      → Gửi kết quả ngược lại cho Ollama
      → Lặp lại (tối đa 5 lần)
      → Stream final response
  NO  → Gửi content trực tiếp cho user
```

### 7 Tools hiện có (src/tools.js)

| Tool | Mô tả | Ví dụ trigger |
|------|--------|---------------|
| `get_current_time` | Lấy thời gian hiện tại (timezone VN) | "Mấy giờ rồi?" |
| `list_agents` | Liệt kê agents + trạng thái | "Có bao nhiêu agent?" |
| `get_system_status` | Uptime, RAM, CPU, model info | "Hệ thống ra sao?" |
| `call_agent` | Gọi agent khác xử lý task | "Debug code này" → Dev Agent |
| `manage_agent` | Bật/tắt agent | "Tắt Dev Agent" |
| `get_memory_stats` | Thống kê memory/conversations | "Memory bao nhiêu?" |
| `run_command` | Chạy lệnh shell (whitelist safe commands) | "Kiểm tra Node version" |

### Parallel execution
- Brain có thể gọi **nhiều tools cùng lúc** (parallel tool calling)
- `call_agent` hỗ trợ gọi nhiều agents song song qua `Promise.all()`
- Mỗi agent call có timeout 60s

### WebSocket protocol mới
- `tool_call` message: server gửi khi Brain đang gọi tool (cho UI hiển thị progress)
  ```json
  { "type": "tool_call", "tool": "get_current_time", "args": {}, "requestId": "..." }
  ```

### API mới
- `GET /api/tools` — liệt kê tất cả tools Brain có

---

## Kiến trúc context filtering (memory.js)

```
User input
    ↓
extractKeywords(input)          ← bỏ stop words
    ↓
Score mọi message trong history:
  0.5 × recency + 0.4 × keyword_overlap + 0.1 × role_bonus
    ↓
Pick top-N messages ≤ 3000 token budget
(luôn giữ 6 message gần nhất bất kể score)
    ↓
Re-sort by timestamp → gửi LLM
```

---

## Agents

| Agent | Provider | Model | Dùng khi |
|-------|----------|-------|----------|
| Brain | Ollama local | qwen2.5:3b | Chat, routing, tool calling |
| Dev Agent | Claude | claude-opus-4-5 | Code, debug, architecture |
| Search Agent | Gemini | gemini-2.0-flash | Research, tìm kiếm |
| (custom) | OpenRouter | dropdown tự fetch | Nhiều model khác |

API key lưu trực tiếp trong `agents.json` field `apiKey`.
`resolveApiKey()`: direct value → env var by name → default env var.

---

## brain.js — System Prompt (cập nhật cho tool calling)

```
Bạn là Brain — bộ não AI trung tâm của hệ thống Brain OS.
- Tự quyết định gọi tool hay agent nào
- KHÔNG BAO GIỜ BỊA thông tin — gọi tool khi cần
- Hỗ trợ gọi NHIỀU tools cùng lúc
- Chỉ gọi tool khi CẦN THIẾT, không gọi thừa
```

### Chat flow (brain.js)
1. Check Ollama availability
2. Assemble prompt + context từ memory
3. Non-streaming call với tools definitions
4. Nếu có `tool_calls`: execute → gửi results → call lại (lặp tối đa 5x)
5. Final response: stream cho non-tool hoặc gửi trực tiếp

---

## UI (index.html — SPA, ~1100 dòng)

**Tab Chat:**
- Dropdown chọn agent
- Load history từ `/api/memory` khi connect, 30 message/page, có "Load more"
- Streaming tokens qua WebSocket
- Nhận `tool_call` messages để hiển thị progress khi Brain đang gọi tools

**Tab Agents:**
- Canvas view (n8n-style): Brain node → dây → Agent nodes, hover hiện Edit/Enable/Disable/Delete
- Grid view: toggle bằng nút ⊞/◈
- OpenRouter: khi chọn provider → tự fetch models từ `https://openrouter.ai/api/v1/models` → dropdown

**Tab Telegram:**
- Token lưu vĩnh viễn trong `data/config.json`
- Pre-fill token input khi load lại trang
- Auto-reconnect sau 3s khi server start

**Tab Logs:**
- Realtime qua WebSocket
- Filter theo level: info/warn/error/debug
- Auto-scroll toggle

---

## Telegram (telegram.js)

Pattern đơn giản chuẩn (không dùng deleteWebhook/Promise.race — những thứ đó gây AggregateError):

```js
const bot = new TelegramBot(token, { polling: true });
botInfo = await bot.getMe();
```

Lỗi đã gặp và fix:
- **409 Conflict**: session cũ chưa timeout → bỏ qua trong `polling_error` handler
- **EFATAL AggregateError**: do code cũ dùng `Promise.race` + `deleteWebhook` → đã xóa hoàn toàn

---

## Bugs đã fix (lịch sử)

1. **AI reply vào bubble cũ**: `getElementById('current-bubble')` tìm nhầm → fix: `div.querySelector('.msg-bubble')`
2. **OpenRouter apiKey not set**: `runAgent` không truyền `apiKey` → fix: `resolveApiKey()` + pass đúng vào dispatcher
3. **OpenRouter model name sai**: `GPT-4o-mini` → phải là `openai/gpt-4o-mini`
4. **Chat history mất khi refresh**: load từ `/api/memory` khi WS connect
5. **Telegram AggregateError**: over-engineered connect logic → rewrite đơn giản
6. **Cannot GET /**: do `server.js` cũ còn `telegram.init(brain, agents)` (2 args) nhưng `telegram.js` mới chỉ nhận 1 arg → server crash trước khi serve static

---

## Lưu ý kỹ thuật quan trọng

### Tool calling với model nhỏ (qwen2.5:3b)
- Model 3B **có thể** xử lý tool calling đơn giản (get_current_time, list_agents...)
- Với tool calling phức tạp (call_agent song song, reasoning dài): nên dùng **qwen2.5:7b+** hoặc **llama3.1:8b**
- Nếu model hay "hallucinate" tool calls → cân nhắc upgrade model

### run_command safe commands
- Chỉ cho phép chạy commands bắt đầu với whitelist (dir, ls, echo, node -v, ollama list, git status, v.v.)
- Timeout 15s, output giới hạn 3000 chars
- Có thể mở rộng whitelist trong `src/tools.js` → `SAFE_PREFIXES`

### Tránh circular dependency
- `tools.js` dùng lazy `require('./brain')` trong `get_system_status` để tránh circular
- `tools.js` import `agents.js` và `memory.js` (safe — không vòng)

---

## Về Nam (user)

- Mục tiêu: AI content pipeline tự động 24/7 (YouTube/TikTok faceless + affiliate marketing)
- Hardware: Windows (Brain OS) + Linux 8GB RAM/256GB (media processing)
- API: Claude Pro, Gemini Pro, Gemini API (Veo3), OpenRouter
- Kỹ năng: Node.js, Linux, API integration, troubleshooting sâu
- Phong cách: CLI, hands-on, không thích config thủ công

---

## Roadmap Brain OS

- ✅ Phase 1: Core (chat + memory + agents + telegram + logs + web UI)
- ✅ Phase 2A: Tool Calling (brain tự gọi tools — thời gian, agents, system, CLI)
- ⬜ Phase 2B: Auto-Routing + Parallel Agents (brain tự chọn và chạy nhiều agents song song)
- ⬜ Phase 2C: Self-improvement (brain đọc error log, tự update system prompt)
- ⬜ Phase 3: CLI tools mở rộng (cli-anything integration, unsafe commands with approval)
- ⬜ Phase 4: Content pipeline (kết nối workflow tạo video tự động)
- ⬜ Phase 5: Multi-agent (nhiều brain song song, chuyên biệt)

---

## Cách dùng file này

Paste nội dung file này vào đầu conversation mới, ví dụ:

> "Đây là context của project Brain OS tôi đang xây dựng: [paste nội dung]. Hãy tiếp tục giúp tôi phát triển."

Hoặc attach file .md trực tiếp vào conversation mới.