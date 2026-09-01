/* ============================================================================
   Document-scoped query workflow — routes, persistence, and scoping.

   The unit tests in documentQuery.test.js cover the draft rules in isolation.
   These trace the flow through the API: that a draft is built from ONE
   document's cached verification payload, that submission persists structured
   rows under the stable docId, that repeats are idempotent, and that the
   record joins the existing AIQ-* query history rather than a parallel system.

   They need the API and MongoDB running. When either is absent the whole file
   skips instead of failing, so `npm test` stays green on a bare checkout:

     TEST_API_URL=http://localhost:5001/api \
     TEST_MONGO_URL=mongodb://localhost:27017/drug_ministry_test \
     node --test tests/documentQueryRoutes.test.js
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

/* Two documents on one application. Their findings must never mix. */
const PRODUCT_APPROVAL = {
  documentTypeMatch: false,
  documentTypeReason: 'The document is a declaration/undertaking for NOC application, not a Product Approval Certificate.',
  expectedDocumentType: 'Product Approval Certificate',
  detectedDocumentType: 'NOC declaration',
  results: [],
  summary: { total: 0, present: 0, missing: 0, unknown: 0, score: 0 },
};

const MFG_LICENSE = {
  documentTypeMatch: true,
  expectedDocumentType: 'Manufacturing License',
  results: [
    { item: 'License number is present', present: true, evidence: 'LIC 25-KD/323' },
    { item: 'Valid date / expiry date is present', present: false, failureReason: 'The licence expired on 31/12/2026.' },
    { item: 'Authorised signatory is present', present: false, note: 'No authorised signature block was found.' },
  ],
  summary: { total: 3, present: 1, missing: 2, unknown: 0, score: 33 },
};

function payload() {
  return {
    user: 'docq-itest',
    formData: {
      applicantName: `DocQuery Applicant ${RUN_ID}`,
      applicantOrganization: 'DocQuery Exports Pvt Ltd',
      email: `docq+${RUN_ID}@example.com`,
      destinationCountry: 'Poland',
      exportCategory: 'Vaccines',
      applicantState: 'Kerala',
      products: [{ genericName: 'Paracetamol', brandName: 'DocQ', quantity: '10' }],
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

/* Seeds the two documents with the verification payloads the draft reads. */
async function seedApplication() {
  const res = await post('/applications/submit', payload(), APPLICANT);
  assert.equal(res.status < 400, true, `submit HTTP ${res.status}`);
  const appNo = res.body.applicationNumber || res.body.application?.applicationNumber;
  assert.ok(appNo, 'submission returned no application number');
  created.push(appNo);

  const doc = (name, fullResults) => ({
    name, size: 1024, type: 'application/pdf', uploadedAt: '10:00 AM',
    data: '', validated: true,
    validationResult: {
      documentTypeMatch: fullResults.documentTypeMatch,
      documentTypeReason: fullResults.documentTypeReason || '',
      score: fullResults.summary.score,
      verifiedAt: new Date(),
      fullResults,
    },
  });

  await mongoose.connection.db.collection('applications').updateOne(
    { applicationNumber: appNo },
    {
      $set: {
        // Deliberately identical filenames: grouping must key on docId alone.
        'documents.product_approval': doc('shared-name.pdf', PRODUCT_APPROVAL),
        'documents.mfg_license': doc('shared-name.pdf', MFG_LICENSE),
      },
    }
  );
  return appNo;
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
    $or: [{ applicationNumber: { $in: created } }, { 'formData.email': new RegExp(`^docq\\+${RUN_ID}`) }],
  });
  await mongoose.connection.db.collection('applicationqueries').deleteMany({
    applicationNumber: { $in: created },
  });
  await mongoose.disconnect();
});

const live_test = (name, fn) => test(name, async t => {
  if (!live) return t.skip(liveError || 'API or MongoDB not reachable');
  return fn(t);
});

/* ---- Scoping ------------------------------------------------------------- */

live_test('a draft is built from the selected document only', async () => {
  const appNo = await seedApplication();

  const approval = await getJson(`/applications/${appNo}/document/product_approval/query-draft`, REVIEWER);
  assert.equal(approval.status, 200);
  assert.equal(approval.body.document.docId, 'product_approval');
  assert.equal(approval.body.document.status.label, 'Wrong Document');
  assert.equal(approval.body.rows.length, 1);
  assert.equal(approval.body.rows[0].checklistItem, 'Document type verification');
  assert.equal(
    approval.body.rows[0].queryText,
    'Please upload a valid Product Approval Certificate for the applied product.'
  );

  const licence = await getJson(`/applications/${appNo}/document/mfg_license/query-draft`, REVIEWER);
  assert.equal(licence.status, 200);
  assert.equal(licence.body.rows.length, 2);

  // Neither draft carries a single finding belonging to the other document.
  const approvalText = JSON.stringify(approval.body.rows);
  const licenceText = JSON.stringify(licence.body.rows);
  assert.ok(!approvalText.includes('licence expired'));
  assert.ok(!approvalText.includes('Authorised signatory'));
  assert.ok(!licenceText.includes('Product Approval Certificate'));
});

