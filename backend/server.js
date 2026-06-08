require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const multer   = require('multer');
const fetch    = require('node-fetch');
const pdfParse = require('pdf-parse');
const JSZip    = require('jszip');
const mongoose = require('mongoose');
const { fillAllTemplates } = require('./templateFiller');

/* ── MongoDB connection ──────────────────────────────────────────────────── */
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/drug_ministry';
mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
  .then(() => console.log(`✅ MongoDB connected: ${MONGODB_URI}`))
  .catch(err => {
    console.warn(`⚠️  MongoDB not available (${err.message}). Running without DB — application endpoints will return errors.`);
    console.warn('   Start MongoDB or set MONGODB_URI in backend/.env to enable persistence.');
  });

const app    = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.use(cors({ origin: 'http://localhost:3000' }));
app.use(express.json({ limit: '50mb' }));

/* ── Application CRUD routes ────────────────────────────────────────────── */
const applicationRoutes = require('./routes/applications');
app.use('/api/applications', applicationRoutes);

/* ─── Health check ─────────────────────────────────────────────────────── */
app.get('/health', (_, res) => res.json({ status: 'ok', model: 'mistral-large-latest' }));

/* ─── Document checklist items per document type ───────────────────────── */
const CHECKLISTS = {
  manufacturing_license: [
    'License number is present',
    'Manufacturer name is mentioned',
    'Valid date / expiry date is present',
    'Issuing authority (State Drug Authority) is mentioned',
    'Drug categories / schedule are listed',
    'Manufacturing site / factory address is present',
    'Authorized signatory name is present',
    'Government seal or stamp is visible',
  ],
  product_approval: [
    'Drug / product name is mentioned',
    'Generic / INN name is present',
    'Dosage form and strength are mentioned',
    'Approval / registration number is present',
    'Approved indications are listed',
    'Manufacturer name is mentioned',
    'Regulatory authority name is present',
    'Date of approval is present',
  ],
  export_authorization: [
    'Exporter / company name is mentioned',
    'Drug name and quantity are specified',
    'Destination country is mentioned',
    'Authorization reference number is present',
    'Issuing authority signature is present',
    'Date of issue is present',
    'Export purpose is stated',
  ],
  quality_assurance: [
    'Certificate of Analysis (CoA) or GMP certificate type is identified',
    'Product / drug name is mentioned',
    'Batch number is present',
    'Manufacturing date or expiry date is present',
    'Test parameters and results are listed',
    'Manufacturer / laboratory name is mentioned',
    'Authorized signatory is present',
    'Certificate issue date is present',
  ],
  default: [
    'Document type is identifiable',
    'Organization / company name is present',
    'Date is mentioned',
    'Reference number or ID is present',
    'Authorized signature is present',
    'Purpose / subject of document is stated',
  ],
};

/* ─── Extract text from PDF buffer ─────────────────────────────────────── */
async function extractTextFromPdf(buffer) {
  try {
    const data = await pdfParse(buffer);
    return data.text || '';
  } catch (e) {
    console.error('PDF parse error:', e.message);
    return '';
  }
}

/* ─── Call Mistral API ──────────────────────────────────────────────────── */
async function callMistral(messages) {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey || apiKey === 'your_mistral_api_key_here') {
    throw new Error('MISTRAL_API_KEY is not configured. Please set it in backend/.env');
  }

  const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'mistral-large-latest',
      messages,
      temperature: 0.1,
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Mistral API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

