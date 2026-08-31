const Application = require('../models/Application');
const { BUSINESS_TIMEZONE, startOfBusinessWeek } = require('../config/businessTime');
const { REVIEW_SLA_DAYS, MS_PER_DAY } = require('../config/reviewSla');
const { resolveCountry } = require('./countryValidation');
const { categoryDisplayLabel } = require('./categoryValidation');

const STATUS_LABELS = {
  DRAFT: 'Draft', SUBMITTED: 'Submitted', IN_REVIEW: 'In Review',
  QUERY_RAISED: 'Query Raised', APPROVED: 'Approved',
  PARTIALLY_APPROVED: 'Partially Approved', REJECTED: 'Rejected',
  UNKNOWN: 'Unrecognised status',
};

function canonicalStatusExpression(field = '$status') {
  return {
    $switch: {
      branches: [
        { case: { $eq: [field, 'Draft'] }, then: 'DRAFT' },
        { case: { $eq: [field, 'Submitted'] }, then: 'SUBMITTED' },
        { case: { $in: [field, ['Under Review', 'Document Verification', 'Compliance Check']] }, then: 'IN_REVIEW' },
        { case: { $eq: [field, 'Query Raised'] }, then: 'QUERY_RAISED' },
        { case: { $eq: [field, 'Approved'] }, then: 'APPROVED' },
        { case: { $eq: [field, 'Partially Approved'] }, then: 'PARTIALLY_APPROVED' },
        { case: { $eq: [field, 'Rejected'] }, then: 'REJECTED' },
      ],
      default: 'UNKNOWN',
    },
  };
}

function conditionalCount(condition) {
  return { $sum: { $cond: [condition, 1, 0] } };
}

async function aggregateSummary(filter, reviewer, now = new Date()) {
  const overdueBefore = new Date(now.getTime() - REVIEW_SLA_DAYS * MS_PER_DAY);
  const rows = await Application.aggregate([
    { $match: filter },
    {
      $project: {
        applicationNumber: 1,
        canonicalStatus: canonicalStatusExpression(),
        effectiveSubmittedAt: { $ifNull: ['$submittedAt', '$createdAt'] },
      },
    },
    {
      $lookup: {
        from: 'applicationreads',
        let: { appNo: '$applicationNumber' },
        pipeline: [{
          $match: {
            $expr: {
              $and: [
                { $eq: ['$applicationNumber', '$$appNo'] },
                { $or: [
                  { $eq: ['$reviewerId', reviewer.id] },
                  { $and: [
                    { $eq: [{ $ifNull: ['$reviewerId', null] }, null] },
                    { $eq: ['$reviewer', reviewer.name] },
                  ] },
                ] },
              ],
            },
          },
        }, { $limit: 1 }],
        as: 'readReceipt',
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        submitted: conditionalCount({ $eq: ['$canonicalStatus', 'SUBMITTED'] }),
        underReview: conditionalCount({ $eq: ['$canonicalStatus', 'IN_REVIEW'] }),
        queryRaised: conditionalCount({ $eq: ['$canonicalStatus', 'QUERY_RAISED'] }),
        approved: conditionalCount({ $in: ['$canonicalStatus', ['APPROVED', 'PARTIALLY_APPROVED']] }),
        rejected: conditionalCount({ $eq: ['$canonicalStatus', 'REJECTED'] }),
        overdue: conditionalCount({
          $and: [
            { $in: ['$canonicalStatus', ['SUBMITTED', 'IN_REVIEW', 'QUERY_RAISED']] },
            { $lt: ['$effectiveSubmittedAt', overdueBefore] },
          ],
        }),
        unknown: conditionalCount({ $eq: ['$canonicalStatus', 'UNKNOWN'] }),
        unread: conditionalCount({ $eq: [{ $size: '$readReceipt' }, 0] }),
      },
    },
  ]);
  const row = rows[0] || {};
  const current = Object.fromEntries(
    ['total', 'submitted', 'underReview', 'queryRaised', 'approved', 'rejected', 'overdue']
      .map(key => [key, row[key] || 0]),
  );
  return { current, unknownCount: row.unknown || 0, unreadCount: row.unread || 0 };
}

const groupCount = field => [
  { $group: { _id: field, value: { $sum: 1 } } },
  { $sort: { value: -1, _id: 1 } },
];

