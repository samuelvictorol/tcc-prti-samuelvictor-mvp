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

const CUSTOM_COMPONENT_TYPES = Object.freeze(['header', 'body', 'footer', 'button']);
const CUSTOM_PARAMETER_TYPES = Object.freeze(['text', 'currency', 'date_time', 'image', 'document', 'video', 'payload', 'coupon_code']);
const BUTTON_SUB_TYPES = Object.freeze(['url', 'quick_reply', 'copy_code', 'otp_copy_code']);
const FORBIDDEN_WHATSAPP_BUTTON_HOSTS = Object.freeze(['wa.me', 'whatsapp.com']);

function buttonUrl(value, details = {}) {
  const rawValue = String(value).trim();
  const placeholderTokens = rawValue.match(/\{\{[^{}]+\}\}/g) || [];
  const positionalPlaceholders = rawValue.match(/\{\{1\}\}/g) || [];
  if (placeholderTokens.some((token) => token !== '{{1}}') || positionalPlaceholders.length > 1
    || (/[{}]/.test(rawValue) && positionalPlaceholders.length !== 1)) {
    templateError(
      'Botao URL aceita no maximo um placeholder posicional {{1}}',
      details,
      'WHATSAPP_TEMPLATE_BUTTON_URL_PLACEHOLDER_INVALID'
    );
  }
  if (positionalPlaceholders.length) {
    const placeholderIndex = rawValue.indexOf('{{1}}');
    const authorityStart = rawValue.indexOf('://') + 3;
    const suffixIndexes = ['/', '?', '#']
      .map((separator) => rawValue.indexOf(separator, authorityStart))
      .filter((index) => index >= 0);
    const suffixStart = suffixIndexes.length ? Math.min(...suffixIndexes) : -1;
    const fragmentStart = rawValue.indexOf('#', authorityStart);
    if (authorityStart < 3 || suffixStart < 0 || placeholderIndex < suffixStart
      || (fragmentStart >= 0 && placeholderIndex > fragmentStart)) {
      templateError(
        'Placeholder {{1}} permitido somente no caminho ou query do botao URL',
        details,
        'WHATSAPP_TEMPLATE_BUTTON_URL_PLACEHOLDER_INVALID'
      );
    }
  }
  let placeholderMarker = 'notify-flow-dynamic-suffix';
  while (rawValue.includes(placeholderMarker)) placeholderMarker += '-value';
  const valueForValidation = rawValue.replace('{{1}}', placeholderMarker);
  let parsed;
  try {
    parsed = new URL(valueForValidation);
  } catch (_error) {
    templateError('Botao exige URL HTTPS valida', details);
  }
  if (parsed.protocol.toLowerCase() === 'whatsapp:') {
    templateError(
      'Botao nao pode redirecionar para WhatsApp ou wa.me',
      { ...details, protocol: parsed.protocol },
      'WHATSAPP_TEMPLATE_BUTTON_URL_FORBIDDEN'
    );
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    templateError('Botao exige URL HTTPS valida, sem credenciais', details);
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (FORBIDDEN_WHATSAPP_BUTTON_HOSTS.some((host) => hostname === host || hostname.endsWith('.' + host))) {
    templateError(
      'Botao nao pode redirecionar para WhatsApp ou wa.me',
      { ...details, hostname },
      'WHATSAPP_TEMPLATE_BUTTON_URL_FORBIDDEN'
    );
  }
  const normalized = parsed.toString();
  return positionalPlaceholders.length ? normalized.replace(placeholderMarker, '{{1}}') : normalized;
}

function meaningfulValue(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'object') return !Array.isArray(value) && Object.keys(value).length > 0;
  return false;
}

