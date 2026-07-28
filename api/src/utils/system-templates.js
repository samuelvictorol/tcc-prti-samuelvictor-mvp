const { CHANNELS } = require('../enums/channels');

const SYSTEM_TEMPLATE_DEFINITIONS = Object.freeze([
  Object.freeze({
    systemKey: 'whatsapp_cloud.jaspers_market_plain_text_v1',
    name: 'Texto sem formatação',
    description: 'OFICIAL META TEST NUMBER · Template oficial de texto simples do ambiente com número de teste da Meta, sem parâmetros.',
    channel: CHANNELS.WHATSAPP_CLOUD,
    templateType: 'approved_template',
    whatsappCloudPreset: 'plain_text',
    externalTemplateName: 'jaspers_market_plain_text_v1',
    languageCode: 'en_US',
    body: 'Mensagem de texto simples aprovada pela Meta.',
    variables: [],
    payload: {},
    active: true
  }),
  Object.freeze({
    systemKey: 'whatsapp_cloud.jaspers_market_order_confirmation_v1',
    name: 'Confirmação de pedido',
    description: 'OFICIAL META TEST NUMBER · Template oficial de confirmação do ambiente com número de teste da Meta.',
    channel: CHANNELS.WHATSAPP_CLOUD,
    templateType: 'approved_template',
    whatsappCloudPreset: 'order_confirmation',
    externalTemplateName: 'jaspers_market_order_confirmation_v1',
    languageCode: 'en_US',
    body: 'Pedido {{orderNumber}} de {{customerName}} confirmado em {{orderDate}}.',
    variables: ['customerName', 'orderNumber', 'orderDate'],
    payload: {
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: '{{customerName}}' },
            { type: 'text', text: '{{orderNumber}}' },
            { type: 'text', text: '{{orderDate}}' }
          ]
        }
      ]
    },
    active: true
  }),
  Object.freeze({
    systemKey: 'whatsapp_cloud.3p_direct_integration_test_template',
    name: 'OFICIAL META PROD NUMBER',
    description: 'Modelo de teste de integração para validar um número de produção. Deve existir e estar aprovado na conta do WhatsApp Business vinculada ao número remetente.',
    channel: CHANNELS.WHATSAPP_CLOUD,
    templateType: 'approved_template',
    whatsappCloudPreset: 'custom',
    externalTemplateName: '3p_direct_integration_test_template',
    languageCode: 'en_US',
    body: 'Modelo oficial de teste de integração em número de produção.',
    variables: [],
    payload: {
      builder: {
        version: 1,
        components: []
      }
    },
    active: true
  })
]);

const RETIRED_SYSTEM_TEMPLATE_KEYS = Object.freeze([
  'whatsapp_cloud.verify_code_1'
]);

const FIXED_WHATSAPP_TEMPLATE_NAMES = Object.freeze(
  SYSTEM_TEMPLATE_DEFINITIONS.map((template) => template.externalTemplateName)
);
const FIXED_WHATSAPP_TEMPLATE_NAME_SET = new Set(FIXED_WHATSAPP_TEMPLATE_NAMES);
const SYSTEM_TEMPLATE_KEY_SET = new Set(SYSTEM_TEMPLATE_DEFINITIONS.map((template) => template.systemKey));

function listSystemTemplateDefinitions() {
  return structuredClone(SYSTEM_TEMPLATE_DEFINITIONS);
}

function isSystemTemplate(template = {}) {
  if (template.systemManaged === true) return true;
  if (SYSTEM_TEMPLATE_KEY_SET.has(String(template.systemKey || ''))) return true;
  return template.channel === CHANNELS.WHATSAPP_CLOUD
    && FIXED_WHATSAPP_TEMPLATE_NAME_SET.has(String(template.externalTemplateName || '').trim());
}

module.exports = {
  SYSTEM_TEMPLATE_DEFINITIONS,
  RETIRED_SYSTEM_TEMPLATE_KEYS,
  FIXED_WHATSAPP_TEMPLATE_NAMES,
  listSystemTemplateDefinitions,
  isSystemTemplate
};
