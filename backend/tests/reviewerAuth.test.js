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
  assert.deepEqual(req.reviewer, {
    id: 'dev:officer-1', name: 'officer-1', role: 'reviewer', verified: false,
  });
});

test('a verified principal supplies the immutable reviewer id', () => {
  const req = { user: { id: 'user-123', role: 'reviewer', name: 'Officer' }, get: () => '' };
  const res = responseStub();
  let called = false;
  requireReviewer(req, res, () => { called = true; });
  assert.equal(called, true);
  assert.equal(req.reviewer.id, 'user-123');
  assert.equal(req.reviewer.verified, true);
});

test('production refuses caller-controlled reviewer headers', () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const headers = { 'x-user-role': 'reviewer', 'x-reviewer-name': 'forged' };
    const req = { get: name => headers[name] };
    const res = responseStub();
    let called = false;
    requireReviewer(req, res, () => { called = true; });
    assert.equal(called, false);
    assert.equal(res.statusCode, 401);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
