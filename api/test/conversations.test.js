const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const Conversation = require('../src/models/conversation.model');
const ConversationMessage = require('../src/models/conversation-message.model');
const conversationsManager = require('../src/managers/conversations.manager');
const contactsManager = require('../src/managers/contacts.manager');
const socketService = require('../src/services/socket.service');
const { env } = require('../src/config/env');
const { encrypt, searchHash } = require('../src/services/crypto.service');
const { createApp } = require('../src/app');

function selected(value) {
  return { select: async () => value };
}

test('serializer deriva preview seguro de template legado sem expor payload opaco', () => {
  const message = conversationsManager.serializeMessage({
    _id: '507f1f77bcf86cd799439022',
    conversation: '507f1f77bcf86cd799439021',
    channel: 'whatsapp_cloud',
    direction: 'outbound',
    providerMessageIdEncrypted: encrypt('wamid.legado'),
    bodyEncrypted: encrypt('Conteudo aprovado na Meta.'),
    type: 'template',
    sentAt: new Date('2026-07-31T12:00:00.000Z'),
    metadataEncrypted: encrypt({
      provider: 'meta_whatsapp_cloud',
      template: {
        name: 'campanha_legada',
        languageCode: 'pt_BR',
        components: [
          {
            type: 'header',
            parameters: [{ type: 'image', image: { link: 'https://cdn.example.com/campanha.png' } }]
          },
          {
            type: 'button', sub_type: 'quick_reply', index: '0',
            parameters: [{ type: 'payload', payload: 'segredo-interno-123' }]
          }
        ]
      }
    })
  });

  assert.deepEqual(message.metadata.template, { name: 'campanha_legada', languageCode: 'pt_BR' });
  assert.deepEqual(message.metadata.templatePreview, {
    version: 1,
    name: 'campanha_legada',
    languageCode: 'pt_BR',
    header: {
      type: 'image',
      text: null,
      media: { type: 'image', url: 'https://cdn.example.com/campanha.png', filename: null }
    },
    body: { text: 'Conteudo aprovado na Meta.' },
    footer: null,
    buttons: []
  });
  assert.doesNotMatch(JSON.stringify(message), /segredo-interno-123|components/);
});

