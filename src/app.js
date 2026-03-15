// ─── Theme ────────────────────────────────────────────────────────────────────
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('brain-os-theme', theme);
    const isLight = theme === 'light';
    document.getElementById('theme-icon').textContent = isLight ? '🌙' : '☀️';
    document.getElementById('theme-label').textContent = isLight ? 'Dark mode' : 'Light mode';
}
function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    applyTheme(current === 'light' ? 'dark' : 'light');
}
// Init theme
(function () {
    const saved = localStorage.getItem('brain-os-theme') || 'dark';
    applyTheme(saved);
})();

// ─── WebSocket ────────────────────────────────────────────────────────────────
let ws, wsReady = false, reconnectTimer;
let currentAgent = 'brain';
let logFilter = 'all';
let logCount = 0;
let autoscroll = true;
let isStreaming = false;
let currentMsgBubble = null;
let currentResponseDiv = null;

const defaultModels = { claude: 'claude-opus-4-5', gemini: 'gemini-2.0-flash', openai: 'gpt-4o', ollama: 'qwen2.5:3b' };

function connect() {
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
        const msg = JSON.parse(e.data);
        handleWS(msg);
    };

    ws.onclose = () => {
        wsReady = false;
        reconnectTimer = setTimeout(connect, 2000);
    };
}

function handleWS(msg) {
    if (msg.type === 'chat_token') {
        if (!currentMsgBubble) {
            appendAssistantMessage('', msg.requestId);
        }
        appendToken(msg.token);
    }
    if (msg.type === 'chat_done') {
        finalizeMessage(msg.stats);
        isStreaming = false;
        document.getElementById('send-btn').disabled = false;
    }
    if (msg.type === 'chat_error') {
        appendErrorMessage(msg.error);
        isStreaming = false;
        document.getElementById('send-btn').disabled = false;
    }
    if (msg.type === 'log') {
        appendLogEntry(msg.entry);
    }
    if (msg.type === 'telegram_status') {
        renderTelegramStatus(msg.status);
    }
    if (msg.type === 'telegram_message') {
        appendTelegramMessage(msg.message);
    }
    if (msg.type === 'chat_cleared') {
        document.getElementById('messages').innerHTML = '';
        historyOffset = 0;
        showEmptyState();
    }
}

// ─── Status ───────────────────────────────────────────────────────────────────
async function loadStatus() {
    try {
        const r = await fetch('/api/status');
        const s = await r.json();
        const brainDot = document.getElementById('brain-dot');
        const brainText = document.getElementById('brain-status-text');
        brainDot.className = 'dot ' + (s.brain.available ? 'green' : 'red');
        brainText.textContent = `Brain: ${s.brain.model}`;
        document.getElementById('memory-info').textContent = `Memory: ${s.memorySize} msgs`;
        document.getElementById('agent-count').textContent = s.agentCount;
        renderTelegramStatus(s.telegram);
    } catch { }
    setTimeout(loadStatus, 8000);
}

// ─── Tab switching ─────────────────────────────────────────────────────────────
function switchTab(tab) {
    document.querySelectorAll('.nav-item').forEach(el =>
        el.classList.toggle('active', el.dataset.tab === tab));
    document.querySelectorAll('.tab-content').forEach(el =>
        el.classList.toggle('active', el.id === 'tab-' + tab));
}

// ─── CHAT ─────────────────────────────────────────────────────────────────────
function showEmptyState() {
    const msg = document.getElementById('messages');
    if (!msg.querySelector('.msg')) {
        const es = document.createElement('div');
        es.className = 'empty-state';
        es.id = 'empty-state';
        es.innerHTML = '<div class="big-icon">🧠</div><p>Brain OS is ready.</p>';
        msg.appendChild(es);
    }
}

function removeEmptyState() {
    const es = document.getElementById('empty-state');
    if (es) es.remove();
}

