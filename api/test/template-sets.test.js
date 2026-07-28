const test = require('node:test');
const assert = require('node:assert/strict');
const TemplateSet = require('../src/models/template-set.model');
const Template = require('../src/models/template.model');
const Invite = require('../src/models/invite.model');
const logsManager = require('../src/managers/logs.manager');
const templateSetsManager = require('../src/managers/template-sets.manager');
const templatesManager = require('../src/managers/templates.manager');
const invitesManager = require('../src/managers/invites.manager');
const {
  createTemplateSetSchema,
  updateTemplateSetSchema,
  listTemplateSetsSchema
} = require('../src/dtos/template-sets.dto');

const IDS = {
  admin: '507f1f77bcf86cd799439001',
  set: '507f1f77bcf86cd799439002',
  invite: '507f1f77bcf86cd799439003',
  telegram: '507f1f77bcf86cd799439004',
  email: '507f1f77bcf86cd799439005',
  cloud: '507f1f77bcf86cd799439006'
};

function queryResult(value) {
  return {
    select() { return this; },
    sort() { return this; },
    skip() { return this; },
    limit() { return this; },
    lean: async () => value
  };
}

function templates() {
  return [
    { _id: IDS.telegram, name: 'Telegram', channel: 'telegram', templateType: 'telegram_text', active: true },
    { _id: IDS.email, name: 'Email', channel: 'email', templateType: 'html', active: true },
    {
      _id: IDS.cloud,
      name: 'WhatsApp',
      channel: 'whatsapp_cloud',
      templateType: 'approved_template',
      whatsappCloudPreset: 'custom',
      active: true
    }
  ];
}

test('DTO de conjunto aceita de um a tres canais e rejeita mapa vazio ou chaves extras', () => {
  const one = createTemplateSetSchema.safeParse({
    body: {
      name: 'Boas-vindas',
      inviteId: IDS.invite,
      templateIds: { telegram: IDS.telegram }
    }
  });
  assert.equal(one.success, true);

  const three = createTemplateSetSchema.safeParse({
    body: {
      name: 'Onboarding completo',
      description: 'Um template por canal',
      templateIds: {
        telegram: IDS.telegram,
        whatsapp_cloud: IDS.cloud,
        email: IDS.email
      }
    }
  });
  assert.equal(three.success, true);

  assert.equal(createTemplateSetSchema.safeParse({
    body: { name: 'Vazio', templateIds: {} }
  }).success, false);
  assert.equal(createTemplateSetSchema.safeParse({
    body: { name: 'Invalido', templateIds: { global: IDS.telegram } }
  }).success, false);
  assert.equal(updateTemplateSetSchema.safeParse({
    params: { id: IDS.set },
    body: { templateIds: {} }
  }).success, false);
  assert.equal(listTemplateSetsSchema.safeParse({
    query: { search: 'convite vip', inviteId: IDS.invite, templateId: IDS.email }
  }).success, true);
});

test('valida existencia, atividade e correspondencia de canal dos templates', async (context) => {
  const original = Template.find;
  context.after(() => { Template.find = original; });

  Template.find = () => queryResult(templates());
  const valid = await templateSetsManager.assertTemplates({
    telegram: IDS.telegram,
    email: IDS.email
  });
  assert.deepEqual(valid.templateIds, { telegram: IDS.telegram, email: IDS.email });

  await assert.rejects(
    () => templateSetsManager.assertTemplates({ email: IDS.telegram }),
    (error) => error.code === 'TEMPLATE_SET_CHANNEL_MISMATCH' && error.details.expectedChannel === 'email'
  );

  Template.find = () => queryResult([{ ...templates()[0], active: false }]);
  await assert.rejects(
    () => templateSetsManager.assertTemplates({ telegram: IDS.telegram }),
    (error) => error.code === 'TEMPLATE_SET_TEMPLATE_INACTIVE'
  );

  Template.find = () => queryResult([]);
  await assert.rejects(
    () => templateSetsManager.assertTemplates({ telegram: IDS.telegram }),
    (error) => error.code === 'TEMPLATE_SET_TEMPLATE_NOT_FOUND'
  );
});

