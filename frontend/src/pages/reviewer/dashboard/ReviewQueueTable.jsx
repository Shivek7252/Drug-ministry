import React from 'react';
import Icon from '../../../components/ui/Icon';
import { statusColor } from './charts/chartTheme';
import { OVERDUE_DAYS, daysBetween, isOverdue, ROWS_PER_PAGE_OPTIONS } from './aggregations';

/* ============================================================================
   ReviewQueueTable

   Sorting is applied by the hook to viewFiltered BEFORE pagination, so the
   order is across the whole result set, not just the visible page.

   The urgency dot and the Overdue tile read the same OVERDUE_DAYS constant,
   and status pills read statusColor() — the same function the charts use — so
   pill, tile and chart segment can never drift apart.
   ============================================================================ */

const COLUMNS = [
  { key: 'application', label: 'Application', sortable: true },
  { key: 'reference', label: 'Reference', sortable: false },
  { key: 'applicant', label: 'Applicant', sortable: true },
  { key: 'state', label: 'State', sortable: false },
  { key: 'category', label: 'Category', sortable: false },
  { key: 'destination', label: 'Destination', sortable: false },
  { key: 'submitted', label: 'Submitted', sortable: true, numeric: true },
  { key: 'age', label: 'Age', sortable: true, numeric: true },
  { key: 'queries', label: 'Queries', sortable: true, numeric: true },
  { key: 'status', label: 'Status', sortable: true },
  { key: 'action', label: 'Action', sortable: false },
];

const ariaSort = (col, sort) => {
  if (!col.sortable) return undefined;
  if (sort.key !== col.key) return 'none';
  return sort.dir === 'asc' ? 'ascending' : 'descending';
};

const fmtDate = value => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', yyyy: undefined, year: 'numeric' });
};

function StatusPill({ status }) {
  const colour = statusColor(status);
  return (
    <span className="rq-pill" style={{ color: colour, borderColor: colour }}>
      <span className="rq-pill-dot" style={{ background: colour }} aria-hidden="true" />
      {status}
    </span>
  );
}

function AgeCell({ app }) {
  const age = daysBetween(app.submittedAt || app.createdAt);
  if (age === null) return <span className="rq-muted">—</span>;
  // Same predicate the Overdue tile uses — never re-state the status list here.
  const overdue = isOverdue(app);
  return (
    <span className={`rq-age tnum${overdue ? ' is-overdue' : ''}`}>
      {overdue && (
        <span
          className="rq-age-dot"
          aria-hidden="true"
          title={`Open for more than ${OVERDUE_DAYS} days`}
        />
      )}
      {age}d
      {overdue && <span className="sr-only"> — overdue, open more than {OVERDUE_DAYS} days</span>}
    </span>
  );
}

