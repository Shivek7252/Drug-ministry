/* ============================================================================
   Business timezone and period boundaries (server side).

   Mirrors frontend/src/config/businessTime.js. Week boundaries are computed
   HERE, not on the client, so every reviewer sees the same "this week" no
   matter what their machine's clock is set to.

   All boundary arithmetic goes through Intl with an explicit timeZone. Never
   apply a manual UTC offset: IST is +05:30 today, but hand-rolled offsets are
   how date bugs are born.
   ============================================================================ */

const BUSINESS_TIMEZONE = 'Asia/Kolkata';
const BUSINESS_TIMEZONE_LABEL = 'IST';

/* Weeks run Monday 00:00 IST to Sunday 24:00 IST. Documented as an assumption:
   no official CDSCO reporting-week definition was found in the repository. */
const WEEK_STARTS_ON = 1;   // 1 = Monday (Date.getDay convention)

const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: BUSINESS_TIMEZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hour12: false, weekday: 'short',
});

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function toValidDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Wall-clock fields of `date` as seen in the business timezone. */
function businessParts(date) {
  const out = {};
  for (const p of partsFmt.formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = p.value;
  }
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour) % 24,   // Intl can emit hour 24 for midnight
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: WEEKDAY_INDEX[out.weekday],
  };
}

/**
 * The UTC instant of business-timezone midnight on the calendar day of `date`.
 * Derived by measuring the zone's actual offset at that instant rather than
 * assuming one, so it stays correct if the zone rule ever changes.
 */
function startOfBusinessDay(date) {
  const p = businessParts(date);
  const naiveUtc = Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0);
  /* Offset = how far the zone is ahead of UTC at this moment. */
  const probe = new Date(naiveUtc);
  const probeParts = businessParts(probe);
  const probeNaive = Date.UTC(
    probeParts.year, probeParts.month - 1, probeParts.day,
    probeParts.hour, probeParts.minute, probeParts.second,
  );
  const offsetMs = probeNaive - naiveUtc;
  return new Date(naiveUtc - offsetMs);
}

/** Start of the business-timezone week containing `date`. */
function startOfBusinessWeek(date) {
  const p = businessParts(date);
  const back = (p.weekday - WEEK_STARTS_ON + 7) % 7;
  const dayStart = startOfBusinessDay(date);
  return startOfBusinessDay(new Date(dayStart.getTime() - back * 86400000));
}

/**
 * The two comparison windows, as half-open intervals [from, to).
 * A boundary instant belongs to the LATER window, so no event is counted twice
 * and none falls between the two.
 */
function weekWindows(now = new Date()) {
  const currentFrom = startOfBusinessWeek(now);
  const priorFrom = startOfBusinessWeek(new Date(currentFrom.getTime() - 1));
  const elapsed = Math.max(0, now.getTime() - currentFrom.getTime());
  return {
    current: { from: currentFrom, to: now },
    /* Compare like with like. On Monday at 10:15 the prior window ends at
       10:15 on the previous Monday, not at the end of the previous Sunday. */
    prior: { from: priorFrom, to: new Date(priorFrom.getTime() + elapsed) },
    timezone: BUSINESS_TIMEZONE,
    weekStartsOn: 'Monday',
    label: 'Week to date vs same period last week.',
  };
}

/** Half-open membership test: from <= value < to. */
function inWindow(value, { from, to }) {
  const d = toValidDate(value);
  if (!d) return false;
  return d.getTime() >= from.getTime() && d.getTime() < to.getTime();
}

module.exports = {
  BUSINESS_TIMEZONE,
  BUSINESS_TIMEZONE_LABEL,
  WEEK_STARTS_ON,
  toValidDate,
  businessParts,
  startOfBusinessDay,
  startOfBusinessWeek,
  weekWindows,
  inWindow,
};
