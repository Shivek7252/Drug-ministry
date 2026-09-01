import React, { useEffect, useState } from 'react';
import Icon from '../../../components/ui/Icon';
import { countryDisplayLabel, isInvalidCountryValue } from '../../../data/countries';
import { EXPORT_CATEGORIES } from '../../../data/mockData';
import { ROWS_PER_PAGE_OPTIONS } from './aggregations';
import { formatBusinessDateTime } from '../../../config/businessTime';
import { normalizeStatus, STATUS, STATUS_LABEL } from './statusModel';

/* ============================================================================
   Review Queue.

   Seven data columns, each one a merge of what used to be two: the queue now
   fits its container at every width instead of living inside a horizontal
   scroller. The table is `table-layout: fixed` on percentage columns with no
   min-width, so it can never be wider than the page; every cell either wraps
   or ellipsises with a title, so nothing is clipped without a way to read it.

   Below CARD_QUERY the table is swapped — in JS, not CSS — for a list of
   <article> cards. One layout is in the DOM at a time: no duplicated values,
   no table semantics left dangling on elements CSS has turned into blocks.
   ============================================================================ */

const CARD_QUERY = '(max-width: 767px)';

const COLUMNS = [
  { key: 'application', label: 'Application', sortable: true },
  { key: 'applicant', label: 'Applicant', sortable: true },
  { key: 'route', label: 'Route', sortable: false },
  { key: 'category', label: 'Category', sortable: false },
  { key: 'submitted', label: 'Submitted', sortable: true },
  { key: 'status', label: 'Review Status', sortable: true },
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

/* Card layout is a real DOM swap, so it needs a JS media query rather than a
   stylesheet breakpoint. Falls back to the table when matchMedia is absent. */
function useCardLayout() {
  const [cards, setCards] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(CARD_QUERY).matches
      : false
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(CARD_QUERY);
    const onChange = event => setCards(event.matches);
    mq.addEventListener('change', onChange);
    setCards(mq.matches);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return cards;
}

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

const sortIcon = (key, sort) =>
  (sort.key !== key ? 'arrowUpDown' : (sort.dir === 'asc' ? 'arrowUp' : 'arrowDown'));

const text = value => String(value || '').trim();

/* ---- Shared value renderers: the table and the cards read the same ones --- */

function InvalidValue({ kind, value }) {
  return (
    <span
      className="rq-invalid"
      title={`Invalid stored ${kind} value: ${value}`}
      aria-label={`Invalid ${kind} data. Stored value: ${value}`}
    >
      <Icon name="alertTriangle" size={12} />
      Invalid data
    </span>
  );
}

/* Application numbers are the row's identity: never truncated, never
   ellipsised. They wrap before they would ever be shortened. */
function ApplicationValue({ id, reference, unread }) {
  return (
    <span className="rq-application">
      <span className="rq-appno-line">
        <span className="rq-appno tnum">{id}</span>
        {unread && <span className="rq-unread-dot" role="img" aria-label="Unread" />}
      </span>
      <span className="rq-ref tnum">{text(reference) || '—'}</span>
    </span>
  );
}

function ApplicantValue({ name, email }) {
  return (
    <span className="rq-applicant">
      <span className="rq-applicant-name">{text(name) || '—'}</span>
      {email && <span className="rq-email" title={email}>{email}</span>}
    </span>
  );
}

function RouteValue({ state, destination }) {
  const from = text(state) || '—';
  const full = destination.invalid ? from : `${from} → ${destination.label}`;
  return (
    <span className="rq-route" title={destination.invalid ? undefined : full}>
      <span className="rq-route-from">{from}</span>
      <span className="rq-route-arrow" aria-hidden="true">→</span>
      <span className="sr-only"> to </span>
      {destination.invalid
        ? <InvalidValue kind="country" value={destination.raw} />
        : <span className="rq-route-to">{destination.label}</span>}
    </span>
  );
}

function CategoryValue({ category }) {
  return category.invalid
    ? <InvalidValue kind="category" value={category.raw} />
    : <span className="rq-chip">{category.label}</span>;
}

function SubmittedValue({ app }) {
  const { date, time } = formatBusinessDateTime(app.submittedAt);
  if (!date) return <span className="rq-muted">—</span>;
  return (
    <span className="rq-submitted" title={`${date}, ${time || 'time unavailable'}`}>
      <span className="rq-submitted-date tnum">{date}</span>
      <span className="rq-submitted-time tnum">{time || 'Time unavailable'}</span>
    </span>
  );
}

/* Status and query count are one fact — where the file stands — so they share
   a cell. The count only appears when there is something to count. */
function ReviewStatusValue({ status, queryCount }) {
  const canonical = normalizeStatus(status);
  const label = STATUS_LABEL[canonical];
  return (
    <span className="rq-reviewstate">
      <span className={`rq-status is-${STATUS_CLASS[canonical]}`} aria-label={`Status: ${label}`}>
        <span className="rq-status-dot" aria-hidden="true" />
        {label}
      </span>
      {queryCount > 0 && (
        <span className="rq-queries tnum">
          {queryCount} {queryCount === 1 ? 'query' : 'queries'}
        </span>
      )}
    </span>
  );
}

function ReviewButton({ id, onOpen }) {
  return (
    <button type="button" className="rq-open" onClick={onOpen} aria-label={`Open application ${id}`}>
      <span className="rq-open-label">Review</span>
      <Icon name="chevronRight" size={14} />
    </button>
  );
}

/* ---- Row model: derived once, rendered by whichever layout is mounted ----- */

const toRowModel = (app, isUnread) => {
  const id = app.applicationNumber;
  return {
    app,
    id,
    reference: app.referenceNumber,
    applicant: app.applicantOrganization || app.applicantName || '',
    email: text(app.email),
    unread: Boolean(isUnread(app)),
    category: categoryDisplay(app.exportCategory),
    destination: countryDisplay(app.destinationCountry || app.consigneeCountry),
    queryCount: Number(app.queryCount) || 0,
    statusLabel: STATUS_LABEL[normalizeStatus(app.status)],
  };
};

const rowAriaLabel = row =>
  `${row.id}, ${row.applicant || 'applicant unavailable'}, ${row.statusLabel}${row.unread ? ', unread' : ''}`;

/* ---- States shared by both layouts --------------------------------------- */

function ErrorState({ error, onRetry }) {
  return (
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
  );
}

function EmptyState({ hasFilters }) {
  return (
    <div className="rq-state">
      <Icon name={hasFilters ? 'search' : 'rows'} size={22} />
      <strong>{hasFilters ? 'No applications match these filters' : 'The review queue is empty'}</strong>
      <span>{hasFilters
        ? 'Adjust or clear the filters to see more applications.'
        : 'Submitted applications will appear here for review.'}</span>
    </div>
  );
}

/* ---- Mobile: one <article> per application ------------------------------- */

function QueueCards({
  rows, loading, initialError, empty, error, hasFilters, onRetry,
  onOpen,
}) {
  if (loading) {
    return (
      <div className="rq-cards" aria-hidden="true">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="rq-card rq-card-skeleton">
            <span className="rq-skel" style={{ width: '55%' }} />
            <span className="rq-skel" style={{ width: '80%' }} />
            <span className="rq-skel" style={{ width: '40%' }} />
          </div>
        ))}
      </div>
    );
  }
  if (initialError) return <div className="rq-cards">{<ErrorState error={error} onRetry={onRetry} />}</div>;
  if (empty) return <div className="rq-cards">{<EmptyState hasFilters={hasFilters} />}</div>;

  return (
    <ul className="rq-cards" aria-label="Review queue applications">
      {rows.map(row => (
          <li key={row.id}>
            <article
              className={`rq-card${row.unread ? ' is-unseen' : ''}`}
              aria-label={rowAriaLabel(row)}
              tabIndex={0}
              onClick={() => onOpen(row.app)}
              onKeyDown={event => {
                if (event.key === 'Enter' && event.target === event.currentTarget) onOpen(row.app);
              }}
            >
              <div className="rq-card-head">
                <ApplicationValue id={row.id} reference={row.reference} unread={row.unread} />
                <ReviewStatusValue status={row.app.status} queryCount={row.queryCount} />
              </div>

              <dl className="rq-card-facts">
                <div className="rq-fact">
                  <dt>Applicant</dt>
                  <dd><ApplicantValue name={row.applicant} email={row.email} /></dd>
                </div>
                <div className="rq-fact">
                  <dt>Route</dt>
                  <dd><RouteValue state={row.app.state} destination={row.destination} /></dd>
                </div>
                <div className="rq-fact">
                  <dt>Category</dt>
                  <dd><CategoryValue category={row.category} /></dd>
                </div>
                <div className="rq-fact">
                  <dt>Submitted</dt>
                  <dd><SubmittedValue app={row.app} /></dd>
                </div>
              </dl>

              <div className="rq-card-foot" onClick={event => event.stopPropagation()}>
                <ReviewButton id={row.id} onOpen={() => onOpen(row.app)} />
              </div>
            </article>
          </li>
      ))}
    </ul>
  );
}

