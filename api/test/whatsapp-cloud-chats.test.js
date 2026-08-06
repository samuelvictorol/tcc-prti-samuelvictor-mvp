const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const ApiError = require('../src/utils/api-error');
const ConversationBackup = require('../src/models/conversation-backup.model');
const conversationsManager = require('../src/managers/conversations.manager');
const contactsManager = require('../src/managers/contacts.manager');
const settingsManager = require('../src/managers/settings.manager');
const logsManager = require('../src/managers/logs.manager');
const authManager = require('../src/managers/auth.manager');
const whatsappCloudManager = require('../src/managers/whatsapp-cloud.manager');
const backupStorage = require('../src/services/conversation-backup-storage.service');
const { createApp } = require('../src/app');

function restoreAfter(context, overrides) {
  const originals = overrides.map(([target, key]) => [target, key, target[key]]);
  const originalFetch = global.fetch;
  context.after(() => {
    for (const [target, key, original] of originals) target[key] = original;
    global.fetch = originalFetch;
  });
}

function openConversation(overrides = {}) {
  const now = new Date('2026-07-28T12:00:00.000Z');
  return {
    conversation: {
      _id: '507f1f77bcf86cd799439011',
      channel: 'whatsapp_cloud',
      contact: '507f1f77bcf86cd799439012'
    },
    externalId: '5511931234567',
    serviceWindow: {
      open: true,
      lastInboundAt: new Date(now.getTime() - 60_000),
      expiresAt: new Date(now.getTime() + 23 * 60 * 60 * 1000),
      remainingSeconds: 82_800
    },
    ...overrides
  };
}

function serializedConversation() {
  return {
    id: '507f1f77bcf86cd799439011',
    channel: 'whatsapp_cloud',
    contactId: '507f1f77bcf86cd799439012',
    serviceWindow: {
      open: true,
      lastInboundAt: new Date('2026-07-28T11:59:00.000Z'),
      expiresAt: new Date('2026-07-29T11:59:00.000Z'),
      remainingSeconds: 86_340
    }
  };
}

function serializedContact(authorized = false) {
  return {
    id: '507f1f77bcf86cd799439012',
    displayName: 'Contato ficticio',
    avatarUrl: 'https://example.com/avatar.jpg',
    phone: '5511931234567',
    active: true,
    notificationDisabled: false,
    channels: [{
      channel: 'whatsapp_cloud',
      address: '5511931234567',
      deliveryAddress: '5511931234567',
      authorized,
      consentStatus: authorized ? 'granted' : 'unknown',
      consentSource: authorized ? 'automatic_permission_command' : null,
      consentCommand: authorized ? '/notify-me' : null,
      metadata: {
        waId: '5511931234567',
        userId: 'BR.12345678901234567',
        phoneNumberId: '1000000000000001',
        businessAccountId: '1000000000000002'
      }
    }]
  };
}

test('janela Cloud abre por 24 horas e retencao operacional expira em 30 dias', () => {
  const inboundAt = new Date('2026-07-28T10:00:00.000Z');
  const open = conversationsManager.cloudServiceWindow({
    channel: 'whatsapp_cloud',
    lastInboundAt: inboundAt
  }, new Date('2026-07-29T09:59:59.000Z').getTime());
  const closed = conversationsManager.cloudServiceWindow({
    channel: 'whatsapp_cloud',
    lastInboundAt: inboundAt
  }, new Date('2026-07-29T10:00:00.000Z').getTime());

  assert.equal(open.open, true);
  assert.equal(open.remainingSeconds, 1);
  assert.equal(open.expiresAt.toISOString(), '2026-07-29T10:00:00.000Z');
  assert.equal(closed.open, false);
  assert.equal(conversationsManager.cloudRetentionUntil(inboundAt).toISOString(), '2026-08-27T10:00:00.000Z');
  assert.equal(conversationsManager.WHATSAPP_CLOUD_RETENTION_DAYS, 30);
});

