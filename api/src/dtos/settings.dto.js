const { z } = require('./common.dto');
const { isSafeExternalHttpUrl } = require('../utils/urls');

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

function hasDisallowedControlCharacters(value) {
  return [...String(value || '')].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 8
      || codePoint === 11
      || codePoint === 12
      || (codePoint >= 14 && codePoint <= 31)
      || codePoint === 127;
  });
}

const telegramMessage = optionalField(
  z.string().trim().min(1).max(3000).refine(
    (value) => !hasDisallowedControlCharacters(value),
    'A mensagem nao pode conter caracteres de controle'
  )
);

const usefulLinkSchema = z.object({
  title: z.string().trim().min(1).max(80),
  caption: optionalField(z.string().trim().max(240)),
  description: optionalField(z.string().trim().max(240)),
  url: z.string()
    .trim()
    .min(8)
    .max(2048)
    .refine(isSafeExternalHttpUrl, 'Informe uma URL externa HTTP ou HTTPS valida e segura')
    .transform((value) => new URL(value).toString()),
  iconName: optionalField(
    z.string()
      .trim()
      .toLowerCase()
      .min(5)
      .max(100)
      .regex(/^mdi-[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Informe um nome de icone MDI valido')
  ),
  icon: optionalField(
    z.string()
      .trim()
      .toLowerCase()
      .min(5)
      .max(100)
      .regex(/^mdi-[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Informe um nome de icone MDI valido')
  )
}).strict().superRefine((item, context) => {
  if (!item.iconName && !item.icon) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['iconName'],
      message: 'Informe o nome de um icone MDI'
    });
  }
  if (item.iconName && item.icon && item.iconName !== item.icon) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['iconName'],
      message: 'iconName e icon devem identificar o mesmo icone'
    });
  }
  if (item.caption && item.description && item.caption !== item.description) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['caption'],
      message: 'caption e description devem possuir o mesmo texto'
    });
  }
}).transform((item) => ({
  title: item.title,
  ...(item.caption || item.description ? { caption: item.caption || item.description } : {}),
  url: item.url,
  iconName: item.iconName || item.icon
}));

const usefulLinksSchema = z.array(usefulLinkSchema).max(5).superRefine((links, context) => {
  const titles = new Map();
  const urls = new Map();
  links.forEach((link, index) => {
    const normalizedTitle = link.title.normalize('NFKC').toLocaleLowerCase('pt-BR');
    const duplicateTitle = titles.get(normalizedTitle);
    if (duplicateTitle !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, 'title'],
        message: `Titulo duplicado com o link ${duplicateTitle + 1}`
      });
    } else {
      titles.set(normalizedTitle, index);
    }
    const duplicateUrl = urls.get(link.url);
    if (duplicateUrl !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, 'url'],
        message: `URL duplicada com o link ${duplicateUrl + 1}`
      });
    } else {
      urls.set(link.url, index);
    }
  });
});

const bulkSettingsSchema = z.object({
  body: z.object({
    telegram: z.object({
      botToken: optionalField(z.string().max(500)),
      webhookSecret: optionalField(z.string().max(256)),
      messages: z.object({
        onboarding: telegramMessage,
        phoneShare: telegramMessage,
        profile: telegramMessage,
        help: telegramMessage
      }).optional()
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
    }).optional(),
    usefulLinks: usefulLinksSchema.optional()
  }).refine((body) => Object.keys(body).length > 0)
});

module.exports = {
  updateSettingSchema,
  deleteSettingSchema,
  revealSettingsSchema,
  bulkSettingsSchema,
  whatsappDisplayPhoneNumber,
  usefulLinkSchema,
  usefulLinksSchema
};