live_test('a draft cannot be requested for a document the application does not have', async () => {
  const appNo = await seedApplication();
  const res = await getJson(`/applications/${appNo}/document/not_a_real_doc/query-draft`, REVIEWER);
  assert.equal(res.status, 404);
});

live_test('the draft endpoint is reviewer-only', async () => {
  const appNo = await seedApplication();
  const res = await getJson(`/applications/${appNo}/document/product_approval/query-draft`);
  assert.equal(res.status === 401 || res.status === 403, true, `expected auth failure, got ${res.status}`);
});

/* ---- Structured persistence --------------------------------------------- */

live_test('submission persists structured rows under the stable docId', async () => {
  const appNo = await seedApplication();
  const draft = await getJson(`/applications/${appNo}/document/product_approval/query-draft`, REVIEWER);

  const rows = [
    { ...draft.body.rows[0], rowKey: 'r1', queryText: 'Please upload the CDSCO-issued Product Approval Certificate.' },
    { rowKey: 'm1', checklistItem: 'Batch size', queryText: 'Please confirm the approved batch size.', rowSource: 'reviewer_added' },
  ];
  const res = await post(
    `/applications/${appNo}/document/product_approval/query`,
    { submissionId: `sub-${RUN_ID}-a`, rows },
    REVIEWER
  );

  assert.equal(res.status, 200);
  assert.equal(res.body.duplicate, false);
  assert.equal(res.body.status, 'Query Raised');
  assert.match(res.body.query.queryIdentifier, /^AIQ-/);
  assert.equal(res.body.query.source, 'document');
  assert.equal(res.body.query.document.docId, 'product_approval');
  assert.equal(res.body.query.document.expectedType, 'Product Approval Certificate');

  const [aiRow, manualRow] = res.body.query.rows;
  assert.equal(aiRow.order, 1);
  assert.equal(aiRow.rowSource, 'ai_generated');
  assert.equal(aiRow.edited, true, 'an AI row the reviewer rewrote is flagged as edited');
  assert.equal(aiRow.aiQueryText, 'Please upload a valid Product Approval Certificate for the applied product.');
  assert.equal(aiRow.queryText, 'Please upload the CDSCO-issued Product Approval Certificate.');
  assert.equal(aiRow.findingRef, 'document-type');

  assert.equal(manualRow.order, 2);
  assert.equal(manualRow.rowSource, 'reviewer_added');
  assert.equal(manualRow.edited, false);

  // Legacy remarks are derived on the server; the rows stay primary.
  assert.match(res.body.query.remarks, /^Document query — Product Approval Certificate/);
  assert.match(res.body.query.remarks, /1\. .*CDSCO-issued Product Approval Certificate/);
});

live_test('an empty or whitespace-only row is refused with a per-row message', async () => {
  const appNo = await seedApplication();
  const res = await post(
    `/applications/${appNo}/document/product_approval/query`,
    { submissionId: `sub-${RUN_ID}-blank`, rows: [{ rowKey: 'r1', queryText: '   ', rowSource: 'ai_generated', aiQueryText: 'x' }] },
    REVIEWER
  );
  assert.equal(res.status, 400);
  assert.ok(res.body.rowErrors.r1, 'the offending row is named in the response');
});

/* ---- Idempotency --------------------------------------------------------- */

live_test('repeating a submission never raises a second query', async () => {
  const appNo = await seedApplication();
  const submissionId = `sub-${RUN_ID}-idem`;
  const body = {
    submissionId,
    rows: [{ rowKey: 'r1', checklistItem: 'Document type verification', queryText: 'Please upload a valid certificate.', rowSource: 'ai_generated', aiQueryText: 'Please upload a valid certificate.' }],
  };
  const path = `/applications/${appNo}/document/product_approval/query`;

  const first = await post(path, body, REVIEWER);
  assert.equal(first.status, 200);
  assert.equal(first.body.duplicate, false);

  const replay = await post(path, body, REVIEWER);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.duplicate, true);
  assert.equal(replay.body.query.queryIdentifier, first.body.query.queryIdentifier);

  // Concurrent replays resolve to the same record too.
  const racing = await Promise.all([post(path, body, REVIEWER), post(path, body, REVIEWER)]);
  for (const res of racing) {
    assert.equal(res.body.query.queryIdentifier, first.body.query.queryIdentifier);
  }

  const stored = await mongoose.connection.db.collection('applicationqueries')
    .countDocuments({ applicationNumber: appNo, source: 'document' });
  assert.equal(stored, 1, 'exactly one query record survives the repeats');
});

