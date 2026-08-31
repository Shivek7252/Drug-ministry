/* ============================================================================
   Reviewer analytics: transitions, windows, SLA and availability.

   Pure-unit throughout — buildAnalytics takes plain objects, so every case
   below (including ones this database does not contain yet, like Partially
   Approved and multiple query cycles) is exercised deterministically with a
   fixed `now`.
   ============================================================================ */

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildAnalytics, percentChange, direction } = require('../services/reviewerAnalytics');
const {
  transitionEvents, parseAuditTransition, statusAsOf, historyComplete, dedupe,
  recordStatusTransition,
} = require('../services/transitionEvents');
const { STATUS, normalizeStatus } = require('../services/statusModel');
const { weekWindows, startOfBusinessWeek, businessParts } = require('../config/businessTime');
const { REVIEW_SLA_DAYS, dueAt } = require('../config/reviewSla');

/* Monday 31 Aug 2026, 08:00 IST. Current week = Mon 31 Aug onward.
   Previous week = Mon 24 Aug 00:00 IST .. Mon 31 Aug 00:00 IST. */
const NOW = new Date('2026-08-31T02:30:00.000Z');
const WINDOW = weekWindows(NOW);
const priorAt = hours => new Date(WINDOW.prior.from.getTime() + hours * 3600000).toISOString();

const audit = (from, to, iso) => ({
  action: 'reviewer_action',
  detail: `Status: ${from} → ${to}. Remarks: test`,
  timestamp: new Date(iso),
});

const app = (over = {}) => ({
  _id: over.applicationNumber || 'A1',
  applicationNumber: 'A1',
  status: 'Submitted',
  submittedAt: new Date('2026-08-01T06:00:00.000Z'),
  auditLog: [],
  ...over,
});

const analytics = (apps, opts = {}) =>
  buildAnalytics(apps, opts.queries || new Map(), opts.read || new Set(), opts.now || NOW);

/* ---- Audit parsing ------------------------------------------------------- */

test('a status transition is parsed from the audit detail', () => {
  const t = parseAuditTransition(audit('Submitted', 'Under Review', '2026-08-26T06:00:00Z'));
  assert.equal(t.from, STATUS.SUBMITTED);
  assert.equal(t.to, STATUS.IN_REVIEW);
  assert.equal(t.source, 'auditLog');
  assert.equal(t.derived, false);
});

test('an ASCII arrow parses too, and a non-transition entry does not', () => {
  const ascii = parseAuditTransition({
    action: 'reviewer_action', detail: 'Status: Submitted -> Approved.', timestamp: new Date(),
  });
  assert.equal(ascii.to, STATUS.APPROVED);
  assert.equal(parseAuditTransition({ action: 'submitted', detail: 'x', timestamp: new Date() }), null);
  assert.equal(parseAuditTransition({ action: 'reviewer_action', detail: 'no status here', timestamp: new Date() }), null);
});

test('structured transition fields take precedence over legacy text parsing', () => {
  const entry = {
    action: 'status_transition', fromStatus: 'Approved', toStatus: 'Rejected',
    occurredAt: new Date(priorAt(1)), actorId: 'user-1', detail: 'not parseable',
  };
  const parsed = parseAuditTransition(entry);
  assert.equal(parsed.from, STATUS.APPROVED);
  assert.equal(parsed.to, STATUS.REJECTED);
  assert.equal(parsed.source, 'structuredAudit');
  assert.equal(parsed.actorId, 'user-1');
});

test('new workflow writes record all structured transition fields', () => {
  const target = app({ auditLog: [] });
  recordStatusTransition(target, {
    fromStatus: 'Submitted', toStatus: 'Under Review',
    occurredAt: new Date(priorAt(1)), actorId: 'user-1', actorName: 'Officer',
    action: 'reviewer_action', remarks: 'Started review',
  });
  const entry = target.auditLog[0];
  for (const key of ['applicationId', 'fromStatus', 'toStatus', 'occurredAt', 'actorId', 'action', 'remarks']) {
    assert.ok(entry[key], `${key} missing`);
  }
});

