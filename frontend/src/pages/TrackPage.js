import React, { useState, useEffect } from 'react';
import { searchApplication, getApplication, listApplications } from '../api/applicationService';
import './TrackPage.css';

function StatusBadge({ status }) {
  const map = {
    'Approved': 'badge-success', 'Under Review': 'badge-info',
    'Pending': 'badge-warning',  'Rejected': 'badge-danger',
    'Submitted': 'badge-info',   'Draft': 'badge-warning',
    'Document Verification': 'badge-info', 'Compliance Check': 'badge-info',
  };
  return <span className={`badge ${map[status] || 'badge-primary'}`}>{status}</span>;
}

function TimelineStep({ step, isLast }) {
  const statusClass = {
    completed: 'tl-completed', inprogress: 'tl-inprogress',
    pending: 'tl-pending',     rejected: 'tl-rejected',
  }[step.status] || 'tl-pending';
  const icons = { completed: '✓', inprogress: '⟳', pending: '○', rejected: '✕' };
  return (
    <div className={`timeline-step ${statusClass}`}>
      <div className="tl-left">
        <div className="tl-circle">{icons[step.status] || '○'}</div>
        {!isLast && <div className="tl-line" />}
      </div>
      <div className="tl-content">
        <div className="tl-step-name">{step.step}</div>
        <div className="tl-date">{step.date}</div>
        <div className="tl-desc">{step.desc}</div>
      </div>
    </div>
  );
}

