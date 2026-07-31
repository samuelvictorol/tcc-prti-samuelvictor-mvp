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

const CUSTOM_COMPONENT_TYPES = Object.freeze(['header', 'body', 'button']);
const CUSTOM_PARAMETER_TYPES = Object.freeze(['text', 'currency', 'date_time', 'image', 'document', 'video', 'payload', 'coupon_code']);
const BUTTON_SUB_TYPES = Object.freeze(['url', 'quick_reply', 'copy_code', 'otp_copy_code']);

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
  return [
    ...Object.values(WHATSAPP_CLOUD_TEMPLATE_PRESETS).map(clonePreset),
    {
      id: 'custom',
      label: 'Template oficial personalizado',
      description: 'Use o nome e o idioma de um template ja aprovado na Meta e monte os parametros em campos guiados.',
      templateName: null,
      languageCode: null,
      preview: null,
      parameters: [],
      builderVersion: 1
    }
  ];
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

function templateError(message, details, code = 'WHATSAPP_TEMPLATE_BUILDER_INVALID') {
  throw new ApiError(422, message, details, code);
}

function normalizeBuilder(builder) {
  if (!builder || Number(builder.version) !== 1 || !Array.isArray(builder.components)) {
    templateError('Builder do template WhatsApp Cloud invalido', { expectedVersion: 1 });
  }
  if (builder.components.length > 20) templateError('Builder excede o limite de 20 componentes');
  const seenComponentIds = new Set();
  const seenSingletonTypes = new Set();
  const seenButtonIndexes = new Set();
  const normalized = builder.components.map((component, componentIndex) => {
    const type = String(component.type || '').toLowerCase();
    if (!CUSTOM_COMPONENT_TYPES.includes(type)) templateError('Tipo de componente Meta invalido', { componentIndex, type });
    if (['header', 'body'].includes(type)) {
      if (seenSingletonTypes.has(type)) {
        templateError('Template permite no maximo um componente ' + type, { componentIndex, type });
      }
      seenSingletonTypes.add(type);
    }
    const id = String(component.id || type + '-' + componentIndex).trim().slice(0, 80);
    if (!id || seenComponentIds.has(id)) templateError('IDs de componentes devem ser unicos', { componentIndex, id });
    seenComponentIds.add(id);
    const subType = component.subType || component.sub_type;
    const buttonIndex = component.index;
    if (type === 'button') {
      if (!BUTTON_SUB_TYPES.includes(subType)) templateError('Botao exige subType url, quick_reply, copy_code ou otp_copy_code', { componentIndex });
      if (!/^[0-9]$/.test(String(buttonIndex ?? ''))) templateError('Botao exige index entre 0 e 9', { componentIndex });
      const normalizedButtonIndex = String(buttonIndex);
      if (seenButtonIndexes.has(normalizedButtonIndex)) {
        templateError('Indices de button devem ser unicos', { componentIndex, index: normalizedButtonIndex });
      }
      seenButtonIndexes.add(normalizedButtonIndex);
    } else if (subType !== undefined || buttonIndex !== undefined) {
      templateError('subType e index sao exclusivos de componentes button', { componentIndex });
    }
    if (!Array.isArray(component.parameters) || component.parameters.length > 20) {
      templateError('Componente deve possuir uma lista de ate 20 parametros', { componentIndex });
    }
    if (['header', 'button'].includes(type) && component.parameters.length > 1) {
      templateError(type + ' aceita no maximo um parametro', { componentIndex, type });
    }
    const seenParameterIds = new Set();
    const parameters = component.parameters.map((parameter, parameterIndex) => {
      const parameterType = String(parameter.type || '').toLowerCase();
      if (!CUSTOM_PARAMETER_TYPES.includes(parameterType)) {
        templateError('Tipo de parametro Meta invalido', { componentIndex, parameterIndex, type: parameterType });
      }
      if (type === 'header' && !['text', 'image', 'document', 'video'].includes(parameterType)) {
        templateError('Header aceita apenas text, image, document e video', { componentIndex, parameterIndex });
      }
      if (type === 'body' && !['text', 'currency', 'date_time'].includes(parameterType)) {
        templateError('Body aceita apenas text, currency e date_time', { componentIndex, parameterIndex });
      }
      if (type === 'button' && !['text', 'payload', 'coupon_code'].includes(parameterType)) {
        templateError('Button aceita text, payload ou coupon_code', { componentIndex, parameterIndex });
      }
      if (type === 'button' && subType === 'url' && parameterType !== 'text') {
        templateError('Botao URL aceita parametro text', { componentIndex, parameterIndex });
      }
      if (type === 'button' && subType === 'quick_reply' && parameterType !== 'payload') {
        templateError('Botao quick_reply aceita parametro payload', { componentIndex, parameterIndex });
      }
      if (type === 'button' && subType === 'copy_code' && parameterType !== 'coupon_code') {
        templateError('Botao copy_code aceita parametro coupon_code', { componentIndex, parameterIndex });
      }
      if (type === 'button' && subType === 'otp_copy_code' && parameterType !== 'text') {
        templateError('Botao OTP para copiar codigo aceita parametro text', { componentIndex, parameterIndex });
      }
      if (type !== 'header' && ['image', 'document', 'video'].includes(parameterType)) {
        templateError('Midia image/document/video so pode ser usada no header', { componentIndex, parameterIndex });
      }
      if (parameterType === 'payload' && (type !== 'button' || subType !== 'quick_reply')) {
        templateError('Payload so pode ser usado em botao quick_reply', { componentIndex, parameterIndex });
      }
      if (parameterType === 'coupon_code' && (type !== 'button' || subType !== 'copy_code')) {
        templateError('coupon_code so pode ser usado em botao copy_code', { componentIndex, parameterIndex });
      }
      const key = String(parameter.key || '').trim();
      if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) {
        templateError('Chave de parametro invalida', { componentIndex, parameterIndex, key });
      }
      const parameterId = String(parameter.id || id + '-parameter-' + parameterIndex).trim().slice(0, 80);
      if (!parameterId || seenParameterIds.has(parameterId)) {
        templateError('IDs de parametros devem ser unicos no componente', { componentIndex, parameterIndex, id: parameterId });
      }
      seenParameterIds.add(parameterId);
      const output = {
        id: parameterId,
        type: parameterType,
        key,
        label: String(parameter.label || key).trim().slice(0, 160),
        example: parameter.example === undefined || parameter.example === null ? undefined : String(parameter.example).slice(0, 1000)
      };
      const parameterName = String(parameter.parameterName || parameter.parameter_name || '').trim();
      if (parameterName) {
        if (type === 'button') templateError('Botoes Meta usam parametros posicionais', { componentIndex, parameterIndex });
        if (!/^[a-z][a-z0-9_]{0,63}$/.test(parameterName)) {
          templateError('Nome do parametro Meta invalido', { componentIndex, parameterIndex, parameterName });
        }
        output.parameterName = parameterName;
      }
      if (parameterType === 'currency' && parameter.currencyCode) output.currencyCode = String(parameter.currencyCode).toUpperCase().slice(0, 3);
      if (parameterType === 'document' && parameter.filename) output.filename = String(parameter.filename).slice(0, 240);
      if (['image', 'document', 'video'].includes(parameterType)) {
        const mediaSource = String(parameter.mediaSource || 'url').trim().toLowerCase();
        if (!['url', 'upload'].includes(mediaSource)) {
          templateError('Origem da midia invalida', { componentIndex, parameterIndex, mediaSource });
        }
        output.mediaSource = mediaSource;
        const mediaAssetId = String(parameter.mediaAssetId || '').trim();
        if (mediaAssetId) {
          if (!/^[a-f\d]{24}$/i.test(mediaAssetId)) {
            templateError('Identificador da midia armazenada invalido', { componentIndex, parameterIndex });
          }
          output.mediaAssetId = mediaAssetId;
        }
        if (mediaSource === 'upload' && !mediaAssetId) {
          templateError('Upload de midia exige o identificador do arquivo armazenado', { componentIndex, parameterIndex });
        }
        const mimeType = String(parameter.mimeType || '').trim().toLowerCase();
        if (mimeType) output.mimeType = mimeType.slice(0, 160);
        const mediaType = String(parameter.mediaType || parameterType).trim().toLowerCase();
        if (mediaType !== parameterType) {
          templateError('Tipo da midia armazenada difere do parametro Meta', { componentIndex, parameterIndex, mediaType, parameterType });
        }
        output.mediaType = mediaType;
        const uploadedFilename = String(parameter.uploadedFilename || '').trim();
        if (uploadedFilename) output.uploadedFilename = uploadedFilename.slice(0, 240);
      }
      return output;
    });
    const namedCount = parameters.filter((parameter) => parameter.parameterName).length;
    if (namedCount > 0 && namedCount !== parameters.length) {
      templateError('Nao misture parametros nomeados e posicionais no mesmo componente', { componentIndex });
    }
    return {
      id,
      type,
      ...(type === 'button' ? { subType, index: String(buttonIndex) } : {}),
      parameters
    };
  });
  return { version: 1, components: normalized };
}

