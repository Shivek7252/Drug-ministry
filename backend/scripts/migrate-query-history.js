require('dotenv').config();
const mongoose = require('mongoose');
const Application = require('../models/Application');
const ApplicationQuery = require('../models/ApplicationQuery');
const { collectLegacyQueries } = require('../services/queryHistory');

function lastStatusDate(app, status) {
  const remarkDates = (app.reviewerRemarks || [])
    .filter(remark => remark.status === status && remark.timestamp)
    .map(remark => new Date(remark.timestamp));
  const auditDates = (app.auditLog || [])
    .filter(entry => entry.timestamp && String(entry.detail || '').includes(`→ ${status}`))
    .map(entry => new Date(entry.timestamp));
  return [...remarkDates, ...auditDates].sort((a, b) => b - a)[0] || null;
}

async function migrateQueryHistory() {
  await ApplicationQuery.createIndexes();
  let applications = 0;
  let queries = 0;
  const cursor = Application.find({}).cursor();
  for await (const app of cursor) {
    applications += 1;
    for (const record of collectLegacyQueries(app)) {
      const result = await ApplicationQuery.updateOne(
        { legacyKey: record.legacyKey },
        { $setOnInsert: record },
        { upsert: true },
      );
      if (result.upsertedCount) queries += 1;
    }

    const queryCount = await ApplicationQuery.countDocuments({ application: app._id });
    const approvedAt = app.approvedAt || lastStatusDate(app, 'Approved');
    const rejectedAt = app.rejectedAt || lastStatusDate(app, 'Rejected');
    await Application.updateOne(
      { _id: app._id },
      { $set: { queryCount, ...(approvedAt && { approvedAt }), ...(rejectedAt && { rejectedAt }) } },
    );
  }
  return { applications, queries };
}

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/drug_ministry';
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  try {
    const result = await migrateQueryHistory();
    console.log(`Query-history migration complete: ${result.applications} applications scanned, ${result.queries} records added.`);
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error(`Query-history migration failed: ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = { migrateQueryHistory };
