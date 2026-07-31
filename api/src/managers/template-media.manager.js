const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const mongoose = require('mongoose');
const ApiError = require('../utils/api-error');
const { env } = require('../config/env');

const BUCKET_NAME = 'templateMedia';
const MB = 1024 * 1024;
const TEMPLATE_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const DISPATCH_MEDIA_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MEDIA_RULES = Object.freeze({
  image: Object.freeze({
    maxBytes: 5 * MB,
    mimeExtensions: Object.freeze({
      'image/jpeg': Object.freeze(['.jpg', '.jpeg']),
      'image/png': Object.freeze(['.png'])
    })
  }),
  video: Object.freeze({
    maxBytes: 16 * MB,
    mimeExtensions: Object.freeze({
      'video/mp4': Object.freeze(['.mp4']),
      'video/3gpp': Object.freeze(['.3gp'])
    })
  }),
  document: Object.freeze({
    maxBytes: 100 * MB,
    mimeExtensions: Object.freeze({
      'text/plain': Object.freeze(['.txt']),
      'application/pdf': Object.freeze(['.pdf']),
      'application/msword': Object.freeze(['.doc']),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': Object.freeze(['.docx']),
      'application/vnd.ms-excel': Object.freeze(['.xls']),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': Object.freeze(['.xlsx']),
      'application/vnd.ms-powerpoint': Object.freeze(['.ppt']),
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': Object.freeze(['.pptx'])
    })
  })
});

function normalizeMimeType(value) {
  return String(value || '').split(';', 1)[0].trim().toLowerCase();
}

function safeFilename(value) {
  const withoutControls = Array.from(path.basename(String(value || 'arquivo')).normalize('NFC'))
    .filter((character) => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127)
    .join('');
  const basename = withoutControls
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return (basename || 'arquivo').slice(0, 180);
}

function inferMediaType(mimeType) {
  return Object.entries(MEDIA_RULES).find(([, rule]) => rule.mimeExtensions[mimeType])?.[0] || null;
}

function validateUpload(file, requestedMediaType) {
  const filename = safeFilename(file?.originalFilename);
  const extension = path.extname(filename).toLowerCase();
  const mimeType = normalizeMimeType(file?.mimetype);
  const mediaType = requestedMediaType ? String(requestedMediaType).trim().toLowerCase() : inferMediaType(mimeType);
  const rule = MEDIA_RULES[mediaType];
  const size = Number(file?.size || 0);

  if (!rule) {
    throw new ApiError(
      422,
      'Tipo de midia invalido',
      { field: 'mediaType', allowed: Object.keys(MEDIA_RULES) },
      'TEMPLATE_MEDIA_TYPE_INVALID'
    );
  }
  const allowedExtensions = rule.mimeExtensions[mimeType];
  if (!allowedExtensions) {
    throw new ApiError(
      415,
      'Formato de arquivo nao suportado pela Meta',
      { mediaType, mimeType, allowedMimeTypes: Object.keys(rule.mimeExtensions) },
      'TEMPLATE_MEDIA_MIME_INVALID'
    );
  }
  if (!allowedExtensions.includes(extension)) {
    throw new ApiError(
      415,
      'Extensao nao corresponde ao tipo do arquivo',
      { mediaType, mimeType, extension, allowedExtensions },
      'TEMPLATE_MEDIA_EXTENSION_INVALID'
    );
  }
  if (!Number.isSafeInteger(size) || size < 1) {
    throw new ApiError(422, 'Arquivo vazio ou invalido', { size }, 'TEMPLATE_MEDIA_EMPTY');
  }
  if (size > rule.maxBytes) {
    throw new ApiError(
      413,
      'Arquivo excede o limite para ' + mediaType,
      { mediaType, size, maxBytes: rule.maxBytes },
      'TEMPLATE_MEDIA_TOO_LARGE'
    );
  }
  return { filename, extension, mimeType, mediaType, size, maxBytes: rule.maxBytes };
}

