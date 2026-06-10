import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { listApplications, searchFull, reviewerAction } from '../../api/applicationService';
import ReviewApplicationDetail from './ReviewApplicationDetail';
import './ReviewDashboard.css';

const STATUS_FILTERS = ['All','Submitted','Under Review','Verified','Query Raised','Approved','Rejected'];
const INDIAN_STATES  = ['All States','Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Delhi','Jammu & Kashmir'];

const STAT_CONFIG = [
  { key:'total',       label:'Total',      color:'#1a56a0' },
  { key:'submitted',   label:'New',        color:'#d97706' },
  { key:'underReview', label:'In Review',  color:'#7c3aed' },
  { key:'approved',    label:'Approved',   color:'#15803d' },
  { key:'rejected',    label:'Rejected',   color:'#dc2626' },
];

function StatusBadge({ status }) {
  const styles = {
    'Approved':     { bg:'#f0fdf4', color:'#15803d', border:'#bbf7d0' },
    'Submitted':    { bg:'#eff6ff', color:'#1d4ed8', border:'#bfdbfe' },
    'Under Review': { bg:'#fefce8', color:'#a16207', border:'#fde68a' },
    'Verified':     { bg:'#f0fdf4', color:'#15803d', border:'#bbf7d0' },
    'Query Raised': { bg:'#fff7ed', color:'#c2410c', border:'#fdba74' },
    'Rejected':     { bg:'#fef2f2', color:'#dc2626', border:'#fecaca' },
    'Pending':      { bg:'#fefce8', color:'#a16207', border:'#fde68a' },
    'Draft':        { bg:'#f8fafc', color:'#64748b', border:'#e2e8f0' },
  };
  const s = styles[status] || styles['Draft'];
  return (
    <span className="rv-status-badge" style={{ background:s.bg, color:s.color, borderColor:s.border }}>
      {status}
    </span>
  );
}

