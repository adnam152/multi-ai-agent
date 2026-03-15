/* ═══════════════════════════════════════════════════════════════
   Brain OS — app.js  (complete, v2)
   ═══════════════════════════════════════════════════════════════ */

// ── State ─────────────────────────────────────────────────────────────────────
let ws = null;
let wsReady = false;
let reconnectTimer = null;
let isStreaming = false;
let currentMsgBubble = null;
let historyOffset = 0;
const HISTORY_PAGE = 30;
let currentAgentId = 'brain';
let agentViewMode = 'canvas'; // 'canvas' | 'grid'
let autoScrollEnabled = true;
let currentLogLevel = 'all';
let allLogs = [];

// ── Copilot models ────────────────────────────────────────────────────────────
const COPILOT_MODELS = [
  // Free (0x premium)
  { id: 'gpt-5-mini',                   label: 'GPT-5 Mini · Free' },
  { id: 'gpt-4.1',                      label: 'GPT-4.1 · Free' },
  { id: 'gpt-4o',                       label: 'GPT-4o · Free' },
  { id: 'raptor-mini',                  label: 'Raptor Mini Preview · Free' },
  // Discount (0.25x – 0.33x)
  { id: 'grok-code-fast-1',             label: 'Grok Code Fast 1 · 0.25x' },
  { id: 'claude-haiku-4-5',             label: 'Claude Haiku 4.5 · 0.33x' },
  { id: 'gemini-3-flash',               label: 'Gemini 3 Flash Preview · 0.33x' },
  { id: 'gpt-5.1-codex-mini',           label: 'GPT-5.1 Codex Mini Preview · 0.33x' },
  // Standard (1x)
  { id: 'gemini-2.5-pro',               label: 'Gemini 2.5 Pro · 1x' },
  { id: 'gemini-3-pro',                 label: 'Gemini 3 Pro Preview · 1x' },
  { id: 'gemini-3.1-pro',               label: 'Gemini 3.1 Pro Preview · 1x' },
  { id: 'gpt-5.1',                      label: 'GPT-5.1 · 1x' },
  { id: 'gpt-5.1-codex',               label: 'GPT-5.1 Codex · 1x' },
  { id: 'gpt-5.1-codex-max',           label: 'GPT-5.1 Codex Max · 1x' },
  { id: 'gpt-5.2',                      label: 'GPT-5.2 · 1x' },
  { id: 'gpt-5.2-codex',               label: 'GPT-5.2 Codex · 1x' },
  { id: 'gpt-5.3-codex',               label: 'GPT-5.3 Codex · 1x' },
];

// ── Utils ─────────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

// ── Theme ─────────────────────────────────────────────────────────────────────
function applyTheme(dark) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const icon = document.getElementById('theme-icon');
  const label = document.getElementById('theme-label');
  if (icon) icon.textContent = dark ? '🌙' : '☀️';
  if (label) label.textContent = dark ? 'Dark mode' : 'Light mode';
  localStorage.setItem('theme', dark ? 'dark' : 'light');
}

function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  applyTheme(!isDark);
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const tabEl = document.getElementById(`tab-${tab}`);
  if (tabEl) tabEl.classList.add('active');
  const navEl = document.querySelector(`.nav-item[data-tab="${tab}"]`);
  if (navEl) navEl.classList.add('active');
}

// ── Modal tab switching ───────────────────────────────────────────────────────
function switchModalTab(tab) {
  document.querySelectorAll('.modal-tab-btn').forEach(btn => {
    const active = btn.dataset.tab === tab;
    btn.classList.toggle('active', active);
    btn.style.color = active ? 'var(--accent)' : 'var(--muted)';
    btn.style.borderBottomColor = active ? 'var(--accent)' : 'transparent';
  });
  document.querySelectorAll('.modal-tab-panel').forEach(panel => {
    panel.style.display = panel.dataset.tab === tab ? '' : 'none';
  });
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
function connect() {
  if (ws) { try { ws.close(); } catch {} }
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);

  ws.onopen = () => {
    wsReady = true;
    loadStatus();
    loadAgents().then(() => loadChatHistory(true));
    loadLogs();
    loadTelegram();
  };

  ws.onmessage = (e) => {
    try { handleWS(JSON.parse(e.data)); } catch {}
  };

  ws.onclose = () => {
    wsReady = false;
    reconnectTimer = setTimeout(connect, 2000);
  };

  ws.onerror = () => { ws.close(); };
}

