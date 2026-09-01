import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getDocumentQueryDraft, submitDocumentQuery } from '../../api/applicationService';
import './DocumentQueryModal.css';

/* ============================================================
   DocumentQueryModal

   Raise a query about ONE uploaded document, from that document's own AI
   verification findings. Scoping is enforced by address, not by filtering:
   the draft is fetched for a single stable `docId`, and every row submits
   back to the same `docId`. Nothing in this component can read another
   document's results.

   The application-level Query flow (review page / checklist page) is a
   separate path and is untouched.
   ============================================================ */

const MAX_TEXT = 2000;

/* Control characters would corrupt the stored row and any later export.
   Matching them is the point, so the rule is disabled deliberately. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp('[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]', 'g');

function sanitizeInput(value) {
  return String(value == null ? '' : value).replace(CONTROL_CHARS, ' ').slice(0, MAX_TEXT);
}

let rowSeq = 0;
function nextRowKey() {
  rowSeq += 1;
  return `qr-${rowSeq}`;
}

function newSubmissionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `sub-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function blankRow() {
  return {
    rowKey: nextRowKey(),
    checklistItem: '',
    deficiency: '',
    aiQueryText: '',
    queryText: '',
    rowSource: 'reviewer_added',
  };
}

function draftToRows(rows) {
  return (rows || []).map(row => ({
    rowKey: nextRowKey(),
    checklistItem: row.checklistItem || '',
    deficiency: row.deficiency || '',
    aiQueryText: row.aiQueryText || '',
    queryText: row.queryText || '',
    rowSource: row.rowSource === 'reviewer_added' ? 'reviewer_added' : 'ai_generated',
    findingRef: row.findingRef || '',
  }));
}

function SourceTag({ row }) {
  const ai = row.rowSource === 'ai_generated';
  const edited = ai && !!row.aiQueryText && row.queryText.trim() !== row.aiQueryText.trim();
  return (
    <span className={`dqm-source dqm-source-${ai ? 'ai' : 'reviewer'}`}>
      {ai ? 'AI Generated' : 'Added by Reviewer'}
      {edited && <em className="dqm-source-edited">edited</em>}
    </span>
  );
}

function SkeletonRows() {
  return (
    <div className="dqm-skeleton" aria-hidden="true">
      {[0, 1, 2].map(i => (
        <div className="dqm-skeleton-row" key={i}>
          <span className="dqm-skeleton-bar dqm-w-sm" />
          <span className="dqm-skeleton-bar dqm-w-md" />
          <span className="dqm-skeleton-bar dqm-w-lg" />
        </div>
      ))}
    </div>
  );
}

export default function DocumentQueryModal({
  appNumber,
  docId,
  docLabel = '',
  fileName = '',
  verificationLabel = '',
  onClose,
  onSubmitted,
}) {
  const [phase, setPhase] = useState('loading');       // loading | ready | error
  const [draftError, setDraftError] = useState('');
  const [document_, setDocument] = useState({ expectedType: docLabel, fileName, status: null });
  const [rows, setRows] = useState([]);
  const [rowErrors, setRowErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const dialogRef = useRef(null);
  const firstFieldRef = useRef(null);
  // One id per modal session — a retried click reuses it, so the server
  // resolves the repeat to the record the first attempt created.
  const submissionId = useRef(newSubmissionId()).current;
  const titleId = useRef(`dqm-title-${Math.random().toString(36).slice(2, 8)}`).current;

  const loadDraft = useCallback(async () => {
    setPhase('loading');
    setDraftError('');
    const res = await getDocumentQueryDraft(appNumber, docId);
    if (res.aborted) return;
    if (!res.success) {
      setDraftError(res.error || 'The query draft could not be generated.');
      // The reviewer can still raise a query by hand when generation fails.
      setRows(current => (current.length ? current : [blankRow()]));
      setPhase('error');
      return;
    }
    if (res.document) {
      setDocument({
        expectedType: res.document.expectedType || docLabel,
        fileName: res.document.fileName || fileName,
        status: res.document.status || null,
      });
    }
    // No failed or warning checks: one blank manual row beats a false query.
    const drafted = draftToRows(res.rows);
    setRows(drafted.length ? drafted : [blankRow()]);
    setPhase('ready');
  }, [appNumber, docId, docLabel, fileName]);

  useEffect(() => { loadDraft(); }, [loadDraft]);

  useEffect(() => {
    const onKeyDown = e => { if (e.key === 'Escape' && !submitting) onClose?.(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, submitting]);

  useEffect(() => {
    if (phase === 'ready') firstFieldRef.current?.focus();
  }, [phase]);

  const statusLabel = document_.status?.label || verificationLabel || 'Verification status unavailable';
  const statusKey = document_.status?.key || '';

  const updateRow = (rowKey, value) => {
    setRows(current => current.map(row => (
      row.rowKey === rowKey ? { ...row, queryText: sanitizeInput(value) } : row
    )));
    setRowErrors(current => {
      if (!current[rowKey]) return current;
      const next = { ...current };
      delete next[rowKey];
      return next;
    });
    setFormError('');
  };

  const addRow = () => {
    setRows(current => [...current, blankRow()]);
    setFormError('');
  };

  const deleteRow = rowKey => {
    setRows(current => current.filter(row => row.rowKey !== rowKey));
    setRowErrors(current => {
      const next = { ...current };
      delete next[rowKey];
      return next;
    });
    setFormError('');
  };

  /* Mirrors the server rule so the reviewer sees the problem before the
     round trip; the server re-validates regardless. */
  const validate = candidateRows => {
    const retained = candidateRows.filter(row => !(
      row.rowSource === 'reviewer_added'
      && !row.queryText.trim() && !row.checklistItem.trim() && !row.deficiency.trim()
    ));
    if (!retained.length) return { retained, errors: {}, form: 'Add at least one query before submitting.' };
    const errors = {};
    retained.forEach(row => {
      if (!row.queryText.trim()) {
        errors[row.rowKey] = 'Enter the corrective action required from the applicant.';
      }
    });
    return { retained, errors, form: '' };
  };

  const handleSubmit = async () => {
    if (submitting) return;
    const { retained, errors, form } = validate(rows);
    if (form || Object.keys(errors).length) {
      setRowErrors(errors);
      setFormError(form);
      return;
    }
    setRowErrors({});
    setFormError('');
    setSubmitting(true);
    const res = await submitDocumentQuery(appNumber, docId, {
      submissionId,
      expectedType: document_.expectedType,
      rows: retained.map(row => ({
        rowKey: row.rowKey,
        checklistItem: row.checklistItem,
        deficiency: row.deficiency,
        aiQueryText: row.aiQueryText,
        queryText: row.queryText.trim(),
        rowSource: row.rowSource,
        findingRef: row.findingRef,
      })),
    });
    setSubmitting(false);
    if (!res.success) {
      if (res.rowErrors) {
        const { _form, ...perRow } = res.rowErrors;
        setRowErrors(perRow);
        setFormError(_form || '');
      } else {
        setFormError(res.error || 'The query could not be submitted.');
      }
      return;
    }
    onSubmitted?.({
      queryIdentifier: res.query?.queryIdentifier || '',
      duplicate: !!res.duplicate,
      rowCount: retained.length,
    });
  };

  const meta = useMemo(() => ([
    ['Expected document type', document_.expectedType || '—'],
    ['Uploaded file', document_.fileName || '—'],
    ['AI verification status', statusLabel],
    ['Application number', appNumber || '—'],
  ]), [document_.expectedType, document_.fileName, statusLabel, appNumber]);

  return createPortal(
    <div
      className="dqm-backdrop"
      onMouseDown={e => { if (e.target === e.currentTarget && !submitting) onClose?.(); }}
    >
      <div className="dqm-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef}>
        <header className="dqm-header">
          <div>
            <h2 id={titleId}>Raise a document query</h2>
            <p>
              Review the generated queries for this document, edit anything that needs rewording,
              then submit. The applicant receives one query per row.
            </p>
          </div>
          <button
            type="button" className="dqm-close" onClick={onClose}
            disabled={submitting} aria-label="Close query dialog"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>

        <dl className="dqm-meta">
          {meta.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd className={label === 'AI verification status' && statusKey ? `dqm-status dqm-status-${statusKey}` : undefined}>
                {value}
              </dd>
            </div>
          ))}
        </dl>

        <div className="dqm-body">
          {phase === 'loading' && (
            <div className="dqm-loading" role="status" aria-live="polite">
              <p>Generating a query draft from this document&rsquo;s verification results&hellip;</p>
              <SkeletonRows />
            </div>
          )}

          {phase === 'error' && (
            <div className="dqm-draft-error" role="alert">
              <p><strong>The query draft could not be generated.</strong></p>
              <p>{draftError}</p>
              <p>You can retry, or write the query manually in the table below.</p>
              <button type="button" className="dqm-btn dqm-btn-neutral" onClick={loadDraft}>Retry</button>
            </div>
          )}

          {phase !== 'loading' && (
            <>
              <table className="dqm-table">
                <caption className="dqm-visually-hidden">
                  Queries to be raised against {document_.expectedType || 'this document'}
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="dqm-col-sr">Sr. No.</th>
                    <th scope="col" className="dqm-col-item">Checklist Item / Issue</th>
                    <th scope="col" className="dqm-col-def">AI-Detected Deficiency</th>
                    <th scope="col" className="dqm-col-query">Query / Corrective Action Required</th>
                    <th scope="col" className="dqm-col-source">Source</th>
                    <th scope="col" className="dqm-col-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => {
                    const error = rowErrors[row.rowKey];
                    const fieldId = `dqm-query-${row.rowKey}`;
                    const errorId = `${fieldId}-error`;
                    return (
                      <tr
                        key={row.rowKey}
                        className={`dqm-row dqm-row-${row.rowSource === 'ai_generated' ? 'ai' : 'manual'}${error ? ' dqm-row-invalid' : ''}`}
                      >
                        <td data-label="Sr. No." className="dqm-col-sr">{index + 1}</td>
                        <td data-label="Checklist Item / Issue" className="dqm-col-item">
                          {row.rowSource === 'ai_generated' ? (
                            <span>{row.checklistItem || '—'}</span>
                          ) : (
                            <input
                              type="text"
                              className="dqm-input"
                              value={row.checklistItem}
                              placeholder="Requirement or issue"
                              aria-label={`Checklist item or issue for query ${index + 1}`}
                              onChange={e => setRows(current => current.map(r => (
                                r.rowKey === row.rowKey ? { ...r, checklistItem: sanitizeInput(e.target.value) } : r
                              )))}
                            />
                          )}
                        </td>
                        <td data-label="AI-Detected Deficiency" className="dqm-col-def">
                          {row.deficiency
                            ? <span>{row.deficiency}</span>
                            : <span className="dqm-muted">No AI finding — added by reviewer</span>}
                        </td>
                        <td data-label="Query / Corrective Action Required" className="dqm-col-query">
                          <label className="dqm-visually-hidden" htmlFor={fieldId}>
                            Query or corrective action required for row {index + 1}
                          </label>
                          <textarea
                            id={fieldId}
                            ref={index === 0 ? firstFieldRef : undefined}
                            className={`dqm-textarea${error ? ' dqm-invalid' : ''}`}
                            value={row.queryText}
                            rows={3}
                            maxLength={MAX_TEXT}
                            aria-invalid={error ? 'true' : undefined}
                            aria-describedby={error ? errorId : undefined}
                            placeholder="Describe the correction the applicant must make"
                            onChange={e => updateRow(row.rowKey, e.target.value)}
                          />
                          {error && <p className="dqm-row-error" id={errorId} role="alert">{error}</p>}
                        </td>
                        <td data-label="Source" className="dqm-col-source"><SourceTag row={row} /></td>
                        <td data-label="Actions" className="dqm-col-actions">
                          <button
                            type="button"
                            className="dqm-delete"
                            onClick={() => deleteRow(row.rowKey)}
                            aria-label={`Delete query row ${index + 1}`}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr className="dqm-row">
                      <td colSpan={6} className="dqm-empty">
                        No queries yet. Use <strong>+ Add Query Row</strong> to write one.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              <button type="button" className="dqm-btn dqm-btn-ghost dqm-add" onClick={addRow}>
                + Add Query Row
              </button>
            </>
          )}
        </div>

        <footer className="dqm-footer">
          <div className="dqm-footer-msg" aria-live="polite">
            {formError && <span className="dqm-form-error" role="alert">{formError}</span>}
            {!formError && rows.length > 0 && phase !== 'loading' && (
              <span>{rows.length} quer{rows.length === 1 ? 'y' : 'ies'} will be sent to the applicant.</span>
            )}
          </div>
          <div className="dqm-footer-actions">
            <button type="button" className="dqm-btn dqm-btn-neutral" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button
              type="button"
              className="dqm-btn dqm-btn-primary"
              onClick={handleSubmit}
              disabled={submitting || phase === 'loading'}
            >
              {submitting ? 'Submitting…' : 'Submit Query'}
            </button>
          </div>
        </footer>
      </div>
    </div>,
    typeof document !== 'undefined' ? document.body : null
  );
}
