const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const Contact = require('../src/models/contact.model');
const ContactGroup = require('../src/models/contact-group.model');
const Notification = require('../src/models/notification.model');
const ProfileAuthChallenge = require('../src/models/profile-auth-challenge.model');
const Template = require('../src/models/template.model');
const contactsManager = require('../src/managers/contacts.manager');
const gmailManager = require('../src/managers/gmail.manager');
const whatsappCloudManager = require('../src/managers/whatsapp-cloud.manager');
const telegramManager = require('../src/managers/telegram.manager');
const profileManager = require('../src/managers/profile.manager');
const settingsManager = require('../src/managers/settings.manager');
const { env } = require('../src/config/env');
const { encrypt } = require('../src/services/crypto.service');

function restoreAfter(context, entries) {
  const originals = entries.map(([target, key]) => [target, key, target[key]]);
  context.after(() => originals.forEach(([target, key, value]) => { target[key] = value; }));
}

function chain(value) {
  return {
    select() { return this; },
    sort() { return this; },
    skip() { return this; },
    limit() { return this; },
    lean() { return Promise.resolve(value); },
    then(resolve) { resolve(value); }
  };
}

function profileContact(id = '507f1f77bcf86cd799439011') {
  return {
    _id: id,
    id,
    displayName: 'Samuel',
    email: 'samuel@example.test',
    phone: '5561999999999',
    telegramUsername: null,
    avatarUrl: null,
    channels: [
      { channel: 'email', address: 'samuel@example.test', authorized: false, consentStatus: 'revoked' },
      { channel: 'whatsapp_cloud', address: '5561999999999', authorized: false, consentStatus: 'revoked' },
      { channel: 'telegram', address: '987654321', authorized: true, consentStatus: 'granted' }
    ],
    pendingWhatsappConsents: []
  };
}

