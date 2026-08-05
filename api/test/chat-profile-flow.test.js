const test = require('node:test');
const assert = require('node:assert/strict');

const Contact = require('../src/models/contact.model');
const ChatEmailChallenge = require('../src/models/chat-email-challenge.model');
const ConsentEvent = require('../src/models/consent-event.model');
const contactsManager = require('../src/managers/contacts.manager');
const gmailManager = require('../src/managers/gmail.manager');
const settingsManager = require('../src/managers/settings.manager');
const chatProfileFlow = require('../src/services/chat-profile-flow.service');
const { encrypt, decrypt, searchHash } = require('../src/services/crypto.service');
const { env } = require('../src/config/env');

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

function stubEmailChallenges(context) {
  restoreAfter(context, [
    [ChatEmailChallenge, 'findOne'],
    [ChatEmailChallenge, 'findOneAndUpdate'],
    [ChatEmailChallenge, 'updateOne'],
    [ChatEmailChallenge, 'create'],
    [gmailManager, 'send']
  ]);
  let state = null;
  const emails = [];
  const matches = (filter = {}) => {
    if (!state) return false;
    if (filter.slotKey && filter.slotKey !== state.slotKey) return false;
    if (filter.operationId && filter.operationId !== state.operationId) return false;
    if (typeof filter.status === 'string' && filter.status !== state.status) return false;
    if (filter.status?.$in && !filter.status.$in.includes(state.status)) return false;
    if (filter.codeHash && filter.codeHash !== state.codeHash) return false;
    if (filter.verificationLeaseId
      && filter.verificationLeaseId !== state.verificationLeaseId) return false;
    if (filter.verificationLeaseUntil?.$gt
      && new Date(state.verificationLeaseUntil) <= new Date(filter.verificationLeaseUntil.$gt)) return false;
    if (filter.verificationLeaseUntil?.$lte
      && new Date(state.verificationLeaseUntil) > new Date(filter.verificationLeaseUntil.$lte)) return false;
    if (filter.verificationLeaseUntil?.$exists === false
      && state.verificationLeaseUntil !== undefined
      && state.verificationLeaseUntil !== null) return false;
    if (filter.updatedAt?.$lte
      && new Date(state.updatedAt) > new Date(filter.updatedAt.$lte)) return false;
    if (filter.resendAt?.$lte && new Date(state.resendAt) > new Date(filter.resendAt.$lte)) return false;
    if (filter.attempts?.$lt && state.attempts >= filter.attempts.$lt) return false;
    if (filter.codeExpiresAt?.$gt
      && new Date(state.codeExpiresAt) <= new Date(filter.codeExpiresAt.$gt)) return false;
    return true;
  };
  const apply = (update = {}) => {
    if (update.$set) Object.assign(state, update.$set);
    for (const key of Object.keys(update.$unset || {})) delete state[key];
    for (const [key, value] of Object.entries(update.$inc || {})) {
      state[key] = Number(state[key] || 0) + value;
    }
    state.updatedAt = new Date();
  };
  ChatEmailChallenge.findOne = () => {
    const chain = {
      select() { return chain; },
      async lean() { return state ? { ...state } : null; }
    };
    return chain;
  };
  ChatEmailChallenge.create = async (input) => {
    if (state) {
      const duplicate = new Error('duplicate');
      duplicate.code = 11000;
      throw duplicate;
    }
    state = { ...input, createdAt: new Date(), updatedAt: new Date() };
    return state;
  };
  ChatEmailChallenge.findOneAndUpdate = async (filter, update) => {
    if (!matches(filter)) return null;
    apply(update);
    return { ...state };
  };
  ChatEmailChallenge.updateOne = async (filter, update) => {
    if (!matches(filter)) return { modifiedCount: 0 };
    apply(update);
    return { modifiedCount: 1 };
  };
  gmailManager.send = async (input) => {
    emails.push(input);
    return { providerMessageId: 'email-verification-message' };
  };
  return {
    emails,
    state: () => state,
    code: () => emails.at(-1)?.text.match(/\b(\d{6})\b/)?.[1]
  };
}