function normalizeFixedValue(value, details) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value.slice(0, 100000);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'object' && !Array.isArray(value)) {
    let json;
    try { json = JSON.stringify(value); } catch (_error) { json = null; }
    if (!json || json.length > 100000) templateError('Valor fixo do parametro invalido', details);
    return JSON.parse(json);
  }
  templateError('Valor fixo do parametro invalido', details);
}

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
    if (['header', 'body', 'footer'].includes(type)) {
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
    if (type === 'footer' && component.parameters.length) {
      templateError('Rodape Meta aceita somente texto fixo', { componentIndex, type });
    }
    const componentText = component.text === undefined || component.text === null
      ? undefined
      : String(component.text);
    if (componentText && !['body', 'footer', 'button'].includes(type)) {
      templateError('Texto fixo permitido somente em body, footer ou button', { componentIndex, type });
    }
    const textLimits = { body: 1024, footer: 60, button: 25 };
    if (componentText && componentText.length > textLimits[type]) {
      templateError('Texto do componente excede o limite da Meta', {
        componentIndex,
        type,
        maxLength: textLimits[type]
      });
    }
    const componentUrl = component.url === undefined || component.url === null || component.url === ''
      ? undefined
      : String(component.url).trim();
    if (componentUrl && (type !== 'button' || subType !== 'url')) {
      templateError('URL fixa e exclusiva de botao do tipo URL', { componentIndex, type, subType });
    }
    // Versoes anteriores da interface conseguiam persistir um parametro de
    // sufixo junto de uma URL sem `{{1}}`. Para a Meta isso e uma URL fixa e
    // enviar o parametro resulta em
    // WHATSAPP_TEMPLATE_BUTTON_URL_PARAMETER_MISMATCH. A existencia de um
    // unico parametro no botao e uma declaracao inequivoca de URL dinamica;
    // recupere o contrato acrescentando o marcador posicional antes de
    // validar e persistir. Botoes realmente fixos continuam sem parametros.
    const legacyDynamicButtonUrl = type === 'button'
      && subType === 'url'
      && componentUrl
      && !componentUrl.includes('{{1}}')
      && !/[{}]/.test(componentUrl)
      && component.parameters.length === 1;
    const effectiveComponentUrl = legacyDynamicButtonUrl ? componentUrl + '{{1}}' : componentUrl;
    const normalizedComponentUrl = effectiveComponentUrl
      ? buttonUrl(effectiveComponentUrl, { componentIndex })
      : undefined;
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
      const fixedValue = normalizeFixedValue(parameter.fixedValue, { componentIndex, parameterIndex, key });
      if (fixedValue !== undefined) output.fixedValue = fixedValue;
      const requestedContentMode = parameter.contentMode === undefined || parameter.contentMode === null
        ? null
        : String(parameter.contentMode).trim().toLowerCase();
      if (requestedContentMode && !['fixed', 'dynamic'].includes(requestedContentMode)) {
        templateError('Modo de preenchimento do parametro invalido', {
          componentIndex,
          parameterIndex,
          key,
          contentMode: requestedContentMode
        });
      }
      const contentMode = requestedContentMode || (fixedValue !== undefined ? 'fixed' : 'dynamic');
      if (contentMode === 'fixed' && fixedValue === undefined) {
        templateError('Parametro configurado como fixo exige um valor salvo', {
          componentIndex,
          parameterIndex,
          key,
          contentMode
        }, 'WHATSAPP_TEMPLATE_FIXED_VALUE_REQUIRED');
      }
      if (contentMode === 'dynamic' && fixedValue !== undefined) {
        templateError('Parametro preenchido em cada disparo nao aceita valor fixo', {
          componentIndex,
          parameterIndex,
          key,
          contentMode
        }, 'WHATSAPP_TEMPLATE_DYNAMIC_VALUE_CONFLICT');
      }
      output.contentMode = contentMode;
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
        const configuredMedia = output.fixedValue ?? output.example;
        if (typeof configuredMedia === 'string' && configuredMedia.trim()) {
          if (!/^https:\/\//i.test(configuredMedia.trim())) {
            templateError('Link fixo de midia deve usar HTTPS', { componentIndex, parameterIndex, key });
          }
        } else if (configuredMedia && typeof configuredMedia === 'object') {
          const link = configuredMedia.link;
          if (link && !/^https:\/\//i.test(String(link))) {
            templateError('Link fixo de midia deve usar HTTPS', { componentIndex, parameterIndex, key });
          }
        }
      }
      if (type === 'button' && subType === 'url') {
        const configuredButtonValue = output.fixedValue ?? output.example;
        if (typeof configuredButtonValue === 'string' && /^(?:https?:\/\/|whatsapp:)/i.test(configuredButtonValue.trim())) {
          buttonUrl(configuredButtonValue.trim(), { componentIndex, parameterIndex, key });
        }
      }
      return output;
    });
    const namedCount = parameters.filter((parameter) => parameter.parameterName).length;
    if (namedCount > 0 && namedCount !== parameters.length) {
      templateError('Nao misture parametros nomeados e posicionais no mesmo componente', { componentIndex });
    }
    if (type === 'button' && subType === 'url') {
      const hasDynamicSuffix = normalizedComponentUrl?.includes('{{1}}') === true;
      const expectedParameters = hasDynamicSuffix ? 1 : 0;
      if (parameters.length !== expectedParameters) {
        templateError(
          hasDynamicSuffix
            ? 'Botao URL com {{1}} exige exatamente um parametro posicional de sufixo'
            : 'Botao URL fixa nao aceita parametro de sufixo',
          { componentIndex, expectedParameters, receivedParameters: parameters.length },
          'WHATSAPP_TEMPLATE_BUTTON_URL_PARAMETER_MISMATCH'
        );
      }
    }
    return {
      id,
      type,
      ...(type === 'button' ? { subType, index: String(buttonIndex) } : {}),
      ...(componentText !== undefined ? { text: componentText } : {}),
      ...(normalizedComponentUrl ? { url: normalizedComponentUrl } : {}),
      parameters
    };
  });
  const category = builder.category === undefined ? undefined : String(builder.category).toLowerCase();
  const mode = builder.mode === undefined ? undefined : String(builder.mode).toLowerCase();
  if (category !== undefined && category !== 'marketing') templateError('Categoria do builder deve ser marketing', { category });
  if (mode !== undefined && mode !== 'standard') templateError('Modo do builder deve ser standard', { mode });
  return {
    version: 1,
    ...(category ? { category } : {}),
    ...(mode ? { mode } : {}),
    components: normalized
  };
}