/* ---- Every transition the workflow allows -------------------------------- */

const TRANSITIONS = [
  ['Submitted', 'Under Review', STATUS.IN_REVIEW],
  ['Under Review', 'Query Raised', STATUS.QUERY_RAISED],
  ['Query Raised', 'Under Review', STATUS.IN_REVIEW],
  ['Query Raised', 'Approved', STATUS.APPROVED],
  ['Approved', 'Rejected', STATUS.REJECTED],
  ['Rejected', 'Approved', STATUS.APPROVED],
  ['Under Review', 'Partially Approved', STATUS.PARTIALLY_APPROVED],
  ['Submitted', 'Rejected', STATUS.REJECTED],
];

for (const [from, to, expected] of TRANSITIONS) {
  test(`transition ${from} -> ${to} is recorded`, () => {
    const events = transitionEvents(app({ auditLog: [audit(from, to, '2026-08-26T06:00:00Z')] }));
    assert.equal(events.length, 1);
    assert.equal(events[0].to, expected);
    assert.equal(events[0].from, normalizeStatus(from));
  });
}

/* ---- Current status vs historical event ---------------------------------- */

test('an approval that was later rejected does not count as a current approval', () => {
  const a = app({
    status: 'Rejected',
    auditLog: [
      audit('Submitted', 'Approved', priorAt(1)),
      audit('Approved', 'Rejected', priorAt(2)),
    ],
  });
  const out = analytics([a]);
  assert.equal(out.current.approved, 0, 'current approved must follow the latest status');
  assert.equal(out.current.rejected, 1);
  /* ...but the approval still happened last week and must be reported. */
  assert.equal(out.activity.prior.approved, 1, 'the historical approval must survive');
  assert.equal(out.activity.prior.rejected, 1);
});

test('a rejection that was later approved does not count as a current rejection', () => {
  const a = app({
    status: 'Approved',
    approvedAt: new Date(priorAt(2)),
    rejectedAt: new Date(priorAt(1)),
    auditLog: [
      audit('Submitted', 'Rejected', priorAt(1)),
      audit('Rejected', 'Approved', priorAt(2)),
    ],
  });
  const out = analytics([a]);
  assert.equal(out.current.rejected, 0);
  assert.equal(out.current.approved, 1);
  assert.equal(out.activity.prior.rejected, 1, 'the historical rejection must survive');
  assert.equal(out.activity.prior.approved, 1);
});

test('Partially Approved counts under Approved, both current and as activity', () => {
  const a = app({
    status: 'Partially Approved',
    auditLog: [audit('Under Review', 'Partially Approved', priorAt(1))],
  });
  const out = analytics([a]);
  assert.equal(out.current.approved, 1);
  assert.equal(out.activity.prior.approved, 1);
});

/* ---- Duplicates and repeated cycles -------------------------------------- */

test('multiple query cycles in one week count the application once', () => {
  const a = app({
    status: 'Query Raised',
    auditLog: [
      audit('Submitted', 'Query Raised', priorAt(1)),
      audit('Query Raised', 'Under Review', priorAt(2)),
      audit('Under Review', 'Query Raised', priorAt(3)),
      audit('Query Raised', 'Under Review', priorAt(4)),
      audit('Under Review', 'Query Raised', priorAt(5)),
    ],
  });
  const out = analytics([a]);
  assert.equal(out.activity.prior.queryRaised, 1, 'three query cycles are still one application');
  assert.equal(out.activity.prior.underReview, 1);
  assert.equal(out.current.queryRaised, 1);
});

test('a duplicated transition record is collapsed', () => {
  const at = '2026-08-26T06:00:00Z';
  const events = dedupe(transitionEvents(app({
    auditLog: [audit('Submitted', 'Approved', at), audit('Submitted', 'Approved', at)],
  })));
  assert.equal(events.length, 1);
});

