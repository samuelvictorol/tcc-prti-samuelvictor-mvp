const test = require('node:test');
const assert = require('node:assert/strict');
const ContactGroup = require('../src/models/contact-group.model');
const Term = require('../src/models/term.model');
const termsManager = require('../src/managers/terms.manager');
const { inviteUrl } = require('../src/dtos/common.dto');
const { scheduleExpiryDisconnect } = require('../src/services/socket.service');
const systemManager = require('../src/managers/system.manager');
const groupsManager = require('../src/managers/groups.manager');
const { encrypt } = require('../src/services/crypto.service');
const { env } = require('../src/config/env');

test('indice externo de grupo usa filtro parcial e links rejeitam protocolos ativos', () => {
  const index = ContactGroup.schema.indexes().find(([fields]) => fields.source === 1 && fields.externalIdHash === 1);
  assert.ok(index);
  assert.deepEqual(index[1].partialFilterExpression, { externalIdHash: { $type: 'string' } });
  assert.equal(inviteUrl.safeParse('https://t.me/grupo').success, true);
  assert.equal(inviteUrl.safeParse('tg://resolve?domain=grupo').success, true);
  assert.equal(inviteUrl.safeParse('mailto:user@example.com').success, true);
  assert.equal(inviteUrl.safeParse('javascript:alert(1)').success, false);
  assert.equal(inviteUrl.safeParse('data:text/html,evil').success, false);
});

test('termo publicado e imutavel', async (context) => {
  const original = Term.findById;
  context.after(() => { Term.findById = original; });
  Term.findById = async () => ({ status: 'published' });
  await assert.rejects(() => termsManager.update('507f1f77bcf86cd799439011', { title: 'Alterado' }), /imutavel/);
});

test('socket desconecta quando access token expira', async () => {
  let disconnected = false;
  const socket = { disconnect: () => { disconnected = true; }, once: () => undefined };
  scheduleExpiryDisconnect(socket, new Date(Date.now() + 20).toISOString());
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(disconnected, true);
});

test('readiness exige Redis quando REDIS_REQUIRED esta ativo', async (context) => {
  const original = env.redisRequired;
  context.after(() => { env.redisRequired = original; });
  env.redisRequired = true;
  const result = await systemManager.health();
  assert.equal(result.ready, false);
  assert.equal(result.dependencies.redis, 'down');
});

test('upsert externo preserva opt-out existente do grupo', async (context) => {
  const original = ContactGroup.findOne;
  context.after(() => { ContactGroup.findOne = original; });
  const group = {
    _id: '507f1f77bcf86cd799439011',
    nameEncrypted: encrypt('Grupo'),
    source: 'telegram',
    externalIdEncrypted: encrypt('-1001'),
    externalIdHash: 'hash',
    contacts: [],
    active: false,
    notificationDisabled: true,
    save: async () => undefined,
    toObject() { return { ...this }; }
  };
  ContactGroup.findOne = () => ({ select: async () => group });
  await groupsManager.upsertExternal({ name: 'Grupo atualizado', source: 'telegram', externalId: '-1001' });
  assert.equal(group.active, false);
  assert.equal(group.notificationDisabled, true);
});
