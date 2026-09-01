import React, { useState, useRef, useEffect, useCallback } from 'react';
import { pdfjsLib, pdfDocumentParams } from '../../config/pdfWorker';
import { useApp } from '../../context/AppContext';
import { REQUIRED_DOCUMENTS } from '../../data/mockData';
import { BACKEND_ORIGIN } from '../../config/api';
import { authenticatedFetch } from '../../api/http';
import './WizardStep.css';
import './DocumentViewer.css';

/* pdf.js worker + credentials are configured centrally. */

/* ─── module-level stores ───────────────────────────────────────────────── */
const FILE_STORE = new Map();
const URL_CACHE = new Map();
// OCR cache: blobUrl+pageNum → { words: [{text, bbox}] }
const OCR_CACHE = new Map();

function getStableUrl(docId, fallback) {
  if (!URL_CACHE.has(docId) && FILE_STORE.has(docId))
    URL_CACHE.set(docId, URL.createObjectURL(FILE_STORE.get(docId)));
  return URL_CACHE.get(docId) || fallback || null;
}
function clearDocStores(docId) {
  const u = URL_CACHE.get(docId);
  if (u) URL.revokeObjectURL(u);
  URL_CACHE.delete(docId);
  FILE_STORE.delete(docId);
}

/* ─── helpers ───────────────────────────────────────────────────────────── */
const MAX_SIZE = 5 * 1024 * 1024;
const ACCEPTED = '.pdf,.jpg,.jpeg,.png,.docx';
function fmtSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(2) + ' MB';
}
function fileIcon(t = '') {
  if (t.includes('pdf')) return '📄';
  if (t.includes('image')) return '🖼️';
  if (t.includes('word') || t.includes('docx')) return '📝';
  return '📎';
}
function escRx(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/* ─── Detect if PDF.js text layer is usable (not PUA-encoded) ──────────── */
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

/* ─── PDF.js text-layer search ─────────────────────────────────────────── */
function escapeRx(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function getHighlightsFromTextLayer(query, items, vp) {
  if (!query?.trim() || !items?.length || !vp) return [];
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
  const re = new RegExp(escapeRx(query.replace(/\s+/g, ' ').trim()), 'gi');
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

/* ─── OCR via Tesseract.js (loaded from CDN) ────────────────────────────── */
// Returns array of word objects: { text: string, bbox: {x0,y0,x1,y1} }
// bbox is in canvas pixels at the scale we rendered at.
let tesseractWorker = null;
let tesseractReady = false;
let tesseractLoading = false;
const tesseractCallbacks = [];

async function getTesseractWorker() {
  if (tesseractReady && tesseractWorker) return tesseractWorker;
  if (tesseractLoading) {
    return new Promise((res) => tesseractCallbacks.push(res));
  }
  tesseractLoading = true;

  // Dynamically load Tesseract.js from CDN if not already present
  if (!window.Tesseract) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      s.onload = res;
      s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  const worker = await window.Tesseract.createWorker('eng', 1, {
    workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
    corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core-simd-lstm.wasm.js',
    langPath: 'https://tessdata.projectnaptha.com/4.0.0',
    logger: () => { }, // silence progress logs
  });

  tesseractWorker = worker;
  tesseractReady = true;
  tesseractLoading = false;
  tesseractCallbacks.forEach(cb => cb(worker));
  tesseractCallbacks.length = 0;
  return worker;
}

// Run OCR on a canvas element, return word-level results
async function ocrCanvas(canvas) {
  const worker = await getTesseractWorker();
  const { data } = await worker.recognize(canvas);
  const words = [];
  for (const block of (data.blocks || [])) {
    for (const para of (block.paragraphs || [])) {
      for (const line of (para.lines || [])) {
        for (const word of (line.words || [])) {
          const t = word.text?.trim();
          if (t && word.confidence > 30) {
            words.push({
              text: t,
              bbox: word.bbox, // {x0, y0, x1, y1} in canvas px
            });
          }
        }
      }
    }
  }
  return words;
}

// Search OCR words and return highlight rects (canvas-px coordinates)
function getHighlightsFromOcr(query, ocrWords) {
  if (!query?.trim() || !ocrWords?.length) return [];

  // Build a flat string from all words (space-separated) with word index map
  const wordMap = []; // index in joined string → word index
  let joined = '';
  ocrWords.forEach((w, wi) => {
    for (let ci = 0; ci < w.text.length; ci++) wordMap.push({ wi, ci });
    joined += w.text;
    if (wi < ocrWords.length - 1) { wordMap.push({ wi, ci: -1, sep: true }); joined += ' '; }
  });

  const q = query.replace(/\s+/g, ' ').trim();
  const re = new RegExp(escRx(q), 'gi');
  const rects = [];
  let m;

  while ((m = re.exec(joined)) !== null) {
    // Find which words are spanned by this match
    const spanStart = m.index;
    const spanEnd = m.index + m[0].length - 1;
    const spanned = new Set();
    for (let i = spanStart; i <= spanEnd && i < wordMap.length; i++) {
      if (!wordMap[i].sep) spanned.add(wordMap[i].wi);
    }
    // Create one rect per spanned word
    for (const wi of spanned) {
      const { bbox } = ocrWords[wi];
      rects.push({
        left: bbox.x0,
        top: bbox.y0,
        width: bbox.x1 - bbox.x0,
        height: bbox.y1 - bbox.y0,
      });
    }
  }
  return rects;
}

/* ─── Single PDF page ───────────────────────────────────────────────────── */
function PdfPage({
  pdf, pageNum, scale, query,
  activeGlobal, globalOffset,
  onReady, onOcrDone,
  wrapRef, ocrWords,
}) {
  const canvasRef = useRef();
  const renderRef = useRef(null);
  const dataRef = useRef({ items: [], vp: null, loaded: false, usable: false });

  const [hl, setHl] = useState([]);
  const [textItems, setItems] = useState([]);
  const [vp, setVp] = useState(null);

  // ── Render page + extract text ──────────────────────────────────────────
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
          // Digital PDF — use text layer
          const rects = getHighlightsFromTextLayer(query, items, viewport);
          setHl(rects);
          onReady(pageNum, rects);
        } else {
          // Scanned/encoded PDF — trigger OCR on this canvas
          onReady(pageNum, []); // register page with 0 matches for now
          onOcrDone && onOcrDone(pageNum, canvas); // ask parent to OCR
        }
      } catch (err) {
        console.error(`PdfPage render error page ${pageNum}:`, err);
      }
    })();

    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, pageNum, scale]);

  // ── Recompute highlights when query or ocrWords change ─────────────────
  useEffect(() => {
    const { items, vp: viewport, loaded, usable } = dataRef.current;
    if (!loaded || !viewport) return;

    if (usable) {
      const rects = getHighlightsFromTextLayer(query, items, viewport);
      setHl(rects);
      onReady(pageNum, rects);
    } else if (ocrWords) {
      const rects = getHighlightsFromOcr(query, ocrWords);
      setHl(rects);
      onReady(pageNum, rects);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, ocrWords]);

  return (
    <div
      ref={wrapRef}
      style={{
        position: 'relative', display: 'inline-block',
        boxShadow: '0 2px 12px rgba(0,0,0,.3)',
        marginBottom: 16, lineHeight: 0, flexShrink: 0,
      }}
    >
      <canvas ref={canvasRef} style={{ display: 'block' }} />

      {/* Text selection layer (digital PDFs only) */}
      {vp && textItems.map((item, i) => {
        if (!item.str) return null;
        const [, , , scY, tx, ty] = item.transform;
        const fs = Math.abs(scY) * vp.scale;
        const iw = item.width * vp.scale;
        const ang = Math.atan2(item.transform[1], item.transform[0]) * (180 / Math.PI);
        const sX = fs > 0 && iw > 0 ? iw / (item.str.length * fs * 0.6) : 1;
        return (
          <span key={i} style={{
            position: 'absolute', left: tx * vp.scale,
            top: vp.height - ty * vp.scale - fs,
            width: iw, height: fs + 2, fontSize: fs,
            fontFamily: item.fontName || 'sans-serif',
            color: 'transparent', whiteSpace: 'pre',
            userSelect: 'text', WebkitUserSelect: 'text', cursor: 'text',
            transformOrigin: '0% 100%',
            transform: `${ang ? `rotate(${ang}deg) ` : ''}scaleX(${sX})`,
          }}>{item.str}</span>
        );
      })}

      {/* Highlight boxes */}
      {hl.map((r, i) => {
        const active = (globalOffset + i) === activeGlobal;
        return (
          <div key={i} style={{
            position: 'absolute',
            left: r.left, top: r.top, width: r.width, height: r.height,
            background: active ? 'rgba(251,191,36,.9)' : 'rgba(254,240,138,.6)',
            border: '1.5px solid ' + (active ? '#d97706' : '#f59e0b'),
            borderRadius: 2, pointerEvents: 'none', zIndex: 10,
            mixBlendMode: 'multiply',
          }} />
        );
      })}
    </div>
  );
}

