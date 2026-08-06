const { z, objectId, idParams, booleanQuery, paginationQuery } = require('./common.dto');
const { CHANNELS } = require('../enums/channels');

const TEMPLATE_CHANNELS = [CHANNELS.TELEGRAM, CHANNELS.WHATSAPP_CLOUD, CHANNELS.EMAIL, CHANNELS.GLOBAL];

const FORBIDDEN_WHATSAPP_BUTTON_HOSTS = ['wa.me', 'whatsapp.com'];

function isForbiddenWhatsappButtonUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol.toLowerCase() === 'whatsapp:') return true;
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
    return FORBIDDEN_WHATSAPP_BUTTON_HOSTS.some((host) => hostname === host || hostname.endsWith('.' + host));
  } catch (_error) {
    return /^\s*whatsapp:/i.test(String(value));
  }
}

function isHttpsUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch (_error) {
    return false;
  }
}

const whatsappFixedValue = z.union([
  z.string().max(100000),
  z.number(),
  z.record(z.unknown())
]);

const whatsappBuilderParameter = z.object({
  id: z.string().min(1).max(80).optional(),
  type: z.enum(['text', 'currency', 'date_time', 'image', 'document', 'video', 'payload', 'coupon_code']),
  key: z.string().min(1).max(64).regex(/^[A-Za-z][A-Za-z0-9_]*$/),
  parameterName: z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/).optional(),
  label: z.string().min(1).max(160),
  example: z.union([z.string().max(1000), z.number()]).nullish(),
  fixedValue: whatsappFixedValue.nullish(),
  // `fixed` reutiliza o valor salvo no template. `dynamic` exige que o
  // operador informe o valor no disparo. O campo e comum a midia, texto e
  // sufixo de URL para manter o mesmo contrato em todos os componentes.
  contentMode: z.enum(['fixed', 'dynamic']).optional(),
  currencyCode: z.string().length(3).regex(/^[A-Za-z]{3}$/).optional(),
  filename: z.string().min(1).max(240).optional(),
  mediaSource: z.enum(['url', 'upload']).optional(),
  mediaAssetId: objectId.optional(),
  mimeType: z.string().min(3).max(160).regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i).optional(),
  mediaType: z.enum(['image', 'video', 'document']).optional(),
  uploadedFilename: z.string().min(1).max(240).optional()
});

