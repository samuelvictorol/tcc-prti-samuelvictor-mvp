const test = require('node:test');
const assert = require('node:assert/strict');

const Template = require('../src/models/template.model');
const TemplateSet = require('../src/models/template-set.model');
const Notification = require('../src/models/notification.model');
const templatesManager = require('../src/managers/templates.manager');
const { createTemplateSchema } = require('../src/dtos/templates.dto');
const {
  SYSTEM_TEMPLATE_DEFINITIONS,
  RETIRED_SYSTEM_TEMPLATE_KEYS,
  FIXED_WHATSAPP_TEMPLATE_NAMES,
  listSystemTemplateDefinitions
} = require('../src/utils/system-templates');

function queryResult(value) {
  return {
    select() { return this; },
    lean: async () => value
  };
}

function withoutSystemFields(definition) {
  const template = structuredClone(definition);
  delete template.systemKey;
  return template;
}

test('define os tres templates WhatsApp fixos com nomes oficiais e idiomas exatos', () => {
  assert.deepEqual(FIXED_WHATSAPP_TEMPLATE_NAMES, [
    'jaspers_market_plain_text_v1',
    'jaspers_market_order_confirmation_v1',
    '3p_direct_integration_test_template'
  ]);
  assert.equal(SYSTEM_TEMPLATE_DEFINITIONS.length, 3);
  assert.deepEqual(RETIRED_SYSTEM_TEMPLATE_KEYS, ['whatsapp_cloud.verify_code_1']);
  for (const definition of listSystemTemplateDefinitions()) {
    assert.equal(definition.channel, 'whatsapp_cloud');
    assert.equal(definition.templateType, 'approved_template');
    assert.equal(definition.active, true);
    assert.equal(createTemplateSchema.safeParse({ body: withoutSystemFields(definition) }).success, true);
  }
});

test('template de integracao do numero de producao usa nome e payload oficiais sem parametros', () => {
  const definition = listSystemTemplateDefinitions()
    .find((item) => item.externalTemplateName === '3p_direct_integration_test_template');
  const normalized = templatesManager.normalizeTemplateInput(definition);
  assert.equal(normalized.name, 'OFICIAL META PROD NUMBER');
  assert.equal(normalized.languageCode, 'en_US');
  assert.equal(normalized.whatsappCloudPreset, 'custom');
  assert.deepEqual(normalized.variables, []);
  assert.deepEqual(normalized.payload.builder, { version: 1, components: [] });
  assert.deepEqual(normalized.payload.components, []);
});

test('seed cria somente ausentes e e idempotente sem sobrescrever personalizacoes', async () => {
  const originals = {
    find: Template.find,
    findOne: Template.findOne,
    create: Template.create,
    updateOne: Template.updateOne,
    deleteOne: Template.deleteOne
  };
  const created = [];
  const updates = [];
  try {
    Template.find = () => queryResult([]);
    Template.findOne = () => ({ lean: async () => null });
    Template.create = async (value) => { created.push(value); return value; };
    Template.updateOne = async (...args) => { updates.push(args); return { modifiedCount: 1 }; };
    assert.deepEqual(await templatesManager.ensureSystemTemplates(), {
      created: 3,
      protected: 0,
      existing: 0,
      retired: 0,
      retiredRetained: 0
    });
    assert.equal(created.length, 3);
    assert.equal(created.every((item) => item.systemManaged === true), true);

    let index = 0;
    const existing = listSystemTemplateDefinitions().map((definition) => ({
      _id: 'existing-' + definition.systemKey,
      ...definition,
      name: 'Nome personalizado ' + definition.externalTemplateName,
      description: 'Descricao personalizada',
      systemKey: undefined,
      systemManaged: false
    }));
    Template.findOne = () => ({ lean: async () => existing[index++] });
    created.length = 0;
    updates.length = 0;
    assert.deepEqual(await templatesManager.ensureSystemTemplates(), {
      created: 0,
      protected: 3,
      existing: 0,
      retired: 0,
      retiredRetained: 0
    });
    assert.equal(created.length, 0);
    assert.equal(updates.length, 3);
    for (const [, update] of updates) {
      assert.deepEqual(Object.keys(update.$set).sort(), ['systemKey', 'systemManaged']);
      assert.equal(update.$set.systemManaged, true);
      assert.equal(update.$set.name, undefined);
      assert.equal(update.$set.description, undefined);
      assert.equal(update.$set.payload, undefined);
    }
  } finally {
    Template.find = originals.find;
    Template.findOne = originals.findOne;
    Template.create = originals.create;
    Template.updateOne = originals.updateOne;
    Template.deleteOne = originals.deleteOne;
  }
});

