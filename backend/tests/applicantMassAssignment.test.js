/* ============================================================================
   DEF-01 — applicant mass assignment, proven at the database level.

   The unit tests in tests/applicantInput.test.js prove the sanitiser drops
   protected fields. This suite proves the real routes actually use it: every
   assertion reads the RAW MongoDB document, because the defect was about what
   gets persisted, not about what the API echoes back.

   Covers all four write paths into an application:
     1. draft creation          POST /applications/draft   (no existing draft)
     2. draft update            POST /applications/draft   (existing draft)
     3. new submission          POST /applications/submit  (no existing draft)
     4. submission of a draft   POST /applications/submit  (existing draft)

   Skips cleanly when the API, database or seeded accounts are absent, matching
   the other database-backed suites:

     TEST_API_URL=http://localhost:5101/api \
     TEST_MONGO_URL=mongodb://localhost:27017/drug_ministry_test \
     TEST_APPLICANT_A='user:pass' TEST_APPLICANT_B='user:pass' \
     TEST_REVIEWER='user:pass' \
     node --test tests/applicantMassAssignment.test.js
   ============================================================================ */

'use strict';

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
const EMAIL_PREFIX = `def01+${RUN_ID}`;
const created = [];
let mongoose = null;
let applications = null;
let live = false;
let liveError = null;
let sessionA = null;
let sessionB = null;
let sessionR = null;

async function signIn(who) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(who),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`login failed for ${who.username}: HTTP ${res.status}`);
  const cookie = (res.headers.getSetCookie?.() || []).map(entry => entry.split(';')[0]).join('; ');
  return { cookie, csrf: body.csrfToken, user: body.user };
}

