#!/usr/bin/env node
/**
 * PGlite proof for 20261102080407_helpr_fault_fee_clamp_and_reversed_restore
 * (Q2172 b, c, d; lead 11-02: B1 + C1's clamp).
 *
 *   node src/test/pglite/helprFaultFeeClamp.pglite.mjs                    # AFTER: base + new migration 3x
 *   NEW_MIGRATION=skip node src/test/pglite/helprFaultFeeClamp.pglite.mjs # RED: base only
 *   PLANT=<name> node src/test/pglite/helprFaultFeeClamp.pglite.mjs       # a planted defect must go RED
 *     PLANT=anon_grant        clamp keeps Supabase's default EXECUTE for anon/authenticated
 *     PLANT=reversed_blocks   restore still refuses after a reversed transfer (the old list)
 *     PLANT=clamp_oldest      clamp gives back the OLDEST debt first
 *     PLANT=clamp_paid        clamp gives back what a paid payout withheld
 *     PLANT=clamp_no_return   clamp deletes the deduction but the debt stays read as paid
 *     PLANT=clamp_keeps_all   clamp gives nothing back (returns the cap anyway)
 *
 * (No restore grant plant: CREATE OR REPLACE keeps the ACL the base migration
 * already revoked, so dropping the restate's REVOKE changes nothing; measured.)
 * Supabase's default grant is emulated: ALTER DEFAULT PRIVILEGES grants EXECUTE
 * on new functions to anon and authenticated before any migration runs.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const BASE1 = read("../../../supabase/migrations/20261019015303_helpr_fault_payout_deduction.sql");
const BASE2 = read("../../../supabase/migrations/20261102072106_helpr_card_fee_debts.sql");
let NEW = read("../../../supabase/migrations/20261102080407_helpr_fault_fee_clamp_and_reversed_restore.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
const PLANT = process.env.PLANT ?? "";
const plant = (find, repl) => {
  if (!NEW.includes(find)) throw new Error(`plant ${PLANT}: find-string not in the migration`);
  NEW = NEW.split(find).join(repl);
};
if (PLANT === "anon_grant") plant("REVOKE ALL ON FUNCTION public.clamp_helpr_fault_fee(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;", "SELECT 1;");
if (PLANT === "reversed_blocks") plant("AND pt.status IN ('pending', 'paid')) THEN", "AND pt.status IN ('pending', 'paid', 'reversed')) THEN");
if (PLANT === "clamp_oldest") plant("ORDER BY created_at DESC, kind DESC, debt_id DESC", "ORDER BY created_at, kind, debt_id");
if (PLANT === "clamp_paid") plant("AND pt.status = 'paid') THEN\n    RAISE EXCEPTION 'payout_already_paid'", "AND false) THEN\n    RAISE EXCEPTION 'payout_already_paid'");
if (PLANT === "clamp_no_return") plant("         SET remaining_cents = least(card_fee_cents, remaining_cents + v_back)", "         SET remaining_cents = remaining_cents");
if (PLANT === "clamp_keeps_all") plant("    EXIT WHEN v_excess <= 0;\n    v_back", "    EXIT WHEN true;\n    v_back");
if (MODE) console.log(`NEW_MIGRATION=${MODE}: base state only (expect FAILs)`);
if (PLANT) console.log(`PLANT=${PLANT} (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const HELPR = "a0000000-0000-4000-8000-000000000002";
const POSTER = "a0000000-0000-4000-8000-000000000001";
const SERIES = "c0000000-0000-4000-8000-000000000001";
const JOB_R = "c0000000-0000-4000-8000-000000000002"; // reversed -> failed -> restore -> retake
const JOB_C = "c0000000-0000-4000-8000-000000000003"; // clamp
const JOB_P = "c0000000-0000-4000-8000-000000000004"; // paid
const RULING_JOB = "c0000000-0000-4000-8000-000000000005";
const VISIT1 = "d0000000-0000-4000-8000-000000000001";
const VISIT2 = "d0000000-0000-4000-8000-000000000002";

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
  CREATE TYPE public.app_role AS ENUM ('admin', 'user');
  CREATE FUNCTION public.has_role(uuid, public.app_role) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
  CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, is_seed boolean NOT NULL DEFAULT false);
  CREATE TABLE public.recurring_visit_payments (
    id uuid PRIMARY KEY, parent_job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
    helper_id uuid, amount_cents integer NOT NULL, stripe_payment_intent_id text, status text NOT NULL DEFAULT 'pending');
  CREATE TABLE public.payout_transfers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, status text NOT NULL);
  CREATE TABLE public.job_helpr_fault_rulings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL UNIQUE REFERENCES public.jobs(id),
    helper_id uuid, card_fee_cents integer, card_fee_remaining_cents integer,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT job_helpr_fault_fee_remaining CHECK (
      (card_fee_cents IS NULL AND card_fee_remaining_cents IS NULL)
      OR (card_fee_cents IS NOT NULL AND card_fee_remaining_cents BETWEEN 0 AND card_fee_cents)));
  INSERT INTO auth.users VALUES ('${HELPR}'), ('${POSTER}');
  INSERT INTO public.jobs (id, customer_id) VALUES ('${SERIES}', '${POSTER}'), ('${JOB_R}', '${POSTER}'), ('${JOB_C}', '${POSTER}'), ('${JOB_P}', '${POSTER}'), ('${RULING_JOB}', '${POSTER}');
  INSERT INTO public.recurring_visit_payments VALUES
    ('${VISIT1}', '${SERIES}', '${HELPR}', 32000, 'pi_1', 'paid'),
    ('${VISIT2}', '${SERIES}', '${HELPR}', 32000, 'pi_2', 'paid');
`);
await db.exec(BASE1);
await db.exec(BASE2);
if (MODE !== "skip") {
  for (let i = 1; i <= 3; i++) {
    await db.exec(NEW);
    console.log(`applied ${i}x`);
  }
}

async function val(sql) {
  try {
    const r = await db.query(sql);
    return Object.values(r.rows[0] ?? {})[0];
  } catch (e) {
    return `ERR ${String(e.message)}`;
  }
}
const owed = async () => (await val(`SELECT
  COALESCE((SELECT sum(card_fee_remaining_cents) FROM public.job_helpr_fault_rulings WHERE helper_id = '${HELPR}'), 0)::int
  + COALESCE((SELECT sum(remaining_cents) FROM public.helpr_card_fee_debts WHERE helper_id = '${HELPR}'), 0)::int`));
const booked = async (job) => (await val(`SELECT
  COALESCE((SELECT sum(deducted_cents) FROM public.job_helpr_fault_fee_deductions WHERE payout_ref = 'job_payout_${job}'), 0)::int
  + COALESCE((SELECT sum(deducted_cents) FROM public.helpr_card_fee_debt_deductions WHERE payout_ref = 'job_payout_${job}'), 0)::int`));

// Owed: ruling 300 (3 days old), debt 958 (2 days), debt 500 (1 day) = 1758.
await db.exec(`INSERT INTO public.job_helpr_fault_rulings (job_id, helper_id, card_fee_cents, card_fee_remaining_cents, created_at)
  VALUES ('${RULING_JOB}', '${HELPR}', 300, 300, now() - interval '3 days')`);
await val(`SELECT public.bill_helpr_card_fee_debt('${VISIT1}', 958, 're_1')`);
await val(`SELECT public.bill_helpr_card_fee_debt('${VISIT2}', 500, 're_2')`);
await db.exec(`UPDATE public.helpr_card_fee_debts SET created_at = now() - interval '2 days' WHERE recurring_visit_payment_id = '${VISIT1}'`);
await db.exec(`UPDATE public.helpr_card_fee_debts SET created_at = now() - interval '1 day' WHERE recurring_visit_payment_id = '${VISIT2}'`);
check("setup: 1758 owed", (await owed()) === 1758, String(await owed()));

// ── (b) a reversed transfer no longer blocks the restore ──────────────
check("b: a payout takes 400", (await val(`SELECT public.take_helpr_fault_fee('${HELPR}', 'job_payout_${JOB_R}', 400)`)) === 400);
await db.exec(`INSERT INTO public.payout_transfers (job_id, helper_id, status) VALUES ('${JOB_R}', '${HELPR}', 'reversed'), ('${JOB_R}', '${HELPR}', 'failed')`);
const back = await val(`SELECT public.restore_helpr_fault_fee('${HELPR}', '${JOB_R}')`);
check("b: after reversed -> failed, restore gives the 400 back", back === 400, String(back));
check("b: the debt reads owed again (1758)", (await owed()) === 1758, String(await owed()));
check("b: the next attempt takes it again under the same ref", (await val(`SELECT public.take_helpr_fault_fee('${HELPR}', 'job_payout_${JOB_R}', 400)`)) === 400);
await db.exec(`INSERT INTO public.payout_transfers (job_id, helper_id, status) VALUES ('${JOB_R}', '${HELPR}', 'pending')`);
check("b: a pending (in-flight) payout still blocks the restore", (await val(`SELECT public.restore_helpr_fault_fee('${HELPR}', '${JOB_R}')`)) === 0);
await db.exec(`UPDATE public.payout_transfers SET status = 'paid' WHERE job_id = '${JOB_R}' AND status = 'pending'`);
check("b: a paid payout still blocks the restore", (await val(`SELECT public.restore_helpr_fault_fee('${HELPR}', '${JOB_R}')`)) === 0);
check("b: the paid payout's 400 stays booked", (await booked(JOB_R)) === 400, String(await booked(JOB_R)));
// Owed now 1358: ruling 0, debt1 858, debt2 500.

// ── (c)/(d) clamp ─────────────────────────────────────────────────────
check("clamp: a payout takes 1000 (debt1 858 + debt2 142)", (await val(`SELECT public.take_helpr_fault_fee('${HELPR}', 'job_payout_${JOB_C}', 1000)`)) === 1000);
check("clamp: above the booked total is a no-op (returns 1000)", (await val(`SELECT public.clamp_helpr_fault_fee('${HELPR}', '${JOB_C}', 5000)`)) === 1000);
const c600 = await val(`SELECT public.clamp_helpr_fault_fee('${HELPR}', '${JOB_C}', 600)`);
check("clamp: to 600 returns 600", c600 === 600, String(c600));
check("clamp: 600 stays booked", (await booked(JOB_C)) === 600, String(await booked(JOB_C)));
check("clamp: the NEWEST debt is given back first (debt2 owes all 500 again)",
  (await val(`SELECT remaining_cents FROM public.helpr_card_fee_debts WHERE recurring_visit_payment_id = '${VISIT2}'`)) === 500);
check("clamp: then the older one, partly (debt1 owes 258)",
  (await val(`SELECT remaining_cents FROM public.helpr_card_fee_debts WHERE recurring_visit_payment_id = '${VISIT1}'`)) === 258);
check("clamp: nothing lost (owed + booked = 1758 - 400 paid)", (await owed()) + (await booked(JOB_C)) === 1358, `${await owed()} + ${await booked(JOB_C)}`);
check("clamp: a retry of take now answers the clamped 600", (await val(`SELECT public.take_helpr_fault_fee('${HELPR}', 'job_payout_${JOB_C}', 5000)`)) === 600);
const c0 = await val(`SELECT public.clamp_helpr_fault_fee('${HELPR}', '${JOB_C}', 0)`);
check("clamp: to 0 gives everything back", c0 === 0 && (await booked(JOB_C)) === 0, String(c0));
check("clamp: every cent owed again (1358)", (await owed()) === 1358, String(await owed()));
const paid = await val(`SELECT public.clamp_helpr_fault_fee('${HELPR}', '${JOB_R}', 0)`);
check("clamp: refused once a paid payout carries the deduction", /payout_already_paid/.test(String(paid)), String(paid));
check("clamp: the paid payout's deduction is untouched", (await booked(JOB_R)) === 400);
const neg = await val(`SELECT public.clamp_helpr_fault_fee('${HELPR}', '${JOB_C}', -1)`);
check("clamp: a negative cap is refused", /invalid_payout/.test(String(neg)), String(neg));
const nul = await val(`SELECT public.clamp_helpr_fault_fee(NULL, '${JOB_C}', 0)`);
check("clamp: a missing Helpr is refused", /invalid_payout/.test(String(nul)), String(nul));

// ── grants ───────────────────────────────────────────────────────────
for (const fn of ["public.clamp_helpr_fault_fee(uuid, uuid, integer)", "public.restore_helpr_fault_fee(uuid, uuid)"]) {
  for (const role of ["anon", "authenticated"]) {
    check(`grant: ${role} cannot execute ${fn.split("(")[0]}`, (await val(`SELECT has_function_privilege('${role}', '${fn}', 'EXECUTE')`)) === false);
  }
  check(`grant: service_role executes ${fn.split("(")[0]}`, (await val(`SELECT has_function_privilege('service_role', '${fn}', 'EXECUTE')`)) === true);
}

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