function appendUserMessage(text) {
    removeEmptyState();
    const msgs = document.getElementById('messages');
    const time = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    const div = document.createElement('div');
    div.className = 'msg user';
    div.innerHTML = `
    <div class="msg-body">
      <div class="msg-meta">${time}</div>
      <div class="msg-bubble">${escHtml(text)}</div>
    </div>
    <div class="msg-avatar">👤</div>`;
    msgs.appendChild(div);
    // Typing indicator
    const typing = document.createElement('div');
    typing.className = 'msg assistant';
    typing.id = 'typing-indicator';
    typing.innerHTML = `<div class="msg-avatar">🧠</div><div class="msg-body"><div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div></div>`;
    msgs.appendChild(typing);
    msgs.scrollTop = msgs.scrollHeight;
}

function appendAssistantMessage(text) {
    const indicator = document.getElementById('typing-indicator');
    if (indicator) indicator.remove();

    const msgs = document.getElementById('messages');
    const time = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    // Tìm agent name từ selector nếu có
    const sel = document.getElementById('agent-selector');
    const selText = sel?.options[sel.selectedIndex]?.text || currentAgent;
    const agentName = currentAgent === 'brain' ? '🧠 Brain' : selText;

    const div = document.createElement('div');
    div.className = 'msg assistant';
    div.innerHTML = `
    <div class="msg-avatar">🤖</div>
    <div class="msg-body">
      <div class="msg-meta"><span class="msg-agent">${escHtml(agentName)}</span> · ${time}</div>
      <div class="msg-bubble"></div>
    </div>`;
    msgs.appendChild(div);
    // FIX: dùng direct reference thay vì getElementById để không bao giờ tìm nhầm bubble cũ
    currentMsgBubble = div.querySelector('.msg-bubble');
    currentResponseDiv = div;
    msgs.scrollTop = msgs.scrollHeight;
}

function appendToken(token) {
    if (!currentMsgBubble) return;
    currentMsgBubble.textContent += token;
    const msgs = document.getElementById('messages');
    msgs.scrollTop = msgs.scrollHeight;
}

function finalizeMessage(stats) {
    if (stats) {
        const info = `${stats.selectedMessages}/${stats.totalMessages} msgs · ~${stats.estimatedTokens} tokens`;
        document.getElementById('live-stats').textContent = info;
        document.getElementById('chat-context-info').textContent = info;
    }
    // FIX: reset cả 2 references, không dùng id nữa
    currentMsgBubble = null;
    currentResponseDiv = null;
}

function appendErrorMessage(error) {
    const indicator = document.getElementById('typing-indicator');
    if (indicator) indicator.remove();
    const msgs = document.getElementById('messages');
    const div = document.createElement('div');
    div.className = 'msg assistant';
    div.innerHTML = `<div class="msg-avatar">⚠️</div><div class="msg-body"><div class="msg-bubble" style="color:var(--red);border-color:#ef444440">${escHtml(error)}</div></div>`;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
}

function sendChat() {
    if (isStreaming) return;
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text || !wsReady) return;

    appendUserMessage(text);
    input.value = '';
    autoResize(input);
    isStreaming = true;
    document.getElementById('send-btn').disabled = true;

    ws.send(JSON.stringify({ type: 'chat', content: text, agentId: currentAgent, requestId: Date.now().toString(36) }));
}

function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
}

function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function clearChat() {
    if (confirm('Clear conversation history?'))
        ws.send(JSON.stringify({ type: 'clear_chat', agentId: currentAgent }));
}

