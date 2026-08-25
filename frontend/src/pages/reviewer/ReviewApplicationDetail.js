import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { getApplicationFull, shipmentAction, setNocMeta } from '../../api/applicationService';
import { useApp } from '../../context/AppContext';
import DocViewerModal from '../../components/shared/DocViewerModal';
import NocChecklistPage from '../../components/checklist/NocChecklistPage';
import ShipmentsTab from './ShipmentsTab';
import './ReviewDashboard.css';

const REQUIRED_DOCS = [
  { id: 'mfg_license', label: 'Manufacturing License', docType: 'mfg_license' },
  { id: 'product_approval', label: 'Product Approval Certificate', docType: 'product_approval' },
  { id: 'export_auth', label: 'Export Authorization Letter', docType: 'export_auth' },
  { id: 'qa_cert', label: 'Quality Assurance Certificate', docType: 'qa_cert' },
  { id: 'batch_analysis', label: 'Batch Analysis Report', docType: 'batch_analysis' },
  { id: 'product_info', label: 'Product Information Sheet', docType: 'product_info' },
];

const STATUS_OPTIONS = ['Under Review', 'Verified', 'Query Raised', 'Approved', 'Rejected'];

/* ── Collapsible section ────────────────────────────────── */
function Sec({ title, icon, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rv-section">
      <button className="rv-section-hdr" onClick={() => setOpen(o => !o)}>
        <span>{icon} {title}</span>
        <span style={{ fontSize: 10, color: '#94a3b8' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="rv-section-body">{children}</div>}
    </div>
  );
}

/* ── Info field ─────────────────────────────────────────── */
function F({ label, value }) {
  if (!value) return null;
  return (
    <div className="rv-field">
      <span className="rv-field-label">{label}</span>
      <span className="rv-field-value">{value}</span>
    </div>
  );
}

/* ── Line-remarks prompt (Query / Reject on a shipment line requires a note) ── */
function LineRemarksPrompt({ nextStatus, onClose, onSubmit }) {
  const [text, setText] = useState('');
  const isQuery = nextStatus === 'Query';
  return createPortal(
    <div className="rv-popup-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="rv-popup-box" style={{ maxWidth: 460 }}>
        <div className="rv-popup-icon">{isQuery ? '❓' : '❌'}</div>
        <h2 className="rv-popup-title" style={{ color: isQuery ? '#b45309' : '#dc2626' }}>
          {isQuery ? 'Raise Query on Line' : 'Reject Line Item'}
        </h2>
        <p className="rv-popup-body">
          {isQuery
            ? 'Explain what needs clarification. The applicant will see this remark.'
            : 'Give a reason for rejecting this shipment line.'}
        </p>
        <textarea
          className="rv-textarea"
          rows={4}
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Enter remarks…"
          autoFocus
        />
        <div className="rv-popup-btns" style={{ marginTop: 16 }}>
          <button
            className={isQuery ? 'rv-popup-btn-fwd' : 'rv-popup-btn-rej'}
            disabled={!text.trim()}
            onClick={() => onSubmit(text.trim())}
          >
            {isQuery ? '❓ Send Query' : '❌ Reject Line'}
          </button>
          <button className="rv-popup-btn-cancel" onClick={onClose}>✕ Cancel</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ── Verified popup (shown when filename matches the prescribed template) ──── */
function VerifiedPopup({ docLabel, onClose, onOpen }) {
  return createPortal(
    <div className="rv-popup-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="rv-popup-box">
        <div className="rv-popup-icon rv-popup-icon-ok">✅</div>
        <h2 className="rv-popup-title rv-popup-title-ok">Document Matched</h2>
        <p className="rv-popup-body">
          The uploaded document matches the prescribed template for this document type.
        </p>
        <div className="rv-popup-doc rv-popup-doc-ok"><strong>Document:</strong> {docLabel}</div>
        <div className="rv-popup-divider" />
        <p className="rv-popup-action-label">What would you like to do?</p>
        <div className="rv-popup-btns">
          <button className="rv-popup-btn-open" onClick={onOpen}>👁 Open &amp; Inspect Document</button>
          <button className="rv-popup-btn-cancel" onClick={onClose}>✕ Close</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ── Mismatch popup ─────────────────────────────────────── */
function MismatchPopup({ docLabel, onClose, onForward, onReject }) {
  return createPortal(
    <div className="rv-popup-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="rv-popup-box">
        <div className="rv-popup-icon">🚫</div>
        <h2 className="rv-popup-title">Document Mismatch Detected</h2>
        <p className="rv-popup-body">
          The uploaded document does not match the prescribed template for this document type.
        </p>
        <div className="rv-popup-doc"><strong>Document:</strong> {docLabel}</div>
        <div className="rv-popup-divider" />
        <p className="rv-popup-action-label">What would you like to do?</p>
        <div className="rv-popup-btns">
          <button className="rv-popup-btn-fwd" onClick={onForward}>⏩ Forward for Further Review &amp; Preview</button>
          <button className="rv-popup-btn-rej" onClick={onReject}>❌ Reject Application</button>
          <button className="rv-popup-btn-cancel" onClick={onClose}>✕ Cancel</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ── Filename-based document type check (no API needed) ────
   Returns true if the uploaded file name looks like the expected doc type.
   Checks against the file's original name stored as up.name.              */
const DOC_FILENAME_KEYWORDS = {
  mfg_license: [['manufactur', 'mfg', 'form-25', 'form-28', 'form25', 'form28', 'form 25', 'form 28', 'license', 'licence', 'drug license', 'dsir', 'loan licence', 'loan license']],
  product_approval: [['approval', 'approved', 'cdsco', 'product approval', 'registration', 'marketing auth', 'certificate of approval', 'nda', 'new drug']],
  export_auth: [['export', 'authorization', 'authorisation', 'auth letter', 'noc', 'no objection', 'export noc', 'export auth']],
  qa_cert: [['quality', 'gmp', 'iso', 'assurance', 'qa cert', 'good manufacturing', 'who-gmp', 'who gmp', 'cgmp', 'compliance']],
  batch_analysis: [['batch', 'analysis', 'coa', 'certificate of analysis', 'analytical', 'test report', 'quality control', 'batch report']],
  product_info: [['product info', 'product information', 'package insert', 'prescribing', 'smpc', 'monograph', 'indications', 'product sheet']],
};

function filenameMatchesDocType(fileName, docType) {
  if (!fileName || !docType) return true; // no info → allow
  const lower = fileName.toLowerCase().replace(/[_\-]/g, ' ');
  const kwGroups = DOC_FILENAME_KEYWORDS[docType];
  if (!kwGroups) return true; // unknown type → allow
  // Any keyword in any group matches → pass
  for (const group of kwGroups) {
    for (const kw of group) {
      if (lower.includes(kw)) return true;
    }
  }
  return false;
}

/* ══════════════════════════════════════════════════════════════════════════
   NocSetupPanel — Reviewer sets NOC validity + sanctioned quantity
   after the application is Approved. This triggers Step II (reconciliation)
   to become active for the applicant.
   ══════════════════════════════════════════════════════════════════════════ */
function NocSetupPanel({ app, currentUser, onSaved }) {
  const existingMeta = app.nocMeta || null;

  /* Pre-fill with today + 1 year if not yet set */
  const todayStr = new Date().toISOString().split('T')[0];
  const nextYearStr = (() => {
    const d = new Date(); d.setFullYear(d.getFullYear() + 1);
    return d.toISOString().split('T')[0];
  })();

  const [sanctionedQty, setSanctionedQty] = useState(existingMeta?.sanctionedQty || '');
  const [qtyUnit, setQtyUnit] = useState(existingMeta?.qtyUnit || 'units');
  const [nocIssuedDate, setNocIssuedDate] = useState(
    existingMeta?.nocIssuedDate
      ? new Date(existingMeta.nocIssuedDate).toISOString().split('T')[0]
      : todayStr
  );
  const [nocExpiryDate, setNocExpiryDate] = useState(
    existingMeta?.nocExpiryDate
      ? new Date(existingMeta.nocExpiryDate).toISOString().split('T')[0]
      : nextYearStr
  );
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  /* auto-set expiry to 1 year from issued date */
  const handleIssuedChange = (val) => {
    setNocIssuedDate(val);
    if (val) {
      const d = new Date(val);
      d.setFullYear(d.getFullYear() + 1);
      setNocExpiryDate(d.toISOString().split('T')[0]);
    }
  };

  const handleSave = async () => {
    if (!sanctionedQty.trim()) { setError('Sanctioned Quantity is required.'); return; }
    setBusy(true); setError(''); setSaved(false);
    const res = await setNocMeta(app.applicationNumber, {
      sanctionedQty: sanctionedQty.trim(),
      qtyUnit,
      nocIssuedDate,
      nocExpiryDate,
      officer: currentUser || 'reviewer',
    });
    setBusy(false);
    if (res.success) { setSaved(true); onSaved && onSaved(); }
    else setError(res.error || 'Failed to save NOC metadata.');
  };

  const isApproved = app.status === 'Approved';

  return (
    <div>
      {/* Info banner */}
      <div style={{
        background: '#f0f7ff', border: '1.5px solid #bfdbfe',
        borderRadius: 10, padding: '14px 16px', marginBottom: 20,
      }}>
        <div style={{ fontWeight: 800, fontSize: 13.5, color: '#1e3a8a', marginBottom: 6 }}>
          🏷 Export NOC Metadata — Step I Completion
        </div>
        <div style={{ fontSize: 12.5, color: '#1e40af', lineHeight: 1.6 }}>
          Per the CDSCO Guidance Document, once the NOC is issued it carries a <strong>1-year validity</strong>
          (or until the sanctioned quantity is exhausted, whichever is earlier). Set these values to
          activate the applicant's <strong>Step II Reconciliation module</strong>.
        </div>
        {!isApproved && (
          <div style={{
            marginTop: 10, padding: '8px 12px',
            background: '#fffbeb', border: '1px solid #fde68a',
            borderRadius: 7, fontSize: 12, color: '#92400e',
          }}>
            ⚠️ The application status is currently <strong>{app.status}</strong>.
            You can pre-fill NOC details, but they will only become active for the applicant
            once the status is set to <strong>Approved</strong>.
          </div>
        )}
      </div>

      {/* Current meta (if already set) */}
      {existingMeta && (
        <div style={{
          background: '#f0fdf4', border: '1.5px solid #86efac',
          borderRadius: 10, padding: '12px 16px', marginBottom: 20,
        }}>
          <div style={{ fontWeight: 700, fontSize: 12.5, color: '#15803d', marginBottom: 8 }}>
            ✅ NOC Already Issued — Current Values
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '8px 16px', fontSize: 12.5 }}>
            {[
              ['Issued Date', existingMeta.nocIssuedDate ? new Date(existingMeta.nocIssuedDate).toLocaleDateString('en-IN') : '—'],
              ['Expiry Date', existingMeta.nocExpiryDate ? new Date(existingMeta.nocExpiryDate).toLocaleDateString('en-IN') : '—'],
              ['Sanctioned Qty', `${existingMeta.sanctionedQty || '—'} ${existingMeta.qtyUnit || ''}`],
              ['Qty Exported', `${existingMeta.qtyExported || '0'} ${existingMeta.qtyUnit || ''}`],
              ['Qty Remaining', `${existingMeta.qtyRemaining || '—'} ${existingMeta.qtyUnit || ''}`],
              ['NOC Status', existingMeta.nocStatus || '—'],
            ].map(([l, v]) => (
              <div key={l}>
                <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.3px' }}>{l}</div>
                <div style={{ fontSize: 13, color: '#0f172a', fontWeight: 600, marginTop: 2 }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Form */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {[
          {
            label: 'NOC Issued Date', type: 'date', val: nocIssuedDate,
            onChange: (e) => handleIssuedChange(e.target.value)
          },
          {
            label: 'NOC Expiry Date (auto: issued + 1 year)', type: 'date', val: nocExpiryDate,
            onChange: (e) => setNocExpiryDate(e.target.value)
          },
        ].map(({ label, type, val, onChange }) => (
          <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11.5, fontWeight: 600, color: '#475569' }}>{label}</label>
            <input type={type} value={val} onChange={onChange}
              style={{ padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: 7, fontSize: 13, outline: 'none' }} />
          </div>
        ))}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11.5, fontWeight: 600, color: '#475569' }}>
            Sanctioned Quantity <span style={{ color: '#dc2626' }}>*</span>
          </label>
          <input type="text" value={sanctionedQty}
            onChange={e => setSanctionedQty(e.target.value)}
            placeholder="e.g. 50000"
            style={{ padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: 7, fontSize: 13, outline: 'none' }} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11.5, fontWeight: 600, color: '#475569' }}>Quantity Unit</label>
          <select value={qtyUnit} onChange={e => setQtyUnit(e.target.value)}
            style={{ padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: 7, fontSize: 13, outline: 'none', background: '#fff' }}>
            {['units', 'kg', 'litres', 'boxes', 'vials', 'tablets', 'capsules', 'ampoules'].map(u => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Guidance rule reminder */}
      <div style={{
        marginTop: 16, padding: '10px 14px',
        background: '#fefce8', border: '1px solid #fde68a',
        borderRadius: 8, fontSize: 12, color: '#713f12', lineHeight: 1.6,
      }}>
        <strong>📌 Key Rules (Guidance Document):</strong>
        <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>
          <li>NOC validity: <strong>1 year</strong> from date of issue OR exhaustion of sanctioned quantity — whichever is earlier.</li>
          <li>Qty/PO-specific NOC is <strong>discontinued</strong> except for NDPS and banned drugs.</li>
          <li>Formulations with &lt;60% residual shelf life must be <strong>destroyed in presence of SLA</strong>.</li>
          <li>APIs with &lt;3 months residual shelf life must be <strong>destroyed in presence of SLA</strong>.</li>
          <li>Timeline: Step I — 5 working days; Step II — 2 working days.</li>
        </ul>
      </div>

      {/* Error / saved */}
      {error && (
        <div style={{ marginTop: 12, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 7, fontSize: 12.5, color: '#dc2626' }}>
          ⚠️ {error}
        </div>
      )}
      {saved && (
        <div style={{ marginTop: 12, padding: '8px 12px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 7, fontSize: 12.5, color: '#15803d', fontWeight: 600 }}>
          ✅ NOC metadata saved successfully. The applicant's Reconciliation module is now active.
        </div>
      )}

      <div style={{ marginTop: 16, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button
          onClick={handleSave}
          disabled={busy}
          style={{
            padding: '10px 22px', background: '#003580', color: '#fff',
            border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13,
            cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? '⏳ Saving…' : existingMeta ? '🔄 Update NOC Metadata' : '🏷 Issue NOC & Activate Step II'}
        </button>
      </div>
    </div>
  );
}

export default function ReviewApplicationDetail({ app, onClose, onAction, actionLoading }) {
  const { currentUser } = useApp();
  const [full, setFull] = useState(null);
  const [loadingFull, setLoadingFull] = useState(true);
  const [actionStatus, setActionStatus] = useState('');
  const [remarks, setRemarks] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [docResult, setDocResult] = useState({}); // docId → 'ok'|'bad'
  const [docVerdict, setDocVerdict] = useState({}); // docId → 'ok'|'bad' (reviewer's explicit verdict)
  const [mismatchDoc, setMismatchDoc] = useState(null); // { docId, docLabel, docType, up }
  const [verifiedDoc, setVerifiedDoc] = useState(null); // { docId, docLabel, docType, up }
  const [activeTab, setActiveTab] = useState('details');
  const [viewerDoc, setViewerDoc] = useState(null); // { docId, docLabel, docType, fileUrl, fileName, fileSize, fileType }
  const [showSummary, setShowSummary] = useState(false);
  const [summaryData, setSummaryData] = useState({}); // docId → { status: 'idle'|'loading'|'done'|'error', results, summary, error }
  const [summaryDocId, setSummaryDocId] = useState(null); // which doc is expanded in summary
  const [lineBusy, setLineBusy] = useState(null); // shipment index currently being actioned
  const [lineRemarksPrompt, setLineRemarksPrompt] = useState(null); // { idx, nextStatus }

  useEffect(() => {
    setFull(null); setLoadingFull(true); setDocResult({}); setDocVerdict({}); setShowForm(false);
    getApplicationFull(app.applicationNumber).then(res => {
      if (res.success) setFull(res.application);
      setLoadingFull(false);
    });
  }, [app.applicationNumber]);

  // Lock body scroll whenever any modal overlay is open
  useEffect(() => {
    const anyOpen = showSummary || !!mismatchDoc || !!verifiedDoc || !!viewerDoc;
    if (anyOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }
  }, [showSummary, mismatchDoc, verifiedDoc, viewerDoc]);

  const data = full || app;

  /* Line-item action — Query/Reject prompt for remarks first */
  const handleLineAction = (idx, nextStatus) => {
    if (nextStatus === 'Query' || nextStatus === 'Rejected') {
      setLineRemarksPrompt({ idx, nextStatus });
      return;
    }
    submitLineAction(idx, nextStatus, '');
  };

  const submitLineAction = async (idx, nextStatus, lineRemarks) => {
    setLineBusy(idx);
    try {
      const res = await shipmentAction(data.applicationNumber, idx, { status: nextStatus, remarks: lineRemarks, officer: 'reviewer' });
      if (res.success) {
        // Refresh full application
        const full2 = await getApplicationFull(data.applicationNumber);
        if (full2.success) setFull(full2.application);
      } else {
        alert(res.error || 'Line action failed.');
      }
    } finally {
      setLineBusy(null);
      setLineRemarksPrompt(null);
    }
  };

  /* Check doc by filename only — instant, no API call */
  const checkDocFilename = (docId, docType, up) => {
    const fileName = up?.name || '';
    const ok = filenameMatchesDocType(fileName, docType);
    setDocResult(p => ({ ...p, [docId]: ok ? 'ok' : 'bad' }));
    return ok;
  };

  const handleDocClick = (docId, docLabel, docType, up) => {
    if (!up) return;
    const prev = docResult[docId];

    // Already checked — cached result
    if (prev === 'ok') {
      setVerifiedDoc({ docId, docLabel, docType, up });
      return;
    }
    if (prev === 'bad') {
      setMismatchDoc({ docId, docLabel, docType, up });
      return;
    }

    // First time — check filename
    const ok = checkDocFilename(docId, docType, up);
    if (ok) {
      setVerifiedDoc({ docId, docLabel, docType, up });
    } else {
      setMismatchDoc({ docId, docLabel, docType, up });
    }
  };

  const openViewer = (docId, docLabel, docType, up) => {
    setViewerDoc({
      docId,
      docLabel,
      docType,
      fileUrl: up.objectUrl || '',
      fileName: up.name || docLabel,
      fileSize: up.size || 0,
      fileType: up.type || 'application/pdf',
    });
  };

  /* Open query form pre-filled for a specific document */
  const handleDocQuery = (docLabel) => {
    setActionStatus('Query Raised');
    setRemarks(`Query regarding document: ${docLabel}`);
    setShowForm(true);
  };

  /* Fetch verify results for a single document (for summary) */
  const fetchDocSummary = async (docId, docLabel, docType, up) => {
    if (!up) return;
    setSummaryData(p => ({ ...p, [docId]: { status: 'loading', results: null, summary: null, error: '' } }));
    try {
      // objectUrl may be missing — try to construct it from applicationNumber
      const fileUrl = up.objectUrl || `http://localhost:5001/api/applications/${data.applicationNumber}/document/${docId}`;
      if (!fileUrl) throw new Error('Document URL not available.');

      const resp = await fetch(fileUrl);
      if (!resp.ok) throw new Error(`Could not fetch document (${resp.status}).`);
      const blob = await resp.blob();

      const form = new FormData();
      // Use correct docType per document, fallback to docId
      const mappedDocType = docType || docId || 'default';
      form.append('file', blob, (up.name || docLabel) + (up.name ? '' : '.pdf'));
      form.append('docType', mappedDocType);
      form.append('docLabel', docLabel);

      const apiResp = await fetch('http://localhost:5001/api/verify', { method: 'POST', body: form });
      const respData = await apiResp.json();
      if (!apiResp.ok) throw new Error(respData.error || 'Verification failed.');

      // Compute summary inline if backend didn't return one
      const results = respData.results || [];
      const summary = respData.summary || {
        total: results.length,
        present: results.filter(r => r.present === true).length,
        missing: results.filter(r => r.present === false).length,
        unknown: results.filter(r => r.present === null).length,
        score: results.length > 0
          ? Math.round((results.filter(r => r.present === true).length / results.length) * 100)
          : 0,
      };

      setSummaryData(p => ({ ...p, [docId]: { status: 'done', results, summary, documentTypeMatch: respData.documentTypeMatch, documentTypeReason: respData.documentTypeReason, error: '' } }));
    } catch (e) {
      setSummaryData(p => ({ ...p, [docId]: { status: 'error', results: null, summary: null, error: e.message } }));
    }
  };

  /* Trigger summary panel: load all uploaded docs — sequentially to avoid rate limiting */
  const handleOpenSummary = async () => {
    setShowSummary(true);
    const docs = data.documents || {};
    const toFetch = REQUIRED_DOCS.filter(doc => {
      if (!docs[doc.id]) return false;                       // not uploaded
      const sd = summaryData[doc.id];
      if (!sd) return true;                                  // never fetched
      if (sd.status === 'error') return false;               // let user retry manually
      if (sd.status === 'done') return false;                // already done
      return false;                                          // loading in progress
    });
    for (const doc of toFetch) {
      await fetchDocSummary(doc.id, doc.label, doc.docType, docs[doc.id]);
      // Small delay between calls to avoid rate limiting
      await new Promise(r => setTimeout(r, 800));
    }
  };

  const handleSubmit = () => {
    if (!actionStatus) { alert('Please select a status.'); return; }
    if ((actionStatus === 'Rejected' || actionStatus === 'Query Raised') && !remarks.trim()) {
      alert('Remarks are mandatory for this action.'); return;
    }
    onAction(data.applicationNumber, actionStatus, remarks);
    setShowForm(false); setRemarks(''); setActionStatus('');
  };

  /* Status badge color */
  const statusColor = { Approved: '#15803d', Rejected: '#dc2626', 'Under Review': '#a16207', Verified: '#15803d', 'Query Raised': '#c2410c', Submitted: '#1d4ed8' };
  const statusBg = { Approved: '#f0fdf4', Rejected: '#fef2f2', 'Under Review': '#fefce8', Verified: '#f0fdf4', 'Query Raised': '#fff7ed', Submitted: '#eff6ff' };
  const statusBorder = { Approved: '#bbf7d0', Rejected: '#fecaca', 'Under Review': '#fde68a', Verified: '#bbf7d0', 'Query Raised': '#fdba74', Submitted: '#bfdbfe' };
  const sc = statusColor[data.status] || '#64748b';
  const sb = statusBg[data.status] || '#f8fafc';
  const sbd = statusBorder[data.status] || '#e2e8f0';

  return (
    <div className="rv-detail-card">
      {/* Head */}
      <div className="rv-detail-head">
        <div>
          <div className="rv-detail-appno">{data.applicationNumber}</div>
          <div className="rv-detail-ref">{data.referenceNumber} · {data.applicantOrganization || data.applicantName || ''}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            background: sb, color: sc, border: `1px solid ${sbd}`,
            borderRadius: 20, padding: '4px 12px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap'
          }}>
            {data.status}
          </span>
          <button className="rv-detail-close" onClick={onClose}>✕ Close</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="rv-tabs">
        {[
          ['details', '📋', 'Details'],
          ['shipments', '🚚', 'Shipments'],
          ['docs', '📁', 'Documents'],
          ['checklist', '🔍', 'Checklist\nQuery'],
          ['noc', '🏷', 'NOC\nSetup'],
          ['audit', '📜', 'Audit'],
        ].map(([k, icon, label]) => (
          <button
            key={k}
            className={`rv-tab-btn ${activeTab === k ? 'active' : ''}`}
            onClick={() => setActiveTab(k)}
          >
            <span style={{ fontSize: 16, lineHeight: 1 }}>{icon}</span>
            <span style={{ fontSize: 10.5, fontWeight: 700, lineHeight: 1.2, textAlign: 'center', whiteSpace: 'pre' }}>{label}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="rv-tab-body">
        {loadingFull && (
          <div className="rv-state-box">
            <div className="rv-spinner" />
            <span className="rv-state-sub">Loading full details…</span>
          </div>
        )}

        {/* ── DETAILS ── */}
        {!loadingFull && activeTab === 'details' && (
          <>
            <Sec title="Application Details" icon="📋">
              <div className="rv-grid-2">
                <F label="Application No." value={data.applicationNumber} />
                <F label="Reference No." value={data.referenceNumber} />
                <F label="Application Type" value={data.applicationType} />
                <F label="Export Purpose" value={data.exportPurpose} />
                <F label="Export Category" value={data.exportCategory} />
                <F label="Destination"
                  value={
                    Array.isArray(data.consignees) && data.consignees.length > 0
                      ? [...new Set(data.consignees.map(c => c.country).filter(Boolean))].join(', ')
                      : data.destinationCountry
                  }
                />
                <F label="Application Date" value={data.applicationDate} />
                <F label="Submitted At" value={data.submittedAt ? new Date(data.submittedAt).toLocaleString('en-IN') : '—'} />
              </div>
            </Sec>
            <Sec title="Applicant" icon="👤">
              <div className="rv-grid-2">
                <F label="Name" value={data.applicantName} />
                <F label="Organization" value={data.applicantOrganization} />
                <F label="Contact" value={data.contactNumber} />
                <F label="Email" value={data.email} />
              </div>
            </Sec>
            <Sec title={`Consignee / Importer${Array.isArray(data.consignees) && data.consignees.length > 1 ? ` (${data.consignees.length})` : ''}`} icon="🏢" defaultOpen={false}>
              {Array.isArray(data.consignees) && data.consignees.length > 0
                ? data.consignees.map((c, i) => (
                  <div key={c.consigneeRef || i} style={{
                    border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px 14px',
                    marginBottom: i < data.consignees.length - 1 ? 12 : 0,
                    background: '#f8fafc',
                  }}>
                    <div style={{ fontWeight: 700, fontSize: 12, color: '#1e40af', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                      🏢 Consignee #{i + 1}
                      {c.country && <span style={{ background: '#dbeafe', color: '#1d4ed8', borderRadius: 12, padding: '1px 8px', fontSize: 11 }}>{c.country}</span>}
                    </div>
                    <div className="rv-grid-2">
                      <F label="Consignee Name" value={c.name} />
                      <F label="Organization" value={c.organisation} />
                      <F label="Country" value={c.country} />
                      <F label="Contact Person" value={c.contactPerson} />
                      <F label="Phone" value={c.phone} />
                      <F label="Email" value={c.email} />
                      <F label="Address" value={[c.addressLine1, c.addressLine2, c.city, c.state, c.postalCode].filter(Boolean).join(', ')} />
                    </div>
                  </div>
                ))
                : (
                  <div className="rv-grid-2">
                    <F label="Consignee" value={data.consigneeName} />
                    <F label="Org" value={data.consigneeOrg} />
                    <F label="Country" value={data.consigneeCountry} />
                    <F label="Contact" value={data.contactPerson} />
                    <F label="Phone" value={data.consigneePhone} />
                    <F label="Email" value={data.consigneeEmail} />
                    <F label="Address" value={[data.addressLine1, data.city, data.state, data.postalCode].filter(Boolean).join(', ')} />
                  </div>
                )
              }
            </Sec>
            {data.products?.length > 0 && (
              <Sec title={`Products (${data.products.length})`} icon="💊" defaultOpen={false}>
                <div className="rv-mini-table-wrap">
                  <table className="rv-mini-table">
                    <thead><tr><th>#</th><th>Product</th><th>Form</th><th>Strength</th><th>Batch</th></tr></thead>
                    <tbody>
                      {data.products.map((p, i) => (
                        <tr key={i}>
                          <td>{i + 1}</td>
                          <td><strong>{p.productName}</strong><br /><span style={{ fontSize: 10, color: '#64748b' }}>{p.genericName}</span></td>
                          <td><span className="rv-cat-pill">{p.dosageForm}</span></td>
                          <td>{p.strength}</td>
                          <td><code style={{ fontSize: 10, background: '#f1f5f9', padding: '1px 4px', borderRadius: 3 }}>{p.batchNumber}</code></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Sec>
            )}
            <Sec title="Manufacturer" icon="🏭" defaultOpen={false}>
              <div className="rv-grid-2">
                <F label="Manufacturer" value={data.manufacturerName} />
                <F label="License No." value={data.mfgLicenseNo} />
                <F label="Factory Addr." value={data.factoryAddress} />
                <F label="Signatory" value={`${data.signatoryName || ''}${data.signatoryDesignation ? ` — ${data.signatoryDesignation}` : ''}`} />
              </div>
            </Sec>
            {data.reviewerRemarks?.length > 0 && (
              <Sec title="Review History" icon="💬">
                <div className="rv-remarks-panel" style={{ padding: 0 }}>
                  {data.reviewerRemarks.map((r, i) => (
                    <div key={i} className="rv-remark-bubble">
                      <div className="rv-remark-meta">
                        <span className="rv-remark-who">👨‍💼 {r.officer}</span>
                        <span style={{ background: sb, color: sc, border: `1px solid ${sbd}`, borderRadius: 20, padding: '1px 8px', fontSize: 10, fontWeight: 700 }}>{r.status}</span>
                        <span className="rv-remark-time">{new Date(r.timestamp).toLocaleString('en-IN')}</span>
                      </div>
                      <p className="rv-remark-text">{r.text}</p>
                    </div>
                  ))}
                </div>
              </Sec>
            )}
          </>
        )}

        {/* ── SHIPMENTS ── */}
        {!loadingFull && activeTab === 'shipments' && (
          <ShipmentsTab
            data={data}
            actionBusy={lineBusy}
            onLineAction={handleLineAction}
          />
        )}

        {/* ── DOCUMENTS ── */}
        {!loadingFull && activeTab === 'docs' && (
          <div className="rv-docs-panel">
            <div className="rv-docs-info">
              <span>ℹ️</span>
              <span>Click <strong>Verify &amp; Open</strong> to validate a document against the prescribed template before opening it.</span>
            </div>
            {REQUIRED_DOCS.map(doc => {
              const up = data.documents?.[doc.id];
              const verdict = docVerdict[doc.id];
              const cls = !up ? 'rv-doc-none' : verdict === 'ok' ? 'rv-doc-ok' : verdict === 'bad' ? 'rv-doc-bad' : '';
              return (
                <div key={doc.id} className={`rv-doc-row ${cls}`}>
                  <span className="rv-doc-icon-big">
                    {!up ? '❌' : verdict === 'ok' ? '✅' : verdict === 'bad' ? '🚫' : '📄'}
                  </span>
                  <div className="rv-doc-info">
                    <div className="rv-doc-name">{doc.label}</div>
                    {up
                      ? <div className="rv-doc-file">{up.name} · {up.uploadedAt}</div>
                      : <div className="rv-doc-missing-lbl">Not uploaded</div>}
                  </div>
                  <div className="rv-doc-actions">
                    {verdict === 'ok' && <span className="rv-status-chip rv-chip-ok">✓ Verified</span>}
                    {verdict === 'bad' && <span className="rv-status-chip rv-chip-bad">✗ Declined</span>}
                    {up && (
                      <>
                        <button className="rv-verify-btn"
                          onClick={() => handleDocClick(doc.id, doc.label, doc.docType, up)}>
                          {verdict ? '👁 Open & Inspect' : '🔍 Verify & Open'}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── CHECKLIST QUERY (Type 1: Diff Products / Diff Companies / Diff Countries) ── */}
        {!loadingFull && activeTab === 'checklist' && (
          <NocChecklistPage
            applicationNumber={data.applicationNumber}
            role="reviewer"
          />
        )}

        {/* ── NOC SETUP (reviewer sets validity + sanctioned qty after approval) ── */}
        {!loadingFull && activeTab === 'noc' && (
          <div style={{ padding: '14px' }}>
            <NocSetupPanel
              app={data}
              currentUser={currentUser}
              onSaved={async () => {
                const res = await getApplicationFull(data.applicationNumber);
                if (res.success) setFull(res.application);
              }}
            />
          </div>
        )}

        {/* ── AUDIT ── */}
        {!loadingFull && activeTab === 'audit' && (
          <div className="rv-audit-panel">
            {(!data.auditLog || data.auditLog.length === 0)
              ? <div className="rv-state-box" style={{ padding: 24 }}><span className="rv-state-sub">No audit events recorded</span></div>
              : [...(data.auditLog || [])].reverse().map((e, i, arr) => (
                <div key={i} className="rv-audit-entry">
                  <div className="rv-audit-dot-wrap">
                    <div className="rv-audit-dot" />
                    {i < arr.length - 1 && <div className="rv-audit-line" />}
                  </div>
                  <div className="rv-audit-body">
                    <div className="rv-audit-evt">{(e.action || '').replace(/_/g, ' ')}</div>
                    <div className="rv-audit-desc">{e.detail}</div>
                    <div className="rv-audit-meta">
                      <span>👤 {e.user || 'system'}</span>
                      <span>🕒 {e.timestamp ? new Date(e.timestamp).toLocaleString('en-IN') : '—'}</span>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* ── Action bar ── */}
      <div className="rv-action-bar">
        {!showForm ? (
          <div className="rv-action-btns">
            <button className="rv-act-btn rv-act-btn-review" onClick={() => { setActionStatus('Under Review'); setShowForm(true); }}>🔍 Under Review</button>
            <button className="rv-act-btn rv-act-btn-approve" onClick={() => { setActionStatus('Approved'); setShowForm(true); }}>✅ Approve</button>
            <button className="rv-act-btn rv-act-btn-summary" onClick={handleOpenSummary}>📊 Summary</button>
            <button className="rv-act-btn rv-act-btn-reject" onClick={() => { setActionStatus('Rejected'); setShowForm(true); }}>❌ Reject</button>
          </div>
        ) : (
          <div className="rv-action-form">
            <div className="rv-action-form-row">
              <strong style={{ fontSize: 12.5, color: '#334155' }}>Decision:</strong>
              <select className="rv-status-select" value={actionStatus} onChange={e => setActionStatus(e.target.value)}>
                <option value="">— Select Status —</option>
                {STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
              </select>
              {(actionStatus === 'Rejected' || actionStatus === 'Query Raised') && (
                <span className="rv-req-note">* Remarks required</span>
              )}
            </div>
            <textarea className="rv-textarea" rows={3}
              placeholder={`Remarks / Observations${actionStatus === 'Rejected' || actionStatus === 'Query Raised' ? ' (required)' : ''}…`}
              value={remarks} onChange={e => setRemarks(e.target.value)} />
            <div className="rv-form-actions">
              <button className="rv-submit-btn" onClick={handleSubmit} disabled={actionLoading}>
                {actionLoading ? '⏳ Saving…' : '💾 Submit Decision'}
              </button>
              <button className="rv-cancel-btn" onClick={() => { setShowForm(false); setRemarks(''); setActionStatus(''); }}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Summary Modal */}
      {showSummary && createPortal(
        <div className="rv-popup-overlay" onClick={e => e.target === e.currentTarget && setShowSummary(false)}>
          <div className="rv-summary-box" onClick={e => e.stopPropagation()}>
            <div className="rv-summary-head">
              <span style={{ fontSize: 20 }}>📊</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: 15, color: '#0f2d5e' }}>Document Summary</div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 1 }}>AI-verified parameter check for each uploaded document</div>
              </div>
              <button className="rv-popup-btn-cancel" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => setShowSummary(false)}>✕ Close</button>
            </div>
            <div className="rv-summary-body">
              {REQUIRED_DOCS.map(doc => {
                const up = data.documents?.[doc.id];
                const sd = summaryData[doc.id];
                return (
                  <div key={doc.id} className="rv-summary-doc-card">
                    <div className="rv-summary-doc-header" onClick={() => setSummaryDocId(summaryDocId === doc.id ? null : doc.id)}>
                      <span className="rv-doc-icon-big" style={{ fontSize: 16 }}>
                        {!up ? '❌' : sd?.status === 'done'
                          ? (sd.documentTypeMatch === false ? '🚫'
                            : sd.summary?.score >= 75 ? '✅'
                              : sd.summary?.score >= 50 ? '⚠️' : '🔴')
                          : '📄'}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 12.5, color: '#1e293b' }}>{doc.label}</div>
                        {!up && <div style={{ fontSize: 10.5, color: '#dc2626', fontStyle: 'italic' }}>Not uploaded</div>}
                        {up && sd?.status === 'done' && (
                          <div style={{ fontSize: 10.5, color: '#64748b' }}>
                            {sd.documentTypeMatch === false
                              ? <span style={{ color: '#b91c1c', fontStyle: 'italic' }}>⚠️ Wrong document type — {sd.documentTypeReason || 'document does not match expected type'}</span>
                              : <>
                                Score: <strong style={{ color: sd.summary.score >= 75 ? '#16a34a' : sd.summary.score >= 50 ? '#d97706' : '#dc2626' }}>{sd.summary.score}%</strong>
                                &nbsp;·&nbsp;✓ {sd.summary.present} found &nbsp;·&nbsp; ✗ {sd.summary.missing} missing
                                {sd.summary.unknown > 0 && <>&nbsp;·&nbsp; ? {sd.summary.unknown} unknown</>}
                              </>
                            }
                          </div>
                        )}
                        {up && sd?.status === 'loading' && <div style={{ fontSize: 10.5, color: '#3b82f6' }}>⏳ Analyzing…</div>}
                        {up && sd?.status === 'error' && <div style={{ fontSize: 10.5, color: '#dc2626' }}>⚠️ {sd.error}</div>}
                        {up && !sd && <div style={{ fontSize: 10.5, color: '#94a3b8' }}>Pending analysis</div>}
                      </div>
                      {up && sd?.status === 'done' && (
                        <span style={{ fontSize: 10, color: '#94a3b8', flexShrink: 0 }}>{summaryDocId === doc.id ? '▲' : '▼'}</span>
                      )}
                      {up && (!sd || sd.status === 'idle') && (
                        <button className="rv-verify-btn" style={{ fontSize: 10, padding: '3px 8px' }}
                          onClick={e => { e.stopPropagation(); fetchDocSummary(doc.id, doc.label, doc.docType, up); }}>
                          Analyze
                        </button>
                      )}
                      {up && sd?.status === 'error' && (
                        <button className="rv-verify-btn" style={{ fontSize: 10, padding: '3px 8px' }}
                          onClick={e => { e.stopPropagation(); fetchDocSummary(doc.id, doc.label, doc.docType, up); }}>
                          Retry
                        </button>
                      )}
                    </div>
                    {up && sd?.status === 'done' && summaryDocId === doc.id && (
                      <div className="rv-summary-doc-items">
                        {sd.results.map((r, i) => {
                          const isPresent = r.present === true;
                          const isMissing = r.present === false;
                          return (
                            <div key={i} className={`rv-summary-item ${isMissing ? 'rv-summary-item-no' : isPresent ? 'rv-summary-item-yes' : 'rv-summary-item-unk'}`}>
                              <span className="rv-summary-item-icon">{isMissing ? '❌' : isPresent ? '✅' : '❓'}</span>
                              <div className="rv-summary-item-text">
                                <div className="rv-summary-item-label">{r.item}</div>
                                {isPresent && r.evidence && (
                                  <div className="rv-summary-item-evidence">
                                    📍 {typeof r.page === 'number' ? `Page ${r.page}: ` : ''}"{r.evidence}"
                                  </div>
                                )}
                                {r.note && <div className="rv-summary-item-note">{r.note}</div>}
                              </div>
                              <span className={`cl-badge rv-summary-item-badge ${isMissing ? 'cl-badge-no' : isPresent ? 'cl-badge-yes' : 'cl-badge-unk'}`}>
                                {isMissing ? 'NO' : isPresent ? 'YES' : '?'}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Verified popup — shown when filename matches the prescribed template */}
      {/* Line-remarks prompt */}
      {lineRemarksPrompt && (
        <LineRemarksPrompt
          nextStatus={lineRemarksPrompt.nextStatus}
          onClose={() => setLineRemarksPrompt(null)}
          onSubmit={(text) => submitLineAction(lineRemarksPrompt.idx, lineRemarksPrompt.nextStatus, text)}
        />
      )}

      {verifiedDoc && (
        <VerifiedPopup
          docLabel={verifiedDoc.docLabel}
          onClose={() => setVerifiedDoc(null)}
          onOpen={() => {
            const { docId, docLabel, docType, up } = verifiedDoc;
            setVerifiedDoc(null);
            openViewer(docId, docLabel, docType, up);
          }}
        />
      )}

      {/* Mismatch popup — rendered via portal to escape stacking context */}
      {mismatchDoc && (
        <MismatchPopup
          docLabel={mismatchDoc.docLabel}
          onClose={() => setMismatchDoc(null)}
          onForward={() => {
            const { docId, docLabel, docType, up } = mismatchDoc;
            setMismatchDoc(null);
            // Forward for review AND open viewer so reviewer can inspect
            onAction(data.applicationNumber, 'Query Raised', `Document mismatch: ${docLabel} does not match prescribed template. Forwarded for further review.`);
            openViewer(docId, docLabel, docType, up);
          }}
          onReject={() => {
            setMismatchDoc(null);
            setActionStatus('Rejected');
            setRemarks(`Document mismatch: ${mismatchDoc.docLabel} does not match the prescribed template.`);
            setShowForm(true);
          }}
        />
      )}

      {/* Document viewer modal with PDF search + AI checklist */}
      {viewerDoc && (
        <DocViewerModal
          docId={viewerDoc.docId}
          docType={viewerDoc.docType}
          docLabel={viewerDoc.docLabel}
          fileUrl={viewerDoc.fileUrl}
          fileName={viewerDoc.fileName}
          fileSize={viewerDoc.fileSize}
          fileType={viewerDoc.fileType}
          verificationResult={docVerdict[viewerDoc.docId]}
          onVerify={(id) => setDocVerdict(p => ({ ...p, [id]: 'ok' }))}
          onDecline={(id) => setDocVerdict(p => ({ ...p, [id]: 'bad' }))}
          onRaiseQuery={(docLabel) => {
            setViewerDoc(null);           // close viewer
            handleDocQuery(docLabel);     // open query form pre-filled
          }}
          onClose={() => setViewerDoc(null)}
        />
      )}
    </div>
  );
}
