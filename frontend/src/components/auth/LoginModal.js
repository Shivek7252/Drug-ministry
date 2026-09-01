import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import './LoginModal.css';

/* Demo credentials shown on the login form for the controlled demonstration.
   These are seeded accounts on the demo backend, not ministry credentials, and
   the list is empty in a production build so it cannot ship to a live portal. */
const DEMO_ACCOUNTS = process.env.NODE_ENV === 'production' ? [] : [
  { role: 'applicant', username: 'applicant', password: '1234' },
  { role: 'reviewer', username: 'reviewer', password: '1234' },
];

// Generate a simple 5-digit captcha
function generateCaptcha() {
  return Math.floor(10000 + Math.random() * 90000).toString();
}

export default function LoginModal() {
  const { loginOpen, setLoginOpen, login } = useApp();

  const [username, setUsername]     = useState('');
  const [password, setPassword]     = useState('');
  const [captchaVal, setCaptchaVal] = useState('');
  const [captcha, setCaptcha]       = useState(generateCaptcha);
  const [errors, setErrors]         = useState({});
  const [loading, setLoading]       = useState(false);
  const [showPass, setShowPass]     = useState(false);

  // Reset form when modal opens
  useEffect(() => {
    if (loginOpen) {
      setUsername('');
      setPassword('');
      setCaptchaVal('');
      setCaptcha(generateCaptcha());
      setErrors({});
      setLoading(false);
    }
  }, [loginOpen]);

  if (!loginOpen) return null;

  const refreshCaptcha = () => {
    setCaptcha(generateCaptcha());
    setCaptchaVal('');
  };

  const validate = () => {
    const e = {};
    if (!username.trim())  e.username = 'Username or email is required';
    if (!password.trim())  e.password = 'Password is required';
    if (!captchaVal.trim()) e.captcha = 'Please enter the captcha';
    else if (captchaVal.trim() !== captcha) { e.captcha = 'Incorrect captcha. Please try again.'; refreshCaptcha(); }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleLogin = async () => {
    if (!validate()) return;

    setLoading(true);
    try {
      await login(username.trim(), password);
    } catch (error) {
      setErrors({ general: error.message || 'Login failed. Please try again.' });
      refreshCaptcha();
      setCaptchaVal('');
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (e) => { if (e.key === 'Enter') handleLogin(); };

  return (
    <>
      <div className="login-overlay" onClick={() => setLoginOpen(false)} />
      <div className="login-modal fade-in">
        {/* Header strip matching CDSCO */}
        <div className="login-header-strip">
          <span className="login-strip-tag">LOGIN / SIGN UP</span>
          <span className="login-strip-text">Click here to login/sign up to the portal</span>
          <span className="login-strip-notice">
            🔔 G.S.R. 50(E) is live on the SUGAM Portal (21 April 2026).
          </span>
          <button className="login-close-btn" onClick={() => setLoginOpen(false)}>✕</button>
        </div>

        {/* Login Row — exactly like CDSCO screenshot */}
        <div className="login-row">
          {/* Username */}
          <div className="login-field-wrap">
            <span className="login-field-icon">👤</span>
            <input
              type="text"
              className={`login-input ${errors.username ? 'login-input-error' : ''}`}
              placeholder="username or email"
              value={username}
              onChange={e => { setUsername(e.target.value); setErrors(p => ({ ...p, username: '', general: '' })); }}
              onKeyDown={handleKey}
              autoFocus
            />
          </div>

          {/* Password */}
          <div className="login-field-wrap">
            <span className="login-field-icon">🔒</span>
            <input
              type={showPass ? 'text' : 'password'}
              className={`login-input ${errors.password ? 'login-input-error' : ''}`}
              placeholder="password"
              value={password}
              onChange={e => { setPassword(e.target.value); setErrors(p => ({ ...p, password: '', general: '' })); }}
              onKeyDown={handleKey}
            />
            <button className="pass-toggle" onClick={() => setShowPass(s => !s)} tabIndex={-1}>
              {showPass ? '🙈' : '👁️'}
            </button>
          </div>

          {/* Captcha display */}
          <div className="captcha-display-wrap">
            <div className="captcha-display">{captcha}</div>
            <button className="captcha-refresh" onClick={refreshCaptcha} title="Refresh captcha">🔄</button>
          </div>

          {/* Captcha input */}
          <div className="login-field-wrap captcha-input-wrap">
            <input
              type="text"
              className={`login-input ${errors.captcha ? 'login-input-error' : ''}`}
              placeholder="Enter Captcha"
              value={captchaVal}
              onChange={e => { setCaptchaVal(e.target.value); setErrors(p => ({ ...p, captcha: '' })); }}
              onKeyDown={handleKey}
              maxLength={5}
            />
          </div>

          {/* Login Button */}
          <button className="login-submit-btn" onClick={handleLogin} disabled={loading}>
            {loading ? <span className="spinner" /> : 'Login'}
          </button>
        </div>

        {/* Validation errors */}
        {(errors.username || errors.password || errors.captcha || errors.general) && (
          <div className="login-errors">
            {errors.username && <span>⚠ {errors.username}</span>}
            {errors.password && <span>⚠ {errors.password}</span>}
            {errors.captcha  && <span>⚠ {errors.captcha}</span>}
            {errors.general  && <span>⚠ {errors.general}</span>}
          </div>
        )}

        {/* Demo credentials. Rendered only outside production so the hint can
            never ship to a live ministry deployment. Clicking a row fills the
            form so it does not have to be typed on stage. */}
        {process.env.NODE_ENV !== 'production' && DEMO_ACCOUNTS.length > 0 && (
          <div className="login-demo">
            <div className="login-demo-title">Demo accounts — click to fill</div>
            <div className="login-demo-rows">
              {DEMO_ACCOUNTS.map(account => (
                <button
                  type="button"
                  key={account.username}
                  className="login-demo-row"
                  onClick={() => {
                    setUsername(account.username);
                    setPassword(account.password);
                    setErrors({});
                  }}
                >
                  <span className={`login-demo-role login-demo-role-${account.role}`}>{account.role}</span>
                  <code>{account.username}</code>
                  <span className="login-demo-sep">/</span>
                  <code>{account.password}</code>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Bottom links — Sign Up & Forgot Password */}
        <div className="login-bottom-links">
          <div className="login-link-item">
            <div className="login-link-icon signup-icon">👤</div>
            <div>
              <div className="login-link-sub">Don't have an account?</div>
              <div className="login-link-main">Sign Up Here</div>
            </div>
          </div>
          <div className="login-link-item">
            <div className="login-link-icon forgot-icon">🔗</div>
            <div>
              <div className="login-link-main">Forgot Password</div>
            </div>
          </div>
        </div>

      </div>
    </>
  );
}
