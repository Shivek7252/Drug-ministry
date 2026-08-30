/**
 * DocViewerModal.js
 * Shared PDF viewer + AI checklist panel, extracted from Step5DocumentUpload.
 * Used by both the applicant wizard and the reviewer detail page.
 *
 * Props:
 *   docId      – unique key for this document (e.g. 'mfg_license')
 *   docLabel   – human-readable label (e.g. 'Manufacturing License')
 *   docType    – checklist key (e.g. 'mfg_license') — falls back to docId
 *   fileUrl    – blob URL or remote URL to fetch the file
 *   fileName   – original file name
 *   fileSize   – file size in bytes
 *   fileType   – MIME type string
 *   onClose    – callback when modal should close
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import * as pdfjsLib from 'pdfjs-dist';
import '../wizard/DocumentViewer.css';
import './ReviewerDocumentVerification.css';
import { getVerificationPresentation, validateReviewerDecision } from './verificationViewModel';

pdfjsLib.GlobalWorkerOptions.workerSrc =
  `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

/* ─── module-level caches (shared across all usages) ────────────────────── */
const OCR_CACHE = new Map();
/* ─── helpers ────────────────────────────────────────────────────────────── */
function fmtSize(b) {
  if (!b) return '';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(2) + ' MB';
}

function escRx(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ─── Detect if PDF.js text layer is usable (not PUA-encoded) ───────────── */
function isTextLayerUsable(items) {
  if (!items || items.length === 0) return false;
  let total = 0, readable = 0;
  for (const item of items) {
    for (const ch of (item.str || '')) {
      total++;
      const cp = ch.codePointAt(0);
      if (cp > 32 && !(cp >= 0xE000 && cp <= 0xF8FF) && !(cp >= 0xF0000))
        readable++;
    }
  }
  return total > 0 && (readable / total) > 0.5;
}

/* Progressive fallback: try full query, then shorter substrings, then each
   whitespace-separated token. Returns the first non-empty match set. */
function progressiveQueries(query) {
  const q = query.replace(/\s+/g, ' ').trim();
  if (!q) return [];
  const out = [q];
  const parts = q.split(/\s+/);
  // Halved from the right
  if (parts.length >= 4) out.push(parts.slice(0, Math.ceil(parts.length / 2)).join(' '));
  // Individual tokens ≥3 chars, in original order, dedup preserving order
  const seen = new Set(out);
  for (const p of parts) if (p.length >= 3 && !seen.has(p)) { out.push(p); seen.add(p); }
  return out;
}

/* ─── PDF.js text-layer search ──────────────────────────────────────────── */
function searchTextLayer(rawQuery, items, vp) {
  if (!items?.length || !vp) return [];
  const map = []; let raw = '';
  for (const item of items) {
    const s = item.str || '';
    for (let c = 0; c < s.length; c++) { map.push({ item, c, syn: false }); raw += s[c]; }
    if (item.hasEOL && raw.length && raw[raw.length - 1] !== ' ') {
      map.push({ item, c: -1, syn: true }); raw += ' ';
    }
  }
  const normMap = []; let norm = '', lastSp = false;
  for (let i = 0; i < raw.length; i++) {
    if (/\s/.test(raw[i])) {
      if (!lastSp) { norm += ' '; normMap.push(i); lastSp = true; }
    } else { norm += raw[i]; normMap.push(i); lastSp = false; }
  }
  const rects = [];
  const re = new RegExp(escRx(rawQuery.replace(/\s+/g, ' ').trim()), 'gi');
  let m;
  while ((m = re.exec(norm)) !== null) {
    const rs = normMap[m.index];
    const re2 = normMap[Math.min(m.index + m[0].length - 1, normMap.length - 1)];
    if (rs == null || re2 == null) continue;
    let seg = null;
    for (let ri = rs; ri <= re2; ri++) {
      if (ri >= map.length) break;
      const e = map[ri]; if (e.syn || !e.item?.str) continue;
      if (!seg || seg.item !== e.item) {
        if (seg) { const r = toRect(seg.item, seg.s, seg.e, vp); if (r) rects.push(r); }
        seg = { item: e.item, s: e.c, e: e.c + 1 };
      } else seg.e = e.c + 1;
    }
    if (seg) { const r = toRect(seg.item, seg.s, seg.e, vp); if (r) rects.push(r); }
  }
  return rects.filter(Boolean);
}

function getHighlightsFromTextLayer(query, items, vp) {
  if (!query?.trim() || !items?.length || !vp) return [];
  for (const q of progressiveQueries(query)) {
    const rects = searchTextLayer(q, items, vp);
    if (rects.length > 0) return rects;
  }
  return [];
}

function toRect(item, s, e, vp) {
  if (!item) return null;
  const [, , , sy, tx, ty] = item.transform;
  const x = tx * vp.scale, y = vp.height - ty * vp.scale;
  const w = item.width * vp.scale, h = Math.abs(sy) * vp.scale;
  const len = item.str.length;
  if (!len || h <= 0) return null;
  const cw = w > 0 ? w / len : h * 0.55;
  return { left: x + s * cw, top: y - h, width: Math.max(4, (e - s) * cw), height: h + 2 };
}

/* ─── OCR via Tesseract.js ───────────────────────────────────────────────── */
let tesseractWorker = null;
let tesseractReady = false;
let tesseractLoading = false;
const tesseractCallbacks = [];

async function getTesseractWorker() {
  if (tesseractReady && tesseractWorker) return tesseractWorker;
  if (tesseractLoading) return new Promise(res => tesseractCallbacks.push(res));
  tesseractLoading = true;
  if (!window.Tesseract) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  const worker = await window.Tesseract.createWorker('eng', 1, {
    workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
    corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core-simd-lstm.wasm.js',
    langPath: 'https://tessdata.projectnaptha.com/4.0.0',
    logger: () => { },
  });
  tesseractWorker = worker; tesseractReady = true; tesseractLoading = false;
  tesseractCallbacks.forEach(cb => cb(worker));
  tesseractCallbacks.length = 0;
  return worker;
}

async function ocrCanvas(canvas) {
  const worker = await getTesseractWorker();
  const { data } = await worker.recognize(canvas);
  const words = [];
  for (const block of (data.blocks || []))
    for (const para of (block.paragraphs || []))
      for (const line of (para.lines || []))
        for (const word of (line.words || [])) {
          const t = word.text?.trim();
          if (t && word.confidence > 30)
            words.push({ text: t, bbox: word.bbox });
        }
  return words;
}

function searchOcr(rawQuery, ocrWords) {
  const wordMap = []; let joined = '';
  ocrWords.forEach((w, wi) => {
    for (let ci = 0; ci < w.text.length; ci++) wordMap.push({ wi, ci });
    joined += w.text;
    if (wi < ocrWords.length - 1) { wordMap.push({ wi, ci: -1, sep: true }); joined += ' '; }
  });
  const re = new RegExp(escRx(rawQuery.replace(/\s+/g, ' ').trim()), 'gi');
  const rects = []; let m;
  while ((m = re.exec(joined)) !== null) {
    const spanned = new Set();
    for (let i = m.index; i <= m.index + m[0].length - 1 && i < wordMap.length; i++)
      if (!wordMap[i].sep) spanned.add(wordMap[i].wi);
    for (const wi of spanned) {
      const { bbox } = ocrWords[wi];
      rects.push({ left: bbox.x0, top: bbox.y0, width: bbox.x1 - bbox.x0, height: bbox.y1 - bbox.y0 });
    }
  }
  return rects;
}

function getHighlightsFromOcr(query, ocrWords) {
  if (!query?.trim() || !ocrWords?.length) return [];
  for (const q of progressiveQueries(query)) {
    const rects = searchOcr(q, ocrWords);
    if (rects.length > 0) return rects;
  }
  return [];
}

/* ─── doc-type → checklist key mapping ──────────────────────────────────── */
/* Each document slot is verified ONLY against the checklist for that slot's
   document type. The reviewer clicked a specific row, so the AI focuses on
   that document's own parameters — not all six Export-NOC master items. */
const DOC_CHECKLISTS = {
  mfg_license: 'manufacturing_license',
  product_approval: 'product_approval',
  export_auth: 'export_authorization',
  qa_cert: 'quality_assurance',
  batch_analysis: 'batch_analysis',
  product_info: 'product_info',
};

/* ─── Single PDF page ────────────────────────────────────────────────────── */
function PdfPage({ pdf, pageNum, scale, query, activeGlobal, globalOffset, onReady, onOcrDone, wrapRef, ocrWords }) {
  const canvasRef = useRef();
  const renderRef = useRef(null);
  const dataRef = useRef({ items: [], vp: null, loaded: false, usable: false });
  const [hl, setHl] = useState([]);
  const [textItems, setItems] = useState([]);
  const [vp, setVp] = useState(null);

  useEffect(() => {
    if (!pdf || scale <= 0) return;
    let dead = false;
    (async () => {
      try {
        if (renderRef.current) { try { renderRef.current.cancel(); } catch (_) { } }
        const page = await pdf.getPage(pageNum);
        if (dead) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const viewport = page.getViewport({ scale });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        renderRef.current = page.render({ canvasContext: canvas.getContext('2d'), viewport });
        try { await renderRef.current.promise; }
        catch (e) { if (e?.name === 'RenderingCancelledException') return; }
        if (dead) return;
        const tc = await page.getTextContent({ includeMarkedContent: true, disableNormalization: false });
        const items = tc.items.filter(i => i.str !== undefined);
        const usable = isTextLayerUsable(items);
        dataRef.current = { items, vp: viewport, loaded: true, usable };
        setItems(items); setVp(viewport);
        if (usable) {
          const rects = getHighlightsFromTextLayer(query, items, viewport);
          setHl(rects); onReady(pageNum, rects);
        } else {
          onReady(pageNum, []);
          onOcrDone && onOcrDone(pageNum, canvas);
        }
      } catch (err) { console.error(`PdfPage render error page ${pageNum}:`, err); }
    })();
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, pageNum, scale]);

  useEffect(() => {
    const { items, vp: viewport, loaded, usable } = dataRef.current;
    if (!loaded || !viewport) return;
    if (usable) {
      const rects = getHighlightsFromTextLayer(query, items, viewport);
      setHl(rects); onReady(pageNum, rects);
    } else if (ocrWords) {
      const rects = getHighlightsFromOcr(query, ocrWords);
      setHl(rects); onReady(pageNum, rects);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, ocrWords]);

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block', boxShadow: '0 2px 12px rgba(0,0,0,.3)', marginBottom: 16, lineHeight: 0, flexShrink: 0 }}>
      <canvas ref={canvasRef} style={{ display: 'block' }} />
      {vp && textItems.map((item, i) => {
        if (!item.str) return null;
        const [, , , scY, tx, ty] = item.transform;
        const fs = Math.abs(scY) * vp.scale;
        const iw = item.width * vp.scale;
        const ang = Math.atan2(item.transform[1], item.transform[0]) * (180 / Math.PI);
        const sX = fs > 0 && iw > 0 ? iw / (item.str.length * fs * 0.6) : 1;
        return (
          <span key={i} style={{
            position: 'absolute', left: tx * vp.scale, top: vp.height - ty * vp.scale - fs,
            width: iw, height: fs + 2, fontSize: fs, fontFamily: item.fontName || 'sans-serif',
            color: 'transparent', whiteSpace: 'pre', userSelect: 'text', WebkitUserSelect: 'text',
            cursor: 'text', transformOrigin: '0% 100%',
            transform: `${ang ? `rotate(${ang}deg) ` : ''}scaleX(${sX})`,
          }}>{item.str}</span>
        );
      })}
      {hl.map((r, i) => {
        const active = (globalOffset + i) === activeGlobal;
        return (
          <div key={i} style={{
            position: 'absolute', left: r.left, top: r.top, width: r.width, height: r.height,
            background: active ? 'rgba(251,191,36,.9)' : 'rgba(254,240,138,.6)',
            border: '1.5px solid ' + (active ? '#d97706' : '#f59e0b'),
            borderRadius: 2, pointerEvents: 'none', zIndex: 10, mixBlendMode: 'multiply',
          }} />
        );
      })}
    </div>
  );
}

function VerificationShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
      <path d="M12 3 5 6v5c0 4.7 2.8 8.2 7 10 4.2-1.8 7-5.3 7-10V6l-7-3Z" />
      <path d="m9 12 2 2 4-5" />
    </svg>
  );
}

