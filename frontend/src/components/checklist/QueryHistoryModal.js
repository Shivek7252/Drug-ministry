import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { verifyChecklistFile } from '../../api/applicationService';

/**
 * QueryHistoryModal
 * Matches the reference CDSCO modal exactly:
 *   • Header: item number + title, close (x) at top-right
 *   • Blue "History" bar with the eye icon
 *   • Table: Query Version | Query | Query Date | Remarks/Reply | Reply Date | Uploaded document
 *   • Below the table: Remarks/Reply | View Uploaded File | Base Query/Remarks | Previous Query/Remarks
 *   • Footer: Close + optional (reviewer) "Raise Query" / (applicant) "Submit Reply" buttons
 *
 * Props
 *   item           — the checklist item shape returned by the backend
 *   role           — 'reviewer' | 'applicant'
 *   maxRounds      — hard cap (default 5)
 *   onClose()
 *   onRaiseQuery(queryText)      — reviewer only
 *   onSubmitReply(replyText, file) — applicant only
 *   busy           — bool, disables buttons during API call
 */
export default function QueryHistoryModal({
  item,
  role = 'reviewer',
  maxRounds = 5,
  onClose,
  onRaiseQuery,
  onSubmitReply,
  busy = false,
  applicationDocs = {},
}) {
  const [showAction, setShowAction] = useState(false);
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);

  // AI verify state — keyed by 'submission' or `reply-<version>`
  const [verifyOpen, setVerifyOpen]   = useState(false);
  const [verifyTarget, setVerifyTarget] = useState('submission');
  const [verifyBusy, setVerifyBusy]   = useState(false);
  const [verifyData, setVerifyData]   = useState({}); // { [key]: { status, results, summary, error } }
  const [expandedItems, setExpandedItems] = useState(true);

  if (!item) return null;

  const queries = item.queries || [];
  const roundsUsed = queries.length;
  const openRound  = queries.find(q => !q.reply);
  const lastRound  = queries[queries.length - 1];
  const latestReply = lastRound?.reply || item.submissionRemark || '';
  const latestReplyDocUrl = lastRound?.replyDocUrl || item.submissionDocUrl || '';
  const latestReplyDocLabel = lastRound?.replyDocName
    ? lastRound.replyDocName
    : item.submissionDocName || 'View_File';

  // Reviewer can raise a query only if no round is open and rounds < max
  const canRaise = role === 'reviewer' && !openRound && roundsUsed < maxRounds;
  // Applicant can reply only if there is an open round
  const canReply = role === 'applicant' && !!openRound;

  const startCompose = () => { setShowAction(true); setText(''); setFile(null); };
  const cancelCompose = () => { setShowAction(false); setText(''); setFile(null); };

  const submit = async () => {
    if (!text.trim()) return;
    if (role === 'reviewer') {
      await onRaiseQuery?.(text.trim());
    } else {
      await onSubmitReply?.(text.trim(), file);
    }
    setShowAction(false);
    setText('');
    setFile(null);
  };

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { year:'numeric', month:'2-digit', day:'2-digit' }) : '';

  /* AI verify targets available for this item — always at least "submission"
     if a file exists; each replied round with an attached doc is another target. */
  const verifyTargets = [];
  if (item.submissionDocUrl) {
    verifyTargets.push({
      key: 'submission',
      label: `At submission — ${item.submissionDocName || 'file'}`,
      fileUrl: item.submissionDocUrl,
      fileName: item.submissionDocName || 'submission.pdf',
    });
  }
  for (const q of queries) {
    if (q.replyDocUrl) {
      verifyTargets.push({
        key: `reply-${q.version}`,
        label: `Reply v${q.version} — ${q.replyDocName || 'file'}`,
        fileUrl: q.replyDocUrl,
        fileName: q.replyDocName || `reply-v${q.version}.pdf`,
      });
    }
  }

  const runVerify = async () => {
    const tgt = verifyTargets.find(t => t.key === verifyTarget) || verifyTargets[0];
    if (!tgt) return;
    setVerifyBusy(true);
    setVerifyData(prev => ({ ...prev, [tgt.key]: { status: 'loading' } }));
    const res = await verifyChecklistFile({
      fileUrl:  tgt.fileUrl,
      itemId:   item.itemId,
      docLabel: item.title,
      fileName: tgt.fileName,
    });
    setVerifyBusy(false);
    if (res.success) {
      setVerifyData(prev => ({
        ...prev,
        [tgt.key]: {
          status:              'done',
          docType:             res.docType,
          results:             res.results || [],
          summary:             res.summary || null,
          documentTypeMatch:   res.documentTypeMatch,
          documentTypeReason:  res.documentTypeReason || '',
          textSource:          res.textSource || 'unknown',
        },
      }));
    } else {
      setVerifyData(prev => ({ ...prev, [tgt.key]: { status: 'error', error: res.error || 'Verification failed.' } }));
    }
  };

  const currentVerify = verifyData[verifyTarget];

  return createPortal(
    <div className="cl-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="cl-modal" role="dialog" aria-modal="true">
        {/* Header */}
        <div className="cl-modal-header">
          <div className="cl-modal-title">
            {item.itemNo}. {item.title}
            <span className="cl-rounds-badge" title="Query rounds used / maximum">
              {roundsUsed}/{maxRounds}
            </span>
          </div>
          <button className="cl-modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        {/* Body */}
        <div className="cl-modal-body">
          {/* Item-specific document panel: the ONE upload that matches this
              checklist item, with a big status badge. This is what tells
              the reviewer whether they need to raise a query. */}
          <ItemDocPanel item={item} role={role} />

          {/* Blue history bar */}
          <div className="cl-history-title">
            <span>History</span>
            <button className="cl-history-eye" title="Query trail" aria-label="History">
              <span style={{ fontSize: 12 }}>👁</span>
            </button>
          </div>

          {/* History table */}
          <table className="cl-history-table">
            <thead>
              <tr>
                <th style={{ width: 90 }}>Query<br/>Version</th>
                <th>Query</th>
                <th style={{ width: 90 }}>Query<br/>Date</th>
                <th>Remarks/Reply</th>
                <th style={{ width: 90 }}>Reply<br/>Date</th>
                <th style={{ width: 130 }}>Uploaded<br/>document</th>
              </tr>
            </thead>
            <tbody>
              {/* Row 0: "At Time Of Submission" */}
              <tr>
                <td className="cl-cell-center">At Time Of Submission</td>
                <td className="cl-cell-none">—</td>
                <td className="cl-cell-none">—</td>
                <td>{item.submissionRemark || <span className="cl-cell-none">NA</span>}</td>
                <td className="cl-cell-none">—</td>
                <td>
                  {item.submissionDocUrl
                    ? <a className="cl-view-file" href={item.submissionDocUrl} target="_blank" rel="noreferrer">View_File</a>
                    : <span className="cl-cell-none">—</span>}
                </td>
              </tr>
              {/* One row per query round */}
              {queries.map((q) => (
                <tr key={q.version}>
                  <td className="cl-cell-center">{q.version}</td>
                  <td>{q.queryText}</td>
                  <td>{fmtDate(q.queryDate)}</td>
                  <td>
                    {q.reply
                      ? q.reply
                      : <span className="cl-cell-none">Awaiting reply…</span>}
                  </td>
                  <td>{q.reply ? fmtDate(q.replyDate) : <span className="cl-cell-none">—</span>}</td>
                  <td>
                    {q.replyDocUrl
                      ? <a className="cl-view-file" href={q.replyDocUrl} target="_blank" rel="noreferrer">View_File</a>
                      : (q.reply ? <span className="cl-cell-none">Not Submitted</span> : <span className="cl-cell-none">—</span>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Field rows */}
          <div className="cl-field-row">
            <div className="cl-field-label">Remarks /Reply</div>
            <div className="cl-field-value">
              <strong>{latestReply || '—'}</strong>
            </div>
          </div>
          <div className="cl-field-row">
            <div className="cl-field-label">View Uploaded File</div>
            <div className="cl-field-value">
              {latestReplyDocUrl
                ? <a className="cl-view-file" href={latestReplyDocUrl} target="_blank" rel="noreferrer">{latestReplyDocLabel}</a>
                : '—'}
            </div>
          </div>
          <div className="cl-field-row">
            <div className="cl-field-label">Base Query/Remarks</div>
            <div className="cl-field-value cl-base-query">
              {item.baseQuery || <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>No query raised yet</span>}
            </div>
          </div>
          <div className="cl-field-row">
            <div className="cl-field-label">Previous Query/Remarks</div>
            <div className="cl-field-value">
              <textarea
                className="cl-textarea"
                readOnly
                placeholder="No previous query on this item."
                value={item.previousQuery || ''}
              />
            </div>
          </div>

          {/* Application-level uploaded documents (with AI verdict badges).
              Shown for every checklist item — the reviewer needs quick access
              to all uploaded docs regardless of which item they clicked. */}
          <ApplicationDocsPanel
            docs={applicationDocs}
            emptyHint={role === 'reviewer'
              ? 'The applicant has not uploaded any documents yet. Raise a query below to request them.'
              : 'You have not uploaded any documents yet.'}
          />

          {/* AI Verify panel */}
          {verifyTargets.length > 0 && (
            <div className="cl-verify">
              <div className="cl-verify-header">
                <div className="cl-verify-title">
                  <span>🤖</span>
                  <span>AI Document Verifier</span>
                </div>
                <button
                  className="cl-btn cl-btn-cancel"
                  style={{ padding: '3px 10px', fontSize: 12 }}
                  onClick={() => setVerifyOpen(o => !o)}
                >
                  {verifyOpen ? '▲ Hide' : '▼ Show'}
                </button>
              </div>
              {verifyOpen && (
                <div className="cl-verify-body">
                  <div className="cl-verify-controls">
                    <label>Verify:&nbsp;</label>
                    <select
                      className="cl-verify-select"
                      value={verifyTarget}
                      onChange={e => setVerifyTarget(e.target.value)}
                      disabled={verifyBusy}
                    >
                      {verifyTargets.map(t => (
                        <option key={t.key} value={t.key}>{t.label}</option>
                      ))}
                    </select>
                    <button
                      className="cl-btn cl-btn-primary"
                      style={{ padding: '4px 12px', fontSize: 12 }}
                      onClick={runVerify}
                      disabled={verifyBusy}
                    >
                      {verifyBusy ? '⏳ Analysing…' : (currentVerify?.status === 'done' ? '↻ Re-verify' : '🔍 Verify')}
                    </button>
                  </div>

                  {currentVerify?.status === 'loading' && (
                    <div className="cl-verify-loading">Extracting text + running AI checklist…</div>
                  )}
                  {currentVerify?.status === 'error' && (
                    <div className="cl-verify-error">⚠️ {currentVerify.error}</div>
                  )}
                  {currentVerify?.status === 'done' && (
                    <>
                      {/* Score summary */}
                      <div className="cl-verify-summary">
                        <div className={`cl-verify-score-badge ${
                          (currentVerify.summary?.score ?? 0) >= 75 ? 'ok'
                          : (currentVerify.summary?.score ?? 0) >= 50 ? 'warn'
                          : 'bad'}`}>
                          {currentVerify.summary?.score ?? 0}%
                        </div>
                        <div className="cl-verify-summary-text">
                          <div className="cl-verify-summary-line">
                            ✓ <strong>{currentVerify.summary?.present ?? 0}</strong> found
                            &nbsp;·&nbsp;
                            ✗ <strong>{currentVerify.summary?.missing ?? 0}</strong> missing
                            {(currentVerify.summary?.unknown ?? 0) > 0 && (
                              <>&nbsp;·&nbsp; ? <strong>{currentVerify.summary.unknown}</strong> unknown</>
                            )}
                          </div>
                          <div className="cl-verify-summary-sub">
                            docType: <code>{currentVerify.docType}</code>
                            {currentVerify.textSource && (
                              <>&nbsp;·&nbsp;text source: <code>{currentVerify.textSource}</code></>
                            )}
                          </div>
                          {currentVerify.documentTypeMatch === false && (
                            <div className="cl-verify-mismatch">
                              🚫 Document-type mismatch: {currentVerify.documentTypeReason || 'The uploaded file does not look like the expected type.'}
                            </div>
                          )}
                        </div>
                        <button
                          className="cl-verify-collapse-btn"
                          onClick={() => setExpandedItems(v => !v)}
                          title={expandedItems ? 'Collapse details' : 'Expand details'}
                        >{expandedItems ? '▲' : '▼'}</button>
                      </div>

                      {/* Per-parameter list */}
                      {expandedItems && (
                        <div className="cl-verify-items">
                          {currentVerify.results.map((r, i) => {
                            const yes = r.present === true;
                            const no  = r.present === false;
                            return (
                              <div key={i} className={`cl-verify-item ${yes ? 'yes' : no ? 'no' : 'unk'}`}>
                                <span className="cl-verify-item-icon">{yes ? '✅' : no ? '❌' : '❓'}</span>
                                <div className="cl-verify-item-body">
                                  <div className="cl-verify-item-label">{r.item}</div>
                                  {yes && r.evidence && (
                                    <div className="cl-verify-item-evidence">
                                      📍 {typeof r.page === 'number' ? `Page ${r.page}: ` : ''}"{r.evidence}"
                                    </div>
                                  )}
                                  {r.note && <div className="cl-verify-item-note">{r.note}</div>}
                                </div>
                                <span className={`cl-badge ${yes ? 'cl-badge-yes' : no ? 'cl-badge-no' : 'cl-badge-unk'}`}>
                                  {yes ? 'YES' : no ? 'NO' : '?'}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                  {!currentVerify && (
                    <div className="cl-verify-hint">
                      Runs the CDSCO AI verifier against this document — will report which required parameters are present, with page + evidence for each. Uses text extraction + OCR fallback.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Compose panel */}
          {showAction && (
            <div className="cl-action-panel">
              <div className="cl-action-panel-title">
                {role === 'reviewer' ? 'Raise a new query' : 'Submit reply'}
              </div>
              <div className="cl-action-panel-hint">
                {role === 'reviewer'
                  ? `Round ${roundsUsed + 1} of ${maxRounds}. The applicant will see this and can reply once.`
                  : `Replying to round ${openRound?.version}. You may attach a supporting document.`}
              </div>
              <textarea
                className="cl-textarea"
                rows={4}
                autoFocus
                placeholder={role === 'reviewer'
                  ? 'Enter query text — e.g. Firm need to submit importing Country registration certificate…'
                  : 'Enter your reply — e.g. Respected Officer, please find attached the NRA certificate…'}
                value={text}
                onChange={e => setText(e.target.value)}
              />
              {role === 'applicant' && (
                <div className="cl-file-input">
                  <label>Attach document (optional):</label>
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={e => setFile(e.target.files?.[0] || null)}
                  />
                  {file && <span style={{ color: '#15803d', fontSize: 11.5 }}>✓ {file.name}</span>}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="cl-modal-footer">
          {!showAction && canRaise && (
            <button className="cl-btn cl-btn-warn" onClick={startCompose} disabled={busy}>
              ❓ Raise Query
            </button>
          )}
          {!showAction && canReply && (
            <button className="cl-btn cl-btn-primary" onClick={startCompose} disabled={busy}>
              ✎ Submit Reply
            </button>
          )}
          {showAction && (
            <>
              <button className="cl-btn cl-btn-cancel" onClick={cancelCompose} disabled={busy}>Cancel</button>
              <button
                className={role === 'reviewer' ? 'cl-btn cl-btn-warn' : 'cl-btn cl-btn-primary'}
                onClick={submit}
                disabled={busy || !text.trim()}
              >
                {busy ? '⏳ Saving…' : role === 'reviewer' ? '❓ Send Query' : '✓ Send Reply'}
              </button>
            </>
          )}
          <button className="cl-btn cl-btn-close" onClick={onClose}>✕ Close</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ── Item-specific document panel ────────────────────────────────────────
   Shows THIS checklist item's matched upload (via exact docId or fuzzy
   filename match) with a big verdict badge. Answers the reviewer's core
   question at a glance: "is this checklist item satisfied?" */
function ItemDocPanel({ item, role }) {
  const status = item.docStatus || (item.submissionDocUrl ? 'ok' : 'missing');
  const matched = item.matchedDoc || null;
  const url = matched?.objectUrl || item.submissionDocUrl || '';

  const statusText =
    status === 'wrong'     ? 'Wrong Document Uploaded' :
    status === 'missing'   ? 'No Document Uploaded' :
    status === 'unchecked' ? 'Document Uploaded — AI Check Pending' :
    'Correct Document Uploaded';

  const guidance =
    status === 'wrong'
      ? (role === 'reviewer'
          ? 'Raise a query below asking the applicant to upload the correct document for this checklist item.'
          : 'The reviewer flagged this upload as wrong. Please re-upload the correct document.')
      : status === 'missing'
      ? (role === 'reviewer'
          ? 'The applicant has not uploaded any document matching this checklist item. Raise a query below to request it.'
          : 'No document has been uploaded for this checklist item yet.')
      : status === 'unchecked'
      ? 'A document is attached but the AI type-check has not run yet.'
      : 'The AI verified this upload matches the expected document type.';

  return (
    <div className={`cl-item-doc cl-item-doc-${status}`}>
      <div className="cl-item-doc-header">
        <span className="cl-item-doc-icon">
          {status === 'ok' ? '✅' : status === 'wrong' ? '🚫' : status === 'unchecked' ? '⏳' : '⚠️'}
        </span>
        <div className="cl-item-doc-title">
          <div className="cl-item-doc-status">{statusText}</div>
          <div className="cl-item-doc-guidance">{guidance}</div>
        </div>
      </div>

      {matched && (
        <div className="cl-item-doc-file">
          <div className="cl-item-doc-filename">
            📄 <strong>{matched.name}</strong>
            {matched.matchType === 'fuzzy' && (
              <span className="cl-item-doc-fuzzy" title="Matched by filename keywords (applicant uploaded to a different slot)">
                fuzzy match
              </span>
            )}
          </div>
          {status === 'wrong' && matched.validationResult?.documentTypeReason && (
            <div className="cl-item-doc-reason">
              <strong>AI reason:</strong> {matched.validationResult.documentTypeReason}
            </div>
          )}
          {url && (
            <a className="cl-item-doc-view" href={url} target="_blank" rel="noreferrer">
              👁 Open Document
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Application documents panel — all uploaded docs with AI verdict badges ─
   Rendered inside every checklist modal so the reviewer always has quick
   access to the applicant's uploads, even for checklist items that don't
   map to a specific upload slot. */
function ApplicationDocsPanel({ docs, emptyHint }) {
  const entries = Object.entries(docs || {});

  return (
    <div className="cl-app-docs">
      <div className="cl-app-docs-title">
        📎 Application Documents
        <span className="cl-app-docs-count">{entries.length} uploaded</span>
      </div>

      {entries.length === 0 ? (
        <div className="cl-app-docs-empty">{emptyHint}</div>
      ) : (
        <div className="cl-app-docs-list">
          {entries.map(([docId, d]) => {
            const vr = d.validationResult || {};
            const verdict = typeof vr.documentTypeMatch === 'boolean'
              ? (vr.documentTypeMatch ? 'ok' : 'bad')
              : null;
            return (
              <div key={docId} className={`cl-app-doc ${verdict === 'ok' ? 'ok' : verdict === 'bad' ? 'bad' : ''}`}>
                <span className="cl-app-doc-slot">{docId}</span>
                <div className="cl-app-doc-body">
                  <div className="cl-app-doc-name" title={d.name}>{d.name || '—'}</div>
                  {verdict === 'bad' && vr.documentTypeReason && (
                    <div className="cl-app-doc-reason">⚠ {vr.documentTypeReason}</div>
                  )}
                </div>
                {verdict === 'ok' && <span className="cl-app-doc-badge ok">✓ AI: Correct</span>}
                {verdict === 'bad' && <span className="cl-app-doc-badge bad">✗ AI: Wrong Doc</span>}
                {verdict === null && <span className="cl-app-doc-badge unk">? Not Checked</span>}
                {d.objectUrl && (
                  <a
                    className="cl-app-doc-view"
                    href={d.objectUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    👁 View
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
