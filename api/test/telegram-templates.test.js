const test = require('node:test');
const assert = require('node:assert/strict');
const dns = require('node:dns').promises;
const { createTemplateSchema } = require('../src/dtos/templates.dto');
const {
  buildMenuKeyboard,
  parseCallbackData
} = require('../src/utils/telegram-templates');
const {
  isPrivateAddress,
  parsePublicHttpsUrl,
  resolvePublicHost,
  sniffMedia,
  assertMediaType,
  downloadRequestError,
  pinnedLookup,
  downloadTelegramMedia
} = require('../src/services/safe-media.service');
const settingsManager = require('../src/managers/settings.manager');
const contactsManager = require('../src/managers/contacts.manager');
const logsManager = require('../src/managers/logs.manager');
const conversationsManager = require('../src/managers/conversations.manager');
const socketService = require('../src/services/socket.service');
const telegramManager = require('../src/managers/telegram.manager');

const validMenu = () => ({
  version: 1,
  kind: 'menu',
  rootNodeId: 'inicio',
  nodes: [
    {
      id: 'inicio',
      title: 'Central de ajuda',
      text: 'Escolha uma opção',
      rows: [[
        { id: 'abrir_pedidos', label: 'Pedidos', action: 'submenu', targetNodeId: 'pedidos' },
        { id: 'abrir_site', label: 'Site', action: 'url', url: 'https://example.com/ajuda' }
      ]]
    },
    {
      id: 'pedidos',
      parentId: 'inicio',
      title: 'Pedidos',
      text: 'Consulte seu pedido.',
      rows: [[{ id: 'rastrear', label: 'Rastrear', action: 'url', url: 'https://example.com/pedidos' }]]
    }
  ]
});

function telegramTemplate(definition, extra = {}) {
  return {
    body: {
      name: 'Template Telegram',
      channel: 'telegram',
      body: 'Prévia',
      payload: { telegram: definition },
      ...extra
    }
  };
}

test('schema Telegram aceita texto, foto, video e menu visual válidos', () => {
  const definitions = [
    { version: 1, kind: 'text', text: 'Olá {{nome}}' },
    { version: 1, kind: 'photo', mediaUrl: 'https://cdn.example.com/foto.png', caption: 'Olá' },
    { version: 1, kind: 'video', mediaUrl: 'https://cdn.example.com/video.mp4', caption: 'Assista' },
    validMenu()
  ];
  for (const definition of definitions) {
    assert.equal(createTemplateSchema.safeParse(telegramTemplate(definition)).success, true);
  }
});

test('schema Telegram rejeita HTML, payload arbitrário, HTTP e menus inválidos/cíclicos', () => {
  assert.equal(createTemplateSchema.safeParse(telegramTemplate(
    { version: 1, kind: 'text', text: 'Oi' },
    { html: '<strong>não permitido</strong>' }
  )).success, false);
  assert.equal(createTemplateSchema.safeParse({ body: {
    name: 'Cloud sem HTML',
    channel: 'whatsapp_cloud',
    body: 'Prévia oficial',
    html: '<strong>não permitido</strong>'
  } }).success, false);
  assert.equal(createTemplateSchema.safeParse(telegramTemplate(
    { version: 1, kind: 'text', text: 'Oi' },
    { payload: { telegram: { version: 1, kind: 'text', text: 'Oi' }, arbitrary: { chat_id: 'atacante' } } }
  )).success, false);
  assert.equal(createTemplateSchema.safeParse(telegramTemplate({
    version: 1,
    kind: 'photo',
    mediaUrl: 'http://cdn.example.com/foto.png',
    caption: ''
  })).success, false);

  const missingTarget = validMenu();
  missingTarget.nodes[0].rows[0][0].targetNodeId = 'inexistente';
  assert.equal(createTemplateSchema.safeParse(telegramTemplate(missingTarget)).success, false);

  const cyclic = validMenu();
  cyclic.nodes[1].rows.push([{
    id: 'volta_em_ciclo',
    label: 'Início',
    action: 'submenu',
    targetNodeId: 'inicio'
  }]);
  assert.equal(createTemplateSchema.safeParse(telegramTemplate(cyclic)).success, false);
});