test('historico criptografa identificadores e conteudo antes de persistir', async (context) => {
  const originals = {
    upsert: Conversation.findOneAndUpdate,
    createMessage: ConversationMessage.create,
    updateMessage: ConversationMessage.updateOne,
    emit: socketService.emit
  };
  context.after(() => {
    Conversation.findOneAndUpdate = originals.upsert;
    ConversationMessage.create = originals.createMessage;
    ConversationMessage.updateOne = originals.updateMessage;
    socketService.emit = originals.emit;
  });

  const conversationId = '507f1f77bcf86cd799439021';
  let upsertUpdate;
  const conversationUpserts = [];
  const conversationSummaries = [];
  let storedMessage;
  Conversation.findOneAndUpdate = (_filter, update) => {
    if (update.$setOnInsert) {
      upsertUpdate = update;
      conversationUpserts.push(update);
      return selected({
        _id: conversationId,
        channel: update.$setOnInsert.channel,
        externalIdEncrypted: update.$setOnInsert.externalIdEncrypted,
        displayNameEncrypted: update.$set.displayNameEncrypted,
        retentionUntil: update.$set.retentionUntil,
        isGroup: false,
        unreadCount: 0,
        messageCount: 0
      });
    }
    if (update.$inc?.activityVersion) {
      return selected({
        _id: conversationId,
        channel: 'telegram',
        externalIdEncrypted: upsertUpdate.$setOnInsert.externalIdEncrypted,
        displayNameEncrypted: upsertUpdate.$set.displayNameEncrypted,
        activityVersion: 1,
        lastHiddenVersion: 0,
        unreadCount: 0,
        messageCount: 0
      });
    }
    conversationSummaries.push(update);
    return selected({
      _id: conversationId,
      channel: 'telegram',
      externalIdEncrypted: upsertUpdate.$setOnInsert.externalIdEncrypted,
      displayNameEncrypted: upsertUpdate.$set.displayNameEncrypted,
      lastMessagePreviewEncrypted: update.$set.lastMessagePreviewEncrypted,
      lastMessageDirection: 'inbound',
      lastMessageType: 'text',
      lastMessageAt: new Date('2026-07-21T00:00:00Z'),
      unreadCount: 1,
      messageCount: 1
    });
  };
  ConversationMessage.create = async (values) => {
    storedMessage = values;
    return { _id: '507f1f77bcf86cd799439022', ...values, createdAt: new Date('2026-07-21T00:00:00Z') };
  };
  ConversationMessage.updateOne = async () => ({ matchedCount: 1 });
  const events = [];
  socketService.emit = (event, payload) => events.push({ event, payload });

  const result = await conversationsManager.recordInbound({
    channel: 'telegram',
    externalId: '123456789',
    contactId: '507f1f77bcf86cd799439011',
    displayName: 'Ana',
    providerMessageId: '55',
    body: 'mensagem privada',
    sentAt: '2026-07-21T00:00:00Z'
  });

  assert.notEqual(upsertUpdate.$setOnInsert.externalIdEncrypted, '123456789');
  assert.notEqual(storedMessage.bodyEncrypted, 'mensagem privada');
  assert.notEqual(storedMessage.providerMessageIdEncrypted, '55');
  assert.equal(storedMessage.activityVersion, 1);
  assert.equal(result.message.body, 'mensagem privada');
  assert.equal(result.conversation.externalId, '123456789');
  assert.equal(result.conversation.unreadCount, 1);
  assert.deepEqual(events.map((item) => item.event), ['conversation:message', 'conversations:updated']);
  assert.equal(storedMessage.retentionUntil, undefined);
  assert.equal(conversationUpserts[0].$set.retentionUntil, undefined);
  assert.equal(conversationSummaries[0].$set.retentionUntil, undefined);

  const originalRetentionDays = env.whatsappWebMessageRetentionDays;
  env.whatsappWebMessageRetentionDays = 7;
  context.after(() => { env.whatsappWebMessageRetentionDays = originalRetentionDays; });
  const retentionStartedAt = Date.now();
  await conversationsManager.recordInbound({
    channel: 'whatsapp_web',
    externalId: '5511999999999@c.us',
    contactId: '507f1f77bcf86cd799439011',
    displayName: 'Ana',
    providerMessageId: 'wweb-55',
    body: 'mensagem com retencao',
    sentAt: '2026-07-21T00:00:00Z'
  });
  const retentionMs = storedMessage.retentionUntil.getTime() - retentionStartedAt;
  assert.ok(retentionMs >= 6.9 * 24 * 60 * 60 * 1000);
  assert.ok(retentionMs <= 7.1 * 24 * 60 * 60 * 1000);
  const conversationRetentionMs = conversationSummaries[1].$set.retentionUntil.getTime() - retentionStartedAt;
  assert.ok(conversationRetentionMs >= 6.9 * 24 * 60 * 60 * 1000);
  assert.ok(conversationRetentionMs <= 7.1 * 24 * 60 * 60 * 1000);
  const messageTtlIndex = ConversationMessage.schema.indexes().find(([fields]) => fields.retentionUntil === 1);
  const conversationTtlIndex = Conversation.schema.indexes().find(([fields]) => fields.retentionUntil === 1);
  assert.ok(messageTtlIndex);
  assert.ok(conversationTtlIndex);
  assert.equal(messageTtlIndex[1].expireAfterSeconds, 0);
  assert.equal(conversationTtlIndex[1].expireAfterSeconds, 0);
});

