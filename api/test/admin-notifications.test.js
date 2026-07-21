const test = require('node:test');
const assert = require('node:assert/strict');
const AdminNotification = require('../src/models/admin-notification.model');
const manager = require('../src/managers/admin-notifications.manager');
const { listAdminNotificationsSchema } = require('../src/dtos/admin-notifications.dto');

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

test('filtro de notificacoes administrativas aceita unread e paginacao', () => {
  const parsed = listAdminNotificationsSchema.safeParse({ query: {
    page: '2', limit: '20', unread: 'true', channel: 'whatsapp_cloud', kind: 'contact_auto_created'
  } });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.query.unread, true);
  assert.equal(parsed.data.query.page, 2);
});