test('resposta livre usa Graph v25, persiste outbound e nao renova a janela inbound', async (context) => {
  restoreAfter(context, [
    [conversationsManager, 'requireOpenCloudServiceWindow'],
    [conversationsManager, 'recordOutbound'],
    [conversationsManager, 'getById'],
    [contactsManager, 'getById'],
    [settingsManager, 'getValue'],
    [logsManager, 'create']
  ]);
  conversationsManager.requireOpenCloudServiceWindow = async () => openConversation();
  let recorded;
  conversationsManager.recordOutbound = async (input) => {
    recorded = input;
    return { message: { id: '507f1f77bcf86cd799439013', body: input.body, direction: 'outbound' } };
  };
  conversationsManager.getById = async () => serializedConversation();
  contactsManager.getById = async () => serializedContact(false);
  settingsManager.getValue = async (key) => ({
    WHATSAPP_CLOUD_ACCESS_TOKEN: '  Bearer token-ficticio  ',
    WHATSAPP_CLOUD_PHONE_NUMBER_ID: '1999999999999999',
    WHATSAPP_CLOUD_API_VERSION: 'v25.0'
  })[key] || null;
  logsManager.create = async () => ({});
  let providerRequest;
  global.fetch = async (url, options) => {
    providerRequest = { url, headers: options.headers, body: JSON.parse(options.body) };
    return { ok: true, json: async () => ({ messages: [{ id: 'wamid.outbound-ficticio' }] }) };
  };

  const result = await whatsappCloudManager.sendConversationText(
    '507f1f77bcf86cd799439011',
    'Resposta dentro da janela'
  );

  assert.equal(providerRequest.url, 'https://graph.facebook.com/v25.0/1000000000000001/messages');
  assert.equal(providerRequest.headers.authorization, 'Bearer token-ficticio');
  assert.deepEqual(providerRequest.body, {
    type: 'text',
    text: { body: 'Resposta dentro da janela', preview_url: false },
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: '5511931234567'
  });
  assert.equal(recorded.channel, 'whatsapp_cloud');
  assert.equal(recorded.direction, undefined);
  assert.equal(recorded.body, 'Resposta dentro da janela');
  assert.equal(recorded.metadata.useCase, 'customer_service');
  assert.equal(result.providerMessageId, 'wamid.outbound-ficticio');
  assert.equal(result.conversation.canReply, true);
  assert.equal(result.conversation.consent.authorized, false);
});

test('codigo de perfil chega ao provedor sem entrar no historico, socket ou log', async (context) => {
  restoreAfter(context, [
    [conversationsManager, 'requireOpenCloudServiceWindow'],
    [conversationsManager, 'recordOutbound'],
    [conversationsManager, 'getById'],
    [contactsManager, 'getById'],
    [settingsManager, 'getValue'],
    [logsManager, 'create']
  ]);
  conversationsManager.requireOpenCloudServiceWindow = async () => openConversation();
  conversationsManager.getById = async () => serializedConversation();
  contactsManager.getById = async () => serializedContact(false);
  settingsManager.getValue = async (key) => ({
    WHATSAPP_CLOUD_ACCESS_TOKEN: 'token-ficticio',
    WHATSAPP_CLOUD_PHONE_NUMBER_ID: '1000000000000001',
    WHATSAPP_CLOUD_API_VERSION: 'v25.0'
  })[key] || null;
  let historyCalled = false;
  conversationsManager.recordOutbound = async () => {
    historyCalled = true;
    throw new Error('codigo nao deve ser persistido');
  };
  const logs = [];
  logsManager.create = async (entry) => {
    logs.push(entry);
    return entry;
  };
  let providerBody;
  global.fetch = async (_url, options) => {
    providerBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ messages: [{ id: 'wamid.profile-code' }] }) };
  };

  const codeMessage = 'Seu codigo de acesso e *“123456”*.';
  const result = await whatsappCloudManager.sendConversationText(
    '507f1f77bcf86cd799439011',
    codeMessage,
    { useCase: 'profile_auth' }
  );

  assert.equal(providerBody.text.body, codeMessage);
  assert.equal(historyCalled, false);
  assert.equal(result.message, null);
  assert.equal(logs[0].action, 'profile_auth.code_sent');
  assert.doesNotMatch(JSON.stringify(logs), /123456/);

  const magicLink = 'https://notify.example/meu-perfil#acesso=segredo-opaco';
  const linkResult = await whatsappCloudManager.sendConversationText(
    '507f1f77bcf86cd799439011',
    magicLink,
    { useCase: 'profile_auth_link' }
  );
  assert.equal(providerBody.text.body, magicLink);
  assert.equal(historyCalled, false);
  assert.equal(linkResult.message, null);
  assert.equal(logs.at(-1).action, 'profile_auth.secret_sent');
  assert.doesNotMatch(JSON.stringify(logs), /segredo-opaco/);
});

