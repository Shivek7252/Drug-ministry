/* ============================================================
   documentQueryDraft.js

   Builds the structured query draft for ONE uploaded document, and normalises
   the rows a reviewer submits back.

   Everything here is scoped to a single document's own verification payload
   (`documents.<docId>.validationResult.fullResults`). No other document's
   findings can reach these functions — the caller passes one payload, and the
   draft carries the document identity so rows stay attached to a stable docId.

   Draft rules:
     - wrong document type  → exactly one row; the per-check results were run
                              against the wrong document and mean nothing
     - otherwise            → one row per failed check, plus unresolved checks
                              that carry an explicit reason (AI warnings)
     - never invent a deficiency the payload does not state
     - overlapping findings are merged so the applicant is not asked twice
   ============================================================ */

const MAX_TEXT = 2000;
/* Built from strings so this source file never carries literal control bytes. */
const CONTROL_CHARS = new RegExp('[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]', 'g');
/* Spaces and tabs collapse; newlines are kept so multi-line queries survive. */
const HORIZONTAL_SPACE = new RegExp('[^\\S\\n]+', 'g');

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/* User-editable text is stored and echoed back to the applicant, so strip the
   control characters that would corrupt a table cell or a PDF export. */
function sanitize(value) {
  return text(value)
    .replace(CONTROL_CHARS, ' ')
    .replace(HORIZONTAL_SPACE, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_TEXT);
}

function normaliseKey(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/* "License number is present" → "the license number"; used to build a readable
   corrective action when the AI did not supply one. */
function requirementPhrase(item) {
  const cleaned = text(item)
    .replace(/\b(is|are|was|were)\s+(present|mentioned|available|listed|included|stated|visible|specified|identified)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.:;]+$/, '');
  if (!cleaned) return 'the required information';
  return /^(the|a|an)\b/i.test(cleaned) ? cleaned : `the ${cleaned.charAt(0).toLowerCase()}${cleaned.slice(1)}`;
}

function wrongTypeDeficiency(payload) {
  const reason = text(payload.documentTypeReason);
  if (reason) return reason;
  const expected = text(payload.expectedDocumentType);
  const detected = text(payload.detectedDocumentType);
  if (expected && detected) {
    return `The uploaded document appears to be ${detected}, not ${expected}.`;
  }
  return 'The uploaded document does not match the expected document type.';
}

function wrongTypeQuery(payload, expectedLabel) {
  const suggested = text(payload.suggestedCorrectiveAction) || text(payload.correctiveAction);
  if (suggested) return suggested;
  const expected = text(payload.expectedDocumentType) || text(expectedLabel);
  return expected
    ? `Please upload a valid ${expected} for the applied product.`
    : 'Please upload the correct document for the applied product.';
}

function checkQuery(check) {
  const suggested = text(check.correctiveAction) || text(check.suggestedAction);
  if (suggested) return suggested;
  const phrase = requirementPhrase(check.item);
  const extracted = text(check.extractedValue) || text(check.extracted) || text(check.actualValue);
  const expected = text(check.expectedValue) || text(check.expected) || text(check.requirement);
  if (extracted && expected) {
    return `Please upload a corrected document showing ${phrase} as ${expected}. The uploaded document states "${extracted}".`;
  }
  if (extracted) {
    return `Please clarify ${phrase}. The uploaded document states "${extracted}".`;
  }
  return `Please upload a document that clearly shows ${phrase}.`;
}

function checkDeficiency(check) {
  const reason = text(check.failureReason) || text(check.note);
  if (reason) return reason;
  const phrase = requirementPhrase(check.item);
  return check.present === false
    ? `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)} could not be found in the uploaded document.`
    : `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)} could not be confirmed from the uploaded document.`;
}

/**
 * Draft rows for one document.
 * @param payload  documents.<docId>.validationResult.fullResults
 * @param expectedLabel  human label of the document slot
 * @returns rows[] — empty when the document has nothing to query
 */
function buildDocumentQueryDraft(payload, expectedLabel = '') {
  const source = payload && typeof payload === 'object' ? payload : {};

  if (source.documentTypeMatch === false) {
    // The checks below ran against the wrong document, so a single, decisive
    // query replaces them all rather than piling on derived failures.
    return finalise([{
      checklistItem: 'Document type verification',
      deficiency: wrongTypeDeficiency(source),
      queryText: wrongTypeQuery(source, expectedLabel),
      findingRef: 'document-type',
    }]);
  }

  const results = Array.isArray(source.results) ? source.results : [];
  const rows = [];
  results.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') return;
    const failed = raw.present === false;
    // An unresolved check is only worth asking about when the AI said why.
    const warned = raw.present !== true && raw.present !== false
      && (text(raw.failureReason) || text(raw.note));
    if (!failed && !warned) return;
    rows.push({
      checklistItem: text(raw.item) || `Verification check ${index + 1}`,
      deficiency: checkDeficiency(raw),
      queryText: checkQuery(raw),
      findingRef: `check:${Number.isInteger(raw.index) ? raw.index : index}`,
    });
  });

  return finalise(rows);
}

/* Merge findings that would read as the same question to the applicant: same
   requirement, or the same deficiency wording under different labels. */
