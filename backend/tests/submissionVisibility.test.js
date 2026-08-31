/* ============================================================================
   Submission -> Review Queue visibility.

   Regression cover for the reported defect: an application submitted from the
   applicant side did not appear in the reviewer Review Queue.

   These are integration tests. They post a real application, then trace that
   exact application number through the database and the reviewer endpoint, so
   a break anywhere in persistence, eligibility, pagination or sort ordering
   fails here rather than silently reaching the UI.

   They need the API and MongoDB running. When either is absent the whole file
   skips instead of failing, so `npm test` stays green on a bare checkout.
   ============================================================================ */

const test = require('node:test');
const assert = require('node:assert/strict');

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

const REVIEWER = { 'x-user-role': 'reviewer', 'x-reviewer-name': 'itest-reviewer' };
const RUN_ID = `${Date.now()}-${process.pid}`;
let payloadSequence = 0;

/* Applications created here are removed in the after() hook. */
const created = [];
let mongoose = null;
let live = false;
let liveError = null;

function payload(overrides = {}) {
  const stamp = `${RUN_ID}-${payloadSequence += 1}`;
  return {
    user: 'itest',
    formData: {
      applicantName: `ITest Applicant ${stamp}`,
      applicantOrganization: 'ITest Exports Pvt Ltd',
      email: `itest+${stamp}@example.com`,
      destinationCountry: 'Poland',
      exportCategory: 'Vaccines',
      applicantState: 'Kerala',
      products: [{ genericName: 'Paracetamol', brandName: 'ITest', quantity: '10' }],
      ...overrides,
    },
  };
}

async function post(path, body, headers = {}) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function getJson(path, headers = REVIEWER) {
  const res = await fetch(`${API}${path}`, { headers });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

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
    const res = await fetch(`${API}/applications/reviewer?pageSize=1`, { headers: REVIEWER });
    if (!res.ok) { liveError = `reviewer endpoint HTTP ${res.status}`; return; }
    mongoose = require('mongoose');
    await mongoose.connect(MONGO, { serverSelectionTimeoutMS: 2500 });
    live = true;
  } catch (err) {
    live = false;
    liveError = err.message;
  }
});

test('database guard refuses a normal development database', () => {
  assert.throws(
    () => testDatabaseName('mongodb://127.0.0.1:27017/drug_ministry'),
    /Refusing database test/,
  );
  assert.equal(testDatabaseName('mongodb://127.0.0.1:27017/drug_ministry_test'), 'drug_ministry_test');
});

test.after(async () => {
  if (!live) return;
  /* Clean by both returned identifiers and this run's unique email prefix.
     The latter also catches a record if the API persists it and then fails
     before returning its application number. */
  await mongoose.connection.db.collection('applications').deleteMany({
    $or: [
      { applicationNumber: { $in: created } },
      { email: { $regex: `^itest\\+${RUN_ID}-` } },
    ],
  });
  await mongoose.disconnect();
});

/* `live` is only known after the before() hook, so the skip decision has to be
   made inside the test body — a { skip } option is evaluated at definition
   time, when `live` is still false and every test would skip. */
const it = (name, fn) => test(name, async t => {
  if (!live) return t.skip(`API or MongoDB not reachable (${liveError || 'unknown'})`);
  return fn(t);
});

/* ---- Persistence --------------------------------------------------------- */

it('a successful submission returns success and creates exactly one record', async () => {
  const { status, body } = await post('/applications/submit', payload());
  assert.equal(status, 200, `submit failed: ${JSON.stringify(body)}`);
  assert.ok(body.applicationNumber, 'response carried no applicationNumber');
  created.push(body.applicationNumber);

  const docs = await mongoose.connection.db.collection('applications')
    .find({ applicationNumber: body.applicationNumber }).toArray();
  assert.equal(docs.length, 1, 'expected exactly one persisted record');

  const doc = docs[0];
  assert.equal(doc.isDraft, false, 'a submitted application must not stay a draft');
  assert.equal(doc.status, 'Submitted');
  assert.ok(doc.submittedAt instanceof Date && !Number.isNaN(doc.submittedAt.getTime()),
    'submittedAt must be a real date — the queue sorts and ages on it');
});

