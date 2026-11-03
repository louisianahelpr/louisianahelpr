#!/usr/bin/env node
/**
 * Q1908 (PGlite proof for 20261103112413_redrive_rows_store_stripe_mode): the two re-drive ledgers
 * (tip_hold_redrives, chargeback_clawbacks) carry a nullable stripe_mode the webhook writes from the Stripe
 * object's livemode, so a re-pay runs where the money sits.
 *   (a) each table takes stripe_mode 'live', 'test' and NULL;
 *   (b) any other value is refused (23514), on both tables;
 *   (c) a row that existed before the migration keeps NULL (no backfill: NULL means "fall back to the job");
 *   (d) grants unchanged: anon and authenticated still hold no privilege on tip_hold_redrives, and
 *       authenticated still only SELECT on chargeback_clawbacks;
 *   (e) the file replays 3x.
 *
 *   node src/test/pglite/redriveRowsStoreStripeMode.pglite.mjs                     # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/redriveRowsStoreStripeMode.pglite.mjs  # RED: no column to write
 *
 * Stubbed, said so: both tables reduced to the columns this needs, with their real grants
 * (20261004220059, 20260923154149). pglite is loaded from ~/.lh-pglite (not a dependency).
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = new URL("../../../supabase/migrations/20261103112413_redrive_rows_store_stripe_mode.sql", import.meta.url).pathname;
const skip = process.env.NEW_MIGRATION === "skip";

let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE public.tip_hold_redrives (tip_id uuid PRIMARY KEY, helper_id uuid, status text NOT NULL);
REVOKE ALL ON TABLE public.tip_hold_redrives FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.tip_hold_redrives TO service_role;
CREATE TABLE public.chargeback_clawbacks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dispute_id text, original_transfer_id text, status text NOT NULL);
REVOKE ALL ON TABLE public.chargeback_clawbacks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.chargeback_clawbacks TO authenticated;
GRANT ALL ON TABLE public.chargeback_clawbacks TO service_role;
INSERT INTO public.tip_hold_redrives VALUES ('00000000-0000-4000-8000-000000000001', gen_random_uuid(), 'reversed');
INSERT INTO public.chargeback_clawbacks (dispute_id, original_transfer_id, status) VALUES ('dp_old', 'tr_old', 'reversed');
`);
if (!skip) { const sql = readFileSync(MIG, "utf8"); for (let k = 1; k <= 3; k++) await db.exec(sql); }

const q = async (s, p = []) => (await db.query(s, p)).rows;
const tryq = async (s, p = []) => { try { await db.query(s, p); return null; } catch (e) { return e; } };

let n = 2;
for (const mode of ["live", "test", null]) {
  const e1 = await tryq(`INSERT INTO public.tip_hold_redrives (tip_id, helper_id, status, stripe_mode) VALUES ($1, gen_random_uuid(), 'owed', $2)`,
    [`00000000-0000-4000-8000-00000000000${n++}`, mode]);
  check(e1 === null, `(a) tip_hold_redrives takes stripe_mode ${mode}`, e1?.message);
  const e2 = await tryq(`INSERT INTO public.chargeback_clawbacks (dispute_id, original_transfer_id, status, stripe_mode) VALUES ('dp_1', $1, 'reversing', $2)`,
    [`tr_${mode}`, mode]);
  check(e2 === null, `(a) chargeback_clawbacks takes stripe_mode ${mode}`, e2?.message);
}
const bad1 = await tryq(`INSERT INTO public.tip_hold_redrives (tip_id, helper_id, status, stripe_mode) VALUES (gen_random_uuid(), gen_random_uuid(), 'owed', 'sandbox')`);
check(bad1?.code === "23514", "(b) tip_hold_redrives refuses stripe_mode 'sandbox' (23514)", bad1?.code ?? bad1?.message ?? "accepted");
const bad2 = await tryq(`INSERT INTO public.chargeback_clawbacks (dispute_id, original_transfer_id, status, stripe_mode) VALUES ('dp_2', 'tr_x', 'reversing', 'LIVE')`);
check(bad2?.code === "23514", "(b) chargeback_clawbacks refuses stripe_mode 'LIVE' (23514)", bad2?.code ?? bad2?.message ?? "accepted");


const oldTip = await q(`SELECT stripe_mode FROM public.tip_hold_redrives WHERE tip_id = '00000000-0000-4000-8000-000000000001'`).catch((e) => [{ err: e.message }]);
check(oldTip.length === 1 && oldTip[0].stripe_mode === null && !oldTip[0].err, "(c) a tip row from before the migration keeps NULL", oldTip[0]?.err);
const oldCb = await q(`SELECT stripe_mode FROM public.chargeback_clawbacks WHERE dispute_id = 'dp_old'`).catch((e) => [{ err: e.message }]);
check(oldCb.length === 1 && oldCb[0].stripe_mode === null && !oldCb[0].err, "(c) a clawback row from before the migration keeps NULL", oldCb[0]?.err);

const priv = async (role, table, p) => (await q(`SELECT has_table_privilege($1, $2, $3) AS ok`, [role, table, p]))[0].ok;
check(!(await priv("anon", "public.tip_hold_redrives", "SELECT")) && !(await priv("authenticated", "public.tip_hold_redrives", "SELECT")),
  "(d) anon/authenticated still cannot read tip_hold_redrives");
check(await priv("authenticated", "public.chargeback_clawbacks", "SELECT") && !(await priv("authenticated", "public.chargeback_clawbacks", "INSERT")),
  "(d) authenticated still only reads chargeback_clawbacks");
const cons = await q(`SELECT count(*)::int AS n FROM pg_constraint WHERE conname IN ('tip_hold_redrives_stripe_mode_check', 'chargeback_clawbacks_stripe_mode_check')`);
check(cons[0].n === 2, "(e) after 3 applies there is exactly one CHECK per table", String(cons[0].n));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