/* ---- Desktop and tablet: the semantic table ------------------------------ */

function QueueTable({
  rows, loading, initialError, empty, error, hasFilters, onRetry,
  sort, onSort, onOpen,
}) {
  const span = COLUMNS.length;
  return (
    <table className="rq-table">
      <caption className="sr-only">
        Reviewer applications. Use sortable column headers to change the server-side order.
      </caption>
      <colgroup>
        <col className="rq-col-application" />
        <col className="rq-col-applicant" />
        <col className="rq-col-route" />
        <col className="rq-col-category" />
        <col className="rq-col-submitted" />
        <col className="rq-col-status" />
        <col className="rq-col-action" />
      </colgroup>
      <thead>
        <tr>
          {COLUMNS.map(column => (
            <th key={column.key} scope="col" aria-sort={ariaSort(column, sort)}>
              {column.sortable ? (
                <button type="button" className="rq-sort" onClick={() => onSort(column.key)}>
                  {column.label}
                  <Icon name={sortIcon(column.key, sort)} size={13} />
                </button>
              ) : column.label}
              {/* Queries merged into Review Status, so its sort lives here too. */}
              {column.key === 'status' && (
                <button
                  type="button"
                  className="rq-sort rq-sort-sub"
                  onClick={() => onSort('queries')}
                  aria-label={`Sort by queries, currently ${
                    sort.key === 'queries' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'unsorted'}`}
                >
                  Queries
                  <Icon name={sortIcon('queries', sort)} size={11} />
                </button>
              )}
            </th>
          ))}
        </tr>
      </thead>

      <tbody>
        {loading && Array.from({ length: 6 }).map((_, rowIndex) => (
          <tr key={`skeleton-${rowIndex}`} className="rq-skeleton" aria-hidden="true">
            {Array.from({ length: span }).map((__, cellIndex) => (
              <td key={cellIndex}><span className="rq-skel" /></td>
            ))}
          </tr>
        ))}

        {initialError && (
          <tr className="rq-state-row">
            <td colSpan={span}><ErrorState error={error} onRetry={onRetry} /></td>
          </tr>
        )}

        {empty && (
          <tr className="rq-state-row">
            <td colSpan={span}><EmptyState hasFilters={hasFilters} /></td>
          </tr>
        )}

        {!loading && rows.map(row => (
            <tr
              key={row.id}
              className={`rq-row${row.unread ? ' is-unseen' : ''}`}
              onClick={() => onOpen(row.app)}
              onKeyDown={event => {
                if (event.key === 'Enter' && event.target === event.currentTarget) onOpen(row.app);
              }}
              tabIndex={0}
              aria-label={rowAriaLabel(row)}
            >
              <td className="rq-cell-application">
                <ApplicationValue id={row.id} reference={row.reference} unread={row.unread} />
              </td>
              <td className="rq-cell-applicant">
                <ApplicantValue name={row.applicant} email={row.email} />
              </td>
              <td className="rq-cell-route">
                <RouteValue state={row.app.state} destination={row.destination} />
              </td>
              <td className="rq-cell-category">
                <CategoryValue category={row.category} />
              </td>
              <td className="rq-cell-submitted">
                <SubmittedValue app={row.app} />
              </td>
              <td className="rq-cell-status">
                <ReviewStatusValue status={row.app.status} queryCount={row.queryCount} />
              </td>
              <td className="rq-cell-action" onClick={event => event.stopPropagation()}>
                <ReviewButton id={row.id} onOpen={() => onOpen(row.app)} />
              </td>
            </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ReviewQueueTable({
  rows, loading, refreshing = false, stale = false, error,
  hasFilters = false, onRetry,
  sort, onSort,
  page, pageCount, onPage,
  rowsPerPage, onRowsPerPage,
  totalRows,
  onOpen, isUnread,
}) {
  const cardLayout = useCardLayout();
  const model = rows.map(app => toRowModel(app, isUnread));
  const from = totalRows === 0 ? 0 : (page - 1) * rowsPerPage + 1;
  const to = Math.min(page * rowsPerPage, totalRows);
  const hasRows = model.length > 0;
  const initialError = !loading && Boolean(error) && !hasRows;
  const empty = !loading && !error && !hasRows;

  const shared = {
    rows: model, loading, initialError, empty, error, hasFilters, onRetry,
    onOpen,
  };

  return (
    <section className="rq" aria-labelledby="rq-heading">
      <header className="rq-toolbar">
        <div className="rq-title-group">
          <h2 className="rq-heading" id="rq-heading">Review Queue</h2>
          <span className="rq-result-count tnum" aria-live="polite">
            {loading && !hasRows
              ? 'Loading applications'
              : `${totalRows.toLocaleString('en-IN')} application${totalRows === 1 ? '' : 's'}`}
          </span>
        </div>

      </header>

      {(refreshing || (stale && hasRows)) && (
        <div className={`rq-sync${stale ? ' is-stale' : ''}`} role="status">
          <Icon name={stale ? 'alertTriangle' : 'refresh'} size={14} />
          <span>{stale ? 'Showing the last loaded results because refresh failed.' : 'Refreshing queue…'}</span>
          {stale && onRetry && <button type="button" onClick={onRetry}>Retry</button>}
        </div>
      )}

      <div className="rq-body">
        {cardLayout
          ? <QueueCards {...shared} />
          : (
            <QueueTable
              {...shared}
              sort={sort}
              onSort={onSort}
            />
          )}
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
            <Icon name="chevronLeft" size={16} /> <span className="rq-page-word">Previous</span>
          </button>
          <span className="rq-pageno tnum" aria-current="page">Page {page} of {pageCount}</span>
          <button type="button" className="rq-page-step" onClick={() => onPage(page + 1)} disabled={page >= pageCount} aria-label="Next page">
            <span className="rq-page-word">Next</span> <Icon name="chevronRight" size={16} />
          </button>
          <button type="button" className="rq-page-edge" onClick={() => onPage(pageCount)} disabled={page >= pageCount} aria-label="Last page">
            <Icon name="chevronsRight" size={16} />
          </button>
        </nav>
      </footer>
    </section>
  );
}
