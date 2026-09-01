# CDSCO Export NOC control matrix — rerun

Every row from `CONTROL_MATRIX.md` is preserved. No row was dropped, merged, or renamed to
improve the pass rate. Rows whose status is unchanged from the baseline are marked so
explicitly.

Evidence keys: `E2E-D` desktop browser; `E2E-M` mobile browser; `UNIT` Jest/node:test;
`DB` isolated database API test; `AUTZ` `backend/tests/authOwnership.test.js`;
`PROBE` live HTTP probe; `INSPECT` code/route inspection only.

`Blocked` means discovered but not exercised end to end. **`INSPECT` alone never counts as Pass.**

## Summary

| Status | Count |
|---|---:|
| Pass | 14 |
| Fail | 0 |
| Blocked | 31 |
| Not Applicable | 0 |
| **Total** | **45** |

Baseline was 11 Pass / 2 Fail / 32 Blocked. The two Fails are now Pass; one previously-passing
security row was re-verified and three new security rows were added.

## Functional controls

| Role | Page/route | Control | State tested | Expected | Actual | Status | Evidence | Change |
|---|---|---|---|---|---|---|---|---|
| Both | Global header | Login / Sign Up | invalid, valid | Validate credentials, persist session | Backend login/logout/session proven at API level; browser modal not re-run | Blocked | AUTZ | Downgraded — baseline E2E not repeated |
| Both | Login modal | Username, password, captcha, refresh, reveal, close | valid/invalid | Field validation, captcha refresh, close | Auxiliary controls still not exercised | Blocked | INSPECT | Unchanged |
| Applicant | Global header | Dashboard, Export NOC, Track, Help, Contact | authenticated | Navigate without losing session | Help/Contact still not clicked | Blocked | INSPECT | Unchanged |
| Applicant | Global header | Notification menu, user menu, text size, announcement dismiss | enabled | Toggle menus / accessibility state | Not functionally exercised | Blocked | INSPECT | Unchanged |
| Applicant | Global header | Logout | enabled | Clear session, return to guarded state | Server-side invalidation proven (session reuse → 401); browser logout not re-run | Blocked | AUTZ | Partial progress |
| Applicant | `/` | Start New Application, View All, Continue, Track | enabled/empty | Navigate to apply/track | Not executed with populated data | Blocked | INSPECT | Unchanged |
| Applicant | `/apply` wizard | Progress steps 1–8 | enabled/completed | Navigate while persisting state | Not executed | Blocked | INSPECT | Unchanged |
| Applicant | Step 1 | Applicant fields, Back, Next, save draft | valid/invalid | Validate and persist draft | Draft creation now owner-bound at API level; browser flow not run | Blocked | AUTZ | Partial progress |
| Applicant | Step 2 | Consignee add/edit/update/remove/cancel | valid/invalid/empty | Maintain rows and persist | Not executed | Blocked | INSPECT | Unchanged |
| Applicant | Step 3 | Drug add/edit/remove, generic-name gate, alerts | approved/banned/unlisted/format | Frontend/backend parity | Generic-name regression passes; full register matrix not executed | Blocked | UNIT | Unchanged |
| Applicant | Step 4 | Manufacturer add/edit/update/remove/cancel | valid/invalid | Maintain rows and persist | Not executed | Blocked | INSPECT | Unchanged |
| Applicant | Step 5 shipments | Add/edit/remove rows, quantity fields | valid/invalid | Maintain references/persistence | Not executed | Blocked | INSPECT | Unchanged |
| Applicant | Step 5 documents | Every slot, browse/drop, preview, replace, remove | valid/invalid | Upload by stable docId; replace invalidates verdict | Replacement invalidation unit passes; file matrix not executed | Blocked | UNIT | Unchanged |
| Applicant | Step 5 documents | AI verify / retry | success/failure | Neutral technical failures | Parser units pass; **no live verification run in this rerun** | Blocked | UNIT | Unchanged |
| Applicant | Step 6 | Declaration checkboxes, Back, Next | unchecked/checked | Enforce declarations | Not executed | Blocked | INSPECT | Unchanged |
| Applicant | Step 7 | Review sections, edit links, submit | valid/invalid/double click | One persisted application | Submission visibility DB tests pass (16/16); browser submit not run | Blocked | DB | Unchanged |
| Applicant | Step 8 | Success links/downloads | completed | Show identifiers, navigate/download | Not executed | Blocked | INSPECT | Unchanged |
| Applicant | `/track` | Application/reference search + Search | empty | Query API, render states | Real record search not run | Blocked | INSPECT | Unchanged |
| Applicant | `/track` | Quick View / checklist / query reply | result | Open, respond, upload correction | Query persistence covered by DB; browser flow not run | Blocked | DB | Unchanged |
| Reviewer | `/review` | KPI status radios | empty | Filter queue and analytics consistently | Aggregation units pass; browser click matrix incomplete | Blocked | UNIT | Unchanged |
| Reviewer | `/review` | Analytics collapse, chart/table, daily/weekly/monthly | empty | Toggle analytics views | Not all clicked | Blocked | INSPECT | Unchanged |
| Reviewer | `/review` | Search | empty/no match | URL-backed query, filtered API | Baseline browser pass not repeated; server filtering covered | Blocked | DB | Downgraded — not re-run |
| Reviewer | `/review` | Category, country, state, date/custom filters | empty | Combined server filters and clear | Filter logic unit-tested; browser combinations incomplete | Blocked | UNIT | Unchanged |
| Reviewer | `/review` | Clear all | filtered | Reset URL/filter state | Not executed | Blocked | INSPECT | Unchanged |
| Reviewer | `/review` | Sort application/applicant/submitted/status/queries | empty | Server-side sort | Not all clicked | Blocked | INSPECT | Unchanged |
| Reviewer | `/review` | Open application | empty | Navigate to detail, mark read | Read receipts now keyed by authenticated principal and proven per-reviewer (17/17); browser open not run | Blocked | DB | Partial progress |
| Reviewer | `/review` | Rows per page | empty | Change page size | Baseline browser pass not repeated | Blocked | INSPECT | Downgraded — not re-run |
| Reviewer | `/review` | First/previous/next/last pagination | empty/disabled | Page without duplicate/lost rows | Populated behaviour DB-tested; browser not re-run | Blocked | DB | Downgraded — not re-run |
| Reviewer | `/review/application/:id` | Back to Queue | loading/error/data | Preserve filters, navigate | Browser populated page absent | Blocked | UNIT | Unchanged |
| Reviewer | Application detail | Overview/Application/Documents/Shipments/Query History/Compliance | data/empty/error | Render authoritative counts | Component tests pass; populated browser journey absent | Blocked | UNIT | Unchanged |
| Reviewer | Application detail | Summary | data | Open/close, navigate, open document | Unit coverage only | Blocked | UNIT | Unchanged |
| Reviewer | Documents | Open & Inspect / close / reopen | completed/failed/pending | Inspect stable docId without stale parent | Parent-state regression passes; persisted browser fixture absent | Blocked | UNIT | Unchanged |
| Reviewer | Document viewer | Search, zoom out/in/reset, download, close | loaded | Manipulate preview | Not all exercised | Blocked | UNIT, INSPECT | Unchanged |
| Reviewer | Document viewer | Verification retry | technical failure | Neutral retry, persist before display | Backend units pass; browser retry not run | Blocked | UNIT | Unchanged |
| Reviewer | Document viewer | Approve, document Query, Reject | correct/wrong/failure | Wrong type hides only document Reject | 7 action-state component tests pass | Pass | UNIT | Unchanged |
| Reviewer | Document query modal | AI rows edit/delete, manual add/delete, submit/cancel/retry | valid/invalid/duplicate | Persist rows under docId with AIQ id | Unit + DB suites pass (10/10 DB) | Pass | UNIT, DB | Unchanged |
| Reviewer | Application actions | Under Review | submitted/query/final | Persist review/audit; block terminal reversal | 13/13 isolated DB route tests pass | Pass | DB | Unchanged |
| Reviewer | Application actions | Approve / Reject / application Query / Cancel | valid/invalid/duplicate | Mandatory remarks, transitions, audit | Core routes pass; browser double-click not run | Blocked | UNIT, INSPECT | Unchanged |
| Reviewer | Shipments | Verify / Query / Approve / Reject + remarks | pending/final | Update line status and audit | Not browser-exercised | Blocked | INSPECT | Unchanged |
| Reviewer | Query History | Structured table, legacy rows, applicant response | populated/empty/error | Chronological compatible history | Unit + DB pass | Pass | UNIT, DB | Unchanged |
| Reviewer | Global | Applicant routes `/`, `/apply`, `/track` | reviewer session | Redirect to `/review` | Server-side role guard proven (403 on applicant surfaces); browser redirect not re-run | Blocked | AUTZ | Downgraded — not re-run |
| Applicant | Global | Reviewer route `/review` | applicant session | Redirect to `/` | Server-side guard proven (403 on 7 reviewer surfaces); browser redirect not re-run | Blocked | AUTZ | Downgraded — not re-run |