async function summarizeChat() {
    const r = await fetch('/api/memory/summarize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentId: currentAgent }) });
    const d = await r.json();
    if (d.summary) alert('Summary saved:\n\n' + d.summary);
    else alert('Not enough history to summarize yet.');
}

function onAgentChange() {
    currentAgent = document.getElementById('agent-selector').value;
    // Xóa chat UI và load lại history của agent mới
    document.getElementById('messages').innerHTML = '';
    historyOffset = 0;
    loadChatHistory(true);
}

// ─── HISTORY ──────────────────────────────────────────────────────────────────
const HISTORY_PAGE = 30;
let historyOffset = 0;
let historyTotal = 0;

async function loadChatHistory(isInitial = false) {
    const r = await fetch(`/api/memory?agentId=${currentAgent}&limit=500`);
    const all = await r.json();

    // Chỉ lấy user + assistant messages, loại system
    const msgs = all.filter(m => m.role === 'user' || m.role === 'assistant');
    historyTotal = msgs.length;

    if (!msgs.length) { showEmptyState(); return; }

    removeEmptyState();

    // Load more button
    const msgs_el = document.getElementById('messages');
    const loadMoreBtn = document.getElementById('load-more-btn');
    if (loadMoreBtn) loadMoreBtn.remove();

    const start = Math.max(0, historyTotal - historyOffset - HISTORY_PAGE);
    const slice = msgs.slice(start, historyTotal - historyOffset);
    const hasMore = start > 0;

    if (hasMore) {
        const btn = document.createElement('div');
        btn.id = 'load-more-btn';
        btn.className = 'load-more-btn';
        btn.textContent = `Load ${Math.min(start, HISTORY_PAGE)} more messages`;
        btn.onclick = () => {
            historyOffset += HISTORY_PAGE;
            loadChatHistory(false);
        };
        msgs_el.insertBefore(btn, msgs_el.firstChild);
    }

    // Khi load thêm (scroll up): chèn trước button hoặc đầu list
    const anchor = isInitial ? null : msgs_el.querySelector('.load-more-btn');

    // Render messages theo thứ tự
    const fragment = document.createDocumentFragment();
    for (const m of slice) {
        // Kiểm tra đã render chưa (tránh duplicate khi reload)
        if (document.querySelector(`[data-msg-id="${m.id}"]`)) continue;
        const el = createHistoryMsgEl(m);
        fragment.appendChild(el);
    }

    if (anchor) {
        // Insert sau load-more button
        anchor.after(fragment);
    } else {
        msgs_el.appendChild(fragment);
        // Chỉ scroll xuống cuối khi là lần đầu load
        if (isInitial) msgs_el.scrollTop = msgs_el.scrollHeight;
    }
}

function createHistoryMsgEl(m) {
    const div = document.createElement('div');
    div.className = `msg ${m.role === 'user' ? 'user' : 'assistant'} history-msg`;
    div.dataset.msgId = m.id;

    const date = new Date(m.timestamp);
    const isToday = date.toDateString() === new Date().toDateString();
    const timeStr = isToday
        ? date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
        : date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }) + ' ' + date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

    if (m.role === 'user') {
        div.innerHTML = `
      <div class="msg-body">
        <div class="msg-meta">${timeStr}</div>
        <div class="msg-bubble">${escHtml(m.content)}</div>
      </div>
      <div class="msg-avatar">👤</div>`;
    } else {
        const agentLabel = m.agentId === 'brain' ? '🧠 Brain' : (m.agentId || 'Agent');
        div.innerHTML = `
      <div class="msg-avatar">🤖</div>
      <div class="msg-body">
        <div class="msg-meta"><span class="msg-agent">${escHtml(agentLabel)}</span> · ${timeStr}</div>
        <div class="msg-bubble">${escHtml(m.content)}</div>
      </div>`;
    }
    return div;
}

// ─── AGENTS ───────────────────────────────────────────────────────────────────
let agentViewMode = 'canvas'; // 'canvas' | 'grid'
let orModels = []; // OpenRouter models cache

async function loadAgents() {
    const r = await fetch('/api/agents');
    const list = await r.json();
    renderAgentCanvas(list);
    renderAgents(list);
    updateAgentSelector(list);
    document.getElementById('agent-count').textContent = list.length;
    document.getElementById('agents-count-meta').textContent = list.length + ' agents';
}

function toggleAgentView() {
    agentViewMode = agentViewMode === 'canvas' ? 'grid' : 'canvas';
    document.getElementById('agents-canvas').style.display = agentViewMode === 'canvas' ? 'flex' : 'none';
    document.getElementById('agents-grid-view').style.display = agentViewMode === 'grid' ? 'flex' : 'none';
    document.getElementById('view-toggle').textContent = agentViewMode === 'canvas' ? '⊞ Grid' : '◈ Canvas';
}

