/* ============================================================================
   Reviewer analytics.

   Three separate concepts, never conflated:

     current   how many applications match the tile RIGHT NOW, by latest
               canonical status. EXP-2026-985978 was rejected then approved,
               so it counts once under Approved and not at all under Rejected.

     activity  how many applications had the relevant EVENT inside a window,
               by transition timestamp. The same application still counts as a
               rejection that week, because the rejection genuinely happened.

     compare   activity this week against activity last week, with an explicit
               availability flag. When history cannot support the comparison we
               say so; we never emit a plausible-looking zero.

   Everything is counted per application (a Set of application ids), so an
   application with three query cycles in one week is one "query raised this
   week", not three.
   ============================================================================ */

const { STATUS, normalizeStatus } = require('./statusModel');
const {
  weekWindows, inWindow, startOfBusinessWeek, businessParts,
} = require('../config/businessTime');
const {
  REVIEW_SLA_DAYS, REVIEW_SLA_BASIS, REVIEW_SLA_DAY_TYPE,
  REVIEW_SLA_PAUSES_ON_QUERY, REVIEW_SLA_DESCRIPTION, dueAt,
} = require('../config/reviewSla');
const {
  transitionEvents, statusAsOf, historyComplete, enteredStatusIn,
} = require('./transitionEvents');

/* ---------------------------------------------------------------------------
   KPI definitions. `current` is a predicate over the latest canonical status.
   `activity` names the event that counts toward a weekly total.
   -------------------------------------------------------------------------- */
const KPI_DEFINITIONS = [
  {
    key: 'total',
    label: 'Total',
    current: 'Every application in the filtered set, whatever its status.',
    activity: 'Applications submitted in the window (submittedAt).',
    matches: () => true,
  },
  {
    key: 'submitted',
    label: 'Submitted',
    current: 'Latest status is Submitted — received, not yet picked up.',
    activity: 'Applications submitted in the window (submittedAt).',
    matches: s => s === STATUS.SUBMITTED,
  },
  {
    key: 'underReview',
    label: 'In Review',
    current: 'Latest status is Under Review, Document Verification or Compliance Check.',
    activity: 'Applications that entered review in the window (transition to In Review).',
    matches: s => s === STATUS.IN_REVIEW,
  },
  {
    key: 'queryRaised',
    label: 'Query',
    current: 'Latest status is Query Raised — held awaiting an applicant response.',
    activity: 'Applications that had a query raised in the window, counted once each.',
    matches: s => s === STATUS.QUERY_RAISED,
  },
  {
    key: 'approved',
    label: 'Approved',
    current: 'Latest status is Approved or Partially Approved.',
    activity: 'Applications approved in the window, even if later rejected.',
    matches: s => s === STATUS.APPROVED || s === STATUS.PARTIALLY_APPROVED,
  },
  {
    key: 'rejected',
    label: 'Rejected',
    current: 'Latest status is Rejected.',
    activity: 'Applications rejected in the window, even if later approved.',
    matches: s => s === STATUS.REJECTED,
  },
  {
    key: 'overdue',
    label: 'Overdue',
    current: `Open past the SLA: non-terminal and dueAt is in the past. ${REVIEW_SLA_DESCRIPTION}`,
    activity: 'Applications whose SLA expired in the window while still open.',
    matches: null,   // computed from dueAt, not from status alone
  },
];

/** Percentage change, or null when the prior period was zero. */
function percentChange(current, prior) {
  if (prior === 0) return null;   // "no baseline", never Infinity or 100%
  return Math.round(((current - prior) / prior) * 1000) / 10;
}

function direction(current, prior) {
  if (current === prior) return 'flat';
  return current > prior ? 'up' : 'down';
}

/**
 * Build the analytics payload.
 *
 * @param {Array} apps     FULL filtered application set (not a page). Must
 *                         include auditLog, status, submittedAt, approvedAt,
 *                         rejectedAt — the caller strips it before responding.
 * @param {Map}   queriesByApp  applicationNumber -> ApplicationQuery[]
 * @param {Set}   readSet  applicationNumbers this reviewer has opened
 * @param {Date}  now
 */
