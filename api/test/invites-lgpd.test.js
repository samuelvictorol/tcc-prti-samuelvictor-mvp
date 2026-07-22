const test = require('node:test');
const assert = require('node:assert/strict');
const Invite = require('../src/models/invite.model');
const Term = require('../src/models/term.model');
const invitesManager = require('../src/managers/invites.manager');
const termsManager = require('../src/managers/terms.manager');
const { createInviteSchema, updateInviteSchema } = require('../src/dtos/invites.dto');
const { createTermSchema } = require('../src/dtos/terms.dto');
const { publicHttpsUrl } = require('../src/dtos/common.dto');
const { INITIAL_LEGAL_VERSION, listDefaultLegalDocuments } = require('../src/utils/default-legal-documents');

const actorId = '507f1f77bcf86cd799439011';

test('convite aceita icone HTTPS publico e deixa o slug sob autoridade da API', () => {
  const parsed = createInviteSchema.safeParse({ body: {
    title: 'Meu Convite Especial',
    slug: 'slug-forjado-pelo-cliente',
    iconeUrl: 'https://cdn.example.com/icons/notify.png',
    links: []
  } });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.body.slug, undefined);
  assert.equal(parsed.data.body.iconeUrl, 'https://cdn.example.com/icons/notify.png');
  assert.equal(updateInviteSchema.safeParse({
    params: { id: actorId },
    body: { title: 'Novo titulo' }
  }).success, true);
});

test('icone do convite rejeita HTTP, credenciais, portas e destinos locais', () => {
  assert.equal(publicHttpsUrl.safeParse('https://cdn.example.com/icon.png').success, true);
  assert.equal(publicHttpsUrl.safeParse('http://cdn.example.com/icon.png').success, false);
  assert.equal(publicHttpsUrl.safeParse('https://user:pass@example.com/icon.png').success, false);
  assert.equal(publicHttpsUrl.safeParse('https://example.com:8443/icon.png').success, false);
  assert.equal(publicHttpsUrl.safeParse('https://localhost/icon.png').success, false);
  assert.equal(publicHttpsUrl.safeParse('https://127.0.0.1/icon.png').success, false);
  assert.equal(publicHttpsUrl.safeParse('https://192.168.1.20/icon.png').success, false);
});

test('slug deriva do titulo e preserva o limite ao adicionar sufixo', () => {
  assert.equal(invitesManager.slugBaseFromTitle('Olá, Mundo!'), 'ola-mundo');
  assert.equal(invitesManager.slugBaseFromTitle('A'), 'convite-a');
  assert.equal(invitesManager.slugCandidate('meu-convite', 1), 'meu-convite');
  assert.equal(invitesManager.slugCandidate('meu-convite', 2), 'meu-convite-2');
  assert.ok(invitesManager.slugCandidate('a'.repeat(100), 200).length <= 100);
});

test('create tenta o proximo slug quando ha colisao concorrente no indice unico', async (context) => {
  const original = Invite.create;
  context.after(() => { Invite.create = original; });
  const attempts = [];
  Invite.create = async (input) => {
    attempts.push(input.slug);
    if (attempts.length === 1) {
      const error = new Error('duplicate');
      error.code = 11000;
      error.keyPattern = { slug: 1 };
      throw error;
    }
    return { _id: actorId, ...input, toObject() { return { ...this }; } };
  };

  const result = await invitesManager.create({ title: 'Meu Convite', links: [] }, actorId);
  assert.deepEqual(attempts, ['meu-convite', 'meu-convite-2']);
  assert.equal(result.slug, 'meu-convite-2');
});

test('update recalcula slug a cada mudanca de titulo e resolve colisao', async (context) => {
  const originals = { findById: Invite.findById, findByIdAndUpdate: Invite.findByIdAndUpdate };
  context.after(() => {
    Invite.findById = originals.findById;
    Invite.findByIdAndUpdate = originals.findByIdAndUpdate;
  });
  Invite.findById = () => ({ select: async () => ({ title: 'Titulo anterior' }) });
  const attempts = [];
  Invite.findByIdAndUpdate = async (_id, update) => {
    attempts.push(update.$set.slug);
    if (attempts.length === 1) {
      const error = new Error('duplicate');
      error.code = 11000;
      error.keyValue = { slug: update.$set.slug };
      throw error;
    }
    return { _id: actorId, ...update.$set, toObject() { return { ...this }; } };
  };

  const result = await invitesManager.update(actorId, { title: 'Titulo Repetido' });
  assert.deepEqual(attempts, ['titulo-repetido', 'titulo-repetido-2']);
  assert.equal(result.slug, 'titulo-repetido-2');
});

