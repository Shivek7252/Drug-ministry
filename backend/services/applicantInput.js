'use strict';

/* ============================================================================
   Applicant input allowlist (DEF-01).

   The Application schema is deliberately `strict: false` so that legacy records
   keep fields this codebase no longer declares. That is safe for reading, but
   it means ANY key an applicant sends in `formData` is persistable. Combined
   with the broad `Object.assign(app, rest)` / `new Application({ ...rest })` in
   the draft and submit routes, an authenticated applicant could write
   reviewer-owned and audit-owned state: `auditLog`, `reviewerRemarks`,
   `queryCount`, `approvedAt`, `rejectedAt`, `nocMeta`, shipment `lineStatus` /
   `lineRemarks`, document `validationResult`, and even `_id`.

   The security boundary is enforced HERE, at the request layer, rather than by
   flipping the schema to `strict: true` — that would silently drop legacy
   fields from every existing record on the next save.

   This module is an ALLOWLIST, not a blacklist. The output object is built key
   by key from the constants below, so a field that is not named here cannot be
   persisted no matter what the client sends. Nothing is ever "assign then
   delete". Because every key written is taken from a frozen constant, keys like
   `__proto__` / `constructor` / `prototype` are structurally unreachable.
   ============================================================================ */

/* Top-level fields an applicant legitimately owns. Mirrors `initialFormData`
   in frontend/src/context/AppContext.js plus the legacy single-row mirrors
   written by `mirrorLegacyFields` before every save/submit. */
const APPLICANT_SCALAR_FIELDS = Object.freeze([
  // Application
  'applicationType', 'exportPurpose', 'exportCategory', 'destinationCountry', 'applicationDate',
  // Applicant
  'applicantName', 'applicantOrganization', 'contactNumber', 'email',
  // Consignee (legacy single-row mirror of consignees[0])
  'consigneeName', 'consigneeOrg', 'addressLine1', 'addressLine2', 'city', 'state',
  'consigneeCountry', 'postalCode', 'contactPerson', 'consigneePhone', 'consigneeEmail',
  // Manufacturer (legacy single-row mirror of companies[0])
  'manufacturerName', 'mfgLicenseNo', 'factoryAddress', 'manufacturingSite',
  'mfgContactPerson', 'mfgContactNumber', 'mfgEmail', 'signatoryName', 'signatoryDesignation',
]);

/* `id` and `productRef` are client-side row keys the wizard round-trips. */
const PRODUCT_FIELDS = Object.freeze([
  'id', 'productRef', 'productName', 'genericName', 'brandName', 'dosageForm',
  'strength', 'packSize', 'batchNumber', 'mfgDate', 'expiryDate',
]);

const COMPANY_FIELDS = Object.freeze([
  'companyRef', 'name', 'licenseNo', 'factoryAddress', 'manufacturingSite',
  'contactPerson', 'contactNumber', 'email', 'signatoryName', 'signatoryDesignation',
]);

const CONSIGNEE_FIELDS = Object.freeze([
  'consigneeRef', 'name', 'organisation', 'addressLine1', 'addressLine2', 'city',
  'state', 'country', 'postalCode', 'contactPerson', 'phone', 'email',
]);

/* Deliberately excludes `lineStatus` and `lineRemarks`: those carry the
   reviewer's per-line decision, the reviewing officer's identity and the AI
   query identifier, and are written only by the reviewer shipment-action route.
   Omitting them lets the schema defaults (`Pending` / `[]`) apply. */
const SHIPMENT_FIELDS = Object.freeze([
  'shipmentRef', 'companyRef', 'productRef', 'consigneeRef', 'quantity', 'packSize',
]);

const DECLARATION_FIELDS = Object.freeze([
  'productInfoAccurate', 'documentsGenuine', 'exportRegulations', 'drugComplies', 'finalDeclaration',
]);

/* Exactly what `cleanDocuments()` in frontend/src/api/applicationService.js
   sends. `path` is excluded so a client cannot point a stored document at an
   arbitrary file, and `validated` / `validationResult` are excluded so a client
   cannot fabricate an AI verdict — both are set server-side by
   services/documentStorage.js after the bytes are written. */
