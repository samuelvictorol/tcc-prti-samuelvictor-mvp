const test = require('node:test');
const assert = require('node:assert/strict');
const AdminNotification = require('../src/models/admin-notification.model');
const manager = require('../src/managers/admin-notifications.manager');
const { listAdminNotificationsSchema } = require('../src/dtos/admin-notifications.dto');

const ADMIN_ID = '507f1f77bcf86cd799439001';

test('notificacao administrativa remove segredos e inclui atalho do contato', async (context) => {
  const originalCreate = AdminNotification.create;
  context.after(() => { AdminNotification.create = originalCreate; });
  let stored;
  AdminNotification.create = async (input) => {
    stored = input;
    return {
      _id: '507f1f77bcf86cd799439099',
      ...input,
      reads: [],
      createdAt: new Date('2026-07-21T00:00:00Z'),
      toObject() { return { ...this }; }
    };
  };

  const result = await manager.create({
    kind: 'contact_auto_created',
    channel: 'whatsapp_cloud',
    title: 'Novo contato',
    message: 'Contato cadastrado',
    contactId: '507f1f77bcf86cd799439011',
    context: { accessToken: 'nao-vazar', nested: { password: 'nao-vazar' }, safe: 'ok' }
  });
  assert.equal(stored.context.accessToken, '[REDACTED]');
  assert.equal(stored.context.nested.password, '[REDACTED]');
  assert.equal(stored.context.safe, 'ok');
  const retentionMs = stored.retentionUntil.getTime() - Date.now();
  assert.ok(retentionMs <= manager.ADMIN_NOTIFICATION_RETENTION_MS);
  assert.ok(retentionMs > manager.ADMIN_NOTIFICATION_RETENTION_MS - 5_000);
  assert.equal(result.contactId, '507f1f77bcf86cd799439011');
  assert.equal(result.contactPath, '/contacts/507f1f77bcf86cd799439011');
  assert.doesNotMatch(JSON.stringify(result), /nao-vazar/);
});

test('marcar notificacao como lida e idempotente por administrador', async (context) => {
  const originalFind = AdminNotification.findById;
  context.after(() => { AdminNotification.findById = originalFind; });
  let saves = 0;
  const document = {
    _id: '507f1f77bcf86cd799439099',
    kind: 'contact_auto_created',
    channel: 'telegram',
    title: 'Novo contato',
    message: 'Contato cadastrado',
    reads: [],
    save: async () => { saves += 1; },
    toObject() { return { ...this }; }
  };
  AdminNotification.findById = async () => document;
  const adminId = '507f1f77bcf86cd799439001';

  assert.equal((await manager.markRead(document._id, adminId)).read, true);
  assert.equal((await manager.markRead(document._id, adminId)).read, true);
  assert.equal(saves, 1);
});

test('filtro de notificacoes administrativas aceita status, busca, periodo e paginacao', () => {
  const parsed = listAdminNotificationsSchema.safeParse({ query: {
    page: '2',
    limit: '20',
    read: 'false',
    search: 'Samuel',
    channel: 'whatsapp_cloud',
    type: 'contact_auto_created',
    dateFrom: '2026-07-01T00:00:00.000Z',
    dateTo: '2026-07-20T00:00:00.000Z'
  } });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.query.read, false);
  assert.equal(parsed.data.query.search, 'Samuel');
  assert.equal(parsed.data.query.type, 'contact_auto_created');
  assert.equal(parsed.data.query.page, 2);
  assert.ok(parsed.data.query.dateFrom instanceof Date);
});

test('filtro rejeita periodo invertido', () => {
  const parsed = listAdminNotificationsSchema.safeParse({ query: {
    dateFrom: '2026-07-20T00:00:00.000Z',
    dateTo: '2026-07-01T00:00:00.000Z'
  } });
  assert.equal(parsed.success, false);
});

test('filtro do historico limita a consulta a 30 dias e suporta lidas ou nao lidas', () => {
  const now = new Date('2026-07-29T12:00:00.000Z');
  const unread = manager.listFilter({
    read: false,
    channel: 'telegram',
    type: 'contact_auto_created',
    search: 'samuel.*'
  }, ADMIN_ID, now);
  assert.equal(unread.createdAt.$gte.toISOString(), '2026-06-29T12:00:00.000Z');
  assert.equal(unread.channel, 'telegram');
  assert.equal(unread.kind, 'contact_auto_created');
  assert.deepEqual(unread.reads, { $not: { $elemMatch: { admin: ADMIN_ID } } });
  assert.equal(unread.$or[0].title.source, 'samuel\\.\\*');

  const read = manager.listFilter({ read: true }, ADMIN_ID, now);
  assert.deepEqual(read.reads, { $elemMatch: { admin: ADMIN_ID } });
});