function finalise(rows) {
  const byItem = new Map();
  const byDeficiency = new Map();
  const kept = [];
  for (const row of rows) {
    const itemKey = normaliseKey(row.checklistItem);
    const defKey = normaliseKey(row.deficiency);
    const seen = byItem.get(itemKey) || (defKey && byDeficiency.get(defKey));
    if (seen) {
      // Keep the longer corrective action — it is the more specific one.
      if (row.queryText.length > seen.queryText.length) seen.queryText = row.queryText;
      continue;
    }
    const entry = { ...row };
    kept.push(entry);
    if (itemKey) byItem.set(itemKey, entry);
    if (defKey) byDeficiency.set(defKey, entry);
  }
  return kept.map((row, i) => ({
    order: i + 1,
    checklistItem: sanitize(row.checklistItem),
    deficiency: sanitize(row.deficiency),
    aiQueryText: sanitize(row.queryText),
    queryText: sanitize(row.queryText),
    edited: false,
    rowSource: 'ai_generated',
    findingRef: row.findingRef,
  }));
}

/* Server-side mirror of the reviewer panel's normalised status, so the query
   modal header states the verdict even before the panel reports one. */
function verificationStatus(payload) {
  const source = payload && typeof payload === 'object' ? payload : null;
  if (!source) return { key: 'incomplete', label: 'Verification Incomplete' };
  if (source.documentTypeMatch === false) return { key: 'rejected', label: 'Wrong Document' };

  const results = Array.isArray(source.results) ? source.results : [];
  const summary = source.summary && typeof source.summary === 'object' ? source.summary : {};
  const count = (key, predicate) => (Number.isFinite(Number(summary[key]))
    ? Number(summary[key])
    : results.filter(predicate).length);
  const missing = count('missing', r => r?.present === false);
  const unknown = count('unknown', r => r && r.present !== true && r.present !== false);
  const total = Number.isFinite(Number(summary.total)) ? Number(summary.total) : results.length;

  if (missing > 0) return { key: 'rejected', label: 'Rejected by AI' };
  if (total === 0 || unknown > 0) return { key: 'incomplete', label: 'Verification Incomplete' };
  return { key: 'approved', label: 'AI Verified' };
}

class QueryRowValidationError extends Error {
  constructor(rowErrors) {
    super('One or more query rows are incomplete.');
    this.name = 'QueryRowValidationError';
    this.rowErrors = rowErrors;
  }
}

/**
 * Normalise reviewer-submitted rows.
 * Drops manual rows the reviewer left completely blank, then requires a
 * corrective action on every row that survives.
 * @throws QueryRowValidationError with per-row messages keyed by client rowKey
 */
function normalizeQueryRows(rawRows) {
  const input = Array.isArray(rawRows) ? rawRows : [];
  const cleaned = input.map((raw, index) => {
    const row = raw && typeof raw === 'object' ? raw : {};
    const rowSource = row.rowSource === 'reviewer_added' ? 'reviewer_added' : 'ai_generated';
    return {
      rowKey: text(row.rowKey) || `row-${index + 1}`,
      checklistItem: sanitize(row.checklistItem),
      deficiency: sanitize(row.deficiency),
      aiQueryText: sanitize(row.aiQueryText),
      queryText: sanitize(row.queryText),
      rowSource,
      findingRef: sanitize(row.findingRef),
    };
  });

  // A manual row with nothing typed into it was never really added.
  const retained = cleaned.filter(row =>
    !(row.rowSource === 'reviewer_added' && !row.queryText && !row.checklistItem && !row.deficiency));

  const rowErrors = {};
  retained.forEach(row => {
    if (!row.queryText) rowErrors[row.rowKey] = 'Enter the corrective action required from the applicant.';
  });
  if (Object.keys(rowErrors).length) throw new QueryRowValidationError(rowErrors);
  if (!retained.length) throw new QueryRowValidationError({ _form: 'Add at least one query before submitting.' });

  return retained.map((row, index) => ({
    order: index + 1,
    checklistItem: row.checklistItem,
    deficiency: row.deficiency,
    aiQueryText: row.rowSource === 'ai_generated' ? row.aiQueryText : '',
    queryText: row.queryText,
    // A reviewer-added row is never "edited" — there is no AI text to diverge from.
    edited: row.rowSource === 'ai_generated' && !!row.aiQueryText && row.aiQueryText !== row.queryText,
    rowSource: row.rowSource,
    findingRef: row.findingRef,
  }));
}

/**
 * Legacy single-string remarks, derived on the server from the structured rows.
 * Older readers (reviewerRemarks, exports, notifications) keep working while
 * the rows stay the primary representation.
 */
function deriveLegacyRemarks(document, rows) {
  const head = `Document query — ${document.expectedType || document.docId}`
    + (document.fileName ? ` (${document.fileName})` : '');
  const body = rows.map(row => {
    const label = row.checklistItem ? `${row.checklistItem}: ` : '';
    return `${row.order}. ${label}${row.queryText}`;
  });
  return [head, ...body].join('\n');
}

module.exports = {
  buildDocumentQueryDraft,
  normalizeQueryRows,
  deriveLegacyRemarks,
  verificationStatus,
  sanitizeQueryText: sanitize,
  QueryRowValidationError,
};