const whatsappBuilderComponent = z.object({
  id: z.string().min(1).max(80).optional(),
  type: z.enum(['header', 'body', 'footer', 'button']),
  subType: z.enum(['url', 'quick_reply', 'copy_code', 'otp_copy_code']).optional(),
  index: z.union([z.string().regex(/^[0-9]$/), z.number().int().min(0).max(9)]).optional(),
  text: z.string().max(4096).nullish(),
  url: z.string().max(2048).nullish(),
  parameters: z.array(whatsappBuilderParameter).max(20)
}).superRefine((component, context) => {
  const allowedByType = {
    header: new Set(['text', 'image', 'document', 'video']),
    body: new Set(['text', 'currency', 'date_time']),
    footer: new Set()
  };
  if (component.type !== 'button' && (component.subType !== undefined || component.index !== undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'subType e index sao exclusivos de button' });
  }
  if (component.type === 'button') {
    if (component.subType === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['subType'], message: 'subType obrigatorio' });
    if (component.index === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['index'], message: 'index obrigatorio' });
  }
  if (['header', 'button'].includes(component.type) && component.parameters.length > 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['parameters'], message: component.type + ' aceita no maximo um parametro' });
  }
  if (component.type === 'footer' && component.parameters.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['parameters'], message: 'Rodape Meta aceita somente texto fixo' });
  }
  if (component.text && component.type === 'header') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['text'], message: 'Texto do cabecalho deve ser configurado como parametro' });
  }
  if (component.text && !['body', 'footer', 'button'].includes(component.type)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['text'], message: 'Texto fixo permitido somente em body, footer ou button' });
  }
  if (component.type === 'body' && String(component.text || '').length > 1024) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['text'], message: 'Corpo do template Meta aceita no maximo 1024 caracteres' });
  }
  if (component.type === 'footer' && String(component.text || '').length > 60) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['text'], message: 'Rodape do template Meta aceita no maximo 60 caracteres' });
  }
  if (component.type === 'button' && String(component.text || '').length > 25) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['text'], message: 'Texto do botao Meta aceita no maximo 25 caracteres' });
  }
  if (component.url && (component.type !== 'button' || component.subType !== 'url')) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['url'], message: 'URL fixa e exclusiva de botao do tipo URL' });
  }
  if (component.url && !isHttpsUrl(component.url)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['url'], message: 'Botao exige URL HTTPS valida, sem credenciais' });
  }
  if (component.url && isForbiddenWhatsappButtonUrl(component.url)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['url'], message: 'Botao nao pode redirecionar para WhatsApp ou wa.me' });
  }
  component.parameters.forEach((parameter, parameterIndex) => {
    if (allowedByType[component.type] && !allowedByType[component.type].has(parameter.type)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['parameters', parameterIndex, 'type'], message: 'Tipo de parametro invalido para ' + component.type });
    }
    if (component.type === 'button') {
      if (parameter.parameterName) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['parameters', parameterIndex, 'parameterName'], message: 'Botoes usam parametros posicionais' });
      }
      const expectedType = { url: 'text', quick_reply: 'payload', copy_code: 'coupon_code', otp_copy_code: 'text' }[component.subType];
      if (expectedType && parameter.type !== expectedType) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['parameters', parameterIndex, 'type'], message: component.subType + ' exige ' + expectedType });
      }
      if (component.subType === 'url') {
        const fixedButtonValue = parameter.fixedValue ?? parameter.example;
        if (typeof fixedButtonValue === 'string' && isForbiddenWhatsappButtonUrl(fixedButtonValue)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['parameters', parameterIndex, 'fixedValue'],
            message: 'Botao nao pode redirecionar para WhatsApp ou wa.me'
          });
        }
      }
    }
    const isMedia = ['image', 'document', 'video'].includes(parameter.type);
    const hasMediaMetadata = parameter.mediaSource !== undefined
      || parameter.mediaAssetId !== undefined
      || parameter.mimeType !== undefined
      || parameter.mediaType !== undefined
      || parameter.uploadedFilename !== undefined;
    if (!isMedia && hasMediaMetadata) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['parameters', parameterIndex],
        message: 'Metadados de upload sao exclusivos de image, document e video'
      });
    }
    if (isMedia && parameter.mediaType && parameter.mediaType !== parameter.type) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['parameters', parameterIndex, 'mediaType'],
        message: 'O tipo da midia armazenada difere do parametro Meta'
      });
    }
    if (isMedia && parameter.mediaSource === 'upload' && !parameter.mediaAssetId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['parameters', parameterIndex, 'mediaAssetId'],
        message: 'Upload de midia exige o identificador do arquivo armazenado'
      });
    }
  });
  const namedCount = component.parameters.filter((parameter) => parameter.parameterName).length;
  if (namedCount > 0 && namedCount !== component.parameters.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['parameters'], message: 'Nao misture parametros nomeados e posicionais no mesmo componente' });
  }
});

const whatsappBuilder = z.object({
  version: z.literal(1),
  category: z.literal('marketing').optional(),
  mode: z.literal('standard').optional(),
  components: z.array(whatsappBuilderComponent).max(20)
}).superRefine((builder, context) => {
  for (const singletonType of ['header', 'body', 'footer']) {
    const indexes = builder.components
      .map((component, index) => component.type === singletonType ? index : -1)
      .filter((index) => index >= 0);
    if (indexes.length > 1) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['components', indexes[1], 'type'], message: 'Apenas um ' + singletonType + ' e permitido' });
    }
  }
  const buttonIndexes = new Map();
  builder.components.forEach((component, componentIndex) => {
    if (component.type !== 'button' || component.index === undefined) return;
    const index = String(component.index);
    if (buttonIndexes.has(index)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['components', componentIndex, 'index'], message: 'Indice de button duplicado' });
    } else {
      buttonIndexes.set(index, componentIndex);
    }
  });
});

