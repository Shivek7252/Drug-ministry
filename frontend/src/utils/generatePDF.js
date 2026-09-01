/**
 * generatePDF.js
 * Primary:  calls backend /api/fill-templates which overlays form data onto
 *           the real CDSCO PDF templates (pdf-lib).
 * Fallback: generates a formatted PDF locally with jsPDF if backend is offline.
 */
import { jsPDF } from 'jspdf';
import { BACKEND_ORIGIN } from '../config/api';
import { authenticatedFetch } from '../api/http';

const BACKEND = BACKEND_ORIGIN;
const APP_NO  = 'EXP-2026-000145';

/* ─── Try backend template fill first, fall back to jsPDF ─────────────── */
export async function downloadFullApplicationPDF(formData) {
  try {
    const resp = await authenticatedFetch(`${BACKEND}/api/fill-templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData),
    });
    if (resp.ok) {
      const blob = await resp.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = blob.type === 'application/zip'
        ? `Export_NOC_Filled_Templates.zip`
        : `Export_NOC_Application.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }
  } catch { /* backend offline — use fallback */ }
  generateFormPDF(formData, 'all');
}

export async function downloadSectionPDF(formData, section) {
  const templateMap = {
    application:  'noc',
    consignee:    'po',
    products:     'po',
    manufacturer: 'manufacturing',
    documents:    null,
    declaration:  'legal',
  };
  const tmpl = templateMap[section];
  if (tmpl) {
    try {
      const resp = await authenticatedFetch(`${BACKEND}/api/fill-template/${tmpl}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (resp.ok) {
        const blob = await resp.blob();
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `ExportNOC_${section}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
        return;
      }
    } catch { /* fallback */ }
  }
  generateFormPDF(formData, section);
}

/* ─── jsPDF fallback helpers ──────────────────────────────────────────── */
const C = {
  navy:   [0, 53, 128], blue:  [26, 86, 160], lblue: [227, 242, 253],
  white:  [255,255,255], black: [15, 15, 15],  grey:  [100,100,100],
  lgrey:  [240,244,248], green: [21,128,61],   lorange:[255,251,235],
  orange: [180,83,9],
};

function sf(doc, weight='normal', size=10, color=C.black) {
  doc.setFont('helvetica', weight); doc.setFontSize(size); doc.setTextColor(...color);
}
function fr(doc, x, y, w, h, color) {
  doc.setFillColor(...color); doc.rect(x, y, w, h, 'F');
}
function dl(doc, x1, y1, x2, y2, color=C.lgrey, lw=0.3) {
  doc.setDrawColor(...color); doc.setLineWidth(lw); doc.line(x1,y1,x2,y2);
}
function ph(doc, page, total) {
  fr(doc, 0, 0, 210, 22, C.navy);
  sf(doc, 'bold', 13, C.white); doc.text('Export NOC Application', 14, 10);
  sf(doc, 'normal', 8, [180,200,240]);
  doc.text('Central Drugs Standard Control Organisation (CDSCO)', 14, 16);
  doc.text('Ministry of Health & Family Welfare, Government of India', 14, 20);
  doc.text(`Page ${page} of ${total}`, 196, 20, { align: 'right' });
  return 32;
}
function pf(doc) {
  dl(doc, 14, 285, 196, 285, C.lgrey, 0.3);
  sf(doc, 'normal', 7, C.grey);
  doc.text(`Generated: ${new Date().toLocaleString()} | CDSCO SUGAM Portal | www.cdsco.gov.in`, 105, 289, { align:'center' });
}
function sh(doc, y, title) {
  fr(doc, 14, y, 182, 8, C.lblue);
  doc.setDrawColor(...C.blue); doc.setLineWidth(0.5); doc.line(14, y, 14, y+8);
  sf(doc, 'bold', 10, C.navy); doc.text(title, 18, y+5.5);
  return y + 10;
}
function lv(doc, x, y, label, value, maxW=80) {
  if (!value) return y;
  sf(doc, 'bold', 8, C.grey); doc.text(label.toUpperCase(), x, y);
  sf(doc, 'normal', 9, C.black);
  const lines = doc.splitTextToSize(String(value), maxW);
  doc.text(lines, x, y+4.5);
  return y + 4.5 + lines.length * 4.5;
}

