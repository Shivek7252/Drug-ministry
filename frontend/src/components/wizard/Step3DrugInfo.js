import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { DOSAGE_FORMS } from '../../data/mockData';
import { searchApprovedDrugs, findApprovedDrug } from '../../data/approvedDrugs';
import './WizardStep.css';

const emptyProduct = {
  productName: '', genericName: '', brandName: '', dosageForm: '',
  strength: '', packSize: '', batchNumber: '', mfgDate: '', expiryDate: ''
};

/* ── Inline styles for autocomplete dropdown ─────────────────────────────── */
const dropdownStyles = {
  wrapper: {
    position: 'relative',
  },
  dropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    zIndex: 1000,
    background: '#fff',
    border: '1.5px solid #90CAF9',
    borderTop: 'none',
    borderRadius: '0 0 8px 8px',
    boxShadow: '0 6px 20px rgba(0,53,128,0.15)',
    maxHeight: 260,
    overflowY: 'auto',
    marginTop: -1,
  },
  item: {
    padding: '10px 14px',
    cursor: 'pointer',
    borderBottom: '1px solid #F0F4F8',
    transition: 'background 0.12s',
  },
  itemHover: {
    background: '#EFF6FF',
  },
  itemName: {
    fontSize: 13,
    fontWeight: 700,
    color: '#1A237E',
    marginBottom: 2,
  },
  itemMeta: {
    fontSize: 11.5,
    color: '#607D8B',
    display: 'flex',
    gap: 10,
    flexWrap: 'wrap',
  },
  noResults: {
    padding: '12px 14px',
    fontSize: 13,
    color: '#78909C',
    fontStyle: 'italic',
  },
  approvedBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 8px',
    borderRadius: 20,
    fontSize: 11,
    fontWeight: 700,
    background: '#E8F5E9',
    color: '#2E7D32',
    border: '1px solid #C8E6C9',
    marginLeft: 6,
    verticalAlign: 'middle',
  },
  warningBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 8px',
    borderRadius: 20,
    fontSize: 11,
    fontWeight: 700,
    background: '#FFF8E1',
    color: '#E65100',
    border: '1px solid #FFCC02',
    marginLeft: 6,
    verticalAlign: 'middle',
  },
  approvalBox: {
    padding: '8px 12px',
    borderRadius: 8,
    marginTop: 6,
    fontSize: 12.5,
    lineHeight: 1.6,
  },
  approvalBoxOk: {
    background: '#E8F5E9',
    border: '1px solid #C8E6C9',
    color: '#1B5E20',
  },
  approvalBoxWarn: {
    background: '#FFF8E1',
    border: '1px solid #FFE082',
    color: '#5D4037',
  },
};

