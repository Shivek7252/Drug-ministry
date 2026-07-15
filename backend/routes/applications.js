const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const Application = require('../models/Application');

/* ── Uploads root (PDF binaries live here, NOT in MongoDB) ───────────────── */
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

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
        'Content-Type':        doc.type || 'application/octet-stream',
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
        'Content-Type':        doc.type || 'application/octet-stream',
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

// Need mongoose for ObjectId check above
const mongoose = require('mongoose');

module.exports = router;
