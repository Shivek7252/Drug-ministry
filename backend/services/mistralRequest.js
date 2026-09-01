'use strict';

const { VerificationError } = require('./verificationResponse');

const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);

function retryAfterMs(value, now = Date.now()) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

function isTransientNetworkError(err) {
  return err?.name === 'AbortError'
    || ['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'EAI_AGAIN']
      .includes(err?.code);
}

async function requestWithRetry(fetchImpl, url, options, {
  maxRetries = 2,
  perAttemptTimeoutMs = 30000,
  overallTimeoutMs = 75000,
  baseDelayMs = 500,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now = () => Date.now(),
  onRetry = () => {},
} = {}) {
  const startedAt = now();
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const remaining = overallTimeoutMs - (now() - startedAt);
    if (remaining <= 0) {
      throw new VerificationError('OVERALL_TIMEOUT', 'Verification service exceeded its overall timeout.', {
        retryable: true,
        httpStatus: 504,
        cause: lastError,
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(perAttemptTimeoutMs, remaining));
    try {
      const response = await fetchImpl(url, { ...options, signal: controller.signal });
      if (!TRANSIENT_STATUSES.has(response.status) || attempt === maxRetries) return response;

      const headerValue = response.headers?.get?.('retry-after');
      const explicitDelay = retryAfterMs(headerValue, now());
      const waitMs = Math.min(explicitDelay ?? baseDelayMs * (2 ** attempt), Math.max(0, remaining));
      onRetry({ attempt: attempt + 1, status: response.status, waitMs });
      await sleep(waitMs);
    } catch (err) {
      lastError = err;
      if (!isTransientNetworkError(err)) throw err;
      if (attempt === maxRetries) {
        const timedOut = err?.name === 'AbortError';
        throw new VerificationError(timedOut ? 'REQUEST_TIMEOUT' : 'NETWORK_FAILURE',
          timedOut ? 'Verification service request timed out.' : 'Verification service is unreachable.', {
            retryable: true,
            httpStatus: timedOut ? 504 : 503,
            cause: err,
          });
      }
      const waitMs = Math.min(baseDelayMs * (2 ** attempt), Math.max(0, remaining));
      onRetry({ attempt: attempt + 1, error: err?.code || err?.name, waitMs });
      await sleep(waitMs);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new VerificationError('VERIFICATION_FAILED', 'Verification service request failed.', { retryable: true });
}

module.exports = { requestWithRetry, retryAfterMs };
