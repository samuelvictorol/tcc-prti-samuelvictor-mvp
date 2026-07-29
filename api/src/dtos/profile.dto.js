const { z, objectId, paginationQuery } = require('./common.dto');

const requestProfileLoginSchema = z.object({
  body: z.object({
    identifierType: z.enum(['email', 'phone']),
    identifier: z.string().trim().min(7).max(254)
  })
});

const exchangeProfileLinkSchema = z.object({
  body: z.object({
    token: z.string().trim().min(40).max(4096)
  })
});

const updateOwnProfileSchema = z.object({
  body: z.object({
    displayName: z.string().trim().min(1).max(200).optional(),
    email: z.union([z.string().trim().email().max(254), z.null()]).optional(),
    phone: z.union([z.string().trim().min(7).max(40), z.null()]).optional(),
    telegramUsername: z.union([z.string().trim().min(1).max(64), z.null()]).optional()
  }).refine((body) => Object.keys(body).length > 0, 'Informe ao menos um campo')
});

const revokeOwnConsentSchema = z.object({
  body: z.object({
    channel: z.enum(['telegram', 'whatsapp_cloud', 'email']),
    confirmed: z.literal(true)
  })
});

const setOwnEmailConsentSchema = z.object({
  body: z.object({
    enabled: z.boolean(),
    confirmed: z.literal(true)
  })
});

const profileHistorySchema = z.object({ query: paginationQuery });

const ownGroupMembershipSchema = z.object({
  params: z.object({ id: objectId })
});

const removeOwnGroupMembershipSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ confirmed: z.literal(true) })
});

const removeOwnInviteMembershipSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ confirmed: z.literal(true) })
});

const profileLoginLogsSchema = z.object({
  query: paginationQuery.extend({
    identifierType: z.enum(['email', 'phone']).optional(),
    deliveryChannel: z.enum(['email', 'whatsapp_cloud', 'telegram']).optional()
  })
});

module.exports = {
  requestProfileLoginSchema,
  exchangeProfileLinkSchema,
  updateOwnProfileSchema,
  revokeOwnConsentSchema,
  setOwnEmailConsentSchema,
  profileHistorySchema,
  ownGroupMembershipSchema,
  removeOwnGroupMembershipSchema,
  removeOwnInviteMembershipSchema,
  profileLoginLogsSchema
};
