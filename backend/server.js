require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const fetch = require('node-fetch');
const pdfParse = require('pdf-parse');
const JSZip = require('jszip');
const mongoose = require('mongoose');
const { fillAllTemplates } = require('./templateFiller');

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const APPROVED_DRUGS_WORKBOOK = path.join(__dirname, '..', 'approved_drugs.xlsx');

function decodeXml(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

async function readApprovedDrugsWorkbook() {
  const zip = await JSZip.loadAsync(fs.readFileSync(APPROVED_DRUGS_WORKBOOK));
  const sharedStringsXml = await zip.file('xl/sharedStrings.xml').async('string');
  const sheetXml = await zip.file('xl/worksheets/sheet1.xml').async('string');
  const sharedStrings = [...sharedStringsXml.matchAll(/<si>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/si>/g)]
    .map(match => decodeXml(match[1]).trim());

  return [...sheetXml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)]
    .slice(1)
    .map(([_, rowNumber, rowXml]) => {
      const cells = {};
      for (const [, cellTag, column, value] of rowXml.matchAll(/(<c[^>]*r="([A-Z]+)\d+"[^>]*>\s*<v>([\s\S]*?)<\/v>\s*<\/c>)/g)) {
        const type = cellTag.match(/\bt="([^"]+)"/)?.[1];
        cells[column] = type === 's' ? sharedStrings[Number(value)] : decodeXml(value).trim();
      }
      return {
        id: Number(rowNumber) - 1,
        genericName: cells.B || '',
        strength: cells.C || '',
        indication: cells.D || '',
        approvalDate: cells.E || '',
      };
    })
    .filter(drug => drug.genericName);
}

/* ── MongoDB connection ──────────────────────────────────────────────────── */
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/drug_ministry';
mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
  .then(() => console.log(`✅ MongoDB connected: ${MONGODB_URI}`))
  .catch(err => {
    console.warn(`⚠️  MongoDB not available (${err.message}). Running without DB — application endpoints will return errors.`);
    console.warn('   Start MongoDB or set MONGODB_URI in backend/.env to enable persistence.');
  });

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_SIZE } });

app.use(cors({ origin: 'http://localhost:3000' }));
app.use(express.json({ limit: '50mb' }));

/* ── Application CRUD routes ────────────────────────────────────────────── */
const applicationRoutes = require('./routes/applications');
app.use('/api/applications', applicationRoutes);

let approvedDrugs = [];
readApprovedDrugsWorkbook()
  .then(drugs => {
    approvedDrugs = drugs;
    console.log(`Loaded ${approvedDrugs.length} approved drugs from approved_drugs.xlsx`);
  })
  .catch(err => console.warn(`Could not load approved_drugs.xlsx: ${err.message}`));

app.get('/api/approved-drugs', (_, res) => res.json({ drugs: approvedDrugs }));

/* ─── Health check ─────────────────────────────────────────────────────── */
app.get('/health', (_, res) => res.json({ status: 'ok', model: 'mistral-large-latest' }));

/* ─── Document checklist items per document type ───────────────────────── */
const CHECKLISTS = {
  export_noc: [
    'System generated Integrated Registration Form (IRF) is present',
    'Legal undertaking in Annexure-II on Rs. 100 non-judicial stamp paper is present',
    'Copy of Manufacturing License (Form-29 / Form-25 / Form-28 / Form-28D / Loan Licence) or DSIR / Form-29 is present',
    'Historical data of Export NOC for the applied product is uploaded',
    'Approval Status in importing Country is mentioned (NRA Registration/Approval certificate, or CDSCO approval in India if NRA not available)',
    'Justification in support of applied quantity (based on one year PO / Export NOC history) is present',
  ],
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
  batch_analysis: [
    'Batch number is present',
    'Product / drug name is mentioned',
    'Manufacturing date is present',
    'Expiry / retest date is present',
    'Test parameters are listed (e.g. assay, dissolution, impurities)',
    'Results / specifications meet acceptance criteria',
    'Manufacturer or testing laboratory name is mentioned',
    'Authorized signatory of QC / QA is present',
  ],
  product_info: [
    'Product / brand name is mentioned',
    'Generic / INN name is present',
    'Dosage form and strength are mentioned',
    'Approved indications are listed',
    'Dosage and administration instructions are present',
    'Contraindications / warnings / adverse reactions are listed',
    'Storage conditions are mentioned',
    'Manufacturer / marketing-authorisation holder is mentioned',
  ],
  default: [
    'Document type is identifiable',
    'Organization / company name is present',
    'Date is mentioned',
    'Reference number or ID is present',
    'Authorized signature is present',
    'Purpose / subject of document is stated',
  ],

  /* ─── Checklist-item-specific profiles (Export NOC Check-List Query Page) ── */
  irf: [
    'Applicant name / firm is mentioned',
    'Application number or Reference number is present',
    'Product name / generic name is listed',
    'Manufacturer name is mentioned',
    'Destination country is specified',
    'Applied quantity is mentioned',
    'Application date is present',
    'Authorized signature is visible',
  ],
  legal_undertaking: [
    'Executed on Rs. 100 non-judicial stamp paper is indicated',
    'Annexure-II heading is present',
    'Applicant / firm name is mentioned',
    'Product name and destination country are listed',
    'Undertaking language ("we hereby undertake" / "we undertake") is present',
    'Signatory name and designation are present',
    'Date and place are mentioned',
    'Notary attestation or seal is visible',
  ],
  historical_data: [
    'Applied product name is mentioned',
    'Past Export NOC file numbers are listed',
    'Past export quantities (last year or previous years) are given',
    'Destination countries in past exports are listed',
    'Export dates or year values are present',
    'Applicant / manufacturer name is mentioned',
  ],
  nra_cert: [
    'Foreign National Regulatory Authority (NRA) / Ministry of Health name is present',
    'Product / drug name is mentioned',
    'Registration or approval certificate number is present',
    'Approval or registration date is mentioned',
    'Marketing authorisation holder / applicant name is present',
    'Country of registration is mentioned',
    'Validity or expiry date is present (if applicable)',
    'Regulator seal or authorized signature is visible',
  ],
  cdsco_approval: [
    'CDSCO / DCGI reference is present',
    'Product / drug name is mentioned',
    'Approval / permission number is present',
    'Approval date is present',
    'Applicant / manufacturer name is mentioned',
    'Approved indications or drug composition / strength are listed',
    'Authorised signatory of CDSCO / DCGI is present',
  ],
  justification: [
    'Applied quantity is mentioned',
    'One-year Purchase Order (PO) history / values are given',
    'Past Export NOC references are listed (if available)',
    'Product name is mentioned',
    'Applicant / firm name is present',
    'Narrative supporting the applied quantity is present',
    'Signatory name and date are present',
  ],
};

