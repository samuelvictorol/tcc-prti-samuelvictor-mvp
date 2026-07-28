const test = require('node:test');
const assert = require('node:assert/strict');

const Contact = require('../src/models/contact.model');
const ConsentEvent = require('../src/models/consent-event.model');
const contactsManager = require('../src/managers/contacts.manager');
const chatProfileFlow = require('../src/services/chat-profile-flow.service');
const { encrypt, decrypt, searchHash } = require('../src/services/crypto.service');

function restoreAfter(context, entries) {
  const originals = entries.map(([target, key]) => [target, key, target[key]]);
  context.after(() => {
    originals.forEach(([target, key, value]) => { target[key] = value; });
    chatProfileFlow.resetLocalStateForTests();
  });
}

function query(value) {
  return {
    select() { return Promise.resolve(value); }
  };
}

test('chat privado mostra o proprio perfil sem expor identificadores internos', async (context) => {
  restoreAfter(context, [[contactsManager, 'getById']]);
  contactsManager.getById = async () => ({
    id: '507f1f77bcf86cd799439011',
    displayName: 'Samuel',
    email: 'samuel@example.test',
    phone: '5561999999999',
    telegramUsername: 'samuel',
    channels: [
      { channel: 'whatsapp_cloud', authorized: true, consentStatus: 'granted' },
      { channel: 'telegram', authorized: true, consentStatus: 'granted' },
      { channel: 'email', authorized: false, consentStatus: 'revoked' }
    ]
  });

  const result = await chatProfileFlow.handleInbound({
    contactId: '507f1f77bcf86cd799439011',
    channel: 'telegram',
    text: '/meu-perfil',
    profileUrl: 'https://notify.example/meu-perfil'
  });

  assert.equal(result.handled, true);
  assert.equal(result.kind, 'profile');
  assert.match(result.text, /Samuel/);
  assert.match(result.text, /samuel@example\.test/);
  assert.match(result.text, /WhatsApp: permitido/);
  assert.match(result.text, /somente o email/i);
  assert.match(result.text, /https:\/\/notify\.example\/meu-perfil/);
  assert.doesNotMatch(result.text, /507f1f77bcf86cd799439011/);
});

test('resumo considera o consentimento efetivo quando ha mais de uma identidade no canal', () => {
  const summary = chatProfileFlow.profileSummary({
    displayName: 'Samuel',
    channels: [
      {
        channel: 'whatsapp_cloud',
        authorized: false,
        consentStatus: 'revoked',
        consentChangedAt: new Date('2026-07-28T10:00:00Z')
      },
      {
        channel: 'whatsapp_cloud',
        authorized: true,
        consentStatus: 'granted',
        consentChangedAt: new Date('2026-07-27T10:00:00Z')
      }
    ]
  });

  assert.match(summary, /WhatsApp: permitido/);
});

test('captura temporaria aceita email valido e permanece ativa apos valor invalido', async (context) => {
  restoreAfter(context, [[contactsManager, 'setEmailFromChat']]);
  const updates = [];
  contactsManager.setEmailFromChat = async (contactId, email, options) => {
    updates.push({ contactId, email, options });
    return { id: contactId, email };
  };
  const contactId = '507f1f77bcf86cd799439012';
  await chatProfileFlow.beginEmailCapture(contactId, 'whatsapp_cloud');
  await chatProfileFlow.beginEmailCapture(contactId, 'telegram');

  const invalid = await chatProfileFlow.handleInbound({
    contactId,
    channel: 'whatsapp_cloud',
    text: 'email-invalido'
  });
  assert.equal(invalid.kind, 'email_invalid');
  assert.equal(await chatProfileFlow.pendingEmailCapture(contactId, 'whatsapp_cloud'), true);

  const valid = await chatProfileFlow.handleInbound({
    contactId,
    channel: 'whatsapp_cloud',
    text: ' Samuel@Example.Test '
  });
  assert.equal(valid.kind, 'email_updated');
  assert.deepEqual(updates, [{
    contactId,
    email: 'Samuel@Example.Test',
    options: { channel: 'whatsapp_cloud' }
  }]);
  assert.equal(await chatProfileFlow.pendingEmailCapture(contactId, 'whatsapp_cloud'), false);
  assert.equal(await chatProfileFlow.pendingEmailCapture(contactId, 'telegram'), false);
});