const telegramNodeId = z.string().min(1).max(24).regex(/^[A-Za-z][A-Za-z0-9_-]*$/);
const telegramHttpsUrl = z.string().url().max(2048).refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443');
  } catch (_error) {
    return false;
  }
}, 'Use uma URL HTTPS publica, sem credenciais');

const telegramMenuButton = z.discriminatedUnion('action', [
  z.object({
    id: z.string().min(1).max(32).regex(/^[A-Za-z][A-Za-z0-9_-]*$/),
    label: z.string().trim().min(1).max(64),
    action: z.literal('submenu'),
    targetNodeId: telegramNodeId
  }).strict(),
  z.object({
    id: z.string().min(1).max(32).regex(/^[A-Za-z][A-Za-z0-9_-]*$/),
    label: z.string().trim().min(1).max(64),
    action: z.literal('url'),
    url: telegramHttpsUrl
  }).strict()
]);

const telegramMenuNode = z.object({
  id: telegramNodeId,
  parentId: telegramNodeId.nullish(),
  title: z.string().trim().min(1).max(160),
  text: z.string().max(3900).default(''),
  rows: z.array(z.array(telegramMenuButton).min(1).max(4)).max(8).default([])
}).strict().superRefine((node, context) => {
  if ((node.title.length + (node.text ? node.text.length + 2 : 0)) > 4096) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['text'], message: 'Titulo e texto juntos excedem 4096 caracteres' });
  }
  const ids = node.rows.flat().map((button) => button.id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['rows'], message: 'Cada botao da pagina deve possuir um ID unico' });
  }
});

const telegramTextDefinition = z.object({
  version: z.literal(1),
  kind: z.literal('text'),
  text: z.string().min(1).max(4096),
  disableLinkPreview: z.boolean().optional()
}).strict();

const telegramPhotoDefinition = z.object({
  version: z.literal(1),
  kind: z.literal('photo'),
  mediaUrl: telegramHttpsUrl,
  caption: z.string().max(1024).default('')
}).strict();

const telegramVideoDefinition = z.object({
  version: z.literal(1),
  kind: z.literal('video'),
  mediaUrl: telegramHttpsUrl,
  caption: z.string().max(1024).default('')
}).strict();

const telegramMenuDefinition = z.object({
  version: z.literal(1),
  kind: z.literal('menu'),
  rootNodeId: telegramNodeId,
  nodes: z.array(telegramMenuNode).min(1).max(30)
}).strict().superRefine((menu, context) => {
  const nodeById = new Map();
  menu.nodes.forEach((node, index) => {
    if (nodeById.has(node.id)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['nodes', index, 'id'], message: 'ID de pagina duplicado' });
    else nodeById.set(node.id, { node, index });
  });
  if (!nodeById.has(menu.rootNodeId)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['rootNodeId'], message: 'Pagina inicial nao encontrada' });
    return;
  }
  const parents = new Map();
  for (const [nodeIndex, node] of menu.nodes.entries()) {
    if (node.id === menu.rootNodeId && node.parentId) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['nodes', nodeIndex, 'parentId'], message: 'A pagina inicial nao possui pagina pai' });
    }
    for (const [rowIndex, row] of node.rows.entries()) {
      for (const [buttonIndex, button] of row.entries()) {
        if (button.action !== 'submenu') continue;
        if (!nodeById.has(button.targetNodeId)) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ['nodes', nodeIndex, 'rows', rowIndex, buttonIndex, 'targetNodeId'], message: 'Submenu de destino nao encontrado' });
          continue;
        }
        if (button.targetNodeId === node.id) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ['nodes', nodeIndex, 'rows', rowIndex, buttonIndex], message: 'Uma pagina nao pode abrir a si mesma' });
        }
        const previous = parents.get(button.targetNodeId);
        if (previous && previous !== node.id) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ['nodes', nodeIndex, 'rows', rowIndex, buttonIndex], message: 'Cada submenu deve possuir somente uma pagina pai' });
        } else parents.set(button.targetNodeId, node.id);
      }
    }
  }
  for (const [nodeIndex, node] of menu.nodes.entries()) {
    if (node.id === menu.rootNodeId) continue;
    const actualParent = parents.get(node.id);
    if (!actualParent) context.addIssue({ code: z.ZodIssueCode.custom, path: ['nodes', nodeIndex], message: 'Pagina orfa: adicione um botao que abra este submenu' });
    if (node.parentId && actualParent && node.parentId !== actualParent) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['nodes', nodeIndex, 'parentId'], message: 'Pagina pai difere do botao que abre o submenu' });
    }
  }
  const visited = new Set();
  const visiting = new Set();
  const walk = (nodeId, depth) => {
    if (depth > 5) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['nodes'], message: 'O menu aceita no maximo cinco niveis' });
      return;
    }
    if (visiting.has(nodeId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['nodes'], message: 'O menu nao pode conter ciclos' });
      return;
    }
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    const current = nodeById.get(nodeId)?.node;
    for (const row of current?.rows || []) {
      for (const button of row) if (button.action === 'submenu' && nodeById.has(button.targetNodeId)) walk(button.targetNodeId, depth + 1);
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  walk(menu.rootNodeId, 1);
  menu.nodes.forEach((node, index) => {
    if (!visited.has(node.id)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['nodes', index], message: 'Pagina inacessivel a partir do inicio' });
  });
});

