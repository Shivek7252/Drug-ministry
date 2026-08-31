const mongoose = require('mongoose');

/* ============================================================================
   ApplicationRead — per-reviewer read receipts.

   Read/unread is reviewer state, NOT application workflow state, so it lives in
   its own collection rather than on Application. One row per (reviewer,
   application); the unique index makes "mark as read" idempotent.

   This replaces the previous localStorage-only `reviewer_opened_apps` key,
   which was per-browser rather than per-reviewer: two reviewers sharing a
   machine saw each other's read state, and the state was lost on cache clear
   or when signing in elsewhere.
   ============================================================================ */
const ApplicationReadSchema = new mongoose.Schema({
  reviewerId: { type: String, trim: true, index: true },
  reviewerName: { type: String, trim: true },
  /* Legacy field retained for existing receipts; new writes use reviewerId. */
  reviewer: { type: String, trim: true, index: true },
  application: { type: mongoose.Schema.Types.ObjectId, ref: 'Application', index: true },
  applicationNumber: { type: String, required: true, trim: true, index: true },
  readAt: { type: Date, default: Date.now },
}, { timestamps: true });

ApplicationReadSchema.index(
  { reviewerId: 1, applicationNumber: 1 },
  { unique: true, partialFilterExpression: { reviewerId: { $type: 'string' } } },
);

module.exports = mongoose.model('ApplicationRead', ApplicationReadSchema);