/* Aliases so the checklist page's docIds map cleanly to server.js keys. */
CHECKLISTS.mfg_license = CHECKLISTS.manufacturing_license;
CHECKLISTS.export_auth = CHECKLISTS.export_authorization;
CHECKLISTS.qa_cert = CHECKLISTS.quality_assurance;

/* ─── Per-checklist "what this document looks like" profile ─────────────── */
/* Used by the AI to first decide whether the upload is the right TYPE of
   document before scoring individual items. Each entry: short identity statement
   + must-have words/phrases that genuine examples of this document type contain. */
const DOC_TYPE_PROFILES = {
  manufacturing_license: {
    identity: 'A Manufacturing License (typically Form 25, Form 28, Form 28D, Loan Licence, or DSIR / Form 29) issued by an Indian State Drug Authority under the Drugs and Cosmetics Act, 1940, authorising a company to manufacture drugs at a specified site.',
    mustHaveAny: ['manufacturing licence', 'manufacturing license', 'licence to manufacture', 'form 25', 'form 28', 'form 28d', 'form-25', 'form-28', 'loan licence', 'state drug', 'drugs and cosmetics', 'drug controller', 'dsir', 'form 29'],
    mustNotBe: 'It must NOT be a product approval certificate, GMP / quality assurance certificate, batch analysis report, export authorisation, product information sheet, invoice, or undertaking.',
  },
  product_approval: {
    identity: 'A Product Approval Certificate / Registration Certificate issued by a regulatory authority (CDSCO, DCGI, or an importing country regulator) approving a specific drug product for marketing.',
    mustHaveAny: ['product approval', 'approval certificate', 'registration certificate', 'marketing authorisation', 'marketing authorization', 'cdsco', 'dcgi', 'approved indications', 'permission to import', 'new drug approval', 'subsequent new drug'],
    mustNotBe: 'It must NOT be a manufacturing licence, GMP certificate, batch analysis report, export authorisation, undertaking, or invoice.',
  },
  export_authorization: {
    identity: 'An Export Authorisation Letter / Export NOC issued by the regulator allowing the export of specified drug quantities to a named destination country.',
    mustHaveAny: ['export authorisation', 'export authorization', 'export noc', 'no objection certificate', 'permission to export', 'destination country', 'quantity to be exported', 'consignee'],
    mustNotBe: 'It must NOT be a manufacturing licence, product approval, GMP / QA certificate, batch analysis report, undertaking, or invoice.',
  },
  quality_assurance: {
    identity: 'A Quality Assurance / GMP / WHO-GMP Certificate or Certificate of Analysis confirming that the manufacturing or product complies with Good Manufacturing Practice standards.',
    mustHaveAny: ['quality assurance', 'gmp certificate', 'good manufacturing practice', 'who-gmp', 'who gmp', 'cgmp', 'certificate of analysis', 'compliance certificate', 'quality management', 'iso 9001'],
    mustNotBe: 'It must NOT be a manufacturing licence, product approval, export NOC, batch analysis report (single batch test), undertaking, or invoice.',
  },
  batch_analysis: {
    identity: 'A Batch Analysis Report or Certificate of Analysis (CoA) for a specific manufactured batch, listing test parameters and their measured results.',
    mustHaveAny: ['batch analysis', 'certificate of analysis', 'coa', 'batch number', 'batch no', 'batch no.', 'analytical report', 'test results', 'specification', 'limits', 'observed', 'complies'],
    mustNotBe: 'It must NOT be a manufacturing licence, product approval, GMP / quality assurance certificate, export NOC, undertaking, or invoice.',
  },
  product_info: {
    identity: 'A Product Information Sheet, Summary of Product Characteristics (SmPC), Package Insert, or Prescribing Information describing a drug product\'s pharmacology, indications, dosing, contraindications, and storage.',
    mustHaveAny: ['product information', 'package insert', 'summary of product characteristics', 'smpc', 'prescribing information', 'indications', 'contraindications', 'adverse reactions', 'dosage and administration', 'pharmacology', 'storage'],
    mustNotBe: 'It must NOT be a manufacturing licence, product approval certificate, GMP / QA certificate, batch analysis report, export NOC, undertaking, or invoice.',
  },
  default: {
    identity: 'A formal document related to the Indian pharmaceutical export NOC application.',
    mustHaveAny: [],
    mustNotBe: '',
  },

  /* ─── Checklist-item-specific identity profiles ─────────────────────────── */
  irf: {
    identity: 'A system-generated Integrated Registration Form (IRF) for the Indian pharmaceutical Export NOC application, listing applicant, product, manufacturer, destination country, and applied quantity.',
    mustHaveAny: ['integrated registration form', 'irf', 'application no', 'application number', 'file number', 'ref no', 'reference no', 'applied for export', 'export noc', 'no objection certificate', 'applicant details'],
    mustNotBe: 'It must NOT be a manufacturing licence, product approval, GMP / QA certificate, batch analysis report, legal undertaking, invoice, or NRA registration certificate.',
  },
  legal_undertaking: {
    identity: 'A Legal Undertaking (Annexure-II) executed by the applicant on Rs. 100 non-judicial stamp paper for the Indian Export NOC process, undertaking regulatory compliance for the exported drug product.',
    mustHaveAny: ['legal undertaking', 'undertaking', 'annexure-ii', 'annexure ii', 'annexure-2', 'annexure 2', 'stamp paper', 'non-judicial', 'we hereby undertake', 'we undertake', 'i / we undertake', 'i/we hereby'],
    mustNotBe: 'It must NOT be a manufacturing licence, product approval, GMP / QA certificate, batch analysis report, IRF, invoice, or NRA certificate.',
  },
  historical_data: {
    identity: 'A historical data record listing past Export NOC file numbers, quantities, dates, and destination countries for the applied drug product.',
    mustHaveAny: ['historical data', 'past export', 'previous noc', 'previous export', 'export noc history', 'export history', 'past year', 'year-wise', 'previously exported', 'past shipments'],
    mustNotBe: 'It must NOT be a manufacturing licence, product approval, GMP / QA certificate, batch analysis report, undertaking, IRF, invoice, or NRA certificate.',
  },
  nra_cert: {
    identity: 'A Registration or Approval Certificate issued by the National Regulatory Authority (NRA) of the destination importing country, authorising the applied drug product for that market.',
    mustHaveAny: ['ministry of health', 'moh', 'national regulatory', 'nra', 'registration certificate', 'marketing authorisation', 'marketing authorization', 'import permit', 'approval certificate', 'certificate of registration', 'health authority', 'directorate of pharmacy', 'medicines authority', 'drug agency'],
    mustNotBe: 'It must NOT be an Indian regulator document (CDSCO / DCGI / State Drug Authority), manufacturing licence, GMP / QA certificate, batch analysis report, undertaking, IRF, or invoice.',
  },
  cdsco_approval: {
    identity: 'An approval / permission letter from CDSCO or DCGI (India) for a drug product, used when the destination importing country regulator does not issue its own approval.',
    mustHaveAny: ['cdsco', 'dcgi', 'drug controller general of india', 'central drugs standard control organization', 'permission letter', 'approval letter', 'no objection', 'approved product', 'directorate general of health services', 'permission for import', 'permission for manufacture'],
    mustNotBe: 'It must NOT be a foreign-country NRA / Ministry-of-Health certificate, manufacturing licence, GMP / QA certificate, batch analysis report, undertaking, IRF, or invoice.',
  },
  justification: {
    identity: 'A justification note supporting the applied export quantity, typically referencing past Purchase Orders (POs) or one-year Export NOC history for the drug product.',
    mustHaveAny: ['justification', 'applied quantity', 'requested quantity', 'purchase order', 'po history', 'po. no', 'po no', 'one year', 'past year', 'annual requirement', 'quantity requested', 'basis of quantity'],
    mustNotBe: 'It must NOT be a manufacturing licence, product approval, GMP / QA certificate, batch analysis report, undertaking, IRF, invoice, or NRA certificate.',
  },
};

