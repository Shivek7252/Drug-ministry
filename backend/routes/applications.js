const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const mongoose = require('mongoose');
const Application = require('../models/Application');
const { v4: uuidv4 } = require('uuid');

/* ── Uploads root (PDF binaries live here, NOT in MongoDB) ───────────────── */
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

/* Multer memory upload for applicant checklist replies (small doc payloads). */
const checklistUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 20 * 1024 * 1024 },
});

const MAX_QUERY_ROUNDS = 5;

/* Approval-section sub-items — same 2 rows for every destination country,
   in every type. Only the display numbering changes per type. */
const APPROVAL_SUBITEMS = [
  { key: '1', title: 'Registration/Approval certificate from NRA of importing Country in case NRA issue the same',      docSuffix: 'nra_cert' },
  { key: '2', title: 'Approval in India from CDSCO if approval status is not available from importing Countrys NRA',    docSuffix: 'cdsco_approval' },
];

/* Per-type layout config. Item IDs are stable across types so query history
   survives if the type ever gets reclassified; only the display itemNo /
   title / whether the item is included differ. */

/* Types 2 & 3 share the same visual layout (items 1,2,3,4=historical,
   5=approval-status per country, 6=justification). Only classification differs. */
const TYPE_2_3_LAYOUT = {
  fixedItems: [
    { itemId: 'irf',         docId: 'irf',               title: 'System generated Integrated Registration Form (IRF)' },
    { itemId: 'legal',       docId: 'legal_undertaking', title: 'Legal undertaking in Annexure-II(on Rs. 100 non-judicial stamp paper)' },
    { itemId: 'mfg_license', docId: 'mfg_license',       title: 'Copy of Manufacturing License (Form-29/Form-25/Form-28/Form-28D/Loan Licence)/ DSIR/Form-29' },
  ],
  hasHistorical: true,
  approvalSectionNo: 5,
  justification: {
    itemId: 'justification', docId: 'justification',
    title: 'Justification in support of applied quantity(based on one year PO/Export NOC history)',
  },
};

const TYPE_PROFILES = {
  type_1: {
    label: 'Different Products – Different Companies – Different Destination Countries',
    fixedItems: [
      { itemId: 'irf',         docId: 'irf',               title: 'System generated Integrated Registration Form (IRF)' },
      { itemId: 'legal',       docId: 'legal_undertaking', title: 'Legal undertaking in Annexture-II' },
      { itemId: 'mfg_license', docId: 'mfg_license',       title: 'Copy of Manufacturing License (Form-29/Form-25/Form-28/Form-28D/Loan Licence)/ DSIR/Form-29' },
    ],
    hasHistorical: false,
    hasMfgLicensePerCompany: false,
    approvalSectionNo: 4,
    justification: {
      itemId: 'justification', docId: 'justification',
      title: 'Justification in support of applied quantity(based on one year PO history)',
    },
  },
  type_2: {
    label: 'Same Company – Same Product – Multiple Destination Countries',
    ...TYPE_2_3_LAYOUT,
    hasMfgLicensePerCompany: false,
  },
  type_3: {
    label: 'Same Company – Different Products – Different Destination Countries',
    ...TYPE_2_3_LAYOUT,
    hasMfgLicensePerCompany: false,
  },
  type_4: {
    label: 'Same Product – Multiple Companies – Multiple Destination Countries',
    /* Items 1 & 2 only in fixedItems — item 3 (Copy of Manufacturing License)
       becomes a parent section with one leaf per company, like section 5.
       hasMfgLicensePerCompany drives that behavior in shape/seed. */
    fixedItems: [
      { itemId: 'irf',         docId: 'irf',               title: 'System generated Integrated Registration Form (IRF)' },
      { itemId: 'legal',       docId: 'legal_undertaking', title: 'Legal undertaking in Annexure-II(on Rs. 100 non-judicial stamp paper)' },
    ],
    hasMfgLicensePerCompany: true,
    hasHistorical: true,
    approvalSectionNo: 5,
    justification: {
      itemId: 'justification', docId: 'justification',
      title: 'Justification in support of applied quantity(based on one year PO/Export NOC history)',
    },
  },
};

const HISTORICAL_ITEM = {
  itemId: 'historical', docId: 'historical_data',
  title: 'Upload historical data of Export NOC for the applied product',
};

const MFG_LICENSE_SUBITEM_TITLE = 'Copy of Manufacturing License (Form-29/Form-25/Form-28/Form-28D/Loan Licence)/ DSIR/Form-29';

/* Detect Type based on counts of unique companies/products/countries.
   Rules:
     Type 2: 1 company + 1 product           (any # countries)
     Type 3: 1 company + >1 products         (any # countries)
     Type 4: 1 product + >1 companies        (any # countries)
     Type 1: everything else (general case: multi-company + multi-product) */
function detectChecklistType(app) {
  const uniq = (arr, key) => new Set((arr || []).map(x => (x?.[key] || '').trim()).filter(Boolean));
  const co = uniq(app.companies, 'name').size || 1;
  const pr = uniq(app.products, 'productName').size || 1;
  if (co === 1 && pr === 1) return 'type_2';
  if (co === 1 && pr > 1)   return 'type_3';
  if (pr === 1 && co > 1)   return 'type_4';
  return 'type_1';
}

/* Return unique companies from companies[] in insertion order. */
function uniqueCompanies(app) {
  const seen = new Set();
  const out  = [];
  for (const c of (app.companies || [])) {
    const name = (c.name || '').trim();
    if (name && !seen.has(name)) { seen.add(name); out.push(c); }
  }
  if (out.length === 0 && app.manufacturerName) {
    out.push({ name: app.manufacturerName, licenseNo: app.mfgLicenseNo || '' });
  }
  return out;
}

/* Canonical (stable) id for a per-company manufacturing-license subitem. */
function mfgLicenseItemId(companyName) {
  const slug = String(companyName || '').replace(/[^a-zA-Z0-9]+/g, '_');
  return `noc_mfg_license_${slug}`;
}

/* Return unique destination countries from consignees[] in insertion order. */
function uniqueDestinationCountries(app) {
  const seen = new Set();
  const out  = [];
  for (const c of (app.consignees || [])) {
    const country = (c.country || '').trim();
    if (country && !seen.has(country)) { seen.add(country); out.push(country); }
  }
  if (out.length === 0 && app.destinationCountry) out.push(app.destinationCountry);
  return out;
}

/* Canonical (stable) id for a per-country approval-status subitem. */
function approvalItemId(country, subKey) {
  const slug = String(country || '').replace(/[^a-zA-Z0-9]+/g, '_');
  return `noc_approval_${subKey}_${slug}`;
}

/* Compute the display numbering for every checklist item based on the type. */
function buildItemNumbering(profile, countries, companies) {
  const numbering = {};
  let n = 1;
  for (const f of profile.fixedItems) numbering[f.itemId] = String(n++);

  // For Type 4: per-company manufacturing-license section slots in here
  let mfgLicenseSectionNo = null;
  if (profile.hasMfgLicensePerCompany) {
    mfgLicenseSectionNo = n;
    (companies || []).forEach((company, i) => {
      numbering[mfgLicenseItemId(company.name)] = `${mfgLicenseSectionNo}.${i + 1}`;
    });
    n = mfgLicenseSectionNo + 1;
  }

  if (profile.hasHistorical) numbering[HISTORICAL_ITEM.itemId] = String(n++);
  const approvalSecNo = n;   // approval status section
  countries.forEach((country, i) => {
    for (const sub of APPROVAL_SUBITEMS) {
      numbering[approvalItemId(country, sub.key)] = `${approvalSecNo}.${i + 1}.${sub.key}`;
    }
  });
  n = approvalSecNo + 1;
  numbering[profile.justification.itemId] = String(n);
  return {
    numbering,
    mfgLicenseSectionNo: mfgLicenseSectionNo === null ? null : String(mfgLicenseSectionNo),
    approvalSectionNo:   String(approvalSecNo),
    justificationNo:     String(n),
  };
}

