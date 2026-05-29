import React, { useState, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { REQUIRED_DOCUMENTS } from '../../data/mockData';
import './WizardStep.css';

const ACCEPTED = '.pdf,.jpg,.jpeg,.png,.docx';
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function getFileIcon(type) {
  if (type.includes('pdf')) return '📄';
  if (type.includes('image')) return '🖼️';
  if (type.includes('word') || type.includes('docx')) return '📝';
  return '📎';
}

function UploadCard({ doc, uploaded, onUpload, onRemove }) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const inputRef = useRef();

  const handleFile = (file) => {
    if (!file) return;
    if (file.size > MAX_SIZE) { alert('File size must be under 5MB'); return; }
    setUploading(true);
    setProgress(0);
    const interval = setInterval(() => {
      setProgress(p => {
        if (p >= 100) {
          clearInterval(interval);
          setUploading(false);
          onUpload(doc.id, file);
          return 100;
        }
        return p + 20;
      });
    }, 120);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    handleFile(file);
  };

  return (
    <div className={`upload-card ${uploaded ? 'uploaded' : ''} ${dragging ? 'dragging' : ''}`}>
      <div className="upload-card-header">
        <div className="upload-doc-info">
          <span className="upload-doc-icon">{uploaded ? getFileIcon(uploaded.type || '') : '📎'}</span>
          <div>
            <div className="upload-doc-label">
              {doc.label}
              {doc.required && <span className="required" style={{ marginLeft: 4 }}>*</span>}
            </div>
            <div className="upload-doc-hint">{doc.hint}</div>
          </div>
        </div>
        {uploaded && (
          <span className="upload-status-badge">✓ Uploaded</span>
        )}
      </div>

      {uploaded ? (
        <div className="uploaded-file">
          <div className="uploaded-file-info">
            <span className="file-icon">{getFileIcon(uploaded.type || '')}</span>
            <div>
              <div className="file-name">{uploaded.name}</div>
              <div className="file-meta">{formatSize(uploaded.size)} · Uploaded at {uploaded.uploadedAt}</div>
            </div>
          </div>
          <button className="btn btn-danger btn-sm" onClick={() => onRemove(doc.id)}>🗑️ Remove</button>
        </div>
      ) : uploading ? (
        <div className="upload-progress-wrap">
          <div className="upload-progress-label">Uploading... {progress}%</div>
          <div className="upload-progress-bar">
            <div className="upload-progress-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>
      ) : (
        <div
          className="drop-zone"
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current.click()}
        >
          <div className="drop-zone-icon">☁️</div>
          <div className="drop-zone-text">
            <strong>Drag &amp; drop</strong> or <span className="drop-zone-link">click to browse</span>
          </div>
          <div className="drop-zone-hint">PDF, JPG, PNG, DOCX · Max 5MB</div>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED}
            style={{ display: 'none' }}
            onChange={e => handleFile(e.target.files[0])}
          />
        </div>
      )}
    </div>
  );
}

export default function Step5DocumentUpload() {
  const { formData, addDocument, removeDocument, setCurrentStep, saveDraft, draftSaved } = useApp();
  const [submitError, setSubmitError] = useState('');

  const handleNext = () => {
    const missing = REQUIRED_DOCUMENTS.filter(d => d.required && !formData.documents[d.id]);
    if (missing.length > 0) {
      setSubmitError(`Please upload the following required documents: ${missing.map(d => d.label).join(', ')}`);
      return;
    }
    setSubmitError('');
    setCurrentStep(6);
  };

  const uploadedCount = Object.keys(formData.documents).length;
  const requiredCount = REQUIRED_DOCUMENTS.filter(d => d.required).length;
  const requiredUploaded = REQUIRED_DOCUMENTS.filter(d => d.required && formData.documents[d.id]).length;

  return (
    <div className="wizard-step fade-in">
      <div className="step-header">
        <div className="step-header-icon">📁</div>
        <div>
          <h2>Upload Supporting Documents</h2>
          <p>Upload all required documents to support your Export NOC application</p>
        </div>
      </div>

      {/* Upload Summary */}
      <div className="upload-summary-bar">
        <div className="upload-summary-item">
          <span className="summary-num">{uploadedCount}</span>
          <span className="summary-label">Documents Uploaded</span>
        </div>
        <div className="upload-summary-divider" />
        <div className="upload-summary-item">
          <span className="summary-num text-success">{requiredUploaded}</span>
          <span className="summary-label">Required Uploaded</span>
        </div>
        <div className="upload-summary-divider" />
        <div className="upload-summary-item">
          <span className="summary-num text-danger">{requiredCount - requiredUploaded}</span>
          <span className="summary-label">Required Pending</span>
        </div>
        <div className="upload-summary-progress">
          <div className="upload-summary-bar-fill" style={{ width: `${(requiredUploaded / requiredCount) * 100}%` }} />
        </div>
      </div>

      {submitError && (
        <div className="alert alert-danger">
          <span>⚠️</span><span>{submitError}</span>
        </div>
      )}

      <div className="alert alert-info">
        <span>ℹ️</span>
        <span>Accepted formats: <strong>PDF, JPG, PNG, DOCX</strong>. Maximum file size: <strong>5 MB</strong> per document. Documents marked with <strong>*</strong> are mandatory.</span>
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
        <button className="btn btn-outline" onClick={() => setCurrentStep(4)}>← Previous</button>
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