function handleWS(msg) {
  switch (msg.type) {
    case 'chat_token':
      if (!currentMsgBubble) appendAssistantMessage('', msg.requestId);
      appendToken(msg.token);
      setTypingStatusText('Brain đang trả lời...');
      clearToolBadge();
      break;
    case 'tool_call':
      appendToolCallBadge(msg.tool, msg.args);
      setTypingStatusText(`Calling tool:`);
      showToolBadge(msg.tool);
      break;
    case 'chat_done':
      finalizeMessage(msg.stats);
      isStreaming = false;
      document.getElementById('send-btn').disabled = false;
      hideTypingStatus();
      loadAgents();
      break;
    case 'chat_error':
      appendErrorMessage(msg.error);
      isStreaming = false;
      document.getElementById('send-btn').disabled = false;
      hideTypingStatus();
      break;
    case 'log':
      if (msg.entry) appendLogEntry(msg.entry);
      break;
    case 'telegram_status':
      renderTelegramStatus(msg.status);
      break;
    case 'telegram_message':
      appendTelegramMessage(msg.message);
      break;
    case 'chat_cleared':
      document.getElementById('messages').innerHTML = '';
      historyOffset = 0;
      showEmptyState();
      break;
    case 'history':
      if (msg.messages) renderHistory(msg.messages);
      break;
  }
}

// ── Status ────────────────────────────────────────────────────────────────────
async function loadStatus() {
  try {
    const r = await fetch('/api/status');
    const s = await r.json();
    const dot = document.getElementById('brain-dot');
    const txt = document.getElementById('brain-status-text');
    const sub = document.getElementById('brain-node-sub');

    if (s.brain.available) {
      dot.className = 'dot green';
      txt.textContent = `Copilot: ${s.brain.model}`;
    } else {
      dot.className = 'dot red';
      txt.textContent = 'copilot-api offline';
    }
    if (sub) sub.textContent = `Copilot · ${s.brain.model}`;

    const mi = document.getElementById('memory-info');
    if (mi) mi.textContent = `Memory: ${s.memorySize} msgs`;

    renderTelegramStatus(s.telegram);
  } catch {}
}

// ── Agents ────────────────────────────────────────────────────────────────────
async function loadAgents() {
  const r = await fetch('/api/agents');
  const list = await r.json();

  // Update count badges
  document.getElementById('agent-count').textContent = list.length;
  document.getElementById('agents-count-meta').textContent = `${list.length} agents`;

  // Update agent selector in chat
  const sel = document.getElementById('agent-selector');
  const cur = sel.value;
  sel.innerHTML = '<option value="brain">🧠 Brain (Copilot)</option>' +
    list.filter(a => a.active).map(a =>
      `<option value="${escHtml(a.id)}">${escHtml(a.name)}</option>`
    ).join('');
  if (list.find(a => a.id === cur)) sel.value = cur;

  // Render canvas / grid
  renderAgentNodes(list);
  renderAgentGrid(list);
}

function renderAgentNodes(list) {
  const col = document.getElementById('agent-nodes-col');
  const connArea = document.getElementById('connector-area');
  if (!col) return;

  if (list.length === 0) {
    col.innerHTML = '';
    connArea.style.display = 'none';
    return;
  }
  connArea.style.display = 'flex';

  col.innerHTML = list.map(a => `
    <div class="node-card ${a.active ? '' : 'node-disabled'}" data-id="${escHtml(a.id)}">
      <div class="node-icon">${providerIcon(a.provider)}</div>
      <div class="node-body">
        <div class="node-title">${escHtml(a.name)}</div>
        <div class="node-sub">${escHtml(a.provider)} · ${escHtml(a.model)}</div>
        ${(a.skills?.length) ? `<div class="node-tag">⚡ ${a.skills.length} skills</div>` : ''}
        ${a.contextNotes ? `<div class="node-tag">📝 context</div>` : ''}
      </div>
      <div class="node-status-dot ${a.active ? 'green' : 'red'}"></div>
      <div class="node-actions">
        <button onclick="editAgent('${escHtml(a.id)}')" class="node-btn" title="Edit">✏️</button>
        <button onclick="toggleAgent('${escHtml(a.id)}', ${!a.active})" class="node-btn" title="${a.active ? 'Disable' : 'Enable'}">${a.active ? '⏸' : '▶️'}</button>
        <button onclick="deleteAgent('${escHtml(a.id)}')" class="node-btn node-btn-del" title="Delete">🗑</button>
      </div>
    </div>`).join('');
}