/* Aliases so the checklist page's docIds map cleanly to server.js keys. */
DOC_TYPE_PROFILES.mfg_license = DOC_TYPE_PROFILES.manufacturing_license;
DOC_TYPE_PROFILES.export_auth = DOC_TYPE_PROFILES.export_authorization;
DOC_TYPE_PROFILES.qa_cert = DOC_TYPE_PROFILES.quality_assurance;

/* ─── Extract combined text from PDF buffer (legacy callers) ──────────── */
async function extractTextFromPdf(buffer) {
  const pages = await extractTextFromPdfPages(buffer);
  return pages.join('\n\n');
}

/* ─── Extract per-page text from PDF buffer ────────────────────────────── */
async function extractTextFromPdfPages(buffer) {
  const pages = [];
  try {
    const renderPage = async (pageData) => {
      const tc = await pageData.getTextContent({
        normalizeWhitespace: false,
        disableCombineTextItems: false,
      });
      let lastY;
      let text = '';
      for (const item of tc.items) {
        if (lastY === item.transform[5] || lastY == null) {
          text += item.str;
        } else {
          text += '\n' + item.str;
        }
        lastY = item.transform[5];
      }
      pages.push(text);
      return text;
    };
    await pdfParse(buffer, { pagerender: renderPage });
  } catch (e) {
    console.error('PDF parse error:', e.message);
  }
  return pages;
}

/* ─── Visual-only checklist items ──────────────────────────────────────── */
/* Items that require SEEING the document (seals, stamps, signature marks,
   photographs, watermarks). The text pass can never confirm these, so they
   go through a separate vision pass using Pixtral. */
const VISUAL_ITEM_PATTERNS = [
  /\bseal\b/i,
  /\bstamp\b/i,
  /signature.*(visible|present)/i,
  /(visible|present).*signature/i,
  /notary attestation/i,
  /photograph/i,
  /watermark/i,
  /qr[\s-]?code/i,
  /emblem/i,
];

function isVisualItem(item) {
  return VISUAL_ITEM_PATTERNS.some(rx => rx.test(item));
}

/* ─── Vision pass: send the PDF to Pixtral and check visual items ──────── */
/* Model fallback chain — first ID that the account has access to wins.
   Override with MISTRAL_VISION_MODEL in .env if needed. */
const VISION_MODEL_CANDIDATES = [
  process.env.MISTRAL_VISION_MODEL,
  'pixtral-12b-2409',
  'pixtral-12b-latest',
  'pixtral-12b',
  'mistral-medium-latest',
  'mistral-small-latest',
].filter(Boolean);

