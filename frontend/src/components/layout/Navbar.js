import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { NOTIFICATIONS } from '../../data/mockData';
import LoginModal from '../auth/LoginModal';
import './Navbar.css';

// Font-size levels: 0 = small (A-), 1 = normal (A), 2 = large (A+)
const FONT_SIZES = [14, 16, 18]; // px values applied to <html>

export default function Navbar() {
  const location  = useLocation();
  const navigate  = useNavigate();
  const { notifOpen, setNotifOpen, isLoggedIn, setLoginOpen, logout, currentUser } = useApp();
  const [mobileMenu,   setMobileMenu]   = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [fontSize,     setFontSize]     = useState(1); // default = normal (index 1)
  const unread = NOTIFICATIONS.filter(n => !n.read).length;

  // Apply font size to <html> whenever it changes
  useEffect(() => {
    document.documentElement.style.fontSize = FONT_SIZES[fontSize] + 'px';
  }, [fontSize]);

  const navLinks = [
    { path: '/',        label: 'Dashboard',        icon: '⊞' },
    { path: '/apply',   label: 'Export NOC',        icon: '📋' },
    { path: '/track',   label: 'Track Application', icon: '🔍' },
    { path: '/help',    label: 'Help',              icon: '❓' },
    { path: '/contact', label: 'Contact',           icon: '📞' },
  ];

  const handleNavClick = (e, path) => {
    if (!isLoggedIn) {
      e.preventDefault();
      setLoginOpen(true);
      setMobileMenu(false);
    } else {
      setMobileMenu(false);
    }
  };

  const handleLogout = () => {
    setUserMenuOpen(false);
    logout();
    navigate('/');
  };

  return (
    <>
      {/* ── Top strip ── */}
      <div className="top-strip">
        <div className="top-strip-inner">
          <div className="top-strip-left">
            <span className="strip-bell">🔔</span>
            <span className="strip-notice">G.S.R. 50(E) is live on the SUGAM Portal (21 April 2026)</span>
          </div>
          <div className="top-strip-right">
            <span className="strip-link">Skip to Main Content</span>
            <span className="strip-sep">|</span>
            <span className="strip-link">Screen Reader Access</span>
            <span className="strip-sep">|</span>

            {/* Font-size group */}
            <div className="font-size-group">
              {[
                { label: 'A-', idx: 0, title: 'Decrease font size' },
                { label: 'A',  idx: 1, title: 'Default font size'  },
                { label: 'A+', idx: 2, title: 'Increase font size' },
              ].map(({ label, idx, title }) => (
                <button
                  key={label}
                  className={`font-size-btn ${fontSize === idx ? 'font-size-active' : ''}`}
                  onClick={() => setFontSize(idx)}
                  title={title}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Header ── */}
      <header className="site-header">
        <div className="header-inner">
          <div className="header-brand">
            <div className="header-logo">
              <div className="logo-emblem">
                <div className="emblem-circle">
                  <span className="emblem-text">CDSCO</span>
                </div>
              </div>
              <div className="header-title">
                <h1>Central Drugs Standard Control Organisation</h1>
                <p>Directorate General Of Health Services</p>
                <p>Ministry of Health &amp; Family Welfare, Government of India</p>
                <span className="sugam-tag">SUGAM — An e-Governance solution for CDSCO</span>
              </div>
            </div>
          </div>

          <div className="header-actions">
            <div className="header-nav-icons">
              {[
                { icon: '🏠', label: 'Home' },
                { icon: 'ℹ️', label: 'About Us' },
                { icon: '⬇️', label: 'Downloads' },
                { icon: '💊', label: 'Drugs' },
                { icon: '🏷️', label: 'Brands' },
                { icon: '📞', label: 'Contact Us' },
              ].map(item => (
                <div key={item.label} className="nav-icon-item">
                  <span className="nav-icon">{item.icon}</span>
                  <span>{item.label}</span>
                </div>
              ))}
            </div>

            <div className="header-right-actions">
              {isLoggedIn && (
                <button className="notif-btn" onClick={() => setNotifOpen(!notifOpen)}>
                  🔔
                  {unread > 0 && <span className="notif-badge">{unread}</span>}
                </button>
              )}

              {isLoggedIn ? (
                <div className="user-menu-wrap">
                  <button className="user-btn" onClick={() => setUserMenuOpen(o => !o)}>
                    <span className="user-avatar">👤</span>
                    <span className="user-name">{currentUser}</span>
                    <span className="user-arrow">▾</span>
                  </button>
                  {userMenuOpen && (
                    <>
                      <div className="user-dropdown fade-in">
                        <div className="user-dropdown-header">
                          <div className="ud-avatar">👤</div>
                          <div>
                            <div className="ud-name">{currentUser}</div>
                            <div className="ud-role">Registered User</div>
                          </div>
                        </div>
                        <div className="ud-divider" />
                        <button className="ud-item" onClick={() => { setUserMenuOpen(false); navigate('/apply'); }}>📋 My Applications</button>
                        <button className="ud-item" onClick={() => { setUserMenuOpen(false); navigate('/track'); }}>🔍 Track Application</button>
                        <button className="ud-item" onClick={() => { setUserMenuOpen(false); navigate('/help'); }}>❓ Help</button>
                        <div className="ud-divider" />
                        <button className="ud-item ud-logout" onClick={handleLogout}>🚪 Logout</button>
                      </div>
                      <div className="user-dropdown-overlay" onClick={() => setUserMenuOpen(false)} />
                    </>
                  )}
                </div>
              ) : (
                <button className="login-btn" onClick={() => setLoginOpen(true)}>
                  LOGIN / SIGN UP
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ── Main Nav ── */}
      <nav className="main-nav">
        <div className="main-nav-inner">
          <button className="mobile-menu-btn" onClick={() => setMobileMenu(!mobileMenu)}>
            ☰ Menu
          </button>
          <ul className={`nav-links ${mobileMenu ? 'open' : ''}`}>
            {navLinks.map(link => {
              const isActive =
                location.pathname === link.path ||
                (link.path === '/apply' && location.pathname.startsWith('/apply'));
              return (
                <li key={link.path}>
                  <Link
                    to={link.path}
                    className={`${isActive ? 'active' : ''} ${!isLoggedIn ? 'nav-locked' : ''}`}
                    onClick={(e) => handleNavClick(e, link.path)}
                  >
                    <span className="nav-link-icon">{link.icon}</span>
                    {link.label}
                    {!isLoggedIn && <span className="nav-lock-icon">🔒</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="nav-right-info">
            <span className="nav-info-text">
              📌 Application for Written Confirmation Certificate &amp; Guidelines for uploading Manufacturing and Formulation data
            </span>
          </div>
        </div>
      </nav>

      {/* ── Notification Panel ── */}
      {notifOpen && isLoggedIn && (
        <div className="notif-panel fade-in">
          <div className="notif-header">
            <span>Notifications</span>
            <button onClick={() => setNotifOpen(false)}>✕</button>
          </div>
          <div className="notif-list">
            {NOTIFICATIONS.map(n => (
              <div key={n.id} className={`notif-item ${!n.read ? 'unread' : ''}`}>
                <div className={`notif-dot dot-${n.type}`} />
                <div className="notif-content">
                  <div className="notif-title">{n.title}</div>
                  <div className="notif-msg">{n.msg}</div>
                  <div className="notif-time">{n.time}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="notif-footer">
            <button>View All Notifications</button>
          </div>
        </div>
      )}
      {notifOpen && isLoggedIn && (
        <div className="notif-overlay" onClick={() => setNotifOpen(false)} />
      )}

      {/* ── Login Modal ── */}
      <LoginModal />
    </>
  );
}
