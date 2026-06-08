/**
 * templateFiller.js
 * Fills CDSCO Export NOC backend PDF templates with submitted form data.
 * Strategy: render form data as an overlay page on top of each template page
 * using pdf-lib. This preserves the original template layout exactly.
 */

const { PDFDocument, rgb, StandardFonts, degrees } = require('pdf-lib');
const fs   = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.join(__dirname, 'templates');

/* ── colour helpers ────────────────────────────────────────────────────── */
const BLACK  = rgb(0, 0, 0);
const NAVY   = rgb(0, 0.21, 0.50);
const GREY   = rgb(0.35, 0.35, 0.35);
const GREEN  = rgb(0.08, 0.50, 0.24);

/* ── safe text (never undefined) ──────────────────────────────────────── */
const t = (v, fallback = '') => (v && String(v).trim()) ? String(v).trim() : fallback;

/* ── draw text with auto-wrap ──────────────────────────────────────────── */
function drawText(page, text, x, y, { font, size = 9, color = BLACK, maxWidth, lineHeight = 12 } = {}) {
  if (!text) return y;
  const words = text.split(' ');
  let line = '';
  let curY = y;
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    const w = maxWidth ? font.widthOfTextAtSize(test, size) : 0;
    if (maxWidth && w > maxWidth && line) {
      page.drawText(line, { x, y: curY, size, font, color });
      curY -= lineHeight;
      line = word;
    } else {
      line = test;
    }
  }
  if (line) page.drawText(line, { x, y: curY, size, font, color });
  return curY - lineHeight;
}

/* ── underline helper ──────────────────────────────────────────────────── */
function drawUnderlineText(page, text, x, y, { font, size = 9, color = BLACK, width = 160 } = {}) {
  page.drawText(text || '', { x, y, size, font, color });
  page.drawLine({ start: { x, y: y - 2 }, end: { x: x + width, y: y - 2 }, thickness: 0.5, color: GREY });
}

/* ── Box / field label + value ──────────────────────────────────────────── */
function fieldRow(page, label, value, x, y, { font, boldFont, size = 8.5, labelWidth = 90, valueWidth = 150 } = {}) {
  page.drawText(label + ':', { x, y, size: size - 0.5, font, color: GREY });
  page.drawText(t(value, '—'), { x: x + labelWidth, y, size, font: boldFont || font, color: BLACK });
  return y - 13;
}

/* ══════════════════════════════════════════════════════════════════════════
   TEMPLATE: Same_To_Same_Empty_NOC_Template.pdf
   A legal undertaking letter for unapproved drugs
   ══════════════════════════════════════════════════════════════════════════ */
async function fillNOCTemplate(formData) {
  const templateBytes = fs.readFileSync(path.join(TEMPLATES_DIR, 'Same_To_Same_Empty_NOC_Template.pdf'));
  const pdfDoc  = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
  const font    = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bFont   = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const page    = pdfDoc.getPages()[0];
  const { width, height } = page.getSize();

  const product = formData.products?.[0];
  const productStr = product
    ? `${t(product.productName)} (${t(product.genericName)}) ${t(product.dosageForm)} ${t(product.strength)}`
    : '';

  // Company name (top blank)
  page.drawText(t(formData.applicantOrganization), {
    x: 50, y: height - 108, size: 10, font: bFont, color: NAVY,
  });

  // Address block
  page.drawText(t(formData.factoryAddress || formData.addressLine1), {
    x: 50, y: height - 152, size: 9, font, color: BLACK,
    maxWidth: 380,
  });

  // License details
  page.drawText(t(formData.mfgLicenseNo), { x: 176, y: height - 184, size: 9, font: bFont, color: BLACK });
  page.drawText('25', { x: 270, y: height - 184, size: 9, font, color: BLACK });
  page.drawText('28', { x: 358, y: height - 184, size: 9, font, color: BLACK });
  // Expiry date placeholder
  page.drawText('31/12/2026', { x: 406, y: height - 184, size: 9, font, color: GREY });

  // Product name
  page.drawText(t(productStr, 'As per application'), {
    x: 50, y: height - 216, size: 9, font: bFont, color: BLACK,
  });

  // Signature block
  page.drawText(`For, ${t(formData.applicantOrganization)}`, {
    x: 50, y: height - 295, size: 9, font: bFont, color: NAVY,
  });
  page.drawText(t(formData.signatoryName), { x: 50, y: height - 310, size: 9, font, color: BLACK });
  page.drawText(t(formData.signatoryDesignation), { x: 50, y: height - 322, size: 8.5, font, color: GREY });

  // Date
  page.drawText(new Date().toLocaleDateString('en-IN'), {
    x: width - 120, y: height - 295, size: 9, font, color: BLACK,
  });

  return pdfDoc.save();
}