test('serializacao volta a remover segredos de registros legados e informa leitura', () => {
  const result = manager.serialize({
    _id: '507f1f77bcf86cd799439099',
    kind: 'system',
    channel: 'system',
    title: 'Atualizacao',
    message: 'Concluida',
    context: {
      token: 'segredo-legado',
      nested: { authorization: 'Bearer segredo', visible: 'ok' }
    },
    reads: [{ admin: ADMIN_ID, readAt: new Date('2026-07-29T10:00:00.000Z') }],
    createdAt: new Date('2026-07-29T09:00:00.000Z'),
    retentionUntil: new Date('2026-08-28T09:00:00.000Z')
  }, ADMIN_ID);
  assert.equal(result.read, true);
  assert.equal(result.context.token, '[REDACTED]');
  assert.equal(result.context.nested.authorization, '[REDACTED]');
  assert.equal(result.context.nested.visible, 'ok');
  assert.doesNotMatch(JSON.stringify(result), /segredo-legado|Bearer segredo/);
});

test('listagem retorna paginacao, contador global de nao lidas e filtros disponiveis', async (context) => {
  const originals = {
    find: AdminNotification.find,
    countDocuments: AdminNotification.countDocuments,
    distinct: AdminNotification.distinct
  };
  context.after(() => Object.assign(AdminNotification, originals));

  const rows = [{
    _id: '507f1f77bcf86cd799439099',
    kind: 'contact_auto_created',
    channel: 'telegram',
    title: 'Novo contato',
    message: 'Samuel',
    reads: [],
    context: {},
    createdAt: new Date('2026-07-29T09:00:00.000Z')
  }];
  const query = {
    sort() { return this; },
    skip() { return this; },
    limit() { return this; },
    async lean() { return rows; }
  };
  let countCall = 0;
  AdminNotification.find = () => query;
  AdminNotification.countDocuments = async () => (++countCall === 1 ? 1 : 4);
  AdminNotification.distinct = async (field) => (
    field === 'channel' ? ['whatsapp_cloud', 'telegram'] : ['system', 'contact_auto_created']
  );

  const result = await manager.list({ page: 1, limit: 10, search: 'Samuel' }, ADMIN_ID);
  assert.equal(result.total, 1);
  assert.equal(result.unread, 4);
  assert.equal(result.items[0].title, 'Novo contato');
  assert.deepEqual(result.filters.channels, ['telegram', 'whatsapp_cloud']);
  assert.deepEqual(result.filters.kinds, ['contact_auto_created', 'system']);
});

test('detalhe nao expoe notificacao fora da janela de 30 dias', async (context) => {
  const originalFindById = AdminNotification.findById;
  context.after(() => { AdminNotification.findById = originalFindById; });
  AdminNotification.findById = async () => ({
    _id: '507f1f77bcf86cd799439099',
    createdAt: new Date(Date.now() - manager.ADMIN_NOTIFICATION_RETENTION_MS - 1_000)
  });
  await assert.rejects(
    () => manager.getById('507f1f77bcf86cd799439099', ADMIN_ID),
    (error) => error.statusCode === 404
  );
});

test('contador e leitura em massa ignoram registros anteriores aos 30 dias', async (context) => {
  const originals = {
    countDocuments: AdminNotification.countDocuments,
    updateMany: AdminNotification.updateMany
  };
  context.after(() => Object.assign(AdminNotification, originals));
  let countFilter;
  let updateFilter;
  AdminNotification.countDocuments = async (filter) => {
    countFilter = filter;
    return 2;
  };
  AdminNotification.updateMany = async (filter) => {
    updateFilter = filter;
    return { modifiedCount: 2 };
  };

  assert.deepEqual(await manager.unreadCount(ADMIN_ID), { unread: 2 });
  assert.ok(countFilter.createdAt.$gte instanceof Date);
  assert.deepEqual(countFilter.reads, { $not: { $elemMatch: { admin: ADMIN_ID } } });

  assert.deepEqual(await manager.markAllRead(ADMIN_ID), { marked: 2, unread: 0 });
  assert.ok(updateFilter.createdAt.$gte instanceof Date);
  assert.deepEqual(updateFilter.reads, { $not: { $elemMatch: { admin: ADMIN_ID } } });
});

test('politica de retencao remove legados e corrige expiracao dos registros ativos', async (context) => {
  const originals = {
    deleteMany: AdminNotification.deleteMany,
    updateMany: AdminNotification.updateMany
  };
  context.after(() => Object.assign(AdminNotification, originals));
  let deletionFilter;
  let migrationFilter;
  let migrationUpdate;
  AdminNotification.deleteMany = async (filter) => {
    deletionFilter = filter;
    return { deletedCount: 3 };
  };
  AdminNotification.updateMany = async (filter, update) => {
    migrationFilter = filter;
    migrationUpdate = update;
    return { modifiedCount: 5 };
  };
  const now = new Date('2026-07-29T12:00:00.000Z');
  const result = await manager.enforceRetentionPolicy(now);
  assert.equal(deletionFilter.createdAt.$lt.toISOString(), '2026-06-29T12:00:00.000Z');
  assert.equal(migrationFilter.createdAt.$gte.toISOString(), '2026-06-29T12:00:00.000Z');
  assert.equal(migrationUpdate[0].$set.retentionUntil.$add[1], manager.ADMIN_NOTIFICATION_RETENTION_MS);
  assert.deepEqual(result, { deleted: 3, migrated: 5 });
});

test('modelo possui TTL sobre retentionUntil', () => {
  const ttl = AdminNotification.schema.indexes().find(([fields]) => fields.retentionUntil === 1);
  assert.ok(ttl);
  assert.equal(ttl[1].expireAfterSeconds, 0);
});