test('approvedAt does not double-count an approval the audit log already records', () => {
  const a = app({
    status: 'Approved',
    approvedAt: new Date('2026-08-26T06:00:00Z'),
    auditLog: [audit('Submitted', 'Approved', '2026-08-26T06:00:00Z')],
  });
  const events = transitionEvents(a);
  assert.equal(events.filter(e => e.to === STATUS.APPROVED).length, 1);
  assert.equal(events[0].source, 'auditLog', 'the richer record must win');
});

test('approvedAt DOES supply an event the audit log is missing, marked derived', () => {
  const a = app({ status: 'Approved', approvedAt: new Date('2026-08-26T06:00:00Z'), auditLog: [] });
  const events = transitionEvents(a);
  assert.equal(events.length, 1);
  assert.equal(events[0].to, STATUS.APPROVED);
  assert.equal(events[0].derived, true, 'a filled gap must be labelled as derived');
  assert.equal(events[0].source, 'approvedAt');
});

test('queries from the query collection are counted once per application', () => {
  const queries = new Map([['A1', [
    { createdAt: new Date(priorAt(1)) },
    { createdAt: new Date(priorAt(3)), responseAt: new Date(priorAt(4)) },
  ]]]);
  const out = analytics([app({ status: 'Query Raised' })], { queries });
  assert.equal(out.activity.prior.queryRaised, 1);
});

/* ---- statusAsOf / history completeness ----------------------------------- */

test('status as of a past instant replays the chain', () => {
  const a = app({
    status: 'Approved',
    auditLog: [
      audit('Submitted', 'Under Review', '2026-08-20T06:00:00Z'),
      audit('Under Review', 'Approved', '2026-08-27T06:00:00Z'),
    ],
  });
  const ev = transitionEvents(a);
  assert.equal(statusAsOf(a, ev, new Date('2026-08-15T00:00:00Z')), STATUS.SUBMITTED);
  assert.equal(statusAsOf(a, ev, new Date('2026-08-22T00:00:00Z')), STATUS.IN_REVIEW);
  assert.equal(statusAsOf(a, ev, new Date('2026-08-28T00:00:00Z')), STATUS.APPROVED);
});

test('an application with no transitions has complete history', () => {
  const a = app({ status: 'Submitted' });
  assert.equal(historyComplete(a, transitionEvents(a)), true);
});

test('a chain that does not reach the stored status is incomplete', () => {
  const a = app({ status: 'Approved', auditLog: [audit('Submitted', 'Under Review', '2026-08-20T06:00:00Z')] });
  assert.equal(historyComplete(a, transitionEvents(a)), false);
});

test('incomplete history makes history-dependent comparisons unavailable, not zero', () => {
  const a = app({ status: 'Approved', auditLog: [audit('Submitted', 'Under Review', '2026-08-20T06:00:00Z')] });
  const out = analytics([a]);
  assert.equal(out.comparison.approved.available, false);
  assert.equal(out.comparison.approved.reason, 'Historical data unavailable');
  assert.ok(out.comparison.approved.affected.includes('A1'));
  /* Submission-based metrics never needed history, so they stay available. */
  assert.equal(out.comparison.total.available, true);
  /* And the CURRENT count is still correct. */
  assert.equal(out.current.approved, 1);
});

/* ---- Week windows and timezone ------------------------------------------- */

test('weeks start Monday 00:00 in the business timezone', () => {
  const start = startOfBusinessWeek(NOW);
  const p = businessParts(start);
  assert.equal(p.weekday, 1, 'week must start on a Monday');
  assert.equal(p.hour, 0);
  assert.equal(p.minute, 0);
  assert.equal(start.toISOString(), '2026-08-30T18:30:00.000Z', 'Mon 31 Aug 00:00 IST');
});

