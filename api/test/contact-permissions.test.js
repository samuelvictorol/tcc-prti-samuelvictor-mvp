const test = require('node:test');
const assert = require('node:assert/strict');
const Contact = require('../src/models/contact.model');
const ConsentEvent = require('../src/models/consent-event.model');
const contactsManager = require('../src/managers/contacts.manager');
const { encrypt, decrypt, searchHash } = require('../src/services/crypto.service');

function selected(value) {
  return { select: async () => value };
}

function contactFixture(identity) {
  return {
    _id: '507f1f77bcf86cd799439011',
    displayNameEncrypted: encrypt('Samuel'),
    displayNameHash: searchHash('samuel'),
    displayNameSource: 'whatsapp_cloud',
    phoneEncrypted: encrypt('551131234567'),
    phoneHash: searchHash('551131234567'),
    channelAvatars: [],
    channels: Array.isArray(identity) ? identity : [identity],
    pendingWhatsappConsents: [],
    tags: [],
    active: true,
    notificationDisabled: false,
    async save() {},
    toObject() { return { ...this }; }
  };
}

function identityFixture(overrides = {}) {
  const address = overrides.address || '551131234567';
  return {
    _id: '507f1f77bcf86cd799439012',
    channel: 'whatsapp_cloud',
    addressEncrypted: encrypt(address),
    addressHash: searchHash(address),
    authorized: false,
    consentStatus: 'unknown',
    source: 'whatsapp_cloud_webhook',
    metadataEncrypted: encrypt({ waId: address }),
    ...overrides
  };
}

test('cadastro manual sempre cria identidade unknown e remove proveniencia reservada', async (context) => {
  const originals = {
    create: Contact.create,
    findById: Contact.findById,
    consent: ConsentEvent.create
  };
  context.after(() => {
    Contact.create = originals.create;
    Contact.findById = originals.findById;
    ConsentEvent.create = originals.consent;
  });
  let stored;
  Contact.create = async (values) => {
    stored = contactFixture(values.channels[0]);
    return stored;
  };
  Contact.findById = () => selected(stored);
  ConsentEvent.create = async () => assert.fail('cadastro manual nao deve auditar consentimento inexistente');

  const result = await contactsManager.create({
    displayName: 'Samuel',
    channels: [{
      channel: 'whatsapp_cloud',
      address: '551131234567',
      authorized: true,
      consentStatus: 'granted',
      source: 'automatic_permission_command',
      consentSource: 'forjado',
      consentCommand: '/forjado',
      metadata: {
        note: 'visivel',
        consentSource: 'forjado',
        permissionCommandReceived: true,
        permissionCommandReceivedVia: 'whatsapp_cloud',
        sharedWhatsappConsent: true,
        autoRegisteredVia: 'whatsapp_cloud'
      }
    }]
  }, '507f1f77bcf86cd799439099');

  assert.equal(result.channels[0].authorized, false);
  assert.equal(result.channels[0].consentStatus, 'unknown');
  assert.equal(result.channels[0].source, 'manual');
  assert.deepEqual(result.channels[0].metadata, { note: 'visivel' });
  assert.equal(result.channels[0].consentSource, null);
  assert.equal(result.channels[0].consentCommand, null);
});

test('criacao automatica nao efetiva grant se auditoria falhar e retry consegue auditar', async (context) => {
  const originals = {
    findOne: Contact.findOne,
    create: Contact.create,
    consent: ConsentEvent.create
  };
  context.after(() => {
    Contact.findOne = originals.findOne;
    Contact.create = originals.create;
    ConsentEvent.create = originals.consent;
  });
  let stored = null;
  let saves = 0;
  Contact.findOne = () => selected(stored);
  Contact.create = async (values) => {
    stored = contactFixture(values.channels[0]);
    stored.save = async () => { saves += 1; };
    return stored;
  };
  let auditAttempts = 0;
  ConsentEvent.create = async (input) => {
    auditAttempts += 1;
    if (auditAttempts === 1) throw new Error('auditoria indisponivel');
    return { _id: '507f1f77bcf86cd799439088', ...input };
  };
  const input = {
    channel: 'whatsapp_cloud',
    address: '551131234567',
    displayName: 'Samuel',
    source: 'whatsapp_cloud_permission_command',
    authorize: true,
    consentStatus: 'granted',
    consentSource: 'automatic_permission_command',
    consentCommand: '/notify-me',
    consentEvidence: { providerMessageId: 'wamid.retry' }
  };

  await assert.rejects(() => contactsManager.upsertFromChannel(input), /auditoria indisponivel/);
  assert.equal(stored.channels[0].authorized, false);
  assert.equal(stored.channels[0].consentStatus, 'unknown');
  assert.equal(saves, 0);

  const retried = await contactsManager.upsertFromChannel(input);
  assert.equal(retried.channels[0].authorized, true);
  assert.equal(retried.channels[0].consentStatus, 'granted');
  assert.equal(auditAttempts, 2);
  assert.equal(saves, 1);
});

