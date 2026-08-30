/**
 * verificationViewModel.js
 * Transforms raw /api/verify response payloads into a stable view-model
 * consumed by ReviewerPanelHeader and ReviewerVerificationResult.
 */

/* ── Status key derivation ─────────────────────────────────────────────── */
function deriveKey(runtimeStatus, payload) {
    if (runtimeStatus === 'loading') return 'loading';
    if (runtimeStatus === 'error') return 'error';
    if (runtimeStatus === 'idle') return 'idle';
    if (!payload) return 'idle';
    if (payload.documentTypeMatch === false) return 'rejected';
    if (runtimeStatus === 'done') {
        const score = payload?.summary?.score ?? 0;
        if (score >= 75) return 'approved';
        if (score >= 40) return 'incomplete';
        return 'incomplete';
    }
    return 'idle';
}

const KEY_LABELS = {
    loading: 'Verifying…',
    error: 'Analysis Temporarily Unavailable',
    idle: 'Not yet verified',
    approved: 'Verified',
    incomplete: 'Verification Incomplete',
    rejected: 'Rejected by AI',
};

/* ── Map raw results array to normalised checks ────────────────────────── */
function mapChecks(results) {
    if (!Array.isArray(results)) return [];
    return results.map((r, i) => ({
        id: r.itemId || String(i),
        item: r.item || r.label || `Check ${i + 1}`,
        present: r.present,
        reason: r.note || r.reason || '',
        evidence: r.evidence || '',
        page: typeof r.page === 'number' ? r.page : null,
        expectedValue: r.expectedValue || '',
        extractedValue: r.extractedValue || '',
        correctiveAction: r.correctiveAction || '',
        raw: r,
    }));
}

/**
 * getVerificationPresentation(runtimeStatus, payload)
 *
 * @param {string}      runtimeStatus  'idle' | 'loading' | 'done' | 'error'
 * @param {object|null} payload        Raw API response from /api/verify
 * @returns {object}   View-model consumed by ReviewerPanelHeader/Result
 */
export function getVerificationPresentation(runtimeStatus, payload) {
    const key = deriveKey(runtimeStatus, payload);
    const label = KEY_LABELS[key] || key;

    const summary = payload?.summary
        ? {
            score: payload.summary.score ?? 0,
            present: payload.summary.present ?? 0,
            missing: payload.summary.missing ?? 0,
            unknown: payload.summary.unknown ?? 0,
            total: payload.summary.total ?? 0,
        }
        : { score: 0, present: 0, missing: 0, unknown: 0, total: 0 };

    const checks = mapChecks(payload?.results);

    // Type-mismatch fields (shown in rejection details)
    const primaryReason = payload?.documentTypeReason || '';
    const expectedDocumentType = payload?.docLabel || '';
    const detectedDocumentType = payload?.detectedDocumentType || '';
    const typeEvidence = payload?.typeEvidence || '';
    const typePage = payload?.typePage || null;
    const correctiveAction = payload?.correctiveAction || '';

    // Text source / page count for analysis-meta row
    const textSource = payload?.textSource || '';
    const pageCount = payload?.pageCount || null;
    const verifiedAt = payload?.verifiedAt || null;

    return {
        key,
        label,
        summary,
        checks,
        primaryReason,
        expectedDocumentType,
        detectedDocumentType,
        typeEvidence,
        typePage,
        correctiveAction,
        textSource,
        pageCount,
        verifiedAt,
    };
}

/**
 * validateReviewerDecision(dialog, remarks)
 * Returns an error string if the decision is invalid, or null if OK.
 *
 * @param {{ status: string }} dialog
 * @param {string}             remarks
 * @returns {string|null}
 */
export function validateReviewerDecision(dialog, remarks) {
    if (!dialog?.status) return 'Please select a decision status.';
    const requiresRemarks = ['Rejected', 'Query Raised'];
    if (requiresRemarks.includes(dialog.status) && !remarks?.trim()) {
        return `Remarks are required when status is "${dialog.status}".`;
    }
    return null;
}
