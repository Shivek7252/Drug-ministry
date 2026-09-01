# CDSCO Export NOC remediation plan

This is the living execution ledger for the release-review rerun. The source of truth is
`RELEASE_REVIEW_REPORT.md` plus `CONTROL_MATRIX.md`. A row moves to **Proven** only when
the expected API, persistence, UI, refresh, and role/ownership behavior has reproducible
evidence. Code inspection alone does not close a row.

## Rerun outcome

See `RELEASE_REVIEW_REPORT_RERUN.md`, `CONTROL_MATRIX_RERUN.md` and
`ACCESS_CONTROL_MATRIX.md`.

Five blockers closed with executed evidence: SEC-01, SEC-02, SEC-03, DB-01, CI-01.
Eight remain open. The controlled 3000/5001 restart was deliberately NOT performed,
because step 5 of the execution order below (complete isolated regression) was not met.

## Baseline

- Branch/commit at rerun start: `main`, `9b9db3116b90332baad8e1c776d16469efdc5a11`.
- Worktree at rerun start: clean; no branch, commit, push, reset, or stash operation used.
- Existing listeners preserved during isolated work: frontend PID 4112 on 3000;
  backend PID 24768 on 5001.
- Configured key names in `backend/.env`: `MISTRAL_API_KEY`, `MONGODB_URI`.
  No auth secret or auth users were configured at baseline. Values were not recorded.
- Backend bare suite: 154 pass, 0 fail, 55 DB-gated skip (209 discovered).
- Frontend Jest: 281/281 pass.
- Backend syntax check: pass.
- Frontend CI build: fail on 22 lint warnings (unused values, hook dependencies,
  BOM, and unnecessary regex escapes).

## Release blockers and proving checks

| ID | Source blocker | Required remediation and proof | State |
|---|---|---|---|
| SEC-01 | General application API returned 200 unauthenticated | Server-issued HttpOnly session; default-deny application/document/mutation APIs; 401 probes | Proven — 401 with no data leak; 14/14 authOwnership tests |
| SEC-02 | No production/server credential flow; spoofable reviewer headers | Environment-seeded hashed demo accounts, login/logout/me, expiry, rate limit, CSRF, server role checks; header-spoof tests | Proven — identity from session principal only; forged headers 401/403 |
| SEC-03 | No applicant ownership enforcement | Immutable principal owner id on writes; owner scope on list/search/stats/detail/documents/mutations; cross-user 403/404 tests | Proven — owner-scoped detail/documents/checklist/reconciliation; cross-tenant 404 |
| RUN-01 | Port 5001 runs pre-fix code | Isolated critical suites first; verify PIDs/commands; controlled restart; health and critical rerun | Still open — regression gate not met; 5001 `/health` lacks `authConfigured` |
| AI-01 | Ambiguous manufacturing-license result lacks signed ground truth | Treat as unresolved evidence, never tune to filename; record authoritative label requirement separately | Still open — authoritative label required (external) |
| AI-02 | No scanned-PDF/persisted refresh consistency series | Deterministic positive/negative text and rasterized scan fixtures; repeated API/DB/card/inspector/refresh comparison | Still open — not executed in this rerun |
| AI-03 | Variable `pdf-parse` extraction | Extraction strategy diagnostics and deterministic regression series; OCR fallback correctness/latency evidence | Still open — not executed in this rerun |
| E2E-01 | Applicant full journey absent | Disposable applicant/account: create, save/resume, all wizard controls, upload/replace, submit once, track, query/reply/resubmit, logout/refresh | Still open — not executed in this rerun |
| E2E-02 | Reviewer populated journey absent | Disposable reviewer/queue: filters/sorts/paging, open/read, tabs, viewer, verify/retry, document/application/shipment/query actions, terminal guards | Still open — not executed in this rerun |
| E2E-03 | Simultaneous applicant/reviewer and refresh absent | Two isolated browser contexts with persisted DB/API/UI equality before and after refresh | Still open — not executed in this rerun |
| CI-01 | CI build treats 22 warnings as errors | Correct each warning without broad formatting; CI build and unit rerun | Proven — CI production build compiles successfully |
| DB-01 | DB suites collide concurrently | Unique database per file or explicit sequential script; demonstrate clean isolated runs | Proven — `npm run test:db`, 87/87 twice, identical results |
| PY-01 | Tampering suite lacks PyMuPDF in pytest environment | Local locked virtual environment, install requirements, run forensics/tampering tests | Still open — not executed in this rerun |