function placeholderForParameter(parameter) {
  const placeholder = '{{' + parameter.key + '}}';
  if (parameter.type === 'text') return { type: 'text', text: placeholder };
  if (parameter.type === 'currency') {
    return {
      type: 'currency',
      currency: {
        fallback_value: parameter.example || placeholder,
        code: parameter.currencyCode || '{{' + parameter.key + '_code}}',
        amount_1000: '{{' + parameter.key + '_amount_1000}}'
      }
    };
  }
  if (parameter.type === 'date_time') return { type: 'date_time', date_time: { fallback_value: placeholder } };
  if (['image', 'document', 'video'].includes(parameter.type)) {
    return {
      type: parameter.type,
      [parameter.type]: { link: placeholder, ...(parameter.type === 'document' && parameter.filename ? { filename: parameter.filename } : {}) }
    };
  }
  if (parameter.type === 'coupon_code') return { type: 'coupon_code', coupon_code: placeholder };
  return { type: 'payload', payload: placeholder };
}

function builderComponents(builder) {
  const normalized = normalizeBuilder(builder);
  return normalized.components.map((component) => ({
    type: component.type,
    ...(component.type === 'button' ? { sub_type: component.subType === 'otp_copy_code' ? 'url' : component.subType, index: component.index } : {}),
    parameters: component.parameters.map((parameter) => ({
      ...placeholderForParameter(parameter),
      ...(parameter.parameterName ? { parameter_name: parameter.parameterName } : {})
    }))
  }));
}

