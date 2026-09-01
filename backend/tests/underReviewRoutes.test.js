/* ============================================================================
   Application-level Under Review — routes, persistence, audit and authority.

   applicationReview.test.js covers the snapshot rules in isolation. These
   trace the flow through the API: that the server builds the snapshot from the
   stored record, that it validates the transition against the STORED status
   rather than anything the client sends, that the review is persisted outside
   the query system, and that repeats create no second audit entry.

   They need the API and MongoDB running. When either is absent the whole file
   skips instead of failing, so `npm test` stays green on a bare checkout:

     TEST_API_URL=http://localhost:5001/api \
     TEST_MONGO_URL=mongodb://localhost:27017/drug_ministry_test \
     node --test tests/underReviewRoutes.test.js
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
/* Populated in test.before by logging in; reviewer identity is server-issued. */
const REVIEWER = {};
const APPLICANT = {};

const created = [];
let mongoose = null;
let live = false;
let liveError = null;

const WRONG_DOC = {
  documentTypeMatch: false,
  documentTypeReason: 'The document is a declaration, not a Product Approval Certificate.',
  expectedDocumentType: 'Product Approval Certificate',
  results: [],
  summary: { total: 0, present: 0, missing: 0, unknown: 0, score: 0 },
};

function payload() {
  return {
    user: 'ur-itest',
    formData: {
      applicantName: `UnderReview Applicant ${RUN_ID}`,
      applicantOrganization: 'UnderReview Exports Pvt Ltd',
      email: `ur+${RUN_ID}@example.com`,
      destinationCountry: 'Poland',
      exportCategory: 'Vaccines',
      applicantState: 'Kerala',
      products: [{ genericName: 'Nimesulide', brandName: 'UR', quantity: '10' }],
    },
  };
}

async function post(path, body, headers = {}) {
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

async function seedApplication() {
  const res = await post('/applications/submit', payload(), APPLICANT);
  assert.equal(res.status < 400, true, `submit HTTP ${res.status}`);
  const appNo = res.body.applicationNumber || res.body.application?.applicationNumber;
  assert.ok(appNo, 'submission returned no application number');
  created.push(appNo);

  await mongoose.connection.db.collection('applications').updateOne(
    { applicationNumber: appNo },
    {
      $set: {
        'documents.product_approval': {
          name: 'noc.pdf', size: 1024, type: 'application/pdf', uploadedAt: '10:00 AM',
          data: '', validated: true,
          validationResult: {
            documentTypeMatch: false,
            documentTypeReason: WRONG_DOC.documentTypeReason,
            score: 0, verifiedAt: new Date(), fullResults: WRONG_DOC,
          },
        },
      },
    }
  );
  return appNo;
}

const setStatus = (appNo, status) => mongoose.connection.db.collection('applications')
  .updateOne({ applicationNumber: appNo }, { $set: { status } });

const reviewsFor = appNo => mongoose.connection.db.collection('applicationreviews')
  .find({ applicationNumber: appNo }).toArray();

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
    if (!haveCredentials('TEST_REVIEWER', 'TEST_APPLICANT_A')) {
      liveError = 'set TEST_REVIEWER and TEST_APPLICANT_A as user:pass';
      return;
    }
    await adoptSession(REVIEWER, API, 'TEST_REVIEWER');
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
    $or: [{ applicationNumber: { $in: created } }, { 'formData.email': new RegExp(`^ur\\+${RUN_ID}`) }],
  });
  await mongoose.connection.db.collection('applicationreviews').deleteMany({ applicationNumber: { $in: created } });
  await mongoose.connection.db.collection('applicationqueries').deleteMany({ applicationNumber: { $in: created } });
  await mongoose.disconnect();
});

const live_test = (name, fn) => test(name, async t => {
  if (!live) return t.skip(liveError || 'API or MongoDB not reachable');
  return fn(t);
});

/* ---- Snapshot generation -------------------------------------------------- */

