const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Contact = require('../src/models/contact.model');
const ContactGroup = require('../src/models/contact-group.model');
const Log = require('../src/models/log.model');
const contactsManager = require('../src/managers/contacts.manager');
const membershipsManager = require('../src/managers/profile-memberships.manager');
const { encrypt } = require('../src/services/crypto.service');
const {
  removeOwnGroupMembershipSchema,
  removeOwnInviteMembershipSchema
} = require('../src/dtos/profile.dto');
const { removeContactInviteSchema } = require('../src/dtos/contacts.dto');

const IDS = Object.freeze({
  self: '507f1f77bcf86cd799439011',
  other: '507f1f77bcf86cd799439012',
  group: '507f1f77bcf86cd799439013',
  invite: '507f1f77bcf86cd799439014',
  admin: '507f1f77bcf86cd799439015'
});

function query(value) {
  const chain = {
    select() { return chain; },
    session() { return chain; },
    sort: async () => value,
    lean: async () => value,
    then(resolve, reject) {
      return Promise.resolve(value).then(resolve, reject);
    }
  };
  return chain;
}

function restoreAfter(context, entries) {
  context.after(() => {
    for (const [object, key, value] of entries) object[key] = value;
  });
}

function groupDocument(overrides = {}) {
  return {
    _id: IDS.group,
    nameEncrypted: encrypt('Clientes do convite'),
    descriptionEncrypted: encrypt('Grupo sincronizado'),
    source: 'manual',
    sourceInvite: IDS.invite,
    sourceInviteTitle: 'Campanha de julho',
    sourceInviteSlug: 'campanha-julho',
    contacts: [IDS.self, IDS.other],
    active: true,
    notificationDisabled: false,
    updatedAt: new Date('2026-07-28T12:00:00Z'),
    ...overrides
  };
}