/* ══════════════════════════════════════════════════════════════════════════
   TEMPLATE: copy of manudufacturing.pdf  (Form 28 — Manufacturing Licence)
   ══════════════════════════════════════════════════════════════════════════ */
async function fillManufacturingTemplate(formData) {
  const templateBytes = fs.readFileSync(path.join(TEMPLATES_DIR, 'copy of manudufacturing.pdf'));
  const pdfDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
  const font   = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bFont  = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const page   = pdfDoc.getPages()[0];
  const { height } = page.getSize();

  // Licence number + date
  page.drawText(t(formData.mfgLicenseNo, 'MFG/XX/2026/XXXXX'), {
    x: 170, y: height - 115, size: 9, font: bFont, color: NAVY,
  });
  page.drawText(new Date().toLocaleDateString('en-IN'), {
    x: 170, y: height - 130, size: 9, font, color: BLACK,
  });

  // Company name & address
  page.drawText(t(formData.manufacturerName || formData.applicantOrganization), {
    x: 90, y: height - 164, size: 9, font: bFont, color: NAVY,
  });
  page.drawText(t(formData.factoryAddress), {
    x: 90, y: height - 180, size: 9, font, color: BLACK, maxWidth: 350,
  });

  // Drug names from products
  const drugNames = (formData.products || [])
    .map(p => `${t(p.productName)} ${t(p.dosageForm)} ${t(p.strength)}`)
    .join(', ');
  page.drawText(t(drugNames, 'As per application'), {
    x: 90, y: height - 225, size: 9, font, color: BLACK, maxWidth: 350,
  });

  // Technical staff
  page.drawText(t(formData.signatoryName) + ' — ' + t(formData.signatoryDesignation), {
    x: 50, y: height - 256, size: 9, font, color: BLACK,
  });

  // Validity
  page.drawText(new Date().toLocaleDateString('en-IN'), { x: 100, y: height - 297, size: 9, font, color: BLACK });
  page.drawText('31/12/2028', { x: 230, y: height - 297, size: 9, font, color: BLACK });

  // Signature
  page.drawText(t(formData.signatoryName), { x: 50, y: height - 340, size: 9, font: bFont, color: NAVY });
  page.drawText(t(formData.signatoryDesignation), { x: 50, y: height - 352, size: 8.5, font, color: GREY });

  return pdfDoc.save();
}

/* ══════════════════════════════════════════════════════════════════════════
   TEMPLATE: legal_undertaking.pdf  (Annexure-II)
   ══════════════════════════════════════════════════════════════════════════ */