function marketingStandardError(message, details = {}) {
  templateError(message, details, 'WHATSAPP_MARKETING_STANDARD_INVALID');
}

function assertMarketingStandardBuilder(builder) {
  if (builder.category !== 'marketing' || builder.mode !== 'standard') {
    marketingStandardError(
      'Template custom novo exige categoria Marketing e modo Padrao',
      { category: builder.category || null, mode: builder.mode || null }
    );
  }
  const header = builder.components.filter((component) => component.type === 'header');
  const body = builder.components.filter((component) => component.type === 'body');
  const footer = builder.components.filter((component) => component.type === 'footer');
  const buttons = builder.components.filter((component) => component.type === 'button');
  if (header.length) {
    const headerParameters = header[0].parameters || [];
    if (headerParameters.length !== 1 || !['image', 'video', 'document'].includes(headerParameters[0]?.type)) {
      marketingStandardError(
        'Cabecalho Marketing Padrao, quando informado, exige exatamente uma imagem, video ou documento',
        { component: 'header' }
      );
    }
  }
  if (body.length && !String(body[0].text || '').trim()) {
    marketingStandardError('Corpo Marketing Padrao informado exige texto fixo', { component: 'body' });
  }
  if (footer.length && !String(footer[0].text || '').trim()) {
    marketingStandardError('Rodape informado exige texto fixo', { component: 'footer' });
  }
  for (const button of buttons) {
    const parameters = button.parameters || [];
    const hasDynamicSuffix = String(button.url || '').includes('{{1}}');
    const hasValidSuffix = hasDynamicSuffix
      ? parameters.length === 1 && parameters[0].type === 'text' && !parameters[0].parameterName
      : parameters.length === 0;
    if (button.subType !== 'url' || !String(button.text || '').trim() || !button.url || !hasValidSuffix) {
      marketingStandardError(
        'Botao Marketing Padrao exige URL fixa sem parametros ou URL com {{1}} e exatamente um parametro posicional de sufixo',
        { component: 'button', index: button.index }
      );
    }
  }
  return builder;
}

