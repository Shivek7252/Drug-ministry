import {
  STATUS, normalizeStatus, isNonTerminal, SLA_DAYS,
} from './statusModel';
import { canonicalName, countryDisplayLabel, isInvalidCountryValue } from '../../../data/countries';

/* ============================================================================
   Pure aggregation functions for the reviewer analytics panel.

   Every function takes the already-filtered application array and returns
   plain data. No fetching, no React, no formatting decisions beyond labels —
   so each one is directly unit-testable and the charts stay presentational.
   ============================================================================ */

/* The reviewer pipeline is strictly ordered. 'Query Raised' is deliberately
   ABSENT: it is an off-pipeline hold, not a stage an application advances
   through, and placing it in the funnel would double-count. */
export const PIPELINE = [
  { key: 'Submitted', label: 'Submitted' },
  { key: 'Under Review', label: 'Under Review' },
  { key: 'Document Verification', label: 'Document Verification' },
  { key: 'Compliance Check', label: 'Compliance Check' },
  { key: 'Decided', label: 'Decided' },
];

const DECIDED = ['Approved', 'Partially Approved', 'Rejected'];
const OPEN_STATES = ['Submitted', 'Under Review', 'Document Verification', 'Compliance Check', 'Query Raised'];

export const OVERDUE_DAYS = SLA_DAYS;   // re-exported; defined in statusModel

export const ROWS_PER_PAGE_OPTIONS = [10, 25, 50, 100];

export const IN_REVIEW_STATES = ['Under Review', 'Document Verification', 'Compliance Check'];

/* ---- small helpers ------------------------------------------------------ */

const asDate = v => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const daysBetween = (from, to = Date.now()) => {
  const d = asDate(from);
  if (!d) return null;
  return Math.floor((to - d.getTime()) / 86400000);
};

const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

const startOfWeek = d => {           // ISO-ish: weeks begin Monday
  const x = startOfDay(d);
  const shift = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - shift);
  return x;
};

const startOfMonth = d => { const x = startOfDay(d); x.setDate(1); return x; };

const bucketStart = (date, granularity) =>
  granularity === 'month' ? startOfMonth(date)
    : granularity === 'week' ? startOfWeek(date)
      : startOfDay(date);

const isoKey = d => d.toISOString().slice(0, 10);

/** Rank of a status within the pipeline; -1 for statuses off the pipeline. */
export function pipelineRank(status) {
  if (DECIDED.includes(status)) return PIPELINE.length - 1;
  const i = PIPELINE.findIndex(s => s.key === status);
  return i;
}

export const isDecided = app => DECIDED.includes(app.status);
export const isOpen = app => OPEN_STATES.includes(app.status);

/** Decision timestamp for a disposed application, or null while open.
 *
 *  Keyed off the CURRENT status, not date presence. The reviewer flow sets
 *  approvedAt on approve and rejectedAt on reject and never clears the other,
 *  so an application approved and later rejected carries both. Preferring
 *  approvedAt unconditionally would report the superseded date and bucket the
 *  decision into the wrong day/week. Live data already contains one such row. */
export function decidedAt(app) {
  if (!isDecided(app)) return null;
  return app.status === 'Rejected'
    ? asDate(app.rejectedAt) || asDate(app.updatedAt)
    : asDate(app.approvedAt) || asDate(app.updatedAt);
}

/** Turnaround in days: submission → decision, or → today while still open. */
export function turnaroundDays(app) {
  const from = asDate(app.submittedAt) || asDate(app.createdAt);
  if (!from) return null;
  const to = decidedAt(app);
  return Math.max(0, Math.floor(((to ? to.getTime() : Date.now()) - from.getTime()) / 86400000));
}

export function isOverdue(app, now = Date.now()) {
  // Non-terminal only: approved, partially approved and rejected applications
  // are finished and can never be overdue. Query Raised IS included — it is a
  // hold, not a completion, and unanswered queries are exactly the ageing this
  // metric exists to surface (see SLA_DESCRIPTION in statusModel).
  if (!isNonTerminal(app)) return false;
  const age = daysBetween(app.submittedAt || app.createdAt, now);
  return age !== null && age > SLA_DAYS;
}

/* ---- 1. Submission trend: received vs disposed -------------------------- */

