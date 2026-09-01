const crypto = require('crypto');
const express = require('express');
const { verifyPassword } = require('../services/passwordHash');

const SESSION_COOKIE = 'cdsco_session';
const CSRF_COOKIE = 'cdsco_csrf';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function parseCookies(header = '') {
  const cookies = {};
  for (const part of String(header).split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    try { cookies[key] = decodeURIComponent(value); } catch (_) { cookies[key] = value; }
  }
  return cookies;
}

function cookie(name, value, { httpOnly = false, secure = false, maxAge = null } = {}) {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'SameSite=Lax',
    httpOnly ? 'HttpOnly' : '',
    secure ? 'Secure' : '',
    Number.isFinite(maxAge) ? `Max-Age=${Math.max(0, Math.floor(maxAge / 1000))}` : '',
  ].filter(Boolean);
  return attributes.join('; ');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function normalizedUser(raw) {
  const id = String(raw?.id || '').trim();
  const username = String(raw?.username || '').trim();
  const role = String(raw?.role || '').toLowerCase().trim();
  const passwordHash = String(raw?.passwordHash || '').trim();
  if (!id || !username || !['applicant', 'reviewer'].includes(role) || !passwordHash.startsWith('scrypt$')) {
    throw new Error('Each auth user requires id, username, applicant/reviewer role, and a scrypt passwordHash.');
  }
  return Object.freeze({ id, username, name: String(raw.name || username).trim(), role, passwordHash });
}

function loadUsersFromEnvironment(env = process.env) {
  const users = [];
  if (env.AUTH_USERS_JSON) {
    let parsed;
    try { parsed = JSON.parse(env.AUTH_USERS_JSON); } catch (_) { throw new Error('AUTH_USERS_JSON is not valid JSON.'); }
    if (!Array.isArray(parsed)) throw new Error('AUTH_USERS_JSON must be an array.');
    users.push(...parsed);
  }
  for (const [prefix, role] of [['DEMO_APPLICANT', 'applicant'], ['DEMO_REVIEWER', 'reviewer']]) {
    if (!env[`${prefix}_USERNAME`] && !env[`${prefix}_PASSWORD_HASH`]) continue;
    users.push({
      id: env[`${prefix}_ID`] || `demo:${role}`,
      username: env[`${prefix}_USERNAME`],
      name: env[`${prefix}_NAME`] || env[`${prefix}_USERNAME`],
      role,
      passwordHash: env[`${prefix}_PASSWORD_HASH`],
    });
  }
  const directory = new Map();
  for (const raw of users) {
    const user = normalizedUser(raw);
    const key = user.username.toLowerCase();
    if (directory.has(key)) throw new Error(`Duplicate auth username: ${user.username}`);
    directory.set(key, user);
  }
  return directory;
}

function publicPrincipal(user) {
  return { id: user.id, username: user.username, name: user.name, role: user.role };
}