## Blocked control groups

| ID | Role / surface | Controls covered | Proving evidence | State |
|---|---|---|---|---|
| C01 | Login modal | invalid/valid login, captcha refresh, reveal, close | Desktop + mobile E2E and auth API/security tests | Pending |
| C02 | Applicant global header | Dashboard/Export NOC/Track/Help/Contact, menus, text size, announcement, logout | Desktop + mobile E2E, refresh and session invalidation | Pending |
| C03 | Applicant dashboard | Start New, View All, Continue, Track | Populated/empty desktop + mobile E2E | Pending |
| C04 | Wizard shell | Steps 1-8, Back/Next, persisted resume | Full disposable browser journey + DB assertions | Pending |
| C05 | Wizard Step 1 | applicant fields, validation, save draft | Browser valid/invalid + owner-scoped DB assertion | Pending |
| C06 | Wizard Step 2 | consignee add/edit/update/remove/cancel | Browser state/persistence matrix | Pending |
| C07 | Wizard Step 3 | drug add/edit/remove and approved/banned/unlisted/format gates | Browser matrix + frontend/backend parity tests | Pending |
| C08 | Wizard Step 4 | manufacturer add/edit/update/remove/cancel | Browser state/persistence matrix | Pending |
| C09 | Wizard Step 5 shipments | add/edit/remove/reference/quantity controls | Browser + submitted DB assertion | Pending |
| C10 | Wizard Step 5 documents | every slot, browse/drop, preview/replace/remove, verify/retry | Text/scan fixtures + UI/API/DB/refresh matrix | Pending |
| C11 | Wizard Step 6 | declaration unchecked/checked and navigation | Browser validation matrix | Pending |
| C12 | Wizard Steps 7-8 | review/edit/submit/double-click, identifiers, success links/downloads | Browser + exactly-one DB record assertion | Pending |
| C13 | Track | empty/result/error search, Quick View/checklist/query reply/correction | Populated browser + API/DB assertions | Pending |
| C14 | Reviewer queue KPIs/analytics | radios, collapse, chart/table and period toggles | Populated desktop + mobile E2E and aggregate equality | Pending |
| C15 | Reviewer queue filters | category/country/state/date/custom/clear-all | Combination E2E + URL/API equality | Pending |
| C16 | Reviewer queue table | every sort, populated paging, open/read | Multi-row E2E + no duplicate/lost row DB checks | Pending |
| C17 | Reviewer detail | back/filter preservation; all six tabs and empty/error/data states | Direct and queue-origin E2E | Pending |
| C18 | Reviewer summary | open/close/navigation/document open | Populated E2E | Pending |
| C19 | Reviewer documents | inspect/close/reopen; search/zoom/reset/download/close; neutral retry | Persisted document E2E + UI/API/DB/refresh equality | Pending |
| C20 | Application decisions | approve/reject/query/cancel, mandatory remarks, duplicate/double click | Browser + isolated DB transition/audit assertions | Pending |
| C21 | Shipments | verify/query/approve/reject and remarks | Browser + DB status/audit assertions | Pending |

## Execution order

1. Close SEC-01..03 with unit and isolated API tests.
2. Close AI-02/03 and create sanitized fixtures; leave AI-01 external unless an
   authoritative label is supplied.
3. Seed isolated data and close C01..C21/E2E-01..03.
4. Close CI-01, DB-01, and PY-01.
5. Run the complete isolated regression and live consistency matrix.
6. Perform the controlled 3000/5001 restart only after critical isolated proof passes.
7. Publish `RELEASE_REVIEW_RERUN.md` and `CONTROL_MATRIX_RERUN.md`; report GO only if
   no demo-breaking blocker remains.
