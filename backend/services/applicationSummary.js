const bannedDrugData = require('../data/bannedDrugs.json');
const { validateProductsApproval } = require('../approvedDrugs');
const { dueAt, REVIEW_SLA_DESCRIPTION } = require('../config/reviewSla');
const { transitionEvents } = require('./transitionEvents');

const DOCUMENT_TYPE_LABELS = Object.freeze({
  irf: 'Integrated Registration Form (IRF)',
  legal: 'Legal undertaking',
  legal_undertaking: 'Legal undertaking',
  mfg_license: 'Manufacturing licence',
  product_approval: 'Product approval certificate',
  export_auth: 'Export authorisation letter',
  qa_cert: 'Quality assurance certificate',
  batch_analysis: 'Batch analysis report',
  product_info: 'Product information sheet',
  historical: 'Historical export NOC data',
  historical_data: 'Historical export NOC data',
  justification: 'Quantity justification',
  nra_cert: 'Importing-country regulatory approval',
  cdsco_approval: 'CDSCO approval in India',
});

const TERMINAL_STATUSES = new Set(['Approved', 'Partially Approved', 'Rejected']);

function plain(value) {
  return value?.toObject ? value.toObject({ flattenMaps: true }) : value;
}

function safeText(value) {
  return value == null ? '' : String(value).trim();
}

function documentTypeLabel(code) {
  const raw = safeText(code);
  if (DOCUMENT_TYPE_LABELS[raw]) return { label: DOCUMENT_TYPE_LABELS[raw], known: true };
  const prefix = raw.replace(/_[A-Z].*$/, '');
  if (DOCUMENT_TYPE_LABELS[prefix]) return { label: DOCUMENT_TYPE_LABELS[prefix], known: true };
  return { label: 'Other document', known: false };
}

function flattenChecklist(checklist = {}) {
  const rows = [];
  const seen = new Set();
  const add = row => {
    if (!row || seen.has(row.itemId)) return;
    seen.add(row.itemId);
    rows.push(row);
  };
  (checklist.preItems || checklist.preSection4 || []).forEach(add);
  (checklist.mfgLicenseSection?.companies || []).forEach(add);
  add(checklist.historicalItem);
  (checklist.approvalSection?.countries || checklist.section4?.countries || [])
    .forEach(country => (country.subItems || []).forEach(add));
  (checklist.postItems || checklist.postSection4 || []).forEach(add);
  return rows;
}

function verificationIsInconclusive(result = {}) {
  const text = `${result.documentTypeReason || ''} ${result.error || ''}`.toLowerCase();
  return !result.documentTypeMatch
    ? false
    : /could not|unavailable|skipped|unable|unknown|configure|manual|not extract/.test(text);
}

function requirementState(row) {
  if (row.notApplicable === true) return 'not_applicable';
  if (!row.matchedDoc) return 'missing';
  if (row.matchedDoc.matchType === 'fuzzy') return 'needs_review';
  const result = row.matchedDoc.validationResult || {};
  if (result.documentTypeMatch === false) return 'needs_review';
  if (result.documentTypeMatch === true && !verificationIsInconclusive(result)) return 'available';
  if (result.error) return 'unable';
  return 'pending';
}

const REQUIREMENT_STATE = {
  available: ['Available', 'A matching file has affirmative verification evidence.'],
  missing: ['Missing', 'No uploaded file is linked to this requirement.'],
  needs_review: ['Needs review', 'The file match or verification result needs reviewer confirmation.'],
  pending: ['Verification pending', 'A file is present, but affirmative verification evidence is not available yet.'],
  unable: ['Unable to verify', 'The verification service could not produce a reliable result.'],
  not_applicable: ['Not applicable', 'This requirement does not apply to the current application.'],
};

function buildRequirements(checklist) {
  return flattenChecklist(checklist).map(row => {
    const state = requirementState(row);
    const [statusLabel, defaultExplanation] = REQUIREMENT_STATE[state];
    const result = row.matchedDoc?.validationResult || {};
    return {
      id: row.itemId,
      number: safeText(row.itemNo),
      name: safeText(row.title) || 'Unnamed requirement',
      context: safeText(row.company || row.country),
      state,
      statusLabel,
      explanation: safeText(result.documentTypeReason) || defaultExplanation,
      matchedDocument: row.matchedDoc ? {
        id: row.matchedDoc.slot,
        name: safeText(row.matchedDoc.name) || 'Uploaded document',
        url: row.matchedDoc.objectUrl || '',
      } : null,
    };
  });
}