test('captura nao vincula automaticamente email pertencente a outro perfil', async (context) => {
  restoreAfter(context, [[contactsManager, 'setEmailFromChat']]);
  contactsManager.setEmailFromChat = async () => {
    const error = new Error('conflito');
    error.code = 'EMAIL_OWNERSHIP_VERIFICATION_REQUIRED';
    throw error;
  };
  const contactId = '507f1f77bcf86cd799439013';
  await chatProfileFlow.beginEmailCapture(contactId, 'telegram');

  const result = await chatProfileFlow.handleInbound({
    contactId,
    channel: 'telegram',
    text: 'existente@example.test'
  });

  assert.equal(result.kind, 'email_conflict');
  assert.match(result.text, /proteger seus dados/i);
  assert.equal(await chatProfileFlow.pendingEmailCapture(contactId, 'telegram'), true);
});

test('/cancelar limpa capturas do contato mesmo quando chegou pelo outro canal', async () => {
  const contactId = '507f1f77bcf86cd799439018';
  await chatProfileFlow.beginEmailCapture(contactId, 'telegram');

  const result = await chatProfileFlow.handleInbound({
    contactId,
    channel: 'whatsapp_cloud',
    text: '/cancelar'
  });

  assert.equal(result.kind, 'email_cancelled');
  assert.equal(await chatProfileFlow.pendingEmailCapture(contactId, 'telegram'), false);
});

test('setEmailFromChat cria identidade sem conceder consentimento e atualiza a mesma ficha', async (context) => {
  restoreAfter(context, [[Contact, 'findById'], [Contact, 'findOne']]);
  const contact = {
    _id: '507f1f77bcf86cd799439014',
    displayNameEncrypted: encrypt('Samuel'),
    displayNameHash: searchHash('samuel'),
    emailEncrypted: undefined,
    emailHash: undefined,
    phoneEncrypted: encrypt('5561999999999'),
    phoneHash: searchHash('5561999999999'),
    channels: [{
      channel: 'telegram',
      addressEncrypted: encrypt('445566'),
      addressHash: searchHash('445566'),
      authorized: true,
      consentStatus: 'granted',
      source: 'telegram_webhook',
      metadataEncrypted: encrypt({ chatId: '445566' })
    }],
    pendingWhatsappConsents: [],
    channelAvatars: [],
    tags: [],
    inviteOrigins: [],
    active: true,
    notificationDisabled: false,
    async save() { return this; }
  };
  Contact.findById = () => query(contact);
  let ownerFilter;
  Contact.findOne = (filter) => {
    ownerFilter = filter;
    return query(null);
  };

  const updated = await contactsManager.setEmailFromChat(
    contact._id,
    'Samuel@Example.Test',
    { channel: 'telegram' }
  );

  assert.equal(decrypt(contact.emailEncrypted), 'samuel@example.test');
  assert.equal(updated.email, 'samuel@example.test');
  const identity = contact.channels.find((item) => item.channel === 'email');
  assert.ok(identity);
  assert.equal(identity.authorized, false);
  assert.equal(identity.consentStatus, 'unknown');
  assert.equal(decrypt(identity.addressEncrypted), 'samuel@example.test');
  assert.deepEqual(ownerFilter.$or, [
    { emailHash: searchHash('samuel@example.test') },
    {
      channels: {
        $elemMatch: {
          channel: 'email',
          addressHash: searchHash('samuel@example.test')
        }
      }
    }
  ]);
});

test('setEmailFromChat exige validacao quando o email pertence a outro contato', async (context) => {
  restoreAfter(context, [[Contact, 'findById'], [Contact, 'findOne']]);
  const contact = {
    _id: '507f1f77bcf86cd799439015',
    displayNameEncrypted: encrypt('Samuel'),
    displayNameHash: searchHash('samuel'),
    channels: [],
    pendingWhatsappConsents: [],
    channelAvatars: [],
    tags: [],
    inviteOrigins: [],
    active: true,
    notificationDisabled: false,
    async save() { throw new Error('nao deve salvar'); }
  };
  Contact.findById = () => query(contact);
  Contact.findOne = () => query({ _id: '507f1f77bcf86cd799439099' });

  await assert.rejects(
    () => contactsManager.setEmailFromChat(contact._id, 'existente@example.test', { channel: 'telegram' }),
    (error) => error.code === 'EMAIL_OWNERSHIP_VERIFICATION_REQUIRED'
  );
});

