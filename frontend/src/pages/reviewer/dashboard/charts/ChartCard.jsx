import React, { createContext, useContext, useId, useState } from 'react';
import Icon from '../../../../components/ui/Icon';
import ChartDataTable from './ChartDataTable';

/* ============================================================================
   ChartCard — the shell every analytics chart sits in.

   Owns the four things that must be identical across all eight charts:
     · title + one-line metric definition
     · loading skeleton / error / empty state / content
     · the "View as table" accessible alternative
     · an optional footnote slot for reconciliation notes

   Presentational only. It never fetches and never aggregates.
   ============================================================================ */

/* Supplied by AnalyticsPanel. When the dataset is truncated the table
   alternative is withheld everywhere: a partial table read as complete is
   worse than no table at all. */
export const AnalyticsContext = createContext({ truncated: false });

export default function ChartCard({
  title,
  subtitle,
  span = 12,
  loading = false,
  error = '',
  empty = false,
  emptyMessage = 'No applications match the current filters.',
  footnote,
  actions,
  table,            // { columns, rows, note }
  height = 240,
  className = '',   // layout modifier, e.g. cc-wide-tablet
  children,
}) {
  const { truncated } = useContext(AnalyticsContext);
  const [showTable, setShowTable] = useState(false);
  const bodyId = useId();

  const tableAvailable = Boolean(table) && !truncated && !loading && !empty && !error;
  const showingTable = showTable && tableAvailable;

  return (
    <section
      className={`cc cc-span-${span}${className ? ` ${className}` : ''}`}
      aria-labelledby={`${bodyId}-title`}
    >
      <header className="cc-head">
        <div className="cc-head-text">
          <h3 className="cc-title" id={`${bodyId}-title`}>{title}</h3>
          {subtitle && <p className="cc-subtitle">{subtitle}</p>}
        </div>

        <div className="cc-head-actions">
          {actions}
          {table && (
            <button
              type="button"
              className="cc-toggle"
              onClick={() => setShowTable(v => !v)}
              aria-expanded={showingTable}
              aria-controls={bodyId}
              disabled={!tableAvailable}
              /* Short visible label so the control fits a 4-column card; the
                 accessible name stays the full phrase. */
              aria-label={showingTable ? 'View as chart' : 'View as table'}
              title={
                truncated
                  ? 'Unavailable while analytics are truncated — refine filters for complete figures'
                  : (showingTable ? 'View as chart' : 'View as table')
              }
            >
              <Icon name={showingTable ? 'barChart' : 'table'} size={16} />
              {showingTable ? 'Chart' : 'Table'}
            </button>
          )}
        </div>
      </header>

      <div className="cc-body" id={bodyId} style={{ '--cc-plot-h': `${height}px` }}>
        {loading && (
          <div className="cc-skeleton" role="status" aria-live="polite">
            <span className="sr-only">Loading {title}</span>
            <div className="cc-skel-plot" aria-hidden="true">
              {[64, 88, 46, 92, 70, 54, 80].map((h, i) => (
                <span key={i} style={{ height: `${h}%` }} />
              ))}
            </div>
          </div>
        )}

        {!loading && error && (
          <p className="cc-error" role="alert">
            <Icon name="alertTriangle" size={20} />
            <span>{error}</span>
          </p>
        )}

        {!loading && !error && empty && (
          <p className="cc-empty">
            <Icon name="barChart" size={20} />
            {emptyMessage}
          </p>
        )}

        {!loading && !error && !empty && (
          showingTable
            ? <ChartDataTable caption={title} {...table} />
            : children
        )}
      </div>

      {footnote && !loading && !error && !empty && (
        <p className="cc-footnote">{footnote}</p>
      )}
    </section>
  );
}
