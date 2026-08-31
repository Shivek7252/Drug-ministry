const test = require('node:test');
const assert = require('node:assert/strict');
const { formatCharts, weightedMedian } = require('../services/reviewerAnalyticsDb');

test('chart aggregation preserves totals larger than former client pagination limits', () => {
  const charts = formatCharts({
    status: [
      { _id: 'SUBMITTED', value: 2100 },
      { _id: 'APPROVED', value: 401 },
    ],
    rawStatus: [
      { _id: 'Submitted', value: 2100 },
      { _id: 'Approved', value: 401 },
    ],
    category: [{ _id: 'Vaccines', value: 2501 }],
    country: [{ _id: 'Japan', value: 2501 }],
    durations: [{ _id: 2, value: 2100 }, { _id: 20, value: 401 }],
    receivedDaily: [], disposedDaily: [],
  }, new Date('2026-08-31T02:30:00Z'));
  assert.equal(charts.scope.applications, 2501);
  assert.equal(charts.statusDistribution.reduce((sum, row) => sum + row.value, 0), 2501);
  assert.equal(charts.categoryMix[0].value, 2501);
  assert.equal(charts.destinationCountries[0].value, 2501);
  assert.equal(charts.processingTime.counted, 2501);
});

test('weighted median is exact without transferring one row per application', () => {
  assert.equal(weightedMedian([{ _id: 2, value: 3 }, { _id: 20, value: 2 }]), 2);
  assert.equal(weightedMedian([{ _id: 2, value: 2 }, { _id: 20, value: 2 }]), 11);
});
