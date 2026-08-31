#!/usr/bin/env node
/* ============================================================================
   Invalid reference-data report — DRY RUN BY DEFAULT.

   Finds applications whose destinationCountry / consignee country /
   exportCategory are not resolvable against the canonical lists, reports what
   a cleanup WOULD do, and writes nothing unless --apply is passed with an
   explicit --map for every value it is asked to change.

   There is no automatic correction. "X" and "Y" carry no information about
   what the applicant meant, so guessing would fabricate regulatory data. The
   only safe automated action is to report; a human maps each value.

     node scripts/invalid-data-report.js                 # dry run, all records
     node scripts/invalid-data-report.js --json          # machine readable
     node scripts/invalid-data-report.js --apply --map "X=India" --map "Y=Vaccines"

   --apply is idempotent: records already carrying the canonical value are
   skipped, so a rerun changes nothing.
   ============================================================================ */

const mongoose = require('mongoose');
const { resolveCountry } = require('../services/countryValidation');
const { resolveCategory } = require('../services/categoryValidation');

const MONGO = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/drug_ministry';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const AS_JSON = args.includes('--json');
const MAP = new Map();
args.forEach((a, i) => {
  if (a === '--map' && args[i + 1]) {
    const [from, ...rest] = args[i + 1].split('=');
    if (from && rest.length) MAP.set(from.trim(), rest.join('=').trim());
  }
});

function scan(app) {
  const issues = [];
  if (app.destinationCountry && !resolveCountry(app.destinationCountry)) {
    issues.push({ field: 'destinationCountry', value: app.destinationCountry, kind: 'country' });
  }
  if (app.consigneeCountry && !resolveCountry(app.consigneeCountry)) {
    issues.push({ field: 'consigneeCountry', value: app.consigneeCountry, kind: 'country' });
  }
  (app.consignees || []).forEach((c, i) => {
    if (c && c.country && !resolveCountry(c.country)) {
      issues.push({ field: `consignees.${i}.country`, value: c.country, kind: 'country' });
    }
  });
  if (app.exportCategory && !resolveCategory(app.exportCategory)) {
    issues.push({ field: 'exportCategory', value: app.exportCategory, kind: 'category' });
  }
  return issues;
}

(async () => {
  await mongoose.connect(MONGO);
  const col = mongoose.connection.db.collection('applications');
  const apps = await col.find({}).toArray();

  const findings = [];
  for (const app of apps) {
    const issues = scan(app);
    if (issues.length) {
      findings.push({
        applicationNumber: app.applicationNumber,
        _id: String(app._id),
        status: app.status,
        isDraft: !!app.isDraft,
        email: app.email,
        submittedAt: app.submittedAt ? app.submittedAt.toISOString() : null,
        issues,
      });
    }
  }

  const distinct = new Map();
  for (const f of findings) {
    for (const i of f.issues) {
      const key = `${i.kind}:${i.value}`;
      const row = distinct.get(key) || { kind: i.kind, value: i.value, count: 0, applications: [] };
      row.count += 1;
      if (!row.applications.includes(f.applicationNumber)) row.applications.push(f.applicationNumber);
      distinct.set(key, row);
    }
  }

  const plan = [...distinct.values()].map(d => ({
    ...d,
    proposedValue: MAP.get(d.value) || null,
    action: MAP.has(d.value) ? 'rewrite' : 'NO MAPPING — leave unchanged, needs a human decision',
  }));

  if (AS_JSON) {
    console.log(JSON.stringify({
      mode: APPLY ? 'apply' : 'dry-run',
      scanned: apps.length,
      affected: findings.length,
      distinctValues: plan,
      findings,
    }, null, 2));
  } else {
    console.log(`\n  Mode          : ${APPLY ? 'APPLY' : 'DRY RUN (nothing will be written)'}`);
    console.log(`  Scanned       : ${apps.length} applications`);
    console.log(`  Affected      : ${findings.length}\n`);
    if (!findings.length) console.log('  No invalid country or category values found.\n');
    for (const f of findings) {
      console.log(`  ${f.applicationNumber}  [${f.status}]  ${f.email || ''}`);
      console.log(`      _id ${f._id}   submitted ${f.submittedAt || 'n/a'}`);
      for (const i of f.issues) console.log(`      ✗ ${i.field} = ${JSON.stringify(i.value)}  (${i.kind})`);
    }
    console.log('\n  Distinct invalid values and proposed action:');
    for (const p of plan) {
      console.log(`    ${p.kind.padEnd(9)} ${JSON.stringify(p.value).padEnd(6)} `
        + `x${String(p.count).padEnd(3)} -> ${p.proposedValue ? JSON.stringify(p.proposedValue) : p.action}`);
      console.log(`              applications: ${p.applications.join(', ')}`);
    }
    console.log('');
  }

  if (APPLY) {
    const mappable = plan.filter(p => p.proposedValue);
    if (!mappable.length) {
      console.log('  --apply given but no --map supplied. Nothing written.\n');
    }
    let changed = 0;
    for (const f of findings) {
      for (const i of f.issues) {
        const target = MAP.get(i.value);
        if (!target) continue;
        const canonical = i.kind === 'country'
          ? resolveCountry(target)?.name : resolveCategory(target);
        if (!canonical) {
          console.log(`  refusing: "${target}" is not itself a valid ${i.kind}.`);
          continue;
        }
        /* Idempotent: only writes when the stored value is still the bad one. */
        const r = await col.updateOne(
          { _id: new mongoose.Types.ObjectId(f._id), [i.field]: i.value },
          { $set: { [i.field]: canonical } },
        );
        if (r.modifiedCount) {
          changed += 1;
          console.log(`  ${f.applicationNumber} ${i.field}: ${JSON.stringify(i.value)} -> ${JSON.stringify(canonical)}`);
        }
      }
    }
    console.log(`\n  Records changed: ${changed}\n`);
  }

  await mongoose.disconnect();
})().catch(err => { console.error(err); process.exit(1); });
