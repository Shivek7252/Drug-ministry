'use strict';

class VerificationError extends Error {
  constructor(code, message, { retryable = false, httpStatus = 502, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'VerificationError';
    this.code = code;
    this.retryable = retryable;
    this.httpStatus = httpStatus;
  }
}

function invalid(code, message) {
  throw new VerificationError(code, message, { retryable: false, httpStatus: 502 });
}

function parseStrictObject(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    invalid('EMPTY_MODEL_RESPONSE', 'Verification service returned empty content.');
  }
  const text = raw.trim();
  if (!text.startsWith('{') || !text.endsWith('}')) {
    invalid('NON_JSON_MODEL_RESPONSE', 'Verification service returned non-JSON content.');
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new VerificationError('MALFORMED_MODEL_RESPONSE', 'Verification service returned malformed JSON.', {
      retryable: false,
      httpStatus: 502,
      cause,
    });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    invalid('INVALID_MODEL_SCHEMA', 'Verification response must be a JSON object.');
  }
  return parsed;
}

function requireBooleanDecision(parsed) {
  if (typeof parsed.documentTypeMatch !== 'boolean') {
    invalid('INVALID_MODEL_SCHEMA', 'Verification response is missing a boolean documentTypeMatch.');
  }
  if (typeof parsed.documentTypeReason !== 'string') {
    invalid('INVALID_MODEL_SCHEMA', 'Verification response is missing documentTypeReason.');
  }
}

function parseQuickVerificationResponse(raw) {
  const parsed = parseStrictObject(raw);
  requireBooleanDecision(parsed);
  return {
    documentTypeMatch: parsed.documentTypeMatch,
    documentTypeReason: parsed.documentTypeReason.trim(),
  };
}

const STRING_FIELDS = ['evidence', 'note', 'expectedValue', 'extractedValue', 'correctiveAction'];

function parseDeepVerificationResponse(raw, { expectedItemCount } = {}) {
  const parsed = parseStrictObject(raw);
  requireBooleanDecision(parsed);
  if (!Array.isArray(parsed.items)) {
    invalid('INVALID_CHECKLIST_SCHEMA', 'Verification response items must be an array.');
  }
  if (Number.isInteger(expectedItemCount) && parsed.items.length !== expectedItemCount) {
    invalid('INCOMPLETE_CHECKLIST', 'Verification response does not contain every checklist item.');
  }

  const seen = new Set();
  for (const item of parsed.items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      invalid('INVALID_CHECKLIST_SCHEMA', 'Verification checklist contains an invalid item.');
    }
    if (!Number.isInteger(item.index) || item.index < 1 || seen.has(item.index)) {
      invalid('INVALID_CHECKLIST_SCHEMA', 'Verification checklist item indexes must be unique positive integers.');
    }
    seen.add(item.index);
    if (typeof item.present !== 'boolean') {
      invalid('INVALID_CHECKLIST_SCHEMA', 'Verification checklist present values must be booleans.');
    }
    if (!(item.page === null || (Number.isInteger(item.page) && item.page > 0))) {
      invalid('INVALID_CHECKLIST_SCHEMA', 'Verification checklist page values must be positive integers or null.');
    }
    for (const field of STRING_FIELDS) {
      if (typeof item[field] === 'undefined') {
        item[field] = '';
      } else if (typeof item[field] !== 'string') {
        invalid('INVALID_CHECKLIST_SCHEMA', `Verification checklist ${field} values must be strings.`);
      }
    }
  }

  if (Number.isInteger(expectedItemCount)) {
    for (let index = 1; index <= expectedItemCount; index += 1) {
      if (!seen.has(index)) invalid('INCOMPLETE_CHECKLIST', 'Verification checklist indexes are incomplete.');
    }
  }

  return parsed;
}

function extractAssistantJson(apiPayload) {
  if (!apiPayload || !Array.isArray(apiPayload.choices) || apiPayload.choices.length === 0) {
    invalid('EMPTY_MODEL_CHOICES', 'Verification service returned no choices.');
  }
  const content = apiPayload.choices[0]?.message?.content;
  if (typeof content !== 'string' || content.trim() === '') {
    invalid('EMPTY_MODEL_RESPONSE', 'Verification service returned empty content.');
  }
  return content;
}

function failurePayload(err) {
  const known = err instanceof VerificationError;
  return {
    state: 'failed',
    retryable: known ? err.retryable : true,
    code: known ? err.code : 'VERIFICATION_FAILED',
    error: known ? err.message : 'Unable to verify this document. Please retry.',
  };
}

module.exports = {
  VerificationError,
  extractAssistantJson,
  failurePayload,
  parseQuickVerificationResponse,
  parseDeepVerificationResponse,
};
