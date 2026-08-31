const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const backend = require('../data/countries.json');
const { validateCountry, isValidCountry, resolveCountry } = require('../services/countryValidation');
const { countrySpellings, ALIASES: filterAliases } = require('../services/countryAliases');

/* Load the frontend module without a bundler: strip ESM syntax and evaluate. */
function loadFrontendCountries() {
  const file = path.join(__dirname, '..', '..', 'frontend', 'src', 'data', 'countries.js');
  const src = fs.readFileSync(file, 'utf8')
    .replace(/^export const /gm, 'const ')
    .replace(/^export function /gm, 'function ')
    .replace(/^export /gm, '');
  const box = { console, module: { exports: {} } };
  vm.createContext(box);
  vm.runInContext(`${src}\n;module.exports = { COUNTRIES, ALIASES };`, box);
  /* Values built inside a vm context carry that context's prototypes, which
     makes deepStrictEqual fail on prototype identity even when the contents
     are identical. Round-trip through JSON so the comparison is about data. */
  return JSON.parse(JSON.stringify(box.module.exports));
}

/* ============================================================================
   Parity — the canonical data exists in two places (a frontend ES module for
   instant search, a backend JSON for validation and query expansion). These
   tests fail the build the moment the two drift apart.
   ============================================================================ */

test('frontend and backend country lists are identical', () => {
  const fe = loadFrontendCountries();
  assert.equal(fe.COUNTRIES.length, backend.countries.length,
    'country counts differ — regenerate backend/data/countries.json');
  assert.deepEqual(
    fe.COUNTRIES.map(c => `${c.alpha2}|${c.alpha3}|${c.name}`).sort(),
    backend.countries.map(c => `${c.alpha2}|${c.alpha3}|${c.name}`).sort(),
    'country entries differ between frontend and backend',
  );
});

test('frontend and backend alias tables are identical', () => {
  const fe = loadFrontendCountries();
  assert.deepEqual(fe.ALIASES, backend.aliases,
    'alias tables differ — frontend/src/data/countries.js and backend/data/countries.json must match');
});

test('the filter alias table matches the canonical alias table', () => {
  assert.deepEqual(filterAliases, backend.aliases,
    'countryAliases.js has drifted from the canonical alias data');
});

test('every alias points at a real canonical country', () => {
  for (const [alias, canonical] of Object.entries(backend.aliases)) {
    assert.ok(backend.countries.some(c => c.name === canonical),
      `alias "${alias}" points at unknown country "${canonical}"`);
    assert.equal(resolveCountry(alias)?.name, canonical);
  }
});

test('the country dataset has no duplicates', () => {
  const names = backend.countries.map(c => c.name);
  const a2 = backend.countries.map(c => c.alpha2);
  assert.equal(new Set(names).size, names.length, 'duplicate country name');
  assert.equal(new Set(a2).size, a2.length, 'duplicate alpha-2 code');
});

/* ---- Validation ---------------------------------------------------------- */

test('valid names, codes and aliases are accepted', () => {
  for (const v of ['Japan', 'japan', 'JP', 'JPN', 'United Kingdom', 'UK', 'South Korea']) {
    assert.ok(isValidCountry(v), `${v} should be valid`);
  }
  assert.equal(validateCountry('UK').canonical, 'United Kingdom');
  assert.equal(validateCountry('south korea').canonical, 'Korea, Republic of');
});

test('arbitrary values are rejected with an actionable message', () => {
  const result = validateCountry('X');
  assert.equal(result.valid, false);
  assert.match(result.message, /not a recognised country/i);
  assert.match(result.message, /ISO 3166-1/);
  assert.equal(validateCountry('').valid, false);
  assert.equal(validateCountry('Wakanda').valid, false);
});

test('legacy invalid values stay filterable for audit', () => {
  // Validation guards new writes; it must not make existing rows unreachable.
  assert.deepEqual(countrySpellings('X'), ['X']);
  assert.equal(isValidCountry('X'), false);
});

test('alias expansion covers both directions for the values in this database', () => {
  const uk = countrySpellings('United Kingdom').map(s => s.toLowerCase());
  assert.ok(uk.includes('uk'), 'canonical UK query must match legacy "UK" rows');
  const kr = countrySpellings('Korea, Republic of').map(s => s.toLowerCase());
  assert.ok(kr.includes('south korea'), 'canonical Korea query must match legacy "South Korea" rows');
  assert.deepEqual(countrySpellings('Japan'), ['Japan'], 'a plain country expands to itself only');
});
