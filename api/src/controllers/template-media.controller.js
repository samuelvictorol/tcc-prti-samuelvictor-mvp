const mediaManager = require('../managers/template-media.manager');

function contentDisposition(filename, mediaType) {
  const ascii = String(filename || 'arquivo')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_');
  const mode = mediaType === 'document' ? 'attachment' : 'inline';
  return mode + '; filename="' + ascii + '"; filename*=UTF-8\'\'' + encodeURIComponent(filename || 'arquivo');
}

async function upload(req, res) {
  const parsed = req.templateMediaUpload;
  try {
    const data = await mediaManager.upload(parsed.file, parsed.mediaType, req.admin.id, { purpose: parsed.purpose });
    res.status(201).json({ success: true, data });
  } finally {
    await parsed.cleanup();
  }
}

async function serve(req, res, next) {
  const media = await mediaManager.open(req.params.token, req.get('range'));
  const contentLength = media.range ? media.range.length : media.size;
  res.set({
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=31536000, immutable, no-transform',
    'Content-Disposition': contentDisposition(media.filename, media.mediaType),
    'Content-Length': String(contentLength),
    'Content-Type': media.mimeType,
    'X-Content-Type-Options': 'nosniff',
    'X-No-Compression': '1'
  });
  if (media.range) {
    res.status(206);
    res.set('Content-Range', 'bytes ' + media.range.start + '-' + media.range.end + '/' + media.size);
  }
  if (req.method === 'HEAD') {
    media.stream.destroy();
    return res.end();
  }
  res.once('close', () => {
    if (!res.writableEnded && !media.stream.destroyed) media.stream.destroy();
  });
  media.stream.once('error', next);
  media.stream.pipe(res);
  return undefined;
}

async function discard(req, res) {
  const data = await mediaManager.discardPending(req.params.id, req.admin.id);
  res.json({ success: true, data });
}

module.exports = { upload, serve, discard, contentDisposition };
