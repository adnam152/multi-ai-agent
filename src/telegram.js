/**
 * Telegram Integration — simple polling + proactive messaging
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const CONFIG_FILE = path.join(__dirname, '../data/config.json');

let bot = null;
let botInfo = null;
let messageLog = [];
let wsClients = new Set();
let config = {};
let brain = null;

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE))
      config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch { config = {}; }
}

function saveConfig(data) {
  config = { ...config, ...data };
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2)); } catch { }
}

function broadcast(payload) {
  const str = JSON.stringify(payload);
  for (const ws of wsClients) { try { ws.send(str); } catch { } }
}

function broadcastMessage(msg) {
  messageLog.unshift(msg);
  if (messageLog.length > 100) messageLog.pop();
  broadcast({ type: 'telegram_message', message: msg });
}

// ─── Proactive: gửi tin cho owner ────────────────────────────────────────────

async function sendToOwner(text) {
  if (!bot) throw new Error('Bot chưa kết nối');
  const chatId = config.telegramOwnerChatId;
  if (!chatId) throw new Error('Chưa có owner chat ID. Vào tab Telegram → nhập User ID của bạn, hoặc nhắn 1 tin bất kỳ cho bot để tự detect.');

  // Telegram giới hạn 4096 chars/message — chia nhỏ nếu cần
  const chunks = [];
  for (let i = 0; i < text.length; i += 4000) chunks.push(text.slice(i, i + 4000));

  for (const chunk of chunks) {
    await bot.sendMessage(chatId, chunk);
  }

  broadcastMessage({
    id: Date.now(),
    direction: 'out',
    to: 'owner',
    chatId,
    text: text.slice(0, 200) + (text.length > 200 ? '...' : ''),
    timestamp: new Date().toISOString(),
    proactive: true,
  });

  logger.info('telegram', `Sent to owner (chatId: ${chatId}): ${text.slice(0, 80)}`);
  return { ok: true, chatId, length: text.length };
}

function setOwnerChatId(chatId) {
  saveConfig({ telegramOwnerChatId: String(chatId) });
  broadcast({ type: 'telegram_status', status: getStatus() });
  logger.info('telegram', `Owner chat ID set: ${chatId}`);
}

// ─── Connect ──────────────────────────────────────────────────────────────────

async function connect(token) {
  if (bot) {
    try { await bot.stopPolling(); } catch { }
    bot = null;
    botInfo = null;
  }

  const TelegramBot = require('node-telegram-bot-api');
  const newBot = new TelegramBot(token, { polling: true });

  try {
    botInfo = await newBot.getMe();
  } catch (e) {
    try { await newBot.stopPolling(); } catch { }
    throw new Error(`Không kết nối được: ${e?.message || e}`);
  }

  bot = newBot;
  saveConfig({ telegramToken: token, telegramBotUsername: botInfo.username });
  logger.info('telegram', `Connected: @${botInfo.username}`);
  broadcast({ type: 'telegram_status', status: getStatus() });

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text) return;
    const user = msg.from.username || msg.from.first_name || String(msg.from.id);

    // Auto-detect owner: lần đầu nhắn tin → lưu chatId
    if (!config.telegramOwnerChatId) {
      saveConfig({ telegramOwnerChatId: String(chatId) });
      broadcast({ type: 'telegram_status', status: getStatus() });
      logger.info('telegram', `Auto-detected owner chat ID: ${chatId} (@${user})`);
      bot.sendMessage(chatId, `✅ Chat ID của bạn (${chatId}) đã được lưu. Brain OS giờ có thể chủ động nhắn tin cho bạn.`).catch(() => { });
    }

    broadcastMessage({ id: msg.message_id, direction: 'in', from: user, chatId, text, timestamp: new Date().toISOString() });
    logger.info('telegram', `@${user}: ${text.slice(0, 80)}`);

    if (!brain) return;
    bot.sendChatAction(chatId, 'typing').catch(() => { });

    brain.chat({
      userInput: text,
      agentId: 'brain',
      onToken: () => { },
      onDone: (content) => {
        bot.sendMessage(chatId, content).catch(() => { });
        broadcastMessage({ id: Date.now(), direction: 'out', to: user, chatId, text: content, timestamp: new Date().toISOString() });
      },
      onError: (e) => {
        bot.sendMessage(chatId, `⚠️ ${e.message}`).catch(() => { });
      }
    });
  });

  bot.on('polling_error', (err) => {
    const msg = err?.message || String(err);
    if (msg.includes('409')) { logger.debug('telegram', '409 — old session clearing'); return; }
    logger.warn('telegram', `Polling: ${msg}`);
  });

  return botInfo;
}

async function disconnect() {
  if (!bot) return;
  try { await bot.stopPolling(); } catch { }
  bot = null;
  botInfo = null;
  logger.info('telegram', 'Disconnected');
  broadcast({ type: 'telegram_status', status: getStatus() });
}

function getStatus() {
  return {
    connected: !!bot,
    username: botInfo?.username || null,
    savedToken: config.telegramToken || null,
    ownerChatId: config.telegramOwnerChatId || null,
    messageCount: messageLog.length,
  };
}

function init(brainModule) {
  brain = brainModule;
  loadConfig();
  if (config.telegramToken) {
    setTimeout(() => {
      connect(config.telegramToken).catch(e =>
        logger.warn('telegram', `Auto-reconnect failed: ${e.message}`)
      );
    }, 3000);
  }
}

module.exports = {
  init, connect, disconnect,
  getStatus, sendToOwner, setOwnerChatId,
  getMessages: () => messageLog,
  registerClient: (ws) => wsClients.add(ws),
  removeClient: (ws) => wsClients.delete(ws),
};