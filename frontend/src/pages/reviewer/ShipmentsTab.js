/**
 * ShipmentsTab.js
 * Reviewer view of the line-item shipments table. Landing view is a matrix
 * groupable by Country / Product / Company; below that is a flat table with
 * per-line status pills and Verify / Query / Reject action buttons.
 */
import React, { useState, useMemo } from 'react';

const STATUS_META = {
  Pending:   { color: '#78716c', bg: '#f5f5f4', bd: '#e7e5e4', icon: '·' },
  Verified:  { color: '#1d4ed8', bg: '#eff6ff', bd: '#bfdbfe', icon: '✓' },
  Query:     { color: '#b45309', bg: '#fffbeb', bd: '#fde68a', icon: '?' },
  Approved:  { color: '#15803d', bg: '#f0fdf4', bd: '#bbf7d0', icon: '✓' },
  Rejected:  { color: '#b91c1c', bg: '#fef2f2', bd: '#fecaca', icon: '✗' },
};

function StatusPill({ status }) {
  const meta = STATUS_META[status] || STATUS_META.Pending;
  return (
    <span style={{
      background: meta.bg, color: meta.color, border: `1px solid ${meta.bd}`,
      borderRadius: 20, padding: '2px 8px', fontSize: 10.5, fontWeight: 700,
      display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
    }}>
      <span>{meta.icon}</span>
      <span>{status}</span>
    </span>
  );
}

