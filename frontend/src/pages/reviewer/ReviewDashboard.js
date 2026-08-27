import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { listApplications, searchFull } from '../../api/applicationService';
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

const INDIAN_STATES = [
  'All States',
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
  'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana',
  'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Delhi', 'Jammu & Kashmir',
];

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
      {Array.from({ length: 9 }).map((_, i) => (
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

  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQ, setSearchQ] = useState('');
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterState, setFilterState] = useState('All States');
  const [filterCat, setFilterCat] = useState('All');
  const [openedApps, setOpenedApps] = useState(() => getOpenedApps());

  /* ── Data fetching ──────────────────────────────────────────────────── */
  const loadApps = useCallback(async () => {
    setLoading(true);
    const res = await listApplications({ limit: 100, isDraft: 'false' });
    if (res.success) setApps(res.applications || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadApps(); }, [loadApps]);

  /* Debounced search */
  useEffect(() => {
    if (!searchQ.trim()) { loadApps(); return; }
    const t = setTimeout(async () => {
      const res = await searchFull(searchQ);
      if (res.success) setApps(res.results || []);
    }, 400);
    return () => clearTimeout(t);
  }, [searchQ]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Derived data ───────────────────────────────────────────────────── */
  const stats = useMemo(() => ({
    total: apps.length,
    submitted: apps.filter(a => a.status === 'Submitted').length,
    underReview: apps.filter(a => a.status === 'Under Review').length,
    queryRaised: apps.filter(a => a.status === 'Query Raised').length,
    approved: apps.filter(a => a.status === 'Approved').length,
    rejected: apps.filter(a => a.status === 'Rejected').length,
  }), [apps]);

  const filtered = useMemo(() => apps.filter(a => {
    if (filterStatus !== 'All' && a.status !== filterStatus) return false;
    if (filterState !== 'All States') {
      const haystack = (a.state || '') + (a.factoryAddress || '') + (a.city || '');
      if (!haystack.includes(filterState)) return false;
    }
    if (filterCat !== 'All' && a.exportCategory !== filterCat) return false;
    return true;
  }), [apps, filterStatus, filterState, filterCat]);

  const categories = useMemo(
    () => ['All', ...new Set(apps.map(a => a.exportCategory).filter(Boolean))],
    [apps],
  );

  const unseenCount = filtered.filter(a => isNewUnseen(a, openedApps)).length;
  const hasFilters = filterStatus !== 'All'
    || filterState !== 'All States'
    || filterCat !== 'All'
    || searchQ.trim() !== '';

  /* ── Handlers ───────────────────────────────────────────────────────── */
  const openConsignment = (app) => {
    markAppOpened(app.applicationNumber);
    setOpenedApps(getOpenedApps());
    navigate(`/review/application/${encodeURIComponent(app.applicationNumber)}`);
  };

  const handleKpiClick = (kpi) => setFilterStatus(kpi.filter);

  const resetFilters = () => {
    setFilterStatus('All');
    setFilterState('All States');
    setFilterCat('All');
    setSearchQ('');
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
                  onChange={e => setFilterStatus(e.target.value)}
                  aria-label="Filter by status"
                >
                  {STATUS_FILTERS.map(s => <option key={s}>{s}</option>)}
                </select>
              </label>

              <label className="rq-filter">
                <span>State</span>
                <select
                  value={filterState}
                  onChange={e => setFilterState(e.target.value)}
                  aria-label="Filter by state"
                >
                  {INDIAN_STATES.map(s => <option key={s}>{s}</option>)}
                </select>
              </label>

              <label className="rq-filter">
                <span>Category</span>
                <select
                  value={filterCat}
                  onChange={e => setFilterCat(e.target.value)}
                  aria-label="Filter by category"
                >
                  {categories.map(c => <option key={c}>{c}</option>)}
                </select>
              </label>

              {hasFilters && (
                <button className="rq-reset-btn" onClick={resetFilters}>
                  ↺ Reset
                </button>
              )}
            </div>
          </div>

          {/* ── Result count ──────────────────────────────────────── */}
          <div className="rq-result-bar" aria-live="polite" aria-atomic="true">
            <div>
              Showing&nbsp;<strong>{filtered.length}</strong>&nbsp;of&nbsp;
              {apps.length} application{apps.length !== 1 ? 's' : ''}
              {filterStatus !== 'All' && (
                <> · <span className="rq-active-filter">Status: {filterStatus}</span></>
              )}
              {filterState !== 'All States' && (
                <> · <span className="rq-active-filter">State: {filterState}</span></>
              )}
              {filterCat !== 'All' && (
                <> · <span className="rq-active-filter">Category: {filterCat}</span></>
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
              {!loading && filtered.length > 0 && (
                <span style={{ fontSize: 12, color: 'var(--muted-2)' }}>
                  {filtered.length} record{filtered.length !== 1 ? 's' : ''}
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
                      <th>Status</th>
                      <th className="rq-th-action">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: 6 }).map((_, i) => <LoadingRow key={i} />)}
                  </tbody>
                </table>
              </div>

            ) : filtered.length === 0 ? (
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
                  aria-label={`${filtered.length} application${filtered.length !== 1 ? 's' : ''} in review queue`}
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
                      <th scope="col">Status</th>
                      <th scope="col" className="rq-th-action">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(app => {
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
          </div>
          {/* end .rq-queue-card */}

        </div>
        {/* end .rq-wrap (body) */}
      </div>
      {/* end .rq-body */}

    </div>
  );
}
