/* ============================================================================
   Canonical workflow-status model.

   ONE normalisation function, shared by the KPI tiles, the charts, the table
   and anything else that reasons about status. Previously each surface tested
   raw enum strings inline, so a status could be counted by one and missed by
   another.

   Unknown or malformed statuses are surfaced as UNKNOWN rather than silently
   dropped — an application with a status nobody recognises is a data problem
   that must be visible, not an application that quietly disappears from every
   count.
   ============================================================================ */

export const STATUS = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  IN_REVIEW: 'IN_REVIEW',
  QUERY_RAISED: 'QUERY_RAISED',
  APPROVED: 'APPROVED',
  PARTIALLY_APPROVED: 'PARTIALLY_APPROVED',
  REJECTED: 'REJECTED',
  UNKNOWN: 'UNKNOWN',
};

/* Raw persisted enum → canonical. Document Verification and Compliance Check
   are mid-review stages with no tile of their own and normalise to IN_REVIEW. */
const RAW_TO_CANONICAL = new Map([
  ['draft', STATUS.DRAFT],
  ['submitted', STATUS.SUBMITTED],
  ['under review', STATUS.IN_REVIEW],
  ['document verification', STATUS.IN_REVIEW],
  ['compliance check', STATUS.IN_REVIEW],
  ['query raised', STATUS.QUERY_RAISED],
  ['approved', STATUS.APPROVED],
  ['partially approved', STATUS.PARTIALLY_APPROVED],
  ['rejected', STATUS.REJECTED],
]);

export function normalizeStatus(raw) {
  const direct = String(raw ?? '').trim().toUpperCase();
  if (Object.values(STATUS).includes(direct)) return direct;
  const key = String(raw ?? '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  if (!key) return STATUS.UNKNOWN;
  return RAW_TO_CANONICAL.get(key) || STATUS.UNKNOWN;
}

/* A decision has been recorded; the application has left the queue. */
export const TERMINAL = new Set([STATUS.APPROVED, STATUS.PARTIALLY_APPROVED, STATUS.REJECTED]);

/* Still needs reviewer action or an applicant response. Query Raised IS
   non-terminal: the application is parked, not finished. */
export const NON_TERMINAL = new Set([
  STATUS.SUBMITTED, STATUS.IN_REVIEW, STATUS.QUERY_RAISED,
]);

export const isTerminal = app => TERMINAL.has(normalizeStatus(app?.status));
export const isNonTerminal = app => NON_TERMINAL.has(normalizeStatus(app?.status));
export const isUnknownStatus = app => normalizeStatus(app?.status) === STATUS.UNKNOWN;

/* ---- SLA -------------------------------------------------------------------
   The project had no SLA rule; 15 days was an unexplained literal. It is named
   and documented here as the single source.

   SLA_DAYS is measured from submission and does NOT pause while an application
   is held at query — a query that goes unanswered is exactly the ageing this
   metric exists to surface. Change the value here, not at call sites.
   -------------------------------------------------------------------------- */
export const SLA_DAYS = 15;
export const SLA_BASIS = 'submittedAt';
export const SLA_DESCRIPTION =
  `Open more than ${SLA_DAYS} days since submission. The clock does not pause while held at query.`;

/** Human label for a canonical status, for display and data tables. */
export const STATUS_LABEL = {
  [STATUS.DRAFT]: 'Draft',
  [STATUS.SUBMITTED]: 'Submitted',
  [STATUS.IN_REVIEW]: 'In Review',
  [STATUS.QUERY_RAISED]: 'Query Raised',
  [STATUS.APPROVED]: 'Approved',
  [STATUS.PARTIALLY_APPROVED]: 'Partially Approved',
  [STATUS.REJECTED]: 'Rejected',
  [STATUS.UNKNOWN]: 'Unrecognised status',
};
