/**
 * applicationService.js
 * All API calls for application CRUD, search, and tracking.
 * Falls back gracefully when the backend is offline.
 */

const BASE = 'http://localhost:5001/api/applications';

/* ── helper ─────────────────────────────────────────────────────────────── */
async function apiFetch(url, options = {}) {
  try {
    const res = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return { success: true, ...data };
  } catch (err) {
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
  return apiFetch(`${BASE}/${appNumber}/review`, {
    method: 'POST',
    body: JSON.stringify({ status, remarks, officer }),
  });
}

/* ── Reviewer: get full application with audit log ──────────────────────── */
export async function getApplicationFull(id) {
  return apiFetch(`${BASE}/${id}/full`);
}

/* ── Reviewer: act on a single shipment line item ──────────────────────── */
export async function shipmentAction(appNumber, shipmentIdx, { status, remarks = '', officer = 'reviewer' }) {
  return apiFetch(`${BASE}/${appNumber}/shipments/${shipmentIdx}/action`, {
    method: 'POST',
    body: JSON.stringify({ status, remarks, officer }),
  });
}

/* ── Export NOC Check-List Query flow ────────────────────────────────── */
export async function getChecklist(appNumber) {
  return apiFetch(`${BASE}/${appNumber}/checklist`);
}

export async function raiseChecklistQuery(appNumber, itemId, { queryText, officer = 'reviewer' }) {
  return apiFetch(`${BASE}/${appNumber}/checklist/${encodeURIComponent(itemId)}/query`, {
    method: 'POST',
    body: JSON.stringify({ queryText, officer }),
  });
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
    return { success: true, ...data };
  } catch (err) {
    return { success: false, error: err.message };
  }
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

    const apiResp = await fetch('http://localhost:5001/api/verify', {
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
