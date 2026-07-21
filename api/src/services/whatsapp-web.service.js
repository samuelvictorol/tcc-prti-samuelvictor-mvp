const path = require('node:path');
const fs = require('node:fs/promises');
const QRCode = require('qrcode');
const { env } = require('../config/env');
const { emit } = require('./socket.service');

let client;
let state = 'not_initialized';
let qrDataUrl;
let handlers = {};

function snapshot() {
  return { initialized: Boolean(client), ready: state === 'ready', state, qrCode: qrDataUrl || null };
}

function publish() {
  emit('whatsapp_web:status', snapshot());
}

async function initialize(eventHandlers = {}) {
  handlers = eventHandlers;
  if (client) return snapshot();
  const { Client, LocalAuth } = require('whatsapp-web.js');
  state = 'initializing';
  client = new Client({
    authStrategy: new LocalAuth({ dataPath: path.resolve(process.cwd(), env.whatsappWebAuthPath) }),
    puppeteer: {
      executablePath: env.puppeteerExecutablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    }
  });
  client.on('qr', async (qr) => {
    state = 'qr';
    qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
    emit('whatsapp_web:qr', { qrCode: qrDataUrl, at: new Date().toISOString() });
    publish();
    await handlers.onQr?.(qrDataUrl);
  });
  client.on('authenticated', async () => {
    state = 'authenticated';
    qrDataUrl = null;
    publish();
    await handlers.onAuthenticated?.();
  });
  client.on('ready', async () => {
    state = 'ready';
    qrDataUrl = null;
    publish();
    await handlers.onReady?.();
  });
  client.on('auth_failure', async (message) => {
    state = 'auth_failure';
    publish();
    await handlers.onAuthFailure?.(message);
  });
  client.on('disconnected', async (reason) => {
    state = 'disconnected';
    qrDataUrl = null;
    publish();
    await handlers.onDisconnected?.(reason);
  });
  client.on('message', (message) => Promise.resolve(handlers.onMessage?.(message)).catch((error) => console.error('[whatsapp-web message]', error)));
  client.initialize().catch(async (error) => {
    state = 'error';
    publish();
    await handlers.onError?.(error);
  });
  publish();
  return snapshot();
}

async function listChats(limit = 100) {
  if (!client || state !== 'ready') throw new Error('WhatsApp Web nao esta pronto');
  const chats = (await client.getChats()).slice(0, Math.min(200, limit));
  return Promise.all(chats.map(async (chat) => {
    let imageUrl = null;
    try { imageUrl = await client.getProfilePicUrl(chat.id._serialized); } catch (_error) { /* imagem opcional */ }
    return {
      id: chat.id._serialized,
      name: chat.name || chat.formattedTitle || chat.id.user,
      phone: chat.isGroup ? null : chat.id.user,
      isGroup: chat.isGroup,
      unreadCount: chat.unreadCount,
      timestamp: chat.timestamp,
      imageUrl
    };
  }));
}

async function getChatSummary(chatId) {
  if (!client || state !== 'ready') throw new Error('WhatsApp Web nao esta pronto');
  const chat = await client.getChatById(chatId);
  let imageUrl = null;
  try { imageUrl = await client.getProfilePicUrl(chat.id._serialized); } catch (_error) { /* imagem opcional */ }
  return {
    id: chat.id._serialized,
    name: chat.name || chat.formattedTitle || chat.id.user,
    phone: chat.isGroup ? null : chat.id.user,
    isGroup: chat.isGroup,
    imageUrl
  };
}

async function getMessages(chatId, limit = 50) {
  if (!client || state !== 'ready') throw new Error('WhatsApp Web nao esta pronto');
  const chat = await client.getChatById(chatId);
  const messages = await chat.fetchMessages({ limit: Math.min(100, Math.max(1, limit)) });
  return messages.map((message) => ({
    id: message.id?._serialized,
    chatId: chat.id._serialized,
    fromMe: message.fromMe,
    body: String(message.body || '').slice(0, 10000),
    type: message.type,
    timestamp: message.timestamp,
    hasMedia: message.hasMedia
  }));
}

async function resolveDestination(destination) {
  if (destination.includes('@')) return destination;
  const number = String(destination).replace(/\D/g, '');
  const result = await client.getNumberId(number);
  if (!result) throw new Error('Numero nao registrado no WhatsApp');
  return result._serialized;
}

async function sendMessage(destination, text, options = {}) {
  if (!client || state !== 'ready') throw new Error('WhatsApp Web nao esta pronto');
  const chatId = await resolveDestination(destination);
  const result = await client.sendMessage(chatId, text, options);
  return { providerMessageId: result.id?._serialized, chatId };
}

async function clearAuthData() {
  const root = path.resolve(process.cwd());
  const target = path.resolve(root, env.whatsappWebAuthPath);
  if (target === root || !target.startsWith(root + path.sep)) throw new Error('Diretorio de autenticacao WhatsApp inseguro');
  await fs.rm(target, { recursive: true, force: true });
}

async function logout() {
  if (client) {
    try { await client.logout(); } catch (_error) { await client.destroy().catch(() => undefined); }
  }
  client = undefined;
  await clearAuthData();
  state = 'not_initialized';
  qrDataUrl = null;
  publish();
  return snapshot();
}

module.exports = { initialize, snapshot, listChats, getChatSummary, getMessages, sendMessage, logout, clearAuthData };
