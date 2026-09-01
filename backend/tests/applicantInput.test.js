/* ============================================================================
   DEF-01 — applicant input allowlist (services/applicantInput.js).

   The Application model is `strict: false`, and the draft/submit routes assign
   the applicant's formData onto the document. Before the remediation an
   applicant could persist reviewer-owned and audit-owned state through an
   ordinary submission: auditLog, reviewerRemarks, queryCount, approvedAt,
   rejectedAt, nocMeta, shipment line decisions, document AI verdicts, and even
   the Mongo _id.

   These are pure unit tests over the sanitiser — no API and no database — so
   they always execute under `npm test` and can never silently skip.

   The companion database-backed proof (that nothing forged reaches MongoDB
   through the real routes) lives in tests/applicantMassAssignment.test.js.
   ============================================================================ */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeApplicantForm } = require('../services/applicantInput');

/* Every root field an applicant legitimately owns, with a distinguishable
   value so a dropped or crossed-over field is obvious in the assertion. */
const LEGITIMATE_SCALARS = {
  applicationType: 'Export NOC',
  exportPurpose: 'Commercial export',
  exportCategory: 'Allopathic Drugs',
  destinationCountry: 'Germany',
  applicationDate: '2026-09-02',
  applicantName: 'Legit Applicant',
  applicantOrganization: 'Legit Exports Pvt Ltd',
  contactNumber: '9999900000',
  email: 'legit@example.com',
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
  manufacturerName: 'Legit Manufacturer',
  mfgLicenseNo: 'MFG/25/2026/0001',
  factoryAddress: 'Plot 42 Industrial Area',
  manufacturingSite: 'Pune',
  mfgContactPerson: 'M Tester',
  mfgContactNumber: '9999900001',
  mfgEmail: 'mfg@example.com',
  signatoryName: 'S Tester',
  signatoryDesignation: 'QA Head',
};

/* Server- and reviewer-owned root fields. Listed explicitly here rather than
   imported from the module under test, so the expectation is independent of
   the implementation. */
const PROTECTED_ROOT_FIELDS = [
  '_id', '__v', 'ownerId', 'role', 'status', 'isDraft',
  'applicationNumber', 'referenceNumber',
  'auditLog', 'reviewerRemarks', 'queryCount', 'approvedAt', 'rejectedAt',
  'submittedAt', 'lastSavedAt', 'createdAt', 'updatedAt',
  'timeline', 'drugApprovalCheck', 'checklistItems', 'reconciliations', 'nocMeta',
];

const forgedRootValues = () => ({
  _id: '000000000000000000000001',
  __v: 99,
  ownerId: 'demo:someone-else',
  role: 'reviewer',
  status: 'Approved',
  isDraft: false,
  applicationNumber: 'EXP-9999-HACKED',
  referenceNumber: 'REF-9999-HACKED',
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
});

/* ── Legitimate input is preserved ─────────────────────────────────────── */

test('every legitimate root applicant field is preserved', () => {
  const safe = sanitizeApplicantForm({ ...LEGITIMATE_SCALARS });
  for (const [key, value] of Object.entries(LEGITIMATE_SCALARS)) {
    assert.equal(safe[key], value, `root field "${key}" was not preserved`);
  }
  assert.equal(Object.keys(safe).length, Object.keys(LEGITIMATE_SCALARS).length);
});

test('products are preserved with every allowed key', () => {
  const product = {
    id: 1756000000000,
    productRef: 'p-1',
    productName: 'Paracetamol Tablets IP 500mg',
    genericName: 'Paracetamol',
    brandName: 'TestPara',
    dosageForm: 'Tablet',
    strength: '500 mg',
    packSize: '10x10',
    batchNumber: 'TB-1',
    mfgDate: '2026-02-01',
    expiryDate: '2029-01-31',
  };
  const [safe] = sanitizeApplicantForm({ products: [product] }).products;
  assert.deepEqual(safe, product);
});