test('solicitacao aguarda /gerar-codigo e a ativacao envia o mesmo codigo sem persistir plaintext', async (context) => {
  restoreAfter(context, [
    [Contact, 'find'],
    [Contact, 'findById'],
    [ProfileAuthChallenge, 'countDocuments'],
    [ProfileAuthChallenge, 'findOne'],
    [ProfileAuthChallenge, 'findOneAndUpdate'],
    [ProfileAuthChallenge, 'updateMany'],
    [ProfileAuthChallenge, 'create'],
    [ProfileAuthChallenge, 'updateOne'],
    [contactsManager, 'serialize'],
    [gmailManager, 'send'],
    [whatsappCloudManager, 'sendConversationText'],
    [telegramManager, 'send'],
    [settingsManager, 'getValue']
  ]);
  const contact = profileContact();
  Contact.find = () => chain([contact]);
  Contact.findById = () => chain(contact);
  contactsManager.serialize = () => contact;
  ProfileAuthChallenge.countDocuments = async () => 0;
  let stored;
  ProfileAuthChallenge.findOne = (filter) => chain(filter.contact
    ? { _id: '507f1f77bcf86cd799439088', ...stored }
    : null);
  ProfileAuthChallenge.updateMany = async () => ({ modifiedCount: 0 });
  ProfileAuthChallenge.create = async (input) => {
    stored = input;
    return { _id: '507f1f77bcf86cd799439088', ...input };
  };
  let persistedCodeHash;
  let activationUpdate;
  ProfileAuthChallenge.findOneAndUpdate = async (_filter, update) => {
    activationUpdate = update;
    persistedCodeHash = update.$set.codeHash;
    return { _id: '507f1f77bcf86cd799439088', ...stored, ...update.$set };
  };
  let persistedDeliveries;
  ProfileAuthChallenge.updateOne = async (_filter, update) => {
    if (update.$set.deliveries) persistedDeliveries = update.$set.deliveries;
    return { modifiedCount: 1 };
  };
  settingsManager.getValue = async (key) => (
    key === 'WHATSAPP_CLOUD_DISPLAY_PHONE_NUMBER' ? '+55 11 98888-7777' : null
  );
  let emailInput;
  gmailManager.send = async (input) => {
    emailInput = input;
    const error = new Error('smtp indisponivel');
    error.code = 'SMTP_DOWN';
    throw error;
  };
  let cloudText;
  whatsappCloudManager.sendConversationText = async (conversationId, text, options) => {
    cloudText = { conversationId, text, options };
    return { providerMessageId: 'provider-secret' };
  };
  let telegramInput;
  telegramManager.send = async (input) => {
    telegramInput = input;
    return { delivered: true };
  };

  const request = await profileManager.requestCode({ identifier: 'samuel@example.test' }, {
    ip: '127.0.0.1', userAgent: 'test-agent'
  });
  assert.equal(Object.hasOwn(stored, 'codeHash'), false);
  assert.equal(request.command, '/gerar-codigo');
  assert.equal(request.awaitingWhatsapp, true);
  assert.equal(new URL(request.whatsappUrl).hostname, 'wa.me');
  assert.equal(new URL(request.whatsappUrl).pathname, '/5511988887777');
  assert.equal(new URL(request.whatsappUrl).searchParams.get('text'), '/gerar-codigo');
  assert.equal(
    new Date(stored.codeExpiresAt).getTime() - new Date(stored.expiresAt).getTime(),
    (env.profileCodeTtlSeconds - Math.max(
      env.profileCodeWindowSeconds,
      env.profileCodeTtlSeconds
    )) * 1000
  );
  assert.equal(emailInput, undefined);
  assert.equal(cloudText, undefined);
  assert.equal(telegramInput, undefined);

  const result = await profileManager.activatePendingCodeFromWhatsapp({
    contactId: contact.id,
    conversationId: '507f1f77bcf86cd799439077'
  });
  const emailCode = /\b(\d{6})\b/.exec(emailInput.text)?.[1];
  const cloudCode = /\b(\d{6})\b/.exec(cloudText.text)?.[1];
  const telegramCode = /\b(\d{6})\b/.exec(telegramInput.text)?.[1];
  assert.match(emailCode, /^\d{6}$/);
  assert.equal(cloudCode, emailCode);
  assert.equal(telegramCode, emailCode);
  assert.equal(emailInput.destination, 'samuel@example.test');
  assert.equal(emailInput.allowUnconsented, true);
  assert.equal(emailInput.useCase, 'profile_auth');
  assert.equal(cloudText.options.useCase, 'profile_auth');
  assert.equal(cloudText.conversationId, '507f1f77bcf86cd799439077');
  assert.match(cloudText.text, /\*“\d{6}”\*/);
  assert.equal(telegramInput.useCase, 'profile_auth');
  assert.equal(telegramInput.contactId, contact.id);
  assert.equal(Object.hasOwn(stored, 'code'), false);
  assert.match(persistedCodeHash, /^[a-f\d]{64}$/);
  assert.notEqual(persistedCodeHash, emailCode);
  assert.ok(new Date(activationUpdate.$set.codeExpiresAt) >= new Date(stored.codeExpiresAt));
  assert.equal(activationUpdate.$inc.activationCount, 1);
  assert.ok(new Date(activationUpdate.$max.expiresAt) > new Date(activationUpdate.$set.codeExpiresAt));
  assert.deepEqual(persistedDeliveries.map((item) => [item.channel, item.status, item.errorCode || null]), [
    ['email', 'failed', 'SMTP_DOWN'],
    ['whatsapp_cloud', 'sent', null],
    ['telegram', 'sent', null]
  ]);
  assert.equal(result.activated, true);
});

test('solicitacao repetida nao revela o desafio ativo para outra sessao', async (context) => {
  restoreAfter(context, [
    [ProfileAuthChallenge, 'findOne'],
    [ProfileAuthChallenge, 'countDocuments'],
    [ProfileAuthChallenge, 'create']
  ]);
  const now = Date.now();
  const reusable = {
    challengeId: 'challenge-reutilizavel',
    codeExpiresAt: new Date(now + 300_000),
    expiresAt: new Date(now + 3_600_000),
    activatedAt: new Date(now - 10_000)
  };
  ProfileAuthChallenge.findOne = () => chain(reusable);
  ProfileAuthChallenge.countDocuments = async () => {
    throw new Error('rate limit nao deve ser consultado');
  };
  ProfileAuthChallenge.create = async () => {
    throw new Error('nao deve criar outro desafio');
  };

  await assert.rejects(
    () => profileManager.requestCode({ identifier: 'samuel@example.test' }),
    (error) => error.statusCode === 429
      && error.code === 'PROFILE_CODE_RATE_LIMIT'
      && !String(error.message).includes(reusable.challengeId)
  );
});

