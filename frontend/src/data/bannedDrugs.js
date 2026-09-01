// ============================================================
// Drugs prohibited under Section 26A of the Drugs & Cosmetics Act, 1940
// Source: banneddrugs.pdf (Ministry of Health and Family Welfare gazette list),
// served by the backend at GET /api/banned-drugs.
//
// Used by: components/wizard/Step3DrugInfo.js to warn an applicant when the
// generic name they entered matches a prohibited drug or combination.
// The check is advisory only — it never blocks the application flow.
// ============================================================

import { BACKEND_ORIGIN } from '../config/api';

let bannedList = [];
let statusNotes = {};
let loadPromise = null;

/* Spelling variants and synonyms seen across the gazette notifications, so that
   "Acetaminophen" matches "Paracetamol", "Cetrizine" matches "Cetirizine", etc. */
const ALIASES = [
  ['acetaminophen', 'paracetamol'],
  ['paracetamole', 'paracetamol'],
  ['albuterol', 'salbutamol'],
  ['lidocaine', 'lignocaine'],
  ['amoxycillin', 'amoxicillin'],
  ['gentamycin', 'gentamicin'],
  ['guaiphenesin', 'guaifenesin'],
  ['guaiphenisin', 'guaifenesin'],
  ['cetrizine', 'cetirizine'],
  ['levocetrizine', 'levocetirizine'],
  ['chlorepheniramine', 'chlorpheniramine'],
  ['chlopheniramine', 'chlorpheniramine'],
  ['chloropheniramine', 'chlorpheniramine'],
  ['dextromethophan', 'dextromethorphan'],
  ['dextromethorphen', 'dextromethorphan'],
  ['tripolidine', 'triprolidine'],
  ['metamizole', 'analgin'],
  ['dipyrone', 'analgin'],
  ['inh', 'isoniazid'],
  ['ascorbic acid', 'vitamin c'],
  ['thiamine', 'vitamin b1'],
  ['pyridoxine', 'vitamin b6'],
  ['cyanocobalamin', 'vitamin b12'],
  ['methylcobalamin', 'vitamin b12'],
  ['mecobalamin', 'vitamin b12'],
  ['niacinamide', 'nicotinamide'],
  ['idochlorhydroxyquinone', 'iodochlorhydroxyquinoline'],
  ['iodochlorohydroxyquinoline', 'iodochlorhydroxyquinoline'],
  ['iodochlorohydroxyquinone', 'iodochlorhydroxyquinoline'],
  ['choline theophylinate', 'choline theophyllinate'],
  ['hydroxyethyltheophylline', 'etofylline'],
];

/* Words describing a dosage form or presentation rather than an ingredient. */
const NOISE = [
  'fixed dose combinations of', 'fixed dose combination of', 'combikit of',
  'dispersible tablets', 'dispersible tablet', 'dispesible tablets',
  'enteric coated granules', 'enteric coated', 'film coated tablets', 'film coated',
  'sustained release', 'ear drops', 'eye drops', 'sp units',
  'injection', 'suspension', 'syrup', 'tablets', 'tablet', 'capsules', 'capsule',
  'granules', 'ointment', 'cream', 'gel',
];

export const BANNED_STATUS_LABELS = {
  'prohibited': 'Prohibited',
  'stayed': 'Prohibition stayed by court',
  'sub-judice': 'Prohibition quashed by High Court — matter sub-judice',
  'conditional': 'Prohibition revoked subject to conditions',
};

/* ── Text normalisation ──────────────────────────────────────────────────── */

function applyAliases(text) {
  let out = text;
  for (const [from, to] of ALIASES) {
    out = out.replace(new RegExp(`(^|[ \\-])${from}($|[ \\-])`, 'g'), `$1${to}$2`);
  }
  return out;
}