/* ─── Parse Mistral's checklist response ───────────────────────────────── */
function parseChecklistResponse(text, items) {
  const results = [];
  const lines   = text.split('\n');

  for (let i = 0; i < items.length; i++) {
    const item  = items[i];
    const lower = item.toLowerCase();

    // Find a line that references this item
    let found = null;
    for (const line of lines) {
      const ll = line.toLowerCase();
      // Match by item keywords or by index pattern like "1." "2." etc.
      const idx = new RegExp(`^\\s*${i + 1}[.)\\s]`);
      if (idx.test(line) || ll.includes(lower.slice(0, 25))) {
        found = line; break;
      }
    }

    let present = null;
    let note    = '';

    if (found) {
      const fl = found.toLowerCase();
      if (fl.includes('yes') || fl.includes('✓') || fl.includes('present') || fl.includes('found') || fl.includes('✅')) {
        present = true;
      } else if (fl.includes('no') || fl.includes('✗') || fl.includes('not present') || fl.includes('missing') || fl.includes('absent') || fl.includes('❌')) {
        present = false;
      }
      // Extract any note in parentheses or after a colon
      const noteMatch = found.match(/[:(–-]\s*(.+)$/);
      if (noteMatch) note = noteMatch[1].trim().replace(/^(yes|no)[,.]?\s*/i, '');
    }

    results.push({ item, present, note });
  }
  return results;
}

/* ─── Document template requirements (strict structural validation) ─────── */
const TEMPLATE_REQUIREMENTS = {
  mfg_license: {
    label: 'Manufacturing License',
    description: 'A valid drug Manufacturing License issued by the State Drug Authority of India (Form 25 or Form 28 under Drugs & Cosmetics Act)',
    mustContainAll: ['license', 'manufacture', 'drug'],
    mustContainAny: ['form 25', 'form 28', 'manufacturing license', 'licence to manufacture', 'state drug', 'drugs and cosmetics', 'schedule m', 'drug controller'],
    mustNotContain: ['purchase order', 'invoice', 'undertaking', 'quality assurance', 'gmp certificate', 'batch analysis', 'certificate of analysis'],
    minLength: 100,
    aiPrompt: `You are validating a document for an Indian drug export NOC application.
Expected document type: "Manufacturing License" — a license issued by the State Drug Authority of India allowing a company to manufacture drugs (typically Form 25 or Form 28 under the Drugs & Cosmetics Act, 1940).

Key characteristics of a genuine Manufacturing License:
- Issued by State Drug Controller or State Licensing Authority
- Contains a license number (e.g., MFG/KA/2024/001)
- Lists authorized drug categories or specific drugs
- Contains manufacturer name and factory address
- Has an issue date and validity period
- References Drugs & Cosmetics Act / Rules
- Contains authorized signatory

Answer: Is this document a Manufacturing License (or closely related regulatory license for drug manufacturing)?
Reply ONLY: YES or NO`,
  },
  product_approval: {
    label: 'Product Approval Certificate',
    description: 'A CDSCO or regulatory authority certificate approving a specific drug product for sale or export',
    mustContainAll: ['approval', 'drug'],
    mustContainAny: ['product approval', 'certificate of approval', 'registration certificate', 'new drug approval', 'cdsco', 'central drugs', 'approved drug', 'marketing authorization'],
    mustNotContain: ['purchase order', 'invoice', 'undertaking', 'manufacturing license', 'batch analysis', 'certificate of analysis'],
    minLength: 80,
    aiPrompt: `You are validating a document for an Indian drug export NOC application.
Expected document type: "Product Approval Certificate" — issued by CDSCO or a regulatory authority certifying that a specific drug product is approved for manufacture/sale.

Key characteristics:
- Issued by CDSCO or State Drug Authority
- Names a specific drug product
- Contains an approval/registration number
- Lists dosage form and strength
- May reference Schedule H/X or drug schedules
- Has validity dates

Answer: Is this document a Product Approval Certificate or drug registration certificate?
Reply ONLY: YES or NO`,
  },
  export_auth: {
    label: 'Export Authorization Letter',
    description: 'A letter from company head or authorized signatory authorizing export of specific drug products',
    mustContainAll: ['export'],
    mustContainAny: ['export authorization', 'authorization letter', 'authorise', 'authorize', 'export noc', 'no objection', 'hereby authorize', 'authorized to export', 'export of drug'],
    mustNotContain: ['purchase order', 'invoice', 'manufacturing license', 'batch analysis', 'certificate of analysis', 'gmp'],
    minLength: 60,
    aiPrompt: `You are validating a document for an Indian drug export NOC application.
Expected document type: "Export Authorization Letter" — a letter from company management authorizing export of drugs to a specific country.

Key characteristics:
- Written on company letterhead
- Signed by authorized signatory (Director/CEO/MD)
- Mentions specific drug product(s) to be exported
- Names destination country
- States authorization for export
- May reference CDSCO or Drug Controller

Answer: Is this document an Export Authorization Letter for drug export?
Reply ONLY: YES or NO`,
  },
  qa_cert: {
    label: 'Quality Assurance Certificate',
    description: 'A GMP certificate, ISO certificate, or Quality Assurance certificate for the manufacturing facility',
    mustContainAll: ['quality'],
    mustContainAny: ['quality assurance', 'gmp', 'good manufacturing', 'iso', 'certificate of compliance', 'who gmp', 'quality certificate', 'quality management', 'cgmp'],
    mustNotContain: ['purchase order', 'invoice', 'manufacturing license form', 'export authorization', 'batch analysis', 'undertaking'],
    minLength: 60,
    aiPrompt: `You are validating a document for an Indian drug export NOC application.
Expected document type: "Quality Assurance Certificate" — a GMP, WHO-GMP, ISO, or similar quality certification for a pharmaceutical manufacturing facility.

Key characteristics:
- Issued by an accredited certification body or regulatory authority
- Certifies GMP / WHO-GMP / ISO 9001 / ISO 13485 compliance
- Names the manufacturing facility
- Has an issue date and validity/expiry
- Contains certification scope

Answer: Is this document a Quality Assurance or GMP Certificate?
Reply ONLY: YES or NO`,
  },
  batch_analysis: {
    label: 'Batch Analysis Report',
    description: 'An analytical test report (Certificate of Analysis / CoA) for a specific drug batch',
    mustContainAll: ['batch'],
    mustContainAny: ['batch analysis', 'certificate of analysis', 'analytical report', 'test report', 'coa', 'batch no', 'batch number', 'analysis report', 'quality control'],
    mustNotContain: ['purchase order', 'invoice', 'manufacturing license', 'gmp certificate', 'export authorization', 'undertaking'],
    minLength: 80,
    aiPrompt: `You are validating a document for an Indian drug export NOC application.
Expected document type: "Batch Analysis Report" — a Certificate of Analysis (CoA) or analytical test report for a specific drug batch.

Key characteristics:
- Contains a specific batch number
- Lists test parameters and results (e.g., assay, dissolution, moisture)
- Has pass/fail or complies/does not comply status
- Names the drug product, dosage form, strength
- Has manufacturing date and expiry date
- Signed by Quality Control head or authorized analyst

Answer: Is this document a Batch Analysis Report or Certificate of Analysis (CoA)?
Reply ONLY: YES or NO`,
  },
  product_info: {
    label: 'Product Information Sheet',
    description: 'A product information document, package insert, or prescribing information for a drug',
    mustContainAll: [],
    mustContainAny: ['product information', 'package insert', 'prescribing information', 'summary of product', 'product monograph', 'smpc', 'indications', 'contraindications', 'dosage and administration'],
    mustNotContain: ['purchase order', 'invoice'],
    minLength: 50,
    aiPrompt: `You are validating a document for an Indian drug export NOC application.
Expected document type: "Product Information Sheet" — a package insert, prescribing information, or summary of product characteristics for a drug.

Key characteristics:
- Describes drug indications and uses
- Lists dosage and administration instructions
- Contains contraindications and side effects
- Describes storage conditions
- May contain pharmacological information

Answer: Is this document a Product Information Sheet or Package Insert?
Reply ONLY: YES or NO`,
  },
};

/* ─── POST /api/validate-template — strict template matching endpoint ───── */
app.post('/api/validate-template', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const docType = req.body.docType || 'default';
    const tmpl    = TEMPLATE_REQUIREMENTS[docType];

    // Unknown type → allow
    if (!tmpl) return res.json({ matched: true, confidence: 'high', reason: 'No template defined for this type' });

    // ── Layer 1: Extract text ──────────────────────────────────────────────
    let docText = '';
    const isImage = req.file.mimetype.startsWith('image/');

    if (req.file.mimetype === 'application/pdf') {
      docText = await extractTextFromPdf(req.file.buffer);
    }

    const textLength = docText.trim().length;
    const lower      = docText.toLowerCase();
    const noText     = textLength < tmpl.minLength;

    // ── Layer 2: Hard "must NOT contain" check (wrong doc type) ───────────
    let wrongDocHits = 0;
    const wrongTermsFound = [];
    if (!noText && tmpl.mustNotContain) {
      for (const term of tmpl.mustNotContain) {
        if (lower.includes(term)) { wrongDocHits++; wrongTermsFound.push(term); }
      }
      // If 2+ wrong-doc terms found, reject immediately without AI call
      if (wrongDocHits >= 2) {
        return res.json({
          matched:    false,
          confidence: 'high',
          layer:      'keyword_exclusion',
          reason:     `Document appears to be a different document type (found: ${wrongTermsFound.slice(0,2).join(', ')}). Expected: ${tmpl.label}`,
          wrongTermsFound,
        });
      }
    }

    // ── Layer 3: Must-contain-any check ───────────────────────────────────
    let anyHits = 0;
    if (!noText && tmpl.mustContainAny && tmpl.mustContainAny.length > 0) {
      for (const term of tmpl.mustContainAny) {
        if (lower.includes(term)) anyHits++;
      }
      // Need at least 1 positive keyword hit
      if (anyHits === 0) {
        // Don't hard-fail yet — let AI decide for borderline cases
        // but note the low keyword score
      }
    }

    // ── Layer 4: Scanned image or very short text → AI is the only judge ──
    // ── Layer 5: AI validation (Mistral) ──────────────────────────────────
    const apiKey = process.env.MISTRAL_API_KEY;
    let aiResult = null;
    let aiReason = '';

    if (apiKey && apiKey !== 'your_mistral_api_key_here' && tmpl.aiPrompt) {
      try {
        const textForAI = noText
          ? `[SCANNED IMAGE OR NO TEXT EXTRACTED — file type: ${req.file.mimetype}, size: ${req.file.size} bytes]`
          : docText.slice(0, 3000);

        const aiPrompt = `${tmpl.aiPrompt}

Document text (first 3000 chars):
"""
${textForAI}
"""`;

        const raw = await callMistral([
          { role: 'system', content: 'You are a strict pharmaceutical document validator. Answer only YES or NO.' },
          { role: 'user',   content: aiPrompt },
        ]);

        const normalized = raw.trim().toUpperCase();
        if (normalized.startsWith('YES')) {
          aiResult = true;
          aiReason = 'AI confirmed document type matches expected template';
        } else if (normalized.startsWith('NO')) {
          aiResult = false;
          aiReason = 'AI determined document does not match expected template type';
        }
      } catch (e) {
        console.error('AI validation error:', e.message);
        // AI failed → fall back to keyword logic
      }
    }

    // ── Final decision ─────────────────────────────────────────────────────
    let matched;
    let confidence;
    let reason;

    if (aiResult !== null) {
      // AI result is authoritative
      matched    = aiResult;
      confidence = 'high';
      reason     = aiResult
        ? `✓ ${tmpl.label} — document verified by AI validation`
        : `✗ Document does not appear to be a ${tmpl.label}. ${aiReason}`;
    } else if (noText && isImage) {
      // Image file with no extractable text — allow with warning
      matched    = true;
      confidence = 'low';
      reason     = `Image file — structural validation skipped. Please ensure this is a ${tmpl.label}.`;
    } else if (noText) {
      // Scanned PDF with no text — allow but warn
      matched    = true;
      confidence = 'low';
      reason     = `Scanned document — text not extractable. Please ensure this is a ${tmpl.label}.`;
    } else {
      // Keyword fallback (no AI)
      const keywordPassed = anyHits >= 1 && wrongDocHits < 2;
      matched    = keywordPassed;
      confidence = 'medium';
      reason     = keywordPassed
        ? `Document keywords match expected ${tmpl.label} format`
        : `Document keywords do not match ${tmpl.label} requirements`;
    }

    res.json({
      matched,
      confidence,
      reason,
      docType,
      docLabel:        tmpl.label,
      aiValidated:     aiResult !== null,
      keywordAnyHits:  anyHits,
      wrongTermsFound,
      textLength,
      noText,
    });

  } catch (err) {
    console.error('Template validate error:', err.message);
    // On server error → allow upload (fail open) so users aren't blocked
    res.json({ matched: true, confidence: 'unknown', reason: 'Validation service error — upload allowed', error: err.message });
  }
});