async function call(method, path, { session, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { cookie: session.cookie, 'x-csrf-token': session.csrf } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const post = (path, body, options) => call('POST', path, { ...options, body });
const get = (path, options) => call('GET', path, options);

/** The raw persisted document — never the API's view of it. */
const raw = appNo => applications.findOne({ applicationNumber: appNo });

/** Remove every draft owned by a principal so draft-vs-no-draft is deterministic. */
async function clearDrafts(session) {
  await applications.deleteMany({ ownerId: session.user.id, isDraft: true });
}

function track(appNo) {
  if (appNo) created.push(appNo);
  return appNo;
}

/* ── Payloads ──────────────────────────────────────────────────────────── */

const LEGITIMATE_SCALARS = {
  applicationType: 'Export NOC',
  exportPurpose: 'Commercial export',
  exportCategory: 'Allopathic Drugs',
  destinationCountry: 'Germany',
  applicationDate: '2026-09-02',
  applicantOrganization: 'DEF01 Exports Pvt Ltd',
  contactNumber: '9812345670',
  consigneeName: 'Consignee GmbH',
  consigneeOrg: 'Consignee Org',
  addressLine1: '1 Test Street',
  addressLine2: 'Suite 2',
  city: 'Berlin',
  state: 'Berlin',
  consigneeCountry: 'Germany',
  postalCode: '10115',
  contactPerson: 'K Tester',
  consigneePhone: '4930000',
  consigneeEmail: 'consignee@example.com',
  manufacturerName: 'DEF01 Manufacturer',
  mfgLicenseNo: 'MFG/25/2026/0001',
  factoryAddress: 'Plot 42 Industrial Area',
  manufacturingSite: 'Pune',
  mfgContactPerson: 'M Tester',
  mfgContactNumber: '9812345671',
  mfgEmail: 'mfg@example.com',
  signatoryName: 'S Tester',
  signatoryDesignation: 'QA Head',
};

function legitimate(tag) {
  return {
    ...LEGITIMATE_SCALARS,
    applicantName: `DEF01 ${tag} ${RUN_ID}`,
    email: `${EMAIL_PREFIX}-${tag}@example.com`,
    products: [{
      productRef: 'p-1', productName: 'Paracetamol Tablets IP 500mg', genericName: 'Paracetamol',
      brandName: 'TestPara', dosageForm: 'Tablet', strength: '500 mg', packSize: '10x10',
      batchNumber: 'TB-1', mfgDate: '2026-02-01', expiryDate: '2029-01-31',
    }],
    companies: [{ companyRef: 'co-1', name: 'DEF01 Manufacturer', licenseNo: 'MFG/25/2026/0001' }],
    consignees: [{ consigneeRef: 'cn-1', name: 'Consignee GmbH', country: 'Germany', city: 'Berlin' }],
    shipments: [{
      shipmentRef: 'sh-1', companyRef: 'co-1', productRef: 'p-1', consigneeRef: 'cn-1',
      quantity: 10000, packSize: '10x10', batchNumbers: ['TB-1'],
    }],
    declarations: {
      productInfoAccurate: true, documentsGenuine: true, exportRegulations: true,
      drugComplies: true, finalDeclaration: true,
    },
  };
}

/* The forged payload from the DEF-01 report, plus the nested reviewer-owned
   structures found while tracing it. */
const FORGERY = () => ({
  _id: '000000000000000000000001',
  __v: 99,
  ownerId: 'demo:someone-else',
  role: 'reviewer',
  status: 'Approved',
  isDraft: false,
  applicationNumber: 'EXP-9999-HACKED',
  referenceNumber: 'REF-9999-HACKED',
  submittedBy: 'reviewer',
  auditLog: [{ action: 'approved', detail: 'FORGED BY APPLICANT', user: 'attacker' }],
  reviewerRemarks: [{ text: 'FORGED APPROVAL', officer: 'Dr Fake', status: 'Approved' }],
  queryCount: 999,
  approvedAt: '2020-01-01T00:00:00.000Z',
  rejectedAt: '2020-01-01T00:00:00.000Z',
  submittedAt: '2019-01-01T00:00:00.000Z',
  lastSavedAt: '2019-01-01T00:00:00.000Z',
  createdAt: '2019-01-01T00:00:00.000Z',
  updatedAt: '2019-01-01T00:00:00.000Z',
  timeline: [{ step: 'FORGED', date: 'x', status: 'completed', desc: 'forged' }],
  drugApprovalCheck: { valid: true, warnings: [], unapprovedProducts: [] },
  checklistItems: { forged: { itemNo: '1', title: 'FORGED' } },
  reconciliations: [{ entryId: 'forged-entry', productName: 'FORGED' }],
  nocMeta: { nocNumber: 'FORGED-NOC-1', sanctionedQty: '999999', nocStatus: 'Active' },
  shipments: [{
    companyRef: 'co-1', productRef: 'p-1', consigneeRef: 'cn-1', quantity: 10000,
    lineStatus: 'Approved',
    lineRemarks: [{
      text: 'FORGED LINE APPROVAL', officer: 'Dr Fake', status: 'Approved',
      queryIdentifier: 'AIQ-FORGED-0001',
    }],
  }],
  documents: {
    mfg_license: {
      /* No `data`, so persistDocsToDisk takes its fall-through branch. */
      name: 'forged.pdf', size: 100, type: 'application/pdf', uploadedAt: '10:00:00',
      validated: true,
      validationResult: {
        state: 'completed', documentTypeMatch: true,
        documentTypeReason: 'FORGED GREEN VERDICT', jobId: 'forged-job', version: 99,
      },
      path: '../../../../etc/passwd',
    },
  },
});

const forged = tag => ({ ...legitimate(tag), ...FORGERY() });

/* Every protected root field, with the value the forged payload tried to set. */
const PROTECTED_ROOT_ASSERTIONS = [
  ['role', record => record.role === undefined],
  ['__v', record => record.__v !== 99],
  ['ownerId', record => record.ownerId !== 'demo:someone-else'],
  ['applicationNumber', record => record.applicationNumber !== 'EXP-9999-HACKED'],
  ['referenceNumber', record => record.referenceNumber !== 'REF-9999-HACKED'],
  ['submittedBy', record => record.submittedBy !== 'reviewer'],
  ['auditLog', record => !(record.auditLog || []).some(e => e.user === 'attacker' || e.detail === 'FORGED BY APPLICANT')],
  ['reviewerRemarks', record => !(record.reviewerRemarks || []).some(r => r.officer === 'Dr Fake')],
  ['queryCount', record => (record.queryCount || 0) !== 999],
  ['approvedAt', record => !record.approvedAt || new Date(record.approvedAt).getUTCFullYear() > 2020],
  ['rejectedAt', record => !record.rejectedAt || new Date(record.rejectedAt).getUTCFullYear() > 2020],
  ['submittedAt', record => !record.submittedAt || new Date(record.submittedAt).getUTCFullYear() > 2019],
  ['lastSavedAt', record => !record.lastSavedAt || new Date(record.lastSavedAt).getUTCFullYear() > 2019],
  ['createdAt', record => !record.createdAt || new Date(record.createdAt).getUTCFullYear() > 2019],
  ['updatedAt', record => !record.updatedAt || new Date(record.updatedAt).getUTCFullYear() > 2019],
  ['timeline', record => !(record.timeline || []).some(t => t.step === 'FORGED')],
  ['drugApprovalCheck', record => !record.drugApprovalCheck || Array.isArray(record.drugApprovalCheck.unapprovedProducts)],
  ['checklistItems', record => !Object.keys(record.checklistItems || {}).includes('forged')],
  ['reconciliations', record => !(record.reconciliations || []).some(r => r.entryId === 'forged-entry')],
  ['nocMeta', record => !record.nocMeta || record.nocMeta.nocNumber !== 'FORGED-NOC-1'],
];

function assertProtectedRootFields(record, where) {
  assert.ok(record, `${where}: no record was persisted`);
  assert.notEqual(String(record._id), '000000000000000000000001', `${where}: client-supplied _id was honoured`);
  for (const [field, ok] of PROTECTED_ROOT_ASSERTIONS) {
    assert.ok(ok(record), `${where}: protected field "${field}" was forged`);
  }
}

function assertProtectedNestedFields(record, where) {
  for (const shipment of record.shipments || []) {
    assert.notEqual(shipment.lineStatus, 'Approved', `${where}: shipment lineStatus was forged`);
    assert.equal((shipment.lineRemarks || []).length, 0, `${where}: shipment lineRemarks were forged`);
  }
  for (const [docId, doc] of Object.entries(record.documents || {})) {
    assert.notEqual(doc.validated, true, `${where}: document "${docId}" validated flag was forged`);
    const verdict = doc.validationResult;
    assert.ok(
      verdict == null || verdict.documentTypeReason !== 'FORGED GREEN VERDICT',
      `${where}: document "${docId}" AI verdict was forged`,
    );
    assert.notEqual(doc.path, '../../../../etc/passwd', `${where}: document "${docId}" path was forged`);
  }
  const blob = JSON.stringify(record);
  for (const marker of ['FORGED', 'Dr Fake', 'attacker', 'HACKED', 'AIQ-FORGED']) {
    assert.equal(blob.includes(marker), false, `${where}: forged marker "${marker}" reached the database`);
  }
}

/* ── Lifecycle ─────────────────────────────────────────────────────────── */

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
    if (healthBody.database !== name) { liveError = `API is not attached to ${name}`; return; }

    mongoose = require('mongoose');
    await mongoose.connect(MONGO, { serverSelectionTimeoutMS: 2500 });
    applications = mongoose.connection.db.collection('applications');

    sessionA = await signIn(APPLICANT_A);
    sessionB = await signIn(APPLICANT_B);
    sessionR = await signIn(REVIEWER);
    /* Draft-vs-no-draft decides which route branch runs, so start from a known
       state. Only this suite's test principals are touched. */
    await clearDrafts(sessionA);
    await clearDrafts(sessionB);
    live = true;
  } catch (err) { live = false; liveError = err.message; }
});

