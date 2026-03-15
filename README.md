# 🧠 Brain OS

Autonomous AI orchestration system with local brain, multi-agent routing, Telegram integration, and intelligent context management.

## Architecture

```
User Input
    ↓
Brain / Orchestrator  ←──── Ollama (local, qwen2.5:3b)
    ↓           ↑
Context Store      Memory.js (score + filter context)
(data/memory.json)
    ↓
Prompt Assembler   → [system prompt + selected context + input]
    ↓
External AI APIs   → Claude / Gemini / OpenRouter
    ↑
Response → stored in memory → sent back to user
```

## Requirements

- Node.js >= 18
- Ollama (for local brain): https://ollama.com
- (Optional) API keys for Claude, Gemini, etc.

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Start Ollama and pull a brain model
ollama pull qwen2.5:3b   # fast, fits 8GB RAM
# or: ollama pull llama3.2:3b

# 3. Start Brain OS
node server.js

# Custom port and model:
node server.js --port 8080 --model llama3.2:3b
```

Open: http://localhost:3333

## API Keys (for agents)

Set environment variables before starting:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export GEMINI_API_KEY=AIza...
export OPENROUTER_API_KEY=sk-or-...

node server.js
```

## Extending

### Add a new agent

In the web UI → Agents tab → New Agent.

### Add local tools (cli-anything)

In `src/brain.js`, extend the `chat()` function to detect tool-use intents
and execute local commands before/after calling the LLM.

### Add more providers

In `src/agents.js`, add a new `callXxx()` function following the same pattern
(model, messages, apiKey, onToken, onDone, onError).

## Context Management (Prompt Assembler)

Every request goes through `memory.assemblePrompt()` which:

1. Extracts keywords from the current input
2. Scores ALL stored messages: `0.5 × recency + 0.4 × keyword_overlap + 0.1 × role_bonus`
3. Picks top messages within a **3000 token budget**
4. Re-sorts selected messages by timestamp before sending

This means: even very long conversations stay within limits, and the most
relevant context is always included regardless of how old it is.

## Local Brain Intelligence

| Task             | Can do? | Notes                                               |
| ---------------- | ------- | --------------------------------------------------- |
| General chat     | ✅      | qwen2.5:3b handles well                             |
| Context routing  | ✅      | Main job of the brain                               |
| Code generation  | ⚠️      | Basic only; use Dev Agent (Claude) for complex code |
| Summarization    | ✅      | Compresses old history periodically                 |
| Self-improvement | ⚠️      | Via prompt evolution (see below)                    |

**Self-improvement (behavioral, not weight-based):**
The brain can analyze its own error logs and update its system prompt dynamically.
This is _behavioral_ learning — the model weights don't change, but its instructions evolve.
True weight-based fine-tuning requires a training pipeline (future feature).

## Data Files

```
data/
  agents.json     # Agent configurations
  memory.json     # Conversation history (last 500 messages)
  summaries.json  # Compressed summaries of old context
  logs.json       # Recent logs (last 1000 entries)
  config.json     # System config (telegram token, etc.)
```