function buildAnalytics(apps, queriesByApp = new Map(), readSet = new Set(), now = new Date()) {
  const windows = weekWindows(now);

  /* One pass: derive each application's event stream once. */
  const rows = apps.map(app => {
    const queries = queriesByApp.get(app.applicationNumber) || [];
    const events = transitionEvents(app, queries);
    return {
      id: String(app._id || app.applicationNumber),
      applicationNumber: app.applicationNumber,
      status: normalizeStatus(app.status),
      submittedAt: app.submittedAt,
      dueAt: dueAt(app),
      events,
      complete: historyComplete(app, events),
      app,
    };
  });

  const uniq = predicate => new Set(rows.filter(predicate).map(r => r.id)).size;

  /* ---- current counts: latest canonical status only --------------------- */
  const current = {};
  for (const def of KPI_DEFINITIONS) {
    current[def.key] = def.key === 'overdue'
      ? uniq(r => isOverdueAt(r, now))
      : uniq(r => def.matches(r.status));
  }

  /* ---- activity per window: transition events --------------------------- */
  const activityIn = window => ({
    total: uniq(r => inWindow(r.submittedAt, window)),
    submitted: uniq(r => inWindow(r.submittedAt, window)),
    underReview: uniq(r => enteredStatusIn(r.events, STATUS.IN_REVIEW, window)),
    queryRaised: uniq(r => enteredStatusIn(r.events, STATUS.QUERY_RAISED, window)),
    /* Approved counts Partially Approved; a later rejection does not erase it. */
    approved: uniq(r => enteredStatusIn(r.events, STATUS.APPROVED, window)
      || enteredStatusIn(r.events, STATUS.PARTIALLY_APPROVED, window)),
    rejected: uniq(r => enteredStatusIn(r.events, STATUS.REJECTED, window)),
    /* Became overdue in the window AND was still open when it happened. */
    overdue: uniq(r => r.dueAt && inWindow(r.dueAt, window) && wasOpenAt(r, r.dueAt)),
  });

  const currentActivity = activityIn(windows.current);
  const priorActivity = activityIn(windows.prior);

  /* ---- availability ------------------------------------------------------
     A comparison is trustworthy only when every application that could
     contribute to it has a reconcilable history. Metrics driven purely by
     submittedAt never depend on transition history, so they are always
     available. */
  const incomplete = rows.filter(r => !r.complete);
  const historyDependent = new Set(['underReview', 'queryRaised', 'approved', 'rejected', 'overdue']);

  const comparison = {};
  for (const def of KPI_DEFINITIONS) {
    const cur = currentActivity[def.key];
    const pri = priorActivity[def.key];
    const needsHistory = historyDependent.has(def.key);
    const available = !needsHistory || incomplete.length === 0;
    comparison[def.key] = available
      ? {
        available: true,
        current: cur,
        prior: pri,
        delta: cur - pri,
        percent: percentChange(cur, pri),
        direction: direction(cur, pri),
        basis: def.activity,
      }
      : {
        available: false,
        reason: 'Historical data unavailable',
        detail: `${incomplete.length} application(s) have no reconcilable status history, `
          + 'so a previous-period figure cannot be reconstructed truthfully.',
        affected: incomplete.slice(0, 20).map(r => r.applicationNumber),
      };
  }

  /* ---- unread: reviewer-specific, never derived from workflow status ---- */
  const unreadIds = rows.filter(r => !readSet.has(r.applicationNumber));
  const unread = {
    count: unreadIds.length,
    definition: 'Applications in the filtered set this reviewer has not opened. '
      + 'Independent of workflow status: an Approved application is unread until opened.',
    applicationNumbers: unreadIds.map(r => r.applicationNumber),
  };

  return {
    generatedAt: now.toISOString(),
    timezone: windows.timezone,
    windows: {
      current: { from: windows.current.from.toISOString(), to: windows.current.to.toISOString() },
      prior: { from: windows.prior.from.toISOString(), to: windows.prior.to.toISOString() },
      weekStartsOn: windows.weekStartsOn,
      label: windows.label,
      boundaries: 'Half-open [from, to). A boundary instant belongs to the later window.',
      /* The current week is almost always partial. Without this the UI would
         read a Monday-morning "-100%" as a collapse rather than as a week that
         has barely started. */
      currentWeekComplete: false,
      currentWeekElapsedFraction: Math.min(1, Math.max(0,
        (windows.current.to - windows.current.from)
        / (windows.current.from.getTime() - windows.prior.from.getTime()))),
    },
    scope: { applications: rows.length, countedBy: 'unique application id' },
    sla: {
      days: REVIEW_SLA_DAYS,
      basis: REVIEW_SLA_BASIS,
      dayType: REVIEW_SLA_DAY_TYPE,
      pausesOnQuery: REVIEW_SLA_PAUSES_ON_QUERY,
      description: REVIEW_SLA_DESCRIPTION,
      confirmed: false,
    },
    definitions: KPI_DEFINITIONS.map(({ key, label, current: c, activity }) => ({
      key, label, current: c, activity,
    })),
    current,
    activity: { current: currentActivity, prior: priorActivity },
    comparison,
    unread,
    history: {
      complete: incomplete.length === 0,
      incompleteCount: incomplete.length,
      incompleteApplications: incomplete.slice(0, 20).map(r => r.applicationNumber),
    },
  };
}