test.after(async () => {
  if (!live) return;
  await applications.deleteMany({
    $or: [
      { applicationNumber: { $in: created } },
      { email: new RegExp(`^${EMAIL_PREFIX.replace('+', '\\+')}`) },
      { applicantName: new RegExp(`DEF01 .* ${RUN_ID}$`) },
    ],
  });
  await mongoose.disconnect();
});

const live_test = (name, fn) => test(name, async t => {
  if (!live) return t.skip(liveError || 'API, database or seeded accounts unavailable');
  return fn(t);
});

/* ── 1. Draft creation (no existing draft) ─────────────────────────────── */

live_test('DEF-01 draft creation ignores every forged root field', async () => {
  await clearDrafts(sessionA);
  const res = await post('/applications/draft', { formData: forged('draft-create') }, { session: sessionA });
  assert.equal(res.status, 200, `draft create HTTP ${res.status}`);
  const record = await raw(track(res.body.applicationNumber));

  assertProtectedRootFields(record, 'draft creation');
  assertProtectedNestedFields(record, 'draft creation');
  assert.equal(record.ownerId, sessionA.user.id, 'ownerId must be the authenticated principal');
  assert.equal(record.status, 'Draft');
  assert.equal(record.isDraft, true);
  assert.match(record.applicationNumber, /^EXP-\d{4}-\d{6}$/);
  assert.ok((record.auditLog || []).some(e => e.action === 'draft_created'),
    'the genuine draft_created audit entry is missing');
});