function renderAgentGrid(list) {
  const grid = document.getElementById('agents-grid');
  if (!grid) return;
  grid.innerHTML = list.map(a => `
    <div class="agent-card ${a.active ? '' : 'agent-disabled'}">
      <div class="agent-card-header">
        <span class="agent-icon">${providerIcon(a.provider)}</span>
        <span class="agent-name">${escHtml(a.name)}</span>
        <span class="dot ${a.active ? 'green' : 'red'}" style="margin-left:auto"></span>
      </div>
      <div class="agent-desc">${escHtml(a.description || '—')}</div>
      <div class="agent-meta">${escHtml(a.provider)} · ${escHtml(a.model)}</div>
      ${a.skills?.length ? `<div class="agent-tag">⚡ ${a.skills.length} skills</div>` : ''}
      <div class="agent-card-footer">
        <button onclick="editAgent('${escHtml(a.id)}')" class="btn btn-ghost btn-sm">Edit</button>
        <button onclick="toggleAgent('${escHtml(a.id)}', ${!a.active})" class="btn btn-ghost btn-sm">${a.active ? 'Disable' : 'Enable'}</button>
        <button onclick="deleteAgent('${escHtml(a.id)}')" class="btn btn-danger btn-sm">Del</button>
      </div>
    </div>`).join('');
}

function providerIcon(p) {
  const map = { claude: '🟣', gemini: '🔵', openrouter: '🌐', openai: '🟢', ollama: '🦙', copilot: '🤖' };
  return map[p] || '🤖';
}

function toggleAgentView() {
  agentViewMode = agentViewMode === 'canvas' ? 'grid' : 'canvas';
  document.getElementById('agents-canvas').style.display = agentViewMode === 'canvas' ? '' : 'none';
  document.getElementById('agents-grid-view').style.display = agentViewMode === 'grid' ? '' : 'none';
  document.getElementById('view-toggle').textContent = agentViewMode === 'canvas' ? '⊞ Grid' : '⬡ Canvas';
}

async function editAgent(id) {
  const r = await fetch('/api/agents');
  const list = await r.json();
  const a = list.find(x => x.id === id);
  if (a) openAgentModal(a);
}

