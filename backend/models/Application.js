const mongoose = require('mongoose');

/* ── Product sub-schema ─────────────────────────────────────────────────── */
const ProductSchema = new mongoose.Schema({
  productRef:   String,    // uuid used by shipments[]
  productName:  String,
  genericName:  String,
  brandName:    String,
  dosageForm:   String,
  strength:     String,
  packSize:     String,
  batchNumber:  String,
  mfgDate:      String,
  expiryDate:   String,
}, { _id: false });

/* ── Company / Manufacturer sub-schema (one row per exporting site) ─────── */
const CompanySchema = new mongoose.Schema({
  companyRef:           String,   // uuid used by shipments[]
  name:                 String,
  licenseNo:            String,
  factoryAddress:       String,
  manufacturingSite:    String,
  contactPerson:        String,
  contactNumber:        String,
  email:                String,
  signatoryName:        String,
  signatoryDesignation: String,
}, { _id: false });

/* ── Consignee sub-schema (one row per importing party / destination) ───── */
const ConsigneeSchema = new mongoose.Schema({
  consigneeRef: String,   // uuid used by shipments[]
  name:         String,
  organisation: String,
  addressLine1: String,
  addressLine2: String,
  city:         String,
  state:        String,
  country:      String,
  postalCode:   String,
  contactPerson:String,
  phone:        String,
  email:        String,
}, { _id: false });

/* ── Shipment (line item) sub-schema ────────────────────────────────────── */
const ShipmentSchema = new mongoose.Schema({
  companyRef:   String,
  productRef:   String,
  consigneeRef: String,
  quantity:     Number,
  packSize:     String,
  batchNumbers: [String],
  // Per-line reviewer state
  lineStatus:   {
    type: String,
    enum: ['Pending', 'Verified', 'Query', 'Approved', 'Rejected'],
    default: 'Pending',
  },
  lineRemarks: [{
    text:      String,
    officer:   String,
    status:    String,
    timestamp: { type: Date, default: Date.now },
  }],
}, { _id: false });

/* ── Document sub-schema ────────────────────────────────────────────────── */
const DocumentSchema = new mongoose.Schema({
  name:       String,
  size:       Number,
  type:       String,
  uploadedAt: String,
  // Large files are stored on disk (relative path under backend/uploads/).
  // `data` (base64) is kept only for tiny legacy docs; prefer `path`.
  path:       String,
  data:       String,
  // validation metadata
  validated:  { type: Boolean, default: false },
  validationResult: mongoose.Schema.Types.Mixed,
}, { _id: false });

/* ── Audit log entry ────────────────────────────────────────────────────── */
const AuditSchema = new mongoose.Schema({
  action:    { type: String, required: true },
  detail:    String,
  timestamp: { type: Date, default: Date.now },
  user:      String,
}, { _id: false });

/* ── Checklist query round (one entry per version, max 5) ──────────────── */
const ChecklistQuerySchema = new mongoose.Schema({
  version:      Number,          // 1..5
  queryText:    String,
  queryDate:    { type: Date, default: Date.now },
  queryBy:      String,          // reviewer/officer name
  reply:        String,          // applicant reply text
  replyDate:    Date,
  replyDocName: String,          // original filename of applicant's uploaded doc, if any
  replyDocPath: String,          // relative path under uploads/, if any
  replyDocType: String,
  replyDocSize: Number,
}, { _id: false });