function createAuthManager(options = {}) {
  const secret = String(options.secret || process.env.AUTH_SESSION_SECRET || '');
  if (secret.length < 32) throw new Error('AUTH_SESSION_SECRET must contain at least 32 characters.');
  const users = options.users instanceof Map ? options.users : loadUsersFromEnvironment(options.env || process.env);
  const lifetimeMs = Math.max(5 * 60 * 1000, Math.min(
    24 * 60 * 60 * 1000,
    Number(options.lifetimeMs || process.env.AUTH_SESSION_LIFETIME_MS || 30 * 60 * 1000),
  ));
  const secureCookies = options.secureCookies ?? process.env.NODE_ENV === 'production';
  const sessions = new Map();
  const attempts = new Map();

  function signature(sessionId) {
    return crypto.createHmac('sha256', secret).update(sessionId).digest('base64url');
  }

  function encodedSession(sessionId) {
    return `${sessionId}.${signature(sessionId)}`;
  }

  function decodeSession(value) {
    const separator = String(value || '').lastIndexOf('.');
    if (separator < 1) return '';
    const sessionId = value.slice(0, separator);
    return safeEqual(value.slice(separator + 1), signature(sessionId)) ? sessionId : '';
  }

  function clearExpired(now = Date.now()) {
    for (const [id, session] of sessions) if (session.expiresAt <= now) sessions.delete(id);
    for (const [key, record] of attempts) if (record.resetAt <= now) attempts.delete(key);
  }

  function currentSession(req) {
    clearExpired();
    const signed = parseCookies(req.headers?.cookie)[SESSION_COOKIE];
    const sessionId = decodeSession(signed);
    const session = sessionId && sessions.get(sessionId);
    if (!session || session.expiresAt <= Date.now()) return null;
    return { sessionId, ...session };
  }

  function setSessionCookies(res, sessionId, session) {
    res.append('Set-Cookie', cookie(SESSION_COOKIE, encodedSession(sessionId), {
      httpOnly: true, secure: secureCookies, maxAge: lifetimeMs,
    }));
    res.append('Set-Cookie', cookie(CSRF_COOKIE, session.csrf, {
      secure: secureCookies, maxAge: lifetimeMs,
    }));
  }

  function clearSessionCookies(res) {
    res.append('Set-Cookie', cookie(SESSION_COOKIE, '', { httpOnly: true, secure: secureCookies, maxAge: 0 }));
    res.append('Set-Cookie', cookie(CSRF_COOKIE, '', { secure: secureCookies, maxAge: 0 }));
  }

  function authenticate(req, res, next) {
    const session = currentSession(req);
    if (!session) return res.status(401).json({ error: 'Authentication is required.' });
    req.auth = { ...session.principal, verified: true };
    req.authSession = session;
    return next();
  }

  function requireRole(role) {
    return (req, res, next) => {
      if (!req.auth) return res.status(401).json({ error: 'Authentication is required.' });
      if (req.auth.role !== role) return res.status(403).json({ error: `${role} authorization is required.` });
      return next();
    };
  }

  function requireCsrf(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();
    const supplied = req.get('x-csrf-token') || '';
    if (!req.authSession || !supplied || !safeEqual(supplied, req.authSession.csrf)) {
      return res.status(403).json({ error: 'A valid CSRF token is required.' });
    }
    return next();
  }

  function throttleKey(req, username) {
    return `${req.ip || req.socket?.remoteAddress || 'unknown'}:${String(username).toLowerCase()}`;
  }

  async function login(req, res) {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const key = throttleKey(req, username);
    const now = Date.now();
    const record = attempts.get(key);
    if (record && record.resetAt > now && record.count >= 5) {
      res.set('Retry-After', String(Math.ceil((record.resetAt - now) / 1000)));
      return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
    }
    const user = users.get(username.toLowerCase());
    const valid = user ? await verifyPassword(password, user.passwordHash) : false;
    if (!valid) {
      const nextRecord = record && record.resetAt > now
        ? { count: record.count + 1, resetAt: record.resetAt }
        : { count: 1, resetAt: now + 15 * 60 * 1000 };
      attempts.set(key, nextRecord);
      return res.status(401).json({ error: 'Invalid username or password.' });
    }
    attempts.delete(key);
    const sessionId = crypto.randomBytes(32).toString('base64url');
    const session = {
      principal: publicPrincipal(user),
      csrf: crypto.randomBytes(32).toString('base64url'),
      expiresAt: now + lifetimeMs,
    };
    sessions.set(sessionId, session);
    setSessionCookies(res, sessionId, session);
    return res.json({ success: true, user: session.principal, csrfToken: session.csrf, expiresAt: session.expiresAt });
  }

  function me(req, res) {
    return res.json({ success: true, user: req.auth, csrfToken: req.authSession.csrf, expiresAt: req.authSession.expiresAt });
  }

  function logout(req, res) {
    if (req.authSession?.sessionId) sessions.delete(req.authSession.sessionId);
    clearSessionCookies(res);
    return res.json({ success: true });
  }

  const router = express.Router();
  router.post('/login', login);
  router.get('/me', authenticate, me);
  router.post('/logout', authenticate, requireCsrf, logout);

  return {
    router, authenticate, requireCsrf, requireRole, currentSession,
    userCount: users.size, sessionCount: () => sessions.size,
  };
}

module.exports = {
  CSRF_COOKIE,
  SESSION_COOKIE,
  createAuthManager,
  loadUsersFromEnvironment,
  parseCookies,
};
