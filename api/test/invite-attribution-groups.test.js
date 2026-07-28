const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Invite = require('../src/models/invite.model');
const InviteClick = require('../src/models/invite-click.model');
const Contact = require('../src/models/contact.model');
const ContactGroup = require('../src/models/contact-group.model');
const invitesManager = require('../src/managers/invites.manager');
const contactsManager = require('../src/managers/contacts.manager');
const groupsManager = require('../src/managers/groups.manager');
const { listContactsSchema } = require('../src/dtos/contacts.dto');
const {
  listGroupsSchema,
  syncInviteGroupsSchema,
  syncExistingGroupInviteSchema
} = require('../src/dtos/groups.dto');

const inviteIdA = new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');
const inviteIdB = new mongoose.Types.ObjectId('507f1f77bcf86cd799439012');
const contactIdA = new mongoose.Types.ObjectId('507f1f77bcf86cd799439021');
const contactIdB = new mongoose.Types.ObjectId('507f1f77bcf86cd799439022');
const sharedContactId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439023');
const manualContactId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439024');

test('marcador de convite cabe no start Telegram, detecta adulteracao e substitui o start padrao', () => {
  const marker = invitesManager.createAttributionMarker(inviteIdA, 'campanha-verao-promocional');
  assert.equal(marker.startsWith('campanha-ver'), true);
  assert.equal(marker.length <= 48, true);
  assert.equal(invitesManager.parseAttributionMarker(marker)?.inviteId, String(inviteIdA));
  const sixCharacterSlug = invitesManager.createAttributionMarker(inviteIdA, 'evento');
  assert.equal(sixCharacterSlug.startsWith('evento_'), true);

  const last = marker.at(-1);
  const tampered = marker.slice(0, -1) + (last === 'A' ? 'B' : 'A');
  assert.equal(invitesManager.parseAttributionMarker(tampered), null);

  const standard = new URL(invitesManager.telegramInviteRedirectUrlWithAttribution(
    'https://t.me/Bot?start=notify-me',
    '/notify-me',
    marker
  ));
  assert.equal(standard.searchParams.get('start'), marker);

  const dynamic = new URL(invitesManager.telegramInviteRedirectUrlWithAttribution(
    'https://t.me/Bot?start=quero-alertas',
    '/quero-alertas',
    marker
  ));
  assert.equal(dynamic.searchParams.get('start'), marker);

  const custom = new URL(invitesManager.telegramInviteRedirectUrlWithAttribution(
    'https://t.me/Bot?start=campanha-custom',
    '/notify-me',
    marker
  ));
  assert.equal(custom.searchParams.get('start'), 'campanha-custom');
});

test('link WhatsApp acrescenta comando e marcador somente em texto controlado pelo app', () => {
  const marker = invitesManager.createAttributionMarker(inviteIdA);
  const standard = new URL(invitesManager.whatsappInviteRedirectUrl(
    'https://wa.me/5561999999999?text=%2Fnotify-me',
    '/notify-me',
    marker
  ));
  assert.equal(standard.searchParams.get('text'), `/notify-me ${marker}`);

  const custom = new URL(invitesManager.whatsappInviteRedirectUrl(
    'https://wa.me/5561999999999?text=Quero%20falar%20com%20vendas',
    '/notify-me',
    marker
  ));
  assert.equal(custom.searchParams.get('text'), 'Quero falar com vendas');
});

