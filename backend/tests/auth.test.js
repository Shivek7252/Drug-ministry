const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { createAuthManager } = require('../middleware/auth');
const { createPasswordHash, verifyPassword } = require('../services/passwordHash');

const SECRET = 'test-only-session-secret-that-is-long-enough';
const PASSWORD = crypto.randomBytes(24).toString('base64url');

function cookieJar(response) {
  const combined = response.headers.get('set-cookie') || '';
  return [...combined.matchAll(/(?:^|,\s*)(cdsco_(?:session|csrf)=[^;,]+)/g)]
    .map(match => match[1])
    .join('; ');
}

function csrfFrom(body) {
  return body.csrfToken;
}

async function startFixture() {
  const applicant = {
    id: 'applicant-immutable-1', username: 'applicant-one', name: 'Applicant One',
    role: 'applicant', passwordHash: await createPasswordHash(PASSWORD),
  };
  const reviewer = {
    id: 'reviewer-immutable-1', username: 'reviewer-one', name: 'Reviewer One',
    role: 'reviewer', passwordHash: await createPasswordHash(PASSWORD),
  };
  const users = new Map([[applicant.username, applicant], [reviewer.username, reviewer]]);
  const auth = createAuthManager({ users, secret: SECRET, lifetimeMs: 5 * 60 * 1000 });
  const app = express();
  app.use(express.json());
  app.use('/auth', auth.router);
  app.get('/private', auth.authenticate, (req, res) => res.json({ user: req.auth }));
  app.post('/mutate', auth.authenticate, auth.requireCsrf, (req, res) => res.json({ success: true }));
  app.get('/reviewer', auth.authenticate, auth.requireRole('reviewer'), (req, res) => res.json({ success: true }));
  const server = await new Promise(resolve => {
    const running = app.listen(0, '127.0.0.1', () => resolve(running));
  });
  return { auth, base: `http://127.0.0.1:${server.address().port}`, server };
}

async function login(base, username = 'applicant-one', password = PASSWORD) {
  const response = await fetch(`${base}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await response.json();
  return { response, body, cookies: cookieJar(response) };
}

test('scrypt password hashes verify without retaining plaintext', async () => {
  const hash = await createPasswordHash(PASSWORD);
  assert.match(hash, /^scrypt\$/);
  assert.equal(hash.includes(PASSWORD), false);
  assert.equal(await verifyPassword(PASSWORD, hash), true);
  assert.equal(await verifyPassword('incorrect password', hash), false);
});

test('server sessions enforce authentication, roles, CSRF, refresh, and logout', async t => {
  const fixture = await startFixture();
  t.after(() => new Promise(resolve => fixture.server.close(resolve)));

  const unauthenticated = await fetch(`${fixture.base}/private`, {
    headers: { 'x-user-role': 'reviewer', 'x-reviewer-name': 'forged' },
  });
  assert.equal(unauthenticated.status, 401, 'spoofed identity headers must not authenticate');

  const signedIn = await login(fixture.base);
  assert.equal(signedIn.response.status, 200);
  assert.equal(signedIn.body.user.role, 'applicant');
  assert.match(signedIn.response.headers.get('set-cookie'), /HttpOnly/i);
  assert.match(signedIn.response.headers.get('set-cookie'), /SameSite=Lax/i);

  const refreshed = await fetch(`${fixture.base}/private`, { headers: { cookie: signedIn.cookies } });
  assert.equal(refreshed.status, 200);
  assert.equal((await refreshed.json()).user.id, 'applicant-immutable-1');

  const reviewerDenied = await fetch(`${fixture.base}/reviewer`, { headers: { cookie: signedIn.cookies } });
  assert.equal(reviewerDenied.status, 403);

  const missingCsrf = await fetch(`${fixture.base}/mutate`, { method: 'POST', headers: { cookie: signedIn.cookies } });
  assert.equal(missingCsrf.status, 403);
  const mutated = await fetch(`${fixture.base}/mutate`, {
    method: 'POST',
    headers: { cookie: signedIn.cookies, 'x-csrf-token': csrfFrom(signedIn.body) },
  });
  assert.equal(mutated.status, 200);

  const loggedOut = await fetch(`${fixture.base}/auth/logout`, {
    method: 'POST',
    headers: { cookie: signedIn.cookies, 'x-csrf-token': csrfFrom(signedIn.body) },
  });
  assert.equal(loggedOut.status, 200);
  assert.match(loggedOut.headers.get('set-cookie'), /Max-Age=0/i);
  const afterLogout = await fetch(`${fixture.base}/private`, { headers: { cookie: signedIn.cookies } });
  assert.equal(afterLogout.status, 401);
});

test('invalid passwords are refused and repeated attempts are rate limited', async t => {
  const fixture = await startFixture();
  t.after(() => new Promise(resolve => fixture.server.close(resolve)));
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const result = await login(fixture.base, 'applicant-one', 'definitely incorrect');
    assert.equal(result.response.status, 401);
  }
  const limited = await login(fixture.base, 'applicant-one', 'definitely incorrect');
  assert.equal(limited.response.status, 429);
  assert.ok(Number(limited.response.headers.get('retry-after')) > 0);
});
