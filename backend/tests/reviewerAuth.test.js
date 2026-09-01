const test = require('node:test');
const assert = require('node:assert/strict');
const { requireReviewer } = require('../middleware/reviewerAuth');

function responseStub() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

test('reviewer middleware rejects missing/applicant roles', () => {
  for (const role of ['', 'applicant']) {
    const req = role ? { auth: { id: 'user-1', role, verified: true } } : {};
    const res = responseStub();
    let called = false;
    requireReviewer(req, res, () => { called = true; });
    assert.equal(res.statusCode, role ? 403 : 401);
    assert.equal(called, false);
  }
});

test('reviewer middleware refuses caller-controlled role headers', () => {
  const headers = { 'x-user-role': 'reviewer', 'x-reviewer-name': 'officer-1' };
  const req = { get: name => headers[name] };
  const res = responseStub();
  let called = false;
  requireReviewer(req, res, () => { called = true; });
  assert.equal(called, false);
  assert.equal(res.statusCode, 401);
});

test('a verified principal supplies the immutable reviewer id', () => {
  const req = { auth: { id: 'user-123', role: 'reviewer', name: 'Officer', verified: true } };
  const res = responseStub();
  let called = false;
  requireReviewer(req, res, () => { called = true; });
  assert.equal(called, true);
  assert.equal(req.reviewer.id, 'user-123');
  assert.equal(req.reviewer.verified, true);
});

test('an unverified principal is refused even if its role says reviewer', () => {
  const req = { auth: { id: 'forged', role: 'reviewer', verified: false } };
  const res = responseStub();
  let called = false;
  requireReviewer(req, res, () => { called = true; });
  assert.equal(called, false);
  assert.equal(res.statusCode, 403);
});