async function aggregateCharts(filter, now = new Date()) {
  const today = now;
  const rows = await Application.aggregate([
    { $match: filter },
    {
      $project: {
        status: 1,
        canonicalStatus: canonicalStatusExpression(),
        exportCategory: { $ifNull: ['$exportCategory', 'Not specified'] },
        destination: { $ifNull: ['$destinationCountry', { $ifNull: ['$consigneeCountry', 'Not specified'] }] },
        submitted: { $ifNull: ['$submittedAt', '$createdAt'] },
        decision: {
          $switch: {
            branches: [
              { case: { $eq: ['$status', 'Rejected'] }, then: '$rejectedAt' },
              { case: { $in: ['$status', ['Approved', 'Partially Approved']] }, then: '$approvedAt' },
            ],
            default: null,
          },
        },
      },
    },
    {
      $addFields: {
        duration: {
          $cond: [
            { $ne: ['$submitted', null] },
            { $max: [0, { $floor: { $divide: [{ $subtract: [{ $ifNull: ['$decision', today] }, '$submitted'] }, MS_PER_DAY] } }] },
            null,
          ],
        },
      },
    },
    {
      $facet: {
        status: groupCount('$canonicalStatus'),
        rawStatus: groupCount('$status'),
        category: groupCount('$exportCategory'),
        country: groupCount('$destination'),
        durations: [
          { $match: { duration: { $ne: null } } },
          { $group: { _id: '$duration', value: { $sum: 1 } } },
          { $sort: { _id: 1 } },
        ],
        receivedDaily: [
          { $match: { submitted: { $ne: null } } },
          { $group: { _id: { $dateToString: { date: '$submitted', format: '%Y-%m-%d', timezone: BUSINESS_TIMEZONE } }, value: { $sum: 1 } } },
        ],
        disposedDaily: [
          { $match: { decision: { $ne: null } } },
          { $group: { _id: { $dateToString: { date: '$decision', format: '%Y-%m-%d', timezone: BUSINESS_TIMEZONE } }, value: { $sum: 1 } } },
        ],
      },
    },
  ]);
  return formatCharts(rows[0] || {}, now);
}

async function loadAnalyticsEventRows(filter, since) {
  const rows = await Application.aggregate([
    { $match: filter },
    {
      $project: {
        applicationNumber: 1, status: 1, submittedAt: 1, createdAt: 1,
        approvedAt: 1, rejectedAt: 1,
        recentAudit: {
          $filter: {
            input: { $ifNull: ['$auditLog', []] },
            as: 'entry',
            cond: {
              $gte: [
                { $ifNull: ['$$entry.occurredAt', '$$entry.timestamp'] },
                since,
              ],
            },
          },
        },
        lastTransition: {
          $arrayElemAt: [{
            $filter: {
              input: { $ifNull: ['$auditLog', []] },
              as: 'entry',
              cond: {
                $or: [
                  { $and: [
                    { $ne: [{ $ifNull: ['$$entry.fromStatus', null] }, null] },
                    { $ne: [{ $ifNull: ['$$entry.toStatus', null] }, null] },
                  ] },
                  { $eq: ['$$entry.action', 'reviewer_action'] },
                ],
              },
            },
          }, -1],
        },
      },
    },
    {
      $lookup: {
        from: 'applicationqueries',
        let: { appNo: '$applicationNumber' },
        pipeline: [
          { $match: { $expr: { $and: [
            { $eq: ['$applicationNumber', '$$appNo'] },
            { $or: [
              { $gte: ['$createdAt', since] },
              { $gte: ['$responseAt', since] },
            ] },
          ] } } },
          { $project: { applicationNumber: 1, createdAt: 1, responseAt: 1, status: 1 } },
        ],
        as: 'queries',
      },
    },
  ]);
  const queriesByApp = new Map();
  for (const row of rows) {
    const auditLog = [...(row.recentAudit || [])];
    if (row.lastTransition) {
      const stamp = row.lastTransition.occurredAt || row.lastTransition.timestamp;
      const already = auditLog.some(entry => String(entry.occurredAt || entry.timestamp) === String(stamp)
        && entry.fromStatus === row.lastTransition.fromStatus
        && entry.toStatus === row.lastTransition.toStatus);
      if (!already) auditLog.push(row.lastTransition);
    }
    row.auditLog = auditLog;
    queriesByApp.set(row.applicationNumber, row.queries || []);
    delete row.recentAudit;
    delete row.lastTransition;
    delete row.queries;
  }
  return { apps: rows, queriesByApp };
}

