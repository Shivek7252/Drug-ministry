import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import {
  exportReviewerApplications,
  getReviewerFilterOptions,
  listReviewerApplications,
} from '../../api/applicationService';
import './ReviewDashboard.css';

/* ══════════════════════════════════════════════════════════════════════════
   Reviewer Queue Page
   All sections share a single .rq-wrap container (max-width 1280px,
   margin 0 auto) so every piece of content is horizontally aligned.
   ══════════════════════════════════════════════════════════════════════════ */

const STATUS_FILTERS = [
  'All', 'Submitted', 'Under Review', 'Verified',
  'Query Raised', 'Approved', 'Rejected',
];

const PAGE_SIZE = 20;

const KPI_CONFIG = [
  { key: 'total', label: 'Total', tone: 'primary', icon: '📋', filter: 'All' },
  { key: 'submitted', label: 'New', tone: 'warn', icon: '✨', filter: 'Submitted' },
  { key: 'underReview', label: 'In Review', tone: 'info', icon: '🔍', filter: 'Under Review' },
  { key: 'queryRaised', label: 'Query', tone: 'orange', icon: '❓', filter: 'Query Raised' },
  { key: 'approved', label: 'Approved', tone: 'ok', icon: '✓', filter: 'Approved' },
  { key: 'rejected', label: 'Rejected', tone: 'bad', icon: '✕', filter: 'Rejected' },
];