const DOCUMENT_FIELDS = Object.freeze(['name', 'size', 'type', 'uploadedAt', 'data']);

/* Document map keys become part of a filename and a Mongo Map key. */
const DOC_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/* Server- and reviewer-owned fields. Documentation and test surface only — the
   allowlist above is what actually enforces the boundary. */
const PROTECTED_FIELDS = Object.freeze([
  '_id', '__v', 'ownerId', 'role', 'status', 'isDraft',
  'applicationNumber', 'referenceNumber',
  'auditLog', 'reviewerRemarks', 'queryCount', 'approvedAt', 'rejectedAt',
  'submittedBy', 'submittedAt', 'lastSavedAt', 'createdAt', 'updatedAt',
  'timeline', 'checklistItems', 'reconciliations', 'nocMeta', 'drugApprovalCheck',
  'shipments[].lineStatus', 'shipments[].lineRemarks',
  'documents[].path', 'documents[].validated', 'documents[].validationResult',
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/* Accepts primitives only. An object or array where the schema expects a scalar
   is dropped rather than cast, so query-operator shapes never reach Mongoose. */
function scalar(value) {
  if (value === null || value === undefined) return undefined;
  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') return value;
  return undefined;
}

/** Build a new object containing only `allowed` keys that the source owns. */
function pick(source, allowed) {
  const out = {};
  if (!isPlainObject(source)) return out;
  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const value = scalar(source[key]);
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}

function pickRows(value, allowed, extra) {
  if (!Array.isArray(value)) return undefined;
  return value.map(row => {
    const clean = pick(row, allowed);
    return typeof extra === 'function' ? extra(clean, row) : clean;
  });
}

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map(scalar).filter(entry => entry !== undefined).map(String);
}

/**
 * Reduce an applicant-supplied `formData` to the fields an applicant may write.
 *
 * Always returns a new plain object. Unknown, reviewer-owned, audit-owned and
 * server-generated keys are absent from the result — they are never copied in
 * the first place, so no later deletion step can be forgotten or bypassed.
 *
 * @param {unknown} formData raw `req.body.formData`
 * @returns {object} a safe object suitable for assignment onto an Application
 */
function sanitizeApplicantForm(formData) {
  const source = isPlainObject(formData) ? formData : {};
  const safe = pick(source, APPLICANT_SCALAR_FIELDS);

  const products = pickRows(source.products, PRODUCT_FIELDS);
  if (products) safe.products = products;

  const companies = pickRows(source.companies, COMPANY_FIELDS);
  if (companies) safe.companies = companies;

  const consignees = pickRows(source.consignees, CONSIGNEE_FIELDS);
  if (consignees) safe.consignees = consignees;

  const shipments = pickRows(source.shipments, SHIPMENT_FIELDS, (clean, row) => {
    clean.batchNumbers = stringList(row?.batchNumbers);
    return clean;
  });
  if (shipments) safe.shipments = shipments;

  if (isPlainObject(source.declarations)) {
    safe.declarations = pick(source.declarations, DECLARATION_FIELDS);
  }

  if (isPlainObject(source.documents)) {
    const documents = {};
    for (const docId of Object.keys(source.documents)) {
      if (!DOC_ID_PATTERN.test(docId)) continue;
      const entry = source.documents[docId];
      if (!isPlainObject(entry)) continue;
      documents[docId] = pick(entry, DOCUMENT_FIELDS);
    }
    safe.documents = documents;
  }

  return safe;
}

module.exports = {
  APPLICANT_SCALAR_FIELDS,
  PRODUCT_FIELDS,
  COMPANY_FIELDS,
  CONSIGNEE_FIELDS,
  SHIPMENT_FIELDS,
  DECLARATION_FIELDS,
  DOCUMENT_FIELDS,
  PROTECTED_FIELDS,
  sanitizeApplicantForm,
};
