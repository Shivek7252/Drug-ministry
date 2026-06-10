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

/* ─── PDF.js text-layer search ──────────────────────────────────────────── */
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
    const re = new RegExp(escRx(query.replace(/\s+/g, ' ').trim()), 'gi');
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

function getHighlightsFromOcr(query, ocrWords) {
    if (!query?.trim() || !ocrWords?.length) return [];
    const wordMap = []; let joined = '';
    ocrWords.forEach((w, wi) => {
        for (let ci = 0; ci < w.text.length; ci++) wordMap.push({ wi, ci });
        joined += w.text;
        if (wi < ocrWords.length - 1) { wordMap.push({ wi, ci: -1, sep: true }); joined += ' '; }
    });
    const re = new RegExp(escRx(query.replace(/\s+/g, ' ').trim()), 'gi');
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

/* ─── doc-type → checklist key mapping ──────────────────────────────────── */
const DOC_CHECKLISTS = {
    mfg_license: 'manufacturing_license',
    product_approval: 'product_approval',
    export_auth: 'export_authorization',
    qa_cert: 'quality_assurance',
    batch_analysis: 'quality_assurance',
    product_info: 'default',
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

/* ─── AI Checklist Panel ─────────────────────────────────────────────────── */
function ChecklistPanel({ docId, docType, docLabel, fileUrl, onSearch, activeQuery }) {
    const [status, setStatus] = useState('idle');
    const [results, setResults] = useState(null);
    const [summary, setSummary] = useState(null);
    const [errMsg, setErrMsg] = useState('');
    const [activeItem, setActiveItem] = useState(null);

    const checklistKey = DOC_CHECKLISTS[docType || docId] || 'default';

    const run = async () => {
        if (!fileUrl) { setErrMsg('No file available for verification.'); setStatus('error'); return; }
        setStatus('loading'); setResults(null); setSummary(null); setErrMsg('');
        setActiveItem(null);
        if (onSearch) onSearch('');
        try {
            const resp = await fetch(fileUrl);
            if (!resp.ok) throw new Error('Could not read document file.');
            const blob = await resp.blob();
            const form = new FormData();
            form.append('file', blob, docLabel + '.pdf');
            form.append('docType', checklistKey);
            form.append('docLabel', docLabel);
            const apiResp = await fetch('http://localhost:5001/api/verify', { method: 'POST', body: form });
            const data = await apiResp.json();
            if (!apiResp.ok) {
                if (data.error?.includes('MISTRAL_API_KEY')) { setStatus('no-key'); setErrMsg(data.error); return; }
                throw new Error(data.error || 'Verification failed.');
            }
            setResults(data.results); setSummary(data.summary); setStatus('done');
        } catch (e) { setErrMsg(e.message); setStatus('error'); }
    };

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

    const handleItemClick = (r, i) => {
        if (!onSearch || r.present === false) return;
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
                        <div style={{ fontSize: 36, marginBottom: 8 }}>🔑</div>
                        <p style={{ fontWeight: 700, color: '#dc2626', marginBottom: 8 }}>API Key Missing</p>
                        <p style={{ fontSize: 11, color: '#64748b', lineHeight: 1.6, marginBottom: 8 }}>
                            Set your Mistral key in <code style={{ background: '#f1f5f9', padding: '1px 4px', borderRadius: 3 }}>backend/.env</code>:
                        </p>
                        <code style={{ display: 'block', background: '#0f172a', color: '#86efac', padding: '8px', borderRadius: 6, fontSize: 10, fontFamily: 'monospace', wordBreak: 'break-all' }}>
                            MISTRAL_API_KEY=your_key_here
                        </code>
                        <a href="https://console.mistral.ai/" target="_blank" rel="noreferrer"
                            style={{ display: 'block', marginTop: 10, fontSize: 11, color: '#3b82f6', textAlign: 'center' }}>
                            Get API key →
                        </a>
                    </div>
                )}
                {status === 'error' && (
                    <div className="cl-error-state">
                        <div style={{ fontSize: 36, marginBottom: 8 }}>⚠️</div>
                        <p style={{ fontWeight: 700, color: '#dc2626', marginBottom: 6 }}>Verification Failed</p>
                        <p style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>{errMsg}</p>
                        <p style={{ fontSize: 10, color: '#94a3b8', marginBottom: 12 }}>
                            Ensure backend is running:<br /><code>cd backend &amp;&amp; npm start</code>
                        </p>
                        <button className="cl-btn-primary" onClick={run}>Retry</button>
                    </div>
                )}
                {status === 'done' && summary && (
                    <div>
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
                            Click a ✅ item to locate it in the document
                        </div>
                        <div className="cl-items-list">
                            {results.map((r, i) => {
                                const isActive = activeItem === i;
                                const isPresent = r.present === true;
                                const isMissing = r.present === false;
                                const isSearching = isActive && activeQuery;
                                return (
                                    <div key={i}
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
                                                        : <><span className="cl-locate-dot" />Click to locate in PDF</>}
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
                        {activeQuery && (
                            <button className="cl-btn-secondary" style={{ marginBottom: 6 }}
                                onClick={() => { setActiveItem(null); if (onSearch) onSearch(''); }}>
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
export default function DocViewerModal({ docId, docType, docLabel, fileUrl, fileName, fileSize, fileType, onClose, onVerify, onDecline, verificationResult }) {
    const isPDF = fileType?.includes('pdf') || fileName?.toLowerCase().endsWith('.pdf');
    const isImg = fileType?.startsWith('image/');

    const [pdf, setPdf] = useState(null);
    const [numPages, setPages] = useState(0);
    const [fitScale, setFit] = useState(null);
    const [zoom, setZoom] = useState(1.0);
    const [query, setQuery] = useState('');
    const [pageHl, setPageHl] = useState({});
    const [activeIdx, setActive] = useState(0);
    const [ocrStatus, setOcrStatus] = useState({});
    const [ocrWords, setOcrWords] = useState({});

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

    useEffect(() => { setActive(0); }, [query]);

    // keyboard shortcuts
    useEffect(() => {
        const fn = (e) => {
            if (e.key === 'Escape') { onClose(); return; }
            if (e.key === 'Enter' && document.activeElement === inputRef.current) {
                e.preventDefault();
                const t = totalRef.current;
                if (t > 0) setActive(a => e.shiftKey ? (a - 1 + t) % t : (a + 1) % t);
            }
        };
        window.addEventListener('keydown', fn);
        return () => window.removeEventListener('keydown', fn);
    }, [onClose]);

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

    // auto-scroll to active match
    useEffect(() => {
        if (!cur || !scrollRef.current) return;
        const wrap = pageRefs.current[cur.pageNum];
        if (!wrap) return;
        const rect = (pageHl[cur.pageNum] || [])[cur.rectIdx];
        if (rect) scrollRef.current.scrollTo({ top: wrap.offsetTop + rect.top - 80, behavior: 'smooth' });
    }, [safeIdx, total]); // eslint-disable-line

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
                        {/* Search */}
                        <div className="dv-search-wrap">
                            <svg className="dv-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                            </svg>
                            <input ref={inputRef} className="dv-search-input" placeholder="Search in document…"
                                value={query} onChange={e => { setQuery(e.target.value); setActive(0); }} />
                            {query && <button className="dv-search-clear" onClick={() => { setQuery(''); setActive(0); }}>✕</button>}
                        </div>
                        {query.trim() && (
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
                                query={query} activeGlobal={safeIdx} globalOffset={offsets[n] ?? 0}
                                onReady={onReady} onOcrDone={onNeedsOcr}
                                wrapRef={el => { pageRefs.current[n] = el; }}
                                ocrWords={ocrWords[n] || null}
                            />
                        ))}
                    </div>

                    <div className="dv-split-right">
                        <ChecklistPanel
                            docId={docId}
                            docType={docType || docId}
                            docLabel={docLabel}
                            fileUrl={fileUrl}
                            onSearch={term => { setQuery(term); setActive(0); }}
                            activeQuery={query}
                        />
                    </div>
                </div>

                <div className="dv-footer">
                    <span className="dv-kbd-hint">
                        <kbd>Esc</kbd> Close &nbsp;·&nbsp; Type to search &nbsp;·&nbsp;
                        <kbd>Enter</kbd> next · <kbd>Shift+Enter</kbd> prev &nbsp;·&nbsp;
                        <kbd>+</kbd><kbd>−</kbd> Zoom
                    </span>
                    {(onVerify || onDecline) && (
                        <div className="dv-verdict">
                            {verificationResult === 'ok' && <span className="dv-verdict-chip dv-verdict-ok">✓ Verified</span>}
                            {verificationResult === 'bad' && <span className="dv-verdict-chip dv-verdict-bad">✗ Declined</span>}
                            {onDecline && (
                                <button className="dv-verdict-btn dv-verdict-btn-decline"
                                    onClick={() => { onDecline(docId, docLabel); onClose(); }}>
                                    ✗ Decline
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
            </div>
        </div>,
        document.body
    );
}
