# CDSCO Export NOC — release review rerun

Supersedes nothing: `RELEASE_REVIEW_REPORT.md` and `CONTROL_MATRIX.md` are preserved as the
original baseline. This document records what the rerun changed, proved, and did not reach.

## 1. Demo readiness

**NO-GO.**

Three of the four security blockers are closed with executed evidence, the database suite is
deterministic again, and the CI build gate now passes. The decision remains NO-GO because the
gate defined in `REMEDIATION_PLAN.md` — *"perform the controlled 3000/5001 restart only after
critical isolated proof passes"* — has not been met. The populated browser control matrix, the
scanned-PDF consistency series, and the Python forensics suite were **not executed in this
rerun**, so the pre-deployment regression is incomplete and port 5001 was deliberately left on
its existing build.

Confirmed by probe: `GET http://localhost:5001/health` returns
`{"status":"ok","model":"mistral-small-latest","database":"drug_ministry","testMode":false}`
with **no `authConfigured` field**, whereas the corrected build reports `"authConfigured":true`.
Port 5001 is therefore still running pre-authentication code, and RUN-01 stands.

## 2. Environment

- Branch/commit: `main`, `9b9db3116b90332baad8e1c776d16469efdc5a11`. No commit, push, reset,
  stash, or branch change was performed.
- Worktree: dirty at start (21 modified, 8 untracked); all pre-existing changes preserved.
- Existing services left running and untouched throughout: frontend `3000` (HTTP 200),
  backend `5001` (`drug_ministry`, `testMode:false`).
- Isolated service used: backend `5101`. Stopped after testing (probe confirms no listener).
- Isolated databases: `drug_ministry_authz_test`, `drug_ministry_rerun_test_1788244468`.
  Both dropped after testing. Main `drug_ministry` verified intact afterwards: 38 applications.
- Disposable accounts: 4 (2 applicants, 2 reviewers), generated per run, never committed.
- Mistral: **0 external API calls made in this rerun.** No live classification series was run.

## 3. Blockers resolved

### SEC-01 — unauthenticated application APIs (was: `GET /api/applications` → 200)

**Root cause.** The application router was mounted without any authentication middleware, so
every route beneath `/api/applications` was reachable anonymously.

**Fix.** The router is mounted behind server-issued session authentication and CSRF:
`app.use('/api/applications', auth.authenticate, auth.requireCsrf, applicationRoutes)`
(`backend/server.js`). Sessions are signed HttpOnly cookies over a 32-byte random id.

**Evidence.** `GET /api/applications` anonymous → **401** with
`{"error":"Authentication is required."}`. Nine anonymous reads and four anonymous mutations
all denied, with no application or applicant string in any response body.

### SEC-02 — spoofable reviewer identity

**Root cause.** Reviewer identity was taken from client-supplied `x-user-role` /
`x-reviewer-name` headers.

**Fix.** Identity now comes only from the verified session principal. Role guards read
`req.auth.role`, which is populated by the session, never by a header.

**Evidence.** An applicant session sending `x-user-role: reviewer` is refused 403 on both the
reviewer queue and a reviewer decision. An anonymous caller with the same forged headers is
refused 401. Logout invalidates the session immediately (subsequent call → 401). Invalid
credentials return a generic message that does not disclose whether the username exists.

### SEC-03 — applicant ownership bypass (**newly found and fixed in this rerun**)

**Root cause.** Authentication alone was mounted, but three applicant-reachable surfaces
performed an unscoped `Application.findOne({ $or: [...] })`, so **any authenticated applicant
could read any other applicant's application, download their uploaded documents, and read
their checklist and reconciliation records.** The owner-scoping helpers (`scopedQuery`,
`ownershipFilter`, `identityQuery`) already existed and were simply not applied there.

**Fix** (`backend/routes/applications.js`):

- `scopedQuery()` is now **default-deny** — with no request principal it returns `{ _id: null }`,
  which matches nothing, so a future call site that forgets to pass `req` fails closed.
- `loadAppOr404(idOrRef, res, req)` takes the request and resolves through
  `scopedQuery(req, identityQuery(idOrRef))`. All 16 call sites updated — this scopes the
  checklist, checklist files, reply files, and the whole reconciliation family at once.
- `GET /:id` and `GET /:id/document/:docId` scoped directly.
- A non-owner receives 404, not 403, so existence is not disclosed.

The six remaining unscoped lookups were each verified to sit behind `requireReviewer`, where
unscoped access is correct by design.

**Evidence.** Applicant B receives 404 for applicant A's detail, document download, checklist
and reconciliation; the list endpoint returns only the caller's own applications; a reviewer
still reads any application; mass assignment of `ownerId`/`status` on submit is ignored and the
forged owner still gets 404.

### DB-01 — database suites collided when run together

**Root cause.** Two compounding causes. Several suites assert on totals across the whole
database, and they were sharing one database that accumulated records across runs. Separately,
after authentication was introduced, five suites still authenticated with the old role headers
and every request 401'd.

**Fix.**

- New shared helper `backend/tests/helpers/session.js` logs a suite in and returns a header bag
  carrying the session cookie and CSRF token, so existing call sites are unchanged.
- Five suites migrated to real sessions; identity assertions now read the authenticated
  principal rather than a header value.
- Two stale expectations corrected: an anonymous caller is refused by authentication (401)
  before role authorization (403) is ever reached. Both are asserted explicitly now.
