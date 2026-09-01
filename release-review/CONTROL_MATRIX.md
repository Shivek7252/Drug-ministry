# CDSCO Export NOC control matrix

Evidence keys: `E2E-D` desktop Edge; `E2E-M` mobile Edge; `UNIT` Jest/node:test; `DB` isolated MongoDB API test; `INSPECT` code/route inspection only. A grouped row covers repeated instances of the same control on that route. `Blocked` means it was discovered but not safely exercised end to end in this run.

| Role | Page/route | Control | State tested | Expected action / API / persistence | Actual result | Status | Evidence |
|---|---|---|---|---|---|---|---|
| Both | Global header | Login / Sign Up | enabled, invalid, valid | Open login; validate credentials/captcha; persist session | Invalid and applicant login worked | Pass | E2E-D, E2E-M |
| Both | Login modal | Username, password, captcha, refresh, password reveal, close | valid/invalid | Validate fields; refresh captcha; close modal | Core login fields tested; auxiliary controls inspected only | Blocked | E2E, INSPECT |
| Applicant | Global header | Dashboard, Export NOC, Track, Help, Contact links | authenticated | Navigate without losing session | Apply/Track/role guard and refresh passed; Help/Contact click not exercised | Blocked | E2E, INSPECT |
| Applicant | Global header | Notification menu, user menu, text size, announcement dismiss | enabled | Toggle menus/accessibility state | Rendered; not all actions functionally exercised | Blocked | INSPECT |
| Applicant | Global header | Logout | enabled | Clear session and return to guarded state | Covered by unit context only, not final browser run | Blocked | UNIT |
| Applicant | `/` | Start New Application, View All, Continue Application, Track | enabled/empty | Navigate to apply/track | Route navigation partly covered | Blocked | E2E, INSPECT |
| Applicant | `/apply` wizard | Progress steps 1–8 | enabled/completed | Navigate wizard while persisting state | Full clean-account journey not executed | Blocked | INSPECT |
| Applicant | Step 1 | Applicant fields, Back, Next, save draft | valid/invalid | Validate and persist draft | Not executed with disposable full fixture | Blocked | INSPECT |
| Applicant | Step 2 | Consignee add/edit/update/remove/cancel and navigation | valid/invalid/empty | Maintain consignee rows and persist | Not executed | Blocked | INSPECT |
| Applicant | Step 3 | Drug add/edit/remove, generic-name gate, alerts | approved/banned/unlisted/format variants | Frontend/backend parity | Generic-name regression passed; full register matrix not executed | Blocked | UNIT |
| Applicant | Step 4 | Manufacturer add/edit/update/remove/cancel | valid/invalid | Maintain manufacturer rows and persist | Not executed | Blocked | INSPECT |
| Applicant | Step 5 shipments | Add/edit/remove rows and quantity fields | valid/invalid | Maintain shipment references/persistence | Not executed | Blocked | INSPECT |
| Applicant | Step 5 documents | Every upload slot, browse/drop, preview, replace, remove | valid/invalid | Upload by stable docId; replace invalidates verdict | Replacement invalidation unit passed; file matrix not executed | Blocked | UNIT, INSPECT |
| Applicant | Step 5 documents | AI verify / retry | success/failure | Neutral technical failures; explicit positive/negative only | Parser/live API verified; upload UI persistence remains unverified | Blocked | UNIT, LIVE |
| Applicant | Step 6 | Declaration checkboxes, Back, Next | unchecked/checked | Enforce declarations | Not executed | Blocked | INSPECT |
| Applicant | Step 7 | Review sections, edit links, submit | valid/invalid/double click | One persisted application and identifiers | Submission visibility DB tests passed; full browser submit not run | Blocked | DB |
| Applicant | Step 8 | Success links/downloads | completed | Show identifiers and navigate/download | Not executed | Blocked | INSPECT |
| Applicant | `/track` | Application/reference search fields and Search | empty | Query application API and render empty/result/error | Fields rendered in both viewports; real record search not run | Blocked | E2E, INSPECT |
| Applicant | `/track` | Quick View / checklist / query reply actions | result | Open result, respond, upload correction | Query persistence covered by DB tests; browser flow not run | Blocked | DB, INSPECT |
| Reviewer | `/review` | KPI status radios | empty | Filter queue and analytics consistently | Unit aggregation passed; browser click matrix incomplete | Blocked | UNIT, E2E |
| Reviewer | `/review` | Analytics collapse, chart/table toggles, daily/weekly/monthly | empty | Toggle analytics views | Empty state rendered; toggles not all clicked | Blocked | E2E, INSPECT |
| Reviewer | `/review` | Search | empty/no match | URL-backed query and filtered API | Filled and retained without runtime error | Pass | E2E-D, E2E-M |
| Reviewer | `/review` | Category, country, state, date/custom range filters | empty | Combined server filters and clear | Filter logic unit-tested; browser combination matrix incomplete | Blocked | UNIT, INSPECT |
| Reviewer | `/review` | Clear all | filtered | Reset URL/filter state | Conditional empty-state execution only | Blocked | E2E |
| Reviewer | `/review` | Sort application/applicant/submitted/status/queries | empty | Server-side sort | Rendered; not all clicked | Blocked | INSPECT |
| Reviewer | `/review` | Open application | empty | Navigate to detail and mark read | No disposable queue row during browser run | Blocked | DB, INSPECT |
| Reviewer | `/review` | Rows per page | empty | Change page size | 25 selected successfully | Pass | E2E-D, E2E-M |
| Reviewer | `/review` | First/previous/next/last pagination | empty/disabled | Page without duplicate/lost rows | Empty-state disabled behavior passed; populated behavior DB-tested | Pass | E2E, DB |
| Reviewer | `/review/application/:id` | Back to Queue | loading/error/data | Preserve filters and navigate | Direct-route/read unit tests passed; browser populated page absent | Blocked | UNIT |
| Reviewer | Application detail | Overview/Application/Documents/Shipments/Query History/Compliance tabs | data/empty/error | Render authoritative counts/sections | Component and data-shaping tests pass; populated browser journey absent | Blocked | UNIT |
| Reviewer | Application detail | Summary | data | Open/close summary and navigate/open document | Unit coverage only | Blocked | UNIT |
| Reviewer | Documents | Open & Inspect / close / reopen | completed/failed/pending | Inspect stable docId; close without stale parent | Parent-state regression passed; real persisted browser fixture absent | Blocked | UNIT |
| Reviewer | Document viewer | Search, zoom out/in/reset, download, close | loaded | Manipulate preview | Rendered in component tests; not all controls exercised | Blocked | UNIT, INSPECT |
| Reviewer | Document viewer | Verification retry | technical failure | Retry neutral failure; persist before final display | Backend parser/retry tests passed; browser retry not run | Blocked | UNIT |
| Reviewer | Document viewer | Approve, document Query, Reject | correct/wrong/failure | Wrong type hides only document Reject; query stays doc-scoped | 7 action-state component tests and query modal tests passed | Pass | UNIT |
| Reviewer | Document query modal | AI rows edit/delete, manual row add/delete, submit/cancel/retry | valid/invalid/duplicate | Persist rows under docId and AIQ identifier | Unit plus isolated DB suites passed | Pass | UNIT, DB |
| Reviewer | Application actions | Under Review | submitted/query/final | Persist review/audit; block terminal reversal | 13 isolated DB route tests passed | Pass | DB |
| Reviewer | Application actions | Approve / Reject / application Query / Cancel | valid/invalid/duplicate | Mandatory remarks, transitions, audit, counters | Core unit routes pass; populated browser double-click not run | Blocked | UNIT, INSPECT |
| Reviewer | Shipments | Verify / Query / Approve / Reject and remarks | pending/final | Update line status and audit | Not browser-exercised | Blocked | INSPECT |
| Reviewer | Query History | Structured table, legacy rows, applicant response | populated/empty/error | Render chronological compatible history | Unit and isolated DB tests pass | Pass | UNIT, DB |
| Reviewer | Global | Applicant routes `/`, `/apply`, `/track` | reviewer session | Redirect to `/review` | Passed | Pass | E2E-D, E2E-M |
| Applicant | Global | Reviewer route `/review` | applicant session | Redirect to `/` | Passed | Pass | E2E-D, E2E-M |

## API/security controls

| Control | Expected | Actual | Status | Evidence |
|---|---|---|---|---|
| Stored pre/deep verification without reviewer identity | 401/403 | 403 | Pass | API probe |
| Stored pre/deep verification with applicant role | 403 | 403 | Pass | API probe |
| Reviewer queue without reviewer identity | 401/403 | Covered by tests | Pass | UNIT/DB |
| General application list without authentication | Denied | HTTP 200 | Fail | API probe |
| Production reviewer authentication | Verified server principal | Frontend uses demo session and production rejects dev headers; no login/token exchange exists | Fail | INSPECT |
