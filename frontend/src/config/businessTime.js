/* ============================================================================
   Business timezone and timestamp formatting.

   The project had no configured timezone — dates were rendered in whatever zone
   the reviewer's machine happened to be in, so the same application could read
   as two different days for two reviewers. CDSCO operates on Indian Standard
   Time, so that is fixed here as the single business zone.

   Formatting always goes through Intl with an explicit `timeZone`. Never apply
   a manual UTC offset: IST is +05:30 today, but hand-rolled arithmetic is how
   date bugs are born, and Intl already handles it.
   ============================================================================ */

export const BUSINESS_TIMEZONE = 'Asia/Kolkata';
export const BUSINESS_TIMEZONE_LABEL = 'IST';
export const BUSINESS_LOCALE = 'en-IN';

/** Parse to a valid Date, or null. Never substitutes "now" for a bad value. */
export function toValidDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const dateFmt = new Intl.DateTimeFormat(BUSINESS_LOCALE, {
  timeZone: BUSINESS_TIMEZONE, day: '2-digit', month: 'short', year: 'numeric',
});

const timeFmt = new Intl.DateTimeFormat(BUSINESS_LOCALE, {
  timeZone: BUSINESS_TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: true,
});

/** "26 Aug 2026" in the business timezone, or null when unparseable. */
export function formatBusinessDate(value) {
  const d = toValidDate(value);
  return d ? dateFmt.format(d) : null;
}

/** "10:42 AM IST" in the business timezone, or null when unparseable. */
export function formatBusinessTime(value) {
  const d = toValidDate(value);
  if (!d) return null;
  // en-IN can emit a narrow no-break space before am/pm; normalise it and
  // upper-case so the output is stable across engines.
  const t = timeFmt.format(d).replace(/ | /g, ' ').replace(/\b(am|pm)\b/i, m => m.toUpperCase());
  return `${t} ${BUSINESS_TIMEZONE_LABEL}`;
}

/** Both parts at once, with explicit nulls rather than invented values. */
export function formatBusinessDateTime(value) {
  return { date: formatBusinessDate(value), time: formatBusinessTime(value) };
}
