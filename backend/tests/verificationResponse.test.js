'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  VerificationError,
  extractAssistantJson,
  failurePayload,
  parseQuickVerificationResponse,
  parseDeepVerificationResponse,
} = require('../services/verificationResponse');
const { requestWithRetry } = require('../services/mistralRequest');

const validItem = {
  index: 1,
  present: true,
  page: 1,
  evidence: 'Licence No. 123',
  note: '',
  expectedValue: '',
  extractedValue: '',
  correctiveAction: '',
};

test('valid positive JSON is accepted', () => {
  assert.equal(parseQuickVerificationResponse('{"documentTypeMatch":true,"documentTypeReason":"matches"}').documentTypeMatch, true);
  assert.equal(parseDeepVerificationResponse(JSON.stringify({ documentTypeMatch: true, documentTypeReason: 'matches', items: [validItem] }), { expectedItemCount: 1 }).documentTypeMatch, true);
});

test('valid negative JSON is accepted', () => {
  const item = { ...validItem, present: false, page: null, evidence: '' };
  assert.equal(parseQuickVerificationResponse('{"documentTypeMatch":false,"documentTypeReason":"invoice"}').documentTypeMatch, false);
  assert.equal(parseDeepVerificationResponse(JSON.stringify({ documentTypeMatch: false, documentTypeReason: 'invoice', items: [item] }), { expectedItemCount: 1 }).documentTypeMatch, false);
});

for (const [name, raw] of [
  ['truncated JSON', '{"documentTypeMatch": tru'],
  ['markdown-fenced JSON', '```json\n{"documentTypeMatch": true}\n```'],
  ['missing documentTypeMatch', '{"documentTypeReason":"missing"}'],
  ['boolean returned as a string', '{"documentTypeMatch":"false"}'],
  ['prose before JSON', 'Result: {"documentTypeMatch": true}'],
]) {
  test(`${name} cannot create a quick verdict`, () => {
    assert.throws(() => parseQuickVerificationResponse(raw), /verification/i);
  });
}

test('invalid checklist array cannot create a deep verdict', () => {
  assert.throws(
    () => parseDeepVerificationResponse('{"documentTypeMatch":true,"items":{}}', { expectedItemCount: 1 }),
    /verification/i,
  );
});

test('empty choices and empty content cannot create a verdict', () => {
  assert.throws(() => extractAssistantJson({ choices: [] }), /no choices/i);
  assert.throws(() => extractAssistantJson({ choices: [{ message: { content: '' } }] }), /empty content/i);
});

test('invalid checklist item shape cannot create a deep verdict', () => {
  const invalid = { ...validItem, present: 'true' };
  assert.throws(
    () => parseDeepVerificationResponse(JSON.stringify({ documentTypeMatch: true, documentTypeReason: 'ok', items: [invalid] }), { expectedItemCount: 1 }),
    /booleans/i,
  );
});

test('omitted optional checklist narrative fields are normalized safely', () => {
  const parsed = parseDeepVerificationResponse(JSON.stringify({
    documentTypeMatch: true,
    documentTypeReason: 'matches',
    items: [{ index: 1, present: false, page: null }],
  }), { expectedItemCount: 1 });
  assert.equal(parsed.items[0].evidence, '');
  assert.equal(parsed.items[0].correctiveAction, '');
});

test('timeout is typed as retryable and never carries a verdict', async () => {
  const abortingFetch = async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  await assert.rejects(
    requestWithRetry(abortingFetch, 'https://example.invalid', {}, {
      maxRetries: 0,
      perAttemptTimeoutMs: 5,
      overallTimeoutMs: 20,
    }),
    err => err instanceof VerificationError && err.code === 'REQUEST_TIMEOUT' && err.retryable,
  );
});

for (const status of [429, 500]) {
  test(`HTTP ${status} is retried with a bounded attempt count`, async () => {
    let attempts = 0;
    const response = { status, headers: { get: () => status === 429 ? '0' : null } };
    const fetchStub = async () => { attempts += 1; return response; };
    const result = await requestWithRetry(fetchStub, 'https://example.invalid', {}, {
      maxRetries: 2,
      sleep: async () => {},
    });
    assert.equal(result, response);
    assert.equal(attempts, 3);
  });
}

test('network failure is typed as retryable after bounded retries', async () => {
  let attempts = 0;
  const fetchStub = async () => {
    attempts += 1;
    throw Object.assign(new Error('reset'), { code: 'ECONNRESET' });
  };
  await assert.rejects(
    requestWithRetry(fetchStub, 'https://example.invalid', {}, { maxRetries: 1, sleep: async () => {} }),
    err => err instanceof VerificationError && err.code === 'NETWORK_FAILURE' && err.retryable,
  );
  assert.equal(attempts, 2);
});

for (const [name, error] of [
  ['OCR failure', new VerificationError('OCR_FAILED', 'OCR failed.', { retryable: true })],
  ['insufficient text', new VerificationError('INSUFFICIENT_TEXT', 'Insufficient text.', { retryable: true, httpStatus: 422 })],
  ['database-write failure', new VerificationError('PERSISTENCE_FAILED', 'Persistence failed.', { retryable: true })],
]) {
  test(`${name} maps to a neutral failed state`, () => {
    const result = failurePayload(error);
    assert.equal(result.state, 'failed');
    assert.equal(typeof result.documentTypeMatch, 'undefined');
  });
}
