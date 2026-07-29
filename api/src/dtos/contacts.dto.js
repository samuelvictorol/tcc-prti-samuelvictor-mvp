const { z, objectId, idParams, booleanQuery, paginationQuery } = require('./common.dto');
const { DELIVERY_CHANNELS } = require('../enums/channels');

function publicIdentityMetadata(metadata) {
  return Object.fromEntries(Object.entries(metadata || {}).filter(([key]) => {
    const normalized = String(key).replace(/[_-]/g, '').toLowerCase();
    return normalized !== 'consentsource'
      && normalized !== 'consentcommand'
      && !normalized.startsWith('consentchanged')
      && normalized !== 'permissioncommandreceived'
      && normalized !== 'autoregisteredvia';
  }));
}

const channelIdentity = z.object({
  channel: z.enum(DELIVERY_CHANNELS),
  address: z.string().min(1).max(500),
  authorized: z.boolean().optional(),
  consentStatus: z.enum(['unknown', 'granted', 'revoked', 'denied']).optional(),
  source: z.string().max(80).optional(),
  interactedAt: z.coerce.date().optional(),
  metadata: z.record(z.unknown()).optional()
});

// Consentimento nunca nasce do payload de cadastro manual. Campos de permissao
// enviados por clientes antigos sao removidos pelo Zod e a concessao segue pelo
// endpoint dedicado, que tambem cria o evento de auditoria.
const manualChannelIdentity = z.object({
  channel: z.enum(DELIVERY_CHANNELS),
  address: z.string().min(1).max(500),
  interactedAt: z.coerce.date().optional(),
  metadata: z.record(z.unknown()).transform(publicIdentityMetadata).optional()
});

const contactBody = z.object({
  displayName: z.string().min(1).max(200),
  email: z.string().email().max(254).nullish(),
  phone: z.string().min(7).max(40).nullish(),
  telegramUsername: z.string().min(1).max(64).nullish(),
  avatarUrl: z.string().url().max(2048).nullish(),
  channels: z.array(channelIdentity).max(10).optional(),
  tags: z.array(z.string().min(1).max(50)).max(50).optional(),
  active: z.boolean().optional(),
  notificationDisabled: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional()
});

const createContactSchema = z.object({
  body: contactBody.extend({ channels: z.array(manualChannelIdentity).max(10).optional() })
});
const updateContactSchema = z.object({ params: idParams, body: contactBody.partial().refine((body) => Object.keys(body).length > 0) });
const contactIdSchema = z.object({ params: idParams });
const removeContactInviteSchema = z.object({
  params: z.object({
    id: objectId,
    inviteId: objectId
  }),
  body: z.object({ confirmed: z.literal(true) })
});
const listContactsSchema = z.object({
  query: paginationQuery.extend({
    search: z.string().max(254).optional(),
    channel: z.enum(DELIVERY_CHANNELS).optional(),
    authorized: booleanQuery.optional(),
    active: booleanQuery.optional(),
    inviteId: objectId.optional()
  })
});

module.exports = {
  createContactSchema,
  updateContactSchema,
  contactIdSchema,
  removeContactInviteSchema,
  listContactsSchema,
  channelIdentity,
  manualChannelIdentity
};