function buildProgress(requirements, checklistAvailable = true) {
  if (!checklistAvailable || requirements.length === 0) {
    return { available: false, completed: null, total: null, percent: null, text: 'Requirement progress unavailable.' };
  }
  const applicable = requirements.filter(item => item.state !== 'not_applicable');
  if (applicable.length === 0) {
    return { available: false, completed: null, total: null, percent: null, text: 'Requirement progress unavailable.' };
  }
  const completed = applicable.filter(item => item.state === 'available').length;
  const total = applicable.length;
  return {
    available: true,
    completed,
    total,
    percent: Math.round((completed / total) * 100),
    text: `${completed} of ${total} applicable requirements have affirmative completion evidence.`,
  };
}

function buildDocuments(app, baseUrl) {
  const entries = app.documents?.entries
    ? Array.from(app.documents.entries())
    : Object.entries(app.documents || {});
  return entries.map(([id, raw]) => {
    const doc = plain(raw) || {};
    const result = doc.validationResult || {};
    const type = documentTypeLabel(id);
    let state = 'pending';
    let statusLabel = 'Verification pending';
    if (result.documentTypeMatch === false) {
      state = 'needs_review'; statusLabel = 'Needs review';
    } else if (result.documentTypeMatch === true && !verificationIsInconclusive(result)) {
      state = 'verified'; statusLabel = 'Verified';
    } else if (result.error) {
      state = 'unable'; statusLabel = 'Unable to verify';
    }
    return {
      id,
      typeLabel: type.label,
      unknownType: !type.known,
      originalTypeCode: type.known ? '' : id,
      name: safeText(doc.name) || 'Uploaded document',
      size: Number.isFinite(Number(doc.size)) ? Number(doc.size) : null,
      mimeType: safeText(doc.type),
      uploadedAt: doc.uploadedAt || null,
      state,
      statusLabel,
      explanation: safeText(result.documentTypeReason) || (state === 'pending'
        ? 'This file has not produced an affirmative verification result.'
        : ''),
      verifiedAt: state === 'verified' ? (result.verifiedAt || null) : null,
      checkedAt: result.verifiedAt || null,
      url: (doc.path || doc.data)
        ? `${baseUrl}/api/applications/${encodeURIComponent(app.applicationNumber)}/document/${encodeURIComponent(id)}`
        : '',
    };
  });
}

