/* ============================================================================
   ISO 3166-1 country data — the single local source for country options.

   Deliberately local rather than fetched at runtime: the reviewer console must
   work without a third-party call, and the list is stable. Stored compactly as
   "alpha2|alpha3|name" and parsed once at module load.

   Canonical names are the ISO 3166-1 English short names. ALIASES maps the
   informal spellings that already exist in the database (UK, South Korea, …)
   onto their canonical entry, so filtering by the canonical name still matches
   legacy records. The backend holds the same alias table for query expansion —
   see backend/services/countryAliases.js; the two must be kept in step.
   ============================================================================ */

const RAW = [
  'AF|AFG|Afghanistan', 'AX|ALA|Åland Islands', 'AL|ALB|Albania', 'DZ|DZA|Algeria',
  'AS|ASM|American Samoa', 'AD|AND|Andorra', 'AO|AGO|Angola', 'AI|AIA|Anguilla',
  'AQ|ATA|Antarctica', 'AG|ATG|Antigua and Barbuda', 'AR|ARG|Argentina', 'AM|ARM|Armenia',
  'AW|ABW|Aruba', 'AU|AUS|Australia', 'AT|AUT|Austria', 'AZ|AZE|Azerbaijan',
  'BS|BHS|Bahamas', 'BH|BHR|Bahrain', 'BD|BGD|Bangladesh', 'BB|BRB|Barbados',
  'BY|BLR|Belarus', 'BE|BEL|Belgium', 'BZ|BLZ|Belize', 'BJ|BEN|Benin',
  'BM|BMU|Bermuda', 'BT|BTN|Bhutan', 'BO|BOL|Bolivia, Plurinational State of',
  'BQ|BES|Bonaire, Sint Eustatius and Saba', 'BA|BIH|Bosnia and Herzegovina',
  'BW|BWA|Botswana', 'BV|BVT|Bouvet Island', 'BR|BRA|Brazil',
  'IO|IOT|British Indian Ocean Territory', 'BN|BRN|Brunei Darussalam', 'BG|BGR|Bulgaria',
  'BF|BFA|Burkina Faso', 'BI|BDI|Burundi', 'CV|CPV|Cabo Verde', 'KH|KHM|Cambodia',
  'CM|CMR|Cameroon', 'CA|CAN|Canada', 'KY|CYM|Cayman Islands',
  'CF|CAF|Central African Republic', 'TD|TCD|Chad', 'CL|CHL|Chile', 'CN|CHN|China',
  'CX|CXR|Christmas Island', 'CC|CCK|Cocos (Keeling) Islands', 'CO|COL|Colombia',
  'KM|COM|Comoros', 'CG|COG|Congo', 'CD|COD|Congo, The Democratic Republic of the',
  'CK|COK|Cook Islands', 'CR|CRI|Costa Rica', 'CI|CIV|Côte d’Ivoire', 'HR|HRV|Croatia',
  'CU|CUB|Cuba', 'CW|CUW|Curaçao', 'CY|CYP|Cyprus', 'CZ|CZE|Czechia',
  'DK|DNK|Denmark', 'DJ|DJI|Djibouti', 'DM|DMA|Dominica', 'DO|DOM|Dominican Republic',
  'EC|ECU|Ecuador', 'EG|EGY|Egypt', 'SV|SLV|El Salvador', 'GQ|GNQ|Equatorial Guinea',
  'ER|ERI|Eritrea', 'EE|EST|Estonia', 'SZ|SWZ|Eswatini', 'ET|ETH|Ethiopia',
  'FK|FLK|Falkland Islands (Malvinas)', 'FO|FRO|Faroe Islands', 'FJ|FJI|Fiji',
  'FI|FIN|Finland', 'FR|FRA|France', 'GF|GUF|French Guiana', 'PF|PYF|French Polynesia',
  'TF|ATF|French Southern Territories', 'GA|GAB|Gabon', 'GM|GMB|Gambia', 'GE|GEO|Georgia',
  'DE|DEU|Germany', 'GH|GHA|Ghana', 'GI|GIB|Gibraltar', 'GR|GRC|Greece',
  'GL|GRL|Greenland', 'GD|GRD|Grenada', 'GP|GLP|Guadeloupe', 'GU|GUM|Guam',
  'GT|GTM|Guatemala', 'GG|GGY|Guernsey', 'GN|GIN|Guinea', 'GW|GNB|Guinea-Bissau',
  'GY|GUY|Guyana', 'HT|HTI|Haiti', 'HM|HMD|Heard Island and McDonald Islands',
  'VA|VAT|Holy See', 'HN|HND|Honduras', 'HK|HKG|Hong Kong', 'HU|HUN|Hungary',
  'IS|ISL|Iceland', 'IN|IND|India', 'ID|IDN|Indonesia',
  'IR|IRN|Iran, Islamic Republic of', 'IQ|IRQ|Iraq', 'IE|IRL|Ireland',
  'IM|IMN|Isle of Man', 'IL|ISR|Israel', 'IT|ITA|Italy', 'JM|JAM|Jamaica',
  'JP|JPN|Japan', 'JE|JEY|Jersey', 'JO|JOR|Jordan', 'KZ|KAZ|Kazakhstan',
  'KE|KEN|Kenya', 'KI|KIR|Kiribati', 'KP|PRK|Korea, Democratic People’s Republic of',
  'KR|KOR|Korea, Republic of', 'KW|KWT|Kuwait', 'KG|KGZ|Kyrgyzstan',
  'LA|LAO|Lao People’s Democratic Republic', 'LV|LVA|Latvia', 'LB|LBN|Lebanon',
  'LS|LSO|Lesotho', 'LR|LBR|Liberia', 'LY|LBY|Libya', 'LI|LIE|Liechtenstein',
  'LT|LTU|Lithuania', 'LU|LUX|Luxembourg', 'MO|MAC|Macao', 'MG|MDG|Madagascar',
  'MW|MWI|Malawi', 'MY|MYS|Malaysia', 'MV|MDV|Maldives', 'ML|MLI|Mali', 'MT|MLT|Malta',
  'MH|MHL|Marshall Islands', 'MQ|MTQ|Martinique', 'MR|MRT|Mauritania', 'MU|MUS|Mauritius',
  'YT|MYT|Mayotte', 'MX|MEX|Mexico', 'FM|FSM|Micronesia, Federated States of',
  'MD|MDA|Moldova, Republic of', 'MC|MCO|Monaco', 'MN|MNG|Mongolia', 'ME|MNE|Montenegro',
  'MS|MSR|Montserrat', 'MA|MAR|Morocco', 'MZ|MOZ|Mozambique', 'MM|MMR|Myanmar',
  'NA|NAM|Namibia', 'NR|NRU|Nauru', 'NP|NPL|Nepal', 'NL|NLD|Netherlands',
  'NC|NCL|New Caledonia', 'NZ|NZL|New Zealand', 'NI|NIC|Nicaragua', 'NE|NER|Niger',
  'NG|NGA|Nigeria', 'NU|NIU|Niue', 'NF|NFK|Norfolk Island', 'MK|MKD|North Macedonia',
  'MP|MNP|Northern Mariana Islands', 'NO|NOR|Norway', 'OM|OMN|Oman', 'PK|PAK|Pakistan',
  'PW|PLW|Palau', 'PS|PSE|Palestine, State of', 'PA|PAN|Panama',
  'PG|PNG|Papua New Guinea', 'PY|PRY|Paraguay', 'PE|PER|Peru', 'PH|PHL|Philippines',
  'PN|PCN|Pitcairn', 'PL|POL|Poland', 'PT|PRT|Portugal', 'PR|PRI|Puerto Rico',
  'QA|QAT|Qatar', 'RE|REU|Réunion', 'RO|ROU|Romania', 'RU|RUS|Russian Federation',
  'RW|RWA|Rwanda', 'BL|BLM|Saint Barthélemy',
  'SH|SHN|Saint Helena, Ascension and Tristan da Cunha', 'KN|KNA|Saint Kitts and Nevis',
  'LC|LCA|Saint Lucia', 'MF|MAF|Saint Martin (French part)',
  'PM|SPM|Saint Pierre and Miquelon', 'VC|VCT|Saint Vincent and the Grenadines',
  'WS|WSM|Samoa', 'SM|SMR|San Marino', 'ST|STP|Sao Tome and Principe',
  'SA|SAU|Saudi Arabia', 'SN|SEN|Senegal', 'RS|SRB|Serbia', 'SC|SYC|Seychelles',
  'SL|SLE|Sierra Leone', 'SG|SGP|Singapore', 'SX|SXM|Sint Maarten (Dutch part)',
  'SK|SVK|Slovakia', 'SI|SVN|Slovenia', 'SB|SLB|Solomon Islands', 'SO|SOM|Somalia',
  'ZA|ZAF|South Africa', 'GS|SGS|South Georgia and the South Sandwich Islands',
  'SS|SSD|South Sudan', 'ES|ESP|Spain', 'LK|LKA|Sri Lanka', 'SD|SDN|Sudan',
  'SR|SUR|Suriname', 'SJ|SJM|Svalbard and Jan Mayen', 'SE|SWE|Sweden',
  'CH|CHE|Switzerland', 'SY|SYR|Syrian Arab Republic', 'TW|TWN|Taiwan, Province of China',
  'TJ|TJK|Tajikistan', 'TZ|TZA|Tanzania, United Republic of', 'TH|THA|Thailand',
  'TL|TLS|Timor-Leste', 'TG|TGO|Togo', 'TK|TKL|Tokelau', 'TO|TON|Tonga',
  'TT|TTO|Trinidad and Tobago', 'TN|TUN|Tunisia', 'TR|TUR|Türkiye',
  'TM|TKM|Turkmenistan', 'TC|TCA|Turks and Caicos Islands', 'TV|TUV|Tuvalu',
  'UG|UGA|Uganda', 'UA|UKR|Ukraine', 'AE|ARE|United Arab Emirates',
  'GB|GBR|United Kingdom', 'US|USA|United States',
  'UM|UMI|United States Minor Outlying Islands', 'UY|URY|Uruguay', 'UZ|UZB|Uzbekistan',
  'VU|VUT|Vanuatu', 'VE|VEN|Venezuela, Bolivarian Republic of', 'VN|VNM|Viet Nam',
  'VG|VGB|Virgin Islands, British', 'VI|VIR|Virgin Islands, U.S.',
  'WF|WLF|Wallis and Futuna', 'EH|ESH|Western Sahara', 'YE|YEM|Yemen',
  'ZM|ZMB|Zambia', 'ZW|ZWE|Zimbabwe',
];

