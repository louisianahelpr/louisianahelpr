/**
 * Which prod-seed accounts CI signs in BY PASSWORD, and the guard that stops
 * `prod-seed.mjs --apply` from (re)creating one without it.
 *
 * Why: CI has no service role, so press-every-control and the prod a11y sweep
 * sign these accounts in with the PLAYWRIGHT_<KEY>_PASSWORD secrets. A
 * --teardown/--apply cycle run without SEED_PASSWORD_<KEY> re-created
 * helpr-seed-incomplete-0912 at 2026-10-01 17:19:57Z with no password; every
 * press-every-control leg then failed `invalid_credentials` (issue #1582,
 * run 36923495483). The old code skipped the password silently when the env
 * var was unset. It now refuses before touching the account.
 */

/** OWNED key in prod-seed.mjs -> the GitHub secret CI signs it in with. */
export const CI_PASSWORD_ACCOUNTS = Object.freeze({
  incomplete: "PLAYWRIGHT_INCOMPLETE_PASSWORD",
  admin: "PLAYWRIGHT_ADMIN_PASSWORD",
});

/**
 * The password to (re)apply for a seed account, or null when CI never signs it
 * in by password. Throws for a CI-password account whose SEED_PASSWORD_<KEY> is
 * unset: creating or keeping it without one silently breaks every CI leg that
 * signs in as it.
 */
export function seedPasswordFor(key, env = process.env) {
  const name = `SEED_PASSWORD_${key.toUpperCase()}`;
  const pw = env[name];
  if (pw) return pw;
  const secret = CI_PASSWORD_ACCOUNTS[key];
  if (secret) {
    throw new Error(
      `REFUSED: ${name} is unset. CI signs the "${key}" seed account in with the ${secret} secret; ` +
        `set ${name} to that secret's value, or this --apply leaves the account with a password CI does not have.`,
    );
  }
  return null;
}
