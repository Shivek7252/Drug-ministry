import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { COUNTRIES, INDIAN_STATES } from '../../data/mockData';
import './WizardStep.css';

export default function Step2ConsigneeDetails() {
  const {
    formData,
    updateConsignee, addConsignee, deleteConsignee,
    setCurrentStep, saveDraft, draftSaved,
  } = useApp();
  const [errors, setErrors] = useState({}); // { [consigneeRef]: { field: msg } }

  const consignees = formData.consignees || [];

  /* On first mount: if the first row is empty but legacy top-level consignee
     fields have data (opening a legacy draft), hydrate row 0 from them. */
  useEffect(() => {
    if (consignees.length !== 1) return;
    const c0 = consignees[0] || {};
    const isEmpty = !c0.name && !c0.country && !c0.addressLine1;
    if (!isEmpty) return;
    if (formData.consigneeName || formData.consigneeCountry || formData.addressLine1) {
      updateConsignee(c0.consigneeRef, {
        name:          formData.consigneeName || '',
        organisation:  formData.consigneeOrg || '',
        addressLine1:  formData.addressLine1 || '',
        addressLine2:  formData.addressLine2 || '',
        city:          formData.city || '',
        state:         formData.state || '',
        country:       formData.consigneeCountry || formData.destinationCountry || '',
        postalCode:    formData.postalCode || '',
        contactPerson: formData.contactPerson || '',
        phone:         formData.consigneePhone || '',
        email:         formData.consigneeEmail || '',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setErr = (ref, field, msg) =>
    setErrors(p => ({ ...p, [ref]: { ...(p[ref] || {}), [field]: msg } }));

  const clearErr = (ref, field) =>
    setErrors(p => {
      const row = { ...(p[ref] || {}) };
      delete row[field];
      return { ...p, [ref]: row };
    });

  const validate = () => {
    let ok = true;
    const next = {};
    consignees.forEach(c => {
      const e = {};
      if (!c.name?.trim())          e.name = 'Consignee name is required';
      if (!c.organisation?.trim())  e.organisation = 'Organization is required';
      if (!c.addressLine1?.trim())  e.addressLine1 = 'Address is required';
      if (!c.city?.trim())          e.city = 'City is required';
      if (!c.country)               e.country = 'Country is required';
      if (!c.contactPerson?.trim()) e.contactPerson = 'Contact person is required';
      if (!c.phone?.trim())         e.phone = 'Phone is required';
      if (!c.email?.trim())         e.email = 'Email is required';
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) e.email = 'Enter a valid email';
      if (Object.keys(e).length) { next[c.consigneeRef] = e; ok = false; }
    });
    // Duplicate country check
    const seen = new Set();
    consignees.forEach(c => {
      if (!c.country) return;
      if (seen.has(c.country)) {
        next[c.consigneeRef] = { ...(next[c.consigneeRef] || {}), country: 'Duplicate country — merge or change' };
        ok = false;
      }
      seen.add(c.country);
    });
    setErrors(next);
    return ok;
  };

  const F = (c, field, label, opts = {}) => {
    const { type = 'text', required = true, placeholder } = opts;
    const err = errors[c.consigneeRef]?.[field];
    return (
      <div className="form-group">
        <label className="form-label">{label}{required && <span className="required">*</span>}</label>
        <input
          type={type}
          className={`form-control ${err ? 'error' : ''}`}
          value={c[field] || ''}
          onChange={e => { updateConsignee(c.consigneeRef, { [field]: e.target.value }); if (err) clearErr(c.consigneeRef, field); }}
          placeholder={placeholder || `Enter ${label.toLowerCase()}`}
        />
        {err && <div className="form-error">⚠ {err}</div>}
      </div>
    );
  };

  const S = (c, field, label, options, required = true) => {
    const err = errors[c.consigneeRef]?.[field];
    return (
      <div className="form-group">
        <label className="form-label">{label}{required && <span className="required">*</span>}</label>
        <select
          className={`form-control ${err ? 'error' : ''}`}
          value={c[field] || ''}
          onChange={e => { updateConsignee(c.consigneeRef, { [field]: e.target.value }); if (err) clearErr(c.consigneeRef, field); }}
        >
          <option value="">— Select {label} —</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        {err && <div className="form-error">⚠ {err}</div>}
      </div>
    );
  };

  return (
    <div className="wizard-step fade-in">
      <div className="step-header">
        <div className="step-header-icon">🏢</div>
        <div>
          <h2>Consignee / Importer Information</h2>
          <p>Add every destination-country consignee. Each becomes a destination in your shipments.</p>
        </div>
      </div>

      <div className="alert alert-info">
        <span>ℹ️</span>
        <span>
          Add one consignee per destination country. If the same product goes to multiple countries, add each country here — you'll combine them into shipments in Step 5.
        </span>
      </div>

      {consignees.map((c, idx) => (
        <div key={c.consigneeRef} className="card mb-3">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>🏭</span>
              <h3 style={{ margin: 0 }}>
                Consignee #{idx + 1}
                {c.country && <span style={{ fontWeight: 500, color: '#64748b', marginLeft: 8, fontSize: 13 }}>· {c.country}</span>}
              </h3>
            </div>
            {consignees.length > 1 && (
              <button
                type="button"
                className="btn btn-outline"
                style={{ padding: '4px 10px', fontSize: 12, color: '#dc2626', borderColor: '#fecaca' }}
                onClick={() => deleteConsignee(c.consigneeRef)}
              >
                ✕ Remove
              </button>
            )}
          </div>
          <div className="card-body">
            <div className="grid grid-2">
              {F(c, 'name', 'Consignee Name')}
              {F(c, 'organisation', 'Organization Name')}
            </div>
            {F(c, 'addressLine1', 'Address Line 1', { placeholder: 'Street address, building name' })}
            {F(c, 'addressLine2', 'Address Line 2', { required: false, placeholder: 'Apartment, suite, unit (optional)' })}
            <div className="grid grid-3">
              {F(c, 'city', 'City')}
              {S(c, 'state', 'State / Province', INDIAN_STATES, false)}
              {F(c, 'postalCode', 'Postal Code', { required: false })}
            </div>
            {S(c, 'country', 'Country', COUNTRIES)}
            <div className="grid grid-3">
              {F(c, 'contactPerson', 'Contact Person')}
              {F(c, 'phone', 'Phone Number', { type: 'tel' })}
              {F(c, 'email', 'Email Address', { type: 'email' })}
            </div>
          </div>
        </div>
      ))}

      <div style={{ marginBottom: 20 }}>
        <button type="button" className="btn btn-outline" onClick={addConsignee}>
          + Add another destination
        </button>
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
