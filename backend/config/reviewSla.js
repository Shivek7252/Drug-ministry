/* ============================================================================
   Review SLA configuration.

   ⚠ ASSUMPTION, NOT AN OFFICIAL RULE.

   The repository contains no CDSCO service-standard document, no policy
   constant, and no migration defining a review SLA. The value 15 appeared as
   an unexplained literal in the dashboard. It is preserved here at the same
   value so no behaviour changes, but it is now named, documented and
   configurable rather than hidden.

   Every item below needs business confirmation before this can be called a
   real SLA. Each is listed with the assumption currently in force:

     duration        REVIEW_SLA_DAYS = 15
     day type        CALENDAR days, not business days
     start           submittedAt (first submission; not re-based on resubmit)
     query holds     the clock does NOT pause while awaiting an applicant reply
     weekends        counted
     public holidays counted
     terminal states Approved / Partially Approved / Rejected stop the clock
     cancelled       no cancelled state exists in the schema today

   Override with the REVIEW_SLA_DAYS environment variable. Change the default
   here, never at a call site.
   ============================================================================ */

const parsed = Number.parseInt(process.env.REVIEW_SLA_DAYS, 10);

/** Days from submission before an open application is overdue. */
const REVIEW_SLA_DAYS = Number.isFinite(parsed) && parsed > 0 ? parsed : 15;

/** Which timestamp starts the clock. */
const REVIEW_SLA_BASIS = 'submittedAt';

/** Calendar days vs business days. */
const REVIEW_SLA_DAY_TYPE = 'calendar';

/** Whether time spent awaiting an applicant response is excluded. */
const REVIEW_SLA_PAUSES_ON_QUERY = false;

const REVIEW_SLA_DESCRIPTION =
  `Open more than ${REVIEW_SLA_DAYS} calendar days after ${REVIEW_SLA_BASIS}. `
  + 'The clock does not pause while an application is held at query, and weekends '
  + 'and public holidays are counted. Assumption pending business confirmation.';

const MS_PER_DAY = 86400000;

/**
 * The instant an application becomes overdue, or null when it has no usable
 * start timestamp. Overdue is strictly AFTER this instant, so an application
 * exactly at the boundary is not yet overdue.
 */
function dueAt(app) {
  const raw = app?.[REVIEW_SLA_BASIS] ?? app?.createdAt;
  if (!raw) return null;
  const start = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(start.getTime())) return null;
  return new Date(start.getTime() + REVIEW_SLA_DAYS * MS_PER_DAY);
}

module.exports = {
  REVIEW_SLA_DAYS,
  REVIEW_SLA_BASIS,
  REVIEW_SLA_DAY_TYPE,
  REVIEW_SLA_PAUSES_ON_QUERY,
  REVIEW_SLA_DESCRIPTION,
  MS_PER_DAY,
  dueAt,
};