function StatusIcon({ state }) {
  if (state === 'approved') return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>;
  if (state === 'rejected') return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>;
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M12 8v5m0 3h.01" /><circle cx="12" cy="12" r="9" /></svg>;
}

function ReviewerPanelHeader({ runtimeStatus, payload, cached }) {
  const view = getVerificationPresentation(runtimeStatus, payload);
  let verifiedAt = '';
  if (view.verifiedAt) {
    const parsed = new Date(view.verifiedAt);
    if (!Number.isNaN(parsed.getTime())) {
      verifiedAt = parsed.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
    }
  }
  return (
    <header className="rvai-header">
      <div className="rvai-header-main">
        <span className="rvai-header-icon"><VerificationShieldIcon /></span>
        <div className="rvai-header-copy">
          <h2>AI Document Verification</h2>
          <p>{verifiedAt ? `Last verified ${verifiedAt}` : 'CDSCO reviewer analysis'}</p>
        </div>
      </div>
      <div className="rvai-header-badges">
        <span className="rvai-result-origin">{cached ? 'Cached Result' : runtimeStatus === 'done' ? 'Live Result' : 'Analysis'}</span>
        <span className={`rvai-status rvai-status-${view.key}`}><StatusIcon state={view.key} />{view.label}</span>
      </div>
    </header>
  );
}

