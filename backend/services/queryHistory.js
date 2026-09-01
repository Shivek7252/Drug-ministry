const crypto = require('crypto');
const ApplicationQuery = require('../models/ApplicationQuery');

function safeAppPart(applicationNumber) {
  return String(applicationNumber).replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40) || 'APP';
}

function generateQueryIdentifier(applicationNumber, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `AIQ-${safeAppPart(applicationNumber)}-${stamp}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

async function createApplicationQuery(app, values) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const queryIdentifier = generateQueryIdentifier(app.applicationNumber);
    try {
      return await ApplicationQuery.create({
        queryIdentifier,
        application: app._id,
        applicationNumber: app.applicationNumber,
        remarks: values.remarks,
        reviewer: { name: values.officer || 'reviewer', role: 'reviewer' },
        source: values.source || 'application',
        sourceReference: values.sourceReference,
        document: values.document,
        rows: values.rows,
        idempotencyKey: values.idempotencyKey,
        status: values.status || 'Open',
        applicantResponse: values.applicantResponse,
        responseAt: values.responseAt,
        legacyKey: values.legacyKey,
        createdAt: values.createdAt,
      });
    } catch (err) {
      // Only an identifier collision is worth retrying. A duplicate
      // idempotencyKey means this exact submission already landed, so it must
      // surface to the caller rather than being retried into a second record.
      const onIdentifier = err?.code === 11000
        && !String(err?.message || '').includes('idempotencyKey')
        && !err?.keyPattern?.idempotencyKey;
      if (!onIdentifier || attempt === 3) throw err;
    }
  }
  throw new Error('Could not allocate a unique AI Query Identifier.');
}

function deterministicLegacyId(applicationNumber, legacyKey) {
  const hash = crypto.createHash('sha256').update(legacyKey).digest('hex').slice(0, 12).toUpperCase();
  return `AIQ-${safeAppPart(applicationNumber)}-LEGACY-${hash}`;
}

function plain(value) {
  return value?.toObject ? value.toObject() : value;
}

function collectLegacyQueries(app) {
  const applicationNumber = app.applicationNumber;
  const applicationId = String(app._id);
  const records = [];
  const add = (legacyKey, values) => records.push({
    queryIdentifier: deterministicLegacyId(applicationNumber, legacyKey),
    application: app._id,
    applicationNumber,
    legacyKey,
    status: 'Open',
    source: 'legacy',
    ...values,
  });

  (app.reviewerRemarks || []).forEach((raw, index) => {
    const remark = plain(raw);
    if (remark.status !== 'Query Raised' || remark.queryIdentifier || !remark.text) return;
    add(`${applicationId}:reviewer:${index}`, {
      remarks: remark.text,
      reviewer: { name: remark.officer || 'reviewer', role: 'reviewer' },
      sourceReference: 'application',
      createdAt: remark.timestamp || app.updatedAt || app.createdAt,
    });
  });

  const checklistEntries = app.checklistItems?.entries
    ? Array.from(app.checklistItems.entries())
    : Object.entries(app.checklistItems || {});
  checklistEntries.forEach(([itemId, rawItem]) => {
    const item = plain(rawItem);
    (item?.queries || []).forEach((rawRound, index) => {
      const round = plain(rawRound);
      if (round.queryIdentifier || !round.queryText) return;
      add(`${applicationId}:checklist:${itemId}:${round.version || index + 1}`, {
        remarks: round.queryText,
        reviewer: { name: round.queryBy || 'reviewer', role: 'reviewer' },
        sourceReference: `${itemId}:v${round.version || index + 1}`,
        status: round.reply ? 'Responded' : 'Open',
        applicantResponse: round.reply,
        responseAt: round.replyDate,
        createdAt: round.queryDate || app.updatedAt || app.createdAt,
      });
    });
  });

  (app.shipments || []).forEach((rawShipment, shipmentIndex) => {
    const shipment = plain(rawShipment);
    (shipment.lineRemarks || []).forEach((rawRemark, remarkIndex) => {
      const remark = plain(rawRemark);
      if (remark.status !== 'Query' || remark.queryIdentifier || !remark.text) return;
      add(`${applicationId}:shipment:${shipmentIndex}:${remarkIndex}`, {
        remarks: remark.text,
        reviewer: { name: remark.officer || 'reviewer', role: 'reviewer' },
        sourceReference: String(shipmentIndex),
        createdAt: remark.timestamp || app.updatedAt || app.createdAt,
      });
    });
  });

  return records;
}

async function getCompleteQueryHistory(app) {
  const persisted = await ApplicationQuery.find({ application: app._id }).sort({ createdAt: 1 }).lean();
  const persistedKeys = new Set(persisted.map(record => record.legacyKey).filter(Boolean));
  const legacy = collectLegacyQueries(app).filter(record => !persistedKeys.has(record.legacyKey));
  return [...persisted, ...legacy].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

async function queryCountsForApplications(applications) {
  const ids = applications.map(app => app._id);
  if (!ids.length) return new Map();
  const persisted = await ApplicationQuery.find({ application: { $in: ids } })
    .select('application legacyKey')
    .lean();
  const result = new Map();
  const persistedKeys = new Map();
  for (const record of persisted) {
    const id = String(record.application);
    result.set(id, (result.get(id) || 0) + 1);
    if (record.legacyKey) {
      if (!persistedKeys.has(id)) persistedKeys.set(id, new Set());
      persistedKeys.get(id).add(record.legacyKey);
    }
  }
  for (const app of applications) {
    const id = String(app._id);
    const migratedKeys = persistedKeys.get(id) || new Set();
    const legacyCount = collectLegacyQueries(app).filter(record => !migratedKeys.has(record.legacyKey)).length;
    result.set(id, Math.max(result.get(id) || 0, app.queryCount || 0) + legacyCount);
  }
  return result;
}

/* Latest query-raised timestamp per application.
   The Query KPI's week-over-week delta must be measured on when a query was
   RAISED, not on when the application was submitted. Returned as a Map keyed
   by application id so the reviewer list can attach it without a second pass. */
async function latestQueryRaisedAt(applications) {
  const ids = applications.map(app => app._id);
  if (!ids.length) return new Map();
  const rows = await ApplicationQuery.aggregate([
    { $match: { application: { $in: ids } } },
    { $group: { _id: '$application', lastRaisedAt: { $max: '$createdAt' } } },
  ]);
  return new Map(rows.map(r => [String(r._id), r.lastRaisedAt]));
}

module.exports = {
  collectLegacyQueries,
  createApplicationQuery,
  generateQueryIdentifier,
  getCompleteQueryHistory,
  queryCountsForApplications,
  latestQueryRaisedAt,
};
