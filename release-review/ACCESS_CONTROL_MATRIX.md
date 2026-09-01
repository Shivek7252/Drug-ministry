# CDSCO Export NOC — access-control matrix

Authoritative inventory of every backend route and the authority required to reach it.
Produced during the release-review rerun. Evidence key: `PROBE` = live HTTP probe against
the isolated API on 5101; `AUTZ` = `backend/tests/authOwnership.test.js`; `DB` = isolated
database suite; `INSPECT` = route/middleware inspection.

## Enforcement model

Authentication and authorization are applied in three layers. Nothing below the first
layer can be reached by an anonymous caller.

| Layer | Mechanism | Where |
|---|---|---|
| 1. Authentication | Server-issued signed HttpOnly session cookie (`cdsco_session`), HMAC-SHA256 over a 32-byte random session id, in-memory session store with expiry | `backend/middleware/auth.js` |
| 2. CSRF | Double-submit token (`cdsco_csrf` cookie + `x-csrf-token` header) required on every unsafe method | `backend/middleware/auth.js` |
| 3. Authorization | `requireReviewer` / `requireApplicant` role guards, plus owner scoping via `scopedQuery()` | `backend/middleware/reviewerAuth.js`, `backend/routes/applications.js` |

The whole application router is mounted behind layers 1 and 2:

```js
app.use('/api/applications', auth.authenticate, auth.requireCsrf, applicationRoutes);
```

`scopedQuery(req, query)` is **default-deny**: with no request principal it returns
`{ _id: null }`, which matches nothing. For a reviewer it returns the query unchanged;
for an applicant it intersects the query with `ownershipFilter(principal)`, which matches
`ownerId === principal.id` or a legacy record whose `submittedBy` equals the username and
which carries no `ownerId`.

A non-owner receives **404**, not 403, so the endpoint does not disclose that the record exists.

## Route inventory

### Public (no authentication)

| Method | Route | Authority | Evidence |
|---|---|---|---|
| GET | `/health` | Public — status, model name and database name only; no secrets | PROBE |
| POST | `/api/auth/login` | Public — rate limited to 5 attempts per IP+username per 15 min; generic failure message | AUTZ |
| GET | `/api/approved-drugs`, `/api/banned-drugs` | Public reference data — no applicant or application content | INSPECT |

### Authentication only

| Method | Route | Authority | Evidence |
|---|---|---|---|
| GET | `/api/auth/me` | Any authenticated principal | AUTZ |
| POST | `/api/auth/logout` | Any authenticated principal + CSRF; invalidates the session immediately | AUTZ |

### Applicant, owner-scoped

Reviewers also reach these; `scopedQuery` leaves their query unscoped.

| Method | Route | Scoping | Evidence |
|---|---|---|---|
| GET | `/api/applications` | Owner-filtered list | AUTZ |
| GET | `/api/applications/search` | Owner-filtered | AUTZ |
| GET | `/api/applications/stats/summary` | Owner-filtered counts | AUTZ |
| GET | `/api/applications/:id` | Owner-scoped — **fixed in this rerun** | AUTZ |
| GET | `/api/applications/:id/document/:docId` | Owner-scoped — **fixed in this rerun** | AUTZ |
| GET | `/api/applications/:id/checklist` | Owner-scoped via `loadAppOr404` — **fixed in this rerun** | AUTZ |
| GET | `/api/applications/:id/checklist/:itemId/submission-file` | Owner-scoped via `loadAppOr404` | INSPECT |
| GET | `/api/applications/:id/checklist/:itemId/reply-file/:version` | Owner-scoped via `loadAppOr404` | INSPECT |
| GET | `/api/applications/:id/reconciliation` | Owner-scoped via `loadAppOr404` | AUTZ |
| GET | `/api/applications/:id/reconciliation/:entryId/doc` | Owner-scoped via `loadAppOr404` | INSPECT |
| POST | `/api/applications/draft` | `requireApplicant`; `ownerId` taken from the principal | AUTZ |
| POST | `/api/applications/submit` | `requireApplicant`; `ownerId` from the principal, body-supplied `ownerId`/`status` ignored | AUTZ |
| POST | `/api/applications/:id/checklist/:itemId/reply` | `requireApplicant` + owner scope | INSPECT |
| POST/PATCH/DELETE | `/api/applications/:id/reconciliation[/:entryId]` | `requireApplicant` + owner scope | INSPECT |

### Reviewer only

