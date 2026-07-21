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

const bulkSettingsSchema = z.object({
  body: z.object({
    telegram: z.object({
      botToken: optionalField(z.string().max(500)),
      webhookSecret: optionalField(z.string().max(256))
    }).optional(),
    whatsappWeb: z.object({
      sessionTtlDays: optionalField(z.coerce.number().int().min(1).max(365))
    }).optional(),
    whatsappCloud: z.object({
      accessToken: optionalField(z.string().max(4000)),
      phoneNumberId: optionalField(z.string().max(100)),
      businessAccountId: optionalField(z.string().max(100)),
      verifyToken: optionalField(z.string().max(500)),
      appSecret: optionalField(z.string().max(500)),
      apiVersion: optionalField(z.string().regex(/^v\d+\.\d+$/))
    }).optional(),
    email: z.object({
      user: optionalField(z.string().email().max(254)),
      from: optionalField(z.string().max(320)),
      fromName: optionalField(z.string().max(200)),
      appPassword: optionalField(z.string().max(256))
    }).optional()
  }).refine((body) => Object.keys(body).length > 0)
});

module.exports = { updateSettingSchema, deleteSettingSchema, bulkSettingsSchema };