## API / security controls

| Control | Expected | Actual | Status | Evidence | Change |
|---|---|---|---|---|---|
| Stored pre/deep verification without reviewer identity | 401/403 | 401 | Pass | AUTZ | Unchanged |
| Stored pre/deep verification with applicant role | 403 | 403 | Pass | AUTZ | Unchanged |
| Reviewer queue without reviewer identity | 401/403 | 401 anonymous, 403 applicant session | Pass | AUTZ, DB | Strengthened |
| General application list without authentication | Denied | **401**, no data in body | **Pass** | PROBE, AUTZ | **Fail → Pass** |
| Production reviewer authentication | Verified server principal | Server-issued signed HttpOnly session; headers carry no authority | **Pass** for demo/staging scope | AUTZ | **Fail → Pass** (production IdP still outstanding, see report §9) |
| Applicant ownership on detail / documents / checklist / reconciliation | Non-owner denied | 404 for all four | Pass | AUTZ | **New row** |
| Cross-applicant list scoping | Own records only | Own only | Pass | AUTZ | **New row** |
| CSRF on cookie-authenticated mutations | Denied without token | 403 | Pass | AUTZ | **New row** |
| Mass assignment of `ownerId` / `status` | Ignored | Ignored; forged owner still 404 | Pass | AUTZ | **New row** |
| Login rate limiting | Throttled | 5 attempts / 15 min per IP+username, `Retry-After` set | Pass | INSPECT, AUTZ | **New row** |
| Session invalidation on logout | Immediate | Subsequent call 401 | Pass | AUTZ | **New row** |

## Not executed in this rerun

Recorded so the gap is explicit rather than implied by absence:

- Playwright desktop and mobile suites (0 runs).
- Seeded populated E2E fixture set (Phase 6) — not built.
- Live Mistral classification of any kind (0 external API calls).
- Scanned-PDF consistency series and refresh comparison.
- `pdf-parse` extraction-variability investigation.
- Python forensics / tampering suite.
- Controlled restart of ports 3000 and 5001, and the final demo rehearsal against them.
