const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildDocumentQueryDraft,
  normalizeQueryRows,
  deriveLegacyRemarks,
  verificationStatus,
  sanitizeQueryText,
  QueryRowValidationError,
} = require('../services/documentQueryDraft');

/* ============================================================
   Document-scoped query draft

   Every function here receives exactly one document's verification payload.
   The scoping guarantee is structural: there is no way to pass a second
   document's findings in, and the route resolves the payload from
   documents.<docId>.validationResult.fullResults for the requested docId only.
   ============================================================ */

const WRONG_DOCUMENT = {
  documentTypeMatch: false,
  documentTypeReason: 'The document is a declaration/undertaking for NOC application, not a Product Approval Certificate.',
  expectedDocumentType: 'Product Approval Certificate',
  detectedDocumentType: 'NOC declaration',
  // These ran against the wrong document and must not become separate queries.
  results: [
    { item: 'Approval number is present', present: false, note: 'Not found.' },
    { item: 'Validity date is present', present: false, note: 'Not found.' },
  ],
  summary: { total: 2, present: 0, missing: 2, unknown: 0, score: 0 },
};

const FAILED_CHECKS = {
  documentTypeMatch: true,
  expectedDocumentType: 'Manufacturing License',
  results: [
    { item: 'License number is present', present: true, evidence: 'LICENSE No : 25-KD/323' },
    {
      item: 'Valid date / expiry date is present', present: false,
      failureReason: 'The licence expired on 31/12/2026.',
      expectedValue: 'a current validity date', extractedValue: '31/12/2026',
    },
    {
      item: 'Authorised signatory is present', present: false,
      note: 'No authorised signature block was found.',
      correctiveAction: 'Please upload a copy signed by the authorised signatory.',
    },
    // Unresolved but explained — an AI warning worth clarifying.
    { item: 'Product list matches the application', present: null, note: 'The product list could not be read from the scan.' },
    // Unresolved and unexplained — must NOT become an invented query.
    { item: 'Schedule M compliance', present: null },
  ],
  summary: { total: 5, present: 1, missing: 2, unknown: 2, score: 20 },
};

test('a wrong-document reason generates exactly one decisive query', () => {
  const rows = buildDocumentQueryDraft(WRONG_DOCUMENT, 'Product Approval Certificate');
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { item: rows[0].checklistItem, deficiency: rows[0].deficiency, query: rows[0].queryText },
    {
      item: 'Document type verification',
      deficiency: 'The document is a declaration/undertaking for NOC application, not a Product Approval Certificate.',
      query: 'Please upload a valid Product Approval Certificate for the applied product.',
    }
  );
  assert.equal(rows[0].rowSource, 'ai_generated');
  assert.equal(rows[0].findingRef, 'document-type');
  assert.equal(rows[0].edited, false);
});

test('multiple failed checks generate separate rows, and unexplained checks generate none', () => {
  const rows = buildDocumentQueryDraft(FAILED_CHECKS, 'Manufacturing License');
  const items = rows.map(r => r.checklistItem);

  assert.deepEqual(items, [
    'Valid date / expiry date is present',
    'Authorised signatory is present',
    'Product list matches the application',
  ]);
  // Passing checks never become queries.
  assert.ok(!items.includes('License number is present'));
  // An unresolved check with no stated reason is not a deficiency.
  assert.ok(!items.includes('Schedule M compliance'));

  assert.equal(rows[0].deficiency, 'The licence expired on 31/12/2026.');
  assert.match(rows[0].queryText, /31\/12\/2026/);
  // A supplied corrective action is used verbatim.
  assert.equal(rows[1].queryText, 'Please upload a copy signed by the authorised signatory.');
  assert.deepEqual(rows.map(r => r.order), [1, 2, 3]);
  assert.deepEqual(rows.map(r => r.findingRef), ['check:1', 'check:2', 'check:3']);
});

