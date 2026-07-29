const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const Contact = require('../src/models/contact.model');
const ProfileAuthChallenge = require('../src/models/profile-auth-challenge.model');
const contactsManager = require('../src/managers/contacts.manager');
const profileManager = require('../src/managers/profile.manager');
const whatsappCloudManager = require('../src/managers/whatsapp-cloud.manager');
const gmailManager = require('../src/managers/gmail.manager');
const settingsManager = require('../src/managers/settings.manager');
const { env } = require('../src/config/env');

function restoreAfter(context, entries) {
  const originals = entries.map(([target, key]) => [target, key, target[key]]);
  context.after(() => originals.forEach(([target, key, value]) => { target[key] = value; }));
}

function selected(value) {
  return { select: async () => value };
}

function chain(value) {
  return {
    select() { return this; },
    sort() { return this; },
    limit() { return this; },
    lean() { return Promise.resolve(value); },
    then(resolve) { resolve(value); }
  };
}

test('telefone brasileiro aceita formato nacional e E.164 sem duplicar 55', () => {
  assert.equal(profileManager.normalizeBrazilianLoginPhone('(61) 98174-8795'), '5561981748795');
  assert.equal(profileManager.normalizeBrazilianLoginPhone('61981748795'), '5561981748795');
  assert.equal(profileManager.normalizeBrazilianLoginPhone('+55 61 98174-8795'), '5561981748795');
  assert.throws(
    () => profileManager.normalizeBrazilianLoginPhone('123'),
    (error) => error.code === 'PROFILE_PHONE_INVALID'
  );
});

test('marcador /login e assinado e detecta qualquer adulteracao', () => {
  const marker = profileManager.createProfileLoginMarker('abcdefghijklmnop');
  const parsed = profileManager.parseProfileLoginInvocation(`/login ${marker}`);
  assert.equal(parsed.marker, marker);
  assert.equal(parsed.command, '/login');
  const last = marker.at(-1);
  const tampered = marker.slice(0, -1) + (last === 'A' ? 'B' : 'A');
  assert.equal(profileManager.parseProfileLoginInvocation(`/login ${tampered}`), null);
  assert.equal(profileManager.parseProfileLoginInvocation('/login'), null);
});

test('solicitacao por telefone monta wa.me com /login e marcador sem codigo numerico', async (context) => {
  restoreAfter(context, [
    [Contact, 'find'],
    [ProfileAuthChallenge, 'countDocuments'],
    [ProfileAuthChallenge, 'findOne'],
    [ProfileAuthChallenge, 'create'],
    [ProfileAuthChallenge, 'updateOne'],
    [contactsManager, 'serialize'],
    [settingsManager, 'getValue']
  ]);
  const contact = {
    _id: '507f1f77bcf86cd799439011',
    id: '507f1f77bcf86cd799439011',
    phone: '5561981748795',
    channels: [{ channel: 'whatsapp_cloud', deliveryAddress: '5561981748795' }]
  };
  Contact.find = () => chain([contact]);
  contactsManager.serialize = () => contact;
  ProfileAuthChallenge.countDocuments = async () => 0;
  ProfileAuthChallenge.findOne = () => chain(null);
  let stored;
  ProfileAuthChallenge.create = async (input) => {
    stored = input;
    return { _id: '507f1f77bcf86cd799439099', ...input };
  };
  let markerHash;
  ProfileAuthChallenge.updateOne = async (_filter, update) => {
    markerHash = update.$set.loginMarkerHash;
    return { modifiedCount: 1 };
  };
  settingsManager.getValue = async (key) => (
    key === 'WHATSAPP_CLOUD_DISPLAY_PHONE_NUMBER' ? '+55 11 98888-7777' : null
  );

  const result = await profileManager.requestLogin({
    identifierType: 'phone',
    identifier: '(61) 98174-8795'
  });
  const url = new URL(result.whatsappUrl);
  const invocation = profileManager.parseProfileLoginInvocation(url.searchParams.get('text'));
  assert.equal(url.pathname, '/5511988887777');
  assert.equal(invocation.command, '/login');
  assert.match(markerHash, /^[a-f\d]{64}$/);
  assert.equal(stored.flow, 'link');
  assert.equal(stored.identifierType, 'phone');
  assert.equal(Object.hasOwn(stored, 'codeHash'), false);
  assert.equal(result.deliveryChannel, 'whatsapp_cloud');
});