test('opt-in associa inbox Web existente ao contato sem recriar conversa ou duplicar mensagens', async (context) => {
  const originals = {
    conversation: Conversation.findOneAndUpdate,
    messages: ConversationMessage.updateMany,
    emit: socketService.emit
  };
  context.after(() => {
    Conversation.findOneAndUpdate = originals.conversation;
    ConversationMessage.updateMany = originals.messages;
    socketService.emit = originals.emit;
  });
  let conversationFilter;
  let conversationUpdate;
  let conversationOptions;
  Conversation.findOneAndUpdate = (filter, update, options) => {
    conversationFilter = filter;
    conversationUpdate = update;
    conversationOptions = options;
    return selected({
      _id: '507f1f77bcf86cd799439071',
      channel: 'whatsapp_web',
      externalIdEncrypted: encrypt('551131234567@c.us'),
      displayNameEncrypted: update.$set.displayNameEncrypted,
      avatarUrlEncrypted: update.$set.avatarUrlEncrypted,
      contact: update.$set.contact,
      retentionUntil: update.$set.retentionUntil,
      messageCount: 2
    });
  };
  let messageMigration;
  ConversationMessage.updateMany = async (filter, update) => {
    messageMigration = { filter, update };
    return { matchedCount: 2, modifiedCount: 2 };
  };
  const events = [];
  socketService.emit = (event, payload) => events.push({ event, payload });

  const result = await conversationsManager.attachContact(
    'whatsapp_web',
    '551131234567@c.us',
    '507f1f77bcf86cd799439072',
    { displayName: 'Samuel', avatarUrl: 'https://cdn.example/samuel.jpg' }
  );

  assert.equal(conversationFilter.channel, 'whatsapp_web');
  assert.equal(conversationFilter.externalIdHash, searchHash('551131234567@c.us'));
  assert.equal(conversationUpdate.$set.contact, '507f1f77bcf86cd799439072');
  assert.equal(conversationOptions.upsert, undefined);
  assert.equal(messageMigration.filter.conversation, '507f1f77bcf86cd799439071');
  assert.equal(messageMigration.update.$set.contact, '507f1f77bcf86cd799439072');
  assert.equal(result.contactId, '507f1f77bcf86cd799439072');
  assert.equal(result.pendingRegistration, false);
  assert.deepEqual(events.map((item) => item.event), ['conversations:updated']);
});

test('remocao concorrente vence inbound que ainda observava conversa visivel', async (context) => {
  const originals = {
    upsert: Conversation.findOneAndUpdate,
    createMessage: ConversationMessage.create,
    deleteMessage: ConversationMessage.deleteOne,
    emit: socketService.emit
  };
  context.after(() => {
    Conversation.findOneAndUpdate = originals.upsert;
    ConversationMessage.create = originals.createMessage;
    ConversationMessage.deleteOne = originals.deleteMessage;
    socketService.emit = originals.emit;
  });
  const conversationId = '507f1f77bcf86cd799439031';
  let commitFilter;
  Conversation.findOneAndUpdate = (filter, update) => {
    if (update.$setOnInsert) {
      return selected({
        _id: conversationId,
        channel: 'telegram',
        externalIdEncrypted: update.$setOnInsert.externalIdEncrypted,
        hiddenAt: null,
        unreadCount: 0,
        messageCount: 0
      });
    }
    commitFilter = filter;
    return selected(null);
  };
  let createCalled = false;
  ConversationMessage.create = async () => { createCalled = true; };
  let removedMessageId;
  ConversationMessage.deleteOne = async (filter) => { removedMessageId = String(filter._id); };
  const events = [];
  socketService.emit = (...args) => events.push(args);

  const result = await conversationsManager.recordInbound({
    channel: 'telegram', externalId: 'race-visible', providerMessageId: 'race-1', body: 'chegando'
  });

  assert.equal(commitFilter.hiddenAt, null);
  assert.equal(createCalled, false);
  assert.equal(removedMessageId, undefined);
  assert.equal(result.discardedByRemoval, true);
  assert.deepEqual(events, []);
});

