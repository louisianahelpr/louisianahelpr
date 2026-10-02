#!/usr/bin/env node
/**
 * PGlite proof for 20261002055253_forbid_blank_stripe_account_id (docs/OPEN.md Q871).
 *
 *   node src/test/pglite/blankStripeAccountIdForbidden.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/blankStripeAccountIdForbidden.pglite.mjs   # RED: no constraint
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture: public.profiles with the live column type (stripe_account_id text,
 * nullable). The migration is applied 3x (replay-safe), then:
 *   - '' and '   ' are rejected (RED without the migration: both accepted);
 *   - NULL and a real acct_ id are still accepted;
 *   - exactly one constraint of that name exists.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const NEW = readFileSync(
  new URL("../../../supabase/migrations/20261002055253_forbid_blank_stripe_account_id.sql", import.meta.url).pathname,
  "utf8",
);
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running without the migration (expect FAILs)`);

const db = new PGlite();
await db.exec(`CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  stripe_account_id text
);`);
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(NEW);

let fails = 0;
const check = (ok, label) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) fails++;
};
async function accepts(v) {
  try {
    await db.query("INSERT INTO public.profiles (stripe_account_id) VALUES ($1)", [v]);
    return true;
  } catch {
    return false;
  }
}

check(!(await accepts("")), "'' is rejected");
check(!(await accepts("   ")), "'   ' is rejected");
check(await accepts(null), "NULL is accepted");
check(await accepts("acct_1ABC"), "a real acct_ id is accepted");
const { rows } = await db.query(
  "SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'profiles_stripe_account_id_not_blank'",
);
check(rows[0].n === 1, "exactly one constraint after 3x replay");

console.log(fails ? `${fails} FAIL` : "ALL PASS");
process.exit(fails ? 1 : 0);
