const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildReviewSnapshot,
  normalizeReviewRows,
  normalizeApplicantMessage,
  underReviewTransition,
  DEFAULT_APPLICANT_MESSAGE,
  ReviewRowValidationError,
} = require('../services/applicationReviewSnapshot');

/* ============================================================
   Application-level Under Review snapshot

   Scope is the WHOLE application: the snapshot is built from the
   buildApplicationSummary projection of the stored record, so findings from
   every section (compliance, documents, products, shipments, queries) reach
   the same table. Rows are exceptions only — successful checks are reported
   through the metrics instead.
   ============================================================ */

/* A summary shaped exactly like buildApplicationSummary output, carrying one
   finding from each section plus several passing checks. */
const SUMMARY = {
  application: {
    overview: { targetIsOverdue: true, ageDays: 41 },
    destinations: [
      { id: 'c1', country: 'Australia', consignee: 'Ozpharma' },
      { id: 'c2', country: 'Wakanda', consignee: 'Unknown Ltd' },
    ],
  },
  executive: { progress: { available: true, completed: 1, total: 7, percent: 14, text: '1 of 7 applicable requirements have affirmative completion evidence.' } },
  issues: [
    { id: 'requirement-mfg_license', severity: 'high', title: 'Missing: Manufacturing licence', explanation: 'No file has been uploaded against this requirement.', action: 'Request the required document or confirm that it is not applicable.', section: 'docs' },
    { id: 'medicine-p1', severity: 'high', title: 'Prohibited-drug match: Nimulid', explanation: 'Nimesulide', action: 'Review the cited notification before making a decision.', section: 'details' },
    { id: 'approval-p2', severity: 'medium', title: 'Approval reference not found: Zorbaxin', explanation: 'The submitted generic name was not found in the configured approved-drug reference.', action: 'Confirm the name and review supporting approval documents.', section: 'details' },
  ],
  requirements: [
    { id: 'mfg_license', state: 'missing' },
    { id: 'product_approval', state: 'available' },
    { id: 'qa_cert', state: 'available' },
    { id: 'legacy_only', state: 'not_applicable' },
  ],
  documents: [
    { id: 'mfg_license', typeLabel: 'Manufacturing licence', name: 'lic.pdf', state: 'verified' },
    { id: 'product_approval', typeLabel: 'Product approval certificate', name: 'noc.pdf', state: 'needs_review', explanation: 'The document is a declaration, not a Product Approval Certificate.' },
    { id: 'qa_cert', typeLabel: 'Quality assurance certificate', name: 'qa.pdf', state: 'pending', explanation: '' },
  ],
};

const APP = {
  applicationNumber: 'EXP-2026-627966',
  status: 'Submitted',
  shipments: [
    { lineStatus: 'Approved' },
    { lineStatus: 'Pending' },
  ],
};

const QUERIES = [
  { queryIdentifier: 'AIQ-1', status: 'Open' },
  { queryIdentifier: 'AIQ-2', status: 'Responded' },
];

const snapshot = () => buildReviewSnapshot({ summary: SUMMARY, app: APP, queries: QUERIES });

/* ── Metrics ─────────────────────────────────────────────────────────────── */

test('metrics summarise the whole application, including the passing checks', () => {
  const { metrics } = snapshot();
  // 2 of 3 applicable requirements; the not_applicable one is excluded.
  assert.equal(metrics.compliancePercent, 67);
  assert.equal(metrics.complianceComplete, 2);
  assert.equal(metrics.complianceTotal, 3);
  assert.equal(metrics.documentsUploaded, 3);
  assert.equal(metrics.aiVerified, 1);
  assert.equal(metrics.aiFlagged, 1);
  assert.equal(metrics.shipments, 2);
  assert.equal(metrics.openQueries, 1);
  assert.equal(metrics.totalQueries, 2);
});

/* ── Row generation ──────────────────────────────────────────────────────── */

test('findings from every application section reach the table', () => {
  const { rows } = snapshot();
  const areas = new Set(rows.map(r => r.area));
  assert.ok(areas.has('Application'), 'the overdue review target is reported');
  assert.ok(areas.has('Compliance'), 'a missing requirement is reported');
  assert.ok(areas.has('Product'), 'a prohibited-drug match is reported');
  assert.ok(areas.has('Document'), 'a flagged upload is reported');
  assert.ok(areas.has('Shipment'), 'unverified shipment lines are reported');
  assert.ok(areas.has('Query'), 'an unanswered query is reported');
});