test('inbound que observa tombstone o reabre por compare-and-set', async (context) => {
  const originals = {
    upsert: Conversation.findOneAndUpdate,
    createMessage: ConversationMessage.create,
    findMessage: ConversationMessage.findOne,
    updateMessage: ConversationMessage.updateOne,
    emit: socketService.emit
  };
  context.after(() => {
    Conversation.findOneAndUpdate = originals.upsert;
    ConversationMessage.create = originals.createMessage;
    ConversationMessage.findOne = originals.findMessage;
    ConversationMessage.updateOne = originals.updateMessage;
    socketService.emit = originals.emit;
  });
  const conversationId = '507f1f77bcf86cd799439041';
  const hiddenAt = new Date('2026-07-21T01:00:00.000Z');
  let reserveFilter;
  let reserveUpdate;
  let commitFilter;
  let commitUpdate;
  Conversation.findOneAndUpdate = (filter, update) => {
    if (update.$setOnInsert) {
      return selected({
        _id: conversationId,
        channel: 'telegram',
        externalIdEncrypted: update.$setOnInsert.externalIdEncrypted,
        hiddenAt,
        activityVersion: 1,
        lastHiddenVersion: 1,
        unreadCount: 0,
        messageCount: 0
      });
    }
    if (update.$inc?.activityVersion) {
      reserveFilter = filter;
      reserveUpdate = update;
      return selected({
        _id: conversationId,
        channel: 'telegram',
        externalIdEncrypted: encrypt('race-hidden'),
        activityVersion: 2,
        lastHiddenVersion: 1,
        unreadCount: 0,
        messageCount: 0
      });
    }
    commitFilter = filter;
    commitUpdate = update;
    return selected({
      _id: conversationId,
      channel: 'telegram',
      externalIdEncrypted: encrypt('race-hidden'),
      lastMessagePreviewEncrypted: update.$set.lastMessagePreviewEncrypted,
      lastMessageDirection: 'inbound',
      lastMessageType: 'text',
      lastMessageAt: new Date(),
      unreadCount: 1,
      messageCount: 1
    });
  };
  ConversationMessage.create = async (values) => ({
    _id: '507f1f77bcf86cd799439042',
    ...values,
    createdAt: new Date()
  });
  ConversationMessage.findOne = () => ({ select: () => ({ lean: async () => null }) });
  ConversationMessage.updateOne = async () => ({ matchedCount: 1 });
  socketService.emit = () => undefined;

  const result = await conversationsManager.recordInbound({
    channel: 'telegram', externalId: 'race-hidden', providerMessageId: 'race-2', body: 'nova mensagem'
  });

  assert.deepEqual(reserveFilter.hiddenAt, hiddenAt);
  assert.equal(reserveUpdate.$unset, undefined);
  assert.deepEqual(commitFilter.$and[0].$or, [{ hiddenAt }, { hiddenAt: null }]);
  assert.equal(commitUpdate.$unset.hiddenAt, 1);
  assert.equal(result.message.id, '507f1f77bcf86cd799439042');
  assert.equal(result.discardedByRemoval, undefined);
  assert.equal(result.message.body, 'nova mensagem');
});

test('replay duplicado de geracao removida nao reserva nem reabre o tombstone', async (context) => {
  const originals = {
    upsert: Conversation.findOneAndUpdate,
    createMessage: ConversationMessage.create,
    findMessage: ConversationMessage.findOne,
    emit: socketService.emit
  };
  context.after(() => {
    Conversation.findOneAndUpdate = originals.upsert;
    ConversationMessage.create = originals.createMessage;
    ConversationMessage.findOne = originals.findMessage;
    socketService.emit = originals.emit;
  });
  const conversationId = '507f1f77bcf86cd799439061';
  const hiddenAt = new Date('2026-07-21T02:00:00.000Z');
  let reserveCalled = false;
  Conversation.findOneAndUpdate = (_filter, update) => {
    if (update.$setOnInsert) {
      return selected({
        _id: conversationId,
        channel: 'telegram',
        externalIdEncrypted: update.$setOnInsert.externalIdEncrypted,
        hiddenAt,
        activityVersion: 1,
        lastHiddenVersion: 1
      });
    }
    if (update.$inc?.activityVersion) {
      reserveCalled = true;
      return selected(null);
    }
    return selected(null);
  };
  let createCalled = false;
  ConversationMessage.create = async () => { createCalled = true; };
  ConversationMessage.findOne = () => ({
    select: () => ({ lean: async () => ({ activityVersion: 1 }) })
  });
  const events = [];
  socketService.emit = (...args) => events.push(args);

  const result = await conversationsManager.recordInbound({
    channel: 'telegram', externalId: 'replay-hidden', providerMessageId: 'old-provider-id', body: 'replay'
  });

  assert.equal(result.duplicate, true);
  assert.equal(reserveCalled, false);
  assert.equal(createCalled, false);
  assert.deepEqual(events, []);
});

