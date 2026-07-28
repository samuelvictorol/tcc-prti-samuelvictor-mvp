const dns = require('node:dns').promises;
const https = require('node:https');
const net = require('node:net');
const ApiError = require('../utils/api-error');

const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const DNS_TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 3;

function mediaError(message, code = 'UNSAFE_MEDIA_URL', details) {
  return new ApiError(422, message, details, code);
}

function ipv4Number(address) {
  const parts = String(address).split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0;
}

function inIpv4Range(value, base, bits) {
  const numeric = ipv4Number(value);
  const baseNumeric = ipv4Number(base);
  if (numeric === null || baseNumeric === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (numeric & mask) === (baseNumeric & mask);
}

function mappedIpv4(address) {
  const normalized = String(address).toLowerCase();
  const dotted = normalized.match(/(?:^|:)ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (dotted) return dotted;
  const hex = normalized.match(/(?:^|:)ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const high = Number.parseInt(hex[1], 16);
  const low = Number.parseInt(hex[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

function isPrivateAddress(address) {
  const normalizedAddress = String(address).replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();
  const family = net.isIP(normalizedAddress);
  if (family === 4) {
    return [
      ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
      ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
      ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
      ['224.0.0.0', 4], ['240.0.0.0', 4]
    ].some(([base, bits]) => inIpv4Range(normalizedAddress, base, bits));
  }
  if (family !== 6) return true;
  const mapped = mappedIpv4(normalizedAddress);
  if (mapped) return isPrivateAddress(mapped);
  const leading = normalizedAddress.match(/^([0-9a-f]{1,4})(?::([0-9a-f]{0,4}))?/);
  if (!leading) return true;
  const first = Number.parseInt(leading[1], 16);
  const second = Number.parseInt(leading[2] || '0', 16);
  // Routable global unicast currently lives in 2000::/3. Keep transition,
  // documentation and protocol-only ranges out even though they share it.
  if (first < 0x2000 || first > 0x3fff) return true;
  return (first === 0x2001 && (second <= 0x01ff || second === 0x0db8))
    || first === 0x2002
    || first === 0x3fff;
}

function normalizedHostname(value) {
  return String(value || '').replace(/^\[|\]$/g, '').toLowerCase();
}

function parsePublicHttpsUrl(value) {
  let url;
  try { url = new URL(String(value || '')); } catch (_error) { throw mediaError('URL de midia invalida'); }
  if (url.protocol !== 'https:') throw mediaError('A midia do Telegram deve usar HTTPS');
  if (url.username || url.password) throw mediaError('A URL de midia nao pode conter credenciais');
  if (url.port && url.port !== '443') throw mediaError('A URL de midia deve usar a porta HTTPS padrao');
  url.hash = '';
  const hostname = normalizedHostname(url.hostname);
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw mediaError('Host de midia local nao permitido');
  }
  return url;
}

async function resolvePublicHost(hostname) {
  hostname = normalizedHostname(hostname);
  let addresses;
  if (net.isIP(hostname)) addresses = [{ address: hostname, family: net.isIP(hostname) }];
  else {
    let timeout;
    try {
      addresses = await Promise.race([
        dns.lookup(hostname, { all: true, verbatim: true }),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(mediaError('Tempo limite ao resolver o host da midia', 'MEDIA_HOST_UNREACHABLE')), DNS_TIMEOUT_MS);
          timeout.unref?.();
        })
      ]);
    } catch (_error) {
      throw mediaError('Nao foi possivel resolver o host da midia', 'MEDIA_HOST_UNREACHABLE');
    } finally {
      clearTimeout(timeout);
    }
  }
  if (!addresses?.length) throw mediaError('Host de midia sem endereco publico', 'MEDIA_HOST_UNREACHABLE');
  if (addresses.some(({ address }) => isPrivateAddress(address))) {
    throw mediaError('A URL de midia aponta para uma rede privada ou reservada');
  }
  // Render and other container hosts commonly resolve an IPv6 address first
  // even when the runtime has no IPv6 egress. Prefer IPv4 when the hostname
  // publishes both families, while still supporting truly IPv6-only hosts.
  return addresses.find(({ family }) => Number(family) === 4) || addresses[0];
}

function sniffMedia(buffer) {
  if (buffer.length >= 12 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: 'image/jpeg', extension: 'jpg' };
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mimeType: 'image/png', extension: 'png' };
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return { mimeType: 'image/webp', extension: 'webp' };
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {
    return { mimeType: 'video/mp4', extension: 'mp4' };
  }
  return null;
}

function assertMediaType(kind, declaredType, detected) {
  const declaredAliases = {
    'image/jpg': 'image/jpeg',
    'image/pjpeg': 'image/jpeg',
    'image/x-png': 'image/png'
  };
  const rawDeclared = String(declaredType || '').split(';')[0].trim().toLowerCase();
  const declared = declaredAliases[rawDeclared] || rawDeclared;
  const genericDeclaredTypes = new Set(['application/octet-stream', 'application/binary', 'binary/octet-stream']);
  const allowed = kind === 'photo'
    ? new Set(['image/jpeg', 'image/png', 'image/webp'])
    : new Set(['video/mp4']);
  if (!detected || !allowed.has(detected.mimeType)) {
    throw mediaError(kind === 'photo' ? 'Arquivo nao e uma imagem JPEG, PNG ou WebP valida' : 'Video deve ser um arquivo MP4 valido', 'MEDIA_TYPE_INVALID');
  }
  if (declared && !genericDeclaredTypes.has(declared) && !allowed.has(declared)) {
    throw mediaError('O Content-Type da midia nao corresponde ao formato permitido', 'MEDIA_TYPE_INVALID');
  }
  if (declared && !genericDeclaredTypes.has(declared) && declared !== detected.mimeType) {
    throw mediaError('O tipo declarado da midia difere do conteudo real', 'MEDIA_TYPE_MISMATCH');
  }
}

function downloadRequestError(error) {
  if (error instanceof ApiError) return error;
  const code = String(error?.code || '').toUpperCase();
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) {
    return mediaError('Nao foi possivel resolver o host da midia', 'MEDIA_HOST_UNREACHABLE');
  }
  if (['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT'].includes(code)) {
    return mediaError(
      'O servidor da midia nao esta acessivel pela internet. Confira se o link e publico e direto para o arquivo',
      'MEDIA_HOST_UNREACHABLE'
    );
  }
  if (['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(code)) {
    return mediaError('O certificado HTTPS do servidor da midia nao e valido', 'MEDIA_TLS_INVALID');
  }
  return mediaError(
    'Nao foi possivel baixar a midia. Use um link HTTPS publico e direto para uma imagem ou video',
    'MEDIA_DOWNLOAD_FAILED'
  );
}

function pinnedLookup(pinned) {
  return (_hostname, lookupOptions, callback) => {
    if (lookupOptions?.all) {
      callback(null, [{ address: pinned.address, family: pinned.family }]);
      return;
    }
    callback(null, pinned.address, pinned.family);
  };
}

async function requestBuffer(url, kind, redirectCount = 0, options = {}) {
  const parsed = parsePublicHttpsUrl(url);
  const hostname = normalizedHostname(parsed.hostname);
  const pinned = await resolvePublicHost(hostname);
  const maxBytes = kind === 'photo' ? PHOTO_MAX_BYTES : VIDEO_MAX_BYTES;
  const timeoutMs = Math.min(Number(options.timeoutMs || REQUEST_TIMEOUT_MS), 30_000);

  return new Promise((resolve, reject) => {
    let settled = false;
    let deadline;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      reject(downloadRequestError(error));
    };
    const request = https.request({
      protocol: 'https:',
      hostname,
      port: parsed.port || 443,
      path: `${parsed.pathname}${parsed.search}`,
      method: 'GET',
      servername: hostname,
      headers: {
        accept: kind === 'photo' ? 'image/jpeg,image/png,image/webp' : 'video/mp4',
        'accept-encoding': 'identity',
        'user-agent': 'NotifyApp-MediaFetcher/1.0'
      },
      // Node 20 enables autoSelectFamily and may request lookup({ all: true }).
      // Returning the legacy scalar shape in that case produces
      // ERR_INVALID_IP_ADDRESS before any network request is attempted.
      lookup: pinnedLookup(pinned)
    }, (response) => {
      const status = Number(response.statusCode || 0);
      if ([301, 302, 303, 307, 308].includes(status)) {
        response.resume();
        if (redirectCount >= MAX_REDIRECTS) return fail(mediaError('A URL de midia excedeu o limite de redirecionamentos', 'MEDIA_REDIRECT_LIMIT'));
        const location = response.headers.location;
        if (!location) return fail(mediaError('Redirecionamento de midia sem destino', 'MEDIA_REDIRECT_INVALID'));
        let target;
        try { target = new URL(location, parsed); } catch (_error) { return fail(mediaError('Redirecionamento de midia invalido', 'MEDIA_REDIRECT_INVALID')); }
        settled = true;
        clearTimeout(deadline);
        return resolve(requestBuffer(target.toString(), kind, redirectCount + 1, options));
      }
      if (status < 200 || status >= 300) {
        response.resume();
        return fail(mediaError('Servidor de midia respondeu com status ' + status, 'MEDIA_DOWNLOAD_FAILED'));
      }
      const contentEncoding = String(response.headers['content-encoding'] || 'identity').toLowerCase();
      if (!['', 'identity'].includes(contentEncoding)) {
        response.resume();
        return fail(mediaError('Midia comprimida no transporte nao e aceita', 'MEDIA_ENCODING_UNSUPPORTED'));
      }
      const declaredLength = Number(response.headers['content-length'] || 0);
      if (declaredLength > maxBytes) {
        response.destroy();
        return fail(mediaError('Arquivo de midia excede o limite permitido', 'MEDIA_TOO_LARGE', { maxBytes }));
      }
      const chunks = [];
      let received = 0;
      response.on('data', (chunk) => {
        received += chunk.length;
        if (received > maxBytes) {
          response.destroy();
          fail(mediaError('Arquivo de midia excede o limite permitido', 'MEDIA_TOO_LARGE', { maxBytes }));
          return;
        }
        chunks.push(chunk);
      });
      response.on('error', fail);
      response.on('end', () => {
        if (settled) return;
        const buffer = Buffer.concat(chunks);
        if (!buffer.length) return fail(mediaError('Arquivo de midia vazio', 'MEDIA_EMPTY'));
        const detected = sniffMedia(buffer);
        try { assertMediaType(kind, response.headers['content-type'], detected); } catch (error) { return fail(error); }
        settled = true;
        clearTimeout(deadline);
        resolve({
          buffer,
          mimeType: detected.mimeType,
          filename: `telegram-${kind}.${detected.extension}`,
          bytes: buffer.length,
          finalUrl: parsed.toString()
        });
      });
    });
    deadline = setTimeout(() => request.destroy(mediaError('Tempo limite ao baixar a midia', 'MEDIA_DOWNLOAD_TIMEOUT')), timeoutMs);
    deadline.unref?.();
    request.on('error', fail);
    request.end();
  });
}

async function downloadTelegramMedia(url, kind, options = {}) {
  if (!['photo', 'video'].includes(kind)) throw mediaError('Tipo de midia Telegram invalido', 'MEDIA_TYPE_INVALID');
  return requestBuffer(url, kind, 0, options);
}

module.exports = {
  PHOTO_MAX_BYTES,
  VIDEO_MAX_BYTES,
  parsePublicHttpsUrl,
  resolvePublicHost,
  isPrivateAddress,
  sniffMedia,
  assertMediaType,
  downloadRequestError,
  pinnedLookup,
  downloadTelegramMedia
};
