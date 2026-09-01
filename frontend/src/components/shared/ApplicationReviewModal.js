import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getApplicationReviewSnapshot, submitUnderReview } from '../../api/applicationService';
import './ApplicationReviewModal.css';

/* ============================================================
   ApplicationReviewModal

   Marks the WHOLE application Under Review. The snapshot is generated on the
   server from the stored record, covering compliance, documents, products,
   shipments and query history — it is not scoped to any one document, and it
   never raises a query or touches the document-query workflow.

   The observation table is internal to reviewers. The only applicant-visible
   text is the separate "Message to Applicant" field below it.
   ============================================================ */

const MAX_TEXT = 2000;
const MAX_MESSAGE = 1200;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp('[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]', 'g');

const REVIEW_AREAS = ['Application', 'Document', 'Product', 'Shipment', 'Compliance', 'Query'];

function sanitizeInput(value, limit = MAX_TEXT) {
  return String(value == null ? '' : value).replace(CONTROL_CHARS, ' ').slice(0, limit);
}

let rowSeq = 0;
const nextRowKey = () => `arm-${rowSeq += 1}`;

function newSubmissionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `rev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function blankRow() {
  return {
    rowKey: nextRowKey(),
    area: 'Application',
    item: '',
    entityId: '',
    severity: 'medium',
    aiObservation: '',
    aiNote: '',
    note: '',
    rowSource: 'reviewer_added',
  };
}

function toRows(rows) {
  return (rows || []).map(row => ({
    rowKey: nextRowKey(),
    area: REVIEW_AREAS.includes(row.area) ? row.area : 'Application',
    item: row.item || '',
    entityId: row.entityId || '',
    severity: row.severity || 'medium',
    aiObservation: row.aiObservation || '',
    aiNote: row.aiNote || '',
    note: row.note || '',
    rowSource: row.rowSource === 'reviewer_added' ? 'reviewer_added' : 'ai_generated',
  }));
}

function SourceTag({ row }) {
  const ai = row.rowSource === 'ai_generated';
  const edited = ai && !!row.aiNote && row.note.trim() !== row.aiNote.trim();
  return (
    <span className={`arm-source arm-source-${ai ? 'ai' : 'reviewer'}`}>
      {ai ? 'AI Generated' : 'Added by Reviewer'}
      {edited && <em className="arm-source-edited">edited</em>}
    </span>
  );
}

function Metrics({ metrics }) {
  if (!metrics) return null;
  const tiles = [
    ['Compliance', metrics.compliancePercent == null ? '—' : `${metrics.compliancePercent}%`,
      metrics.complianceTotal ? `${metrics.complianceComplete}/${metrics.complianceTotal} checklist items OK` : 'Checklist unavailable'],
    ['Documents', `${metrics.documentsUploaded}`, 'uploaded'],
    ['AI verified', `${metrics.aiVerified}`, 'matching their expected type'],
    ['AI flagged', `${metrics.aiFlagged}`, metrics.aiFlagged ? 'need reviewer attention' : 'no misclassified uploads'],
    ['Shipments', `${metrics.shipments}`, 'consignment lines'],
    ['Open queries', `${metrics.openQueries}`, 'awaiting applicant response'],
  ];
  return (
    <dl className="arm-metrics">
      {tiles.map(([label, value, hint]) => (
        <div key={label} className={label === 'AI flagged' && metrics.aiFlagged > 0 ? 'arm-metric-alert' : undefined}>
          <dt>{label}</dt>
          <dd>{value}</dd>
          <small>{hint}</small>
        </div>
      ))}
    </dl>
  );
}

function SkeletonRows() {
  return (
    <div className="arm-skeleton" aria-hidden="true">
      {[0, 1, 2].map(i => (
        <div className="arm-skeleton-row" key={i}>
          <span className="arm-skeleton-bar arm-w-sm" />
          <span className="arm-skeleton-bar arm-w-md" />
          <span className="arm-skeleton-bar arm-w-lg" />
        </div>
      ))}
    </div>
  );
}

export default function ApplicationReviewModal({ appNumber, onClose, onCompleted }) {
  const [phase, setPhase] = useState('loading');       // loading | ready | error
  const [snapshotError, setSnapshotError] = useState('');
  const [application, setApplication] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [transition, setTransition] = useState(null);
  const [existingReview, setExistingReview] = useState(null);
  const [rows, setRows] = useState([]);
  const [applicantMessage, setApplicantMessage] = useState('');
  const [rowErrors, setRowErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const firstFieldRef = useRef(null);
  // One id per modal session, so a retried click resolves to the first record.
  const submissionId = useRef(newSubmissionId()).current;
  const titleId = useRef(`arm-title-${Math.random().toString(36).slice(2, 8)}`).current;

  const loadSnapshot = useCallback(async () => {
    setPhase('loading');
    setSnapshotError('');
    const res = await getApplicationReviewSnapshot(appNumber);
    if (res.aborted) return;
    if (!res.success) {
      setSnapshotError(res.error || 'The review snapshot could not be generated.');
      // The reviewer can still record an observation by hand.
      setRows(current => (current.length ? current : []));
      setApplicantMessage(current => current || '');
      setPhase('error');
      return;
    }
    setApplication(res.application || null);
    setMetrics(res.metrics || null);
    setTransition(res.transition || null);
    setExistingReview(res.existingReview || null);
    setRows(toRows(res.rows));
    setApplicantMessage(res.applicantMessage || '');
    setPhase('ready');
  }, [appNumber]);

  useEffect(() => { loadSnapshot(); }, [loadSnapshot]);

  useEffect(() => {
    const onKeyDown = e => { if (e.key === 'Escape' && !submitting) onClose?.(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, submitting]);

  useEffect(() => { if (phase === 'ready') firstFieldRef.current?.focus(); }, [phase]);

  const patchRow = (rowKey, patch) => {
    setRows(current => current.map(row => (row.rowKey === rowKey ? { ...row, ...patch } : row)));
    setRowErrors(current => {
      if (!current[rowKey]) return current;
      const next = { ...current };
      delete next[rowKey];
      return next;
    });
    setFormError('');
  };

  const addRow = () => { setRows(current => [...current, blankRow()]); setFormError(''); };

  const deleteRow = rowKey => {
    setRows(current => current.filter(row => row.rowKey !== rowKey));
    setRowErrors(current => {
      const next = { ...current };
      delete next[rowKey];
      return next;
    });
    setFormError('');
  };

  /* Mirrors the server rule; the server re-validates regardless. An empty
     table is valid — a clean application needs no observations. */
  const validate = candidateRows => {
    const retained = candidateRows.filter(row => !(
      row.rowSource === 'reviewer_added' && !row.note.trim() && !row.item.trim() && !row.aiObservation.trim()
    ));
    const errors = {};
    retained.forEach(row => {
      if (!row.note.trim()) errors[row.rowKey] = 'Enter a reviewer note or next action for this observation.';
    });
    return { retained, errors };
  };

  const handleSubmit = async () => {
    if (submitting) return;
    const { retained, errors } = validate(rows);
    if (Object.keys(errors).length) {
      setRowErrors(errors);
      return;
    }
    setRowErrors({});
    setFormError('');
    setSubmitting(true);
    const res = await submitUnderReview(appNumber, {
      submissionId,
      applicantMessage: applicantMessage.trim(),
      rows: retained.map(row => ({
        rowKey: row.rowKey,
        area: row.area,
        item: row.item.trim(),
        entityId: row.entityId,
        severity: row.severity,
        aiObservation: row.aiObservation,
        aiNote: row.aiNote,
        note: row.note.trim(),
        rowSource: row.rowSource,
      })),
    });
    setSubmitting(false);
    if (!res.success) {
      if (res.rowErrors) setRowErrors(res.rowErrors);
      else setFormError(res.error || 'The application could not be marked Under Review.');
      return;
    }
    onCompleted?.({
      status: res.status,
      duplicate: !!res.duplicate,
      statusChanged: res.statusChanged !== false,
      rowCount: retained.length,
    });
  };

  const blocked = transition && transition.allowed === false;
  const fmtDate = value => (value
    ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—');

  const header = [
    ['Application number', application?.applicationNumber || appNumber],
    ['Applicant / company', application?.applicant || '—'],
    ['Submitted', fmtDate(application?.submittedAt)],
    ['Current status', application?.currentStatus || '—'],
  ];

  return createPortal(
    <div
      className="arm-backdrop"
      onMouseDown={e => { if (e.target === e.currentTarget && !submitting) onClose?.(); }}
    >
      <div className="arm-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="arm-header">
          <div>
            <h2 id={titleId}>Mark Application as Under Review</h2>
            <p>
              These observations are internal to reviewers. Only the message at the bottom
              reaches the applicant. Raising a query is a separate action.
            </p>
          </div>
          <button
            type="button" className="arm-close" onClick={onClose}
            disabled={submitting} aria-label="Close review dialog"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>

        <dl className="arm-context">
          {header.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>

        <div className="arm-body">
          {phase === 'loading' && (
            <div className="arm-loading" role="status" aria-live="polite">
              <p>Building the review snapshot from this application&rsquo;s stored record&hellip;</p>
              <SkeletonRows />
            </div>
          )}

          {phase === 'error' && (
            <div className="arm-alert arm-alert-error" role="alert">
              <p><strong>The review snapshot could not be generated.</strong></p>
              <p>{snapshotError}</p>
              <p>You can retry, or continue and record an observation manually.</p>
              <button type="button" className="arm-btn arm-btn-neutral" onClick={loadSnapshot}>Retry</button>
            </div>
          )}

          {phase === 'ready' && blocked && (
            <div className="arm-alert arm-alert-error" role="alert">
              <p><strong>This application cannot be moved to Under Review.</strong></p>
              <p>{transition.reason}</p>
            </div>
          )}

          {phase === 'ready' && transition?.alreadyUnderReview && (
            <div className="arm-alert arm-alert-info">
              <p>
                This application is already <strong>{application?.currentStatus}</strong>.
                {existingReview
                  ? ` The notes below are the ${existingReview.rowCount} observation${existingReview.rowCount === 1 ? '' : 's'} recorded by ${existingReview.reviewer} on ${fmtDate(existingReview.reviewedAt)}.`
                  : ' Submitting will update the internal review notes.'}
                {' '}No second status change will be recorded.
              </p>
            </div>
          )}

          {phase !== 'loading' && <Metrics metrics={metrics} />}

          {phase !== 'loading' && (
            <>
              <h3 className="arm-section-title">
                Internal review observations
                <span className="arm-internal-tag">Not shown to the applicant</span>
              </h3>

              {rows.length === 0 ? (
                <p className="arm-empty">
                  No significant exceptions were identified. You may add an internal review note if required.
                </p>
              ) : (
                <table className="arm-table">
                  <caption className="arm-visually-hidden">
                    Internal review observations for {application?.applicationNumber || appNumber}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col" className="arm-col-sr">Sr. No.</th>
                      <th scope="col" className="arm-col-area">Review Area</th>
                      <th scope="col" className="arm-col-item">Item</th>
                      <th scope="col" className="arm-col-obs">AI Observation</th>
                      <th scope="col" className="arm-col-note">Reviewer Note / Next Action</th>
                      <th scope="col" className="arm-col-source">Source</th>
                      <th scope="col" className="arm-col-actions">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => {
                      const error = rowErrors[row.rowKey];
                      const fieldId = `arm-note-${row.rowKey}`;
                      const errorId = `${fieldId}-error`;
                      return (
                        <tr
                          key={row.rowKey}
                          className={`arm-row arm-row-${row.rowSource === 'ai_generated' ? 'ai' : 'manual'}${error ? ' arm-row-invalid' : ''}`}
                        >
                          <td data-label="Sr. No." className="arm-col-sr">{index + 1}</td>
                          <td data-label="Review Area" className="arm-col-area">
                            {row.rowSource === 'ai_generated' ? (
                              <span className={`arm-area arm-sev-${row.severity}`}>{row.area}</span>
                            ) : (
                              <>
                                <label className="arm-visually-hidden" htmlFor={`arm-area-${row.rowKey}`}>
                                  Review area for observation {index + 1}
                                </label>
                                <select
                                  id={`arm-area-${row.rowKey}`}
                                  className="arm-select"
                                  value={row.area}
                                  onChange={e => patchRow(row.rowKey, { area: e.target.value })}
                                >
                                  {REVIEW_AREAS.map(area => <option key={area} value={area}>{area}</option>)}
                                </select>
                              </>
                            )}
                          </td>
                          <td data-label="Item" className="arm-col-item">
                            {row.rowSource === 'ai_generated' ? (
                              <span>{row.item || '—'}</span>
                            ) : (
                              <input
                                type="text"
                                className="arm-input"
                                value={row.item}
                                placeholder="Field, document or item"
                                aria-label={`Item for observation ${index + 1}`}
                                onChange={e => patchRow(row.rowKey, { item: sanitizeInput(e.target.value) })}
                              />
                            )}
                          </td>
                          <td data-label="AI Observation" className="arm-col-obs">
                            {row.aiObservation
                              ? <span>{row.aiObservation}</span>
                              : <span className="arm-muted">No AI finding — added by reviewer</span>}
                          </td>
                          <td data-label="Reviewer Note / Next Action" className="arm-col-note">
                            <label className="arm-visually-hidden" htmlFor={fieldId}>
                              Reviewer note or next action for observation {index + 1}
                            </label>
                            <textarea
                              id={fieldId}
                              ref={index === 0 ? firstFieldRef : undefined}
                              className={`arm-textarea${error ? ' arm-invalid' : ''}`}
                              value={row.note}
                              rows={3}
                              maxLength={MAX_TEXT}
                              aria-invalid={error ? 'true' : undefined}
                              aria-describedby={error ? errorId : undefined}
                              placeholder="What the reviewer should do about this"
                              onChange={e => patchRow(row.rowKey, { note: sanitizeInput(e.target.value) })}
                            />
                            {error && <p className="arm-row-error" id={errorId} role="alert">{error}</p>}
                          </td>
                          <td data-label="Source" className="arm-col-source"><SourceTag row={row} /></td>
                          <td data-label="Actions" className="arm-col-actions">
                            <button
                              type="button"
                              className="arm-delete"
                              onClick={() => deleteRow(row.rowKey)}
                              aria-label={`Delete observation ${index + 1}`}
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}

              <button type="button" className="arm-btn arm-btn-ghost arm-add" onClick={addRow}>
                + Add Observation
              </button>

              <div className="arm-message">
                <label htmlFor="arm-applicant-message">
                  Message to Applicant
                  <span className="arm-applicant-tag">Visible to the applicant</span>
                </label>
                <p className="arm-message-hint">
                  Keep this neutral. Internal observations, AI findings and verification evidence
                  must not appear here. If a correction is needed, raise a query instead.
                </p>
                <textarea
                  id="arm-applicant-message"
                  className="arm-textarea arm-message-box"
                  rows={3}
                  maxLength={MAX_MESSAGE}
                  value={applicantMessage}
                  onChange={e => setApplicantMessage(sanitizeInput(e.target.value, MAX_MESSAGE))}
                />
              </div>
            </>
          )}
        </div>

        <footer className="arm-footer">
          <div className="arm-footer-msg" aria-live="polite">
            {formError && <span className="arm-form-error" role="alert">{formError}</span>}
            {!formError && phase !== 'loading' && (
              <span>
                {rows.length === 0
                  ? 'No internal observations recorded.'
                  : `${rows.length} internal observation${rows.length === 1 ? '' : 's'} will be saved.`}
              </span>
            )}
          </div>
          <div className="arm-footer-actions">
            <button type="button" className="arm-btn arm-btn-neutral" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button
              type="button"
              className="arm-btn arm-btn-primary"
              onClick={handleSubmit}
              disabled={submitting || phase === 'loading' || blocked}
            >
              {submitting ? 'Submitting…' : 'Mark as Under Review'}
            </button>
          </div>
        </footer>
      </div>
    </div>,
    typeof document !== 'undefined' ? document.body : null
  );
}