test('/help exato lista os comandos reais de WhatsApp e Telegram', async (context) => {
  restoreAfter(context, [[settingsManager, 'getValidatedPermissionCommands']]);
  settingsManager.getValidatedPermissionCommands = async () => ({
    whatsapp: '/autorizar-wpp',
    telegram: '/autorizar-telegram'
  });

  const whatsapp = await chatProfileFlow.handleInbound({
    contactId: '507f1f77bcf86cd799439011',
    channel: 'whatsapp_cloud',
    text: '/help'
  });
  const telegram = await chatProfileFlow.handleInbound({
    contactId: '507f1f77bcf86cd799439011',
    channel: 'telegram',
    text: '/help'
  });
  const telegramAlias = await chatProfileFlow.handleInbound({
    contactId: '507f1f77bcf86cd799439011',
    channel: 'telegram',
    text: '/help@EjugNotifyBot'
  });
  const notExact = await chatProfileFlow.handleInbound({
    contactId: '507f1f77bcf86cd799439011',
    channel: 'telegram',
    text: '/help agora'
  });

  assert.equal(whatsapp.handled, true);
  assert.equal(whatsapp.kind, 'help');
  assert.match(whatsapp.text, /Ajuda do Notify Flow no WhatsApp/);
  assert.match(whatsapp.text, /\/autorizar-wpp/);
  assert.match(whatsapp.text, /\/login/);
  assert.match(whatsapp.text, /\/meu-perfil/);
  assert.match(whatsapp.text, /\/cancelar/);
  assert.doesNotMatch(whatsapp.text, /\/stop/);

  assert.equal(telegram.handled, true);
  assert.equal(telegram.kind, 'help');
  assert.match(telegram.text, /Ajuda do Notify Flow no Telegram/);
  assert.match(telegram.text, /\/autorizar-telegram/);
  assert.match(telegram.text, /\/autorizar-wpp/);
  assert.match(telegram.text, /\/start/);
  assert.doesNotMatch(telegram.text, /payload|chat_id|contactId|user_id|token/i);
  assert.match(telegram.text, /\/stop/);
  assert.equal(telegramAlias.handled, true);
  assert.equal(telegramAlias.kind, 'help');
  assert.equal(telegramAlias.text, telegram.text);
  assert.equal(notExact.handled, false);
});

test('/help continua disponivel com comandos padrao quando a configuracao legada e invalida', async (context) => {
  restoreAfter(context, [[settingsManager, 'getValidatedPermissionCommands']]);
  settingsManager.getValidatedPermissionCommands = async () => {
    throw new Error('configuracao legada invalida');
  };

  const result = await chatProfileFlow.handleInbound({
    contactId: '507f1f77bcf86cd799439011',
    channel: 'whatsapp_cloud',
    text: '/help'
  });

  assert.equal(result.handled, true);
  assert.equal(result.kind, 'help');
  assert.match(result.text, /Ajuda do Notify Flow no WhatsApp/);
  assert.match(result.text, /\/notify-me/);
  assert.match(result.text, /\/login/);
});

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
  const aliasResult = await chatProfileFlow.handleInbound({
    contactId: '507f1f77bcf86cd799439011',
    channel: 'telegram',
    text: '/meu-perfil@EjugNotifyBot',
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
  assert.equal(aliasResult.handled, true);
  assert.equal(aliasResult.kind, 'profile');
  assert.equal(aliasResult.text, result.text);
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
  const challenges = stubEmailChallenges(context);
  const updates = [];
  contactsManager.setEmailFromChat = async (contactId, email, options) => {
    updates.push({ contactId, email, options });
    return { id: contactId, email };
  };
  const contactId = '507f1f77bcf86cd799439012';
  assert.match(chatProfileFlow.emailCapturePrompt(), /endereço válido/i);
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
    text: ' Samuel@Example.Test ',
    providerEvidence: {
      providerMessageId: 'wamid.secret-reference',
      updateId: 'cloud-update-1'
    }
  });
  assert.equal(valid.kind, 'email_verification_started');
  assert.equal(updates.length, 0);
  assert.equal(challenges.emails.length, 1);
  assert.equal(challenges.emails[0].destination, 'samuel@example.test');
  assert.equal(challenges.emails[0].useCase, 'chat_email_verification');
  assert.match(valid.text, /lixo eletronico/i);
  assert.equal(await chatProfileFlow.pendingEmailCapture(contactId, 'whatsapp_cloud'), false);

  const confirmed = await chatProfileFlow.handleInbound({
    contactId,
    channel: 'whatsapp_cloud',
    text: challenges.code(),
    providerEvidence: {
      providerMessageId: 'wamid.code-reference',
      updateId: 'cloud-code-update-1'
    }
  });
  assert.equal(confirmed.kind, 'email_updated');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].contactId, contactId);
  assert.equal(updates[0].email, 'samuel@example.test');
  assert.equal(updates[0].options.channel, 'whatsapp_cloud');
  assert.equal(updates[0].options.providerMessageId, 'wamid.code-reference');
  assert.equal(updates[0].options.updateId, 'cloud-code-update-1');
  assert.equal(updates[0].options.verificationMethod, 'chat_email_code');
  assert.match(updates[0].options.operationId, /^[0-9a-f-]{36}$/i);
  assert.match(confirmed.text, /autorizado para receber notificacoes/i);
  assert.equal(await chatProfileFlow.pendingEmailCapture(contactId, 'whatsapp_cloud'), false);
  assert.equal(await chatProfileFlow.pendingEmailCapture(contactId, 'telegram'), false);
});

