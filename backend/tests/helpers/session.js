/* ============================================================================
   Shared authenticated-session helper for the database-backed API suites.

   Reviewer identity now comes from a server-issued session, not from client
   headers, so integration tests must log in like a real client does. Each
   helper returns a header bag that carries the session cookie and the CSRF
   token the server issued, which the existing call sites can pass straight
   through in place of the old `x-user-role` headers.

   Credentials come from the environment so nothing is committed:

     TEST_APPLICANT_A='user:pass'   TEST_APPLICANT_B='user:pass'
     TEST_REVIEWER='user:pass'

   Generate disposable accounts with `node scripts/create-demo-accounts.js`.
   ============================================================================ */

function credentials(name) {
  const raw = process.env[name] || '';
  const separator = raw.indexOf(':');
  if (separator < 1) return null;
  return { username: raw.slice(0, separator), password: raw.slice(separator + 1) };
}

function haveCredentials(...names) {
  return names.every(name => credentials(name) !== null);
}

/**
 * Log in and return headers that authenticate subsequent requests.
 * @returns {Promise<{cookie:string,'x-csrf-token':string,principal:object}>}
 */
async function sessionHeaders(apiBase, envName) {
  const who = credentials(envName);
  if (!who) throw new Error(`${envName} is not set (expected "username:password").`);
  const res = await fetch(`${apiBase}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(who),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Login failed for ${envName}: HTTP ${res.status}`);
  const cookie = (res.headers.getSetCookie?.() || [])
    .map(entry => entry.split(';')[0])
    .join('; ');
  return { cookie, 'x-csrf-token': body.csrfToken, principal: body.user };
}

/** Populate an existing header object in place so call sites keep their reference. */
async function adoptSession(target, apiBase, envName) {
  const headers = await sessionHeaders(apiBase, envName);
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, headers);
  return target;
}

module.exports = { credentials, haveCredentials, sessionHeaders, adoptSession };