test('teclado Telegram gera callbacks opacos e botão Voltar automático', () => {
  const menu = validMenu();
  const token = 'abcdefghijklmnop';
  const rootKeyboard = buildMenuKeyboard(menu, 'inicio', token);
  const callback = rootKeyboard.inline_keyboard[0][0].callback_data;
  assert.deepEqual(parseCallbackData(callback), { token, nodeId: 'pedidos' });
  assert.ok(Buffer.byteLength(callback, 'utf8') <= 64);

  const childKeyboard = buildMenuKeyboard(menu, 'pedidos', token);
  assert.deepEqual(childKeyboard.inline_keyboard.at(-1), [{
    text: '← Voltar',
    callback_data: `tm:${token}:inicio`
  }]);
});

test('download de mídia bloqueia HTTP, redes privadas e DNS resolvido para IP privado', async (context) => {
  assert.equal(isPrivateAddress('127.0.0.1'), true);
  assert.equal(isPrivateAddress('10.0.0.7'), true);
  assert.equal(isPrivateAddress('::1'), true);
  assert.equal(isPrivateAddress('::ffff:192.168.1.7'), true);
  assert.equal(isPrivateAddress('64:ff9b::7f00:1'), true);
  assert.equal(isPrivateAddress('fec0::1'), true);
  assert.equal(isPrivateAddress('2002:7f00:1::'), true);
  assert.equal(isPrivateAddress('1.1.1.1'), false);
  assert.equal(isPrivateAddress('2606:4700:4700::1111'), false);
  assert.throws(() => parsePublicHttpsUrl('http://example.com/foto.jpg'), /HTTPS/i);
  assert.throws(() => parsePublicHttpsUrl('https://user:pass@example.com/foto.jpg'), /credenciais/i);

  const originalLookup = dns.lookup;
  context.after(() => { dns.lookup = originalLookup; });
  dns.lookup = async () => [{ address: '127.0.0.1', family: 4 }];
  await assert.rejects(
    () => downloadTelegramMedia('https://media.example.test/foto.jpg', 'photo'),
    (error) => error.statusCode === 422 && error.code === 'UNSAFE_MEDIA_URL'
  );
  dns.lookup = async () => [
    { address: '1.1.1.1', family: 4 },
    { address: '169.254.169.254', family: 4 }
  ];
  await assert.rejects(
    () => downloadTelegramMedia('https://mixed-dns.example.test/foto.jpg', 'photo'),
    (error) => error.statusCode === 422 && error.code === 'UNSAFE_MEDIA_URL'
  );
});

test('detecção de mídia confere assinatura real do arquivo', () => {
  assert.deepEqual(sniffMedia(Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0])), {
    mimeType: 'image/jpeg', extension: 'jpg'
  });
  assert.deepEqual(sniffMedia(Buffer.from('0000ftypisom', 'ascii')), {
    mimeType: 'video/mp4', extension: 'mp4'
  });
  assert.equal(sniffMedia(Buffer.from('<html>não é imagem</html>')), null);
  assert.doesNotThrow(() => assertMediaType(
    'photo',
    'image/jpg',
    { mimeType: 'image/jpeg', extension: 'jpg' }
  ));
  assert.doesNotThrow(() => assertMediaType(
    'video',
    'binary/octet-stream',
    { mimeType: 'video/mp4', extension: 'mp4' }
  ));
});

test('download de mídia prefere IPv4 público e traduz falhas de rede sem ocultar a correção', async (context) => {
  const originalLookup = dns.lookup;
  context.after(() => { dns.lookup = originalLookup; });
  dns.lookup = async () => [
    { address: '2606:4700:4700::1111', family: 6 },
    { address: '1.1.1.1', family: 4 }
  ];

  assert.deepEqual(await resolvePublicHost('media.example.test'), {
    address: '1.1.1.1',
    family: 4
  });
  const unreachable = downloadRequestError(Object.assign(new Error('network'), { code: 'ENETUNREACH' }));
  assert.equal(unreachable.code, 'MEDIA_HOST_UNREACHABLE');
  assert.match(unreachable.message, /link e publico e direto/i);

  const lookup = pinnedLookup({ address: '1.1.1.1', family: 4 });
  await new Promise((resolve, reject) => {
    lookup('media.example.test', { all: true }, (error, addresses) => {
      if (error) return reject(error);
      assert.deepEqual(addresses, [{ address: '1.1.1.1', family: 4 }]);
      resolve();
    });
  });
  await new Promise((resolve, reject) => {
    lookup('media.example.test', {}, (error, address, family) => {
      if (error) return reject(error);
      assert.equal(address, '1.1.1.1');
      assert.equal(family, 4);
      resolve();
    });
  });
});