test('email valido fora do fluxo inicia verificacao persistente com TTL e reenvio controlado', async (context) => {
  const challenges = stubEmailChallenges(context);
  const originalTtl = env.chatEmailCodeTtlSeconds;
  const originalResend = env.chatEmailCodeResendSeconds;
  env.chatEmailCodeTtlSeconds = 900;
  env.chatEmailCodeResendSeconds = 120;
  context.after(() => {
    env.chatEmailCodeTtlSeconds = originalTtl;
    env.chatEmailCodeResendSeconds = originalResend;
  });
  const contactId = '507f1f77bcf86cd799439021';
  const startedAt = Date.now();

  const started = await chatProfileFlow.handleInbound({
    contactId,
    channel: 'telegram',
    text: 'Pode atualizar para Novo.Email@Example.Test, por favor?',
    providerEvidence: { updateId: 1001 }
  });

  assert.equal(started.kind, 'email_verification_started');
  assert.equal(challenges.emails.length, 1);
  assert.equal(challenges.emails[0].destination, 'novo.email@example.test');
  assert.ok(new Date(challenges.state().codeExpiresAt).getTime() - startedAt >= 899_000);
  assert.ok(new Date(challenges.state().resendAt).getTime() - startedAt >= 119_000);
  assert.doesNotMatch(JSON.stringify(challenges.state()), new RegExp(challenges.code()));

  const limited = await chatProfileFlow.handleInbound({
    contactId,
    channel: 'whatsapp_cloud',
    text: 'novo.email@example.test'
  });
  assert.equal(limited.kind, 'email_verification_rate_limited');
  assert.match(limited.text, /aguarde/i);
  assert.equal(challenges.emails.length, 1);

  challenges.state().resendAt = new Date(Date.now() - 1);
  const resent = await chatProfileFlow.handleInbound({
    contactId,
    channel: 'whatsapp_cloud',
    text: 'novo.email@example.test'
  });
  assert.equal(resent.kind, 'email_verification_started');
  assert.equal(challenges.emails.length, 2);
  assert.notEqual(challenges.emails[0].text, challenges.emails[1].text);
});

test('codigo de email expira, limita tentativas e nunca aparece no texto seguro', async (context) => {
  restoreAfter(context, [[contactsManager, 'setEmailFromChat']]);
  const challenges = stubEmailChallenges(context);
  let updates = 0;
  contactsManager.setEmailFromChat = async () => {
    updates += 1;
    return { email: 'seguro@example.test' };
  };
  const contactId = '507f1f77bcf86cd799439022';

  await chatProfileFlow.handleInbound({
    contactId,
    channel: 'telegram',
    text: 'seguro@example.test'
  });
  const secretCode = challenges.code();
  assert.equal(
    await chatProfileFlow.safeInboundText(contactId, secretCode),
    chatProfileFlow.EMAIL_VERIFICATION_CODE_PLACEHOLDER
  );

  challenges.state().codeExpiresAt = new Date(Date.now() - 1);
  const expired = await chatProfileFlow.handleInbound({
    contactId,
    channel: 'telegram',
    text: secretCode
  });
  assert.equal(expired.kind, 'email_verification_expired');
  assert.equal(updates, 0);
  assert.equal(
    await chatProfileFlow.safeInboundText(contactId, secretCode),
    chatProfileFlow.EMAIL_VERIFICATION_CODE_PLACEHOLDER
  );

  challenges.state().resendAt = new Date(Date.now() - 1);
  await chatProfileFlow.handleInbound({
    contactId,
    channel: 'telegram',
    text: 'seguro@example.test'
  });
  const latestCode = challenges.code();
  let invalid;
  for (let attempt = 0; attempt < env.chatEmailCodeMaxAttempts; attempt += 1) {
    invalid = await chatProfileFlow.handleInbound({
      contactId,
      channel: 'telegram',
      text: latestCode === '000000' ? '999999' : '000000'
    });
  }
  assert.equal(invalid.kind, 'email_verification_invalid');
  assert.match(invalid.text, /limite de tentativas/i);
  assert.equal(challenges.state().status, 'revoked');
  assert.equal(updates, 0);
  assert.equal(
    await chatProfileFlow.safeInboundText(contactId, latestCode),
    chatProfileFlow.EMAIL_VERIFICATION_CODE_PLACEHOLDER
  );
});

