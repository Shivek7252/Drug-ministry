import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { COUNTRIES, APPLICATION_TYPES, EXPORT_PURPOSES, EXPORT_CATEGORIES } from '../../data/mockData';
import './WizardStep.css';

export default function Step1ApplicationDetails() {
  const { formData, updateForm, setCurrentStep, saveDraft, draftSaved } = useApp();
  const [errors, setErrors] = useState({});

  const validate = () => {
    const e = {};
    if (!formData.applicationType) e.applicationType = 'Please select application type';
    if (!formData.exportPurpose) e.exportPurpose = 'Please select export purpose';
    if (!formData.exportCategory) e.exportCategory = 'Please select export category';
    if (!formData.destinationCountry) e.destinationCountry = 'Please select destination country';
    if (!formData.applicantName.trim()) e.applicantName = 'Applicant name is required';
    if (!formData.applicantOrganization.trim()) e.applicantOrganization = 'Organization name is required';
    if (!formData.contactNumber.trim()) e.contactNumber = 'Contact number is required';
    else if (!/^\+?[\d\s\-()]{8,15}$/.test(formData.contactNumber)) e.contactNumber = 'Enter a valid contact number';
    if (!formData.email.trim()) e.email = 'Email address is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) e.email = 'Enter a valid email address';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleNext = () => {
    if (validate()) setCurrentStep(2);
  };

  const F = (name, label, type = 'text', required = true) => (
    <div className="form-group">
      <label className="form-label">{label}{required && <span className="required">*</span>}</label>
      <input
        type={type}
        className={`form-control ${errors[name] ? 'error' : ''}`}
        value={formData[name]}
        onChange={e => { updateForm({ [name]: e.target.value }); if (errors[name]) setErrors(p => ({ ...p, [name]: '' })); }}
        placeholder={`Enter ${label.toLowerCase()}`}
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
        <div className="step-header-icon">📋</div>
        <div>
          <h2>Application Details</h2>
          <p>Provide basic information about your Export NOC application</p>
        </div>
      </div>

      <div className="alert alert-info">
        <span>ℹ️</span>
        <span>Fields marked with <strong>*</strong> are mandatory. Please ensure all information is accurate before proceeding.</span>
      </div>

      {/* Application Info */}
      <div className="card mb-3">
        <div className="card-header">
          <span>📄</span>
          <h3>Application Information</h3>
        </div>
        <div className="card-body">
          <div className="grid grid-2">
            {S('applicationType', 'Application Type', APPLICATION_TYPES)}
            {S('exportPurpose', 'Export Purpose', EXPORT_PURPOSES)}
            {S('exportCategory', 'Export Category', EXPORT_CATEGORIES)}
            {S('destinationCountry', 'Destination Country', COUNTRIES)}
            <div className="form-group">
              <label className="form-label">Application Date<span className="required">*</span></label>
              <input
                type="date"
                className="form-control"
                value={formData.applicationDate}
                onChange={e => updateForm({ applicationDate: e.target.value })}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Applicant Info */}
      <div className="card mb-3">
        <div className="card-header">
          <span>👤</span>
          <h3>Applicant Information</h3>
        </div>
        <div className="card-body">
          <div className="grid grid-2">
            {F('applicantName', 'Applicant Name')}
            {F('applicantOrganization', 'Applicant Organization')}
            {F('contactNumber', 'Contact Number', 'tel')}
            {F('email', 'Email Address', 'email')}
          </div>
        </div>
      </div>

      <div className="step-actions">
        <button className="btn btn-outline" onClick={saveDraft}>
          {draftSaved ? '✓ Draft Saved' : '💾 Save Draft'}
        </button>
        <button className="btn btn-primary btn-lg" onClick={handleNext}>
          Next: Consignee Details →
        </button>
      </div>
    </div>
  );
}
