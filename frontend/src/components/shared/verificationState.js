export function applyPersistedVerification(application, docId, payload) {
  if (!application || !docId || payload?.state !== 'completed') return application;
  if (typeof payload.documentTypeMatch !== 'boolean') return application;
  const current = application.documents?.[docId];
  if (!current) return application;

  const validationResult = {
    state: 'completed',
    retryable: false,
    operation: 'deep',
    jobId: payload.jobId || null,
    version: payload.version || 0,
    fileHash: payload.fileHash || null,
    verifiedAt: payload.verifiedAt || null,
    documentTypeMatch: payload.documentTypeMatch,
    documentTypeReason: payload.documentTypeReason || '',
    score: payload.summary?.score ?? null,
    fullResults: payload,
  };

  return {
    ...application,
    documents: {
      ...application.documents,
      [docId]: { ...current, validated: true, validationResult },
    },
  };
}