async function verifyVisualItemsWithVision(pdfBuffer, visualItems) {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey || apiKey === 'your_mistral_api_key_here') {
    throw new Error('MISTRAL_API_KEY is not configured');
  }

  const b64 = pdfBuffer.toString('base64');
  const numbered = visualItems.map((v, i) => `${i + 1}. ${v}`).join('\n');

  const prompt = `You are inspecting a scanned government/regulatory document (Indian pharma export NOC context) for VISUAL elements only. Read the document images page by page.

For each item below, decide if the visual element is present anywhere in the document, and on which page:

${numbered}

Interpretation rules — be inclusive, not strict:
- "Seal" / "stamp" / "emblem" means ANY round, oval or shield-shaped official mark, government/authority emblem, embossed impression, notary stamp, or ink stamp — even faded, light-blue, watermark-style, or partially visible. The Indian FDA/CDSCO/State-Drug seal is typically a circular blue/black mark, often near a signature or at the bottom of the page. Watermarks that reproduce the authority logo (e.g. "FDA MAHARASHTRA" faded across the page) also count as a seal.
- "Signature" / "signatory" means any handwritten mark, eSign block, or digitally signed name (e.g. "e-Signed by NAME on DATE") from a person.
- "Photograph" means a passport-style photo of a person.
- "Watermark" means a repeating faded background image or text overlay.
- "QR code" means a square 2D barcode.
- If the element appears anywhere on any page, mark present=true and report the earliest page.

Return STRICT JSON in exactly this shape — no preamble, no markdown fences:
{
  "items": [
    { "index": 1, "present": true, "page": 1, "evidence": "short description of what you saw and where" }
  ]
}`;

  const body = (model) => JSON.stringify({
    model,
    temperature: 0,
    max_tokens: 1500,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'document_url', document_url: `data:application/pdf;base64,${b64}` },
        ],
      },
    ],
  });

  let lastErr = '';
  for (const model of VISION_MODEL_CANDIDATES) {
    const response = await fetchWithRetry('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: body(model),
    });

    if (response.ok) {
      const data = await response.json();
      const raw = data.choices?.[0]?.message?.content || '{}';
      console.log(`[Vision] used model: ${model}`);
      try { return JSON.parse(raw); } catch { return { items: [] }; }
    }

    const errText = await response.text();
    lastErr = `${response.status}: ${errText.slice(0, 200)}`;
    // Only try the next model on invalid_model / not-found errors.
    const shouldFallback = /invalid_model|not.?found|does not exist|unauthorized model/i.test(errText)
      || response.status === 404;
    if (!shouldFallback) {
      throw new Error(`Pixtral vision error ${lastErr}`);
    }
    console.warn(`[Vision] model "${model}" unavailable (${response.status}) — trying next.`);
  }
  throw new Error(`Pixtral vision error: no accessible vision model. Last: ${lastErr}`);
}

/* ─── Mistral OCR fallback for scanned / image-only PDFs ───────────────── */
async function ocrPdfWithMistral(buffer) {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey || apiKey === 'your_mistral_api_key_here') {
    throw new Error('MISTRAL_API_KEY is not configured');
  }
  const b64 = buffer.toString('base64');
  const response = await fetchWithRetry('https://api.mistral.ai/v1/ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'mistral-ocr-latest',
      document: { type: 'document_url', document_url: `data:application/pdf;base64,${b64}` },
      include_image_base64: false,
    }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Mistral OCR error ${response.status}: ${err}`);
  }
  const data = await response.json();
  return (data.pages || []).map(p => p.markdown || p.text || '');
}

/* ─── Sleep helper ──────────────────────────────────────────────────────── */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/* ─── Detect network-level errors (DNS, connection refused, timeout) ─────── */
function isNetworkError(err) {
  const code = err?.code || '';
  return (
    code === 'ENOTFOUND' ||     // DNS resolution failed
    code === 'ECONNREFUSED' ||  // connection refused
    code === 'ECONNRESET' ||    // connection reset
    code === 'ETIMEDOUT' ||     // connection timed out
    code === 'ENETUNREACH' ||   // network unreachable
    code === 'EAI_AGAIN'        // DNS temporary failure
  );
}

/* ─── Mistral API call with exponential backoff on 429 ─────────────────── */
async function fetchWithRetry(url, options, maxRetries = 4) {
  let delay = 2000; // start with 2 seconds
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response;
    try {
      response = await fetch(url, options);
    } catch (networkErr) {
      if (isNetworkError(networkErr)) {
        // No point retrying DNS/network failures — fail fast with a clear message
        throw new Error(
          `Mistral API is unreachable (${networkErr.code}). ` +
          `Please check your internet connection or network/firewall settings. ` +
          `Original: ${networkErr.message}`
        );
      }
      throw networkErr; // re-throw unexpected errors
    }
    if (response.status !== 429) return response;
    if (attempt === maxRetries) return response; // return 429 on final attempt
    const retryAfter = response.headers.get('retry-after');
    const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : delay;
    console.warn(`[Mistral] 429 rate limit — waiting ${waitMs}ms before retry ${attempt + 1}/${maxRetries}...`);
    await sleep(waitMs);
    delay = Math.min(delay * 2, 30000); // cap at 30s
  }
}

/* ─── Call Mistral chat completions (plain text response) ──────────────── */
async function callMistral(messages, { model = 'mistral-large-latest', maxTokens = 2000 } = {}) {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey || apiKey === 'your_mistral_api_key_here') {
    throw new Error('MISTRAL_API_KEY is not configured. Please set it in backend/.env');
  }

  const response = await fetchWithRetry('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, temperature: 0.1, max_tokens: maxTokens }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Mistral API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

/* ─── Call Mistral chat completions in strict JSON mode ────────────────── */
async function callMistralJson(messages, { model = 'mistral-large-latest', maxTokens = 3500 } = {}) {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey || apiKey === 'your_mistral_api_key_here') {
    throw new Error('MISTRAL_API_KEY is not configured. Please set it in backend/.env');
  }
  const response = await fetchWithRetry('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Mistral API error ${response.status}: ${err}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || '{}';
}

/* ─── Parse Mistral's checklist response ───────────────────────────────── */
function parseChecklistResponse(text, items) {
  const results = [];
  const lines = text.split('\n');

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
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
    let note = '';

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
    const tmpl = TEMPLATE_REQUIREMENTS[docType];

    // Unknown type → allow
    if (!tmpl) return res.json({ matched: true, confidence: 'high', reason: 'No template defined for this type' });

    // ── Layer 1: Extract text ──────────────────────────────────────────────
    let docText = '';
    const isImage = req.file.mimetype.startsWith('image/');

    if (req.file.mimetype === 'application/pdf') {
      docText = await extractTextFromPdf(req.file.buffer);
    }

    const textLength = docText.trim().length;
    const lower = docText.toLowerCase();
    const noText = textLength < tmpl.minLength;

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
          matched: false,
          confidence: 'high',
          layer: 'keyword_exclusion',
          reason: `Document appears to be a different document type (found: ${wrongTermsFound.slice(0, 2).join(', ')}). Expected: ${tmpl.label}`,
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
          { role: 'user', content: aiPrompt },
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
        if (e.message.includes('ENOTFOUND') || e.message.includes('unreachable')) {
          console.warn('[AI Validate] Mistral API unreachable (network/DNS) — falling back to keyword-only validation.');
        } else {
          console.error('[AI Validate] error:', e.message);
        }
        // AI failed → fall back to keyword logic
      }
    }

    // ── Final decision ─────────────────────────────────────────────────────
    let matched;
    let confidence;
    let reason;

    if (aiResult !== null) {
      // AI result is authoritative
      matched = aiResult;
      confidence = 'high';
      reason = aiResult
        ? `✓ ${tmpl.label} — document verified by AI validation`
        : `✗ Document does not appear to be a ${tmpl.label}. ${aiReason}`;
    } else if (noText && isImage) {
      // Image file with no extractable text — allow with warning
      matched = true;
      confidence = 'low';
      reason = `Image file — structural validation skipped. Please ensure this is a ${tmpl.label}.`;
    } else if (noText) {
      // Scanned PDF with no text — allow but warn
      matched = true;
      confidence = 'low';
      reason = `Scanned document — text not extractable. Please ensure this is a ${tmpl.label}.`;
    } else {
      // No AI available — only hard-fail on strong wrong-doc signals (mustNotContain).
      // Keyword presence check is advisory only: without AI we cannot reliably classify,
      // so we fail-open to avoid blocking legitimate documents.
      if (wrongDocHits >= 2) {
        // Already returned above — but guard here too
        matched = false;
        confidence = 'medium';
        reason = `Document appears to be a different document type. Expected: ${tmpl.label}`;
      } else {
        matched = true;
        confidence = anyHits >= 1 ? 'medium' : 'low';
        reason = anyHits >= 1
          ? `Document keywords match expected ${tmpl.label} format`
          : `Document accepted — configure MISTRAL_API_KEY for stricter AI-based validation`;
      }
    }

    res.json({
      matched,
      confidence,
      reason,
      docType,
      docLabel: tmpl.label,
      aiValidated: aiResult !== null,
      keywordAnyHits: anyHits,
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
    const docType = req.body.docType || 'default';
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

/* ─── Fast doc-type-only identification (used by /api/pre-verify) ────────
   Answers ONLY "is this the expected document type?" — skips per-item
   checklist, skips vision pass, skips OCR fallback, uses a small model with
   a truncated text sample. ~1-3s per doc instead of ~15-30s. */
async function identifyDocumentTypeQuick({ buffer, mimetype, docType, docLabel }) {
  const profile = DOC_TYPE_PROFILES[docType] || DOC_TYPE_PROFILES.default;

  let text = '';
  let usedOcr = false;
  if (mimetype === 'application/pdf') {
    try {
      const pages = await extractTextFromPdfPages(buffer);
      text = pages.join('\n\n').trim();
    } catch (_) { /* fall through */ }

    // OCR fallback for scanned PDFs — costs ~5-10s but pre-verify is meant
    // to be accurate, and the app's uploaded docs are typically scans.
    if (text.length < 200) {
      try {
        const ocrPages = await ocrPdfWithMistral(buffer);
        const ocrText = ocrPages.join('\n\n').trim();
        if (ocrText.length > text.length) {
          text = ocrText;
          usedOcr = true;
        }
      } catch (e) {
        console.warn('[pre-verify OCR] fallback failed:', e.message);
      }
    }
  }

  if (text.length < 100) {
    return {
      documentTypeMatch: true,
      documentTypeReason: 'Could not extract text from document — type check skipped, please deep-verify manually.',
    };
  }

  // Truncate — doc-type ID only needs the header/first page or two.
  const sample = text.length > 3000 ? text.slice(0, 3000) + '\n...[truncated]' : text;

  const systemPrompt = `You classify pharmaceutical/regulatory documents. Answer ONLY whether the given text is the EXPECTED document type. Return strict JSON: {"documentTypeMatch": true|false, "documentTypeReason": "one short sentence"}. No preamble, no markdown.`;

  const userPrompt = `EXPECTED document type: "${docLabel}"