test('identificador inexistente retorna erro claro sem criar desafio ou acionar provedores', async (context) => {
  restoreAfter(context, [
    [Contact, 'find'], [ProfileAuthChallenge, 'countDocuments'], [ProfileAuthChallenge, 'findOne'],
    [ProfileAuthChallenge, 'create'],
    [gmailManager, 'send'], [whatsappCloudManager, 'send'], [telegramManager, 'send'],
    [settingsManager, 'getValue']
  ]);
  Contact.find = () => chain([]);
  ProfileAuthChallenge.countDocuments = async () => 0;
  ProfileAuthChallenge.findOne = () => chain(null);
  let challenges = 0;
  ProfileAuthChallenge.create = async () => { challenges += 1; };
  let sends = 0;
  gmailManager.send = async () => { sends += 1; };
  whatsappCloudManager.send = async () => { sends += 1; };
  telegramManager.send = async () => { sends += 1; };
  settingsManager.getValue = async () => '+55 11 98888-7777';

  await assert.rejects(
    () => profileManager.requestCode({ identifier: 'nobody@example.test' }),
    (error) => error.statusCode === 404 && error.code === 'PROFILE_CONTACT_NOT_FOUND'
  );
  assert.equal(sends, 0);
  assert.equal(challenges, 0);
});

test('desafio ativado e revogado quando os tres canais de entrega falham', async (context) => {
  restoreAfter(context, [
    [Contact, 'findById'], [contactsManager, 'serialize'],
    [ProfileAuthChallenge, 'findOne'], [ProfileAuthChallenge, 'findOneAndUpdate'],
    [ProfileAuthChallenge, 'updateOne'], [gmailManager, 'send'],
    [whatsappCloudManager, 'sendConversationText'], [telegramManager, 'send']
  ]);
  const contact = profileContact();
  Contact.findById = () => chain(contact);
  contactsManager.serialize = () => contact;
  const challenge = {
    _id: '507f1f77bcf86cd799439088',
    challengeId: '9f9e0f12-353a-4c28-9a96-b9e267def122',
    contact: contact.id,
    expiresAt: new Date(Date.now() + 600_000),
    maxAttempts: 5
  };
  ProfileAuthChallenge.findOne = () => chain(challenge);
  ProfileAuthChallenge.findOneAndUpdate = async (_filter, update) => ({ ...challenge, ...update.$set });
  let lastUpdate;
  ProfileAuthChallenge.updateOne = async (_filter, update) => { lastUpdate = update; return {}; };
  gmailManager.send = async () => { const error = new Error('down'); error.code = 'SMTP_DOWN'; throw error; };
  whatsappCloudManager.sendConversationText = async () => { const error = new Error('down'); error.code = 'META_DOWN'; throw error; };
  telegramManager.send = async () => { const error = new Error('down'); error.code = 'TELEGRAM_DOWN'; throw error; };

  const result = await profileManager.activatePendingCodeFromWhatsapp({
    contactId: contact.id,
    conversationId: '507f1f77bcf86cd799439077'
  });
  assert.equal(result.activated, false);
  assert.equal(result.reasonCode, 'PROFILE_CODE_DELIVERY_FAILED');
  assert.ok(lastUpdate.$set.revokedAt instanceof Date);
  assert.deepEqual(lastUpdate.$set.deliveries.map((item) => item.status), ['failed', 'failed', 'failed']);
});

test('limite por identificador bloqueia nova solicitacao antes de consultar o contato', async (context) => {
  restoreAfter(context, [[ProfileAuthChallenge, 'countDocuments'], [ProfileAuthChallenge, 'findOne'], [Contact, 'find']]);
  ProfileAuthChallenge.countDocuments = async () => env.profileCodeMaxRequests;
  ProfileAuthChallenge.findOne = () => chain(null);
  let lookedUp = false;
  Contact.find = () => { lookedUp = true; return chain([]); };
  await assert.rejects(
    () => profileManager.requestCode({ identifier: 'samuel@example.test' }),
    (error) => error.statusCode === 429 && error.code === 'PROFILE_CODE_RATE_LIMIT'
  );
  assert.equal(lookedUp, false);
});