export function generateFormPDF(formData, section='all') {
  const doc = new jsPDF({ unit:'mm', format:'a4', compress:true });
  const t   = (v, f='') => (v && String(v).trim()) ? String(v).trim() : f;
  let y     = ph(doc, 1, 2);
  let page  = 1;

  function np() {
    pf(doc); doc.addPage(); page++; y = ph(doc, page, 2);
  }

  // Ref cards
  fr(doc, 14, y, 88, 16, C.lblue); fr(doc, 108, y, 88, 16, C.lorange);
  sf(doc,'bold',7,C.grey); doc.text('APPLICATION NUMBER',17,y+5);
  sf(doc,'bold',13,C.navy); doc.text(t(formData.applicationNumber, APP_NO),17,y+12);
  sf(doc,'bold',7,C.grey); doc.text('REFERENCE NUMBER',111,y+5);
  sf(doc,'bold',13,C.orange); doc.text(t(formData.referenceNumber,'REF-XXXXXX'),111,y+12);
  y += 22;

  // App details
  if (section==='all'||section==='application') {
    y = sh(doc, y, '📋 Application Details');
    const cols=[['Application Type',formData.applicationType],['Export Purpose',formData.exportPurpose],['Export Category',formData.exportCategory],['Destination Country',formData.destinationCountry]];
    cols.forEach(([l,v],i)=>{ lv(doc, i%2===0?14:110, y, l, v, 85); if(i%2===1) y+=10; });
    y+=4; dl(doc,14,y,196,y); y+=4;
    const ac=[['Applicant Name',formData.applicantName],['Organization',formData.applicantOrganization],['Contact',formData.contactNumber],['Email',formData.email]];
    ac.forEach(([l,v],i)=>{ lv(doc, i%2===0?14:110, y, l, v, 85); if(i%2===1) y+=10; });
    y+=6;
  }

  // Products
  if ((section==='all'||section==='products') && formData.products?.length>0) {
    if(y>220){np();}
    y = sh(doc, y, `💊 Drug / Product Information (${formData.products.length} products)`);
    const tCols=[['#',5],['Product',35],['Generic',28],['Form',20],['Strength',20],['Batch',22],['Expiry',20]];
    let tx=14; fr(doc,14,y,182,6.5,C.navy);
    tCols.forEach(([h,w])=>{ sf(doc,'bold',7,C.white); doc.text(h,tx+1,y+4.5); tx+=w; }); y+=6.5;
    formData.products.forEach((p,idx)=>{
      if(y>265){np();}
      fr(doc,14,y,182,7,idx%2===0?C.white:C.lgrey);
      const row=[String(idx+1),p.productName,p.genericName,p.dosageForm,p.strength,p.batchNumber,p.expiryDate];
      let rx=14;
      tCols.forEach(([,w],ci)=>{ sf(doc,'normal',7.5,C.black); const cell=doc.splitTextToSize(row[ci]||'—',w-2); doc.text(cell[0]||'',rx+1,y+4.8); rx+=w; });
      y+=7;
    }); y+=5;
  }

  // Manufacturer
  if (section==='all'||section==='manufacturer') {
    if(y>230){np();}
    y = sh(doc, y, '🏭 Manufacturer Details');
    const mc=[['Manufacturer Name',formData.manufacturerName],['License Number',formData.mfgLicenseNo],['Contact Person',formData.mfgContactPerson],['Email',formData.mfgEmail]];
    mc.forEach(([l,v],i)=>{ lv(doc, i%2===0?14:110, y, l, v, 85); if(i%2===1) y+=10; });
    if(formData.factoryAddress){ y+=2; lv(doc,14,y,'Factory Address',formData.factoryAddress,180); y+=12; }
    fr(doc,14,y,182,14,C.lorange); doc.setDrawColor(...C.green); doc.setLineWidth(0.3); doc.rect(14,y,182,14);
    sf(doc,'bold',8,C.green); doc.text('AUTHORIZED SIGNATORY',17,y+5);
    sf(doc,'bold',10,C.navy); doc.text(t(formData.signatoryName,'—'),17,y+10.5);
    sf(doc,'normal',8,C.grey); doc.text(t(formData.signatoryDesignation),17,y+14);
    dl(doc,140,y+13,192,y+13,C.grey,0.4);
    sf(doc,'normal',7,C.grey); doc.text('Signature',166,y+15.5,{align:'center'});
    y+=20;
  }

  // Documents
  if (section==='all'||section==='documents') {
    if(y>240){np();}
    y = sh(doc, y, '📁 Uploaded Documents');
    const docs=[{id:'mfg_license',label:'Manufacturing License'},{id:'product_approval',label:'Product Approval Certificate'},{id:'export_auth',label:'Export Authorization Letter'},{id:'qa_cert',label:'Quality Assurance Certificate'},{id:'batch_analysis',label:'Batch Analysis Report'},{id:'product_info',label:'Product Information Sheet'}];
    docs.forEach(d=>{
      if(y>268){np();}
      const up = formData.documents&&formData.documents[d.id];
      fr(doc,14,y,182,8,up?[240,253,244]:[255,242,242]);
      doc.setDrawColor(...(up?C.green:C.orange)); doc.setLineWidth(0.2); doc.rect(14,y,182,8);
      sf(doc,'bold',8,up?C.green:[220,38,38]); doc.text(up?'✓':'✗',18,y+5.5);
      sf(doc,'normal',8.5,C.black); doc.text(d.label,24,y+5.5);
      if(up){ sf(doc,'normal',7.5,C.grey); doc.text(up.name||'Uploaded',180,y+5.5,{align:'right'}); }
      y+=9;
    });
  }

  pf(doc);
  const sl = section==='all'?'Full_Application':section;
  doc.save(`ExportNOC_${sl}.pdf`);
}