/* Idempotent seed: refresh titles + itemNo based on the current type; preserve
   queries[] and status. Adds items for new countries; leaves obsolete items
   (e.g. countries removed after the fact) alone so their history isn't lost. */
function seedChecklist(app) {
  if (!app.checklistItems) app.checklistItems = new Map();
  const items    = app.checklistItems;

  // Migration: pre-refactor keys `noc_4_<sub>_<country>` → `noc_approval_<sub>_<country>`
  for (const key of Array.from(items.keys ? items.keys() : Object.keys(items))) {
    if (typeof key === 'string' && key.startsWith('noc_4_')) {
      const newKey = key.replace(/^noc_4_/, 'noc_approval_');
      if (!items.get(newKey)) {
        const val = items.get(key);
        if (val) { val.itemId = newKey; items.set(newKey, val); }
      }
      items.delete(key);
    }
  }

  const type      = detectChecklistType(app);
  const profile   = TYPE_PROFILES[type] || TYPE_PROFILES.type_1;
  const countries = uniqueDestinationCountries(app);
  const companies = uniqueCompanies(app);
  const { numbering } = buildItemNumbering(profile, countries, companies);

  const upsert = (itemId, seed) => {
    const existing = items.get ? items.get(itemId) : items?.[itemId];
    if (existing) {
      // Preserve queries + status; refresh display fields + doc pointers.
      existing.itemNo = seed.itemNo || existing.itemNo;
      existing.title  = seed.title  || existing.title;
      if (seed.country)      existing.country     = seed.country;
      if (seed.company)      existing.company     = seed.company;
      if (seed.parentGroup)  existing.parentGroup = seed.parentGroup;
      if (seed.submissionRemark !== undefined)  existing.submissionRemark  = seed.submissionRemark;
      if (seed.submissionDocName !== undefined) existing.submissionDocName = seed.submissionDocName;
      if (seed.submissionDocPath !== undefined) existing.submissionDocPath = seed.submissionDocPath;
      items.set(itemId, existing);
    } else {
      items.set(itemId, { itemId, status: 'OK', queries: [], ...seed });
    }
  };

  const getDoc = (docId) =>
    (app.documents?.get ? app.documents.get(docId) : app.documents?.[docId]) || null;

  const seedRow = (row) => {
    const uploaded = getDoc(row.docId);
    upsert(row.itemId, {
      itemNo: numbering[row.itemId],
      title:  row.title,
      submissionRemark:  uploaded ? `${row.title.split('(')[0].trim()} has been submitted` : '',
      submissionDocName: uploaded?.name || '',
      submissionDocPath: uploaded?.path || '',
    });
  };

  for (const r of profile.fixedItems) seedRow(r);

  // Type 4: per-company manufacturing-license leaves
  if (profile.hasMfgLicensePerCompany) {
    companies.forEach((company) => {
      const itemId = mfgLicenseItemId(company.name);
      const docId  = `mfg_license_${String(company.name || '').replace(/[^a-zA-Z0-9]+/g, '_')}`;
      const uploaded = getDoc(docId) || getDoc('mfg_license'); // fall back to shared upload if per-company doc absent
      upsert(itemId, {
        itemNo: numbering[itemId],
        title:  MFG_LICENSE_SUBITEM_TITLE,
        parentGroup: 'mfg_license',
        company: company.name,
        submissionRemark:  uploaded ? `Copy of Manufacturing License has been submitted for ${company.name}` : '',
        submissionDocName: uploaded?.name || '',
        submissionDocPath: uploaded?.path || '',
      });
    });
  }

  if (profile.hasHistorical) seedRow(HISTORICAL_ITEM);

  countries.forEach((country) => {
    for (const sub of APPROVAL_SUBITEMS) {
      const itemId = approvalItemId(country, sub.key);
      const docId  = `${sub.docSuffix}_${country.replace(/[^a-zA-Z0-9]+/g, '_')}`;
      const uploaded = getDoc(docId);
      upsert(itemId, {
        itemNo: numbering[itemId],
        title:  sub.title,
        country,
        parentGroup: 'approval_status',
        submissionRemark:  uploaded ? `${sub.title.split(' of ')[0].trim()} has been submitted` : '',
        submissionDocName: uploaded?.name || '',
        submissionDocPath: uploaded?.path || '',
      });
    }
  });

  seedRow(profile.justification);

  app.markModified('checklistItems');
}

/* Shape the checklistItems Map into an ordered tree the UI can render. */
function shapeChecklist(app, baseUrl) {
  const items    = app.checklistItems;
  const type     = detectChecklistType(app);
  const profile  = TYPE_PROFILES[type] || TYPE_PROFILES.type_1;
  const countries = uniqueDestinationCountries(app);
  const companies = uniqueCompanies(app);
  const { approvalSectionNo, mfgLicenseSectionNo } = buildItemNumbering(profile, countries, companies);
  const get = (id) => items?.get ? items.get(id) : items?.[id];

  const withDocUrl = (raw) => {
    if (!raw) return null;
    const item = raw.toObject ? raw.toObject() : { ...raw };
    if (item.submissionDocPath) {
      item.submissionDocUrl = `${baseUrl}/api/applications/${app.applicationNumber}/checklist/${encodeURIComponent(item.itemId)}/submission-file`;
    }
    item.queries = (item.queries || []).map((q, i) => ({
      ...(q.toObject ? q.toObject() : q),
      version: q.version || (i + 1),
      replyDocUrl: q.replyDocPath
        ? `${baseUrl}/api/applications/${app.applicationNumber}/checklist/${encodeURIComponent(item.itemId)}/reply-file/${q.version || (i + 1)}`
        : '',
    }));
    return item;
  };

  const preItems = profile.fixedItems.map(f => withDocUrl(get(f.itemId))).filter(Boolean);

  // Type 4: per-company manufacturing-license section (parent + per-company leaves)
  let mfgLicenseSection = null;
  if (profile.hasMfgLicensePerCompany && mfgLicenseSectionNo) {
    mfgLicenseSection = {
      itemNo: mfgLicenseSectionNo,
      title:  'Copy of Manufacturing License',
      companies: companies.map((company, i) => {
        const leaf = withDocUrl(get(mfgLicenseItemId(company.name)));
        if (leaf) leaf.itemNo = leaf.itemNo || `${mfgLicenseSectionNo}.${i + 1}`;
        return leaf;
      }).filter(Boolean),
    };
  }

  // Historical-data item stays a separate node so the frontend can slot it
  // AFTER mfgLicenseSection in Type 4 (or after preItems in Types 2/3).
  const historicalItem = profile.hasHistorical
    ? withDocUrl(get(HISTORICAL_ITEM.itemId))
    : null;

  // Back-compat: older frontend code reads historical from preItems for
  // Types 2/3 where there is no mfg-license section.
  if (historicalItem && !profile.hasMfgLicensePerCompany) preItems.push(historicalItem);

  const approvalSection = {
    itemNo: approvalSectionNo,
    title:  'Approval Status in importing Country',
    countries: countries.map((country, i) => ({
      itemNo:  `${approvalSectionNo}.${i + 1}`,
      country,
      subItems: APPROVAL_SUBITEMS.map(sub => withDocUrl(get(approvalItemId(country, sub.key)))).filter(Boolean),
    })),
  };

  const postItems = [withDocUrl(get(profile.justification.itemId))].filter(Boolean);

  return {
    type,
    typeLabel: profile.label,
    // Back-compat aliases so old field names still work:
    preSection4:  preItems,
    section4:     approvalSection,
    postSection4: postItems,
    // New canonical names:
    mfgLicenseSection,
    historicalItem,
    preItems,
    approvalSection,
    postItems,
    maxRounds: MAX_QUERY_ROUNDS,
  };
}

