const { createPasswordHash } = require('../services/passwordHash');

async function main() {
  const password = process.env.AUTH_PASSWORD;
  if (!password) throw new Error('Set AUTH_PASSWORD in this process environment. It will not be written to disk.');
  const hash = await createPasswordHash(password);
  process.stdout.write(`${hash}\n`);
}

main().catch(err => {
  console.error(err.message);
  process.exitCode = 1;
});