test('claim de atribuicao e atomico: replay e idempotente no vencedor e recusado para outro contato', async (context) => {
  const originals = {
    clickFindOne: InviteClick.findOne,
    clickUpdateOne: InviteClick.updateOne,
    clickFindById: InviteClick.findById,
    inviteFindOne: Invite.findOne,
    attachInviteOrigin: contactsManager.attachInviteOrigin,
    addContactForInvite: groupsManager.addContactForInvite
  };
  context.after(() => {
    InviteClick.findOne = originals.clickFindOne;
    InviteClick.updateOne = originals.clickUpdateOne;
    InviteClick.findById = originals.clickFindById;
    Invite.findOne = originals.inviteFindOne;
    contactsManager.attachInviteOrigin = originals.attachInviteOrigin;
    groupsManager.addContactForInvite = originals.addContactForInvite;
  });

  const marker = invitesManager.createAttributionMarker(inviteIdA);
  const clickId = new mongoose.Types.ObjectId();
  const invite = { _id: inviteIdA, title: 'Convite A', slug: 'convite-a', active: true };
  let owner = null;
  const attached = [];

  InviteClick.findOne = () => ({
    lean: async () => ({ _id: clickId, invite: inviteIdA, contact: owner, clickedAt: new Date() })
  });
  Invite.findOne = () => ({ lean: async () => invite });
  InviteClick.updateOne = async (_filter, update) => {
    const requestedOwner = String(update.$set.contact);
    if (owner === null || String(owner) === requestedOwner) {
      owner = requestedOwner;
      return { matchedCount: 1, modifiedCount: 1 };
    }
    return { matchedCount: 0, modifiedCount: 0 };
  };
  InviteClick.findById = () => ({
    select() { return this; },
    lean: async () => ({ contact: owner })
  });
  contactsManager.attachInviteOrigin = async (contactId) => {
    attached.push(String(contactId));
    return { id: String(contactId) };
  };
  groupsManager.addContactForInvite = async () => ({ matched: false, added: false });

  const [first, second] = await Promise.all([
    invitesManager.attributeContactFromMarker(contactIdA, marker, 'telegram'),
    invitesManager.attributeContactFromMarker(contactIdB, marker, 'whatsapp_cloud')
  ]);
  const winnerId = first ? String(contactIdA) : String(contactIdB);
  const loserId = first ? String(contactIdB) : String(contactIdA);
  assert.equal(Boolean(first) !== Boolean(second), true);
  assert.equal(owner, winnerId);
  assert.deepEqual(attached, [winnerId]);

  assert.ok(await invitesManager.attributeContactFromMarker(winnerId, marker, 'telegram'));
  assert.equal(await invitesManager.attributeContactFromMarker(loserId, marker, 'telegram'), null);
});

test('origens do contato sao deduplicadas e acumulam canais de uso', async (context) => {
  const originals = { updateOne: Contact.updateOne, findById: Contact.findById };
  context.after(() => {
    Contact.updateOne = originals.updateOne;
    Contact.findById = originals.findById;
  });
  const origins = [];
  Contact.updateOne = async (filter, update) => {
    const originIndex = origins.findIndex((origin) => String(origin.invite) === String(inviteIdA));
    if (filter['inviteOrigins.invite']?.$ne) {
      if (originIndex >= 0) return { matchedCount: 0, modifiedCount: 0 };
      origins.push({ ...update.$push.inviteOrigins, channels: [...update.$push.inviteOrigins.channels] });
      return { matchedCount: 1, modifiedCount: 1 };
    }
    if (originIndex < 0) return { matchedCount: 0, modifiedCount: 0 };
    Object.assign(origins[originIndex], {
      title: update.$set['inviteOrigins.$.title'],
      slug: update.$set['inviteOrigins.$.slug'],
      lastUsedAt: update.$max['inviteOrigins.$.lastUsedAt']
    });
    const channel = update.$addToSet?.['inviteOrigins.$.channels'];
    if (channel && !origins[originIndex].channels.includes(channel)) origins[originIndex].channels.push(channel);
    return { matchedCount: 1, modifiedCount: 1 };
  };
  Contact.findById = () => ({
    select: async () => ({
      _id: contactIdA,
      channels: [],
      inviteOrigins: origins,
      active: true
    })
  });

  const invite = { _id: inviteIdA, title: 'Convite A', slug: 'convite-a' };
  await contactsManager.attachInviteOrigin(contactIdA, invite, { channel: 'telegram' });
  const contact = await contactsManager.attachInviteOrigin(contactIdA, invite, { channel: 'whatsapp_cloud' });

  assert.equal(contact.inviteOrigins.length, 1);
  assert.deepEqual(contact.inviteOrigins[0].channels.sort(), ['telegram', 'whatsapp_cloud']);
});

test('filtro por convite combina com a busca existente sem perder nenhum criterio', async (context) => {
  const originals = { find: Contact.find, countDocuments: Contact.countDocuments };
  context.after(() => {
    Contact.find = originals.find;
    Contact.countDocuments = originals.countDocuments;
  });
  let capturedFilter;
  Contact.find = (filter) => {
    capturedFilter = filter;
    const query = {
      select() { return query; },
      sort() { return query; },
      skip() { return query; },
      limit: async () => []
    };
    return query;
  };
  Contact.countDocuments = async () => 0;

  await contactsManager.list({ inviteId: String(inviteIdA), search: 'Samuel', page: 1, limit: 20 });
  assert.equal(capturedFilter['inviteOrigins.invite'], String(inviteIdA));
  assert.equal(Array.isArray(capturedFilter.$or), true);
  assert.equal(capturedFilter.$or.length > 0, true);
});