live_test('a submission without a submissionId is refused', async () => {
  const appNo = await seedApplication();
  const res = await post(
    `/applications/${appNo}/document/product_approval/query`,
    { rows: [{ rowKey: 'r1', queryText: 'Please upload it.', rowSource: 'reviewer_added' }] },
    REVIEWER
  );
  assert.equal(res.status, 400);
});

/* ---- Existing AIQ query history + applicant display ---------------------- */

live_test('the query joins the existing AIQ query history, with its rows intact', async () => {
  const appNo = await seedApplication();
  await post(
    `/applications/${appNo}/document/mfg_license/query`,
    {
      submissionId: `sub-${RUN_ID}-history`,
      rows: [{ rowKey: 'r1', checklistItem: 'Valid date / expiry date is present', deficiency: 'The licence expired on 31/12/2026.', queryText: 'Please upload a licence that is currently valid.', rowSource: 'ai_generated', aiQueryText: 'Please upload a licence that is currently valid.' }],
    },
    REVIEWER
  );

  const history = await getJson(`/applications/${appNo}/query-history`, REVIEWER);
  assert.equal(history.status, 200);
  const record = history.body.queries.find(q => q.source === 'document');
  assert.ok(record, 'the document query appears in the shared query history');
  assert.match(record.queryIdentifier, /^AIQ-/);
  assert.equal(record.document.docId, 'mfg_license');
  assert.equal(record.rows.length, 1);
  // Legacy consumers still find a remarks string on the same record.
  assert.ok(record.remarks.length > 0);
});

live_test('the applicant view groups queries by docId, not by filename', async () => {
  const appNo = await seedApplication();
  // Both documents share a filename on purpose.
  await post(`/applications/${appNo}/document/product_approval/query`,
    { submissionId: `sub-${RUN_ID}-g1`, rows: [{ rowKey: 'r1', queryText: 'Please upload the approval certificate.', rowSource: 'reviewer_added' }] }, REVIEWER);
  await post(`/applications/${appNo}/document/mfg_license/query`,
    { submissionId: `sub-${RUN_ID}-g2`, rows: [{ rowKey: 'r1', queryText: 'Please upload a valid licence.', rowSource: 'reviewer_added' }] }, REVIEWER);

  // The applicant view: fetched as the owning applicant, whose session now
  // scopes the checklist to their own application.
  const checklist = await getJson(`/applications/${appNo}/checklist`, APPLICANT);
  assert.equal(checklist.status, 200);
  const grouped = checklist.body.documentQueries;

  assert.equal(grouped.product_approval.length, 1);
  assert.equal(grouped.mfg_license.length, 1);
  assert.equal(grouped.product_approval[0].rows[0].queryText, 'Please upload the approval certificate.');
  assert.equal(grouped.mfg_license[0].rows[0].queryText, 'Please upload a valid licence.');
  // Reviewer-internal pre-edit text is not exposed to the applicant.
  assert.equal(grouped.product_approval[0].rows[0].aiQueryText, undefined);
});

live_test('legacy application-level queries keep working alongside document queries', async () => {
  const appNo = await seedApplication();
  const legacy = await post(`/applications/${appNo}/review`,
    { status: 'Query Raised', remarks: 'Application-level clarification required.' }, REVIEWER);
  assert.equal(legacy.status, 200);

  await post(`/applications/${appNo}/document/product_approval/query`,
    { submissionId: `sub-${RUN_ID}-mixed`, rows: [{ rowKey: 'r1', queryText: 'Please upload the approval certificate.', rowSource: 'reviewer_added' }] }, REVIEWER);

  const history = await getJson(`/applications/${appNo}/query-history`, REVIEWER);
  const sources = history.body.queries.map(q => q.source);
  assert.ok(sources.includes('application'), 'the application-level query is untouched');
  assert.ok(sources.includes('document'));

  const applicationQuery = history.body.queries.find(q => q.source === 'application');
  assert.equal(applicationQuery.remarks, 'Application-level clarification required.');
  assert.equal(applicationQuery.rows, undefined, 'legacy records carry no rows and are rendered from remarks');
});
