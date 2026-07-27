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

function webIdentityFixture(overrides = {}) {
  const address = overrides.address || '551131234567@c.us';
  return {
    _id: '507f1f77bcf86cd799439013',
    channel: 'whatsapp_web',
    addressEncrypted: encrypt(address),
    addressHash: searchHash(address),
    authorized: false,
    consentStatus: 'unknown',
    source: 'whatsapp_web_message',
    metadataEncrypted: encrypt({ chatId: address }),
    ...overrides
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
        permissionCommandReceivedVia: 'whatsapp_web',
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

for (const scenario of [
  {
    label: 'WhatsApp Web',
    sourceChannel: 'whatsapp_web',
    address: '551131234567@c.us',
    source: 'whatsapp_web_permission_command'
  },
  {
    label: 'WhatsApp Cloud',
    sourceChannel: 'whatsapp_cloud',
    address: '551131234567',
    source: 'whatsapp_cloud_permission_command'
  }
]) {
  test(`comando via ${scenario.label} concede Web e Cloud com proveniencia compartilhada`, async (context) => {
    const originals = {
      findOne: Contact.findOne,
      findById: Contact.findById,
      consent: ConsentEvent.create
    };
    context.after(() => {
      Contact.findOne = originals.findOne;
      Contact.findById = originals.findById;
      ConsentEvent.create = originals.consent;
    });
    const contact = contactFixture([webIdentityFixture(), identityFixture()]);
    Contact.findOne = () => selected(contact);
    Contact.findById = () => selected(contact);
    const audits = [];
    ConsentEvent.create = async (input) => { audits.push(input); return input; };

    const result = await contactsManager.upsertFromChannel({
      channel: scenario.sourceChannel,
      address: scenario.address,
      phone: '551131234567',
      displayName: 'Samuel',
      source: scenario.source,
      authorize: true,
      consentStatus: 'granted',
      consentSource: 'automatic_permission_command',
      consentCommand: '/notify-me',
      consentEvidence: { providerMessageId: `command-${scenario.sourceChannel}` },
      shareWhatsappConsent: true,
      metadata: { permissionCommandReceived: true }
    });

    assert.deepEqual(result.channels.map((identity) => [
      identity.channel,
      identity.authorized,
      identity.consentStatus,
      identity.consentSource,
      identity.consentCommand,
      identity.metadata.permissionCommandReceivedVia,
      identity.metadata.sharedWhatsappConsent
    ]).sort(), [
      ['whatsapp_cloud', true, 'granted', 'automatic_permission_command', '/notify-me', scenario.sourceChannel, true],
      ['whatsapp_web', true, 'granted', 'automatic_permission_command', '/notify-me', scenario.sourceChannel, true]
    ]);
    assert.deepEqual(audits.map((event) => event.channel).sort(), ['whatsapp_cloud', 'whatsapp_web']);
    assert.ok(audits.every((event) => event.source === 'automatic_permission_command'));
    assert.ok(audits.every((event) => decrypt(event.evidenceEncrypted, { json: true }).receivedVia === scenario.sourceChannel));
    assert.deepEqual(result.pendingWhatsappConsents, []);
  });
}

test('canal ausente recebe grant pendente sem destino inventado e o consome ao ser identificado', async (context) => {
  const originals = {
    findOne: Contact.findOne,
    findById: Contact.findById,
    consent: ConsentEvent.create
  };
  context.after(() => {
    Contact.findOne = originals.findOne;
    Contact.findById = originals.findById;
    ConsentEvent.create = originals.consent;
  });
  const contact = contactFixture(webIdentityFixture());
  Contact.findOne = () => selected(contact);
  Contact.findById = () => selected(contact);
  const audits = [];
  ConsentEvent.create = async (input) => { audits.push(input); return input; };

  const commandResult = await contactsManager.upsertFromChannel({
    channel: 'whatsapp_web',
    address: '551131234567@c.us',
    phone: '551131234567',
    displayName: 'Samuel',
    source: 'whatsapp_web_permission_command',
    authorize: true,
    consentStatus: 'granted',
    consentSource: 'automatic_permission_command',
    consentCommand: '/notify-me',
    consentEvidence: { providerMessageId: 'wweb-command' },
    shareWhatsappConsent: true
  });

  assert.equal(commandResult.channels.length, 1);
  assert.equal(commandResult.channels[0].authorized, true);
  assert.deepEqual(commandResult.pendingWhatsappConsents.map((item) => ({
    channel: item.channel,
    status: item.status,
    sourceChannel: item.sourceChannel,
    command: item.command
  })), [{
    channel: 'whatsapp_cloud',
    status: 'granted',
    sourceChannel: 'whatsapp_web',
    command: '/notify-me'
  }]);
  assert.equal(contact.channels.some((identity) => identity.channel === 'whatsapp_cloud'), false);
  const pendingAudit = audits.find((event) => event.channel === 'whatsapp_cloud');
  assert.equal(decrypt(pendingAudit.evidenceEncrypted, { json: true }).stage, 'pending_identity');

  const discovered = await contactsManager.upsertFromChannel({
    channel: 'whatsapp_cloud',
    address: '551131234567',
    phone: '551131234567',
    displayName: 'Samuel',
    source: 'whatsapp_cloud_webhook',
    metadata: { waId: '551131234567' }
  });

  const cloud = discovered.channels.find((identity) => identity.channel === 'whatsapp_cloud');
  assert.equal(cloud.address, '551131234567');
  assert.equal(cloud.authorized, true);
  assert.equal(cloud.consentStatus, 'granted');
  assert.equal(cloud.consentSource, 'automatic_permission_command');
  assert.equal(cloud.metadata.permissionCommandReceivedVia, 'whatsapp_web');
  assert.deepEqual(discovered.pendingWhatsappConsents, []);
  const propagationAudit = audits.filter((event) => event.channel === 'whatsapp_cloud')[1];
  assert.equal(decrypt(propagationAudit.evidenceEncrypted, { json: true }).propagatedAfterIdentityDiscovery, true);
});

test('administrador revoga somente um provedor WhatsApp depois do opt-in compartilhado', async (context) => {
  const originals = { findById: Contact.findById, consent: ConsentEvent.create };
  context.after(() => {
    Contact.findById = originals.findById;
    ConsentEvent.create = originals.consent;
  });
  const granted = {
    authorized: true,
    consentStatus: 'granted',
    consentSource: 'automatic_permission_command',
    consentCommand: '/notify-me',
    metadataEncrypted: encrypt({ sharedWhatsappConsent: true, permissionCommandReceivedVia: 'whatsapp_web' })
  };
  const web = webIdentityFixture(granted);
  const cloud = identityFixture(granted);
  const contact = contactFixture([web, cloud]);
  Contact.findById = () => selected(contact);
  const audits = [];
  ConsentEvent.create = async (input) => { audits.push(input); return input; };

  const result = await contactsManager.setChannelConsent(contact._id, 'whatsapp_cloud', 'revoked', {
    source: 'admin_manual',
    actorId: '507f1f77bcf86cd799439099',
    evidence: { confirmed: true }
  });

  const webResult = result.channels.find((identity) => identity.channel === 'whatsapp_web');
  const cloudResult = result.channels.find((identity) => identity.channel === 'whatsapp_cloud');
  assert.equal(webResult.authorized, true);
  assert.equal(webResult.consentStatus, 'granted');
  assert.equal(cloudResult.authorized, false);
  assert.equal(cloudResult.consentStatus, 'revoked');
  assert.equal(cloudResult.consentSource, 'admin_manual');
  assert.deepEqual(audits.map((event) => [event.channel, event.status]), [['whatsapp_cloud', 'revoked']]);
});

test('administrador revoga separadamente o grant Cloud pendente sem identidade sintetica', async (context) => {
  const originals = { findById: Contact.findById, consent: ConsentEvent.create };
  context.after(() => {
    Contact.findById = originals.findById;
    ConsentEvent.create = originals.consent;
  });
  const web = webIdentityFixture({
    authorized: true,
    consentStatus: 'granted',
    consentSource: 'automatic_permission_command',
    consentCommand: '/notify-me',
    metadataEncrypted: encrypt({ sharedWhatsappConsent: true, permissionCommandReceivedVia: 'whatsapp_web' })
  });
  const contact = contactFixture(web);
  contact.pendingWhatsappConsents = [{
    channel: 'whatsapp_cloud',
    sourceChannel: 'whatsapp_web',
    status: 'granted',
    source: 'automatic_permission_command',
    command: '/notify-me',
    evidenceEncrypted: encrypt({ providerMessageId: 'wweb-command' }),
    createdAt: new Date('2026-07-21T14:00:00.000Z')
  }];
  Contact.findById = () => selected(contact);
  const audits = [];
  ConsentEvent.create = async (input) => { audits.push(input); return input; };

  const result = await contactsManager.setChannelConsent(contact._id, 'whatsapp_cloud', 'revoked', {
    source: 'admin_manual',
    actorId: '507f1f77bcf86cd799439099',
    evidence: { confirmed: true }
  });

  assert.equal(result.channels.length, 1);
  assert.equal(result.channels[0].channel, 'whatsapp_web');
  assert.equal(result.channels[0].authorized, true);
  assert.equal(result.pendingWhatsappConsents.length, 1);
  assert.equal(result.pendingWhatsappConsents[0].channel, 'whatsapp_cloud');
  assert.equal(result.pendingWhatsappConsents[0].status, 'revoked');
  assert.equal(result.pendingWhatsappConsents[0].source, 'admin_manual');
  assert.notEqual(result.pendingWhatsappConsents[0].status, 'granted');
  assert.deepEqual(audits.map((event) => [event.channel, event.status]), [['whatsapp_cloud', 'revoked']]);
});
