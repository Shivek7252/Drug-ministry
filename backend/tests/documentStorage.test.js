'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { newStoredUpload } = require('../services/documentStorage');

test('replacing file bytes invalidates any client-supplied previous verification', () => {
  const stored = newStoredUpload({
    name: 'same-name.pdf',
    size: 123,
    type: 'application/pdf',
    uploadedAt: 'now',
    validated: true,
    validationResult: { state: 'completed', documentTypeMatch: true, fileHash: 'old' },
  }, 'EXP-TEST/licence.pdf');

  assert.equal(stored.validated, false);
  assert.equal(stored.validationResult, null);
  assert.equal(stored.path, 'EXP-TEST/licence.pdf');
});
