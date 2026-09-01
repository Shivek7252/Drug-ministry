import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  getReconciliation,
  addReconciliationEntry,
  updateReconciliationEntry,
  deleteReconciliationEntry,
} from '../../api/applicationService';
import { useApp } from '../../context/AppContext';
import './ReconciliationPage.css';

/* ── helpers ─────────────────────────────────────────────────────────────── */
function fmt(n) {
  if (n === null || n === undefined || n === '') return '—';
  return String(n);
}
function fmtDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-IN'); } catch { return d; }
}
function fmtNum(n) {
  const f = parseFloat(n);
  return isNaN(f) ? '—' : f.toLocaleString('en-IN');
}

/* shelf-life badge */
function ShelfBadge({ status, pct }) {
  if (!status || status === 'ok') {
    return <span className="recon-shelf recon-shelf-ok">✓ OK {pct != null ? `(${pct}%)` : ''}</span>;
  }
  if (status === 'warning') {
    return <span className="recon-shelf recon-shelf-warn">⚠ Low {pct != null ? `(${pct}%)` : ''}</span>;
  }
  return (
    <span className="recon-shelf recon-shelf-destroy">
      🔴 Must Destroy {pct != null ? `(${pct}%)` : ''}
    </span>
  );
}

/* status badge */
function StatusChip({ status }) {
  const map = {
    Draft:         'recon-chip-draft',
    Submitted:     'recon-chip-submitted',
    'Port Verified':'recon-chip-verified',
    Released:      'recon-chip-released',
  };
  return <span className={`recon-chip ${map[status] || 'recon-chip-draft'}`}>{status}</span>;
}

/* ── NOC Status Banner ───────────────────────────────────────────────────── */
function NocBanner({ nocMeta, applicationNumber }) {
  if (!nocMeta) {
    return (
      <div className="recon-noc-banner recon-noc-pending">
        <div className="recon-noc-icon">⏳</div>
        <div>
          <div className="recon-noc-title">NOC Pending Approval</div>
          <div className="recon-noc-sub">
            The Export NOC has not been issued yet. Reconciliation entries can be added
            once the NOC is approved by the CDSCO officer.
          </div>
        </div>
      </div>
    );
  }

  const issuedDate  = nocMeta.nocIssuedDate  ? new Date(nocMeta.nocIssuedDate)  : null;
  const expiryDate  = nocMeta.nocExpiryDate  ? new Date(nocMeta.nocExpiryDate)  : null;
  const now         = new Date();
  const daysLeft    = expiryDate ? Math.max(0, Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24))) : null;
  const isExpired   = expiryDate && expiryDate < now;
  const isWarning   = daysLeft !== null && daysLeft <= 30 && !isExpired;

  const bannerClass = isExpired
    ? 'recon-noc-expired'
    : isWarning ? 'recon-noc-warning' : 'recon-noc-active';

  return (
    <div className={`recon-noc-banner ${bannerClass}`}>
      <div className="recon-noc-icon">
        {isExpired ? '❌' : isWarning ? '⚠️' : '✅'}
      </div>
      <div className="recon-noc-body">
        <div className="recon-noc-title">
          Export NOC — {isExpired ? 'EXPIRED' : isWarning ? 'EXPIRING SOON' : 'ACTIVE'}
        </div>
        <div className="recon-noc-meta-row">
          <span>📅 Issued: <strong>{issuedDate ? fmtDate(issuedDate) : '—'}</strong></span>
          <span>🗓 Expires: <strong>{expiryDate ? fmtDate(expiryDate) : '—'}</strong></span>
          {daysLeft !== null && !isExpired && (
            <span>⏱ <strong>{daysLeft} days</strong> remaining</span>
          )}
        </div>
        <div className="recon-noc-meta-row">
          <span>📦 Sanctioned Qty: <strong>{fmt(nocMeta.sanctionedQty)} {nocMeta.qtyUnit || ''}</strong></span>
          <span>✈ Exported: <strong>{fmt(nocMeta.qtyExported)} {nocMeta.qtyUnit || ''}</strong></span>
          <span>🔖 Remaining: <strong>{fmt(nocMeta.qtyRemaining)} {nocMeta.qtyUnit || ''}</strong></span>
        </div>
        <div className="recon-noc-rule">
          <span>ℹ️ Guidance: Formulations must be exported within <strong>60% residual shelf life</strong>.
          APIs within <strong>3 months</strong> residual shelf life. If below threshold, destroy in presence of SLA.</span>
        </div>
      </div>
    </div>
  );
}

