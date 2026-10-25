#!/usr/bin/env node
/**
 * PGlite proof for 20261025161802_paid_job_fees_are_fixed.sql: once a job is
 * paid, SQL does not rewrite its fee fields unless a migration opts in.
 *
 *   npx tsx src/test/pglite/paidJobFeesAreFixed.pglite.mjs [--replay] [--before]
 *
 * auth.role() is stubbed to read the test-only setting test.role ('' = no JWT,
 * as a migration or the SQL editor runs). The jobs table carries only the
 * columns the trigger reads. The 20261021142508 restamp UPDATE is run VERBATIM
 * (read from its migration file) as the incident's shape. --before leaves this
 * migration out: every [fix] check must FAIL. Otherwise it is applied (3x with
 * --replay) and every check must PASS.
 *
 *   F1 [fix] the 20261021142508 restamp, verbatim, on a paid job (escrow) is refused; the row keeps its fees
 *   F2 [fix] a signed-in member changing a paid job's customer_fee_amount is refused
 *   F3 [fix] a hand UPDATE (no JWT, no opt-in) of a released job's platform_fee_amount is refused
 *   F4 [fix] a signed-in member is refused even with the opt-in setting
 *   F5 [fix] a service_role JWT claim without the service_role session role is refused
 *   K1 [keep] the edge functions (service_role) still record the fee at release
 *   K2 [keep] a migration that opts in (SET LOCAL app.paid_job_fee_rewrite) restamps a paid job
 *   K3 [keep] an unpaid job is re-priced freely (create-payment stamps it at funding)
 *   K4 [keep] the funding write itself (unpaid -> escrow with its fee stamp, one statement) passes
 *   K5 [keep] a failed / abandoned job may be re-priced by a new checkout
 *   K6 [keep] a paid job's other columns still change (status, title)
 *   K7 [keep] an UPDATE that rewrites a fee to the SAME value passes
 *   K8 [keep] the trigger function is not executable by PUBLIC/anon/authenticated
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261025161802_paid_job_fees_are_fixed.sql";
const RESTAMP = "20261021142508_legacy_jobs_take_the_flat_helpr_fee.sql";
const REPLAY = process.argv.includes("--replay");
const BEFORE = process.argv.includes("--before");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT NULL::uuid $f$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('test.role', true), '') $f$;
CREATE TABLE public.jobs (
  id text PRIMARY KEY, title text, status text DEFAULT 'open', budget numeric(10,2), urgent_fee numeric,
  is_group_job boolean DEFAULT false, payment_status text,
  helper_fee_percent numeric, helper_fee_flat_cents integer, poster_fee_flat_cents integer,
  platform_fee_amount numeric(10,2), platform_fee_percent numeric, customer_fee_amount numeric(10,2),
  recurrence_days smallint[], parent_job_id text
);
CREATE TABLE public.payout_transfers (id serial PRIMARY KEY, job_id text);
GRANT USAGE ON SCHEMA auth TO service_role; GRANT ALL ON public.jobs TO service_role;
INSERT INTO public.jobs (id, title, budget, payment_status, helper_fee_percent, helper_fee_flat_cents, platform_fee_amount, platform_fee_percent, customer_fee_amount) VALUES
  ('P1', 'GIVE AWAY!! (11f8b084 shape)', 60, 'escrow', 12, NULL, 7.20, 12, 7.20),
  ('P2', 'Paid, member edit', 50, 'escrow', 5, 70, 3.20, 0, 0),
  ('P3', 'Released', 50, 'released', 12, NULL, 6.00, 12, 6.00),
  ('P4', 'Release records its fee', 50, 'payout_pending', 12, NULL, 6.00, 12, 6.00),
  ('P5', 'Owner-decided restamp', 60, 'escrow', 12, NULL, 7.20, 12, 7.20),
  ('U1', 'Unpaid', 40, 'unpaid', NULL, NULL, NULL, NULL, 0),
  ('U2', 'Being funded', 40, 'unpaid', NULL, NULL, NULL, NULL, 0),
  ('U3', 'Bank payment failed', 40, 'failed', 12, NULL, 4.80, 12, 4.80),
  ('U4', 'Checkout expired', 40, 'abandoned', 12, NULL, 4.80, 12, 4.80),
  ('P6', 'Paid, other columns', 30, 'escrow', 5, 70, 2.20, 0, 0);
`);

const migrationSql = readFileSync(`${DIR}${THIS}`, "utf8");
if (!BEFORE) {
  for (let i = 0; i < (REPLAY ? 3 : 1); i++) await db.exec(migrationSql);
}

/** Run as a role; '' = no JWT (a migration). Returns the error message or null. */
async function as(role, sql, { optIn = null } = {}) {
  try {
    // 'service_role' = the edge functions: the JWT claim AND the session role
    // (PostgREST SET ROLE). 'claim:service_role' = the claim alone.
    const claim = role.startsWith("claim:") ? role.slice(6) : role;
    const setRole = role === "service_role" ? " SET LOCAL ROLE service_role;" : "";
    await db.exec(`BEGIN; SELECT set_config('test.role', '${claim}', true);${setRole}${optIn ? ` SET LOCAL app.paid_job_fee_rewrite = '${optIn}';` : ""} ${sql}; COMMIT;`);
    return null;
  } catch (e) {
    await db.exec("ROLLBACK;").catch(() => {});
    return String(e?.message ?? e);
  }
}
const row = async (id) => (await db.query(`SELECT * FROM public.jobs WHERE id = $1`, [id])).rows[0];