// ── Canvas (n8n-style) ────────────────────────────────────────────────────────

const providerIcon = { claude: '🎭', gemini: '✨', openrouter: '🌐', ollama: '🦙', openai: '⚡' };
const providerColor = { claude: 'pb-claude', gemini: 'pb-gemini', openrouter: 'pb-openrouter', ollama: 'pb-ollama', openai: 'pb-openai' };

function renderAgentCanvas(list) {
    const col = document.getElementById('agent-nodes-col');
    col.innerHTML = '';

    if (!list.length) {
        col.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:20px 0 0 20px">No agents yet.<br>Click + New Agent to add one.</div>';
        document.getElementById('connector-main').style.display = 'none';
        return;
    }
    document.getElementById('connector-main').style.display = 'block';

    list.forEach((a, i) => {
        const row = document.createElement('div');
        row.className = 'node-row';

        const wire = document.createElement('div');
        wire.className = 'node-wire' + (a.active ? ' active' : '');
        wire.style.width = '80px';

        const card = document.createElement('div');
        card.className = 'node-card' + (a.active ? '' : ' inactive');
        card.onclick = () => editAgent(a.id);
        const icon = providerIcon[a.provider] || '🤖';
        const pColor = providerColor[a.provider] || '';
        card.innerHTML = `
      <div class="node-icon">${icon}</div>
      <div class="node-body">
        <div class="node-title">${escHtml(a.name)}</div>
        <div class="node-sub ${pColor}">${a.provider} · ${a.model.split('/').pop()}</div>
      </div>
      <div class="node-status-dot ${a.active ? 'green' : 'gray'}"></div>
      <div class="node-actions">
        <button class="node-action-btn" onclick="event.stopPropagation();editAgent('${a.id}')">Edit</button>
        <button class="node-action-btn" onclick="event.stopPropagation();toggleAgent('${a.id}',${!a.active})">${a.active ? 'Disable' : 'Enable'}</button>
        <button class="node-action-btn del" onclick="event.stopPropagation();deleteAgent('${a.id}')">Delete</button>
      </div>`;

        row.appendChild(wire);
        row.appendChild(card);
        col.appendChild(row);
    });

    // Fix connector-main height to center on agents
    const brainNode = document.getElementById('node-brain');
    const brainH = brainNode?.offsetHeight || 56;
    const totalH = list.length * 68;
    const midAgent = totalH / 2;
    document.getElementById('connector-main').style.cssText = `height:1px;background:var(--border2);width:80px;margin-top:${midAgent - brainH / 2 + brainH / 2}px`;
}

// ── Grid view ──────────────────────────────────────────────────────────────────

function renderAgents(list) {
    const grid = document.getElementById('agents-grid');
    if (!list.length) {
        grid.innerHTML = '<div class="section-empty" style="grid-column:1/-1">No agents yet.</div>';
        return;
    }
    grid.innerHTML = list.map(a => `
    <div class="agent-card">
      <div class="agent-card-header">
        <div class="agent-card-name">${escHtml(a.name)}</div>
        <span class="provider-badge provider-${a.provider}">${a.provider}</span>
      </div>
      <div class="agent-desc">${escHtml(a.description || '—')}</div>
      <div class="agent-model">${a.model}</div>
      <div class="agent-actions">
        <button class="btn btn-ghost btn-sm" onclick="editAgent('${a.id}')">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteAgent('${a.id}')">Delete</button>
        <div class="active-toggle">
          <span class="toggle ${a.active ? 'on' : ''}" onclick="toggleAgent('${a.id}', ${!a.active})"></span>
        </div>
      </div>
    </div>`).join('');
}

function updateAgentSelector(list) {
    const sel = document.getElementById('agent-selector');
    const cur = sel.value;
    const extra = list.map(a => `<option value="${a.id}">${a.name} (${a.provider})</option>`).join('');
    sel.innerHTML = `<option value="brain">🧠 Brain (Local)</option>${extra}`;
    sel.value = cur || 'brain';
}

// ── OpenRouter model fetch ─────────────────────────────────────────────────────