/* ── 2. Draft update (existing draft) ──────────────────────────────────── */

live_test('DEF-01 draft update cannot overwrite protected fields on an existing draft', async () => {
  await clearDrafts(sessionA);
  const first = await post('/applications/draft', { formData: legitimate('draft-update') }, { session: sessionA });
  assert.equal(first.status, 200);
  const appNo = track(first.body.applicationNumber);

  const second = await post('/applications/draft', {
    formData: { ...forged('draft-update'), email: `${EMAIL_PREFIX}-draft-update@example.com`, applicantOrganization: 'UPDATED ORG' },
  }, { session: sessionA });
  assert.equal(second.status, 200, `draft update HTTP ${second.status}`);
  assert.equal(second.body.applicationNumber, appNo, 'the update must reuse the same draft record');

  const record = await raw(appNo);
  assertProtectedRootFields(record, 'draft update');
  assertProtectedNestedFields(record, 'draft update');
  assert.equal(record.ownerId, sessionA.user.id, 'ownerId must not be reassignable');
  assert.equal(record.status, 'Draft');
  assert.equal(record.isDraft, true);
  assert.equal(record.applicantOrganization, 'UPDATED ORG', 'the legitimate edit must still be saved');
});

/* ── 3. New submission (no existing draft) ─────────────────────────────── */

live_test('DEF-01 new submission ignores every forged root and nested field', async () => {
  await clearDrafts(sessionA);
  const res = await post('/applications/submit', { formData: forged('submit-new') }, { session: sessionA });
  assert.equal(res.status, 200, `submit HTTP ${res.status}`);
  const appNo = track(res.body.applicationNumber);
  const record = await raw(appNo);

  assertProtectedRootFields(record, 'new submission');
  assertProtectedNestedFields(record, 'new submission');
  assert.equal(record.ownerId, sessionA.user.id);
  assert.equal(record.status, 'Submitted', 'status must be server-controlled');
  assert.equal(record.isDraft, false);
  assert.equal(record.submittedBy, APPLICANT_A.username);
  assert.ok((record.auditLog || []).some(e => e.action === 'submitted' && e.user === APPLICANT_A.username),
    'the genuine submission audit entry is missing');
  assert.equal((record.auditLog || []).length, 1,
    'a forged audit trail must not survive alongside the genuine entry');
  assert.deepEqual(record.timeline.map(step => step.step), [
    'Application Submitted', 'Under Review', 'Document Verification', 'Compliance Check', 'NOC Decision',
  ], 'the server timeline must replace any client-supplied timeline');
});

/* ── 4. Submission of an existing draft ────────────────────────────────── */

