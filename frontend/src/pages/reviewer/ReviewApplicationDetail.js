import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { getApplicationFull } from '../../api/applicationService';
import DocViewerModal from '../../components/shared/DocViewerModal';
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
  mfg_license:      [['manufactur', 'mfg', 'form-25', 'form-28', 'form25', 'form28', 'form 25', 'form 28', 'license', 'licence', 'drug license', 'dsir', 'loan licence', 'loan license']],
  product_approval: [['approval', 'approved', 'cdsco', 'product approval', 'registration', 'marketing auth', 'certificate of approval', 'nda', 'new drug']],
  export_auth:      [['export', 'authorization', 'authorisation', 'auth letter', 'noc', 'no objection', 'export noc', 'export auth']],
  qa_cert:          [['quality', 'gmp', 'iso', 'assurance', 'qa cert', 'good manufacturing', 'who-gmp', 'who gmp', 'cgmp', 'compliance']],
  batch_analysis:   [['batch', 'analysis', 'coa', 'certificate of analysis', 'analytical', 'test report', 'quality control', 'batch report']],
  product_info:     [['product info', 'product information', 'package insert', 'prescribing', 'smpc', 'monograph', 'indications', 'product sheet']],
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

export default function ReviewApplicationDetail({ app, onClose, onAction, actionLoading }) {
  const [full, setFull] = useState(null);
  const [loadingFull, setLoadingFull] = useState(true);
  const [actionStatus, setActionStatus] = useState('');
  const [remarks, setRemarks] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [docResult, setDocResult] = useState({}); // docId → 'ok'|'bad'
  const [docVerdict, setDocVerdict] = useState({}); // docId → 'ok'|'bad' (reviewer's explicit verdict)
  const [mismatchDoc, setMismatchDoc] = useState(null); // { docId, docLabel, docType, up }
  const [activeTab, setActiveTab] = useState('details');
  const [viewerDoc, setViewerDoc] = useState(null); // { docId, docLabel, docType, fileUrl, fileName, fileSize, fileType }

  useEffect(() => {
    setFull(null); setLoadingFull(true); setDocResult({}); setDocVerdict({}); setShowForm(false);
    getApplicationFull(app.applicationNumber).then(res => {
      if (res.success) setFull(res.application);
      setLoadingFull(false);
    });
  }, [app.applicationNumber]);

  const data = full || app;

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
      openViewer(docId, docLabel, docType, up);
      return;
    }
    if (prev === 'bad') {
      setMismatchDoc({ docId, docLabel, docType, up });
      return;
    }

    // First time — check filename
    const ok = checkDocFilename(docId, docType, up);
    if (ok) {
      openViewer(docId, docLabel, docType, up);
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
        {[['details', '📋 Details'], ['docs', '📁 Documents'], ['audit', '📜 Audit']].map(([k, l]) => (
          <button key={k} className={`rv-tab-btn ${activeTab === k ? 'active' : ''}`} onClick={() => setActiveTab(k)}>{l}</button>
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
                <F label="Destination" value={data.destinationCountry} />
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
            <Sec title="Consignee / Importer" icon="🏢" defaultOpen={false}>
              <div className="rv-grid-2">
                <F label="Consignee" value={data.consigneeName} />
                <F label="Org" value={data.consigneeOrg} />
                <F label="Country" value={data.consigneeCountry} />
                <F label="Contact" value={data.contactPerson} />
                <F label="Phone" value={data.consigneePhone} />
                <F label="Email" value={data.consigneeEmail} />
                <F label="Address" value={[data.addressLine1, data.city, data.state, data.postalCode].filter(Boolean).join(', ')} />
              </div>
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
                      <button className="rv-verify-btn"
                        onClick={() => handleDocClick(doc.id, doc.label, doc.docType, up)}>
                        {verdict ? '👁 Open & Inspect' : '🔍 Verify & Open'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
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
            <button className="rv-act-btn rv-act-btn-query" onClick={() => { setActionStatus('Query Raised'); setShowForm(true); }}>❓ Query</button>
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
          onClose={() => setViewerDoc(null)}
        />
      )}
    </div>
  );
}
