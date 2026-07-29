const { z, idParams } = require('./common.dto');
const MANUAL_CONSENT_CHANNELS = ['telegram', 'whatsapp_cloud', 'email'];

const contactPrivacySchema = z.object({ params: idParams });
const consentSchema = z.object({
  params: idParams,
  body: z.object({
    channel: z.enum(MANUAL_CONSENT_CHANNELS),
    status: z.enum(['granted', 'revoked', 'denied']),
    legalBasis: z.string().min(1).max(100).optional(),
    purpose: z.string().min(1).max(200).optional(),
    termsVersion: z.string().max(40).optional(),
    evidence: z.record(z.unknown()).optional(),
    confirmed: z.boolean().optional()
  }).superRefine((body, context) => {
    if (['revoked', 'denied'].includes(body.status) && body.confirmed !== true) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['confirmed'],
        message: 'Confirme explicitamente a remocao da permissao'
      });
    }
  })
});

module.exports = { contactPrivacySchema, consentSchema, MANUAL_CONSENT_CHANNELS };
