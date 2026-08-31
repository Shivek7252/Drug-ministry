/* ============================================================================
   Status-transition events.

   The reviewer dashboard needs to answer "how many applications entered review
   / were approved / were rejected THIS WEEK". That is an event question, and
   it cannot be answered by pairing an application's CURRENT status with an old
   timestamp — EXP-2026-985978 in this database was rejected and then approved,
   so its rejection is a real event that its current status hides.

   This module reconstructs the event stream from sources that already exist:

     1. auditLog entries written by the reviewer action route. Their detail is
        structured: "Status: <from> → <to>. Remarks: <text>". This is the
        primary and most trustworthy source: it records both endpoints of the
        transition and when it happened.
     2. ApplicationQuery documents — createdAt is when a query was raised,
        responseAt when the applicant answered.
     3. approvedAt / rejectedAt denormalised fields, used ONLY to fill a gap
        the audit log does not already cover.

   Nothing is invented. Every event carries the source it came from, and an
   application whose event chain does not reconcile with its current status is
   reported as having incomplete history rather than being silently guessed at.
   ============================================================================ */

const { STATUS, normalizeStatus } = require('./statusModel');

/* "Status: Submitted → Query Raised. Remarks: ..." — the arrow is U+2192.
   The remarks clause is optional; some entries end at the full stop. */
const TRANSITION_RE = /Status:\s*(.+?)\s*(?:→|->)\s*([^.]+?)\s*(?:\.|$)/u;

/** Events within this many ms describing the same target status are one event. */
const DEDUPE_WINDOW_MS = 2000;

const asDate = v => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Parse one audit entry into a transition, or null when it is not one.
 * Returns canonical statuses; an unparseable side becomes UNKNOWN so a
 * malformed entry is visible rather than dropped.
 */
function parseAuditTransition(entry) {
  if (!entry) return null;
  const structuredAt = asDate(entry.occurredAt || entry.timestamp);
  if (entry.fromStatus && entry.toStatus && structuredAt) {
    return {
      from: normalizeStatus(entry.fromStatus),
      to: normalizeStatus(entry.toStatus),
      at: structuredAt,
      source: 'structuredAudit',
      derived: false,
      action: entry.action || 'status_transition',
      actorId: entry.actorId || null,
    };
  }
  if (entry.action !== 'reviewer_action') return null;
  const match = TRANSITION_RE.exec(String(entry.detail || ''));
  const at = asDate(entry.timestamp);
  if (!match || !at) return null;
  return {
    from: normalizeStatus(match[1]),
    to: normalizeStatus(match[2]),
    at,
    source: 'auditLog',
    derived: false,
  };
}

function recordStatusTransition(app, {
  fromStatus = app.status, toStatus, occurredAt = new Date(),
  actorId, actorName, action = 'status_transition', remarks = '', detail,
}) {
  if (!app || !toStatus || normalizeStatus(fromStatus) === normalizeStatus(toStatus)) return null;
  const at = asDate(occurredAt) || new Date();
  const entry = {
    action,
    detail: detail || `Status: ${fromStatus} -> ${toStatus}. Remarks: ${remarks || '—'}`,
    timestamp: at,
    user: actorName || actorId || 'system',
    applicationId: app._id,
    fromStatus,
    toStatus,
    occurredAt: at,
    actorId: actorId ? String(actorId) : undefined,
    remarks: remarks || undefined,
  };
  app.auditLog.push(entry);
  return entry;
}

/**
 * The full ordered event stream for one application.
 *
 * @param {object} app      application document (lean or hydrated)
 * @param {Array}  queries  ApplicationQuery documents for this application
 */
