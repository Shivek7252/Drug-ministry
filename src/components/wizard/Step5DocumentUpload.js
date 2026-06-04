import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { REQUIRED_DOCUMENTS } from '../../data/mockData';
import PDFViewer from '../../pdfviewer';          // ← the working viewer
import './WizardStep.css';
import './DocumentViewer.css';

/* ─── helpers ─────────────────────────────────────────────────────────────── */
const MAX_SIZE = 5 * 1024 * 1024;
const ACCEPTED = '.pdf,.jpg,.jpeg,.png,.docx';

function fmtSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(2) + ' MB';
}
function fileIcon(t = '') {
  if (t.includes('pdf'))   return '📄';
  if (t.includes('image')) return '🖼️';
  if (t.includes('word') || t.includes('docx')) return '📝';
  return '📎';
}

/* ─── PDF fullscreen modal (uses the real PDFViewer) ─────────────────────── */
function PdfViewerModal({ fileObj, fileName, fileSize, onClose }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [inputVal,    setInputVal]    = useState('');
  const inputRef = useRef();

  // Keyboard: Esc to close
  useEffect(() => {
    const fn = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);

  const handleSearch = (val) => {
    setInputVal(val);
    setSearchQuery(val);   // live update — PDFViewer re-highlights on every change
  };

  return (
    <div className="dv-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dv-modal" onClick={(e) => e.stopPropagation()}>

        {/* ── header ── */}
        <div className="dv-header">
          <div className="dv-header-left">
            <span className="dv-file-icon">📄</span>
            <div>
              <div className="dv-file-name" title={fileName}>{fileName}</div>
              <div className="dv-file-meta">{fmtSize(fileSize)} · PDF Document</div>
            </div>
          </div>
          <div className="dv-toolbar">
            {/* search box — passes live value to PDFViewer as searchQuery prop */}
            <div className="dv-search-wrap">
              <svg className="dv-search-icon" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" width="14" height="14">
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                ref={inputRef}
                className="dv-search-input"
                placeholder="Search in document…"
                value={inputVal}
                onChange={(e) => handleSearch(e.target.value)}
              />
              {inputVal && (
                <button className="dv-search-clear"
                  onClick={() => { setInputVal(''); setSearchQuery(''); inputRef.current?.focus(); }}>
                  ✕
                </button>
              )}
            </div>
            {fileObj && (
              <a className="dv-tool-btn"
                href={URL.createObjectURL(fileObj)}
                download={fileName}
                title="Download">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" width="14" height="14">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
              </a>
            )}
            <button className="dv-close-btn" onClick={onClose} title="Close (Esc)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.8" width="15" height="15">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        {/* ── PDFViewer body — searchQuery prop drives highlighting ── */}
        <div className="dv-body dv-pdf-body">
          <PDFViewer
            file={fileObj}
            searchQuery={searchQuery}
            ocrText={null}
            ocrBlocks={null}
          />
        </div>

        {/* ── footer ── */}
        <div className="dv-footer">
          <span className="dv-kbd-hint">
            <kbd>Esc</kbd> Close &nbsp;·&nbsp;
            Type to search · <kbd>Enter</kbd> next match · <kbd>Shift+Enter</kbd> prev
          </span>
        </div>
      </div>
    </div>
  );
}

/* ─── Image fullscreen modal ─────────────────────────────────────────────── */
function ImageViewerModal({ objectUrl, fileName, fileSize, onClose }) {
  const [zoom,     setZoom]     = useState(1);
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    const fn = (e) => {
      if (e.key === 'Escape')            onClose();
      if (e.key === '+' || e.key === '=') setZoom(z => Math.min(+(z+0.25).toFixed(2), 5));
      if (e.key === '-')                  setZoom(z => Math.max(+(z-0.25).toFixed(2), 0.1));
      if (e.key === '0')                  setZoom(1);
      if (e.key === 'r' || e.key === 'R') setRotation(r => (r+90)%360);
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);

  return (
    <div className="dv-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dv-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dv-header">
          <div className="dv-header-left">
            <span className="dv-file-icon">🖼️</span>
            <div>
              <div className="dv-file-name">{fileName}</div>
              <div className="dv-file-meta">{fmtSize(fileSize)}</div>
            </div>
          </div>
          <div className="dv-toolbar">
            <button className="dv-tool-btn" onClick={() => setZoom(z=>Math.min(+(z+0.25).toFixed(2),5))} title="Zoom In (+)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="14" height="14"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
            </button>
            <button className="dv-tool-btn" onClick={() => setZoom(z=>Math.max(+(z-0.25).toFixed(2),0.1))} title="Zoom Out (-)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="14" height="14"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
            </button>
            <button className="dv-tool-btn" onClick={() => { setZoom(1); setRotation(0); }} title="Reset">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="14" height="14"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
            </button>
            <button className="dv-tool-btn" onClick={() => setRotation(r=>(r+90)%360)} title="Rotate (R)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="14" height="14"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            </button>
            <span className="dv-zoom-badge">{Math.round(zoom*100)}%</span>
            <div className="dv-sep"/>
            {objectUrl && (
              <a className="dv-tool-btn" href={objectUrl} download={fileName} title="Download">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              </a>
            )}
            <button className="dv-close-btn" onClick={onClose} title="Close (Esc)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" width="15" height="15"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>
        <div className="dv-body dv-img-body">
          <div className="dv-scroll-area">
            <div className="dv-img-stage" style={{transform:`scale(${zoom}) rotate(${rotation}deg)`}}>
              <img src={objectUrl} alt={fileName} className="dv-img" draggable={false}/>
            </div>
          </div>
        </div>
        <div className="dv-footer">
          <span className="dv-kbd-hint">
            <kbd>Esc</kbd> Close &nbsp;·&nbsp; <kbd>+</kbd><kbd>-</kbd> Zoom &nbsp;·&nbsp; <kbd>R</kbd> Rotate &nbsp;·&nbsp; <kbd>0</kbd> Reset
          </span>
        </div>
      </div>
    </div>
  );
}

/* ─── Upload Card ─────────────────────────────────────────────────────────── */
function UploadCard({ doc, uploaded, onUpload, onRemove }) {
  const [dragging,   setDragging]   = useState(false);
  const [uploading,  setUploading]  = useState(false);
  const [progress,   setProgress]   = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const inputRef   = useRef();
  // Store the actual File object — needed for PDFViewer which calls createObjectURL(file)
  const fileObjRef  = useRef(null);
  const objectUrlRef= useRef(uploaded?.objectUrl || null);

  useEffect(() => {
    if (uploaded?.objectUrl) objectUrlRef.current = uploaded.objectUrl;
  }, [uploaded]);

  const handleFile = (file) => {
    if (!file) return;
    if (file.size > MAX_SIZE) { alert('File size must be under 5MB.'); return; }
    // Keep the actual File object alive in a ref
    fileObjRef.current  = file;
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setUploading(true); setProgress(0);
    let p = 0;
    const iv = setInterval(() => {
      p += 20; setProgress(Math.min(p, 100));
      if (p >= 100) {
        clearInterval(iv); setUploading(false);
        onUpload(doc.id, {
          name: file.name, size: file.size, type: file.type,
          objectUrl: url, uploadedAt: new Date().toLocaleTimeString(),
        });
      }
    }, 120);
  };

  const handleDrop = (e) => {
    e.preventDefault(); setDragging(false);
    handleFile(e.dataTransfer.files[0]);
  };

  const isPDF = uploaded?.type === 'application/pdf';
  const isImg = uploaded?.type?.startsWith('image/');

  return (
    <>
      <div className={`upload-card ${uploaded?'uploaded':''} ${dragging?'dragging':''}`}>

        {/* header */}
        <div className="upload-card-header">
          <div className="upload-doc-info">
            <span className="upload-doc-icon">{uploaded ? fileIcon(uploaded.type) : '📎'}</span>
            <div>
              <div className="upload-doc-label">
                {doc.label}
                {doc.required && <span className="required" style={{marginLeft:4}}>*</span>}
              </div>
              <div className="upload-doc-hint">{doc.hint}</div>
            </div>
          </div>
          <div className="uc-header-right">
            {uploaded && <span className="upload-status-badge">✓ Uploaded</span>}
            {uploaded && (
              <button className="dv-eye-btn" onClick={()=>setViewerOpen(true)}
                title="Preview document" aria-label={`Preview ${doc.label}`}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* body */}
        {uploaded ? (
          <div className="uploaded-file">
            <div className="uploaded-file-info">
              <span className="file-icon">{fileIcon(uploaded.type)}</span>
              <div>
                <div className="file-name">{uploaded.name}</div>
                <div className="file-meta">{fmtSize(uploaded.size)} · {uploaded.uploadedAt}</div>
              </div>
            </div>
            <div className="uc-file-btns">
              <button className="uc-preview-btn" onClick={()=>setViewerOpen(true)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
                Preview
              </button>
              <button className="btn btn-danger btn-sm" onClick={() => {
                if (objectUrlRef.current) { URL.revokeObjectURL(objectUrlRef.current); objectUrlRef.current = null; }
                fileObjRef.current = null;
                onRemove(doc.id);
              }}>🗑️ Remove</button>
            </div>
          </div>
        ) : uploading ? (
          <div className="upload-progress-wrap">
            <div className="upload-progress-label">Uploading... {progress}%</div>
            <div className="upload-progress-bar">
              <div className="upload-progress-fill" style={{width:`${progress}%`}}/>
            </div>
          </div>
        ) : (
          <div className="drop-zone"
            onDragOver={e=>{e.preventDefault();setDragging(true);}}
            onDragLeave={()=>setDragging(false)}
            onDrop={handleDrop}
            onClick={()=>inputRef.current.click()}>
            <div className="drop-zone-icon">☁️</div>
            <div className="drop-zone-text">
              <strong>Drag &amp; drop</strong> or <span className="drop-zone-link">click to browse</span>
            </div>
            <div className="drop-zone-hint">PDF, JPG, PNG, DOCX · Max 5MB</div>
            <input ref={inputRef} type="file" accept={ACCEPTED}
              style={{display:'none'}} onChange={e=>handleFile(e.target.files[0])}/>
          </div>
        )}
      </div>

      {/* viewer modal */}
      {viewerOpen && uploaded && isPDF && fileObjRef.current && (
        <PdfViewerModal
          fileObj={fileObjRef.current}
          fileName={uploaded.name}
          fileSize={uploaded.size}
          onClose={()=>setViewerOpen(false)}
        />
      )}
      {viewerOpen && uploaded && isImg && (
        <ImageViewerModal
          objectUrl={objectUrlRef.current || uploaded.objectUrl}
          fileName={uploaded.name}
          fileSize={uploaded.size}
          onClose={()=>setViewerOpen(false)}
        />
      )}
      {viewerOpen && uploaded && !isPDF && !isImg && (
        <div className="dv-overlay" onClick={()=>setViewerOpen(false)}>
          <div className="dv-modal" style={{maxHeight:260}} onClick={e=>e.stopPropagation()}>
            <div className="dv-header">
              <div className="dv-header-left">
                <span className="dv-file-icon">{fileIcon(uploaded.type)}</span>
                <div><div className="dv-file-name">{uploaded.name}</div></div>
              </div>
              <button className="dv-close-btn" onClick={()=>setViewerOpen(false)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" width="15" height="15"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="dv-body" style={{padding:32,flexDirection:'column',gap:12,textAlign:'center'}}>
              <div style={{fontSize:48}}>{fileIcon(uploaded.type)}</div>
              <p style={{color:'#94a3b8',fontSize:13}}>Preview not available for this file type.</p>
              {objectUrlRef.current && (
                <a href={objectUrlRef.current} download={uploaded.name} className="dv-dl-btn">⬇ Download</a>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ─── Step 5 main ─────────────────────────────────────────────────────────── */
export default function Step5DocumentUpload() {
  const { formData, addDocument, removeDocument, setCurrentStep, saveDraft, draftSaved } = useApp();
  const [submitError, setSubmitError] = useState('');

  const handleNext = () => {
    const missing = REQUIRED_DOCUMENTS.filter(d => d.required && !formData.documents[d.id]);
    if (missing.length > 0) {
      setSubmitError(`Please upload: ${missing.map(d=>d.label).join(', ')}`);
      return;
    }
    setSubmitError(''); setCurrentStep(6);
  };

  const uploaded    = Object.keys(formData.documents).length;
  const reqCount    = REQUIRED_DOCUMENTS.filter(d=>d.required).length;
  const reqUploaded = REQUIRED_DOCUMENTS.filter(d=>d.required&&formData.documents[d.id]).length;

  return (
    <div className="wizard-step fade-in">
      <div className="step-header">
        <div className="step-header-icon">📁</div>
        <div>
          <h2>Upload Supporting Documents</h2>
          <p>Upload all required documents to support your Export NOC application</p>
        </div>
      </div>

      <div className="upload-summary-bar">
        <div className="upload-summary-item">
          <span className="summary-num">{uploaded}</span>
          <span className="summary-label">Documents Uploaded</span>
        </div>
        <div className="upload-summary-divider"/>
        <div className="upload-summary-item">
          <span className="summary-num text-success">{reqUploaded}</span>
          <span className="summary-label">Required Uploaded</span>
        </div>
        <div className="upload-summary-divider"/>
        <div className="upload-summary-item">
          <span className="summary-num text-danger">{reqCount - reqUploaded}</span>
          <span className="summary-label">Required Pending</span>
        </div>
        <div className="upload-summary-progress">
          <div className="upload-summary-bar-fill"
            style={{width:`${reqCount?(reqUploaded/reqCount)*100:0}%`}}/>
        </div>
      </div>

      {submitError && (
        <div className="alert alert-danger"><span>⚠️</span><span>{submitError}</span></div>
      )}

      <div className="alert alert-info">
        <span>ℹ️</span>
        <span>
          Accepted: <strong>PDF, JPG, PNG, DOCX</strong> · Max <strong>5 MB</strong> each.
          Required fields marked <strong>*</strong>.
          Click <strong>👁 Preview</strong> on any uploaded PDF to open a full viewer with search &amp; highlight.
        </span>
      </div>

      <div className="upload-grid">
        {REQUIRED_DOCUMENTS.map(doc => (
          <UploadCard
            key={doc.id}
            doc={doc}
            uploaded={formData.documents[doc.id]}
            onUpload={addDocument}
            onRemove={removeDocument}
          />
        ))}
      </div>

      <div className="step-actions">
        <button className="btn btn-outline" onClick={()=>setCurrentStep(4)}>← Previous</button>
        <button className="btn btn-outline" onClick={saveDraft}>
          {draftSaved ? '✓ Draft Saved' : '💾 Save Draft'}
        </button>
        <button className="btn btn-primary btn-lg" onClick={handleNext}>
          Next: Declaration →
        </button>
      </div>
    </div>
  );
}