/* ─── PDF Viewer Modal ──────────────────────────────────────────────────── */
/* ─── doc-type checklist mapping ───────────────────────────────────────── */
const DOC_CHECKLISTS = {
  mfg_license: 'manufacturing_license',
  product_approval: 'product_approval',
  export_auth: 'export_authorization',
  qa_cert: 'quality_assurance',
  batch_analysis: 'quality_assurance',
  product_info: 'default',
};

/* ─── ChecklistPanel ────────────────────────────────────────────────────── */
export function ChecklistPanel({ docId, docLabel, viewUrl, onSearch, activeQuery }) {
  const [status, setStatus] = React.useState('idle');
  const [results, setResults] = React.useState(null);
  const [summary, setSummary] = React.useState(null);
  const [errMsg, setErrMsg] = React.useState('');
  const [activeItem, setActiveItem] = React.useState(null);

  const run = async () => {
    if (!viewUrl) { setErrMsg('No file available.'); setStatus('error'); return; }
    setStatus('loading'); setResults(null); setSummary(null); setErrMsg('');
    setActiveItem(null);
    if (onSearch) onSearch('');
    try {
      const resp = await authenticatedFetch(viewUrl);
      if (!resp.ok) throw new Error('Could not read document file.');
      const blob = await resp.blob();
      const form = new FormData();
      form.append('file', blob, docLabel + '.pdf');
      form.append('docType', DOC_CHECKLISTS[docId] || 'default');
      form.append('docLabel', docLabel);
      const apiResp = await authenticatedFetch(`${BACKEND_ORIGIN}/api/verify`, { method: 'POST', body: form });
      const data = await apiResp.json();
      if (!apiResp.ok) {
        throw new Error('Anuvadini AI analysis is temporarily unavailable. Please try again shortly.');
      }
      setResults(data.results); setSummary(data.summary); setStatus('done');
    } catch (e) { setErrMsg(e.message); setStatus('error'); }
  };

  // Extract the most meaningful search term from a checklist item label
  const getSearchTerm = (item, note) => {
    // If note contains a specific value (e.g. a number, name), use it
    if (note) {
      // Extract quoted values or values after ":" 
      const quoted = note.match(/"([^"]+)"|'([^']+)'|:\s*([A-Z][A-Za-z0-9\s\-/]{2,30})/);
      if (quoted) return (quoted[1] || quoted[2] || quoted[3] || '').trim();
    }
    // Extract key noun phrases from the item label
    // Remove common filler words and extract the core noun
    const label = item
      .replace(/\bis\b|\bare\b|\bhas\b|\bhave\b|\bof\b|\bthe\b|\ba\b|\ban\b|\bin\b|\bfor\b|\bby\b|\bon\b/gi, ' ')
      .replace(/present|mentioned|available|listed|included|stated|visible|identified|specified/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Get significant words (length > 3, not common)
    const words = label.split(/\s+/).filter(w => w.length > 3);
    // Return up to 3 most meaningful words
    return words.slice(0, 3).join(' ').trim() || item.split(' ').slice(0, 2).join(' ');
  };

  const handleItemClick = (r, i) => {
    if (!onSearch || r.present === false) return; // don't search for missing items
    const term = getSearchTerm(r.item, r.note);
    if (!term) return;
    setActiveItem(i);
    onSearch(term);
  };

  const score = summary?.score ?? 0;
  const sc = score >= 75 ? '#16a34a' : score >= 50 ? '#d97706' : '#dc2626';
  const sb = score >= 75 ? '#f0fdf4' : score >= 50 ? '#fffbeb' : '#fef2f2';

  return (
    <div className="cl-panel">
      <div className="cl-header">
        <span className="cl-header-icon">🤖</span>
        <div>
          <div className="cl-header-title">AI Document Verification</div>
          <div className="cl-header-sub">Powered by ANUVADINI AI</div>
        </div>
      </div>
      <div className="cl-body">
        {status === 'idle' && (
          <div className="cl-idle">
            <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
            <p style={{ fontWeight: 700, color: '#1e293b', marginBottom: 6 }}>Verify Document Completeness</p>
            <p style={{ fontSize: 12, color: '#64748b', marginBottom: 16, lineHeight: 1.6 }}>
              Check if this {docLabel} contains all required information for the Export NOC application.
            </p>
            <button className="cl-btn-primary" onClick={run}>
              🔍 Run AI Verification
            </button>
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
              The Anuvadini AI analysis service is currently unavailable.
              Please try again later.
            </p>
            <button className="cl-btn-primary" onClick={run}>Retry</button>
          </div>
        )}
        {status === 'error' && (
          <div className="cl-error-state">
            <div style={{ fontSize: 36, marginBottom: 8 }}>🔄</div>
            <p style={{ fontWeight: 700, color: '#d97706', marginBottom: 6 }}>Analysis Temporarily Unavailable</p>
            <p style={{ fontSize: 12, color: '#64748b', lineHeight: 1.7, marginBottom: 16 }}>
              {errMsg || 'The Anuvadini AI analysis service encountered a network issue. Please try again.'}
            </p>
            <button className="cl-btn-primary" onClick={run}>Retry</button>
          </div>
        )}
        {status === 'done' && summary && (
          <div>
            <div className="cl-score" style={{ background: sb, borderColor: sc + '55' }}>
              <div className="cl-score-num" style={{ color: sc }}>{score}%</div>
              <div className="cl-score-label">Completeness Score</div>
              <div className="cl-score-bar-wrap"><div className="cl-score-bar-fill" style={{ width: `${score}%`, background: sc }} /></div>
              <div className="cl-score-row">
                <span className="cl-cnt yes">✓ {summary.present}</span>
                <span className="cl-cnt no">✗ {summary.missing}</span>
                {summary.unknown > 0 && <span className="cl-cnt unk">? {summary.unknown}</span>}
              </div>
            </div>

            {/* Click-to-locate hint */}
            <div className="cl-locate-hint">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              Click a ✅ item to locate it in the document
            </div>

            <div className="cl-items-list">
              {results.map((r, i) => {
                const isActive = activeItem === i;
                const isPresent = r.present === true;
                const isMissing = r.present === false;
                const isSearching = isActive && activeQuery;
                return (
                  <div
                    key={i}
                    className={`cl-item ${isMissing ? 'cl-item-no' : isPresent ? 'cl-item-yes' : 'cl-item-unk'} ${isPresent ? 'cl-item-clickable' : ''} ${isActive ? 'cl-item-active' : ''}`}
                    onClick={() => handleItemClick(r, i)}
                    title={isPresent ? `Click to find "${getSearchTerm(r.item, r.note)}" in document` : isMissing ? 'Not found in document' : ''}
                  >
                    <span className="cl-item-icon">
                      {isSearching ? '🔍' : isMissing ? '❌' : isPresent ? '✅' : '❓'}
                    </span>
                    <div className="cl-item-text">
                      <div className="cl-item-label">{r.item}</div>
                      {isPresent && (
                        <div className="cl-locate-tag">
                          {isActive && activeQuery
                            ? <><span className="cl-locate-dot active" />Searching: <em>{activeQuery}</em></>
                            : <><span className="cl-locate-dot" />Click to locate in PDF</>
                          }
                        </div>
                      )}
                      {r.note && <div className="cl-item-note">{r.note}</div>}
                    </div>
                    <span className={`cl-badge ${isMissing ? 'cl-badge-no' : isPresent ? 'cl-badge-yes' : 'cl-badge-unk'}`}>
                      {isMissing ? 'NO' : isPresent ? 'YES' : '?'}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Clear search button */}
            {activeQuery && (
              <button className="cl-btn-secondary" style={{ marginBottom: 6 }} onClick={() => { setActiveItem(null); if (onSearch) onSearch(''); }}>
                ✕ Clear Location Search
              </button>
            )}
            <button className="cl-btn-secondary" onClick={run}>🔄 Re-run Verification</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── PDF Viewer Modal (split screen) ───────────────────────────────────── */
function PdfViewerModal({ docId, docLabel, fallbackUrl, fileName, fileSize, onClose }) {
  const [pdf, setPdf] = useState(null);
  const [numPages, setPages] = useState(0);
  const [fitScale, setFit] = useState(null);
  const [zoom, setZoom] = useState(1.0);
  const [query] = useState('');
  const [pageHl, setPageHl] = useState({});
  const [activeIdx, setActive] = useState(0);
  const [ocrStatus, setOcrStatus] = useState({});
  const [ocrWords, setOcrWords] = useState({});
  const scrollRef = useRef();
  const pageRefs = useRef({});
  const totalRef = useRef(0);
  const viewUrl = getStableUrl(docId, fallbackUrl);

  useEffect(() => {
    if (!viewUrl) return;
    let cancelled = false;
    setPdf(null); setPages(0); setFit(null); setPageHl({}); setActive(0);
    pdfjsLib.getDocument(pdfDocumentParams(viewUrl)).promise
      .then(d => { if (!cancelled) { setPdf(d); setPages(d.numPages); } })
      .catch(e => { if (!cancelled) console.error('PDF:', e); });
    return () => { cancelled = true; };
  }, [viewUrl]);

  useEffect(() => {
    if (!pdf || !scrollRef.current) return;
    pdf.getPage(1).then(p => {
      const cw = scrollRef.current?.clientWidth || 480;
      const base = p.getViewport({ scale: 1 });
      setFit(Math.min(cw - 24, 620) / base.width);
    });
  }, [pdf]);

  useEffect(() => { setActive(0); }, [query]);

  useEffect(() => {
    const fn = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);

  const onReady = useCallback((pn, rects) => setPageHl(prev => ({ ...prev, [pn]: rects })), []);
  const onNeedsOcr = useCallback((pn, canvas) => {
    const key = (viewUrl || docId) + ':' + pn;
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
  }, [viewUrl, docId]);

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

  useEffect(() => {
    if (!cur || !scrollRef.current) return;
    const wrap = pageRefs.current[cur.pageNum];
    if (!wrap) return;
    const rect = (pageHl[cur.pageNum] || [])[cur.rectIdx];
    if (rect) scrollRef.current.scrollTo({ top: wrap.offsetTop + rect.top - 80, behavior: 'smooth' });
  }, [safeIdx, total]); // eslint-disable-line

  const ocrRunning = Object.values(ocrStatus).some(s => s === 'running');

  return (
    <div className="dv-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="dv-modal dv-modal-split" onClick={e => e.stopPropagation()}>

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
            <button className="dv-tool-btn" onClick={() => setZoom(z => Math.max(.5, +(z - .25).toFixed(2)))} title="Zoom out">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="13" height="13"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" /></svg>
            </button>
            <span className="dv-zoom-badge">{Math.round(zoom * 100)}%</span>
            <button className="dv-tool-btn" onClick={() => setZoom(z => Math.min(3, +(z + .25).toFixed(2)))} title="Zoom in">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="13" height="13"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" /></svg>
            </button>
            <button className="dv-close-btn" onClick={onClose}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" width="15" height="15"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        </div>

        {/* PDF body (preview only) */}
        <div className="dv-split-body">
          <div ref={scrollRef} className="dv-split-left">
            {!viewUrl && <div className="dv-no-preview"><div style={{ fontSize: 52 }}>📄</div><p>Preview unavailable</p></div>}
            {viewUrl && !pdf && <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, color: '#94a3b8' }}><div className="dv-spinner" /><span style={{ fontSize: 13 }}>Loading…</span></div>}
            {pdf && numPages > 0 && scale > 0 && Array.from({ length: numPages }, (_, i) => i + 1).map(n => (
              <PdfPage key={fileName + '-p' + n} pdf={pdf} pageNum={n} scale={scale}
                query={query} activeGlobal={safeIdx} globalOffset={offsets[n] ?? 0}
                onReady={onReady} onOcrDone={onNeedsOcr}
                wrapRef={el => { pageRefs.current[n] = el; }}
                ocrWords={ocrWords[n] || null} />
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}


/* ─── Image Viewer Modal ────────────────────────────────────────────────── */
function ImageViewerModal({ docId, fallbackUrl, fileName, fileSize, onClose }) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const viewUrl = getStableUrl(docId, fallbackUrl);
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
  return (
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
            <button className="dv-tool-btn" onClick={() => setZoom(z => Math.min(+(z + .25).toFixed(2), 5))}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="14" height="14">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                <line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
              </svg>
            </button>
            <button className="dv-tool-btn" onClick={() => setZoom(z => Math.max(+(z - .25).toFixed(2), .1))}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="14" height="14">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                <line x1="8" y1="11" x2="14" y2="11" />
              </svg>
            </button>
            <button className="dv-tool-btn" onClick={() => { setZoom(1); setRotation(0); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="14" height="14">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" />
              </svg>
            </button>
            <button className="dv-tool-btn" onClick={() => setRotation(r => (r + 90) % 360)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="14" height="14">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            </button>
            <span className="dv-zoom-badge">{Math.round(zoom * 100)}%</span>
            <div className="dv-sep" />
            {viewUrl && (
              <a className="dv-tool-btn" href={viewUrl} download={fileName}>
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
        <div className="dv-body dv-img-body">
          <div className="dv-scroll-area">
            <div className="dv-img-stage" style={{ transform: `scale(${zoom}) rotate(${rotation}deg)` }}>
              {viewUrl && <img src={viewUrl} alt={fileName} className="dv-img" draggable={false} />}
            </div>
          </div>
        </div>
        <div className="dv-footer">
          <span className="dv-kbd-hint">
            <kbd>Esc</kbd> Close · <kbd>+</kbd><kbd>-</kbd> Zoom · <kbd>R</kbd> Rotate · <kbd>0</kbd> Reset
          </span>
        </div>
      </div>
    </div>
  );
}

/* ─── Upload Card ───────────────────────────────────────────────────────── */
function UploadCard({ doc, uploaded, verification, onUpload, onRemove }) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const inputRef = useRef();
  const isPDF = uploaded?.type === 'application/pdf';
  const isImg = uploaded?.type?.startsWith('image/');

  const handleFile = useCallback((file) => {
    if (!file) return;
    if (file.size > MAX_SIZE) { alert('File size must be under 5MB.'); return; }
    FILE_STORE.set(doc.id, file); URL_CACHE.delete(doc.id);
    setUploading(true); setProgress(0);

    const reader = new FileReader();
    reader.onerror = () => { setUploading(false); alert('Could not read file.'); };
    reader.onload = () => {
      const base64 = reader.result; // data:<mime>;base64,...
      let p = 0;
      const iv = setInterval(() => {
        p += 20; setProgress(Math.min(p, 100));
        if (p >= 100) {
          clearInterval(iv); setUploading(false);
          const url = getStableUrl(doc.id, null);
          onUpload(doc.id, {
            name: file.name, size: file.size, type: file.type,
            objectUrl: url || '',
            data: base64,
            uploadedAt: new Date().toLocaleTimeString(),
          }, file);
        }
      }, 120);
    };
    reader.readAsDataURL(file);
  }, [doc.id, onUpload]);

  const handleDrop = (e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); };

  return (
    <>
      <div className={`upload-card ${uploaded ? 'uploaded' : ''} ${verification?.status === 'verified' ? 'verification-verified' : ''} ${verification?.status === 'failed' || verification?.status === 'error' ? 'verification-failed' : ''} ${dragging ? 'dragging' : ''}`}>
        <div className="upload-card-header">
          <div className="upload-doc-info">
            <span className="upload-doc-icon">{uploaded ? fileIcon(uploaded.type) : '📎'}</span>
            <div>
              <div className="upload-doc-label">
                {doc.label}{doc.required && <span className="required" style={{ marginLeft: 4 }}>*</span>}
              </div>
              <div className="upload-doc-hint">{doc.hint}</div>
            </div>
          </div>
          <div className="uc-header-right">
            {uploaded && !verification && <span className="upload-status-badge">✓ Uploaded</span>}
            {verification?.status === 'loading' && <span className="upload-status-badge verification-loading">🤖 Analyzing...</span>}
            {verification?.status === 'verified' && <span className="upload-status-badge verification-badge-ok">✓ AI Verified</span>}
            {(verification?.status === 'failed' || verification?.status === 'error') && <span className="upload-status-badge verification-badge-failed">✕ AI Issue</span>}
          </div>
        </div>
        {uploaded ? (
          <>
          <div className="uploaded-file">
            <div className="uploaded-file-info">
              <span className="file-icon">{fileIcon(uploaded.type)}</span>
              <div>
                <div className="file-name">{uploaded.name}</div>
                <div className="file-meta">{fmtSize(uploaded.size)} · {uploaded.uploadedAt}</div>
              </div>
            </div>
            <div className="uc-file-btns">
              <button className="uc-preview-btn" onClick={() => setViewerOpen(true)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                </svg>
                Preview
              </button>
              <button className="btn btn-danger btn-sm"
                onClick={() => { clearDocStores(doc.id); onRemove(doc.id); }}>🗑️ Remove</button>
            </div>
          </div>
          {verification?.status === 'verified' && (
            <div className="document-verification-message verification-message-ok">✓ AI verification passed. Document appears correct and complete.</div>
          )}
          {(verification?.status === 'failed' || verification?.status === 'error') && (
            <div className="document-verification-message verification-message-failed">✕ AI verification found an issue. Review this document before continuing.</div>
          )}
          </>
        ) : uploading ? (
          <div className="upload-progress-wrap">
            <div className="upload-progress-label">Uploading... {progress}%</div>
            <div className="upload-progress-bar">
              <div className="upload-progress-fill" style={{ width: `${progress}%` }} />
            </div>
          </div>
        ) : (
          <div className="drop-zone"
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop} onClick={() => inputRef.current.click()}>
            <div className="drop-zone-icon">☁️</div>
            <div className="drop-zone-text">
              <strong>Drag &amp; drop</strong> or <span className="drop-zone-link">click to browse</span>
            </div>
            <div className="drop-zone-hint">PDF, JPG, PNG, DOCX · Max 5MB</div>
            <input ref={inputRef} type="file" accept={ACCEPTED} style={{ display: 'none' }}
              onChange={e => handleFile(e.target.files[0])} />
          </div>
        )}
      </div>

      {viewerOpen && uploaded && isPDF && (
        <PdfViewerModal docId={doc.id} docLabel={doc.label} fallbackUrl={uploaded.objectUrl}
          fileName={uploaded.name} fileSize={uploaded.size} onClose={() => setViewerOpen(false)} />
      )}
      {viewerOpen && uploaded && isImg && (
        <ImageViewerModal docId={doc.id} fallbackUrl={uploaded.objectUrl}
          fileName={uploaded.name} fileSize={uploaded.size} onClose={() => setViewerOpen(false)} />
      )}
      {viewerOpen && uploaded && !isPDF && !isImg && (
        <div className="dv-overlay" onClick={() => setViewerOpen(false)}>
          <div className="dv-modal" style={{ maxHeight: 240 }} onClick={e => e.stopPropagation()}>
            <div className="dv-header">
              <div className="dv-header-left">
                <span className="dv-file-icon">{fileIcon(uploaded.type)}</span>
                <div><div className="dv-file-name">{uploaded.name}</div></div>
              </div>
              <button className="dv-close-btn" onClick={() => setViewerOpen(false)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" width="15" height="15">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="dv-no-preview">
              <div style={{ fontSize: 52 }}>{fileIcon(uploaded.type)}</div>
              <p style={{ fontWeight: 700 }}>Preview unavailable</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ─── Step 5 Main ───────────────────────────────────────────────────────── */
export default function Step5DocumentUpload() {
  const { formData, addDocument, removeDocument, setCurrentStep, saveDraft, draftSaved } = useApp();
  const [submitError, setSubmitError] = useState('');
  const [verification, setVerification] = useState({});

  const verifyUploadedDocument = async (doc, file) => {
    setVerification(prev => ({ ...prev, [doc.id]: { status: 'loading' } }));
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      form.append('docType', DOC_CHECKLISTS[doc.id] || 'default');
      form.append('docLabel', doc.label);
      const response = await authenticatedFetch(`${BACKEND_ORIGIN}/api/verify`, { method: 'POST', body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Verification failed');
      const passed = data.documentTypeMatch === true &&
        data.summary?.total > 0 && data.summary.missing === 0 && data.summary.unknown === 0;
      setVerification(prev => ({ ...prev, [doc.id]: { status: passed ? 'verified' : 'failed', data } }));
    } catch (error) {
      setVerification(prev => ({ ...prev, [doc.id]: { status: 'error', error: error.message } }));
    }
  };

  const handleUpload = (docId, fileData, file) => {
    addDocument(docId, fileData);
    const doc = REQUIRED_DOCUMENTS.find(item => item.id === docId);
    if (doc && file) verifyUploadedDocument(doc, file);
  };

  const handleRemove = (docId) => {
    removeDocument(docId);
    setVerification(prev => {
      const next = { ...prev };
      delete next[docId];
      return next;
    });
  };

  const handleNext = () => {
    const missing = REQUIRED_DOCUMENTS.filter(d => d.required && !formData.documents[d.id]);
    if (missing.length > 0) { setSubmitError(`Please upload: ${missing.map(d => d.label).join(', ')}`); return; }
    setSubmitError(''); setCurrentStep(7);
  };
  return (
    <div className="wizard-step fade-in">
      <div className="step-header">
        <div className="step-header-icon">📁</div>
        <div><h2>Upload Supporting Documents</h2><p>Upload all required documents to support your Export NOC application</p></div>
      </div>
      {submitError && <div className="alert alert-danger"><span>⚠️</span><span>{submitError}</span></div>}
      <div className="alert alert-info">
        <span>ℹ️</span>
        <span>Accepted: <strong>PDF, JPG, PNG, DOCX</strong> · Max <strong>5 MB</strong>. Required fields marked <strong>*</strong>. Click <strong>👁 Preview</strong> to view with search &amp; OCR highlighting.</span>
      </div>
      <div className="upload-grid">
        {REQUIRED_DOCUMENTS.map(doc => (
          <UploadCard key={doc.id} doc={doc} uploaded={formData.documents[doc.id]} verification={verification[doc.id]} onUpload={handleUpload} onRemove={handleRemove} />
        ))}
      </div>
      <div className="step-actions">
        <button className="btn btn-outline" onClick={() => setCurrentStep(5)}>← Previous</button>
        <button className="btn btn-outline" onClick={saveDraft}>{draftSaved ? '✓ Draft Saved' : '💾 Save Draft'}</button>
        <button className="btn btn-primary btn-lg" onClick={handleNext}>Next: Declaration →</button>
      </div>
    </div>
  );
}