export function submissionTrend(apps, { granularity = 'day', days = 90 } = {}) {
  const since = startOfDay(Date.now() - days * 86400000);
  const buckets = new Map();

  const touch = key => {
    if (!buckets.has(key)) buckets.set(key, { key, received: 0, disposed: 0 });
    return buckets.get(key);
  };

  // Seed every bucket in range so gaps render as zero rather than collapsing.
  for (let d = bucketStart(since, granularity); d <= new Date(); ) {
    touch(isoKey(d));
    if (granularity === 'month') d.setMonth(d.getMonth() + 1);
    else if (granularity === 'week') d.setDate(d.getDate() + 7);
    else d.setDate(d.getDate() + 1);
  }

  for (const app of apps) {
    const sub = asDate(app.submittedAt) || asDate(app.createdAt);
    if (sub && sub >= since) touch(isoKey(bucketStart(sub, granularity))).received += 1;
    const dec = decidedAt(app);
    if (dec && dec >= since) touch(isoKey(bucketStart(dec, granularity))).disposed += 1;
  }

  return [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/* ---- 2. Status distribution -------------------------------------------- */

export function statusDistribution(apps) {
  const counts = new Map();
  for (const app of apps) {
    const s = app.status || 'Draft';
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  const total = apps.length;
  return [...counts.entries()]
    .map(([status, value]) => ({
      status,
      value,
      share: total ? value / total : 0,
    }))
    .sort((a, b) => b.value - a.value);
}

/* ---- 3. Processing time: aging buckets + median ------------------------- */

export const TAT_BUCKETS = [
  { key: '0-3', label: '0–3 days', min: 0, max: 3 },
  { key: '4-7', label: '4–7 days', min: 4, max: 7 },
  { key: '8-15', label: '8–15 days', min: 8, max: 15 },
  { key: '16-30', label: '16–30 days', min: 16, max: 30 },
  { key: '30+', label: 'Over 30 days', min: 31, max: Infinity },
];

export function processingTime(apps) {
  const rows = TAT_BUCKETS.map(b => ({ ...b, value: 0 }));
  const durations = [];

  for (const app of apps) {
    const t = turnaroundDays(app);
    if (t === null) continue;
    durations.push(t);
    const hit = rows.find(b => t >= b.min && t <= b.max);
    if (hit) hit.value += 1;
  }

  durations.sort((a, b) => a - b);
  const median = durations.length
    ? (durations.length % 2
      ? durations[(durations.length - 1) / 2]
      : Math.round((durations[durations.length / 2 - 1] + durations[durations.length / 2]) / 2))
    : null;

  const total = durations.length;
  return {
    rows: rows.map(r => ({ ...r, share: total ? r.value / total : 0 })),
    median,
    counted: total,
  };
}

/* ---- 4/5/6. Simple descending counts ------------------------------------ */

function countBy(apps, pick, { limit = 0, othersLabel = 'Others' } = {}) {
  const counts = new Map();
  for (const app of apps) {
    const raw = pick(app);
    const key = (raw === undefined || raw === null || String(raw).trim() === '')
      ? 'Not specified'
      : String(raw).trim();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const total = apps.length;
  let rows = [...counts.entries()]
    .map(([label, value]) => ({ label, value, share: total ? value / total : 0 }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));

  if (limit && rows.length > limit) {
    const head = rows.slice(0, limit);
    const tailValue = rows.slice(limit).reduce((s, r) => s + r.value, 0);
    rows = [...head, { label: othersLabel, value: tailValue, share: total ? tailValue / total : 0 }];
  }
  return rows;
}

export const categoryMix = apps => countBy(apps, a => a.exportCategory);

/* Invalid legacy values are labelled rather than shown as a country, so the
   affected records stay visible and auditable without implying validity. */
export const destinationCountries = apps =>
  countBy(apps, a => {
    const raw = a.destinationCountry || a.consigneeCountry;
    return isInvalidCountryValue(raw) ? countryDisplayLabel(raw) : canonicalName(raw);
  }, { limit: 8 });


/* ---- 7. Cumulative pipeline funnel -------------------------------------
   "Reached stage N or beyond" — so a decided application still counts at
   every prior stage. Current status is a position, not a history, and this
   is the only sound reading of it.

   TODO: when auditLog transition history is exposed on the reviewer list
   endpoint, replace this with a true time-based funnel measuring how long
   each application actually spent in each stage.
   ------------------------------------------------------------------------ */

export function pipelineFunnel(apps) {
  const stages = PIPELINE.map((stage, idx) => {
    const value = apps.filter(app => {
      const rank = pipelineRank(app.status);
      // 'Query Raised' is a hold, not a stage, so it is never its own bar.
      // It is still counted at the stages it has provably cleared: a query can
      // only be raised from the review screen, so such an application has
      // reached Submitted and Under Review, and no further. Stating the rule
      // here because the number must be explainable on request.
      if (rank === -1) return app.status === 'Query Raised' && idx <= 1;
      return rank >= idx;
    }).length;
    return { key: stage.key, label: stage.label, value };
  });

  const entry = stages[0]?.value || 0;
  return stages.map((s, i) => {
    const prev = i === 0 ? null : stages[i - 1].value;
    const dropOff = prev === null ? null : prev - s.value;
    return {
      ...s,
      share: entry ? s.value / entry : 0,
      dropOff,
      dropOffShare: prev ? (dropOff / prev) : null,
    };
  });
}

/** Off-pipeline hold, rendered beside the funnel rather than inside it. */
export function queryHold(apps) {
  const held = apps.filter(a => a.status === 'Query Raised').length;
  return { held, share: apps.length ? held / apps.length : 0, total: apps.length };
}

/* ---- 8. Decision throughput by week ------------------------------------- */

export function decisionThroughput(apps, { weeks = 12 } = {}) {
  const since = startOfWeek(Date.now() - (weeks - 1) * 7 * 86400000);
  const buckets = new Map();

  for (let d = new Date(since); d <= new Date(); d.setDate(d.getDate() + 7)) {
    buckets.set(isoKey(startOfWeek(d)), {
      key: isoKey(startOfWeek(d)),
      approved: 0, partiallyApproved: 0, rejected: 0, pending: 0,
    });
  }

  for (const app of apps) {
    const dec = decidedAt(app);
    if (dec && dec >= since) {
      const row = buckets.get(isoKey(startOfWeek(dec)));
      if (row) {
        if (app.status === 'Approved') row.approved += 1;
        else if (app.status === 'Partially Approved') row.partiallyApproved += 1;
        else if (app.status === 'Rejected') row.rejected += 1;
      }
      continue;
    }
    // Still open: attribute to the week it was submitted so backlog is visible.
    const sub = asDate(app.submittedAt) || asDate(app.createdAt);
    if (sub && sub >= since) {
      const row = buckets.get(isoKey(startOfWeek(sub)));
      if (row) row.pending += 1;
    }
  }

  return [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/* ---- KPI tiles ----------------------------------------------------------
   Each tile is a predicate over barFiltered. Defined here rather than in the
   hook so presentational components can use them without importing routing.
   -------------------------------------------------------------------------- */
export const KPI_TILES = [
  { key: 'total', label: 'Total', token: 'total', match: () => true },
  // Renamed from "New": this is a workflow status, not reviewer read state.
  // Unread is reported separately and comes from the read-receipt API.
  { key: 'submitted', label: 'Submitted', token: 'submitted', match: a => normalizeStatus(a.status) === STATUS.SUBMITTED },
  { key: 'underReview', label: 'In Review', token: 'review', match: a => normalizeStatus(a.status) === STATUS.IN_REVIEW },
  { key: 'queryRaised', label: 'Query', token: 'query', match: a => normalizeStatus(a.status) === STATUS.QUERY_RAISED },
  {
    key: 'approved',
    label: 'Approved',
    token: 'approved',
    match: a => [STATUS.APPROVED, STATUS.PARTIALLY_APPROVED].includes(normalizeStatus(a.status)),
  },
  { key: 'rejected', label: 'Rejected', token: 'rejected', match: a => normalizeStatus(a.status) === STATUS.REJECTED },
  // Wrapped deliberately: Array.filter passes (element, index), and isOverdue
  // takes an optional clock as its second argument. Passing it bare made the
  // index the clock and zeroed the tile.
  { key: 'overdue', label: 'Overdue', token: 'overdue', match: a => isOverdue(a) },
];

/* Applications whose status matches nothing we recognise. Surfaced so a data
   problem is visible rather than silently missing from every tile. */
export const unknownStatusApps = apps =>
  apps.filter(a => normalizeStatus(a.status) === STATUS.UNKNOWN);

/* ---- KPI counts ---------------------------------------------------------- */

export function kpiCounts(apps) {
  // Derived from KPI_TILES so the number on a tile is always the number of
  // rows that tile would show. One predicate, two uses.
  return Object.fromEntries(
    KPI_TILES.map(tile => [tile.key, apps.filter(tile.match).length])
  );
}

/** The tile whose predicate covers a given status — used by donut clicks. */
export function tileForStatus(status) {
  const hit = KPI_TILES.find(t => t.key !== 'total' && t.match({ status }));
  return hit ? hit.key : 'total';
}

/* ----------------------------------------------------------------------------
   Review-queue row sorting. Lives here rather than in useReviewQueue so it can
   be unit-tested: that hook imports react-router-dom, which the CRA jest
   resolver cannot resolve for v7. Same reason KPI_TILES moved here.
   -------------------------------------------------------------------------- */
export const SORT_ACCESSORS = {
  application: a => a.applicationNumber || '',
  applicant: a => (a.applicantOrganization || a.applicantName || '').toLowerCase(),
  // Full millisecond timestamp, not the formatted date, so two rows on the
  // same day still order by the time they were received.
  submitted: a => new Date(a.submittedAt || a.createdAt || 0).getTime(),
  queries: a => a.queryCount || 0,
  status: a => a.status || '',
};

export function sortRows(rows, key, dir) {
  const accessor = SORT_ACCESSORS[key];
  if (!accessor) return rows;
  const factor = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = accessor(a);
    const bv = accessor(b);
    if (av < bv) return -1 * factor;
    if (av > bv) return 1 * factor;
    return 0;
  });
}
