const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const Notification = require('../src/models/notification.model');
const ConsentEvent = require('../src/models/consent-event.model');
const InviteClick = require('../src/models/invite-click.model');
const Invite = require('../src/models/invite.model');
const Contact = require('../src/models/contact.model');
const ContactGroup = require('../src/models/contact-group.model');
const Conversation = require('../src/models/conversation.model');
const ConversationMessage = require('../src/models/conversation-message.model');
const AdminNotification = require('../src/models/admin-notification.model');
const ChatEmailChallenge = require('../src/models/chat-email-challenge.model');
const RefreshToken = require('../src/models/refresh-token.model');
const Admin = require('../src/models/admin.model');
const contactsManager = require('../src/managers/contacts.manager');
const privacyManager = require('../src/managers/privacy.manager');
const authManager = require('../src/managers/auth.manager');
const { env } = require('../src/config/env');

test('alteracao manual de permissao deriva origem administrativa e persiste ator', async (context) => {
  const originals = {
    get: contactsManager.getById,
    setConsent: contactsManager.setChannelConsent,
    findConsent: ConsentEvent.findOne
  };
  context.after(() => {
    contactsManager.getById = originals.get;
    contactsManager.setChannelConsent = originals.setConsent;
    ConsentEvent.findOne = originals.findConsent;
  });
  const contactId = '507f1f77bcf86cd799439011';
  const actorId = '507f1f77bcf86cd799439012';
  contactsManager.getById = async () => ({ id: contactId });
  let consentContext;
  let consentChannel;
  contactsManager.setChannelConsent = async (_id, channel, _status, input) => {
    consentChannel = channel;
    consentContext = input;
    return { id: contactId, channels: [{ channel: 'telegram', consentStatus: 'revoked' }] };
  };
  ConsentEvent.findOne = () => ({
    sort() { return this; },
    select() { return this; },
    async lean() { return { channel: 'telegram', status: 'revoked', source: 'admin_manual', actor: actorId }; }
  });

  const result = await privacyManager.recordConsent(contactId, {
    channel: 'telegram',
    status: 'revoked',
    confirmed: true,
    evidence: { reason: 'Solicitacao do cliente' },
    source: 'forjado'
  }, actorId);

  assert.equal(consentContext.source, 'admin_manual');
  assert.equal(consentContext.actorId, actorId);
  assert.equal(consentChannel, 'telegram');
  assert.deepEqual(consentContext.evidence, { reason: 'Solicitacao do cliente', confirmed: true });
  assert.equal(result.contact.channels[0].consentStatus, 'revoked');
});

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

test('remocao direta de contato apaga historico e atalhos pessoais sem deixar referencias orfas', async (context) => {
  const originals = {
    findContact: Contact.findById,
    deleteContact: Contact.deleteOne,
    group: ContactGroup.updateMany,
    distinctConversations: Conversation.distinct,
    deleteConversations: Conversation.deleteMany,
    updateConversations: Conversation.updateMany,
    distinctMessageConversations: ConversationMessage.distinct,
    deleteMessages: ConversationMessage.deleteMany,
    deleteAdminNotifications: AdminNotification.deleteMany,
    deleteEmailChallenges: ChatEmailChallenge.deleteMany
  };
  context.after(() => {
    Contact.findById = originals.findContact;
    Contact.deleteOne = originals.deleteContact;
    ContactGroup.updateMany = originals.group;
    Conversation.distinct = originals.distinctConversations;
    Conversation.deleteMany = originals.deleteConversations;
    Conversation.updateMany = originals.updateConversations;
    ConversationMessage.distinct = originals.distinctMessageConversations;
    ConversationMessage.deleteMany = originals.deleteMessages;
    AdminNotification.deleteMany = originals.deleteAdminNotifications;
    ChatEmailChallenge.deleteMany = originals.deleteEmailChallenges;
  });
  const contactId = '507f1f77bcf86cd799439011';
  const conversationId = '507f1f77bcf86cd799439021';
  const groupConversationId = '507f1f77bcf86cd799439022';
  Contact.findById = async () => ({ _id: contactId });
  Contact.deleteOne = async () => ({ deletedCount: 1 });
  ContactGroup.updateMany = async () => ({ modifiedCount: 1 });
  Conversation.distinct = async (field, filter) => {
    assert.equal(field, '_id');
    assert.deepEqual(filter, { contact: contactId });
    return [conversationId];
  };
  ConversationMessage.distinct = async (field, filter) => {
    assert.equal(field, 'conversation');
    assert.deepEqual(filter, { contact: contactId });
    return [conversationId, groupConversationId];
  };
  let messageFilter;
  let conversationFilter;
  let shortcutFilter;
  let shortcutUpdate;
  let adminFilter;
  ConversationMessage.deleteMany = async (filter) => { messageFilter = filter; return { deletedCount: 5 }; };
  Conversation.deleteMany = async (filter) => { conversationFilter = filter; return { deletedCount: 1 }; };
  Conversation.updateMany = async (filter, update) => {
    shortcutFilter = filter;
    shortcutUpdate = update;
    return { modifiedCount: 1 };
  };
  AdminNotification.deleteMany = async (filter) => { adminFilter = filter; return { deletedCount: 2 }; };
  ChatEmailChallenge.deleteMany = async (filter) => {
    assert.deepEqual(filter, { contact: contactId });
    return { deletedCount: 1 };
  };

  const result = await contactsManager.remove(contactId);

  assert.deepEqual(conversationFilter, { contact: contactId });
  assert.deepEqual(messageFilter.$or, [
    { contact: contactId },
    { conversation: { $in: [conversationId] } }
  ]);
  assert.deepEqual(shortcutFilter, { _id: { $in: [groupConversationId] } });
  assert.equal(shortcutUpdate.$unset.lastMessagePreviewEncrypted, 1);
  assert.equal(shortcutUpdate.$set.unreadCount, 0);
  assert.ok(adminFilter.$or.some((condition) => condition.contact === contactId));
  assert.ok(adminFilter.$or.some((condition) => condition['context.contactId']?.$in.includes(contactId)));
  assert.equal(result.removedConversations, 1);
  assert.equal(result.removedConversationMessages, 5);
  assert.equal(result.removedAdminNotifications, 2);
  assert.equal(result.removedEmailChallenges, 1);
  assert.equal(result.sanitizedConversationShortcuts, 1);
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