function placeholderForParameter(parameter) {
  const placeholder = '{{' + parameter.key + '}}';
  if (parameter.type === 'text') return { type: 'text', text: placeholder };
  if (parameter.type === 'currency') {
    return {
      type: 'currency',
      currency: {
        fallback_value: placeholder,
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

function configuredParameterValue(parameter) {
  if (meaningfulValue(parameter.fixedValue)) return parameter.fixedValue;
  return undefined;
}

function storedParameterPayload(parameter) {
  if (meaningfulValue(parameter.fixedValue)) {
    return runtimeParameter(parameter, { [parameter.key]: parameter.fixedValue });
  }
  // `example` documenta a configuracao na UI/Meta, mas nunca representa um
  // valor autorizado para uma entrega real.
  return placeholderForParameter(parameter);
}

function builderComponents(builder) {
  const normalized = normalizeBuilder(builder);
  return normalized.components.filter((component) => component.parameters.length > 0).map((component) => ({
    type: component.type,
    ...(component.type === 'button' ? { sub_type: component.subType === 'otp_copy_code' ? 'url' : component.subType, index: component.index } : {}),
    parameters: component.parameters.map((parameter) => ({
      ...storedParameterPayload(parameter),
      ...(parameter.parameterName ? { parameter_name: parameter.parameterName } : {})
    }))
  }));
}

function resolvedParameterValue(variables, parameter) {
  const hasExplicitValue = Object.prototype.hasOwnProperty.call(variables || {}, parameter.key)
    && meaningfulValue(variables[parameter.key]);
  const value = hasExplicitValue ? variables[parameter.key] : configuredParameterValue(parameter);
  if (!meaningfulValue(value)) {
    templateError(
      'O template oficial nao possui valor fixo para todos os parametros',
      { missingParameters: [parameter.key], canOverrideAtRuntime: true },
      'WHATSAPP_TEMPLATE_PARAMETERS_REQUIRED'
    );
  }
  return value;
}

function previewText(value, maxLength = 4096) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function previewParameterValue(parameter, variables = {}) {
  const value = resolvedParameterValue(variables, parameter);
  if (parameter.type === 'text') return previewText(typeof value === 'object' ? value.text : value);
  if (parameter.type === 'currency') {
    if (typeof value !== 'object') return previewText(value);
    return previewText(value.fallbackValue ?? value.fallback_value);
  }
  if (parameter.type === 'date_time') {
    if (typeof value !== 'object') return previewText(value);
    return previewText(value.fallbackValue ?? value.fallback_value);
  }
  if (['image', 'document', 'video'].includes(parameter.type)) {
    const source = typeof value === 'object' ? value : { link: value };
    const link = previewText(source.link, 4096);
    return {
      type: parameter.type,
      url: link && /^https:\/\//i.test(link) ? link : null,
      filename: parameter.type === 'document'
        ? previewText(source.filename || parameter.filename || parameter.uploadedFilename, 240)
        : null
    };
  }
  return null;
}

function interpolatePreviewText(text, parameters, variables) {
  let output = previewText(text, 10_000);
  if (!output) return null;
  parameters.forEach((parameter, index) => {
    const value = previewParameterValue(parameter, variables);
    if (typeof value !== 'string' || !value) return;
    const tokens = [String(index + 1), parameter.key, parameter.parameterName].filter(Boolean);
    for (const token of tokens) output = output.replaceAll('{{' + token + '}}', value);
  });
  return output.slice(0, 10_000);
}

function normalizeTemplatePreview(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const name = previewText(input.name, 512);
  if (!name) return null;
  const languageCode = previewText(input.languageCode, 20);
  const mediaInput = input.header?.media;
  const mediaType = previewText(mediaInput?.type, 20);
  const mediaUrl = previewText(mediaInput?.url, 4096);
  const media = mediaInput && ['image', 'video', 'document'].includes(mediaType)
    ? {
        type: mediaType,
        url: mediaUrl && /^https:\/\//i.test(mediaUrl) ? mediaUrl : null,
        filename: mediaType === 'document' ? previewText(mediaInput.filename, 240) : null
      }
    : null;
  const headerType = previewText(input.header?.type, 20);
  const header = input.header && ['text', 'image', 'video', 'document'].includes(headerType)
    ? {
        type: headerType,
        text: previewText(input.header.text, 1024),
        media
      }
    : null;
  const bodyText = previewText(input.body?.text, 10_000);
  const footerText = previewText(input.footer?.text, 1000);
  const buttons = Array.isArray(input.buttons) ? input.buttons.slice(0, 10).map((button, index) => {
    const type = previewText(button?.type, 40) || 'url';
    const url = previewText(button?.url, 4096);
    return {
      index: String(button?.index ?? index).slice(0, 2),
      type,
      text: previewText(button?.text, 80),
      // Somente o destino HTTPS aprovado e necessario para a previa. Payloads
      // de quick reply, OTP e copy code nunca sao expostos ao cliente web.
      url: type === 'url' && url && /^https:\/\//i.test(url) ? url : null
    };
  }) : [];
  return {
    version: 1,
    name,
    languageCode,
    header,
    body: bodyText ? { text: bodyText } : null,
    footer: footerText ? { text: footerText } : null,
    buttons
  };
}

function buildCustomTemplatePreview(customTemplate) {
  const builder = normalizeBuilder(customTemplate.builder);
  const variables = customTemplate.variables || {};
  const headerComponent = builder.components.find((component) => component.type === 'header');
  const bodyComponent = builder.components.find((component) => component.type === 'body');
  const footerComponent = builder.components.find((component) => component.type === 'footer');
  const headerParameter = headerComponent?.parameters?.[0];
  const headerValue = headerParameter ? previewParameterValue(headerParameter, variables) : null;
  const headerType = headerParameter?.type || null;
  const header = headerComponent ? {
    type: headerType || 'text',
    text: headerType === 'text'
      ? interpolatePreviewText(headerComponent.text || '{{1}}', headerComponent.parameters, variables)
      : null,
    media: headerValue && typeof headerValue === 'object' ? headerValue : null
  } : null;
  const buttons = builder.components.filter((component) => component.type === 'button').map((component) => ({
    index: component.index,
    type: component.subType,
    text: component.text || null,
    url: component.subType === 'url'
      ? String(component.url || '').replace(
          '{{1}}',
          component.parameters?.[0]
            ? String(previewParameterValue(component.parameters[0], variables) || '{{1}}')
            : '{{1}}'
        ) || null
      : null
  }));
  return normalizeTemplatePreview({
    name: customTemplate.name,
    languageCode: customTemplate.languageCode,
    header,
    body: bodyComponent ? { text: interpolatePreviewText(bodyComponent.text, bodyComponent.parameters, variables) } : null,
    footer: footerComponent ? { text: footerComponent.text } : null,
    buttons
  });
}

function buildOfficialTemplatePreview(officialTemplate) {
  const preset = getTemplatePreset(officialTemplate?.preset);
  const values = officialTemplate?.parameters || {};
  let body = preset.preview;
  for (const parameter of preset.parameters) {
    const value = parameterValue(values, parameter.key);
    if (meaningfulValue(value)) body = body.replaceAll('{{' + parameter.key + '}}', String(value));
  }
  return normalizeTemplatePreview({
    name: preset.templateName,
    languageCode: preset.languageCode,
    body: { text: body },
    buttons: []
  });
}

function metaParameterPreview(parameter = {}) {
  if (parameter.type === 'text') return previewText(parameter.text, 1024);
  if (parameter.type === 'currency') return previewText(parameter.currency?.fallback_value, 1024);
  if (parameter.type === 'date_time') return previewText(parameter.date_time?.fallback_value, 1024);
  if (['image', 'document', 'video'].includes(parameter.type)) {
    const media = parameter[parameter.type] || {};
    const url = previewText(media.link, 4096);
    return {
      type: parameter.type,
      url: url && /^https:\/\//i.test(url) ? url : null,
      filename: parameter.type === 'document' ? previewText(media.filename, 240) : null
    };
  }
  return null;
}

function templatePreviewFromMetaTemplate(template = {}, fallbackBody = null) {
  const name = previewText(template.name, 512);
  if (!name) return null;
  const languageCode = previewText(template.language?.code || template.languageCode, 20);
  const presetId = presetFromTemplateName(name);
  if (presetId) {
    const bodyComponent = (template.components || []).find((component) => component.type === 'body');
    const parameters = bodyComponent?.parameters || [];
    const preset = getTemplatePreset(presetId);
    const values = Object.fromEntries(preset.parameters.map((parameter, index) => [
      parameter.key,
      metaParameterPreview(parameters[index]) || parameter.example
    ]));
    return buildOfficialTemplatePreview({ preset: presetId, parameters: values });
  }
  const headerComponent = (template.components || []).find((component) => component.type === 'header');
  const headerParameter = headerComponent?.parameters?.[0];
  const headerValue = metaParameterPreview(headerParameter);
  const fallbackText = String(fallbackBody || '').trim();
  const safeFallbackBody = /^\[template(?::[^\]]*)?\]$/i.test(fallbackText) ? null : fallbackText;
  return normalizeTemplatePreview({
    name,
    languageCode,
    header: headerComponent ? {
      type: headerParameter?.type || 'text',
      text: headerParameter?.type === 'text' ? headerValue : null,
      media: headerValue && typeof headerValue === 'object' ? headerValue : null
    } : null,
    body: safeFallbackBody ? { text: safeFallbackBody } : null,
    buttons: []
  });
}

function safeTemplateConversationMetadata(metadata, fallbackBody = null) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return metadata || null;
  const preview = normalizeTemplatePreview(metadata.templatePreview)
    || templatePreviewFromMetaTemplate(metadata.template, fallbackBody);
  if (!preview) return metadata;
  return {
    ...metadata,
    template: {
      name: preview.name,
      languageCode: preview.languageCode
    },
    templatePreview: preview
  };
}

function runtimeParameter(parameter, variables) {
  const value = resolvedParameterValue(variables, parameter);
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
        fallback_value: String(value.fallbackValue ?? value.fallback_value ?? ''),
        code: String(value.code ?? parameter.currencyCode ?? '').toUpperCase(),
        amount_1000: Number(value.amount1000 ?? value.amount_1000)
      };
    } else {
      const numeric = Number(value);
      currency = {
        fallback_value: String(value),
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

function normalizeOfficialTemplateDefinition(input, options = {}) {
  const externalTemplateName = String(input.externalTemplateName || '').trim();
  const inferredPreset = input.whatsappCloudPreset
    || presetFromTemplateName(externalTemplateName)
    || (externalTemplateName ? 'custom' : null);
  if (inferredPreset === 'custom') {
    const name = externalTemplateName;
    const languageCode = String(input.languageCode || 'pt_BR').trim();
    if (!/^[a-z0-9_]{1,512}$/.test(name)) templateError('Nome oficial Meta invalido', { field: 'externalTemplateName' });
    if (!/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(languageCode)) templateError('Codigo de idioma Meta invalido', { field: 'languageCode' });
    const configuredBuilder = input.payload?.builder;
    const marketingDefaults = options.enforceMarketingStandard === false && configuredBuilder
      ? {}
      : { category: 'marketing', mode: 'standard' };
    const builder = normalizeBuilder({
      version: 1,
      ...marketingDefaults,
      components: [],
      ...(configuredBuilder || {})
    });
    if (options.enforceMarketingStandard !== false) assertMarketingStandardBuilder(builder);
    const fixedBody = builder.components.find((component) => component.type === 'body')?.text;
    return {
      ...input,
      templateType: 'approved_template',
      whatsappCloudPreset: 'custom',
      externalTemplateName: name,
      languageCode,
      // `description` identifica o template apenas dentro do Notify Flow. O
      // conteudo visivel vem exclusivamente do componente body cadastrado.
      body: fixedBody || null,
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
    body: input.body && input.body !== input.description ? input.body : preset.preview,
    payload: components.length ? { components } : {}
  };
}

module.exports = {
  WHATSAPP_CLOUD_TEMPLATE_PRESETS,
  listTemplatePresets,
  getTemplatePreset,
  presetFromTemplateName,
  normalizeBuilder,
  assertMarketingStandardBuilder,
  builderComponents,
  buildOfficialTemplateMessage,
  buildCustomTemplateMessage,
  buildOfficialTemplatePreview,
  buildCustomTemplatePreview,
  templatePreviewFromMetaTemplate,
  normalizeTemplatePreview,
  safeTemplateConversationMetadata,
  officialTemplateInputForPreset,
  normalizeOfficialTemplateDefinition
};
