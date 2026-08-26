import React, { useCallback, useEffect, useState } from 'react';
import { getChecklist, raiseChecklistQuery, replyChecklistQuery } from '../../api/applicationService';
import { useApp } from '../../context/AppContext';
import QueryHistoryModal from './QueryHistoryModal';
import './NocChecklistPage.css';

/**
 * NocChecklistPage
 * Shared "Export NOC Check List Query Page" — used by both reviewer and applicant.
 *
 * Props
 *   applicationNumber — required
 *   role              — 'reviewer' | 'applicant' (drives which action button appears in the modal)
 *   currentUser       — display name written into the audit trail
 */
export default function NocChecklistPage({ applicationNumber, role = 'reviewer', currentUser }) {
  const { currentUser: ctxUser } = useApp();
  const actor = currentUser || ctxUser || (role === 'reviewer' ? 'reviewer' : 'applicant');
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [data, setData]             = useState(null);   // { applicationNumber, referenceNumber, status, checklist }
  const [activeItem, setActiveItem] = useState(null);   // checklist item shape
  const [busy, setBusy]             = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const res = await getChecklist(applicationNumber);
    if (res.success) {
      setData(res);
      // If the modal is open, refresh its item too
      if (activeItem) {
        const refreshed = findItemById(res.checklist, activeItem.itemId);
        if (refreshed) setActiveItem(refreshed);
      }
    } else {
      setError(res.error || 'Failed to load checklist.');
    }
    setLoading(false);
  }, [applicationNumber]); // eslint-disable-line

  useEffect(() => { load(); }, [load]);

  const handleRaiseQuery = async (queryText) => {
    if (!activeItem) return;
    setBusy(true);
    const res = await raiseChecklistQuery(applicationNumber, activeItem.itemId, {
      queryText,
      officer: actor,
    });
    setBusy(false);
    if (res.success) {
      setData(prev => ({ ...prev, checklist: res.checklist }));
      const refreshed = findItemById(res.checklist, activeItem.itemId);
      if (refreshed) setActiveItem(refreshed);
    } else {
      alert(res.error || 'Could not raise query.');
    }
  };

  const handleSubmitReply = async (reply, file) => {
    if (!activeItem) return;
    setBusy(true);
    const res = await replyChecklistQuery(applicationNumber, activeItem.itemId, {
      reply,
      applicant: actor,
      file,
    });
    setBusy(false);
    if (res.success) {
      setData(prev => ({ ...prev, checklist: res.checklist }));
      const refreshed = findItemById(res.checklist, activeItem.itemId);
      if (refreshed) setActiveItem(refreshed);
    } else {
      alert(res.error || 'Could not submit reply.');
    }
  };

  return (
    <div className="cl-page">
      <div className="cl-header">Export NOC Check List Query Page</div>

      {data && (
        <div className="cl-file-meta">
          <div><strong>File number : </strong>{data.referenceNumber || '—'}</div>
          <div><strong>CDSCO File number : </strong>{data.applicationNumber || '—'}</div>
          {data.checklist?.typeLabel && (
            <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 2 }}>
              <em>Detected flow: {data.checklist.typeLabel}</em>
            </div>
          )}
        </div>
      )}

      <div className="cl-note">
        <div className="cl-note-title">Note:</div>
        <ol>
          <li>Click on the checklist point to view documents against it. Please Review Atleast Those Checklist Items where Prevoius Status is Query.</li>
          <li>Query can be raised only five times in the life span of a file</li>
        </ol>
      </div>

      {!loading && !error && data && (() => {
        const allItems = flattenChecklistItems(data.checklist);
        const counts = { ok: 0, missing: 0, wrong: 0, unchecked: 0 };
        for (const it of allItems) {
          const s = it.docStatus || (it.submissionDocUrl ? 'ok' : 'missing');
          counts[s] = (counts[s] || 0) + 1;
        }
        const actionNeeded = counts.wrong + counts.missing;
        return (
          <div className={`cl-summary ${actionNeeded > 0 ? 'cl-summary-warn' : 'cl-summary-ok'}`}>
            <div className="cl-summary-headline">
              {actionNeeded > 0
                ? <>⚠ <strong>{actionNeeded}</strong> checklist item{actionNeeded !== 1 ? 's' : ''} need reviewer action</>
                : <>✅ All {allItems.length} checklist items have matching documents</>}
            </div>
            <div className="cl-summary-chips">
              <span className="cl-summary-chip cl-chip-ok">✓ OK: {counts.ok}</span>
              {counts.missing > 0   && <span className="cl-summary-chip cl-chip-missing">⚠ Missing: {counts.missing}</span>}
              {counts.wrong > 0     && <span className="cl-summary-chip cl-chip-wrong">✗ Wrong Doc: {counts.wrong}</span>}
              {counts.unchecked > 0 && <span className="cl-summary-chip cl-chip-unchecked">? Not Checked: {counts.unchecked}</span>}
            </div>
          </div>
        );
      })()}

      {loading && <div className="cl-loader">Loading checklist…</div>}
      {error && <div className="cl-error">⚠️ {error}</div>}

      {!loading && !error && data && (() => {
        const cl                = data.checklist;
        const preItems          = cl.preItems || cl.preSection4 || [];
        const mfgLicenseSection = cl.mfgLicenseSection || null;
        const historicalItem    = cl.historicalItem || null;
        const approvalSection   = cl.approvalSection || cl.section4 || null;
        const postItems         = cl.postItems || cl.postSection4 || [];

        /* Type 4: preItems holds items 1 & 2 only; historical is separate.
           Types 1-3: historical (if any) is already inside preItems. */
        return (
          <div className="cl-list">
            {/* Items 1 & 2 (and 3 for Types 1-3 which have flat mfg-license) */}
            {preItems.map(item => (
              <ChecklistRow key={item.itemId} item={item} onOpen={() => setActiveItem(item)} />
            ))}

            {/* Type 4: Copy of Manufacturing License section (parent + per-company) */}
            {mfgLicenseSection && mfgLicenseSection.companies.length > 0 && (
              <>
                <div className="cl-row cl-row-flat">
                  <span className="cl-check" style={{ opacity: 0 }}>✓</span>
                  <span className="cl-num">{mfgLicenseSection.itemNo} .</span>
                  <span className="cl-title">{mfgLicenseSection.title}</span>
                </div>
                <div className="cl-country-child">
                  {mfgLicenseSection.companies.map(item => (
                    <ChecklistRow key={item.itemId} item={item} onOpen={() => setActiveItem(item)} companyTag={item.company} />
                  ))}
                </div>
              </>
            )}

            {/* Type 4: historical row comes AFTER mfg-license section */}
            {historicalItem && mfgLicenseSection && (
              <ChecklistRow key={historicalItem.itemId} item={historicalItem} onOpen={() => setActiveItem(historicalItem)} />
            )}

            {/* Approval Status section: parent + per-country subgroups */}
            {approvalSection && approvalSection.countries.length > 0 && (
              <>
                <div className="cl-row cl-row-flat">
                  <span className="cl-check" style={{ opacity: 0 }}>✓</span>
                  <span className="cl-num">{approvalSection.itemNo} .</span>
                  <span className="cl-title">Approval Status in importing Country</span>
                </div>
                {approvalSection.countries.map(country => (
                  <div key={country.itemNo} className="cl-country-block">
                    <div className="cl-row cl-row-subhdr">
                      <span className="cl-check" style={{ opacity: 0 }}>✓</span>
                      <span>{country.itemNo}.Approval Status in importing Country({country.country})</span>
                    </div>
                    <div className="cl-country-child">
                      {country.subItems.map(item => (
                        <ChecklistRow key={item.itemId} item={item} onOpen={() => setActiveItem(item)} />
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}

            {/* Post-approval items (justification) */}
            {postItems.map(item => (
              <ChecklistRow key={item.itemId} item={item} onOpen={() => setActiveItem(item)} />
            ))}
          </div>
        );
      })()}

      {activeItem && (
        <QueryHistoryModal
          item={activeItem}
          role={role}
          maxRounds={data?.checklist?.maxRounds || 5}
          busy={busy}
          applicationDocs={data?.documents || {}}
          onClose={() => setActiveItem(null)}
          onRaiseQuery={handleRaiseQuery}
          onSubmitReply={handleSubmitReply}
        />
      )}
    </div>
  );
}

/* ── Row renderer ──────────────────────────────────────────────────────── */
function ChecklistRow({ item, onOpen, companyTag }) {
  const queryStatus = item.status || 'OK';
  // Derived doc status from backend (based on uploads + AI verdict).
  // 'ok' | 'missing' | 'wrong' | 'unchecked'
  const docStatus = item.docStatus || (item.submissionDocUrl ? 'ok' : 'missing');

  const cls =
    docStatus === 'wrong'   ? 'cl-row cl-row-wrong'   :
    docStatus === 'missing' ? 'cl-row cl-row-missing' :
    docStatus === 'unchecked' ? 'cl-row cl-row-unchecked' :
    'cl-row cl-row-ok';

  const icon =
    docStatus === 'wrong'   ? '✗' :
    docStatus === 'missing' ? '⚠' :
    docStatus === 'unchecked' ? '?' :
    '✓';

  const label =
    docStatus === 'wrong'   ? 'Wrong Doc' :
    docStatus === 'missing' ? 'Missing' :
    docStatus === 'unchecked' ? 'Not Checked' :
    'OK';

  return (
    <div className={cls} onClick={onOpen} role="button" tabIndex={0}
         onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onOpen(); }}>
      <span className="cl-check">{icon}</span>
      <span className="cl-num">{item.itemNo}</span>
      <span className="cl-title">
        {item.title}
        {companyTag && <span style={{ marginLeft: 6, color: '#64748b', fontSize: 12, fontStyle: 'italic', textDecoration: 'none' }}>— {companyTag}</span>}
        {item.matchedDoc?.matchType === 'fuzzy' && (
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
            matched: {item.matchedDoc.name}
          </div>
        )}
      </span>
      <span className="cl-status-group">
        {queryStatus === 'Query'            && <span className="cl-tag-open">Query</span>}
        {queryStatus === 'Query Replied OK' && <span className="cl-tag-replied">Query Replied</span>}
        <span className={`cl-doc-status cl-doc-status-${docStatus}`}>{label}</span>
      </span>
    </div>
  );
}

/* ── Helpers ──────────────────────────────────────────────────────────── */
function flattenChecklistItems(tree) {
  if (!tree) return [];
  const pre  = tree.preItems  || tree.preSection4  || [];
  const post = tree.postItems || tree.postSection4 || [];
  const approval = tree.approvalSection || tree.section4;
  const out = [...pre, ...post];
  if (tree.historicalItem)   out.push(tree.historicalItem);
  if (tree.mfgLicenseSection?.companies) out.push(...tree.mfgLicenseSection.companies);
  for (const c of (approval?.countries || [])) out.push(...(c.subItems || []));
  return out;
}

function findItemById(tree, itemId) {
  if (!tree) return null;
  const pre  = tree.preItems  || tree.preSection4  || [];
  const post = tree.postItems || tree.postSection4 || [];
  const approval = tree.approvalSection || tree.section4;
  const pools = [...pre, ...post];
  if (tree.historicalItem)   pools.push(tree.historicalItem);
  if (tree.mfgLicenseSection?.companies) pools.push(...tree.mfgLicenseSection.companies);
  for (const c of (approval?.countries || [])) {
    pools.push(...(c.subItems || []));
  }
  return pools.find(x => x.itemId === itemId) || null;
}
