/* ============================================================================
   Shared chart theme.

   Colours are READ FROM tokens.css at runtime rather than restated here, so
   tokens.css stays the single source and Part 7's "no inline hex" holds. The
   fallback map below is used only when there is no live stylesheet to read
   (jsdom under test, SSR) — it mirrors tokens.css and must be kept in step.
   ============================================================================ */

const FALLBACK = {
  '--chart-1': '#0072B2', '--chart-2': '#E69F00', '--chart-3': '#009E73',
  '--chart-4': '#CC79A7', '--chart-5': '#56B4E9', '--chart-6': '#D55E00',
  '--chart-7': '#6B7C91', '--chart-8': '#8C6D31',
  '--tat-1': '#3B7FB8', '--tat-2': '#7FA9CE', '--tat-3': '#D9A441',
  '--tat-4': '#C9702F', '--tat-5': '#A82F29',
  '--chart-grid': '#DCE3EB', '--chart-axis': '#6B7C91', '--chart-ref': '#3A4757',
  '--surface-card': '#FFFFFF',
  '--elev-overlay': '0 8px 24px rgba(22, 28, 36, 0.16)',
  '--st-submitted-fg': '#1D4ED8', '--st-review-fg': '#003580',
  '--st-query-fg': '#B45309', '--st-approved-fg': '#15803D',
  '--st-rejected-fg': '#B91C1C', '--st-draft-fg': '#6B7C91',
};

const cache = new Map();

export function token(name) {
  if (cache.has(name)) return cache.get(name);
  let value = '';
  if (typeof window !== 'undefined' && typeof getComputedStyle === 'function') {
    value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  const resolved = value || FALLBACK[name] || FALLBACK['--chart-7'];
  cache.set(name, resolved);
  return resolved;
}

/** Call after a theme change so the next read re-resolves. */
export const clearTokenCache = () => cache.clear();

export const seriesColors = () =>
  ['--chart-1', '--chart-2', '--chart-3', '--chart-4',
    '--chart-5', '--chart-6', '--chart-7', '--chart-8'].map(token);

export const tatRamp = () =>
  ['--tat-1', '--tat-2', '--tat-3', '--tat-4', '--tat-5'].map(token);

/* Status → the SAME token its KPI tile and status pill use. */
const STATUS_TOKEN = {
  'Submitted': '--st-submitted-fg',
  'Under Review': '--st-review-fg',
  'Document Verification': '--chart-5',
  'Compliance Check': '--chart-3',
  'Query Raised': '--st-query-fg',
  'Approved': '--st-approved-fg',
  'Partially Approved': '--chart-3',
  'Rejected': '--st-rejected-fg',
  'Draft': '--st-draft-fg',
};

export const statusColor = status => token(STATUS_TOKEN[status] || '--st-draft-fg');

/* ---- Formatters --------------------------------------------------------- */

export const fmtInt = n => Number(n || 0).toLocaleString('en-IN');

export const fmtPct = share =>
  `${(Number(share || 0) * 100).toFixed(Number(share) >= 0.1 ? 0 : 1)}%`;

/** "12 (34%)" — tooltips must always carry absolute value AND share. */
export const fmtValueWithShare = (value, share) =>
  `${fmtInt(value)} (${fmtPct(share)})`;

export const fmtDateKey = (key, granularity = 'day') => {
  const d = new Date(key);
  if (Number.isNaN(d.getTime())) return key;
  if (granularity === 'month') {
    return d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
  }
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
};

/* ---- Shared recharts props ---------------------------------------------- */

export const axisProps = () => ({
  stroke: token('--chart-axis'),
  tick: { fill: token('--chart-axis'), fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: token('--chart-grid') },
});

export const gridProps = () => ({
  stroke: token('--chart-grid'),
  strokeDasharray: '2 4',
  vertical: false,
});

export const tooltipProps = () => ({
  cursor: { fill: token('--chart-grid'), fillOpacity: 0.35 },
  contentStyle: {
    background: token('--surface-card'),
    border: `1px solid ${token('--chart-grid')}`,
    borderRadius: 6,
    fontSize: 12,
    boxShadow: token('--elev-overlay'),   // overlay — the one place shadow is allowed
    padding: '8px 10px',
  },
  labelStyle: { fontWeight: 700, marginBottom: 4 },
});

/** Area fills are a 10% wash — no gradients beyond that (chart rules). */
export const AREA_FILL_OPACITY = 0.1;

export const CHART_HEIGHT = { standard: 240, tall: 280 };
