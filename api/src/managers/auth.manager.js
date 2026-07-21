const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Admin = require('../models/admin.model');
const RefreshToken = require('../models/refresh-token.model');
const { env, configuredAdmins } = require('../config/env');
const { tokenHash, searchHash } = require('../services/crypto.service');
const { registerSecurityStrike } = require('../middlewares/security');
const ApiError = require('../utils/api-error');

const publicAdmin = (admin) => ({ id: String(admin._id), email: admin.email, lastLoginAt: admin.lastLoginAt });

async function bootstrapAdmins() {
  const admins = configuredAdmins();
  if (!admins.length) {
    console.warn('[auth] nenhum ADMINn_EMAIL/ADMINn_PASSWORD configurado');
    return 0;
  }

  const activeEmails = [];
  for (const input of admins) {
    activeEmails.push(input.email);
    const existing = await Admin.findOne({ email: input.email }).select('+passwordHash');
    if (!existing) {
      await Admin.create({
        email: input.email,
        passwordHash: await bcrypt.hash(input.password, 12),
        sourceIndex: input.sourceIndex,
        envManaged: true,
        active: true
      });
      continue;
    }
    const passwordMatches = await bcrypt.compare(input.password, existing.passwordHash);
    existing.sourceIndex = input.sourceIndex;
    existing.envManaged = true;
    existing.active = true;
    if (!passwordMatches) existing.passwordHash = await bcrypt.hash(input.password, 12);
    await existing.save();
  }
  await Admin.updateMany({ envManaged: true, email: { $nin: activeEmails } }, { $set: { active: false } });
  return admins.length;
}

function issueAccessToken(admin) {
  return jwt.sign({ sub: String(admin._id), email: admin.email, type: 'access' }, env.jwtAccessSecret, {
    expiresIn: env.jwtAccessTtl,
    issuer: 'notify-app-api',
    audience: 'notify-app-admin',
    jwtid: crypto.randomUUID()
  });
}

async function issueRefreshToken(admin, meta = {}) {
  const token = jwt.sign({ sub: String(admin._id), type: 'refresh' }, env.jwtRefreshSecret, {
    expiresIn: env.jwtRefreshTtl,
    issuer: 'notify-app-api',
    audience: 'notify-app-admin',
    jwtid: crypto.randomUUID()
  });
  const decoded = jwt.decode(token);
  await RefreshToken.create({
    admin: admin._id,
    tokenHash: tokenHash(token),
    expiresAt: new Date(decoded.exp * 1000),
    ipHash: meta.ip ? searchHash(meta.ip) : undefined,
    userAgent: String(meta.userAgent || '').slice(0, 500)
  });
  return token;
}

async function tokenPair(admin, meta) {
  return {
    accessToken: issueAccessToken(admin),
    refreshToken: await issueRefreshToken(admin, meta),
    tokenType: 'Bearer',
    admin: publicAdmin(admin)
  };
}

async function login(input, meta = {}) {
  const email = String(input.email).trim().toLowerCase();
  const admin = await Admin.findOne({ email, active: true }).select('+passwordHash');
  const valid = admin && await bcrypt.compare(input.password, admin.passwordHash);
  if (!valid) {
    await registerSecurityStrike(meta.ip || 'unknown');
    throw new ApiError(401, 'Credenciais invalidas', null, 'INVALID_CREDENTIALS');
  }
  admin.lastLoginAt = new Date();
  await admin.save();
  return tokenPair(admin, meta);
}

async function rotate(refreshToken, meta = {}) {
  let decoded;
  try {
    decoded = jwt.verify(refreshToken, env.jwtRefreshSecret, {
      issuer: 'notify-app-api', audience: 'notify-app-admin'
    });
  } catch (_error) {
    throw new ApiError(401, 'Refresh token invalido ou expirado', null, 'INVALID_REFRESH_TOKEN');
  }
  if (decoded.type !== 'refresh') throw new ApiError(401, 'Tipo de token invalido');
  const hash = tokenHash(refreshToken);
  const stored = await RefreshToken.findOneAndUpdate(
    { tokenHash: hash, revokedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { revokedAt: new Date() } },
    { new: true }
  );
  if (!stored) throw new ApiError(401, 'Refresh token revogado');
  const admin = await Admin.findOne({ _id: decoded.sub, active: true });
  if (!admin) throw new ApiError(401, 'Administrador indisponivel');
  const pair = await tokenPair(admin, meta);
  await RefreshToken.updateOne({ _id: stored._id }, { $set: { replacedByHash: tokenHash(pair.refreshToken) } });
  return pair;
}

async function logout(refreshToken) {
  await RefreshToken.updateOne({ tokenHash: tokenHash(refreshToken), revokedAt: null }, { $set: { revokedAt: new Date() } });
  return { revoked: true };
}

async function authenticateAccess(token) {
  let decoded;
  try {
    decoded = jwt.verify(token, env.jwtAccessSecret, {
      issuer: 'notify-app-api', audience: 'notify-app-admin'
    });
  } catch (_error) {
    throw new ApiError(401, 'Token de acesso invalido ou expirado', null, 'INVALID_ACCESS_TOKEN');
  }
  if (decoded.type !== 'access') throw new ApiError(401, 'Tipo de token invalido');
  const admin = await Admin.findOne({ _id: decoded.sub, active: true });
  if (!admin) throw new ApiError(401, 'Administrador indisponivel');
  return { ...publicAdmin(admin), accessTokenExpiresAt: new Date(decoded.exp * 1000).toISOString() };
}

async function current(admin) {
  return admin;
}

function refreshCookieOptions(refreshToken) {
  const decoded = refreshToken ? jwt.decode(refreshToken) : null;
  return {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'lax',
    path: env.apiPrefix + '/auth',
    maxAge: decoded?.exp ? Math.max(0, decoded.exp * 1000 - Date.now()) : 30 * 24 * 60 * 60 * 1000
  };
}

module.exports = { bootstrapAdmins, login, rotate, logout, authenticateAccess, current, refreshCookieOptions };
