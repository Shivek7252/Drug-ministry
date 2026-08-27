import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { useApp } from '../../context/AppContext';
import {
  getApplicationFull,
  shipmentAction,
  preVerifyDocs,
  reviewerAction,
  getChecklist,
} from '../../api/applicationService';
import DocViewerModal from '../../components/shared/DocViewerModal';
import NocChecklistPage from '../../components/checklist/NocChecklistPage';
import ShipmentsTab from './ShipmentsTab';
import SummaryPanel from './SummaryPanel';
import './ReviewApplicationPage.css';

/* ══════════════════════════════════════════════════════════════════════════
   ReviewApplicationPage — full-page reviewer dashboard for a single
   application. Renders at /review/application/:appNumber (opens in a new
   browser tab from the queue).

   Composed of a sticky topbar, a hero card, a KPI strip, and a two-column
   body (sidebar navigation + main content). Reuses ShipmentsTab,
   NocChecklistPage, SummaryPanel and DocViewerModal.
   ══════════════════════════════════════════════════════════════════════════ */

/* Doc slots the applicant uploads to. Same list the queue-side modal used. */
const REQUIRED_DOCS = [
  { id: 'mfg_license', label: 'Manufacturing License', docType: 'mfg_license' },
  { id: 'product_approval', label: 'Product Approval Certificate', docType: 'product_approval' },
  { id: 'export_auth', label: 'Export Authorization Letter', docType: 'export_auth' },
  { id: 'qa_cert', label: 'Quality Assurance Certificate', docType: 'qa_cert' },
  { id: 'batch_analysis', label: 'Batch Analysis Report', docType: 'batch_analysis' },
  { id: 'product_info', label: 'Product Information Sheet', docType: 'product_info' },
];

const SECTIONS = [
  { id: 'overview', label: 'Overview', icon: '📊' },
  { id: 'details', label: 'Application', icon: '📋' },
  { id: 'docs', label: 'Documents', icon: '📁' },
  { id: 'shipments', label: 'Shipments', icon: '🚚' },
  { id: 'checklist', label: 'Checklist Query', icon: '🔍' },
];