test('tombstone por geracao descarta mensagem reservada antes de uma remocao posterior', async (context) => {
  const originals = {
    upsert: Conversation.findOneAndUpdate,
    createMessage: ConversationMessage.create,
    updateMessage: ConversationMessage.updateOne,
    deleteMessage: ConversationMessage.deleteOne,
    emit: socketService.emit
  };
  context.after(() => {
    Conversation.findOneAndUpdate = originals.upsert;
    ConversationMessage.create = originals.createMessage;
    ConversationMessage.updateOne = originals.updateMessage;
    ConversationMessage.deleteOne = originals.deleteMessage;
    socketService.emit = originals.emit;
  });
  const conversationId = '507f1f77bcf86cd799439051';
  Conversation.findOneAndUpdate = (_filter, update) => {
    if (update.$setOnInsert) {
      return selected({
        _id: conversationId,
        channel: 'telegram',
        externalIdEncrypted: update.$setOnInsert.externalIdEncrypted,
        activityVersion: 0,
        lastHiddenVersion: 0,
        hiddenAt: null
      });
    }
    if (update.$inc?.activityVersion) {
      return selected({
        _id: conversationId,
        channel: 'telegram',
        externalIdEncrypted: encrypt('race-after-reserve'),
        activityVersion: 1,
        lastHiddenVersion: 0,
        hiddenAt: null
      });
    }
    return selected(null);
  };
  ConversationMessage.create = async (values) => ({
    _id: '507f1f77bcf86cd799439052',
    ...values,
    createdAt: new Date()
  });
  let tombstoned = false;
  ConversationMessage.updateOne = async (_filter, update) => {
    tombstoned = update.$unset?.bodyEncrypted === 1
      && update.$unset?.sentAt === 1
      && update.$set?.tombstonedAt instanceof Date;
    return { matchedCount: 1 };
  };
  let deleted = false;
  ConversationMessage.deleteOne = async () => { deleted = true; };
  const events = [];
  socketService.emit = (...args) => events.push(args);

  const result = await conversationsManager.recordInbound({
    channel: 'telegram', externalId: 'race-after-reserve', providerMessageId: 'race-3', body: 'na corrida'
  });

  assert.equal(result.discardedByRemoval, true);
  assert.equal(tombstoned, true);
  assert.equal(deleted, false);
  assert.deepEqual(events, []);
});

test('limpar historico de inbox pendente preserva conversa sem criar contato', async (context) => {
  const originals = {
    clearTransition: Conversation.findOneAndUpdate,
    tombstoneMessages: ConversationMessage.updateMany,
    deleteMessages: ConversationMessage.deleteMany,
    emit: socketService.emit
  };
  context.after(() => {
    Conversation.findOneAndUpdate = originals.clearTransition;
    ConversationMessage.updateMany = originals.tombstoneMessages;
    ConversationMessage.deleteMany = originals.deleteMessages;
    socketService.emit = originals.emit;
  });
  const id = '507f1f77bcf86cd799439021';
  let clearPipeline;
  Conversation.findOneAndUpdate = (_filter, update) => {
    clearPipeline = update;
    return selected({
      _id: id,
      channel: 'whatsapp_web',
      externalIdEncrypted: encrypt('551131234567@c.us'),
      activityVersion: 6,
      lastHiddenVersion: 6
    });
  };
  let tombstoneFilter;
  ConversationMessage.updateMany = async (filter) => {
    tombstoneFilter = filter;
    return { modifiedCount: 5 };
  };
  ConversationMessage.deleteMany = async () => ({ deletedCount: 2 });
  socketService.emit = () => undefined;

  const result = await conversationsManager.clearHistory(id);
  assert.equal(result.removedMessages, 7);
  assert.equal(result.conversationPreserved, true);
  assert.equal(result.contactPreserved, false);
  assert.equal(result.pendingRegistration, true);
  assert.equal(clearPipeline[0].$set.messageCount, 0);
  assert.equal(clearPipeline[0].$set.lastMessageAt, '$$REMOVE');
  assert.deepEqual(clearPipeline[0].$set.lastHiddenVersion, clearPipeline[0].$set.activityVersion);
  assert.deepEqual(tombstoneFilter.$and[0].$or[0], { activityVersion: { $lt: 6 } });
});

