import React, { useState, useEffect } from 'react';
import { getApplicationFull } from '../../api/applicationService';
import './ReviewDashboard.css';

const REQUIRED_DOCS = [
  { id:'mfg_license',     label:'Manufacturing License',        docType:'mfg_license' },
  { id:'product_approval',label:'Product Approval Certificate', docType:'product_approval' },
  { id:'export_auth',     label:'Export Authorization Letter',  docType:'export_auth' },
  { id:'qa_cert',         label:'Quality Assurance Certificate',docType:'qa_cert' },
  { id:'batch_analysis',  label:'Batch Analysis Report',        docType:'batch_analysis' },
  { id:'product_info',    label:'Product Information Sheet',    docType:'product_info' },
];

const STATUS_OPTIONS = ['Under Review','Verified','Query Raised','Approved','Rejected'];

/* ── Collapsible section ────────────────────────────────── */
function Sec({ title, icon, defaultOpen=true, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rv-section">
      <button className="rv-section-hdr" onClick={() => setOpen(o=>!o)}>
        <span>{icon} {title}</span>
        <span style={{fontSize:10,color:'#94a3b8'}}>{open?'▲':'▼'}</span>
      </button>
      {open && <div className="rv-section-body">{children}</div>}
    </div>
  );
}

/* ── Info field ─────────────────────────────────────────── */
function F({ label, value }) {
  if (!value) return null;
  return (
    <div className="rv-field">
      <span className="rv-field-label">{label}</span>
      <span className="rv-field-value">{value}</span>
    </div>
  );
}