test('update preserva o slug quando o titulo nao mudou', async (context) => {
  const originals = { findById: Invite.findById, findByIdAndUpdate: Invite.findByIdAndUpdate };
  context.after(() => {
    Invite.findById = originals.findById;
    Invite.findByIdAndUpdate = originals.findByIdAndUpdate;
  });
  Invite.findById = () => ({ select: async () => ({ title: 'Mesmo titulo' }) });
  let updatePayload;
  Invite.findByIdAndUpdate = async (_id, update) => {
    updatePayload = update.$set;
    return { _id: actorId, slug: 'mesmo-titulo-2', ...update.$set, toObject() { return { ...this }; } };
  };

  const result = await invitesManager.update(actorId, { title: 'Mesmo titulo', description: 'Nova descricao' });
  assert.equal(updatePayload.slug, undefined);
  assert.equal(result.slug, 'mesmo-titulo-2');
});

test('convite publico expoe o icone validado sem revelar o destino bruto dos links', async (context) => {
  const original = Invite.findOne;
  context.after(() => { Invite.findOne = original; });
  Invite.findOne = () => ({ lean: async () => ({
    _id: actorId,
    slug: 'meu-convite',
    title: 'Meu convite',
    description: 'Descricao',
    iconeUrl: 'https://cdn.example.com/icon.png',
    gradientStart: '#82F8E6',
    gradientEnd: '#35BCA4',
    links: [{ _id: actorId, label: 'Abrir', channel: 'telegram', active: true, url: 'https://secret.example/path' }]
  }) });

  const result = await invitesManager.getPublic('meu-convite');
  assert.equal(result.iconeUrl, 'https://cdn.example.com/icon.png');
  assert.equal(result.links[0].url, undefined);
  assert.match(result.links[0].trackingUrl, /\/public\/invites\/meu-convite\/links\//);
});

test('link legado do Telegram vira deep-link com o comando dinamico', () => {
  assert.equal(
    invitesManager.telegramInviteRedirectUrl(
      'https://t.me/EjugNotifyBot?text=%2Fnotify-me',
      '/outro-comando'
    ),
    'https://t.me/EjugNotifyBot?start=notify-me'
  );
  assert.equal(
    invitesManager.telegramInviteRedirectUrl('https://t.me/EjugNotifyBot', '/quero alertas'),
    'https://t.me/EjugNotifyBot?start=quero-alertas'
  );
  assert.equal(
    invitesManager.telegramInviteRedirectUrl('https://example.com/telegram', '/notify-me'),
    'https://example.com/telegram'
  );
});

test('contrato simplificado de documento legal aplica publicacao e versao seguras', () => {
  const parsed = createTermSchema.safeParse({ body: {
    type: 'privacy_policy',
    title: 'Privacidade',
    content: '<p>Texto claro.</p>'
  } });
  assert.equal(parsed.success, true);
  const prepared = termsManager.createDefaults(parsed.data.body);
  assert.equal(prepared.status, 'published');
  assert.match(prepared.version, /^\d{14}-[a-f0-9]{6}$/);
  assert.ok(prepared.effectiveAt instanceof Date);
  assert.ok(prepared.publishedAt instanceof Date);
});

test('documentos legais padrao cobrem os tres tipos e informam canais, direitos e preferencias', () => {
  const documents = listDefaultLegalDocuments();
  assert.deepEqual(documents.map((document) => document.type).sort(), [
    'privacy_policy',
    'terms_of_service',
    'terms_of_use'
  ]);
  assert.deepEqual(documents.map((document) => document.title).sort(), [
    'Política de Privacidade',
    'Termos de Serviço e Comunicações',
    'Termos de Uso'
  ]);

  const combinedContent = documents.map((document) => document.content).join(' ');
  for (const expected of ['Telegram', 'Meta', 'WhatsApp', 'Google/Gmail', 'consentimento', 'revogação', 'LGPD']) {
    assert.match(combinedContent, new RegExp(expected));
  }
});

test('seed legal adota tipos existentes e cria apenas os ausentes sem sobrescrever conteudo', async (context) => {
  const originals = { exists: Term.exists, create: Term.create };
  context.after(() => {
    Term.exists = originals.exists;
    Term.create = originals.create;
  });

  const created = [];
  Term.exists = async ({ type }) => type === 'terms_of_use' ? { _id: actorId } : null;
  Term.create = async (input) => {
    created.push(input);
    return input;
  };

  const result = await termsManager.ensureDefaultTerms();

  assert.deepEqual(result, { created: 2, adopted: 1 });
  assert.deepEqual(created.map((document) => document.type), ['privacy_policy', 'terms_of_service']);
  assert.ok(created.every((document) => document.version === INITIAL_LEGAL_VERSION));
  assert.ok(created.every((document) => document.status === 'published'));
  assert.ok(created.every((document) => document.effectiveAt instanceof Date));
  assert.ok(created.every((document) => document.publishedAt instanceof Date));
});