test('corte automatico preserva hashes como tombstones sem renovar tombstones antigos', async (context) => {
  const originals = {
    findMessages: ConversationMessage.find,
    tombstoneMessages: ConversationMessage.updateMany,
    deleteMessages: ConversationMessage.deleteMany,
    updateConversation: Conversation.updateOne
  };
  context.after(() => {
    ConversationMessage.find = originals.findMessages;
    ConversationMessage.updateMany = originals.tombstoneMessages;
    ConversationMessage.deleteMany = originals.deleteMessages;
    Conversation.updateOne = originals.updateConversation;
  });

  const conversationId = '507f1f77bcf86cd799439021';
  const overflowIds = ['507f1f77bcf86cd799439031', '507f1f77bcf86cd799439032'];
  ConversationMessage.find = () => ({
    sort: () => ({
      skip: () => ({
        select: () => ({
          lean: async () => overflowIds.map((_id) => ({ _id }))
        })
      })
    })
  });
  let tombstoneFilter;
  let tombstonePipeline;
  ConversationMessage.updateMany = async (filter, update) => {
    tombstoneFilter = filter;
    tombstonePipeline = update;
    return { modifiedCount: 2 };
  };
  ConversationMessage.deleteMany = async () => ({ deletedCount: 0 });
  let conversationUpdate;
  Conversation.updateOne = async (_filter, update) => { conversationUpdate = update; };

  await conversationsManager._trimHistory(conversationId, 502);

  assert.deepEqual(tombstoneFilter.$and[0]._id.$in, overflowIds);
  assert.deepEqual(tombstoneFilter.$and[2], { tombstonedAt: { $exists: false } });
  assert.equal(tombstonePipeline[0].$set.bodyEncrypted, '$$REMOVE');
  assert.equal(tombstonePipeline[0].$set.sentAt, '$$REMOVE');
  assert.equal(conversationUpdate.$set.messageCount, 500);
});

test('remover conversa cria ocultacao duravel ate o proximo inbound', async (context) => {
  const originals = {
    find: Conversation.findById,
    removeTransition: Conversation.findOneAndUpdate,
    tombstoneMessages: ConversationMessage.updateMany,
    deleteMessages: ConversationMessage.deleteMany,
    emit: socketService.emit
  };
  context.after(() => {
    Conversation.findById = originals.find;
    Conversation.findOneAndUpdate = originals.removeTransition;
    ConversationMessage.updateMany = originals.tombstoneMessages;
    ConversationMessage.deleteMany = originals.deleteMessages;
    socketService.emit = originals.emit;
  });
  const id = '507f1f77bcf86cd799439021';
  Conversation.findById = () => selected({ _id: id, channel: 'telegram', externalIdEncrypted: encrypt('123') });
  let tombstoneFilter;
  let tombstonePipeline;
  ConversationMessage.updateMany = async (filter, update) => {
    tombstoneFilter = filter;
    tombstonePipeline = update;
    return { modifiedCount: 2 };
  };
  let deleteFilter;
  ConversationMessage.deleteMany = async (filter) => { deleteFilter = filter; return { deletedCount: 1 }; };
  let updatePipeline;
  Conversation.findOneAndUpdate = (_filter, update) => {
    updatePipeline = update;
    return selected({ _id: id, activityVersion: 5, lastHiddenVersion: 5 });
  };
  const events = [];
  socketService.emit = (event) => events.push(event);

  const result = await conversationsManager.remove(id);

  assert.equal(result.hiddenUntilNextInbound, true);
  assert.equal(result.removedMessages, 3);
  assert.equal(updatePipeline[0].$set.hiddenAt, '$$NOW');
  assert.equal(updatePipeline[0].$set.messageCount, 0);
  assert.deepEqual(tombstoneFilter.$and[0].$or[0], { activityVersion: { $lt: 5 } });
  assert.deepEqual(tombstoneFilter.$and[2], { tombstonedAt: { $exists: false } });
  assert.equal(tombstonePipeline[0].$set.bodyEncrypted, '$$REMOVE');
  assert.equal(tombstonePipeline[0].$set.direction, '$$REMOVE');
  assert.equal(tombstonePipeline[0].$set.sentAt, '$$REMOVE');
  assert.deepEqual(deleteFilter.$and[0].$or[0], { activityVersion: { $lt: 5 } });
  assert.deepEqual(events, ['conversation:removed']);
});