export default function ReviewDashboard() {
  const { currentUser } = useApp();
  const [apps,          setApps]          = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [searchQ,       setSearchQ]       = useState('');
  const [filterStatus,  setFilterStatus]  = useState('All');
  const [filterState,   setFilterState]   = useState('All States');
  const [filterCat,     setFilterCat]     = useState('All');
  const [selectedApp,   setSelectedApp]   = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [stats, setStats] = useState({ total:0, submitted:0, underReview:0, approved:0, rejected:0 });

  const loadApps = useCallback(async () => {
    setLoading(true);
    const res = await listApplications({ limit:100, isDraft:'false' });
    if (res.success) {
      const all = res.applications || [];
      setApps(all);
      setStats({
        total:       all.length,
        submitted:   all.filter(a=>a.status==='Submitted').length,
        underReview: all.filter(a=>a.status==='Under Review').length,
        approved:    all.filter(a=>a.status==='Approved').length,
        rejected:    all.filter(a=>a.status==='Rejected').length,
      });
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadApps(); }, [loadApps]);

  useEffect(() => {
    if (!searchQ.trim()) { loadApps(); return; }
    const t = setTimeout(async () => {
      const res = await searchFull(searchQ);
      if (res.success) setApps(res.results || []);
    }, 400);
    return () => clearTimeout(t);
  }, [searchQ]); // eslint-disable-line

  const filtered = apps.filter(a => {
    if (filterStatus !== 'All' && a.status !== filterStatus) return false;
    if (filterState  !== 'All States') {
      const inState = (a.state || '') + (a.factoryAddress || '') + (a.city || '');
      if (!inState.includes(filterState)) return false;
    }
    if (filterCat !== 'All' && a.exportCategory !== filterCat) return false;
    return true;
  });

  const handleAction = async (appNumber, status, remarks) => {
    setActionLoading(true);
    await reviewerAction(appNumber, { status, remarks, officer: currentUser });
    await loadApps();
    if (selectedApp?.applicationNumber === appNumber) {
      setSelectedApp(p => p ? {...p, status} : p);
    }
    setActionLoading(false);
  };

  const categories = ['All', ...new Set(apps.map(a=>a.exportCategory).filter(Boolean))];

  const handleStatClick = (key) => {
    const map = { submitted:'Submitted', underReview:'Under Review', approved:'Approved', rejected:'Rejected' };
    setFilterStatus(map[key] || 'All');
    setSelectedApp(null);
  };

  return (
    <div className="rv-page">
      {/* ── Page header ── */}
      <div className="rv-page-header">
        <div>
          <h1 className="rv-page-title">Export NOC Review Dashboard</h1>
          <p className="rv-page-sub">Centralized application review and verification portal · CDSCO SUGAM</p>
        </div>
        <div className="rv-officer-pill">
          <div className="rv-officer-pill-avatar">👨‍💼</div>
          <div>
            <div style={{fontSize:12,fontWeight:700}}>{currentUser}</div>
            <div style={{fontSize:10,opacity:.7}}>Drug Controller Officer</div>
          </div>
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div className="rv-stats-row">
        {STAT_CONFIG.map(s => (
          <div key={s.key}
            className={`rv-stat-card ${filterStatus === (s.key==='total'?'All': s.key==='submitted'?'Submitted':s.key==='underReview'?'Under Review':s.key==='approved'?'Approved':'Rejected') ? 'active' : ''}`}
            onClick={() => handleStatClick(s.key)}>
            <span className="rv-stat-num" style={{color:s.color}}>{stats[s.key]}</span>
            <span className="rv-stat-label">{s.label}</span>
          </div>
        ))}
      </div>

      {/* ── Main container ── */}
      <div className="rv-container">

        {/* Filter bar */}
        <div className="rv-filter-bar">
          <div className="rv-search-box">
            <span className="rv-search-box-icon">🔍</span>
            <input placeholder="Search by App No., Ref No., Applicant, Email, License…"
              value={searchQ} onChange={e => setSearchQ(e.target.value)} />
            {searchQ && <button className="rv-search-clear" onClick={() => setSearchQ('')}>✕</button>}
          </div>
          <div className="rv-filter-sep"/>
          <div className="rv-filter-select">
            <label>Status</label>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              {STATUS_FILTERS.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="rv-filter-select">
            <label>State</label>
            <select value={filterState} onChange={e => setFilterState(e.target.value)}>
              {INDIAN_STATES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="rv-filter-select">
            <label>Category</label>
            <select value={filterCat} onChange={e => setFilterCat(e.target.value)}>
              {categories.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <button className="rv-reset-btn" onClick={() => { setFilterStatus('All'); setFilterState('All States'); setFilterCat('All'); setSearchQ(''); }}>
            ↺ Reset
          </button>
          <span className="rv-count-badge">
            Showing <strong>{filtered.length}</strong> / {apps.length} applications
          </span>
        </div>

        {/* Split content */}
        <div className="rv-content-split">

          {/* Applications table */}
          <div className="rv-table-col">
            <div className="rv-table-card">
              <div className="rv-table-card-header">
                <span className="rv-table-card-title">📋 Review Queue</span>
                {loading && <span style={{fontSize:12,color:'#94a3b8'}}>⏳ Loading…</span>}
              </div>
              {loading ? (
                <div className="rv-state-box">
                  <div className="rv-spinner"/>
                  <span className="rv-state-sub">Loading applications…</span>
                </div>
              ) : filtered.length === 0 ? (
                <div className="rv-state-box">
                  <div className="rv-state-icon">📭</div>
                  <div className="rv-state-title">No applications found</div>
                  <div className="rv-state-sub">Try adjusting your filters or search query</div>
                </div>
              ) : (
                <div className="rv-table-scroll">
                  <table className="rv-table">
                    <thead>
                      <tr>
                        <th>App No.</th>
                        <th>Ref No.</th>
                        <th>Applicant</th>
                        <th>State</th>
                        <th>Category</th>
                        <th>Country</th>
                        <th>Date</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(app => (
                        <tr key={app.applicationNumber}
                          className={selectedApp?.applicationNumber === app.applicationNumber ? 'rv-row-selected' : ''}
                          onClick={() => setSelectedApp(app)}>
                          <td><span className="rv-app-no">{app.applicationNumber}</span></td>
                          <td><span className="rv-ref-no">{app.referenceNumber}</span></td>
                          <td>
                            <div className="rv-org-name">{app.applicantOrganization || app.applicantName || '—'}</div>
                            <div className="rv-org-email">{app.email || ''}</div>
                          </td>
                          <td><span style={{fontSize:11.5,color:'#475569'}}>{app.state || app.city || '—'}</span></td>
                          <td><span className="rv-cat-pill">{app.exportCategory || '—'}</span></td>
                          <td><span style={{fontSize:11.5}}>{app.destinationCountry || '—'}</span></td>
                          <td className="rv-date-cell">{app.submittedAt ? new Date(app.submittedAt).toLocaleDateString('en-IN') : app.applicationDate || '—'}</td>
                          <td><StatusBadge status={app.status}/></td>
                          <td>
                            <button className="rv-open-btn" onClick={e=>{e.stopPropagation();setSelectedApp(app);}}>
                              Open →
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Detail panel */}
          {selectedApp && (
            <div className="rv-detail-col">
              <ReviewApplicationDetail
                app={selectedApp}
                onClose={() => setSelectedApp(null)}
                onAction={handleAction}
                actionLoading={actionLoading}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
