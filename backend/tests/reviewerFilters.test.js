const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applicationsToCsv,
  buildReviewerFilter,
  exportFilename,
  resolveDateRange,
} = require('../services/reviewerFilters');

const NOW = new Date('2026-08-28T12:00:00.000Z');

test('resolves three-month and one-year presets', () => {
  assert.equal(resolveDateRange({ datePreset: '3months' }, NOW).start.toISOString(), '2026-05-28T12:00:00.000Z');
  assert.equal(resolveDateRange({ datePreset: '1year' }, NOW).start.toISOString(), '2025-08-28T12:00:00.000Z');
});

test('validates custom dates and creates an inclusive end date', () => {
  const range = resolveDateRange({ datePreset: 'custom', startDate: '2026-01-01', endDate: '2026-01-31' }, NOW);
  assert.equal(range.start.toISOString(), '2026-01-01T00:00:00.000Z');
  assert.equal(range.end.toISOString(), '2026-01-31T23:59:59.999Z');
  assert.throws(() => resolveDateRange({ datePreset: 'custom', startDate: '2026-02-31', endDate: '2026-03-02' }), /valid/);
  assert.throws(() => resolveDateRange({ datePreset: 'custom', startDate: '2026-03-02', endDate: '2026-03-01' }), /after/);
});

test('combines date and country before pagination', () => {
  const { filter } = buildReviewerFilter({ datePreset: '3months', country: 'Kenya' }, NOW);
  assert.ok(Array.isArray(filter.$and));
  assert.ok(filter.$and.some(clause => clause.$expr));
  const countryClause = filter.$and.find(clause => clause.$or);
  assert.equal(countryClause.$or.length, 3);
  assert.ok(countryClause.$or[0].destinationCountry.test('KENYA'));
});

test('CSV includes required values, legacy decision dates, and formula protection', () => {
  const app = {
    _id: 'abc', applicationNumber: '=EXP-1', referenceNumber: 'REF-1',
    applicantOrganization: 'Pharma Ltd', destinationCountry: 'Kenya',
    submittedAt: '2026-06-01T00:00:00.000Z', status: 'Approved', queryCount: 2,
    reviewerRemarks: [
      { status: 'Rejected', timestamp: '2026-06-02T00:00:00.000Z' },
      { status: 'Approved', timestamp: '2026-06-03T00:00:00.000Z' },
    ],
  };
  const csv = applicationsToCsv([app]);
  assert.match(csv, /Application ID/);
  assert.match(csv, /'=EXP-1/);
  assert.match(csv, /2026-06-03T00:00:00.000Z/);
  assert.match(csv, /2026-06-02T00:00:00.000Z/);
});

test('export filename contains selected period, country, and export date', () => {
  const range = resolveDateRange({ datePreset: 'custom', startDate: '2026-01-01', endDate: '2026-02-01' }, NOW);
  assert.equal(
    exportFilename(range, 'United Kingdom', NOW),
    'reviewer-applications_2026-01-01_to_2026-02-01_united-kingdom_exported-2026-08-28.csv',
  );
});
