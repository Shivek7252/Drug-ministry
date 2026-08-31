const { countrySpellings } = require('./countryAliases');
const { startOfBusinessDay } = require('../config/businessTime');
const { REVIEW_SLA_DAYS, MS_PER_DAY } = require('../config/reviewSla');

const ALLOWED_PRESETS = new Set([
  'all', 'today', '7d', '30d', '90d', '3months', '1year', 'custom',
]);

const DEFAULT_FILTERS = Object.freeze({
  search: '', category: 'All', country: 'All', state: 'All States',
  status: 'All', workflowStatus: 'total', datePreset: 'all',
  startDate: '', endDate: '',
});

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const date = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return startOfBusinessDay(date);
}

function resolveDateRange(params, now = new Date()) {
  const preset = params.datePreset || 'all';
  if (!ALLOWED_PRESETS.has(preset)) throw new Error('Invalid datePreset.');
  if (preset === 'all') return { preset, start: null, endExclusive: null };

  if (preset === 'custom') {
    const start = parseIsoDate(params.startDate);
    const endStart = parseIsoDate(params.endDate);
    const endExclusive = endStart && startOfBusinessDay(new Date(endStart.getTime() + MS_PER_DAY));
    if (!start || !endExclusive) throw new Error('Custom date range requires valid startDate and endDate values.');
    if (start >= endExclusive) throw new Error('startDate cannot be after endDate.');
    return {
      preset, start, endExclusive,
      startDate: params.startDate,
      endDate: params.endDate,
    };
  }

  const endExclusive = new Date(now);
  let start = startOfBusinessDay(now);
  if (preset === '7d') start = startOfBusinessDay(new Date(now.getTime() - 6 * MS_PER_DAY));
  if (preset === '30d') start = startOfBusinessDay(new Date(now.getTime() - 29 * MS_PER_DAY));
  if (preset === '90d') start = startOfBusinessDay(new Date(now.getTime() - 89 * MS_PER_DAY));
  if (preset === '3months') {
    const d = new Date(now); d.setUTCMonth(d.getUTCMonth() - 3); start = d;
  }
  if (preset === '1year') {
    const d = new Date(now); d.setUTCFullYear(d.getUTCFullYear() - 1); start = d;
  }
  return { preset, start, endExclusive };
}

function canonicalReviewerFilters(params = {}) {
  const search = String(params.search ?? params.q ?? '').trim();
  return {
    search,
    category: params.category || DEFAULT_FILTERS.category,
    country: params.country || DEFAULT_FILTERS.country,
    state: params.state || DEFAULT_FILTERS.state,
    status: params.status || DEFAULT_FILTERS.status,
    workflowStatus: params.workflowStatus || DEFAULT_FILTERS.workflowStatus,
    datePreset: params.datePreset || DEFAULT_FILTERS.datePreset,
    startDate: params.startDate || '',
    endDate: params.endDate || '',
  };
}

function workflowStatusClause(value, now = new Date()) {
  const groups = {
    total: null,
    submitted: { status: 'Submitted' },
    underReview: { status: { $in: ['Under Review', 'Document Verification', 'Compliance Check'] } },
    queryRaised: { status: 'Query Raised' },
    approved: { status: { $in: ['Approved', 'Partially Approved'] } },
    rejected: { status: 'Rejected' },
    unknown: { status: { $nin: [
      'Draft', 'Submitted', 'Under Review', 'Document Verification', 'Compliance Check',
      'Query Raised', 'Approved', 'Partially Approved', 'Rejected',
    ] } },
  };
  if (value === 'overdue') {
    return {
      status: { $in: ['Submitted', 'Under Review', 'Document Verification', 'Compliance Check', 'Query Raised'] },
      $expr: {
        $lt: [
          { $ifNull: ['$submittedAt', '$createdAt'] },
          new Date(now.getTime() - REVIEW_SLA_DAYS * MS_PER_DAY),
        ],
      },
    };
  }
  if (!(value in groups)) throw new Error('Invalid workflowStatus.');
  return groups[value];
}