test('trocar endereco de email nao transfere consentimento concedido ao endereco antigo', async (context) => {
  restoreAfter(context, [[Contact, 'findById'], [Contact, 'findOne'], [ConsentEvent, 'create']]);
  const contact = {
    _id: '507f1f77bcf86cd799439016',
    displayNameEncrypted: encrypt('Samuel'),
    displayNameHash: searchHash('samuel'),
    emailEncrypted: encrypt('antigo@example.test'),
    emailHash: searchHash('antigo@example.test'),
    channels: [{
      channel: 'email',
      addressEncrypted: encrypt('antigo@example.test'),
      addressHash: searchHash('antigo@example.test'),
      authorized: true,
      consentStatus: 'granted',
      source: 'self_service_profile_email',
      consentSource: 'self_service_profile_email',
      consentedAt: new Date(),
      metadataEncrypted: encrypt({})
    }],
    pendingWhatsappConsents: [],
    channelAvatars: [],
    tags: [],
    inviteOrigins: [],
    active: true,
    notificationDisabled: false,
    async save() { return this; }
  };
  Contact.findById = () => query(contact);
  Contact.findOne = () => query(null);
  const audits = [];
  ConsentEvent.create = async (input) => { audits.push(input); return input; };

  const updated = await contactsManager.setEmailFromChat(
    contact._id,
    'novo@example.test',
    { channel: 'whatsapp_cloud' }
  );

  const identity = contact.channels.find((item) => item.channel === 'email');
  assert.equal(updated.email, 'novo@example.test');
  assert.equal(decrypt(identity.addressEncrypted), 'novo@example.test');
  assert.equal(identity.authorized, false);
  assert.equal(identity.consentStatus, 'unknown');
  assert.equal(identity.source, 'chat_profile');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].status, 'revoked');
  assert.equal(audits[0].source, 'chat_profile_email_change');
});

test('falha ao persistir troca de email nao cria auditoria de revogacao falsa', async (context) => {
  restoreAfter(context, [[Contact, 'findById'], [Contact, 'findOne'], [ConsentEvent, 'create']]);
  const contact = {
    _id: '507f1f77bcf86cd799439017',
    displayNameEncrypted: encrypt('Samuel'),
    displayNameHash: searchHash('samuel'),
    emailEncrypted: encrypt('antigo@example.test'),
    emailHash: searchHash('antigo@example.test'),
    channels: [{
      channel: 'email',
      addressEncrypted: encrypt('antigo@example.test'),
      addressHash: searchHash('antigo@example.test'),
      authorized: true,
      consentStatus: 'granted',
      source: 'self_service_profile_email',
      consentSource: 'self_service_profile_email',
      consentedAt: new Date(),
      metadataEncrypted: encrypt({})
    }],
    pendingWhatsappConsents: [],
    channelAvatars: [],
    tags: [],
    inviteOrigins: [],
    active: true,
    notificationDisabled: false,
    async save() { throw new Error('falha de persistencia'); }
  };
  Contact.findById = () => query(contact);
  Contact.findOne = () => query(null);
  let audits = 0;
  ConsentEvent.create = async () => { audits += 1; };

  await assert.rejects(
    () => contactsManager.setEmailFromChat(
      contact._id,
      'novo@example.test',
      { channel: 'telegram' }
    ),
    /falha de persistencia/
  );
  assert.equal(audits, 0);
});