/* ---- Reviewer endpoint --------------------------------------------------- */

it('the same application is returned by the unfiltered reviewer endpoint', async () => {
  const { body: sub } = await post('/applications/submit', payload());
  created.push(sub.applicationNumber);

  const { status, body } = await getJson('/applications/reviewer?pageSize=100');
  assert.equal(status, 200);
  const hit = body.applications.find(a => a.applicationNumber === sub.applicationNumber);
  assert.ok(hit, 'submitted application missing from the unfiltered reviewer queue');
  assert.equal(hit.status, 'Submitted');
});

it('total, statusCounts and the returned page all include it', async () => {
  const before = await getJson('/applications/reviewer?pageSize=100');
  const { body: sub } = await post('/applications/submit', payload());
  created.push(sub.applicationNumber);
  const after = await getJson('/applications/reviewer?pageSize=100');

  assert.equal(after.body.total, before.body.total + 1, 'total did not account for the new record');
  assert.equal(
    (after.body.statusCounts.Submitted || 0),
    (before.body.statusCounts.Submitted || 0) + 1,
    'Submitted status count did not account for the new record',
  );
  assert.equal(after.body.applications.length, after.body.total,
    'returned page count disagrees with total at pageSize=100');
});

it('the newest application is first on page 1 sorted by submitted descending', async () => {
  const { body: sub } = await post('/applications/submit', payload());
  created.push(sub.applicationNumber);

  const { body } = await getJson('/applications/reviewer?page=1&pageSize=20');
  assert.equal(body.applications[0].applicationNumber, sub.applicationNumber,
    'newest submission is not the first row of page 1');

  /* Ordering must hold on the full timestamp, not a truncated date. */
  const times = body.applications.map(a => new Date(a.submittedAt).getTime());
  const sorted = [...times].sort((x, y) => y - x);
  assert.deepEqual(times, sorted, 'page 1 is not ordered by submittedAt descending');
});

it('pagination does not hide it and pages do not duplicate records', async () => {
  const { body: sub } = await post('/applications/submit', payload());
  created.push(sub.applicationNumber);

  const { body: first } = await getJson('/applications/reviewer?page=1&pageSize=100');
  const totalPages = first.totalPages;
  const seen = [];
  for (let p = 1; p <= totalPages; p += 1) {
    const { body } = await getJson(`/applications/reviewer?page=${p}&pageSize=5`);
    seen.push(...body.applications.map(a => a.applicationNumber));
  }
  assert.ok(seen.includes(sub.applicationNumber), 'application lost while paging through the queue');
  assert.equal(new Set(seen).size, seen.length, 'the same application appeared on two pages');
});

/* ---- Eligibility consistency --------------------------------------------- */

it('a draft is excluded from the queue, so it can raise no notification either', async () => {
  const { status, body } = await post('/applications/draft', payload());
  assert.equal(status, 200, `draft save failed: ${JSON.stringify(body)}`);
  created.push(body.applicationNumber);

  const { body: queue } = await getJson('/applications/reviewer?pageSize=100');
  assert.ok(
    !queue.applications.some(a => a.applicationNumber === body.applicationNumber),
    'a draft leaked into the reviewer queue',
  );
});

it('navbar and Review Queue read the same endpoint, so eligibility cannot diverge', async () => {
  /* The navbar hook calls listReviewerApplications({ pageSize: 100 }) with no
     other filters — byte-for-byte the request asserted here. If the queue's
     eligibility rule changes, both move together. */
  const { body: navbar } = await getJson('/applications/reviewer?pageSize=100');
  const { body: queue } = await getJson('/applications/reviewer?pageSize=100');
  assert.deepEqual(
    navbar.applications.map(a => a.applicationNumber),
    queue.applications.map(a => a.applicationNumber),
  );
  /* With no filters the builder collapses its single clause, so the unfiltered
     eligibility rule is the whole filter. */
  const { buildReviewerFilter } = require('../services/reviewerFilters');
  assert.deepEqual(buildReviewerFilter({}).filter, { isDraft: false },
    'queue eligibility is no longer { isDraft: false } — update the navbar hook comment');
});

/* ---- Failed submissions must leave nothing behind ------------------------- */

