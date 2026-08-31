import React from 'react';
import Icon from '../../../components/ui/Icon';
import { countryDisplayLabel, isInvalidCountryValue } from '../../../data/countries';
import { EXPORT_CATEGORIES } from '../../../data/mockData';
import { ROWS_PER_PAGE_OPTIONS } from './aggregations';
import { formatBusinessDateTime } from '../../../config/businessTime';
import { normalizeStatus, STATUS, STATUS_LABEL } from './statusModel';

/* The desktop table and mobile review cards are the same semantic table. At
   small widths CSS turns each <tr> into a stacked card, so values are never
   duplicated in the DOM and assistive technology keeps proper row context. */

const COLUMNS = [
  { key: 'application', label: 'Application', sortable: true },
  { key: 'reference', label: 'Reference', sortable: false },
  { key: 'applicant', label: 'Applicant', sortable: true },
  { key: 'state', label: 'State', sortable: false },
  { key: 'category', label: 'Category', sortable: false },
  { key: 'destination', label: 'Destination', sortable: false },
  { key: 'submitted', label: 'Submitted', sortable: true, numeric: true },
  { key: 'queries', label: 'Queries', sortable: true, numeric: true },
  { key: 'status', label: 'Status', sortable: true },
  { key: 'action', label: 'Action', sortable: false },
];

const STATUS_CLASS = {
  [STATUS.DRAFT]: 'draft',
  [STATUS.SUBMITTED]: 'submitted',
  [STATUS.IN_REVIEW]: 'review',
  [STATUS.QUERY_RAISED]: 'query',
  [STATUS.APPROVED]: 'approved',
  [STATUS.PARTIALLY_APPROVED]: 'approved',
  [STATUS.REJECTED]: 'rejected',
  [STATUS.UNKNOWN]: 'unknown',
};

const categoryDisplay = value => {
  const raw = String(value || '').trim();
  if (!raw) return { label: '—', raw: '', invalid: false };
  const canonical = EXPORT_CATEGORIES.find(category => category.toLowerCase() === raw.toLowerCase());
  return canonical
    ? { label: canonical, raw, invalid: false }
    : { label: 'Invalid data', raw, invalid: true };
};

const countryDisplay = value => {
  const raw = String(value || '').trim();
  if (!raw) return { label: '—', raw: '', invalid: false };
  return isInvalidCountryValue(raw)
    ? { label: 'Invalid data', raw, invalid: true }
    : { label: countryDisplayLabel(raw), raw, invalid: false };
};

const ariaSort = (column, sort) => {
  if (!column.sortable) return undefined;
  if (sort.key !== column.key) return 'none';
  return sort.dir === 'asc' ? 'ascending' : 'descending';
};

function TextValue({ value, className = '' }) {
  const text = String(value || '').trim();
  return (
    <span className={className} title={text || undefined}>
      {text || '—'}
    </span>
  );
}

function SubmittedCell({ app }) {
  const { date, time } = formatBusinessDateTime(app.submittedAt);
  if (!date) return <span className="rq-muted">—</span>;
  const full = `${date}, ${time || 'time unavailable'}`;
  return (
    <span className="rq-submitted" title={full}>
      <span className="rq-submitted-date tnum">{date}</span>
      <span className="rq-submitted-time tnum">{time || 'Time unavailable'}</span>
    </span>
  );
}