| Method | Route | Authority | Evidence |
|---|---|---|---|
| GET | `/api/applications/reviewer` | `requireReviewer` | AUTZ, DB |
| GET | `/api/applications/reviewer/analytics` | `requireReviewer` | AUTZ, DB |
| GET | `/api/applications/reviewer/options` | `requireReviewer` | INSPECT |
| GET | `/api/applications/reviewer/export` | `requireReviewer` | AUTZ |
| GET | `/api/applications/reviewer/read-state` | `requireReviewer` | DB |
| POST | `/api/applications/:id/read` | `requireReviewer`; receipt keyed by principal id | DB |
| GET | `/api/applications/:id/full` | `requireReviewer` — internal notes and raw verification | AUTZ |
| GET | `/api/applications/:id/summary` | `requireReviewer` | AUTZ |
| GET | `/api/applications/:id/query-history` | `requireReviewer` | AUTZ, DB |
| GET | `/api/applications/:id/review-snapshot` | `requireReviewer` | AUTZ, DB |
| POST | `/api/applications/:id/under-review` | `requireReviewer` | DB |
| POST | `/api/applications/:id/review` | `requireReviewer` | AUTZ, DB |
| PATCH | `/api/applications/:id/status` | `requireReviewer` | AUTZ |
| POST | `/api/applications/:id/shipments/:idx/action` | `requireReviewer` | DB |
| GET/POST | `/api/applications/:id/document/:docId/query-draft`, `/query` | `requireReviewer` | DB |
| POST | `/api/applications/:id/checklist/:itemId/query` | `requireReviewer` | INSPECT |
| POST | `/api/applications/:appNum/pre-verify` | authenticate + CSRF + `requireReviewer` | INSPECT |
| POST | `/api/applications/:appNum/document/:docId/verify` | authenticate + CSRF + `requireReviewer` | INSPECT |

### Authenticated utility

| Method | Route | Authority | Evidence |
|---|---|---|---|
| POST | `/api/verify`, `/api/validate-template`, `/api/extract-doc-data` | authenticate + CSRF | INSPECT |
| POST | `/api/fill-templates`, `/api/fill-template/:name` | authenticate + CSRF | INSPECT |

## Negative-test results

All executed live against the isolated API with four disposable seeded accounts
(two applicants, two reviewers). Source: `backend/tests/authOwnership.test.js`, 14/14 pass.

| # | Probe | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | `GET /api/applications` anonymous | 401/403, no data | **401**, `{"error":"Authentication is required."}` | Pass |
| 2 | 9 anonymous reads (list, detail, document, checklist, full, query-history, reviewer queue, stats, search) | 401/403 and no application payload | All 401; no `applicationNumber` or applicant string in any body | Pass |
| 3 | 4 anonymous mutations (submit, draft, review, status) | 401/403 | All 401 | Pass |
| 4 | Applicant session + forged `x-user-role: reviewer` on reviewer queue | 403 | 403 | Pass |
| 5 | Applicant session + forged reviewer headers on `POST /:id/review` | 403 | 403 | Pass |
| 6 | Anonymous + forged reviewer headers | 401/403 | 401 | Pass |
| 7 | Reuse of session after logout | 401 | 401 | Pass |
| 8 | Wrong password | 401, generic message | 401, no user-existence disclosure | Pass |
| 9 | Applicant B reads applicant A's application | 404 | 404, no data leaked | Pass |
| 10 | Applicant B downloads applicant A's document | 404 | 404 | Pass |
| 11 | Applicant B reads applicant A's checklist and reconciliation | 404 | 404 | Pass |
| 12 | Applicant list scoping | own only | A sees own; B does not see A's | Pass |
| 13 | Reviewer reads any application (`/:id`, `/full`, `/query-history`) | 200 | 200 | Pass |
| 14 | Applicant hits 7 reviewer-only surfaces | 403 | 403 on all | Pass |
| 15 | Mass assignment of `ownerId` and `status` on submit | ignored | `ownerId` = principal, `status` ≠ Approved; forged owner still gets 404 | Pass |
| 16 | Mutation without `x-csrf-token` | 403 | 403 | Pass |

## Credential handling

- Passwords are stored only as `scrypt$N$r$p$salt$hash` (N=16384, r=8, p=1, 64-byte key).
- No username, password, hash, session secret or API key is committed.
- Disposable accounts are generated by `backend/scripts/create-demo-accounts.js`, which
  prints env lines to stdout and writes nothing to the repository.
- `AUTH_SESSION_SECRET` must be at least 32 characters or the server refuses to start.

## Known limitation

This is a **server-backed credential store for a controlled demo/staging environment**, not
ministry production SSO. Sessions are held in process memory, so they do not survive a
backend restart and do not span multiple backend instances. Integration with the real CDSCO
identity provider remains outstanding — see the rerun report, section 9.
