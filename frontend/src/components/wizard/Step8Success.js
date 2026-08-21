import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import './WizardStep.css';

const APP_NO = 'EXP-2026-000145';
const REF_NO = 'REF-789654';

/* compute 1-year NOC expiry date string */
function nocExpiryDate() {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
}

export default function Step8Success() {
  const navigate = useNavigate();
  const { resetForm, formData, submittedAppNo, submittedRefNo, drugWarnings, allDrugsApproved } = useApp();
  const [show, setShow] = useState(false);

  // Use real submitted numbers if available, else fallback
  const appNo = submittedAppNo || APP_NO;
  const refNo = submittedRefNo || REF_NO;

  useEffect(() => {
    const t = setTimeout(() => setShow(true), 100);
    return () => clearTimeout(t);
  }, []);

  const handleDownloadAck = () => {
    const content = `
ACKNOWLEDGEMENT RECEIPT
========================
Central Drugs Standard Control Organisation (CDSCO)
Ministry of Health & Family Welfare, Government of India

Application Number : ${appNo}
Reference Number   : ${refNo}
Application Date   : ${formData.applicationDate || new Date().toLocaleDateString()}
Applicant Name     : ${formData.applicantName || 'N/A'}
Organization       : ${formData.applicantOrganization || 'N/A'}
Destination Country: ${formData.destinationCountry || 'N/A'}
Export Category    : ${formData.exportCategory || 'N/A'}
Products           : ${formData.products.length} product(s)

Status             : SUBMITTED — Under Review

This is a system-generated acknowledgement. Please quote the Application Number
and Reference Number in all future correspondence.

Generated: ${new Date().toLocaleString()}

CDSCO SUGAM Portal | www.cdsco.gov.in
Helpdesk: 1800-11-4477 | helpdesk-cdsco@nic.in
    `.trim();
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Acknowledgement_${appNo}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="wizard-step fade-in">
      <div className={`success-screen ${show ? 'success-bounce' : ''}`}>
        {/* Animation */}
        <div className="success-animation">
          <div className="success-circle">
            <svg viewBox="0 0 52 52" className="success-svg">
              <circle className="success-circle-bg" cx="26" cy="26" r="25" fill="none" />
              <path className="success-check" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8" />
            </svg>
          </div>
          <div className="success-ripple" />
          <div className="success-ripple ripple-2" />
        </div>

        <h1 className="success-title">Application Submitted Successfully!</h1>
        <p className="success-subtitle">
          Your Export NOC application has been received and is now under review by CDSCO.
        </p>

        {/* ── CDSCO Drug Approval Warnings ─────────────────────────────── */}
        {drugWarnings && drugWarnings.length > 0 && (
          <div style={{
            margin: '0 auto 20px',
            maxWidth: 620,
            background: '#FFF8E1',
            border: '1.5px solid #FFD54F',
            borderRadius: 10,
            padding: '14px 18px',
            textAlign: 'left',
          }}>
            <div style={{ fontWeight: 800, fontSize: 13.5, color: '#E65100', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              ⚠️ CDSCO Drug Approval Notice
            </div>
            <p style={{ fontSize: 12.5, color: '#5D4037', marginBottom: 8, lineHeight: 1.6 }}>
              The following product(s) were <strong>not found in the CDSCO approved drugs list</strong>.
              Your application has been submitted but reviewers will flag these for additional documentation.
              Please ensure valid approval certificates are attached.
            </p>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {drugWarnings.map((w, i) => (
                <li key={i} style={{ fontSize: 12.5, color: '#5D4037', marginBottom: 4 }}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {/* All drugs approved — positive confirmation ─────────────────── */}
        {allDrugsApproved && (!drugWarnings || drugWarnings.length === 0) && (
          <div style={{
            margin: '0 auto 20px',
            maxWidth: 620,
            background: '#E8F5E9',
            border: '1.5px solid #A5D6A7',
            borderRadius: 10,
            padding: '12px 18px',
            textAlign: 'left',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}>
            <span style={{ fontSize: 22 }}>✅</span>
            <span style={{ fontSize: 12.5, color: '#1B5E20', fontWeight: 600 }}>
              All submitted products are verified against the CDSCO approved drugs list.
            </span>
          </div>
        )}

        {/* Reference Numbers */}
        <div className="success-ref-cards">
          <div className="ref-card">
            <div className="ref-card-label">Application Number</div>
            <div className="ref-card-value">{appNo}</div>
            <div className="ref-card-hint">Use this to track your application</div>
          </div>
          <div className="ref-card ref-card-secondary">
            <div className="ref-card-label">Reference Number</div>
            <div className="ref-card-value">{refNo}</div>
            <div className="ref-card-hint">Quote in all correspondence</div>
          </div>
        </div>

        {/* NOC Validity Info — per guidance document */}
        <div style={{
          margin: '20px auto', maxWidth: 560,
          background: '#f0f7ff', border: '1.5px solid #bfdbfe',
          borderRadius: 12, padding: '16px 20px', textAlign: 'left',
        }}>
          <div style={{ fontWeight: 800, fontSize: 13.5, color: '#1e3a8a', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
            📜 Export NOC — Validity &amp; Process Summary
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 20px', fontSize: 12.5 }}>
            {[
              ['Step I Status',     '✅ Registered with Zonal Office'],
              ['NOC Validity',      '1 Year from date of issue'],
              ['Estimated Issue',   'Within 7 working days'],
              ['Estimated Expiry',  nocExpiryDate()],
              ['Sanctioned Qty',    'As per approved application'],
              ['NDPS / Banned',     'PO-specific NOC issued separately'],
            ].map(([k, v]) => (
              <div key={k}>
                <div style={{ color: '#64748b', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.3px' }}>{k}</div>
                <div style={{ color: '#0f172a', fontWeight: 600, marginTop: 2 }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, fontSize: 11.5, color: '#1e40af', background: '#e0f2fe', borderRadius: 7, padding: '8px 12px', lineHeight: 1.6 }}>
            <strong>Step II (Reconciliation):</strong> After NOC approval, log each export consignment
            using the <strong>Reconciliation Module</strong> on the Track page.
            The module remains open throughout the NOC validity period.
            Formulations with &lt;60% residual shelf life must be destroyed in presence of SLA.
          </div>
        </div>

        {/* What's Next */}
        <div className="success-next-steps">
          <h3>What happens next?</h3>
          <div className="next-steps-grid">
            <div className="next-step-item">
              <div className="next-step-icon">📧</div>
              <div>
                <strong>Email Confirmation</strong>
                <p>A confirmation email will be sent to {formData.email || 'your registered email'}</p>
              </div>
            </div>
            <div className="next-step-item">
              <div className="next-step-icon">🔍</div>
              <div>
                <strong>Document Verification</strong>
                <p>CDSCO officers will verify your uploaded documents within 3–5 working days</p>
              </div>
            </div>
            <div className="next-step-item">
              <div className="next-step-icon">✅</div>
              <div>
                <strong>NOC Issuance</strong>
                <p>Upon successful verification, the Export NOC will be issued within 7–10 working days</p>
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="success-actions">
          <button className="btn btn-primary btn-lg" onClick={handleDownloadAck}>
            ⬇️ Download Acknowledgement
          </button>
          <button className="btn btn-secondary btn-lg" onClick={() => navigate('/track')}>
            🔍 Track Application
          </button>
          <button
            className="btn btn-secondary btn-lg"
            style={{ background: '#003580', color: '#fff', border: 'none' }}
            onClick={() => navigate('/track')}
            title="Track your application and open Step II Reconciliation"
          >
            🚢 Step II Reconciliation
          </button>
          <button className="btn btn-outline btn-lg" onClick={() => { resetForm(); navigate('/'); }}>
            ⊞ Go to Dashboard
          </button>
        </div>

        <div className="success-footer-note">
          <span>📞</span>
          <span>For queries, contact CDSCO Helpdesk: <strong>1800-11-4477</strong> (Toll Free) or email <strong>helpdesk-cdsco@nic.in</strong></span>
        </div>
      </div>
    </div>
  );
}