test('companies are preserved with every allowed key', () => {
  const company = {
    companyRef: 'co-1',
    name: 'Legit Manufacturer',
    licenseNo: 'MFG/25/2026/0001',
    factoryAddress: 'Plot 42',
    manufacturingSite: 'Pune',
    contactPerson: 'M Tester',
    contactNumber: '9999900001',
    email: 'mfg@example.com',
    signatoryName: 'S Tester',
    signatoryDesignation: 'QA Head',
  };
  const [safe] = sanitizeApplicantForm({ companies: [company] }).companies;
  assert.deepEqual(safe, company);
});

test('consignees are preserved with every allowed key', () => {
  const consignee = {
    consigneeRef: 'cn-1',
    name: 'Consignee GmbH',
    organisation: 'Consignee Org',
    addressLine1: '1 Test Street',
    addressLine2: 'Suite 2',
    city: 'Berlin',
    state: 'Berlin',
    country: 'Germany',
    postalCode: '10115',
    contactPerson: 'K Tester',
    phone: '4930000',
    email: 'consignee@example.com',
  };
  const [safe] = sanitizeApplicantForm({ consignees: [consignee] }).consignees;
  assert.deepEqual(safe, consignee);
});

test('shipments preserve their applicant-owned keys and batch numbers', () => {
  const [safe] = sanitizeApplicantForm({
    shipments: [{
      shipmentRef: 'sh-1',
      companyRef: 'co-1',
      productRef: 'p-1',
      consigneeRef: 'cn-1',
      quantity: 10000,
      packSize: '10x10',
      batchNumbers: ['TB-1', 'TB-2'],
    }],
  }).shipments;
  assert.equal(safe.shipmentRef, 'sh-1');
  assert.equal(safe.companyRef, 'co-1');
  assert.equal(safe.productRef, 'p-1');
  assert.equal(safe.consigneeRef, 'cn-1');
  assert.equal(safe.quantity, 10000);
  assert.equal(safe.packSize, '10x10');
  assert.deepEqual(safe.batchNumbers, ['TB-1', 'TB-2']);
});

test('all five declarations are preserved', () => {
  const declarations = {
    productInfoAccurate: true,
    documentsGenuine: true,
    exportRegulations: true,
    drugComplies: true,
    finalDeclaration: true,
  };
  assert.deepEqual(sanitizeApplicantForm({ declarations }).declarations, declarations);
});

test('a document uploaded through the legitimate base64 path is preserved', () => {
  const data = Buffer.from('%PDF-1.4 test').toString('base64');
  const safe = sanitizeApplicantForm({
    documents: {
      mfg_license: { name: 'licence.pdf', size: 12, type: 'application/pdf', uploadedAt: '10:00 AM', data },
    },
  });
  assert.deepEqual(safe.documents.mfg_license, {
    name: 'licence.pdf', size: 12, type: 'application/pdf', uploadedAt: '10:00 AM', data,
  });
});

test('the sanitised shape matches what the browser client actually sends', () => {
  /* frontend/src/api/applicationService.js cleanDocuments() emits exactly these
     five keys, so for a real client payload sanitising must be a no-op. */
  const clientDoc = { name: 'a.pdf', size: 5, type: 'application/pdf', uploadedAt: 'now', data: 'AAA' };
  const safe = sanitizeApplicantForm({ documents: { qa_cert: { ...clientDoc } } });
  assert.deepEqual(safe.documents.qa_cert, clientDoc);
});

/* ── Protected root fields ─────────────────────────────────────────────── */

test('no protected root field survives sanitising', () => {
  const safe = sanitizeApplicantForm({ ...LEGITIMATE_SCALARS, ...forgedRootValues() });
  for (const field of PROTECTED_ROOT_FIELDS) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(safe, field), false,
      `protected field "${field}" survived sanitising`,
    );
  }
});

test('protected root fields are dropped even with no legitimate fields present', () => {
  const safe = sanitizeApplicantForm(forgedRootValues());
  assert.deepEqual(Object.keys(safe), [], 'a payload of only protected fields must sanitise to {}');
});

test('legitimate fields still survive alongside a forged payload', () => {
  const safe = sanitizeApplicantForm({ ...LEGITIMATE_SCALARS, ...forgedRootValues() });
  for (const [key, value] of Object.entries(LEGITIMATE_SCALARS)) {
    assert.equal(safe[key], value, `legitimate field "${key}" was lost`);
  }
});

