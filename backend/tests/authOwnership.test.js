/* ============================================================================
   Authentication and applicant-ownership enforcement.

   Closes SEC-01 (unauthenticated application APIs), SEC-02 (spoofable reviewer
   identity) and SEC-03 (applicant ownership bypass) from the release review.

   The probes run against a live isolated API seeded with three disposable
   accounts. When the API, database, or seeded credentials are absent the whole
   file skips instead of failing, matching the convention used by the other
   database-backed suites:

     TEST_API_URL=http://localhost:5101/api \
     TEST_MONGO_URL=mongodb://localhost:27017/drug_ministry_test \
     TEST_APPLICANT_A='user:pass' TEST_APPLICANT_B='user:pass' \
     TEST_REVIEWER='user:pass' \
     node --test tests/authOwnership.test.js
   ============================================================================ */

const test = require('node:test');
const assert = require('node:assert/strict');

const API = process.env.TEST_API_URL || '';
const MONGO = process.env.TEST_MONGO_URL || '';

function credentials(name) {
  const raw = process.env[name] || '';
  const separator = raw.indexOf(':');
  if (separator < 1) return null;
  return { username: raw.slice(0, separator), password: raw.slice(separator + 1) };
}

const APPLICANT_A = credentials('TEST_APPLICANT_A');
const APPLICANT_B = credentials('TEST_APPLICANT_B');
const REVIEWER = credentials('TEST_REVIEWER');

const RUN_ID = `${Date.now()}-${process.pid}`;
const created = [];
let mongoose = null;
let live = false;
let liveError = null;

/* A logged-in principal: cookie jar plus the CSRF token the server issued. */
async function signIn(who) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(who),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`login failed for ${who.username}: HTTP ${res.status}`);
  const cookies = (res.headers.getSetCookie?.() || [])
    .map(entry => entry.split(';')[0]).join('; ');
  return { cookie: cookies, csrf: body.csrfToken, user: body.user };
}

function authHeaders(session, extra = {}) {
  return {
    'Content-Type': 'application/json',
    ...(session ? { cookie: session.cookie, 'x-csrf-token': session.csrf } : {}),
    ...extra,
  };
}

