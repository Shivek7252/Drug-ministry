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
    const req = { get: name => name === 'x-user-role' ? role : 'user' };
    const res = responseStub();
    let called = false;
    requireReviewer(req, res, () => { called = true; });
    assert.equal(res.statusCode, 403);
    assert.equal(called, false);
  }
});

test('reviewer middleware attaches the authenticated reviewer', () => {
  const headers = { 'x-user-role': 'reviewer', 'x-reviewer-name': 'officer-1' };
  const req = { get: name => headers[name] };
  const res = responseStub();
  let called = false;
  requireReviewer(req, res, () => { called = true; });
  assert.equal(called, true);
  assert.deepEqual(req.reviewer, { name: 'officer-1', role: 'reviewer' });
});
