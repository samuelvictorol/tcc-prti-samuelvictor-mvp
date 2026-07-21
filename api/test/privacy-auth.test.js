const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const Notification = require('../src/models/notification.model');
const ConsentEvent = require('../src/models/consent-event.model');
const InviteClick = require('../src/models/invite-click.model');
const Invite = require('../src/models/invite.model');
const RefreshToken = require('../src/models/refresh-token.model');
const Admin = require('../src/models/admin.model');
const contactsManager = require('../src/managers/contacts.manager');
const privacyManager = require('../src/managers/privacy.manager');
const authManager = require('../src/managers/auth.manager');
const { env } = require('../src/config/env');

test('exclusao LGPD cobre delivery isolada e desativa convite personalizado', async (context) => {
  const originals = {
    get: contactsManager.getById,
    remove: contactsManager.remove,
    notification: Notification.updateMany,
    consent: ConsentEvent.updateMany,
    click: InviteClick.updateMany,
    invite: Invite.updateMany
  };
  context.after(() => {
    contactsManager.getById = originals.get;
    contactsManager.remove = originals.remove;
    Notification.updateMany = originals.notification;
    ConsentEvent.updateMany = originals.consent;
    InviteClick.updateMany = originals.click;
    Invite.updateMany = originals.invite;
  });
  contactsManager.getById = async () => ({ id: '507f1f77bcf86cd799439011' });
  contactsManager.remove = async () => ({ removed: true });
  let notificationFilter;
  let inviteUpdate;
  Notification.updateMany = async (filter) => { notificationFilter = filter; };
  ConsentEvent.updateMany = async () => undefined;
  InviteClick.updateMany = async () => undefined;
  Invite.updateMany = async (_filter, update) => { inviteUpdate = update; };

  await privacyManager.deleteContact('507f1f77bcf86cd799439011');
  assert.deepEqual(notificationFilter.$or[1], { 'deliveries.contact': '507f1f77bcf86cd799439011' });
  assert.equal(inviteUpdate.$set.active, false);
  assert.equal(inviteUpdate.$unset.recipientContact, 1);
});

test('rotacao de refresh token so pode ser reivindicada uma vez', async (context) => {
  const originals = {
    claim: RefreshToken.findOneAndUpdate,
    create: RefreshToken.create,
    update: RefreshToken.updateOne,
    admin: Admin.findOne
  };
  context.after(() => {
    RefreshToken.findOneAndUpdate = originals.claim;
    RefreshToken.create = originals.create;
    RefreshToken.updateOne = originals.update;
    Admin.findOne = originals.admin;
  });
  let claimed = false;
  RefreshToken.findOneAndUpdate = async () => {
    if (claimed) return null;
    claimed = true;
    return { _id: '507f1f77bcf86cd799439055' };
  };
  RefreshToken.create = async () => ({});
  RefreshToken.updateOne = async () => ({});
  Admin.findOne = async () => ({ _id: '507f1f77bcf86cd799439011', email: 'admin@example.com', active: true });
  const token = jwt.sign({ sub: '507f1f77bcf86cd799439011', type: 'refresh' }, env.jwtRefreshSecret, {
    expiresIn: '1h', issuer: 'notify-app-api', audience: 'notify-app-admin'
  });

  await authManager.rotate(token);
  await assert.rejects(() => authManager.rotate(token), /revogado/);
});