live_test('DEF-01 submitting an existing draft ignores every forged field', async () => {
  await clearDrafts(sessionA);
  const draft = await post('/applications/draft', { formData: legitimate('submit-draft') }, { session: sessionA });
  assert.equal(draft.status, 200);
  const appNo = track(draft.body.applicationNumber);

  const res = await post('/applications/submit', {
    formData: { ...forged('submit-draft'), email: `${EMAIL_PREFIX}-submit-draft@example.com` },
  }, { session: sessionA });
  assert.equal(res.status, 200, `submit HTTP ${res.status}`);
  assert.equal(res.body.applicationNumber, appNo, 'the submission must convert the existing draft');

  const record = await raw(appNo);
  assertProtectedRootFields(record, 'submission of an existing draft');
  assertProtectedNestedFields(record, 'submission of an existing draft');
  assert.equal(record.status, 'Submitted');
  assert.equal(record.isDraft, false);
  assert.equal(record.ownerId, sessionA.user.id);
  const actions = (record.auditLog || []).map(entry => entry.action);
  assert.deepEqual(actions, ['draft_created', 'submitted'],
    'the audit trail must contain exactly the two genuine server entries');
});

/* ── GET /:id/full carries no forged reviewer information ──────────────── */

live_test('DEF-01 GET /:id/full exposes no forged reviewer history', async () => {
  await clearDrafts(sessionA);
  const res = await post('/applications/submit', { formData: forged('full-view') }, { session: sessionA });
  assert.equal(res.status, 200);
  const appNo = track(res.body.applicationNumber);

  const full = await get(`/applications/${appNo}/full`, { session: sessionR });
  assert.equal(full.status, 200, `GET /full HTTP ${full.status}`);
  const blob = JSON.stringify(full.body);
  for (const marker of ['FORGED', 'Dr Fake', 'attacker', 'HACKED', 'AIQ-FORGED', 'FORGED-NOC-1']) {
    assert.equal(blob.includes(marker), false, `GET /full leaked forged marker "${marker}"`);
  }
  assert.equal(full.body.application.queryCount || 0, 0, 'GET /full reported a forged query count');
  assert.equal((full.body.application.reviewerRemarks || []).length, 0,
    'GET /full reported forged reviewer remarks');
});

/* ── Legitimate applicant workflow still works ─────────────────────────── */

live_test('DEF-01 legitimate applicant fields survive draft, resume and submit', async () => {
  await clearDrafts(sessionA);
  const form = legitimate('roundtrip');

  const draft = await post('/applications/draft', { formData: form }, { session: sessionA });
  assert.equal(draft.status, 200);
  const appNo = track(draft.body.applicationNumber);

  const resumed = await get(`/applications/${appNo}`, { session: sessionA });
  assert.equal(resumed.status, 200, 'the applicant must be able to resume their own draft');
  for (const [key, value] of Object.entries(LEGITIMATE_SCALARS)) {
    assert.equal(resumed.body.application[key], value, `field "${key}" did not survive resume`);
  }

  const submitted = await post('/applications/submit', { formData: form }, { session: sessionA });
  assert.equal(submitted.status, 200);
  assert.equal(submitted.body.applicationNumber, appNo);

  const record = await raw(appNo);
  for (const [key, value] of Object.entries(LEGITIMATE_SCALARS)) {
    assert.equal(record[key], value, `field "${key}" did not survive submission`);
  }
  assert.equal(record.products.length, 1);
  assert.equal(record.products[0].genericName, 'Paracetamol');
  assert.equal(record.products[0].strength, '500 mg');
  assert.equal(record.companies.length, 1);
  assert.equal(record.companies[0].licenseNo, 'MFG/25/2026/0001');
  assert.equal(record.consignees.length, 1);
  assert.equal(record.consignees[0].country, 'Germany');
  assert.equal(record.shipments.length, 1);
  assert.equal(record.shipments[0].quantity, 10000);
  assert.deepEqual(record.shipments[0].batchNumbers, ['TB-1']);
  for (const key of ['productInfoAccurate', 'documentsGenuine', 'exportRegulations', 'drugComplies', 'finalDeclaration']) {
    assert.equal(record.declarations[key], true, `declaration "${key}" did not survive`);
  }
});