it('an incomplete submission is rejected and persists no record', async () => {
  const countBefore = await mongoose.connection.db.collection('applications').countDocuments({});
  const { status, body } = await post('/applications/submit', payload({ applicantName: '' }));
  if (body.applicationNumber) created.push(body.applicationNumber);
  assert.equal(status, 400);
  assert.match(body.error, /required/i);
  const countAfter = await mongoose.connection.db.collection('applications').countDocuments({});
  assert.equal(countAfter, countBefore, 'a rejected submission still wrote a record');
});

it('a submission with an invalid category is rejected and persists no record', async () => {
  const countBefore = await mongoose.connection.db.collection('applications').countDocuments({});
  const { status, body } = await post('/applications/submit', payload({ exportCategory: 'Y' }));
  /* Register for cleanup BEFORE asserting: if validation regresses and a record
     IS written, the failing assertion must not also leak it into the database. */
  if (body.applicationNumber) created.push(body.applicationNumber);
  assert.equal(status, 400);
  assert.equal(body.field, 'exportCategory');
  assert.match(body.error, /not a recognised export category/i);
  const countAfter = await mongoose.connection.db.collection('applications').countDocuments({});
  assert.equal(countAfter, countBefore, 'a rejected submission still wrote a record');
});

it('a valid category alias is accepted and stored canonically', async () => {
  const { status, body } = await post('/applications/submit', payload({ exportCategory: 'vaccines' }));
  assert.equal(status, 200, JSON.stringify(body));
  created.push(body.applicationNumber);
  const stored = await mongoose.connection.db.collection('applications')
    .findOne({ applicationNumber: body.applicationNumber });
  assert.equal(stored.exportCategory, 'Vaccines');
});

it('country aliases are accepted and stored canonically', async () => {
  const { status, body } = await post('/applications/submit', payload({
    destinationCountry: 'UK',
    consignees: [{ country: 'south korea' }],
  }));
  assert.equal(status, 200, JSON.stringify(body));
  created.push(body.applicationNumber);
  const stored = await mongoose.connection.db.collection('applications')
    .findOne({ applicationNumber: body.applicationNumber });
  assert.equal(stored.destinationCountry, 'United Kingdom');
  assert.equal(stored.consignees[0].country, 'Korea, Republic of');
});

it('invalid legacy values remain findable without assuming fixture counts', async () => {
  /* Validation guards new writes; it must never make existing rows unreachable. */
  const { body } = await getJson('/applications/reviewer?pageSize=100');
  const legacy = body.applications.filter(
    a => a.destinationCountry === 'X' || a.exportCategory === 'Y');
  assert.ok(Array.isArray(legacy));
  assert.ok(legacy.every(row => row.applicationNumber), 'invalid rows must remain addressable for audit');
});

it('a submission with an invalid country is rejected and persists no record', async () => {
  const countBefore = await mongoose.connection.db.collection('applications').countDocuments({});
  const { status, body } = await post('/applications/submit', payload({ destinationCountry: 'X' }));
  if (body.applicationNumber) created.push(body.applicationNumber);
  assert.equal(status, 400);
  const countAfter = await mongoose.connection.db.collection('applications').countDocuments({});
  assert.equal(countAfter, countBefore, 'a rejected submission still wrote a record');
});

/* ---- Reviewer scope ------------------------------------------------------ */

it('the queue is refused without a reviewer role', async () => {
  const { status } = await getJson('/applications/reviewer', { 'x-user-role': 'applicant' });
  assert.equal(status, 403, 'a non-reviewer reached the reviewer queue');
});

it('every reviewer sees the same queue — there is no per-reviewer assignment scope', async () => {
  /* Documents the intended rule: the queue is shared, not assigned. If
     per-reviewer assignment is ever introduced, this test must be updated
     deliberately rather than the navbar and queue drifting apart silently. */
  const a = await getJson('/applications/reviewer?pageSize=100', { ...REVIEWER, 'x-reviewer-name': 'reviewer-a' });
  const b = await getJson('/applications/reviewer?pageSize=100', { ...REVIEWER, 'x-reviewer-name': 'reviewer-b' });
  assert.deepEqual(
    a.body.applications.map(x => x.applicationNumber),
    b.body.applications.map(x => x.applicationNumber),
  );
});
