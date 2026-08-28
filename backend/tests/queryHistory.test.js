const test = require('node:test');
const assert = require('node:assert/strict');
const { collectLegacyQueries, generateQueryIdentifier } = require('../services/queryHistory');

test('AI query identifiers are readable and unique', () => {
  const first = generateQueryIdentifier('EXP-2026-123456', new Date('2026-08-28T10:20:30Z'));
  const second = generateQueryIdentifier('EXP-2026-123456', new Date('2026-08-28T10:20:30Z'));
  assert.match(first, /^AIQ-EXP-2026-123456-20260828102030-[A-F0-9]{8}$/);
  assert.notEqual(first, second);
});

test('legacy reviewer, checklist, and shipment queries are retained chronologically', () => {
  const app = {
    _id: '507f1f77bcf86cd799439011',
    applicationNumber: 'EXP-2026-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    reviewerRemarks: [
      { text: 'Application query', status: 'Query Raised', officer: 'R1', timestamp: new Date('2026-01-02T00:00:00Z') },
      { text: 'Already migrated', status: 'Query Raised', queryIdentifier: 'AIQ-existing' },
    ],
    checklistItems: new Map([['legal', { queries: [{ version: 1, queryText: 'Checklist query', queryBy: 'R2', queryDate: new Date('2026-01-03T00:00:00Z'), reply: 'Fixed', replyDate: new Date('2026-01-04T00:00:00Z') }] }]]),
    shipments: [{ lineRemarks: [{ text: 'Shipment query', status: 'Query', officer: 'R3', timestamp: new Date('2026-01-05T00:00:00Z') }] }],
  };
  const records = collectLegacyQueries(app);
  assert.equal(records.length, 3);
  assert.equal(records[1].status, 'Responded');
  assert.equal(records[1].applicantResponse, 'Fixed');
  assert.ok(records.every(record => record.queryIdentifier.startsWith('AIQ-EXP-2026-1-LEGACY-')));
});
