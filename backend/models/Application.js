const mongoose = require('mongoose');

/* ── Product sub-schema ─────────────────────────────────────────────────── */
const ProductSchema = new mongoose.Schema({
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

/* ── Main Application schema ────────────────────────────────────────────── */
const ApplicationSchema = new mongoose.Schema({
  // Generated identifiers
  applicationNumber: { type: String, unique: true, required: true, index: true },
  referenceNumber:   { type: String, unique: true, required: true, index: true },

  // Status
  status: {
    type: String,
    enum: ['Draft', 'Submitted', 'Under Review', 'Document Verification', 'Compliance Check', 'Approved', 'Rejected'],
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