live_test('the snapshot is generated from the whole stored application', async () => {
  const appNo = await seedApplication();
  const res = await getJson(`/applications/${appNo}/review-snapshot`, REVIEWER);

  assert.equal(res.status, 200);
  assert.equal(res.body.application.applicationNumber, appNo);
  assert.equal(res.body.application.applicant, 'UnderReview Exports Pvt Ltd');
  assert.equal(res.body.application.currentStatus, 'Submitted');
  assert.equal(res.body.transition.allowed, true);
  assert.equal(res.body.transition.alreadyUnderReview, false);

  // Metrics come from the stored record, not the client.
  assert.equal(res.body.metrics.documentsUploaded, 1);
  assert.equal(res.body.metrics.aiFlagged, 1);
  assert.equal(typeof res.body.metrics.compliancePercent, 'number');

  // Findings from more than one section: the flagged document and the
  // prohibited-drug product both appear.
  const areas = new Set(res.body.rows.map(r => r.area));
  assert.ok(areas.has('Document'), 'the flagged upload is reported');
  assert.ok(areas.has('Product'), 'the prohibited-drug product is reported');
  assert.ok(res.body.rows.every(r => r.rowSource === 'ai_generated' && r.edited === false));
  assert.match(res.body.applicantMessage, /taken up for review/i);
});

live_test('the snapshot endpoint is reviewer-only', async () => {
  const appNo = await seedApplication();
  const res = await getJson(`/applications/${appNo}/review-snapshot`);
  assert.equal(res.status === 401 || res.status === 403, true, `expected auth failure, got ${res.status}`);
});

live_test('an unauthorised user cannot mark an application Under Review', async () => {
  const appNo = await seedApplication();
  const res = await post(`/applications/${appNo}/under-review`, {
    submissionId: `sub-${RUN_ID}-anon`,
    rows: [], applicantMessage: 'Taken up for review.',
  });
  assert.equal(res.status === 401 || res.status === 403, true, `expected auth failure, got ${res.status}`);
  assert.equal((await reviewsFor(appNo)).length, 0);
});

/* ---- Persistence, status and audit --------------------------------------- */

live_test('submission stores the structured review, changes status, and writes audit history', async () => {
  const appNo = await seedApplication();
  const draft = await getJson(`/applications/${appNo}/review-snapshot`, REVIEWER);
  const first = draft.body.rows[0];

  const res = await post(`/applications/${appNo}/under-review`, {
    submissionId: `sub-${RUN_ID}-main`,
    applicantMessage: 'Your application is under examination.',
    rows: [
      { ...first, rowKey: 'r1', note: 'Escalated to the senior reviewer.' },
      { rowKey: 'm1', area: 'Shipment', item: 'Consignee address', note: 'Verify the consignee address.', rowSource: 'reviewer_added' },
    ],
  }, REVIEWER);

  assert.equal(res.status, 200);
  assert.equal(res.body.duplicate, false);
  assert.equal(res.body.status, 'Under Review');
  assert.equal(res.body.statusChanged, true);

  const review = res.body.review;
  assert.equal(review.applicationNumber, appNo);
  assert.equal(review.previousStatus, 'Submitted');
  assert.equal(review.newStatus, 'Under Review');
  assert.equal(review.reviewer.name, REVIEWER.principal.username);
  assert.ok(review.createdAt, 'a timestamp is stored');
  assert.equal(review.applicantMessage, 'Your application is under examination.');

  const [aiRow, manualRow] = review.rows;
  assert.equal(aiRow.order, 1);
  assert.equal(aiRow.rowSource, 'ai_generated');
  assert.equal(aiRow.edited, true, 'the reviewer rewrote the generated note');
  assert.equal(aiRow.aiNote, first.aiNote, 'the original generated text is preserved');
  assert.equal(aiRow.note, 'Escalated to the senior reviewer.');
  assert.ok(aiRow.aiObservation.length > 0);
  assert.equal(manualRow.order, 2);
  assert.equal(manualRow.rowSource, 'reviewer_added');
  assert.equal(manualRow.edited, false);

  // The status change is on the application, with one audit transition.
  const full = await getJson(`/applications/${appNo}/full`, REVIEWER);
  assert.equal(full.body.application.status, 'Under Review');
  const transitions = (full.body.application.auditLog || [])
    .filter(e => e.toStatus === 'Under Review');
  assert.equal(transitions.length, 1, 'exactly one Under Review transition is recorded');
  assert.equal(transitions[0].fromStatus, 'Submitted');

  // It is a review, never a query: nothing lands in the query system.
  const history = await getJson(`/applications/${appNo}/query-history`, REVIEWER);
  assert.equal(history.body.queries.filter(q => q.source === 'document').length, 0);
  assert.equal(history.body.queries.some(q => /under examination/i.test(q.remarks || '')), false,
    'the applicant message is not turned into a query record');
});

