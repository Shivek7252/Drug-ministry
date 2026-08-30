import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { getChecklist } from '../../api/applicationService';
import './SummaryPanel.css';

/**
 * SummaryPanel — Application compliance dashboard.
 *
 * NOT a per-document text summary. Answers the reviewer's practical
 * questions in one place:
 *   - What documents does CDSCO require for this application?
 *   - What did the applicant upload?
 *   - What is verified / wrong / missing?
 *   - What issues need attention?
 *   - What should the reviewer do next?
 *
 * Data source: `/api/applications/:id/checklist` — one endpoint returns the
 * dynamic CDSCO checklist tree (with docStatus + fuzzy-matched uploads) and
 * the full documents map (with validationResult from pre-verify). Both are
 * DB-cached so this is fast.
 *
 * Props
 *   appNumber       — application number (required)
 *   application     — the loaded application (used for header metadata)
 *   onClose         — close callback
 *   onNavigateTo(tab) — jump to a tab (e.g. 'docs', 'shipments')
 *   onOpenDoc(docId, docLabel, docType, docObj) — open doc viewer for an upload
 */
export default function SummaryPanel({ appNumber, application, onClose, onNavigateTo, onOpenDoc }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    getChecklist(appNumber).then(res => {
      if (cancelled) return;
      if (res.success) setData(res);
      else setError(res.error || 'Failed to load compliance data.');
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [appNumber]);

  const analysis = useMemo(() => (data ? analyzeCompliance(data, application) : null), [data, application]);

  const handleNav = (tab) => {
    if (onNavigateTo) onNavigateTo(tab);
    onClose();
  };

  return createPortal(
    <div className="sp-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sp-modal" role="dialog" aria-modal="true">
        <SummaryHeader application={application} onClose={onClose} />

        {loading && (
          <div className="sp-state">
            <div className="sp-spinner" />
            <div>Loading compliance data…</div>
          </div>
        )}

        {!loading && error && (
          <div className="sp-state sp-state-error">
            <div style={{ fontSize: 32 }}>⚠️</div>
            <div><strong>Could not load summary</strong></div>
            <div style={{ fontSize: 12, color: '#64748b' }}>{error}</div>
          </div>
        )}

        {!loading && !error && analysis && (
          <div className="sp-body">
            <OverallCard analysis={analysis} />
            {/* Action-first ordering: Next Steps + Issues come immediately
                after the score so the reviewer sees what to do without
                scrolling past the detail grid. */}
            <NextStepsSection analysis={analysis} onNav={handleNav} />
            <IssuesSection analysis={analysis} onNav={handleNav} />
            <div className="sp-grid">
              <ChecklistSection analysis={analysis} onNav={handleNav} />
              <UploadedFilesSection analysis={analysis} onOpenDoc={(docId, doc) => {
                if (!onOpenDoc) return;
                onClose();
                onOpenDoc(docId, doc.name || docId, docId, doc);
              }} />
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Analyzer — pure function, computes every derived value in one place so the
   rendering layer stays declarative and easy to audit.
   ══════════════════════════════════════════════════════════════════════════ */
function analyzeCompliance(data, application) {
  const cl   = data.checklist || {};
  const docs = data.documents || {};

  const items = flattenChecklist(cl);
  const counts = { ok: 0, missing: 0, wrong: 0, unchecked: 0 };
  const buckets = { ok: [], missing: [], wrong: [], unchecked: [] };
  for (const it of items) {
    const s = it.docStatus || (it.submissionDocUrl ? 'ok' : 'missing');
    counts[s] = (counts[s] || 0) + 1;
    (buckets[s] || (buckets[s] = [])).push(it);
  }

  const total = items.length;
  const completionPct = total > 0 ? Math.round((counts.ok / total) * 100) : 0;

  // Uploads — the 6-slot side of the story
  const uploadEntries = Object.entries(docs);
  const uploadStats = { total: uploadEntries.length, verified: 0, wrong: 0, pending: 0 };
  const uploads = uploadEntries.map(([docId, doc]) => {
    const vr = doc.validationResult || {};
    let verdict, reason;
    if (typeof vr.documentTypeMatch === 'boolean') {
      verdict = vr.documentTypeMatch ? 'verified' : 'wrong';
      reason = vr.documentTypeReason || '';
    } else {
      verdict = 'pending';
      reason = '';
    }
    uploadStats[verdict]++;
    return { docId, doc, verdict, reason, verifiedAt: vr.verifiedAt || null };
  });

  // Issues — ranked list of things needing reviewer attention
  const issues = [];
  for (const it of buckets.wrong) {
    issues.push({
      severity: 'high',
      kind: 'wrong-doc',
      icon: '🚫',
      title: `Wrong document: ${it.title}`,
      detail: it.matchedDoc?.validationResult?.documentTypeReason
        || 'AI classified the upload as a different document type.',
      itemNo: it.itemNo,
      relatedTab: 'docs',
    });
  }
  for (const it of buckets.missing) {
    issues.push({
      severity: 'high',
      kind: 'missing',
      icon: '⚠️',
      title: `Missing: ${it.title}`,
      detail: `Item ${it.itemNo} — no matching document uploaded by the applicant.`,
      itemNo: it.itemNo,
      relatedTab: 'docs',
    });
  }
  for (const it of buckets.unchecked) {
    issues.push({
      severity: 'medium',
      kind: 'unchecked',
      icon: '❓',
      title: `Not AI-verified: ${it.title}`,
      detail: 'A document is attached but the AI type-check has not run yet.',
      itemNo: it.itemNo,
      relatedTab: 'docs',
    });
  }

  // Recommended next steps — actionable, ordered by priority
  const nextSteps = [];
  const missingCount = counts.missing;
  const wrongCount   = counts.wrong;
  const uncheckedCount = counts.unchecked;

  if (missingCount + wrongCount > 0) {
    nextSteps.push({
      priority: 1,
      icon: '📝',
      title: `${missingCount + wrongCount} document${missingCount + wrongCount !== 1 ? 's' : ''} need correction`,
      detail: `${missingCount} missing · ${wrongCount} wrongly uploaded. Review the uploads and request corrections from the applicant.`,
      cta: { label: 'Open Documents', tab: 'docs' },
    });
  }
  if (uncheckedCount > 0 && missingCount + wrongCount === 0) {
    nextSteps.push({
      priority: 2,
      icon: '🔍',
      title: `Trigger AI verification for ${uncheckedCount} unchecked document${uncheckedCount !== 1 ? 's' : ''}`,
      detail: 'Open each item once to run the full AI check — results are cached after the first run.',
      cta: { label: 'Open Documents', tab: 'docs' },
    });
  }
  if (completionPct === 100 && total > 0) {
    nextSteps.push({
      priority: 1,
      icon: '✅',
      title: 'All required documents present and verified',
      detail: 'Compliance is complete on the document side. Proceed to shipment-line verification or the final Approve/Reject decision.',
      cta: { label: 'Open Shipments', tab: 'shipments' },
    });
  }
  if (uploadStats.wrong > 0) {
    nextSteps.push({
      priority: 2,
      icon: '🔄',
      title: `${uploadStats.wrong} uploaded file${uploadStats.wrong !== 1 ? 's' : ''} classified as wrong type`,
      detail: 'Review the AI reason on each file. If the AI is correct, decline the doc and request a re-upload via query.',
      cta: { label: 'Open Documents', tab: 'docs' },
    });
  }
  if (nextSteps.length === 0) {
    nextSteps.push({
      priority: 3,
      icon: '👀',
      title: 'Review remaining details and decide',
      detail: 'Documents are in order — check application details and shipments, then Approve or Reject.',
      cta: { label: 'Open Shipments', tab: 'shipments' },
    });
  }

  return {
    typeLabel: cl.typeLabel || '',
    total, counts, completionPct,
    buckets,
    checklistItems: items,
    uploadStats,
    uploads,
    issues,
    nextSteps,
    application,
  };
}

function flattenChecklist(cl) {
  const items = [];
  const seen = new Set();
  const push = (it) => { if (it && !seen.has(it.itemId)) { seen.add(it.itemId); items.push(it); } };
  (cl.preItems || cl.preSection4 || []).forEach(push);
  if (cl.mfgLicenseSection?.companies) cl.mfgLicenseSection.companies.forEach(push);
  if (cl.historicalItem) push(cl.historicalItem);
  for (const c of (cl.approvalSection?.countries || [])) (c.subItems || []).forEach(push);
  (cl.postItems || cl.postSection4 || []).forEach(push);
  return items;
}

/* ══════════════════════════════════════════════════════════════════════════
   Presentational sections
   ══════════════════════════════════════════════════════════════════════════ */
function SummaryHeader({ application, onClose }) {
  const app = application || {};
  return (
    <div className="sp-header">
      <div className="sp-header-left">
        <div className="sp-header-icon">📊</div>
        <div>
          <div className="sp-header-title">Application Compliance Summary</div>
          <div className="sp-header-sub">
            {app.applicationNumber || '—'}
            {app.referenceNumber && <> · {app.referenceNumber}</>}
            {app.applicantName && <> · {app.applicantName}</>}
            {app.status && <span className="sp-status-chip">{app.status}</span>}
          </div>
        </div>
      </div>
      <button className="sp-close" onClick={onClose} aria-label="Close">✕</button>
    </div>
  );
}

function OverallCard({ analysis }) {
  const { completionPct, counts, total, uploadStats, typeLabel } = analysis;
  const tone =
    completionPct >= 100 ? 'ok' :
    completionPct >= 60  ? 'warn' :
    'bad';

  return (
    <div className={`sp-overall sp-overall-${tone}`}>
      <div className="sp-overall-left">
        <div className="sp-gauge">
          <div className="sp-gauge-num">{completionPct}%</div>
          <div className="sp-gauge-label">complete</div>
        </div>
      </div>
      <div className="sp-overall-right">
        <div className="sp-overall-head">
          {completionPct >= 100
            ? '✅ All required documents present and correctly classified'
            : completionPct >= 60
              ? '⚠ Some checklist items still need attention'
              : '🚫 Significant compliance gaps — reviewer action required'}
        </div>
        {typeLabel && <div className="sp-overall-flow">Application flow: <strong>{typeLabel}</strong></div>}
        <div className="sp-count-chips">
          <span className="sp-chip sp-chip-ok">✓ Correct: {counts.ok}</span>
          {counts.missing > 0   && <span className="sp-chip sp-chip-missing">⚠ Missing: {counts.missing}</span>}
          {counts.wrong > 0     && <span className="sp-chip sp-chip-wrong">✗ Wrong: {counts.wrong}</span>}
          {counts.unchecked > 0 && <span className="sp-chip sp-chip-unchecked">? Unchecked: {counts.unchecked}</span>}
          <span className="sp-chip sp-chip-total">Total items: {total}</span>
        </div>
        <div className="sp-count-chips" style={{ marginTop: 8 }}>
          <span className="sp-chip sp-chip-mini">📎 Files uploaded: {uploadStats.total}</span>
          {uploadStats.verified > 0 && <span className="sp-chip sp-chip-mini sp-chip-ok">✓ AI verified: {uploadStats.verified}</span>}
          {uploadStats.wrong > 0    && <span className="sp-chip sp-chip-mini sp-chip-wrong">✗ AI flagged wrong: {uploadStats.wrong}</span>}
          {uploadStats.pending > 0  && <span className="sp-chip sp-chip-mini sp-chip-unchecked">⏳ Pending check: {uploadStats.pending}</span>}
        </div>
      </div>
    </div>
  );
}

function ChecklistSection({ analysis, onNav }) {
  const { checklistItems, counts } = analysis;
  if (checklistItems.length === 0) {
    return (
      <div className="sp-card">
        <div className="sp-card-title">📋 CDSCO Checklist Compliance</div>
        <div className="sp-empty">No checklist items configured for this application type.</div>
      </div>
    );
  }
  return (
    <div className="sp-card">
      <div className="sp-card-title">
        📋 CDSCO Checklist Compliance
        <button className="sp-card-cta" onClick={() => onNav('docs')}>Open Documents →</button>
      </div>
      <div className="sp-list">
        {checklistItems.map(it => {
          const s = it.docStatus || 'missing';
          return (
            <div key={it.itemId} className={`sp-list-row sp-list-row-${s}`}>
              <span className={`sp-status-dot sp-status-dot-${s}`}>
                {s === 'ok' ? '✓' : s === 'wrong' ? '✗' : s === 'unchecked' ? '?' : '⚠'}
              </span>
              <div className="sp-list-main">
                <div className="sp-list-title">
                  <span className="sp-list-num">{it.itemNo}</span>
                  <span>{it.title}</span>
                  {it.company && <span className="sp-list-tag">— {it.company}</span>}
                  {it.country && <span className="sp-list-tag">— {it.country}</span>}
                </div>
                {it.matchedDoc && (
                  <div className="sp-list-sub">
                    📄 {it.matchedDoc.name}
                    {it.matchedDoc.matchType === 'fuzzy' && <span className="sp-fuzzy-tag">fuzzy</span>}
                  </div>
                )}
                {s === 'wrong' && it.matchedDoc?.validationResult?.documentTypeReason && (
                  <div className="sp-list-reason">⚠ {it.matchedDoc.validationResult.documentTypeReason}</div>
                )}
                {s === 'missing' && (
                  <div className="sp-list-sub sp-list-sub-warn">No matching document uploaded.</div>
                )}
              </div>
              <span className={`sp-badge sp-badge-${s}`}>
                {s === 'ok' ? 'OK' : s === 'wrong' ? 'WRONG' : s === 'unchecked' ? 'PENDING' : 'MISSING'}
              </span>
            </div>
          );
        })}
      </div>
      {counts.ok === checklistItems.length && (
        <div className="sp-success-strip">✅ Every checklist item has a matching, correctly-classified document.</div>
      )}
    </div>
  );
}

function UploadedFilesSection({ analysis, onOpenDoc }) {
  const { uploads } = analysis;
  if (uploads.length === 0) {
    return (
      <div className="sp-card">
        <div className="sp-card-title">📎 Uploaded Files</div>
        <div className="sp-empty">The applicant has not uploaded any documents.</div>
      </div>
    );
  }
  return (
    <div className="sp-card">
      <div className="sp-card-title">
        📎 Uploaded Files ({uploads.length})
      </div>
      <div className="sp-list">
        {uploads.map(({ docId, doc, verdict, reason, verifiedAt }) => (
          <div key={docId} className={`sp-list-row sp-list-row-${verdict === 'verified' ? 'ok' : verdict === 'wrong' ? 'wrong' : 'unchecked'}`}>
            <span className={`sp-status-dot sp-status-dot-${verdict === 'verified' ? 'ok' : verdict === 'wrong' ? 'wrong' : 'unchecked'}`}>
              {verdict === 'verified' ? '✓' : verdict === 'wrong' ? '✗' : '?'}
            </span>
            <div className="sp-list-main">
              <div className="sp-list-title">
                <span className="sp-slot-tag">{docId}</span>
                <span title={doc.name}>{doc.name || '—'}</span>
              </div>
              {verdict === 'wrong' && reason && (
                <div className="sp-list-reason">⚠ {reason}</div>
              )}
              {verifiedAt && (
                <div className="sp-list-sub">AI checked: {new Date(verifiedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</div>
              )}
            </div>
            <div className="sp-list-actions">
              <span className={`sp-badge sp-badge-${verdict === 'verified' ? 'ok' : verdict === 'wrong' ? 'wrong' : 'unchecked'}`}>
                {verdict === 'verified' ? 'AI OK' : verdict === 'wrong' ? 'AI WRONG' : 'PENDING'}
              </span>
              {onOpenDoc && doc.objectUrl && (
                <button className="sp-mini-btn" onClick={() => onOpenDoc(docId, doc)} title="Open document">
                  👁 View
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function IssuesSection({ analysis, onNav }) {
  const { issues } = analysis;
  if (issues.length === 0) {
    return (
      <div className="sp-card sp-card-ok">
        <div className="sp-card-title">🎉 No outstanding issues</div>
        <div className="sp-empty" style={{ color: '#166534' }}>
          Every checklist item has a matching, AI-verified document. No missing or misclassified uploads.
        </div>
      </div>
    );
  }
  const bySev = { high: [], medium: [] };
  issues.forEach(i => (bySev[i.severity] || bySev.medium).push(i));
  return (
    <div className="sp-card">
      <div className="sp-card-title">
        🚨 Issues Requiring Attention <span className="sp-issue-count">{issues.length}</span>
      </div>
      <div className="sp-issue-list">
        {[...bySev.high, ...bySev.medium].map((iss, i) => {
          const clickable = !!iss.relatedTab;
          return (
            <div key={i}
                 className={`sp-issue sp-issue-${iss.severity} ${clickable ? 'sp-clickable' : ''}`}
                 onClick={clickable ? () => onNav(iss.relatedTab) : undefined}
                 role={clickable ? 'button' : undefined}
                 tabIndex={clickable ? 0 : undefined}
                 onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') onNav(iss.relatedTab); } : undefined}>
              <span className="sp-issue-icon">{iss.icon}</span>
              <div className="sp-issue-main">
                <div className="sp-issue-title">
                  {iss.itemNo && <span className="sp-list-num">{iss.itemNo}</span>}
                  {iss.title}
                </div>
                <div className="sp-issue-detail">{iss.detail}</div>
              </div>
              {clickable && (
                <span className="sp-row-cta">
                  Review →
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NextStepsSection({ analysis, onNav }) {
  const { nextSteps } = analysis;
  return (
    <div className="sp-card">
      <div className="sp-card-title">🎯 Recommended Next Steps</div>
      <div className="sp-steps">
        {nextSteps.map((s, i) => {
          const clickable = !!s.cta?.tab;
          return (
            <div key={i}
                 className={`sp-step sp-step-p${s.priority} ${clickable ? 'sp-clickable' : ''}`}
                 onClick={clickable ? () => onNav(s.cta.tab) : undefined}
                 role={clickable ? 'button' : undefined}
                 tabIndex={clickable ? 0 : undefined}
                 onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') onNav(s.cta.tab); } : undefined}>
              <span className="sp-step-icon">{s.icon}</span>
              <div className="sp-step-main">
                <div className="sp-step-title">{s.title}</div>
                <div className="sp-step-detail">{s.detail}</div>
              </div>
              {clickable && (
                <span className="sp-row-cta sp-row-cta-primary">{s.cta.label} →</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