const STATUS_TONES = {
  'Submitted': { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' },
  'Under Review': { bg: '#fefce8', color: '#a16207', border: '#fde68a' },
  'Verified': { bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0' },
  'Query Raised': { bg: '#fff7ed', color: '#c2410c', border: '#fdba74' },
  'Approved': { bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0' },
  'Partially Approved': { bg: '#eff6ff', color: '#1e40af', border: '#bfdbfe' },
  'Rejected': { bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
  'Draft': { bg: '#f8fafc', color: '#64748b', border: '#e2e8f0' },
};

/* ── localStorage helpers ───────────────────────────────────────────────── */
const OPENED_KEY = 'reviewer_opened_apps';

function getOpenedApps() {
  try { return new Set(JSON.parse(localStorage.getItem(OPENED_KEY) || '[]')); }
  catch { return new Set(); }
}

function markAppOpened(appNo) {
  const set = getOpenedApps();
  set.add(appNo);
  localStorage.setItem(OPENED_KEY, JSON.stringify([...set]));
}

/* Unseen = submitted within last 48 h and not yet opened by this reviewer. */
function isNewUnseen(app, openedSet) {
  if (openedSet.has(app.applicationNumber)) return false;
  if (!app.submittedAt) return false;
  const age = Date.now() - new Date(app.submittedAt).getTime();
  return age < 48 * 60 * 60 * 1000;
}

/* ── Presentational sub-components ─────────────────────────────────────── */

function StatusBadge({ status }) {
  const s = STATUS_TONES[status] || STATUS_TONES.Draft;
  return (
    <span
      className="rq-status-badge"
      style={{ background: s.bg, color: s.color, borderColor: s.border }}
    >
      {status}
    </span>
  );
}

function KpiCard({ tone, icon, label, value, active, onClick }) {
  return (
    <button
      className={`rq-kpi rq-kpi-${tone}${active ? ' rq-kpi-active' : ''}`}
      onClick={onClick}
      aria-pressed={active}
      title={`Filter by: ${label}`}
    >
      <span className="rq-kpi-icon" aria-hidden="true">{icon}</span>
      <div className="rq-kpi-body">
        <span className="rq-kpi-value">{value}</span>
        <span className="rq-kpi-label">{label}</span>
      </div>
    </button>
  );
}

function LoadingRow() {
  return (
    <tr className="rq-row-skeleton" aria-hidden="true">
      {Array.from({ length: 10 }).map((_, i) => (
        <td key={i}><div className="rq-skel-cell" /></td>
      ))}
    </tr>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Main page component
   ══════════════════════════════════════════════════════════════════════════ */

export default function ReviewDashboard() {
  const { currentUser } = useApp();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQ, setSearchQ] = useState(() => searchParams.get('q') || '');
  const [debouncedQ, setDebouncedQ] = useState(() => searchParams.get('q') || '');
  const [filterStatus, setFilterStatus] = useState(() => searchParams.get('status') || 'All');
  const [filterCat, setFilterCat] = useState(() => searchParams.get('category') || 'All');
  const [datePreset, setDatePreset] = useState(() => searchParams.get('datePreset') || 'all');
  const [startDate, setStartDate] = useState(() => searchParams.get('startDate') || '');
  const [endDate, setEndDate] = useState(() => searchParams.get('endDate') || '');
  const [country, setCountry] = useState(() => searchParams.get('country') || 'All');
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get('page')) || 1));
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [statusCounts, setStatusCounts] = useState({});
  const [countries, setCountries] = useState([]);
  const [categories, setCategories] = useState([]);
  const [exportState, setExportState] = useState({ status: 'idle', message: '' });
  const [openedApps, setOpenedApps] = useState(() => getOpenedApps());

  /* ── Data fetching ──────────────────────────────────────────────────── */
  const loadApps = useCallback(async () => {
    setLoading(true);
    setError('');
    const res = await listReviewerApplications({
      page,
      pageSize: PAGE_SIZE,
      q: debouncedQ,
      status: filterStatus,
      category: filterCat,
      country,
      datePreset,
      ...(datePreset === 'custom' ? { startDate, endDate } : {}),
    });
    if (res.success) {
      setApps(res.applications || []);
      setTotal(res.total || 0);
      setTotalPages(res.totalPages || 1);
      setStatusCounts(res.statusCounts || {});
      if (page > (res.totalPages || 1)) setPage(res.totalPages || 1);
    } else {
      setApps([]);
      setTotal(0);
      setError(res.error || 'Applications could not be loaded.');
    }
    setLoading(false);
  }, [page, debouncedQ, filterStatus, filterCat, country, datePreset, startDate, endDate]);

  useEffect(() => { loadApps(); }, [loadApps]);

  /* Debounced search */
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(searchQ.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [searchQ]);

  useEffect(() => {
    getReviewerFilterOptions().then(res => {
      if (res.success) {
        setCountries(res.countries || []);
        setCategories(res.categories || []);
      }
    });
  }, []);

  useEffect(() => {
    const next = new URLSearchParams();
    if (debouncedQ) next.set('q', debouncedQ);
    if (filterStatus !== 'All') next.set('status', filterStatus);
    if (filterCat !== 'All') next.set('category', filterCat);
    if (country !== 'All') next.set('country', country);
    if (datePreset !== 'all') next.set('datePreset', datePreset);
    if (datePreset === 'custom' && startDate) next.set('startDate', startDate);
    if (datePreset === 'custom' && endDate) next.set('endDate', endDate);
    if (page > 1) next.set('page', String(page));
    setSearchParams(next, { replace: true });
  }, [debouncedQ, filterStatus, filterCat, country, datePreset, startDate, endDate, page, setSearchParams]);

  /* ── Derived data ───────────────────────────────────────────────────── */
  const stats = useMemo(() => ({
    total: Object.values(statusCounts).reduce((sum, count) => sum + count, 0),
    submitted: statusCounts.Submitted || 0,
    underReview: statusCounts['Under Review'] || 0,
    queryRaised: statusCounts['Query Raised'] || 0,
    approved: statusCounts.Approved || 0,
    rejected: statusCounts.Rejected || 0,
  }), [statusCounts]);

  const unseenCount = apps.filter(a => isNewUnseen(a, openedApps)).length;
  const hasFilters = filterStatus !== 'All'
    || filterCat !== 'All'
    || country !== 'All'
    || datePreset !== 'all'
    || searchQ.trim() !== '';

  /* ── Handlers ───────────────────────────────────────────────────────── */
  const openConsignment = (app) => {
    markAppOpened(app.applicationNumber);
    setOpenedApps(getOpenedApps());
    const query = searchParams.toString();
    navigate(`/review/application/${encodeURIComponent(app.applicationNumber)}${query ? `?${query}` : ''}`);
  };

  const handleKpiClick = (kpi) => { setFilterStatus(kpi.filter); setPage(1); };

  const resetFilters = () => {
    setFilterStatus('All');
    setFilterCat('All');
    setCountry('All');
    setDatePreset('all');
    setStartDate('');
    setEndDate('');
    setSearchQ('');
    setDebouncedQ('');
    setPage(1);
  };

  const exportFilters = {
    q: debouncedQ,
    status: filterStatus,
    category: filterCat,
    country,
    datePreset,
    ...(datePreset === 'custom' ? { startDate, endDate } : {}),
  };

  const handleExport = async () => {
    if (!loading && total === 0) {
      setExportState({ status: 'empty', message: 'No applications match the selected filters.' });
      return;
    }
    if (datePreset === 'custom' && (!startDate || !endDate)) {
      setExportState({ status: 'error', message: 'Choose both custom range dates before exporting.' });
      return;
    }
    setExportState({ status: 'loading', message: 'Preparing all matching records…' });
    const res = await exportReviewerApplications(exportFilters);
    if (!res.success) {
      setExportState({
        status: res.error?.includes('No applications') ? 'empty' : 'error',
        message: res.error || 'Export failed.',
      });
      return;
    }
    const url = URL.createObjectURL(res.blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = res.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setExportState({
      status: 'success',
      message: `${res.count} matching record${res.count === 1 ? '' : 's'} downloaded as ${res.filename}.`,
    });
  };

  /* ── Render ─────────────────────────────────────────────────────────── */
  return (
    <div className="rq-page">

      {/* ════ HERO BANNER ═══════════════════════════════════════════════
          Full-bleed background; content aligned via .rq-wrap
          ══════════════════════════════════════════════════════════════ */}
      <header className="rq-header">
        <div className="rq-wrap">
          <div className="rq-header-left">
            <div className="rq-eyebrow">CDSCO SUGAM · Reviewer Console</div>
            <h1 className="rq-title">Export NOC Review Dashboard</h1>
            <p className="rq-subtitle">
              Centralised application review and verification portal · CDSCO SUGAM
            </p>
          </div>
          <div className="rq-officer" aria-label="Signed in as reviewer">
            <div className="rq-officer-avatar" aria-hidden="true">👨‍💼</div>
            <div>
              <div className="rq-officer-name">{currentUser || 'Reviewer'}</div>
              <div className="rq-officer-role">Drug Controller Officer</div>
            </div>
          </div>
        </div>
      </header>

      {/* ════ KPI STAT CARDS ════════════════════════════════════════════
          White bar; full-width inside .rq-wrap
          ══════════════════════════════════════════════════════════════ */}
      <div className="rq-kpi-bar" role="region" aria-label="Application statistics">
        <div className="rq-wrap">
          <div className="rq-kpi-strip">
            {KPI_CONFIG.map(k => (
              <KpiCard
                key={k.key}
                tone={k.tone}
                icon={k.icon}
                label={k.label}
                value={stats[k.key] ?? 0}
                active={filterStatus === k.filter}
                onClick={() => handleKpiClick(k)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* ════ BODY CONTENT ══════════════════════════════════════════════
          All body sections share the same .rq-wrap container.
          ══════════════════════════════════════════════════════════════ */}
      <div className="rq-body">
        <div className="rq-wrap">

          {/* ── Search + Filters ──────────────────────────────────── */}
          <div className="rq-toolbar" role="search">
            {/* Search input */}
            <div className="rq-search">
              <svg
                viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" width="15" height="15" aria-hidden="true"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                placeholder="Search by App No., Reference, Applicant, Email or License…"
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                aria-label="Search applications"
              />
              {searchQ && (
                <button
                  className="rq-search-clear"
                  onClick={() => setSearchQ('')}
                  aria-label="Clear search"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Filter selects */}
            <div className="rq-filters">
              <label className="rq-filter">
                <span>Status</span>
                <select
                  value={filterStatus}
                  onChange={e => { setFilterStatus(e.target.value); setPage(1); }}
                  aria-label="Filter by status"
                >
                  {STATUS_FILTERS.map(s => <option key={s}>{s}</option>)}
                </select>
              </label>

              <label className="rq-filter">
                <span>Category</span>
                <select
                  value={filterCat}
                  onChange={e => { setFilterCat(e.target.value); setPage(1); }}
                  aria-label="Filter by category"
                >
                  <option>All</option>
                  {categories.map(c => <option key={c}>{c}</option>)}
                </select>
              </label>

              <label className="rq-filter">
                <span>Country</span>
                <select value={country} onChange={e => { setCountry(e.target.value); setPage(1); }} aria-label="Filter by country">
                  <option>All</option>
                  {countries.map(value => <option key={value}>{value}</option>)}
                </select>
              </label>

              <label className="rq-filter">
                <span>Submitted</span>
                <select value={datePreset} onChange={e => { setDatePreset(e.target.value); setPage(1); }} aria-label="Filter by submission date">
                  <option value="all">All dates</option>
                  <option value="3months">Last 3 months</option>
                  <option value="1year">Last 1 year</option>
                  <option value="custom">Custom range</option>
                </select>
              </label>

              {datePreset === 'custom' && (
                <div className="rq-custom-dates">
                  <label className="rq-filter">
                    <span>From</span>
                    <input type="date" value={startDate} max={endDate || undefined} onChange={e => { setStartDate(e.target.value); setPage(1); }} />
                  </label>
                  <label className="rq-filter">
                    <span>To</span>
                    <input type="date" value={endDate} min={startDate || undefined} onChange={e => { setEndDate(e.target.value); setPage(1); }} />
                  </label>
                </div>
              )}

              <button
                className="rq-export-btn"
                onClick={handleExport}
                disabled={exportState.status === 'loading' || loading || !!error || total === 0}
                title="Download every application matching the selected filters"
              >
                <span className="rq-export-btn-icon" aria-hidden="true">
                  {exportState.status === 'loading' ? (
                    <span className="rq-export-spinner" />
                  ) : (
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2">
                      <path d="M12 3v12" />
                      <path d="m7 10 5 5 5-5" />
                      <path d="M5 21h14" />
                    </svg>
                  )}
                </span>
                <span className="rq-export-btn-copy">
                  <strong>{exportState.status === 'loading' ? 'Preparing CSV' : 'Export CSV'}</strong>
                  <small>{loading ? 'Loading records…' : total === 0 ? 'No records to export' : `All ${total} matching record${total === 1 ? '' : 's'}`}</small>
                </span>
              </button>

              {hasFilters && (
                <button className="rq-reset-btn" onClick={resetFilters}>
                  ↺ Reset
                </button>
              )}
            </div>
          </div>

          {exportState.status !== 'idle' && (
            <div className={`rq-export-state rq-export-${exportState.status}`} role="status">
              <div className="rq-export-feedback-main">
                <span className="rq-export-feedback-icon" aria-hidden="true">
                  {exportState.status === 'success' ? '✓' : exportState.status === 'loading' ? '…' : exportState.status === 'empty' ? '○' : '!'}
                </span>
                <div>
                  <strong>
                    {exportState.status === 'success' ? 'Export complete' : exportState.status === 'loading' ? 'Preparing your download' : exportState.status === 'empty' ? 'Nothing to export' : 'Export failed'}
                  </strong>
                  <span>{exportState.message}</span>
                </div>
              </div>
              <div className="rq-export-feedback-actions">
                {exportState.status === 'error' && <button className="rq-export-retry" onClick={handleExport}>Try again</button>}
                {exportState.status !== 'loading' && <button className="rq-export-dismiss" onClick={() => setExportState({ status: 'idle', message: '' })} aria-label="Dismiss export message">×</button>}
              </div>
            </div>
          )}

          {/* ── Result count ──────────────────────────────────────── */}
          <div className="rq-result-bar" aria-live="polite" aria-atomic="true">
            <div>
              Showing&nbsp;<strong>{apps.length}</strong>&nbsp;of&nbsp;
              {total} application{total !== 1 ? 's' : ''}
              {filterStatus !== 'All' && (
                <> · <span className="rq-active-filter">Status: {filterStatus}</span></>
              )}
              {filterCat !== 'All' && (
                <> · <span className="rq-active-filter">Category: {filterCat}</span></>
              )}
              {country !== 'All' && (
                <> · <span className="rq-active-filter">Country: {country}</span></>
              )}
              {datePreset !== 'all' && (
                <> · <span className="rq-active-filter">Date: {datePreset === '3months' ? 'Last 3 months' : datePreset === '1year' ? 'Last 1 year' : `${startDate || '…'} to ${endDate || '…'}`}</span></>
              )}
            </div>
            {unseenCount > 0 && (
              <span
                className="rq-unseen-badge"
                title={`${unseenCount} newly submitted application${unseenCount !== 1 ? 's' : ''}`}
              >
                🔔 {unseenCount} new since your last visit
              </span>
            )}
          </div>

          {/* ── Review Queue card ─────────────────────────────────── */}
          <div className="rq-queue-card">
            <div className="rq-queue-head">
              <div className="rq-queue-title">
                <span className="rq-queue-icon" aria-hidden="true">📋</span>
                Review Queue
                {loading && (
                  <span className="rq-queue-loading" aria-label="Loading">
                    Loading…
                  </span>
                )}
              </div>
              {!loading && apps.length > 0 && (
                <span style={{ fontSize: 12, color: 'var(--muted-2)' }}>
                  {apps.length} record{apps.length !== 1 ? 's' : ''} on this page
                </span>
              )}
            </div>

            {loading ? (
              /* Skeleton rows while fetching */
              <div className="rq-table-wrap">
                <table className="rq-table" aria-busy="true" aria-label="Loading applications">
                  <thead>
                    <tr>
                      <th>Application</th>
                      <th>Reference</th>
                      <th>Applicant</th>
                      <th>State</th>
                      <th>Category</th>
                      <th>Destination</th>
                      <th>Submitted</th>
                      <th>Queries</th>
                      <th>Status</th>
                      <th className="rq-th-action">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: 6 }).map((_, i) => <LoadingRow key={i} />)}
                  </tbody>
                </table>
              </div>

            ) : error ? (
              <div className="rq-empty" role="alert">
                <div className="rq-empty-icon" aria-hidden="true">⚠</div>
                <h3>Could not load applications</h3>
                <p>{error}</p>
                <button className="rq-btn rq-btn-primary" onClick={loadApps}>Try again</button>
              </div>
            ) : apps.length === 0 ? (
              /* Empty state */
              <div className="rq-empty" role="status">
                <div className="rq-empty-icon" aria-hidden="true">📭</div>
                <h3>No applications match your filters</h3>
                <p>
                  {hasFilters
                    ? 'Try clearing your filters or search query to see all pending applications.'
                    : 'No pending applications right now. New submissions will appear here.'}
                </p>
                {hasFilters && (
                  <button className="rq-btn rq-btn-primary" onClick={resetFilters}>
                    ↺ Clear all filters
                  </button>
                )}
              </div>

            ) : (
              /* Applications table */
              <div className="rq-table-wrap">
                <table
                  className="rq-table"
                  aria-label={`${apps.length} application${apps.length !== 1 ? 's' : ''} in review queue`}
                >
                  <thead>
                    <tr>
                      <th scope="col">Application</th>
                      <th scope="col">Reference</th>
                      <th scope="col">Applicant</th>
                      <th scope="col">State</th>
                      <th scope="col">Category</th>
                      <th scope="col">Destination</th>
                      <th scope="col">Submitted</th>
                      <th scope="col">Queries</th>
                      <th scope="col">Status</th>
                      <th scope="col" className="rq-th-action">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {apps.map(app => {
                      const unseen = isNewUnseen(app, openedApps);
                      const dt = app.submittedAt ? new Date(app.submittedAt) : null;

                      return (
                        <tr
                          key={app.applicationNumber}
                          className={`rq-row${unseen ? ' rq-row-new' : ''}`}
                          onClick={() => openConsignment(app)}
                          tabIndex={0}
                          onKeyDown={e => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              openConsignment(app);
                            }
                          }}
                          aria-label={`Application ${app.applicationNumber}. Press Enter to open in new tab.`}
                        >
                          {/* Application number */}
                          <td>
                            <div className="rq-app-cell">
                              {unseen && (
                                <span
                                  className="rq-new-dot"
                                  title="New — not yet opened"
                                  aria-label="New application"
                                />
                              )}
                              <span className="rq-app-no">{app.applicationNumber}</span>
                            </div>
                          </td>

                          {/* Reference */}
                          <td>
                            <span className="rq-ref-no">{app.referenceNumber || '—'}</span>
                          </td>

                          {/* Applicant */}
                          <td>
                            <div
                              className="rq-org-name"
                              title={app.applicantOrganization || app.applicantName || '—'}
                            >
                              {app.applicantOrganization || app.applicantName || '—'}
                            </div>
                            {app.email && (
                              <div className="rq-org-email" title={app.email}>
                                {app.email}
                              </div>
                            )}
                          </td>

                          {/* State */}
                          <td>
                            <span className="rq-cell-muted">
                              {app.state || app.city || '—'}
                            </span>
                          </td>

                          {/* Category */}
                          <td>
                            {app.exportCategory
                              ? <span className="rq-cat-pill" title={app.exportCategory}>{app.exportCategory}</span>
                              : <span className="rq-cell-muted">—</span>}
                          </td>

                          {/* Destination country */}
                          <td>
                            <span className="rq-cell-ink">
                              {app.destinationCountry || '—'}
                            </span>
                          </td>

                          {/* Submitted date */}
                          <td>
                            {dt ? (
                              <>
                                <div className="rq-date-primary">
                                  {dt.toLocaleDateString('en-IN', {
                                    day: '2-digit', month: 'short', year: 'numeric',
                                  })}
                                </div>
                                <div className="rq-date-secondary">
                                  {dt.toLocaleTimeString('en-IN', {
                                    hour: '2-digit', minute: '2-digit', hour12: true,
                                  })}
                                </div>
                              </>
                            ) : (
                              <span className="rq-cell-muted">
                                {app.applicationDate || '—'}
                              </span>
                            )}
                          </td>

                          <td>
                            <span className={`rq-query-count${app.queryCount > 0 ? ' has-queries' : ''}`}>{app.queryCount || 0}</span>
                          </td>

                          {/* Status badge */}
                          <td><StatusBadge status={app.status} /></td>

                          {/* Open button */}
                          <td className="rq-td-action">
                            <button
                              className="rq-open-btn"
                              onClick={e => { e.stopPropagation(); openConsignment(app); }}
                              title={`Open ${app.applicationNumber} in a new tab`}
                              aria-label={`Open application ${app.applicationNumber} in new tab`}
                            >
                              Open
                              {/* External-link icon makes the new-tab intent clear */}
                              <svg
                                width="11" height="11"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.5"
                                aria-hidden="true"
                              >
                                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                <polyline points="15 3 21 3 21 9" />
                                <line x1="10" y1="14" x2="21" y2="3" />
                              </svg>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {!loading && !error && totalPages > 1 && (
              <div className="rq-pagination" aria-label="Application pagination">
                <button disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}>← Previous</button>
                <span>Page <strong>{page}</strong> of <strong>{totalPages}</strong></span>
                <button disabled={page >= totalPages} onClick={() => setPage(value => Math.min(totalPages, value + 1))}>Next →</button>
              </div>
            )}
          </div>
          {/* end .rq-queue-card */}

        </div>
        {/* end .rq-wrap (body) */}
      </div>
      {/* end .rq-body */}

    </div>
  );
}