test('CRUD cria conjunto auditado, serializa somente resumos seguros e permite reutilizar templates', async (context) => {
  const originals = {
    templateFind: Template.find,
    inviteFindById: Invite.findById,
    inviteFind: Invite.find,
    setCreate: TemplateSet.create,
    setFindById: TemplateSet.findById,
    setDelete: TemplateSet.findByIdAndDelete,
    log: logsManager.create
  };
  context.after(() => {
    Template.find = originals.templateFind;
    Invite.findById = originals.inviteFindById;
    Invite.find = originals.inviteFind;
    TemplateSet.create = originals.setCreate;
    TemplateSet.findById = originals.setFindById;
    TemplateSet.findByIdAndDelete = originals.setDelete;
    logsManager.create = originals.log;
  });

  const invite = { _id: IDS.invite, title: 'Convite VIP', slug: 'convite-vip', active: true };
  const sourceTemplates = templates().map((item) => ({ ...item, payload: { secret: 'nao-expor' }, body: 'conteudo' }));
  let stored;
  Template.find = () => queryResult(sourceTemplates);
  Invite.findById = () => queryResult(invite);
  Invite.find = () => queryResult([invite]);
  TemplateSet.create = async (input) => {
    stored = { _id: IDS.set, ...input, createdAt: new Date(), updatedAt: new Date() };
    return stored;
  };
  TemplateSet.findById = () => queryResult(stored);
  const logs = [];
  logsManager.create = async (input) => { logs.push(input); return input; };

  const created = await templateSetsManager.create({
    name: 'Campanha VIP',
    description: 'Conjunto reutilizavel',
    inviteId: IDS.invite,
    templateIds: { telegram: IDS.telegram, email: IDS.email }
  }, IDS.admin);

  assert.deepEqual(created.templateIds, { telegram: IDS.telegram, email: IDS.email });
  assert.equal(created.invite.slug, 'convite-vip');
  assert.equal(created.templateCount, 2);
  assert.equal(created.templates.telegram.payload, undefined);
  assert.equal(created.templates.telegram.body, undefined);
  assert.equal(created.integrity.valid, true);
  assert.equal(logs[0].action, 'template_set.created');
  assert.deepEqual(stored.templates, { telegram: IDS.telegram, email: IDS.email });

  // Nao ha indice unico nos IDs: o mesmo template pode integrar outros conjuntos.
  assert.equal(
    TemplateSet.schema.indexes().some(([fields, options]) => (
      options.unique && Object.keys(fields).some((field) => field.startsWith('templates.'))
    )),
    false
  );

  TemplateSet.findByIdAndDelete = () => queryResult(stored);
  const removed = await templateSetsManager.remove(IDS.set, IDS.admin);
  assert.deepEqual(removed, { id: IDS.set, removed: true });
  assert.equal(logs.at(-1).action, 'template_set.deleted');
});

test('busca inclui nome/descricao do conjunto e titulo/slug do convite, com filtros exatos', async (context) => {
  const originals = {
    templateFind: Template.find,
    inviteFind: Invite.find,
    setFind: TemplateSet.find,
    setCount: TemplateSet.countDocuments
  };
  context.after(() => {
    Template.find = originals.templateFind;
    Invite.find = originals.inviteFind;
    TemplateSet.find = originals.setFind;
    TemplateSet.countDocuments = originals.setCount;
  });

  const set = {
    _id: IDS.set,
    name: 'Avisos',
    invite: IDS.invite,
    templates: { telegram: IDS.telegram },
    createdBy: IDS.admin,
    updatedBy: IDS.admin
  };
  let setFilter;
  Invite.find = (filter) => {
    if (filter.$or) return queryResult([{ _id: IDS.invite }]);
    return queryResult([{ _id: IDS.invite, title: 'Convite Escola', slug: 'convite-escola', active: true }]);
  };
  Template.find = () => queryResult([templates()[0]]);
  TemplateSet.find = (filter) => {
    setFilter = filter;
    return queryResult([set]);
  };
  TemplateSet.countDocuments = async () => 1;

  const result = await templateSetsManager.list({
    search: 'escola',
    inviteId: IDS.invite,
    templateId: IDS.telegram,
    page: 1,
    limit: 10
  });

  assert.equal(result.total, 1);
  assert.equal(result.items[0].invite.title, 'Convite Escola');
  assert.equal(setFilter.invite, IDS.invite);
  assert.ok(Array.isArray(setFilter.$and));
  assert.match(JSON.stringify(setFilter), /templates\.telegram/);
});