/* ── Mismatch popup ─────────────────────────────────────── */
function MismatchPopup({ docLabel, onClose, onForward, onReject }) {
  return (
    <div className="rv-popup-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="rv-popup-box">
        <div className="rv-popup-icon">🚫</div>
        <h2 className="rv-popup-title">Document Mismatched</h2>
        <p className="rv-popup-body">
          Uploaded document does not match the prescribed template.
        </p>
        <div className="rv-popup-doc"><strong>Document:</strong> {docLabel}</div>
        <div className="rv-popup-btns">
          <button className="rv-popup-btn-fwd"    onClick={onForward}>⏩ Forward for Further Review</button>
          <button className="rv-popup-btn-rej"    onClick={onReject} >❌ Reject Application</button>
          <button className="rv-popup-btn-cancel" onClick={onClose}  >Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default function ReviewApplicationDetail({ app, onClose, onAction, actionLoading }) {
  const [full,         setFull]        = useState(null);
  const [loadingFull,  setLoadingFull] = useState(true);
  const [actionStatus, setActionStatus]= useState('');
  const [remarks,      setRemarks]     = useState('');
  const [showForm,     setShowForm]    = useState(false);
  const [docVerifying, setDocVerifying]= useState({});
  const [docResult,    setDocResult]   = useState({}); // docId → 'ok'|'bad'
  const [mismatchDoc,  setMismatchDoc] = useState(null);
  const [activeTab,    setActiveTab]   = useState('details');

  useEffect(() => {
    setFull(null); setLoadingFull(true); setDocResult({}); setShowForm(false);
    getApplicationFull(app.applicationNumber).then(res => {
      if (res.success) setFull(res.application);
      setLoadingFull(false);
    });
  }, [app.applicationNumber]);

  const data = full || app;

  /* Verify doc */
  const verifyDoc = async (docId, docLabel, docType, objectUrl) => {
    if (!objectUrl) { setDocResult(p=>({...p,[docId]:'no-url'})); return false; }
    setDocVerifying(p=>({...p,[docId]:true}));
    try {
      const blob = await fetch(objectUrl).then(r=>r.blob());
      const form = new FormData();
      form.append('file', blob, docLabel+'.pdf');
      form.append('docType', docType);
      const res  = await fetch('http://localhost:5001/api/validate-template', {method:'POST',body:form});
      const json = await res.json();
      const ok   = json.matched !== false;
      setDocResult(p=>({...p,[docId]:ok?'ok':'bad'}));
      if (!ok) { setMismatchDoc({ docId, docLabel }); return false; }
      return true;
    } catch {
      setDocResult(p=>({...p,[docId]:'ok'}));
      return true;
    } finally {
      setDocVerifying(p=>({...p,[docId]:false}));
    }
  };

  const handleDocClick = async (docId, docLabel, docType, objectUrl) => {
    const prev = docResult[docId];
    if (prev === 'ok')  { if (objectUrl) window.open(objectUrl,'_blank'); return; }
    if (prev === 'bad') { setMismatchDoc({ docId, docLabel }); return; }
    const ok = await verifyDoc(docId, docLabel, docType, objectUrl);
    if (ok && objectUrl) window.open(objectUrl,'_blank');
  };

  const handleSubmit = () => {
    if (!actionStatus) { alert('Please select a status.'); return; }
    if ((actionStatus==='Rejected'||actionStatus==='Query Raised') && !remarks.trim()) {
      alert('Remarks are mandatory for this action.'); return;
    }
    onAction(data.applicationNumber, actionStatus, remarks);
    setShowForm(false); setRemarks(''); setActionStatus('');
  };

  /* Status badge color */
  const statusColor = { Approved:'#15803d', Rejected:'#dc2626', 'Under Review':'#a16207', Verified:'#15803d', 'Query Raised':'#c2410c', Submitted:'#1d4ed8' };
  const statusBg    = { Approved:'#f0fdf4', Rejected:'#fef2f2', 'Under Review':'#fefce8', Verified:'#f0fdf4', 'Query Raised':'#fff7ed', Submitted:'#eff6ff' };
  const statusBorder= { Approved:'#bbf7d0', Rejected:'#fecaca', 'Under Review':'#fde68a', Verified:'#bbf7d0', 'Query Raised':'#fdba74', Submitted:'#bfdbfe' };
  const sc = statusColor[data.status] || '#64748b';
  const sb = statusBg[data.status]    || '#f8fafc';
  const sbd= statusBorder[data.status]|| '#e2e8f0';

  return (
    <div className="rv-detail-card">
      {/* Head */}
      <div className="rv-detail-head">
        <div>
          <div className="rv-detail-appno">{data.applicationNumber}</div>
          <div className="rv-detail-ref">{data.referenceNumber} · {data.applicantOrganization || data.applicantName || ''}</div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <span style={{background:sb,color:sc,border:`1px solid ${sbd}`,
            borderRadius:20,padding:'4px 12px',fontSize:11,fontWeight:700,whiteSpace:'nowrap'}}>
            {data.status}
          </span>
          <button className="rv-detail-close" onClick={onClose}>✕ Close</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="rv-tabs">
        {[['details','📋 Details'],['docs','📁 Documents'],['audit','📜 Audit']].map(([k,l])=>(
          <button key={k} className={`rv-tab-btn ${activeTab===k?'active':''}`} onClick={()=>setActiveTab(k)}>{l}</button>
        ))}
      </div>

      {/* Tab content */}
      <div className="rv-tab-body">
        {loadingFull && (
          <div className="rv-state-box">
            <div className="rv-spinner"/>
            <span className="rv-state-sub">Loading full details…</span>
          </div>
        )}

        {/* ── DETAILS ── */}
        {!loadingFull && activeTab==='details' && (
          <>
            <Sec title="Application Details" icon="📋">
              <div className="rv-grid-2">
                <F label="Application No."  value={data.applicationNumber}/>
                <F label="Reference No."    value={data.referenceNumber}/>
                <F label="Application Type" value={data.applicationType}/>
                <F label="Export Purpose"   value={data.exportPurpose}/>
                <F label="Export Category"  value={data.exportCategory}/>
                <F label="Destination"      value={data.destinationCountry}/>
                <F label="Application Date" value={data.applicationDate}/>
                <F label="Submitted At"     value={data.submittedAt?new Date(data.submittedAt).toLocaleString('en-IN'):'—'}/>
              </div>
            </Sec>
            <Sec title="Applicant" icon="👤">
              <div className="rv-grid-2">
                <F label="Name"         value={data.applicantName}/>
                <F label="Organization" value={data.applicantOrganization}/>
                <F label="Contact"      value={data.contactNumber}/>
                <F label="Email"        value={data.email}/>
              </div>
            </Sec>
            <Sec title="Consignee / Importer" icon="🏢" defaultOpen={false}>
              <div className="rv-grid-2">
                <F label="Consignee"   value={data.consigneeName}/>
                <F label="Org"         value={data.consigneeOrg}/>
                <F label="Country"     value={data.consigneeCountry}/>
                <F label="Contact"     value={data.contactPerson}/>
                <F label="Phone"       value={data.consigneePhone}/>
                <F label="Email"       value={data.consigneeEmail}/>
                <F label="Address" value={[data.addressLine1,data.city,data.state,data.postalCode].filter(Boolean).join(', ')}/>
              </div>
            </Sec>
            {data.products?.length>0 && (
              <Sec title={`Products (${data.products.length})`} icon="💊" defaultOpen={false}>
                <div className="rv-mini-table-wrap">
                  <table className="rv-mini-table">
                    <thead><tr><th>#</th><th>Product</th><th>Form</th><th>Strength</th><th>Batch</th></tr></thead>
                    <tbody>
                      {data.products.map((p,i)=>(
                        <tr key={i}>
                          <td>{i+1}</td>
                          <td><strong>{p.productName}</strong><br/><span style={{fontSize:10,color:'#64748b'}}>{p.genericName}</span></td>
                          <td><span className="rv-cat-pill">{p.dosageForm}</span></td>
                          <td>{p.strength}</td>
                          <td><code style={{fontSize:10,background:'#f1f5f9',padding:'1px 4px',borderRadius:3}}>{p.batchNumber}</code></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Sec>
            )}
            <Sec title="Manufacturer" icon="🏭" defaultOpen={false}>
              <div className="rv-grid-2">
                <F label="Manufacturer"  value={data.manufacturerName}/>
                <F label="License No."   value={data.mfgLicenseNo}/>
                <F label="Factory Addr." value={data.factoryAddress}/>
                <F label="Signatory"     value={`${data.signatoryName||''}${data.signatoryDesignation?` — ${data.signatoryDesignation}`:''}`}/>
              </div>
            </Sec>
            {data.reviewerRemarks?.length>0 && (
              <Sec title="Review History" icon="💬">
                <div className="rv-remarks-panel" style={{padding:0}}>
                  {data.reviewerRemarks.map((r,i)=>(
                    <div key={i} className="rv-remark-bubble">
                      <div className="rv-remark-meta">
                        <span className="rv-remark-who">👨‍💼 {r.officer}</span>
                        <span style={{background:sb,color:sc,border:`1px solid ${sbd}`,borderRadius:20,padding:'1px 8px',fontSize:10,fontWeight:700}}>{r.status}</span>
                        <span className="rv-remark-time">{new Date(r.timestamp).toLocaleString('en-IN')}</span>
                      </div>
                      <p className="rv-remark-text">{r.text}</p>
                    </div>
                  ))}
                </div>
              </Sec>
            )}
          </>
        )}

        {/* ── DOCUMENTS ── */}
        {!loadingFull && activeTab==='docs' && (
          <div className="rv-docs-panel">
            <div className="rv-docs-info">
              <span>ℹ️</span>
              <span>Click <strong>Verify &amp; Open</strong> to validate a document against the prescribed template before opening it.</span>
            </div>
            {REQUIRED_DOCS.map(doc => {
              const up  = data.documents?.[doc.id];
              const res = docResult[doc.id];
              const ver = docVerifying[doc.id];
              const cls = !up?'rv-doc-none':res==='ok'?'rv-doc-ok':res==='bad'?'rv-doc-bad':'';
              return (
                <div key={doc.id} className={`rv-doc-row ${cls}`}>
                  <span className="rv-doc-icon-big">
                    {!up?'❌':res==='ok'?'✅':res==='bad'?'🚫':'📄'}
                  </span>
                  <div className="rv-doc-info">
                    <div className="rv-doc-name">{doc.label}</div>
                    {up
                      ? <div className="rv-doc-file">{up.name} · {up.uploadedAt}</div>
                      : <div className="rv-doc-missing-lbl">Not uploaded</div>}
                  </div>
                  <div className="rv-doc-actions">
                    {res==='ok'  && <span className="rv-status-chip rv-chip-ok">✓ Verified</span>}
                    {res==='bad' && <span className="rv-status-chip rv-chip-bad">✗ Mismatch</span>}
                    {ver && <span className="rv-verifying-lbl">🔍 Verifying…</span>}
                    {up && !ver && (
                      <button className="rv-verify-btn"
                        onClick={()=>handleDocClick(doc.id,doc.label,doc.docType,up.objectUrl||'')}>
                        {res==='ok'?'👁 Open':'🔍 Verify & Open'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── AUDIT ── */}
        {!loadingFull && activeTab==='audit' && (
          <div className="rv-audit-panel">
            {(!data.auditLog||data.auditLog.length===0)
              ? <div className="rv-state-box" style={{padding:24}}><span className="rv-state-sub">No audit events recorded</span></div>
              : [...(data.auditLog||[])].reverse().map((e,i,arr)=>(
                <div key={i} className="rv-audit-entry">
                  <div className="rv-audit-dot-wrap">
                    <div className="rv-audit-dot"/>
                    {i<arr.length-1 && <div className="rv-audit-line"/>}
                  </div>
                  <div className="rv-audit-body">
                    <div className="rv-audit-evt">{(e.action||'').replace(/_/g,' ')}</div>
                    <div className="rv-audit-desc">{e.detail}</div>
                    <div className="rv-audit-meta">
                      <span>👤 {e.user||'system'}</span>
                      <span>🕒 {e.timestamp?new Date(e.timestamp).toLocaleString('en-IN'):'—'}</span>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* ── Action bar ── */}
      <div className="rv-action-bar">
        {!showForm ? (
          <div className="rv-action-btns">
            <button className="rv-act-btn rv-act-btn-review"  onClick={()=>{setActionStatus('Under Review');setShowForm(true);}}>🔍 Under Review</button>
            <button className="rv-act-btn rv-act-btn-approve" onClick={()=>{setActionStatus('Approved');   setShowForm(true);}}>✅ Approve</button>
            <button className="rv-act-btn rv-act-btn-query"   onClick={()=>{setActionStatus('Query Raised');setShowForm(true);}}>❓ Query</button>
            <button className="rv-act-btn rv-act-btn-reject"  onClick={()=>{setActionStatus('Rejected');   setShowForm(true);}}>❌ Reject</button>
          </div>
        ) : (
          <div className="rv-action-form">
            <div className="rv-action-form-row">
              <strong style={{fontSize:12.5,color:'#334155'}}>Decision:</strong>
              <select className="rv-status-select" value={actionStatus} onChange={e=>setActionStatus(e.target.value)}>
                <option value="">— Select Status —</option>
                {STATUS_OPTIONS.map(s=><option key={s}>{s}</option>)}
              </select>
              {(actionStatus==='Rejected'||actionStatus==='Query Raised') && (
                <span className="rv-req-note">* Remarks required</span>
              )}
            </div>
            <textarea className="rv-textarea" rows={3}
              placeholder={`Remarks / Observations${actionStatus==='Rejected'||actionStatus==='Query Raised'?' (required)':''}…`}
              value={remarks} onChange={e=>setRemarks(e.target.value)}/>
            <div className="rv-form-actions">
              <button className="rv-submit-btn" onClick={handleSubmit} disabled={actionLoading}>
                {actionLoading?'⏳ Saving…':'💾 Submit Decision'}
              </button>
              <button className="rv-cancel-btn" onClick={()=>{setShowForm(false);setRemarks('');setActionStatus('');}}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Mismatch popup */}
      {mismatchDoc && (
        <MismatchPopup
          docLabel={mismatchDoc.docLabel}
          onClose={()=>setMismatchDoc(null)}
          onForward={()=>{
            setMismatchDoc(null);
            onAction(data.applicationNumber,'Query Raised',`Document mismatch: ${mismatchDoc.docLabel} does not match prescribed template. Forwarded for further review.`);
          }}
          onReject={()=>{
            setMismatchDoc(null);
            setActionStatus('Rejected');
            setRemarks(`Document mismatch: ${mismatchDoc.docLabel} does not match the prescribed template.`);
            setShowForm(true);
          }}
        />
      )}
    </div>
  );
}