const STATUS_TONES = {
  'Submitted': { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' },
  'Under Review': { bg: '#fefce8', color: '#a16207', border: '#fde68a' },
  'Verified': { bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0' },
  'Query Raised': { bg: '#fff7ed', color: '#c2410c', border: '#fdba74' },
  'Approved': { bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0' },
  'Partially Approved': { bg: '#eff6ff', color: '#1e40af', border: '#bfdbfe' },
  'Rejected': { bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
  'Draft': { bg: '#f8fafc', color: '#64748b', border: '#e2e8f0' },
};

/* ══════════════════════════════════════════════════════════════════════════
   Small building blocks
   ══════════════════════════════════════════════════════════════════════════ */

function StatusBadge({ status }) {
  const s = STATUS_TONES[status] || STATUS_TONES.Draft;
  return (
    <span className="rap-status-badge" style={{ background: s.bg, color: s.color, borderColor: s.border }}>
      {status}
    </span>
  );
}

function Field({ label, value, mono }) {
  const display = value == null || value === '' ? '—' : value;
  return (
    <div className="rap-field">
      <span className="rap-field-label">{label}</span>
      <span className={`rap-field-value ${mono ? 'rap-field-mono' : ''}`}>{display}</span>
    </div>
  );
}

function SectionCard({ title, icon, right, children, className = '' }) {
  return (
    <div className={`rap-card ${className}`}>
      <div className="rap-card-head">
        <div className="rap-card-title">
          {icon && <span className="rap-card-icon">{icon}</span>}
          <span>{title}</span>
        </div>
        {right && <div className="rap-card-right">{right}</div>}
      </div>
      <div className="rap-card-body">{children}</div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Main page
   ══════════════════════════════════════════════════════════════════════════ */

export default function ReviewApplicationPage() {
  const { appNumber } = useParams();
  const navigate = useNavigate();
  const { currentUser: ctxUser } = useApp();

  // When this page opens in a new browser tab via window.open(), the React
  // context is fresh (no login state). Fall back to the identity stored in
  // sessionStorage by the login handler in AppContext.
  const currentUser = useMemo(() => {
    if (ctxUser) return ctxUser;
    try {
      const stored = sessionStorage.getItem('reviewer_identity');
      if (stored) {
        const parsed = JSON.parse(stored);
        return parsed.username || null;
      }
    } catch (_) { }
    return null;
  }, [ctxUser]);

  const [full, setFull] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeSection, setActiveSection] = useState('overview');

  // Doc verdict / verify state — ported from the modal
  const [docResult, setDocResult] = useState({}); // filename-check cache
  const [docVerdict, setDocVerdict] = useState({}); // reviewer's explicit verify/decline
  const [verifiedDoc, setVerifiedDoc] = useState(null);
  const [mismatchDoc, setMismatchDoc] = useState(null);
  const [viewerDoc, setViewerDoc] = useState(null);

  // Compliance snapshot (fetched once for the Overview KPI strip)
  const [compliance, setCompliance] = useState(null);

  // Global panels
  const [showSummary, setShowSummary] = useState(false);

  // Action form
  const [showForm, setShowForm] = useState(false);
  const [actionStatus, setActionStatus] = useState('');
  const [remarks, setRemarks] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

  // Shipment line action state
  const [lineBusy, setLineBusy] = useState(null);
  const [lineRemarksPrompt, setLineRemarksPrompt] = useState(null);

  // Pre-verify background sweep
  const [aiCheckLoading, setAiCheckLoading] = useState(false);
  const preVerifyAttempted = useRef(new Set());

  const data = full || {};

  /* ── Data load ────────────────────────────────────────────────────────── */
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const res = await getApplicationFull(appNumber);
    if (res.success) setFull(res.application);
    else setError(res.error || 'Application could not be loaded.');
    setLoading(false);
  }, [appNumber]);

  useEffect(() => { load(); }, [load]);

  /* Compliance snapshot for KPIs — cheap fetch since /checklist is cached. */
  useEffect(() => {
    if (!appNumber) return;
    let cancelled = false;
    getChecklist(appNumber).then(res => {
      if (cancelled || !res.success) return;
      const items = flattenChecklist(res.checklist);
      const counts = { ok: 0, missing: 0, wrong: 0, unchecked: 0 };
      for (const it of items) counts[it.docStatus || 'missing']++;
      setCompliance({
        total: items.length,
        counts,
        pct: items.length ? Math.round((counts.ok / items.length) * 100) : 0,
        typeLabel: res.checklist?.typeLabel,
      });
    });
    return () => { cancelled = true; };
  }, [appNumber]);

  /* Pre-verify sweep — one-shot per app, using cached endpoint. */
  useEffect(() => {
    if (!full?.applicationNumber) return;
    if (preVerifyAttempted.current.has(full.applicationNumber)) return;

    const docs = full.documents || {};
    const uploaded = REQUIRED_DOCS.filter(d => docs[d.id]);
    if (uploaded.length === 0) return;
    const needsCheck = uploaded.some(d => {
      const vr = docs[d.id]?.validationResult;
      return !vr || typeof vr.documentTypeMatch !== 'boolean';
    });
    if (!needsCheck) return;

    preVerifyAttempted.current.add(full.applicationNumber);
    let cancelled = false;
    setAiCheckLoading(true);
    preVerifyDocs(full.applicationNumber).then(async (res) => {
      if (cancelled) return;
      if (res.success) {
        const refreshed = await getApplicationFull(full.applicationNumber);
        if (!cancelled && refreshed.success) setFull(refreshed.application);
      }
      if (!cancelled) setAiCheckLoading(false);
    });
    return () => { cancelled = true; };
  }, [full]);

  /* ── Compliance derived counts (from `data` — not from /checklist) ────── */
  const uploadStats = useMemo(() => {
    const docs = data.documents || {};
    let uploaded = 0, verified = 0, wrong = 0, pending = 0;
    for (const slot of REQUIRED_DOCS) {
      const doc = docs[slot.id];
      if (!doc) continue;
      uploaded++;
      const vr = doc.validationResult || {};
      if (vr.documentTypeMatch === true) verified++;
      else if (vr.documentTypeMatch === false) wrong++;
      else pending++;
    }
    return { uploaded, verified, wrong, pending, total: REQUIRED_DOCS.length };
  }, [data.documents]);

  /* ── Handlers ────────────────────────────────────────────────────────── */
  const openViewer = (docId, docLabel, docType, up) => {
    setViewerDoc({
      docId, docLabel, docType,
      fileUrl: up.objectUrl || '',
      fileName: up.name || docLabel,
      fileSize: up.size || 0,
      fileType: up.type || 'application/pdf',
    });
  };

  const handleDocClick = (docId, docLabel, docType, up) => {
    if (!up) return;
    const aiMatch = up.validationResult && typeof up.validationResult.documentTypeMatch === 'boolean'
      ? up.validationResult.documentTypeMatch
      : null;
    if (aiMatch === true) { setVerifiedDoc({ docId, docLabel, docType, up }); return; }
    if (aiMatch === false) { setMismatchDoc({ docId, docLabel, docType, up }); return; }
    // No cached verdict yet — go straight to the viewer (auto-run kicks in there).
    openViewer(docId, docLabel, docType, up);
  };

  const handleAction = async () => {
    if (!actionStatus) return;
    if ((actionStatus === 'Rejected' || actionStatus === 'Query Raised') && !remarks.trim()) {
      alert('Remarks are mandatory for this action.'); return;
    }
    setActionBusy(true);
    const res = await reviewerAction(data.applicationNumber, { status: actionStatus, remarks, officer: currentUser || 'reviewer' });
    setActionBusy(false);
    if (res.success) {
      setShowForm(false); setRemarks(''); setActionStatus('');
      await load();
    } else {
      alert(res.error || 'Action failed.');
    }
  };

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
      const res = await shipmentAction(data.applicationNumber, idx, {
        status: nextStatus, remarks: lineRemarks, officer: currentUser || 'reviewer',
      });
      if (res.success) await load();
      else alert(res.error || 'Line action failed.');
    } finally {
      setLineBusy(null);
      setLineRemarksPrompt(null);
    }
  };

  /* Lock body scroll for modal overlays. */
  useEffect(() => {
    const anyOpen = showSummary || !!verifiedDoc || !!mismatchDoc || !!viewerDoc;
    if (anyOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }
  }, [showSummary, verifiedDoc, mismatchDoc, viewerDoc]);

  /* ── Render ──────────────────────────────────────────────────────────── */
  if (loading) {
    return (
      <div className="rap-page">
        <div className="rap-loading">
          <div className="rap-spinner" />
          <div>Loading application {appNumber}…</div>
        </div>
      </div>
    );
  }

  if (error || !full) {
    return (
      <div className="rap-page">
        <div className="rap-error">
          <div className="rap-error-icon">⚠️</div>
          <h2>Could not load application</h2>
          <p>{error || `Application ${appNumber} was not found.`}</p>
          <button className="rap-btn rap-btn-primary" onClick={() => navigate('/review')}>← Back to Review Queue</button>
        </div>
      </div>
    );
  }

  const submittedDate = data.submittedAt ? new Date(data.submittedAt) : null;
  const applicant = data.applicantOrganization || data.applicantName || '—';

  return (
    <div className="rap-page">
      {/* ═══ Sticky topbar ═════════════════════════════════════════════ */}
      <div className="rap-topbar">
        <div className="rap-topbar-left">
          {/* <Link to="/review" className="rap-back-btn">← Review Queue</Link> */}
          {/* <span className="rap-crumb-sep">/</span> */}
          <span className="rap-crumb">{data.applicationNumber}</span>
        </div>
        <div className="rap-topbar-right">
          <StatusBadge status={data.status} />
          <button className="rap-btn rap-btn-back" onClick={() => navigate('/review')}>← Back to Queue</button>
        </div>
      </div>

      {/* ═══ Hero card ═════════════════════════════════════════════════ */}
      <div className="rap-hero">
        <div className="rap-hero-main">
          <div className="rap-hero-eyebrow">Export NOC Application</div>
          <h1 className="rap-hero-title">{applicant}</h1>
          <div className="rap-hero-meta">
            <span>📄 {data.applicationNumber}</span>
            <span>·</span>
            <span>Ref {data.referenceNumber}</span>
            {data.exportCategory && <><span>·</span><span className="rap-cat-pill">{data.exportCategory}</span></>}
            {(data.destinationCountry || data.consignees?.[0]?.country) && <>
              <span>·</span>
              <span>🌍 {data.destinationCountry || data.consignees?.[0]?.country}</span>
            </>}
            {submittedDate && <>
              <span>·</span>
              <span>📅 Submitted {submittedDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            </>}
          </div>
          {compliance?.typeLabel && (
            <div className="rap-hero-flow">Application flow: <em>{compliance.typeLabel}</em></div>
          )}
        </div>
        <div className="rap-hero-actions">
          {/* Summary always visible */}
          <button className="rap-btn rap-btn-neutral" onClick={() => setShowSummary(true)}>📊 Summary</button>

          {/* Submitted / Query Raised / Partially Approved — full action set */}
          {(data.status === 'Submitted' || data.status === 'Query Raised' || data.status === 'Partially Approved') && (
            <>
              <button className="rap-btn rap-btn-warn" onClick={() => { setActionStatus('Under Review'); setShowForm(true); }}>🔍 Under Review</button>
              <button className="rap-btn rap-btn-danger" onClick={() => { setActionStatus('Rejected'); setShowForm(true); }}>✕ Reject</button>
              <button className="rap-btn rap-btn-primary" onClick={() => { setActionStatus('Approved'); setShowForm(true); }}>✓ Approve</button>
            </>
          )}

          {/* Under Review — no "Under Review" button (already there), just Reject + Approve */}
          {data.status === 'Under Review' && (
            <>
              <button className="rap-btn rap-btn-danger" onClick={() => { setActionStatus('Rejected'); setShowForm(true); }}>✕ Reject</button>
              <button className="rap-btn rap-btn-primary" onClick={() => { setActionStatus('Approved'); setShowForm(true); }}>✓ Approve</button>
            </>
          )}

          {/* Approved — Summary only (no extra buttons) */}
          {/* Rejected — Summary only (no extra buttons) */}
        </div>
      </div>

      {/* ═══ KPI strip ═════════════════════════════════════════════════ */}
      <div className="rap-kpi-row">
        <KpiCard
          tone={compliance ? (compliance.pct >= 100 ? 'ok' : compliance.pct >= 60 ? 'warn' : 'bad') : 'neutral'}
          icon="🎯"
          label="Compliance"
          value={compliance ? `${compliance.pct}%` : '—'}
          hint={compliance ? `${compliance.counts.ok}/${compliance.total} checklist items OK` : 'Loading…'}
          onClick={() => setActiveSection('checklist')}
        />
        <KpiCard
          tone="neutral" icon="📎"
          label="Documents"
          value={`${uploadStats.uploaded}/${uploadStats.total}`}
          hint={`${uploadStats.uploaded} uploaded, ${uploadStats.total - uploadStats.uploaded} slot${uploadStats.total - uploadStats.uploaded !== 1 ? 's' : ''} empty`}
          onClick={() => setActiveSection('docs')}
        />
        <KpiCard
          tone={uploadStats.verified === uploadStats.uploaded && uploadStats.uploaded > 0 ? 'ok' : 'neutral'}
          icon="✓" label="AI Verified"
          value={String(uploadStats.verified)}
          hint={aiCheckLoading ? 'AI check in progress…' : 'Uploads matching their expected type'}
          onClick={() => setActiveSection('docs')}
        />
        <KpiCard
          tone={uploadStats.wrong > 0 ? 'bad' : 'ok'} icon="⚠"
          label="AI Flagged"
          value={String(uploadStats.wrong)}
          hint={uploadStats.wrong > 0 ? 'Wrong document type detected' : 'No misclassified uploads'}
          onClick={() => setActiveSection('docs')}
        />
        <KpiCard
          tone="neutral" icon="🚚"
          label="Shipments"
          value={String(data.shipments?.length || 0)}
          hint={`${(data.shipments || []).filter(s => s.lineStatus === 'Approved').length} approved · ${(data.shipments || []).filter(s => s.lineStatus === 'Pending').length} pending`}
          onClick={() => setActiveSection('shipments')}
        />
      </div>

      {/* ═══ Body: sidebar + main ═════════════════════════════════════ */}
      <div className="rap-body">
        <aside className="rap-sidebar">
          <div className="rap-side-label">Sections</div>
          <nav className="rap-nav">
            {SECTIONS.map(s => (
              <button key={s.id}
                className={`rap-nav-item ${activeSection === s.id ? 'active' : ''}`}
                onClick={() => setActiveSection(s.id)}>
                <span className="rap-nav-icon">{s.icon}</span>
                <span>{s.label}</span>
              </button>
            ))}
          </nav>

          {compliance && (
            <div className="rap-side-compliance">
              <div className="rap-side-label" style={{ margin: '20px 0 8px' }}>Compliance</div>
              <div className={`rap-side-pct rap-tone-${compliance.pct >= 100 ? 'ok' : compliance.pct >= 60 ? 'warn' : 'bad'}`}>
                <div className="rap-side-pct-num">{compliance.pct}%</div>
                <div className="rap-side-pct-bar">
                  <div className="rap-side-pct-fill" style={{ width: `${compliance.pct}%` }} />
                </div>
                <div className="rap-side-pct-detail">
                  ✓ {compliance.counts.ok} · ⚠ {compliance.counts.missing} · ✗ {compliance.counts.wrong}
                </div>
              </div>
            </div>
          )}
        </aside>

        <main className="rap-main">
          {activeSection === 'overview' && <OverviewSection data={data} compliance={compliance} uploadStats={uploadStats} onNavigate={setActiveSection} onOpenSummary={() => setShowSummary(true)} />}
          {activeSection === 'details' && <DetailsSection data={data} />}
          {activeSection === 'docs' && <DocumentsSection data={data} docVerdict={docVerdict} aiCheckLoading={aiCheckLoading} onDocClick={handleDocClick} />}
          {activeSection === 'shipments' && <ShipmentsTab data={data} actionBusy={lineBusy} onLineAction={handleLineAction} />}
          {activeSection === 'checklist' && <NocChecklistPage applicationNumber={data.applicationNumber} role="reviewer" />}
        </main>
      </div>

      {/* ═══ Modals & popups ═════════════════════════════════════════ */}
      {showSummary && (
        <SummaryPanel
          appNumber={data.applicationNumber}
          application={data}
          onClose={() => setShowSummary(false)}
          onNavigateTo={(tab) => setActiveSection(tab)}
          onOpenDoc={(docId, docLabel, docType, doc) => openViewer(docId, docLabel, docType, doc)}
        />
      )}

      {viewerDoc && (
        <DocViewerModal
          docId={viewerDoc.docId}
          docType={viewerDoc.docType}
          docLabel={viewerDoc.docLabel}
          fileUrl={viewerDoc.fileUrl}
          fileName={viewerDoc.fileName}
          fileSize={viewerDoc.fileSize}
          fileType={viewerDoc.fileType}
          appNumber={data.applicationNumber}
          verificationResult={docVerdict[viewerDoc.docId]}
          onVerify={(id) => setDocVerdict(p => ({ ...p, [id]: 'ok' }))}
          onDecline={(id) => setDocVerdict(p => ({ ...p, [id]: 'bad' }))}
          onClose={() => setViewerDoc(null)}
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

      {mismatchDoc && (
        <MismatchPopup
          docLabel={mismatchDoc.docLabel}
          onClose={() => setMismatchDoc(null)}
          onForward={() => {
            const { docId, docLabel, docType, up } = mismatchDoc;
            setMismatchDoc(null);
            openViewer(docId, docLabel, docType, up);
          }}
          onReject={() => {
            setMismatchDoc(null);
            setActionStatus('Rejected');
            setRemarks(`Document mismatch — uploaded file for "${mismatchDoc.docLabel}" does not match the expected template.`);
            setShowForm(true);
          }}
        />
      )}

      {lineRemarksPrompt && (
        <LineRemarksPrompt
          nextStatus={lineRemarksPrompt.nextStatus}
          onClose={() => setLineRemarksPrompt(null)}
          onSubmit={(text) => submitLineAction(lineRemarksPrompt.idx, lineRemarksPrompt.nextStatus, text)}
        />
      )}

      {showForm && (
        <ActionFormOverlay
          actionStatus={actionStatus}
          setActionStatus={setActionStatus}
          remarks={remarks}
          setRemarks={setRemarks}
          busy={actionBusy}
          onCancel={() => { setShowForm(false); setRemarks(''); setActionStatus(''); }}
          onSubmit={handleAction}
        />
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Sections
   ══════════════════════════════════════════════════════════════════════════ */

function OverviewSection({ data, compliance, uploadStats, onNavigate, onOpenSummary }) {
  const submittedDate = data.submittedAt ? new Date(data.submittedAt) : null;
  const products = data.products || [];
  const consignees = data.consignees || (data.consigneeName ? [{
    name: data.consigneeName, country: data.consigneeCountry, city: data.city,
  }] : []);

  return (
    <div className="rap-section">
      <SectionCard title="Snapshot" icon="👁️">
        <div className="rap-snapshot">
          <div className="rap-snap-item">
            <div className="rap-snap-label">Applicant</div>
            <div className="rap-snap-value">{data.applicantOrganization || data.applicantName || '—'}</div>
            {data.email && <div className="rap-snap-sub">{data.email}</div>}
          </div>
          <div className="rap-snap-item">
            <div className="rap-snap-label">Destination</div>
            <div className="rap-snap-value">
              {data.destinationCountry
                || consignees.map(c => c.country).filter(Boolean).join(', ')
                || '—'}
            </div>
            <div className="rap-snap-sub">{consignees.length} consignee{consignees.length !== 1 ? 's' : ''}</div>
          </div>
          <div className="rap-snap-item">
            <div className="rap-snap-label">Products</div>
            <div className="rap-snap-value">{products.length}</div>
            <div className="rap-snap-sub">{data.exportCategory || 'Uncategorised'}</div>
          </div>
          <div className="rap-snap-item">
            <div className="rap-snap-label">Application Type</div>
            <div className="rap-snap-value">{data.applicationType || '—'}</div>
            <div className="rap-snap-sub">{data.exportPurpose || ''}</div>
          </div>
          <div className="rap-snap-item">
            <div className="rap-snap-label">Submitted</div>
            <div className="rap-snap-value">
              {submittedDate ? submittedDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
            </div>
            {submittedDate && <div className="rap-snap-sub">{submittedDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>}
          </div>
        </div>
      </SectionCard>

      <div className="rap-two-col">
        <SectionCard
          title="Compliance At A Glance"
          icon="🎯"
          right={<button className="rap-mini-btn" onClick={onOpenSummary}>Open full summary →</button>}
        >
          {compliance ? (
            <div className="rap-compliance-glance">
              <div className={`rap-glance-hero rap-tone-${compliance.pct >= 100 ? 'ok' : compliance.pct >= 60 ? 'warn' : 'bad'}`}>
                <div className="rap-glance-num">{compliance.pct}%</div>
                <div className="rap-glance-cap">Checklist complete</div>
              </div>
              <div className="rap-glance-list">
                <GlanceRow label="Correct documents" count={compliance.counts.ok} tone="ok" />
                <GlanceRow label="Missing documents" count={compliance.counts.missing} tone="missing" onClick={compliance.counts.missing > 0 ? () => onNavigate('checklist') : null} />
                <GlanceRow label="Wrong documents" count={compliance.counts.wrong} tone="wrong" onClick={compliance.counts.wrong > 0 ? () => onNavigate('checklist') : null} />
                <GlanceRow label="Not yet verified" count={compliance.counts.unchecked} tone="unchecked" onClick={compliance.counts.unchecked > 0 ? () => onNavigate('docs') : null} />
              </div>
            </div>
          ) : (
            <div className="rap-empty">Loading compliance data…</div>
          )}
        </SectionCard>

        <SectionCard title="File Uploads" icon="📎" right={<button className="rap-mini-btn" onClick={() => onNavigate('docs')}>Manage →</button>}>
          <div className="rap-glance-list">
            <GlanceRow label="Files uploaded" count={uploadStats.uploaded} tone="ok" />
            <GlanceRow label="AI verified" count={uploadStats.verified} tone="ok" />
            <GlanceRow label="AI flagged wrong" count={uploadStats.wrong} tone="wrong" onClick={uploadStats.wrong > 0 ? () => onNavigate('docs') : null} />
            <GlanceRow label="Awaiting AI check" count={uploadStats.pending} tone="unchecked" />
            <GlanceRow label="Empty slots" count={uploadStats.total - uploadStats.uploaded} tone="missing" />
          </div>
        </SectionCard>
      </div>

      {consignees.length > 0 && (
        <SectionCard title="Consignees & Products" icon="🌍">
          <div className="rap-two-col">
            <div>
              <div className="rap-mini-label">Consignees</div>
              <div className="rap-chip-cloud">
                {consignees.map((c, i) => (
                  <span key={i} className="rap-chip">
                    <strong>{c.name || 'Consignee ' + (i + 1)}</strong>
                    {c.country && <span className="rap-chip-tag">{c.country}</span>}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <div className="rap-mini-label">Products</div>
              {products.length === 0 ? (
                <div className="rap-empty rap-empty-inline">No products listed.</div>
              ) : (
                <div className="rap-chip-cloud">
                  {products.map((p, i) => (
                    <span key={i} className="rap-chip">
                      <strong>{p.productName}</strong>
                      {p.strength && <span className="rap-chip-tag">{p.strength}</span>}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </SectionCard>
      )}
    </div>
  );
}

function GlanceRow({ label, count, tone, onClick }) {
  return (
    <div className={`rap-glance-row rap-tone-${tone} ${onClick ? 'clickable' : ''}`} onClick={onClick || undefined}>
      <span>{label}</span>
      <span className="rap-glance-count">{count}</span>
    </div>
  );
}

function DetailsSection({ data }) {
  return (
    <div className="rap-section">
      <SectionCard title="Application" icon="📋">
        <div className="rap-fields-grid">
          <Field label="Application No." value={data.applicationNumber} mono />
          <Field label="Reference No." value={data.referenceNumber} mono />
          <Field label="Application Type" value={data.applicationType} />
          <Field label="Export Purpose" value={data.exportPurpose} />
          <Field label="Export Category" value={data.exportCategory} />
          <Field label="Application Date" value={data.applicationDate} />
          <Field label="Submitted At" value={data.submittedAt ? new Date(data.submittedAt).toLocaleString('en-IN') : '—'} />
          <Field label="Status" value={data.status} />
        </div>
      </SectionCard>

      <SectionCard title="Applicant" icon="👤">
        <div className="rap-fields-grid">
          <Field label="Name" value={data.applicantName} />
          <Field label="Organization" value={data.applicantOrganization} />
          <Field label="Contact" value={data.contactNumber} />
          <Field label="Email" value={data.email} />
        </div>
      </SectionCard>

      {(data.consignees?.length > 0 || data.consigneeName) && (
        <SectionCard title={`Consignees (${data.consignees?.length || 1})`} icon="🏢">
          {(data.consignees?.length > 0 ? data.consignees : [{
            name: data.consigneeName, organisation: data.consigneeOrg,
            country: data.consigneeCountry, contactPerson: data.contactPerson,
            phone: data.consigneePhone, email: data.consigneeEmail,
            addressLine1: data.addressLine1, city: data.city, state: data.state, postalCode: data.postalCode,
          }]).map((c, i) => (
            <div key={i} className="rap-consignee-block">
              <div className="rap-consignee-head">
                🏢 Consignee #{i + 1}
                {c.country && <span className="rap-chip-tag">{c.country}</span>}
              </div>
              <div className="rap-fields-grid">
                <Field label="Consignee Name" value={c.name} />
                <Field label="Organization" value={c.organisation} />
                <Field label="Country" value={c.country} />
                <Field label="Contact Person" value={c.contactPerson} />
                <Field label="Phone" value={c.phone} />
                <Field label="Email" value={c.email} />
                <Field label="Address" value={[c.addressLine1, c.addressLine2, c.city, c.state, c.postalCode].filter(Boolean).join(', ')} />
              </div>
            </div>
          ))}
        </SectionCard>
      )}

      {data.products?.length > 0 && (
        <SectionCard title={`Products (${data.products.length})`} icon="💊">
          <div className="rap-table-wrap">
            <table className="rap-table">
              <thead><tr><th>#</th><th>Product</th><th>Form</th><th>Strength</th><th>Batch</th><th>Mfg Date</th><th>Expiry</th></tr></thead>
              <tbody>
                {data.products.map((p, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td><strong>{p.productName}</strong><br /><span className="rap-sub">{p.genericName}</span></td>
                    <td>{p.dosageForm}</td>
                    <td>{p.strength}</td>
                    <td><code>{p.batchNumber}</code></td>
                    <td>{p.mfgDate}</td>
                    <td>{p.expiryDate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      <SectionCard title="Manufacturer" icon="🏭">
        <div className="rap-fields-grid">
          <Field label="Manufacturer" value={data.manufacturerName} />
          <Field label="License No." value={data.mfgLicenseNo} mono />
          <Field label="Factory Address" value={data.factoryAddress} />
          <Field label="Manufacturing Site" value={data.manufacturingSite} />
          <Field label="Contact Person" value={data.mfgContactPerson} />
          <Field label="Contact Number" value={data.mfgContactNumber} />
          <Field label="Email" value={data.mfgEmail} />
          <Field label="Signatory" value={data.signatoryName ? `${data.signatoryName}${data.signatoryDesignation ? ` — ${data.signatoryDesignation}` : ''}` : ''} />
        </div>
      </SectionCard>

      {data.reviewerRemarks?.length > 0 && (
        <SectionCard title="Reviewer Remarks" icon="💬">
          <div className="rap-remarks">
            {data.reviewerRemarks.map((r, i) => (
              <div key={i} className="rap-remark">
                <div className="rap-remark-meta">
                  <span className="rap-remark-who">👨‍💼 {r.officer}</span>
                  <StatusBadge status={r.status} />
                  <span className="rap-remark-time">{new Date(r.timestamp).toLocaleString('en-IN')}</span>
                </div>
                <p className="rap-remark-text">{r.text}</p>
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}

function DocumentsSection({ data, docVerdict, aiCheckLoading, onDocClick }) {
  return (
    <div className="rap-section">
      <SectionCard title="Uploaded Documents" icon="📁">
        <div className="rap-docs-info">
          <span>ℹ️</span>
          <span>
            {aiCheckLoading
              ? 'AI is checking each uploaded document against its expected type — badges will update in a moment…'
              : <>Green ✓ means the AI confirmed the uploaded file matches the expected document type. Red ✗ means a wrong document was uploaded. Click <strong>Verify &amp; Open</strong> for the full AI checklist.</>}
          </span>
        </div>
        <div className="rap-docs-grid">
          {REQUIRED_DOCS.map(slot => {
            const up = data.documents?.[slot.id];
            const reviewerVerdict = docVerdict[slot.id];
            const aiVerdict = up?.validationResult && typeof up.validationResult.documentTypeMatch === 'boolean'
              ? (up.validationResult.documentTypeMatch ? 'ok' : 'bad')
              : null;
            const verdict = reviewerVerdict || aiVerdict;
            const aiPending = up && !aiVerdict && !reviewerVerdict && aiCheckLoading;

            const tone = !up ? 'none' : verdict === 'ok' ? 'ok' : verdict === 'bad' ? 'bad' : 'neutral';
            return (
              <div key={slot.id} className={`rap-doc-card rap-doc-${tone}`}>
                <div className="rap-doc-head">
                  <span className="rap-doc-icon">
                    {!up ? '❌' : aiPending ? '⏳' : verdict === 'ok' ? '✅' : verdict === 'bad' ? '🚫' : '📄'}
                  </span>
                  <div className="rap-doc-name">{slot.label}</div>
                  {aiPending && <span className="rap-badge rap-badge-pending">Checking…</span>}
                  {verdict === 'ok' && <span className="rap-badge rap-badge-ok">{reviewerVerdict ? '✓ Verified' : '✓ AI Correct'}</span>}
                  {verdict === 'bad' && <span className="rap-badge rap-badge-bad">{reviewerVerdict ? '✗ Declined' : '✗ Wrong Doc'}</span>}
                </div>
                {up ? (
                  <>
                    <div className="rap-doc-file">
                      <div className="rap-doc-filename" title={up.name}>📄 {up.name}</div>
                      <div className="rap-doc-meta">Uploaded {up.uploadedAt}</div>
                      {verdict === 'bad' && up.validationResult?.documentTypeReason && !reviewerVerdict && (
                        <div className="rap-doc-reason">⚠ {up.validationResult.documentTypeReason}</div>
                      )}
                    </div>
                    <div className="rap-doc-actions">
                      <button className="rap-btn rap-btn-primary rap-btn-sm"
                        onClick={() => onDocClick(slot.id, slot.label, slot.docType, up)}>
                        {verdict ? '👁 Open & Inspect' : '🔍 Verify & Open'}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="rap-doc-empty">Not uploaded</div>
                )}
              </div>
            );
          })}
        </div>
      </SectionCard>
    </div>
  );
}

function KpiCard({ tone, icon, label, value, hint, onClick }) {
  return (
    <button className={`rap-kpi rap-kpi-${tone}`} onClick={onClick}>
      <div className="rap-kpi-top">
        <span className="rap-kpi-icon">{icon}</span>
        <span className="rap-kpi-label">{label}</span>
      </div>
      <div className="rap-kpi-value">{value}</div>
      <div className="rap-kpi-hint">{hint}</div>
    </button>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Popups (verify/mismatch/line-remarks/action-form) — self-contained
   ══════════════════════════════════════════════════════════════════════════ */

function VerifiedPopup({ docLabel, onClose, onOpen }) {
  return createPortal(
    <div className="rap-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="rap-modal-box">
        <div className="rap-modal-icon rap-modal-icon-ok">✅</div>
        <h2 className="rap-modal-title" style={{ color: '#15803d' }}>Document Matched</h2>
        <p className="rap-modal-body">The uploaded document matches the prescribed template for this document type.</p>
        <div className="rap-modal-file rap-modal-file-ok"><strong>Document:</strong> {docLabel}</div>
        <div className="rap-modal-btns">
          <button className="rap-btn rap-btn-primary" onClick={onOpen}>👁 Open &amp; Inspect Document</button>
          <button className="rap-btn rap-btn-ghost" onClick={onClose}>✕ Close</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function MismatchPopup({ docLabel, onClose, onForward, onReject }) {
  return createPortal(
    <div className="rap-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="rap-modal-box">
        <div className="rap-modal-icon">🚫</div>
        <h2 className="rap-modal-title" style={{ color: '#dc2626' }}>Document Mismatch Detected</h2>
        <p className="rap-modal-body">The uploaded document does not match the prescribed template for this document type.</p>
        <div className="rap-modal-file"><strong>Document:</strong> {docLabel}</div>
        <div className="rap-modal-btns">
          <button className="rap-btn rap-btn-warn" onClick={onForward}>⏩ Forward for Further Review</button>
          <button className="rap-btn rap-btn-danger" onClick={onReject}>✕ Reject Application</button>
          <button className="rap-btn rap-btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function LineRemarksPrompt({ nextStatus, onClose, onSubmit }) {
  const [text, setText] = useState('');
  const isQuery = nextStatus === 'Query';
  return createPortal(
    <div className="rap-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="rap-modal-box">
        <div className="rap-modal-icon">{isQuery ? '❓' : '✕'}</div>
        <h2 className="rap-modal-title" style={{ color: isQuery ? '#b45309' : '#dc2626' }}>
          {isQuery ? 'Raise Query on Line' : 'Reject Line Item'}
        </h2>
        <p className="rap-modal-body">
          {isQuery ? 'Explain what needs clarification. The applicant will see this remark.' : 'Give a reason for rejecting this shipment line.'}
        </p>
        <textarea className="rap-textarea" rows={4} value={text} onChange={e => setText(e.target.value)}
          placeholder="Enter remarks…" autoFocus />
        <div className="rap-modal-btns">
          <button className={isQuery ? 'rap-btn rap-btn-warn' : 'rap-btn rap-btn-danger'}
            disabled={!text.trim()} onClick={() => onSubmit(text.trim())}>
            {isQuery ? '❓ Send Query' : '✕ Reject Line'}
          </button>
          <button className="rap-btn rap-btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function ActionFormOverlay({ actionStatus, setActionStatus, remarks, setRemarks, busy, onCancel, onSubmit }) {
  return createPortal(
    <div className="rap-modal-overlay" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="rap-modal-box" style={{ maxWidth: 520 }}>
        <div className="rap-modal-icon">📋</div>
        <h2 className="rap-modal-title">Reviewer Action</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
          <label className="rap-mini-label">Decision</label>
          <select className="rap-select" value={actionStatus} onChange={e => setActionStatus(e.target.value)}>
            <option value="">— select —</option>
            <option value="Under Review">Under Review</option>
            <option value="Approved">Approved</option>
            <option value="Query Raised">Query Raised</option>
            <option value="Rejected">Rejected</option>
          </select>
          <label className="rap-mini-label">
            Remarks {(actionStatus === 'Rejected' || actionStatus === 'Query Raised') && <span style={{ color: '#dc2626' }}>*</span>}
          </label>
          <textarea className="rap-textarea" rows={4} value={remarks} onChange={e => setRemarks(e.target.value)}
            placeholder="Notes for the applicant…" />
        </div>
        <div className="rap-modal-btns">
          <button className="rap-btn rap-btn-primary" onClick={onSubmit} disabled={busy || !actionStatus}>
            {busy ? '⏳ Submitting…' : '✓ Submit Decision'}
          </button>
          <button className="rap-btn rap-btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Helpers
   ══════════════════════════════════════════════════════════════════════════ */
function flattenChecklist(cl) {
  if (!cl) return [];
  const items = []; const seen = new Set();
  const push = it => { if (it && !seen.has(it.itemId)) { seen.add(it.itemId); items.push(it); } };
  (cl.preItems || cl.preSection4 || []).forEach(push);
  if (cl.mfgLicenseSection?.companies) cl.mfgLicenseSection.companies.forEach(push);
  if (cl.historicalItem) push(cl.historicalItem);
  for (const c of (cl.approvalSection?.countries || [])) (c.subItems || []).forEach(push);
  (cl.postItems || cl.postSection4 || []).forEach(push);
  return items;
}
