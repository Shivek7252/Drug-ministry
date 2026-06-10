const express = require('express');
const router = express.Router();
const Application = require('../models/Application');

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
      assignDocuments(app, documents);
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
    assignDocuments(newApp, documents);
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
      assignDocuments(app, documents);
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
    assignDocuments(newApp, documents);
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
    if (!doc || !doc.data) return res.status(404).json({ error: 'Document file not stored' });

    // doc.data is a data URL ("data:<mime>;base64,...") or bare base64
    let b64 = String(doc.data);
    const comma = b64.indexOf(',');
    if (b64.startsWith('data:') && comma >= 0) b64 = b64.slice(comma + 1);

    const buf = Buffer.from(b64, 'base64');
    res.set({
      'Content-Type':        doc.type || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${doc.name || 'document'}"`,
      'Content-Length':      buf.length,
    });
    res.send(buf);
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
          objectUrl: v.data ? `${baseUrl}/api/applications/${obj.applicationNumber}/document/${k}` : '',
        };
      }
      obj.documents = docsOut;
    }
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
          objectUrl: v.data ? `${baseUrl}/api/applications/${obj.applicationNumber}/document/${k}` : '',
        };
      }
      obj.documents = docsOut;
    }
    res.json({ success: true, application: obj });
  } catch (err) {
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
