#!/usr/bin/env node
/* ============================================================================
   Generate disposable demo accounts for a controlled demo/staging environment.

   Prints environment lines to stdout. Nothing is written to the repository and
   no credential is ever committed: pipe the output into a gitignored env file
   or into the process environment of the server you are starting.

     node scripts/create-demo-accounts.js                 # random passwords
     node scripts/create-demo-accounts.js --json          # machine readable

   The generated AUTH_USERS_JSON contains scrypt hashes only. The plaintext
   passwords are printed once so an operator can hand them to demo users; they
   are not recoverable afterwards.

   This is NOT ministry production SSO. It is a server-backed credential store
   for a controlled environment, pending the real CDSCO identity provider.
   ============================================================================ */

const crypto = require('crypto');
const { createPasswordHash } = require('../services/passwordHash');

/* Two of each role: ownership and per-reviewer read state can only be proven
   with a second, distinct principal of the same role. The primary pair uses
   short, typeable names/passwords for the live demonstration. */
const ROLES = [
  { key: 'APPLICANT_A', role: 'applicant', username: 'applicant', demo: '1234' },
  { key: 'APPLICANT_B', role: 'applicant', username: 'applicant2', demo: '1234' },
  { key: 'REVIEWER', role: 'reviewer', username: 'reviewer', demo: '1234' },
  { key: 'REVIEWER_B', role: 'reviewer', username: 'reviewer2', demo: '1234' },
];

/* Demo passwords are deliberately short so they can be typed on stage. This is
   the ONLY place the password-length control is relaxed, and only when --demo
   is passed; without it every account gets a 24-character random password. */
const DEMO_MIN_LENGTH = 4;

/* 24 URL-safe characters — comfortably above the 12-character minimum the
   password hasher enforces, and generated from a CSPRNG. */
function generatePassword() {
  return crypto.randomBytes(18).toString('base64url');
}

async function main() {
  const asJson = process.argv.includes('--json');
  const demoMode = process.argv.includes('--demo');
  const users = [];
  const plaintext = {};

  for (const { key, role, username, demo } of ROLES) {
    const password = process.env[`SEED_${key}_PASSWORD`]
      || (demoMode ? demo : generatePassword());
    users.push({
      id: `demo:${username}`,
      username,
      name: username,
      role,
      passwordHash: await createPasswordHash(password, demoMode ? { minLength: DEMO_MIN_LENGTH } : {}),
    });
    plaintext[key] = { username, password, role };
  }

  const env = {
    AUTH_SESSION_SECRET: crypto.randomBytes(48).toString('base64url'),
    AUTH_USERS_JSON: JSON.stringify(users),
  };

  if (asJson) {
    process.stdout.write(JSON.stringify({ env, accounts: plaintext }, null, 2) + '\n');
    return;
  }

  process.stdout.write('# Generated demo accounts — do not commit this output.\n');
  for (const [name, value] of Object.entries(env)) {
    process.stdout.write(`${name}='${value}'\n`);
  }
  process.stdout.write('\n# Plaintext credentials (shown once):\n');
  for (const [key, account] of Object.entries(plaintext)) {
    process.stdout.write(`# ${key} (${account.role}): ${account.username} / ${account.password}\n`);
  }
}

main().catch(err => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});