function ReviewerVerificationResult({ payload, onLocate, activeQuery, onRerun }) {
  const view = getVerificationPresentation('done', payload);
  const hasTypeComparison = Boolean(view.expectedDocumentType || view.detectedDocumentType);
  const showRejectionDetails = view.key === 'rejected';

  return (
    <div className="rvai-content">
      <section className="rvai-section" aria-labelledby="rvai-summary-heading">
        <div className="rvai-section-title" id="rvai-summary-heading">Verification Summary</div>
        <div className="rvai-summary-card">
          <div className="rvai-progress-head">
            <div><span>Completion</span><strong>{view.summary.score ?? 0}%</strong></div>
            <span>{view.summary.present} of {view.summary.total} checks passed</span>
          </div>
          <div className="rvai-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={view.summary.score ?? 0}>
            <span className={`rvai-progress-${view.key}`} style={{ width: `${view.summary.score ?? 0}%` }} />
          </div>
          <div className="rvai-metrics">
            <div><span className="rvai-metric-dot rvai-dot-pass" /><strong>{view.summary.present}</strong><span>Passed</span></div>
            <div><span className="rvai-metric-dot rvai-dot-fail" /><strong>{view.summary.missing}</strong><span>Failed</span></div>
            <div><span className="rvai-metric-dot rvai-dot-total" /><strong>{view.summary.total}</strong><span>Total</span></div>
          </div>
          {(view.textSource || view.pageCount) && (
            <div className="rvai-analysis-meta">
              {view.textSource && (
                <div>
                  <span>Analysis source</span>
                  <strong>
                    {view.textSource === 'mistral-ocr' ? 'Anuvadini OCR'
                      : view.textSource === 'anuvadini-ocr' ? 'Anuvadini OCR'
                        : view.textSource === 'pdf-text' ? 'PDF Text Layer'
                          : view.textSource === 'none' ? 'No text extracted'
                            : view.textSource}
                  </strong>
                </div>
              )}
              {view.pageCount ? <div><span>Pages analysed</span><strong>{view.pageCount}</strong></div> : null}
            </div>
          )}
        </div>
      </section>

      {showRejectionDetails && (
        <section className="rvai-section" aria-labelledby="rvai-rejection-heading">
          <div className="rvai-section-title" id="rvai-rejection-heading">Rejection Details</div>
          <div className="rvai-rejection-card">
            {view.primaryReason && (
              <div className="rvai-primary-reason">
                <span className="rvai-reason-icon"><StatusIcon state="rejected" /></span>
                <div><span>Primary rejection reason</span><p>{view.primaryReason}</p></div>
              </div>
            )}
            {hasTypeComparison && (
              <div className="rvai-type-grid">
                {view.expectedDocumentType && <div><span>Expected document</span><strong>{view.expectedDocumentType}</strong></div>}
                {view.detectedDocumentType && <div><span>Detected document</span><strong>{view.detectedDocumentType}</strong></div>}
              </div>
            )}
            {view.typeEvidence && (
              <div className="rvai-evidence">
                <div><span>Supporting evidence</span>{view.typePage && <b>Page {view.typePage}</b>}</div>
                <blockquote>“{view.typeEvidence}”</blockquote>
                <button type="button" onClick={() => onLocate({ evidence: view.typeEvidence, page: view.typePage }, -1)}>Locate in document</button>
              </div>
            )}
            {view.correctiveAction && (
              <div className="rvai-correction"><span>Suggested corrective action</span><p>{view.correctiveAction}</p></div>
            )}
            {!view.primaryReason && !hasTypeComparison && !view.typeEvidence && !view.correctiveAction && (
              <div className="rvai-empty-detail">No additional rejection fields were returned by this verification result.</div>
            )}
          </div>
        </section>
      )}

      <section className="rvai-section" aria-labelledby="rvai-checklist-heading">
        <div className="rvai-section-title" id="rvai-checklist-heading">
          <span>Verification Checklist</span><span className="rvai-count-badge">{view.checks.length}</span>
        </div>
        {view.checks.length > 0 ? (
          <div className="rvai-checklist">
            {view.checks.map((check, index) => {
              const checkState = check.present === true ? 'passed' : check.present === false ? 'failed' : 'warning';
              return (
                <article className={`rvai-check rvai-check-${checkState}`} key={check.id}>
                  <div className="rvai-check-head">
                    <span className="rvai-check-icon"><StatusIcon state={check.present === true ? 'approved' : check.present === false ? 'rejected' : 'incomplete'} /></span>
                    <strong>{check.item}</strong>
                    <span className="rvai-check-state">{checkState === 'passed' ? 'Passed' : checkState === 'failed' ? 'Failed' : 'Needs review'}</span>
                  </div>
                  {check.reason && <p className="rvai-check-reason">{check.reason}</p>}
                  {(check.expectedValue || check.extractedValue) && check.present !== true && (
                    <div className="rvai-values">
                      {check.expectedValue && <div><span>Expected</span><strong>{check.expectedValue}</strong></div>}
                      {check.extractedValue && <div><span>Extracted</span><strong>{check.extractedValue}</strong></div>}
                    </div>
                  )}
                  {check.evidence && (
                    <div className="rvai-check-evidence">
                      <div><span>Evidence</span>{check.page && <b>Page {check.page}</b>}</div>
                      <p>“{check.evidence}”</p>
                      <button type="button" onClick={() => onLocate(check.raw, index)}>{activeQuery ? 'Update highlight' : 'Locate in document'}</button>
                    </div>
                  )}
                  {check.correctiveAction && check.present !== true && (
                    <div className="rvai-check-correction"><span>Correction</span><p>{check.correctiveAction}</p></div>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rvai-empty-detail">No check-level results are available for this analysis.</div>
        )}
      </section>

      <div className="rvai-panel-actions">
        {activeQuery && <button type="button" className="rvai-text-button" onClick={() => onLocate(null)}>Clear document highlight</button>}
        <button type="button" className="rvai-rerun" onClick={onRerun}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></svg>
          Re-run Verification
        </button>
      </div>
    </div>
  );
}

/* ─── AI Checklist Panel ─────────────────────────────────────────────────── */
function ChecklistPanel({ docId, docType, docLabel, fileUrl, onSearch, activeQuery, appNumber, reviewerMode = false }) {
  const [status, setStatus] = useState('idle');
  const [results, setResults] = useState(null);
  const [summary, setSummary] = useState(null);
  const [verificationPayload, setVerificationPayload] = useState(null);
  const [typeMatch, setTypeMatch] = useState(true);
  const [typeReason, setTypeReason] = useState('');
  const [errMsg, setErrMsg] = useState('');
  const [activeItem, setActiveItem] = useState(null);
  const [cached, setCached] = useState(false);

  const checklistKey = DOC_CHECKLISTS[docType || docId] || 'default';

  // Two paths:
  //   1. appNumber + docId → hit the backend endpoint that uses a DB cache.
  //      First call runs full verify + caches; subsequent calls are instant.
  //   2. No appNumber → fall back to legacy multipart upload path.
  const run = async ({ force = false } = {}) => {
    if (!fileUrl && !appNumber) { setErrMsg('No file available for verification.'); setStatus('error'); return; }
    setStatus('loading'); setResults(null); setSummary(null); setVerificationPayload(null);
    setTypeMatch(true); setTypeReason(''); setErrMsg('');
    setActiveItem(null);
    if (onSearch) onSearch('');
    try {
      let data;
      if (appNumber && docId) {
        const url = `http://localhost:5001/api/applications/${encodeURIComponent(appNumber)}/document/${encodeURIComponent(docId)}/verify${force ? '?force=1' : ''}`;
        const apiResp = await fetch(url, { method: 'POST' });
        data = await apiResp.json();
        if (!apiResp.ok) throw new Error(data.error || 'AI analysis is temporarily unavailable. Please try again shortly.');
      } else {
        const resp = await fetch(fileUrl);
        if (!resp.ok) throw new Error('Could not read document file.');
        const blob = await resp.blob();
        const form = new FormData();
        form.append('file', blob, docLabel + '.pdf');
        form.append('docType', checklistKey);
        form.append('docLabel', docLabel);
        const apiResp = await fetch('http://localhost:5001/api/verify', { method: 'POST', body: form });
        data = await apiResp.json();
        if (!apiResp.ok) throw new Error('AI analysis is temporarily unavailable. Please try again shortly.');
      }
      setResults(Array.isArray(data.results) ? data.results : []); setSummary(data.summary || null);
      setVerificationPayload(data);
      setTypeMatch(data.documentTypeMatch !== false);
      setTypeReason(data.documentTypeReason || '');
      setCached(data.cached === true);
      setStatus('done');
    } catch (e) { setErrMsg(e.message); setStatus('error'); }
  };

  // Auto-run on mount whenever we have a file (or appNumber+docId cache lookup).
  // Reviewer opens "Open & Inspect" and results appear without clicking anything.
  useEffect(() => {
    if (!fileUrl && !appNumber) return;
    if (status !== 'idle') return;
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUrl, appNumber, docId]);

  const getSearchTerm = (item, note) => {
    if (note) {
      const quoted = note.match(/"([^"]+)"|'([^']+)'|:\s*([A-Z][A-Za-z0-9\s\-/]{2,30})/);
      if (quoted) return (quoted[1] || quoted[2] || quoted[3] || '').trim();
    }
    const label = item
      .replace(/\bis\b|\bare\b|\bhas\b|\bhave\b|\bof\b|\bthe\b|\ba\b|\ban\b|\bin\b|\bfor\b|\bby\b|\bon\b/gi, ' ')
      .replace(/present|mentioned|available|listed|included|stated|visible|identified|specified/gi, '')
      .replace(/\s+/g, ' ').trim();
    const words = label.split(/\s+/).filter(w => w.length > 3);
    return words.slice(0, 3).join(' ').trim() || item.split(' ').slice(0, 2).join(' ');
  };

  /* From a piece of AI evidence text, pick the shortest DISTINCTIVE token
     that scanned-PDF OCR will most reliably find. Long full quotes with mixed
     punctuation (e.g. "LIC No / Validity | KD/323 31/12/2026") almost never
     match exactly against Tesseract output — but a single ID like "KD/323"
     or date like "31/12/2026" nearly always does. Priority:
       1. Alphanumeric ID (mix of letters + digits, has / or - allowed)
       2. Date pattern dd/mm/yyyy or dd-mm-yyyy
       3. All-caps run of 2+ words (proper nouns)
       4. Fallback: first 5 significant words. */
  const pickDistinctiveTerm = (evidence) => {
    if (!evidence) return '';
    const cleaned = evidence.replace(/^["'`]+|["'`]+$/g, '').trim();

    // 1. Alphanumeric IDs — mix of letters + digits, minimum 3 chars, allow /-
    const idMatch = cleaned.match(/\b[A-Z]{1,6}[\/\-][A-Z0-9]{2,}[A-Z0-9\/\-]*\b|\b[A-Z]{2,}[0-9]+[A-Z0-9]*\b|\b[0-9]+[A-Z]+[A-Z0-9]*\b/);
    if (idMatch) return idMatch[0];

    // 2. Date patterns
    const dateMatch = cleaned.match(/\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/);
    if (dateMatch) return dateMatch[0];

    // 3. Run of 2+ consecutive all-caps words (>=3 chars each)
    const capsMatch = cleaned.match(/\b[A-Z]{3,}(?:\s+[A-Z]{3,}){1,4}\b/);
    if (capsMatch) return capsMatch[0];

    // 4. First 5 significant words (fallback)
    return cleaned.split(/\s+/).slice(0, 5).join(' ');
  };

  const handleItemClick = (r, i) => {
    if (!onSearch) return;
    if (!r) { setActiveItem(null); onSearch(''); return; }
    if (!r.evidence) return;
    // Prefer a distinctive short token from the AI evidence (ID / date /
    // caps run) — much more OCR-robust than the full verbatim quote.
    let term = pickDistinctiveTerm(r.evidence);
    if (!term) term = getSearchTerm(r.item, r.note);
    if (!term) return;
    setActiveItem(i);
    onSearch(term, r.page || null);
  };

  const score = summary?.score ?? 0;
  const sc = score >= 75 ? '#16a34a' : score >= 50 ? '#d97706' : '#dc2626';
  const sb = score >= 75 ? '#f0fdf4' : score >= 50 ? '#fffbeb' : '#fef2f2';

  return (
    <div className="cl-panel">
      {reviewerMode ? (
        <ReviewerPanelHeader runtimeStatus={status} payload={verificationPayload} cached={cached} />
      ) : (
        <div className="cl-header">
          <span className="cl-header-icon">🤖</span>
          <div>
            <div className="cl-header-title">AI Document Verification</div>
            <div className="cl-header-sub">Powered by ANUVADINI AI</div>
          </div>
        </div>
      )}
      <div className={`cl-body${reviewerMode ? ' rvai-body' : ''}`}>
        {status === 'idle' && (
          <div className="cl-idle">
            <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
            <p style={{ fontWeight: 700, color: '#1e293b', marginBottom: 6 }}>Verify Document Completeness</p>
            <p style={{ fontSize: 12, color: '#64748b', marginBottom: 16, lineHeight: 1.6 }}>
              Check if this <strong>{docLabel}</strong> contains all required information for the Export NOC application.
            </p>
            <button className="cl-btn-primary" onClick={run}>🔍 Run AI Verification</button>
          </div>
        )}
        {status === 'loading' && (
          <div className="cl-loading">
            <div className="cl-spin" />
            <p style={{ fontWeight: 600, color: '#1e293b', margin: '12px 0 4px' }}>Analyzing document…</p>
            <p style={{ fontSize: 11, color: '#64748b' }}>Sending to ANUVADINI AI (5–15 sec)</p>
          </div>
        )}
        {status === 'no-key' && (
          <div className="cl-error-state">
            <div style={{ fontSize: 36, marginBottom: 8 }}>🔄</div>
            <p style={{ fontWeight: 700, color: '#d97706', marginBottom: 8 }}>Analysis Temporarily Unavailable</p>
            <p style={{ fontSize: 12, color: '#64748b', lineHeight: 1.7, marginBottom: 16 }}>
              The AI analysis service is currently undergoing maintenance.
              We are working on restoring full functionality. Please try again later.
            </p>
            <button className="cl-btn-primary" onClick={run}>Retry</button>
          </div>
        )}
        {status === 'error' && (
          <div className="cl-error-state">
            <div style={{ fontSize: 36, marginBottom: 8 }}>🔄</div>
            <p style={{ fontWeight: 700, color: '#d97706', marginBottom: 6 }}>Analysis Temporarily Unavailable</p>
            <p style={{ fontSize: 12, color: '#64748b', lineHeight: 1.7, marginBottom: 16 }}>
              {errMsg || 'The AI analysis service could not complete verification. Please try again.'}
            </p>
            <button className="cl-btn-primary" onClick={run}>Retry</button>
          </div>
        )}
        {status === 'done' && reviewerMode && verificationPayload && (
          <ReviewerVerificationResult
            payload={verificationPayload}
            activeQuery={activeQuery}
            onLocate={handleItemClick}
            onRerun={() => run({ force: true })}
          />
        )}
        {status === 'done' && !reviewerMode && summary && !typeMatch && (
          <div>
            <div className="cl-absent-banner">
              <span className="cl-absent-icon">❌</span>
              <div>
                <div className="cl-absent-title">{docLabel} is not present</div>
                <div className="cl-absent-sub">
                  {typeReason
                    ? <>{typeReason} The uploaded file does not appear to be a valid <strong>{docLabel}</strong>.</>
                    : <>The uploaded file does not appear to be a valid <strong>{docLabel}</strong>. None of the expected identifying features were found.</>
                  }
                </div>
              </div>
            </div>
            <button className="cl-btn-secondary" onClick={() => run({ force: true })}>🔄 Re-run Verification</button>
          </div>
        )}
        {status === 'done' && !reviewerMode && summary && typeMatch && (
          <div>
            {cached && (
              <div style={{
                fontSize: 10.5, fontWeight: 700, color: '#64748b',
                background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 10,
                padding: '2px 8px', display: 'inline-block', marginBottom: 6,
              }}>
                ⚡ From cache
              </div>
            )}
            <div className="cl-score" style={{ background: sb, borderColor: sc + '55' }}>
              <div className="cl-score-num" style={{ color: sc }}>{score}%</div>
              <div className="cl-score-label">Completeness Score</div>
              <div className="cl-score-bar-wrap">
                <div className="cl-score-bar-fill" style={{ width: `${score}%`, background: sc }} />
              </div>
              <div className="cl-score-row">
                <span className="cl-cnt yes">✓ {summary.present}</span>
                <span className="cl-cnt no">✗ {summary.missing}</span>
                {summary.unknown > 0 && <span className="cl-cnt unk">? {summary.unknown}</span>}
              </div>
            </div>
            <div className="cl-locate-hint">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              Click 🔍 on a ✅ item to highlight it in the PDF
            </div>
            <div className="cl-items-list">
              {results.map((r, i) => {
                const isActive = activeItem === i;
                const isPresent = r.present === true;
                const isMissing = r.present === false;
                return (
                  <div key={i}
                    className={`cl-item ${isMissing ? 'cl-item-no' : isPresent ? 'cl-item-yes' : 'cl-item-unk'} ${isActive ? 'cl-item-active' : ''}`}
                  >
                    <span className="cl-item-icon">
                      {isMissing ? '❌' : isPresent ? '✅' : '❓'}
                    </span>
                    <div className="cl-item-text">
                      <div className="cl-item-label">{r.item}</div>
                      {isPresent && r.evidence && (
                        <div className="cl-item-evidence">
                          <span className="cl-evidence-label">
                            📍 Evidence{typeof r.page === 'number' ? ` (Page ${r.page})` : ''}:
                          </span>
                          <span className="cl-evidence-quote">“{r.evidence}”</span>
                        </div>
                      )}
                      {isPresent && (
                        <div className="cl-locate-tag">
                          {isActive && activeQuery
                            ? <><span className="cl-locate-dot active" />Highlighting: <em>{activeQuery}</em></>
                            : <><span className="cl-locate-dot" />Press 🔍 to highlight in PDF</>}
                        </div>
                      )}
                      {r.note && <div className="cl-item-note">{r.note}</div>}
                    </div>
                    <div className="cl-item-right">
                      <span className={`cl-badge ${isMissing ? 'cl-badge-no' : isPresent ? 'cl-badge-yes' : 'cl-badge-unk'}`}>
                        {isMissing ? 'NO' : isPresent ? 'YES' : '?'}
                      </span>
                      {isPresent && (
                        <button
                          className={`cl-search-btn${isActive && activeQuery ? ' cl-search-btn-active' : ''}`}
                          title={`Highlight "${getSearchTerm(r.item, r.note)}" in PDF`}
                          onClick={() => handleItemClick(r, i)}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="13" height="13">
                            <circle cx="11" cy="11" r="8" />
                            <line x1="21" y1="21" x2="16.65" y2="16.65" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {activeQuery && (
              <button className="cl-btn-secondary" style={{ marginBottom: 6 }}
                onClick={() => { setActiveItem(null); if (onSearch) onSearch(''); }}>
                ✕ Clear Location Search
              </button>
            )}
            <button className="cl-btn-secondary" onClick={() => run({ force: true })}>🔄 Re-run Verification</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Image Viewer (non-PDF files) ──────────────────────────────────────── */
function ImageViewer({ fileUrl, fileName, fileSize, onClose }) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  useEffect(() => {
    const fn = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === '+' || e.key === '=') setZoom(z => Math.min(+(z + .25).toFixed(2), 5));
      if (e.key === '-') setZoom(z => Math.max(+(z - .25).toFixed(2), .1));
      if (e.key === '0') setZoom(1);
      if (e.key === 'r' || e.key === 'R') setRotation(r => (r + 90) % 360);
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);
  return createPortal(
    <div className="dv-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="dv-modal" onClick={e => e.stopPropagation()}>
        <div className="dv-header">
          <div className="dv-header-left">
            <span className="dv-file-icon">🖼️</span>
            <div>
              <div className="dv-file-name">{fileName}</div>
              <div className="dv-file-meta">{fmtSize(fileSize)}</div>
            </div>
          </div>
          <div className="dv-toolbar">
            <button className="dv-tool-btn" onClick={() => setZoom(z => Math.min(+(z + .25).toFixed(2), 5))}>+</button>
            <button className="dv-tool-btn" onClick={() => setZoom(z => Math.max(+(z - .25).toFixed(2), .1))}>−</button>
            <button className="dv-tool-btn" onClick={() => { setZoom(1); setRotation(0); }}>↺</button>
            <button className="dv-tool-btn" onClick={() => setRotation(r => (r + 90) % 360)}>⟳</button>
            <span className="dv-zoom-badge">{Math.round(zoom * 100)}%</span>
            <div className="dv-sep" />
            {fileUrl && <a className="dv-tool-btn" href={fileUrl} download={fileName} title="Download">⬇</a>}
            <button className="dv-close-btn" onClick={onClose}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" width="15" height="15">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
        <div className="dv-body dv-img-body">
          <div className="dv-scroll-area">
            <div className="dv-img-stage" style={{ transform: `scale(${zoom}) rotate(${rotation}deg)` }}>
              {fileUrl && <img src={fileUrl} alt={fileName} className="dv-img" draggable={false} />}
            </div>
          </div>
        </div>
        <div className="dv-footer">
          <span className="dv-kbd-hint"><kbd>Esc</kbd> Close · <kbd>+</kbd><kbd>-</kbd> Zoom · <kbd>R</kbd> Rotate</span>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ─── Main exported component ────────────────────────────────────────────── */
export default function DocViewerModal({ docId, docType, docLabel, fileUrl, fileName, fileSize, fileType, onClose, onVerify, onDecline, onRaiseQuery, verificationResult, appNumber, reviewerMode = false, onReviewerDecision, reviewActionsDisabled = false }) {
  const isPDF = fileType?.includes('pdf') || fileName?.toLowerCase().endsWith('.pdf');
  const isImg = fileType?.startsWith('image/');

  const [pdf, setPdf] = useState(null);
  const [numPages, setPages] = useState(0);
  const [fitScale, setFit] = useState(null);
  const [zoom, setZoom] = useState(1.0);
  // Two separate query states:
  //   `query`          — text the user typed into the top search bar (shown in input)
  //   `highlightQuery` — term triggered by clicking the checklist 🔍 icon
  //                      (drives highlighting but does NOT appear in the input)
  const [query, setQuery] = useState('');
  const [highlightQuery, setHighlightQuery] = useState('');
  const effectiveQuery = query || highlightQuery;
  const [pageHl, setPageHl] = useState({});
  const [activeIdx, setActive] = useState(0);
  const [ocrStatus, setOcrStatus] = useState({});
  const [ocrWords, setOcrWords] = useState({});
  const [decisionDialog, setDecisionDialog] = useState(null);
  const [decisionRemarks, setDecisionRemarks] = useState('');
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [decisionFeedback, setDecisionFeedback] = useState(null);
  const [decisionComplete, setDecisionComplete] = useState(false);

  const scrollRef = useRef();
  const pageRefs = useRef({});
  const inputRef = useRef();
  const totalRef = useRef(0);

  // load PDF
  useEffect(() => {
    if (!isPDF || !fileUrl) return;
    let cancelled = false;
    setPdf(null); setPages(0); setFit(null); setPageHl({}); setActive(0);
    pdfjsLib.getDocument({ url: fileUrl }).promise
      .then(d => { if (!cancelled) { setPdf(d); setPages(d.numPages); } })
      .catch(e => { if (!cancelled) console.error('DocViewerModal PDF load error:', e); });
    return () => { cancelled = true; };
  }, [fileUrl, isPDF]);

  // compute fit scale after pdf loads
  useEffect(() => {
    if (!pdf || !scrollRef.current) return;
    pdf.getPage(1).then(p => {
      const cw = scrollRef.current?.clientWidth || 480;
      const base = p.getViewport({ scale: 1 });
      setFit(Math.min(cw - 24, 620) / base.width);
    });
  }, [pdf]);

  useEffect(() => { setActive(0); }, [query, highlightQuery]);

  // keyboard shortcuts
  useEffect(() => {
    const fn = (e) => {
      if (e.key === 'Escape') {
        if (decisionDialog && !decisionBusy) setDecisionDialog(null);
        else if (!decisionDialog) onClose();
        return;
      }
      if (e.key === 'Enter' && document.activeElement === inputRef.current) {
        e.preventDefault();
        const t = totalRef.current;
        if (t > 0) setActive(a => e.shiftKey ? (a - 1 + t) % t : (a + 1) % t);
      }
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose, decisionDialog, decisionBusy]);

  const openDecision = (status) => {
    if (decisionBusy || decisionComplete || reviewActionsDisabled) return;
    setDecisionFeedback(null);
    setDecisionRemarks('');
    setDecisionDialog(status);
  };

  const submitDecision = async () => {
    if (!decisionDialog || decisionBusy || decisionComplete || !onReviewerDecision) return;
    const validationError = validateReviewerDecision(decisionDialog, decisionRemarks);
    if (validationError) {
      setDecisionFeedback({ type: 'error', message: validationError });
      return;
    }
    setDecisionBusy(true);
    setDecisionFeedback(null);
    try {
      const result = await onReviewerDecision(decisionDialog, decisionRemarks.trim(), { docId, docLabel });
      if (result?.success === false) throw new Error(result.error || 'The reviewer action could not be submitted.');
      const actionLabel = decisionDialog === 'Query Raised' ? 'Query submitted' : decisionDialog === 'Approved' ? 'Application approved' : 'Application rejected';
      setDecisionFeedback({ type: 'success', message: `${actionLabel} successfully.` });
      setDecisionComplete(true);
      setDecisionDialog(null);
      setDecisionRemarks('');
    } catch (error) {
      setDecisionFeedback({ type: 'error', message: error.message || 'The reviewer action could not be submitted.' });
    } finally {
      setDecisionBusy(false);
    }
  };

  const onReady = useCallback((pn, rects) => setPageHl(prev => ({ ...prev, [pn]: rects })), []);
  const onNeedsOcr = useCallback((pn, canvas) => {
    const key = (fileUrl || docId) + ':' + pn;
    if (OCR_CACHE.has(key)) {
      setOcrWords(p => ({ ...p, [pn]: OCR_CACHE.get(key) }));
      setOcrStatus(p => ({ ...p, [pn]: 'done' }));
      return;
    }
    setOcrStatus(p => ({ ...p, [pn]: 'running' }));
    ocrCanvas(canvas).then(w => {
      OCR_CACHE.set(key, w);
      setOcrWords(p => ({ ...p, [pn]: w }));
      setOcrStatus(p => ({ ...p, [pn]: 'done' }));
    }).catch(() => setOcrStatus(p => ({ ...p, [pn]: 'error' })));
  }, [fileUrl, docId]);

  const scale = fitScale ? fitScale * zoom : 0;
  const allMatches = []; const offsets = {};
  let off = 0;
  for (let p = 1; p <= numPages; p++) {
    offsets[p] = off;
    (pageHl[p] || []).forEach((_, i) => allMatches.push({ pageNum: p, rectIdx: i }));
    off += (pageHl[p] || []).length;
  }
  const total = allMatches.length;
  totalRef.current = total;
  const safeIdx = total > 0 ? ((activeIdx % total) + total) % total : 0;
  const cur = allMatches[safeIdx];

  // auto-scroll to active match (fires when new highlights land)
  useEffect(() => {
    if (!cur || !scrollRef.current) return;
    const wrap = pageRefs.current[cur.pageNum];
    if (!wrap) return;
    const rect = (pageHl[cur.pageNum] || [])[cur.rectIdx];
    if (rect) scrollRef.current.scrollTo({ top: wrap.offsetTop + rect.top - 80, behavior: 'smooth' });
  }, [safeIdx, total, effectiveQuery]); // eslint-disable-line

  const ocrRunning = Object.values(ocrStatus).some(s => s === 'running');

  // non-PDF image
  if (isImg) return <ImageViewer fileUrl={fileUrl} fileName={fileName} fileSize={fileSize} onClose={onClose} />;

  // non-PDF, non-image fallback
  if (!isPDF) {
    return createPortal(
      <div className="dv-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
        <div className="dv-modal" style={{ maxHeight: 240 }} onClick={e => e.stopPropagation()}>
          <div className="dv-header">
            <div className="dv-header-left">
              <span className="dv-file-icon">📎</span>
              <div><div className="dv-file-name">{fileName}</div></div>
            </div>
            <button className="dv-close-btn" onClick={onClose}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" width="15" height="15">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div className="dv-no-preview">
            <div style={{ fontSize: 52 }}>📎</div>
            <p style={{ fontWeight: 700 }}>Preview unavailable for this file type</p>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  // PDF viewer with checklist
  return createPortal(
    <div className={`dv-overlay${reviewerMode ? ' dv-overlay-reviewer' : ''}`} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={`dv-modal dv-modal-split${reviewerMode ? ' dv-modal-reviewer' : ''}`} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="dv-header">
          <div className="dv-header-left">
            <span className="dv-file-icon">📄</span>
            <div>
              <div className="dv-file-name" title={fileName}>{fileName}</div>
              <div className="dv-file-meta">
                {fmtSize(fileSize)} · {numPages || '…'} page{numPages !== 1 ? 's' : ''}
                {ocrRunning && <span style={{ color: '#60a5fa', marginLeft: 6, fontSize: 10 }}>· OCR…</span>}
              </div>
            </div>
          </div>
          <div className="dv-toolbar">
            {/* Search */}
            <div className="dv-search-wrap">
              <svg className="dv-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input ref={inputRef} className="dv-search-input" placeholder="Search in document…"
                value={query}
                onChange={e => { setQuery(e.target.value); setHighlightQuery(''); setActive(0); }} />
              {(query || highlightQuery) && (
                <button className="dv-search-clear"
                  onClick={() => { setQuery(''); setHighlightQuery(''); setActive(0); }}>✕</button>
              )}
            </div>
            {effectiveQuery.trim() && (
              <span className="dv-match-badge" style={{
                background: total > 0 ? '#fef3c7' : '#fef2f2',
                color: total > 0 ? '#92400e' : '#dc2626',
                borderRadius: 20, padding: '2px 9px', fontSize: 11, fontWeight: 700,
              }}>
                {total > 0 ? `${safeIdx + 1}/${total}` : '0'}
              </span>
            )}
            {total > 1 && <>
              <button className="dv-tool-btn" onClick={() => setActive(a => (a - 1 + total) % total)}>‹</button>
              <button className="dv-tool-btn" onClick={() => setActive(a => (a + 1) % total)}>›</button>
            </>}
            <div className="dv-sep" />
            {/* Zoom */}
            <button className="dv-tool-btn" onClick={() => setZoom(z => Math.max(.5, +(z - .25).toFixed(2)))} title="Zoom out">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="13" height="13">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" />
              </svg>
            </button>
            <span className="dv-zoom-badge">{Math.round(zoom * 100)}%</span>
            <button className="dv-tool-btn" onClick={() => setZoom(z => Math.min(3, +(z + .25).toFixed(2)))} title="Zoom in">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="13" height="13">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                <line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
              </svg>
            </button>
            <button className="dv-tool-btn" onClick={() => setZoom(1)} style={{ fontSize: 10, width: 'auto', padding: '0 7px' }}>Reset</button>
            <div className="dv-sep" />
            {fileUrl && (
              <a className="dv-tool-btn" href={fileUrl} download={fileName} title="Download">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </a>
            )}
            <button className="dv-close-btn" onClick={onClose}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" width="15" height="15">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Split body: PDF on left, checklist on right */}
        <div className="dv-split-body">
          <div ref={scrollRef} className="dv-split-left">
            {!fileUrl && (
              <div className="dv-no-preview">
                <div style={{ fontSize: 52 }}>📄</div>
                <p>Preview unavailable</p>
              </div>
            )}
            {fileUrl && !pdf && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, color: '#94a3b8' }}>
                <div className="dv-spinner" />
                <span style={{ fontSize: 13 }}>Loading PDF…</span>
              </div>
            )}
            {pdf && numPages > 0 && scale > 0 && Array.from({ length: numPages }, (_, i) => i + 1).map(n => (
              <PdfPage
                key={`${docId}-p${n}`}
                pdf={pdf} pageNum={n} scale={scale}
                query={effectiveQuery} activeGlobal={safeIdx} globalOffset={offsets[n] ?? 0}
                onReady={onReady} onOcrDone={onNeedsOcr}
                wrapRef={el => { pageRefs.current[n] = el; }}
                ocrWords={ocrWords[n] || null}
              />
            ))}
          </div>

          <div className={`dv-split-right${reviewerMode ? ' dv-split-right-reviewer' : ''}`}>
            <ChecklistPanel
              docId={docId}
              docType={docType || docId}
              docLabel={docLabel}
              fileUrl={fileUrl}
              appNumber={appNumber}
              onSearch={(term, pageHint) => {
                // Drive highlighting via highlightQuery — the top search bar
                // stays empty so the reviewer doesn't see typed-in text.
                setHighlightQuery(term);
                setQuery('');
                setActive(0);
                if (pageHint && pageRefs.current[pageHint] && scrollRef.current) {
                  requestAnimationFrame(() => {
                    scrollRef.current?.scrollTo({
                      top: pageRefs.current[pageHint].offsetTop - 20,
                      behavior: 'smooth',
                    });
                  });
                }
              }}
              activeQuery={effectiveQuery}
              reviewerMode={reviewerMode}
            />
          </div>
        </div>

        <div className={`dv-footer${reviewerMode ? ' rvai-decision-footer' : ''}`}>
          {reviewerMode && onReviewerDecision ? (
            <>
              <div className="rvai-decision-feedback" aria-live="polite">
                {decisionFeedback && <span className={`rvai-feedback-${decisionFeedback.type}`}>{decisionFeedback.message}</span>}
                {!decisionFeedback && reviewActionsDisabled && <span>This application already has a final decision.</span>}
                {!decisionFeedback && !reviewActionsDisabled && <span>Select a reviewer decision for this application.</span>}
              </div>
              <div className="rvai-decision-actions">
                <button type="button" className="rvai-action rvai-action-approve" title="Approve application"
                  disabled={decisionBusy || decisionComplete || reviewActionsDisabled} onClick={() => openDecision('Approved')}>
                  <StatusIcon state="approved" />Approve
                </button>
                <button type="button" className="rvai-action rvai-action-query" title="Raise a query requiring applicant clarification"
                  disabled={decisionBusy || decisionComplete || reviewActionsDisabled} onClick={() => openDecision('Query Raised')}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z" /><path d="M9.5 9a2.5 2.5 0 1 1 3.2 2.4c-.7.3-.7.8-.7 1.1M12 15.5h.01" /></svg>
                  Query
                </button>
                <button type="button" className="rvai-action rvai-action-reject" title="Reject application"
                  disabled={decisionBusy || decisionComplete || reviewActionsDisabled} onClick={() => openDecision('Rejected')}>
                  <StatusIcon state="rejected" />Reject
                </button>
              </div>
            </>
          ) : (onVerify || onDecline || onRaiseQuery) && (
            <div className="dv-verdict">
              {verificationResult === 'ok' && <span className="dv-verdict-chip dv-verdict-ok">✓ Verified</span>}
              {verificationResult === 'bad' && <span className="dv-verdict-chip dv-verdict-bad">✗ Declined</span>}
              {onDecline && (
                <button className="dv-verdict-btn dv-verdict-btn-decline"
                  onClick={() => { onDecline(docId, docLabel); onClose(); }}>
                  ✗ Decline
                </button>
              )}
              {onRaiseQuery && (
                <button className="dv-verdict-btn dv-verdict-btn-query"
                  onClick={() => onRaiseQuery(docLabel)}>
                  ❓ Raise Query
                </button>
              )}
              {onVerify && (
                <button className="dv-verdict-btn dv-verdict-btn-verify"
                  onClick={() => { onVerify(docId, docLabel); onClose(); }}>
                  ✓ Verify
                </button>
              )}
            </div>
          )}
        </div>

        {reviewerMode && decisionDialog && (
          <div className="rvai-dialog-backdrop" onClick={e => e.target === e.currentTarget && !decisionBusy && setDecisionDialog(null)}>
            <div className="rvai-dialog" role="dialog" aria-modal="true" aria-labelledby="rvai-dialog-title">
              <div className={`rvai-dialog-icon rvai-dialog-icon-${decisionDialog === 'Approved' ? 'approve' : decisionDialog === 'Rejected' ? 'reject' : 'query'}`}>
                {decisionDialog === 'Query Raised'
                  ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z" /></svg>
                  : <StatusIcon state={decisionDialog === 'Approved' ? 'approved' : 'rejected'} />}
              </div>
              <div className="rvai-dialog-copy">
                <h3 id="rvai-dialog-title">
                  {decisionDialog === 'Approved' ? 'Approve this application?' : decisionDialog === 'Query Raised' ? 'Raise a query' : 'Reject this application?'}
                </h3>
                <p>
                  {decisionDialog === 'Approved'
                    ? 'Confirm that the application and supporting documents meet the review requirements.'
                    : decisionDialog === 'Query Raised'
                      ? 'Explain what clarification or corrected document the applicant must provide.'
                      : 'Provide the specific reason for rejection. This will be recorded in the review history.'}
                </p>
              </div>
              {decisionDialog !== 'Approved' && (
                <label className="rvai-dialog-field">
                  <span>Reviewer remarks <b>*</b></span>
                  <textarea rows="5" value={decisionRemarks} onChange={e => setDecisionRemarks(e.target.value)}
                    placeholder={decisionDialog === 'Query Raised' ? 'Enter the required clarification…' : 'Enter the rejection reason…'}
                    disabled={decisionBusy} autoFocus />
                </label>
              )}
              {decisionFeedback?.type === 'error' && <div className="rvai-dialog-error" role="alert">{decisionFeedback.message}</div>}
              <div className="rvai-dialog-actions">
                <button type="button" className="rvai-dialog-cancel" disabled={decisionBusy} onClick={() => setDecisionDialog(null)}>Cancel</button>
                <button type="button"
                  className={`rvai-dialog-submit rvai-dialog-submit-${decisionDialog === 'Approved' ? 'approve' : decisionDialog === 'Rejected' ? 'reject' : 'query'}`}
                  disabled={decisionBusy || (decisionDialog !== 'Approved' && !decisionRemarks.trim())}
                  onClick={submitDecision} autoFocus={decisionDialog === 'Approved'}>
                  {decisionBusy ? 'Submitting…' : decisionDialog === 'Approved' ? 'Confirm Approval' : decisionDialog === 'Query Raised' ? 'Submit Query' : 'Confirm Rejection'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
