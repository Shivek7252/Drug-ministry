import { getVerificationPresentation, validateReviewerDecision } from './verificationViewModel';

describe('getVerificationPresentation', () => {
  test('identifies an approved verification result', () => {
    const view = getVerificationPresentation('done', {
      documentTypeMatch: true,
      results: [{ item: 'Licence number', present: true, evidence: 'Licence 123' }],
      summary: { total: 1, present: 1, missing: 0, unknown: 0, score: 100 },
    });
    expect(view.key).toBe('approved');
  });

  test('preserves detailed rejected-result fields from the backend', () => {
    const view = getVerificationPresentation('done', {
      documentTypeMatch: true,
      results: [{
        item: 'Valid approval date', present: false, note: 'The approval has expired.',
        expectedValue: 'A current approval', extractedValue: 'Expired 01/01/2025',
        evidence: 'Valid until 01/01/2025', page: 2, correctiveAction: 'Upload the renewed approval.',
      }],
      summary: { total: 1, present: 0, missing: 1, unknown: 0, score: 0 },
    });
    expect(view.key).toBe('rejected');
    expect(view.primaryReason).toBe('The approval has expired.');
    expect(view.failedChecks[0]).toMatchObject({
      expectedValue: 'A current approval',
      extractedValue: 'Expired 01/01/2025',
      evidence: 'Valid until 01/01/2025',
      page: 2,
      correctiveAction: 'Upload the renewed approval.',
    });
  });

  test('identifies a pending verification', () => {
    expect(getVerificationPresentation('loading', null).key).toBe('pending');
  });

  test('handles incomplete backend results without empty-section failures', () => {
    const view = getVerificationPresentation('done', {
      documentTypeMatch: true,
      hasText: false,
      results: [{ item: 'Authorised signature', present: null }],
    });
    expect(view.key).toBe('incomplete');
    expect(view.primaryReason).toBe('');
    expect(view.failedChecks).toEqual([]);
  });
});

describe('validateReviewerDecision', () => {
  test('allows approval confirmation without remarks', () => {
    expect(validateReviewerDecision('Approved', '')).toBe('');
  });

  test.each(['Query Raised', 'Rejected'])('%s requires reviewer remarks', status => {
    expect(validateReviewerDecision(status, '   ')).toMatch(/remarks are required/i);
    expect(validateReviewerDecision(status, 'Document-specific reason')).toBe('');
  });
});
