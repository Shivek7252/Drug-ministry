import React, { useState } from 'react';
import { createPortal } from 'react-dom';

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
}) {
  const [showAction, setShowAction] = useState(false);
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);

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
              {item.baseQuery ? item.baseQuery : (item.submissionRemark ? 'ok' : 'ok')}
            </div>
          </div>
          <div className="cl-field-row">
            <div className="cl-field-label">Previous Query/Remarks</div>
            <div className="cl-field-value">
              <textarea
                className="cl-textarea"
                readOnly
                value={item.previousQuery || 'ok'}
              />
            </div>
          </div>

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
