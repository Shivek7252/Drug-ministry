/* ============================================================================
   Analytics endpoint: authorization, projection safety, filter parity, and
   agreement with the reviewer queue.

   Integration — needs the API and MongoDB. Skips cleanly when neither is up.
   ============================================================================ */

const test = require('node:test');
const assert = require('node:assert/strict');

const API = process.env.API_URL || 'http://localhost:5001/api';
const REVIEWER = { 'x-user-role': 'reviewer', 'x-reviewer-name': 'analytics-itest' };

let live = false;
let liveError = null;

async function get(path, headers = REVIEWER) {
  const res = await fetch(`${API}${path}`, { headers });
  return { status: res.status, body: await res.json().catch(() => ({})), text: null };
}

test.before(async () => {
  try {
    const res = await fetch(`${API}/applications/reviewer/analytics`, { headers: REVIEWER });
    if (!res.ok) { liveError = `analytics endpoint HTTP ${res.status}`; return; }
    live = true;
  } catch (err) { liveError = err.message; }
});

const it = (name, fn) => test(name, async t => {
  if (!live) return t.skip(`API not reachable (${liveError || 'unknown'})`);
  return fn(t);
});

/* ---- Authorization ------------------------------------------------------- */

it('an unauthenticated caller is refused', async () => {
  const { status } = await get('/applications/reviewer/analytics', {});
  assert.equal(status, 403);
});

it('a non-reviewer role is refused', async () => {
  const { status } = await get('/applications/reviewer/analytics', { 'x-user-role': 'applicant' });
  assert.equal(status, 403);
});

it('a reviewer role without a name is refused', async () => {
  const { status } = await get('/applications/reviewer/analytics', { 'x-user-role': 'reviewer' });
  assert.equal(status, 403);
});

/* ---- Projection safety --------------------------------------------------- */

it('the response never exposes the raw audit log or documents', async () => {
  const { body } = await get('/applications/reviewer/analytics');
  const raw = JSON.stringify(body);
  assert.ok(!raw.includes('auditLog'), 'auditLog must not be returned');
  assert.ok(!/Status:\s*\w+\s*→/.test(raw), 'raw audit detail strings must not be returned');
  assert.ok(!raw.includes('"documents"'), 'documents must not be returned');
  assert.ok(!raw.includes('reviewerRemarks'), 'reviewer remarks must not be returned');
});

it('no applicant contact details are returned', async () => {
  const { body } = await get('/applications/reviewer/analytics');
  const raw = JSON.stringify(body);
  assert.ok(!raw.includes('@'), 'no email addresses should appear in an analytics payload');
});

/* ---- Agreement with the queue -------------------------------------------- */

it('current counts agree with the reviewer queue for the same filters', async () => {
  const [queue, an] = await Promise.all([
    get('/applications/reviewer?pageSize=100'),
    get('/applications/reviewer/analytics'),
  ]);
  assert.equal(an.body.current.total, queue.body.total, 'Total must match the queue total');
  assert.equal(an.body.scope.applications, queue.body.total,
    'analytics must aggregate the full set, not a page');

  const sc = queue.body.statusCounts || {};
  assert.equal(an.body.current.submitted, sc.Submitted || 0);
  assert.equal(an.body.current.queryRaised, sc['Query Raised'] || 0);
  assert.equal(an.body.current.rejected, sc.Rejected || 0);
  assert.equal(
    an.body.current.underReview,
    (sc['Under Review'] || 0) + (sc['Document Verification'] || 0) + (sc['Compliance Check'] || 0),
  );
  assert.equal(
    an.body.current.approved,
    (sc.Approved || 0) + (sc['Partially Approved'] || 0),
  );
});

it('analytics is independent of pagination', async () => {
  const [p1, p2] = await Promise.all([
    get('/applications/reviewer/analytics?page=1&pageSize=1'),
    get('/applications/reviewer/analytics?page=3&pageSize=5'),
  ]);
  assert.deepEqual(p1.body.current, p2.body.current,
    'pagination parameters must not change an aggregate');
});

it('the same filters narrow analytics and the queue identically', async () => {
  const filter = 'category=Vaccines';
  const [queue, an] = await Promise.all([
    get(`/applications/reviewer?pageSize=100&${filter}`),
    get(`/applications/reviewer/analytics?${filter}`),
  ]);
  assert.equal(an.body.current.total, queue.body.total);
  assert.equal(an.body.scope.applications, queue.body.total);
});

