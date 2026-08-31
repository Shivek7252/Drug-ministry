/* ============================================================================
   Country validation for incoming applications.

   The database already contains two legacy records with destinationCountry "X"
   (diagnostic test submissions, 2026-06-10). They exist because the submit
   route only checked that the field was PRESENT, never that it was a real
   country. This module closes that gap for new writes.

   Legacy rows are deliberately left untouched: filtering and export must keep
   working for them so reviewers can still find and audit them.

   Canonical data lives in backend/data/countries.json, generated from
   frontend/src/data/countries.js. Parity tests on both sides fail if the two
   copies diverge.
   ============================================================================ */

const { countries, aliases } = require('../data/countries.json');

const norm = v => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

const BY_NAME = new Map(countries.map(c => [norm(c.name), c]));
const BY_A2 = new Map(countries.map(c => [c.alpha2.toLowerCase(), c]));
const BY_A3 = new Map(countries.map(c => [c.alpha3.toLowerCase(), c]));

/** Resolve a name, ISO code or alias to its canonical country, else null. */
function resolveCountry(value) {
  const key = norm(value);
  if (!key) return null;
  const aliased = aliases[key];
  if (aliased) return BY_NAME.get(norm(aliased)) || null;
  return BY_NAME.get(key) || BY_A2.get(key) || BY_A3.get(key) || null;
}

const isValidCountry = value => resolveCountry(value) !== null;

/**
 * Validate a country supplied by a client.
 * Returns { valid, canonical, message } — never throws, so callers decide
 * whether an invalid value is fatal.
 */
function validateCountry(value, fieldLabel = 'Destination country') {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return { valid: false, canonical: null, message: `${fieldLabel} is required.` };
  }
  const hit = resolveCountry(raw);
  if (!hit) {
    return {
      valid: false,
      canonical: null,
      message: `${fieldLabel} "${raw}" is not a recognised country. `
        + 'Enter an ISO 3166-1 country name or code (for example "Japan", "JP" or "JPN").',
    };
  }
  return { valid: true, canonical: hit.name, message: null };
}

module.exports = {
  COUNTRIES: countries,
  ALIASES: aliases,
  resolveCountry,
  isValidCountry,
  validateCountry,
};
