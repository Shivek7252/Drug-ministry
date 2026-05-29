import React, { useState } from 'react';
import './HelpPage.css';

const FAQS = [
  { q: 'What is an Export NOC?', a: 'An Export No Objection Certificate (NOC) is a document issued by CDSCO certifying that there is no objection to the export of specific drug products from India. It is required by importing countries as proof of regulatory compliance.' },
  { q: 'Who can apply for an Export NOC?', a: 'Pharmaceutical manufacturers, exporters, and authorized representatives holding a valid manufacturing license issued by the State Drug Authority can apply for an Export NOC through the CDSCO SUGAM portal.' },
  { q: 'What documents are required?', a: 'The following documents are required: (1) Manufacturing License, (2) Product Approval Certificate, (3) Export Authorization Letter, (4) Quality Assurance Certificate (GMP/ISO), (5) Batch Analysis Report, and optionally (6) Product Information Sheet.' },
  { q: 'How long does it take to get an Export NOC?', a: 'Typically, an Export NOC is processed within 7–10 working days after submission of a complete application with all required documents. Processing time may vary based on the complexity of the application.' },
  { q: 'What is the validity of an Export NOC?', a: 'An Export NOC is generally valid for one year from the date of issue, or until the expiry of the batch, whichever is earlier. The validity may vary based on the specific conditions mentioned in the certificate.' },
  { q: 'Can I track my application online?', a: 'Yes, you can track your application status in real-time using the "Track Application" feature on this portal. You will need your Application Number or Reference Number to track the status.' },
  { q: 'What file formats are accepted for document upload?', a: 'The portal accepts PDF, JPG, PNG, and DOCX formats. Each file must not exceed 5 MB in size. Ensure documents are clear and legible before uploading.' },
  { q: 'Can I save my application as a draft?', a: 'Yes, you can save your application as a draft at any step of the application process using the "Save Draft" button. You can resume your application later from where you left off.' }
];

export default function HelpPage() {
  const [openFaq, setOpenFaq] = useState(null);

  return (
    <div className="help-page">
      <div className="help-container">
        <div className="page-header">
          <div>
            <h1>Help &amp; Support</h1>
            <p>Find answers to frequently asked questions and get support</p>
          </div>
        </div>

        {/* Contact Cards */}
        <div className="help-contact-grid">
          <div className="help-contact-card">
            <div className="hc-icon">📞</div>
            <h3>Helpdesk</h3>
            <p className="hc-value">1800-11-4477</p>
            <p className="hc-sub">Toll Free · Mon–Fri 9AM–5:30PM</p>
          </div>
          <div className="help-contact-card">
            <div className="hc-icon">📧</div>
            <h3>Email Support</h3>
            <p className="hc-value">helpdesk-cdsco@nic.in</p>
            <p className="hc-sub">Response within 2 working days</p>
          </div>
          <div className="help-contact-card">
            <div className="hc-icon">🌐</div>
            <h3>Official Website</h3>
            <p className="hc-value">www.cdsco.gov.in</p>
            <p className="hc-sub">For circulars and notifications</p>
          </div>
          <div className="help-contact-card">
            <div className="hc-icon">📍</div>
            <h3>Office Address</h3>
            <p className="hc-value">FDA Bhawan, Kotla Road</p>
            <p className="hc-sub">New Delhi – 110002</p>
          </div>
        </div>

        {/* FAQs */}
        <div className="card">
          <div className="card-header">
            <span>❓</span>
            <h3>Frequently Asked Questions</h3>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {FAQS.map((faq, i) => (
              <div key={i} className={`faq-item ${openFaq === i ? 'open' : ''}`}>
                <button className="faq-question" onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                  <span>{faq.q}</span>
                  <span className="faq-arrow">{openFaq === i ? '▲' : '▼'}</span>
                </button>
                {openFaq === i && (
                  <div className="faq-answer fade-in">{faq.a}</div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* User Manual */}
        <div className="card mt-3">
          <div className="card-header">
            <span>📚</span>
            <h3>Resources &amp; Downloads</h3>
          </div>
          <div className="card-body">
            <div className="resources-grid">
              {[
                { icon: '📄', title: 'User Manual', desc: 'Step-by-step guide for Export NOC application', type: 'PDF' },
                { icon: '🎥', title: 'Video Tutorial', desc: 'Watch how to apply for Export NOC', type: 'VIDEO' },
                { icon: '📋', title: 'Checklist', desc: 'Document checklist for Export NOC', type: 'PDF' },
                { icon: '📜', title: 'Drugs & Cosmetics Act', desc: 'Drugs and Cosmetics Act, 1940', type: 'PDF' }
              ].map((r, i) => (
                <div key={i} className="resource-item">
                  <span className="resource-icon">{r.icon}</span>
                  <div>
                    <div className="resource-title">{r.title}</div>
                    <div className="resource-desc">{r.desc}</div>
                  </div>
                  <span className="resource-type">{r.type}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
