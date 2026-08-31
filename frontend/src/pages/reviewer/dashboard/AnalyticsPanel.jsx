import React, { useCallback, useEffect, useState } from 'react';
import Icon from '../../../components/ui/Icon';
import { AnalyticsContext } from './charts/ChartCard';
import './AnalyticsPanel.css';

/* ============================================================================
   AnalyticsPanel — collapsible 12-column analytics region.

   Open by default (this is an oversight console; the charts are the point).
   Collapse state persists per browser. Below 1024px the grid becomes a single
   column and the panel defaults collapsed on first visit.

   Charts are children; this component owns layout, disclosure and the
   truncation warning only.
   ============================================================================ */

const KEY = 'reviewer_analytics_open';
const NARROW = '(max-width: 1023px)';

function readInitialOpen() {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
  } catch { /* private mode */ }
  // No stored preference: open on desktop, collapsed on narrow viewports.
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return !window.matchMedia(NARROW).matches;
  }
  return true;
}

export default function AnalyticsPanel({
  truncated = false,
  truncationLimit = 2000,
  loading = false,
  resultCount = 0,
  filtered = false,
  stale = false,
  error = '',
  generatedAt = null,
  children,
}) {
  const [open, setOpen] = useState(readInitialOpen);

  useEffect(() => {
    try { localStorage.setItem(KEY, String(open)); } catch { /* private mode */ }
  }, [open]);

  const toggle = useCallback(() => setOpen(v => !v), []);

  return (
    <AnalyticsContext.Provider value={{ truncated }}>
      <section className="ap" aria-labelledby="ap-heading">
        <header className="ap-head">
          <button
            type="button"
            className="ap-disclosure"
            onClick={toggle}
            aria-expanded={open}
            aria-controls="ap-grid"
          >
            <Icon name={open ? 'chevronUp' : 'chevronDown'} size={18} />
            <span id="ap-heading">Analytics</span>
          </button>

          {/* When nothing is filtered the count duplicates the table footer's
              range line, so name the scope instead. Under an active filter the
              number is genuinely informative here, so it is shown. */}
          <p className="ap-scope tnum">
            {loading
              ? 'Computing…'
              : filtered
                ? `Derived from ${resultCount.toLocaleString('en-IN')} matching application${resultCount === 1 ? '' : 's'}`
                : 'Derived from all applications in the review queue'}
          </p>
        </header>

        {open && stale && generatedAt && (
          <div className="ap-stale" role="status">
            <Icon name="alertTriangle" size={18} />
            <div>
              <strong>Showing the last successful analytics snapshot.</strong>{' '}
              Refresh failed{error ? `: ${error}` : '.'} Generated{' '}
              <time dateTime={generatedAt}>{new Date(generatedAt).toLocaleString('en-IN')}</time>.
            </div>
          </div>
        )}

        {open && !stale && error && (
          <div className="ap-error" role="alert">
            <Icon name="alertTriangle" size={18} />
            <div><strong>Analytics unavailable.</strong> {error}</div>
          </div>
        )}

        {open && truncated && (
          <div className="ap-truncated" role="alert">
            <Icon name="alertTriangle" size={18} />
            <div>
              <strong>
                Showing analytics for the first {truncationLimit.toLocaleString('en-IN')} applications.
              </strong>{' '}
              Refine filters for complete figures. The “View as table” option is disabled
              while figures are partial.
            </div>
          </div>
        )}

        <div id="ap-grid" className="ap-grid" hidden={!open}>
          {children}
        </div>
      </section>
    </AnalyticsContext.Provider>
  );
}
