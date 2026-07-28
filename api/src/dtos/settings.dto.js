const { z } = require('./common.dto');

function optionalField(schema) {
  return z.preprocess(
    (value) => value === null || typeof value === 'string' && value.trim() === '' ? undefined : value,
    schema.optional()
  );
}

const updateSettingSchema = z.object({
  params: z.object({ key: z.string().min(2).max(100).regex(/^[A-Za-z0-9_]+$/) }),
  body: z.object({ value: z.union([z.string(), z.number(), z.boolean()]), sensitive: z.boolean().optional() })
});

const deleteSettingSchema = z.object({
  params: z.object({ key: z.string().min(2).max(100).regex(/^[A-Za-z0-9_]+$/) })
});

const revealSettingsSchema = z.object({
  params: z.object({
    channel: z.enum(['telegram', 'whatsappCloud', 'email'])
  })
});

const whatsappPermissionCommand = optionalField(
  z.string().trim().min(1).max(100).refine(
    (value) => ![...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint <= 31 || codePoint === 127;
    }),
    'O comando nao pode conter caracteres de controle'
  )
);

const whatsappDisplayPhoneNumber = optionalField(
  z.string()
    .trim()
    .max(40)
    .transform((value) => value.replace(/\D/g, ''))
    .refine(
      (value) => /^[1-9]\d{7,14}$/.test(value),
      'Informe o numero publico do WhatsApp com DDI (8 a 15 digitos)'
    )
);

const whatsappConsentRequestText = optionalField(
  z.string().trim().min(1).max(1000).refine(
    (value) => value.includes('{command}'),
    'Inclua {command} no texto para mostrar o comando dinamico'
  )
);

const bulkSettingsSchema = z.object({
  body: z.object({
    telegram: z.object({
      botToken: optionalField(z.string().max(500)),
      webhookSecret: optionalField(z.string().max(256))
    }).optional(),
    whatsappCloud: z.object({
      accessToken: optionalField(z.string().max(4000)),
      phoneNumberId: optionalField(z.string().max(100)),
      displayPhoneNumber: whatsappDisplayPhoneNumber,
      businessAccountId: optionalField(z.string().max(100)),
      verifyToken: optionalField(z.string().max(500)),
      appSecret: optionalField(z.string().max(500)),
      apiVersion: optionalField(z.string().regex(/^v\d+\.\d+$/))
    }).optional(),
    whatsappPermission: z.object({
      command: whatsappPermissionCommand,
      requestText: whatsappConsentRequestText
    }).optional(),
    telegramPermission: z.object({
      command: whatsappPermissionCommand
    }).optional(),
    email: z.object({
      user: optionalField(z.string().email().max(254)),
      from: optionalField(z.string().max(320)),
      fromName: optionalField(z.string().max(200)),
      appPassword: optionalField(z.string().max(256))
    }).optional()
  }).refine((body) => Object.keys(body).length > 0)
});

module.exports = {
  updateSettingSchema,
  deleteSettingSchema,
  revealSettingsSchema,
  bulkSettingsSchema,
  whatsappDisplayPhoneNumber
};
