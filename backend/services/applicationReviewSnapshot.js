/* ============================================================================
   applicationReviewSnapshot.js

   Builds the internal review snapshot the reviewer confirms when marking an
   application Under Review, and normalises what they submit back.

   Scope is the WHOLE application, not one document. Every observation is
   derived from the stored record via the existing buildApplicationSummary
   projection — checklist requirements, uploaded documents and their cached
   verification results, product approval/prohibition checks, shipments and
   destinations, and the existing AIQ query history. Nothing is invented: a row
   only exists where the summary already states a deficiency.

   Rows are exceptions only. Successful checks are reported through the compact
   metrics instead, so a clean application produces an empty table rather than
   dozens of "OK" lines.

   This module knows nothing about ApplicationQuery. The Under Review action is
   a status transition with an internal snapshot, never a query.
   ============================================================================ */

const { normalizeStatus, STATUS } = require('./statusModel');
const { isValidCountry } = require('./countryValidation');

const MAX_TEXT = 2000;
const MAX_ROWS = 60;

/* Built from strings so this source file never carries literal control bytes. */
const CONTROL_CHARS = new RegExp('[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]', 'g');
const HORIZONTAL_SPACE = new RegExp('[^\\S\\n]+', 'g');

const REVIEW_AREAS = Object.freeze(['Application', 'Document', 'Product', 'Shipment', 'Compliance', 'Query']);

const DEFAULT_APPLICANT_MESSAGE =
  'Your application has been taken up for review. The submitted information and supporting '
  + 'documents are currently being examined. No action is required unless a separate query is raised.';

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function sanitize(value) {
  return text(value)
    .replace(CONTROL_CHARS, ' ')
    .replace(HORIZONTAL_SPACE, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_TEXT);
}

function normaliseKey(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/* ── Status transition rules ─────────────────────────────────────────────────
   Approved and Rejected are final: no reopening workflow exists for them, so
   the action is refused rather than silently rewinding a decision. A draft has
   not reached a reviewer at all.

   Partially Approved is deliberately allowed: the reviewer page already offers
   Under Review for that status, so it is an existing authorised path back into
   review rather than a new one introduced here. */
const ENTRY_STATUSES = new Set([
  STATUS.SUBMITTED,
  STATUS.IN_REVIEW,
  STATUS.QUERY_RAISED,
  STATUS.PARTIALLY_APPROVED,
]);

function underReviewTransition(currentStatus) {
  const canonical = normalizeStatus(currentStatus);
  if (canonical === STATUS.IN_REVIEW) {
    // Already in review: the reviewer may refresh their notes, but the status
    // transition (and its audit entry) must not be written twice.
    return { allowed: true, alreadyUnderReview: true, reason: '' };
  }
  if (!ENTRY_STATUSES.has(canonical)) {
    return {
      allowed: false,
      alreadyUnderReview: false,
      reason: canonical === STATUS.DRAFT
        ? 'A draft application has not been submitted for review.'
        : `An application that is ${currentStatus} cannot be moved back to Under Review.`,
    };
  }
  return { allowed: true, alreadyUnderReview: false, reason: '' };
}

/* ── Metrics ─────────────────────────────────────────────────────────────────
   The compact counters shown above the table. Successful checks live here so
   they do not each become a row. */
function buildMetrics(summary, app, queries) {
  const documents = summary.documents || [];
  const requirements = summary.requirements || [];
  const progress = summary.executive?.progress || null;
  const applicable = requirements.filter(item => item.state !== 'not_applicable');
  const complete = applicable.filter(item => item.state === 'available').length;
  const shipments = Array.isArray(app.shipments) ? app.shipments : [];
  const openQueries = (queries || []).filter(q => String(q.status || 'Open') !== 'Closed'
    && String(q.status || 'Open') !== 'Responded').length;

  return {
    compliancePercent: applicable.length ? Math.round((complete / applicable.length) * 100) : null,
    complianceComplete: complete,
    complianceTotal: applicable.length,
    documentsUploaded: documents.length,
    documentsExpected: requirements.length || documents.length,
    aiVerified: documents.filter(doc => doc.state === 'verified').length,
    aiFlagged: documents.filter(doc => doc.state === 'needs_review').length,
    shipments: shipments.length,
    openQueries,
    totalQueries: (queries || []).length,
    progressText: progress?.text || '',
  };
}

/* ── Observation rows ───────────────────────────────────────────────────────
   Ordered most-severe first so the reviewer reads what matters at the top. */
const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };

function buildRows(summary, app, queries, metrics) {
  const raw = [];
  const add = row => raw.push(row);

  /* 1. Application-level: an overdue review target is a real, stored fact. */
  const overview = summary.application?.overview || {};
  if (overview.targetIsOverdue) {
    add({
      area: 'Application', item: 'Review target date', entityId: 'review-target',
      severity: 'high',
      aiObservation: `The configured review target date has passed${overview.ageDays != null ? ` (submitted ${overview.ageDays} days ago)` : ''}.`,
      note: 'Prioritise this application and record a decision without further delay.',
    });
  }

  /* 2. Compliance + document requirements. summary.issues already merges the
        checklist state with the verification verdict for each requirement. */
  (summary.issues || []).forEach(issue => {
    const isMedicine = issue.id.startsWith('medicine-') || issue.id.startsWith('approval-');
    add({
      area: isMedicine ? 'Product' : 'Compliance',
      item: issue.title.replace(/^[^:]+:\s*/, '') || issue.title,
      entityId: issue.id,
      severity: issue.severity === 'high' ? 'high' : 'medium',
      aiObservation: issue.explanation || issue.title,
      note: issue.action || 'Review the evidence and record a decision.',
    });
  });

  /* 3. Documents whose own verification flagged them. */
  (summary.documents || []).forEach(doc => {
    if (doc.state === 'verified') return;
    const severity = doc.state === 'needs_review' ? 'high' : 'medium';
    const observation = doc.explanation
      || (doc.state === 'pending'
        ? 'This upload has not produced an affirmative verification result.'
        : 'The uploaded file could not be verified.');
    add({
      area: 'Document',
      item: `${doc.typeLabel}${doc.name ? ` — ${doc.name}` : ''}`,
      entityId: doc.id,
      severity,
      aiObservation: observation,
      note: doc.state === 'needs_review'
        ? 'Open and inspect the upload; raise a document query if a corrected file is required.'
        : 'Run or re-run AI verification for this upload before deciding.',
    });
  });

  /* 4. Shipment lines still awaiting a reviewer verdict. */
  const shipments = Array.isArray(app.shipments) ? app.shipments : [];
  const pendingLines = shipments.filter(line => {
    const status = text((line?.toObject ? line.toObject() : line)?.lineStatus) || 'Pending';
    return status !== 'Approved' && status !== 'Verified' && status !== 'Rejected';
  });
  if (pendingLines.length) {
    add({
      area: 'Shipment', item: 'Shipment line verification', entityId: 'shipments',
      severity: 'medium',
      aiObservation: `${pendingLines.length} of ${shipments.length} shipment line${shipments.length === 1 ? '' : 's'} ${pendingLines.length === 1 ? 'has' : 'have'} no reviewer verdict recorded.`,
      note: 'Verify each shipment line against the consignee and destination details.',
    });
  }

  /* 5. Destination countries the configured country reference does not know. */
  (summary.application?.destinations || []).forEach((destination, index) => {
    const country = text(destination?.country);
    if (!country || country === 'Destination unavailable') {
      add({
        area: 'Shipment',
        item: `Destination — consignee ${destination?.consignee || index + 1}`,
        entityId: `destination-${destination?.id ?? index}`,
        severity: 'medium',
        aiObservation: 'No destination country is recorded against this consignee.',
        note: 'Obtain the destination country before approving the consignment.',
      });
      return;
    }
    if (isValidCountry(country)) return;
    add({
      area: 'Shipment',
      item: `Destination country — ${country}`,
      entityId: `destination-${destination?.id ?? index}`,
      severity: 'medium',
      aiObservation: `"${country}" is not recognised in the configured country reference.`,
      note: 'Confirm the destination country before approving the consignment.',
    });
  });

  /* 6. Queries the applicant has not answered. */
  const unanswered = (queries || []).filter(q => String(q.status || 'Open') === 'Open');
  if (unanswered.length) {
    add({
      area: 'Query', item: 'Unresolved queries', entityId: 'queries',
      severity: 'high',
      aiObservation: `${unanswered.length} raised quer${unanswered.length === 1 ? 'y is' : 'ies are'} still awaiting an applicant response (${unanswered.map(q => q.queryIdentifier).filter(Boolean).slice(0, 3).join(', ')}).`,
      note: 'Confirm whether the outstanding queries block this review.',
    });
  }

  return finalise(raw, metrics);
}

/* Merge findings that would read as the same observation, keep the more severe
   one, then order by severity and cap the table at a readable length. */