test('janela fechada bloqueia texto livre antes de chamar a Meta', async (context) => {
  restoreAfter(context, [[conversationsManager, 'requireOpenCloudServiceWindow']]);
  let providerCalled = false;
  global.fetch = async () => {
    providerCalled = true;
    throw new Error('nao deveria chamar');
  };
  conversationsManager.requireOpenCloudServiceWindow = async () => {
    throw new ApiError(
      409,
      'Janela fechada',
      null,
      'WHATSAPP_CUSTOMER_SERVICE_WINDOW_CLOSED'
    );
  };

  await assert.rejects(
    () => whatsappCloudManager.sendConversationText('507f1f77bcf86cd799439011', 'Ola'),
    (error) => error.code === 'WHATSAPP_CUSTOMER_SERVICE_WINDOW_CLOSED'
  );
  assert.equal(providerCalled, false);
});

test('conversa tecnica sem contato permanece somente leitura tambem na API', async (context) => {
  restoreAfter(context, [[conversationsManager, 'requireOpenCloudServiceWindow']]);
  conversationsManager.requireOpenCloudServiceWindow = async () => openConversation({
    conversation: {
      _id: '507f1f77bcf86cd799439011',
      channel: 'whatsapp_cloud',
      contact: null
    }
  });
  let providerCalled = false;
  global.fetch = async () => {
    providerCalled = true;
    throw new Error('nao deveria chamar');
  };

  await assert.rejects(
    () => whatsappCloudManager.sendConversationText('507f1f77bcf86cd799439011', 'Ola'),
    (error) => error.code === 'WHATSAPP_CLOUD_TECHNICAL_CONVERSATION_READ_ONLY'
  );
  assert.equal(providerCalled, false);
});

test('solicitacao de consentimento interpola comando dinamico e registra como outbound', async (context) => {
  restoreAfter(context, [
    [conversationsManager, 'getById'],
    [conversationsManager, 'requireOpenCloudServiceWindow'],
    [conversationsManager, 'recordOutbound'],
    [contactsManager, 'getById'],
    [settingsManager, 'getValue'],
    [settingsManager, 'getWhatsappConsentRequestText'],
    [settingsManager, 'getWhatsappPermissionCommand'],
    [logsManager, 'create']
  ]);
  conversationsManager.getById = async () => serializedConversation();
  conversationsManager.requireOpenCloudServiceWindow = async () => openConversation();
  conversationsManager.recordOutbound = async (input) => ({
    message: { id: '507f1f77bcf86cd799439013', body: input.body }
  });
  contactsManager.getById = async () => serializedContact(false);
  settingsManager.getWhatsappConsentRequestText = async () => 'Para permitir, envie {command}.';
  settingsManager.getWhatsappPermissionCommand = async () => '/notify-dinamico';
  settingsManager.getValue = async (key) => ({
    WHATSAPP_CLOUD_ACCESS_TOKEN: 'token-ficticio',
    WHATSAPP_CLOUD_PHONE_NUMBER_ID: '1000000000000001',
    WHATSAPP_CLOUD_API_VERSION: 'v25.0'
  })[key] || null;
  logsManager.create = async () => ({});
  let body;
  global.fetch = async (_url, options) => {
    body = JSON.parse(options.body);
    return { ok: true, json: async () => ({ messages: [{ id: 'wamid.consent-ficticio' }] }) };
  };

  await whatsappCloudManager.sendConsentRequest('507f1f77bcf86cd799439011');
  assert.equal(body.text.body, 'Para permitir, envie /notify-dinamico.');
});