test('codigo correto e de uso unico emite JWT exclusivo de contato', async (context) => {
  restoreAfter(context, [
    [ProfileAuthChallenge, 'findOne'], [ProfileAuthChallenge, 'findOneAndUpdate'],
    [Contact, 'exists'], [Contact, 'findById'], [contactsManager, 'getById']
  ]);
  const challengeId = '9f9e0f12-353a-4c28-9a96-b9e267def122';
  const code = '384920';
  const contactId = '507f1f77bcf86cd799439011';
  const hash = crypto.createHmac('sha256', env.profileJwtSecret)
    .update('profile-code:' + challengeId + ':' + code)
    .digest('hex');
  const challenge = {
    _id: '507f1f77bcf86cd799439088', challengeId, contact: contactId,
    codeHash: hash, attempts: 0, maxAttempts: 5,
    activatedAt: new Date(), activationChannel: 'whatsapp_cloud',
    expiresAt: new Date(Date.now() + 60_000), consumedAt: null, revokedAt: null
  };
  ProfileAuthChallenge.findOne = () => ({ select: async () => challenge });
  let claims = 0;
  let claimFilter;
  ProfileAuthChallenge.findOneAndUpdate = async (filter) => {
    claimFilter = filter;
    claims += 1;
    return claims === 1 ? { ...challenge, consumedAt: new Date() } : null;
  };
  Contact.exists = async () => ({ _id: contactId });
  Contact.findById = () => chain({ _id: contactId, active: true, deletedAt: null });
  contactsManager.getById = async () => profileContact(contactId);

  const result = await profileManager.verifyCode({ challengeId, code });
  const decoded = jwt.verify(result.accessToken, env.profileJwtSecret, {
    issuer: 'notify-app-api', audience: 'notify-app-contact'
  });

  assert.equal(claims, 1);
  assert.equal(claimFilter.codeHash, hash);
  assert.equal(claimFilter.activatedAt, challenge.activatedAt);
  assert.equal(claimFilter.expiresAt, challenge.expiresAt);
  assert.equal(decoded.sub, contactId);
  assert.equal(decoded.type, 'profile_access');
  assert.equal(decoded.exp - decoded.iat, 600);
  assert.ok(decoded.scope.includes('profile:consent:revoke'));
  assert.equal(result.profile.id, contactId);
  assert.equal(Object.hasOwn(result, 'refreshToken'), false);
  assert.equal(result.expiresInSeconds <= 600, true);
  assert.equal(new Date(result.expiresAt).getTime(), decoded.exp * 1000);

  const authenticated = await profileManager.authenticateProfileAccess(result.accessToken);
  assert.equal(authenticated.contactId, contactId);
  const adminLikeToken = jwt.sign({ sub: contactId, type: 'access' }, env.profileJwtSecret, {
    issuer: 'notify-app-api', audience: 'notify-app-admin'
  });
  await assert.rejects(
    () => profileManager.authenticateProfileAccess(adminLikeToken),
    (error) => error.code === 'INVALID_PROFILE_TOKEN'
  );
  await assert.rejects(
    () => profileManager.verifyCode({ challengeId, code }),
    (error) => error.code === 'INVALID_PROFILE_CODE'
  );
});

test('perfil nunca concede consentimento e revoga somente o proprio contactId', async (context) => {
  restoreAfter(context, [[contactsManager, 'setChannelConsent']]);
  let consentCall;
  contactsManager.setChannelConsent = async (...args) => {
    consentCall = args;
    return profileContact(args[0]);
  };

  const result = await profileManager.revokeOwnConsent('507f1f77bcf86cd799439011', {
    channel: 'whatsapp_cloud', confirmed: true
  });

  assert.equal(consentCall[0], '507f1f77bcf86cd799439011');
  assert.equal(consentCall[1], 'whatsapp_cloud');
  assert.equal(consentCall[2], 'revoked');
  assert.equal(consentCall[3].source, 'self_service_profile');
  assert.equal(consentCall[3].evidence.confirmed, true);
  assert.equal(result.id, '507f1f77bcf86cd799439011');
});

