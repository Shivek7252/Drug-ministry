#!/usr/bin/env node
/* Backfills only audit entries whose legacy reviewer-action text can be parsed
   without guessing. Dry-run by default; pass --apply to write. */
const mongoose = require('mongoose');
const Application = require('../models/Application');
const { parseAuditTransition } = require('../services/transitionEvents');

const APPLY = process.argv.includes('--apply');
const MONGO = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/drug_ministry';

(async () => {
  await mongoose.connect(MONGO);
  const cursor = Application.find({
    auditLog: { $elemMatch: { action: 'reviewer_action', fromStatus: { $exists: false } } },
  }).select('applicationNumber auditLog').cursor();
  let applications = 0;
  let transitions = 0;
  for await (const app of cursor) {
    let changed = false;
    for (const entry of app.auditLog) {
      if (entry.fromStatus || entry.toStatus) continue;
      const parsed = parseAuditTransition(entry);
      if (!parsed || parsed.from === 'UNKNOWN' || parsed.to === 'UNKNOWN') continue;
      entry.applicationId = app._id;
      entry.fromStatus = parsed.from;
      entry.toStatus = parsed.to;
      entry.occurredAt = parsed.at;
      entry.actorId = entry.user ? `legacy:${String(entry.user).toLowerCase()}` : 'legacy:unknown';
      changed = true;
      transitions += 1;
    }
    if (!changed) continue;
    applications += 1;
    if (APPLY) {
      app.markModified('auditLog');
      await app.save();
    }
  }
  console.log(JSON.stringify({
    mode: APPLY ? 'apply' : 'dry-run', applications, transitions,
    note: 'Only reliably parsed reviewer_action entries are included; no events are invented.',
  }, null, 2));
  await mongoose.disconnect();
})().catch(error => { console.error(error); process.exitCode = 1; });