async function toggleAgent(id, active) {
  await fetch(`/api/agents/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active }),
  });
  loadAgents();
}

async function deleteAgent(id) {
  if (!confirm('Delete this agent?')) return;
  await fetch(`/api/agents/${id}`, { method: 'DELETE' });
  loadAgents();
}

// ── Agent Modal ───────────────────────────────────────────────────────────────
function openAgentModal(data = null) {
  document.getElementById('modal-title').textContent = data ? 'Edit Agent' : 'New Agent';
  document.getElementById('agent-edit-id').value = data?.id || '';
  document.getElementById('agent-name').value = data?.name || '';
  document.getElementById('agent-desc-input').value = data?.description || '';
  document.getElementById('agent-apikey').value = data?.apiKey || '';
  document.getElementById('agent-prompt').value = data?.systemPrompt || '';

  const skillsEl = document.getElementById('agent-skills');
  if (skillsEl) skillsEl.value = (data?.skills || []).join('\n');

  const ctxEl = document.getElementById('agent-context-notes');
  if (ctxEl) ctxEl.value = data?.contextNotes || '';

  const autoEl = document.getElementById('agent-auto-update');
  if (autoEl) autoEl.checked = data?.autoUpdateContext || false;

  // Set provider first, then trigger model dropdown
  const prov = data?.provider || 'copilot';
  document.getElementById('agent-provider').value = prov;
  onProviderChange();

  // Set model after dropdown renders
  const mv = data?.model || '';
  setTimeout(() => {
    const modelEl = document.getElementById('agent-model');
    if (modelEl && mv) modelEl.value = mv;
  }, 50);

  switchModalTab('general');
  document.getElementById('agent-modal').classList.add('open');
}

function closeAgentModal() {
  document.getElementById('agent-modal').classList.remove('open');
}

function onProviderChange() {
  const p = document.getElementById('agent-provider').value;
  const wrap = document.getElementById('agent-model-wrap');
  const hint = document.getElementById('model-hint');
  const keyRow = document.getElementById('agent-apikey-row');

  const defaults = {
    claude: 'claude-sonnet-4-5',
    gemini: 'gemini-2.0-flash',
    openai: 'gpt-4o',
    ollama: 'qwen2.5:3b',
    copilot: 'gpt-5-mini',
  };

  // Copilot: dropdown + hide API key row
  if (p === 'copilot') {
    const opts = COPILOT_MODELS.map(m =>
      `<option value="${m.id}">${escHtml(m.label)}</option>`
    ).join('');
    wrap.innerHTML = `<select class="form-select" id="agent-model">${opts}</select>`;
    if (hint) hint.textContent = 'Free: gpt-5-mini, gpt-4.1-mini, gpt-4o-mini, gemini-2.0-flash';
    if (keyRow) keyRow.style.display = 'none';
    return;
  }

  // Show API key row for all other providers
  if (keyRow) keyRow.style.display = '';

  if (p === 'openrouter') {
    wrap.innerHTML = `<input type="text" class="form-input" id="agent-model" placeholder="openai/gpt-4o-mini">`;
    if (hint) hint.textContent = 'Format: provider/model-name';
    // Try to fetch OpenRouter models
    fetch('https://openrouter.ai/api/v1/models')
      .then(r => r.json())
      .then(data => {
        const opts = (data.data || [])
          .sort((a, b) => a.id.localeCompare(b.id))
          .map(m => `<option value="${escHtml(m.id)}">${escHtml(m.id)}</option>`)
          .join('');
        wrap.innerHTML = `<select class="form-select" id="agent-model">${opts}</select>`;
      })
      .catch(() => {});
    return;
  }

  // Text input for claude / gemini / openai / ollama
  wrap.innerHTML = `<input type="text" class="form-input" id="agent-model" placeholder="${defaults[p] || 'model-name'}" value="${defaults[p] || ''}">`;
  if (hint) hint.textContent = '';
}

async function saveAgent() {
  const id = document.getElementById('agent-edit-id').value;
  const skillsRaw = document.getElementById('agent-skills')?.value || '';
  const skills = skillsRaw.split('\n').map(s => s.trim()).filter(Boolean);

  const body = {
    name: document.getElementById('agent-name').value.trim(),
    description: document.getElementById('agent-desc-input').value.trim(),
    provider: document.getElementById('agent-provider').value,
    model: document.getElementById('agent-model').value.trim(),
    apiKey: document.getElementById('agent-apikey').value.trim(),
    systemPrompt: document.getElementById('agent-prompt').value.trim(),
    skills,
    contextNotes: document.getElementById('agent-context-notes')?.value || '',
    autoUpdateContext: document.getElementById('agent-auto-update')?.checked || false,
  };

  if (!body.name) return alert('Name required');

  const url = id ? `/api/agents/${id}` : '/api/agents';
  const method = id ? 'PUT' : 'POST';
  await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  closeAgentModal();
  loadAgents();
}

async function clearAgentContext() {
  const id = document.getElementById('agent-edit-id').value;
  if (!id) { document.getElementById('agent-context-notes').value = ''; return; }
  if (!confirm('Clear all context notes for this agent?')) return;
  await fetch(`/api/agents/${id}/context`, { method: 'DELETE' });
  document.getElementById('agent-context-notes').value = '';
}

// ── Chat ──────────────────────────────────────────────────────────────────────
function onAgentChange() {
  currentAgentId = document.getElementById('agent-selector').value;
  document.getElementById('messages').innerHTML = '';
  historyOffset = 0;
  showEmptyState();
  // Load history for selected agent
  if (ws && wsReady) {
    ws.send(JSON.stringify({ type: 'load_history', agentId: currentAgentId, limit: HISTORY_PAGE }));
  }
}

async function loadChatHistory(initial = false) {
  if (!ws || !wsReady) return;
  ws.send(JSON.stringify({
    type: 'load_history',
    agentId: currentAgentId,
    limit: HISTORY_PAGE,
  }));
}

function renderHistory(messages) {
  if (!messages || messages.length === 0) { showEmptyState(); return; }
  hideEmptyState();
  const container = document.getElementById('messages');
  container.innerHTML = '';
  messages.forEach(m => {
    if (m.role === 'user') appendUserMessage(m.content, false);
    else if (m.role === 'assistant') appendAssistantMessageFinal(m.content);
  });
  container.scrollTop = container.scrollHeight;
}

function sendChat() {
  const input = document.getElementById('chat-input');
  const content = input.value.trim();
  if (!content || isStreaming) return;
  if (!wsReady) { alert('WebSocket not connected'); return; }

  isStreaming = true;
  document.getElementById('send-btn').disabled = true;
  currentMsgBubble = null;

  appendUserMessage(content);
  input.value = '';
  autoResize(input);
  hideEmptyState();
  showTypingStatus();  // ← show bar

  const requestId = Date.now().toString(36);
  ws.send(JSON.stringify({ type: 'chat', content, agentId: currentAgentId, requestId }));
}

function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 200) + 'px';
}

function clearChat() {
  if (!confirm('Clear chat history?')) return;
  if (ws && wsReady) {
    ws.send(JSON.stringify({ type: 'clear_chat', agentId: currentAgentId }));
  }
}

async function summarizeChat() {
  const btn = document.querySelector('[onclick="summarizeChat()"]');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Summarizing...'; }
  try {
    const r = await fetch('/api/memory/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: currentAgentId }),
    });
    const d = await r.json();
    appendSystemMessage('📄 Summary: ' + (d.summary || '(empty)'));
  } catch (e) {
    appendErrorMessage('Summarize failed: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📄 Summarize'; }
  }
}

// ── Chat message rendering ────────────────────────────────────────────────────

function getBotAvatar() {
  if (currentAgentId === 'brain') return '🧠';
  const sel = document.getElementById('agent-selector');
  const opt = sel?.querySelector(`option[value="${currentAgentId}"]`);
  return opt ? opt.textContent.split(' ')[0] : '🤖';
}

// User: avatar RIGHT → DOM order [avatar][col] + row-reverse → col left, avatar right
function appendUserMessage(content, scroll = true) {
  hideEmptyState();
  const div = document.createElement('div');
  div.className = 'msg msg-user';
  div.innerHTML = `
    <div class="msg-row">
      <div class="msg-avatar msg-avatar-user">👤</div>
      <div class="msg-col">
        <div class="msg-bubble">${escHtml(content)}</div>
        <div class="msg-meta">${fmtTime(Date.now())}</div>
      </div>
    </div>`;
  document.getElementById('messages').appendChild(div);
  if (scroll) div.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

// Bot: show typing dots immediately, replace with content on first token
function appendAssistantMessage(content, requestId) {
  hideEmptyState();
  const avatar = getBotAvatar();
  const div = document.createElement('div');
  div.className = 'msg msg-assistant';
  div.dataset.requestId = requestId || '';
  div.innerHTML = `
    <div class="msg-row">
      <div class="msg-avatar msg-avatar-bot">${avatar}</div>
      <div class="msg-col">
        <div class="msg-bubble msg-bubble-typing">
          <span class="typing-dots"><span></span><span></span><span></span></span>
        </div>
        <div class="msg-meta" id="stats-${requestId}">typing...</div>
      </div>
    </div>`;
  document.getElementById('messages').appendChild(div);
  currentMsgBubble = div.querySelector('.msg-bubble');
  div.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function appendAssistantMessageFinal(content) {
  const avatar = getBotAvatar();
  const div = document.createElement('div');
  div.className = 'msg msg-assistant';
  div.innerHTML = `
    <div class="msg-row">
      <div class="msg-avatar msg-avatar-bot">${avatar}</div>
      <div class="msg-col">
        <div class="msg-bubble">${renderMarkdown(content)}</div>
        <div class="msg-meta">—</div>
      </div>
    </div>`;
  document.getElementById('messages').appendChild(div);
}

function appendToken(token) {
  if (!currentMsgBubble) return;
  // First token: replace typing dots with actual text
  if (currentMsgBubble.classList.contains('msg-bubble-typing')) {
    currentMsgBubble.classList.remove('msg-bubble-typing');
    currentMsgBubble.innerHTML = '';
  }
  currentMsgBubble.innerHTML =
    currentMsgBubble.innerHTML.replace('<span class="typing-cursor">▌</span>', '') +
    escHtml(token) +
    '<span class="typing-cursor">▌</span>';
  currentMsgBubble.closest('.msg')?.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function finalizeMessage(stats) {
  if (!currentMsgBubble) return;
  const raw = currentMsgBubble.innerHTML
    .replace('<span class="typing-cursor">▌</span>', '')
    .replace(/<span class="typing-dots">[\s\S]*?<\/span>/, '');
  const decoded = raw
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"');
  currentMsgBubble.classList.remove('msg-bubble-typing');
  currentMsgBubble.innerHTML = renderMarkdown(decoded);

  if (stats) {
    const metaEl = currentMsgBubble.closest('.msg')?.querySelector('.msg-meta');
    if (metaEl) {
      const statsText = stats.estimatedTokens
        ? `~${stats.estimatedTokens} tokens · ${stats.selectedMessages} msgs` : '';
      metaEl.textContent = `${fmtTime(Date.now())} ${statsText}`;
      const badge = document.getElementById('live-stats');
      if (badge && statsText) badge.textContent = statsText;
    }
  }
  currentMsgBubble = null;
}

function appendToolCallBadge(tool) {
  const div = document.createElement('div');
  div.className = 'msg msg-tool';
  div.innerHTML = `<div class="tool-badge">🔧 ${escHtml(tool)}</div>`;
  document.getElementById('messages').appendChild(div);
  div.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function appendErrorMessage(msg) {
  const div = document.createElement('div');
  div.className = 'msg msg-error';
  div.innerHTML = `<div class="msg-bubble">⚠️ ${escHtml(msg)}</div>`;
  document.getElementById('messages').appendChild(div);
  currentMsgBubble = null;
  div.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function appendSystemMessage(msg) {
  const div = document.createElement('div');
  div.className = 'msg msg-system';
  div.innerHTML = `<div class="msg-bubble">${escHtml(msg)}</div>`;
  document.getElementById('messages').appendChild(div);
  div.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function showEmptyState() {
  const es = document.getElementById('empty-state');
  if (es) es.style.display = '';
}

function hideEmptyState() {
  const es = document.getElementById('empty-state');
  if (es) es.style.display = 'none';
}

function showTypingStatus(text = 'Brain đang trả lời...') {
  const bar = document.getElementById('typing-status');
  if (!bar) return;
  bar.classList.add('visible');
  setTypingStatusText(text);
}

function hideTypingStatus() {
  const bar = document.getElementById('typing-status');
  if (bar) bar.classList.remove('visible');
  clearToolBadge();
}

function setTypingStatusText(text) {
  const el = document.getElementById('typing-status-text');
  if (el) el.textContent = text;
}

function showToolBadge(toolName) {
  const el = document.getElementById('typing-tool-badge');
  if (!el) return;
  el.textContent = `🔧 ${toolName}`;
  el.style.display = '';
}

function clearToolBadge() {
  const el = document.getElementById('typing-tool-badge');
  if (el) el.style.display = 'none';
}

// Simple markdown renderer
function renderMarkdown(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // code blocks
    .replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
      `<pre><code class="lang-${lang}">${code.trim()}</code></pre>`)
    // inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // headers
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // newlines
    .replace(/\n/g, '<br>');
}

// ── Logs ──────────────────────────────────────────────────────────────────────
async function loadLogs() {
  const r = await fetch('/api/logs?limit=200');
  allLogs = await r.json();
  renderLogs();
  updateLogCount();
}

function appendLogEntry(entry) {
  allLogs.push(entry);
  if (allLogs.length > 500) allLogs.shift();
  if (currentLogLevel === 'all' || entry.level === currentLogLevel) {
    const list = document.getElementById('log-list');
    list.appendChild(buildLogEl(entry));
    if (autoScrollEnabled) list.scrollTop = list.scrollHeight;
  }
  updateLogCount();
}

function renderLogs() {
  const list = document.getElementById('log-list');
  const filtered = currentLogLevel === 'all' ? allLogs : allLogs.filter(l => l.level === currentLogLevel);
  list.innerHTML = filtered.map(l => buildLogEl(l).outerHTML).join('');
  if (autoScrollEnabled) list.scrollTop = list.scrollHeight;
}

function buildLogEl(entry) {
  const div = document.createElement('div');
  div.className = `log-entry log-${entry.level}`;
  const t = fmtTime(new Date(entry.timestamp).getTime());
  div.innerHTML = `<span class="log-time">${t}</span><span class="log-level">${entry.level.toUpperCase()}</span><span class="log-source">[${escHtml(entry.source)}]</span><span class="log-msg">${escHtml(entry.message)}</span>`;
  return div;
}

function filterLogs(level) {
  currentLogLevel = level;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b.dataset.level === level));
  renderLogs();
}

function toggleAutoscroll() {
  autoScrollEnabled = !autoScrollEnabled;
  const tog = document.getElementById('autoscroll-toggle');
  if (tog) tog.className = `toggle ${autoScrollEnabled ? 'on' : ''}`;
}

async function clearLogs() {
  if (!confirm('Clear all logs?')) return;
  await fetch('/api/logs', { method: 'DELETE' });
  allLogs = [];
  document.getElementById('log-list').innerHTML = '';
  updateLogCount();
}

function updateLogCount() {
  const n = allLogs.length;
  const el1 = document.getElementById('log-count');
  const el2 = document.getElementById('log-total-count');
  if (el1) el1.textContent = n;
  if (el2) el2.textContent = `${n} entries`;
}

// ── Telegram ──────────────────────────────────────────────────────────────────
async function loadTelegram() {
  const r = await fetch('/api/telegram');
  const s = await r.json();
  renderTelegramStatus(s);

  const msgs = await fetch('/api/telegram/messages').then(r => r.json());
  if (msgs && msgs.length) renderTelegramMessages(msgs);
}

function renderTelegramStatus(s) {
  const dot = document.getElementById('tg-dot');
  const txt = document.getElementById('tg-status-text');
  const title = document.getElementById('tg-card-title');
  const sub = document.getElementById('tg-card-sub');
  const btn = document.getElementById('tg-connect-btn');
  const sendCard = document.getElementById('tg-send-card');
  const ownerDot = document.getElementById('owner-dot');
  const ownerTxt = document.getElementById('owner-status-text');

  if (!s) return;

  if (s.connected) {
    if (dot) dot.className = 'dot green';
    if (txt) txt.textContent = `Telegram: @${s.username || 'connected'}`;
    if (title) title.textContent = `@${s.username || 'Bot'} connected`;
    if (sub) sub.textContent = 'Telegram bot is active and ready';
    if (btn) btn.textContent = 'Disconnect';
    if (sendCard) sendCard.style.display = '';
    const tokenInput = document.getElementById('tg-token-input');
    if (tokenInput && s.token) tokenInput.value = s.token;
  } else {
    if (dot) dot.className = 'dot red';
    if (txt) txt.textContent = 'Telegram: —';
    if (title) title.textContent = 'Not connected';
    if (sub) sub.textContent = 'Connect your Telegram bot to control Brain OS remotely';
    if (btn) btn.textContent = 'Connect';
    if (sendCard) sendCard.style.display = 'none';
  }

  if (s.ownerChatId) {
    if (ownerDot) ownerDot.className = 'dot green';
    if (ownerTxt) ownerTxt.textContent = `ID: ${s.ownerChatId}`;
    const ownerInput = document.getElementById('tg-owner-input');
    if (ownerInput) ownerInput.value = s.ownerChatId;
  } else {
    if (ownerDot) ownerDot.className = 'dot';
    if (ownerTxt) ownerTxt.textContent = 'Chưa thiết lập';
  }
}

function renderTelegramMessages(msgs) {
  const section = document.getElementById('tg-messages-section');
  const list = document.getElementById('tg-messages-list');
  const count = document.getElementById('tg-msg-count');
  if (!section || !list) return;
  section.style.display = '';
  count.textContent = msgs.length;
  list.innerHTML = msgs.slice(-20).reverse().map(m => `
    <div class="tg-msg-item">
      <span class="tg-msg-from">${escHtml(m.from || 'unknown')}</span>
      <span class="tg-msg-text">${escHtml(m.text || '')}</span>
      <span class="tg-msg-time">${fmtTime(m.timestamp || Date.now())}</span>
    </div>`).join('');
}

function appendTelegramMessage(msg) {
  const section = document.getElementById('tg-messages-section');
  if (section) section.style.display = '';
  const list = document.getElementById('tg-messages-list');
  const empty = list?.querySelector('.section-empty');
  if (empty) empty.remove();
  if (!list) return;

  const isOut = msg.direction === 'out';
  const label = isOut
    ? `🧠 Brain → ${escHtml(msg.to || 'user')}`
    : `👤 ${escHtml(msg.from || msg.chatId || '?')}`;
  const ts = fmtTime(msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now());

  const div = document.createElement('div');
  div.className = `tg-msg-item ${isOut ? 'tg-msg-out' : 'tg-msg-in'}`;
  div.innerHTML = `
    <span class="tg-msg-from">${label}</span>
    <span class="tg-msg-text">${escHtml(msg.text || '')}</span>
    <span class="tg-msg-time">${ts}</span>`;
  list.prepend(div);

  const count = document.getElementById('tg-msg-count');
  if (count) count.textContent = parseInt(count.textContent || '0') + 1;
}

async function toggleTelegram() {
  const r = await fetch('/api/telegram');
  const s = await r.json();

  if (s.connected) {
    if (!confirm('Disconnect Telegram?')) return;
    await fetch('/api/telegram/disconnect', { method: 'POST' });
  } else {
    const token = document.getElementById('tg-token-input').value.trim();
    if (!token) return alert('Enter bot token first');
    const btn = document.getElementById('tg-connect-btn');
    btn.disabled = true;
    btn.textContent = 'Connecting...';
    try {
      const res = await fetch('/api/telegram/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed');
    } catch (e) {
      alert('Error: ' + e.message);
    } finally {
      btn.disabled = false;
    }
  }
  loadTelegram();
}

async function saveOwnerChatId() {
  const chatId = document.getElementById('tg-owner-input').value.trim();
  if (!chatId) return alert('Enter Chat ID first');
  await fetch('/api/telegram/owner', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId }),
  });
  loadTelegram();
}

async function testSendToOwner() {
  const btn = document.getElementById('test-send-btn');
  btn.disabled = true;
  btn.textContent = 'Sending...';
  try {
    const r = await fetch('/api/telegram/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '👋 Brain OS test message — connection OK!' }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Failed');
    alert('Sent! Check Telegram.');
  } catch (e) {
    alert('Error: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Gửi tin test';
  }
}

async function sendManualTelegram() {
  const msg = document.getElementById('tg-manual-msg').value.trim();
  if (!msg) return;
  await fetch('/api/telegram/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: msg }),
  });
  document.getElementById('tg-manual-msg').value = '';
}

// ── Init ──────────────────────────────────────────────────────────────────────
(function init() {
  // Apply saved theme
  const savedTheme = localStorage.getItem('theme') || 'dark';
  applyTheme(savedTheme === 'dark');

  // Start WebSocket
  connect();

  // Set initial tab btn styles
  switchModalTab('general');
})();