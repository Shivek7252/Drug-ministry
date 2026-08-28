function requireReviewer(req, res, next) {
  const role = String(req.get('x-user-role') || '').toLowerCase();
  const reviewer = String(req.get('x-reviewer-name') || '').trim();
  if (role !== 'reviewer' || !reviewer) {
    return res.status(403).json({ error: 'Reviewer authorization is required.' });
  }
  req.reviewer = { name: reviewer, role };
  return next();
}

module.exports = { requireReviewer };
