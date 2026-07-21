const { z, idParams, booleanQuery, paginationQuery } = require('./common.dto');
const { DELIVERY_CHANNELS } = require('../enums/channels');

const channelIdentity = z.object({
  channel: z.enum(DELIVERY_CHANNELS),
  address: z.string().min(1).max(500),
  authorized: z.boolean().optional(),
  consentStatus: z.enum(['unknown', 'granted', 'revoked', 'denied']).optional(),
  source: z.string().max(80).optional(),
  interactedAt: z.coerce.date().optional(),
  metadata: z.record(z.unknown()).optional()
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

const createContactSchema = z.object({ body: contactBody });
const updateContactSchema = z.object({ params: idParams, body: contactBody.partial().refine((body) => Object.keys(body).length > 0) });
const contactIdSchema = z.object({ params: idParams });
const listContactsSchema = z.object({
  query: paginationQuery.extend({
    search: z.string().max(254).optional(),
    channel: z.enum(DELIVERY_CHANNELS).optional(),
    authorized: booleanQuery.optional(),
    active: booleanQuery.optional()
  })
});

module.exports = { createContactSchema, updateContactSchema, contactIdSchema, listContactsSchema, channelIdentity };
