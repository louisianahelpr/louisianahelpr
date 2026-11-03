#!/usr/bin/env node
/**
 * PGlite proof for 20261103082037_payout_failure_notified_at (docs/OPEN.md Q2276 (b), (c)).
 *
 *   node src/test/pglite/payoutFailureNotifiedAt.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/payoutFailureNotifiedAt.pglite.mjs # RED: the live state
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR). Fixture: profiles (the two columns this reads)
 * and payout_failures' table DDL verbatim from 20261021030052.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const MIGDIR = "../../../supabase/migrations/";
const NEW = read(`${MIGDIR}20261103082037_payout_failure_notified_at.sql`);
const BASE = read(`${MIGDIR}20261021030052_payout_failures.sql`);
const TABLE = BASE.slice(BASE.indexOf("CREATE TABLE IF NOT EXISTS public.payout_failures"), BASE.indexOf(");", BASE.indexOf("CREATE TABLE IF NOT EXISTS public.payout_failures")) + 2);
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the live state (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const U1 = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const U2 = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";

const db = new PGlite();
await db.exec(`
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, stripe_account_id text);
INSERT INTO auth.users VALUES ('${U1}'), ('${U2}');
INSERT INTO public.profiles VALUES ('${U1}', 'acct_1'), ('${U2}', NULL);
${TABLE}
-- A failure recorded and told before the migration (the old handler deleted any row it could not tell).
INSERT INTO public.payout_failures (user_id, stripe_account_id, stripe_payout_id, stripe_event_id, amount_cents, created_at)
VALUES ('${U1}', 'acct_1', 'po_old', 'evt_old', 100, '2026-11-01T00:00:00Z');
`);

if (MODE !== "skip") {
  await db.exec(NEW);
  // A failure recorded after the migration whose notice has not gone out yet.
  await db.exec(`INSERT INTO public.payout_failures (user_id, stripe_account_id, stripe_payout_id, stripe_event_id, amount_cents) VALUES ('${U1}', 'acct_1', 'po_new', 'evt_new', 200)`);
  await db.exec(NEW);
  await db.exec(NEW);
}

const col = async () => (await db.query(`SELECT count(*)::int n FROM information_schema.columns WHERE table_name = 'payout_failures' AND column_name = 'notified_at'`)).rows[0].n === 1;
check("B1 payout_failures has notified_at", await col());
if (await col()) {
  const r = (await db.query(`SELECT stripe_payout_id p, notified_at FROM public.payout_failures ORDER BY p`)).rows;
  const old = r.find((x) => x.p === "po_old");
  const fresh = r.find((x) => x.p === "po_new");
  check("B2 a row told before the migration is stamped with its created_at", !!old?.notified_at && new Date(old.notified_at).toISOString() === "2026-11-01T00:00:00.000Z", JSON.stringify(old));
  check("B3 a replay never stamps a row still waiting for its notice", !!fresh && fresh.notified_at === null, JSON.stringify(fresh));
}
async function tryDup(sql) { try { await db.exec(sql); return true; } catch { return false; } }
check("C1 a second profile cannot link an account already linked", !(await tryDup(`UPDATE public.profiles SET stripe_account_id = 'acct_1' WHERE user_id = '${U2}'`)));
await db.exec(`UPDATE public.profiles SET stripe_account_id = NULL WHERE user_id = '${U2}'`);
check("C2 any number of profiles may have no payout account", await tryDup(`INSERT INTO auth.users VALUES ('5a1e0c2e-0b8e-4c55-9d1a-3f0f6f2c7b11'); INSERT INTO public.profiles VALUES ('5a1e0c2e-0b8e-4c55-9d1a-3f0f6f2c7b11', NULL)`));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