export const COUNTRIES = RAW.map(row => {
  const [alpha2, alpha3, name] = row.split('|');
  return { alpha2, alpha3, name };
});

export const ALL_COUNTRIES = 'All';

/* ---- Aliases ---------------------------------------------------------------
   Informal spellings that exist in the data (or that reviewers naturally type)
   mapped onto the canonical ISO name. Every key is matched case-insensitively.
   Keep in step with backend/services/countryAliases.js.
   -------------------------------------------------------------------------- */
export const ALIASES = {
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

const BY_NAME = new Map(COUNTRIES.map(c => [norm(c.name), c]));
const BY_A2 = new Map(COUNTRIES.map(c => [c.alpha2.toLowerCase(), c]));
const BY_A3 = new Map(COUNTRIES.map(c => [c.alpha3.toLowerCase(), c]));

/**
 * Resolve any stored or typed value to its canonical country, via exact name,
 * ISO code, or alias. Returns null for values that are not countries — the
 * database contains at least one ("X"), and inventing a match for it would be
 * worse than reporting none.
 */
export function resolveCountry(value) {
  const key = norm(value);
  if (!key || key === norm(ALL_COUNTRIES)) return null;
  const aliased = ALIASES[key];
  if (aliased) return BY_NAME.get(norm(aliased)) || null;
  return BY_NAME.get(key) || BY_A2.get(key) || BY_A3.get(key) || null;
}

/** Canonical display name for a stored value, or the raw value if unresolvable. */
export function canonicalName(value) {
  const hit = resolveCountry(value);
  return hit ? hit.name : String(value ?? '').trim();
}

/** True when a stored value is present but is not a recognised country. */
export function isInvalidCountryValue(value) {
  const raw = String(value ?? '').trim();
  return raw !== '' && raw !== ALL_COUNTRIES && resolveCountry(raw) === null;
}

/**
 * Label for a stored country value. Legacy values that are not countries are
 * marked as invalid data rather than rendered as though they were real, while
 * staying visible so the affected records remain auditable.
 */
export function countryDisplayLabel(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '—';
  return isInvalidCountryValue(raw) ? `Invalid country data: ${raw}` : canonicalName(raw);
}

/**
 * Case-insensitive partial search over canonical names, ISO codes and aliases.
 * Prefix matches rank above mid-string matches so typing "ind" surfaces India
 * before British Indian Ocean Territory.
 */
export function searchCountries(query, { limit = 0 } = {}) {
  const q = norm(query);
  if (!q) return limit ? COUNTRIES.slice(0, limit) : COUNTRIES;

  const aliasTargets = new Set(
    Object.entries(ALIASES)
      .filter(([alias]) => alias.includes(q))
      .map(([, canonical]) => norm(canonical))
  );

  const scored = [];
  for (const c of COUNTRIES) {
    const name = norm(c.name);
    let score = -1;
    if (name.startsWith(q)) score = 0;
    else if (c.alpha2.toLowerCase() === q || c.alpha3.toLowerCase() === q) score = 1;
    else if (name.includes(q)) score = 2;
    else if (aliasTargets.has(name)) score = 3;
    if (score >= 0) scored.push({ c, score });
  }
  scored.sort((a, b) => a.score - b.score || a.c.name.localeCompare(b.c.name));
  const out = scored.map(s => s.c);
  return limit ? out.slice(0, limit) : out;
}
