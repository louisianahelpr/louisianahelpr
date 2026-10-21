#!/usr/bin/env node
/**
 * PGlite proof for 20261021142508_legacy_jobs_take_the_flat_helpr_fee.sql
 * (owner decision 2026-10-21: every legacy job whose Helpr is not paid yet
 * moves to the flat Helpr fee, 5% + $0.70).
 *
 *   npx tsx src/test/pglite/legacyJobsFlatFee.pglite.mjs [--replay] [--before]
 *
 * is_server_context and enforce_jobs_fee_model_lock are loaded from their
 * EFFECTIVE definitions before this migration (auth.uid() and auth.role() are
 * stubbed NULL: a migration runs with no JWT). The jobs
 * table carries only the columns read or written. Each stamped fee is checked
 * against the REAL TypeScript jobFlatFeeTotalCents (_shared/crewShares.ts).
 * --before leaves the migration out: every [fix] check must FAIL. Otherwise it
 * is applied (3x with --replay) and every check must PASS.
 *
 *   L1 [fix] the $60 "GIVE AWAY!!"-shaped job (escrow, tier 12%): 70c / 5%, fee $3.70, take-home $56.30
 *   L2 [fix] an urgent legacy job: the fee is on budget + bonus, equal to the TypeScript
 *   K9 [keep] a legacy crew is untouched (its unfilled-spot refund would keep Stripe's fee twice)
 *   L3 [fix] a legacy job waiting for its payout (payout_pending) is stamped
 *   K1 [keep] a released legacy job is untouched
 *   K2 [keep] an unpaid legacy job is untouched (create-payment stamps it at funding)
 *   K3 [keep] a job already on the flat model keeps its stamp
 *   K4 [keep] a poster-fee job is untouched
 *   K5 [keep] a legacy series parent in escrow is untouched
 *   K6 [keep] a legacy crew already partly paid (a payout_transfers row) is untouched
 *   K7 [keep] replay: a second and third run change nothing
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { effectiveDefs } from "../helpers/effectiveFunctionDefs.ts";
import { jobFlatFeeTotalCents } from "../../../supabase/functions/_shared/crewShares.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261021142508_legacy_jobs_take_the_flat_helpr_fee.sql";
const REPLAY = process.argv.includes("--replay");
const BEFORE = process.argv.includes("--before");

const DEFS = effectiveDefs(DIR, { before: THIS });
function fnStmt(name) {
  const d = DEFS.get(name);
  if (!d) throw new Error(`no migration before ${THIS} defines ${name}`);
  const open = /\bAS\s+(\$\w*\$)/i.exec(d.stmt);
  const end = d.stmt.indexOf(open[1], open.index + open[0].length);
  return `${d.stmt.slice(0, end + open[1].length)};`;
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
await db.exec(`
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT NULL::uuid $f$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $f$ SELECT NULL::text $f$;
CREATE TABLE public.jobs (
  id text PRIMARY KEY, title text, budget numeric(10,2), is_urgent boolean DEFAULT false, urgent_fee numeric,
  is_group_job boolean DEFAULT false, helpers_needed integer DEFAULT 1, payment_status text,
  helper_fee_percent numeric, helper_fee_flat_cents integer, poster_fee_flat_cents integer,
  platform_fee_amount numeric(10,2), customer_fee_amount numeric(10,2),
  recurrence_days smallint[], parent_job_id text
);
CREATE TABLE public.payout_transfers (id serial PRIMARY KEY, job_id text);
${fnStmt("is_server_context")}
${fnStmt("enforce_jobs_fee_model_lock")}
CREATE TRIGGER jobs_fee_model_lock BEFORE INSERT OR UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_jobs_fee_model_lock();
INSERT INTO public.jobs (id, title, budget, is_urgent, urgent_fee, is_group_job, helpers_needed, payment_status,
  helper_fee_percent, helper_fee_flat_cents, poster_fee_flat_cents, platform_fee_amount, customer_fee_amount, recurrence_days) VALUES
  ('L1', 'GIVE AWAY!!', 60, false, 0, false, 1, 'escrow', 12, NULL, NULL, 7.20, 7.20, NULL),
  ('L2', 'Urgent', 100, true, 10, false, 1, 'escrow', 12, NULL, NULL, 12.00, 0, NULL),
  ('K9', 'Crew', 100, true, 10, true, 3, 'escrow', NULL, NULL, NULL, NULL, 0, NULL),
  ('L3', 'Done, payout due', 80, false, NULL, false, 1, 'payout_pending', 12, NULL, NULL, 9.60, 0, NULL),
  ('K1', 'Released', 50, false, NULL, false, 1, 'released', 12, NULL, NULL, 6.00, 0, NULL),
  ('K2', 'Unpaid', 40, false, NULL, false, 1, 'unpaid', NULL, NULL, NULL, NULL, 0, NULL),
  ('K3', 'Flat', 100, false, NULL, false, 1, 'escrow', 5, 70, NULL, 5.70, 0, NULL),
  ('K4', 'Poster fee', 100, false, NULL, false, 1, 'escrow', 0, 0, 570, 0, 5.70, NULL),
  ('K5', 'Series', 70, false, NULL, false, 1, 'escrow', 12, NULL, NULL, 8.40, 0, ARRAY[1]::smallint[]),
  ('K6', 'Crew part paid', 90, false, NULL, true, 2, 'escrow', NULL, NULL, NULL, NULL, 0, NULL);
INSERT INTO public.payout_transfers (job_id) VALUES ('K6');
`);
const snapshot = async () => JSON.stringify((await db.query("SELECT * FROM public.jobs ORDER BY id")).rows);
const untouched = await snapshot();

const MIGRATION = readFileSync(DIR + THIS, "utf8");
if (!BEFORE) await db.exec(MIGRATION);
const afterOne = await snapshot();
if (!BEFORE && REPLAY) for (let i = 0; i < 2; i++) await db.exec(MIGRATION);
const row = async (id) => (await db.query(`SELECT * FROM public.jobs WHERE id = $1`, [id])).rows[0];
const cents = (v) => Math.round(Number(v) * 100);
const stamped = (r) => r.helper_fee_flat_cents === 70 && Number(r.helper_fee_percent) === 5;

const l1 = await row("L1");
check("L1 [fix] the $60 legacy job: 70c / 5%, fee $3.70, take-home $56.30",
  stamped(l1) && cents(l1.platform_fee_amount) === 370 && jobFlatFeeTotalCents(6000, 0, 1) === 370 && 6000 - cents(l1.platform_fee_amount) === 5630,
  JSON.stringify({ flat: l1.helper_fee_flat_cents, pct: l1.helper_fee_percent, fee: l1.platform_fee_amount }));
const l2 = await row("L2");
const l2ts = jobFlatFeeTotalCents(10000, 1000, 1);
check("L2 [fix] an urgent legacy job: the fee is on budget + bonus, equal to the TypeScript",
  stamped(l2) && cents(l2.platform_fee_amount) === l2ts, `sql ${l2.platform_fee_amount}, ts ${l2ts}c`);
const l3 = await row("L3");
check("L3 [fix] a legacy job waiting for its payout is stamped",
  stamped(l3) && cents(l3.platform_fee_amount) === jobFlatFeeTotalCents(8000, 0, 1), JSON.stringify(l3));
const before = JSON.parse(untouched);
const same = async (id) => JSON.stringify(await row(id)) === JSON.stringify(before.find((r) => r.id === id));
check("K1 [keep] a released legacy job is untouched", await same("K1"));
check("K2 [keep] an unpaid legacy job is untouched", await same("K2"));
check("K3 [keep] a flat-model job keeps its stamp", await same("K3"));
check("K4 [keep] a poster-fee job is untouched", await same("K4"));
check("K5 [keep] a legacy series parent is untouched", await same("K5"));
check("K6 [keep] a legacy crew already partly paid is untouched", await same("K6"));
check("K9 [keep] a legacy crew is untouched", await same("K9"));
check("K7 [keep] replay changes nothing", (await snapshot()) === afterOne);
check("K8 [keep] the poster side is never touched (customer_fee_amount)",
  JSON.parse(await snapshot()).every((r) => r.customer_fee_amount === before.find((b) => b.id === r.id).customer_fee_amount));

if (BEFORE) {
  console.log(failures > 0 ? `RED as expected (${failures} failing before the migration)` : "UNEXPECTED: all passed before the migration");
  process.exit(failures > 0 ? 0 : 1);
}
console.log(failures === 0 ? `ALL PASS${REPLAY ? " (applied 3x)" : ""}` : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