function requiredVariable(variables, parameter) {
  const value = variables?.[parameter.key];
  if (value === undefined || value === null || value === '') {
    templateError(
      'Preencha todos os campos do template oficial',
      { missingParameters: [parameter.key] },
      'WHATSAPP_TEMPLATE_PARAMETERS_REQUIRED'
    );
  }
  return value;
}

function runtimeParameter(parameter, variables) {
  const value = requiredVariable(variables, parameter);
  if (parameter.type === 'text') {
    const text = typeof value === 'object' ? value.text : value;
    if (text === undefined || text === null) templateError('Parametro text invalido', { key: parameter.key });
    return { type: 'text', text: String(text) };
  }
  if (parameter.type === 'date_time') {
    const source = typeof value === 'object' ? value : { fallback_value: String(value) };
    const allowed = ['fallback_value', 'day_of_week', 'year', 'month', 'day_of_month', 'hour', 'minute', 'calendar'];
    const dateTime = Object.fromEntries(Object.entries(source).filter(([key]) => allowed.includes(key)));
    if (source.fallbackValue !== undefined && dateTime.fallback_value === undefined) dateTime.fallback_value = String(source.fallbackValue);
    if (!Object.keys(dateTime).length) templateError('Parametro date_time invalido', { key: parameter.key });
    return { type: 'date_time', date_time: dateTime };
  }
  if (parameter.type === 'currency') {
    let currency;
    if (typeof value === 'object') {
      currency = {
        fallback_value: String(value.fallbackValue ?? value.fallback_value ?? parameter.example ?? ''),
        code: String(value.code ?? parameter.currencyCode ?? '').toUpperCase(),
        amount_1000: Number(value.amount1000 ?? value.amount_1000)
      };
    } else {
      const numeric = Number(value);
      currency = {
        fallback_value: parameter.example || String(value),
        code: String(parameter.currencyCode || '').toUpperCase(),
        amount_1000: Math.round(numeric * 1000)
      };
    }
    if (!/^[A-Z]{3}$/.test(currency.code) || !Number.isSafeInteger(currency.amount_1000)) {
      templateError('Currency exige codigo ISO de 3 letras e valor numerico', { key: parameter.key });
    }
    return { type: 'currency', currency };
  }
  if (['image', 'document', 'video'].includes(parameter.type)) {
    const source = typeof value === 'object' ? value : { link: String(value) };
    const allowed = parameter.type === 'document' ? ['id', 'link', 'filename'] : ['id', 'link'];
    const media = Object.fromEntries(Object.entries(source).filter(([key]) => allowed.includes(key)));
    if (!media.id && !media.link) templateError('Midia exige link HTTPS ou media id', { key: parameter.key });
    if (media.link && !/^https:\/\//i.test(String(media.link))) templateError('Link de midia deve usar HTTPS', { key: parameter.key });
    if (parameter.type === 'document' && parameter.filename && !media.filename) media.filename = parameter.filename;
    return { type: parameter.type, [parameter.type]: media };
  }
  if (parameter.type === 'coupon_code') {
    const couponCode = typeof value === 'object' ? value.couponCode ?? value.coupon_code : value;
    if (couponCode === undefined || couponCode === null) templateError('Parametro coupon_code invalido', { key: parameter.key });
    return { type: 'coupon_code', coupon_code: String(couponCode) };
  }
  const payload = typeof value === 'object' ? value.payload : value;
  if (payload === undefined || payload === null) templateError('Parametro payload invalido', { key: parameter.key });
  return { type: 'payload', payload: String(payload) };
}

function buildCustomTemplateMessage(customTemplate) {
  const name = String(customTemplate?.name || '').trim();
  const languageCode = String(customTemplate?.languageCode || '').trim();
  if (!/^[a-z0-9_]{1,512}$/.test(name)) templateError('Nome oficial Meta invalido', { field: 'externalTemplateName' });
  if (!/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(languageCode)) templateError('Codigo de idioma Meta invalido', { field: 'languageCode' });
  const builder = normalizeBuilder(customTemplate.builder);
  const components = builder.components
    .filter((component) => component.parameters.length > 0)
    .map((component) => ({
      type: component.type,
      ...(component.type === 'button' ? { sub_type: component.subType === 'otp_copy_code' ? 'url' : component.subType, index: component.index } : {}),
      parameters: component.parameters.map((parameter) => ({
        ...runtimeParameter(parameter, customTemplate.variables || {}),
        ...(parameter.parameterName ? { parameter_name: parameter.parameterName } : {})
      }))
    }));
  return {
    type: 'template',
    template: {
      name,
      language: { code: languageCode },
      ...(components.length ? { components } : {})
    }
  };
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
  if (inferredPreset === 'custom') {
    const name = String(input.externalTemplateName || '').trim();
    const languageCode = String(input.languageCode || '').trim();
    if (!/^[a-z0-9_]{1,512}$/.test(name)) templateError('Nome oficial Meta invalido', { field: 'externalTemplateName' });
    if (!/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(languageCode)) templateError('Codigo de idioma Meta invalido', { field: 'languageCode' });
    const builder = normalizeBuilder(input.payload?.builder);
    return {
      ...input,
      templateType: 'approved_template',
      whatsappCloudPreset: 'custom',
      externalTemplateName: name,
      languageCode,
      payload: { builder, components: builderComponents(builder) }
    };
  }
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
  normalizeBuilder,
  builderComponents,
  buildOfficialTemplateMessage,
  buildCustomTemplateMessage,
  officialTemplateInputForPreset,
  normalizeOfficialTemplateDefinition
};