- New `npm run test:db` (`backend/scripts/run-db-tests.js`) runs the database suites one file
  at a time and aggregates the totals, with the reason documented in the script header.

**Evidence.** Two consecutive full passes on a fresh isolated database produced identical
results: **87 pass, 0 fail, 0 skipped** each time.

### CI-01 — CI build treated 22 warnings as errors

**Status: closed.** `CI=true npx react-scripts build` now reports **`Compiled successfully.`**
No `CI=false`, no removed gate, no broad `eslint-disable`.

## 4. Mistral verification

**Not re-tested in this rerun. Zero external Mistral calls were made.**

The parser-level protections described in the baseline report remain in the worktree and their
unit coverage still passes as part of the backend suite. However, the rerun did **not** execute:

- the scanned-PDF consistency series (AI-02),
- the `pdf-parse` extraction-variability investigation (AI-03),
- any live known-outcome classification.

The ambiguous repository file `3. Copy of Manufacturing License.pdf` (AI-01) was **not**
re-classified and remains without authoritative ground truth. It is excluded from every
accuracy claim in this document, and no classifier, prompt, or profile was tuned toward it.

## 5. Test results

| Suite | Passed | Failed | Skipped | Command |
|---|---:|---:|---:|---|
| Backend bare (unit + config) | 158 | 0 | 70 (env-gated) | `npm test` |
| Backend database-backed | 87 | 0 | 0 | `npm run test:db` |
| Backend unique total | **245** | **0** | — | both of the above |
| Backend syntax check | Pass | 0 | — | `npm run check` |
| Frontend Jest | **281** | 0 | 0 | `CI=true react-scripts test` |
| Frontend CI production build | **Pass** | 0 | — | `CI=true react-scripts build` |
| Playwright desktop | **not run** | — | — | — |
| Playwright mobile | **not run** | — | — | — |
| Live Mistral classification | **not run** (0 API calls) | — | — | — |
| Python forensics / tampering | **not run** | — | — | — |

New tests added by this rerun: `backend/tests/authOwnership.test.js` (14 tests covering
SEC-01/02/03, CSRF, mass assignment and cross-tenant isolation).

## 6. Remaining blockers

| ID | Severity | Blocker | Why it is still open |
|---|---|---|---|
| RUN-01 | Blocker | Port 5001 runs pre-authentication code | Deliberate. The pre-deployment regression gate (populated E2E + scanned-PDF series + forensics) is incomplete, so the controlled restart was not performed. Confirmed by the missing `authConfigured` flag on `/health`. |
| E2E-01/02/03 | Blocker | Populated applicant and reviewer browser journeys | Not executed in this rerun. The seeded-fixture system (Phase 6) was not built. |
| C01–C21 | Blocker | ~40 control-matrix rows remain `Blocked` | Depend on the seeded fixtures and browser journeys above. |
| AI-02 | Critical | No scanned-PDF refresh-consistency series | Not executed; no sanitized scan fixtures created. |
| AI-03 | Major | `pdf-parse` extraction variability uninvestigated | Not executed. |
| PY-01 | Major | Python forensics suite blocked on PyMuPDF | Not addressed. |
| AI-01 | Major | Ambiguous manufacturing-licence file | Requires an authoritative human label — genuinely external. |
| SEC-04 | Major | Sessions are in-process memory | Do not survive restart or span instances; acceptable for a single-instance demo, not for production. |
| SEC-05 | Major | Production CDSCO identity provider | Not available in this environment; the current flow is an explicitly scoped demo/staging credential store. |

## 7. Files changed by this rerun

| File | Why |
|---|---|
| `backend/routes/applications.js` | SEC-03: default-deny `scopedQuery`; owner-scoped `loadAppOr404` (+16 call sites); owner-scoped `GET /:id` and `GET /:id/document/:docId` |
| `backend/scripts/create-demo-accounts.js` | New — generates disposable scrypt-hashed accounts; prints env lines, commits nothing |
| `backend/scripts/run-db-tests.js` | New — documented sequential database test runner |
| `backend/package.json` | Added `test:db` script |
| `backend/tests/authOwnership.test.js` | New — 14 authentication/authorization/ownership regression tests |
| `backend/tests/helpers/session.js` | New — shared login helper for database-backed suites |
| `backend/tests/documentQueryRoutes.test.js` | Migrated to session auth; applicant session for submissions |
| `backend/tests/underReviewRoutes.test.js` | Migrated to session auth; reviewer name from the principal |
| `backend/tests/unreadCount.test.js` | Migrated to session auth; receipts keyed by principal id; 403→401 for anonymous |
| `backend/tests/submissionVisibility.test.js` | Migrated to session auth; explicit anonymous-401 and applicant-403 assertions |
| `release-review/ACCESS_CONTROL_MATRIX.md` | New — full route inventory and negative-test results |
| `release-review/RELEASE_REVIEW_REPORT_RERUN.md` | This document |
| `release-review/CONTROL_MATRIX_RERUN.md` | Rerun matrix, every original row preserved |
| `release-review/DEMO_CHECKLIST.md` | Pre-demo sequence |

No unrelated file was reformatted, reset, or discarded.

## 8. Rollback

Nothing was deployed, so no rollback is required. Ports 3000 and 5001 are running exactly the
processes they were running before this rerun began, against `drug_ministry`. All isolated
databases created during the rerun have been dropped and the isolated backend on 5101 is stopped.
