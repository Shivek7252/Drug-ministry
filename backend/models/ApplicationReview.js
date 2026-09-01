const mongoose = require('mongoose');

/* ── One internal review observation ─────────────────────────────────────────
   Internal to the reviewer. Nothing in this sub-document is ever sent to the
   applicant — the applicant sees only `applicantMessage` on the parent. */
const ReviewRowSchema = new mongoose.Schema({
  order:         { type: Number, required: true },
  area:          { type: String, enum: ['Application', 'Document', 'Product', 'Shipment', 'Compliance', 'Query'], default: 'Application' },
  item:          String,          // the document, product, shipment or checklist item
  entityId:      String,          // stable id of the referenced entity
  severity:      { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },
  aiObservation: String,          // evidence-based finding from the stored record
  aiNote:        String,          // originally generated note (blank when reviewer-added)
  note:          { type: String, required: true },  // final, reviewer-confirmed note
  edited:        { type: Boolean, default: false },
  rowSource:     { type: String, enum: ['ai_generated', 'reviewer_added'], default: 'ai_generated' },
}, { _id: false });

/* ── Internal review snapshot for one Under Review action ────────────────────
   Deliberately NOT an ApplicationQuery: this is a status transition with an
   internal record, and it must never appear in query history or query counts. */
const ApplicationReviewSchema = new mongoose.Schema({
  application: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Application',
    required: true,
    index: true,
  },
  applicationNumber: { type: String, required: true, index: true },

  rows: { type: [ReviewRowSchema], default: [] },
  /* Counters as computed on the server at the moment of the decision. */
  metrics: mongoose.Schema.Types.Mixed,

  /* The only applicant-visible field on this record. */
  applicantMessage: { type: String, required: true, trim: true },

  reviewer: {
    id:   String,
    name: { type: String, required: true, default: 'reviewer' },
    role: { type: String, default: 'reviewer' },
  },

  previousStatus: String,
  newStatus:      { type: String, default: 'Under Review' },
  /* False when the application was already Under Review and this submission
     only refreshed the notes — no second status transition was recorded. */
  statusChanged:  { type: Boolean, default: true },

  /* Per-submission key: a retried click or replayed request resolves to the
     record the first attempt created instead of duplicating review history. */
  idempotencyKey: { type: String, unique: true, sparse: true, index: true },
}, { timestamps: true });

ApplicationReviewSchema.index({ application: 1, createdAt: -1 });

module.exports = mongoose.model('ApplicationReview', ApplicationReviewSchema);
