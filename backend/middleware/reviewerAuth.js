function requireReviewer(req, res, next) {
  const principal = req.auth;
  if (principal && String(principal.role || '').toLowerCase() === 'reviewer'
      && principal.id && principal.verified === true) {
    req.reviewer = {
      id: String(principal.id),
      name: String(principal.name || principal.username || principal.email || 'Reviewer'),
      role: 'reviewer',
      verified: true,
    };
    return next();
  }

  if (!principal) return res.status(401).json({ error: 'Verified authentication is required.' });
  return res.status(403).json({ error: 'Reviewer authorization is required.' });
}

function requireApplicant(req, res, next) {
  if (!req.auth) return res.status(401).json({ error: 'Verified authentication is required.' });
  if (req.auth.verified !== true || req.auth.role !== 'applicant' || !req.auth.id) {
    return res.status(403).json({ error: 'Applicant authorization is required.' });
  }
  return next();
}

module.exports = { requireApplicant, requireReviewer };