function businessDateKey(value) {
  const p = businessParts(value);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function buildEventChartActivity(apps, queriesByApp = new Map(), now = new Date()) {
  const currentWeek = startOfBusinessWeek(now);
  const firstWeek = new Date(currentWeek.getTime() - 11 * 7 * 86400000);
  const throughput = new Map();
  for (let i = 0; i < 12; i += 1) {
    const start = new Date(firstWeek.getTime() + i * 7 * 86400000);
    const key = businessDateKey(start);
    throughput.set(key, { key, approved: 0, partiallyApproved: 0, rejected: 0, pending: 0 });
  }
  const decisions = new Map();
  const disposed = { day: new Map(), week: new Map(), month: new Map() };
  const seen = new Set();
  for (const app of apps) {
    const appId = String(app._id || app.applicationNumber);
    const events = transitionEvents(app, queriesByApp.get(app.applicationNumber) || []);
    for (const event of events) {
      if (![STATUS.APPROVED, STATUS.PARTIALLY_APPROVED, STATUS.REJECTED].includes(event.to)) continue;
      const day = businessDateKey(event.at);
      const week = businessDateKey(startOfBusinessWeek(event.at));
      const month = `${day.slice(0, 7)}-01`;
      const target = event.to === STATUS.REJECTED ? 'rejected'
        : event.to === STATUS.PARTIALLY_APPROVED ? 'partiallyApproved' : 'approved';
      for (const [granularity, key] of Object.entries({ day, week, month })) {
        const dedupeKey = `${appId}:${target}:${granularity}:${key}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        disposed[granularity].set(key, (disposed[granularity].get(key) || 0) + 1);
      }
      if (throughput.has(week)) {
        const decisionKey = `${appId}:${target}:${week}`;
        if (!decisions.has(decisionKey)) {
          decisions.set(decisionKey, true);
          throughput.get(week)[target] += 1;
        }
      }
    }
    const status = normalizeStatus(app.status);
    const submittedAt = app.submittedAt || app.createdAt;
    if ([STATUS.SUBMITTED, STATUS.IN_REVIEW, STATUS.QUERY_RAISED].includes(status) && submittedAt) {
      const week = businessDateKey(startOfBusinessWeek(submittedAt));
      if (throughput.has(week)) throughput.get(week).pending += 1;
    }
  }
  return {
    decisionThroughput: [...throughput.values()],
    disposed: Object.fromEntries(Object.entries(disposed).map(([key, map]) => [
      key, [...map.entries()].map(([period, value]) => ({ key: period, value })),
    ])),
  };
}

/** Overdue right now: non-terminal and past dueAt. */
function isOverdueAt(row, now) {
  if (!row.dueAt) return false;
  if (row.status !== STATUS.SUBMITTED && row.status !== STATUS.IN_REVIEW
      && row.status !== STATUS.QUERY_RAISED) return false;
  return row.dueAt.getTime() < (now instanceof Date ? now.getTime() : now);
}

/** Was the application still open (non-terminal) at `at`? */
function wasOpenAt(row, at) {
  const past = statusAsOf(row.app, row.events, at);
  return past === STATUS.SUBMITTED || past === STATUS.IN_REVIEW || past === STATUS.QUERY_RAISED;
}

module.exports = {
  KPI_DEFINITIONS,
  buildAnalytics,
  buildEventChartActivity,
  percentChange,
  direction,
  isOverdueAt,
  wasOpenAt,
};