function normalize(text) {
  let t = String(text || '').toLowerCase();
  t = t.replace(/\([^)]*\)/g, ' ');
  t = t.replace(/[/,;]/g, ' ');
  for (const noise of NOISE) t = t.split(noise).join(' ');
  // Strip strengths ("500 mg", "62.5mg", "10000 sp units") and the bare numbers
  // left behind by dose lists like "1000/1000/500/500mg" - but never digits that
  // are part of a substance name, so "vitamin b12" and "vitamin d3" survive.
  t = t.replace(/\b\d+(\.\d+)?\s*(mcg|mg|ml|iu|sp units|units|g)\b/g, ' ');
  t = t.replace(/(^|\s)\d+(\.\d+)?(?=\s|$)/g, ' ');
  t = t.replace(/\b(sr|mr|er|ip|bp|usp)\b/g, ' ');
  t = t.replace(/[^a-z0-9+\- ]/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  t = t.replace(/\s*-\s*/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').trim();
  return applyAliases(t);
}

function splitIngredients(text) {
  return String(text || '')
    .split(/\s*\+\s*|\s+&\s+|\s*,\s*|\s+and\s+|\s+with\s+/i)
    .map(normalize)
    .filter(part => part.length >= 3);
}

/* True when `short` occurs inside `long` at a word boundary. Trailing digits are
   tolerated so "vitamin d" matches "vitamin d3" - but only when `short` does not
   itself end in a digit, so "vitamin b1" must never match "vitamin b12". */
function tokenContains(long, short) {
  if (long === short) return true;
  if (short.length < 4) return false;
  const endTest = /[0-9]$/.test(short) ? /^($|[ -])/ : /^[0-9]*($|[ -])/;
  let from = 0;
  for (;;) {
    const idx = long.indexOf(short, from);
    if (idx === -1) return false;
    const startsClean = idx === 0 || long[idx - 1] === ' ' || long[idx - 1] === '-';
    if (startsClean && endTest.test(long.slice(idx + short.length))) return true;
    from = idx + 1;
  }
}

/* A few gazette entries name the same ingredient twice (e.g. Sr. 266 lists both
   "Chlorpheniramine" and "Chlorpheniramine maleate"). Left as-is they would demand
   two separate ingredients from the product and never match it, so keep only the
   most specific of any pair where one term contains the other. */
function dedupeTerms(terms) {
  return terms.filter((term, i) =>
    !terms.some((other, j) => j !== i && other !== term && tokenContains(other, term)) &&
    terms.indexOf(term) === i
  );
}

function termMatches(term, ingredient) {
  return tokenContains(ingredient, term) || tokenContains(term, ingredient);
}

/* ── Loading ─────────────────────────────────────────────────────────────── */

export async function loadBannedDrugs() {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const response = await fetch(`${BACKEND_ORIGIN}/api/banned-drugs`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (Array.isArray(data.entries)) {
        bannedList = data.entries.map(entry => {
          const terms = (entry.terms || []).map(normalize).filter(Boolean);
          // Only FDC term sets are matched one-to-one against ingredients;
          // substance terms are alternative spellings, so leave those intact.
          return { ...entry, terms: entry.type === 'fdc' ? dedupeTerms(terms) : terms };
        });
        statusNotes = data.statusNotes || {};
      }
    } catch (error) {
      console.warn('Prohibited drug list unavailable:', error.message);
      loadPromise = null; // allow a retry on the next call
    }
    return bannedList;
  })();
  return loadPromise;
}

export function isBannedListLoaded() {
  return bannedList.length > 0;
}

/* ── Matching ────────────────────────────────────────────────────────────── */

const MATCH_KINDS = {
  exact: { score: 100, reason: 'This exact fixed dose combination is prohibited.' },
  single: { score: 95, reason: 'This drug is prohibited.' },
  rule: { score: 80, reason: 'This combination falls under a prohibited category of fixed dose combinations.' },
  contains: { score: 70, reason: 'The product contains a prohibited fixed dose combination.' },
  component: { score: 55, reason: 'One of the ingredients of this product is a prohibited drug.' },
};

function matchEntry(entry, ingredients, fullText) {
  const terms = entry.terms || [];
  if (terms.length === 0) return null;

  if (entry.type === 'fdc' && terms.length >= 2) {
    const used = new Set();
    for (const term of terms) {
      const idx = ingredients.findIndex((ing, i) => !used.has(i) && termMatches(term, ing));
      if (idx === -1) return null;
      used.add(idx);
    }
    return used.size === ingredients.length ? 'exact' : 'contains';
  }

  if (entry.type === 'substance') {
    const hit = terms.some(term =>
      ingredients.some(ing => termMatches(term, ing)) || tokenContains(fullText, term)
    );
    if (!hit) return null;
    return ingredients.length <= 1 ? 'single' : 'component';
  }

  if (entry.type === 'rule' && terms.length >= 2) {
    return terms.every(term => tokenContains(fullText, term)) ? 'rule' : null;
  }

  return null;
}

/**
 * Check a generic name against the Section 26A prohibited list.
 * Returns { banned, matches, primary } — `matches` is ordered most relevant first.
 */
export function checkBannedDrug(genericName, limit = 4) {
  const fullText = normalize(genericName);
  if (!fullText || fullText.length < 3 || bannedList.length === 0) {
    return { banned: false, matches: [], primary: null };
  }

  const ingredients = splitIngredients(genericName);
  if (ingredients.length === 0) ingredients.push(fullText);

  const matches = [];
  for (const entry of bannedList) {
    const kind = matchEntry(entry, ingredients, fullText);
    if (!kind) continue;
    matches.push({
      sr: entry.sr,
      name: entry.name,
      notification: entry.notification,
      scope: entry.scope || '',
      status: entry.status || 'prohibited',
      statusNote: entry.statusNote || statusNotes[entry.status] || '',
      matchType: kind,
      reason: MATCH_KINDS[kind].reason,
      score: MATCH_KINDS[kind].score,
    });
  }

  matches.sort((a, b) => b.score - a.score || a.sr - b.sr);
  const trimmed = matches.slice(0, limit);

  return {
    banned: matches.length > 0,
    totalMatches: matches.length,
    matches: trimmed,
    primary: trimmed[0] || null,
  };
}

/** Compact summary to persist alongside a saved product row. */
export function summarizeBannedMatch(genericName) {
  const { banned, primary, totalMatches } = checkBannedDrug(genericName, 1);
  if (!banned) return { banned: false };
  return {
    banned: true,
    bannedSr: primary.sr,
    bannedName: primary.name,
    bannedNotification: primary.notification,
    bannedStatus: primary.status,
    bannedMatchType: primary.matchType,
    bannedMatchCount: totalMatches,
  };
}