function StatusBadge({ status }) {
  const canonical = normalizeStatus(status);
  const label = STATUS_LABEL[canonical];
  return (
    <span className={`rq-status is-${STATUS_CLASS[canonical]}`} aria-label={`Status: ${label}`}>
      <span className="rq-status-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

function InvalidValue({ kind, value }) {
  return (
    <span
      className="rq-invalid"
      title={`Invalid stored ${kind} value: ${value}`}
      aria-label={`Invalid ${kind} data. Stored value: ${value}`}
    >
      <Icon name="alertTriangle" size={13} />
      Invalid data
    </span>
  );
}

export default function ReviewQueueTable({
  rows, loading, refreshing = false, stale = false, error,
  hasFilters = false, onRetry,
  sort, onSort,
  page, pageCount, onPage,
  rowsPerPage, onRowsPerPage,
  totalRows,
  selected, onToggleSelect, onToggleSelectAll, onClearSelection,
  density, onDensity,
  onOpen, isUnread,
  onBulkMarkInReview, bulkBusy,
}) {
  const pageIds = rows.map(row => row.applicationNumber);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every(id => selected.has(id));
  const someOnPageSelected = pageIds.some(id => selected.has(id));
  const from = totalRows === 0 ? 0 : (page - 1) * rowsPerPage + 1;
  const to = Math.min(page * rowsPerPage, totalRows);
  const hasRows = rows.length > 0;
  const initialError = !loading && Boolean(error) && !hasRows;
  const empty = !loading && !error && !hasRows;

  return (
    <section className="rq" aria-labelledby="rq-heading">
      <header className={`rq-toolbar${selected.size > 0 ? ' is-selection' : ''}`}>
        <div className="rq-title-group">
          <h2 className="rq-heading" id="rq-heading">Review Queue</h2>
          <span className="rq-result-count tnum" aria-live="polite">
            {loading && !hasRows
              ? 'Loading applications'
              : `${totalRows.toLocaleString('en-IN')} application${totalRows === 1 ? '' : 's'}`}
          </span>
        </div>

        {selected.size > 0 ? (
          <div className="rq-bulk" aria-label="Selection actions">
            <span className="rq-bulk-count tnum">{selected.size} selected</span>
            <button
              type="button"
              className="rq-bulk-action"
              onClick={onBulkMarkInReview}
              disabled={bulkBusy}
            >
              <Icon name="search" size={14} />
              {bulkBusy ? 'Marking…' : 'Mark In Review'}
            </button>
            <button type="button" className="rq-bulk-clear" onClick={onClearSelection}>Clear selection</button>
          </div>
        ) : (
          <div className="rq-density-wrap">
            <span className="rq-density-label">Density</span>
            <div className="rq-density" role="group" aria-label="Row density">
              {['comfortable', 'compact'].map(option => (
                <button
                  key={option}
                  type="button"
                  onClick={() => onDensity(option)}
                  aria-pressed={density === option}
                  className={density === option ? 'is-active' : ''}
                >
                  {option === 'comfortable' ? 'Comfortable' : 'Compact'}
                </button>
              ))}
            </div>
          </div>
        )}
      </header>

      {(refreshing || (stale && hasRows)) && (
        <div className={`rq-sync${stale ? ' is-stale' : ''}`} role="status">
          <Icon name={stale ? 'alertTriangle' : 'refresh'} size={14} />
          <span>{stale ? 'Showing the last loaded results because refresh failed.' : 'Refreshing queue…'}</span>
          {stale && onRetry && (
            <button type="button" onClick={onRetry}>Retry</button>
          )}
        </div>
      )}

      <div className="rq-scroll">
        <table className={`rq-table is-${density}`}>
          <caption className="sr-only">
            Reviewer applications. Use sortable column headers to change the server-side order.
          </caption>
          <colgroup>
            <col className="rq-col-check" />
            <col className="rq-col-application" />
            <col className="rq-col-reference" />
            <col className="rq-col-applicant" />
            <col className="rq-col-state" />
            <col className="rq-col-category" />
            <col className="rq-col-destination" />
            <col className="rq-col-submitted" />
            <col className="rq-col-queries" />
            <col className="rq-col-status" />
            <col className="rq-col-action" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className="rq-check">
                <input
                  type="checkbox"
                  checked={allOnPageSelected}
                  ref={element => { if (element) element.indeterminate = !allOnPageSelected && someOnPageSelected; }}
                  onChange={onToggleSelectAll}
                  aria-label="Select all applications on this page"
                  disabled={!hasRows}
                />
              </th>
              {COLUMNS.map(column => (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={ariaSort(column, sort)}
                  className={column.numeric ? 'rq-num' : undefined}
                >
                  {column.sortable ? (
                    <button type="button" className="rq-sort" onClick={() => onSort(column.key)}>
                      {column.label}
                      <Icon
                        name={sort.key !== column.key
                          ? 'arrowUpDown'
                          : (sort.dir === 'asc' ? 'arrowUp' : 'arrowDown')}
                        size={13}
                      />
                    </button>
                  ) : column.label}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {loading && Array.from({ length: 5 }).map((_, rowIndex) => (
              <tr key={`skeleton-${rowIndex}`} className="rq-skeleton" aria-hidden="true">
                {Array.from({ length: COLUMNS.length + 1 }).map((__, cellIndex) => (
                  <td key={cellIndex}><span className="rq-skel" /></td>
                ))}
              </tr>
            ))}

            {initialError && (
              <tr className="rq-state-row">
                <td colSpan={COLUMNS.length + 1}>
                  <div className="rq-state rq-state-error" role="alert">
                    <Icon name="alertTriangle" size={22} />
                    <strong>Review queue could not be loaded</strong>
                    <span>{error}</span>
                    {onRetry && (
                      <button type="button" onClick={onRetry}>
                        <Icon name="refresh" size={14} /> Retry
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            )}

            {empty && (
              <tr className="rq-state-row">
                <td colSpan={COLUMNS.length + 1}>
                  <div className="rq-state">
                    <Icon name={hasFilters ? 'search' : 'rows'} size={22} />
                    <strong>{hasFilters ? 'No applications match these filters' : 'The review queue is empty'}</strong>
                    <span>{hasFilters
                      ? 'Adjust or clear the filters to see more applications.'
                      : 'Submitted applications will appear here for review.'}</span>
                  </div>
                </td>
              </tr>
            )}

            {!loading && hasRows && rows.map(app => {
              const id = app.applicationNumber;
              const checked = selected.has(id);
              const unread = Boolean(isUnread(app));
              const applicant = app.applicantOrganization || app.applicantName || '—';
              const category = categoryDisplay(app.exportCategory);
              const destination = countryDisplay(app.destinationCountry || app.consigneeCountry);
              const queryCount = Number(app.queryCount) || 0;
              const statusLabel = STATUS_LABEL[normalizeStatus(app.status)];

              return (
                <tr
                  key={id}
                  className={`rq-row${checked ? ' is-selected' : ''}${unread ? ' is-unseen' : ''}`}
                  onClick={() => onOpen(app)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' && event.target === event.currentTarget) onOpen(app);
                  }}
                  tabIndex={0}
                  aria-label={`${id}, ${applicant}, ${statusLabel}${unread ? ', unread' : ''}`}
                >
                  <td className="rq-check rq-cell-check" onClick={event => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggleSelect(id)}
                      aria-label={`Select ${id}`}
                    />
                  </td>
                  <td className="rq-cell-application" data-label="Application">
                    <span className="rq-application-line">
                      <TextValue value={id} className="rq-appno tnum" />
                      {unread && <span className="rq-unread-badge">Unread</span>}
                    </span>
                  </td>
                  <td className="rq-cell-reference" data-label="Reference">
                    <TextValue value={app.referenceNumber} className="rq-ref tnum" />
                  </td>
                  <td className="rq-cell-applicant" data-label="Applicant">
                    <TextValue value={applicant} className="rq-applicant" />
                    {app.email && <TextValue value={app.email} className="rq-email" />}
                  </td>
                  <td className="rq-cell-state" data-label="State">
                    <TextValue value={app.state} className="rq-truncate" />
                  </td>
                  <td className="rq-cell-category" data-label="Category">
                    {category.invalid
                      ? <InvalidValue kind="category" value={category.raw} />
                      : <span className="rq-chip" title={category.label}>{category.label}</span>}
                  </td>
                  <td className="rq-cell-destination" data-label="Destination">
                    {destination.invalid
                      ? <InvalidValue kind="country" value={destination.raw} />
                      : <TextValue value={destination.label} className="rq-truncate" />}
                  </td>
                  <td className="rq-num rq-cell-submitted" data-label="Submitted">
                    <SubmittedCell app={app} />
                  </td>
                  <td
                    className={`rq-num rq-cell-queries tnum${queryCount === 0 ? ' is-zero' : ''}`}
                    data-label="Queries"
                    aria-label={`${queryCount} ${queryCount === 1 ? 'query' : 'queries'}`}
                  >
                    {queryCount}
                  </td>
                  <td className="rq-cell-status" data-label="Status"><StatusBadge status={app.status} /></td>
                  <td className="rq-cell-action" data-label="Action" onClick={event => event.stopPropagation()}>
                    <button
                      type="button"
                      className="rq-open"
                      onClick={() => onOpen(app)}
                      aria-label={`Open application ${id}`}
                    >
                      Review <Icon name="chevronRight" size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <footer className="rq-pagination">
        <label className="rq-perpage">
          <span>Rows per page</span>
          <select
            value={rowsPerPage}
            onChange={event => onRowsPerPage(Number(event.target.value))}
            aria-label="Rows per page"
          >
            {ROWS_PER_PAGE_OPTIONS.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>

        <p className="rq-range tnum">
          {totalRows === 0
            ? 'No results'
            : <><strong>{from.toLocaleString('en-IN')}–{to.toLocaleString('en-IN')}</strong> of {totalRows.toLocaleString('en-IN')} results</>}
        </p>

        <nav className="rq-pager" aria-label="Queue pagination">
          <button type="button" className="rq-page-edge" onClick={() => onPage(1)} disabled={page <= 1} aria-label="First page">
            <Icon name="chevronsLeft" size={16} />
          </button>
          <button type="button" className="rq-page-step" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page">
            <Icon name="chevronLeft" size={16} /> Previous
          </button>
          <span className="rq-pageno tnum" aria-current="page">Page {page} of {pageCount}</span>
          <button type="button" className="rq-page-step" onClick={() => onPage(page + 1)} disabled={page >= pageCount} aria-label="Next page">
            Next <Icon name="chevronRight" size={16} />
          </button>
          <button type="button" className="rq-page-edge" onClick={() => onPage(pageCount)} disabled={page >= pageCount} aria-label="Last page">
            <Icon name="chevronsRight" size={16} />
          </button>
        </nav>
      </footer>
    </section>
  );
}