What "${docLabel}" should look like:
${profile.identity}
${profile.mustNotBe || ''}

Indicative keywords in genuine "${docLabel}" documents:
${profile.mustHaveAny.length ? profile.mustHaveAny.map(k => `  • ${k}`).join('\n') : '  (none specified)'}

Document text sample (may be truncated):
"""
${sample}
"""

Return JSON only.`;

  // Use the strong model — the truncation + parallelization already give us
  // the speed win; using `small` here would trade real accuracy for maybe 2s.
  const raw = await callMistralJson(
    [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
    { model: 'mistral-large-latest', maxTokens: 200 }
  );

  let parsed;
  try { parsed = JSON.parse(raw); } catch { parsed = {}; }
  return {
    documentTypeMatch: parsed.documentTypeMatch === true,
    documentTypeReason: typeof parsed.documentTypeReason === 'string' ? parsed.documentTypeReason.trim() : '',
  };
}

/* ─── Reusable verification core (used by /api/verify AND /api/pre-verify) ─
   Same logic as before, just factored so a route can call it with a buffer
   instead of an upload. Returns the full response object; never writes to res. */
async function verifyDocumentBuffer({ buffer, mimetype, docType, docLabel }) {
  const items = CHECKLISTS[docType] || CHECKLISTS.default;
  const profile = DOC_TYPE_PROFILES[docType] || DOC_TYPE_PROFILES.default;

  // ── Step 1: extract per-page text ──────────────────────────────────────
  let pages = [];
  let textSource = 'none';
  if (mimetype === 'application/pdf') {
    pages = await extractTextFromPdfPages(buffer);
    if (pages.join('').trim().length > 50) textSource = 'pdf-text';
  }

  // ── Step 2: OCR fallback for scanned / image-only PDFs ────────────────
  const totalChars = pages.reduce((s, p) => s + (p || '').length, 0);
  if (mimetype === 'application/pdf' && totalChars < 200) {
    try {
      const ocrPages = await ocrPdfWithMistral(buffer);
      if (ocrPages.join('').trim().length > 50) {
        pages = ocrPages;
        textSource = 'mistral-ocr';
      }
    } catch (e) {
      if (e.message.includes('ENOTFOUND') || e.message.includes('unreachable')) {
        console.warn('[OCR] Mistral API unreachable (network/DNS issue) — skipping OCR, continuing with text extraction only.');
      } else {
        console.warn('[OCR] fallback failed:', e.message);
      }
    }
  }

  const hasText = pages.join('').trim().length > 100;

  if (!hasText) {
    const blankResults = items.map(it => ({
      item: it, present: null, page: null, evidence: '',
      note: 'Text could not be extracted. Document appears to be a scanned image — AI checklist verification requires text extraction.'
    }));
    return {
      success: true, docType, docLabel, hasText: false, textSource,
      documentTypeMatch: true,
      documentTypeReason: 'Document accepted — scanned/image-based PDF, text extraction unavailable.',
      results: blankResults,
      summary: { total: items.length, present: 0, missing: 0, unknown: items.length, score: 0 },
    };
  }

  // ── Step 3: build prompt with page markers ────────────────────────────
  const MAX_CHARS = 60000;
  let pageText = pages
    .map((p, i) => `\n===== PAGE ${i + 1} =====\n${(p || '').trim()}`)
    .join('\n');
  if (pageText.length > MAX_CHARS) pageText = pageText.slice(0, MAX_CHARS) + '\n...[truncated]';

  const systemPrompt = `You are a strict, evidence-only document verifier for the Indian pharmaceutical Export NOC process (CDSCO / Drug Ministry).