test('codigo confirmado atualiza uma vez e permanece redigido depois do consumo', async (context) => {
  restoreAfter(context, [[contactsManager, 'setEmailFromChat']]);
  const challenges = stubEmailChallenges(context);
  const updates = [];
  contactsManager.setEmailFromChat = async (contactId, email, options) => {
    updates.push({ contactId, email, options });
    return { id: contactId, email };
  };
  const contactId = '507f1f77bcf86cd799439023';
  await chatProfileFlow.handleInbound({
    contactId,
    channel: 'whatsapp_cloud',
    text: 'confirmado@example.test'
  });
  const code = challenges.code();

  const confirmed = await chatProfileFlow.handleInbound({
    contactId,
    channel: 'telegram',
    text: code,
    providerEvidence: { updateId: 2002 }
  });

  assert.equal(confirmed.kind, 'email_updated');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].options.channel, 'telegram');
  assert.equal(updates[0].options.verificationMethod, 'chat_email_code');
  assert.equal(challenges.state().status, 'consumed');
  assert.equal(
    await chatProfileFlow.safeInboundText(contactId, code),
    chatProfileFlow.EMAIL_VERIFICATION_CODE_PLACEHOLDER
  );
  const duplicate = await chatProfileFlow.handleInbound({
    contactId,
    channel: 'whatsapp_cloud',
    text: code
  });
  assert.equal(duplicate.handled, false);
  assert.equal(updates.length, 1);
});

test('novo email nao substitui desafio enquanto a atualizacao verificada possui lease ativo', async (context) => {
  restoreAfter(context, [[contactsManager, 'setEmailFromChat']]);
  const challenges = stubEmailChallenges(context);
  let releaseUpdate;
  let updateStarted;
  const started = new Promise((resolve) => { updateStarted = resolve; });
  const blocked = new Promise((resolve) => { releaseUpdate = resolve; });
  const updates = [];
  contactsManager.setEmailFromChat = async (contactId, email) => {
    updates.push({ contactId, email });
    updateStarted();
    await blocked;
    return { id: contactId, email };
  };
  const contactId = '507f1f77bcf86cd799439024';
  await chatProfileFlow.handleInbound({
    contactId,
    channel: 'telegram',
    text: 'primeiro@example.test'
  });
  const code = challenges.code();
  challenges.state().resendAt = new Date(Date.now() - 1);

  const verification = chatProfileFlow.handleInbound({
    contactId,
    channel: 'telegram',
    text: code
  });
  await started;

  const replacement = await chatProfileFlow.handleInbound({
    contactId,
    channel: 'whatsapp_cloud',
    text: 'segundo@example.test'
  });
  assert.equal(replacement.kind, 'email_verification_rate_limited');
  assert.equal(challenges.emails.length, 1);
  assert.equal(challenges.state().status, 'verifying');

  releaseUpdate();
  const confirmed = await verification;
  assert.equal(confirmed.kind, 'email_updated');
  assert.deepEqual(updates, [{ contactId, email: 'primeiro@example.test' }]);
  assert.equal(challenges.state().status, 'consumed');
});

test('lease orfao pode ser recuperado com CAS antes de substituir o desafio', async (context) => {
  const challenges = stubEmailChallenges(context);
  const contactId = '507f1f77bcf86cd799439025';
  await chatProfileFlow.handleInbound({
    contactId,
    channel: 'telegram',
    text: 'antigo@example.test'
  });
  challenges.state().status = 'verifying';
  challenges.state().verificationLeaseId = 'lease-abandonado';
  challenges.state().verificationLeaseUntil = new Date(Date.now() - 1);
  challenges.state().resendAt = new Date(Date.now() - 1);

  const replacement = await chatProfileFlow.handleInbound({
    contactId,
    channel: 'telegram',
    text: 'novo@example.test'
  });
  assert.equal(replacement.kind, 'email_verification_started');
  assert.equal(challenges.emails.length, 2);
  assert.equal(challenges.state().status, 'active');
  assert.equal(challenges.state().targetEmailHash, searchHash('novo@example.test'));
});