test('sync cria um grupo por convite, replica contatos multi-origem e nunca remove membros manuais', async (context) => {
  const originals = {
    inviteFind: Invite.find,
    contactFind: Contact.find,
    groupFindOne: ContactGroup.findOne,
    groupCreate: ContactGroup.create,
    groupFindByIdAndUpdate: ContactGroup.findByIdAndUpdate
  };
  context.after(() => {
    Invite.find = originals.inviteFind;
    Contact.find = originals.contactFind;
    ContactGroup.findOne = originals.groupFindOne;
    ContactGroup.create = originals.groupCreate;
    ContactGroup.findByIdAndUpdate = originals.groupFindByIdAndUpdate;
  });

  const invites = [
    { _id: inviteIdA, title: 'Convite A', slug: 'convite-a', active: true },
    { _id: inviteIdB, title: 'Convite B', slug: 'convite-b', active: true }
  ];
  const contactsByInvite = new Map([
    [String(inviteIdA), [contactIdA, sharedContactId]],
    [String(inviteIdB), [contactIdB, sharedContactId]]
  ]);
  const groups = new Map();

  Invite.find = (filter) => {
    const query = {
      sort() { return query; },
      lean: async () => filter._id?.$in
        ? invites.filter((invite) => filter._id.$in.map(String).includes(String(invite._id)))
        : invites
    };
    return query;
  };
  Contact.find = (filter) => ({
    select() { return this; },
    lean: async () => (contactsByInvite.get(String(filter['inviteOrigins.invite'])) || [])
      .map((_id) => ({ _id }))
  });
  ContactGroup.findOne = (filter) => ({
    select: async () => groups.get(String(filter.sourceInvite)) || null
  });
  ContactGroup.create = async (values) => {
    const group = { _id: new mongoose.Types.ObjectId(), ...values, contacts: [...values.contacts] };
    groups.set(String(values.sourceInvite), group);
    return group;
  };
  ContactGroup.findByIdAndUpdate = (id, update) => ({
    select: async () => {
      const group = [...groups.values()].find((item) => String(item._id) === String(id));
      Object.assign(group, update.$set || {});
      for (const contactId of update.$addToSet?.contacts?.$each || []) {
        if (!group.contacts.map(String).includes(String(contactId))) group.contacts.push(contactId);
      }
      return group;
    }
  });

  const first = await groupsManager.syncInviteGroups({
    inviteIds: [String(inviteIdA), String(inviteIdB)]
  });
  assert.equal(first.summary.groupsCreated, 2);
  assert.equal(groups.size, 2);
  assert.equal(groups.get(String(inviteIdA)).contacts.map(String).includes(String(sharedContactId)), true);
  assert.equal(groups.get(String(inviteIdB)).contacts.map(String).includes(String(sharedContactId)), true);

  groups.get(String(inviteIdA)).contacts.push(manualContactId);
  contactsByInvite.get(String(inviteIdA)).push(contactIdB);
  const second = await groupsManager.syncInviteGroups({ inviteIds: [String(inviteIdA)] });
  const finalMembers = groups.get(String(inviteIdA)).contacts.map(String);
  assert.equal(second.summary.groupsCreated, 0);
  assert.equal(second.summary.contactsAdded, 1);
  assert.equal(finalMembers.includes(String(manualContactId)), true);
  assert.equal(finalMembers.includes(String(contactIdB)), true);
});

test('manager rejeita sincronizacao sem convite selecionado antes de consultar o banco', async () => {
  await assert.rejects(
    groupsManager.syncInviteGroups({ inviteIds: [] }),
    (error) => error.statusCode === 422 && error.code === 'INVITE_SELECTION_REQUIRED'
  );
});

test('DTOs expoem filtro e sincronizacao amigavel sem aceitar payload arbitrario', () => {
  assert.equal(listContactsSchema.safeParse({
    query: { search: 'samuel', inviteId: String(inviteIdA) }
  }).success, true);
  assert.equal(listGroupsSchema.safeParse({
    query: { inviteId: String(inviteIdA) }
  }).success, true);
  assert.equal(syncInviteGroupsSchema.safeParse({
    body: { inviteIds: [String(inviteIdA), String(inviteIdB)] }
  }).success, true);
  assert.equal(syncInviteGroupsSchema.safeParse({
    body: { inviteIds: [] }
  }).success, false);
  assert.equal(syncInviteGroupsSchema.safeParse({
    body: { inviteIds: [], payload: { $where: 'true' } }
  }).success, false);
  assert.equal(syncExistingGroupInviteSchema.safeParse({
    params: { id: String(contactIdA) },
    body: { inviteId: String(inviteIdA) }
  }).success, true);
});