live_test('DEF-01 a document uploaded through the base64 path still persists', async () => {
  await clearDrafts(sessionA);
  const data = Buffer.from('%PDF-1.4 def01 upload test').toString('base64');
  const res = await post('/applications/submit', {
    formData: {
      ...legitimate('upload'),
      documents: {
        mfg_license: { name: 'licence.pdf', size: 26, type: 'application/pdf', uploadedAt: '10:00 AM', data },
      },
    },
  }, { session: sessionA });
  assert.equal(res.status, 200);
  const appNo = track(res.body.applicationNumber);

  const record = await raw(appNo);
  const doc = record.documents.mfg_license;
  assert.ok(doc, 'the uploaded document was not persisted');
  assert.equal(doc.name, 'licence.pdf');
  assert.equal(doc.type, 'application/pdf');
  assert.equal(doc.path, `${appNo}/mfg_license.pdf`, 'the stored path must be server-generated');
  assert.equal(doc.validated, false, 'a fresh upload must start unverified');
  assert.equal(doc.validationResult, null, 'a fresh upload must carry no verdict');

  const download = await fetch(`${API}/applications/${appNo}/document/mfg_license`, {
    headers: { cookie: sessionA.cookie },
  });
  assert.equal(download.status, 200, 'the owner must still be able to download the document');
});

/* ── Verification results remain writable by the server, not the applicant ── */

live_test('DEF-01 verification results are server-writable but applicant-proof', async () => {
  await clearDrafts(sessionA);
  const data = Buffer.from('%PDF-1.4 def01 verdict test').toString('base64');
  const res = await post('/applications/submit', {
    formData: {
      ...legitimate('verdict'),
      documents: {
        mfg_license: { name: 'licence.pdf', size: 27, type: 'application/pdf', uploadedAt: '10:00 AM', data },
      },
    },
  }, { session: sessionA });
  assert.equal(res.status, 200);
  const appNo = track(res.body.applicationNumber);

  /* The authorized server-side verification workflow owns this field. */
  const serverVerdict = {
    state: 'completed', retryable: false, operation: 'quick', jobId: 'server-job-1',
    version: 1, documentTypeMatch: true, documentTypeReason: 'Server-written verdict',
  };
  await applications.updateOne(
    { applicationNumber: appNo },
    { $set: { 'documents.mfg_license.validationResult': serverVerdict, 'documents.mfg_license.validated': true } },
  );
  const afterServerWrite = await raw(appNo);
  assert.equal(afterServerWrite.documents.mfg_license.validated, true,
    'the server workflow must still be able to write a verification result');
  assert.equal(afterServerWrite.documents.mfg_license.validationResult.documentTypeReason,
    'Server-written verdict');

  /* The applicant cannot overwrite that verdict with a forged one. */
  await clearDrafts(sessionA);
  const attack = await post('/applications/draft', {
    formData: {
      ...legitimate('verdict-attack'),
      documents: {
        mfg_license: {
          name: 'licence.pdf', size: 27, type: 'application/pdf', uploadedAt: '10:00 AM',
          validated: true,
          validationResult: { state: 'completed', documentTypeMatch: true, documentTypeReason: 'FORGED GREEN VERDICT' },
        },
      },
    },
  }, { session: sessionA });
  assert.equal(attack.status, 200);
  const attacked = await raw(track(attack.body.applicationNumber));
  const attackedDoc = attacked.documents.mfg_license;
  assert.notEqual(attackedDoc.validated, true, 'an applicant forged a verified flag');
  assert.ok(
    attackedDoc.validationResult == null
      || attackedDoc.validationResult.documentTypeReason !== 'FORGED GREEN VERDICT',
    'an applicant forged an AI verdict',
  );

  /* The reviewer-only verification route stays reviewer-only. */
  const applicantVerify = await post(`/applications/${appNo}/document/mfg_license/verify`, {}, { session: sessionA });
  assert.equal(applicantVerify.status, 403, 'an applicant must not reach the verification route');
});

/* ── Cross-tenant isolation ────────────────────────────────────────────── */