export default function ReviewQueueTable({
  rows, loading, error,
  sort, onSort,
  page, pageCount, onPage,
  rowsPerPage, onRowsPerPage,
  totalRows,
  selected, onToggleSelect, onToggleSelectAll, onClearSelection,
  density, onDensity,
  onOpen, openedApps, isUnseen,
  onBulkMarkInReview, bulkBusy,
}) {
  const pageIds = rows.map(r => r.applicationNumber);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every(id => selected.has(id));
  const someOnPageSelected = pageIds.some(id => selected.has(id));
  const from = totalRows === 0 ? 0 : (page - 1) * rowsPerPage + 1;
  const to = Math.min(page * rowsPerPage, totalRows);

  return (
    <section className="rq" aria-labelledby="rq-heading">
      {/* Toolbar: selection state and the single bulk action live here, inline,
          rather than in a slide-in bar built for actions that do not exist. */}
      <div className="rq-toolbar">
        <h2 className="rq-heading" id="rq-heading">Review Queue</h2>

        {selected.size > 0 ? (
          <div className="rq-bulk">
            <span className="rq-bulk-count tnum">{selected.size} selected</span>
            <span className="rq-bulk-sep" aria-hidden="true">·</span>
            <button
              type="button"
              className="rq-bulk-action"
              onClick={onBulkMarkInReview}
              disabled={bulkBusy}
            >
              {bulkBusy ? 'Marking…' : 'Mark In Review'}
            </button>
            <span className="rq-bulk-sep" aria-hidden="true">·</span>
            <button type="button" className="rq-bulk-clear" onClick={onClearSelection}>Clear</button>
          </div>
        ) : (
          <div className="rq-density" role="group" aria-label="Row density">
            <Icon name="rows" size={16} />
            {['comfortable', 'compact'].map(d => (
              <button
                key={d}
                type="button"
                onClick={() => onDensity(d)}
                aria-pressed={density === d}
                className={density === d ? 'is-active' : ''}
              >
                {d === 'comfortable' ? 'Comfortable' : 'Compact'}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="rq-scroll">
        <table className={`rq-table is-${density}`}>
          <thead>
            <tr>
              <th scope="col" className="rq-check">
                <input
                  type="checkbox"
                  checked={allOnPageSelected}
                  ref={el => { if (el) el.indeterminate = !allOnPageSelected && someOnPageSelected; }}
                  onChange={onToggleSelectAll}
                  aria-label="Select all rows on this page"
                  disabled={rows.length === 0}
                />
              </th>
              {COLUMNS.map(col => (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={ariaSort(col, sort)}
                  className={col.numeric ? 'rq-num' : undefined}
                >
                  {col.sortable ? (
                    <button type="button" className="rq-sort" onClick={() => onSort(col.key)}>
                      {col.label}
                      <Icon
                        name={sort.key !== col.key ? 'arrowUpDown' : (sort.dir === 'asc' ? 'arrowUp' : 'arrowDown')}
                        size={13}
                      />
                    </button>
                  ) : col.label}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {loading && Array.from({ length: 5 }).map((_, i) => (
              <tr key={`sk-${i}`} className="rq-skeleton" aria-hidden="true">
                {Array.from({ length: COLUMNS.length + 1 }).map((__, j) => (
                  <td key={j}><span className="rq-skel" /></td>
                ))}
              </tr>
            ))}

            {!loading && error && (
              <tr><td colSpan={COLUMNS.length + 1} className="rq-state rq-state-error">{error}</td></tr>
            )}

            {!loading && !error && rows.length === 0 && (
              <tr><td colSpan={COLUMNS.length + 1} className="rq-state">No applications match the current filters.</td></tr>
            )}

            {!loading && !error && rows.map(app => {
              const id = app.applicationNumber;
              const checked = selected.has(id);
              return (
                <tr
                  key={id}
                  className={`rq-row${checked ? ' is-selected' : ''}${isUnseen(app) ? ' is-unseen' : ''}`}
                  onClick={() => onOpen(app)}
                >
                  <td className="rq-check" onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggleSelect(id)}
                      aria-label={`Select ${id}`}
                    />
                  </td>
                  <td className="rq-appno">{id}</td>
                  <td><span className="rq-ref tnum">{app.referenceNumber || '—'}</span></td>
                  <td>
                    <span className="rq-applicant">{app.applicantOrganization || app.applicantName || '—'}</span>
                    {app.email && <span className="rq-email">{app.email}</span>}
                  </td>
                  <td>{app.state || '—'}</td>
                  <td>
                    {app.exportCategory
                      ? <span className="rq-chip" title={app.exportCategory}>{app.exportCategory}</span>
                      : <span className="rq-muted">—</span>}
                  </td>
                  <td>{app.destinationCountry || app.consigneeCountry || '—'}</td>
                  <td className="rq-num tnum">{fmtDate(app.submittedAt || app.createdAt)}</td>
                  <td className="rq-num"><AgeCell app={app} /></td>
                  <td className="rq-num tnum">{app.queryCount || 0}</td>
                  <td><StatusPill status={app.status} /></td>
                  <td onClick={e => e.stopPropagation()}>
                    <button type="button" className="rq-open" onClick={() => onOpen(app)}>
                      Open <Icon name="externalLink" size={13} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Single source of "how many" — the duplicate line above the table is gone. */}
      <div className="rq-pagination">
        <label className="rq-perpage">
          <span>Rows</span>
          <select value={rowsPerPage} onChange={e => onRowsPerPage(Number(e.target.value))}>
            {ROWS_PER_PAGE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>

        <p className="rq-range tnum">
          {totalRows === 0 ? 'No results' : `${from}–${to} of ${totalRows.toLocaleString('en-IN')}`}
        </p>

        <nav className="rq-pager" aria-label="Pagination">
          <button type="button" onClick={() => onPage(1)} disabled={page <= 1} aria-label="First page">
            <Icon name="chevronsLeft" size={16} />
          </button>
          <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page">
            <Icon name="chevronLeft" size={16} />
          </button>
          <span className="rq-pageno tnum">Page {page} of {pageCount}</span>
          <button type="button" onClick={() => onPage(page + 1)} disabled={page >= pageCount} aria-label="Next page">
            <Icon name="chevronRight" size={16} />
          </button>
          <button type="button" onClick={() => onPage(pageCount)} disabled={page >= pageCount} aria-label="Last page">
            <Icon name="chevronsRight" size={16} />
          </button>
        </nav>
      </div>
    </section>
  );
}