test('backup manual salva snapshot criptografado e devolve historico local exportavel', async (context) => {
  restoreAfter(context, [
    [conversationsManager, 'list'],
    [conversationsManager, 'listMessages'],
    [contactsManager, 'getManyByIds'],
    [ConversationBackup, 'find'],
    [ConversationBackup, 'create'],
    [backupStorage, 'upload']
  ]);
  conversationsManager.list = async () => ({
    items: [serializedConversation()],
    page: 1,
    limit: 100,
    total: 1,
    pages: 1
  });
  conversationsManager.listMessages = async () => ({
    items: [{
      id: '507f1f77bcf86cd799439013',
      direction: 'inbound',
      body: 'Mensagem local',
      sentAt: new Date('2026-07-28T11:59:00.000Z')
    }],
    page: 1,
    limit: 100,
    total: 1,
    pages: 1
  });
  contactsManager.getManyByIds = async () => [serializedContact(true)];
  let stored;
  let uploaded;
  ConversationBackup.find = () => ({
    select: () => ({ lean: async () => [] })
  });
  backupStorage.upload = async (payload, options) => {
    uploaded = { payload, options };
    return {
      fileId: '507f1f77bcf86cd799439097',
      filename: options.filename,
      contentType: 'application/octet-stream',
      storageBytes: 2048,
      plaintextBytes: 1536,
      checksumSha256: 'a'.repeat(64)
    };
  };
  ConversationBackup.create = async (input) => {
    stored = input;
    return {
      _id: '507f1f77bcf86cd799439099',
      ...input
    };
  };

  const snapshot = await whatsappCloudManager.createStoredBackup(
    'manual',
    new Date('2026-07-28T12:00:00.000Z')
  );
  const backup = snapshot.export;

  assert.equal(snapshot.created, true);
  assert.equal(backup.backupId, '507f1f77bcf86cd799439099');
  assert.equal(backup.format, 'notify-flow.whatsapp-cloud-conversations');
  assert.equal(backup.source, 'local_webhook_history');
  assert.equal(backup.historyImportedFromMeta, false);
  assert.equal(backup.retentionDays, 30);
  assert.equal(backup.conversations[0].messages[0].body, 'Mensagem local');
  assert.equal(backup.conversations[0].consent.authorized, true);
  assert.equal(uploaded.payload.conversations[0].messages[0].body, 'Mensagem local');
  assert.match(uploaded.options.filename, /manual/);
  assert.equal(stored.gridFsFileId, '507f1f77bcf86cd799439097');
  assert.equal(stored.checksumSha256, 'a'.repeat(64));
  assert.equal(stored.storageBytes, 2048);
  assert.ok(stored.expiresAt > new Date('2026-07-28T12:00:00.000Z'));
  assert.equal(stored.messageCount, 1);
});