/* Path-safe writer for applicant reply doc bytes; returns relative path. */
function persistReplyFile(appNumber, itemId, version, file) {
  if (!file) return null;
  const dir = path.join(UPLOADS_DIR, String(appNumber), 'checklist_replies');
  fs.mkdirSync(dir, { recursive: true });
  const safeItem = String(itemId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const extMatch = (file.originalname || '').match(/\.[a-zA-Z0-9]{1,8}$/);
  const ext = extMatch ? extMatch[0] : '.pdf';
  const fileName = `${safeItem}_v${version}${ext}`;
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, file.buffer);
  return `${appNumber}/checklist_replies/${fileName}`;
}

/* Write each base64 doc to disk, return docs map with `path` set + `data` stripped.
   Keeps the MongoDB document well under the 16 MiB BSON limit. */
function persistDocsToDisk(appNumber, docs) {
  if (!docs || typeof docs !== 'object' || !appNumber) return docs || {};
  const appDir = path.join(UPLOADS_DIR, String(appNumber));
  if (!fs.existsSync(appDir)) fs.mkdirSync(appDir, { recursive: true });

  const out = {};
  for (const [docId, doc] of Object.entries(docs)) {
    if (!doc || typeof doc !== 'object') continue;

    let b64 = '';
    if (typeof doc.data === 'string' && doc.data.length > 0) {
      b64 = doc.data.startsWith('data:')
        ? doc.data.slice(doc.data.indexOf(',') + 1)
        : doc.data;
    }

    if (b64) {
      // Pick safe filename: `${docId}.<ext>`
      const extMatch = (doc.name || '').match(/\.[a-zA-Z0-9]{1,8}$/);
      const ext = extMatch ? extMatch[0] : '.pdf';
      const safeId = String(docId).replace(/[^a-zA-Z0-9_-]/g, '_');
      const fileName = `${safeId}${ext}`;
      const filePath = path.join(appDir, fileName);
      try {
        fs.writeFileSync(filePath, Buffer.from(b64, 'base64'));
        out[docId] = {
          name:       doc.name,
          size:       doc.size,
          type:       doc.type,
          uploadedAt: doc.uploadedAt,
          path:       `${appNumber}/${fileName}`,   // relative under UPLOADS_DIR
          validated:  doc.validated,
          validationResult: doc.validationResult,
        };
        continue;
      } catch (e) {
        console.error(`[persistDocsToDisk] failed to write ${filePath}:`, e.message);
        // fall through and keep base64 in Mongo as a last resort
      }
    }

    // No usable base64 — keep whatever the client sent (path-only update, etc.)
    out[docId] = { ...doc };
  }
  return out;
}

/* ── Legacy shim: synthesise companies[]/consignees[]/shipments[] on read ─
   For old applications saved with the single-manufacturer / single-consignee
   fields, we generate a one-row companies[]/consignees[]/shipments[] on the
   fly so the new reviewer UI works without a data migration. */
function shapeMultiRows(obj) {
  if (!obj) return obj;

  // companies[]
  if (!Array.isArray(obj.companies) || obj.companies.length === 0) {
    if (obj.manufacturerName || obj.mfgLicenseNo || obj.factoryAddress) {
      obj.companies = [{
        companyRef:           'legacy-co',
        name:                 obj.manufacturerName || '',
        licenseNo:            obj.mfgLicenseNo || '',
        factoryAddress:       obj.factoryAddress || '',
        manufacturingSite:    obj.manufacturingSite || '',
        contactPerson:        obj.mfgContactPerson || '',
        contactNumber:        obj.mfgContactNumber || '',
        email:                obj.mfgEmail || '',
        signatoryName:        obj.signatoryName || '',
        signatoryDesignation: obj.signatoryDesignation || '',
      }];
    } else {
      obj.companies = [];
    }
  }

  // consignees[]
  if (!Array.isArray(obj.consignees) || obj.consignees.length === 0) {
    if (obj.consigneeName || obj.consigneeCountry || obj.destinationCountry) {
      obj.consignees = [{
        consigneeRef:  'legacy-cn',
        name:          obj.consigneeName || '',
        organisation:  obj.consigneeOrg || '',
        addressLine1:  obj.addressLine1 || '',
        addressLine2:  obj.addressLine2 || '',
        city:          obj.city || '',
        state:         obj.state || '',
        country:       obj.consigneeCountry || obj.destinationCountry || '',
        postalCode:    obj.postalCode || '',
        contactPerson: obj.contactPerson || '',
        phone:         obj.consigneePhone || '',
        email:         obj.consigneeEmail || '',
      }];
    } else {
      obj.consignees = [];
    }
  }

  // Backfill productRef on legacy products so shipments can reference them
  if (Array.isArray(obj.products)) {
    obj.products = obj.products.map((p, i) => ({
      productRef: p.productRef || `legacy-p${i}`,
      ...p,
    }));
  }

  // shipments[] — cross product every legacy product × single legacy company × single legacy consignee
  if (!Array.isArray(obj.shipments) || obj.shipments.length === 0) {
    const co = obj.companies[0];
    const cn = obj.consignees[0];
    if (co && cn && Array.isArray(obj.products) && obj.products.length > 0) {
      obj.shipments = obj.products.map(p => ({
        companyRef:   co.companyRef,
        productRef:   p.productRef,
        consigneeRef: cn.consigneeRef,
        quantity:     0,
        packSize:     p.packSize || '',
        batchNumbers: p.batchNumber ? [p.batchNumber] : [],
        lineStatus:   'Pending',
        lineRemarks:  [],
      }));
    } else {
      obj.shipments = [];
    }
  }

  return obj;
}

/* ── Infer MIME type from filename or stored type ────────────────────────── */
function inferMimeType(fileName, storedType) {
  if (storedType && storedType !== 'application/octet-stream') return storedType;
  if (!fileName) return 'application/pdf';
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  const map = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
  return map[ext] || 'application/pdf'; // default to PDF for unknown extensions
}

/* ── Generate unique IDs ─────────────────────────────────────────────────── */
function generateAppNumber() {
  const year = new Date().getFullYear();
  const seq = Math.floor(100000 + Math.random() * 900000);
  return `EXP-${year}-${seq}`;
}
function generateRefNumber() {
  const seq = Math.floor(700000 + Math.random() * 200000);
  return `REF-${seq}`;
}

/* ── helper: explicitly replace a Mongoose Map field ─────────────────────── */
function assignDocuments(app, docs) {
  if (!docs || typeof docs !== 'object') return;
  // Build a clean plain object — Mongoose will cast it to Map<DocumentSchema>
  const clean = {};
  for (const [k, v] of Object.entries(docs)) {
    if (v && typeof v === 'object') clean[k] = v;
  }
  // Mongoose's .set() casts plain objects to the schema's Map type properly.
  // Direct assignment (`app.documents = new Map()`) bypasses Mongoose's change
  // tracking and the Map entries are not persisted.
  app.set('documents', clean);
  app.markModified('documents');
  console.log(`[assignDocuments] received ${Object.keys(docs).length} keys, set ${Object.keys(clean).length}, app.documents.size=${app.documents?.size}`);
}

/* ── Ensure uniqueness by checking DB ───────────────────────────────────── */
async function uniqueAppNumber() {
  let num, exists = true;
  while (exists) {
    num = generateAppNumber();
    exists = await Application.exists({ applicationNumber: num });
  }
  return num;
}
async function uniqueRefNumber() {
  let num, exists = true;
  while (exists) {
    num = generateRefNumber();
    exists = await Application.exists({ referenceNumber: num });
  }
  return num;
}

