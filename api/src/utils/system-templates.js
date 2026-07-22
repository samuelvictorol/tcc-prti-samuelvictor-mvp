const { CHANNELS } = require('../enums/channels');

const SYSTEM_TEMPLATE_DEFINITIONS = Object.freeze([
  Object.freeze({
    systemKey: 'whatsapp_cloud.verify_code_1',
    name: 'Validar usuário',
    description: 'Código de acesso de uso único enviado para validar o acesso ao Meu Perfil.',
    channel: CHANNELS.WHATSAPP_CLOUD,
    templateType: 'approved_template',
    whatsappCloudPreset: 'custom',
    externalTemplateName: 'verify_code_1',
    languageCode: 'pt_BR',
    body: '{{codigo}} é o seu código de verificação.',
    variables: ['codigo'],
    payload: {
      builder: {
        version: 1,
        components: [
          {
            id: 'verification-code-body',
            type: 'body',
            parameters: [
              {
                id: 'verification-code-text',
                type: 'text',
                key: 'codigo',
                label: 'Código de verificação',
                example: '123456'
              }
            ]
          },
          {
            id: 'verification-code-copy-button',
            type: 'button',
            subType: 'otp_copy_code',
            index: '0',
            parameters: [
              {
                id: 'verification-code-copy-value',
                type: 'text',
                key: 'codigo',
                label: 'Mesmo código no botão Copiar código',
                example: '123456'
              }
            ]
          }
        ]
      }
    },
    active: true
  }),
  Object.freeze({
    systemKey: 'whatsapp_cloud.jaspers_market_plain_text_v1',
    name: 'Texto sem formatação',
    description: 'Template oficial de texto simples aprovado na Meta, sem parâmetros.',
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
    description: 'Template oficial de confirmação com cliente, número do pedido e data.',
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
  })
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
  FIXED_WHATSAPP_TEMPLATE_NAMES,
  listSystemTemplateDefinitions,
  isSystemTemplate
};