test('backup automatico cria no primeiro ciclo e respeita intervalo real de 30 dias', async (context) => {
  restoreAfter(context, [
    [conversationsManager, 'list'],
    [contactsManager, 'getManyByIds'],
    [ConversationBackup, 'find'],
    [ConversationBackup, 'findOne'],
    [ConversationBackup, 'create'],
    [backupStorage, 'upload']
  ]);
  conversationsManager.list = async () => ({
    items: [],
    page: 1,
    limit: 100,
    total: 0,
    pages: 0
  });
  contactsManager.getManyByIds = async () => [];
  ConversationBackup.find = () => ({
    select: () => ({ lean: async () => [] })
  });
  let latest = null;
  ConversationBackup.findOne = () => ({
    sort: () => ({ lean: async () => latest })
  });
  backupStorage.upload = async (_payload, options) => ({
    fileId: '507f1f77bcf86cd799439097',
    filename: options.filename,
    contentType: 'application/octet-stream',
    storageBytes: 128,
    plaintextBytes: 64,
    checksumSha256: 'b'.repeat(64)
  });
  let creates = 0;
  ConversationBackup.create = async (input) => {
    creates += 1;
    latest = { _id: '507f1f77bcf86cd799439098', ...input };
    return latest;
  };

  const now = new Date('2026-07-28T12:00:00.000Z');
  const created = await whatsappCloudManager.createAutomaticBackupIfDue(now);
  const skipped = await whatsappCloudManager.createAutomaticBackupIfDue(
    new Date(now.getTime() + 29 * 24 * 60 * 60 * 1000)
  );

  assert.equal(created.created, true);
  assert.equal(created.trigger, 'automatic');
  assert.equal(skipped.created, false);
  assert.equal(skipped.reason, 'not_due');
  assert.equal(creates, 1);
});

test('retencao remove metadados expirados e o arquivo correspondente do GridFS', async (context) => {
  restoreAfter(context, [
    [ConversationBackup, 'find'],
    [ConversationBackup, 'deleteOne'],
    [backupStorage, 'remove']
  ]);
  ConversationBackup.find = () => ({
    select: () => ({
      lean: async () => [{
        _id: '507f1f77bcf86cd799439096',
        gridFsFileId: '507f1f77bcf86cd799439097'
      }]
    })
  });
  const removedFiles = [];
  backupStorage.remove = async (id) => {
    removedFiles.push(String(id));
    return true;
  };
  ConversationBackup.deleteOne = async () => ({ deletedCount: 1 });

  const result = await whatsappCloudManager.pruneExpiredBackups(
    new Date('2026-10-28T12:00:00.000Z')
  );

  assert.equal(result.removed, 1);
  assert.deepEqual(removedFiles, ['507f1f77bcf86cd799439097']);
});

test('backup armazenado no GridFS pode ser recuperado para download autenticado', async (context) => {
  restoreAfter(context, [
    [ConversationBackup, 'find'],
    [ConversationBackup, 'findById'],
    [backupStorage, 'download']
  ]);
  ConversationBackup.find = () => ({
    select: () => ({ lean: async () => [] })
  });
  ConversationBackup.findById = () => ({
    select: () => ({
      lean: async () => ({
        _id: '507f1f77bcf86cd799439095',
        channel: 'whatsapp_cloud',
        trigger: 'automatic',
        periodKey: '1',
        periodStartedAt: new Date('2026-07-01T00:00:00.000Z'),
        periodEndsAt: new Date('2026-07-31T00:00:00.000Z'),
        generatedAt: new Date('2026-07-28T12:00:00.000Z'),
        conversationCount: 1,
        messageCount: 1,
        gridFsFileId: '507f1f77bcf86cd799439097',
        checksumSha256: 'c'.repeat(64),
        expiresAt: new Date('2026-10-26T12:00:00.000Z')
      })
    })
  });
  let downloaded;
  backupStorage.download = async (id, checksum) => {
    downloaded = { id: String(id), checksum };
    return {
      format: 'notify-flow.whatsapp-cloud-conversations',
      generatedAt: '2026-07-28T12:00:00.000Z',
      conversations: [{ id: 'conversation-1', messages: [] }]
    };
  };

  const result = await whatsappCloudManager.getStoredBackupExport(
    '507f1f77bcf86cd799439095',
    new Date('2026-07-29T12:00:00.000Z')
  );

  assert.deepEqual(downloaded, {
    id: '507f1f77bcf86cd799439097',
    checksum: 'c'.repeat(64)
  });
  assert.equal(result.backup.trigger, 'automatic');
  assert.equal(result.export.backupId, '507f1f77bcf86cd799439095');
  assert.equal(result.export.conversations[0].id, 'conversation-1');
});