export default function ShipmentsTab({ data, onLineAction, actionBusy }) {
  const shipments  = data.shipments  || [];
  const companies  = data.companies  || [];
  const products   = data.products   || [];
  const consignees = data.consignees || [];

  const [groupBy, setGroupBy] = useState('country'); // 'country' | 'product' | 'company'
  const [expandedIdx, setExpandedIdx] = useState(null);

  const byCompany   = useMemo(() => Object.fromEntries(companies.map(c => [c.companyRef, c])),   [companies]);
  const byProduct   = useMemo(() => Object.fromEntries(products.map(p => [p.productRef, p])),    [products]);
  const byConsignee = useMemo(() => Object.fromEntries(consignees.map(c => [c.consigneeRef, c])), [consignees]);

  /* Roll-up matrix: rows × columns depend on groupBy */
  const matrix = useMemo(() => {
    if (shipments.length === 0) return null;
    // rows dimension = groupBy; columns dimension = product (default) or country if groupBy=product
    const rowKey = groupBy === 'country'  ? s => byConsignee[s.consigneeRef]?.country || '(no country)'
                :  groupBy === 'company'  ? s => byCompany[s.companyRef]?.name         || '(no company)'
                :  /* product */            s => byProduct[s.productRef]?.productName  || '(no product)';
    const colKey = groupBy === 'product'  ? s => byConsignee[s.consigneeRef]?.country || '(no country)'
                :                            s => byProduct[s.productRef]?.productName || '(no product)';

    const rowSet = new Set(), colSet = new Set();
    shipments.forEach(s => { rowSet.add(rowKey(s)); colSet.add(colKey(s)); });
    const rows = [...rowSet].sort();
    const cols = [...colSet].sort();

    const cell = {};   // "row||col" → { qty, statuses: {Pending: n, Approved: n, ...}, count }
    shipments.forEach(s => {
      const r = rowKey(s), c = colKey(s);
      const key = `${r}||${c}`;
      cell[key] = cell[key] || { qty: 0, count: 0, statuses: {} };
      cell[key].qty   += Number(s.quantity) || 0;
      cell[key].count += 1;
      const st = s.lineStatus || 'Pending';
      cell[key].statuses[st] = (cell[key].statuses[st] || 0) + 1;
    });

    const rowTotals = Object.fromEntries(rows.map(r => [r, 0]));
    const colTotals = Object.fromEntries(cols.map(c => [c, 0]));
    let grand = 0;
    Object.entries(cell).forEach(([k, v]) => {
      const [r, c] = k.split('||');
      rowTotals[r] += v.qty; colTotals[c] += v.qty; grand += v.qty;
    });
    return { rows, cols, cell, rowTotals, colTotals, grand };
  }, [shipments, groupBy, byCompany, byProduct, byConsignee]);

  if (shipments.length === 0) {
    return (
      <div className="rv-state-box" style={{ padding: 24 }}>
        <span className="rv-state-sub">No shipments defined for this application.</span>
      </div>
    );
  }

  const cellStatusIcon = (statuses) => {
    if (!statuses) return null;
    const parts = [];
    ['Approved', 'Verified', 'Query', 'Rejected', 'Pending'].forEach(s => {
      if (statuses[s]) parts.push(`${STATUS_META[s].icon}${statuses[s]}`);
    });
    return <span style={{ fontSize: 10, color: '#64748b', marginLeft: 4 }}>{parts.join(' ')}</span>;
  };

  return (
    <div className="rv-shipments-tab">

      {/* Grouping switcher — matches screenshot blue-underline style */}
      <div className="rv-shipments-groupby">
        <span style={{ fontSize: 12, fontWeight: 700, color: '#475569', padding: '6px 12px 6px 0', whiteSpace: 'nowrap' }}>Group by:</span>
        {[['country', '🌐 Country'], ['product', '💊 Product'], ['company', '🏭 Company']].map(([k, l]) => (
          <button
            key={k}
            className={`rv-tab-btn ${groupBy === k ? 'active' : ''}`}
            onClick={() => setGroupBy(k)}
          >
            {l}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', padding: '6px 0', fontSize: 12, color: '#94a3b8' }}>
          {shipments.length} line{shipments.length === 1 ? '' : 's'}
        </div>
      </div>

      {/* Content padded area */}
      <div style={{ padding: '12px 0' }}>

      {/* Summary matrix */}
      {matrix && (
        <div style={{ marginBottom: 14, overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 10, background: '#fff', padding: '0' }}>
          <table className="rv-mini-table" style={{ minWidth: 600 }}>
            <thead>
              <tr>
                <th style={{ background: '#f1f5f9' }}>{groupBy === 'country' ? 'Country' : groupBy === 'company' ? 'Company' : 'Product'}</th>
                {matrix.cols.map(c => <th key={c}>{c}</th>)}
                <th style={{ background: '#eff6ff', color: '#1e40af' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map(r => (
                <tr key={r}>
                  <td style={{ fontWeight: 700, background: '#f8fafc' }}>{r}</td>
                  {matrix.cols.map(c => {
                    const v = matrix.cell[`${r}||${c}`];
                    if (!v) return <td key={c} style={{ color: '#cbd5e1' }}>—</td>;
                    return (
                      <td key={c}>
                        <div style={{ fontWeight: 600 }}>{v.qty.toLocaleString()}</div>
                        {cellStatusIcon(v.statuses)}
                      </td>
                    );
                  })}
                  <td style={{ fontWeight: 700, color: '#1e40af', background: '#f0f9ff' }}>
                    {matrix.rowTotals[r].toLocaleString()}
                  </td>
                </tr>
              ))}
              <tr>
                <td style={{ fontWeight: 700, background: '#eff6ff', color: '#1e40af' }}>Total</td>
                {matrix.cols.map(c => (
                  <td key={c} style={{ fontWeight: 700, color: '#1e40af', background: '#f0f9ff' }}>
                    {matrix.colTotals[c].toLocaleString()}
                  </td>
                ))}
                <td style={{ fontWeight: 800, color: '#1e40af', background: '#dbeafe' }}>
                  {matrix.grand.toLocaleString()}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '12px 0', fontSize: 11, color: '#94a3b8', padding: '0 2px' }}>
        <span>Cell counts: {STATUS_META.Approved.icon} approved · {STATUS_META.Query.icon} query · {STATUS_META.Rejected.icon} rejected · {STATUS_META.Pending.icon} pending</span>
      </div>

      {/* Line-item table */}
      <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, background: '#fff', overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid #e2e8f0', fontWeight: 700, fontSize: 13, color: '#0f172a', background: '#f8fafc' }}>
          Shipment line items
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="rv-mini-table" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th style={{ width: 36 }}>#</th>
                <th>Manufacturer</th>
                <th>Product</th>
                <th>Destination</th>
                <th style={{ width: 80 }}>Qty</th>
                <th>Batches</th>
                <th style={{ width: 90 }}>Status</th>
                <th style={{ width: 210 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {shipments.map((s, i) => {
                const co = byCompany[s.companyRef]     || {};
                const pr = byProduct[s.productRef]     || {};
                const cn = byConsignee[s.consigneeRef] || {};
                const status = s.lineStatus || 'Pending';
                const isExpanded = expandedIdx === i;
                const disabled = !!actionBusy && actionBusy === i;
                return (
                  <React.Fragment key={s.shipmentRef || i}>
                    <tr>
                      <td>{i + 1}</td>
                      <td>{co.name || '—'}</td>
                      <td>
                        <strong>{pr.productName || '—'}</strong>
                        {pr.strength && <span style={{ color: '#64748b', fontSize: 11 }}> · {pr.strength}</span>}
                      </td>
                      <td>
                        <strong>{cn.country || '—'}</strong>
                        {cn.organisation && <div style={{ fontSize: 10.5, color: '#64748b' }}>{cn.organisation}</div>}
                      </td>
                      <td>{(Number(s.quantity) || 0).toLocaleString()}</td>
                      <td style={{ fontSize: 11 }}>
                        {Array.isArray(s.batchNumbers) ? s.batchNumbers.join(', ') : ''}
                      </td>
                      <td><StatusPill status={status} /></td>
                      <td>
                        {onLineAction ? (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button
                              className="rv-verify-btn"
                              style={{ padding: '4px 8px', fontSize: 11, background: '#f0fdf4', color: '#15803d', borderColor: '#bbf7d0' }}
                              disabled={disabled}
                              onClick={() => onLineAction(i, 'Approved')}
                            >✓ Approve</button>
                            <button
                              className="rv-verify-btn"
                              style={{ padding: '4px 8px', fontSize: 11, background: '#fffbeb', color: '#b45309', borderColor: '#fde68a' }}
                              disabled={disabled}
                              onClick={() => onLineAction(i, 'Query')}
                            >? Query</button>
                            <button
                              className="rv-verify-btn"
                              style={{ padding: '4px 8px', fontSize: 11, background: '#fef2f2', color: '#b91c1c', borderColor: '#fecaca' }}
                              disabled={disabled}
                              onClick={() => onLineAction(i, 'Rejected')}
                            >✗ Reject</button>
                            {(s.lineRemarks && s.lineRemarks.length > 0) && (
                              <button
                                className="rv-verify-btn"
                                style={{ padding: '4px 6px', fontSize: 11 }}
                                onClick={() => setExpandedIdx(isExpanded ? null : i)}
                                title="Show remarks"
                              >{isExpanded ? '▲' : '▼'}</button>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: '#94a3b8', fontSize: 11 }}>—</span>
                        )}
                      </td>
                    </tr>
                    {isExpanded && s.lineRemarks && s.lineRemarks.length > 0 && (
                      <tr>
                        <td colSpan={8} style={{ background: '#f8fafc', padding: '10px 14px' }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 6 }}>Remarks history</div>
                          {s.lineRemarks.map((r, ri) => (
                            <div key={ri} style={{ fontSize: 11.5, marginBottom: 4, paddingLeft: 8, borderLeft: '2px solid #cbd5e1' }}>
                              <span style={{ color: '#64748b' }}>{r.officer || 'reviewer'}</span>
                              <span style={{ margin: '0 6px', color: '#94a3b8' }}>·</span>
                              <span style={{ fontWeight: 600 }}>{r.status}</span>
                              <span style={{ margin: '0 6px', color: '#94a3b8' }}>·</span>
                              <span style={{ color: '#64748b' }}>{r.timestamp ? new Date(r.timestamp).toLocaleString('en-IN') : ''}</span>
                              <div style={{ color: '#0f172a', marginTop: 2 }}>{r.text}</div>
                            </div>
                          ))}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      </div>{/* end padded area */}
    </div>
  );
}