live_test('a row kept without a note is refused with a per-row message', async () => {
  const appNo = await seedApplication();
  const res = await post(`/applications/${appNo}/under-review`, {
    submissionId: `sub-${RUN_ID}-blank`,
    rows: [{ rowKey: 'r1', area: 'Document', item: 'x', aiObservation: 'y', aiNote: 'z', note: '   ', rowSource: 'ai_generated' }],
  }, REVIEWER);
  assert.equal(res.status, 400);
  assert.ok(res.body.rowErrors.r1);
  assert.equal((await reviewsFor(appNo)).length, 0);
});

live_test('a clean submission with no observations is accepted', async () => {
  const appNo = await seedApplication();
  const res = await post(`/applications/${appNo}/under-review`, {
    submissionId: `sub-${RUN_ID}-clean`, rows: [],
  }, REVIEWER);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.review.rows, []);
  // The neutral default message is applied server-side.
  assert.match(res.body.review.applicantMessage, /taken up for review/i);
});

/* ---- Idempotency ---------------------------------------------------------- */

live_test('repeating a submission creates no second review or audit entry', async () => {
  const appNo = await seedApplication();
  const body = {
    submissionId: `sub-${RUN_ID}-idem`,
    applicantMessage: 'Under examination.',
    rows: [{ rowKey: 'm1', area: 'Application', item: 'Note', note: 'Internal note.', rowSource: 'reviewer_added' }],
  };
  const path = `/applications/${appNo}/under-review`;

  const first = await post(path, body, REVIEWER);
  assert.equal(first.body.duplicate, false);

  const replay = await post(path, body, REVIEWER);
  assert.equal(replay.body.duplicate, true);

  const racing = await Promise.all([post(path, body, REVIEWER), post(path, body, REVIEWER)]);
  assert.ok(racing.every(r => r.status === 200));

  assert.equal((await reviewsFor(appNo)).length, 1, 'exactly one review record survives');
  const full = await getJson(`/applications/${appNo}/full`, REVIEWER);
  const transitions = (full.body.application.auditLog || []).filter(e => e.toStatus === 'Under Review');
  assert.equal(transitions.length, 1, 'no duplicate audit history');
});

live_test('a submission without a submissionId is refused', async () => {
  const appNo = await seedApplication();
  const res = await post(`/applications/${appNo}/under-review`, { rows: [] }, REVIEWER);
  assert.equal(res.status, 400);
});

/* ---- Status transition rules --------------------------------------------- */

live_test('an approved or rejected application cannot be moved to Under Review', async () => {
  for (const status of ['Approved', 'Rejected']) {
    const appNo = await seedApplication();
    await setStatus(appNo, status);

    const snapshot = await getJson(`/applications/${appNo}/review-snapshot`, REVIEWER);
    assert.equal(snapshot.body.transition.allowed, false, `${status} snapshot must refuse`);

    const res = await post(`/applications/${appNo}/under-review`, {
      submissionId: `sub-${RUN_ID}-${status}`, rows: [],
    }, REVIEWER);
    assert.equal(res.status, 409, `${status} submission must be refused`);
    assert.equal(res.body.code, 'TRANSITION_NOT_ALLOWED');
    assert.equal((await reviewsFor(appNo)).length, 0);

    const full = await getJson(`/applications/${appNo}/full`, REVIEWER);
    assert.equal(full.body.application.status, status, 'the stored status is untouched');
  }
});

