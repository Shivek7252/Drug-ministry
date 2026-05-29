import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { COUNTRIES, INDIAN_STATES } from '../../data/mockData';
import './WizardStep.css';

export default function Step2ConsigneeDetails() {
  const { formData, updateForm, setCurrentStep, saveDraft, draftSaved } = useApp();
  const [errors, setErrors] = useState({});

  const validate = () => {
    const e = {};
    if (!formData.consigneeName.trim()) e.consigneeName = 'Consignee name is required';
    if (!formData.consigneeOrg.trim()) e.consigneeOrg = 'Organization name is required';
    if (!formData.addressLine1.trim()) e.addressLine1 = 'Address is required';
    if (!formData.city.trim()) e.city = 'City is required';
    if (!formData.consigneeCountry) e.consigneeCountry = 'Country is required';
    if (!formData.contactPerson.trim()) e.contactPerson = 'Contact person is required';
    if (!formData.consigneePhone.trim()) e.consigneePhone = 'Phone number is required';
    if (!formData.consigneeEmail.trim()) e.consigneeEmail = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.consigneeEmail)) e.consigneeEmail = 'Enter a valid email';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const F = (name, label, type = 'text', required = true, placeholder) => (
    <div className="form-group">
      <label className="form-label">{label}{required && <span className="required">*</span>}</label>
      <input
        type={type}
        className={`form-control ${errors[name] ? 'error' : ''}`}
        value={formData[name]}
        onChange={e => { updateForm({ [name]: e.target.value }); if (errors[name]) setErrors(p => ({ ...p, [name]: '' })); }}
        placeholder={placeholder || `Enter ${label.toLowerCase()}`}
      />
      {errors[name] && <div className="form-error">⚠ {errors[name]}</div>}
    </div>
  );

  const S = (name, label, options, required = true) => (
    <div className="form-group">
      <label className="form-label">{label}{required && <span className="required">*</span>}</label>
      <select
        className={`form-control ${errors[name] ? 'error' : ''}`}
        value={formData[name]}
        onChange={e => { updateForm({ [name]: e.target.value }); if (errors[name]) setErrors(p => ({ ...p, [name]: '' })); }}
      >
        <option value="">— Select {label} —</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      {errors[name] && <div className="form-error">⚠ {errors[name]}</div>}
    </div>
  );

  return (
    <div className="wizard-step fade-in">
      <div className="step-header">
        <div className="step-header-icon">🏢</div>
        <div>
          <h2>Consignee / Importer Information</h2>
          <p>Provide details of the consignee or importer in the destination country</p>
        </div>
      </div>

      <div className="alert alert-info">
        <span>ℹ️</span>
        <span>The consignee is the entity receiving the exported drugs in the destination country. Ensure all details match the import documents.</span>
      </div>

      {/* Consignee Identity */}
      <div className="card mb-3">
        <div className="card-header">
          <span>🏭</span>
          <h3>Consignee / Importer Identity</h3>
        </div>
        <div className="card-body">
          <div className="grid grid-2">
            {F('consigneeName', 'Consignee Name')}
            {F('consigneeOrg', 'Organization Name')}
          </div>
        </div>
      </div>

      {/* Address */}
      <div className="card mb-3">
        <div className="card-header">
          <span>📍</span>
          <h3>Address Details</h3>
        </div>
        <div className="card-body">
          <div className="form-group">
            <label className="form-label">Address Line 1<span className="required">*</span></label>
            <input
              type="text"
              className={`form-control ${errors.addressLine1 ? 'error' : ''}`}
              value={formData.addressLine1}
              onChange={e => { updateForm({ addressLine1: e.target.value }); if (errors.addressLine1) setErrors(p => ({ ...p, addressLine1: '' })); }}
              placeholder="Street address, building name"
            />
            {errors.addressLine1 && <div className="form-error">⚠ {errors.addressLine1}</div>}
          </div>
          {F('addressLine2', 'Address Line 2', 'text', false, 'Apartment, suite, unit (optional)')}
          <div className="grid grid-3">
            {F('city', 'City')}
            {S('state', 'State / Province', INDIAN_STATES, false)}
            {F('postalCode', 'Postal Code', 'text', false)}
          </div>
          {S('consigneeCountry', 'Country', COUNTRIES)}
        </div>
      </div>

      {/* Contact */}
      <div className="card mb-3">
        <div className="card-header">
          <span>📞</span>
          <h3>Contact Information</h3>
        </div>
        <div className="card-body">
          <div className="grid grid-3">
            {F('contactPerson', 'Contact Person')}
            {F('consigneePhone', 'Phone Number', 'tel')}
            {F('consigneeEmail', 'Email Address', 'email')}
          </div>
        </div>
      </div>

      <div className="step-actions">
        <button className="btn btn-outline" onClick={() => setCurrentStep(1)}>← Previous</button>
        <button className="btn btn-outline" onClick={saveDraft}>
          {draftSaved ? '✓ Draft Saved' : '💾 Save Draft'}
        </button>
        <button className="btn btn-primary btn-lg" onClick={() => { if (validate()) setCurrentStep(3); }}>
          Next: Drug/Product Info →
        </button>
      </div>
    </div>
  );
}
