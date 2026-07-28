const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const mongoose = require('mongoose');
const { encrypt, decrypt } = require('./crypto.service');

const BUCKET_NAME = 'conversation_backups';

function bucket() {
  if (!mongoose.connection.db) {
    throw new Error('MongoDB indisponivel para armazenar o backup');
  }
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
    bucketName: BUCKET_NAME
  });
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function upload(payload, options = {}) {
  const plaintext = JSON.stringify(payload);
  const encrypted = encrypt(plaintext);
  const content = Buffer.from(encrypted, 'utf8');
  const filename = options.filename
    || `notify-flow-whatsapp-cloud-${new Date().toISOString()}.enc`;
  const stream = bucket().openUploadStream(filename, {
    contentType: 'application/octet-stream',
    metadata: {
      channel: 'whatsapp_cloud',
      encrypted: true,
      format: payload?.format || 'notify-flow.whatsapp-cloud-conversations',
      generatedAt: payload?.generatedAt || new Date().toISOString()
    }
  });

  await pipeline(Readable.from([content]), stream);
  return {
    fileId: stream.id,
    filename,
    contentType: 'application/octet-stream',
    storageBytes: content.length,
    plaintextBytes: Buffer.byteLength(plaintext),
    checksumSha256: sha256(content)
  };
}

async function download(fileId, expectedChecksum) {
  const chunks = [];
  for await (const chunk of bucket().openDownloadStream(new mongoose.Types.ObjectId(fileId))) {
    chunks.push(Buffer.from(chunk));
  }
  const content = Buffer.concat(chunks);
  if (expectedChecksum && sha256(content) !== expectedChecksum) {
    throw new Error('Integridade do backup invalida');
  }
  return decrypt(content.toString('utf8'), { json: true });
}

async function remove(fileId) {
  if (!fileId) return false;
  try {
    await bucket().delete(new mongoose.Types.ObjectId(fileId));
    return true;
  } catch (error) {
    if (error?.code === 26 || /FileNotFound/i.test(String(error?.message || ''))) return false;
    throw error;
  }
}

module.exports = {
  upload,
  download,
  remove,
  BUCKET_NAME
};
