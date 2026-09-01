/* ============================================================================
   Unread count — the complete flow, database to endpoint.

   "Unread" means: an application in the globally filtered set for which the
   CURRENT reviewer holds no read receipt. These tests trace that definition
   end to end, because every previous defect lived between the layers rather
   than inside one:

     - a stale unique index on (reviewer, applicationNumber) made read receipts
       unique per APPLICATION rather than per reviewer, so only the first
       reviewer in the whole system could ever mark anything read;
     - opening an application by direct URL wrote no receipt at all;
     - the count was refreshed before the receipt it was meant to observe.

   They need the API and MongoDB running. When either is absent the whole file
   skips instead of failing, so `npm test` stays green on a bare checkout:

     TEST_API_URL=http://localhost:5001/api \
     TEST_MONGO_URL=mongodb://localhost:27017/drug_ministry_test \
     node --test tests/unreadCount.test.js
   ============================================================================ */

const test = require('node:test');
const assert = require('node:assert/strict');
const { haveCredentials, adoptSession } = require('./helpers/session');

const API = process.env.TEST_API_URL || '';
const MONGO = process.env.TEST_MONGO_URL || '';

function testDatabaseName(uri) {
  if (!uri) return null;
  const name = new URL(uri).pathname.replace(/^\//, '').split('?')[0];
  if (!/(^|[-_])test($|[-_])/i.test(name)) {
    throw new Error(`Refusing database test against non-test database "${name || '(missing)'}".`);
  }
  return name;
}

const RUN_ID = `${Date.now()}-${process.pid}`;
/* Reviewer identity is server-issued; these are filled in by test.before. */
const asReviewer = () => ({});
/* Two distinct reviewers: read state must never cross between them. */
const ALICE = asReviewer(`unread-alice-${RUN_ID}`);
const APPLICANT = {};
const BOB = asReviewer(`unread-bob-${RUN_ID}`);

let payloadSequence = 0;
const created = [];
let mongoose = null;
let live = false;
let liveError = null;

function payload(overrides = {}) {
  const stamp = `${RUN_ID}-${payloadSequence += 1}`;
  return {
    user: 'unread-itest',
    formData: {
      applicantName: `Unread Applicant ${stamp}`,
      applicantOrganization: 'Unread Exports Pvt Ltd',
      email: `unread+${stamp}@example.com`,
      destinationCountry: 'Poland',
      exportCategory: 'Vaccines',
      applicantState: 'Kerala',
      products: [{ genericName: 'Paracetamol', brandName: 'Unread', quantity: '10' }],
      ...overrides,
    },
  };
}

/* Submissions and drafts are applicant actions; an explicit {} opts out. */
async function post(path, body, headers = APPLICANT) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function getJson(path, headers) {
  const res = await fetch(`${API}${path}`, { headers });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/** The number the dashboard renders, for one reviewer, under one filter set. */
async function unreadFor(headers, query = '') {
  const res = await getJson(`/applications/reviewer/analytics${query}`, headers);
  assert.equal(res.status, 200, `analytics HTTP ${res.status}`);
  return { unread: res.body.unread.count, total: res.body.current.total };
}

async function submit(overrides) {
  const res = await post('/applications/submit', payload(overrides), APPLICANT);
  assert.equal(res.status < 400, true, `submit HTTP ${res.status}`);
  const appNo = res.body.applicationNumber || res.body.application?.applicationNumber;
  assert.ok(appNo, 'submission returned no application number');
  created.push(appNo);
  return appNo;
}

const markRead = (appNo, headers) => post(`/applications/${appNo}/read`, undefined, headers);

test.before(async () => {
  try {
    if (!API || !MONGO) {
      liveError = 'set TEST_API_URL and TEST_MONGO_URL to an isolated test server/database';
      return;
    }
    const expectedDatabase = testDatabaseName(MONGO);
    const health = await fetch(`${API.replace(/\/api\/?$/, '')}/health`);
    const healthBody = await health.json();
    if (healthBody.database !== expectedDatabase || !healthBody.testMode) {
      liveError = `API is not attached to isolated test database ${expectedDatabase}`;
      return;
    }
    if (!haveCredentials('TEST_REVIEWER', 'TEST_REVIEWER_B', 'TEST_APPLICANT_A')) {
      liveError = 'set TEST_REVIEWER, TEST_REVIEWER_B and TEST_APPLICANT_A as user:pass';
      return;
    }
    await adoptSession(ALICE, API, 'TEST_REVIEWER');
    if (typeof BOB === 'object' && BOB) await adoptSession(BOB, API, 'TEST_REVIEWER_B');
    await adoptSession(APPLICANT, API, 'TEST_APPLICANT_A');
    mongoose = require('mongoose');
    await mongoose.connect(MONGO, { serverSelectionTimeoutMS: 2500 });
    live = true;
  } catch (err) {
    live = false;
    liveError = err.message;
  }
});

test.after(async () => {
  if (!live) return;
  await mongoose.connection.db.collection('applications').deleteMany({
    $or: [
      { applicationNumber: { $in: created } },
      { 'formData.email': new RegExp(`^unread\\+${RUN_ID}`) },
    ],
  });
  await mongoose.connection.db.collection('applicationreads').deleteMany({
    $or: [
      { applicationNumber: { $in: created } },
      { reviewerId: new RegExp(RUN_ID) },
    ],
  });
  await mongoose.disconnect();
});

const live_test = (name, fn) => test(name, async t => {
  if (!live) return t.skip(liveError || 'API or MongoDB not reachable');
  return fn(t);
});

/* ---- The stale index that broke everything ------------------------------- */

live_test('read receipts are unique per reviewer, not per application', async () => {
  const indexes = await mongoose.connection.db.collection('applicationreads').indexes();
  const legacy = indexes.find(index => index.name === 'reviewer_1_applicationNumber_1');
  /* A unique, unpartitioned index on (reviewer, applicationNumber) collides on
     (null, appNo) for every id-keyed receipt after the first. */
  assert.equal(
    Boolean(legacy && legacy.unique && !legacy.partialFilterExpression), false,
    'the legacy unique index is still present — only one reviewer can mark any application read',
  );
  const current = indexes.find(index => index.name === 'reviewerId_1_applicationNumber_1');
  assert.ok(current && current.unique, 'the (reviewerId, applicationNumber) unique index is missing');
});

live_test('the reconciler drops a legacy unique index and is idempotent', async () => {
  const { reconcileReadReceiptIndexes } = require('../services/readReceipts');
  const collection = mongoose.connection.db.collection('applicationreads');

  try {
    await collection.createIndex(
      { reviewer: 1, applicationNumber: 1 },
      { unique: true, name: 'reviewer_1_applicationNumber_1' },
    );
    const first = await reconcileReadReceiptIndexes();
    assert.equal(first.dropped, true, 'the legacy index was not dropped');

    const second = await reconcileReadReceiptIndexes();
    assert.equal(second.dropped, false, 'the reconciler is not idempotent');

    const names = (await collection.indexes()).map(index => index.name);
    assert.equal(names.includes('reviewer_1_applicationNumber_1'), false);
    assert.equal(names.includes('reviewerId_1_applicationNumber_1'), true,
      'dropping the legacy index must not disturb the id-keyed one');
  } finally {
    /* Never leave the landmine behind for the next run, even on failure. */
    await reconcileReadReceiptIndexes();
  }
});

live_test('a second reviewer can mark read even before the legacy index is dropped', async () => {
  /* Belt and braces: the write sets the reviewer name as well as the id, so a
     database that has not yet been reconciled still keys the legacy index per
     reviewer instead of colliding on null. */
  const collection = mongoose.connection.db.collection('applicationreads');
  await collection.createIndex(
    { reviewer: 1, applicationNumber: 1 },
    { unique: true, name: 'reviewer_1_applicationNumber_1' },
  );
  try {
    const appNo = await submit();
    assert.equal((await markRead(appNo, ALICE)).status, 200, 'first reviewer blocked');
    const res = await markRead(appNo, BOB);
    assert.equal(res.status, 200, `second reviewer blocked: ${JSON.stringify(res.body)}`);
  } finally {
    const { reconcileReadReceiptIndexes } = require('../services/readReceipts');
    await reconcileReadReceiptIndexes();
  }
});

/* ---- The count itself ---------------------------------------------------- */

live_test('the initial count comes from the server and equals total minus receipts held', async () => {
  const before = await unreadFor(ALICE);
  const appNo = await submit();
  const after = await unreadFor(ALICE);

  assert.equal(after.total, before.total + 1, 'the new application is not in the filtered set');
  assert.equal(after.unread, before.unread + 1, 'a new submission must arrive unread');

  const receipts = await mongoose.connection.db.collection('applicationreads')
    .countDocuments({ applicationNumber: appNo });
  assert.equal(receipts, 0, 'submitting must not write a read receipt');
});

live_test('opening one application reduces the count by exactly one', async () => {
  const appNo = await submit();
  const before = await unreadFor(ALICE);
  const res = await markRead(appNo, ALICE);
  assert.equal(res.status, 200, `mark read HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.success, true);
  const after = await unreadFor(ALICE);
  assert.equal(after.unread, before.unread - 1);
});

live_test('opening the same application twice does not reduce it twice', async () => {
  const appNo = await submit();
  await markRead(appNo, ALICE);
  const once = await unreadFor(ALICE);

  const second = await markRead(appNo, ALICE);
  assert.equal(second.status, 200, 'a repeat open must succeed, not error');
  assert.equal(second.body.alreadyRead, true, 'the second call must report the receipt already existed');
  const twice = await unreadFor(ALICE);

  assert.equal(twice.unread, once.unread, 'the count moved on a repeat open');
  const receipts = await mongoose.connection.db.collection('applicationreads')
    .countDocuments({ reviewerId: ALICE.principal.id, applicationNumber: appNo });
  assert.equal(receipts, 1, 'a repeat open wrote a duplicate receipt');
});

live_test('opening every application in a filtered set produces zero', async () => {
  /* Scope to a country nothing else in the database uses, so "every
     application" is a set this test fully controls. */
  const country = 'Iceland';
  const filter = `?country=${encodeURIComponent(country)}`;
  await submit({ destinationCountry: country });
  await submit({ destinationCountry: country });

  const before = await unreadFor(ALICE, filter);
  assert.ok(before.unread >= 2, `expected at least the 2 just submitted, got ${before.unread}`);

  const queue = await getJson(`/applications/reviewer${filter}&pageSize=100`, ALICE);
  for (const app of queue.body.applications) await markRead(app.applicationNumber, ALICE);

  const after = await unreadFor(ALICE, filter);
  assert.equal(after.unread, 0, 'every application opened but the count is not zero');
});

/* ---- Per-reviewer isolation ---------------------------------------------- */

live_test('one reviewer opening an application does not mark it read for another', async () => {
  const appNo = await submit();
  const aliceBefore = await unreadFor(ALICE);
  const bobBefore = await unreadFor(BOB);

  const res = await markRead(appNo, ALICE);
  assert.equal(res.status, 200, `Alice could not mark read: ${JSON.stringify(res.body)}`);

  assert.equal((await unreadFor(ALICE)).unread, aliceBefore.unread - 1);
  assert.equal((await unreadFor(BOB)).unread, bobBefore.unread, "Alice's read state changed Bob's count");
});

live_test('a second reviewer can mark an application the first already opened', async () => {
  const appNo = await submit();
  assert.equal((await markRead(appNo, ALICE)).status, 200);
  const bobBefore = await unreadFor(BOB);

  const res = await markRead(appNo, BOB);
  assert.equal(res.status, 200, `Bob was blocked by Alice's receipt: ${JSON.stringify(res.body)}`);
  assert.equal((await unreadFor(BOB)).unread, bobBefore.unread - 1);

  const rows = await mongoose.connection.db.collection('applicationreads')
    .find({ applicationNumber: appNo }).toArray();
  assert.equal(rows.length, 2, 'both reviewers must hold their own receipt');
});

live_test('the queue payload flags rows read for this reviewer only', async () => {
  const appNo = await submit();
  await markRead(appNo, ALICE);

  const forAlice = await getJson(`/applications/reviewer?search=${appNo}`, ALICE);
  const forBob = await getJson(`/applications/reviewer?search=${appNo}`, BOB);
  assert.equal(forAlice.body.applications[0].isRead, true);
  assert.equal(forBob.body.applications[0].isRead, false);
});

/* ---- The strip and the table must agree ---------------------------------- */

live_test('the KPI count and the table badges use the same receipt predicate', async () => {
  const country = 'Iceland';
  const filter = `?country=${encodeURIComponent(country)}`;
  await submit({ destinationCountry: country });
  await submit({ destinationCountry: country });
  const appNo = await submit({ destinationCountry: country });
  await markRead(appNo, ALICE);

  const analytics = await unreadFor(ALICE, filter);
  const queue = await getJson(`/applications/reviewer${filter}&pageSize=100`, ALICE);
  const badges = queue.body.applications.filter(app => !app.isRead).length;

  assert.equal(
    analytics.unread, badges,
    `the strip says ${analytics.unread} unread but the table shows ${badges} badges`,
  );
});

live_test('a legacy name-keyed receipt is honoured everywhere or nowhere', async () => {
  /* Receipts written before the id-keyed schema carry only the reviewer name.
     Every path must resolve them identically — the queue's private copy of the
     predicate once did not, and the strip and the table disagreed by one. */
  const country = 'Iceland';
  const filter = `?country=${encodeURIComponent(country)}`;
  const appNo = await submit({ destinationCountry: country });
  await mongoose.connection.db.collection('applicationreads').insertOne({
    reviewer: ALICE.principal.username,          // legacy shape: no reviewerId
    applicationNumber: appNo,
    readAt: new Date(),
  });

  const queue = await getJson(`/applications/reviewer?search=${appNo}`, ALICE);
  const state = await getJson('/applications/reviewer/read-state', ALICE);
  const analytics = await unreadFor(ALICE, filter);
  const badges = (await getJson(`/applications/reviewer${filter}&pageSize=100`, ALICE))
    .body.applications.filter(app => !app.isRead).length;

  assert.equal(queue.body.applications[0].isRead, true, 'the queue ignored a legacy receipt');
  assert.equal(state.body.read.some(r => r.applicationNumber === appNo), true,
    'read-state ignored a legacy receipt');
  assert.equal(analytics.unread, badges, 'the strip and the table disagree on a legacy receipt');
});

/* ---- Persistence --------------------------------------------------------- */

live_test('a receipt survives a new session — it is database state, not browser state', async () => {
  const appNo = await submit();
  await markRead(appNo, ALICE);
  const first = await unreadFor(ALICE);

  /* A fresh login is a fresh request carrying the same reviewer identity and
     no client state whatsoever. */
  const relogin = await unreadFor({ ...ALICE });
  assert.equal(relogin.unread, first.unread);

  const state = await getJson('/applications/reviewer/read-state', ALICE);
  assert.equal(state.status, 200);
  assert.ok(
    state.body.read.some(row => row.applicationNumber === appNo),
    'the receipt is not in the persisted read state',
  );
});

/* ---- Filters and pagination ---------------------------------------------- */

live_test('the count respects filters and is not computed from one page', async () => {
  const country = 'Iceland';
  const other = 'Poland';
  await submit({ destinationCountry: country });
  const scoped = await unreadFor(ALICE, `?country=${encodeURIComponent(country)}`);
  const everything = await unreadFor(ALICE);

  assert.ok(scoped.unread <= everything.unread, 'a filtered count exceeded the unfiltered one');
  assert.ok(scoped.total <= everything.total);

  /* Page size must not change the answer: a per-page count would. */
  const [small, large] = await Promise.all([
    getJson(`/applications/reviewer/analytics?country=${encodeURIComponent(other)}&pageSize=1`, ALICE),
    getJson(`/applications/reviewer/analytics?country=${encodeURIComponent(other)}&pageSize=100`, ALICE),
  ]);
  assert.equal(small.body.unread.count, large.body.unread.count,
    'the unread count changed with page size — it is being computed per page');
  assert.ok(
    large.body.unread.count <= large.body.current.total,
    'unread exceeded the size of the filtered set',
  );
});

live_test('a filter that matches nothing reports zero, not the unfiltered count', async () => {
  const res = await unreadFor(ALICE, '?search=NO-SUCH-APPLICATION-NUMBER-XYZ');
  assert.equal(res.total, 0);
  assert.equal(res.unread, 0);
});

/* ---- Authentication ------------------------------------------------------ */

live_test('marking read requires reviewer authentication', async () => {
  const appNo = await submit();
  const res = await post(`/applications/${appNo}/read`, undefined, {});
  assert.equal(res.status, 401, 'an unauthenticated caller could write a read receipt');
});

live_test('marking an application that does not exist does not invent a receipt', async () => {
  const res = await markRead('EXP-0000-NOPE', ALICE);
  assert.equal(res.status, 404);
  const rows = await mongoose.connection.db.collection('applicationreads')
    .countDocuments({ applicationNumber: 'EXP-0000-NOPE' });
  assert.equal(rows, 0);
});