function ranked(entries, total, normalise = value => value, limit = 0) {
  const counts = new Map();
  for (const entry of entries || []) {
    const label = normalise(entry._id == null || entry._id === '' ? 'Not specified' : String(entry._id));
    counts.set(label, (counts.get(label) || 0) + entry.value);
  }
  let rows = [...counts.entries()]
    .map(([label, value]) => ({ label, value, share: total ? value / total : 0 }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  if (limit && rows.length > limit) {
    const tail = rows.slice(limit).reduce((sum, row) => sum + row.value, 0);
    rows = [...rows.slice(0, limit), { label: 'Others', value: tail, share: total ? tail / total : 0 }];
  }
  return rows;
}

function weightedMedian(entries) {
  const total = entries.reduce((sum, row) => sum + row.value, 0);
  if (!total) return null;
  const targets = total % 2 ? [(total + 1) / 2] : [total / 2, total / 2 + 1];
  const values = [];
  let seen = 0;
  for (const row of entries) {
    seen += row.value;
    while (targets.length && seen >= targets[0]) {
      values.push(Number(row._id)); targets.shift();
    }
  }
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

function dailySeries(source, now, days) {
  const map = new Map((source || []).map(row => [row._id, row.value]));
  const out = [];
  const end = new Date(now); end.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(end.getTime() - i * MS_PER_DAY);
    const key = d.toISOString().slice(0, 10);
    out.push({ key, value: map.get(key) || 0 });
  }
  return out;
}

function rollupTrend(received, disposed, granularity) {
  const buckets = new Map();
  const bucket = key => {
    const d = new Date(`${key}T12:00:00Z`);
    if (granularity === 'month') return `${key.slice(0, 7)}-01`;
    if (granularity === 'week') return startOfBusinessWeek(d).toISOString().slice(0, 10);
    return key;
  };
  for (const row of received) {
    const key = bucket(row.key); const hit = buckets.get(key) || { key, received: 0, disposed: 0 };
    hit.received += row.value; buckets.set(key, hit);
  }
  for (const row of disposed) {
    const key = bucket(row.key); const hit = buckets.get(key) || { key, received: 0, disposed: 0 };
    hit.disposed += row.value; buckets.set(key, hit);
  }
  return [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function formatCharts(raw, now) {
  const total = (raw.status || []).reduce((sum, row) => sum + row.value, 0);
  const statusDistribution = (raw.status || []).map(row => ({
    status: STATUS_LABELS[row._id] || STATUS_LABELS.UNKNOWN,
    value: row.value,
    share: total ? row.value / total : 0,
  })).sort((a, b) => b.value - a.value);
  const rawCounts = Object.fromEntries((raw.rawStatus || []).map(row => [row._id, row.value]));
  const stageValues = [
    total,
    total - (rawCounts.Draft || 0) - (rawCounts.Submitted || 0),
    (rawCounts['Document Verification'] || 0) + (rawCounts['Compliance Check'] || 0)
      + (rawCounts.Approved || 0) + (rawCounts['Partially Approved'] || 0) + (rawCounts.Rejected || 0),
    (rawCounts['Compliance Check'] || 0) + (rawCounts.Approved || 0)
      + (rawCounts['Partially Approved'] || 0) + (rawCounts.Rejected || 0),
    (rawCounts.Approved || 0) + (rawCounts['Partially Approved'] || 0) + (rawCounts.Rejected || 0),
  ];
  const labels = ['Submitted', 'Under Review', 'Document Verification', 'Compliance Check', 'Decided'];
  const pipeline = stageValues.map((value, index) => {
    const previous = index ? stageValues[index - 1] : null;
    const dropOff = previous == null ? null : previous - value;
    return {
      key: labels[index], label: labels[index], value,
      share: total ? value / total : 0,
      dropOff,
      dropOffShare: previous ? dropOff / previous : null,
    };
  });
  const durationTotal = (raw.durations || []).reduce((sum, row) => sum + row.value, 0);
  const definitions = [
    { key: '0-3', label: '0–3 days', min: 0, max: 3 },
    { key: '4-7', label: '4–7 days', min: 4, max: 7 },
    { key: '8-15', label: '8–15 days', min: 8, max: 15 },
    { key: '16-30', label: '16–30 days', min: 16, max: 30 },
    { key: '30+', label: 'Over 30 days', min: 31, max: Infinity },
  ];
  const processingRows = definitions.map(def => {
    const value = (raw.durations || []).filter(row => row._id >= def.min && row._id <= def.max)
      .reduce((sum, row) => sum + row.value, 0);
    return { ...def, value, share: durationTotal ? value / durationTotal : 0 };
  });
  const received = dailySeries(raw.receivedDaily, now, 365);
  const disposed = dailySeries(raw.disposedDaily, now, 365);
  return {
    scope: { applications: total, countedBy: 'unique application id before aggregation' },
    submissionTrend: {
      day: rollupTrend(received.slice(-90), disposed.slice(-90), 'day'),
      week: rollupTrend(received.slice(-180), disposed.slice(-180), 'week'),
      month: rollupTrend(received, disposed, 'month'),
    },
    statusDistribution,
    processingTime: { rows: processingRows, median: weightedMedian(raw.durations || []), counted: durationTotal },
    categoryMix: ranked(raw.category, total, categoryDisplayLabel),
    destinationCountries: ranked(raw.country, total, value => {
      if (value === 'Not specified') return value;
      return resolveCountry(value)?.name || `Invalid country data: ${value}`;
    }, 8),
    pipeline: {
      stages: pipeline,
      hold: { held: rawCounts['Query Raised'] || 0, share: total ? (rawCounts['Query Raised'] || 0) / total : 0, total },
    },
    decisionThroughput: [],
  };
}

module.exports = {
  aggregateCharts,
  aggregateSummary,
  canonicalStatusExpression,
  formatCharts,
  loadAnalyticsEventRows,
  weightedMedian,
};