test('solicitacao por email envia somente o magic link ao Gmail', async (context) => {
  restoreAfter(context, [
    [Contact, 'find'],
    [ProfileAuthChallenge, 'countDocuments'],
    [ProfileAuthChallenge, 'findOne'],
    [ProfileAuthChallenge, 'create'],
    [ProfileAuthChallenge, 'findOneAndUpdate'],
    [gmailManager, 'send']
  ]);
  const contact = {
    _id: '507f1f77bcf86cd799439011',
    id: '507f1f77bcf86cd799439011',
    email: 'samuel@example.test',
    channels: [{ channel: 'email', address: 'samuel@example.test' }]
  };
  Contact.find = () => chain([contact]);
  ProfileAuthChallenge.countDocuments = async () => 0;
  ProfileAuthChallenge.findOne = () => chain(null);
  const challenge = {
    _id: '507f1f77bcf86cd799439099',
    challengeId: '9f9e0f12-353a-4c28-9a96-b9e267def122',
    contact: contact._id,
    expiresAt: new Date(Date.now() + 600_000)
  };
  ProfileAuthChallenge.create = async () => challenge;
  ProfileAuthChallenge.findOneAndUpdate = async (_filter, update) => ({ ...challenge, ...update.$set });
  let mail;
  gmailManager.send = async (input) => {
    mail = input;
    return { providerMessageId: 'mail-safe' };
  };

  const result = await profileManager.requestLogin({
    identifierType: 'email',
    identifier: 'samuel@example.test'
  });
  assert.equal(result.deliveryChannel, 'email');
  assert.equal(Object.hasOwn(result, 'url'), false);
  assert.equal(Object.hasOwn(result, 'whatsappUrl'), false);
  assert.equal(mail.destination, 'samuel@example.test');
  const magicUrl = /https?:\/\/\S+/.exec(mail.text)?.[0];
  assert.ok(magicUrl);
  assert.equal(new URL(magicUrl).search, '');
  assert.match(new URL(magicUrl).hash, /^#acesso=[A-Za-z0-9_-]{43}$/);
});

test('link direto usa fragmento, e one-time e emite sessao limitada a sete dias', async (context) => {
  restoreAfter(context, [
    [Contact, 'findOne'],
    [Contact, 'findById'],
    [ProfileAuthChallenge, 'create'],
    [ProfileAuthChallenge, 'updateMany'],
    [ProfileAuthChallenge, 'findOneAndUpdate'],
    [contactsManager, 'getById']
  ]);
  const contactId = '507f1f77bcf86cd799439011';
  const challengeId = '9f9e0f12-353a-4c28-9a96-b9e267def122';
  const contact = {
    _id: contactId,
    id: contactId,
    active: true,
    deletedAt: null,
    displayName: 'Samuel',
    channels: [],
    pendingWhatsappConsents: []
  };
  Contact.findOne = () => selected(contact);
  Contact.findById = () => selected(contact);
  contactsManager.getById = async () => contact;
  ProfileAuthChallenge.create = async (input) => ({
    _id: '507f1f77bcf86cd799439099',
    ...input,
    challengeId
  });
  let revokedPrevious = false;
  ProfileAuthChallenge.updateMany = async () => {
    revokedPrevious = true;
    return { modifiedCount: 1 };
  };
  let storedTokenHash;
  let exchanged = false;
  ProfileAuthChallenge.findOneAndUpdate = (filter, update) => {
    if (filter._id) {
      storedTokenHash = update.$set.linkTokenHash;
      return Promise.resolve({ _id: filter._id, challengeId, contact: contactId, ...update.$set });
    }
    assert.equal(filter.linkTokenHash, storedTokenHash);
    if (exchanged) return { select: async () => null };
    exchanged = true;
    return { select: async () => ({ challengeId, contact: contactId, ...update.$set }) };
  };

  const issued = await profileManager.createDirectProfileLink(contactId, { source: 'telegram' });
  assert.equal(revokedPrevious, true);
  assert.equal(issued.challengeId, challengeId);
  const url = new URL(issued.url);
  assert.equal(url.search, '');
  const token = new URLSearchParams(url.hash.slice(1)).get('acesso');
  assert.ok(token);

  const exchangedResult = await profileManager.exchangeProfileLink({ token });
  const claims = jwt.verify(exchangedResult.accessToken, env.profileJwtSecret, {
    issuer: 'notify-app-api',
    audience: 'notify-app-contact'
  });
  assert.equal(claims.sub, contactId);
  assert.equal(claims.exp - claims.iat <= 7 * 24 * 60 * 60, true);
  assert.equal(exchangedResult.profile.id, contactId);
  await assert.rejects(
    () => profileManager.exchangeProfileLink({ token }),
    (error) => error.code === 'INVALID_PROFILE_LINK'
  );
});

test('sessao do perfil acompanha merge seguro de Telegram para WhatsApp', async (context) => {
  restoreAfter(context, [
    [Contact, 'findById'],
    [contactsManager, 'serialize']
  ]);
  const sourceId = '507f1f77bcf86cd799439011';
  const targetId = '507f1f77bcf86cd799439012';
  const source = {
    _id: sourceId,
    active: true,
    deletedAt: new Date(),
    metadata: { mergedIntoContactId: targetId }
  };
  const target = { _id: targetId, active: true, deletedAt: null, metadata: {} };
  Contact.findById = (id) => selected(String(id) === sourceId ? source : target);
  contactsManager.serialize = (contact) => ({ metadata: contact.metadata });

  assert.equal(await profileManager.resolveActiveProfileContactId(sourceId), targetId);
});

test('todo useCase profile_auth e tratado como segredo', () => {
  assert.equal(whatsappCloudManager.isSensitiveProfileAuthUseCase('profile_auth'), true);
  assert.equal(whatsappCloudManager.isSensitiveProfileAuthUseCase('profile_auth_link'), true);
  assert.equal(whatsappCloudManager.isSensitiveProfileAuthUseCase('profile_auth_existing_contact'), true);
  assert.equal(whatsappCloudManager.isSensitiveProfileAuthUseCase('customer_service'), false);
});