test('overlapping findings are merged so the applicant is not asked twice', () => {
  const rows = buildDocumentQueryDraft({
    documentTypeMatch: true,
    results: [
      { item: 'Expiry date is present', present: false, note: 'The validity date is missing.' },
      { item: 'expiry  date is present', present: false, note: 'Something else.' },
      { item: 'Validity block', present: false, note: 'The validity date is missing.' },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].order, 1);
});

test('a clean document produces no query rows rather than a false one', () => {
  const rows = buildDocumentQueryDraft({
    documentTypeMatch: true,
    results: [{ item: 'License number is present', present: true, evidence: 'LIC 1' }],
    summary: { total: 1, present: 1, missing: 0, unknown: 0, score: 100 },
  });
  assert.deepEqual(rows, []);
});

test('a missing or malformed payload never invents findings', () => {
  assert.deepEqual(buildDocumentQueryDraft(null), []);
  assert.deepEqual(buildDocumentQueryDraft({}), []);
  assert.deepEqual(buildDocumentQueryDraft({ documentTypeMatch: true, results: 'nope' }), []);
});

test('verification status mirrors the reviewer panel verdict', () => {
  assert.equal(verificationStatus(WRONG_DOCUMENT).label, 'Wrong Document');
  assert.equal(verificationStatus(FAILED_CHECKS).label, 'Rejected by AI');
  assert.equal(verificationStatus(null).label, 'Verification Incomplete');
  assert.equal(verificationStatus({
    documentTypeMatch: true,
    results: [{ item: 'a', present: true }],
    summary: { total: 1, present: 1, missing: 0, unknown: 0 },
  }).label, 'AI Verified');
});

/* ── Reviewer-submitted rows ─────────────────────────────────────────────── */

const aiRow = (over = {}) => ({
  rowKey: 'r1', checklistItem: 'Document type verification',
  deficiency: 'Wrong document.', aiQueryText: 'Please upload a valid certificate.',
  queryText: 'Please upload a valid certificate.', rowSource: 'ai_generated',
  findingRef: 'document-type', ...over,
});

test('an edited AI row keeps its source and is marked as edited', () => {
  const [row] = normalizeQueryRows([aiRow({ queryText: 'Please upload the certificate issued by CDSCO.' })]);
  assert.equal(row.rowSource, 'ai_generated');
  assert.equal(row.edited, true);
  assert.equal(row.aiQueryText, 'Please upload a valid certificate.');
  assert.equal(row.queryText, 'Please upload the certificate issued by CDSCO.');
});

test('an untouched AI row is not marked as edited', () => {
  assert.equal(normalizeQueryRows([aiRow()])[0].edited, false);
});

test('a reviewer-added row keeps its own source and is never "edited"', () => {
  const [row] = normalizeQueryRows([
    { rowKey: 'm1', queryText: 'Please confirm the batch size.', rowSource: 'reviewer_added' },
  ]);
  assert.equal(row.rowSource, 'reviewer_added');
  assert.equal(row.edited, false);
  assert.equal(row.aiQueryText, '');
});

test('whitespace-only queries are rejected against the offending row', () => {
  assert.throws(
    () => normalizeQueryRows([aiRow(), aiRow({ rowKey: 'r2', queryText: '   \t  ' })]),
    err => {
      assert.ok(err instanceof QueryRowValidationError);
      assert.deepEqual(Object.keys(err.rowErrors), ['r2']);
      return true;
    }
  );
});

test('completely blank manual rows are dropped, not rejected', () => {
  const rows = normalizeQueryRows([
    aiRow(),
    { rowKey: 'm1', queryText: '  ', checklistItem: '', deficiency: '', rowSource: 'reviewer_added' },
  ]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows.map(r => r.order), [1]);
});

test('a partly filled manual row still requires its corrective action', () => {
  assert.throws(
    () => normalizeQueryRows([{ rowKey: 'm1', checklistItem: 'Batch size', queryText: '', rowSource: 'reviewer_added' }]),
    err => err instanceof QueryRowValidationError && !!err.rowErrors.m1
  );
});

test('submitting nothing at all is a form-level error', () => {
  assert.throws(() => normalizeQueryRows([]), err => !!err.rowErrors._form);
  assert.throws(() => normalizeQueryRows(undefined), err => !!err.rowErrors._form);
});

test('row order is renumbered contiguously after drops', () => {
  const rows = normalizeQueryRows([
    aiRow({ rowKey: 'a' }),
    { rowKey: 'blank', queryText: '', rowSource: 'reviewer_added' },
    { rowKey: 'b', queryText: 'Please confirm the pack size.', rowSource: 'reviewer_added' },
  ]);
  assert.deepEqual(rows.map(r => r.order), [1, 2]);
});

test('text is trimmed and stripped of control characters before storage', () => {
  const [row] = normalizeQueryRows([aiRow({ queryText: `  Please upload\tthe   file.  ` })]);
  assert.equal(row.queryText, 'Please upload the file.');
  assert.equal(sanitizeQueryText('a'.repeat(5000)).length, 2000);
});

test('legacy remarks are derived from the rows for backward compatibility', () => {
  const rows = normalizeQueryRows([
    aiRow({ queryText: 'Please upload a valid Product Approval Certificate.' }),
    { rowKey: 'm1', checklistItem: 'Batch size', queryText: 'Please confirm the batch size.', rowSource: 'reviewer_added' },
  ]);
  const remarks = deriveLegacyRemarks(
    { docId: 'product_approval', expectedType: 'Product Approval Certificate', fileName: 'noc.pdf' },
    rows
  );
  assert.equal(remarks.split('\n')[0], 'Document query — Product Approval Certificate (noc.pdf)');
  assert.match(remarks, /1\. Document type verification: Please upload a valid Product Approval Certificate\./);
  assert.match(remarks, /2\. Batch size: Please confirm the batch size\./);
});