function buildReviewerFilter(params, now = new Date()) {
  const applied = canonicalReviewerFilters(params);
  const dateRange = resolveDateRange(applied, now);
  const clauses = [{ isDraft: false }];

  if (applied.status !== 'All') clauses.push({ status: applied.status });
  const workflow = workflowStatusClause(applied.workflowStatus, now);
  if (workflow) clauses.push(workflow);
  if (applied.category !== 'All') clauses.push({ exportCategory: applied.category });

  if (applied.country !== 'All') {
    // Match every accepted spelling, so selecting the canonical ISO name still
    // finds records stored as "UK" or "South Korea".
    const spellings = countrySpellings(applied.country);
    const exactCountry = new RegExp(`^(${spellings.map(escapeRegex).join('|')})$`, 'i');
    clauses.push({
      $or: [
        { destinationCountry: exactCountry },
        { consigneeCountry: exactCountry },
        { 'consignees.country': exactCountry },
      ],
    });
  }

  if (applied.state !== 'All States') {
    const state = new RegExp(`^${escapeRegex(applied.state.trim())}$`, 'i');
    clauses.push({ $or: [{ state }, { city: state }, { factoryAddress: state }] });
  }

  if (applied.search) {
    const q = new RegExp(escapeRegex(applied.search), 'i');
    clauses.push({
      $or: [
        { applicationNumber: q }, { referenceNumber: q }, { applicantName: q },
        { applicantOrganization: q }, { email: q }, { mfgLicenseNo: q },
      ],
    });
  }

  if (dateRange.start) {
    clauses.push({
      $expr: {
        $and: [
          { $gte: [{ $ifNull: ['$submittedAt', '$createdAt'] }, dateRange.start] },
          { $lt: [{ $ifNull: ['$submittedAt', '$createdAt'] }, dateRange.endExclusive] },
        ],
      },
    });
  }

  return {
    filter: clauses.length === 1 ? clauses[0] : { $and: clauses },
    dateRange,
    appliedFilters: applied,
  };
}

function csvCell(value) {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function applicationsToCsv(applications, queryCounts = new Map()) {
  const headers = [
    'Application ID', 'Reference ID', 'Applicant / Company', 'Country',
    'Submission Date', 'Current Status', 'Query Count', 'Approval Date', 'Rejection Date',
  ];
  const rows = applications.map(app => {
    const countries = [
      app.destinationCountry,
      app.consigneeCountry,
      ...(app.consignees || []).map(c => c.country),
    ].filter(Boolean);
    const submitted = app.submittedAt || app.createdAt;
    const count = queryCounts.get(String(app._id)) ?? app.queryCount ?? 0;
    const statusDate = (status, explicit) => {
      if (explicit) return new Date(explicit).toISOString();
      const dates = [
        ...(app.reviewerRemarks || [])
          .filter(remark => remark.status === status && remark.timestamp)
          .map(remark => new Date(remark.timestamp)),
        ...(app.auditLog || [])
          .filter(entry => entry.timestamp && String(entry.detail || '').includes(status))
          .map(entry => new Date(entry.timestamp)),
      ].filter(date => !Number.isNaN(date.getTime())).sort((a, b) => b - a);
      return dates[0]?.toISOString() || '';
    };
    return [
      app.applicationNumber,
      app.referenceNumber,
      app.applicantOrganization || app.applicantName,
      [...new Set(countries)].join('; '),
      submitted ? new Date(submitted).toISOString() : '',
      app.status,
      count,
      statusDate('Approved', app.approvedAt),
      statusDate('Rejected', app.rejectedAt),
    ];
  });
  return `\uFEFF${[headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}`;
}

function exportFilename(dateRange, country, now = new Date()) {
  const exportDate = now.toISOString().slice(0, 10);
  let period = dateRange.preset;
  if (period === 'custom') period = `${dateRange.startDate}_to_${dateRange.endDate}`;
  if (period === 'all') period = 'all-dates';
  const countryPart = country && country !== 'All'
    ? `_${country.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
    : '';
  return `reviewer-applications_${period}${countryPart}_exported-${exportDate}.csv`;
}

module.exports = {
  applicationsToCsv,
  buildReviewerFilter,
  canonicalReviewerFilters,
  DEFAULT_FILTERS,
  exportFilename,
  resolveDateRange,
  workflowStatusClause,
};
