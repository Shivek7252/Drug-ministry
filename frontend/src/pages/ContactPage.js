import React, { useState } from 'react';
import './ContactPage.css';

export default function ContactPage() {
  const [form, setForm] = useState({ name: '', email: '', subject: '', message: '' });
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    setSubmitted(true);
  };

  return (
    <div className="contact-page">
      <div className="contact-container">
        <div className="page-header">
          <h1>Contact Us</h1>
          <p>Get in touch with CDSCO for queries related to Export NOC and drug regulations</p>
        </div>

        <div className="contact-grid">
          {/* Contact Info */}
          <div className="contact-info-col">
            <div className="card">
              <div className="card-header"><span>📍</span><h3>CDSCO Headquarters</h3></div>
              <div className="card-body">
                <div className="contact-info-list">
                  <div className="ci-item">
                    <span className="ci-icon">📍</span>
                    <div>
                      <strong>Address</strong>
                      <p>FDA Bhawan, Kotla Road<br />New Delhi – 110002, India</p>
                    </div>
                  </div>
                  <div className="ci-item">
                    <span className="ci-icon">📞</span>
                    <div>
                      <strong>Helpdesk (Toll Free)</strong>
                      <p>1800-11-4477</p>
                      <p style={{ fontSize: 11.5, color: '#78909C' }}>Mon–Fri: 9:00 AM – 5:30 PM</p>
                    </div>
                  </div>
                  <div className="ci-item">
                    <span className="ci-icon">📧</span>
                    <div>
                      <strong>Email</strong>
                      <p>helpdesk-cdsco@nic.in</p>
                    </div>
                  </div>
                  <div className="ci-item">
                    <span className="ci-icon">🌐</span>
                    <div>
                      <strong>Website</strong>
                      <p>www.cdsco.gov.in</p>
                    </div>
                  </div>
                  <div className="ci-item">
                    <span className="ci-icon">📠</span>
                    <div>
                      <strong>Fax</strong>
                      <p>+91-11-23236975</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="card mt-2">
              <div className="card-header"><span>🏢</span><h3>Zonal Offices</h3></div>
              <div className="card-body">
                {[
                  { zone: 'Mumbai (West)', phone: '022-26592000' },
                  { zone: 'Kolkata (East)', phone: '033-22890000' },
                  { zone: 'Chennai (South)', phone: '044-24350000' },
                  { zone: 'Ahmedabad (West)', phone: '079-26580000' },
                  { zone: 'Hyderabad (South)', phone: '040-27190000' },
                  { zone: 'Guwahati (NE)', phone: '0361-2340000' }
                ].map((z, i) => (
                  <div key={i} className="zone-item">
                    <span className="zone-name">{z.zone}</span>
                    <span className="zone-phone">{z.phone}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Contact Form */}
          <div className="contact-form-col">
            <div className="card">
              <div className="card-header"><span>✉️</span><h3>Send a Message</h3></div>
              <div className="card-body">
                {submitted ? (
                  <div className="contact-success fade-in">
                    <div className="contact-success-icon">✅</div>
                    <h3>Message Sent Successfully!</h3>
                    <p>Thank you for contacting CDSCO. Our team will respond to your query within 2 working days.</p>
                    <button className="btn btn-primary mt-2" onClick={() => { setSubmitted(false); setForm({ name: '', email: '', subject: '', message: '' }); }}>
                      Send Another Message
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit}>
                    <div className="grid grid-2">
                      <div className="form-group">
                        <label className="form-label">Full Name<span className="required">*</span></label>
                        <input type="text" className="form-control" required value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Your full name" />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Email Address<span className="required">*</span></label>
                        <input type="email" className="form-control" required value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="your@email.com" />
                      </div>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Subject<span className="required">*</span></label>
                      <select className="form-control" required value={form.subject} onChange={e => setForm(p => ({ ...p, subject: e.target.value }))}>
                        <option value="">— Select Subject —</option>
                        <option>Export NOC Application Query</option>
                        <option>Application Status Inquiry</option>
                        <option>Document Upload Issue</option>
                        <option>Technical Support</option>
                        <option>General Inquiry</option>
                        <option>Other</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Message<span className="required">*</span></label>
                      <textarea className="form-control" required rows={5} value={form.message} onChange={e => setForm(p => ({ ...p, message: e.target.value }))} placeholder="Describe your query in detail..." />
                    </div>
                    <button type="submit" className="btn btn-primary btn-lg w-100">
                      📤 Send Message
                    </button>
                  </form>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
