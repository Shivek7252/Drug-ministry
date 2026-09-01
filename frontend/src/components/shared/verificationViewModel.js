function text(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function pageNumber(value) {
    const page = Number(value);
    return Number.isInteger(page) && page > 0 ? page : null;
}

export function normalizeVerificationResponse(payload) {
    const source = payload && typeof payload === 'object' ? payload : {};
    const checks = Array.isArray(source.results)
        ? source.results.filter(Boolean).map((result, index) => ({
            id: result.index ?? index,
            item: text(result.item) || `Verification check ${index + 1}`,
            present: result.present === true ? true : result.present === false ? false : null,
            reason: text(result.failureReason) || text(result.note),
            expectedValue: text(result.expectedValue) || text(result.expected) || text(result.requirement) || text(result.item),
            extractedValue: text(result.extractedValue) || text(result.extracted) || text(result.actualValue),
            evidence: text(result.evidence) || text(result.supportingEvidence),
            page: pageNumber(result.page ?? result.pageNumber),
            correctiveAction: text(result.correctiveAction) || text(result.suggestedAction),
            raw: result,
        }))
        : [];

    const present = checks.filter(check => check.present === true).length;
    const missing = checks.filter(check => check.present === false).length;
    const unknown = checks.filter(check => check.present === null).length;
    const suppliedSummary = source.summary && typeof source.summary === 'object' ? source.summary : null;
    const total = Number.isFinite(Number(suppliedSummary?.total))
        ? Number(suppliedSummary.total)
        : checks.length;
    const scoreValue = Number(suppliedSummary?.score);
    const score = Number.isFinite(scoreValue)
        ? Math.max(0, Math.min(100, scoreValue))
        : total > 0 ? Math.round((present / total) * 100) : null;

    return {
        typeMatches: typeof source.documentTypeMatch === 'boolean' ? source.documentTypeMatch : null,
        typeReason: text(source.documentTypeReason),
        typeEvidence: text(source.documentTypeEvidence),
        typePage: pageNumber(source.documentTypePage),
        expectedDocumentType: text(source.expectedDocumentType) || text(source.docLabel),
        detectedDocumentType: text(source.detectedDocumentType),
        correctiveAction: text(source.suggestedCorrectiveAction) || text(source.correctiveAction),
        verifiedAt: text(source.verifiedAt),
        hasText: source.hasText !== false,
        textSource: text(source.textSource),
        pageCount: Number.isFinite(Number(source.pageCount)) ? Number(source.pageCount) : null,
        checks,
        summary: {
            total,
            present: Number.isFinite(Number(suppliedSummary?.present)) ? Number(suppliedSummary.present) : present,
            missing: Number.isFinite(Number(suppliedSummary?.missing)) ? Number(suppliedSummary.missing) : missing,
            unknown: Number.isFinite(Number(suppliedSummary?.unknown)) ? Number(suppliedSummary.unknown) : unknown,
            score,
        },
    };
}

export function getVerificationPresentation(runtimeStatus, payload) {
    const verification = normalizeVerificationResponse(payload);
    let key = 'incomplete';
    let label = 'Incomplete Result';

    if (runtimeStatus === 'idle' || runtimeStatus === 'loading') {
        key = 'pending';
        label = 'Verification Pending';
    } else if (runtimeStatus === 'error' || !payload) {
        key = 'incomplete';
        label = 'Verification Incomplete';
    } else if (verification.typeMatches === false || verification.summary.missing > 0) {
        key = 'rejected';
        label = 'Rejected by AI';
    } else if (verification.typeMatches !== true || verification.summary.total === 0 || verification.summary.unknown > 0) {
        key = 'incomplete';
        label = 'Verification Incomplete';
    } else {
        key = 'approved';
        label = 'AI Verified';
    }

    const failedChecks = verification.typeMatches === true
        ? verification.checks.filter(check => check.present === false)
        : [];
    const pendingChecks = verification.checks.filter(check => check.present === null);
    const primaryReason = verification.typeMatches === false
        ? verification.typeReason
        : failedChecks.find(check => check.reason)?.reason || pendingChecks.find(check => check.reason)?.reason || '';
    const correctiveAction = verification.correctiveAction
        || failedChecks.find(check => check.correctiveAction)?.correctiveAction
        || '';

    /* The uploaded file is not the expected document type at all — the "Wrong
       Document" case on the reviewer's document grid. Deliberately narrower than
       `key === 'rejected'`, which also covers a document of the right type that
       merely failed some checks. Guarded on the key so a pending or errored run,
       where typeMatches defaults to true, can never report a wrong document. */
    const isWrongDocumentType = key === 'rejected' && verification.typeMatches === false;

    return {
        ...verification,
        key,
        label,
        failedChecks,
        pendingChecks,
        primaryReason,
        correctiveAction,
        isWrongDocumentType,
    };
}

export function validateReviewerDecision(status, remarks = '') {
    if (!['Approved', 'Query Raised', 'Rejected'].includes(status)) {
        return 'Select a valid reviewer decision.';
    }
    if ((status === 'Query Raised' || status === 'Rejected') && !String(remarks).trim()) {
        return 'Reviewer remarks are required for this action.';
    }
    return '';
}
