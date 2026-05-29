import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { DOSAGE_FORMS } from '../../data/mockData';
import './WizardStep.css';

const emptyProduct = {
  productName: '', genericName: '', brandName: '', dosageForm: '',
  strength: '', packSize: '', batchNumber: '', mfgDate: '', expiryDate: ''
};

export default function Step3DrugInfo() {
  const { formData, addProduct, updateProduct, deleteProduct, setCurrentStep, saveDraft, draftSaved } = useApp();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [product, setProduct] = useState(emptyProduct);
  const [errors, setErrors] = useState({});
  const [tableError, setTableError] = useState('');

  const validateProduct = () => {
    const e = {};
    if (!product.productName.trim()) e.productName = 'Required';
    if (!product.genericName.trim()) e.genericName = 'Required';
    if (!product.dosageForm) e.dosageForm = 'Required';
    if (!product.strength.trim()) e.strength = 'Required';
    if (!product.batchNumber.trim()) e.batchNumber = 'Required';
    if (!product.mfgDate) e.mfgDate = 'Required';
    if (!product.expiryDate) e.expiryDate = 'Required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSaveProduct = () => {
    if (!validateProduct()) return;
    if (editId) {
      updateProduct(editId, product);
      setEditId(null);
    } else {
      addProduct(product);
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

  const PF = (name, label, required = true) => (
    <div className="form-group">
      <label className="form-label">{label}{required && <span className="required">*</span>}</label>
      <input
        type="text"
        className={`form-control ${errors[name] ? 'error' : ''}`}
        value={product[name]}
        onChange={e => { setProduct(p => ({ ...p, [name]: e.target.value })); if (errors[name]) setErrors(p => ({ ...p, [name]: '' })); }}
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

      {/* Product Table */}
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
                      <td><span className="badge badge-info">{p.dosageForm}</span></td>
                      <td>{p.strength}</td>
                      <td>{p.packSize || '—'}</td>
                      <td><code>{p.batchNumber}</code></td>
                      <td>{p.mfgDate}</td>
                      <td>{p.expiryDate}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-outline btn-sm" onClick={() => handleEdit(p)}>✏️ Edit</button>
                          <button className="btn btn-danger btn-sm" onClick={() => deleteProduct(p.id)}>🗑️</button>
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

      {/* Add Product Form */}
      {showForm ? (
        <div className="card mb-3 slide-in">
          <div className="card-header">
            <span>{editId ? '✏️' : '➕'}</span>
            <h3>{editId ? 'Edit Product' : 'Add New Product'}</h3>
          </div>
          <div className="card-body">
            <div className="grid grid-3">
              {PF('productName', 'Product Name')}
              {PF('genericName', 'Generic Name')}
              {PF('brandName', 'Brand Name', false)}
            </div>
            <div className="grid grid-3">
              <div className="form-group">
                <label className="form-label">Dosage Form<span className="required">*</span></label>
                <select
                  className={`form-control ${errors.dosageForm ? 'error' : ''}`}
                  value={product.dosageForm}
                  onChange={e => { setProduct(p => ({ ...p, dosageForm: e.target.value })); if (errors.dosageForm) setErrors(p => ({ ...p, dosageForm: '' })); }}
                >
                  <option value="">— Select Form —</option>
                  {DOSAGE_FORMS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
                {errors.dosageForm && <div className="form-error">⚠ {errors.dosageForm}</div>}
              </div>
              {PF('strength', 'Strength (e.g. 500mg)')}
              {PF('packSize', 'Pack Size (e.g. 10x10)', false)}
            </div>
            <div className="grid grid-3">
              {PF('batchNumber', 'Batch Number')}
              <div className="form-group">
                <label className="form-label">Manufacturing Date<span className="required">*</span></label>
                <input type="date" className={`form-control ${errors.mfgDate ? 'error' : ''}`}
                  value={product.mfgDate}
                  onChange={e => { setProduct(p => ({ ...p, mfgDate: e.target.value })); if (errors.mfgDate) setErrors(p => ({ ...p, mfgDate: '' })); }}
                />
                {errors.mfgDate && <div className="form-error">⚠ {errors.mfgDate}</div>}
              </div>
              <div className="form-group">
                <label className="form-label">Expiry Date<span className="required">*</span></label>
                <input type="date" className={`form-control ${errors.expiryDate ? 'error' : ''}`}
                  value={product.expiryDate}
                  onChange={e => { setProduct(p => ({ ...p, expiryDate: e.target.value })); if (errors.expiryDate) setErrors(p => ({ ...p, expiryDate: '' })); }}
                />
                {errors.expiryDate && <div className="form-error">⚠ {errors.expiryDate}</div>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button className="btn btn-success" onClick={handleSaveProduct}>
                {editId ? '✓ Update Product' : '➕ Add Product'}
              </button>
              <button className="btn btn-outline" onClick={handleCancel}>Cancel</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="add-product-btn-wrap">
          <button className="btn btn-secondary btn-lg" onClick={() => setShowForm(true)}>
            ➕ Add Drug / Product
          </button>
          {formData.products.length === 0 && (
            <p className="text-muted mt-1" style={{ fontSize: 13 }}>No products added yet. Click above to add a product.</p>
          )}
        </div>
      )}

      <div className="step-actions">
        <button className="btn btn-outline" onClick={() => setCurrentStep(2)}>← Previous</button>
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