/* ── Empty field helper ─────────────────────────────────────────────────── */
const emptyEntry = () => ({
  nocQty: '', batchQtyManufactured: '', packedExportedQty: '',
  countryExported: '', customerName: '', customerAddress: '',
  poNumber: '', eiNumber: '', sbNumber: '',
  poDate: '', eiDate: '', sbDate: '',
  productName: '', batchNumber: '',
  productType: 'formulation', mfgDate: '', expiryDate: '',
  status: 'Draft',
});

/* ── Entry Form Modal ────────────────────────────────────────────────────── */
function EntryFormModal({ appNumber, nocMeta, products, existingEntry, onClose, onSaved }) {
  const { currentUser } = useApp();
  const [form,    setForm]    = useState(existingEntry ? { ...existingEntry } : emptyEntry());
  const [docFile, setDocFile] = useState(null);
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState('');
  const fileRef = useRef();

  /* Auto-fill nocQty from nocMeta */
  useEffect(() => {
    if (!form.nocQty && nocMeta?.sanctionedQty) {
      setForm(f => ({ ...f, nocQty: nocMeta.sanctionedQty }));
    }
  }, [nocMeta]); // eslint-disable-line

  /* Auto-compute leftUnpackedQty */
  const batchNum  = parseFloat(form.batchQtyManufactured) || 0;
  const packedNum = parseFloat(form.packedExportedQty)    || 0;
  const leftQty   = batchNum > 0 ? Math.max(0, batchNum - packedNum) : '';

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const validate = () => {
    if (!form.packedExportedQty) return 'Packed & Exported Qty is required.';
    if (!form.countryExported)   return 'Country Exported is required.';
    if (!form.customerName)      return 'Customer Name is required.';
    if (!form.poNumber && !form.eiNumber && !form.sbNumber)
      return 'At least one of PO No., EI No. or SB No. is required.';
    return '';
  };

  const handleSave = async (submitStatus) => {
    const err = validate();
    if (err) { setError(err); return; }
    setBusy(true); setError('');
    const payload = {
      ...form,
      leftUnpackedQty: String(leftQty),
      status: submitStatus,
      submittedBy: currentUser || 'applicant',
    };
    let res;
    if (existingEntry?.entryId) {
      res = await updateReconciliationEntry(appNumber, existingEntry.entryId, payload, docFile);
    } else {
      res = await addReconciliationEntry(appNumber, payload, docFile);
    }
    setBusy(false);
    if (res.success) { onSaved(res.entry); onClose(); }
    else setError(res.error || 'Failed to save entry.');
  };

  return (
    <div className="recon-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="recon-modal" onClick={e => e.stopPropagation()}>
        <div className="recon-modal-header">
          <h3>{existingEntry ? '✏️ Edit Reconciliation Entry' : '➕ New Reconciliation Entry'}</h3>
          <button className="recon-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="recon-modal-body">
          {error && <div className="recon-alert-err">⚠️ {error}</div>}

          {/* Official CDSCO reconciliation table fields */}
          <div className="recon-section-label">📦 Quantity Details</div>
          <div className="recon-form-grid">
            <div className="recon-field">
              <label>NOC Qty (Sanctioned)</label>
              <input value={form.nocQty} onChange={set('nocQty')} placeholder="e.g. 50000 units" />
            </div>
            <div className="recon-field">
              <label>Batch Qty Manufactured</label>
              <input type="number" min="0" value={form.batchQtyManufactured}
                onChange={set('batchQtyManufactured')} placeholder="0" />
            </div>
            <div className="recon-field">
              <label>Packed &amp; Exported Qty <span className="recon-req">*</span></label>
              <input type="number" min="0" value={form.packedExportedQty}
                onChange={set('packedExportedQty')} placeholder="0" />
            </div>
            <div className="recon-field">
              <label>Left / Unpacked Qty</label>
              <input value={leftQty !== '' ? leftQty : ''} readOnly
                className="recon-input-readonly" placeholder="Auto-computed" />
            </div>
          </div>

          <div className="recon-section-label">🌍 Customer &amp; Destination</div>
          <div className="recon-form-grid">
            <div className="recon-field">
              <label>Country Exported <span className="recon-req">*</span></label>
              <input value={form.countryExported} onChange={set('countryExported')}
                placeholder="e.g. Kenya" />
            </div>
            <div className="recon-field">
              <label>Customer Name <span className="recon-req">*</span></label>
              <input value={form.customerName} onChange={set('customerName')}
                placeholder="Importing company name" />
            </div>
            <div className="recon-field recon-field-full">
              <label>Customer Address</label>
              <input value={form.customerAddress} onChange={set('customerAddress')}
                placeholder="Address of importer" />
            </div>
          </div>

          <div className="recon-section-label">📄 Trade Document Details (PO / EI / SB)</div>
          <div className="recon-form-grid">
            <div className="recon-field">
              <label>Purchase Order (PO) No.</label>
              <input value={form.poNumber} onChange={set('poNumber')} placeholder="PO-XXXXXXXX" />
            </div>
            <div className="recon-field">
              <label>PO Date</label>
              <input type="date" value={form.poDate} onChange={set('poDate')} />
            </div>
            <div className="recon-field">
              <label>Export Invoice (EI) No.</label>
              <input value={form.eiNumber} onChange={set('eiNumber')} placeholder="INV-XXXXXXXX" />
            </div>
            <div className="recon-field">
              <label>EI Date</label>
              <input type="date" value={form.eiDate} onChange={set('eiDate')} />
            </div>
            <div className="recon-field">
              <label>Shipping Bill (SB) No.</label>
              <input value={form.sbNumber} onChange={set('sbNumber')} placeholder="SB-XXXXXXXX" />
            </div>
            <div className="recon-field">
              <label>SB Date</label>
              <input type="date" value={form.sbDate} onChange={set('sbDate')} />
            </div>
          </div>

          <div className="recon-section-label">💊 Product &amp; Batch Details</div>
          <div className="recon-form-grid">
            <div className="recon-field">
              <label>Product Name</label>
              {products && products.length > 0 ? (
                <select value={form.productName} onChange={set('productName')}>
                  <option value="">— Select product —</option>
                  {products.map((p, i) => (
                    <option key={i} value={p.productName}>{p.productName} ({p.dosageForm} {p.strength})</option>
                  ))}
                </select>
              ) : (
                <input value={form.productName} onChange={set('productName')} placeholder="Drug product name" />
              )}
            </div>
            <div className="recon-field">
              <label>Batch Number</label>
              <input value={form.batchNumber} onChange={set('batchNumber')} placeholder="Batch / Lot No." />
            </div>
            <div className="recon-field">
              <label>Product Type</label>
              <select value={form.productType} onChange={set('productType')}>
                <option value="formulation">Formulation (60% shelf life rule)</option>
                <option value="api">API / Bulk Drug (3-month rule)</option>
              </select>
            </div>
          </div>

          <div className="recon-section-label">📅 Shelf Life (Guidance Doc Compliance)</div>
          <div className="recon-form-grid">
            <div className="recon-field">
              <label>Manufacturing Date</label>
              <input type="date" value={form.mfgDate} onChange={set('mfgDate')} />
            </div>
            <div className="recon-field">
              <label>Expiry Date</label>
              <input type="date" value={form.expiryDate} onChange={set('expiryDate')} />
            </div>
          </div>
          {form.productType === 'formulation' && (
            <div className="recon-shelf-note">
              📌 Per guidance: formulation stock with residual shelf life below <strong>60%</strong> must be
              destroyed in the presence of the State Licensing Authority (SLA).
            </div>
          )}
          {form.productType === 'api' && (
            <div className="recon-shelf-note">
              📌 Per guidance: API / bulk drug stock with residual shelf life below <strong>3 months</strong>
              must be destroyed in the presence of the State Licensing Authority (SLA).
            </div>
          )}

          <div className="recon-section-label">📎 Supporting Document (COA / Invoice)</div>
          <div className="recon-file-zone"
            onClick={() => fileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); setDocFile(e.dataTransfer.files[0]); }}>
            {docFile
              ? <span>📄 {docFile.name} ({(docFile.size / 1024).toFixed(0)} KB)</span>
              : existingEntry?.docName
                ? <span>📄 Already uploaded: <strong>{existingEntry.docName}</strong> — drag new file to replace</span>
                : <span>☁️ Drag &amp; drop or click to attach COA, Invoice, or Shipping Bill</span>}
            <input ref={fileRef} type="file" accept=".pdf,.jpg,.png,.docx"
              style={{ display: 'none' }}
              onChange={e => setDocFile(e.target.files[0])} />
          </div>
        </div>

        <div className="recon-modal-footer">
          <button className="recon-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="recon-btn-draft" onClick={() => handleSave('Draft')} disabled={busy}>
            {busy ? '⏳ Saving…' : '💾 Save Draft'}
          </button>
          <button className="recon-btn-submit" onClick={() => handleSave('Submitted')} disabled={busy}>
            {busy ? '⏳ Submitting…' : '📤 Submit to Port Office'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Entry Row (table row) ───────────────────────────────────────────────── */
function EntryRow({ entry, idx, onEdit, onDelete }) {
  const canDelete = entry.status === 'Draft';
  return (
    <tr>
      <td className="recon-td-idx">{idx + 1}</td>
      <td>
        <div className="recon-td-product">{entry.productName || '—'}</div>
        <div className="recon-td-batch">{entry.batchNumber ? `Batch: ${entry.batchNumber}` : ''}</div>
      </td>
      <td className="recon-td-num">{fmtNum(entry.nocQty)}</td>
      <td className="recon-td-num">{fmtNum(entry.batchQtyManufactured)}</td>
      <td className="recon-td-num recon-td-exported">{fmtNum(entry.packedExportedQty)}</td>
      <td className="recon-td-num">{fmtNum(entry.leftUnpackedQty)}</td>
      <td>{entry.countryExported || '—'}</td>
      <td>
        <div>{entry.customerName || '—'}</div>
        {entry.poNumber  && <div className="recon-td-trade">PO: {entry.poNumber}</div>}
        {entry.eiNumber  && <div className="recon-td-trade">EI: {entry.eiNumber}</div>}
        {entry.sbNumber  && <div className="recon-td-trade">SB: {entry.sbNumber}</div>}
      </td>
      <td><ShelfBadge status={entry.shelfLifeStatus} pct={entry.residualShelfLifePct} /></td>
      <td>
        {entry.docUrl
          ? <a href={entry.docUrl} target="_blank" rel="noreferrer" className="recon-doc-link">📄 View</a>
          : <span className="recon-no-doc">—</span>}
      </td>
      <td><StatusChip status={entry.status} /></td>
      <td>
        <div className="recon-row-actions">
          <button className="recon-btn-edit" onClick={() => onEdit(entry)} title="Edit">✏️</button>
          {canDelete && (
            <button className="recon-btn-del" onClick={() => onDelete(entry.entryId)} title="Delete">🗑</button>
          )}
        </div>
      </td>
    </tr>
  );
}

/* ── Summary Stats Row ───────────────────────────────────────────────────── */
function SummaryBar({ summary }) {
  if (!summary) return null;
  return (
    <div className="recon-summary-bar">
      <div className="recon-sum-item">
        <span className="recon-sum-num">{summary.totalEntries}</span>
        <span className="recon-sum-label">Total Entries</span>
      </div>
      <div className="recon-sum-divider" />
      <div className="recon-sum-item">
        <span className="recon-sum-num recon-sum-draft">{summary.draftCount}</span>
        <span className="recon-sum-label">Draft</span>
      </div>
      <div className="recon-sum-divider" />
      <div className="recon-sum-item">
        <span className="recon-sum-num recon-sum-submitted">{summary.submittedCount}</span>
        <span className="recon-sum-label">Submitted to Port</span>
      </div>
      <div className="recon-sum-divider" />
      <div className="recon-sum-item">
        <span className="recon-sum-num recon-sum-released">{summary.releasedCount}</span>
        <span className="recon-sum-label">Released</span>
      </div>
      <div className="recon-sum-divider" />
      <div className="recon-sum-item">
        <span className="recon-sum-num recon-sum-exported">{fmtNum(summary.totalExported)}</span>
        <span className="recon-sum-label">Total Exported</span>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ══════════════════════════════════════════════════════════════════════════ */
export default function ReconciliationPage({ applicationNumber }) {
  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [showForm,    setShowForm]    = useState(false);
  const [editEntry,   setEditEntry]   = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [deleting,    setDeleting]    = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const res = await getReconciliation(applicationNumber);
    if (res.success) setData(res);
    else setError(res.error || 'Failed to load reconciliation data.');
    setLoading(false);
  }, [applicationNumber]);

  useEffect(() => { load(); }, [load]);

  const handleSaved = (entry) => {
    // Optimistically refresh
    load();
  };

  const handleDelete = async (entryId) => {
    setDeleting(true);
    const res = await deleteReconciliationEntry(applicationNumber, entryId);
    setDeleting(false);
    setDeleteConfirm(null);
    if (res.success) load();
    else alert(res.error || 'Could not delete entry.');
  };

  const openEdit = (entry) => { setEditEntry(entry); setShowForm(true); };
  const openAdd  = ()      => { setEditEntry(null);  setShowForm(true); };
  const closeForm = ()     => { setShowForm(false); setEditEntry(null); };

  /* extract product list from existing entries for the dropdown */
  const entryProducts = (data?.entries || [])
    .filter(e => e.productName)
    .map(e => ({ productName: e.productName, dosageForm: '', strength: '' }));
  const uniqueProducts = [...new Map(entryProducts.map(p => [p.productName, p])).values()];

  return (
    <div className="recon-page">
      {/* Page header */}
      <div className="recon-page-header">
        <div>
          <h2 className="recon-title">🚢 Step II — Export Reconciliation</h2>
          <p className="recon-sub">
            Official CDSCO reconciliation module. Log each consignment exported against
            this NOC. Module remains open throughout the 1-year NOC validity period.
          </p>
        </div>
        <button className="recon-btn-add" onClick={openAdd}>
          ➕ Add Consignment Entry
        </button>
      </div>

      {/* NOC status banner */}
      {!loading && (
        <NocBanner nocMeta={data?.nocMeta} applicationNumber={applicationNumber} />
      )}

      {/* Summary bar */}
      {!loading && data && <SummaryBar summary={data.summary} />}

      {/* Error */}
      {error && (
        <div className="recon-alert-err" style={{ margin: '12px 0' }}>
          ⚠️ {error}
          <button className="recon-retry-btn" onClick={load}>↺ Retry</button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="recon-loading">
          <div className="recon-spinner" />
          <span>Loading reconciliation data…</span>
        </div>
      )}

      {/* Official reconciliation table */}
      {!loading && data && (
        <div className="recon-table-card">
          <div className="recon-table-header">
            <span className="recon-table-title">📋 Consignment Register</span>
            <span className="recon-table-hint">
              As per CDSCO Guidance Document — Reconciliation Data Format
            </span>
          </div>

          {data.entries.length === 0 ? (
            <div className="recon-empty">
              <div style={{ fontSize: 44, marginBottom: 12 }}>📦</div>
              <p style={{ fontWeight: 700, color: '#1e293b', marginBottom: 4 }}>No consignment entries yet</p>
              <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
                Add a new entry for each consignment exported under this NOC.
              </p>
              <button className="recon-btn-add" onClick={openAdd}>➕ Add First Entry</button>
            </div>
          ) : (
            <div className="recon-table-scroll">
              <table className="recon-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Product / Batch</th>
                    <th>NOC Qty</th>
                    <th>Batch Mfg. Qty</th>
                    <th>Packed &amp; Exported</th>
                    <th>Left / Unpacked</th>
                    <th>Country</th>
                    <th>Customer / PO·EI·SB</th>
                    <th>Shelf Life</th>
                    <th>Doc</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.entries.map((entry, i) => (
                    <EntryRow
                      key={entry.entryId}
                      entry={entry}
                      idx={i}
                      onEdit={openEdit}
                      onDelete={(id) => setDeleteConfirm(id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Guidance note footer */}
      {!loading && (
        <div className="recon-guidance-note">
          <strong>📜 Guidance Document Reference:</strong> Per CDSCO guidelines, the applicant must
          fill out reconciliation details in the prescribed format and obtain clearance for each
          consignment from the concerned port office. The reconciliation module remains open
          throughout the validity of the NOC (1 year or quantity exhaustion, whichever is earlier).
          For NDPS / Banned drugs, a quantity-specific and PO-specific NOC will be issued for each order.
        </div>
      )}

      {/* Entry Form Modal */}
      {showForm && (
        <EntryFormModal
          appNumber={applicationNumber}
          nocMeta={data?.nocMeta}
          products={uniqueProducts}
          existingEntry={editEntry}
          onClose={closeForm}
          onSaved={handleSaved}
        />
      )}

      {/* Delete confirm */}
      {deleteConfirm && (
        <div className="recon-modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="recon-confirm-box" onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>🗑️</div>
            <h3>Delete Entry?</h3>
            <p>This will permanently remove this draft entry. This action cannot be undone.</p>
            <div className="recon-confirm-btns">
              <button className="recon-btn-del-confirm" onClick={() => handleDelete(deleteConfirm)} disabled={deleting}>
                {deleting ? '⏳ Deleting…' : '🗑 Delete'}
              </button>
              <button className="recon-btn-ghost" onClick={() => setDeleteConfirm(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