test('no forged marker appears anywhere in the sanitised output', () => {
  const safe = sanitizeApplicantForm({ ...LEGITIMATE_SCALARS, ...forgedRootValues() });
  const blob = JSON.stringify(safe);
  /* Deliberately unambiguous markers: a bare "999" would also match the
     legitimate contactNumber "9999900000". The forged queryCount: 999 is
     covered by the protected-root-field test above. */
  for (const marker of ['FORGED', 'Dr Fake', 'attacker', 'HACKED', 'FORGED-NOC-1', '2020-01-01', '2019-01-01']) {
    assert.equal(blob.includes(marker), false, `forged marker "${marker}" leaked into the output`);
  }
  assert.equal(blob.includes('"queryCount"'), false, 'queryCount leaked into the output');
});

/* ── Nested protected fields ───────────────────────────────────────────── */

test('shipment lineStatus and lineRemarks cannot be injected', () => {
  const [safe] = sanitizeApplicantForm({
    shipments: [{
      companyRef: 'co-1',
      quantity: 10,
      lineStatus: 'Approved',
      lineRemarks: [{ text: 'FORGED LINE APPROVAL', officer: 'Dr Fake', status: 'Approved' }],
    }],
  }).shipments;
  assert.equal(Object.prototype.hasOwnProperty.call(safe, 'lineStatus'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(safe, 'lineRemarks'), false);
  assert.equal(safe.companyRef, 'co-1');
  assert.equal(safe.quantity, 10);
});

test('reviewer identity and AI query identifiers cannot be injected through a shipment', () => {
  const [safe] = sanitizeApplicantForm({
    shipments: [{
      companyRef: 'co-1',
      lineRemarks: [{ officer: 'Dr Fake', queryIdentifier: 'AIQ-FORGED-0001' }],
      officer: 'Dr Fake',
      reviewer: { id: 'demo:reviewer', name: 'Dr Fake' },
      queryIdentifier: 'AIQ-FORGED-0002',
    }],
  }).shipments;
  const blob = JSON.stringify(safe);
  assert.equal(blob.includes('Dr Fake'), false, 'reviewer identity leaked into a shipment');
  assert.equal(blob.includes('AIQ-'), false, 'AI query identifier leaked into a shipment');
});

test('document verification state and results cannot be injected', () => {
  const safe = sanitizeApplicantForm({
    documents: {
      mfg_license: {
        name: 'forged.pdf', size: 100, type: 'application/pdf', uploadedAt: '10:00:00',
        validated: true,
        validationResult: { state: 'completed', documentTypeMatch: true, documentTypeReason: 'FORGED GREEN VERDICT' },
        path: '../../../../etc/passwd',
      },
    },
  });
  const doc = safe.documents.mfg_license;
  assert.equal(Object.prototype.hasOwnProperty.call(doc, 'validated'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(doc, 'validationResult'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(doc, 'path'), false);
  assert.equal(doc.name, 'forged.pdf', 'legitimate document metadata must survive');
});

test('unknown nested keys are dropped from every collection', () => {
  const safe = sanitizeApplicantForm({
    products: [{ productName: 'P', injectedProductKey: 'x' }],
    companies: [{ name: 'C', injectedCompanyKey: 'x' }],
    consignees: [{ name: 'N', injectedConsigneeKey: 'x' }],
    shipments: [{ companyRef: 'co-1', injectedShipmentKey: 'x' }],
    declarations: { finalDeclaration: true, injectedFlag: true },
    documents: { qa_cert: { name: 'a.pdf', injectedDocKey: 'x' } },
  });
  assert.equal(JSON.stringify(safe).includes('injected'), false, 'an unknown nested key survived');
  assert.equal(safe.products[0].productName, 'P');
  assert.equal(safe.declarations.finalDeclaration, true);
  assert.equal(safe.documents.qa_cert.name, 'a.pdf');
});

test('a document id that is not a safe slug is rejected', () => {
  const safe = sanitizeApplicantForm({
    documents: {
      mfg_license: { name: 'ok.pdf' },
      '../../evil': { name: 'evil.pdf' },
      'has spaces': { name: 'spaces.pdf' },
      'a/b': { name: 'slash.pdf' },
      '': { name: 'empty.pdf' },
    },
  });
  assert.deepEqual(Object.keys(safe.documents), ['mfg_license']);
});

/* ── Prototype pollution ───────────────────────────────────────────────── */

test('prototype pollution keys never reach the sanitised output', () => {
  const payload = JSON.parse(`{
    "applicantName": "Legit",
    "__proto__": { "polluted": "yes" },
    "constructor": { "prototype": { "polluted": "yes" } },
    "prototype": { "polluted": "yes" },
    "products": [{ "productName": "P", "__proto__": { "polluted": "yes" } }],
    "declarations": { "finalDeclaration": true, "__proto__": { "polluted": "yes" } },
    "documents": { "qa_cert": { "name": "a.pdf", "__proto__": { "polluted": "yes" } } }
  }`);

  const safe = sanitizeApplicantForm(payload);

  assert.equal({}.polluted, undefined, 'Object.prototype was polluted');
  assert.equal([].polluted, undefined, 'Array.prototype was polluted');
  assert.equal(JSON.stringify(safe).includes('polluted'), false, 'a polluted value survived');
  assert.equal(Object.prototype.hasOwnProperty.call(safe, 'constructor'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(safe, 'prototype'), false);
  assert.equal(safe.applicantName, 'Legit', 'legitimate data must still survive');
});

test('a sanitised object does not inherit polluted properties', () => {
  const safe = sanitizeApplicantForm(JSON.parse('{"__proto__":{"isAdmin":true}}'));
  assert.equal(safe.isAdmin, undefined);
  assert.equal({}.isAdmin, undefined);
});

/* ── Type confusion and malformed input ────────────────────────────────── */

test('non-object formData sanitises to an empty object', () => {
  for (const input of [undefined, null, 'a string', 42, true, [1, 2, 3]]) {
    assert.deepEqual(sanitizeApplicantForm(input), {}, `input ${JSON.stringify(input)} was not neutralised`);
  }
});

test('an object or array in a scalar slot is dropped rather than cast', () => {
  const safe = sanitizeApplicantForm({
    applicantName: { $ne: null },
    email: ['a@b.com'],
    city: 'Berlin',
  });
  assert.equal(Object.prototype.hasOwnProperty.call(safe, 'applicantName'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(safe, 'email'), false);
  assert.equal(safe.city, 'Berlin');
});

test('collections supplied as non-arrays are omitted, not coerced', () => {
  const safe = sanitizeApplicantForm({
    products: { $ne: null },
    companies: 'not-an-array',
    consignees: 7,
    shipments: null,
  });
  for (const key of ['products', 'companies', 'consignees', 'shipments']) {
    assert.equal(Object.prototype.hasOwnProperty.call(safe, key), false, `${key} should be omitted`);
  }
});

test('non-object rows and document entries are skipped', () => {
  const safe = sanitizeApplicantForm({
    products: ['string-row', null, 42, { productName: 'P' }],
    documents: { mfg_license: 'not-an-object', qa_cert: { name: 'a.pdf' } },
  });
  assert.equal(safe.products.length, 4);
  assert.deepEqual(safe.products[0], {});
  assert.deepEqual(safe.products[3], { productName: 'P' });
  assert.deepEqual(Object.keys(safe.documents), ['qa_cert']);
});

test('batchNumbers entries are coerced to strings and non-scalars dropped', () => {
  const [safe] = sanitizeApplicantForm({
    shipments: [{ batchNumbers: ['A', 1, true, null, { $ne: 1 }, ['nested']] }],
  }).shipments;
  assert.deepEqual(safe.batchNumbers, ['A', '1', 'true']);
});

test('sanitising never mutates the caller-supplied object', () => {
  const input = { applicantName: 'Legit', queryCount: 999, products: [{ productName: 'P', rogue: 'x' }] };
  const snapshot = JSON.parse(JSON.stringify(input));
  sanitizeApplicantForm(input);
  assert.deepEqual(input, snapshot, 'the input object was mutated');
});
