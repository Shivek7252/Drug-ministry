# CDSCO Export NOC — pre-demo checklist

Current decision: **NO-GO**. This checklist is the sequence to run once the outstanding
blockers in `RELEASE_REVIEW_REPORT_RERUN.md` §6 are closed. Do not run the demo against a
backend that fails step 3.

## A. Before the room (≈30 min, day before)

1. **Confirm the deployed build is the corrected one.**
   ```
   curl -s http://localhost:5001/health
   ```
   Must include `"authConfigured":true`. If that field is absent, port 5001 is running
   pre-authentication code — **stop, redeploy, do not demo.**

2. **Confirm the database.** The same `/health` response must name the database you intend to
   demo against. Never point a demo at an untested database.

3. **Confirm authentication is enforced.**
   ```
   curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5001/api/applications
   ```
   Must print `401`. Anything else is a release blocker.

4. **Confirm ownership is enforced.** Log in as demo applicant B and request demo applicant A's
   application number. Must return 404.

5. **Seed disposable demo accounts** (never reuse real ministry credentials):
   ```
   cd backend && node scripts/create-demo-accounts.js
   ```
   Pipe the output into the server's environment. Record the plaintext once; it is not recoverable.

6. **Run the regression gate.**
   ```
   cd backend && npm test && npm run test:db && npm run check
   cd frontend && CI=true npx react-scripts test --watchAll=false
   cd frontend && CI=true npx react-scripts build
   ```
   All must pass. `npm run test:db` must report `fail 0`.

7. **Run the verification consistency series** with one known-correct text PDF, one known-wrong
   text PDF, and one known-correct scanned PDF. For each, compare: reviewer card → inspector →
   API response → database record → applicant view → result after refresh. All six must agree.
   A result that changes only because the page was refreshed is a stop condition.

8. **Confirm neutral failure handling.** Force one technical failure (disconnect Mistral) and
   confirm the UI shows *Unable to Verify* / retry — never green, never red.

9. **Replace a verified file** and confirm the previous verdict disappears immediately without a
   refresh.

10. **Keep the previous deployment available** for rollback, and note how to switch back.

## B. Ten minutes before

11. Restart nothing. Confirm 3000 and 5001 respond and `/health` still reports the intended
    database and `authConfigured`.
12. Log in once as the demo applicant and once as the demo reviewer, in the two browser
    profiles you will actually use. Leave both sessions open.
13. Open the disposable application you will demonstrate and confirm its documents already show
    settled verdicts — do not let the room watch a cold verification.
14. Clear browser console. Confirm no errors on the reviewer queue and the application detail.
15. Have one spare disposable application submitted and ready, in case a live action fails.

## C. During the demo — safe sequence

16. Applicant: log in → dashboard → open the prepared draft → step through the wizard.
17. Applicant: add an approved product; then show the banned-product warning.
18. Applicant: upload the known-correct document. Wait for the verdict **without refreshing**.
19. Applicant: submit → show the application number → open Track.
20. Reviewer: show the new application and its unread state → search for it → open it.
21. Reviewer: compare the KPI counters with the documents tab.
22. Reviewer: Open & Inspect the correct document → close → confirm the card is unchanged.
23. Reviewer: Open & Inspect the wrong document → show the reason and evidence → raise a
    document-specific structured query.
24. Applicant: show the query under the correct document → respond → upload a correction.
25. Reviewer: mark the application Under Review → show the internal observations and the
    applicant-facing message.
26. Reviewer: Approve **a different disposable application**, never the one under discussion.

## D. Hard stop conditions

Abandon the live path and switch to prepared screenshots if any of these occur:

- `/health` does not report `authConfigured`.
- An unauthenticated API call returns anything other than 401/403.
- A document verdict changes after a page refresh.
- A technical failure renders as *AI Correct* or *Wrong Document*.
- A query appears under the wrong document.
- The applicant and reviewer show different verification results for the same document.
- Any critical button produces no visible response.
