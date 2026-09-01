# CDSCO Export NOC release review

## 1. Demo readiness

**NO-GO.** The refresh-dependent document-card bug and unsafe Mistral response coercion are fixed in the worktree and covered by regression tests, but the running development backend on port 5001 was intentionally not restarted and therefore does not contain these fixes. Release blockers also remain: unauthenticated application APIs, no real production login/token flow, CI lint failure, incomplete full-control browser coverage, no controlled scanned-PDF consistency series, and an unverified live misclassification of the repository file named `3. Copy of Manufacturing License.pdf`.

## 2. Environment

- Branch/commit: `main`, `fa06c488bdc4db7f3ced6f9676f58826b626cd10`.
- Worktree: heavily dirty before this review; all unrelated changes were preserved.
- Existing services: frontend 3000 and backend 5001 were detected and left running/untouched.
- Isolated services used: frontend 3100 and backend 5101; both stopped after testing.
- Isolated database: `drug_ministry_codex_test_20260901`; dropped after testing.
- Model: `mistral-small-latest`; OCR fallback `mistral-ocr-latest`.
- Live logical verification runs: 7. Estimated external Mistral requests: 12; retries 0, 429s 0, timeouts 0.
- Fixtures: two generated sanitized text PDFs (known Export NOC history and clearly wrong commercial invoice), plus repository manufacturing-license-named PDF. Temporary PDFs were removed.

## 3. Critical verification incident

### Reproduction and proof

The original quick parser converted parse failure/missing fields/string booleans to `false`. The deep parser caught JSON failure, substituted `{ items: [] }`, then evaluated `parsed.documentTypeMatch === true`, also yielding `false`. Characterization tests initially produced 6 failures: truncated JSON, fenced JSON, missing decision, string boolean, prose prefix, and invalid checklist shape all failed to raise and could create a red verdict.

The no-text paths separately returned `documentTypeMatch: true`, creating an unsafe green verdict.

The reviewer card read `full.documents[docId].validationResult`, while the modal deep-verification route persisted a newer result and close only cleared `viewerDoc`. A browser refresh refetched MongoDB and changed the card. That is the proven refresh mechanism.

### Fix

- Shared strict response parser and typed neutral errors.
- Empty choices/content, malformed/non-JSON responses, missing/invalid decision, incomplete checklist, OCR/no-text failure never carry `documentTypeMatch`.
- Bounded retry for 429/5xx/network/timeout, `Retry-After`, per-attempt and overall timeouts.
- Explicit `processing`, `completed`, and `failed` persisted states with `jobId`, version, SHA-256 file hash, operation, and timestamps.
- Atomic completion matches the current `jobId`, so an older response cannot overwrite a newer job.
- File replacement always clears `validated` and `validationResult`.
- Stored verification requires reviewer authorization.
- The persisted deep response updates the parent React state immediately; closing the inspector no longer needs a refresh.
- Frontend normalization requires an explicit boolean and keeps missing decisions neutral.

### Regression proof

- Backend verification/replacement focused tests: 19/19 passed.
- Frontend stale-parent and normalized-state tests: passed within 281/281 frontend tests.
- Document-inspection action-state tests: passed after the authorization-header integration was decoupled from Jest mocks.

## 4. Mistral reliability

| Fixture | Expected | Runs | Correct | Inconsistent | Min ms | Average ms | p95 ms | Refresh consistency |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| Sanitized Export NOC history text PDF | true | 3 | 3 | 0 | 2,938 | 3,446 | 3,805 | API result stable; persisted UI refresh series not run |
| Sanitized commercial invoice text PDF | false | 2 | 2 | 0 | 2,452 | 2,666 | 2,879 | API result stable; persisted UI refresh series not run |
| Repository `3. Copy of Manufacturing License.pdf` | presumed true from slot/name; ground truth not independently signed off | 2 | 0 | 1 neutral schema failure, 1 false verdict | 5,015 | 5,680 | 6,345 | Not run |

Instrumented representative positive run: PDF extraction 42 ms, OCR 326 ms, classification 3,168 ms, vision 0 ms, backend total 3,537 ms, client-observed total 3,595 ms. Database-write and frontend-render timing were not captured in the stateless live endpoint. Identical generated PDFs sometimes used OCR on the first run and PDF text on the second because `pdf-parse` emitted invalid-stream warnings; outcome consistency remained 100% for the controlled fixtures, but extraction variability remains a risk.

## 5. Applicant E2E results

- Desktop and mobile: invalid login, valid login, session refresh, `/apply`, `/track`, and reviewer-route blocking passed.
- Full wizard create/save/resume/upload/replace/submit/query/resubmit journey was not executed with a populated disposable application; release-blocking coverage remains incomplete.
- Static demo credentials remain visible in the frontend and no backend credential/token exchange exists.

## 6. Reviewer E2E results

- Desktop and mobile: queue load, search, rows-per-page, empty pagination, refresh, and applicant-route redirection passed with no console/page errors or non-aborted request failures.
- Populated application inspection, persisted live verification, application decisions, and simultaneous applicant/reviewer views were not completed in Playwright.

## 7. Every-button matrix