function startsWithBytes(buffer, expected) {
  return expected.every((byte, index) => buffer[index] === byte);
}

async function validateContentSignature(filepath, mimeType) {
  const handle = await fs.promises.open(filepath, 'r');
  let buffer;
  try {
    buffer = Buffer.alloc(512);
    const result = await handle.read(buffer, 0, buffer.length, 0);
    buffer = buffer.subarray(0, result.bytesRead);
  } finally {
    await handle.close();
  }

  const signatures = {
    'image/jpeg': () => startsWithBytes(buffer, [0xff, 0xd8, 0xff]),
    'image/png': () => startsWithBytes(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    'application/pdf': () => buffer.subarray(0, 5).toString('ascii') === '%PDF-',
    'video/mp4': () => buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp',
    'video/3gpp': () => buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp',
    'application/msword': () => startsWithBytes(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    'application/vnd.ms-excel': () => startsWithBytes(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    'application/vnd.ms-powerpoint': () => startsWithBytes(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': () => startsWithBytes(buffer, [0x50, 0x4b]),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': () => startsWithBytes(buffer, [0x50, 0x4b]),
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': () => startsWithBytes(buffer, [0x50, 0x4b]),
    'text/plain': () => buffer.length > 0 && !buffer.includes(0) && !buffer.toString('utf8').includes('\ufffd')
  };
  const valid = signatures[mimeType]?.() === true;
  if (!valid) {
    throw new ApiError(
      415,
      'Conteudo do arquivo nao corresponde ao MIME informado',
      { mimeType },
      'TEMPLATE_MEDIA_CONTENT_INVALID'
    );
  }
  return true;
}

function bucketForConnection() {
  if (!mongoose.connection.db || mongoose.connection.readyState !== 1) {
    throw new ApiError(503, 'Armazenamento de midia indisponivel', null, 'TEMPLATE_MEDIA_STORAGE_UNAVAILABLE');
  }
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: BUCKET_NAME });
}

function signId(id) {
  return crypto.createHmac('sha256', env.mediaSigningSecret)
    .update('template-media:v1:' + String(id))
    .digest('base64url');
}

function validSignature(id, signature) {
  const expected = Buffer.from(signId(id));
  const actual = Buffer.from(String(signature || ''));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function publicToken(id) {
  return String(id) + '.' + signId(id);
}

function parsePublicToken(token) {
  const match = /^([a-f\d]{24})\.([A-Za-z0-9_-]{43})$/i.exec(String(token || ''));
  if (!match || !validSignature(match[1], match[2])) {
    throw new ApiError(404, 'Midia nao encontrada', null, 'TEMPLATE_MEDIA_NOT_FOUND');
  }
  return match[1];
}

function publicUrl(id) {
  return env.mediaPublicBaseUrl
    + env.apiPrefix
    + '/media/'
    + encodeURIComponent(publicToken(id));
}

function responseForFile(file) {
  const metadata = file.metadata || {};
  const id = String(file._id);
  return {
    id,
    url: publicUrl(id),
    mimeType: String(file.contentType || metadata.mimeType || 'application/octet-stream'),
    mediaType: String(metadata.mediaType || 'document'),
    filename: String(metadata.originalFilename || file.filename || 'arquivo'),
    size: Number(file.length || metadata.size || 0)
  };
}

function normalizePurpose(value) {
  const purpose = String(value || 'template').trim().toLowerCase();
  if (!['template', 'dispatch'].includes(purpose)) {
    throw new ApiError(
      422,
      'Finalidade do upload invalida',
      { field: 'purpose', allowed: ['template', 'dispatch'] },
      'TEMPLATE_MEDIA_PURPOSE_INVALID'
    );
  }
  return purpose;
}

async function upload(file, requestedMediaType, actorId, options = {}) {
  const validated = validateUpload(file, requestedMediaType);
  await validateContentSignature(file.filepath, validated.mimeType);
  const bucket = options.bucket || bucketForConnection();
  const uploadedAt = new Date();
  const purpose = normalizePurpose(options.purpose);
  const expiresAt = new Date(uploadedAt.getTime() + (
    purpose === 'dispatch' ? DISPATCH_MEDIA_TTL_MS : TEMPLATE_DRAFT_TTL_MS
  ));
  const uploadStream = bucket.openUploadStream(validated.filename, {
    contentType: validated.mimeType,
    metadata: {
      scope: 'whatsapp_template',
      mediaType: validated.mediaType,
      mimeType: validated.mimeType,
      originalFilename: validated.filename,
      extension: validated.extension,
      size: validated.size,
      uploadedBy: actorId ? String(actorId) : null,
      uploadedAt,
      purpose,
      status: purpose === 'dispatch' ? 'dispatch' : 'pending',
      expiresAt
    }
  });
  const digest = crypto.createHash('sha256');
  const hashTransform = new Transform({
    transform(chunk, _encoding, callback) {
      digest.update(chunk);
      callback(null, chunk);
    }
  });

  try {
    await pipeline(fs.createReadStream(file.filepath), hashTransform, uploadStream);
    const sha256 = digest.digest('hex');
    const db = options.db || mongoose.connection.db;
    if (db?.collection) {
      await db.collection(BUCKET_NAME + '.files').updateOne(
        { _id: uploadStream.id },
        { $set: { 'metadata.sha256': sha256 } }
      );
    }
    return responseForFile({
      _id: uploadStream.id,
      filename: validated.filename,
      contentType: validated.mimeType,
      length: validated.size,
      metadata: {
        mediaType: validated.mediaType,
        mimeType: validated.mimeType,
        originalFilename: validated.filename,
        size: validated.size
      }
    });
  } catch (error) {
    await bucket.delete(uploadStream.id).catch(() => {});
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, 'Falha ao salvar a midia no MongoDB', null, 'TEMPLATE_MEDIA_STORAGE_FAILED');
  }
}

function objectId(value) {
  const normalized = String(value || '');
  if (!mongoose.isObjectIdOrHexString(normalized)) {
    throw new ApiError(404, 'Midia nao encontrada', null, 'TEMPLATE_MEDIA_NOT_FOUND');
  }
  return new mongoose.Types.ObjectId(normalized);
}

function parseByteRange(value, length) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(String(value).trim());
  if (!match || (!match[1] && !match[2]) || String(value).includes(',')) {
    throw new ApiError(416, 'Intervalo de bytes invalido', { length }, 'TEMPLATE_MEDIA_RANGE_INVALID');
  }
  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength < 1) {
      throw new ApiError(416, 'Intervalo de bytes invalido', { length }, 'TEMPLATE_MEDIA_RANGE_INVALID');
    }
    start = Math.max(0, length - suffixLength);
    end = length - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : length - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= length || end < start) {
    throw new ApiError(416, 'Intervalo fora do tamanho do arquivo', { length }, 'TEMPLATE_MEDIA_RANGE_INVALID');
  }
  end = Math.min(end, length - 1);
  return { start, end, length: end - start + 1 };
}

