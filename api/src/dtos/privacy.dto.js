const { z, idParams } = require('./common.dto');
const { DELIVERY_CHANNELS } = require('../enums/channels');

const contactPrivacySchema = z.object({ params: idParams });
const consentSchema = z.object({
  params: idParams,
  body: z.object({
    channel: z.enum(DELIVERY_CHANNELS),
    status: z.enum(['granted', 'revoked', 'denied']),
    legalBasis: z.string().min(1).max(100).optional(),
    purpose: z.string().min(1).max(200).optional(),
    source: z.string().min(1).max(100),
    termsVersion: z.string().max(40).optional(),
    evidence: z.record(z.unknown()).optional()
  })
});

module.exports = { contactPrivacySchema, consentSchema };
