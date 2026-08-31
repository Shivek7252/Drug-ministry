import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import useReviewerNotifications from '../../hooks/useReviewerNotifications';
import LoginModal from '../auth/LoginModal';
import Icon from '../ui/Icon';
import useTextScale from '../../hooks/useTextScale';
import './Navbar.css';

/* Announcement dismissal persists per browser (Part 3A). */
const ANNOUNCE_KEY = 'cdsco_announcement_dismissed';
const ANNOUNCE_ID = 'gsr-50e-2026-04-21';   // bump to re-show a new notice

const TEXT_SCALE_BUTTONS = [
  { label: 'A-', scale: 'sm', title: 'Decrease text size' },
  { label: 'A', scale: 'md', title: 'Default text size' },
  { label: 'A+', scale: 'lg', title: 'Increase text size' },
];

export default function Navbar() {
  const location  = useLocation();
  const navigate  = useNavigate();
  const { notifOpen, setNotifOpen, isLoggedIn, setLoginOpen, logout, currentUser, userRole } = useApp();
  const [mobileMenu,   setMobileMenu]   = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  /* Real applications from the reviewer endpoint, not the old mock array. The
     endpoint is called unfiltered, so eligibility is exactly the queue's
     ({ isDraft: false }) and the badge cannot claim an entry the queue hides. */
  const { notifications, unreadCount: unread } =
    useReviewerNotifications({ enabled: isLoggedIn && userRole === 'reviewer' });

  /* Drives the root rem class from tokens.css, on BOTH portals, and persists.
     Replaces an inline html.style.fontSize that was not persisted and would
     have overridden the token classes. */
  const { scale, setScale } = useTextScale();

  /* Anything positioned below the chrome (e.g. the login modal) needs the
     strip's CURRENT height, which is 0 once dismissed. */
  const [announceOpen, setAnnounceOpen] = useState(() => {
    try { return localStorage.getItem(ANNOUNCE_KEY) !== ANNOUNCE_ID; }
    catch { return true; }
  });
  const dismissAnnouncement = () => {
    setAnnounceOpen(false);
    try { localStorage.setItem(ANNOUNCE_KEY, ANNOUNCE_ID); } catch { /* private mode */ }
  };

  useEffect(() => {
    document.documentElement.style.setProperty(
      '--h-announce-current', announceOpen ? 'var(--h-announce)' : '0px'
    );
  }, [announceOpen]);

  const navLinks = [
    { path: '/',        label: 'Dashboard',        icon: 'grid' },
    { path: '/apply',   label: 'Export NOC',        icon: 'fileText' },
    { path: '/track',   label: 'Track Application', icon: 'search' },
    { path: '/help',    label: 'Help',              icon: 'helpCircle' },
    { path: '/contact', label: 'Contact',           icon: 'phone' },
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
      {/* ── Announcement strip (32px, dismissible) ── */}
      {announceOpen && (
        <div className="top-strip">
          <div className="top-strip-inner">
            <div className="top-strip-left">
              <Icon name="megaphone" size={14} />
              <span className="strip-notice">G.S.R. 50(E) is live on the SUGAM Portal (21 April 2026)</span>
            </div>
            <div className="top-strip-right">
              {/* Visibly rendered at all widths, matching the original header and
                  the GIGW convention on Indian government portals. Kept as real
                  anchors rather than the original spans so they actually work. */}
              <a className="strip-link" href="#main-content">Skip to Main Content</a>
              <span className="strip-sep" aria-hidden="true">|</span>
              <a className="strip-link" href="#main-content">Screen Reader Access</a>
              <span className="strip-sep" aria-hidden="true">|</span>

              <div className="font-size-group" role="group" aria-label="Text size">
                {TEXT_SCALE_BUTTONS.map(({ label, scale: s2, title }) => (
                  <button
                    key={s2}
                    type="button"
                    className={`font-size-btn ${scale === s2 ? 'font-size-active' : ''}`}
                    onClick={() => setScale(s2)}
                    aria-pressed={scale === s2}
                    title={title}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                className="strip-dismiss"
                onClick={dismissAnnouncement}
                aria-label="Dismiss announcement"
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

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
                { icon: 'home', label: 'Home' },
                { icon: 'info', label: 'About Us' },
                { icon: 'download', label: 'Downloads' },
                { icon: 'pill', label: 'Drugs' },
                { icon: 'tag', label: 'Brands' },
                { icon: 'phone', label: 'Contact Us' },
              ].map(item => (
                <div key={item.label} className="nav-icon-item">
                  <Icon name={item.icon} size={18} className="nav-icon" />
                  <span>{item.label}</span>
                </div>
              ))}
            </div>

            <div className="header-right-actions">
              {isLoggedIn && (
                <button className="notif-btn" onClick={() => setNotifOpen(!notifOpen)}>
                  <Icon name="megaphone" size={18} title="Notifications" />
                  {unread > 0 && <span className="notif-badge tnum">{unread}</span>}
                </button>
              )}

              {isLoggedIn ? (
                <div className="user-menu-wrap">
                  <button className="user-btn" onClick={() => setUserMenuOpen(o => !o)}>
                    <span className="user-avatar"><Icon name="info" size={14} /></span>
                    <span className="user-name">{currentUser}</span>
                    <Icon name="chevronDown" size={14} className="user-arrow" />
                  </button>
                  {userMenuOpen && (
                    <>
                      <div className="user-dropdown fade-in">
                        <div className="user-dropdown-header">
                          <div className="ud-avatar"><Icon name="info" size={16} /></div>
                          <div>
                            <div className="ud-name">{currentUser}</div>
                            <div className="ud-role">Registered User</div>
                          </div>
                        </div>
                        <div className="ud-divider" />
                        <button className="ud-item" onClick={() => { setUserMenuOpen(false); navigate('/apply'); }}><Icon name="fileText" size={15} /> My Applications</button>
                        <button className="ud-item" onClick={() => { setUserMenuOpen(false); navigate('/track'); }}><Icon name="search" size={15} /> Track Application</button>
                        <button className="ud-item" onClick={() => { setUserMenuOpen(false); navigate('/help'); }}><Icon name="helpCircle" size={15} /> Help</button>
                        <div className="ud-divider" />
                        <button className="ud-item ud-logout" onClick={handleLogout}><Icon name="externalLink" size={15} /> Logout</button>
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
            <Icon name="rows" size={16} /> Menu
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
                    <Icon name={link.icon} size={16} className="nav-link-icon" />
                    {link.label}
                    {!isLoggedIn && (
                      <Icon name="lock" size={12} className="nav-lock-icon" title="Sign in required" />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </nav>

      {/* ── Notification Panel ── */}
      {notifOpen && isLoggedIn && (
        <div className="notif-panel fade-in">
          <div className="notif-header">
            <span>Notifications</span>
            <button onClick={() => setNotifOpen(false)} aria-label="Close notifications"><Icon name="x" size={16} /></button>
          </div>
          <div className="notif-list">
            {notifications.length === 0 && (
              <p className="notif-empty">No notifications.</p>
            )}
            {notifications.map(n => (
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
