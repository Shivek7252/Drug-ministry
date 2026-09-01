const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const KEY_BYTES = 64;
const DEFAULT_COST = Object.freeze({ N: 16384, r: 8, p: 1 });

function safeText(value) {
  return typeof value === 'string' ? value : '';
}

const MIN_LENGTH = 12;

async function createPasswordHash(password, options = {}) {
  const plain = safeText(password);
  /* The 12-character floor is the default for every real caller. The demo
     account seeder passes an explicit lower `minLength` so that short, typeable
     credentials can be issued for a controlled demonstration — the weakening is
     opt-in at one call site rather than removed from the control itself. */
  const minLength = Number.isInteger(options.minLength) ? options.minLength : MIN_LENGTH;
  if (plain.length < minLength) {
    throw new Error(`Passwords must contain at least ${minLength} characters.`);
  }
  const salt = options.salt || crypto.randomBytes(16);
  const cost = { ...DEFAULT_COST, ...(options.cost || {}) };
  const derived = await scrypt(plain, salt, KEY_BYTES, { ...cost, maxmem: 64 * 1024 * 1024 });
  return [
    'scrypt', cost.N, cost.r, cost.p,
    Buffer.from(salt).toString('base64url'),
    Buffer.from(derived).toString('base64url'),
  ].join('$');
}

async function verifyPassword(password, encoded) {
  try {
    const [algorithm, n, r, p, saltText, expectedText, extra] = safeText(encoded).split('$');
    if (algorithm !== 'scrypt' || extra !== undefined) return false;
    const cost = { N: Number(n), r: Number(r), p: Number(p) };
    if (!Number.isInteger(cost.N) || !Number.isInteger(cost.r) || !Number.isInteger(cost.p)) return false;
    if (cost.N < 16384 || cost.r < 8 || cost.p < 1) return false;
    const salt = Buffer.from(saltText, 'base64url');
    const expected = Buffer.from(expectedText, 'base64url');
    if (salt.length < 16 || expected.length !== KEY_BYTES) return false;
    const actual = await scrypt(safeText(password), salt, expected.length, {
      ...cost,
      maxmem: 64 * 1024 * 1024,
    });
    return crypto.timingSafeEqual(expected, Buffer.from(actual));
  } catch (_) {
    return false;
  }
}

module.exports = { createPasswordHash, verifyPassword };
