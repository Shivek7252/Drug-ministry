const mongoose = require('mongoose');

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
    enum: ['application', 'shipment', 'checklist', 'legacy'],
    default: 'application',
  },
  sourceReference: String,
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