test('redacao compara hashes: preserva codigo substituido sem mascarar seis digitos alheios', async (context) => {
  const challenges = stubEmailChallenges(context);
  const contactId = '507f1f77bcf86cd799439026';
  await chatProfileFlow.handleInbound({
    contactId,
    channel: 'telegram',
    text: 'um@example.test'
  });
  const oldCode = challenges.code();
  challenges.state().resendAt = new Date(Date.now() - 1);
  await chatProfileFlow.handleInbound({
    contactId,
    channel: 'telegram',
    text: 'dois@example.test'
  });
  const activeCode = challenges.code();
  const unrelated = ['123456', '654321', '111111']
    .find((candidate) => candidate !== oldCode && candidate !== activeCode);

  assert.equal(
    await chatProfileFlow.safeInboundText(contactId, oldCode),
    chatProfileFlow.EMAIL_VERIFICATION_CODE_PLACEHOLDER
  );
  assert.equal(
    await chatProfileFlow.safeInboundText(contactId, activeCode),
    chatProfileFlow.EMAIL_VERIFICATION_CODE_PLACEHOLDER
  );
  assert.equal(await chatProfileFlow.safeInboundText(contactId, unrelated), unrelated);

  challenges.state().status = 'consumed';
  assert.equal(
    await chatProfileFlow.safeInboundText(contactId, activeCode),
    chatProfileFlow.EMAIL_VERIFICATION_CODE_PLACEHOLDER
  );
  assert.equal(await chatProfileFlow.safeInboundText(contactId, unrelated), unrelated);
});

test('intervalo minimo configurado para novo codigo de email e dois minutos', () => {
  assert.ok(env.chatEmailCodeResendSeconds >= 120);
});

test('setEmailFromChat rejeita origem que nao seja um chat autenticado suportado', async () => {
  await assert.rejects(
    () => contactsManager.setEmailFromChat(
      '507f1f77bcf86cd799439014',
      'samuel@example.test',
      { channel: 'email' }
    ),
    (error) => error.code === 'INVALID_EMAIL_SOURCE_CHANNEL'
  );
});

test('captura nao vincula automaticamente email pertencente a outro perfil', async (context) => {
  restoreAfter(context, [[contactsManager, 'setEmailFromChat']]);
  const challenges = stubEmailChallenges(context);
  contactsManager.setEmailFromChat = async () => {
    const error = new Error('conflito');
    error.code = 'EMAIL_OWNERSHIP_VERIFICATION_REQUIRED';
    throw error;
  };
  const contactId = '507f1f77bcf86cd799439013';
  await chatProfileFlow.beginEmailCapture(contactId, 'telegram');

  const started = await chatProfileFlow.handleInbound({
    contactId,
    channel: 'telegram',
    text: 'existente@example.test'
  });
  assert.equal(started.kind, 'email_verification_started');
  const result = await chatProfileFlow.handleInbound({
    contactId,
    channel: 'telegram',
    text: challenges.code()
  });

  assert.equal(result.kind, 'email_conflict');
  assert.match(result.text, /proteger seus dados/i);
  assert.equal(await chatProfileFlow.pendingEmailCapture(contactId, 'telegram'), false);
});