function normalizeMedicine(value) {
  return safeText(value).toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function termAppears(text, term) {
  const t = normalizeMedicine(term);
  return t.length >= 3 && (` ${text} `).includes(` ${t} `);
}

function specificBannedMatch(name) {
  const text = normalizeMedicine(name);
  if (!text) return null;
  for (const entry of bannedDrugData.entries || []) {
    const terms = (entry.terms || []).map(normalizeMedicine).filter(Boolean);
    if (!terms.length) continue;
    const matched = entry.type === 'fdc' || entry.type === 'rule'
      ? terms.length >= 2 && terms.every(term => termAppears(text, term))
      : terms.some(term => termAppears(text, term));
    if (matched) return {
      name: entry.name,
      notification: entry.notification || '',
      status: entry.status || 'prohibited',
    };
  }
  return null;
}

function buildMedicineChecks(products = []) {
  const approvals = validateProductsApproval(products).results || [];
  const manualClassRuleCount = (bannedDrugData.entries || [])
    .filter(entry => entry.type === 'rule' && !(entry.terms || []).filter(Boolean).length).length;
  return products.map((raw, index) => {
    const product = plain(raw) || {};
    const medicineName = safeText(product.genericName || product.productName);
    const banned = specificBannedMatch(medicineName);
    const approval = approvals[index] || {};
    return {
      productRef: product.productRef || String(index),
      productName: safeText(product.productName) || `Product ${index + 1}`,
      genericName: safeText(product.genericName),
      approval: approval.approved ? {
        state: 'matched', label: 'Found in approved-drug reference',
        matchedName: approval.matchedName, approvalDate: approval.approvalDate,
      } : {
        state: 'not_found', label: 'Not found in approved-drug reference',
        matchedName: '', approvalDate: null,
      },
      prohibition: banned ? {
        state: 'specific_match', label: 'Specific prohibited-drug match', ...banned,
      } : {
        state: manualClassRuleCount ? 'manual_class_review' : 'no_specific_match',
        label: manualClassRuleCount
          ? 'No specific name match; manual class-based review required'
          : 'No specific prohibited-drug name match',
        manualClassRuleCount,
      },
    };
  });
}

function buildDestinations(app) {
  const companies = new Map((app.companies || []).map(c => [c.companyRef, plain(c)]));
  const products = new Map((app.products || []).map(p => [p.productRef, plain(p)]));
  const shipmentsByConsignee = new Map();
  (app.shipments || []).forEach((raw, index) => {
    const shipment = plain(raw) || {};
    const rows = shipmentsByConsignee.get(shipment.consigneeRef) || [];
    rows.push({
      id: String(index),
      product: products.get(shipment.productRef)?.productName || 'Product not linked',
      manufacturer: companies.get(shipment.companyRef)?.name || 'Manufacturer not linked',
      quantity: shipment.quantity ?? null,
      packSize: safeText(shipment.packSize),
      batches: shipment.batchNumbers || [],
      status: shipment.lineStatus || 'Pending',
    });
    shipmentsByConsignee.set(shipment.consigneeRef, rows);
  });
  const consignees = (app.consignees || []).map((raw, index) => {
    const c = plain(raw) || {};
    return {
      id: c.consigneeRef || String(index),
      country: safeText(c.country) || safeText(app.destinationCountry) || 'Destination unavailable',
      consignee: safeText(c.organisation || c.name),
      contact: safeText(c.contactPerson),
      address: [c.addressLine1, c.addressLine2, c.city, c.state, c.postalCode].map(safeText).filter(Boolean).join(', '),
      shipments: shipmentsByConsignee.get(c.consigneeRef) || [],
    };
  });
  if (!consignees.length && (app.destinationCountry || app.consigneeCountry)) {
    consignees.push({
      id: 'legacy', country: app.destinationCountry || app.consigneeCountry,
      consignee: app.consigneeOrg || app.consigneeName || '', contact: app.contactPerson || '',
      address: [app.addressLine1, app.addressLine2, app.city, app.state, app.postalCode].map(safeText).filter(Boolean).join(', '),
      shipments: shipmentsByConsignee.get(undefined) || [],
    });
  }
  return consignees;
}

function buildIssues(requirements, medicineChecks) {
  const issues = [];
  requirements.forEach(item => {
    if (item.state === 'available' || item.state === 'not_applicable') return;
    const severity = item.state === 'missing' || item.state === 'needs_review' ? 'high' : 'medium';
    issues.push({
      id: `requirement-${item.id}`,
      severity,
      title: `${item.statusLabel}: ${item.name}`,
      explanation: item.explanation,
      action: item.state === 'missing' ? 'Request the required document or confirm that it is not applicable.' : 'Review the linked document and record a decision.',
      section: 'docs',
    });
  });
  medicineChecks.forEach(check => {
    if (check.prohibition.state === 'specific_match') {
      issues.push({ id: `medicine-${check.productRef}`, severity: 'high', title: `Prohibited-drug match: ${check.productName}`, explanation: check.prohibition.name, action: 'Review the cited notification before making a decision.', section: 'details' });
    } else if (check.approval.state === 'not_found') {
      issues.push({ id: `approval-${check.productRef}`, severity: 'medium', title: `Approval reference not found: ${check.productName}`, explanation: 'The submitted generic name was not found in the configured approved-drug reference.', action: 'Confirm the name and review supporting approval documents.', section: 'details' });
    }
  });
  return issues;
}

function buildExecutive(progress, requirements, issues, workflowStatus) {
  const pending = requirements.some(item => item.state === 'pending' || item.state === 'unable');
  const blocking = issues.some(issue => issue.severity === 'high');
  let state = 'ready';
  let label = 'Ready for reviewer decision';
  let explanation = 'All applicable requirements have affirmative completion evidence. The reviewer must still make the workflow decision.';
  if (!progress.available) {
    state = 'unavailable'; label = 'Unable to verify';
    explanation = 'A reliable applicable-requirement set is not available, so completion cannot be calculated.';
  } else if (blocking) {
    state = 'attention'; label = 'Needs attention';
    explanation = 'One or more required items are missing or need reviewer confirmation.';
  } else if (pending) {
    state = 'verifying'; label = 'Verification in progress';
    explanation = 'Files are present, but one or more verification results are pending or inconclusive.';
  } else if (progress.completed < progress.total) {
    state = 'attention'; label = 'Needs attention';
    explanation = 'Not every applicable requirement has affirmative completion evidence.';
  }
  const nextAction = state === 'ready'
    ? (TERMINAL_STATUSES.has(workflowStatus) ? 'Review the recorded decision and supporting history.' : 'Review the evidence and record the application decision.')
    : state === 'verifying' ? 'Complete or manually confirm pending document checks.'
      : state === 'attention' ? 'Resolve the highest-priority issue before recording a decision.'
        : 'Review the application manually because requirement progress is unavailable.';
  return { state, label, explanation, progress, nextAction };
}

function buildQueries(queries = []) {
  return queries.map(q => ({
    id: q.queryIdentifier || String(q._id || ''),
    status: q.status || 'Open',
    raisedAt: q.createdAt || null,
    raisedBy: q.reviewer?.name || 'Reviewer',
    subject: q.sourceReference || q.source || 'Application',
    question: safeText(q.remarks),
    response: safeText(q.applicantResponse),
    respondedAt: q.responseAt || null,
  }));
}

function buildTimeline(app, queries) {
  const events = [];
  if (app.submittedAt || app.createdAt) events.push({
    id: 'submitted', at: app.submittedAt || app.createdAt, type: 'submission',
    title: 'Application submitted', detail: safeText(app.submittedBy),
  });
  transitionEvents(app, queries).forEach((event, index) => {
    const title = event.kind === 'queryRaised' ? 'Query raised'
      : event.kind === 'queryResolved' ? 'Query response received'
        : event.to ? `Status changed to ${String(event.to).replaceAll('_', ' ').toLowerCase().replace(/^./, c => c.toUpperCase())}` : 'Workflow updated';
    events.push({ id: `transition-${index}`, at: event.at, type: event.kind || 'status', title, detail: event.derived ? 'Recorded from application decision timestamp.' : '' });
  });
  return events.sort((a, b) => new Date(b.at) - new Date(a.at));
}

function buildApplicationSummary({ app: rawApp, checklist, queries = [], baseUrl = '' }) {
  const app = plain(rawApp) || {};
  const requirements = buildRequirements(checklist || {});
  const progress = buildProgress(requirements, Boolean(checklist));
  const medicineChecks = buildMedicineChecks(app.products || []);
  const issues = buildIssues(requirements, medicineChecks);
  const deadline = dueAt(app);
  const submittedAt = app.submittedAt || app.createdAt || null;
  const ageDays = submittedAt ? Math.max(0, Math.floor((Date.now() - new Date(submittedAt).getTime()) / 86400000)) : null;
  const queryHistory = buildQueries(queries);
  const decisions = buildTimeline(app, queries).filter(event => /status changed|decision/i.test(event.title));
  return {
    generatedAt: new Date().toISOString(),
    application: {
      applicationNumber: app.applicationNumber,
      referenceNumber: app.referenceNumber,
      workflowStatus: app.status,
      applicant: {
        name: safeText(app.applicantName), organisation: safeText(app.applicantOrganization),
        email: safeText(app.email), phone: safeText(app.contactNumber), state: safeText(app.state),
      },
      overview: {
        applicationType: safeText(app.applicationType), category: safeText(app.exportCategory),
        purpose: safeText(app.exportPurpose), submittedAt, ageDays,
        configuredTargetDate: deadline, targetIsOverdue: deadline ? Date.now() > deadline.getTime() && !TERMINAL_STATUSES.has(app.status) : false,
        targetDefinition: REVIEW_SLA_DESCRIPTION,
        workflow: { code: checklist?.type || '', label: checklist?.typeLabel || 'Application workflow unavailable' },
      },
      manufacturers: (app.companies || []).map((raw, index) => {
        const c = plain(raw) || {};
        return { id: c.companyRef || String(index), name: safeText(c.name), licenceNumber: safeText(c.licenseNo), site: safeText(c.manufacturingSite || c.factoryAddress), signatory: safeText(c.signatoryName), signatoryRole: safeText(c.signatoryDesignation) };
      }),
      products: (app.products || []).map((raw, index) => {
        const p = plain(raw) || {};
        return { id: p.productRef || String(index), name: safeText(p.productName), genericName: safeText(p.genericName), brandName: safeText(p.brandName), dosage: [p.strength, p.dosageForm].map(safeText).filter(Boolean).join(' · '), packSize: safeText(p.packSize), batchNumber: safeText(p.batchNumber), manufacturingDate: p.mfgDate || null, expiryDate: p.expiryDate || null };
      }),
      destinations: buildDestinations(app),
    },
    executive: buildExecutive(progress, requirements, issues, app.status),
    issues,
    medicineChecks,
    requirements,
    documents: buildDocuments(app, baseUrl),
    queries: queryHistory,
    decisions,
    timeline: buildTimeline(app, queries),
    availability: {
      checklist: Boolean(checklist && requirements.length),
      documents: Boolean(app.documents && (app.documents.size || Object.keys(app.documents || {}).length)),
      queries: true,
      medicineChecks: (app.products || []).length > 0,
    },
  };
}

module.exports = {
  DOCUMENT_TYPE_LABELS,
  buildApplicationSummary,
  buildDocuments,
  buildMedicineChecks,
  buildProgress,
  buildRequirements,
  documentTypeLabel,
  flattenChecklist,
  requirementState,
  specificBannedMatch,
  verificationIsInconclusive,
};
