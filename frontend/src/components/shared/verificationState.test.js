import { applyPersistedVerification } from './verificationState';

const app = {
  applicationNumber: 'EXP-TEST-1',
  documents: {
    licence: {
      name: 'same.pdf',
      validationResult: { state: 'completed', version: 1, documentTypeMatch: false },
    },
  },
};

test('persisted deep result replaces stale parent state without refresh', () => {
  const next = applyPersistedVerification(app, 'licence', {
    state: 'completed',
    version: 2,
    jobId: 'job-2',
    fileHash: 'hash-2',
    verifiedAt: '2026-09-01T00:00:00.000Z',
    documentTypeMatch: true,
    documentTypeReason: 'Correct licence.',
    summary: { score: 100 },
  });
  expect(next.documents.licence.validationResult.documentTypeMatch).toBe(true);
  expect(next.documents.licence.validationResult.version).toBe(2);
  expect(app.documents.licence.validationResult.documentTypeMatch).toBe(false);
});

test('failed or incomplete response cannot replace a final verdict', () => {
  expect(applyPersistedVerification(app, 'licence', { state: 'failed', retryable: true })).toBe(app);
  expect(applyPersistedVerification(app, 'licence', { state: 'completed' })).toBe(app);
});
