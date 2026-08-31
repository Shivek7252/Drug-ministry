function requireReviewer(req, res, next) {
  /* A hosting layer may attach a verified principal. Prefer its immutable id
     and never consult caller-controlled role headers in production. */
  const principal = req.user || req.auth;
  if (principal && String(principal.role || '').toLowerCase() === 'reviewer'
      && (principal.id || principal._id || principal.sub)) {
    req.reviewer = {
      id: String(principal.id || principal._id || principal.sub),
      name: String(principal.name || principal.username || principal.email || 'Reviewer'),
      role: 'reviewer',
      verified: true,
    };
    return next();
  }

  const allowDevelopmentHeaders = process.env.NODE_ENV !== 'production'
    || process.env.ALLOW_INSECURE_REVIEWER_HEADERS === 'true';
  if (!allowDevelopmentHeaders) {
    return res.status(401).json({ error: 'Verified reviewer authentication is required.' });
  }
  const role = String(req.get('x-user-role') || '').toLowerCase();
  const reviewer = String(req.get('x-reviewer-name') || '').trim();
  if (role !== 'reviewer' || !reviewer) {
    return res.status(403).json({ error: 'Reviewer authorization is required.' });
  }
  req.reviewer = {
    id: `dev:${reviewer.toLowerCase()}`,
    name: reviewer,
    role,
    verified: false,
  };
  return next();
}

module.exports = { requireReviewer };