test('the window boundary is half-open: it belongs to the current week', () => {
  const w = weekWindows(NOW);
  const onBoundary = app({ submittedAt: w.current.from });
  const priorBoundary = app({ applicationNumber: 'A2', _id: 'A2', submittedAt: w.prior.from });
  const out = analytics([onBoundary, priorBoundary]);
  assert.equal(out.activity.current.submitted, 1);
  assert.equal(out.activity.prior.submitted, 1);
});

test('the unmatched remainder of last week is excluded from a fair WTD comparison', () => {
  const a = app({ submittedAt: new Date(WINDOW.current.from.getTime() - 1) });
  const out = analytics([a]);
  assert.equal(out.activity.prior.submitted, 0);
  assert.equal(out.activity.current.submitted, 0);
});

test('the prior comparison window is half-open at the elapsed-time boundary', () => {
  const inside = app({ submittedAt: new Date(WINDOW.prior.to.getTime() - 1) });
  const outside = app({ applicationNumber: 'A2', _id: 'A2', submittedAt: WINDOW.prior.to });
  const out = analytics([inside, outside]);
  assert.equal(out.activity.prior.submitted, 1);
});

test('an event outside both windows contributes to neither', () => {
  const out = analytics([app({ submittedAt: new Date('2026-07-01T06:00:00Z') })]);
  assert.equal(out.activity.current.submitted, 0);
  assert.equal(out.activity.prior.submitted, 0);
});

/* ---- SLA / overdue ------------------------------------------------------- */

test('dueAt is submittedAt plus the configured SLA, with no hardcoded 15', () => {
  const a = app({ submittedAt: new Date('2026-08-01T00:00:00Z') });
  const expected = new Date(a.submittedAt.getTime() + REVIEW_SLA_DAYS * 86400000);
  assert.equal(dueAt(a).toISOString(), expected.toISOString());
});

test('the SLA boundary is exclusive: exactly at dueAt is not yet overdue', () => {
  const submittedAt = new Date(NOW.getTime() - REVIEW_SLA_DAYS * 86400000);
  const atBoundary = analytics([app({ submittedAt })]);
  assert.equal(atBoundary.current.overdue, 0, 'exactly at the boundary is not overdue');

  const oneMsPast = analytics([app({ submittedAt: new Date(submittedAt.getTime() - 1) })]);
  assert.equal(oneMsPast.current.overdue, 1, 'one millisecond past is overdue');
});

test('terminal applications are never overdue however old', () => {
  const old = new Date('2026-01-01T00:00:00Z');
  for (const status of ['Approved', 'Partially Approved', 'Rejected']) {
    const out = analytics([app({
      status, submittedAt: old,
      auditLog: [audit('Submitted', status, '2026-01-05T00:00:00Z')],
    })]);
    assert.equal(out.current.overdue, 0, `${status} must not be overdue`);
  }
});

test('a query hold IS overdue — it is a hold, not a completion', () => {
  const out = analytics([app({
    status: 'Query Raised', submittedAt: new Date('2026-01-01T00:00:00Z'),
    auditLog: [audit('Submitted', 'Query Raised', '2026-01-05T00:00:00Z')],
  })]);
  assert.equal(out.current.overdue, 1);
});

test('an application completed BEFORE its due date never became overdue', () => {
  /* Submitted 26 Aug, approved 27 Aug, due 10 Sep — decided well inside SLA. */
  const out = analytics([app({
    status: 'Approved',
    submittedAt: new Date('2026-08-26T00:00:00Z'),
    auditLog: [audit('Submitted', 'Approved', '2026-08-27T00:00:00Z')],
  })]);
  assert.equal(out.current.overdue, 0);
  assert.equal(out.activity.current.overdue, 0);
  assert.equal(out.activity.prior.overdue, 0);
});

