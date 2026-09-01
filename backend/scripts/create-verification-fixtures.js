'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { PDFDocument, StandardFonts } = require('pdf-lib');

async function writePdf(fileName, lines) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  lines.forEach((line, index) => page.drawText(line, { x: 54, y: 780 - index * 28, size: 12, font }));
  const target = path.join(os.tmpdir(), fileName);
  fs.writeFileSync(target, await pdf.save());
  return target;
}

Promise.all([
  writePdf('cdsco-known-correct-history.pdf', [
    'EXPORT NOC HISTORICAL DATA - SANITIZED TEST FIXTURE',
    'Applicant: Demo Pharma Test Laboratories',
    'Applied product: Paracetamol Tablets 500 mg',
    'Previous Export NOC file number: EXP-NOC-2025-TEST-001',
    'Export date: 15 March 2025',
    'Destination country: Kenya',
    'Past export quantity: 100,000 tablets',
    'Previous Export NOC file number: EXP-NOC-2024-TEST-002',
    'Export date: 20 April 2024',
    'Destination country: Ghana',
    'Past export quantity: 75,000 tablets',
  ]),
  writePdf('cdsco-known-wrong-invoice.pdf', [
    'COMMERCIAL INVOICE - SANITIZED TEST FIXTURE',
    'Invoice number: INV-TEST-100',
    'Seller: Example Office Supplies',
    'Item: Printer paper',
    'Quantity: 20 boxes',
    'Total: INR 10,000',
    'This is not an Export NOC history document.',
  ]),
]).then(paths => paths.forEach(file => console.log(file)));