/* ── Checklist item state (per checklist row shown to reviewer/applicant) ── */
const ChecklistItemSchema = new mongoose.Schema({
  itemId:         String,        // canonical id, e.g. 'irf', 'legal', 'mfg_license', 'noc_approval_1_Benin', 'noc_mfg_license_CompanyA'
  itemNo:         String,        // display number, e.g. '1', '3.1', '5.1.1'
  title:          String,        // display label
  country:        String,        // populated for approval-status country rows (Type 1/2/3/4)
  company:        String,        // populated for Type-4 per-company manufacturing-license rows
  parentGroup:    String,        // e.g. 'approval_status', 'mfg_license'
  submissionRemark: String,      // "At Time Of Submission" remark from applicant
  submissionDocName: String,
  submissionDocPath: String,     // usually mirrors the existing document upload path
  baseQuery:      String,        // "Base Query/Remarks" — the very first query text
  previousQuery:  String,        // "Previous Query/Remarks" — last-1 exchange snapshot
  status: {
    type: String,
    enum: ['OK', 'Query', 'Query Replied OK'],
    default: 'OK',
  },
  queries: [ChecklistQuerySchema],
}, { _id: false });

/* ── Main Application schema ────────────────────────────────────────────── */
const ApplicationSchema = new mongoose.Schema({
  // Generated identifiers
  applicationNumber: { type: String, unique: true, required: true, index: true },
  referenceNumber:   { type: String, unique: true, required: true, index: true },

  // Status (rollup of shipments[].lineStatus for new-style apps)
  status: {
    type: String,
    enum: ['Draft', 'Submitted', 'Under Review', 'Document Verification', 'Compliance Check', 'Query Raised', 'Approved', 'Partially Approved', 'Rejected'],
    default: 'Draft',
    index: true,
  },

  // Applicant
  applicationType:       String,
  exportPurpose:         String,
  exportCategory:        String,
  destinationCountry:    String,
  applicationDate:       String,
  applicantName:         String,
  applicantOrganization: String,
  contactNumber:         String,
  email:                 String,

  // Consignee
  consigneeName:    String,
  consigneeOrg:     String,
  addressLine1:     String,
  addressLine2:     String,
  city:             String,
  state:            String,
  consigneeCountry: String,
  postalCode:       String,
  contactPerson:    String,
  consigneePhone:   String,
  consigneeEmail:   String,

  // Products
  products: [ProductSchema],

  // NEW multi-row arrays (Phase 1 — legacy single-value fields above still populated for back-compat)
  companies:  [CompanySchema],
  consignees: [ConsigneeSchema],
  shipments:  [ShipmentSchema],

  // Manufacturer
  manufacturerName:    String,
  mfgLicenseNo:        String,
  factoryAddress:      String,
  manufacturingSite:   String,
  mfgContactPerson:    String,
  mfgContactNumber:    String,
  mfgEmail:            String,
  signatoryName:       String,
  signatoryDesignation:String,

  // Documents (keyed object: docId → document metadata + data)
  documents: {
    type:    Map,
    of:      DocumentSchema,
    default: {},
  },

  // Declarations
  declarations: {
    productInfoAccurate: { type: Boolean, default: false },
    documentsGenuine:    { type: Boolean, default: false },
    exportRegulations:   { type: Boolean, default: false },
    drugComplies:        { type: Boolean, default: false },
    finalDeclaration:    { type: Boolean, default: false },
  },

  // Metadata
  submittedAt:  Date,
  lastSavedAt:  { type: Date, default: Date.now },
  submittedBy:  String,
  isDraft:      { type: Boolean, default: true },

  // Audit trail
  auditLog: [AuditSchema],

  // Reviewer remarks
  reviewerRemarks: [{
    text:      String,
    officer:   String,
    status:    String,
    timestamp: { type: Date, default: Date.now },
  }],

  // Export NOC Check-List Query state (per item; section 4 has one item per destination country)
  checklistItems: {
    type:    Map,
    of:      ChecklistItemSchema,
    default: {},
  },

}, {
  timestamps: true,   // adds createdAt + updatedAt
  strict: false,      // allow extra fields
});

/* ── Text index for full-text search ─────────────────────────────────────── */
ApplicationSchema.index({
  applicationNumber:   'text',
  referenceNumber:     'text',
  applicantName:       'text',
  applicantOrganization:'text',
  destinationCountry:  'text',
  mfgLicenseNo:        'text',
});

module.exports = mongoose.model('Application', ApplicationSchema);
