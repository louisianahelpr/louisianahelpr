#!/usr/bin/env node
/**
 * PGlite proof for 20261102162029_declutter_manager_payouts_seed.sql (Builder 4, batch fix for PR #4014): a manager
 * payout written for a seed order is born is_seed = true (and a real order's false), and rows already written from a
 * seed order are backfilled. The trigger function is the real declutter_order_rows_seed (20261015042253).
 *
 *   node src/test/pglite/declutterManagerPayoutsSeed.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterManagerPayoutsSeed.pglite.mjs  # RED
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const skip = process.env.NEW_MIGRATION === "skip";
let pass = 0;
let fail = 0;
const ok = (cond, label, detail = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && detail ? `  (${detail})` : ""}`);
};

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, is_seed boolean NOT NULL DEFAULT false);
CREATE TABLE public.declutter_manager_payouts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL UNIQUE REFERENCES public.declutter_orders(id),
  share_cents integer NOT NULL DEFAULT 0, is_seed boolean NOT NULL DEFAULT false);`);
// The real trigger function, from its migration.
const slice4 = readFileSync(`${MIG_DIR}20261015042253_declutter_slice4_handover_payout.sql`, "utf8");
const fn = /CREATE OR REPLACE FUNCTION public\.declutter_order_rows_seed\(\)[\s\S]*?\$fn\$;/.exec(slice4);
if (!fn) throw new Error("declutter_order_rows_seed not found in 20261015042253");
await db.exec(fn[0]);

const SEED = "10000000-0000-0000-0000-000000000001";
const REAL = "10000000-0000-0000-0000-000000000002";
const OLD_SEED = "10000000-0000-0000-0000-000000000003";
await db.exec(`INSERT INTO public.declutter_orders VALUES ('${SEED}', true), ('${REAL}', false), ('${OLD_SEED}', true);
INSERT INTO public.declutter_manager_payouts (order_id) VALUES ('${OLD_SEED}');`);
if (!skip) {
  const sql = readFileSync(`${MIG_DIR}20261102162029_declutter_manager_payouts_seed.sql`, "utf8");
  for (let i = 0; i < 3; i++) {
    try {
      await db.exec(sql);
      ok(true, `the migration applies (run ${i + 1} of 3)`);
    } catch (e) {
      ok(false, `the migration applies (run ${i + 1} of 3)`, e.message);
    }
  }
}
await db.exec(`INSERT INTO public.declutter_manager_payouts (order_id) VALUES ('${SEED}'), ('${REAL}');`);
const seedOf = async (o) => (await db.query(`SELECT is_seed FROM public.declutter_manager_payouts WHERE order_id = '${o}'`)).rows[0]?.is_seed;
ok((await seedOf(SEED)) === true, "a seed order's manager payout is born is_seed = true");
ok((await seedOf(REAL)) === false, "a real order's manager payout is born is_seed = false");
ok((await seedOf(OLD_SEED)) === true, "a row already written from a seed order is backfilled");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
