/**
 * Step5Shipments.js
 * Line-item table: every row is one shipment = { company, product, consignee/country, qty, batch }.
 * Combined with the multi-row companies[]/products[]/consignees[] arrays, this expresses all four
 * combinations the user asked for (same-co/same-prod/multi-country, etc.) in a single application.
 */
import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import './WizardStep.css';

const emptyBatchList = [];

export default function Step5Shipments() {
  const {
    formData,
    addShipment, updateShipment, deleteShipment, replaceShipments,
    setCurrentStep, saveDraft, draftSaved,
  } = useApp();
  const [errors, setErrors] = useState(''); // top-level string

  const companies  = useMemo(() => formData.companies || [], [formData.companies]);
  const products   = useMemo(() => formData.products || [], [formData.products]);
  const consignees = useMemo(() => formData.consignees || [], [formData.consignees]);
  const shipments  = formData.shipments  || [];

  /* Quick lookups for the summary strip */
  const byCompany   = useMemo(() => Object.fromEntries(companies.map(c => [c.companyRef, c])),   [companies]);
  const byProduct   = useMemo(() => Object.fromEntries(products.map(p => [p.productRef, p])),    [products]);
  const byConsignee = useMemo(() => Object.fromEntries(consignees.map(c => [c.consigneeRef, c])), [consignees]);

  /* Are the master lists usable? */
  const canBuild = companies.length > 0 && products.length > 0 && consignees.length > 0;

  /* ── Validation ─────────────────────────────────────────── */
  const validate = () => {
    if (shipments.length === 0) { setErrors('Add at least one shipment.'); return false; }
    for (const s of shipments) {
      if (!s.companyRef)   { setErrors('Every row needs a Manufacturer.'); return false; }
      if (!s.productRef)   { setErrors('Every row needs a Product.'); return false; }
      if (!s.consigneeRef) { setErrors('Every row needs a Destination.'); return false; }
      if (!s.quantity || Number(s.quantity) <= 0) { setErrors('Every row needs a quantity > 0.'); return false; }
    }
    // Duplicate triple
    const seen = new Set();
    for (const s of shipments) {
      const key = `${s.companyRef}|${s.productRef}|${s.consigneeRef}`;
      if (seen.has(key)) {
        const co = byCompany[s.companyRef]?.name || '?';
        const pr = byProduct[s.productRef]?.productName || '?';
        const cn = byConsignee[s.consigneeRef]?.country || '?';
        setErrors(`Duplicate shipment: ${co} → ${pr} → ${cn}. Merge or remove one.`);
        return false;
      }
      seen.add(key);
    }
    setErrors('');
    return true;
  };

  /* ── Quick-fill: expand one product across all consignees ── */
  const expandProductToAllCountries = (productRef, companyRef) => {
    if (!productRef || !companyRef) return;
    const existing = new Set(shipments.map(s => `${s.companyRef}|${s.productRef}|${s.consigneeRef}`));
    const rows = [...shipments];
    consignees.forEach(cn => {
      const key = `${companyRef}|${productRef}|${cn.consigneeRef}`;
      if (existing.has(key)) return;
      rows.push({
        shipmentRef: `sh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        companyRef, productRef, consigneeRef: cn.consigneeRef,
        quantity: '', packSize: '', batchNumbers: emptyBatchList,
      });
    });
    replaceShipments(rows);
  };

  /* Batch numbers helper: comma-separated text ↔ array */
  const batchesToString = (arr) => Array.isArray(arr) ? arr.join(', ') : '';
  const stringToBatches = (str) => (str || '').split(',').map(s => s.trim()).filter(Boolean);

  return (
    <div className="wizard-step fade-in">
      <div className="step-header">
        <div className="step-header-icon">🚚</div>
        <div>
          <h2>Shipments</h2>
          <p>Add one row per Manufacturer × Product × Destination combination.</p>
        </div>
      </div>

      {!canBuild && (
        <div className="alert alert-warning" style={{ marginBottom: 16 }}>
          <span>⚠️</span>
          <span>
            You need at least one <strong>manufacturer</strong>, one <strong>product</strong>, and one <strong>destination consignee</strong> before adding shipments.
            Go back to Steps 2 – 4 to add them.
          </span>
        </div>
      )}

      <div className="alert alert-info" style={{ marginBottom: 16 }}>
        <span>ℹ️</span>
        <span>
          Each row combines <strong>one Manufacturer</strong>, <strong>one Product</strong>, and <strong>one Destination</strong>.
          Add rows for every combination you want approved.
        </span>
      </div>

      {/* ── Summary strip ─────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <div className="rv-chip">🏭 {companies.length} Manufacturer{companies.length === 1 ? '' : 's'}</div>
        <div className="rv-chip">💊 {products.length} Product{products.length === 1 ? '' : 's'}</div>
        <div className="rv-chip">🌐 {consignees.length} Destination{consignees.length === 1 ? '' : 's'}</div>
        <div className="rv-chip rv-chip-primary">🚚 {shipments.length} Shipment line{shipments.length === 1 ? '' : 's'}</div>
      </div>

      {/* ── Shipment table ────────────────────────────────── */}
      {shipments.length === 0 ? (
        <div className="card mb-3" style={{ padding: '32px 20px', textAlign: 'center', color: '#64748b' }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>📦</div>
          <p style={{ margin: 0 }}>No shipments yet. Add your first shipment below.</p>
        </div>
      ) : (
        <div className="card mb-3">
          <div className="card-body" style={{ padding: 0, overflowX: 'auto' }}>
            <table className="rv-mini-table" style={{ minWidth: 900 }}>
              <thead>
                <tr>
                  <th style={{ width: 40 }}>#</th>
                  <th>Manufacturer</th>
                  <th>Product</th>
                  <th>Destination</th>
                  <th style={{ width: 110 }}>Quantity</th>
                  <th style={{ width: 200 }}>Batch numbers</th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {shipments.map((s, i) => (
                  <tr key={s.shipmentRef}>
                    <td>{i + 1}</td>
                    <td>
                      <select
                        className="form-control"
                        style={{ minWidth: 160 }}
                        value={s.companyRef || ''}
                        onChange={e => updateShipment(s.shipmentRef, { companyRef: e.target.value })}
                      >
                        <option value="">— Select —</option>
                        {companies.map(c => (
                          <option key={c.companyRef} value={c.companyRef}>
                            {c.name || '(unnamed)'}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        className="form-control"
                        style={{ minWidth: 160 }}
                        value={s.productRef || ''}
                        onChange={e => updateShipment(s.shipmentRef, { productRef: e.target.value })}
                      >
                        <option value="">— Select —</option>
                        {products.map(p => (
                          <option key={p.productRef} value={p.productRef}>
                            {p.productName || '(unnamed)'}{p.strength ? ` · ${p.strength}` : ''}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        className="form-control"
                        style={{ minWidth: 160 }}
                        value={s.consigneeRef || ''}
                        onChange={e => updateShipment(s.shipmentRef, { consigneeRef: e.target.value })}
                      >
                        <option value="">— Select —</option>
                        {consignees.map(c => (
                          <option key={c.consigneeRef} value={c.consigneeRef}>
                            {c.country || '(no country)'}{c.organisation ? ` — ${c.organisation}` : ''}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        className="form-control"
                        value={s.quantity ?? ''}
                        onChange={e => updateShipment(s.shipmentRef, { quantity: e.target.value })}
                        placeholder="Qty"
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        className="form-control"
                        value={batchesToString(s.batchNumbers)}
                        onChange={e => updateShipment(s.shipmentRef, { batchNumbers: stringToBatches(e.target.value) })}
                        placeholder="B001, B002"
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-outline"
                        style={{ padding: '4px 8px', color: '#dc2626', borderColor: '#fecaca' }}
                        title="Remove row"
                        onClick={() => deleteShipment(s.shipmentRef)}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Actions ───────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <button type="button" className="btn btn-outline" disabled={!canBuild} onClick={() => addShipment()}>
          + Add shipment row
        </button>

        {canBuild && products.length > 0 && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: '#64748b' }}>Quick-fill:</span>
            <select
              className="form-control"
              style={{ width: 'auto', fontSize: 12 }}
              defaultValue=""
              onChange={e => {
                const [pRef, cRef] = e.target.value.split('|');
                if (pRef && cRef) expandProductToAllCountries(pRef, cRef);
                e.target.value = '';
              }}
            >
              <option value="">Add one product to every destination…</option>
              {companies.flatMap(c =>
                products.map(p => (
                  <option key={`${p.productRef}|${c.companyRef}`} value={`${p.productRef}|${c.companyRef}`}>
                    {c.name || '(co)'} × {p.productName || '(prod)'} → all {consignees.length} countries
                  </option>
                ))
              )}
            </select>
          </div>
        )}
      </div>

      {errors && (
        <div className="alert alert-warning" style={{ marginBottom: 16 }}>
          <span>⚠️</span>
          <span>{errors}</span>
        </div>
      )}

      <div className="step-actions">
        <button className="btn btn-outline" onClick={() => setCurrentStep(4)}>← Previous</button>
        <button className="btn btn-outline" onClick={saveDraft}>
          {draftSaved ? '✓ Draft Saved' : '💾 Save Draft'}
        </button>
        <button className="btn btn-primary btn-lg" onClick={() => { if (validate()) setCurrentStep(6); }}>
          Next: Document Upload →
        </button>
      </div>
    </div>
  );
}
