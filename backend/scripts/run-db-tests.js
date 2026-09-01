#!/usr/bin/env node
/* ============================================================================
   Run the database-backed API suites ONE FILE AT A TIME.

   These suites talk to a running API bound to a single database, and several
   of them assert on totals across that database (unread counts, queue totals,
   status roll-ups). Run concurrently they interleave each other's fixtures and
   the totals collide, which previously made the suite look flaky. Running them
   sequentially against an isolated database is deterministic: two consecutive
   passes produce identical results.

   Required environment:
     TEST_API_URL       e.g. http://localhost:5101/api
     TEST_MONGO_URL     an isolated database whose name contains "test"
     TEST_APPLICANT_A / TEST_APPLICANT_B / TEST_REVIEWER / TEST_REVIEWER_B
                        as "username:password" — see scripts/create-demo-accounts.js

   Any file that cannot reach the API or the seeded accounts skips itself, so
   this command is safe to run on a bare checkout.
   ============================================================================ */

const { spawnSync } = require('child_process');
const path = require('path');

/* Ordered deliberately: cheapest first, so a broken environment fails fast. */
const FILES = [
  'analyticsEndpoint',
  'submissionVisibility',
  'unreadCount',
  'documentQueryRoutes',
  'underReviewRoutes',
  'authOwnership',
];

const totals = { pass: 0, fail: 0, skipped: 0 };
let failedFiles = 0;

for (const name of FILES) {
  const file = path.join(__dirname, '..', 'tests', `${name}.test.js`);
  const run = spawnSync(process.execPath, ['--test', file], {
    encoding: 'utf8',
    env: process.env,
  });
  const output = `${run.stdout || ''}${run.stderr || ''}`;
  const count = key => {
    const match = output.match(new RegExp(`^# ${key} (\\d+)`, 'm'));
    return match ? Number(match[1]) : 0;
  };
  const pass = count('pass');
  const fail = count('fail');
  const skipped = count('skipped');
  totals.pass += pass;
  totals.fail += fail;
  totals.skipped += skipped;
  if (fail > 0) failedFiles += 1;

  process.stdout.write(`${name.padEnd(24)} pass ${pass}  fail ${fail}  skipped ${skipped}\n`);
  if (fail > 0) process.stdout.write(output.split('\n').filter(l => l.startsWith('not ok')).join('\n') + '\n');
}

process.stdout.write(
  `${'-'.repeat(58)}\nTOTAL  pass ${totals.pass}  fail ${totals.fail}  skipped ${totals.skipped}\n`
);
process.exit(failedFiles > 0 ? 1 : 0);