function contactDocument(id, name, phone) {
  return {
    _id: id,
    displayNameEncrypted: encrypt(name),
    displayNameHash: `hash-${id}`,
    phoneEncrypted: encrypt(phone),
    phoneHash: `phone-${id}`,
    channels: [],
    inviteOrigins: [],
    pendingWhatsappConsents: [],
    active: true,
    notificationDisabled: false,
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

function transactionSession(callback = async (work) => work()) {
  return {
    withTransaction: callback,
    endSession: async () => undefined
  };
}

test('lista somente convites e grupos vinculados ao contato autenticado', async (context) => {
  restoreAfter(context, [
    [contactsManager, 'getById', contactsManager.getById],
    [ContactGroup, 'find', ContactGroup.find]
  ]);
  contactsManager.getById = async (contactId) => {
    assert.equal(contactId, IDS.self);
    return {
      inviteOrigins: [{
        inviteId: IDS.invite,
        title: 'Campanha de julho',
        slug: 'campanha-julho',
        channels: ['telegram'],
        firstUsedAt: new Date('2026-07-01T00:00:00Z'),
        lastUsedAt: new Date('2026-07-20T00:00:00Z')
      }]
    };
  };
  let groupFilter;
  ContactGroup.find = (filter) => {
    groupFilter = filter;
    return query([groupDocument()]);
  };

  const result = await membershipsManager.listOwn(IDS.self);

  assert.equal(String(groupFilter.contacts), IDS.self);
  assert.deepEqual(result.invites.map((invite) => invite.id), [IDS.invite]);
  assert.equal(result.groups[0].name, 'Clientes do convite');
  assert.equal(result.groups[0].memberCount, 2);
  assert.equal(Object.hasOwn(result.groups[0], 'contacts'), false);
});

test('detalhe do grupo exige a propria membresia e mascara telefones dos participantes', async (context) => {
  restoreAfter(context, [
    [ContactGroup, 'findOne', ContactGroup.findOne],
    [Contact, 'find', Contact.find]
  ]);
  let membershipFilter;
  ContactGroup.findOne = (filter) => {
    membershipFilter = filter;
    return query(groupDocument());
  };
  Contact.find = (filter) => {
    assert.deepEqual(filter._id.$in, [IDS.self, IDS.other]);
    return query([
      contactDocument(IDS.self, 'Samuel', '+55 (61) 98174-8795'),
      contactDocument(IDS.other, 'Ana', '+55 (11) 98888-7777')
    ]);
  };

  const result = await membershipsManager.ownGroupDetails(IDS.self, IDS.group);

  assert.equal(String(membershipFilter.contacts), IDS.self);
  assert.equal(result.members.length, 2);
  assert.equal(result.members.find((member) => member.isSelf).displayName, 'Samuel');
  assert.match(result.members[0].phoneMasked, /^\d{4} /);
  assert.doesNotMatch(JSON.stringify(result), /5561981748795|5511988887777/);
  assert.equal(Object.hasOwn(result.members[0], 'id'), false);
});

test('saida de grupo remove somente o proprio contato e registra auditoria sem PII direta', async (context) => {
  restoreAfter(context, [
    [mongoose, 'startSession', mongoose.startSession],
    [ContactGroup, 'findOne', ContactGroup.findOne],
    [ContactGroup, 'updateOne', ContactGroup.updateOne],
    [Log, 'create', Log.create]
  ]);
  mongoose.startSession = async () => transactionSession();
  ContactGroup.findOne = () => query(groupDocument());
  let updateCall;
  ContactGroup.updateOne = async (...args) => {
    updateCall = args;
    return { matchedCount: 1, modifiedCount: 1 };
  };
  let audit;
  Log.create = async (documents) => {
    audit = Array.isArray(documents) ? documents[0] : documents;
    return documents;
  };

  const result = await membershipsManager.removeOwnGroupMembership(
    IDS.self,
    IDS.group,
    { requestId: 'request-membership' }
  );

  assert.equal(String(updateCall[0].contacts), IDS.self);
  assert.equal(String(updateCall[1].$pull.contacts), IDS.self);
  assert.equal(updateCall[0]._id.toString(), IDS.group);
  assert.equal(result.removed, true);
  assert.equal(audit.action, 'profile.group_membership_removed');
  assert.equal(audit.context.selfService, true);
  assert.equal(audit.requestId, 'request-membership');
  assert.doesNotMatch(JSON.stringify(audit.context), new RegExp(IDS.self));
});

test('remocao de convite funciona no Mongo standalone, limpa apenas o origin e grupos sincronizados', async (context) => {
  restoreAfter(context, [
    [mongoose, 'startSession', mongoose.startSession],
    [Contact, 'findOne', Contact.findOne],
    [Contact, 'updateOne', Contact.updateOne],
    [ContactGroup, 'find', ContactGroup.find],
    [ContactGroup, 'updateMany', ContactGroup.updateMany],
    [Log, 'create', Log.create]
  ]);
  const unsupported = new Error('Transaction numbers are only allowed on a replica set member');
  unsupported.code = 20;
  mongoose.startSession = async () => transactionSession(async () => { throw unsupported; });
  Contact.findOne = () => query({
    _id: IDS.self,
    inviteOrigins: [{
      invite: IDS.invite,
      title: 'Campanha de julho',
      slug: 'campanha-julho'
    }]
  });
  ContactGroup.find = () => query([{ _id: IDS.group }]);
  let contactUpdate;
  Contact.updateOne = async (...args) => {
    contactUpdate = args;
    return { matchedCount: 1, modifiedCount: 1 };
  };
  const groupUpdates = [];
  ContactGroup.updateMany = async (...args) => {
    groupUpdates.push(args);
    return { matchedCount: 1, modifiedCount: 1 };
  };
  let audit;
  Log.create = async (document) => {
    audit = Array.isArray(document) ? document[0] : document;
    return document;
  };

  const result = await membershipsManager.removeInviteMembership(
    IDS.self,
    IDS.invite,
    {
      actorId: IDS.admin,
      requestId: 'admin-request',
      source: 'admin_contact_dialog'
    }
  );

  assert.equal(String(groupUpdates[0][0].sourceInvite), IDS.invite);
  assert.equal(String(groupUpdates[0][0].contacts), IDS.self);
  assert.equal(String(groupUpdates[0][1].$pull.contacts), IDS.self);
  assert.equal(String(contactUpdate[0]._id), IDS.self);
  assert.equal(String(contactUpdate[0]['inviteOrigins.invite']), IDS.invite);
  assert.equal(String(contactUpdate[1].$pull.inviteOrigins.invite), IDS.invite);
  assert.equal(result.synchronizedGroupsUpdated, 1);
  assert.equal(result.auditRecorded, true);
  assert.equal(audit.action, 'contact.invite_membership_removed');
  assert.equal(String(audit.actor), IDS.admin);
  assert.equal(audit.context.selfService, false);
});

test('fallback compensa grupos se o origin do contato mudar durante a remocao', async (context) => {
  restoreAfter(context, [
    [mongoose, 'startSession', mongoose.startSession],
    [Contact, 'findOne', Contact.findOne],
    [Contact, 'updateOne', Contact.updateOne],
    [ContactGroup, 'find', ContactGroup.find],
    [ContactGroup, 'updateMany', ContactGroup.updateMany]
  ]);
  const unsupported = new Error('transactions are not supported');
  unsupported.code = 20;
  mongoose.startSession = async () => transactionSession(async () => { throw unsupported; });
  Contact.findOne = () => query({
    _id: IDS.self,
    inviteOrigins: [{ invite: IDS.invite, title: 'Convite', slug: 'convite' }]
  });
  ContactGroup.find = () => query([{ _id: IDS.group }]);
  Contact.updateOne = async () => ({ matchedCount: 1, modifiedCount: 0 });
  const updates = [];
  ContactGroup.updateMany = async (...args) => {
    updates.push(args);
    return { modifiedCount: 1 };
  };

  await assert.rejects(
    () => membershipsManager.removeInviteMembership(IDS.self, IDS.invite, { selfService: true }),
    (error) => error.code === 'CONTACT_INVITE_MEMBERSHIP_CHANGED'
  );
  assert.equal(String(updates[1][0]._id.$in[0]), IDS.group);
  assert.equal(String(updates[1][1].$addToSet.contacts), IDS.self);
});

test('schemas exigem confirmacao explicita nas remocoes self-service e administrativa', () => {
  assert.equal(removeOwnGroupMembershipSchema.safeParse({
    params: { id: IDS.group },
    body: { confirmed: false }
  }).success, false);
  assert.equal(removeOwnInviteMembershipSchema.safeParse({
    params: { id: IDS.invite },
    body: { confirmed: true }
  }).success, true);
  assert.equal(removeContactInviteSchema.safeParse({
    params: { id: IDS.self, inviteId: IDS.invite },
    body: { confirmed: true }
  }).success, true);
});