test('an application completed AFTER becoming overdue counted as overdue in that week', () => {
  /* Due inside last week, still open at that moment, decided afterwards. */
  const w = weekWindows(NOW);
  const submittedAt = new Date(w.prior.from.getTime() + 3600000 - REVIEW_SLA_DAYS * 86400000);
  const out = analytics([app({
    status: 'Approved',
    submittedAt,
    auditLog: [audit('Submitted', 'Approved', NOW.toISOString())],
  })]);
  assert.equal(out.activity.prior.overdue, 1, 'it did become overdue last week');
  assert.equal(out.current.overdue, 0, 'but it is finished now');
});

test('an application already terminal when its SLA expired did not become overdue', () => {
  const w = weekWindows(NOW);
  const submittedAt = new Date(w.prior.from.getTime() + 86400000 - REVIEW_SLA_DAYS * 86400000);
  const out = analytics([app({
    status: 'Approved',
    submittedAt,
    /* Approved long before the due date fell in last week. */
    auditLog: [audit('Submitted', 'Approved', new Date(submittedAt.getTime() + 3600000).toISOString())],
  })]);
  assert.equal(out.activity.prior.overdue, 0);
});

/* ---- Unread -------------------------------------------------------------- */

test('unread is reviewer-specific and independent of workflow status', () => {
  const a = app({ applicationNumber: 'A1', _id: 'A1', status: 'Approved' });
  const b = app({ applicationNumber: 'A2', _id: 'A2', status: 'Submitted' });
  const out = analytics([a, b], { read: new Set(['A1']) });
  assert.equal(out.unread.count, 1);
  assert.deepEqual(out.unread.applicationNumbers, ['A2']);
  /* An approved application is unread until opened — status does not imply read. */
  const none = analytics([a, b], { read: new Set() });
  assert.equal(none.unread.count, 2);
});

test('Submitted and Unread are different numbers', () => {
  const a = app({ applicationNumber: 'A1', _id: 'A1', status: 'Approved' });
  const b = app({ applicationNumber: 'A2', _id: 'A2', status: 'Submitted' });
  const out = analytics([a, b], { read: new Set(['A2']) });
  assert.equal(out.current.submitted, 1);
  assert.equal(out.unread.count, 1);
  assert.deepEqual(out.unread.applicationNumbers, ['A1'], 'unread is not the submitted set');
});

/* ---- Counting and shape -------------------------------------------------- */

test('counts are unique per application id', () => {
  const out = analytics([
    app({ applicationNumber: 'A1', _id: 'X' }),
    app({ applicationNumber: 'A2', _id: 'X' }),   // same id: one application
  ]);
  assert.equal(out.current.total, 1);
});

test('percent change omits a percentage when there is no baseline', () => {
  assert.equal(percentChange(3, 0), null);
  assert.equal(percentChange(3, 2), 50);
  assert.equal(percentChange(1, 2), -50);
  assert.equal(direction(2, 2), 'flat');
  assert.equal(direction(3, 2), 'up');
  assert.equal(direction(1, 2), 'down');
});

test('the payload carries a generation timestamp, the timezone and the SLA basis', () => {
  const out = analytics([app()]);
  assert.ok(Date.parse(out.generatedAt));
  assert.equal(out.timezone, 'Asia/Kolkata');
  assert.equal(out.sla.days, REVIEW_SLA_DAYS);
  assert.equal(out.sla.confirmed, false, 'the SLA is an assumption until business confirms it');
  assert.equal(out.windows.currentWeekComplete, false);
});

test('an empty dataset produces zeros, not errors', () => {
  const out = analytics([]);
  assert.equal(out.current.total, 0);
  assert.equal(out.unread.count, 0);
  assert.equal(out.history.complete, true);
});

test('every KPI has a stated current and activity definition', () => {
  const out = analytics([app()]);
  for (const d of out.definitions) {
    assert.ok(d.current && d.current.length > 10, `${d.key} needs a current definition`);
    assert.ok(d.activity && d.activity.length > 10, `${d.key} needs an activity definition`);
  }
});
