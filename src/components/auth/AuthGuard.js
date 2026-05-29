import React from 'react';
import { useApp } from '../../context/AppContext';
import './AuthGuard.css';

export default function AuthGuard({ children }) {
  const { isLoggedIn, setLoginOpen } = useApp();

  if (isLoggedIn) return children;

  return (
    <div className="auth-guard-page">

      {/* ── Hero Banner ── */}
      <div className="ag-hero">
        <div className="ag-hero-content">
          <div className="ag-hero-badge">CDSCO SUGAM Portal</div>
          <h1>Export NOC Management System</h1>
          <p>
            A comprehensive e-Governance solution for pharmaceutical manufacturers and exporters
            to apply, track, and manage Export No Objection Certificates online.
          </p>
          <div className="ag-hero-btns">
            <button className="ag-btn-primary" onClick={() => setLoginOpen(true)}>
              🔑 Login to Portal
            </button>
            <button className="ag-btn-outline" onClick={() => setLoginOpen(true)}>
              📝 Register / Sign Up
            </button>
          </div>
        </div>
        <div className="ag-hero-visual">
          <div className="ag-visual-circle">
            <div className="ag-visual-inner">
              <span className="ag-visual-icon">💊</span>
              <span className="ag-visual-label">Export NOC</span>
            </div>
          </div>
          <div className="ag-orbit ag-orbit-1"><span>📋</span></div>
          <div className="ag-orbit ag-orbit-2"><span>✅</span></div>
          <div className="ag-orbit ag-orbit-3"><span>🌍</span></div>
        </div>
      </div>

      {/* ── Feature Cards ── */}
      <div className="ag-features">
        <div className="ag-feature-card">
          <div className="ag-fc-icon" style={{ background: '#E3F2FD' }}>📋</div>
          <h3>Apply Online</h3>
          <p>Submit Export NOC applications through a guided 8-step wizard with document upload support.</p>
        </div>
        <div className="ag-feature-card">
          <div className="ag-fc-icon" style={{ background: '#E8F5E9' }}>🔍</div>
          <h3>Track Status</h3>
          <p>Real-time application tracking with detailed status timeline from submission to approval.</p>
        </div>
        <div className="ag-feature-card">
          <div className="ag-fc-icon" style={{ background: '#FFF3E0' }}>📊</div>
          <h3>Dashboard</h3>
          <p>Comprehensive analytics dashboard with charts for applications, approvals, and export trends.</p>
        </div>
        <div className="ag-feature-card">
          <div className="ag-fc-icon" style={{ background: '#FCE4EC' }}>🔒</div>
          <h3>Secure Portal</h3>
          <p>Government-grade secure portal with authenticated access for registered pharmaceutical companies.</p>
        </div>
      </div>

      {/* ── Login CTA strip ── */}
      <div className="ag-cta-strip">
        <div className="ag-cta-text">
          <strong>Ready to apply for Export NOC?</strong>
          <span>Login to access the full portal and start your application.</span>
        </div>
      </div>

    </div>
  );
}
