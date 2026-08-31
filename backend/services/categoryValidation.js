/* ============================================================================
   Export-category validation.

   Two applications in this database carry exportCategory "Y" (and destination
   country "X"): EXP-2026-605804 and EXP-2026-700901, both submitted on
   2026-06-10 from diagnostic-test*@test.com. They exist because the submit
   route only checked that the field was PRESENT, never that it was one of the
   allowed categories — the same gap that let "X" through for country.

   This closes the gap for NEW writes. Existing rows are left untouched: they
   remain findable, filterable and exportable so they can be audited. See
   scripts/invalid-data-report.js for the dry-run cleanup report.

   Canonical data lives in backend/data/exportCategories.json, generated from
   the frontend's EXPORT_CATEGORIES. A parity test fails the build if the two
   copies diverge.
   ============================================================================ */

const { categories, aliases } = require('../data/exportCategories.json');

const norm = v => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

const BY_NAME = new Map(categories.map(c => [norm(c), c]));

/** Resolve a name or alias to its canonical category, else null. */
function resolveCategory(value) {
  const key = norm(value);
  if (!key) return null;
  const aliased = aliases[key];
  if (aliased) return BY_NAME.get(norm(aliased)) || null;
  return BY_NAME.get(key) || null;
}

const isValidCategory = value => resolveCategory(value) !== null;

/**
 * Validate a category supplied by a client. Never throws — the caller decides
 * whether an invalid value is fatal.
 */
function validateCategory(value, fieldLabel = 'Export category') {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return { valid: false, canonical: null, message: `${fieldLabel} is required.` };
  }
  const hit = resolveCategory(raw);
  if (!hit) {
    return {
      valid: false,
      canonical: null,
      message: `${fieldLabel} "${raw}" is not a recognised export category. `
        + `Choose one of: ${categories.join(', ')}.`,
    };
  }
  return { valid: true, canonical: hit, message: null };
}

/**
 * Classify a stored value for display. Invalid values are labelled explicitly
 * so charts and tables surface them instead of silently dropping the record.
 */
function categoryDisplayLabel(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '—';
  const hit = resolveCategory(raw);
  return hit || `Invalid category data: ${raw}`;
}

const isInvalidCategoryValue = value => {
  const raw = String(value ?? '').trim();
  if (!raw || raw === 'All') return false;
  return resolveCategory(raw) === null;
};

module.exports = {
  CATEGORIES: categories,
  ALIASES: aliases,
  resolveCategory,
  isValidCategory,
  validateCategory,
  categoryDisplayLabel,
  isInvalidCategoryValue,
};