test('send usa payload.telegram, ignora destination divergente e callback navega editando o menu', async (context) => {
  const originals = {
    getValue: settingsManager.getValue,
    getDestination: contactsManager.getDestination,
    setConsentByAddress: contactsManager.setConsentByAddress,
    log: logsManager.create,
    recordOutbound: conversationsManager.recordOutbound,
    emit: socketService.emit,
    fetch: global.fetch
  };
  context.after(() => {
    settingsManager.getValue = originals.getValue;
    contactsManager.getDestination = originals.getDestination;
    contactsManager.setConsentByAddress = originals.setConsentByAddress;
    logsManager.create = originals.log;
    conversationsManager.recordOutbound = originals.recordOutbound;
    socketService.emit = originals.emit;
    global.fetch = originals.fetch;
  });

  settingsManager.getValue = async (key) => ({
    TELEGRAM_BOT_TOKEN: '123:bot-token-for-tests',
    TELEGRAM_WEBHOOK_SECRET: 'webhook-secret'
  })[key] || null;
  const destinationLookups = [];
  contactsManager.getDestination = async (contactId, channel) => {
    destinationLookups.push({ contactId, channel });
    return { address: '111222333' };
  };
  contactsManager.setConsentByAddress = async () => ({});
  logsManager.create = async () => ({});
  conversationsManager.recordOutbound = async () => ({});
  const socketEvents = [];
  socketService.emit = (name, payload) => socketEvents.push({ name, payload });

  const calls = [];
  global.fetch = async (url, options) => {
    const method = String(url).split('/').at(-1);
    const body = JSON.parse(options.body);
    calls.push({ method, body });
    const messageResult = {
      message_id: 77,
      date: 1_700_000_000,
      chat: { id: 111222333, type: 'private', first_name: 'Ana' }
    };
    return {
      ok: true,
      json: async () => ({ ok: true, result: ['sendMessage', 'editMessageText'].includes(method) ? messageResult : true })
    };
  };

  const menu = validMenu();
  await telegramManager.send({
    contactId: '507f1f77bcf86cd799439011',
    destination: '999999999',
    payload: { telegram: menu }
  });

  assert.deepEqual(destinationLookups, [{ contactId: '507f1f77bcf86cd799439011', channel: 'telegram' }]);
  assert.equal(calls[0].method, 'sendMessage');
  assert.equal(calls[0].body.chat_id, '111222333');
  assert.notEqual(calls[0].body.chat_id, '999999999');
  const callbackData = calls[0].body.reply_markup.inline_keyboard[0][0].callback_data;

  const callbackResult = await telegramManager.webhook({
    update_id: 445566,
    callback_query: {
      id: 'callback-1',
      data: callbackData,
      from: { id: 111222333, first_name: 'Ana' },
      message: { message_id: 77, chat: { id: 111222333, type: 'private' } }
    }
  }, 'webhook-secret');

  assert.equal(callbackResult.callback, 'navigated');
  assert.deepEqual(calls.slice(1).map((call) => call.method), ['answerCallbackQuery', 'editMessageText']);
  assert.equal(calls[2].body.chat_id, '111222333');
  assert.equal(calls[2].body.text, 'Pedidos\n\nConsulte seu pedido.');
  assert.equal(calls[2].body.reply_markup.inline_keyboard.at(-1)[0].text, '← Voltar');
  assert.ok(socketEvents.some((event) => event.name === 'telegram:webhook' && event.payload.kind === 'menu_callback'));
});

test('registro de webhook solicita callback_query nos allowed_updates', async (context) => {
  const originals = {
    getValue: settingsManager.getValue,
    fetch: global.fetch
  };
  context.after(() => {
    settingsManager.getValue = originals.getValue;
    global.fetch = originals.fetch;
  });
  settingsManager.getValue = async (key) => ({
    TELEGRAM_BOT_TOKEN: '123:bot-token-for-tests',
    TELEGRAM_WEBHOOK_SECRET: 'webhook-secret'
  })[key] || null;
  let requestBody;
  global.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ ok: true, result: true }) };
  };

  await telegramManager.registerWebhook('https://notify.example.com/api/webhooks/telegram');
  assert.ok(requestBody.allowed_updates.includes('callback_query'));
});