live_test('the stored status decides the transition, not anything the client sends', async () => {
  const appNo = await seedApplication();
  await setStatus(appNo, 'Approved');
  const res = await post(`/applications/${appNo}/under-review`, {
    submissionId: `sub-${RUN_ID}-spoof`,
    rows: [],
    // All of this is ignored: the server reads the record instead.
    status: 'Submitted', currentStatus: 'Submitted', metrics: { compliancePercent: 100 },
  }, REVIEWER);
  assert.equal(res.status, 409);
});

live_test('an application already Under Review updates its notes without a second transition', async () => {
  const appNo = await seedApplication();
  await post(`/applications/${appNo}/under-review`,
    { submissionId: `sub-${RUN_ID}-a`, rows: [] }, REVIEWER);

  const snapshot = await getJson(`/applications/${appNo}/review-snapshot`, REVIEWER);
  assert.equal(snapshot.body.transition.alreadyUnderReview, true);
  assert.ok(snapshot.body.existingReview, 'the previous review is shown back to the reviewer');

  const second = await post(`/applications/${appNo}/under-review`, {
    submissionId: `sub-${RUN_ID}-b`,
    rows: [{ rowKey: 'm1', area: 'Application', item: 'Follow-up', note: 'Chase the manufacturer.', rowSource: 'reviewer_added' }],
  }, REVIEWER);

  assert.equal(second.status, 200);
  assert.equal(second.body.statusChanged, false);
  assert.equal(second.body.review.statusChanged, false);

  const full = await getJson(`/applications/${appNo}/full`, REVIEWER);
  const transitions = (full.body.application.auditLog || []).filter(e => e.toStatus === 'Under Review');
  assert.equal(transitions.length, 1, 'still exactly one status transition in history');
});

/* ---- Coexistence with the document query workflow ------------------------ */

live_test('the document query workflow is unaffected by an Under Review action', async () => {
  const appNo = await seedApplication();
  await post(`/applications/${appNo}/under-review`,
    { submissionId: `sub-${RUN_ID}-coexist`, rows: [] }, REVIEWER);

  const query = await post(`/applications/${appNo}/document/product_approval/query`, {
    submissionId: `sub-${RUN_ID}-docq`,
    rows: [{ rowKey: 'r1', queryText: 'Please upload a valid Product Approval Certificate.', rowSource: 'reviewer_added' }],
  }, REVIEWER);

  assert.equal(query.status, 200);
  assert.equal(query.body.status, 'Query Raised', 'the document query still drives its own status');
  assert.match(query.body.query.queryIdentifier, /^AIQ-/);

  // The two records live in separate collections and neither absorbed the other.
  assert.equal((await reviewsFor(appNo)).length, 1);
  const queries = await mongoose.connection.db.collection('applicationqueries')
    .find({ applicationNumber: appNo }).toArray();
  assert.equal(queries.length, 1);
  assert.equal(queries[0].rows.length, 1);
});

live_test('legacy Under Review history stays readable alongside the new records', async () => {
  const appNo = await seedApplication();
  // The pre-existing reviewer route wrote Under Review with no review record.
  const legacy = await post(`/applications/${appNo}/review`,
    { status: 'Under Review', remarks: 'Legacy under-review remark.' }, REVIEWER);
  assert.equal(legacy.status, 200);

  const full = await getJson(`/applications/${appNo}/full`, REVIEWER);
  assert.equal(full.body.application.status, 'Under Review');
  assert.ok((full.body.application.reviewerRemarks || [])
    .some(r => r.text === 'Legacy under-review remark.'), 'the legacy remark is still readable');

  // The new snapshot endpoint copes with an application that has no review record.
  const snapshot = await getJson(`/applications/${appNo}/review-snapshot`, REVIEWER);
  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.body.transition.alreadyUnderReview, true);
  assert.equal(snapshot.body.existingReview, null);
  assert.match(snapshot.body.applicantMessage, /taken up for review/i);
});