test('inbound comum preserva proveniencia do comando e mescla metadata do provedor', async (context) => {
  const originals = { findOne: Contact.findOne, consent: ConsentEvent.create };
  context.after(() => {
    Contact.findOne = originals.findOne;
    ConsentEvent.create = originals.consent;
  });
  const changedAt = new Date('2026-07-21T12:00:00.000Z');
  const identity = identityFixture({
    authorized: true,
    consentStatus: 'granted',
    source: 'whatsapp_cloud_permission_command',
    consentSource: 'automatic_permission_command',
    consentCommand: '/notify-me',
    consentChangedAt: changedAt,
    consentChangedBy: null,
    metadataEncrypted: encrypt({ waId: '551131234567', permissionCommandReceived: true })
  });
  const contact = contactFixture(identity);
  Contact.findOne = () => selected(contact);
  let audits = 0;
  ConsentEvent.create = async () => { audits += 1; };

  const result = await contactsManager.upsertFromChannel({
    channel: 'whatsapp_cloud',
    address: '551131234567',
    phone: '551131234567',
    displayName: 'Samuel atualizado',
    source: 'whatsapp_cloud_webhook',
    authorize: false,
    metadata: { messageType: 'text' }
  });

  assert.equal(result.channels[0].source, 'whatsapp_cloud_permission_command');
  assert.equal(result.channels[0].consentSource, 'automatic_permission_command');
  assert.equal(result.channels[0].consentCommand, '/notify-me');
  assert.equal(new Date(result.channels[0].consentChangedAt).toISOString(), changedAt.toISOString());
  assert.equal(result.channels[0].metadata.permissionCommandReceived, true);
  assert.equal(result.channels[0].metadata.messageType, 'text');
  assert.equal(audits, 0);
});

test('comando promove identidade unknown uma unica vez e registra evidencia', async (context) => {
  const originals = { findOne: Contact.findOne, consent: ConsentEvent.create };
  context.after(() => {
    Contact.findOne = originals.findOne;
    ConsentEvent.create = originals.consent;
  });
  const identity = identityFixture();
  const contact = contactFixture(identity);
  Contact.findOne = () => selected(contact);
  const audits = [];
  ConsentEvent.create = async (input) => { audits.push(input); return input; };

  await contactsManager.upsertFromChannel({
    channel: 'whatsapp_cloud',
    address: '551131234567',
    phone: '551131234567',
    source: 'whatsapp_cloud_permission_command',
    authorize: true,
    consentStatus: 'granted',
    consentSource: 'automatic_permission_command',
    consentCommand: '/notify-me',
    consentEvidence: { providerMessageId: 'wamid.permission' }
  });
  const firstChangedAt = identity.consentChangedAt;
  await contactsManager.upsertFromChannel({
    channel: 'whatsapp_cloud',
    address: '551131234567',
    phone: '551131234567',
    source: 'whatsapp_cloud_permission_command',
    authorize: true,
    consentStatus: 'granted',
    consentSource: 'automatic_permission_command',
    consentCommand: '/notify-me',
    consentEvidence: { providerMessageId: 'wamid.permission-replay' }
  });

  assert.equal(identity.authorized, true);
  assert.equal(identity.consentStatus, 'granted');
  assert.equal(identity.source, 'whatsapp_cloud_webhook');
  assert.equal(identity.consentSource, 'automatic_permission_command');
  assert.equal(identity.consentCommand, '/notify-me');
  assert.equal(identity.consentChangedAt, firstChangedAt);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].source, 'automatic_permission_command');
  assert.deepEqual(decrypt(audits[0].evidenceEncrypted, { json: true }), { providerMessageId: 'wamid.permission' });
});