test('perfil permite ativar e revogar somente email com confirmacao e auditoria', async (context) => {
  restoreAfter(context, [[contactsManager, 'ensureEmailIdentity'], [contactsManager, 'setChannelConsent']]);
  const calls = [];
  contactsManager.ensureEmailIdentity = async (contactId) => { calls.push(['ensure', contactId]); };
  contactsManager.setChannelConsent = async (...args) => {
    calls.push(['consent', ...args]);
    const contact = profileContact(args[0]);
    contact.channels[0].authorized = args[2] === 'granted';
    contact.channels[0].consentStatus = args[2];
    return contact;
  };

  const granted = await profileManager.setOwnEmailConsent('507f1f77bcf86cd799439011', {
    enabled: true, confirmed: true
  });
  assert.deepEqual(calls[0], ['ensure', '507f1f77bcf86cd799439011']);
  assert.equal(calls[1][2], 'email');
  assert.equal(calls[1][3], 'granted');
  assert.equal(calls[1][4].source, 'self_service_profile_email');
  assert.deepEqual(calls[1][4].evidence, { confirmed: true, selfService: true, enabled: true });
  assert.equal(granted.permissions.find((item) => item.channel === 'email').authorized, true);

  calls.length = 0;
  await profileManager.setOwnEmailConsent('507f1f77bcf86cd799439011', {
    enabled: false, confirmed: true
  });
  assert.equal(calls.some(([kind]) => kind === 'ensure'), false);
  assert.equal(calls[0][3], 'revoked');
});

test('links de ativacao usam numero runtime e adaptam comando configurado ao deep-link Telegram', async (context) => {
  restoreAfter(context, [
    [contactsManager, 'getById'], [settingsManager, 'getWhatsappPermissionCommand'],
    [settingsManager, 'getTelegramPermissionCommand'],
    [settingsManager, 'getValue'], [telegramManager, 'status']
  ]);
  contactsManager.getById = async () => profileContact();
  settingsManager.getWhatsappPermissionCommand = async () => '/notify-me';
  settingsManager.getTelegramPermissionCommand = async () => '/verify-me';
  settingsManager.getValue = async (key) => key === 'WHATSAPP_CLOUD_DISPLAY_PHONE_NUMBER'
    ? '+1 (555) 000-1111'
    : null;
  telegramManager.status = async () => ({ configured: true, bot: { username: 'NotifyFlowBot' } });

  const result = await profileManager.activationLinks('507f1f77bcf86cd799439011');
  assert.equal(result.telegram.command, '/notify-me');
  assert.equal(result.telegram.permissionCommand, '/verify-me');
  assert.equal(result.telegram.deepLinkPayload, 'notify-me');
  assert.equal(result.telegram.deepLinkCommand, '/start notify-me');
  assert.equal(result.telegram.url, 'https://t.me/NotifyFlowBot?start=notify-me');
  assert.match(result.telegram.explanation, /\/start notify-me/);
  assert.equal(result.whatsapp.url, 'https://wa.me/15550001111?text=%2Fnotify-me');
  assert.deepEqual(
    result.helpCommands.whatsapp.map((item) => item.command),
    ['/notify-me', '/login', '/meu-perfil', '/help', '/cancelar']
  );
  assert.deepEqual(
    result.helpCommands.telegram.map((item) => item.command),
    ['/verify-me', '/notify-me', '/start', '/login', '/meu-perfil', '/help', '/cancelar', '/stop']
  );
});

test('historico filtra delivery do contato e retorna grupos/templates sem dados de terceiros', async (context) => {
  restoreAfter(context, [[Notification, 'aggregate'], [ContactGroup, 'find'], [Template, 'find']]);
  const contactId = '507f1f77bcf86cd799439011';
  const notificationId = '507f1f77bcf86cd799439012';
  const deliveryId = '507f1f77bcf86cd799439013';
  const groupId = '507f1f77bcf86cd799439014';
  const templateId = '507f1f77bcf86cd799439015';
  let pipeline;
  Notification.aggregate = async (value) => {
    pipeline = value;
    return [{ items: [{
      id: deliveryId,
      notificationId,
      channel: 'email', status: 'sent', attempts: 1,
      notificationKind: 'global', notificationChannel: 'global', notificationStatus: 'completed',
      notificationCreatedAt: new Date(), template: null, templates: { email: templateId },
      recipientGroups: [groupId]
    }], metadata: [{ total: 1 }] }];
  };
  ContactGroup.find = () => ({
    select: async () => [{
      _id: groupId,
      nameEncrypted: encrypt('Clientes VIP'),
      contacts: [contactId, '507f1f77bcf86cd799439099'],
      active: true
    }]
  });
  Template.find = () => ({
    select() { return this; },
    lean: async () => [{ _id: templateId, name: 'Email global', channel: 'email' }]
  });

  const result = await profileManager.deliveryHistory(contactId, { page: 1, limit: 10 });

  assert.equal(String(pipeline[0].$match['deliveries.contact']), contactId);
  assert.equal(String(pipeline[2].$match['deliveries.contact']), contactId);
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0].groups, [{ id: groupId, name: 'Clientes VIP' }]);
  assert.equal(result.items[0].template.name, 'Email global');
  assert.equal(result.items[0].notification.scope, 'global');
  assert.equal(result.items[0].notification.viaGroup, true);
  assert.equal(Object.hasOwn(result.items[0], 'contactId'), false);
  assert.equal(Object.hasOwn(result.items[0], 'providerMessageId'), false);
  assert.equal(Object.hasOwn(result.items[0], 'destination'), false);
  assert.doesNotMatch(JSON.stringify(result), /507f1f77bcf86cd799439099/);
});