function finalise(rows, metrics) {
  const byItem = new Map();
  const byObservation = new Map();
  const kept = [];
  for (const row of rows) {
    const itemKey = `${row.area}|${normaliseKey(row.item)}`;
    const obsKey = normaliseKey(row.aiObservation);
    const seen = byItem.get(itemKey) || (obsKey && byObservation.get(obsKey));
    if (seen) {
      if (SEVERITY_RANK[row.severity] < SEVERITY_RANK[seen.severity]) seen.severity = row.severity;
      continue;
    }
    const entry = { ...row };
    kept.push(entry);
    byItem.set(itemKey, entry);
    if (obsKey) byObservation.set(obsKey, entry);
  }

  kept.sort((a, b) => (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3));

  const trimmed = kept.slice(0, MAX_ROWS);
  if (kept.length > MAX_ROWS && metrics) metrics.rowsTruncated = kept.length - MAX_ROWS;

  return trimmed.map((row, index) => ({
    order: index + 1,
    area: REVIEW_AREAS.includes(row.area) ? row.area : 'Application',
    item: sanitize(row.item),
    entityId: sanitize(row.entityId),
    severity: row.severity,
    aiObservation: sanitize(row.aiObservation),
    aiNote: sanitize(row.note),
    note: sanitize(row.note),
    edited: false,
    rowSource: 'ai_generated',
  }));
}

/**
 * The complete snapshot for one application.
 * @param summary  buildApplicationSummary() output for this application
 * @param app      the stored application document
 * @param queries  getCompleteQueryHistory() output
 */
function buildReviewSnapshot({ summary, app, queries = [] }) {
  const source = summary || {};
  const record = app || {};
  const metrics = buildMetrics(source, record, queries);
  return { metrics, rows: buildRows(source, record, queries, metrics) };
}

class ReviewRowValidationError extends Error {
  constructor(rowErrors) {
    super('One or more review rows are incomplete.');
    this.name = 'ReviewRowValidationError';
    this.rowErrors = rowErrors;
  }
}

/**
 * Normalise reviewer-submitted rows.
 * An empty table is valid — a clean application needs no observations — but a
 * row that is kept must carry a note.
 * @throws ReviewRowValidationError keyed by the client rowKey
 */
function normalizeReviewRows(rawRows) {
  const input = Array.isArray(rawRows) ? rawRows : [];
  const cleaned = input.slice(0, MAX_ROWS).map((raw, index) => {
    const row = raw && typeof raw === 'object' ? raw : {};
    const rowSource = row.rowSource === 'reviewer_added' ? 'reviewer_added' : 'ai_generated';
    return {
      rowKey: text(row.rowKey) || `row-${index + 1}`,
      area: REVIEW_AREAS.includes(row.area) ? row.area : 'Application',
      item: sanitize(row.item),
      entityId: sanitize(row.entityId),
      severity: ['high', 'medium', 'low'].includes(row.severity) ? row.severity : 'medium',
      aiObservation: sanitize(row.aiObservation),
      aiNote: sanitize(row.aiNote),
      note: sanitize(row.note),
      rowSource,
    };
  });

  // A manual row the reviewer never filled in was never really added.
  const retained = cleaned.filter(row =>
    !(row.rowSource === 'reviewer_added' && !row.note && !row.item && !row.aiObservation));

  const rowErrors = {};
  retained.forEach(row => {
    if (!row.note) rowErrors[row.rowKey] = 'Enter a reviewer note or next action for this observation.';
  });
  if (Object.keys(rowErrors).length) throw new ReviewRowValidationError(rowErrors);

  return retained.map((row, index) => ({
    order: index + 1,
    area: row.area,
    item: row.item,
    entityId: row.entityId,
    severity: row.severity,
    aiObservation: row.aiObservation,
    // Reviewer-added rows have no generated text to preserve.
    aiNote: row.rowSource === 'ai_generated' ? row.aiNote : '',
    note: row.note,
    edited: row.rowSource === 'ai_generated' && !!row.aiNote && row.aiNote !== row.note,
    rowSource: row.rowSource,
  }));
}

/** The applicant-facing message: reviewer-editable, never carrying internals. */
function normalizeApplicantMessage(value) {
  const message = sanitize(value);
  return message || DEFAULT_APPLICANT_MESSAGE;
}

module.exports = {
  buildReviewSnapshot,
  buildMetrics,
  normalizeReviewRows,
  normalizeApplicantMessage,
  underReviewTransition,
  sanitizeReviewText: sanitize,
  DEFAULT_APPLICANT_MESSAGE,
  REVIEW_AREAS,
  ReviewRowValidationError,
};
