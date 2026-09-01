/**
 * applicationService.js
 * All API calls for application CRUD, search, and tracking.
 * Falls back gracefully when the backend is offline.
 */

import { serializeReviewerFilters } from '../config/reviewerFilters';
import { signalQueueChanged } from '../config/queueRefreshSignal';
import { APPLICATIONS_API, BACKEND_ORIGIN } from '../config/api';

const BASE = APPLICATIONS_API;

export function reviewerHeaders() {
  try {
    const identity = JSON.parse(sessionStorage.getItem('reviewer_identity') || '{}');
    if (identity.role === 'reviewer' && identity.username) {
      return { 'X-User-Role': 'reviewer', 'X-Reviewer-Name': identity.username };
    }
  } catch (_) { }
  return {};
}

/* ── helper ─────────────────────────────────────────────────────────────── */
async function apiFetch(url, options = {}) {
  const { signal: caller, ...rest } = options;
  /* The 15s timeout still applies, but a caller-supplied signal must also be
     able to cancel — previously it was silently overwritten, so a component
     that unmounted mid-request could not actually abort it. */
  const timeout = AbortSignal.timeout(15000);
  const signal = caller && typeof AbortSignal.any === 'function'
    ? AbortSignal.any([caller, timeout])
    : (caller || timeout);
  try {
    const res = await fetch(url, {
      ...rest,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      signal,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return { success: true, ...data };
  } catch (err) {
    /* A deliberate abort is not a failure the UI should report. */
    if (caller?.aborted || err.name === 'AbortError' || err.name === 'TimeoutError') {
      return { success: false, aborted: true, error: err.message };
    }
    return { success: false, error: err.message };
  }
}

/* Strip blob URLs (only valid in caller's browser) but ship base64 data */
function cleanDocuments(docs) {
  const out = {};
  if (!docs) return out;
  for (const [id, doc] of Object.entries(docs)) {
    out[id] = {
      name: doc.name,
      size: doc.size,
      type: doc.type,
      uploadedAt: doc.uploadedAt,
      data: doc.data || '',
    };
  }
  return out;
}

/* ── Auto-save draft ─────────────────────────────────────────────────────── */
export async function saveDraft(formData, user = 'anonymous') {
  const cleanDocs = cleanDocuments(formData.documents);
  return apiFetch(`${BASE}/draft`, {
    method: 'POST',
    body: JSON.stringify({ formData: { ...formData, documents: cleanDocs }, user }),
  });
}

/* ── Final submit ────────────────────────────────────────────────────────── */
export async function submitApplication(formData, user = 'anonymous') {
  const cleanDocs = cleanDocuments(formData.documents);
  console.log('[submitApplication] doc keys being sent:',
    Object.keys(cleanDocs),
    'data sizes:',
    Object.fromEntries(Object.entries(cleanDocs).map(([k, v]) => [k, v.data?.length || 0])));
  return apiFetch(`${BASE}/submit`, {
    method: 'POST',
    body: JSON.stringify({ formData: { ...formData, documents: cleanDocs }, user }),
  });
}

/* ── Search by application/reference number ─────────────────────────────── */
export async function searchApplication(appNo, refNo) {
  const params = new URLSearchParams();
  if (appNo)  params.set('appNo',  appNo.trim());
  if (refNo)  params.set('refNo',  refNo.trim());
  if (!appNo && !refNo) return { success: false, error: 'Provide appNo or refNo' };
  return apiFetch(`${BASE}/search?${params}`);
}

/* ── Full-text search ────────────────────────────────────────────────────── */
export async function searchFull(q) {
  return apiFetch(`${BASE}/search?q=${encodeURIComponent(q)}`);
}

/* ── Get single application detail ──────────────────────────────────────── */
export async function getApplication(id) {
  return apiFetch(`${BASE}/${encodeURIComponent(id)}`);
}

/* ── List all applications ───────────────────────────────────────────────── */
export async function listApplications(filters = {}) {
  const params = new URLSearchParams(filters);
  return apiFetch(`${BASE}?${params}`);
}

/* ── Dashboard stats ─────────────────────────────────────────────────────── */
export async function getDashboardStats() {
  return apiFetch(`${BASE}/stats/summary`);
}

/* ── Update status (admin) ──────────────────────────────────────────────── */
export async function updateStatus(appNumber, status, note = '') {
  return apiFetch(`${BASE}/${appNumber}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, note }),
  });
}

/* ── Reviewer: add remark + status update ─────────────────────────────── */
export async function reviewerAction(appNumber, { status, remarks, officer = 'reviewer' }) {
  const result = await apiFetch(`${BASE}/${appNumber}/review`, {
    method: 'POST',
    headers: reviewerHeaders(),
    body: JSON.stringify({ status, remarks, officer }),
  });
  if (result.success) signalQueueChanged();
  return result;
}

/* ── Reviewer: get full application with audit log ──────────────────────── */
export async function getApplicationFull(id) {
  return apiFetch(`${BASE}/${id}/full`, { headers: reviewerHeaders() });
}

/** Narrow reviewer-only payload used by the decision summary dialog. */
export async function getApplicationSummary(id, { signal } = {}) {
  return apiFetch(`${BASE}/${encodeURIComponent(id)}/summary`, {
    headers: reviewerHeaders(),
    signal,
  });
}

/* ── Reviewer: pre-verify every uploaded document so the Documents tab can
   show green/red doc-type-match badges without waiting for a manual click.
   Backend caches verdicts in Mongo — first call runs Mistral for uncached
   docs, subsequent calls return instantly. */
export async function preVerifyDocs(appNumber, { force = false } = {}) {
  try {
    const res = await fetch(`${BASE}/${appNumber}/pre-verify${force ? '?force=1' : ''}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...reviewerHeaders() },
      signal: AbortSignal.timeout(240000), // 4 min — Mistral round-trips for up to ~10 docs
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return { success: true, ...data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/* ── Reviewer: act on a single shipment line item ──────────────────────── */
export async function shipmentAction(appNumber, shipmentIdx, { status, remarks = '', officer = 'reviewer' }) {
  const result = await apiFetch(`${BASE}/${appNumber}/shipments/${shipmentIdx}/action`, {
    method: 'POST',
    headers: reviewerHeaders(),
    body: JSON.stringify({ status, remarks, officer }),
  });
  if (result.success) signalQueueChanged();
  return result;
}

/* ── Export NOC Check-List Query flow ────────────────────────────────── */
export async function getChecklist(appNumber) {
  return apiFetch(`${BASE}/${appNumber}/checklist`);
}

export async function raiseChecklistQuery(appNumber, itemId, { queryText, officer = 'reviewer' }) {
  const result = await apiFetch(`${BASE}/${appNumber}/checklist/${encodeURIComponent(itemId)}/query`, {
    method: 'POST',
    headers: reviewerHeaders(),
    body: JSON.stringify({ queryText, officer }),
  });
  if (result.success) signalQueueChanged();
  return result;
}

/* Reviewer queue: all filtering happens on the server before pagination. */
export async function listReviewerApplications(filters = {}, extras = {}) {
  const params = serializeReviewerFilters(filters, extras);
  return apiFetch(`${BASE}/reviewer?${params}`, { headers: reviewerHeaders() });
}

/* Reviewer analytics: current counts, weekly activity and the week-over-week
   comparison, aggregated server-side over the complete filtered dataset. */
export async function getReviewerAnalytics(filters = {}, { signal } = {}) {
  const params = serializeReviewerFilters(filters);
  return apiFetch(`${BASE}/reviewer/analytics?${params}`, { headers: reviewerHeaders(), signal });
}

export async function getReviewerFilterOptions() {
  return apiFetch(`${BASE}/reviewer/options`, { headers: reviewerHeaders() });
}

/* ── Application-level Under Review workflow ─────────────────────────────
   Whole-application scope. The server generates and validates the snapshot
   from the stored record; nothing sent from here is trusted as evidence. */

export async function getApplicationReviewSnapshot(appNumber, { signal } = {}) {
  return apiFetch(`${BASE}/${encodeURIComponent(appNumber)}/review-snapshot`, {
    headers: reviewerHeaders(), signal,
  });
}

/* Own fetch, not apiFetch: a 400 carries per-row validation messages and a 409
   carries the refused transition, both of which apiFetch would discard. */
export async function submitUnderReview(appNumber, { submissionId, rows, applicantMessage }) {
  try {
    const res = await fetch(`${BASE}/${encodeURIComponent(appNumber)}/under-review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...reviewerHeaders() },
      body: JSON.stringify({ submissionId, rows, applicantMessage }),
      signal: AbortSignal.timeout(20000),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || `HTTP ${res.status}`, rowErrors: data.rowErrors || null, code: data.code };
    }
    signalQueueChanged();
    return { success: true, ...data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/* ── Document-scoped query workflow ──────────────────────────────────────
   Both calls address the document by its stable docId, so a query can never
   be drafted from — or attached to — a different upload. */

export async function getDocumentQueryDraft(appNumber, docId, { signal } = {}) {
  return apiFetch(
    `${BASE}/${encodeURIComponent(appNumber)}/document/${encodeURIComponent(docId)}/query-draft`,
    { headers: reviewerHeaders(), signal }
  );
}

/* Not routed through apiFetch: a 400 carries per-row validation messages that
   the modal shows beside each row, and apiFetch discards the response body. */
export async function submitDocumentQuery(appNumber, docId, { submissionId, rows, expectedType }) {
  try {
    const res = await fetch(
      `${BASE}/${encodeURIComponent(appNumber)}/document/${encodeURIComponent(docId)}/query`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...reviewerHeaders() },
        body: JSON.stringify({ submissionId, rows, expectedType }),
        signal: AbortSignal.timeout(20000),
      }
    );
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || `HTTP ${res.status}`, rowErrors: data.rowErrors || null };
    }
    signalQueueChanged();
    return { success: true, ...data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export async function getQueryHistory(appNumber) {
  return apiFetch(`${BASE}/${encodeURIComponent(appNumber)}/query-history`, { headers: reviewerHeaders() });
}

/* Applicant reply — multipart because it can include a document. */
export async function replyChecklistQuery(appNumber, itemId, { reply, applicant = 'applicant', file = null }) {
  try {
    const form = new FormData();
    form.append('reply', reply);
    form.append('applicant', applicant);
    if (file) form.append('replyDoc', file);
    const res = await fetch(`${BASE}/${appNumber}/checklist/${encodeURIComponent(itemId)}/reply`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(30000),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const result = { success: true, ...data };
    signalQueueChanged();
    return result;
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   STEP II — RECONCILIATION API CALLS
   ══════════════════════════════════════════════════════════════════════════ */

/** Fetch all reconciliation entries for an application. */
export async function getReconciliation(appNumber) {
  return apiFetch(`${BASE}/${appNumber}/reconciliation`);
}

/**
 * Add a new reconciliation entry (with optional doc attachment).
 * `entry` is a plain object; `docFile` is an optional File object.
 */
export async function addReconciliationEntry(appNumber, entry, docFile = null) {
  try {
    const form = new FormData();
    Object.entries(entry).forEach(([k, v]) => {
      if (v !== null && v !== undefined) form.append(k, String(v));
    });
    if (docFile) form.append('doc', docFile);
    const res = await fetch(`${BASE}/${appNumber}/reconciliation`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(30000),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return { success: true, ...data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Update / submit an existing reconciliation entry.
 */
export async function updateReconciliationEntry(appNumber, entryId, patch, docFile = null) {
  try {
    const form = new FormData();
    Object.entries(patch).forEach(([k, v]) => {
      if (v !== null && v !== undefined) form.append(k, String(v));
    });
    if (docFile) form.append('doc', docFile);
    const res = await fetch(`${BASE}/${appNumber}/reconciliation/${entryId}`, {
      method: 'PATCH',
      body: form,
      signal: AbortSignal.timeout(30000),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return { success: true, ...data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/** Delete a draft reconciliation entry. */
export async function deleteReconciliationEntry(appNumber, entryId) {
  return apiFetch(`${BASE}/${appNumber}/reconciliation/${entryId}`, { method: 'DELETE' });
}

/** Set NOC metadata (reviewer action after approval). */
export async function setNocMeta(appNumber, meta) {
  return apiFetch(`${BASE}/${appNumber}/noc-meta`, {
    method: 'POST',
    body: JSON.stringify(meta),
  });
}

/* Map a checklist item's canonical id to the AI-verifier docType key. */
export function checklistItemToDocType(itemId) {
  if (!itemId) return 'default';
  if (itemId === 'irf')                             return 'irf';
  if (itemId === 'legal')                           return 'legal_undertaking';
  if (itemId === 'mfg_license')                     return 'mfg_license';
  if (itemId === 'historical')                      return 'historical_data';
  if (itemId === 'justification')                   return 'justification';
  if (itemId.startsWith('noc_mfg_license_'))        return 'mfg_license';
  if (itemId.startsWith('noc_approval_1_'))         return 'nra_cert';
  if (itemId.startsWith('noc_approval_2_'))         return 'cdsco_approval';
  return 'default';
}

/* Verify a checklist item's file with the AI verifier.
   Fetches the file from `fileUrl` (submissionDocUrl or replyDocUrl),
   sends it multipart to /api/verify with the mapped docType, returns the
   verifier's structured response. */
export async function verifyChecklistFile({ fileUrl, itemId, docLabel = 'document', fileName = 'file.pdf' }) {
  try {
    if (!fileUrl) return { success: false, error: 'No file URL provided.' };
    const fileResp = await fetch(fileUrl);
    if (!fileResp.ok) throw new Error(`Could not download file (HTTP ${fileResp.status}).`);
    const blob = await fileResp.blob();

    const docType = checklistItemToDocType(itemId);
    const form = new FormData();
    form.append('file', blob, fileName);
    form.append('docType',  docType);
    form.append('docLabel', docLabel);

    const apiResp = await fetch(`${BACKEND_ORIGIN}/api/verify`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(60000),
    });
    const data = await apiResp.json();
    if (!apiResp.ok) throw new Error(data.error || `HTTP ${apiResp.status}`);
    return { success: true, docType, ...data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export async function getReviewerReadState() {
  return apiFetch(`${BASE}/reviewer/read-state`, { headers: reviewerHeaders() });
}

export async function markApplicationRead(appNumber) {
  return apiFetch(`${BASE}/${encodeURIComponent(appNumber)}/read`, {
    method: 'POST',
    headers: reviewerHeaders(),
  });
}