See [CONTROL_MATRIX.md](./CONTROL_MATRIX.md). Discovered but unexecuted controls are explicitly `Blocked`; they are not counted as passing.

## 8. Backend and database results

- Backend unit/configured suite: 154 passed, 55 environment-gated tests skipped in the bare run.
- The four database-backed files interfere when run concurrently against one DB (count collisions). Run sequentially, all 56/56 passed and cleaned their records.
- Total unique backend tests after sequential DB execution: 209/209 passed.
- Stable docId query association, AIQ history, idempotent query submission, Under Review transitions, unread receipts, submission visibility, and replacement invalidation passed.
- Stored verification unauthorized/applicant probes returned 403.
- `GET /api/applications` returned 200 without authentication: release-blocking data-access flaw.
- Production reviewer middleware requires a verified principal, but the application supplies only client-controlled development headers and has no production authentication integration.

## 9. Files changed by this review

- `backend/server.js`: strict parser integration, timeout/retry, safe logs, verification job state/version/hash, atomic stale-job protection, reviewer guards, timing diagnostics, neutral failures.
- `backend/services/verificationResponse.js`: typed strict response validation and failure model.
- `backend/services/mistralRequest.js`: bounded transient retry and timeouts.
- `backend/services/documentStorage.js`: replacement invalidation helper.
- `backend/tests/verificationResponse.test.js`, `backend/tests/documentStorage.test.js`: critical regression coverage.
- `backend/scripts/create-verification-fixtures.js`: sanitized deterministic PDF fixture generator.
- `backend/routes/applications.js`: new-file verification invalidation (file was already dirty before review).
- `frontend/src/components/shared/verificationState.js` and test: immediate authoritative parent-state update.
- `frontend/src/components/shared/verificationViewModel.js`: explicit boolean/neutral state handling (file was already dirty).
- `frontend/src/components/shared/DocViewerModal.js`: persisted-result callback, authorized stored verification, configurable backend (file was already dirty).
- Reviewer pages: apply persisted verification result immediately (both were already dirty).
- `frontend/src/config/api.js` and call sites: isolated/configurable backend origin.
- `frontend/playwright.config.js`, `frontend/e2e/portal.spec.js`, package/lock: project-local browser automation.

## 10. Test results

| Suite | Passed | Failed | Skipped/blocked |
|---|---:|---:|---:|
| Backend unique tests (unit + sequential DB) | 209 | 0 | 0 |
| Frontend Jest | 281 | 0 | 0 |
| Playwright Edge desktop/mobile | 4 | 0 | 0 in configured smoke scope |
| Live known-outcome classifications | 5 | 0 | persisted refresh/scanned series blocked |
| Backend syntax/check script | Pass | 0 | — |
| Production build (normal) | Pass with warnings | 0 | — |
| CI lint/build | 0 | Fail | Existing warnings treated as errors |
| Python tampering/forensics | 0 | 0 test failures | Blocked at collection: missing `fitz`/PyMuPDF in available pytest environment |

## 11. Remaining risks

| Severity | Risk / impact | Demo impact | Recommended next action |
|---|---|---|---|
| Critical | General application APIs are accessible without authentication | Applicant data/status exposure and unauthorized mutation risk | Implement real server sessions/OIDC/JWT and guard every route by role/ownership |
| Critical | Port 5001 still runs the pre-fix backend | Demo can still show false verdict/refresh bug | Deploy/restart backend in a controlled window, then rerun persisted E2E |
| High | Repository manufacturing-license-named file returned false live | Possible correct-document false rejection | Obtain signed ground truth and tune/evaluate classifier without hardcoding |
| High | Full applicant/reviewer button matrix remains blocked | Unknown critical UI failures | Seed isolated app/accounts and execute full populated Playwright journey |
| High | No live scanned-PDF repetition/persisted refresh series | OCR consistency not established | Add sanitized scan fixture and repeat applicant/API/DB/reviewer/refresh comparison |
| High | CI lint fails | Release pipeline may reject build | Resolve warnings without broad unrelated reformatting |
| Medium | DB route files collide when parallel | False negatives/flaky CI | Allocate unique DB per file or force sequential database test script |
| Medium | `pdf-parse` emitted invalid-stream warnings and triggered OCR variably | Added latency/cost | Upgrade/replace parser and add deterministic extraction regression fixtures |
| Medium | Tampering suite dependencies incomplete | Forensics functionality unverified | Create locked Python environment and install `requirements.txt` |

## 12. Demo checklist

- Deploy/restart the backend and confirm `/health` reports the intended database/model.
- Confirm production authentication is active; verify unauthenticated application list/status/document calls are denied.
- Use a non-production database and disposable demo accounts/application.
- Run one known correct text PDF, one known wrong text PDF, and one known correct scanned PDF.
- For each, compare initial reviewer card, inspector, API, MongoDB, applicant view, and result after refresh.
- Confirm technical failure shows `Unable to Verify`/retry, never green or red.
- Replace a verified file and confirm the old verdict disappears immediately.
- Run `npm test`, sequential DB suites, frontend Jest, Playwright, CI lint, and production build.
- Keep the old deployment available for rollback; do not point the demo at the untested development database.