test('avatar do contato prefere WhatsApp Cloud e usa Telegram como alternativa', () => {
  const base = {
    _id: '507f1f77bcf86cd799439011',
    displayNameEncrypted: encrypt('Ana'),
    channels: [],
    channelAvatars: [
      { channel: 'telegram', urlEncrypted: encrypt('https://telegram.example/avatar.jpg') },
      { channel: 'whatsapp_cloud', urlEncrypted: encrypt('https://whatsapp.example/avatar.jpg') }
    ]
  };
  const preferred = contactsManager.serialize(base);
  assert.equal(preferred.avatarUrl, 'https://whatsapp.example/avatar.jpg');
  assert.equal(preferred.avatarSource, 'whatsapp_cloud');

  const fallback = contactsManager.serialize({ ...base, channelAvatars: base.channelAvatars.slice(0, 1) });
  assert.equal(fallback.avatarUrl, 'https://telegram.example/avatar.jpg');
  assert.equal(fallback.avatarSource, 'telegram');
});

test('marcar conversa ja lida e idempotente e nao realimenta o socket', async (context) => {
  const originals = {
    update: Conversation.findOneAndUpdate,
    find: Conversation.findById,
    emit: socketService.emit
  };
  context.after(() => {
    Conversation.findOneAndUpdate = originals.update;
    Conversation.findById = originals.find;
    socketService.emit = originals.emit;
  });

  const id = '507f1f77bcf86cd799439091';
  let updateFilter;
  Conversation.findOneAndUpdate = (filter) => {
    updateFilter = filter;
    return selected(null);
  };
  Conversation.findById = () => selected({
    _id: id,
    channel: 'whatsapp_cloud',
    externalIdEncrypted: encrypt('5511999999999'),
    unreadCount: 0
  });
  const events = [];
  socketService.emit = (event) => events.push(event);

  const result = await conversationsManager.markRead(id);

  assert.deepEqual(updateFilter, { _id: id, unreadCount: { $gt: 0 } });
  assert.equal(result.id, id);
  assert.equal(result.unreadCount, 0);
  assert.deepEqual(events, []);
});

test('marcar conversa nao lida emite atualizacao uma unica vez', async (context) => {
  const originals = {
    update: Conversation.findOneAndUpdate,
    emit: socketService.emit
  };
  context.after(() => {
    Conversation.findOneAndUpdate = originals.update;
    socketService.emit = originals.emit;
  });

  const id = '507f1f77bcf86cd799439092';
  Conversation.findOneAndUpdate = () => selected({
    _id: id,
    channel: 'whatsapp_cloud',
    externalIdEncrypted: encrypt('5511888888888'),
    unreadCount: 0
  });
  const events = [];
  socketService.emit = (event, payload) => events.push({ event, payload });

  const result = await conversationsManager.markRead(id);

  assert.equal(result.unreadCount, 0);
  assert.equal(events.length, 1);
  assert.equal(events[0].event, 'conversations:updated');
  assert.equal(events[0].payload.conversation.id, id);
});

test('rotas de conversas exigem autenticacao administrativa', async () => {
  const response = await request(createApp()).get('/api/conversations');
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'AUTH_REQUIRED');
});

test('modelos nao deixam corpo e identificadores externos visiveis por padrao', () => {
  assert.equal(Conversation.schema.path('externalIdEncrypted').options.select, false);
  assert.equal(Conversation.schema.path('lastMessagePreviewEncrypted').options.select, false);
  assert.equal(ConversationMessage.schema.path('bodyEncrypted').options.select, false);
  assert.equal(ConversationMessage.schema.path('providerMessageIdEncrypted').options.select, false);
});
