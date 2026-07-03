import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import './WizardStep.css';

export default function Step4ManufacturerDetails() {
  const {
    formData,
    updateCompany, addCompany, deleteCompany,
    setCurrentStep, saveDraft, draftSaved,
  } = useApp();
  const [errors, setErrors] = useState({}); // { [companyRef]: { field: msg } }

  const companies = formData.companies || [];

  /* Hydrate first row from legacy top-level manufacturer fields (opening old draft) */
  useEffect(() => {
    if (companies.length !== 1) return;
    const c0 = companies[0] || {};
    const isEmpty = !c0.name && !c0.licenseNo && !c0.factoryAddress;
    if (!isEmpty) return;
    if (formData.manufacturerName || formData.mfgLicenseNo || formData.factoryAddress) {
      updateCompany(c0.companyRef, {
        name:                 formData.manufacturerName || '',
        licenseNo:            formData.mfgLicenseNo || '',
        factoryAddress:       formData.factoryAddress || '',
        manufacturingSite:    formData.manufacturingSite || '',
        contactPerson:        formData.mfgContactPerson || '',
        contactNumber:        formData.mfgContactNumber || '',
        email:                formData.mfgEmail || '',
        signatoryName:        formData.signatoryName || '',
        signatoryDesignation: formData.signatoryDesignation || '',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearErr = (ref, field) =>
    setErrors(p => {
      const row = { ...(p[ref] || {}) };
      delete row[field];
      return { ...p, [ref]: row };
    });

  const validate = () => {
    let ok = true;
    const next = {};
    companies.forEach(c => {
      const e = {};
      if (!c.name?.trim())            e.name = 'Manufacturer name is required';
      if (!c.licenseNo?.trim())       e.licenseNo = 'License number is required';
      if (!c.factoryAddress?.trim())  e.factoryAddress = 'Factory address is required';
      if (!c.contactPerson?.trim())   e.contactPerson = 'Contact person is required';
      if (!c.contactNumber?.trim())   e.contactNumber = 'Contact number is required';
      if (!c.email?.trim())           e.email = 'Email is required';
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) e.email = 'Enter a valid email';
      if (!c.signatoryName?.trim())        e.signatoryName = 'Signatory name is required';
      if (!c.signatoryDesignation?.trim()) e.signatoryDesignation = 'Designation is required';
      if (Object.keys(e).length) { next[c.companyRef] = e; ok = false; }
    });
    // Duplicate licence number check
    const seen = new Set();
    companies.forEach(c => {
      const l = (c.licenseNo || '').trim();
      if (!l) return;
      if (seen.has(l)) {
        next[c.companyRef] = { ...(next[c.companyRef] || {}), licenseNo: 'Duplicate licence number' };
        ok = false;
      }
      seen.add(l);
    });
    setErrors(next);
    return ok;
  };

  const F = (c, field, label, opts = {}) => {
    const { type = 'text', required = true, placeholder } = opts;
    const err = errors[c.companyRef]?.[field];
    return (
      <div className="form-group">
        <label className="form-label">{label}{required && <span className="required">*</span>}</label>
        <input
          type={type}
          className={`form-control ${err ? 'error' : ''}`}
          value={c[field] || ''}
          onChange={e => { updateCompany(c.companyRef, { [field]: e.target.value }); if (err) clearErr(c.companyRef, field); }}
          placeholder={placeholder || `Enter ${label.toLowerCase()}`}
        />
        {err && <div className="form-error">⚠ {err}</div>}
      </div>
    );
  };

  return (
    <div className="wizard-step fade-in">
      <div className="step-header">
        <div className="step-header-icon">🏭</div>
        <div>
          <h2>Manufacturer Information</h2>
          <p>Add every manufacturer / site that produces the drugs in this application.</p>
        </div>
      </div>

      <div className="alert alert-warning">
        <span>⚠️</span>
        <span>Manufacturing licence details must match the licences issued by the State Drug Authority. Incorrect details may lead to rejection.</span>
      </div>

      {companies.map((c, idx) => (
        <div key={c.companyRef} className="card mb-3">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>🏭</span>
              <h3 style={{ margin: 0 }}>
                Manufacturer #{idx + 1}
                {c.name && <span style={{ fontWeight: 500, color: '#64748b', marginLeft: 8, fontSize: 13 }}>· {c.name}</span>}
              </h3>
            </div>
            {companies.length > 1 && (
              <button
                type="button"
                className="btn btn-outline"
                style={{ padding: '4px 10px', fontSize: 12, color: '#dc2626', borderColor: '#fecaca' }}
                onClick={() => deleteCompany(c.companyRef)}
              >
                ✕ Remove
              </button>
            )}
          </div>
          <div className="card-body">
            <div className="grid grid-2">
              {F(c, 'name', 'Manufacturer Name')}
              {F(c, 'licenseNo', 'Manufacturing Licence Number', { placeholder: 'e.g. MFG/KA/2024/001234' })}
            </div>
            <div className="form-group">
              <label className="form-label">Factory Address<span className="required">*</span></label>
              <textarea
                className={`form-control ${errors[c.companyRef]?.factoryAddress ? 'error' : ''}`}
                value={c.factoryAddress || ''}
                onChange={e => { updateCompany(c.companyRef, { factoryAddress: e.target.value }); if (errors[c.companyRef]?.factoryAddress) clearErr(c.companyRef, 'factoryAddress'); }}
                placeholder="Complete factory / manufacturing unit address"
                rows={3}
              />
              {errors[c.companyRef]?.factoryAddress && <div className="form-error">⚠ {errors[c.companyRef].factoryAddress}</div>}
            </div>
            {F(c, 'manufacturingSite', 'Manufacturing Site Name', { required: false, placeholder: 'Name of the specific manufacturing site (if different)' })}
            <div className="grid grid-3">
              {F(c, 'contactPerson', 'Contact Person')}
              {F(c, 'contactNumber', 'Contact Number', { type: 'tel' })}
              {F(c, 'email', 'Email Address', { type: 'email' })}
            </div>
            <div className="grid grid-2">
              {F(c, 'signatoryName', 'Authorized Signatory Name')}
              {F(c, 'signatoryDesignation', 'Designation', { placeholder: 'e.g. Director, QA Head' })}
            </div>
          </div>
        </div>
      ))}

      <div style={{ marginBottom: 20 }}>
        <button type="button" className="btn btn-outline" onClick={addCompany}>
          + Add another manufacturer
        </button>
      </div>

      <div className="step-actions">
        <button className="btn btn-outline" onClick={() => setCurrentStep(3)}>← Previous</button>
        <button className="btn btn-outline" onClick={saveDraft}>
          {draftSaved ? '✓ Draft Saved' : '💾 Save Draft'}
        </button>
        <button className="btn btn-primary btn-lg" onClick={() => { if (validate()) setCurrentStep(5); }}>
          Next: Shipments →
        </button>
      </div>
    </div>
  );
}
