const fs = require('node:fs/promises');
const os = require('node:os');
const { formidable } = require('formidable');
const ApiError = require('../utils/api-error');

const MAX_MULTIPART_BYTES = 100 * 1024 * 1024;

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

async function removeTemporaryFiles(files) {
  const paths = Object.values(files || {})
    .flatMap(asArray)
    .map((file) => file?.filepath)
    .filter(Boolean);
  await Promise.all(paths.map((filepath) => fs.unlink(filepath).catch(() => {})));
}

function formidableError(error) {
  if (Number(error?.httpCode) === 413) {
    return new ApiError(
      413,
      'Arquivo excede o limite maximo de 100 MB',
      { maxBytes: MAX_MULTIPART_BYTES },
      'TEMPLATE_MEDIA_TOO_LARGE'
    );
  }
  return new ApiError(400, 'Upload multipart invalido', null, 'TEMPLATE_MEDIA_MULTIPART_INVALID');
}

function parseTemplateMedia(req, res, next) {
  if (!/^multipart\/form-data\b/i.test(String(req.get('content-type') || ''))) {
    return next(new ApiError(
      415,
      'Envie o arquivo como multipart/form-data no campo file',
      { field: 'file' },
      'TEMPLATE_MEDIA_MULTIPART_REQUIRED'
    ));
  }

  const form = formidable({
    allowEmptyFiles: false,
    keepExtensions: false,
    maxFields: 4,
    maxFieldsSize: 16 * 1024,
    maxFiles: 1,
    maxFileSize: MAX_MULTIPART_BYTES,
    maxTotalFileSize: MAX_MULTIPART_BYTES,
    minFileSize: 1,
    multiples: false,
    uploadDir: os.tmpdir()
  });

  form.parse(req, async (error, fields, files) => {
    if (error) {
      await removeTemporaryFiles(files);
      return next(formidableError(error));
    }

    const unexpectedFileFields = Object.keys(files || {}).filter((key) => key !== 'file');
    const unexpectedFields = Object.keys(fields || {}).filter((key) => !['mediaType', 'purpose'].includes(key));
    const uploadedFiles = asArray(files?.file).filter(Boolean);
    if (unexpectedFileFields.length || unexpectedFields.length || uploadedFiles.length !== 1) {
      await removeTemporaryFiles(files);
      return next(new ApiError(
        422,
        'Envie exatamente um arquivo no campo file',
        { field: 'file', unexpectedFields: [...unexpectedFileFields, ...unexpectedFields] },
        'TEMPLATE_MEDIA_FILE_REQUIRED'
      ));
    }

    let cleaned = false;
    const cleanup = async () => {
      if (cleaned) return;
      cleaned = true;
      await removeTemporaryFiles(files);
    };
    res.once('close', () => { cleanup().catch(() => {}); });
    res.once('finish', () => { cleanup().catch(() => {}); });
    req.templateMediaUpload = {
      file: uploadedFiles[0],
      mediaType: asArray(fields?.mediaType)[0] || null,
      purpose: asArray(fields?.purpose)[0] || 'template',
      cleanup
    };
    return next();
  });
}

module.exports = {
  parseTemplateMedia,
  removeTemporaryFiles,
  MAX_MULTIPART_BYTES
};