test('aposentadoria preserva template referenciado como inativo e remove somente o orfao', async () => {
  const originals = {
    find: Template.find,
    updateOne: Template.updateOne,
    deleteOne: Template.deleteOne,
    setExists: TemplateSet.exists,
    notificationExists: Notification.exists
  };
  const retiredTemplate = {
    _id: 'retired-template-id',
    systemKey: 'whatsapp_cloud.verify_code_1',
    active: true
  };
  const updates = [];
  const deletes = [];
  try {
    Template.find = () => queryResult([retiredTemplate]);
    Template.updateOne = async (...args) => { updates.push(args); return { modifiedCount: 1 }; };
    Template.deleteOne = async (...args) => { deletes.push(args); return { deletedCount: 1 }; };

    TemplateSet.exists = async () => ({ _id: 'set-id' });
    Notification.exists = async () => null;
    assert.deepEqual(await templatesManager.retireSystemTemplates(), { deletedCount: 0, retainedCount: 1 });
    assert.deepEqual(updates.at(-1), [
      { _id: retiredTemplate._id },
      { $set: { active: false } }
    ]);
    assert.equal(deletes.length, 0);

    TemplateSet.exists = async () => null;
    Notification.exists = async () => ({ _id: 'notification-id' });
    assert.deepEqual(await templatesManager.retireSystemTemplates(), { deletedCount: 0, retainedCount: 1 });
    assert.equal(updates.length, 2);
    assert.equal(deletes.length, 0);

    Notification.exists = async () => null;
    assert.deepEqual(await templatesManager.retireSystemTemplates(), { deletedCount: 1, retainedCount: 0 });
    assert.equal(deletes.length, 1);
  } finally {
    Template.find = originals.find;
    Template.updateOne = originals.updateOne;
    Template.deleteOne = originals.deleteOne;
    TemplateSet.exists = originals.setExists;
    Notification.exists = originals.notificationExists;
  }
});

test('API recusa excluir template fixo inclusive pela regra de nome oficial', async () => {
  const originals = { findById: Template.findById, deleteOne: Template.deleteOne };
  let deleteCalled = false;
  try {
    Template.findById = () => ({ lean: async () => ({
      _id: 'system-id',
      name: 'Texto sem formatacao',
      channel: 'whatsapp_cloud',
      externalTemplateName: 'jaspers_market_plain_text_v1',
      systemManaged: false
    }) });
    Template.deleteOne = async () => { deleteCalled = true; return { deletedCount: 1 }; };
    await assert.rejects(
      templatesManager.remove('system-id'),
      (error) => error.code === 'SYSTEM_TEMPLATE_DELETE_FORBIDDEN' && error.statusCode === 409
    );
    assert.equal(deleteCalled, false);
  } finally {
    Template.findById = originals.findById;
    Template.deleteOne = originals.deleteOne;
  }
});

test('serializer informa explicitamente quando exclusao e permitida', () => {
  const fixed = templatesManager.serializeTemplate({
    _id: 'fixed', channel: 'whatsapp_cloud', externalTemplateName: 'jaspers_market_plain_text_v1'
  });
  const custom = templatesManager.serializeTemplate({
    _id: 'custom', channel: 'whatsapp_cloud', externalTemplateName: 'minha_campanha_v1'
  });
  assert.equal(fixed.systemManaged, true);
  assert.equal(fixed.deletable, false);
  assert.equal(custom.systemManaged, false);
  assert.equal(custom.deletable, true);
});

test('template oficial do numero de producao tambem nao pode ser excluido', async () => {
  const originals = { findById: Template.findById, deleteOne: Template.deleteOne };
  let deleteCalled = false;
  try {
    Template.findById = () => ({ lean: async () => ({
      _id: 'prod-system-id',
      channel: 'whatsapp_cloud',
      externalTemplateName: '3p_direct_integration_test_template',
      systemManaged: false
    }) });
    Template.deleteOne = async () => { deleteCalled = true; return { deletedCount: 1 }; };
    await assert.rejects(
      templatesManager.remove('prod-system-id'),
      (error) => error.code === 'SYSTEM_TEMPLATE_DELETE_FORBIDDEN' && error.statusCode === 409
    );
    assert.equal(deleteCalled, false);
  } finally {
    Template.findById = originals.findById;
    Template.deleteOne = originals.deleteOne;
  }
});
