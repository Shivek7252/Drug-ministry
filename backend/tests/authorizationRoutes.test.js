const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const mongoose = require('mongoose');
const { createAuthManager } = require('../middleware/auth');
const { createPasswordHash } = require('../services/passwordHash');

const MONGO = process.env.TEST_MONGO_URL || '';
const PASSWORD = crypto.randomBytes(24).toString('base64url');
const SECRET = crypto.randomBytes(48).toString('base64url');
let fixture = null;
let unavailable = '';

function assertIsolatedDatabase(uri) {
  const name = uri ? new URL(uri).pathname.replace(/^\//, '').split('?')[0] : '';
  if (!/(^|[-_])(test|codex)([-_]|$)/i.test(name)) {
    throw new Error(`Refusing authorization tests against non-isolated database "${name || '(missing)'}".`);
  }
  return name;
}

function cookies(response) {
  return [...String(response.headers.get('set-cookie') || '')
    .matchAll(/(?:^|,\s*)(cdsco_(?:session|csrf)=[^;,]+)/g)]
    .map(match => match[1]).join('; ');
}

async function login(base, username) {
  const response = await fetch(`${base}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  return { cookie: cookies(response), csrf: body.csrfToken, user: body.user };
}

async function request(base, session, path, { method = 'GET', body, headers = {} } = {}) {
  const requestHeaders = { ...headers };
  if (session?.cookie) requestHeaders.cookie = session.cookie;
  if (session?.csrf && !['GET', 'HEAD', 'OPTIONS'].includes(method)) requestHeaders['x-csrf-token'] = session.csrf;
  if (body !== undefined) requestHeaders['content-type'] = 'application/json';
  const response = await fetch(`${base}${path}`, {
    method, headers: requestHeaders, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

function submission(stamp) {
  return {
    user: 'caller-controlled-user-must-be-ignored',
    formData: {
      applicantName: `Applicant ${stamp}`,
      applicantOrganization: `Exports ${stamp}`,
      email: `${stamp}@example.test`,
      destinationCountry: 'Japan',
      exportCategory: 'Vaccines',
      products: [{ genericName: 'Paracetamol', brandName: 'Fixture', quantity: '10' }],
      declarations: {
        productInfoAccurate: true, documentsGenuine: true, exportRegulations: true,
        drugComplies: true, finalDeclaration: true,
      },
    },
  };
}

test.before(async () => {
  try {
    if (!MONGO) { unavailable = 'set TEST_MONGO_URL to a unique isolated database'; return; }
    assertIsolatedDatabase(MONGO);
    await mongoose.connect(MONGO, { serverSelectionTimeoutMS: 3000 });
    const passwordHash = await createPasswordHash(PASSWORD);
    const users = new Map([
      ['applicant-a', { id: 'owner-a', username: 'applicant-a', name: 'Applicant A', role: 'applicant', passwordHash }],
      ['applicant-b', { id: 'owner-b', username: 'applicant-b', name: 'Applicant B', role: 'applicant', passwordHash }],
      ['reviewer-a', { id: 'reviewer-a-id', username: 'reviewer-a', name: 'Reviewer A', role: 'reviewer', passwordHash }],
    ]);
    const auth = createAuthManager({ users, secret: SECRET, lifetimeMs: 5 * 60 * 1000 });
    const app = express();
    app.use(express.json({ limit: '5mb' }));
    app.use('/auth', auth.router);
    app.use('/applications', auth.authenticate, auth.requireCsrf, require('../routes/applications'));
    const server = await new Promise(resolve => {
      const running = app.listen(0, '127.0.0.1', () => resolve(running));
    });
    fixture = { server, base: `http://127.0.0.1:${server.address().port}` };
  } catch (error) {
    unavailable = error.message;
  }
});

test.after(async () => {
  if (fixture) await new Promise(resolve => fixture.server.close(resolve));
  if (mongoose.connection.readyState) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

test('isolated database guard refuses a development database', () => {
  assert.throws(() => assertIsolatedDatabase('mongodb://127.0.0.1:27017/drug_ministry'), /Refusing/);
});

test('default deny, immutable ownership, role checks, and cross-applicant isolation', async t => {
  if (!fixture) return t.skip(unavailable);
  const [ownerA, ownerB, reviewer] = await Promise.all([
    login(fixture.base, 'applicant-a'),
    login(fixture.base, 'applicant-b'),
    login(fixture.base, 'reviewer-a'),
  ]);

  const noSession = await request(fixture.base, null, '/applications', {
    headers: { 'x-user-role': 'reviewer', 'x-reviewer-name': 'forged' },
  });
  assert.equal(noSession.status, 401);

  const missingCsrf = await fetch(`${fixture.base}/applications/submit`, {
    method: 'POST', headers: { cookie: ownerA.cookie, 'content-type': 'application/json' },
    body: JSON.stringify(submission('missing-csrf')),
  });
  assert.equal(missingCsrf.status, 403);

  const createdA = await request(fixture.base, ownerA, '/applications/submit', {
    method: 'POST', body: submission('owner-a'),
  });
  const createdB = await request(fixture.base, ownerB, '/applications/submit', {
    method: 'POST', body: submission('owner-b'),
  });
  assert.equal(createdA.status, 200);
  assert.equal(createdB.status, 200);

  const storedA = await mongoose.connection.db.collection('applications')
    .findOne({ applicationNumber: createdA.body.applicationNumber });
  assert.equal(storedA.ownerId, ownerA.user.id);
  assert.equal(storedA.submittedBy, ownerA.user.username);
  assert.notEqual(storedA.submittedBy, submission('ignored').user);

  const ownList = await request(fixture.base, ownerA, '/applications');
  assert.equal(ownList.status, 200);
  assert.deepEqual(ownList.body.applications.map(row => row.applicationNumber), [createdA.body.applicationNumber]);

  const otherSearch = await request(
    fixture.base, ownerB, `/applications/search?appNo=${encodeURIComponent(createdA.body.applicationNumber)}`,
  );
  assert.equal(otherSearch.status, 200);
  assert.equal(otherSearch.body.count, 0);
  const otherDetail = await request(fixture.base, ownerB, `/applications/${createdA.body.applicationNumber}`);
  assert.equal(otherDetail.status, 404);
  const otherDocument = await request(
    fixture.base, ownerB, `/applications/${createdA.body.applicationNumber}/document/mfg_license`,
  );
  assert.equal(otherDocument.status, 404);

  const applicantQueue = await request(fixture.base, ownerA, '/applications/reviewer');
  assert.equal(applicantQueue.status, 403);
  const reviewerQueue = await request(fixture.base, reviewer, '/applications/reviewer?pageSize=100');
  assert.equal(reviewerQueue.status, 200);
  assert.ok(reviewerQueue.body.applications.some(row => row.applicationNumber === createdA.body.applicationNumber));

  const forgedMutation = await request(fixture.base, ownerA, `/applications/${createdA.body.applicationNumber}/status`, {
    method: 'PATCH', body: { status: 'Approved', user: 'forged-reviewer' },
  });
  assert.equal(forgedMutation.status, 403);
});
