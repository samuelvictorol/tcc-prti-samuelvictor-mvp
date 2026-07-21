const crypto = require('node:crypto');

const TELEGRAM_TEMPLATE_KINDS = Object.freeze(['text', 'photo', 'video', 'menu']);
const CALLBACK_PREFIX = 'tm';

function createNodeId(prefix = 'pagina') {
  return `${prefix}_${crypto.randomBytes(5).toString('hex')}`;
}

function telegramDefinitionFromTemplate(template = {}) {
  const stored = template.payload?.telegram;
  if (stored && typeof stored === 'object') return stored;
  return { version: 1, kind: 'text', text: String(template.body || '') };
}

function menuNode(definition, nodeId) {
  return definition?.nodes?.find((node) => node.id === nodeId) || null;
}

function menuParentId(definition, nodeId) {
  const explicit = menuNode(definition, nodeId)?.parentId;
  if (explicit) return explicit;
  for (const node of definition?.nodes || []) {
    for (const row of node.rows || []) {
      const button = row.find((item) => item.action === 'submenu' && item.targetNodeId === nodeId);
      if (button) return node.id;
    }
  }
  return null;
}

function renderMenuText(node = {}) {
  return [node.title, node.text].map((value) => String(value || '').trim()).filter(Boolean).join('\n\n');
}

function callbackData(token, nodeId) {
  const value = `${CALLBACK_PREFIX}:${token}:${nodeId}`;
  if (Buffer.byteLength(value, 'utf8') > 64) throw new Error('Callback Telegram excede 64 bytes');
  return value;
}

function parseCallbackData(value) {
  const match = String(value || '').match(/^tm:([A-Za-z0-9_-]{12,32}):([A-Za-z][A-Za-z0-9_-]{0,23})$/);
  return match ? { token: match[1], nodeId: match[2] } : null;
}

function buildMenuKeyboard(definition, nodeId, token) {
  const node = menuNode(definition, nodeId);
  if (!node) throw new Error('Pagina do menu Telegram nao encontrada');
  const inlineKeyboard = (node.rows || []).map((row) => row.map((button) => {
    if (button.action === 'url') return { text: button.label, url: button.url };
    return { text: button.label, callback_data: callbackData(token, button.targetNodeId) };
  }));
  const parentId = menuParentId(definition, nodeId);
  if (parentId) inlineKeyboard.push([{ text: '← Voltar', callback_data: callbackData(token, parentId) }]);
  return { inline_keyboard: inlineKeyboard };
}

function telegramTemplateBody(definition = {}) {
  if (definition.kind === 'text') return String(definition.text || '');
  if (['photo', 'video'].includes(definition.kind)) return String(definition.caption || '');
  if (definition.kind === 'menu') return renderMenuText(menuNode(definition, definition.rootNodeId) || {});
  return '';
}

function extractVariables(value) {
  const found = new Set();
  const visit = (current) => {
    if (typeof current === 'string') {
      for (const match of current.matchAll(/{{\s*([A-Za-z][A-Za-z0-9_]*)\s*}}/g)) found.add(match[1]);
      return;
    }
    if (Array.isArray(current)) current.forEach(visit);
    else if (current && typeof current === 'object') Object.values(current).forEach(visit);
  };
  visit(value);
  return [...found];
}

module.exports = {
  TELEGRAM_TEMPLATE_KINDS,
  createNodeId,
  telegramDefinitionFromTemplate,
  telegramTemplateBody,
  extractVariables,
  menuNode,
  menuParentId,
  renderMenuText,
  buildMenuKeyboard,
  parseCallbackData
};