function transitionEvents(app, queries = []) {
  const events = [];

  /* 1. Audit log — the authoritative record of reviewer decisions. */
  for (const entry of app.auditLog || []) {
    const t = parseAuditTransition(entry);
    if (t) events.push(t);
  }

  /* 2. Query lifecycle. A raised query is a transition into QUERY_RAISED even
        when the reviewer route recorded no audit line for it. */
  for (const q of queries) {
    const raisedAt = asDate(q.createdAt);
    if (raisedAt) {
      events.push({
        from: null, to: STATUS.QUERY_RAISED, at: raisedAt,
        source: 'applicationQuery', derived: false, kind: 'queryRaised',
      });
    }
    const respondedAt = asDate(q.responseAt);
    if (respondedAt) {
      events.push({
        from: STATUS.QUERY_RAISED, to: null, at: respondedAt,
        source: 'applicationQuery', derived: false, kind: 'queryResolved',
      });
    }
  }

  /* 3. Denormalised decision timestamps, ONLY where the audit log has no
        transition to that status at that time. These are derived: they record
        that a decision happened but not what it came from. */
  const covers = (status, at) => events.some(
    e => e.to === status && Math.abs(e.at.getTime() - at.getTime()) <= DEDUPE_WINDOW_MS,
  );
  const approvedAt = asDate(app.approvedAt);
  if (approvedAt && !covers(STATUS.APPROVED, approvedAt) && !covers(STATUS.PARTIALLY_APPROVED, approvedAt)) {
    events.push({
      from: null, to: STATUS.APPROVED, at: approvedAt,
      source: 'approvedAt', derived: true,
    });
  }
  const rejectedAt = asDate(app.rejectedAt);
  if (rejectedAt && !covers(STATUS.REJECTED, rejectedAt)) {
    events.push({
      from: null, to: STATUS.REJECTED, at: rejectedAt,
      source: 'rejectedAt', derived: true,
    });
  }

  events.sort((a, b) => a.at - b.at);
  return dedupe(events);
}

/**
 * Collapse repeated records of the same transition. Two events are duplicates
 * when they name the same target status within DEDUPE_WINDOW_MS — that is the
 * audit log and a denormalised field describing one decision, or a route that
 * wrote twice. The non-derived record wins so provenance stays accurate.
 */
function dedupe(events) {
  const kept = [];
  for (const e of events) {
    const twin = kept.find(k => k.to === e.to && k.kind === e.kind
      && Math.abs(k.at.getTime() - e.at.getTime()) <= DEDUPE_WINDOW_MS);
    if (!twin) { kept.push(e); continue; }
    if (twin.derived && !e.derived) Object.assign(twin, e);
  }
  return kept;
}

/**
 * The application's status at an arbitrary past instant.
 *
 * An application with no transitions has held its submission status since it
 * was submitted — that is a fact, not a guess, so history for it is complete.
 * Returns null when `at` precedes submission.
 */
function statusAsOf(app, events, at) {
  const submittedAt = asDate(app.submittedAt) || asDate(app.createdAt);
  const when = at instanceof Date ? at : new Date(at);
  if (!submittedAt || when < submittedAt) return null;

  let status = STATUS.SUBMITTED;
  for (const e of events) {
    if (e.at > when) break;
    if (e.to) status = e.to;
  }
  return status;
}

/**
 * Whether the reconstructed chain reconciles with the stored current status.
 * When it does not, comparisons that depend on past status are reported as
 * unavailable for this application instead of being approximated.
 */
function historyComplete(app, events) {
  const current = normalizeStatus(app.status);
  if (current === STATUS.UNKNOWN) return false;
  const withTarget = events.filter(e => e.to);
  if (withTarget.length === 0) return current === STATUS.SUBMITTED;
  return withTarget[withTarget.length - 1].to === current;
}

/** Distinct application-level event predicates used by the analytics service. */
const enteredStatusIn = (events, status, window) => events.some(
  e => e.to === status && e.at >= window.from && e.at < window.to,
);

const leftStatusIn = (events, status, window) => events.some(
  e => e.from === status && e.at >= window.from && e.at < window.to,
);

module.exports = {
  TRANSITION_RE,
  DEDUPE_WINDOW_MS,
  parseAuditTransition,
  recordStatusTransition,
  transitionEvents,
  dedupe,
  statusAsOf,
  historyComplete,
  enteredStatusIn,
  leftStatusIn,
};
