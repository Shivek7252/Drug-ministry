#!/usr/bin/env node
/* Read-only reconciliation helper. It never writes or deletes records. */
const mongoose = require('mongoose');

const MONGO = process.env.MONGODB_URI || 'mongodb://localhost:27017/drug_ministry';

(async () => {
  await mongoose.connect(MONGO);
  const db = mongoose.connection.db;
  const apps = db.collection('applications');
  const byStatus = await apps.aggregate([
    { $match: { isDraft: false } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]).toArray();
  const leftovers = await apps.find({
    $or: [{ submittedBy: 'itest' }, { email: /^itest\+/i }],
  }).project({ applicationNumber: 1 }).toArray();
  const invalid = await apps.countDocuments({
    $or: [{ destinationCountry: 'X' }, { exportCategory: 'Y' }],
  });
  const indexes = await apps.indexes();
  console.log(JSON.stringify({
    database: mongoose.connection.name,
    submittedTotal: byStatus.reduce((sum, row) => sum + row.count, 0),
    byStatus,
    leftoverTestRecords: leftovers.length,
    invalidDiagnosticRecords: invalid,
    applicationIndexes: indexes.map(index => index.name),
  }, null, 2));
  await mongoose.disconnect();
})().catch(error => { console.error(error); process.exitCode = 1; });
