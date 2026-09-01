const mongoose = require('mongoose');

/* ── One row of a structured document query ──────────────────────────────
   The rows are the primary representation; `remarks` on the parent record is
   derived from them so legacy readers keep working. */
const QueryRowSchema = new mongoose.Schema({
  order:         { type: Number, required: true },
  checklistItem: String,          // requirement or detected issue
  deficiency:    String,          // AI evidence / detected deficiency
  aiQueryText:   String,          // original AI-generated text (blank when reviewer-added)
  queryText:     { type: String, required: true },  // final, reviewer-confirmed text
  edited:        { type: Boolean, default: false }, // AI text changed by the reviewer
  rowSource:     { type: String, enum: ['ai_generated', 'reviewer_added'], default: 'ai_generated' },
  findingRef:    String,          // 'document-type' | 'check:<index>'
}, { _id: false });

const ApplicationQuerySchema = new mongoose.Schema({
  queryIdentifier: {
    type: String,
    required: true,
    unique: true,
    index: true,
    trim: true,
  },
  application: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Application',
    required: true,
    index: true,
  },
  applicationNumber: { type: String, required: true, index: true },
  remarks: { type: String, required: true, trim: true },
  reviewer: {
    name: { type: String, required: true, default: 'reviewer' },
    role: { type: String, default: 'reviewer' },
  },
  source: {
    type: String,
    enum: ['application', 'shipment', 'checklist', 'document', 'legacy'],
    default: 'application',
  },
  sourceReference: String,

  /* Document-scoped queries. `docId` is the stable document key — never the
     filename or label — so a query can never re-attach to a different upload
     that happens to share a name or type. */
  document: {
    docId:        { type: String, index: true },
    expectedType: String,
    fileName:     String,
  },
  rows: { type: [QueryRowSchema], default: undefined },

  /* Per-submission key. A retried click or a network replay resolves to the
     same record instead of raising the query twice. */
  idempotencyKey: { type: String, unique: true, sparse: true, index: true },
  status: {
    type: String,
    enum: ['Open', 'Responded', 'Closed'],
    default: 'Open',
    index: true,
  },
  applicantResponse: String,
  responseAt: Date,
  legacyKey: { type: String, unique: true, sparse: true, index: true },
}, { timestamps: true });

ApplicationQuerySchema.index({ application: 1, createdAt: 1 });

module.exports = mongoose.model('ApplicationQuery', ApplicationQuerySchema);
