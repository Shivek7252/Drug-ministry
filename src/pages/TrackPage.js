import React, { useState } from 'react';
import { TRACKING_TIMELINE, MOCK_APPLICATIONS } from '../data/mockData';
import './TrackPage.css';

function StatusBadge({ status }) {
  const map = {
    'Approved': 'badge-success',
    'Under Review': 'badge-info',
    'Pending': 'badge-warning',
    'Rejected': 'badge-danger'
  };
  return <span className={`badge ${map[status] || 'badge-primary'}`}>{status}</span>;
}

function TimelineStep({ step, isLast }) {
  const statusClass = {
    completed: 'tl-completed',
    inprogress: 'tl-inprogress',
    pending: 'tl-pending',
    rejected: 'tl-rejected'
  }[step.status] || 'tl-pending';

  const icons = {
    completed: '✓',
    inprogress: '⟳',
    pending: '○',
    rejected: '✕'
  };

  return (
    <div className={`timeline-step ${statusClass}`}>
      <div className="tl-left">
        <div className="tl-circle">{icons[step.status]}</div>
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
  const [appNo, setAppNo] = useState('');
  const [refNo, setRefNo] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);

  const handleSearch = () => {
    setError('');
    if (!appNo.trim() && !refNo.trim()) {
      setError('Please enter an Application Number or Reference Number to search.');
      return;
    }
    const found = MOCK_APPLICATIONS.find(a =>
      (appNo.trim() && a.id.toLowerCase() === appNo.trim().toLowerCase()) ||
      (refNo.trim() && a.refNo.toLowerCase() === refNo.trim().toLowerCase())
    );
    setSearched(true);
    if (found) {
      setResult({ app: found, timeline: TRACKING_TIMELINE[found.id] || [] });
    } else {
      setResult(null);
    }
  };

  const handleQuickSearch = (app) => {
    setAppNo(app.id);
    setRefNo('');
    setResult({ app, timeline: TRACKING_TIMELINE[app.id] || [] });
    setSearched(true);
    setError('');
  };

  return (
    <div className="track-page">
      <div className="track-container">
        {/* Header */}
        <div className="page-header">
          <div>
            <h1>Track Application</h1>
            <p>Track the status of your Export NOC application in real-time</p>
          </div>
        </div>

        {/* Search Card */}
        <div className="card mb-3">
          <div className="card-header">
            <span>🔍</span>
            <h3>Search Application</h3>
          </div>
          <div className="card-body">
            <div className="track-search-grid">
              <div className="form-group">
                <label className="form-label">Application Number</label>
                <input
                  type="text"
                  className="form-control"
                  value={appNo}
                  onChange={e => setAppNo(e.target.value)}
                  placeholder="e.g. EXP-2026-000145"
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                />
              </div>
              <div className="track-or">OR</div>
              <div className="form-group">
                <label className="form-label">Reference Number</label>
                <input
                  type="text"
                  className="form-control"
                  value={refNo}
                  onChange={e => setRefNo(e.target.value)}
                  placeholder="e.g. REF-789654"
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                />
              </div>
              <button className="btn btn-primary btn-lg track-search-btn" onClick={handleSearch}>
                🔍 Search
              </button>
            </div>
            {error && <div className="alert alert-danger mt-2"><span>⚠️</span><span>{error}</span></div>}
            <div className="track-hint">
              <span>💡</span>
              <span>Try: <strong>EXP-2026-000145</strong> or <strong>REF-789654</strong></span>
            </div>
          </div>
        </div>

        {/* Quick Search */}
        <div className="card mb-3">
          <div className="card-header">
            <span>⚡</span>
            <h3>Quick Search — Recent Applications</h3>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Application No.</th>
                    <th>Applicant</th>
                    <th>Country</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {MOCK_APPLICATIONS.map(app => (
                    <tr key={app.id}>
                      <td><strong style={{ color: '#003580' }}>{app.id}</strong></td>
                      <td>{app.applicant}</td>
                      <td>{app.country}</td>
                      <td>{app.date}</td>
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
          </div>
        </div>

        {/* Result */}
        {searched && !result && (
          <div className="alert alert-danger">
            <span>❌</span>
            <span>No application found with the provided details. Please check the Application Number or Reference Number and try again.</span>
          </div>
        )}

        {result && (
          <div className="track-result fade-in">
            {/* App Summary */}
            <div className="card mb-3">
              <div className="card-header">
                <span>📋</span>
                <h3>Application Summary</h3>
              </div>
              <div className="card-body">
                <div className="track-summary-grid">
                  <div className="track-summary-item">
                    <span className="ts-label">Application Number</span>
                    <span className="ts-value primary">{result.app.id}</span>
                  </div>
                  <div className="track-summary-item">
                    <span className="ts-label">Reference Number</span>
                    <span className="ts-value">{result.app.refNo}</span>
                  </div>
                  <div className="track-summary-item">
                    <span className="ts-label">Applicant</span>
                    <span className="ts-value">{result.app.applicant}</span>
                  </div>
                  <div className="track-summary-item">
                    <span className="ts-label">Destination Country</span>
                    <span className="ts-value">{result.app.country}</span>
                  </div>
                  <div className="track-summary-item">
                    <span className="ts-label">Export Category</span>
                    <span className="ts-value">{result.app.category}</span>
                  </div>
                  <div className="track-summary-item">
                    <span className="ts-label">Application Date</span>
                    <span className="ts-value">{result.app.date}</span>
                  </div>
                  <div className="track-summary-item">
                    <span className="ts-label">Current Status</span>
                    <span className="ts-value"><StatusBadge status={result.app.status} /></span>
                  </div>
                  <div className="track-summary-item">
                    <span className="ts-label">Products</span>
                    <span className="ts-value">{result.app.products} product(s)</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Timeline */}
            <div className="card">
              <div className="card-header">
                <span>📅</span>
                <h3>Application Status Timeline</h3>
              </div>
              <div className="card-body">
                <div className="timeline-legend">
                  <span className="tl-legend-item"><span className="tl-dot tl-dot-completed" />Completed</span>
                  <span className="tl-legend-item"><span className="tl-dot tl-dot-inprogress" />In Progress</span>
                  <span className="tl-legend-item"><span className="tl-dot tl-dot-pending" />Pending</span>
                  <span className="tl-legend-item"><span className="tl-dot tl-dot-rejected" />Rejected</span>
                </div>
                <div className="timeline">
                  {result.timeline.length > 0 ? (
                    result.timeline.map((step, i) => (
                      <TimelineStep key={i} step={step} isLast={i === result.timeline.length - 1} />
                    ))
                  ) : (
                    <div className="alert alert-info"><span>ℹ️</span><span>Timeline not available for this application.</span></div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