async function open(token, rangeHeader, options = {}) {
  const normalizedId = parsePublicToken(token);
  const gridId = objectId(normalizedId);
  const bucket = options.bucket || bucketForConnection();
  const file = await bucket.find({
    _id: gridId,
    'metadata.scope': 'whatsapp_template',
    $or: [
      { 'metadata.expiresAt': { $exists: false } },
      { 'metadata.expiresAt': { $gt: new Date() } }
    ]
  }).next();
  if (!file) throw new ApiError(404, 'Midia nao encontrada', null, 'TEMPLATE_MEDIA_NOT_FOUND');
  const range = parseByteRange(rangeHeader, Number(file.length));
  return {
    ...responseForFile(file),
    range,
    stream: bucket.openDownloadStream(gridId, range ? { start: range.start, end: range.end + 1 } : undefined)
  };
}

function normalizeAssetIds(values) {
  return [...new Set((values || [])
    .map((value) => String(value || '').trim())
    .filter((value) => mongoose.isObjectIdOrHexString(value)))];
}

async function retain(assetIds, options = {}) {
  const ids = normalizeAssetIds(assetIds).map((id) => new mongoose.Types.ObjectId(id));
  if (!ids.length) return { retained: 0 };
  const db = options.db || mongoose.connection.db;
  if (!db?.collection) throw new ApiError(503, 'Armazenamento de midia indisponivel', null, 'TEMPLATE_MEDIA_STORAGE_UNAVAILABLE');
  const result = await db.collection(BUCKET_NAME + '.files').updateMany(
    {
      _id: { $in: ids },
      'metadata.scope': 'whatsapp_template',
      $or: [
        { 'metadata.status': { $in: ['pending', 'retained'] } },
        { 'metadata.status': { $exists: false } }
      ]
    },
    {
      $set: { 'metadata.status': 'retained', 'metadata.purpose': 'template' },
      $unset: { 'metadata.expiresAt': '' }
    }
  );
  if (Number(result.matchedCount || 0) !== ids.length) {
    throw new ApiError(
      422,
      'Uma ou mais midias vinculadas nao existem ou expiraram',
      { requested: ids.length, matched: Number(result.matchedCount || 0) },
      'TEMPLATE_MEDIA_REFERENCE_INVALID'
    );
  }
  return { retained: Number(result.modifiedCount || 0) };
}