/* ─── POST /api/extract-doc-data — extract key fields from uploaded doc ──── */
app.post('/api/extract-doc-data', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    const docType  = req.body.docType  || 'default';
    const docLabel = req.body.docLabel || 'document';

    let docText = '';
    if (req.file.mimetype === 'application/pdf') {
      docText = await extractTextFromPdf(req.file.buffer);
    }

    const hasText = docText.trim().length > 80;
    if (!hasText) {
      return res.json({ success: true, hasText: false, fields: {}, summary: 'Scanned document — text not extractable' });
    }

    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey || apiKey === 'your_mistral_api_key_here') {
      return res.json({ success: true, hasText, fields: {}, summary: 'API key not configured — extraction skipped' });
    }

    const extractPrompt = `You are a document data extractor for Indian pharmaceutical regulatory documents.

Document type: "${docLabel}"
Extracted text:
"""
${docText.slice(0, 4000)}
"""

Extract the following key information as a JSON object. Use null for any field not found.
Return ONLY valid JSON, no explanation:
{
  "documentNumber": "license/certificate/reference number",
  "issueDate": "date of issue or signing",
  "expiryDate": "expiry or valid until date",
  "issuingAuthority": "name of authority that issued this document",
  "holderName": "name of company or person the document is issued to",
  "address": "address mentioned",
  "productName": "drug or product name if mentioned",
  "batchNumber": "batch or lot number if mentioned",
  "signatoryName": "name of authorized signatory",
  "signatoryDesignation": "designation of signatory"
}`;

    let fields = {};
    try {
      const raw = await callMistral([
        { role: 'system', content: 'Extract document data and return only valid JSON.' },
        { role: 'user', content: extractPrompt },
      ]);
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) fields = JSON.parse(jsonMatch[0]);
    } catch (e) { console.error('Extract parse error:', e.message); }

    // Build a human-readable summary of non-null fields
    const presentFields = Object.entries(fields).filter(([, v]) => v && v !== 'null');
    const summary = presentFields.length > 0
      ? presentFields.map(([k, v]) => `${k.replace(/([A-Z])/g, ' $1').trim()}: ${v}`).join(' · ')
      : 'No data extracted';

    res.json({ success: true, hasText, fields, summary });
  } catch (err) {
    console.error('Extract error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ─── POST /api/verify — main verification endpoint ────────────────────── */
app.post('/api/verify', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const docType  = req.body.docType || 'default';
    const docLabel = req.body.docLabel || 'document';
    const items    = CHECKLISTS[docType] || CHECKLISTS.default;

    // Extract text from PDF
    let docText = '';
    if (req.file.mimetype === 'application/pdf') {
      docText = await extractTextFromPdf(req.file.buffer);
    }

    const hasText = docText.trim().length > 100;

    // Build prompt
    const systemPrompt = `You are a document verification assistant for the Indian pharmaceutical regulatory system (CDSCO / Drug Ministry). 
You analyze uploaded documents and check whether specific required items are present.
Be precise and concise. For each item, answer YES or NO clearly.`;

    const userPrompt = `Document type: "${docLabel}"

${hasText
  ? `Extracted document text:\n\`\`\`\n${docText.slice(0, 6000)}\n\`\`\``
  : `Note: This appears to be a scanned image-based PDF. Make reasonable inferences based on document type.`
}

Please verify each of the following items in the document. 
For each item, respond with the item number, YES/NO, and a brief note if relevant.
Format: "1. YES - [brief note]" or "1. NO - [brief note]"

Items to check:
${items.map((item, i) => `${i + 1}. ${item}`).join('\n')}`;

    const content = await callMistral([
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt   },
    ]);

    const results = parseChecklistResponse(content, items);

    // Count totals
    const presentCount = results.filter(r => r.present === true).length;
    const missingCount = results.filter(r => r.present === false).length;
    const unknownCount = results.filter(r => r.present === null).length;

    res.json({
      success:      true,
      docType,
      docLabel,
      hasText,
      results,
      summary: {
        total:   items.length,
        present: presentCount,
        missing: missingCount,
        unknown: unknownCount,
        score:   Math.round((presentCount / items.length) * 100),
      },
      rawResponse: content,
    });

  } catch (err) {
    console.error('Verify error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ─── POST /api/fill-templates — fill all PDF templates with form data ──── */
app.post('/api/fill-templates', async (req, res) => {
  try {
    const formData = req.body;
    if (!formData || typeof formData !== 'object') {
      return res.status(400).json({ error: 'formData body is required.' });
    }

    const filled = await fillAllTemplates(formData);

    if (filled.length === 0) {
      return res.status(500).json({ error: 'No templates could be filled.' });
    }

    // If only one template, return it directly as PDF
    if (filled.length === 1) {
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filled[0].name}"`,
        'Content-Length': filled[0].buffer.length,
      });
      return res.send(filled[0].buffer);
    }

    // Multiple templates → zip with JSZip
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="Export_NOC_Filled_Templates.zip"',
    });

    const zip = new JSZip();
    for (const f of filled) {
      zip.file(f.name, f.buffer);
    }
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    res.set('Content-Length', zipBuffer.length);
    res.send(zipBuffer);

  } catch (err) {
    console.error('Fill templates error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ─── POST /api/fill-template/:name — fill a single named template ──────── */
app.post('/api/fill-template/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const formData = req.body;

    const { fillNOCTemplate, fillManufacturingTemplate,
            fillLegalUndertakingTemplate, fillPOTemplate } = require('./templateFiller');

    const fillerMap = {
      'noc':          { fn: fillNOCTemplate,              filename: 'NOC_Undertaking.pdf' },
      'manufacturing':{ fn: fillManufacturingTemplate,    filename: 'Manufacturing_Licence_Form28.pdf' },
      'legal':        { fn: fillLegalUndertakingTemplate, filename: 'Legal_Undertaking_AnnexureII.pdf' },
      'po':           { fn: fillPOTemplate,               filename: 'Export_NOC_Application_Form.pdf' },
    };

    const entry = fillerMap[name];
    if (!entry) return res.status(404).json({ error: `Template "${name}" not found. Valid: ${Object.keys(fillerMap).join(', ')}` });

    const pdfBytes = await entry.fn(formData);
    const buffer   = Buffer.from(pdfBytes);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${entry.filename}"`,
      'Content-Length': buffer.length,
    });
    res.send(buffer);

  } catch (err) {
    console.error('Fill single template error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ─── Start server ──────────────────────────────────────────────────────── */
const PORT = process.env.PORT || 5001;

const server = app.listen(PORT, () => {
  console.log(`\n✅ Drug Ministry backend running on http://localhost:${PORT}`);
  console.log(`   Mistral key: ${process.env.MISTRAL_API_KEY?.slice(0,8)}...`);
  console.log(`   Endpoints:`);
  console.log(`     GET  /health`);
  console.log(`     POST /api/verify`);
  console.log(`     POST /api/validate-template`);
  console.log(`     POST /api/extract-doc-data`);
  console.log(`     POST /api/fill-templates`);
  console.log(`     POST /api/fill-template/:name\n`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Port ${PORT} is already in use.`);
    console.error(`   Run this command to free it, then restart:\n`);
    console.error(`   lsof -ti :${PORT} | xargs kill -9\n`);
    process.exit(1);
  } else {
    throw err;
  }
});