live_test('DEF-01 applicant B cannot affect or reach applicant A data', async () => {
  await clearDrafts(sessionA);
  const a = await post('/applications/submit', { formData: legitimate('tenant-a') }, { session: sessionA });
  assert.equal(a.status, 200);
  const appNo = track(a.body.applicationNumber);

  assert.equal((await get(`/applications/${appNo}`, { session: sessionB })).status, 404);
  assert.equal((await get(`/applications/${appNo}/checklist`, { session: sessionB })).status, 404);
  assert.equal((await get(`/applications/${appNo}/document/mfg_license`, { session: sessionB })).status, 404);

  const search = await get(`/applications/search?appNo=${appNo}`, { session: sessionB });
  assert.equal(search.body.count, 0, 'applicant B search reached applicant A data');

  const list = await get('/applications', { session: sessionB });
  assert.equal((list.body.applications || []).some(x => x.applicationNumber === appNo), false,
    'applicant B list included applicant A data');

  /* B forging A's ownerId must not move or alter A's record. */
  await clearDrafts(sessionB);
  const spoof = await post('/applications/draft', {
    formData: { ...legitimate('tenant-b'), ownerId: sessionA.user.id, applicationNumber: appNo },
  }, { session: sessionB });
  assert.equal(spoof.status, 200);
  track(spoof.body.applicationNumber);
  assert.notEqual(spoof.body.applicationNumber, appNo, "applicant B claimed applicant A's application number");

  const spoofed = await raw(spoof.body.applicationNumber);
  assert.equal(spoofed.ownerId, sessionB.user.id, 'ownerId was forged across tenants');

  const untouched = await raw(appNo);
  assert.equal(untouched.ownerId, sessionA.user.id, "applicant A's record was modified");
  assert.equal(untouched.status, 'Submitted');
});

/* ── Reviewer workflow regression ──────────────────────────────────────── */

live_test('DEF-01 reviewer Query, Under Review, Approve and Reject still work', async () => {
  await clearDrafts(sessionA);
  const target = await post('/applications/submit', { formData: legitimate('reviewer-flow') }, { session: sessionA });
  assert.equal(target.status, 200);
  const appNo = track(target.body.applicationNumber);

  const query = await post(`/applications/${appNo}/review`,
    { status: 'Query Raised', remarks: `DEF01 reviewer query ${RUN_ID}` }, { session: sessionR });
  assert.equal(query.status, 200, `Query Raised HTTP ${query.status}`);
  assert.equal(query.body.status, 'Query Raised');

  const afterQuery = await raw(appNo);
  assert.equal(afterQuery.queryCount, 1, 'the genuine reviewer query did not increment queryCount');
  assert.ok((afterQuery.reviewerRemarks || []).some(r => r.status === 'Query Raised' && r.officer),
    'the genuine reviewer remark was not written');

  const underReview = await post(`/applications/${appNo}/under-review`, {
    submissionId: `def01-${RUN_ID}`,
    rows: [{ rowKey: 'r1', area: 'Documents', note: 'DEF01 reviewer observation', rowSource: 'reviewer_added' }],
    applicantMessage: 'DEF01 applicant-facing message',
  }, { session: sessionR });
  assert.equal(underReview.status, 200, `Under Review HTTP ${underReview.status}`);
  assert.equal((await raw(appNo)).status, 'Under Review');

  const approved = await post(`/applications/${appNo}/review`,
    { status: 'Approved', remarks: `DEF01 approval ${RUN_ID}` }, { session: sessionR });
  assert.equal(approved.status, 200, `Approve HTTP ${approved.status}`);
  const afterApprove = await raw(appNo);
  assert.equal(afterApprove.status, 'Approved');
  assert.ok(afterApprove.approvedAt, 'approvedAt must be set by the reviewer route');

  await clearDrafts(sessionA);
  const other = await post('/applications/submit', { formData: legitimate('reviewer-reject') }, { session: sessionA });
  const rejectNo = track(other.body.applicationNumber);
  const noRemarks = await post(`/applications/${rejectNo}/review`, { status: 'Rejected' }, { session: sessionR });
  assert.equal(noRemarks.status, 400, 'rejection without remarks must still be refused');

  const rejected = await post(`/applications/${rejectNo}/review`,
    { status: 'Rejected', remarks: `DEF01 rejection ${RUN_ID}` }, { session: sessionR });
  assert.equal(rejected.status, 200, `Reject HTTP ${rejected.status}`);
  const afterReject = await raw(rejectNo);
  assert.equal(afterReject.status, 'Rejected');
  assert.ok(afterReject.rejectedAt, 'rejectedAt must be set by the reviewer route');
});