You will be given:
  (a) the full text of an uploaded document (with per-page markers), and
  (b) the EXPECTED document type and its checklist of required parameters.

You MUST perform TWO checks, in order:

CHECK 1 — Document type identification (do this first):
  Decide whether the uploaded document is actually the EXPECTED document type.
  - Use the identity description and the indicative keyword set you are given.
  - If the document is clearly a DIFFERENT type (e.g. an invoice, an undertaking, a CoA when a manufacturing licence is expected, a manufacturing licence when a product approval is expected), set "documentTypeMatch": false and explain why in "documentTypeReason".
  - When the type is wrong, cite a short verbatim quote that supports the decision in "documentTypeEvidence" and its page in "documentTypePage", wherever the document provides usable evidence.
  - Set "detectedDocumentType" to the document type actually observed, when it can be identified from the document.
  - Give a specific upload correction in "suggestedCorrectiveAction". Base it on the expected document type and the observed problem.
  - If the document type matches, set "documentTypeMatch": true.

CHECK 2 — Per-parameter verification:
  ONLY IF documentTypeMatch is true, evaluate each checklist parameter.
  - For each parameter decide present=true / present=false.
  - If present=true, you MUST cite a verbatim quote (<=25 words) copied directly from the document text into "evidence", and the integer "page" it appears on.
  - If a parameter is absent, set present=false and explain what is missing in "note".
  - If a parameter is present but its value is wrong, expired, inconsistent, or otherwise invalid, set present=false, put the required value/condition in "expectedValue", the verbatim observed value in "extractedValue", and cite supporting text/page in "evidence" and "page".
  - For every failed parameter, provide a specific "correctiveAction". Do NOT guess, paraphrase evidence, or invent quotes.
  - If documentTypeMatch is false, set every item's present=false, evidence="", page=null, and note="document type mismatch — parameter not applicable".

Output STRICT JSON only — no preamble, no markdown fences, no commentary.

JSON schema:
{
  "documentTypeMatch": true | false,
  "documentTypeReason": "<one short sentence explaining the type decision>",
  "documentTypeEvidence": "<verbatim short quote supporting a type mismatch, or empty>",
  "documentTypePage": <integer page number or null>,
  "detectedDocumentType": "<observed document type, or empty when uncertain>",
  "suggestedCorrectiveAction": "<specific corrective action when verification fails, or empty>",
  "items": [
    {
      "index": <1..N>,
      "present": true | false,
      "page": <integer page number or null>,
      "evidence": "<verbatim short quote from document, or empty when information is missing>",
      "note": "<one-line result or failure reason in <= 20 words>",
      "expectedValue": "<required value or condition, or empty>",
      "extractedValue": "<verbatim observed value when relevant, or empty>",
      "correctiveAction": "<specific correction for a failed check, or empty>"
    }
  ]
}`;

  const userPrompt = `EXPECTED document type: "${docLabel}"
Internal type key: "${docType}"
Text source: ${textSource}

What "${docLabel}" should look like:
${profile.identity}
${profile.mustNotBe || ''}

Indicative keywords/phrases found in genuine "${docLabel}" documents (presence of several of these is a strong signal — but the absence of all of them is a strong signal of a WRONG document type):
${profile.mustHaveAny.length ? profile.mustHaveAny.map(k => `  • ${k}`).join('\n') : '  (no specific keywords)'}

Document text (with page markers):
"""
${pageText}
"""

Checklist parameters to verify (return one entry per item, in order):
${items.map((it, i) => `${i + 1}. ${it}`).join('\n')}