async function call(method, path, { session, body, headers } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: authHeaders(session, headers),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const get = (path, options) => call('GET', path, options);
const post = (path, body, options) => call('POST', path, { ...options, body });

function payload() {
  const stamp = `${RUN_ID}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    user: 'authz-itest',
    formData: {
      applicantName: `Authz Applicant ${stamp}`,
      applicantOrganization: 'Authz Exports Pvt Ltd',
      email: `authz+${stamp}@example.com`,
      destinationCountry: 'Poland',
      exportCategory: 'Vaccines',
      applicantState: 'Kerala',
      products: [{ genericName: 'Paracetamol', brandName: 'Authz', quantity: '10' }],
      documents: {
        mfg_license: {
          name: 'licence.pdf', size: 12, type: 'application/pdf',
          uploadedAt: '10:00 AM', data: Buffer.from('%PDF-1.4 test').toString('base64'),
        },
      },
    },
  };
}

/* Owned by applicant A. */
async function submitAs(session) {
  const res = await post('/applications/submit', payload(), { session });
  assert.equal(res.status < 400, true, `submit HTTP ${res.status}`);
  const appNo = res.body.applicationNumber || res.body.application?.applicationNumber;
  assert.ok(appNo, 'submission returned no application number');
  created.push(appNo);
  return appNo;
}

test.before(async () => {
  try {
    if (!API || !MONGO) { liveError = 'set TEST_API_URL and TEST_MONGO_URL'; return; }
    if (!APPLICANT_A || !APPLICANT_B || !REVIEWER) {
      liveError = 'set TEST_APPLICANT_A, TEST_APPLICANT_B and TEST_REVIEWER as user:pass';
      return;
    }
    const name = new URL(MONGO).pathname.replace(/^\//, '').split('?')[0];
    if (!/(^|[-_])test($|[-_])/i.test(name)) throw new Error(`Refusing non-test database "${name}".`);
    const health = await fetch(`${API.replace(/\/api\/?$/, '')}/health`);
    const healthBody = await health.json();
    if (healthBody.database !== name) { liveError = `API is not on ${name}`; return; }
    mongoose = require('mongoose');
    await mongoose.connect(MONGO, { serverSelectionTimeoutMS: 2500 });
    live = true;
  } catch (err) { live = false; liveError = err.message; }
});

test.after(async () => {
  if (!live) return;
  await mongoose.connection.db.collection('applications').deleteMany({
    $or: [{ applicationNumber: { $in: created } }, { 'formData.email': new RegExp(`^authz\\+${RUN_ID}`) }],
  });
  await mongoose.disconnect();
});

const live_test = (name, fn) => test(name, async t => {
  if (!live) return t.skip(liveError || 'API, database or seeded accounts unavailable');
  return fn(t);
});

/* ---- SEC-01: unauthenticated access is denied everywhere ----------------- */

live_test('SEC-01 unauthenticated requests cannot reach any application API', async () => {
  const a = await signIn(APPLICANT_A);
  const appNo = await submitAs(a);

  const probes = [
    ['GET', '/applications'],
    ['GET', `/applications/${appNo}`],
    ['GET', `/applications/${appNo}/document/mfg_license`],
    ['GET', `/applications/${appNo}/checklist`],
    ['GET', `/applications/${appNo}/full`],
    ['GET', `/applications/${appNo}/query-history`],
    ['GET', '/applications/reviewer'],
    ['GET', '/applications/stats/summary'],
    ['GET', '/applications/search?q=authz'],
  ];

  for (const [method, path] of probes) {
    const res = await call(method, path);
    assert.ok(
      res.status === 401 || res.status === 403,
      `${method} ${path} returned ${res.status}, expected 401/403`
    );
    // No application payload may leak in the denial body.
    const text = JSON.stringify(res.body);
    assert.ok(!text.includes('applicationNumber'), `${path} leaked application data`);
    assert.ok(!text.includes('Authz Exports'), `${path} leaked applicant data`);
  }
});

live_test('SEC-01 unauthenticated mutations are denied', async () => {
  const mutations = [
    ['POST', '/applications/submit'],
    ['POST', '/applications/draft'],
    ['POST', '/applications/EXP-0000-000000/review'],
    ['PATCH', '/applications/EXP-0000-000000/status'],
  ];
  for (const [method, path] of mutations) {
    const res = await call(method, path, { body: {} });
    assert.ok(res.status === 401 || res.status === 403, `${method} ${path} returned ${res.status}`);
  }
});

/* ---- SEC-02: identity comes from the session, never from headers --------- */

live_test('SEC-02 a forged role header cannot grant reviewer access', async () => {
  const a = await signIn(APPLICANT_A);
  const forged = {
    'x-user-role': 'reviewer',
    'x-reviewer-name': 'attacker',
    'x-user-id': 'someone-else',
  };

  const queue = await get('/applications/reviewer', { session: a, headers: forged });
  assert.equal(queue.status, 403, 'applicant session with forged headers reached the reviewer queue');

  const appNo = await submitAs(a);
  const decision = await post(`/applications/${appNo}/review`,
    { status: 'Approved', remarks: 'forged' }, { session: a, headers: forged });
  assert.equal(decision.status, 403, 'applicant session with forged headers made a reviewer decision');
});

live_test('SEC-02 an unauthenticated forged reviewer header is still denied', async () => {
  const res = await get('/applications/reviewer', {
    headers: { 'x-user-role': 'reviewer', 'x-reviewer-name': 'attacker' },
  });
  assert.ok(res.status === 401 || res.status === 403, `returned ${res.status}`);
});

live_test('SEC-02 logout invalidates the session immediately', async () => {
  const a = await signIn(APPLICANT_A);
  const before = await get('/applications/stats/summary', { session: a });
  assert.equal(before.status, 200);

  const out = await post('/auth/logout', {}, { session: a });
  assert.equal(out.status, 200);

  const after = await get('/applications/stats/summary', { session: a });
  assert.equal(after.status, 401, 'the session still worked after logout');
});

live_test('SEC-02 invalid credentials are rejected with a generic message', async () => {
  const res = await post('/auth/login', { username: APPLICANT_A.username, password: 'wrong-password-x' });
  assert.equal(res.status, 401);
  const message = String(res.body.error || '');
  // Must not disclose whether the username exists.
  assert.doesNotMatch(message, /no such user|unknown user|user not found|password incorrect for/i);
});

/* ---- SEC-03: applicant ownership -------------------------------------- */

live_test('SEC-03 an applicant cannot read another applicant\'s application', async () => {
  const a = await signIn(APPLICANT_A);
  const b = await signIn(APPLICANT_B);
  const appNo = await submitAs(a);

  // The owner can read it.
  const owner = await get(`/applications/${appNo}`, { session: a });
  assert.equal(owner.status, 200);
  assert.equal(owner.body.application.applicationNumber, appNo);

  // A different applicant cannot, and learns nothing about it.
  const other = await get(`/applications/${appNo}`, { session: b });
  assert.equal(other.status, 404, `cross-applicant detail read returned ${other.status}`);
  assert.ok(!JSON.stringify(other.body).includes('Authz Exports'), 'cross-applicant read leaked data');
});

live_test('SEC-03 an applicant cannot download another applicant\'s documents', async () => {
  const a = await signIn(APPLICANT_A);
  const b = await signIn(APPLICANT_B);
  const appNo = await submitAs(a);

  const res = await fetch(`${API}/applications/${appNo}/document/mfg_license`, {
    headers: { cookie: b.cookie },
  });
  assert.equal(res.status, 404, `cross-applicant document download returned ${res.status}`);
});

live_test('SEC-03 an applicant cannot read another applicant\'s checklist or reconciliation', async () => {
  const a = await signIn(APPLICANT_A);
  const b = await signIn(APPLICANT_B);
  const appNo = await submitAs(a);

  for (const path of [`/applications/${appNo}/checklist`, `/applications/${appNo}/reconciliation`]) {
    const res = await get(path, { session: b });
    assert.equal(res.status, 404, `${path} returned ${res.status} for a non-owner`);
  }
});

live_test('SEC-03 the application list is scoped to the caller', async () => {
  const a = await signIn(APPLICANT_A);
  const b = await signIn(APPLICANT_B);
  const appNo = await submitAs(a);

  const mine = await get('/applications', { session: a });
  assert.equal(mine.status, 200);
  const numbers = (mine.body.applications || []).map(x => x.applicationNumber);
  assert.ok(numbers.includes(appNo), 'the owner cannot see their own application in the list');

  const theirs = await get('/applications', { session: b });
  assert.equal(theirs.status, 200);
  const otherNumbers = (theirs.body.applications || []).map(x => x.applicationNumber);
  assert.ok(!otherNumbers.includes(appNo), 'the list leaked another applicant\'s application');
});

live_test('SEC-03 a reviewer retains full access to any application', async () => {
  const a = await signIn(APPLICANT_A);
  const reviewer = await signIn(REVIEWER);
  const appNo = await submitAs(a);

  for (const path of [`/applications/${appNo}`, `/applications/${appNo}/full`, `/applications/${appNo}/query-history`]) {
    const res = await get(path, { session: reviewer });
    assert.equal(res.status, 200, `${path} denied a reviewer (${res.status})`);
  }
});

live_test('SEC-03 an applicant cannot reach reviewer-only surfaces', async () => {
  const a = await signIn(APPLICANT_A);
  const appNo = await submitAs(a);

  // Reviewer-only reads: analytics, exports, internal review evidence.
  for (const path of [
    '/applications/reviewer',
    '/applications/reviewer/analytics',
    '/applications/reviewer/export',
    `/applications/${appNo}/full`,
    `/applications/${appNo}/summary`,
    `/applications/${appNo}/query-history`,
    `/applications/${appNo}/review-snapshot`,
  ]) {
    const res = await get(path, { session: a });
    assert.equal(res.status, 403, `${path} returned ${res.status} for an applicant`);
  }
});

live_test('SEC-03 mass assignment cannot forge ownership or status on submit', async () => {
  const a = await signIn(APPLICANT_A);
  const b = await signIn(APPLICANT_B);

  const forged = payload();
  forged.formData.ownerId = 'not-the-caller';
  forged.formData.status = 'Approved';
  const res = await post('/applications/submit', forged, { session: a });
  assert.equal(res.status < 400, true);
  const appNo = res.body.applicationNumber || res.body.application?.applicationNumber;
  created.push(appNo);

  // Ownership is taken from the authenticated principal, not the body.
  const stored = await mongoose.connection.db.collection('applications').findOne({ applicationNumber: appNo });
  assert.equal(stored.ownerId, a.user.id, 'ownerId was taken from the request body');
  assert.notEqual(stored.status, 'Approved', 'status was accepted from the request body');

  // And the forged owner still cannot read it.
  const other = await get(`/applications/${appNo}`, { session: b });
  assert.equal(other.status, 404);
});

/* ---- CSRF -------------------------------------------------------------- */

live_test('mutations without a CSRF token are rejected', async () => {
  const a = await signIn(APPLICANT_A);
  const res = await fetch(`${API}/applications/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: a.cookie },  // no x-csrf-token
    body: JSON.stringify(payload()),
  });
  assert.equal(res.status, 403, `CSRF-less mutation returned ${res.status}`);
});
