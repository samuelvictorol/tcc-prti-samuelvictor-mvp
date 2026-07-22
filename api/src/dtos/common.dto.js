const { z } = require('zod');
const { isAllowedInviteUrl, isSafePublicHttpsUrl } = require('../utils/urls');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'ObjectId invalido');
const booleanQuery = z.preprocess((value) => {
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return value;
}, z.boolean());
const paginationQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
}).passthrough();

const idParams = z.object({ id: objectId });
const inviteUrl = z.string().min(3).max(2048).refine(isAllowedInviteUrl, 'Protocolo de link nao permitido');
const publicHttpsUrl = z.string().trim().min(8).max(2048).refine(isSafePublicHttpsUrl, 'Informe uma URL HTTPS publica e segura');

module.exports = { z, objectId, booleanQuery, paginationQuery, idParams, inviteUrl, publicHttpsUrl };