test('PUT generico nao altera consentimento nem permite forjar sua origem', async (context) => {
  const original = Contact.findById;
  context.after(() => { Contact.findById = original; });
  const address = '551131234567';
  const identity = identityFixture({
    authorized: true,
    consentStatus: 'granted',
    source: 'whatsapp_cloud_permission_command',
    consentSource: 'automatic_permission_command',
    consentCommand: '/notify-me',
    consentChangedAt: new Date('2026-07-21T12:00:00.000Z'),
    metadataEncrypted: encrypt({
      waId: '551131234567',
      consentSource: 'automatic_permission_command',
      permissionCommandReceived: true,
      autoRegisteredVia: 'whatsapp_cloud'
    })
  });
  const contact = contactFixture(identity);
  Contact.findById = () => selected(contact);

  await assert.rejects(
    () => contactsManager.update(contact._id, {
      channels: [{ channel: 'whatsapp_cloud', address, authorized: false, consentStatus: 'revoked' }]
    }),
    (error) => error.code === 'CONSENT_UPDATE_REQUIRES_ENDPOINT'
  );

  const result = await contactsManager.update(contact._id, {
    channels: [{
      channel: 'whatsapp_cloud', address, authorized: true, consentStatus: 'granted',
      source: 'admin_forjado', consentSource: 'admin_forjado', consentCommand: '/outro',
      metadata: {
        note: 'editado',
        consentSource: 'admin_forjado',
        consentChangedByAdmin: true,
        permissionCommandReceived: false,
        autoRegisteredVia: 'manual'
      }
    }]
  });
  assert.equal(result.channels[0].source, 'whatsapp_cloud_permission_command');
  assert.equal(result.channels[0].consentSource, 'automatic_permission_command');
  assert.equal(result.channels[0].consentCommand, '/notify-me');
  assert.equal(result.channels[0].metadata.note, 'editado');
  assert.equal(result.channels[0].metadata.consentSource, 'automatic_permission_command');
  assert.equal(result.channels[0].metadata.permissionCommandReceived, true);
  assert.equal(result.channels[0].metadata.autoRegisteredVia, 'whatsapp_cloud');
  assert.equal(result.channels[0].metadata.consentChangedByAdmin, undefined);
});

test('grant manual falha fechado antes do save e retry efetiva somente depois da auditoria', async (context) => {
  const originals = { findById: Contact.findById, consent: ConsentEvent.create };
  context.after(() => {
    Contact.findById = originals.findById;
    ConsentEvent.create = originals.consent;
  });
  let saves = 0;
  const identity = identityFixture();
  const contact = contactFixture(identity);
  contact.save = async () => { saves += 1; };
  Contact.findById = () => selected(contact);
  let auditAttempts = 0;
  ConsentEvent.create = async (input) => {
    auditAttempts += 1;
    if (auditAttempts === 1) throw new Error('falha no audit grant');
    return input;
  };

  await assert.rejects(
    () => contactsManager.setChannelConsent(contact._id, 'whatsapp_cloud', 'granted', { source: 'admin_manual' }),
    /falha no audit grant/
  );
  assert.equal(identity.authorized, false);
  assert.equal(identity.consentStatus, 'unknown');
  assert.equal(saves, 0);

  const retried = await contactsManager.setChannelConsent(contact._id, 'whatsapp_cloud', 'granted', { source: 'admin_manual' });
  assert.equal(retried.channels[0].authorized, true);
  assert.equal(retried.channels[0].consentStatus, 'granted');
  assert.equal(auditAttempts, 2);
  assert.equal(saves, 1);
});