test('/cancelar limpa capturas do contato mesmo quando chegou pelo outro canal', async (context) => {
  restoreAfter(context, [
    [ChatEmailChallenge, 'findOne'],
    [ChatEmailChallenge, 'updateOne']
  ]);
  ChatEmailChallenge.updateOne = async () => ({ modifiedCount: 0 });
  ChatEmailChallenge.findOne = () => {
    const chain = {
      select() { return chain; },
      async lean() { return null; }
    };
    return chain;
  };
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

test('/cancelar nao confirma cancelamento durante uma verificacao ja em andamento', async (context) => {
  const challenges = stubEmailChallenges(context);
  const contactId = '507f1f77bcf86cd799439028';
  await chatProfileFlow.handleInbound({
    contactId,
    channel: 'telegram',
    text: 'andamento@example.test'
  });
  challenges.state().status = 'verifying';
  challenges.state().verificationLeaseId = 'lease-em-andamento';
  challenges.state().verificationLeaseUntil = new Date(Date.now() + 60_000);

  const result = await chatProfileFlow.handleInbound({
    contactId,
    channel: 'whatsapp_cloud',
    text: '/cancelar'
  });

  assert.equal(result.kind, 'email_verification_in_progress');
  assert.match(result.text, /sendo concluida/i);
  assert.equal(challenges.state().status, 'verifying');
  assert.equal(challenges.state().verificationLeaseId, 'lease-em-andamento');
});

test('setEmailFromChat cria identidade e concede consentimento explicito somente ao email informado', async (context) => {
  restoreAfter(context, [[Contact, 'findById'], [Contact, 'findOne'], [ConsentEvent, 'create']]);
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
  const audits = [];
  ConsentEvent.create = async (input) => {
    audits.push(input);
    return input;
  };

  const updated = await contactsManager.setEmailFromChat(
    contact._id,
    'Samuel@Example.Test',
    {
      channel: 'telegram',
      operationId: 'chat-email-grant-1',
      providerMessageId: 'telegram-message-10',
      updateId: 'telegram-update-20'
    }
  );

  assert.equal(decrypt(contact.emailEncrypted), 'samuel@example.test');
  assert.equal(updated.email, 'samuel@example.test');
  const identity = contact.channels.find((item) => item.channel === 'email');
  assert.ok(identity);
  assert.equal(identity.authorized, true);
  assert.equal(identity.consentStatus, 'granted');
  assert.equal(identity.consentSource, 'chat_email_explicit_opt_in');
  assert.equal(decrypt(identity.addressEncrypted), 'samuel@example.test');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].status, 'granted');
  assert.equal(audits[0].source, 'chat_email_explicit_opt_in');
  const evidence = decrypt(audits[0].evidenceEncrypted, { json: true });
  assert.equal(evidence.sourceChannel, 'telegram');
  assert.equal(evidence.interaction, 'email_submitted_after_consent_prompt');
  assert.equal(evidence.addressReferenceHash, searchHash('samuel@example.test'));
  assert.equal(evidence.providerMessageReferenceHash, searchHash('chat-email-message:telegram:telegram-message-10'));
  assert.equal(evidence.providerUpdateReferenceHash, searchHash('chat-email-update:telegram:telegram-update-20'));
  assert.doesNotMatch(audits[0].evidenceEncrypted, /samuel@example\.test|telegram-message-10/);
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

test('trocar endereco revoga o consentimento antigo e cria um novo grant auditado para o email informado', async (context) => {
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
    { channel: 'whatsapp_cloud', operationId: 'chat-email-grant-replacement' }
  );

  const identity = contact.channels.find((item) => item.channel === 'email');
  assert.equal(updated.email, 'novo@example.test');
  assert.equal(decrypt(identity.addressEncrypted), 'novo@example.test');
  assert.equal(identity.authorized, true);
  assert.equal(identity.consentStatus, 'granted');
  assert.equal(identity.source, 'chat_profile');
  assert.equal(identity.consentSource, 'chat_email_explicit_opt_in');
  assert.equal(audits.length, 2);
  assert.equal(audits[0].status, 'revoked');
  assert.equal(audits[0].source, 'chat_profile_email_change');
  assert.equal(audits[1].status, 'granted');
  assert.equal(audits[1].source, 'chat_email_explicit_opt_in');
  const revocationEvidence = decrypt(audits[0].evidenceEncrypted, { json: true });
  const grantEvidence = decrypt(audits[1].evidenceEncrypted, { json: true });
  assert.equal(revocationEvidence.previousAddressReferenceHash, searchHash('antigo@example.test'));
  assert.equal(revocationEvidence.replacementAddressReferenceHash, searchHash('novo@example.test'));
  assert.equal(grantEvidence.addressReferenceHash, searchHash('novo@example.test'));
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
    { channel: 'telegram', operationId: 'chat-email-audit-retry' }
  );

  assert.equal(auditAttempts, 3);
  assert.equal(contact.channels.find((item) => item.channel === 'email').authorized, true);
  assert.equal(contact.channels.find((item) => item.channel === 'email').consentStatus, 'granted');
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
      { channel: 'whatsapp_cloud', operationId: 'chat-email-cleanup-retry' }
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
    { channel: 'whatsapp_cloud', operationId: 'chat-email-cleanup-retry' }
  );

  assert.equal(operationHashes.length, 3);
  assert.equal(operationHashes[0], operationHashes[1]);
  assert.notEqual(operationHashes[1], operationHashes[2]);
  assert.equal(contact.channels.find((item) => item.channel === 'email').authorized, true);
  assert.equal(
    decrypt(
      contact.channels.find((item) => item.channel === 'email').metadataEncrypted,
      { json: true }
    ).pendingConsentAudit,
    undefined
  );
});
