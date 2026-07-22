const { z, idParams, booleanQuery, paginationQuery, inviteUrl, publicHttpsUrl } = require('./common.dto');
const { DELIVERY_CHANNELS } = require('../enums/channels');

const inviteBody = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).nullish(),
  iconeUrl: publicHttpsUrl.nullish(),
  links: z.array(z.object({
    label: z.string().min(1).max(100),
    url: inviteUrl,
    channel: z.enum([...DELIVERY_CHANNELS, 'other']).optional(),
    active: z.boolean().optional()
  })).max(30).default([]),
  gradientStart: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  gradientEnd: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  recipientContact: z.string().regex(/^[a-f\d]{24}$/i).nullish(),
  active: z.boolean().optional()
});

const createInviteSchema = z.object({ body: inviteBody });
const updateInviteSchema = z.object({ params: idParams, body: inviteBody.partial().refine((body) => Object.keys(body).length > 0) });
const inviteIdSchema = z.object({ params: idParams });
const listInvitesSchema = z.object({ query: paginationQuery.extend({ active: booleanQuery.optional() }) });
const publicInviteSchema = z.object({ params: z.object({ slug: z.string().min(3).max(100) }), query: z.object({ token: z.string().optional() }).passthrough() });
const trackInviteSchema = z.object({
  params: z.object({ slug: z.string().min(3).max(100), linkId: z.string().regex(/^[a-f\d]{24}$/i) }),
  query: z.object({ token: z.string().optional() }).passthrough()
});

module.exports = { createInviteSchema, updateInviteSchema, inviteIdSchema, listInvitesSchema, publicInviteSchema, trackInviteSchema };
