#!/usr/bin/env node
/**
 * PGlite proof for 20261102072106_helpr_card_fee_debts (Q2245 step a): a
 * lapsed Helpr's card-fee debt for a fully refunded series visit, billed once
 * per visit payment and taken from their next job payout by the SAME
 * take/restore pair as the at-fault card fee.
 *
 *   node src/test/pglite/helprCardFeeDebts.pglite.mjs                    # AFTER: base + new migration 3x
 *   NEW_MIGRATION=skip node src/test/pglite/helprCardFeeDebts.pglite.mjs # RED: base only
 *   PLANT=<name> node src/test/pglite/helprCardFeeDebts.pglite.mjs       # a planted defect must go RED
 *     PLANT=anon_grant     bill_helpr_card_fee_debt keeps Supabase's default EXECUTE for anon/authenticated
 *     PLANT=bill_twice     no one-debt-per-visit rule (a re-run sweep bills again)
 *     PLANT=no_cap         the bill is not capped at the visit's charge
 *     PLANT=take_skips     take_helpr_fault_fee ignores the card-fee debts
 *     PLANT=retry_twice    a retried payout takes the card-fee debt again
 *     PLANT=restore_skips  restore_helpr_fault_fee leaves the card-fee deduction taken
 *     PLANT=any_helper     bill accepts a visit with no Helpr
 *
 * Supabase's default grant is emulated: ALTER DEFAULT PRIVILEGES grants EXECUTE
 * on new functions to anon and authenticated before any migration runs.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const BASE = read("../../../supabase/migrations/20261019015303_helpr_fault_payout_deduction.sql");
let NEW = read("../../../supabase/migrations/20261102072106_helpr_card_fee_debts.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
const PLANT = process.env.PLANT ?? "";
const plant = (find, repl) => {
  if (!NEW.includes(find)) throw new Error(`plant ${PLANT}: find-string not in the migration`);
  NEW = NEW.split(find).join(repl);
};
if (PLANT === "anon_grant") plant("REVOKE ALL ON FUNCTION public.bill_helpr_card_fee_debt(uuid, integer, text) FROM PUBLIC, anon, authenticated;", "SELECT 1;");
if (PLANT === "bill_twice") {
  plant("recurring_visit_payment_id uuid UNIQUE REFERENCES", "recurring_visit_payment_id uuid REFERENCES");
  plant("  ON CONFLICT (recurring_visit_payment_id) DO NOTHING\n", "");
}
if (PLANT === "no_cap") plant("v_cents := least(p_card_fee_cents, v_row.amount_cents);", "v_cents := p_card_fee_cents;");
if (PLANT === "take_skips") plant("     WHERE c.helper_id = p_helper_id AND c.remaining_cents > 0\n     ORDER BY", "     WHERE false\n     ORDER BY");
if (PLANT === "retry_twice") plant("     OR EXISTS (SELECT 1 FROM public.helpr_card_fee_debt_deductions x", "     OR false AND EXISTS (SELECT 1 FROM public.helpr_card_fee_debt_deductions x");
if (PLANT === "restore_skips") plant("     WHERE d.payout_ref = 'job_payout_' || p_job_id::text\n       AND c.id = d.debt_id", "     WHERE false AND d.payout_ref = 'job_payout_' || p_job_id::text\n       AND c.id = d.debt_id");
if (PLANT === "any_helper") plant("  IF v_row.helper_id IS NULL THEN\n    RAISE EXCEPTION 'visit_payment_no_helper'", "  IF false THEN\n    RAISE EXCEPTION 'visit_payment_no_helper'");
if (MODE) console.log(`NEW_MIGRATION=${MODE}: base state only (expect FAILs)`);
if (PLANT) console.log(`PLANT=${PLANT} (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const HELPR = "a0000000-0000-4000-8000-000000000002";
const OTHER = "a0000000-0000-4000-8000-000000000003";
const POSTER = "a0000000-0000-4000-8000-000000000001";
const SERIES = "c0000000-0000-4000-8000-000000000001";
const JOB_A = "c0000000-0000-4000-8000-000000000002";
const JOB_B = "c0000000-0000-4000-8000-000000000003";
const JOB_C = "c0000000-0000-4000-8000-000000000004";
const RULING_JOB = "c0000000-0000-4000-8000-000000000005";
const VISIT1 = "d0000000-0000-4000-8000-000000000001";
const VISIT2 = "d0000000-0000-4000-8000-000000000002";
const VISIT_UNPAID = "d0000000-0000-4000-8000-000000000003";
const VISIT_NOHELPR = "d0000000-0000-4000-8000-000000000004";
const VISIT3 = "d0000000-0000-4000-8000-000000000005";

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
  INSERT INTO auth.users VALUES ('${HELPR}'), ('${OTHER}'), ('${POSTER}');
  INSERT INTO public.jobs (id, customer_id) VALUES ('${SERIES}', '${POSTER}'), ('${JOB_A}', '${POSTER}'), ('${JOB_B}', '${POSTER}'), ('${JOB_C}', '${POSTER}'), ('${RULING_JOB}', '${POSTER}');
  INSERT INTO public.recurring_visit_payments VALUES
    ('${VISIT1}', '${SERIES}', '${HELPR}', 32000, 'pi_1', 'paid'),
    ('${VISIT2}', '${SERIES}', '${HELPR}', 500, 'pi_2', 'paid'),
    ('${VISIT_UNPAID}', '${SERIES}', '${HELPR}', 32000, NULL, 'pending'),
    ('${VISIT_NOHELPR}', '${SERIES}', NULL, 32000, 'pi_4', 'paid'),
    ('${VISIT3}', '${SERIES}', '${HELPR}', 32000, 'pi_5', 'paid');
`);
await db.exec(BASE);
if (MODE !== "skip") {
  for (let i = 1; i <= 3; i++) {
    await db.exec(NEW);
    console.log(`applied ${i}x`);
  }
}

async function one(sql) {
  try {
    const r = await db.query(sql);
    return { ok: true, row: r.rows[0] ?? null };
  } catch (e) {
    return { ok: false, err: String(e.message) };
  }
}
const val = async (sql) => {
  const r = await one(sql);
  return r.ok ? Object.values(r.row ?? {})[0] : `ERR ${r.err}`;
};

// ── bill ─────────────────────────────────────────────────────────────
check("bill: a paid visit bills its Helpr the card fee", (await val(`SELECT public.bill_helpr_card_fee_debt('${VISIT1}', 958, 're_1')`)) === 958);
check("bill: a replay of the same visit bills nothing", (await val(`SELECT public.bill_helpr_card_fee_debt('${VISIT1}', 958, 're_1')`)) === 0);
check("bill: one debt row for that visit", (await val(`SELECT count(*)::int FROM public.helpr_card_fee_debts WHERE recurring_visit_payment_id = '${VISIT1}'`)) === 1);
check("bill: capped at the visit's charge", (await val(`SELECT public.bill_helpr_card_fee_debt('${VISIT2}', 9999, 're_2')`)) === 500);
const unpaid = await val(`SELECT public.bill_helpr_card_fee_debt('${VISIT_UNPAID}', 100, 're_3')`);
check("bill: an unpaid visit is refused", /visit_payment_not_paid/.test(String(unpaid)), String(unpaid));
const nohelpr = await val(`SELECT public.bill_helpr_card_fee_debt('${VISIT_NOHELPR}', 100, 're_4')`);
check("bill: a visit with no Helpr is refused", /visit_payment_no_helper/.test(String(nohelpr)), String(nohelpr));
const zero = await val(`SELECT public.bill_helpr_card_fee_debt('${VISIT1}', 0, 're_1')`);
check("bill: a zero fee is refused", /invalid_debt/.test(String(zero)), String(zero));
check("bill: the debt belongs to the visit's Helpr, source series_visit_lapsed",
  (await val(`SELECT count(*)::int FROM public.helpr_card_fee_debts WHERE helper_id = '${HELPR}' AND source = 'series_visit_lapsed' AND job_id = '${SERIES}'`)) === 2);

// Age the debts so an older at-fault ruling sorts first, then a newer one after.
await db.exec(`UPDATE public.helpr_card_fee_debts SET created_at = now() - interval '2 days' WHERE recurring_visit_payment_id = '${VISIT1}'`).catch((e) => console.log(`(age skipped: ${e.message})`));
await db.exec(`UPDATE public.helpr_card_fee_debts SET created_at = now() - interval '1 day' WHERE recurring_visit_payment_id = '${VISIT2}'`).catch((e) => console.log(`(age skipped: ${e.message})`));
await db.exec(`INSERT INTO public.job_helpr_fault_rulings (job_id, helper_id, card_fee_cents, card_fee_remaining_cents, created_at)
  VALUES ('${RULING_JOB}', '${HELPR}', 300, 300, now() - interval '3 days')`);

// ── take: oldest first across both kinds ─────────────────────────────
// Owed: ruling 300 (3d), debt 958 (2d), debt 500 (1d) = 1758.
check("take: a payout capped at 1000 takes 1000", (await val(`SELECT public.take_helpr_fault_fee('${HELPR}', 'job_payout_${JOB_A}', 1000)`)) === 1000);
check("take: the oldest (the ruling) is cleared first", (await val(`SELECT card_fee_remaining_cents FROM public.job_helpr_fault_rulings WHERE job_id = '${RULING_JOB}'`)) === 0);
check("take: then the older card-fee debt (958 -> 258)", (await val(`SELECT remaining_cents FROM public.helpr_card_fee_debts WHERE recurring_visit_payment_id = '${VISIT1}'`)) === 258);
check("take: the newest debt untouched", (await val(`SELECT remaining_cents FROM public.helpr_card_fee_debts WHERE recurring_visit_payment_id = '${VISIT2}'`)) === 500);
check("take: a retry of the same payout returns the first answer", (await val(`SELECT public.take_helpr_fault_fee('${HELPR}', 'job_payout_${JOB_A}', 5000)`)) === 1000);
check("take: the retry took nothing more", (await val(`SELECT sum(remaining_cents)::int FROM public.helpr_card_fee_debts`)) === 758);
check("take: another Helpr owes nothing", (await val(`SELECT public.take_helpr_fault_fee('${OTHER}', 'job_payout_${JOB_B}', 5000)`)) === 0);
check("take: the next payout takes the rest (758)", (await val(`SELECT public.take_helpr_fault_fee('${HELPR}', 'job_payout_${JOB_B}', 5000)`)) === 758);
check("take: all paid off", (await val(`SELECT sum(remaining_cents)::int FROM public.helpr_card_fee_debts`)) === 0);

// ── restore ──────────────────────────────────────────────────────────
check("restore: a payout that stopped gives back its card-fee deduction", (await val(`SELECT public.restore_helpr_fault_fee('${HELPR}', '${JOB_B}')`)) === 758);
check("restore: the debts read owed again", (await val(`SELECT sum(remaining_cents)::int FROM public.helpr_card_fee_debts`)) === 758);
check("restore: its deduction rows are gone", (await val(`SELECT count(*)::int FROM public.helpr_card_fee_debt_deductions WHERE payout_ref = 'job_payout_${JOB_B}'`)) === 0);
await db.exec(`INSERT INTO public.payout_transfers (job_id, helper_id, status) VALUES ('${JOB_A}', '${HELPR}', 'paid')`);
check("restore: refused while a live payout carries it", (await val(`SELECT public.restore_helpr_fault_fee('${HELPR}', '${JOB_A}')`)) === 0);
check("restore: that payout's deductions stay", (await val(`SELECT sum(deducted_cents)::int FROM public.helpr_card_fee_debt_deductions WHERE payout_ref = 'job_payout_${JOB_A}'`)) === 700);
check("take: a third payout takes what was given back", (await val(`SELECT public.take_helpr_fault_fee('${HELPR}', 'job_payout_${JOB_C}', 5000)`)) === 758);
// A payout that took ONLY card-fee debt, retried after a new debt was billed: the first answer, nothing new taken.
check("bill: a later visit bills again", (await val(`SELECT public.bill_helpr_card_fee_debt('${VISIT3}', 200, 're_5')`)) === 200);
check("take: a retry of a card-fee-only payout returns the first answer", (await val(`SELECT public.take_helpr_fault_fee('${HELPR}', 'job_payout_${JOB_C}', 5000)`)) === 758);
check("take: that retry left the new debt owed", (await val(`SELECT remaining_cents FROM public.helpr_card_fee_debts WHERE recurring_visit_payment_id = '${VISIT3}'`)) === 200);

// ── grants ───────────────────────────────────────────────────────────
for (const fn of ["public.bill_helpr_card_fee_debt(uuid, integer, text)", "public.take_helpr_fault_fee(uuid, text, integer)", "public.restore_helpr_fault_fee(uuid, uuid)"]) {
  for (const role of ["anon", "authenticated"]) {
    check(`grant: ${role} cannot execute ${fn.split("(")[0]}`, (await val(`SELECT has_function_privilege('${role}', '${fn}', 'EXECUTE')`)) === false);
  }
  check(`grant: service_role executes ${fn.split("(")[0]}`, (await val(`SELECT has_function_privilege('service_role', '${fn}', 'EXECUTE')`)) === true);
}
for (const t of ["public.helpr_card_fee_debts", "public.helpr_card_fee_debt_deductions"]) {
  check(`grant: anon has nothing on ${t}`, (await val(`SELECT has_table_privilege('anon', '${t}', 'SELECT,INSERT,UPDATE,DELETE')`)) === false);
  check(`grant: authenticated cannot write ${t}`, (await val(`SELECT has_table_privilege('authenticated', '${t}', 'INSERT,UPDATE,DELETE')`)) === false);
  check(`rls: on for ${t}`, (await val(`SELECT relrowsecurity FROM pg_class WHERE oid = '${t}'::regclass`)) === true);
}
check("grant: a Helpr cannot read the refund ref", (await val(`SELECT has_column_privilege('authenticated', 'public.helpr_card_fee_debts', 'refund_ref', 'SELECT')`)) === false);
check("grant: a Helpr reads the remaining amount", (await val(`SELECT has_column_privilege('authenticated', 'public.helpr_card_fee_debts', 'remaining_cents', 'SELECT')`)) === true);
check("rls: the Helpr-reads-own policy exists",
  (await val(`SELECT count(*)::int FROM pg_policies WHERE tablename = 'helpr_card_fee_debts' AND policyname = 'helpr card fee debts: the Helpr reads own'`)) === 1);

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
