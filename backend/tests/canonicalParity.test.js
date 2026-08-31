/* ============================================================================
   Canonical-definition parity.

   The status model and the export-category list each exist on both sides of
   the wire. These tests fail the build the moment the two copies drift, so a
   status or category cannot be recognised by one surface and dropped by the
   other. Same technique as countryParity.test.js.
   ============================================================================ */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const backendStatus = require('../services/statusModel');
const {
  validateCategory, isValidCategory, resolveCategory,
  categoryDisplayLabel, isInvalidCategoryValue, CATEGORIES,
} = require('../services/categoryValidation');
const categoryData = require('../data/exportCategories.json');

/** Evaluate a frontend ES module without a bundler. */
function loadFrontend(relPath, exportsExpr) {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', relPath), 'utf8')
    .replace(/^import[^\n]*\n/gm, '')
    .replace(/^export const /gm, 'const ')
    .replace(/^export function /gm, 'function ')
    .replace(/^export /gm, '');
  const box = { console, module: { exports: {} } };
  vm.createContext(box);
  vm.runInContext(`${src}\n;module.exports = ${exportsExpr};`, box);
  return box.module.exports;
}

/* ---- Status model -------------------------------------------------------- */

test('frontend and backend status enums are identical', () => {
  const fe = loadFrontend('pages/reviewer/dashboard/statusModel.js', '{ STATUS }');
  assert.deepEqual(
    JSON.parse(JSON.stringify(fe.STATUS)),
    JSON.parse(JSON.stringify(backendStatus.STATUS)),
    'STATUS enums differ between frontend and backend',
  );
});

test('every raw enum value normalises the same on both sides', () => {
  const fe = loadFrontend('pages/reviewer/dashboard/statusModel.js', '{ normalizeStatus }');
  const raws = [
    'Draft', 'Submitted', 'Under Review', 'Document Verification', 'Compliance Check',
    'Query Raised', 'Approved', 'Partially Approved', 'Rejected',
    /* casing, spacing and separator variants */
    'submitted', 'UNDER REVIEW', 'query_raised', 'partially-approved', '  Approved  ',
    /* malformed */
    '', null, undefined, 'Nonsense',
  ];
  for (const raw of raws) {
    assert.equal(
      backendStatus.normalizeStatus(raw), fe.normalizeStatus(raw),
      `normalizeStatus(${JSON.stringify(raw)}) differs between frontend and backend`,
    );
  }
});

test('terminal and non-terminal sets agree across the wire', () => {
  const fe = loadFrontend('pages/reviewer/dashboard/statusModel.js', '{ TERMINAL, NON_TERMINAL }');
  assert.deepEqual([...fe.TERMINAL].sort(), [...backendStatus.TERMINAL].sort());
  assert.deepEqual([...fe.NON_TERMINAL].sort(), [...backendStatus.NON_TERMINAL].sort());
});

test('an unrecognised status is UNKNOWN, never silently dropped', () => {
  assert.equal(backendStatus.normalizeStatus('Cancelled'), backendStatus.STATUS.UNKNOWN);
  assert.equal(backendStatus.isTerminal({ status: 'Cancelled' }), false);
  assert.equal(backendStatus.isNonTerminal({ status: 'Cancelled' }), false);
});

/* ---- Export categories --------------------------------------------------- */

test('frontend and backend category lists are identical', () => {
  const fe = loadFrontend('data/mockData.js', '{ EXPORT_CATEGORIES }');
  assert.deepEqual(
    JSON.parse(JSON.stringify(fe.EXPORT_CATEGORIES)).slice().sort(),
    categoryData.categories.slice().sort(),
    'category lists differ — regenerate backend/data/exportCategories.json',
  );
});

test('every category alias points at a real category', () => {
  for (const [alias, canonical] of Object.entries(categoryData.aliases)) {
    assert.ok(CATEGORIES.includes(canonical), `alias "${alias}" points at unknown "${canonical}"`);
    assert.equal(resolveCategory(alias), canonical);
  }
});

test('valid categories are accepted in any casing', () => {
  for (const c of CATEGORIES) assert.ok(isValidCategory(c), `${c} should be valid`);
  assert.equal(validateCategory('vaccines').canonical, 'Vaccines');
  assert.equal(validateCategory('  Medical Devices ').canonical, 'Medical Devices');
  assert.equal(validateCategory('ayurvedic').canonical, 'Ayurvedic / Herbal Products');
});

test('the legacy "Y" value is rejected with an actionable message', () => {
  const r = validateCategory('Y');
  assert.equal(r.valid, false);
  assert.match(r.message, /not a recognised export category/i);
  assert.match(r.message, /Vaccines/);
  assert.equal(validateCategory('').valid, false);
  assert.equal(validateCategory('Widgets').valid, false);
});

test('legacy invalid values stay visible and labelled, never silently dropped', () => {
  assert.equal(isInvalidCategoryValue('Y'), true);
  assert.equal(categoryDisplayLabel('Y'), 'Invalid category data: Y');
  assert.equal(isInvalidCategoryValue('Vaccines'), false);
  assert.equal(categoryDisplayLabel('vaccines'), 'Vaccines');
  assert.equal(isInvalidCategoryValue(''), false);
  assert.equal(isInvalidCategoryValue('All'), false);
  assert.equal(categoryDisplayLabel(''), '—');
});

test('an invalid category is never offered as a selectable option', () => {
  assert.ok(!CATEGORIES.includes('Y'));
});

/* ---- SLA configuration --------------------------------------------------- */

test('the SLA is configurable and documented, not a bare literal', () => {
  const sla = require('../config/reviewSla');
  assert.equal(typeof sla.REVIEW_SLA_DAYS, 'number');
  assert.ok(sla.REVIEW_SLA_DAYS > 0);
  assert.equal(sla.REVIEW_SLA_BASIS, 'submittedAt');
  assert.equal(sla.REVIEW_SLA_DAY_TYPE, 'calendar');
  assert.equal(sla.REVIEW_SLA_PAUSES_ON_QUERY, false);
  assert.match(sla.REVIEW_SLA_DESCRIPTION, /pending business confirmation/i);
});

test('no hardcoded 15-day SLA remains in the analytics services', () => {
  for (const file of ['services/reviewerAnalytics.js', 'services/transitionEvents.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.ok(!/\b15\s*\*\s*86400000\b/.test(src), `${file} hardcodes a 15-day SLA`);
  }
});