test('backup manual exige admin e responde como attachment JSON sem cache', async (context) => {
  restoreAfter(context, [
    [authManager, 'authenticateAccess'],
    [whatsappCloudManager, 'createStoredBackup']
  ]);
  authManager.authenticateAccess = async () => ({ id: '507f1f77bcf86cd799439091' });
  whatsappCloudManager.createStoredBackup = async () => ({
    created: true,
    export: {
      backupId: '507f1f77bcf86cd799439092',
      generatedAt: '2026-07-28T12:00:00.000Z',
      retentionDays: 30,
      conversations: []
    }
  });
  const app = createApp();
  const unauthorized = await request(app).post('/api/whatsapp-cloud/conversations/backup');
  const authorized = await request(app)
    .post('/api/whatsapp-cloud/conversations/backup')
    .set('Authorization', 'Bearer token-admin-ficticio');

  assert.equal(unauthorized.status, 401);
  assert.equal(authorized.status, 200);
  assert.match(authorized.headers['content-disposition'], /notify-flow-whatsapp-cloud-2026-07-28\.json/);
  assert.match(authorized.headers['content-type'], /application\/json/);
  assert.match(authorized.headers['cache-control'], /no-store/);
  assert.equal(authorized.body.backupId, '507f1f77bcf86cd799439092');
});

test('lista e download de snapshots automaticos exigem autenticacao administrativa', async (context) => {
  restoreAfter(context, [
    [authManager, 'authenticateAccess'],
    [whatsappCloudManager, 'listStoredBackups'],
    [whatsappCloudManager, 'getStoredBackupExport']
  ]);
  authManager.authenticateAccess = async () => ({ id: '507f1f77bcf86cd799439091' });
  whatsappCloudManager.listStoredBackups = async () => ({
    items: [{
      id: '507f1f77bcf86cd799439092',
      trigger: 'automatic',
      generatedAt: '2026-07-28T12:00:00.000Z',
      expiresAt: '2026-10-26T12:00:00.000Z',
      downloadable: true
    }],
    page: 1,
    limit: 20,
    total: 1,
    pages: 1
  });
  whatsappCloudManager.getStoredBackupExport = async () => ({
    backup: {
      id: '507f1f77bcf86cd799439092',
      trigger: 'automatic',
      generatedAt: '2026-07-28T12:00:00.000Z'
    },
    export: {
      backupId: '507f1f77bcf86cd799439092',
      generatedAt: '2026-07-28T12:00:00.000Z',
      conversations: []
    }
  });
  const app = createApp();

  const unauthorized = await request(app).get('/api/whatsapp-cloud/conversations/backups');
  const listed = await request(app)
    .get('/api/whatsapp-cloud/conversations/backups')
    .set('Authorization', 'Bearer token-admin-ficticio');
  const downloaded = await request(app)
    .get('/api/whatsapp-cloud/conversations/backups/507f1f77bcf86cd799439092/download')
    .set('Authorization', 'Bearer token-admin-ficticio');

  assert.equal(unauthorized.status, 401);
  assert.equal(listed.status, 200);
  assert.equal(listed.body.data.items[0].trigger, 'automatic');
  assert.equal(downloaded.status, 200);
  assert.match(downloaded.headers['content-disposition'], /automatic-2026-07-28\.json/);
  assert.equal(downloaded.body.backupId, '507f1f77bcf86cd799439092');
});
