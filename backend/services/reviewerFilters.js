const ALLOWED_PRESETS = new Set(['all', '3months', '1year', 'custom']);

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseIsoDate(value, endOfDay = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const date = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return date;
}

function resolveDateRange(params, now = new Date()) {
  const preset = params.datePreset || 'all';
  if (!ALLOWED_PRESETS.has(preset)) throw new Error('Invalid datePreset.');
  if (preset === 'all') return { preset, start: null, end: null };

  if (preset === 'custom') {
    const start = parseIsoDate(params.startDate);
    const end = parseIsoDate(params.endDate, true);
    if (!start || !end) throw new Error('Custom date range requires valid startDate and endDate values.');
    if (start > end) throw new Error('startDate cannot be after endDate.');
    return { preset, start, end };
  }

  const end = new Date(now);
  const start = new Date(now);
  if (preset === '3months') start.setUTCMonth(start.getUTCMonth() - 3);
  if (preset === '1year') start.setUTCFullYear(start.getUTCFullYear() - 1);
  return { preset, start, end };
}

function buildReviewerFilter(params, now = new Date()) {
  const dateRange = resolveDateRange(params, now);
  const clauses = [{ isDraft: false }];

  if (params.status && params.status !== 'All') clauses.push({ status: params.status });
  if (params.category && params.category !== 'All') clauses.push({ exportCategory: params.category });

  if (params.country && params.country !== 'All') {
    const exactCountry = new RegExp(`^${escapeRegex(params.country.trim())}$`, 'i');
    clauses.push({
      $or: [
        { destinationCountry: exactCountry },
        { consigneeCountry: exactCountry },
        { 'consignees.country': exactCountry },
      ],
    });
  }

  if (params.state && params.state !== 'All States') {
    const state = new RegExp(escapeRegex(params.state.trim()), 'i');
    clauses.push({ $or: [{ state }, { city: state }, { factoryAddress: state }] });
  }

  if (params.q && params.q.trim()) {
    const q = new RegExp(escapeRegex(params.q.trim()), 'i');
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
          { $lte: [{ $ifNull: ['$submittedAt', '$createdAt'] }, dateRange.end] },
        ],
      },
    });
  }

  return { filter: clauses.length === 1 ? clauses[0] : { $and: clauses }, dateRange };
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
  if (period === 'custom') period = `${dateRange.start.toISOString().slice(0, 10)}_to_${dateRange.end.toISOString().slice(0, 10)}`;
  if (period === 'all') period = 'all-dates';
  const countryPart = country && country !== 'All'
    ? `_${country.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
    : '';
  return `reviewer-applications_${period}${countryPart}_exported-${exportDate}.csv`;
}

module.exports = {
  applicationsToCsv,
  buildReviewerFilter,
  exportFilename,
  resolveDateRange,
};