test('rows are evidence-based and carry the stored explanation verbatim', () => {
  const { rows } = snapshot();
  const flagged = rows.find(r => r.entityId === 'product_approval');
  assert.equal(flagged.area, 'Document');
  assert.equal(flagged.aiObservation, 'The document is a declaration, not a Product Approval Certificate.');
  assert.ok(flagged.note.length > 0);

  const banned = rows.find(r => r.entityId === 'medicine-p1');
  assert.equal(banned.area, 'Product');
  assert.equal(banned.aiObservation, 'Nimesulide');
});

test('successful checks never become rows', () => {
  const { rows } = snapshot();
  // The verified manufacturing licence upload and the two available
  // requirements produce no observation of their own.
  assert.equal(rows.some(r => r.area === 'Document' && r.entityId === 'mfg_license'), false);
  assert.equal(rows.some(r => /verified/i.test(r.aiObservation)), false);
  assert.equal(rows.some(r => r.entityId === 'qa_cert' && r.area === 'Compliance'), false);
});

test('a clean application produces no rows at all', () => {
  const { rows, metrics } = buildReviewSnapshot({
    summary: {
      application: { overview: { targetIsOverdue: false }, destinations: [{ id: 'c1', country: 'Australia' }] },
      issues: [],
      requirements: [{ id: 'a', state: 'available' }],
      documents: [{ id: 'a', typeLabel: 'Manufacturing licence', name: 'a.pdf', state: 'verified' }],
    },
    app: { status: 'Submitted', shipments: [{ lineStatus: 'Approved' }] },
    queries: [],
  });
  assert.deepEqual(rows, []);
  assert.equal(metrics.compliancePercent, 100);
  assert.equal(metrics.aiFlagged, 0);
});

test('an unrecognised destination country is reported, a valid one is not', () => {
  const { rows } = snapshot();
  const destinations = rows.filter(r => r.entityId.startsWith('destination-'));
  assert.equal(destinations.length, 1);
  assert.match(destinations[0].item, /Wakanda/);
});

test('overlapping findings are combined', () => {
  const { rows } = buildReviewSnapshot({
    summary: {
      application: { overview: {}, destinations: [] },
      issues: [
        { id: 'requirement-a', severity: 'medium', title: 'Missing: Licence', explanation: 'No file has been uploaded.', action: 'Request it.' },
        { id: 'requirement-b', severity: 'high', title: 'Missing: Licence', explanation: 'No file has been uploaded.', action: 'Request it.' },
      ],
      requirements: [], documents: [],
    },
    app: { status: 'Submitted', shipments: [] },
    queries: [],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].severity, 'high', 'the more severe of the merged pair wins');
});

test('rows are ordered most severe first and numbered contiguously', () => {
  const { rows } = snapshot();
  const ranks = rows.map(r => ({ high: 0, medium: 1, low: 2 }[r.severity]));
  assert.deepEqual([...ranks].sort((a, b) => a - b), ranks);
  assert.deepEqual(rows.map(r => r.order), rows.map((_, i) => i + 1));
  assert.ok(rows.every(r => r.rowSource === 'ai_generated' && r.edited === false));
  assert.ok(rows.every(r => r.aiNote === r.note), 'generated note starts equal to the original');
});

test('a missing or malformed summary never invents findings', () => {
  assert.deepEqual(buildReviewSnapshot({ summary: null, app: null, queries: [] }).rows, []);
  assert.deepEqual(buildReviewSnapshot({ summary: {}, app: {}, queries: [] }).rows, []);
});

/* ── Status transitions ──────────────────────────────────────────────────── */

test('Under Review is reachable from the statuses the reviewer page offers it for', () => {
  // Partially Approved included: the reviewer page already offers the button
  // there, so it is an existing authorised path back into review.
  for (const status of ['Submitted', 'Query Raised', 'Partially Approved']) {
    const t = underReviewTransition(status);
    assert.equal(t.allowed, true, `${status} should allow Under Review`);
    assert.equal(t.alreadyUnderReview, false);
  }
});