test('revoke manual permanece bloqueado se auditoria falhar e retry audita sem nova mudanca', async (context) => {
  const originals = { findById: Contact.findById, consent: ConsentEvent.create };
  context.after(() => {
    Contact.findById = originals.findById;
    ConsentEvent.create = originals.consent;
  });
  let saves = 0;
  const identity = identityFixture({ authorized: true, consentStatus: 'granted' });
  const contact = contactFixture(identity);
  contact.save = async () => { saves += 1; };
  Contact.findById = () => selected(contact);
  let auditAttempts = 0;
  ConsentEvent.create = async (input) => {
    auditAttempts += 1;
    if (auditAttempts === 1) throw new Error('falha no audit revoke');
    return input;
  };

  await assert.rejects(
    () => contactsManager.setChannelConsent(contact._id, 'whatsapp_cloud', 'revoked', { source: 'admin_manual' }),
    /falha no audit revoke/
  );
  assert.equal(identity.authorized, false);
  assert.equal(identity.consentStatus, 'revoked');
  assert.equal(saves, 1);

  const retried = await contactsManager.setChannelConsent(contact._id, 'whatsapp_cloud', 'revoked', { source: 'admin_manual' });
  assert.equal(retried.channels[0].authorized, false);
  assert.equal(retried.channels[0].consentStatus, 'revoked');
  assert.equal(auditAttempts, 2);
  assert.equal(saves, 1);
});

test('alteracao manual persiste ator e origem na identidade e no evento', async (context) => {
  const originals = { findById: Contact.findById, consent: ConsentEvent.create };
  context.after(() => {
    Contact.findById = originals.findById;
    ConsentEvent.create = originals.consent;
  });
  const actorId = '507f1f77bcf86cd799439099';
  const identity = identityFixture();
  const contact = contactFixture(identity);
  Contact.findById = () => selected(contact);
  let audit;
  ConsentEvent.create = async (input) => { audit = input; return input; };

  const result = await contactsManager.setChannelConsent(contact._id, 'whatsapp_cloud', 'granted', {
    source: 'admin_manual',
    actorId,
    evidence: { confirmed: true }
  });

  assert.equal(result.channels[0].authorized, true);
  assert.equal(result.channels[0].consentStatus, 'granted');
  assert.equal(result.channels[0].consentSource, 'admin_manual');
  assert.equal(result.channels[0].consentChangedBy, actorId);
  assert.ok(result.channels[0].consentChangedAt);
  assert.equal(audit.source, 'admin_manual');
  assert.equal(String(audit.actor), actorId);
});

test('administrador autenticado concede Telegram somente sobre identidade real do bot', async (context) => {
  const originals = { findById: Contact.findById, consent: ConsentEvent.create };
  context.after(() => {
    Contact.findById = originals.findById;
    ConsentEvent.create = originals.consent;
  });
  const actorId = '507f1f77bcf86cd799439099';
  const identity = identityFixture({
    channel: 'telegram',
    addressEncrypted: encrypt('987654321'),
    addressHash: searchHash('987654321'),
    source: 'telegram_webhook',
    metadataEncrypted: encrypt({ chatId: '987654321', userId: '987654321' })
  });
  const contact = contactFixture(identity);
  Contact.findById = () => selected(contact);
  let audit;
  ConsentEvent.create = async (input) => { audit = input; return input; };

  const result = await contactsManager.setChannelConsent(contact._id, 'telegram', 'granted', {
    source: 'admin_manual',
    actorId
  });

  assert.equal(result.channels[0].authorized, true);
  assert.equal(result.channels[0].consentStatus, 'granted');
  assert.equal(result.channels[0].consentSource, 'admin_manual');
  assert.equal(result.channels[0].consentChangedBy, actorId);
  assert.equal(audit.channel, 'telegram');
  assert.equal(audit.source, 'admin_manual');
  assert.equal(String(audit.actor), actorId);
});

test('grant manual do Telegram continua bloqueado sem ator administrativo autenticado', async () => {
  await assert.rejects(
    () => contactsManager.setChannelConsent(
      '507f1f77bcf86cd799439011',
      'telegram',
      'granted',
      { source: 'admin_manual' }
    ),
    (error) => error.statusCode === 403 && error.code === 'PROVIDER_CONSENT_MANAGED'
  );
});