test('falha temporaria de auditoria deixa marcador e o retry conclui a trilha', async (context) => {
  restoreAfter(context, [[Contact, 'findById'], [Contact, 'findOne'], [ConsentEvent, 'create']]);
  const contact = {
    _id: '507f1f77bcf86cd799439019',
    displayNameEncrypted: encrypt('Samuel'),
    displayNameHash: searchHash('samuel'),
    emailEncrypted: encrypt('antigo@example.test'),
    emailHash: searchHash('antigo@example.test'),
    channels: [{
      channel: 'email',
      addressEncrypted: encrypt('antigo@example.test'),
      addressHash: searchHash('antigo@example.test'),
      authorized: true,
      consentStatus: 'granted',
      source: 'self_service_profile_email',
      consentSource: 'self_service_profile_email',
      consentedAt: new Date(),
      metadataEncrypted: encrypt({})
    }],
    pendingWhatsappConsents: [],
    channelAvatars: [],
    tags: [],
    inviteOrigins: [],
    active: true,
    notificationDisabled: false,
    async save() { return this; }
  };
  Contact.findById = () => query(contact);
  Contact.findOne = () => query(null);
  let auditAttempts = 0;
  ConsentEvent.create = async (input) => {
    auditAttempts += 1;
    if (auditAttempts === 1) throw new Error('auditoria indisponivel');
    return input;
  };

  await assert.rejects(
    () => contactsManager.setEmailFromChat(
      contact._id,
      'novo@example.test',
      { channel: 'telegram' }
    ),
    /auditoria indisponivel/
  );
  const identityAfterFailure = contact.channels.find((item) => item.channel === 'email');
  assert.equal(
    decrypt(identityAfterFailure.metadataEncrypted, { json: true }).pendingConsentAudit.kind,
    'email_replacement_revocation'
  );

  await contactsManager.setEmailFromChat(
    contact._id,
    'novo@example.test',
    { channel: 'telegram' }
  );

  assert.equal(auditAttempts, 2);
  assert.equal(
    decrypt(
      contact.channels.find((item) => item.channel === 'email').metadataEncrypted,
      { json: true }
    )
      .pendingConsentAudit,
    undefined
  );
});

test('retry de cleanup nao duplica evento legal da mesma operacao', async (context) => {
  restoreAfter(context, [[Contact, 'findById'], [Contact, 'findOne'], [ConsentEvent, 'create']]);
  let saveCalls = 0;
  const contact = {
    _id: '507f1f77bcf86cd799439020',
    displayNameEncrypted: encrypt('Samuel'),
    displayNameHash: searchHash('samuel'),
    emailEncrypted: encrypt('antigo@example.test'),
    emailHash: searchHash('antigo@example.test'),
    channels: [{
      channel: 'email',
      addressEncrypted: encrypt('antigo@example.test'),
      addressHash: searchHash('antigo@example.test'),
      authorized: true,
      consentStatus: 'granted',
      source: 'self_service_profile_email',
      consentSource: 'self_service_profile_email',
      consentedAt: new Date(),
      metadataEncrypted: encrypt({})
    }],
    pendingWhatsappConsents: [],
    channelAvatars: [],
    tags: [],
    inviteOrigins: [],
    active: true,
    notificationDisabled: false,
    async save() {
      saveCalls += 1;
      if (saveCalls === 2) throw new Error('cleanup indisponivel');
      return this;
    }
  };
  Contact.findById = () => query(contact);
  Contact.findOne = () => query(null);
  const operationHashes = [];
  ConsentEvent.create = async (input) => {
    operationHashes.push(input.operationIdHash);
    if (operationHashes.length === 2) {
      const duplicate = new Error('duplicate');
      duplicate.code = 11000;
      throw duplicate;
    }
    return input;
  };

  await assert.rejects(
    () => contactsManager.setEmailFromChat(
      contact._id,
      'novo@example.test',
      { channel: 'whatsapp_cloud' }
    ),
    /cleanup indisponivel/
  );
  assert.ok(
    decrypt(
      contact.channels.find((item) => item.channel === 'email').metadataEncrypted,
      { json: true }
    ).pendingConsentAudit
  );

  await contactsManager.setEmailFromChat(
    contact._id,
    'novo@example.test',
    { channel: 'whatsapp_cloud' }
  );

  assert.equal(operationHashes.length, 2);
  assert.equal(operationHashes[0], operationHashes[1]);
  assert.equal(
    decrypt(
      contact.channels.find((item) => item.channel === 'email').metadataEncrypted,
      { json: true }
    ).pendingConsentAudit,
    undefined
  );
});