async function fetchOpenRouterModels(apiKey) {
    if (orModels.length) return orModels;
    try {
        const headers = apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {};
        const r = await fetch('https://openrouter.ai/api/v1/models', { headers });
        if (!r.ok) return [];
        const d = await r.json();
        orModels = (d.data || [])
            .map(m => ({ id: m.id, name: m.name || m.id, ctx: m.context_length }))
            .sort((a, b) => a.id.localeCompare(b.id));
        return orModels;
    } catch { return []; }
}

function buildModelSelect(models, currentVal) {
    const opts = models.map(m =>
        `<option value="${escHtml(m.id)}" ${m.id === currentVal ? 'selected' : ''}>${escHtml(m.name)}</option>`
    ).join('');
    return `<select class="form-select" id="agent-model-select" onchange="document.getElementById('agent-model').value=this.value">${opts}</select>`;
}

async function onProviderChange() {
    const p = document.getElementById('agent-provider').value;
    const modelInput = document.getElementById('agent-model');
    const modelWrap = document.getElementById('agent-model-wrap');

    if (p === 'openrouter') {
        modelInput.value = '';
        modelWrap.innerHTML = `<div style="color:var(--muted);font-size:11px;font-family:var(--mono);padding:6px 0">Loading models...</div><input type="hidden" class="form-input" id="agent-model" value="auto">`;
        const apiKey = document.getElementById('agent-apikey').value.trim();
        const models = await fetchOpenRouterModels(apiKey);
        // Prepend "Auto" option
        const autoOpt = { id: 'auto', name: '✨ Auto (smart routing by context)' };
        const allModels = [autoOpt, ...models];
        const currentVal = document.getElementById('agent-model')?.value || 'auto';
        modelWrap.innerHTML = buildModelSelect(allModels, currentVal) + `<input type="hidden" id="agent-model" value="${currentVal}">`;
        document.getElementById('agent-model-select').onchange = function () {
            document.getElementById('agent-model').value = this.value;
        };
        // hint
        document.getElementById('model-hint').textContent = '— auto chọn model theo context';
    } else {
        const defaults = { claude: 'claude-opus-4-5', gemini: 'gemini-2.0-flash', openai: 'gpt-4o', ollama: 'qwen2.5:3b' };
        modelWrap.innerHTML = `<input type="text" class="form-input" id="agent-model" placeholder="e.g. ${defaults[p] || 'model-name'}" value="${defaults[p] || ''}">`;
        document.getElementById('model-hint').textContent = '';
    }
}

function openAgentModal(data = null) {
    document.getElementById('modal-title').textContent = data ? 'Edit Agent' : 'New Agent';
    document.getElementById('agent-edit-id').value = data?.id || '';
    document.getElementById('agent-name').value = data?.name || '';
    document.getElementById('agent-desc-input').value = data?.description || '';
    document.getElementById('agent-provider').value = data?.provider || 'claude';
    document.getElementById('agent-apikey').value = data?.apiKey || '';
    document.getElementById('agent-prompt').value = data?.systemPrompt || '';
    // Reset model wrap then trigger provider change to set correct model input
    const defaults = { claude: 'claude-opus-4-5', gemini: 'gemini-2.0-flash', openai: 'gpt-4o', ollama: 'qwen2.5:3b' };
    const p = data?.provider || 'claude';
    const mv = data?.model || defaults[p] || '';
    document.getElementById('agent-model-wrap').innerHTML = `<input type="text" class="form-input" id="agent-model" value="${escHtml(mv)}">`;
    if (p === 'openrouter') onProviderChange();
    document.getElementById('agent-modal').classList.add('open');
}

function closeAgentModal() { document.getElementById('agent-modal').classList.remove('open'); }