Return ONLY the JSON object described in the schema — no preamble, no markdown fences.`;

  // ── Step 4: call Mistral in strict JSON mode ──────────────────────────
  const raw = await callMistralJson([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]);

  // ── Step 5: parse and normalise ───────────────────────────────────────
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) {
    console.error('Failed to parse Mistral JSON:', e.message, '\nRaw:', raw.slice(0, 500));
    parsed = { items: [] };
  }

  const byIndex = new Map();
  for (const e of (parsed.items || [])) {
    if (e && typeof e.index === 'number') byIndex.set(e.index, e);
  }

  const documentTypeMatch = parsed.documentTypeMatch === true;
  const documentTypeReason = typeof parsed.documentTypeReason === 'string'
    ? parsed.documentTypeReason.trim() : '';
  const documentTypeEvidence = typeof parsed.documentTypeEvidence === 'string'
    ? parsed.documentTypeEvidence.trim() : '';
  const documentTypePage = typeof parsed.documentTypePage === 'number'
    ? parsed.documentTypePage : null;
  const detectedDocumentType = typeof parsed.detectedDocumentType === 'string'
    ? parsed.detectedDocumentType.trim() : '';
  const suggestedCorrectiveAction = typeof parsed.suggestedCorrectiveAction === 'string'
    ? parsed.suggestedCorrectiveAction.trim() : '';

  const results = items.map((it, i) => {
    if (!documentTypeMatch) {
      return {
        item: it,
        present: false,
        page: null,
        evidence: '',
        note: 'Document type mismatch — parameter not applicable.',
        expectedValue: it,
        extractedValue: '',
        correctiveAction: '',
      };
    }
    const m = byIndex.get(i + 1) || {};
    const present = m.present === true ? true : m.present === false ? false : null;
    const evidence = typeof m.evidence === 'string' ? m.evidence.trim() : '';
    const finalPresent = present === true && !evidence ? null : present;
    return {
      item: it,
      present: finalPresent,
      page: typeof m.page === 'number' ? m.page : null,
      evidence,
      note: typeof m.note === 'string' ? m.note.trim() : '',
      expectedValue: typeof m.expectedValue === 'string' && m.expectedValue.trim()
        ? m.expectedValue.trim() : it,
      extractedValue: typeof m.extractedValue === 'string' ? m.extractedValue.trim() : '',
      correctiveAction: typeof m.correctiveAction === 'string' ? m.correctiveAction.trim() : '',
    };
  });

  // ── Step 5b: vision pass for visual-only items ────────────────────────
  let visionUsed = false;
  if (documentTypeMatch && mimetype === 'application/pdf') {
    const visualIdx = [];
    items.forEach((it, i) => { if (isVisualItem(it)) visualIdx.push(i); });

    if (visualIdx.length > 0) {
      try {
        const vision = await verifyVisualItemsWithVision(buffer, visualIdx.map(i => items[i]));
        const visionByIdx = new Map();
        for (const v of (vision.items || [])) {
          if (v && typeof v.index === 'number') visionByIdx.set(v.index, v);
        }
        visualIdx.forEach((origIdx, k) => {
          const v = visionByIdx.get(k + 1);
          if (!v) return;
          const page = typeof v.page === 'number' ? v.page : results[origIdx].page;
          const evidence = typeof v.evidence === 'string' ? v.evidence.trim() : '';
          if (v.present === true) {
            results[origIdx] = {
              ...results[origIdx],
              present: true,
              page,
              evidence: evidence || 'Visually detected',
              note: 'Verified by vision model',
            };
          } else if (v.present === false && results[origIdx].present !== true) {
            results[origIdx] = {
              ...results[origIdx],
              present: false,
              evidence: '',
              note: evidence ? `Vision: ${evidence}` : 'Not visually detected',
            };
          }
        });
        visionUsed = true;
      } catch (e) {
        console.warn('[Vision] visual-item pass failed:', e.message);
      }
    }
  }

  const presentCount = results.filter(r => r.present === true).length;
  const missingCount = results.filter(r => r.present === false).length;
  const unknownCount = results.filter(r => r.present === null).length;

  return {
    success: true,
    docType,
    docLabel,
    expectedDocumentType: docLabel,
    hasText,
    textSource,
    pageCount: pages.length,
    documentTypeMatch,
    documentTypeReason,
    documentTypeEvidence,
    documentTypePage,
    detectedDocumentType,
    suggestedCorrectiveAction,
    visionUsed,
    results,
    summary: {
      total: items.length,
      present: presentCount,
      missing: missingCount,
      unknown: unknownCount,
      score: documentTypeMatch ? Math.round((presentCount / items.length) * 100) : 0,
    },
    rawResponse: raw,
  };
}

/* ─── POST /api/verify — main verification endpoint ────────────────────── */
app.post('/api/verify', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const result = await verifyDocumentBuffer({
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      docType: req.body.docType || 'default',
      docLabel: req.body.docLabel || 'document',
    });
    return res.json(result);
  } catch (err) {
    const isApiIssue = err.message.includes('MISTRAL_API_KEY') ||
      err.message.includes('ENOTFOUND') ||
      err.message.includes('unreachable') ||
      err.message.includes('401') ||
      err.message.includes('429') ||
      err.message.includes('quota') ||
      err.message.includes('credits');
    console.error('Verify error:', err.message);

    if (isApiIssue) {
      // Return graceful unknown results so reviewer sees the checklist, not an error
      const docType = req.body?.docType || 'default';
      const docLabel = req.body?.docLabel || 'document';
      const items = CHECKLISTS[docType] || CHECKLISTS.default;
      const blankResults = items.map(it => ({
        item: it, present: null, page: null, evidence: '',
        note: 'AI verification temporarily unavailable — result unknown.'
      }));
      return res.json({
        success: true, docType, docLabel, hasText: true, textSource: 'pdf-text',
        documentTypeMatch: true,
        documentTypeReason: 'AI verification service temporarily unavailable.',
        results: blankResults,
        summary: { total: items.length, present: 0, missing: 0, unknown: items.length, score: 0 },
      });
    }

    res.status(500).json({ error: err.message });
  }
});

/* ─── POST /api/applications/:appNum/pre-verify ──────────────────────────
   Runs AI verification for every uploaded document on an application and
   caches the doc-type-match verdict in documents.<docId>.validationResult.
   Reviewer's Documents tab reads the cache to show green/red badges before
   any manual click. Skips docs already cached unless ?force=1. */
const Application = require('./models/Application');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

app.post('/api/applications/:appNum/pre-verify', async (req, res) => {
  try {
    const { appNum } = req.params;
    const force = req.query.force === '1' || req.body?.force === true;

    const application = await Application.findOne({
      $or: [{ applicationNumber: appNum }, { referenceNumber: appNum }],
    });
    if (!application) return res.status(404).json({ error: 'Application not found' });

    // Normalise Map / object doc storage
    const docs = application.documents;
    const entries = docs?.entries
      ? Array.from(docs.entries())
      : Object.entries(docs || {});

    const results = {};

    // Process each doc: return cached verdict, or run fast type-only check.
    // All uncached docs run in parallel so pre-verify wall time ≈ slowest doc.
    const perDoc = async ([docId, docRaw]) => {
      const doc = docRaw?.toObject ? docRaw.toObject() : docRaw;
      if (!doc) return [docId, null];

      if (!force && doc.validated && doc.validationResult && typeof doc.validationResult.documentTypeMatch === 'boolean') {
        return [docId, {
          documentTypeMatch: doc.validationResult.documentTypeMatch,
          documentTypeReason: doc.validationResult.documentTypeReason || '',
          score: doc.validationResult.score ?? null,
          verifiedAt: doc.validationResult.verifiedAt || null,
          cached: true,
        }];
      }

      // Load file bytes (disk preferred, base64 fallback)
      let buffer;
      try {
        if (doc.path) {
          const filePath = path.resolve(path.join(UPLOADS_DIR, doc.path));
          if (!filePath.startsWith(path.resolve(UPLOADS_DIR))) return [docId, { error: 'Invalid document path' }];
          if (!fs.existsSync(filePath)) return [docId, { error: 'File missing on disk' }];
          buffer = fs.readFileSync(filePath);
        } else if (doc.data) {
          let b64 = String(doc.data);
          const comma = b64.indexOf(',');
          if (b64.startsWith('data:') && comma >= 0) b64 = b64.slice(comma + 1);
          buffer = Buffer.from(b64, 'base64');
        } else {
          return [docId, { error: 'File not stored' }];
        }
      } catch (readErr) {
        return [docId, { error: `Read failed: ${readErr.message}` }];
      }

      const docType = CHECKLISTS[docId] ? docId : 'default';
      const docLabel = doc.name || docId;
      const mimetype = doc.type || 'application/pdf';

      try {
        const quick = await identifyDocumentTypeQuick({ buffer, mimetype, docType, docLabel });
        const cached = {
          documentTypeMatch: quick.documentTypeMatch,
          documentTypeReason: quick.documentTypeReason,
          score: null,
          verifiedAt: new Date(),
        };
        return [docId, { cached: false, updatedDoc: { ...doc, validated: true, validationResult: cached }, result: { ...cached, cached: false } }];
      } catch (verifyErr) {
        console.warn(`[pre-verify] ${docId} failed:`, verifyErr.message);
        return [docId, { error: verifyErr.message }];
      }
    };

    const settled = await Promise.all(entries.map(perDoc));
    for (const [docId, r] of settled) {
      if (!r) continue;
      if (r.updatedDoc) {
        if (docs?.set) docs.set(docId, r.updatedDoc);
        else docs[docId] = r.updatedDoc;
        results[docId] = r.result;
      } else {
        results[docId] = r;
      }
    }

    application.markModified('documents');
    await application.save();

    res.json({ success: true, results });
  } catch (err) {
    console.error('Pre-verify error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ─── POST /api/applications/:appNum/document/:docId/verify ──────────────
   Runs the FULL AI verification (text + OCR + per-item checklist + vision
   pass) for one stored application document and caches the full results on
   documents.<docId>.validationResult.fullResults. Subsequent calls hit the
   cache instantly. Pass ?force=1 to re-run and refresh the cache. */
app.post('/api/applications/:appNum/document/:docId/verify', async (req, res) => {
  try {
    const { appNum, docId } = req.params;
    const force = req.query.force === '1' || req.body?.force === true;

    const application = await Application.findOne({
      $or: [{ applicationNumber: appNum }, { referenceNumber: appNum }],
    });
    if (!application) return res.status(404).json({ error: 'Application not found' });

    const docs = application.documents;
    const docRaw = docs?.get ? docs.get(docId) : docs?.[docId];
    if (!docRaw) return res.status(404).json({ error: 'Document not found' });
    const doc = docRaw?.toObject ? docRaw.toObject() : docRaw;

    // Cache hit
    if (!force && doc.validationResult?.fullResults) {
      return res.json({
        ...doc.validationResult.fullResults,
        cached: true,
        verifiedAt: doc.validationResult.verifiedAt || doc.validationResult.fullResults.verifiedAt || null,
      });
    }

    // Load bytes
    let buffer;
    if (doc.path) {
      const filePath = path.resolve(path.join(UPLOADS_DIR, doc.path));
      if (!filePath.startsWith(path.resolve(UPLOADS_DIR))) return res.status(400).json({ error: 'Invalid document path' });
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing on disk' });
      buffer = fs.readFileSync(filePath);
    } else if (doc.data) {
      let b64 = String(doc.data);
      const comma = b64.indexOf(',');
      if (b64.startsWith('data:') && comma >= 0) b64 = b64.slice(comma + 1);
      buffer = Buffer.from(b64, 'base64');
    } else {
      return res.status(404).json({ error: 'File not stored' });
    }

    const docType = CHECKLISTS[docId] ? docId : 'default';
    const docLabel = TEMPLATE_REQUIREMENTS[docId]?.label || doc.name || docId;
    const mimetype = doc.type || 'application/pdf';

    const verifyResult = await verifyDocumentBuffer({ buffer, mimetype, docType, docLabel });
    const verifiedAt = new Date();

    // Persist full result + refresh the top-level type match/reason too so
    // the reviewer's Documents-tab badge stays in sync.
    const updatedDoc = {
      ...doc,
      validated: true,
      validationResult: {
        ...(doc.validationResult || {}),
        documentTypeMatch: verifyResult.documentTypeMatch,
        documentTypeReason: verifyResult.documentTypeReason,
        score: verifyResult.summary?.score ?? null,
        verifiedAt,
        fullResults: verifyResult,
      },
    };
    if (docs?.set) docs.set(docId, updatedDoc);
    else docs[docId] = updatedDoc;
    application.markModified('documents');
    await application.save();

    res.json({ ...verifyResult, cached: false, verifiedAt });
  } catch (err) {
    console.error('Doc verify error:', err.message);
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
      'noc': { fn: fillNOCTemplate, filename: 'NOC_Undertaking.pdf' },
      'manufacturing': { fn: fillManufacturingTemplate, filename: 'Manufacturing_Licence_Form28.pdf' },
      'legal': { fn: fillLegalUndertakingTemplate, filename: 'Legal_Undertaking_AnnexureII.pdf' },
      'po': { fn: fillPOTemplate, filename: 'Export_NOC_Application_Form.pdf' },
    };

    const entry = fillerMap[name];
    if (!entry) return res.status(404).json({ error: `Template "${name}" not found. Valid: ${Object.keys(fillerMap).join(', ')}` });

    const pdfBytes = await entry.fn(formData);
    const buffer = Buffer.from(pdfBytes);
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
  console.log(`   Mistral key: ${process.env.MISTRAL_API_KEY?.slice(0, 8)}...`);
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