async function fillLegalUndertakingTemplate(formData) {
  const templateBytes = fs.readFileSync(path.join(TEMPLATES_DIR, 'legal undertaking.pdf'));
  const pdfDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
  const font   = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bFont  = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const page   = pdfDoc.getPages()[0];
  const { height } = page.getSize();

  // I, Mr./Ms. ___
  page.drawText(t(formData.signatoryName), { x: 106, y: height - 130, size: 9, font: bFont, color: NAVY });
  // S/o D/o
  page.drawText('—', { x: 320, y: height - 130, size: 9, font, color: BLACK });
  // Director / Auth Signatory of
  page.drawText(t(formData.applicantOrganization), { x: 164, y: height - 148, size: 9, font: bFont, color: NAVY });
  // Aged about
  page.drawText('—', { x: 390, y: height - 148, size: 9, font, color: BLACK });

  // Undertaking statements — fill in applicant / product info
  const product = formData.products?.[0];
  const stmts = [
    `That ${t(formData.applicantOrganization)} is engaged in manufacture and export of pharmaceutical products.`,
    `That the drug product "${product ? t(product.productName) : 'as per application'}" is intended solely for export to ${t(formData.destinationCountry)}.`,
    `That the product complies with the quality standards of the importing country and applicable Indian regulations.`,
    `That the Manufacturing License No. ${t(formData.mfgLicenseNo)} is valid and subsisting.`,
    `That all information furnished is true and correct to the best of our knowledge and belief.`,
    `That we undertake to comply with all conditions imposed by CDSCO regarding this export NOC.`,
    `That we accept full responsibility for the quality and safety of the exported products.`,
  ];

  let y = height - 188;
  stmts.forEach((stmt, i) => {
    page.drawText(`${i + 1}.`, { x: 50, y, size: 8.5, font: bFont, color: BLACK });
    const lines = stmt.length > 85 ? [stmt.slice(0, 85), stmt.slice(85)] : [stmt];
    lines.forEach(line => {
      page.drawText(line, { x: 65, y, size: 8.5, font, color: BLACK });
      y -= 13;
    });
  });

  // Signature block on page 1
  const sigY = y - 20;
  page.drawText('Deponent / Authorized Signatory', { x: 50, y: sigY, size: 8.5, font: bFont, color: GREY });
  page.drawText(t(formData.signatoryName), { x: 50, y: sigY - 14, size: 9, font: bFont, color: NAVY });
  page.drawText(t(formData.signatoryDesignation), { x: 50, y: sigY - 26, size: 8.5, font, color: GREY });
  page.drawText(t(formData.applicantOrganization), { x: 50, y: sigY - 38, size: 8.5, font, color: BLACK });
  page.drawText('Date: ' + new Date().toLocaleDateString('en-IN'), { x: 50, y: sigY - 52, size: 8.5, font, color: GREY });

  return pdfDoc.save();
}

/* ══════════════════════════════════════════════════════════════════════════
   TEMPLATE: Empty_PO_Template_Same_Format.pdf  (Purchase Order / Full NOC)
   This is the most structured template — used as the main Export NOC form
   ══════════════════════════════════════════════════════════════════════════ */