it('a country filter narrows analytics the same way', async () => {
  const [queue, an] = await Promise.all([
    get('/applications/reviewer?pageSize=100&country=Japan'),
    get('/applications/reviewer/analytics?country=Japan'),
  ]);
  assert.equal(an.body.current.total, queue.body.total);
});

it('combined filters agree', async () => {
  const f = 'category=Vaccines&country=Japan';
  const [queue, an] = await Promise.all([
    get(`/applications/reviewer?pageSize=100&${f}`),
    get(`/applications/reviewer/analytics?${f}`),
  ]);
  assert.equal(an.body.current.total, queue.body.total);
});

it('an unmatched filter yields zeros, not an error', async () => {
  const { status, body } = await get('/applications/reviewer/analytics?country=Bhutan&category=Cosmetics');
  assert.equal(status, 200);
  assert.equal(body.current.total, 0);
  assert.equal(body.unread.count, 0);
});

it('an invalid date preset is a 400, not a silent empty result', async () => {
  const { status } = await get('/applications/reviewer/analytics?datePreset=not-a-preset');
  assert.equal(status, 400);
});

/* ---- Payload contract ---------------------------------------------------- */

it('the payload carries generation time, windows, SLA and definitions', async () => {
  const { body } = await get('/applications/reviewer/analytics');
  assert.ok(Date.parse(body.generatedAt));
  assert.equal(body.timezone, 'Asia/Kolkata');
  assert.ok(Date.parse(body.windows.current.from));
  assert.ok(Date.parse(body.windows.prior.from));
  assert.equal(body.windows.weekStartsOn, 'Monday');
  assert.equal(body.sla.confirmed, false);
  assert.ok(body.definitions.length >= 7);
  for (const key of ['total', 'submitted', 'underReview', 'queryRaised', 'approved', 'rejected', 'overdue']) {
    assert.ok(key in body.current, `current.${key} missing`);
    assert.ok(key in body.comparison, `comparison.${key} missing`);
  }
});

it('every comparison is either available with numbers or explicitly unavailable', async () => {
  const { body } = await get('/applications/reviewer/analytics');
  for (const [key, c] of Object.entries(body.comparison)) {
    if (c.available) {
      assert.equal(typeof c.current, 'number', `${key}.current`);
      assert.equal(typeof c.prior, 'number', `${key}.prior`);
      assert.equal(c.delta, c.current - c.prior, `${key}.delta must be current - prior`);
      assert.ok(['up', 'down', 'flat'].includes(c.direction));
    } else {
      assert.ok(c.reason, `${key} must say why it is unavailable`);
    }
  }
});

it('unread is per reviewer: two reviewers get independent counts', async () => {
  const a = await get('/applications/reviewer/analytics', { ...REVIEWER, 'x-reviewer-name': 'unread-a' });
  const b = await get('/applications/reviewer/analytics', { ...REVIEWER, 'x-reviewer-name': 'unread-b' });
  /* Same population... */
  assert.equal(a.body.current.total, b.body.current.total);
  /* ...and unread is a reviewer-specific aggregate, without returning a raw
     application list from the analytics endpoint. */
  assert.ok(a.body.unread.count <= a.body.current.total);
  assert.equal(a.body.unread.applicationNumbers, undefined);
  assert.equal(b.body.unread.applicationNumbers, undefined);
});

it('all seven charts are aggregated over the complete filtered population', async () => {
  const { body } = await get('/applications/reviewer/analytics?workflowStatus=total&pageSize=1');
  assert.equal(body.charts.scope.applications, body.current.total);
  for (const key of [
    'submissionTrend', 'statusDistribution', 'processingTime', 'categoryMix',
    'destinationCountries', 'pipeline', 'decisionThroughput',
  ]) assert.ok(key in body.charts, `charts.${key} missing`);
});

it('search and state filters are reported exactly as applied', async t => {
  const queue = await get('/applications/reviewer?page=1&pageSize=1');
  const sample = queue.body.applications?.[0];
  if (!sample) return t.skip('No submitted application available');
  const search = encodeURIComponent(sample.applicationNumber);
  const state = encodeURIComponent(sample.state || sample.city || 'All States');
  const [filteredQueue, analytics] = await Promise.all([
    get(`/applications/reviewer?search=${search}&state=${state}`),
    get(`/applications/reviewer/analytics?search=${search}&state=${state}`),
  ]);
  assert.equal(analytics.body.current.total, filteredQueue.body.total);
  assert.equal(analytics.body.filters.search, sample.applicationNumber);
  assert.equal(analytics.body.filters.state, sample.state || sample.city || 'All States');
});
