/* ============================================================================
   Canonical workflow-status model (server side).

   Deliberately mirrors frontend/src/pages/reviewer/dashboard/statusModel.js.
   The two are held identical by tests/statusModelParity.test.js, which loads
   the frontend module and compares the mapping entry by entry — the same
   technique used for the country data. If one side gains a status and the
   other does not, the build fails rather than the two surfaces silently
   disagreeing about what an application is.
   ============================================================================ */

const STATUS = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  IN_REVIEW: 'IN_REVIEW',
  QUERY_RAISED: 'QUERY_RAISED',
  APPROVED: 'APPROVED',
  PARTIALLY_APPROVED: 'PARTIALLY_APPROVED',
  REJECTED: 'REJECTED',
  UNKNOWN: 'UNKNOWN',
};

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

function normalizeStatus(raw) {
  const direct = String(raw ?? '').trim().toUpperCase();
  if (Object.values(STATUS).includes(direct)) return direct;
  const key = String(raw ?? '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  if (!key) return STATUS.UNKNOWN;
  return RAW_TO_CANONICAL.get(key) || STATUS.UNKNOWN;
}

const TERMINAL = new Set([STATUS.APPROVED, STATUS.PARTIALLY_APPROVED, STATUS.REJECTED]);
const NON_TERMINAL = new Set([STATUS.SUBMITTED, STATUS.IN_REVIEW, STATUS.QUERY_RAISED]);

const isTerminalStatus = s => TERMINAL.has(s);
const isNonTerminalStatus = s => NON_TERMINAL.has(s);

const isTerminal = app => TERMINAL.has(normalizeStatus(app?.status));
const isNonTerminal = app => NON_TERMINAL.has(normalizeStatus(app?.status));

const STATUS_LABEL = {
  [STATUS.DRAFT]: 'Draft',
  [STATUS.SUBMITTED]: 'Submitted',
  [STATUS.IN_REVIEW]: 'In Review',
  [STATUS.QUERY_RAISED]: 'Query Raised',
  [STATUS.APPROVED]: 'Approved',
  [STATUS.PARTIALLY_APPROVED]: 'Partially Approved',
  [STATUS.REJECTED]: 'Rejected',
  [STATUS.UNKNOWN]: 'Unrecognised status',
};

/** Every raw enum string the normaliser recognises, for parity checking. */
const RECOGNISED_RAW_VALUES = [...RAW_TO_CANONICAL.keys()];

module.exports = {
  STATUS,
  RAW_TO_CANONICAL,
  RECOGNISED_RAW_VALUES,
  normalizeStatus,
  TERMINAL,
  NON_TERMINAL,
  isTerminal,
  isNonTerminal,
  isTerminalStatus,
  isNonTerminalStatus,
  STATUS_LABEL,
};
