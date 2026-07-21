const ApiError = require('./api-error');

const WHATSAPP_CLOUD_TEMPLATE_PRESETS = Object.freeze({
  order_confirmation: Object.freeze({
    id: 'order_confirmation',
    label: 'Confirmacao de pedido',
    description: 'Template oficial de confirmacao de pedido com cliente, numero do pedido e data.',
    templateName: 'jaspers_market_order_confirmation_v1',
    languageCode: 'en_US',
    preview: 'Pedido {{orderNumber}} de {{customerName}} confirmado em {{orderDate}}.',
    parameters: Object.freeze([
      Object.freeze({ key: 'customerName', label: 'Nome do cliente', example: 'John Doe' }),
      Object.freeze({ key: 'orderNumber', label: 'Numero do pedido', example: '123456' }),
      Object.freeze({ key: 'orderDate', label: 'Data do pedido', example: 'Jul 20, 2026' })
    ])
  }),
  plain_text: Object.freeze({
    id: 'plain_text',
    label: 'Texto sem formatacao',
    description: 'Template oficial de texto simples, sem parametros.',
    templateName: 'jaspers_market_plain_text_v1',
    languageCode: 'en_US',
    preview: 'Mensagem de texto simples aprovada pela Meta.',
    parameters: Object.freeze([])
  }),
  hello_world: Object.freeze({
    id: 'hello_world',
    label: 'Ola mundo',
    description: 'Template oficial hello_world fornecido pela Meta para testes.',
    templateName: 'hello_world',
    languageCode: 'en_US',
    preview: 'Hello World',
    parameters: Object.freeze([])
  })
});

const PRESET_BY_TEMPLATE_NAME = Object.freeze(Object.fromEntries(
  Object.values(WHATSAPP_CLOUD_TEMPLATE_PRESETS).map((preset) => [preset.templateName, preset.id])
));

const PARAMETER_ALIASES = Object.freeze({
  customerName: Object.freeze(['customer_name']),
  orderNumber: Object.freeze(['order_number']),
  orderDate: Object.freeze(['order_date'])
});

function clonePreset(preset) {
  return {
    id: preset.id,
    label: preset.label,
    description: preset.description,
    templateName: preset.templateName,
    languageCode: preset.languageCode,
    preview: preset.preview,
    parameters: preset.parameters.map((parameter) => ({ ...parameter }))
  };
}

function listTemplatePresets() {
  return Object.values(WHATSAPP_CLOUD_TEMPLATE_PRESETS).map(clonePreset);
}

function getTemplatePreset(id) {
  const preset = WHATSAPP_CLOUD_TEMPLATE_PRESETS[id];
  if (!preset) {
    throw new ApiError(
      422,
      'Modelo oficial do WhatsApp Cloud invalido',
      { allowedPresets: Object.keys(WHATSAPP_CLOUD_TEMPLATE_PRESETS) },
      'WHATSAPP_TEMPLATE_PRESET_INVALID'
    );
  }
  return preset;
}

function presetFromTemplateName(templateName) {
  return PRESET_BY_TEMPLATE_NAME[templateName] || null;
}

function templateParameterPlaceholders(preset) {
  return Object.fromEntries(preset.parameters.map((parameter) => [parameter.key, '{{' + parameter.key + '}}']));
}

function parameterValue(values, key) {
  if (values[key] !== undefined && values[key] !== null) return values[key];
  for (const alias of PARAMETER_ALIASES[key] || []) {
    if (values[alias] !== undefined && values[alias] !== null) return values[alias];
  }
  return undefined;
}

function buildComponents(preset, parameters, options = {}) {
  if (!preset.parameters.length) return [];
  const values = parameters || {};
  const missing = preset.parameters
    .filter((parameter) => {
      const value = parameterValue(values, parameter.key);
      return value === undefined || String(value).trim() === '';
    })
    .map((parameter) => parameter.key);
  if (missing.length && options.requireValues !== false) {
    throw new ApiError(
      422,
      'Preencha todos os campos do template oficial',
      { preset: preset.id, missingParameters: missing },
      'WHATSAPP_TEMPLATE_PARAMETERS_REQUIRED'
    );
  }
  return [{
    type: 'body',
    parameters: preset.parameters.map((parameter) => ({
      type: 'text',
      text: String(parameterValue(values, parameter.key) ?? '')
    }))
  }];
}

function buildOfficialTemplateMessage(officialTemplate) {
  const preset = getTemplatePreset(officialTemplate?.preset);
  const components = buildComponents(preset, officialTemplate?.parameters);
  const template = {
    name: preset.templateName,
    language: { code: preset.languageCode }
  };
  if (components.length) template.components = components;
  return { type: 'template', template };
}

function officialTemplateInputForPreset(presetId) {
  const preset = getTemplatePreset(presetId);
  return {
    preset: preset.id,
    parameters: templateParameterPlaceholders(preset)
  };
}

function normalizeOfficialTemplateDefinition(input) {
  const inferredPreset = input.whatsappCloudPreset || presetFromTemplateName(input.externalTemplateName);
  if (!inferredPreset) return { ...input };
  const preset = getTemplatePreset(inferredPreset);
  const placeholders = templateParameterPlaceholders(preset);
  const components = buildComponents(preset, placeholders, { requireValues: false });
  return {
    ...input,
    templateType: 'approved_template',
    whatsappCloudPreset: preset.id,
    externalTemplateName: preset.templateName,
    languageCode: preset.languageCode,
    body: input.body || preset.preview,
    payload: components.length ? { components } : {}
  };
}

module.exports = {
  WHATSAPP_CLOUD_TEMPLATE_PRESETS,
  listTemplatePresets,
  getTemplatePreset,
  presetFromTemplateName,
  buildOfficialTemplateMessage,
  officialTemplateInputForPreset,
  normalizeOfficialTemplateDefinition
};