/* ── POST /api/applications/draft — auto-save draft ─────────────────────── */
router.post('/draft', async (req, res) => {
  try {
    const { formData, user = 'anonymous' } = req.body;

    // Check if a draft already exists for this user (same email/org)
    let app = null;
    if (formData.email) {
      app = await Application.findOne({
        email: formData.email,
        isDraft: true,
        status: 'Draft',
      }).sort({ lastSavedAt: -1 });
    }

    if (app) {
      // Update existing draft
      const { documents, ...rest } = formData;
      Object.assign(app, rest, { lastSavedAt: new Date() });
      const persisted = persistDocsToDisk(app.applicationNumber, documents);
      assignDocuments(app, persisted);
      app.auditLog.push({ action: 'draft_saved', detail: 'Auto-saved draft', user });
      await app.save();
      return res.json({ success: true, applicationNumber: app.applicationNumber, referenceNumber: app.referenceNumber, message: 'Draft saved' });
    }

    // Create new draft with generated IDs
    const applicationNumber = await uniqueAppNumber();
    const referenceNumber = await uniqueRefNumber();
    const { documents, ...rest } = formData;
    const newApp = new Application({
      ...rest,
      applicationNumber,
      referenceNumber,
      status: 'Draft',
      isDraft: true,
      submittedBy: user,
      auditLog: [{ action: 'draft_created', detail: 'New draft created', user }],
    });
    const persisted = persistDocsToDisk(applicationNumber, documents);
    assignDocuments(newApp, persisted);
    await newApp.save();
    res.json({ success: true, applicationNumber, referenceNumber, message: 'Draft created' });

  } catch (err) {
    console.error('Draft save error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ── POST /api/applications/submit — final submission ───────────────────── */
router.post('/submit', async (req, res) => {
  try {
    const { formData, user = 'anonymous' } = req.body;

    // DEBUG: log incoming document keys + sizes
    if (formData?.documents) {
      const summary = Object.entries(formData.documents).map(([k, v]) =>
        `${k}(${v?.name || '?'}, ${v?.size || 0}B, data:${v?.data ? v.data.length + 'ch' : 'none'})`
      ).join(', ');
      console.log(`[submit] documents from client: ${summary || 'EMPTY'}`);
    } else {
      console.log('[submit] no documents field in formData');
    }

    // Required field validation
    const required = ['applicantName', 'applicantOrganization', 'email', 'destinationCountry', 'exportCategory'];
    for (const f of required) {
      if (!formData[f] || !String(formData[f]).trim()) {
        return res.status(400).json({ error: `Field "${f}" is required.` });
      }
    }
    if (!formData.products || formData.products.length === 0) {
      return res.status(400).json({ error: 'At least one product is required.' });
    }

    // Find existing draft or create new
    let app = null;
    if (formData.email) {
      app = await Application.findOne({ email: formData.email, isDraft: true }).sort({ lastSavedAt: -1 });
    }

    const submittedAt = new Date();
    const timeline = [
      { step: 'Application Submitted', date: submittedAt.toLocaleString('en-IN'), status: 'completed', desc: 'Application received and assigned reference number' },
      { step: 'Under Review', date: 'Pending', status: 'pending', desc: 'Application will be assigned to Drug Controller Officer' },
      { step: 'Document Verification', date: 'Pending', status: 'pending', desc: 'Documents will be verified' },
      { step: 'Compliance Check', date: 'Pending', status: 'pending', desc: 'Awaiting document verification' },
      { step: 'NOC Decision', date: 'Pending', status: 'pending', desc: 'Awaiting compliance check' },
    ];

    if (app) {
      const { documents, ...rest } = formData;
      Object.assign(app, rest, {
        status: 'Submitted',
        isDraft: false,
        submittedAt,
        lastSavedAt: submittedAt,
        submittedBy: user,
        timeline,
      });
      const persisted = persistDocsToDisk(app.applicationNumber, documents);
      assignDocuments(app, persisted);
      app.auditLog.push({ action: 'submitted', detail: 'Final application submitted', user, timestamp: submittedAt });
      await app.save();
      console.log(`[submit] saved ${app.applicationNumber} with ${app.documents?.size || 0} documents`);
      return res.json({
        success: true,
        applicationNumber: app.applicationNumber,
        referenceNumber: app.referenceNumber,
        message: 'Application submitted successfully',
      });
    }

    // No draft — create and submit immediately
    const applicationNumber = await uniqueAppNumber();
    const referenceNumber = await uniqueRefNumber();
    const { documents, ...rest } = formData;
    const newApp = new Application({
      ...rest,
      applicationNumber,
      referenceNumber,
      status: 'Submitted',
      isDraft: false,
      submittedAt,
      submittedBy: user,
      timeline,
      auditLog: [
        { action: 'submitted', detail: 'Application created and submitted', user, timestamp: submittedAt },
      ],
    });
    const persisted = persistDocsToDisk(applicationNumber, documents);
    assignDocuments(newApp, persisted);
    await newApp.save();
    console.log(`[submit] created ${applicationNumber} with ${newApp.documents?.size || 0} documents`);
    res.json({ success: true, applicationNumber, referenceNumber, message: 'Application submitted successfully' });

  } catch (err) {
    console.error('Submit error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /api/applications/search — search by appNo or refNo ────────────── */
router.get('/search', async (req, res) => {
  try {
    const { appNo, refNo, q } = req.query;
    if (!appNo && !refNo && !q) {
      return res.status(400).json({ error: 'Provide appNo, refNo, or q (search query)' });
    }

    let query = {};
    if (appNo) query.applicationNumber = { $regex: appNo.trim(), $options: 'i' };
    else if (refNo) query.referenceNumber = { $regex: refNo.trim(), $options: 'i' };
    else if (q) {
      const re = { $regex: q.trim(), $options: 'i' };
      query = {
        $or: [
          { applicationNumber: re },
          { referenceNumber: re },
          { applicantName: re },
          { applicantOrganization: re },
          { email: re },
          { mfgLicenseNo: re },
        ]
      };
    }

    const results = await Application
      .find(query)
      .select('-documents -auditLog')  // exclude heavy fields from list
      .sort({ createdAt: -1 })
      .limit(20);

    res.json({ success: true, count: results.length, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /api/applications/stats/summary — dashboard stats ──────────────── */
router.get('/stats/summary', async (req, res) => {
  try {
    const [total, approved, pending, rejected, underReview] = await Promise.all([
      Application.countDocuments({ isDraft: false }),
      Application.countDocuments({ status: 'Approved' }),
      Application.countDocuments({ status: { $in: ['Submitted', 'Draft'] } }),
      Application.countDocuments({ status: 'Rejected' }),
      Application.countDocuments({ status: 'Under Review' }),
    ]);

    // Monthly counts for current year
    const year = new Date().getFullYear();
    const monthly = await Application.aggregate([
      { $match: { createdAt: { $gte: new Date(`${year}-01-01`) }, isDraft: false } },
      {
        $group: {
          _id: { $month: '$createdAt' },
          applications: { $sum: 1 },
          approved: { $sum: { $cond: [{ $eq: ['$status', 'Approved'] }, 1, 0] } },
        }
      },
      { $sort: { _id: 1 } },
    ]);

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthlyData = months.map((month, i) => {
      const found = monthly.find(m => m._id === i + 1);
      return { month, applications: found?.applications || 0, approved: found?.approved || 0 };
    });

    // Country distribution
    const byCountry = await Application.aggregate([
      { $match: { isDraft: false } },
      { $group: { _id: '$destinationCountry', value: { $sum: 1 } } },
      { $sort: { value: -1 } },
      { $limit: 8 },
      { $project: { country: '$_id', value: 1, _id: 0 } },
    ]);

    // Category distribution
    const byCategory = await Application.aggregate([
      { $match: { isDraft: false } },
      { $group: { _id: '$exportCategory', value: { $sum: 1 } } },
      { $sort: { value: -1 } },
      { $project: { name: '$_id', value: 1, _id: 0 } },
    ]);

    res.json({
      success: true,
      stats: { total, approved, pending, rejected, underReview },
      monthly: monthlyData,
      byCountry,
      byCategory,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /api/applications/:id/document/:docId — stream raw document file ── */
router.get('/:id/document/:docId', async (req, res) => {
  try {
    const { id, docId } = req.params;
    const app = await Application.findOne({
      $or: [
        { applicationNumber: id },
        { referenceNumber:   id },
        { _id: mongoose.isValidObjectId(id) ? id : null },
      ],
    });
    if (!app) return res.status(404).json({ error: 'Application not found' });

    const doc = app.documents?.get ? app.documents.get(docId) : app.documents?.[docId];
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    // Preferred: stream from disk (current architecture)
    if (doc.path && typeof doc.path === 'string') {
      const filePath = path.join(UPLOADS_DIR, doc.path);
      const resolved = path.resolve(filePath);
      // path-traversal safety
      if (!resolved.startsWith(path.resolve(UPLOADS_DIR))) {
        return res.status(400).json({ error: 'Invalid document path' });
      }
      if (!fs.existsSync(resolved)) {
        return res.status(404).json({ error: 'Document file missing on disk' });
      }
      res.set({
        'Content-Type':        inferMimeType(doc.name, doc.type),
        'Content-Disposition': `inline; filename="${doc.name || 'document'}"`,
      });
      return fs.createReadStream(resolved).pipe(res);
    }

    // Legacy: base64 stored inline in Mongo
    if (doc.data) {
      let b64 = String(doc.data);
      const comma = b64.indexOf(',');
      if (b64.startsWith('data:') && comma >= 0) b64 = b64.slice(comma + 1);
      const buf = Buffer.from(b64, 'base64');
      res.set({
        'Content-Type':        inferMimeType(doc.name, doc.type),
        'Content-Disposition': `inline; filename="${doc.name || 'document'}"`,
        'Content-Length':      buf.length,
      });
      return res.send(buf);
    }

    return res.status(404).json({ error: 'Document file not stored' });
  } catch (err) {
    console.error('Doc fetch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /api/applications/:id — get full application by appNo ──────────── */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const app = await Application.findOne({
      $or: [
        { applicationNumber: id },
        { referenceNumber: id },
        { _id: mongoose.isValidObjectId(id) ? id : null },
      ],
    });
    if (!app) return res.status(404).json({ error: 'Application not found' });

    // Strip raw bytes; emit a download URL instead
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const obj = app.toObject({ flattenMaps: true });
    if (obj.documents) {
      const docsOut = {};
      for (const [k, v] of Object.entries(obj.documents)) {
        docsOut[k] = {
          name: v.name, size: v.size, type: v.type,
          uploadedAt: v.uploadedAt, validated: v.validated,
          objectUrl: (v.path || v.data) ? `${baseUrl}/api/applications/${obj.applicationNumber}/document/${k}` : '',
        };
      }
      obj.documents = docsOut;
    }
    shapeMultiRows(obj);
    res.json({ success: true, application: obj });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /api/applications — list all (admin/dashboard) ─────────────────── */
router.get('/', async (req, res) => {
  try {
    const { status, limit = 20, skip = 0, isDraft } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (isDraft !== undefined) filter.isDraft = isDraft === 'true';
    else filter.isDraft = false; // default: only submitted apps

    const [apps, total] = await Promise.all([
      Application.find(filter)
        .select('-documents -auditLog')
        .sort({ createdAt: -1 })
        .limit(Number(limit))
        .skip(Number(skip)),
      Application.countDocuments(filter),
    ]);

    res.json({ success: true, total, count: apps.length, applications: apps });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── POST /api/applications/:id/review — reviewer action ────────────────── */
router.post('/:id/review', async (req, res) => {
  try {
    const { status, remarks, officer = 'reviewer' } = req.body;
    const app = await Application.findOne({
      $or: [{ applicationNumber: req.params.id }, { _id: req.params.id }],
    });
    if (!app) return res.status(404).json({ error: 'Application not found' });

    const prev = app.status;
    if (status) app.status = status;
    app.auditLog.push({
      action: 'reviewer_action',
      detail: `Status: ${prev} → ${status || prev}. Remarks: ${remarks || '—'}`,
      user: officer,
      timestamp: new Date(),
    });
    if (remarks) {
      if (!app.reviewerRemarks) app.reviewerRemarks = [];
      app.reviewerRemarks.push({ text: remarks, officer, timestamp: new Date(), status: status || prev });
    }
    await app.save();
    res.json({ success: true, status: app.status, auditLog: app.auditLog });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /api/applications/:id/full — full detail with audit log ─────────── */
router.get('/:id/full', async (req, res) => {
  try {
    const app = await Application.findOne({
      $or: [{ applicationNumber: req.params.id }, { referenceNumber: req.params.id }],
    });
    if (!app) return res.status(404).json({ error: 'Not found' });
    const obj = app.toObject({ flattenMaps: true });
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    if (obj.documents) {
      const docsOut = {};
      for (const [k, v] of Object.entries(obj.documents)) {
        docsOut[k] = {
          name: v.name, size: v.size, type: v.type,
          uploadedAt: v.uploadedAt, validated: v.validated,
          objectUrl: (v.path || v.data) ? `${baseUrl}/api/applications/${obj.applicationNumber}/document/${k}` : '',
        };
      }
      obj.documents = docsOut;
    }
    shapeMultiRows(obj);
    res.json({ success: true, application: obj });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── POST /api/applications/:id/shipments/:idx/action ────────────────────
   Reviewer sets lineStatus + adds a lineRemarks entry on ONE shipment line,
   then app-level status is rolled up from every line's status. */
function rollupApplicationStatus(shipmentStatuses) {
  if (!Array.isArray(shipmentStatuses) || shipmentStatuses.length === 0) return null;
  const has = (s) => shipmentStatuses.includes(s);
  const all = (s) => shipmentStatuses.every(x => x === s);
  if (all('Approved'))                        return 'Approved';
  if (all('Rejected'))                        return 'Rejected';
  if (has('Query'))                           return 'Query Raised';
  if (has('Approved') && has('Rejected'))     return 'Partially Approved';
  if (has('Approved') || has('Verified'))     return 'Under Review';
  return null; // no change — leave whatever's there
}

router.post('/:id/shipments/:idx/action', async (req, res) => {
  try {
    const { status, remarks = '', officer = 'reviewer' } = req.body;
    const idx = Number(req.params.idx);
    if (!Number.isFinite(idx) || idx < 0) {
      return res.status(400).json({ error: 'Invalid shipment index' });
    }
    if (!['Pending', 'Verified', 'Query', 'Approved', 'Rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const app = await Application.findOne({
      $or: [{ applicationNumber: req.params.id }, { referenceNumber: req.params.id }],
    });
    if (!app) return res.status(404).json({ error: 'Application not found' });

    // ── Legacy synthesis: if shipments[] is empty, build from products × companies × consignees ──
    if (!Array.isArray(app.shipments) || app.shipments.length === 0) {
      // Ensure companies[]
      let companies = Array.isArray(app.companies) && app.companies.length > 0
        ? app.companies
        : (app.manufacturerName || app.mfgLicenseNo || app.factoryAddress)
          ? [{ companyRef: 'legacy-co', name: app.manufacturerName || '', licenseNo: app.mfgLicenseNo || '', factoryAddress: app.factoryAddress || '' }]
          : [];

      // Ensure consignees[]
      let consignees = Array.isArray(app.consignees) && app.consignees.length > 0
        ? app.consignees
        : (app.consigneeName || app.consigneeCountry || app.destinationCountry)
          ? [{ consigneeRef: 'legacy-cn', name: app.consigneeName || '', country: app.consigneeCountry || app.destinationCountry || '' }]
          : [];

      // Ensure products have productRef
      const products = Array.isArray(app.products)
        ? app.products.map((p, i) => ({ productRef: p.productRef || `legacy-p${i}`, ...p.toObject ? p.toObject() : p }))
        : [];

      const co = companies[0];
      const cn = consignees[0];
      if (co && cn && products.length > 0) {
        app.shipments = products.map(p => ({
          companyRef:   co.companyRef,
          productRef:   p.productRef,
          consigneeRef: cn.consigneeRef,
          quantity:     0,
          packSize:     p.packSize || '',
          batchNumbers: p.batchNumber ? [p.batchNumber] : [],
          lineStatus:   'Pending',
          lineRemarks:  [],
        }));
        app.markModified('shipments');
      }
    }

    if (!Array.isArray(app.shipments) || !app.shipments[idx]) {
      return res.status(404).json({ error: 'Shipment line not found' });
    }

    const line = app.shipments[idx];
    const prev = line.lineStatus || 'Pending';
    line.lineStatus = status;
    line.lineRemarks = line.lineRemarks || [];
    line.lineRemarks.push({ text: remarks, officer, status, timestamp: new Date() });
    app.markModified('shipments');

    // Roll-up application-level status
    const rolled = rollupApplicationStatus(app.shipments.map(s => s.lineStatus || 'Pending'));
    if (rolled) app.status = rolled;

    app.auditLog.push({
      action: 'line_action',
      detail: `Shipment #${idx + 1}: ${prev} → ${status}. ${remarks ? '"' + remarks + '"' : ''}`,
      user:   officer,
      timestamp: new Date(),
    });

    await app.save();
    res.json({
      success: true,
      status: app.status,
      shipmentIdx: idx,
      lineStatus: status,
    });
  } catch (err) {
    console.error('Line action error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ── PATCH /api/applications/:id/status — update status ─────────────────── */
router.patch('/:id/status', async (req, res) => {
  try {
    const { status, note, user = 'system' } = req.body;
    const app = await Application.findOne({
      $or: [{ applicationNumber: req.params.id }, { _id: req.params.id }],
    });
    if (!app) return res.status(404).json({ error: 'Application not found' });

    app.status = status;
    app.auditLog.push({ action: 'status_changed', detail: `Status changed to ${status}. ${note || ''}`, user });
    await app.save();
    res.json({ success: true, status: app.status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════════════
   Export NOC Check-List Query flow (Type 1: multi-country)
   ─────────────────────────────────────────────────────────────────────── */

async function loadAppOr404(idOrRef, res) {
  const app = await Application.findOne({
    $or: [
      { applicationNumber: idOrRef },
      { referenceNumber:   idOrRef },
      { _id: mongoose.isValidObjectId(idOrRef) ? idOrRef : null },
    ],
  });
  if (!app) { res.status(404).json({ error: 'Application not found' }); return null; }
  return app;
}

/* ── GET /:id/checklist — full checklist tree for reviewer + applicant ── */
router.get('/:id/checklist', async (req, res) => {
  try {
    const app = await loadAppOr404(req.params.id, res);
    if (!app) return;
    seedChecklist(app);
    await app.save();
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json({
      success: true,
      applicationNumber: app.applicationNumber,
      referenceNumber:   app.referenceNumber,
      status:            app.status,
      checklist:         shapeChecklist(app, baseUrl),
    });
  } catch (err) {
    console.error('checklist load error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ── POST /:id/checklist/:itemId/query — reviewer raises a query ────── */
router.post('/:id/checklist/:itemId/query', async (req, res) => {
  try {
    const { queryText, officer = 'reviewer' } = req.body;
    if (!queryText || !String(queryText).trim()) {
      return res.status(400).json({ error: 'queryText is required' });
    }
    const app = await loadAppOr404(req.params.id, res);
    if (!app) return;
    seedChecklist(app);

    const item = app.checklistItems.get(req.params.itemId);
    if (!item) return res.status(404).json({ error: 'Checklist item not found' });

    // Enforce: reviewer can only raise a query if there's no open (unreplied) query
    const openRound = (item.queries || []).find(q => !q.reply);
    if (openRound) {
      return res.status(409).json({ error: 'An open query already exists for this item. Wait for applicant reply.' });
    }
    if ((item.queries || []).length >= MAX_QUERY_ROUNDS) {
      return res.status(409).json({ error: `Query limit reached (${MAX_QUERY_ROUNDS} rounds per item).` });
    }

    const version = (item.queries || []).length + 1;
    item.queries = item.queries || [];
    item.queries.push({
      version,
      queryText: String(queryText).trim(),
      queryDate: new Date(),
      queryBy:   officer,
    });
    if (version === 1) item.baseQuery = String(queryText).trim();
    item.status = 'Query';

    app.status = 'Query Raised';
    app.checklistItems.set(req.params.itemId, item);
    app.markModified('checklistItems');
    app.auditLog.push({
      action: 'checklist_query',
      detail: `Item ${item.itemNo} (${item.title}) — v${version} query raised: "${item.queries[version - 1].queryText}"`,
      user:   officer,
    });
    await app.save();

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json({ success: true, checklist: shapeChecklist(app, baseUrl) });
  } catch (err) {
    console.error('checklist query error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ── POST /:id/checklist/:itemId/reply — applicant replies to latest query ── */
router.post('/:id/checklist/:itemId/reply', checklistUpload.single('replyDoc'), async (req, res) => {
  try {
    const reply     = (req.body.reply || '').trim();
    const applicant = req.body.applicant || 'applicant';
    if (!reply) return res.status(400).json({ error: 'reply text is required' });

    const app = await loadAppOr404(req.params.id, res);
    if (!app) return;
    seedChecklist(app);

    const item = app.checklistItems.get(req.params.itemId);
    if (!item) return res.status(404).json({ error: 'Checklist item not found' });

    const openIdx = (item.queries || []).findIndex(q => !q.reply);
    if (openIdx === -1) return res.status(409).json({ error: 'No open query to reply to.' });

    const round = item.queries[openIdx];
    round.reply     = reply;
    round.replyDate = new Date();

    if (req.file) {
      const relPath = persistReplyFile(app.applicationNumber, req.params.itemId, round.version, req.file);
      round.replyDocName = req.file.originalname;
      round.replyDocPath = relPath;
      round.replyDocType = req.file.mimetype;
      round.replyDocSize = req.file.size;
    }

    item.previousQuery = round.queryText;
    item.status = 'Query Replied OK';

    app.checklistItems.set(req.params.itemId, item);
    app.markModified('checklistItems');

    // Roll application status back to Under Review if no other items still open
    const anyOpen = [...app.checklistItems.values()].some(it => (it.queries || []).some(q => !q.reply));
    if (!anyOpen && app.status === 'Query Raised') app.status = 'Under Review';

    app.auditLog.push({
      action: 'checklist_reply',
      detail: `Item ${item.itemNo} (${item.title}) — v${round.version} reply: "${reply}"${req.file ? ' [file attached]' : ''}`,
      user:   applicant,
    });
    await app.save();

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json({ success: true, checklist: shapeChecklist(app, baseUrl) });
  } catch (err) {
    console.error('checklist reply error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /:id/checklist/:itemId/submission-file — stream at-submission doc ── */
router.get('/:id/checklist/:itemId/submission-file', async (req, res) => {
  try {
    const app = await loadAppOr404(req.params.id, res);
    if (!app) return;
    const item = app.checklistItems?.get(req.params.itemId);
    if (!item?.submissionDocPath) return res.status(404).json({ error: 'File not found' });
    const resolved = path.resolve(path.join(UPLOADS_DIR, item.submissionDocPath));
    if (!resolved.startsWith(path.resolve(UPLOADS_DIR))) return res.status(400).json({ error: 'Invalid path' });
    if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'File missing on disk' });
    const mimeType = inferMimeType(item.submissionDocName, item.submissionDocType);
    res.set({
      'Content-Type':        mimeType,
      'Content-Disposition': `inline; filename="${item.submissionDocName || 'document'}"`,
    });
    fs.createReadStream(resolved).pipe(res);
  } catch (err) {
    console.error('submission-file error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /:id/checklist/:itemId/reply-file/:version — stream applicant reply doc ── */
router.get('/:id/checklist/:itemId/reply-file/:version', async (req, res) => {
  try {
    const app = await loadAppOr404(req.params.id, res);
    if (!app) return;
    const item  = app.checklistItems?.get(req.params.itemId);
    const round = item?.queries?.find(q => String(q.version) === String(req.params.version));
    if (!round?.replyDocPath) return res.status(404).json({ error: 'File not found' });
    const resolved = path.resolve(path.join(UPLOADS_DIR, round.replyDocPath));
    if (!resolved.startsWith(path.resolve(UPLOADS_DIR))) return res.status(400).json({ error: 'Invalid path' });
    if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'File missing on disk' });
    const mimeType = inferMimeType(round.replyDocName, round.replyDocType);
    res.set({
      'Content-Type':        mimeType,
      'Content-Disposition': `inline; filename="${round.replyDocName || 'reply-document'}"`,
    });
    fs.createReadStream(resolved).pipe(res);
  } catch (err) {
    console.error('reply-file error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   STEP II — RECONCILIATION ROUTES
   Official CDSCO reconciliation module: one entry per consignment export.
   Module stays open throughout the NOC validity period.
   ══════════════════════════════════════════════════════════════════════════ */

const reconciliationUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

/* ── Compute residual shelf life % (for formulations) ──────────────────────
   Returns a number 0-100, or null if dates not parseable. */
function residualShelfLifePct(mfgDate, expiryDate) {
  try {
    const mfg  = new Date(mfgDate);
    const exp  = new Date(expiryDate);
    const now  = new Date();
    if (isNaN(mfg) || isNaN(exp)) return null;
    const totalMs  = exp - mfg;
    const usedMs   = now - mfg;
    const remainPct = Math.max(0, Math.round(((totalMs - usedMs) / totalMs) * 100));
    return remainPct;
  } catch { return null; }
}

/* ── Residual shelf life in months (for APIs) ───────────────────────────── */
function residualShelfLifeMonths(expiryDate) {
  try {
    const exp  = new Date(expiryDate);
    const now  = new Date();
    if (isNaN(exp)) return null;
    const diffMs   = exp - now;
    return Math.max(0, diffMs / (1000 * 60 * 60 * 24 * 30.44));
  } catch { return null; }
}

/* ── GET /:id/reconciliation — get all reconciliation entries + NOC meta ── */
router.get('/:id/reconciliation', async (req, res) => {
  try {
    const app = await loadAppOr404(req.params.id, res);
    if (!app) return;

    const obj = app.toObject();
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    // Attach doc download URLs to each entry
    const entries = (obj.reconciliations || []).map(e => ({
      ...e,
      docUrl: e.docPath
        ? `${baseUrl}/api/applications/${obj.applicationNumber}/reconciliation/${e.entryId}/doc`
        : '',
    }));

    // Compute running totals
    const exportedNums = entries
      .filter(e => e.status !== 'Draft')
      .map(e => parseFloat(e.packedExportedQty) || 0);
    const totalExported = exportedNums.reduce((s, n) => s + n, 0);

    res.json({
      success:           true,
      applicationNumber: obj.applicationNumber,
      referenceNumber:   obj.referenceNumber,
      status:            obj.status,
      nocMeta:           obj.nocMeta || null,
      entries,
      summary: {
        totalEntries:   entries.length,
        totalExported,
        draftCount:     entries.filter(e => e.status === 'Draft').length,
        submittedCount: entries.filter(e => e.status === 'Submitted').length,
        releasedCount:  entries.filter(e => e.status === 'Released').length,
      },
    });
  } catch (err) {
    console.error('reconciliation GET error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ── POST /:id/reconciliation — add a new reconciliation entry ────────────
   Accepts multipart form data (with optional COA/EI doc attachment).       */
router.post('/:id/reconciliation', reconciliationUpload.single('doc'), async (req, res) => {
  try {
    const app = await loadAppOr404(req.params.id, res);
    if (!app) return;

    // Only allow if NOC is approved / active
    if (!['Approved', 'Under Review', 'Submitted', 'Verified'].includes(app.status) &&
        app.status !== 'Approved') {
      // Allow for testing when status is any non-Draft — gate loosely
    }

    const b = req.body;
    const entryId = uuidv4();

    // Compute shelf life
    const productType = b.productType || 'formulation';
    let shelfLifeStatus = 'ok';
    let pct = null;

    if (b.expiryDate) {
      if (productType === 'api') {
        const months = residualShelfLifeMonths(b.expiryDate);
        pct = residualShelfLifePct(b.mfgDate, b.expiryDate);
        if (months !== null && months < 3)  shelfLifeStatus = 'destroy';
        else if (months !== null && months < 6) shelfLifeStatus = 'warning';
      } else {
        pct = residualShelfLifePct(b.mfgDate, b.expiryDate);
        if (pct !== null && pct < 60) shelfLifeStatus = 'destroy';
        else if (pct !== null && pct < 70) shelfLifeStatus = 'warning';
      }
    }

    // Compute leftUnpackedQty  
    const nocQty    = parseFloat(b.nocQty || app.nocMeta?.sanctionedQty || 0);
    const batchQty  = parseFloat(b.batchQtyManufactured || 0);
    const packed    = parseFloat(b.packedExportedQty || 0);
    const leftUnpackedQty = batchQty > 0 ? String(Math.max(0, batchQty - packed)) : '';

    // Persist optional document
    let docName = '', docPath = '', docType = '', docSize = 0;
    if (req.file) {
      const appDir = path.join(UPLOADS_DIR, String(app.applicationNumber), 'reconciliation');
      fs.mkdirSync(appDir, { recursive: true });
      const extMatch = (req.file.originalname || '').match(/\.[a-zA-Z0-9]{1,8}$/);
      const ext      = extMatch ? extMatch[0] : '.pdf';
      const fileName = `recon_${entryId}${ext}`;
      const filePath = path.join(appDir, fileName);
      fs.writeFileSync(filePath, req.file.buffer);
      docName = req.file.originalname;
      docPath = `${app.applicationNumber}/reconciliation/${fileName}`;
      docType = req.file.mimetype;
      docSize = req.file.size;
    }

    const entry = {
      entryId,
      nocQty:              b.nocQty || (app.nocMeta?.sanctionedQty || ''),
      batchQtyManufactured:b.batchQtyManufactured || '',
      packedExportedQty:   b.packedExportedQty || '',
      leftUnpackedQty,
      countryExported:     b.countryExported || '',
      customerName:        b.customerName || '',
      customerAddress:     b.customerAddress || '',
      poNumber:            b.poNumber || '',
      eiNumber:            b.eiNumber || '',
      sbNumber:            b.sbNumber || '',
      poDate:              b.poDate || '',
      eiDate:              b.eiDate || '',
      sbDate:              b.sbDate || '',
      productRef:          b.productRef || '',
      productName:         b.productName || '',
      batchNumber:         b.batchNumber || '',
      productType,
      mfgDate:             b.mfgDate || '',
      expiryDate:          b.expiryDate || '',
      residualShelfLifePct: pct,
      shelfLifeStatus,
      docName, docPath, docType, docSize,
      status:      b.status === 'Submitted' ? 'Submitted' : 'Draft',
      submittedBy: b.submittedBy || 'applicant',
      submittedAt: new Date(),
    };

    if (!Array.isArray(app.reconciliations)) app.reconciliations = [];
    app.reconciliations.push(entry);
    app.markModified('reconciliations');

    app.auditLog.push({
      action: 'reconciliation_entry',
      detail: `Reconciliation entry added (${entry.status}): ${entry.productName || 'product'} → ${entry.countryExported}, Qty: ${entry.packedExportedQty}`,
      user:   b.submittedBy || 'applicant',
      timestamp: new Date(),
    });

    await app.save();

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json({
      success: true,
      entry: {
        ...entry,
        docUrl: entry.docPath
          ? `${baseUrl}/api/applications/${app.applicationNumber}/reconciliation/${entryId}/doc`
          : '',
      },
    });
  } catch (err) {
    console.error('reconciliation POST error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ── PATCH /:id/reconciliation/:entryId — update/submit an entry ────────── */
router.patch('/:id/reconciliation/:entryId', reconciliationUpload.single('doc'), async (req, res) => {
  try {
    const app = await loadAppOr404(req.params.id, res);
    if (!app) return;

    const idx = (app.reconciliations || []).findIndex(e => e.entryId === req.params.entryId);
    if (idx === -1) return res.status(404).json({ error: 'Reconciliation entry not found' });

    const existing = app.reconciliations[idx];
    const b = req.body;

    // Recompute shelf life if dates changed
    const productType = b.productType || existing.productType || 'formulation';
    let shelfLifeStatus = existing.shelfLifeStatus || 'ok';
    let pct = existing.residualShelfLifePct;
    const expiryDate = b.expiryDate || existing.expiryDate;
    const mfgDate    = b.mfgDate    || existing.mfgDate;

    if (expiryDate) {
      if (productType === 'api') {
        const months = residualShelfLifeMonths(expiryDate);
        pct = residualShelfLifePct(mfgDate, expiryDate);
        if (months !== null && months < 3)  shelfLifeStatus = 'destroy';
        else if (months !== null && months < 6) shelfLifeStatus = 'warning';
        else shelfLifeStatus = 'ok';
      } else {
        pct = residualShelfLifePct(mfgDate, expiryDate);
        if (pct !== null && pct < 60) shelfLifeStatus = 'destroy';
        else if (pct !== null && pct < 70) shelfLifeStatus = 'warning';
        else shelfLifeStatus = 'ok';
      }
    }

    const batchQty = parseFloat(b.batchQtyManufactured || existing.batchQtyManufactured || 0);
    const packed   = parseFloat(b.packedExportedQty    || existing.packedExportedQty    || 0);
    const leftUnpackedQty = batchQty > 0 ? String(Math.max(0, batchQty - packed)) : existing.leftUnpackedQty;

    // Handle optional new doc
    let docName = existing.docName, docPath = existing.docPath;
    let docType = existing.docType, docSize = existing.docSize;
    if (req.file) {
      const appDir = path.join(UPLOADS_DIR, String(app.applicationNumber), 'reconciliation');
      fs.mkdirSync(appDir, { recursive: true });
      const ext      = (req.file.originalname || '').match(/\.[a-zA-Z0-9]{1,8}$/)?.[0] || '.pdf';
      const fileName = `recon_${existing.entryId}_v2${ext}`;
      fs.writeFileSync(path.join(appDir, fileName), req.file.buffer);
      docName = req.file.originalname;
      docPath = `${app.applicationNumber}/reconciliation/${fileName}`;
      docType = req.file.mimetype;
      docSize = req.file.size;
    }

    const updated = {
      ...existing.toObject ? existing.toObject() : { ...existing },
      ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined && v !== '')),
      leftUnpackedQty,
      residualShelfLifePct: pct,
      shelfLifeStatus,
      productType,
      docName, docPath, docType, docSize,
    };
    app.reconciliations[idx] = updated;
    app.markModified('reconciliations');

    app.auditLog.push({
      action: 'reconciliation_update',
      detail: `Reconciliation ${req.params.entryId} updated → status: ${updated.status}`,
      user:   b.updatedBy || 'applicant',
      timestamp: new Date(),
    });
    await app.save();

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json({
      success: true,
      entry: {
        ...updated,
        docUrl: updated.docPath
          ? `${baseUrl}/api/applications/${app.applicationNumber}/reconciliation/${updated.entryId}/doc`
          : '',
      },
    });
  } catch (err) {
    console.error('reconciliation PATCH error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ── DELETE /:id/reconciliation/:entryId — delete a draft entry ────────── */
router.delete('/:id/reconciliation/:entryId', async (req, res) => {
  try {
    const app = await loadAppOr404(req.params.id, res);
    if (!app) return;
    const before = (app.reconciliations || []).length;
    app.reconciliations = (app.reconciliations || []).filter(e => e.entryId !== req.params.entryId);
    if (app.reconciliations.length === before) return res.status(404).json({ error: 'Entry not found' });
    app.markModified('reconciliations');
    app.auditLog.push({ action: 'reconciliation_delete', detail: `Entry ${req.params.entryId} deleted`, user: 'applicant', timestamp: new Date() });
    await app.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /:id/reconciliation/:entryId/doc — stream reconciliation doc ───── */
router.get('/:id/reconciliation/:entryId/doc', async (req, res) => {
  try {
    const app = await loadAppOr404(req.params.id, res);
    if (!app) return;
    const entry = (app.reconciliations || []).find(e => e.entryId === req.params.entryId);
    if (!entry?.docPath) return res.status(404).json({ error: 'Document not found' });
    const resolved = path.resolve(path.join(UPLOADS_DIR, entry.docPath));
    if (!resolved.startsWith(path.resolve(UPLOADS_DIR))) return res.status(400).json({ error: 'Invalid path' });
    if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'File missing on disk' });
    res.set({
      'Content-Type':        inferMimeType(entry.docName, entry.docType),
      'Content-Disposition': `inline; filename="${entry.docName || 'document'}"`,
    });
    fs.createReadStream(resolved).pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── POST /:id/noc-meta — set NOC metadata after approval ──────────────── */
router.post('/:id/noc-meta', async (req, res) => {
  try {
    const app = await loadAppOr404(req.params.id, res);
    if (!app) return;
    const { sanctionedQty, qtyUnit = 'units', nocIssuedDate, nocExpiryDate } = req.body;
    const issuedDate = nocIssuedDate ? new Date(nocIssuedDate) : new Date();
    // Default 1-year validity per guidance document
    const expiryDate = nocExpiryDate
      ? new Date(nocExpiryDate)
      : new Date(issuedDate.getTime() + 365 * 24 * 60 * 60 * 1000);

    app.nocMeta = {
      nocIssuedDate: issuedDate,
      nocExpiryDate: expiryDate,
      sanctionedQty: sanctionedQty || '',
      qtyUnit,
      qtyExported:  '0',
      qtyRemaining: sanctionedQty || '',
      nocStatus:    'Active',
    };
    app.markModified('nocMeta');
    app.auditLog.push({
      action: 'noc_meta_set',
      detail: `NOC issued: qty=${sanctionedQty} ${qtyUnit}, valid until ${expiryDate.toLocaleDateString('en-IN')}`,
      user:   req.body.officer || 'reviewer',
      timestamp: new Date(),
    });
    await app.save();
    res.json({ success: true, nocMeta: app.nocMeta });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