test('schema possui indices unicos parciais de email e telefone', () => {
  const indexes = Contact.schema.indexes();
  const email = indexes.find(([, options]) => options.name === 'uniq_contact_email_hash');
  const phone = indexes.find(([, options]) => options.name === 'uniq_contact_phone_hash');
  assert.deepEqual(email[0], { emailHash: 1 });
  assert.equal(email[1].unique, true);
  assert.deepEqual(email[1].partialFilterExpression, { emailHash: { $type: 'string' } });
  assert.deepEqual(phone[0], { phoneHash: 1 });
  assert.equal(phone[1].unique, true);
});

test('painel administrativo de logins nunca devolve codigo ou hashes', async (context) => {
  restoreAfter(context, [
    [ProfileAuthChallenge, 'find'], [ProfileAuthChallenge, 'countDocuments'],
    [gmailManager, 'status'], [whatsappCloudManager, 'status'], [telegramManager, 'status'],
    [settingsManager, 'getValue'],
    [global, 'fetch']
  ]);
  let overviewFilter;
  ProfileAuthChallenge.find = (filter) => {
    overviewFilter = filter;
    return chain([{
    _id: '507f1f77bcf86cd799439088',
    challengeId: '9f9e0f12-353a-4c28-9a96-b9e267def122',
    contact: '507f1f77bcf86cd799439011', identifierType: 'email',
    codeHash: 'nao-pode-sair', identifierHash: 'tambem-nao', requestIpHash: 'nem-ip',
    flow: 'link', activationChannel: 'email', linkSource: 'email_login_request',
    attempts: 1, maxAttempts: 5, expiresAt: new Date(Date.now() + 60_000),
    deliveries: [], createdAt: new Date()
    }]);
  };
  ProfileAuthChallenge.countDocuments = async () => 1;
  gmailManager.status = async () => ({ configured: true });
  whatsappCloudManager.status = async () => ({ configured: true, sendConfigured: true });
  telegramManager.status = async () => ({ configured: true });
  settingsManager.getValue = async (key) => ({
    WHATSAPP_CLOUD_ACCESS_TOKEN: 'secret-token',
    WHATSAPP_CLOUD_BUSINESS_ACCOUNT_ID: 'waba-123',
    WHATSAPP_CLOUD_API_VERSION: 'v25.0'
  })[key];
  global.fetch = async () => { throw new Error('o fluxo nao deve consultar templates da Meta'); };

  const result = await profileManager.loginOverview({
    page: 1,
    limit: 20,
    deliveryChannel: 'email'
  });
  const serialized = JSON.stringify(result);
  assert.equal(result.configuration.template.name, null);
  assert.equal(result.configuration.template.command, '/login');
  assert.equal(result.configuration.template.flow, 'one_time_profile_link');
  assert.equal(result.configuration.template.editable, false);
  assert.equal(result.configuration.template.approvalConfirmed, true);
  assert.equal(result.configuration.template.found, true);
  assert.equal(result.configuration.template.status, 'active');
  assert.deepEqual(result.configuration.template.languages, []);
  assert.equal(result.configuration.providers.whatsapp_cloud.serviceWindowFlow, true);
  assert.equal(result.configuration.providers.telegram.configured, true);
  assert.deepEqual(overviewFilter.$or, [
    { 'deliveries.channel': 'email' },
    { flow: 'link', activationChannel: 'email' }
  ]);
  assert.equal(result.items[0].activationChannel, 'email');
  assert.equal(result.items[0].linkSource, 'email_login_request');
  assert.doesNotMatch(serialized, /nao-pode-sair|tambem-nao|nem-ip|codeHash|identifierHash|requestIpHash/);
  assert.doesNotMatch(serialized, /secret-token|do-not-expose/);
});