/* ── GenericNameAutocomplete component ───────────────────────────────────── */
function GenericNameAutocomplete({ value, onChange, onSelect, error }) {
  const [suggestions, setSuggestions] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [hoveredIdx, setHoveredIdx] = useState(-1);
  const wrapperRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleChange = (e) => {
    const v = e.target.value;
    onChange(v);
    if (v.trim().length >= 2) {
      const results = searchApprovedDrugs(v, 8);
      setSuggestions(results);
      setShowDropdown(true);
    } else {
      setSuggestions([]);
      setShowDropdown(false);
    }
    setHoveredIdx(-1);
  };

  const handleKeyDown = (e) => {
    if (!showDropdown || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHoveredIdx(i => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHoveredIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && hoveredIdx >= 0) {
      e.preventDefault();
      handlePick(suggestions[hoveredIdx]);
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  };

  const handlePick = (drug) => {
    onSelect(drug);
    setShowDropdown(false);
    setSuggestions([]);
    setHoveredIdx(-1);
  };

  return (
    <div style={dropdownStyles.wrapper} ref={wrapperRef}>
      <input
        type="text"
        className={`form-control ${error ? 'error' : ''}`}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (value.trim().length >= 2 && suggestions.length > 0) setShowDropdown(true);
        }}
        placeholder="Type to search CDSCO approved drugs…"
        autoComplete="off"
      />
      {showDropdown && (
        <div style={dropdownStyles.dropdown}>
          {suggestions.length === 0 ? (
            <div style={dropdownStyles.noResults}>No approved drug matches found</div>
          ) : (
            suggestions.map((drug, idx) => (
              <div
                key={drug.id}
                style={{
                  ...dropdownStyles.item,
                  ...(idx === hoveredIdx ? dropdownStyles.itemHover : {}),
                  borderBottom: idx === suggestions.length - 1 ? 'none' : undefined,
                }}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(-1)}
                onMouseDown={() => handlePick(drug)}
              >
                <div style={dropdownStyles.itemName}>
                  {drug.genericName}
                  <span style={dropdownStyles.approvedBadge}>✓ CDSCO Approved</span>
                </div>
                <div style={dropdownStyles.itemMeta}>
                  {drug.strength && <span>💊 {drug.strength}</span>}
                  {drug.indication && (
                    <span title={drug.indication}>
                      📋 {drug.indication.length > 55 ? drug.indication.slice(0, 55) + '…' : drug.indication}
                    </span>
                  )}
                  {drug.approvalDate && <span>📅 Approved: {drug.approvalDate}</span>}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* ── ApprovalStatusInfo: shown below the generic name field after entry ──── */
function ApprovalStatusInfo({ genericName }) {
  if (!genericName || genericName.trim().length < 2) return null;
  const drug = findApprovedDrug(genericName);

  if (drug) {
    return (
      <div style={{ ...dropdownStyles.approvalBox, ...dropdownStyles.approvalBoxOk }}>
        <strong>✅ CDSCO Approved</strong> — {drug.genericName}
        {drug.approvalDate && <> | Approval Date: <strong>{drug.approvalDate}</strong></>}
        {drug.indication && <> | Indication: {drug.indication}</>}
      </div>
    );
  }

  return (
    <div style={{ ...dropdownStyles.approvalBox, ...dropdownStyles.approvalBoxWarn }}>
      <strong>⚠ Not found in CDSCO approved list</strong> — This drug may require additional
      justification. Ensure you have valid approval documentation before submitting.
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   Main Step3DrugInfo component
   ════════════════════════════════════════════════════════════════════════════ */
export default function Step3DrugInfo() {
  const {
    formData, addProduct, updateProduct, deleteProduct,
    setCurrentStep, saveDraft, draftSaved,
  } = useApp();

  const [showForm, setShowForm]   = useState(false);
  const [editId, setEditId]       = useState(null);
  const [product, setProduct]     = useState(emptyProduct);
  const [errors, setErrors]       = useState({});
  const [tableError, setTableError] = useState('');

  const validateProduct = () => {
    const e = {};
    if (!product.productName.trim())  e.productName  = 'Required';
    if (!product.genericName.trim())  e.genericName  = 'Required';
    if (!product.dosageForm)          e.dosageForm   = 'Required';
    if (!product.strength.trim())     e.strength     = 'Required';
    if (!product.batchNumber.trim())  e.batchNumber  = 'Required';
    if (!product.mfgDate)             e.mfgDate      = 'Required';
    if (!product.expiryDate)          e.expiryDate   = 'Required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSaveProduct = () => {
    if (!validateProduct()) return;
    // Tag whether this generic name is CDSCO-approved
    const approved = findApprovedDrug(product.genericName);
    const productWithStatus = {
      ...product,
      cdscoApproved: !!approved,
      cdscoApprovalDate: approved?.approvalDate || '',
    };
    if (editId) {
      updateProduct(editId, productWithStatus);
      setEditId(null);
    } else {
      addProduct(productWithStatus);
    }
    setProduct(emptyProduct);
    setShowForm(false);
    setTableError('');
  };

  const handleEdit = (p) => {
    setProduct({ ...p });
    setEditId(p.id);
    setShowForm(true);
    setTableError('');
  };

  const handleCancel = () => {
    setProduct(emptyProduct);
    setEditId(null);
    setShowForm(false);
    setErrors({});
  };

  const handleNext = () => {
    if (formData.products.length === 0) {
      setTableError('Please add at least one drug/product before proceeding.');
      return;
    }
    setCurrentStep(4);
  };

  // Generic text field factory
  const PF = (name, label, required = true) => (
    <div className="form-group">
      <label className="form-label">
        {label}{required && <span className="required">*</span>}
      </label>
      <input
        type="text"
        className={`form-control ${errors[name] ? 'error' : ''}`}
        value={product[name]}
        onChange={e => {
          setProduct(p => ({ ...p, [name]: e.target.value }));
          if (errors[name]) setErrors(p => ({ ...p, [name]: '' }));
        }}
        placeholder={`Enter ${label.toLowerCase()}`}
      />
      {errors[name] && <div className="form-error">⚠ {errors[name]}</div>}
    </div>
  );

  return (
    <div className="wizard-step fade-in">
      <div className="step-header">
        <div className="step-header-icon">💊</div>
        <div>
          <h2>Drug / Product Details</h2>
          <p>Add all drug or pharmaceutical products to be exported</p>
        </div>
      </div>

      {tableError && (
        <div className="alert alert-danger">
          <span>⚠️</span><span>{tableError}</span>
        </div>
      )}

      {/* ── Product Table ─────────────────────────────────────────────────── */}
      {formData.products.length > 0 && (
        <div className="card mb-3">
          <div className="card-header">
            <span>📦</span>
            <h3>Added Products ({formData.products.length})</h3>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Product Name</th>
                    <th>Generic Name</th>
                    <th>Brand Name</th>
                    <th>Dosage Form</th>
                    <th>Strength</th>
                    <th>Pack Size</th>
                    <th>Batch No.</th>
                    <th>Mfg. Date</th>
                    <th>Expiry Date</th>
                    <th>CDSCO Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {formData.products.map((p, i) => (
                    <tr key={p.id}>
                      <td><strong>{i + 1}</strong></td>
                      <td><strong>{p.productName}</strong></td>
                      <td>{p.genericName}</td>
                      <td>{p.brandName || '—'}</td>
                      <td>
                        <span className="badge badge-info">{p.dosageForm}</span>
                      </td>
                      <td>{p.strength}</td>
                      <td>{p.packSize || '—'}</td>
                      <td><code>{p.batchNumber}</code></td>
                      <td>{p.mfgDate}</td>
                      <td>{p.expiryDate}</td>
                      <td>
                        {p.cdscoApproved === true ? (
                          <span style={dropdownStyles.approvedBadge}>✓ Approved</span>
                        ) : p.cdscoApproved === false ? (
                          <span style={dropdownStyles.warningBadge}>⚠ Unverified</span>
                        ) : (
                          <span style={{ color: '#90A4AE', fontSize: 12 }}>—</span>
                        )}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() => handleEdit(p)}
                          >
                            ✏️ Edit
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => deleteProduct(p.id)}
                          >
                            🗑️
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Add / Edit Product Form ──────────────────────────────────────── */}
      {showForm ? (
        <div className="card mb-3 slide-in">
          <div className="card-header">
            <span>{editId ? '✏️' : '➕'}</span>
            <h3>{editId ? 'Edit Product' : 'Add New Product'}</h3>
          </div>
          <div className="card-body">

            {/* Row 1 */}
            <div className="grid grid-3">
              {PF('productName', 'Product Name')}

              {/* Generic Name with autocomplete */}
              <div className="form-group">
                <label className="form-label">
                  Generic Name<span className="required">*</span>
                  <span style={{
                    marginLeft: 8,
                    fontSize: 11,
                    fontWeight: 600,
                    color: '#1565C0',
                    background: '#E3F2FD',
                    padding: '1px 7px',
                    borderRadius: 10,
                  }}>
                    🔍 CDSCO lookup
                  </span>
                </label>
                <GenericNameAutocomplete
                  value={product.genericName}
                  error={!!errors.genericName}
                  onChange={(val) => {
                    setProduct(p => ({ ...p, genericName: val }));
                    if (errors.genericName) setErrors(p => ({ ...p, genericName: '' }));
                  }}
                  onSelect={(drug) => {
                    setProduct(p => ({
                      ...p,
                      genericName: drug.genericName,
                      // Pre-fill strength only if empty
                      strength: p.strength.trim() ? p.strength : (drug.strength || p.strength),
                    }));
                    if (errors.genericName) setErrors(p => ({ ...p, genericName: '' }));
                    if (errors.strength)   setErrors(p => ({ ...p, strength: '' }));
                  }}
                />
                {errors.genericName && (
                  <div className="form-error">⚠ {errors.genericName}</div>
                )}
                <ApprovalStatusInfo genericName={product.genericName} />
              </div>

              {PF('brandName', 'Brand Name', false)}
            </div>

            {/* Row 2 */}
            <div className="grid grid-3">
              <div className="form-group">
                <label className="form-label">
                  Dosage Form<span className="required">*</span>
                </label>
                <select
                  className={`form-control ${errors.dosageForm ? 'error' : ''}`}
                  value={product.dosageForm}
                  onChange={e => {
                    setProduct(p => ({ ...p, dosageForm: e.target.value }));
                    if (errors.dosageForm) setErrors(p => ({ ...p, dosageForm: '' }));
                  }}
                >
                  <option value="">— Select Form —</option>
                  {DOSAGE_FORMS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
                {errors.dosageForm && (
                  <div className="form-error">⚠ {errors.dosageForm}</div>
                )}
              </div>

              {PF('strength', 'Strength (e.g. 500mg)')}
              {PF('packSize', 'Pack Size (e.g. 10x10)', false)}
            </div>

            {/* Row 3 */}
            <div className="grid grid-3">
              {PF('batchNumber', 'Batch Number')}
              <div className="form-group">
                <label className="form-label">
                  Manufacturing Date<span className="required">*</span>
                </label>
                <input
                  type="date"
                  className={`form-control ${errors.mfgDate ? 'error' : ''}`}
                  value={product.mfgDate}
                  onChange={e => {
                    setProduct(p => ({ ...p, mfgDate: e.target.value }));
                    if (errors.mfgDate) setErrors(p => ({ ...p, mfgDate: '' }));
                  }}
                />
                {errors.mfgDate && <div className="form-error">⚠ {errors.mfgDate}</div>}
              </div>
              <div className="form-group">
                <label className="form-label">
                  Expiry Date<span className="required">*</span>
                </label>
                <input
                  type="date"
                  className={`form-control ${errors.expiryDate ? 'error' : ''}`}
                  value={product.expiryDate}
                  onChange={e => {
                    setProduct(p => ({ ...p, expiryDate: e.target.value }));
                    if (errors.expiryDate) setErrors(p => ({ ...p, expiryDate: '' }));
                  }}
                />
                {errors.expiryDate && (
                  <div className="form-error">⚠ {errors.expiryDate}</div>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button className="btn btn-success" onClick={handleSaveProduct}>
                {editId ? '✓ Update Product' : '➕ Add Product'}
              </button>
              <button className="btn btn-outline" onClick={handleCancel}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="add-product-btn-wrap">
          <button
            className="btn btn-secondary btn-lg"
            onClick={() => setShowForm(true)}
          >
            ➕ Add Drug / Product
          </button>
          {formData.products.length === 0 && (
            <p className="text-muted mt-1" style={{ fontSize: 13 }}>
              No products added yet. Click above to add a product.
            </p>
          )}
        </div>
      )}

      {/* ── Step Actions ─────────────────────────────────────────────────── */}
      <div className="step-actions">
        <button className="btn btn-outline" onClick={() => setCurrentStep(2)}>
          ← Previous
        </button>
        <button className="btn btn-outline" onClick={saveDraft}>
          {draftSaved ? '✓ Draft Saved' : '💾 Save Draft'}
        </button>
        <button className="btn btn-primary btn-lg" onClick={handleNext}>
          Next: Manufacturer Details →
        </button>
      </div>
    </div>
  );
}