const telegramTemplateDefinition = z.union([
  telegramTextDefinition,
  telegramPhotoDefinition,
  telegramVideoDefinition,
  telegramMenuDefinition
]);

const templatePayload = z.object({
  builder: whatsappBuilder.optional(),
  components: z.array(z.record(z.unknown())).max(20).optional(),
  telegram: telegramTemplateDefinition.optional()
}).strict();

const templateBodyBase = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(1000).nullish(),
  channel: z.enum(TEMPLATE_CHANNELS),
  templateType: z.string().min(1).max(80).optional(),
  subject: z.string().max(998).nullish(),
  body: z.string().max(100000).nullish(),
  html: z.string().max(500000).nullish(),
  payload: templatePayload.nullish(),
  variants: z.record(z.unknown()).nullish(),
  variables: z.array(z.string().min(1).max(64).regex(/^[A-Za-z][A-Za-z0-9_]*$/)).max(100).optional(),
  whatsappCloudPreset: z.enum(['order_confirmation', 'plain_text', 'hello_world', 'custom']).nullish(),
  externalTemplateName: z.string().max(512).nullish(),
  languageCode: z.string().max(20).nullish(),
  active: z.boolean().optional()
});

function validateChannelBody(body, context) {
  if (body.channel && body.channel !== CHANNELS.EMAIL && body.html) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['html'], message: 'Somente templates de email aceitam HTML' });
  }
  if (body.channel === CHANNELS.TELEGRAM) {
    if (!body.payload?.telegram) context.addIssue({ code: z.ZodIssueCode.custom, path: ['payload', 'telegram'], message: 'Definicao Telegram obrigatoria' });
    if (body.payload?.builder || body.payload?.components) context.addIssue({ code: z.ZodIssueCode.custom, path: ['payload'], message: 'Template Telegram aceita somente payload.telegram' });
  } else if (body.channel && body.payload?.telegram) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['payload', 'telegram'], message: 'Definicao Telegram usada em outro canal' });
  }
}

const templateBody = templateBodyBase.superRefine(validateChannelBody);

const createTemplateSchema = z.object({ body: templateBody });
const updateTemplateSchema = z.object({ params: idParams, body: templateBodyBase.partial().superRefine(validateChannelBody).refine((body) => Object.keys(body).length > 0) });
const templateIdSchema = z.object({ params: idParams });
const listTemplatesSchema = z.object({
  query: paginationQuery.extend({ channel: z.enum(TEMPLATE_CHANNELS).optional(), search: z.string().max(160).optional(), active: booleanQuery.optional() })
});

module.exports = {
  createTemplateSchema,
  updateTemplateSchema,
  templateIdSchema,
  listTemplatesSchema,
  telegramTemplateDefinition,
  telegramMenuDefinition,
  telegramMenuNode,
  telegramMenuButton,
  whatsappBuilder,
  whatsappBuilderComponent,
  whatsappBuilderParameter
};