async function fillPOTemplate(formData) {
  const templateBytes = fs.readFileSync(path.join(TEMPLATES_DIR, 'Empty_PO_Template_Same_Format.pdf'));
  const pdfDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
  const font   = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bFont  = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pages  = pdfDoc.getPages();
  const page   = pages[0];
  const { width, height } = page.getSize();

  // ── Page 1: Company / Supplier info ──
  page.drawText(t(formData.applicantOrganization), { x: 70, y: height - 60, size: 10, font: bFont, color: NAVY });
  page.drawText(t(formData.destinationCountry), { x: 70, y: height - 78, size: 9, font, color: BLACK });

  // PO Details header
  page.drawText('PO / NOC Ref: EXP-2026-000145', { x: 70, y: height - 96, size: 8.5, font, color: GREY });

  // Supplier (applicant)
  page.drawText(t(formData.applicantOrganization), { x: 55, y: height - 136, size: 9, font: bFont, color: NAVY });
  page.drawText(t(formData.factoryAddress), { x: 55, y: height - 148, size: 8.5, font, color: BLACK, maxWidth: 180 });
  page.drawText('Lic: ' + t(formData.mfgLicenseNo), { x: 55, y: height - 172, size: 8, font, color: GREY });

  // Consignee (importer)
  const consAddr = [formData.addressLine1, formData.city, formData.consigneeCountry].filter(Boolean).join(', ');
  page.drawText(t(formData.consigneeName), { x: 240, y: height - 136, size: 9, font: bFont, color: NAVY });
  page.drawText(t(formData.consigneeOrg), { x: 240, y: height - 148, size: 8.5, font, color: BLACK });
  page.drawText(t(consAddr), { x: 240, y: height - 160, size: 8, font, color: GREY, maxWidth: 180 });

  // Payment / delivery terms
  page.drawText('As per Export NOC Terms', { x: 155, y: height - 252, size: 8.5, font, color: BLACK });
  page.drawText(t(formData.destinationCountry), { x: 155, y: height - 265, size: 8.5, font, color: BLACK });
  page.drawText(t(formData.applicantOrganization), { x: 155, y: height - 278, size: 8.5, font, color: BLACK });
  page.drawText(t(formData.signatoryName), { x: 155, y: height - 291, size: 8.5, font, color: BLACK });

  // Product table rows
  let tableY = height - 210;
  (formData.products || []).forEach((p, i) => {
    if (tableY < 60) return;
    page.drawText(String(i + 1),             { x: 30,  y: tableY, size: 8.5, font, color: BLACK });
    page.drawText(t(p.productName),           { x: 55,  y: tableY, size: 8.5, font: bFont, color: NAVY, maxWidth: 120 });
    page.drawText(t(p.dosageForm),            { x: 180, y: tableY, size: 8.5, font, color: BLACK });
    page.drawText(t(p.packSize || p.strength),{ x: 225, y: tableY, size: 8.5, font, color: BLACK });
    page.drawText('As agreed',                { x: 270, y: tableY, size: 8.5, font, color: GREY });
    page.drawText('—',                        { x: 340, y: tableY, size: 8.5, font, color: GREY });
    tableY -= 14;
  });

  // Page 2 if present — Invoice section
  if (pages[1]) {
    const p2 = pages[1];
    const h2 = p2.getSize().height;
    p2.drawText(t(formData.consigneeName),        { x: 55, y: h2 - 78,  size: 9,   font: bFont, color: NAVY });
    p2.drawText('EXP-2026-000145',                { x: 270, y: h2 - 78, size: 9,   font, color: BLACK });
    p2.drawText(new Date().toLocaleDateString('en-IN'), { x: 390, y: h2 - 78, size: 9, font, color: BLACK });
    p2.drawText(t(formData.applicantOrganization), { x: 55, y: h2 - 95, size: 9,   font, color: BLACK });
    p2.drawText('Air / Sea',                       { x: 200, y: h2 - 95, size: 9,  font, color: BLACK });
    p2.drawText(t(formData.destinationCountry),    { x: 350, y: h2 - 95, size: 9,  font, color: BLACK });

    let ty2 = h2 - 130;
    (formData.products || []).forEach((p, i) => {
      if (ty2 < 60) return;
      p2.drawText(String(i + 1),                        { x: 30,  y: ty2, size: 8.5, font, color: BLACK });
      p2.drawText(t(p.packSize || '1 Pack'),            { x: 55,  y: ty2, size: 8.5, font, color: BLACK });
      p2.drawText(`${t(p.productName)} ${t(p.dosageForm)} ${t(p.strength)}`, { x: 100, y: ty2, size: 8.5, font: bFont, color: NAVY, maxWidth: 160 });
      p2.drawText(t(p.packSize || '—'),                 { x: 270, y: ty2, size: 8.5, font, color: BLACK });
      p2.drawText('As Agreed',                          { x: 320, y: ty2, size: 8.5, font, color: GREY });
      p2.drawText('Per unit',                           { x: 380, y: ty2, size: 8.5, font, color: GREY });
      ty2 -= 14;
    });

    p2.drawText(t(formData.signatoryName),        { x: 55, y: 55, size: 9, font: bFont, color: NAVY });
    p2.drawText(t(formData.signatoryDesignation), { x: 55, y: 43, size: 8.5, font, color: GREY });
  }

  return pdfDoc.save();
}

/* ══════════════════════════════════════════════════════════════════════════
   MAIN EXPORT — generate all filled templates and zip them
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Returns an array of { name, buffer } objects — one per template.
 * Caller decides how to deliver them (zip, multipart, individual).
 */
async function fillAllTemplates(formData) {
  const results = [];

  // 1. NOC Undertaking
  try {
    const buf = await fillNOCTemplate(formData);
    results.push({ name: 'NOC_Undertaking.pdf', buffer: Buffer.from(buf) });
  } catch (e) { console.error('NOC template error:', e.message); }

  // 2. Manufacturing Licence (Form 28)
  try {
    const buf = await fillManufacturingTemplate(formData);
    results.push({ name: 'Manufacturing_Licence_Form28.pdf', buffer: Buffer.from(buf) });
  } catch (e) { console.error('Mfg template error:', e.message); }

  // 3. Legal Undertaking (Annexure II)
  try {
    const buf = await fillLegalUndertakingTemplate(formData);
    results.push({ name: 'Legal_Undertaking_AnnexureII.pdf', buffer: Buffer.from(buf) });
  } catch (e) { console.error('Legal template error:', e.message); }

  // 4. PO / Main NOC form
  try {
    const buf = await fillPOTemplate(formData);
    results.push({ name: 'Export_NOC_Application_Form.pdf', buffer: Buffer.from(buf) });
  } catch (e) { console.error('PO template error:', e.message); }

  return results;
}

module.exports = { fillAllTemplates, fillNOCTemplate, fillManufacturingTemplate, fillLegalUndertakingTemplate, fillPOTemplate };
