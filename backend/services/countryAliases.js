/* ============================================================================
   Country alias expansion for reviewer filtering.

   The database holds informal spellings ("UK", "South Korea") alongside
   canonical ones. The reviewer console now sends the canonical ISO 3166-1 name,
   so an exact match would silently miss those legacy records. Expanding the
   selected country to every accepted spelling keeps old rows findable without
   rewriting any data.

   Mirrors ALIASES in frontend/src/data/countries.js — keep the two in step.
   ============================================================================ */

const ALIASES = {
  'uk': 'United Kingdom',
  'u.k.': 'United Kingdom',
  'great britain': 'United Kingdom',
  'britain': 'United Kingdom',
  'england': 'United Kingdom',
  'south korea': 'Korea, Republic of',
  'republic of korea': 'Korea, Republic of',
  'north korea': 'Korea, Democratic People’s Republic of',
  'usa': 'United States',
  'u.s.a.': 'United States',
  'united states of america': 'United States',
  'uae': 'United Arab Emirates',
  'russia': 'Russian Federation',
  'iran': 'Iran, Islamic Republic of',
  'syria': 'Syrian Arab Republic',
  'vietnam': 'Viet Nam',
  'laos': 'Lao People’s Democratic Republic',
  'taiwan': 'Taiwan, Province of China',
  'bolivia': 'Bolivia, Plurinational State of',
  'venezuela': 'Venezuela, Bolivarian Republic of',
  'tanzania': 'Tanzania, United Republic of',
  'moldova': 'Moldova, Republic of',
  'macedonia': 'North Macedonia',
  'turkey': 'Türkiye',
  'ivory coast': 'Côte d’Ivoire',
  'cape verde': 'Cabo Verde',
  'czech republic': 'Czechia',
  'swaziland': 'Eswatini',
  'burma': 'Myanmar',
  'palestine': 'Palestine, State of',
  'micronesia': 'Micronesia, Federated States of',
  'brunei': 'Brunei Darussalam',
  'hong kong sar': 'Hong Kong',
  'vatican': 'Holy See',
  'east timor': 'Timor-Leste',
};

const norm = v => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/* canonical (normalised) -> [every spelling that should match it] */
const CANONICAL_TO_SPELLINGS = (() => {
  const map = new Map();
  for (const [alias, canonical] of Object.entries(ALIASES)) {
    const key = norm(canonical);
    if (!map.has(key)) map.set(key, new Set([canonical]));
    map.get(key).add(alias);
  }
  return map;
})();

/**
 * Every spelling that should match the selected country, including the value
 * itself. Unknown values pass through unchanged so a filter on a non-canonical
 * stored value (e.g. "X") still behaves exactly as before.
 */
function countrySpellings(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return [];
  const key = norm(raw);
  const canonical = ALIASES[key] ? norm(ALIASES[key]) : key;
  const spellings = CANONICAL_TO_SPELLINGS.get(canonical);
  const out = new Set([raw]);
  if (ALIASES[key]) out.add(ALIASES[key]);
  if (spellings) spellings.forEach(s => out.add(s));
  return [...out];
}

module.exports = { ALIASES, countrySpellings };