async function saveAgent() {
    const id = document.getElementById('agent-edit-id').value;
    const body = {
        name: document.getElementById('agent-name').value.trim(),
        description: document.getElementById('agent-desc-input').value.trim(),
        provider: document.getElementById('agent-provider').value,
        model: document.getElementById('agent-model').value.trim(),
        apiKey: document.getElementById('agent-apikey').value.trim(),
        systemPrompt: document.getElementById('agent-prompt').value.trim(),
    };
    if (!body.name) return alert('Name required');
    const url = id ? `/api/agents/${id}` : '/api/agents';
    const method = id ? 'PUT' : 'POST';
    await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    closeAgentModal();
    loadAgents();
}

function editAgent(id) {
    fetch('/api/agents').then(r => r.json()).then(list => {
        const a = list.find(x => x.id === id);
        if (a) openAgentModal(a);
    });
}

async function deleteAgent(id) {
    if (!confirm('Delete this agent?')) return;
    await fetch(`/api/agents/${id}`, { method: 'DELETE' });
    loadAgents();
}

async function toggleAgent(id, active) {
    await fetch(`/api/agents/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active }) });
    loadAgents();
}

// ─── TELEGRAM ─────────────────────────────────────────────────────────────────
function renderTelegramStatus(s) {
    const dot = document.getElementById('tg-dot');
    const text = document.getElementById('tg-status-text');
    const title = document.getElementById('tg-card-title');
    const sub = document.getElementById('tg-card-sub');
    const btn = document.getElementById('tg-connect-btn');
    const msgsSection = document.getElementById('tg-messages-section');
    const sendCard = document.getElementById('tg-send-card');
    const ownerDot = document.getElementById('owner-dot');
    const ownerText = document.getElementById('owner-status-text');

    dot.className = 'dot ' + (s.connected ? 'green' : 'amber');
    text.textContent = s.connected ? `@${s.username}` : 'Telegram: —';
    if (title) title.textContent = s.connected ? `Connected · @${s.username}` : 'Not connected';
    if (sub) sub.textContent = s.connected ? 'Bot đang nhận tin' : 'Connect bot để điều khiển Brain OS từ xa';
    if (btn) { btn.textContent = s.connected ? 'Disconnect' : 'Connect'; btn.className = 'btn btn-sm ' + (s.connected ? 'btn-danger' : 'btn-primary'); }
    if (msgsSection) msgsSection.style.display = s.connected ? 'block' : 'none';
    if (sendCard) sendCard.style.display = (s.connected && s.ownerChatId) ? 'block' : 'none';

    // Owner chat ID status
    if (ownerDot && ownerText) {
        if (s.ownerChatId) {
            ownerDot.className = 'dot green';
            ownerText.textContent = `ID: ${s.ownerChatId}`;
            document.getElementById('tg-owner-input').value = s.ownerChatId;
            document.getElementById('test-send-btn').disabled = !s.connected;
        } else {
            ownerDot.className = 'dot amber';
            ownerText.textContent = 'Chưa thiết lập';
        }
    }
}

async function saveOwnerChatId() {
    const chatId = document.getElementById('tg-owner-input').value.trim();
    if (!chatId || isNaN(chatId)) return alert('Chat ID phải là số. Lấy từ @userinfobot trên Telegram.');
    const r = await fetch('/api/telegram/owner', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId }) });
    const d = await r.json();
    if (d.ok) { loadTelegram(); }
    else alert('Lỗi: ' + d.error);
}

async function testSendToOwner() {
    const btn = document.getElementById('test-send-btn');
    btn.disabled = true; btn.textContent = 'Đang gửi...';
    try {
        const r = await fetch('/api/telegram/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '✅ Brain OS test message — kết nối thành công! Brain giờ có thể chủ động nhắn tin cho bạn.' }) });
        const d = await r.json();
        if (d.error) alert('Lỗi: ' + d.error);
        else { btn.textContent = 'Đã gửi!'; setTimeout(() => { btn.textContent = 'Gửi tin test'; btn.disabled = false; }, 2000); return; }
    } catch (e) { alert('Lỗi: ' + e.message); }
    btn.textContent = 'Gửi tin test'; btn.disabled = false;
}

async function sendManualTelegram() {
    const msg = document.getElementById('tg-manual-msg').value.trim();
    if (!msg) return;
    const r = await fetch('/api/telegram/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: msg }) });
    const d = await r.json();
    if (d.error) alert('Lỗi: ' + d.error);
    else document.getElementById('tg-manual-msg').value = '';
}

async function loadTelegram() {
    const r = await fetch('/api/telegram');
    const s = await r.json();
    renderTelegramStatus(s);
    // Pre-fill token input nếu đã có token lưu
    if (s.savedToken) {
        document.getElementById('tg-token-input').value = s.savedToken;
    }
    if (s.connected) {
        const mr = await fetch('/api/telegram/messages');
        const msgs = await mr.json();
        msgs.forEach(m => appendTelegramMessage(m));
    }
}

async function toggleTelegram() {
    const r = await fetch('/api/telegram');
    const s = await r.json();

    if (s.connected) {
        await fetch('/api/telegram/disconnect', { method: 'POST' });
        loadTelegram();
    } else {
        const token = document.getElementById('tg-token-input').value.trim();
        if (!token) return alert('Enter a bot token first');
        const res = await fetch('/api/telegram/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
        const d = await res.json();
        if (d.error) alert('❌ Lỗi kết nối Telegram:\n\n' + d.error + '\n\nKiểm tra:\n• Token có đúng không?\n• Máy có kết nối internet không?');
        else loadTelegram();
    }
}

function appendTelegramMessage(msg) {
    const list = document.getElementById('tg-messages-list');
    const empty = list.querySelector('.section-empty');
    if (empty) empty.remove();

    const div = document.createElement('div');
    div.className = 'tg-msg ' + (msg.direction === 'in' ? 'in' : 'out');
    const t = new Date(msg.timestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    div.innerHTML = `
    <div class="tg-msg-header"><span>${msg.direction === 'in' ? '← ' + (msg.from || '?') : '→ ' + (msg.to || '?')}</span><span>${t}</span></div>
    <div class="tg-msg-text">${escHtml(msg.text)}</div>`;
    list.insertBefore(div, list.firstChild);
    document.getElementById('tg-messages-section').style.display = 'block';
}

// ─── LOGS ─────────────────────────────────────────────────────────────────────
async function loadLogs() {
    const r = await fetch('/api/logs?limit=200');
    const list = await r.json();
    const el = document.getElementById('log-list');
    el.innerHTML = '';
    list.forEach(appendLogEntry);
}

function appendLogEntry(entry) {
    const list = document.getElementById('log-list');
    logCount++;
    document.getElementById('log-count').textContent = logCount > 99 ? '99+' : logCount;
    document.getElementById('log-total-count').textContent = logCount + ' entries';

    const div = document.createElement('div');
    div.className = `log-entry ${entry.level !== logFilter && logFilter !== 'all' ? 'hide' : ''}`;
    div.dataset.level = entry.level;
    const t = new Date(entry.timestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    div.innerHTML = `
    <span class="log-time">${t}</span>
    <span class="log-level ${entry.level}">${entry.level.toUpperCase()}</span>
    <span class="log-source">${escHtml(entry.source)}</span>
    <span class="log-msg">${escHtml(entry.message)}</span>`;
    list.appendChild(div);

    if (autoscroll) list.scrollTop = list.scrollHeight;
}

function filterLogs(level) {
    logFilter = level;
    document.querySelectorAll('.filter-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.level === level));
    document.querySelectorAll('.log-entry').forEach(e =>
        e.classList.toggle('hide', level !== 'all' && e.dataset.level !== level));
}

async function clearLogs() {
    if (!confirm('Clear all logs?')) return;
    await fetch('/api/logs', { method: 'DELETE' });
    document.getElementById('log-list').innerHTML = '';
    logCount = 0;
    document.getElementById('log-count').textContent = '0';
    document.getElementById('log-total-count').textContent = '0 entries';
}

function toggleAutoscroll() {
    autoscroll = !autoscroll;
    document.getElementById('autoscroll-toggle').classList.toggle('on', autoscroll);
}

// ─── Utils ────────────────────────────────────────────────────────────────────
function escHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Close modal on backdrop click
document.getElementById('agent-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeAgentModal();
});

connect();