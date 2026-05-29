import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import './WizardStep.css';

const APP_NO = 'EXP-2026-000145';
const REF_NO = 'REF-789654';

export default function Step8Success() {
  const navigate = useNavigate();
  const { resetForm, formData } = useApp();
  const [show, setShow] = useState(false);

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

Application Number : ${APP_NO}
Reference Number   : ${REF_NO}
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
    a.download = `Acknowledgement_${APP_NO}.txt`;
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

        {/* Reference Numbers */}
        <div className="success-ref-cards">
          <div className="ref-card">
            <div className="ref-card-label">Application Number</div>
            <div className="ref-card-value">{APP_NO}</div>
            <div className="ref-card-hint">Use this to track your application</div>
          </div>
          <div className="ref-card ref-card-secondary">
            <div className="ref-card-label">Reference Number</div>
            <div className="ref-card-value">{REF_NO}</div>
            <div className="ref-card-hint">Quote in all correspondence</div>
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
