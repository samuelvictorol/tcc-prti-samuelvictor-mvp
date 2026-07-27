const { z, objectId, idParams, paginationQuery, inviteUrl } = require('./common.dto');
const { DELIVERY_CHANNELS } = require('../enums/channels');

const groupBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullish(),
  source: z.enum(['manual', ...DELIVERY_CHANNELS]).optional(),
  externalId: z.string().max(500).nullish(),
  inviteLink: inviteUrl.nullish(),
  imageUrl: z.string().url().max(2048).nullish(),
  contactIds: z.array(objectId).max(10000).optional(),
  active: z.boolean().optional(),
  notificationDisabled: z.boolean().optional()
});

const createGroupSchema = z.object({ body: groupBody });
const updateGroupSchema = z.object({ params: idParams, body: groupBody.partial().refine((body) => Object.keys(body).length > 0) });
const groupIdSchema = z.object({ params: idParams });
const listGroupsSchema = z.object({
  query: paginationQuery.extend({
    search: z.string().max(200).optional(),
    source: z.enum(['manual', ...DELIVERY_CHANNELS]).optional(),
    inviteId: objectId.optional()
  })
});

const syncInviteGroupsSchema = z.object({
  body: z.object({
    inviteIds: z.array(objectId).min(1).max(200)
  }).strict()
});

const syncExistingGroupInviteSchema = z.object({
  params: idParams,
  body: z.object({ inviteId: objectId }).strict()
});

module.exports = {
  createGroupSchema,
  updateGroupSchema,
  groupIdSchema,
  listGroupsSchema,
  syncInviteGroupsSchema,
  syncExistingGroupInviteSchema
};