test('resolucao para disparo recusa convite removido e preserva mapa por canal', async (context) => {
  const originals = {
    templateFind: Template.find,
    inviteFindById: Invite.findById,
    setFindById: TemplateSet.findById
  };
  context.after(() => {
    Template.find = originals.templateFind;
    Invite.findById = originals.inviteFindById;
    TemplateSet.findById = originals.setFindById;
  });

  TemplateSet.findById = () => queryResult({
    _id: IDS.set,
    invite: IDS.invite,
    templates: { telegram: IDS.telegram, email: IDS.email }
  });
  Template.find = () => queryResult(templates());
  Invite.findById = () => queryResult(null);

  await assert.rejects(
    () => templateSetsManager.resolveForNotification(IDS.set),
    (error) => error.code === 'TEMPLATE_SET_INVITE_NOT_FOUND'
  );

  Invite.findById = () => queryResult({ _id: IDS.invite, active: false });
  const resolved = await templateSetsManager.resolveForNotification(IDS.set);
  assert.deepEqual(resolved.templateIds, { telegram: IDS.telegram, email: IDS.email });
  assert.equal(resolved.templates.telegram.channel, 'telegram');
});

test('template e convite vinculados nao podem ser removidos deixando referencias quebradas', async (context) => {
  const originals = {
    templateFindById: Template.findById,
    templateDelete: Template.deleteOne,
    inviteDelete: Invite.deleteOne,
    setFindOne: TemplateSet.findOne
  };
  context.after(() => {
    Template.findById = originals.templateFindById;
    Template.deleteOne = originals.templateDelete;
    Invite.deleteOne = originals.inviteDelete;
    TemplateSet.findOne = originals.setFindOne;
  });

  Template.findById = () => queryResult({
    _id: IDS.telegram,
    name: 'Telegram',
    channel: 'telegram',
    active: true,
    systemManaged: false
  });
  TemplateSet.findOne = () => queryResult({ _id: IDS.set, name: 'Campanha VIP' });
  let templateDeleted = false;
  let inviteDeleted = false;
  Template.deleteOne = async () => { templateDeleted = true; return { deletedCount: 1 }; };
  Invite.deleteOne = async () => { inviteDeleted = true; return { deletedCount: 1 }; };

  await assert.rejects(
    () => templatesManager.remove(IDS.telegram),
    (error) => error.code === 'TEMPLATE_IN_USE_BY_SET' && error.statusCode === 409
  );
  await assert.rejects(
    () => invitesManager.remove(IDS.invite),
    (error) => error.code === 'INVITE_IN_USE_BY_TEMPLATE_SET' && error.statusCode === 409
  );
  assert.equal(templateDeleted, false);
  assert.equal(inviteDeleted, false);
});

test('template vinculado nao pode mudar de canal nem ser desativado', async (context) => {
  const originals = {
    templateFindById: Template.findById,
    templateUpdate: Template.findByIdAndUpdate,
    setFindOne: TemplateSet.findOne
  };
  context.after(() => {
    Template.findById = originals.templateFindById;
    Template.findByIdAndUpdate = originals.templateUpdate;
    TemplateSet.findOne = originals.setFindOne;
  });

  Template.findById = () => queryResult({
    _id: IDS.telegram,
    name: 'Telegram',
    channel: 'telegram',
    templateType: 'telegram_text',
    body: 'Ola',
    payload: { telegram: { kind: 'text', text: 'Ola' } },
    active: true,
    systemManaged: false
  });
  TemplateSet.findOne = () => queryResult({ _id: IDS.set, name: 'Campanha VIP' });
  let updateCalled = false;
  Template.findByIdAndUpdate = () => {
    updateCalled = true;
    return queryResult(null);
  };

  await assert.rejects(
    () => templatesManager.update(IDS.telegram, { channel: 'email' }, IDS.admin),
    (error) => error.code === 'TEMPLATE_IN_USE_BY_SET'
      && error.statusCode === 409
      && error.details.fields.includes('channel')
  );
  await assert.rejects(
    () => templatesManager.update(IDS.telegram, { active: false }, IDS.admin),
    (error) => error.code === 'TEMPLATE_IN_USE_BY_SET'
      && error.statusCode === 409
      && error.details.fields.includes('active')
  );
  assert.equal(updateCalled, false);
});