// The incident's UPDATE, verbatim: the DO block of 20261021142508, scoped to P1.
const restamp = readFileSync(`${DIR}${RESTAMP}`, "utf8").replace("AND p.pay_cents > 0", "AND p.pay_cents > 0 AND j.id = 'P1'");
{
  const err = await as("", restamp.replace(/;\s*$/, ""));
  const p1 = await row("P1");
  check("F1 [fix] the 20261021142508 restamp, verbatim, on a paid job is refused; the row keeps its fees",
    /paid_job_fee_fixed/.test(err ?? "") && Number(p1.helper_fee_percent) === 12 && p1.helper_fee_flat_cents === null && Number(p1.platform_fee_amount) === 7.2,
    err ?? `no error; now ${p1.helper_fee_percent}% / ${p1.helper_fee_flat_cents}c / ${p1.platform_fee_amount}`);
}
{
  const err = await as("authenticated", `UPDATE public.jobs SET customer_fee_amount = 1.00 WHERE id = 'P2'`);
  check("F2 [fix] a signed-in member changing a paid job's customer_fee_amount is refused", /paid_job_fee_fixed/.test(err ?? ""), err ?? "no error");
}
{
  const err = await as("", `UPDATE public.jobs SET platform_fee_amount = 1.00 WHERE id = 'P3'`);
  check("F3 [fix] a hand UPDATE (no JWT, no opt-in) of a released job's platform_fee_amount is refused", /paid_job_fee_fixed/.test(err ?? ""), err ?? "no error");
}
{
  const err = await as("authenticated", `UPDATE public.jobs SET helper_fee_percent = 0 WHERE id = 'P2'`, { optIn: "member says so" });
  check("F4 [fix] a signed-in member is refused even with the opt-in setting", /paid_job_fee_fixed/.test(err ?? ""), err ?? "no error");
}
{
  const err = await as("claim:service_role", `UPDATE public.jobs SET platform_fee_amount = 1.00 WHERE id = 'P2'`);
  check("F5 [fix] a service_role JWT claim without the service_role session role is refused", /paid_job_fee_fixed/.test(err ?? ""), err ?? "no error");
}
{
  const err = await as("service_role", `UPDATE public.jobs SET payment_status = 'released', platform_fee_amount = 5.00, helper_fee_percent = 10 WHERE id = 'P4'`);
  const p4 = await row("P4");
  check("K1 [keep] the edge functions (service_role) still record the fee at release", err === null && Number(p4.platform_fee_amount) === 5, err ?? "");
}
{
  const err = await as("", restamp.replace("AND j.id = 'P1'", "AND j.id = 'P5'").replace(/;\s*$/, ""), { optIn: "owner decision 2026-10-21 (Q?): legacy jobs take the flat Helpr fee" });
  const p5 = await row("P5");
  check("K2 [keep] a migration that opts in (SET LOCAL app.paid_job_fee_rewrite) restamps a paid job",
    err === null && Number(p5.helper_fee_percent) === 5 && p5.helper_fee_flat_cents === 70 && Number(p5.platform_fee_amount) === 3.7, err ?? `${p5.helper_fee_percent}/${p5.helper_fee_flat_cents}/${p5.platform_fee_amount}`);
}
{
  const err = await as("authenticated", `UPDATE public.jobs SET customer_fee_amount = 4.80, platform_fee_percent = 12 WHERE id = 'U1'`);
  check("K3 [keep] an unpaid job is re-priced freely", err === null, err ?? "");
}
{
  const err = await as("", `UPDATE public.jobs SET payment_status = 'escrow', helper_fee_percent = 5, helper_fee_flat_cents = 70, platform_fee_amount = 2.70 WHERE id = 'U2'`);
  check("K4 [keep] the funding write itself (unpaid -> escrow with its fee stamp, one statement) passes", err === null, err ?? "");
}
{
  const e1 = await as("", `UPDATE public.jobs SET helper_fee_percent = 5, helper_fee_flat_cents = 70 WHERE id = 'U3'`);
  const e2 = await as("", `UPDATE public.jobs SET helper_fee_percent = 5, helper_fee_flat_cents = 70 WHERE id = 'U4'`);
  check("K5 [keep] a failed / abandoned job may be re-priced by a new checkout", e1 === null && e2 === null, `${e1 ?? ""} ${e2 ?? ""}`);
}
{
  const err = await as("authenticated", `UPDATE public.jobs SET status = 'in_progress', title = 'renamed' WHERE id = 'P6'`);
  check("K6 [keep] a paid job's other columns still change", err === null, err ?? "");
}
{
  const err = await as("", `UPDATE public.jobs SET platform_fee_amount = 2.20, helper_fee_flat_cents = 70 WHERE id = 'P6'`);
  check("K7 [keep] an UPDATE that rewrites a fee to the SAME value passes", err === null, err ?? "");
}
if (!BEFORE) {
  const acl = (await db.query(`SELECT coalesce(proacl::text, '') AS acl FROM pg_proc WHERE proname = 'enforce_paid_job_fee_fields_fixed'`)).rows[0]?.acl ?? "";
  check("K8 [keep] the trigger function is not executable by PUBLIC/anon/authenticated",
    acl !== "" && !/(^|[{,])=X/.test(acl) && !/anon=X/.test(acl) && !/authenticated=X/.test(acl), acl);
}

console.log(failures === 0 ? "ALL PASS" : `${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
