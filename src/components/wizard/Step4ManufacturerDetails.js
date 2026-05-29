import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import './WizardStep.css';

export default function Step4ManufacturerDetails() {
  const { formData, updateForm, setCurrentStep, saveDraft, draftSaved } = useApp();
  const [errors, setErrors] = useState({});

  const validate = () => {
    const e = {};
    if (!formData.manufacturerName.trim()) e.manufacturerName = 'Manufacturer name is required';
    if (!formData.mfgLicenseNo.trim()) e.mfgLicenseNo = 'License number is required';
    if (!formData.factoryAddress.trim()) e.factoryAddress = 'Factory address is required';
    if (!formData.mfgContactPerson.trim()) e.mfgContactPerson = 'Contact person is required';
    if (!formData.mfgContactNumber.trim()) e.mfgContactNumber = 'Contact number is required';
    if (!formData.mfgEmail.trim()) e.mfgEmail = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.mfgEmail)) e.mfgEmail = 'Enter a valid email';
    if (!formData.signatoryName.trim()) e.signatoryName = 'Signatory name is required';
    if (!formData.signatoryDesignation.trim()) e.signatoryDesignation = 'Designation is required';
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

  return (
    <div className="wizard-step fade-in">
      <div className="step-header">
        <div className="step-header-icon">🏭</div>
        <div>
          <h2>Manufacturer Information</h2>
          <p>Provide details of the drug manufacturer and authorized signatory</p>
        </div>
      </div>

      <div className="alert alert-warning">
        <span>⚠️</span>
        <span>Manufacturing license details must match the license issued by the State Drug Authority. Incorrect details may lead to rejection.</span>
      </div>

      {/* Manufacturer Details */}
      <div className="card mb-3">
        <div className="card-header">
          <span>🏭</span>
          <h3>Manufacturer Details</h3>
        </div>
        <div className="card-body">
          <div className="grid grid-2">
            {F('manufacturerName', 'Manufacturer Name')}
            {F('mfgLicenseNo', 'Manufacturing License Number', 'text', true, 'e.g. MFG/KA/2024/001234')}
          </div>
          <div className="form-group">
            <label className="form-label">Factory Address<span className="required">*</span></label>
            <textarea
              className={`form-control ${errors.factoryAddress ? 'error' : ''}`}
              value={formData.factoryAddress}
              onChange={e => { updateForm({ factoryAddress: e.target.value }); if (errors.factoryAddress) setErrors(p => ({ ...p, factoryAddress: '' })); }}
              placeholder="Complete factory / manufacturing unit address"
              rows={3}
            />
            {errors.factoryAddress && <div className="form-error">⚠ {errors.factoryAddress}</div>}
          </div>
          {F('manufacturingSite', 'Manufacturing Site Name', 'text', false, 'Name of the specific manufacturing site (if different)')}
        </div>
      </div>

      {/* Contact */}
      <div className="card mb-3">
        <div className="card-header">
          <span>📞</span>
          <h3>Manufacturer Contact</h3>
        </div>
        <div className="card-body">
          <div className="grid grid-3">
            {F('mfgContactPerson', 'Contact Person')}
            {F('mfgContactNumber', 'Contact Number', 'tel')}
            {F('mfgEmail', 'Email Address', 'email')}
          </div>
        </div>
      </div>

      {/* Authorized Signatory */}
      <div className="card mb-3">
        <div className="card-header">
          <span>✍️</span>
          <h3>Authorized Signatory</h3>
        </div>
        <div className="card-body">
          <div className="alert alert-info" style={{ marginBottom: 16 }}>
            <span>ℹ️</span>
            <span>The authorized signatory must be a responsible person as per the manufacturing license.</span>
          </div>
          <div className="grid grid-2">
            {F('signatoryName', 'Authorized Signatory Name')}
            {F('signatoryDesignation', 'Designation', 'text', true, 'e.g. Director, Quality Head, Regulatory Affairs Manager')}
          </div>
        </div>
      </div>

      <div className="step-actions">
        <button className="btn btn-outline" onClick={() => setCurrentStep(3)}>← Previous</button>
        <button className="btn btn-outline" onClick={saveDraft}>
          {draftSaved ? '✓ Draft Saved' : '💾 Save Draft'}
        </button>
        <button className="btn btn-primary btn-lg" onClick={() => { if (validate()) setCurrentStep(5); }}>
          Next: Document Upload →
        </button>
      </div>
    </div>
  );
}
