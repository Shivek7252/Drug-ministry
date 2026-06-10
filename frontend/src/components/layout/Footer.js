import React from 'react';
import './Footer.css';

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-top">
        <div className="footer-inner">
          <div className="footer-col">
            <div className="footer-logo-wrap">
              <div className="footer-emblem">CDSCO</div>
              <div>
                <h3>CDSCO SUGAM Portal</h3>
                <p>Ministry of Health &amp; Family Welfare</p>
                <p>Government of India</p>
              </div>
            </div>
            <p className="footer-desc">
              The Central Drugs Standard Control Organisation (CDSCO) under Directorate General of Health Services,
              Ministry of Health &amp; Family Welfare, Government of India is the National Regulatory Authority (NRA) of India.
            </p>
          </div>

          <div className="footer-col">
            <h4>Quick Links</h4>
            <ul>
              <li><a href="#!">Home</a></li>
              <li><a href="#!">About CDSCO</a></li>
              <li><a href="#!">Export NOC Application</a></li>
              <li><a href="#!">Track Application</a></li>
              <li><a href="#!">Downloads</a></li>
              <li><a href="#!">Circulars &amp; Notifications</a></li>
            </ul>
          </div>

          <div className="footer-col">
            <h4>Help &amp; Support</h4>
            <ul>
              <li><a href="#!">User Manual</a></li>
              <li><a href="#!">FAQs</a></li>
              <li><a href="#!">Video Tutorials</a></li>
              <li><a href="#!">Helpdesk Portal</a></li>
              <li><a href="#!">Privacy Policy</a></li>
              <li><a href="#!">Terms &amp; Conditions</a></li>
            </ul>
          </div>

          <div className="footer-col">
            <h4>Contact Information</h4>
            <div className="footer-contact">
              <div className="contact-item">
                <span>📍</span>
                <span>FDA Bhawan, Kotla Road, New Delhi – 110002</span>
              </div>
              <div className="contact-item">
                <span>📞</span>
                <span>Helpdesk: 1800-11-4477 (Toll Free)</span>
              </div>
              <div className="contact-item">
                <span>📧</span>
                <span>helpdesk-cdsco@nic.in</span>
              </div>
              <div className="contact-item">
                <span>🌐</span>
                <span>www.cdsco.gov.in</span>
              </div>
              <div className="contact-item">
                <span>⏰</span>
                <span>Mon–Fri: 9:00 AM – 5:30 PM</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="footer-bottom">
        <div className="footer-bottom-inner">
          <span>© 2026 Central Drugs Standard Control Organisation. All Rights Reserved.</span>
          <div className="footer-bottom-links">
            <a href="#!">Privacy Policy</a>
            <span>|</span>
            <a href="#!">Terms &amp; Conditions</a>
            <span>|</span>
            <a href="#!">Disclaimer</a>
            <span>|</span>
            <a href="#!">Accessibility</a>
            <span>|</span>
            <a href="#!">Sitemap</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