async function discardPending(id, actorId, options = {}) {
  const gridId = objectId(id);
  const bucket = options.bucket || bucketForConnection();
  const file = await bucket.find({
    _id: gridId,
    'metadata.scope': 'whatsapp_template',
    'metadata.status': 'pending',
    'metadata.uploadedBy': String(actorId || '')
  }).next();
  if (!file) throw new ApiError(404, 'Midia temporaria nao encontrada', null, 'TEMPLATE_MEDIA_NOT_FOUND');
  await bucket.delete(gridId);
  return { id: String(gridId), removed: true };
}

async function removeRetained(assetIds, options = {}) {
  const bucket = options.bucket || bucketForConnection();
  let removed = 0;
  for (const id of normalizeAssetIds(assetIds)) {
    const gridId = new mongoose.Types.ObjectId(id);
    const file = await bucket.find({
      _id: gridId,
      'metadata.scope': 'whatsapp_template',
      'metadata.status': 'retained'
    }).next();
    if (!file) continue;
    await bucket.delete(gridId);
    removed += 1;
  }
  return { removed };
}

async function cleanupExpired(options = {}) {
  const db = options.db || mongoose.connection.db;
  const bucket = options.bucket || bucketForConnection();
  if (!db?.collection) return { removed: 0 };
  const limit = Math.min(500, Math.max(1, Number(options.limit) || 100));
  const expired = await db.collection(BUCKET_NAME + '.files')
    .find({
      'metadata.scope': 'whatsapp_template',
      'metadata.expiresAt': { $lte: options.now || new Date() }
    })
    .project({ _id: 1 })
    .limit(limit)
    .toArray();
  let removed = 0;
  for (const file of expired) {
    try {
      await bucket.delete(file._id);
      removed += 1;
    } catch (_error) {
      // O proximo ciclo tenta novamente sem bloquear os demais arquivos.
    }
  }
  return { removed, scanned: expired.length };
}

module.exports = {
  upload,
  open,
  validateUpload,
  validateContentSignature,
  parseByteRange,
  signId,
  validSignature,
  publicToken,
  parsePublicToken,
  publicUrl,
  responseForFile,
  normalizePurpose,
  normalizeAssetIds,
  retain,
  discardPending,
  removeRetained,
  cleanupExpired,
  MEDIA_RULES,
  BUCKET_NAME,
  TEMPLATE_DRAFT_TTL_MS,
  DISPATCH_MEDIA_TTL_MS
};
