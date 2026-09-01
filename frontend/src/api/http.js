let csrfToken = '';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function csrfCookie() {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.split('; ')
    .find(part => part.startsWith('cdsco_csrf='));
  if (!match) return '';
  try { return decodeURIComponent(match.slice(match.indexOf('=') + 1)); } catch (_) { return ''; }
}

export function setCsrfToken(value) {
  csrfToken = typeof value === 'string' ? value : '';
}

export function clearCsrfToken() {
  csrfToken = '';
}

export async function authenticatedFetch(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = { ...(options.headers || {}) };
  if (!SAFE_METHODS.has(method)) {
    const token = csrfToken || csrfCookie();
    if (token) headers['X-CSRF-Token'] = token;
  }
  return fetch(url, { ...options, headers, credentials: 'include' });
}