test('statuses that are already canonically in review record no second transition', () => {
  // 'Document Verification' and 'Compliance Check' both canonicalise to
  // IN_REVIEW, so re-marking them would be the same transition twice.
  for (const status of ['Under Review', 'Document Verification', 'Compliance Check']) {
    const t = underReviewTransition(status);
    assert.equal(t.allowed, true);
    assert.equal(t.alreadyUnderReview, true, `${status} is already in review`);
  }
});

test('approved, rejected and draft applications cannot be moved to Under Review', () => {
  for (const status of ['Approved', 'Rejected', 'Draft']) {
    const t = underReviewTransition(status);
    assert.equal(t.allowed, false, `${status} must be refused`);
    assert.ok(t.reason.length > 0);
  }
});

/* ── Submitted rows ──────────────────────────────────────────────────────── */

const aiRow = (over = {}) => ({
  rowKey: 'r1', area: 'Document', item: 'Product approval certificate',
  entityId: 'product_approval', severity: 'high',
  aiObservation: 'The document is a declaration.',
  aiNote: 'Open and inspect the upload.', note: 'Open and inspect the upload.',
  rowSource: 'ai_generated', ...over,
});

test('an edited AI row preserves the generated text and is marked edited', () => {
  const [row] = normalizeReviewRows([aiRow({ note: 'Escalated to the senior reviewer.' })]);
  assert.equal(row.rowSource, 'ai_generated');
  assert.equal(row.edited, true);
  assert.equal(row.aiNote, 'Open and inspect the upload.');
  assert.equal(row.note, 'Escalated to the senior reviewer.');
});

test('an untouched AI row is not marked edited', () => {
  assert.equal(normalizeReviewRows([aiRow()])[0].edited, false);
});

test('a reviewer-added row keeps its own source and is never edited', () => {
  const [row] = normalizeReviewRows([
    { rowKey: 'm1', area: 'Application', item: 'Site inspection', note: 'Schedule a site visit.', rowSource: 'reviewer_added' },
  ]);
  assert.equal(row.rowSource, 'reviewer_added');
  assert.equal(row.edited, false);
  assert.equal(row.aiNote, '');
});

test('a row kept without a note is refused against that row', () => {
  assert.throws(
    () => normalizeReviewRows([aiRow(), aiRow({ rowKey: 'r2', note: '   ' })]),
    err => {
      assert.ok(err instanceof ReviewRowValidationError);
      assert.deepEqual(Object.keys(err.rowErrors), ['r2']);
      return true;
    }
  );
});

test('blank manual rows are dropped, and an empty table is valid', () => {
  const rows = normalizeReviewRows([
    { rowKey: 'm1', note: '  ', item: '', aiObservation: '', rowSource: 'reviewer_added' },
  ]);
  assert.deepEqual(rows, [], 'a clean application may be marked Under Review with no observations');
});

test('an unknown review area falls back rather than being stored raw', () => {
  const [row] = normalizeReviewRows([aiRow({ area: 'Nonsense' })]);
  assert.equal(row.area, 'Application');
});

test('reviewer text is sanitised and trimmed', () => {
  const [row] = normalizeReviewRows([aiRow({ note: '  Escalate\tto   the senior reviewer.  ' })]);
  assert.equal(row.note, 'Escalate to the senior reviewer.');
});

/* ── Applicant-facing message ────────────────────────────────────────────── */

test('the applicant message defaults to the neutral wording', () => {
  assert.equal(normalizeApplicantMessage(''), DEFAULT_APPLICANT_MESSAGE);
  assert.equal(normalizeApplicantMessage('   '), DEFAULT_APPLICANT_MESSAGE);
  assert.match(DEFAULT_APPLICANT_MESSAGE, /taken up for review/i);
  // The default exposes no internal finding.
  assert.doesNotMatch(DEFAULT_APPLICANT_MESSAGE, /flag|risk|observation|deficien/i);
});

test('the applicant message is reviewer-editable and sanitised', () => {
  assert.equal(
    normalizeApplicantMessage('  Your application is under examination.  '),
    'Your application is under examination.'
  );
});