export default function TrackPage() {
  const [appNo,    setAppNo]    = useState('');
  const [refNo,    setRefNo]    = useState('');
  const [result,   setResult]   = useState(null);
  const [error,    setError]    = useState('');
  const [searched, setSearched] = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [recentApps, setRecentApps] = useState([]);
  const [dbOnline,   setDbOnline]   = useState(true);

  // Load recent applications on mount — DB only, no mock fallback
  useEffect(() => {
    (async () => {
      const res = await listApplications({ limit: 10 });
      if (res.success) {
        setRecentApps(res.applications || []);
        setDbOnline(true);
      } else {
        setRecentApps([]);
        setDbOnline(false);
      }
    })();
  }, []);

  const buildResult = (app) => {
    const timeline = app.timeline || [
      { step: 'Application Submitted', date: app.submittedAt ? new Date(app.submittedAt).toLocaleString('en-IN') : app.applicationDate || '—', status: 'completed', desc: 'Application received' },
      { step: 'Under Review',          date: 'Pending', status: ['Under Review','Document Verification','Compliance Check','Approved'].includes(app.status) ? 'completed' : 'pending', desc: 'Being reviewed by Drug Controller Officer' },
      { step: 'Document Verification', date: 'Pending', status: ['Document Verification','Compliance Check','Approved'].includes(app.status) ? 'completed' : 'pending', desc: 'Document verification' },
      { step: 'Compliance Check',      date: 'Pending', status: ['Compliance Check','Approved'].includes(app.status) ? 'completed' : 'pending', desc: 'Compliance check' },
      { step: 'NOC Decision',          date: app.status === 'Approved' ? '—' : 'Pending', status: app.status === 'Approved' ? 'completed' : app.status === 'Rejected' ? 'rejected' : 'pending', desc: 'Final NOC decision' },
    ];
    return { app, timeline };
  };

  const handleSearch = async () => {
    setError(''); setResult(null);
    if (!appNo.trim() && !refNo.trim()) {
      setError('Please enter an Application Number or Reference Number to search.');
      return;
    }
    setLoading(true); setSearched(true);
    try {
      // Try live DB first
      const res = await searchApplication(appNo.trim() || null, refNo.trim() || null);
      if (res.success && res.results?.length > 0) {
        // Get full details for the first match
        const detail = await getApplication(res.results[0].applicationNumber);
        const fullApp = detail.success ? detail.application : res.results[0];
        setResult(buildResult(fullApp));
      } else {
        // Not found in DB
        setResult(null);
      }
      if (!res.success) {
        setError(res.error || 'Search failed. Please ensure the backend is running.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleQuickSearch = async (app) => {
    setAppNo(app.applicationNumber || app.id || '');
    setRefNo('');
    setError('');
    setSearched(true);
    setLoading(true);
    try {
      const id = app.applicationNumber || app.id;
      const detail = await getApplication(id);
      const fullApp = detail.success ? detail.application : app;
      setResult(buildResult(fullApp));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="track-page">
      <div className="track-container">
        <div className="page-header">
          <div>
            <h1>Track Application</h1>
            <p>Track the status of your Export NOC application in real-time</p>
          </div>
          {!dbOnline && (
            <div className="alert alert-warning" style={{margin:'12px 0 0'}}>
              <span>⚠️</span>
              <span>Could not connect to backend. Start the server with <code>cd backend &amp;&amp; npm start</code> and ensure MongoDB is running.</span>
            </div>
          )}
        </div>

        {/* Search Card */}
        <div className="card mb-3">
          <div className="card-header"><span>🔍</span><h3>Search Application</h3></div>
          <div className="card-body">
            <div className="track-search-grid">
              <div className="form-group">
                <label className="form-label">Application Number</label>
                <input type="text" className="form-control" value={appNo}
                  onChange={e => setAppNo(e.target.value)}
                  placeholder="e.g. EXP-2026-000145"
                  onKeyDown={e => e.key === 'Enter' && handleSearch()} />
              </div>
              <div className="track-or">OR</div>
              <div className="form-group">
                <label className="form-label">Reference Number</label>
                <input type="text" className="form-control" value={refNo}
                  onChange={e => setRefNo(e.target.value)}
                  placeholder="e.g. REF-789654"
                  onKeyDown={e => e.key === 'Enter' && handleSearch()} />
              </div>
              <button className="btn btn-primary btn-lg track-search-btn"
                onClick={handleSearch} disabled={loading}>
                {loading ? '⏳ Searching…' : '🔍 Search'}
              </button>
            </div>
            {error && <div className="alert alert-danger mt-2"><span>⚠️</span><span>{error}</span></div>}
            <div className="track-hint">
              <span>💡</span>
              <span>Enter the Application Number or Reference Number received after submission</span>
            </div>
          </div>
        </div>

        {/* Recent Applications table */}
        <div className="card mb-3">
          <div className="card-header"><span>⚡</span><h3>Recent Applications</h3></div>
          <div className="card-body" style={{ padding: 0 }}>
            {recentApps.length === 0 ? (
              <div style={{padding:'20px',textAlign:'center',color:'#94a3b8'}}>
                No applications found. <a href="/apply" style={{color:'#1a56a0'}}>Submit your first application →</a>
              </div>
            ) : (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Application No.</th><th>Applicant</th><th>Country</th>
                      <th>Date</th><th>Status</th><th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentApps.map((app, i) => (
                      <tr key={app.applicationNumber || i}>
                        <td><strong style={{color:'#003580'}}>{app.applicationNumber || app.id}</strong></td>
                        <td>{app.applicantOrganization || app.applicant || '—'}</td>
                        <td>{app.destinationCountry || app.country || '—'}</td>
                        <td>{app.applicationDate || app.date || (app.createdAt ? new Date(app.createdAt).toLocaleDateString('en-IN') : '—')}</td>
                        <td><StatusBadge status={app.status} /></td>
                        <td>
                          <button className="btn btn-outline btn-sm" onClick={() => handleQuickSearch(app)}>
                            🔍 Track
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

        {/* Not found */}
        {searched && !result && !loading && !error && (
          <div className="alert alert-danger">
            <span>❌</span>
            <span>No application found. Please check the Application Number or Reference Number.</span>
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="track-result fade-in">
            <div className="card mb-3">
              <div className="card-header"><span>📋</span><h3>Application Summary</h3></div>
              <div className="card-body">
                <div className="track-summary-grid">
                  {[
                    ['Application Number', result.app.applicationNumber],
                    ['Reference Number',   result.app.referenceNumber],
                    ['Applicant Name',     result.app.applicantName],
                    ['Organization',       result.app.applicantOrganization],
                    ['Destination Country',result.app.destinationCountry],
                    ['Export Category',    result.app.exportCategory],
                    ['Application Date',   result.app.applicationDate],
                    ['Application Type',   result.app.applicationType],
                    ['Contact Email',      result.app.email],
                    ['Products',           result.app.products ? `${result.app.products.length} product(s)` : '—'],
                    ['Submitted At',       result.app.submittedAt ? new Date(result.app.submittedAt).toLocaleString('en-IN') : '—'],
                    ['Current Status',     null],
                  ].map(([label, value]) => (
                    <div key={label} className="track-summary-item">
                      <span className="ts-label">{label}</span>
                      <span className="ts-value">
                        {label === 'Current Status'
                          ? <StatusBadge status={result.app.status} />
                          : label === 'Application Number'
                            ? <strong style={{color:'#003580'}}>{value}</strong>
                            : value || '—'}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Manufacturer details */}
                {result.app.manufacturerName && (
                  <div style={{marginTop:16,paddingTop:12,borderTop:'1px solid #e2e8f0'}}>
                    <div style={{fontWeight:700,fontSize:13,color:'#475569',marginBottom:8}}>🏭 Manufacturer</div>
                    <div className="track-summary-grid">
                      {[
                        ['Manufacturer',    result.app.manufacturerName],
                        ['License No.',     result.app.mfgLicenseNo],
                        ['Signatory',       result.app.signatoryName],
                        ['Designation',     result.app.signatoryDesignation],
                      ].filter(([,v])=>v).map(([l,v]) => (
                        <div key={l} className="track-summary-item">
                          <span className="ts-label">{l}</span>
                          <span className="ts-value">{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Products table */}
                {result.app.products?.length > 0 && result.app.products[0]?.productName && (
                  <div style={{marginTop:16,paddingTop:12,borderTop:'1px solid #e2e8f0'}}>
                    <div style={{fontWeight:700,fontSize:13,color:'#475569',marginBottom:8}}>💊 Products</div>
                    <div className="table-wrapper">
                      <table>
                        <thead>
                          <tr><th>#</th><th>Product</th><th>Generic</th><th>Form</th><th>Strength</th><th>Batch</th></tr>
                        </thead>
                        <tbody>
                          {result.app.products.map((p, i) => (
                            <tr key={i}>
                              <td>{i+1}</td>
                              <td><strong>{p.productName}</strong></td>
                              <td>{p.genericName}</td>
                              <td><span className="badge badge-info">{p.dosageForm}</span></td>
                              <td>{p.strength}</td>
                              <td><code>{p.batchNumber}</code></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Documents */}
                {result.app.documents && Object.keys(result.app.documents).length > 0 && (
                  <div style={{marginTop:16,paddingTop:12,borderTop:'1px solid #e2e8f0'}}>
                    <div style={{fontWeight:700,fontSize:13,color:'#475569',marginBottom:8}}>📁 Uploaded Documents</div>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                      {Object.entries(result.app.documents).map(([id, doc]) => (
                        <div key={id} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 10px',background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:7}}>
                          <span style={{fontSize:18}}>✅</span>
                          <div>
                            <div style={{fontSize:12.5,fontWeight:600,color:'#15803d'}}>{doc.name}</div>
                            <div style={{fontSize:11,color:'#64748b'}}>{doc.uploadedAt}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Timeline */}
            <div className="card">
              <div className="card-header"><span>📅</span><h3>Application Status Timeline</h3></div>
              <div className="card-body">
                <div className="timeline-legend">
                  <span className="tl-legend-item"><span className="tl-dot tl-dot-completed"/>Completed</span>
                  <span className="tl-legend-item"><span className="tl-dot tl-dot-inprogress"/>In Progress</span>
                  <span className="tl-legend-item"><span className="tl-dot tl-dot-pending"/>Pending</span>
                </div>
                <div className="timeline">
                  {result.timeline.length > 0
                    ? result.timeline.map((step, i) => (
                        <TimelineStep key={i} step={step} isLast={i === result.timeline.length - 1} />
                      ))
                    : <div className="alert alert-info"><span>ℹ️</span><span>Timeline not available.</span></div>
                  }
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
