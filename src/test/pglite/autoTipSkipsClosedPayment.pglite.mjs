#!/usr/bin/env node
/**
 * PGlite proof for 20261019043709_auto_tip_skips_closed_payment.
 *
 *   PGLITE_DIR=~/.lh-pglite node src/test/pglite/autoTipSkipsClosedPayment.pglite.mjs
 *
 * OLD STATE (auto_tip_candidates from 20260925154606, verbatim): every
 * completed job is a candidate with nothing saying its money went back, so a
 * charged-back, refunded, closed or disputed job is charged like any other.
 * NEW STATE (the migration, applied 3x): every candidate carries tip_state,
 * and auto_tip_job_state(job) answers the same:
 *   'closed'  status not completed, payment not funded, or a payment_refunds
 *             row (by job_id OR the job's PaymentIntent) other than
 *             duplicate_onboarding_fee / duplicate_funding / crew_unfilled_refund
 *             (a Dashboard FULL refund on a 'released' job keeps
 *             payment_status 'released': only that row shows it);
 *   'held'    a LIVE dispute (has_active_dispute, or dispute_status open /
 *             escalated / stripe_chargeback / reversal_hold / dispute_lost);
 *   'chargeable' otherwise (a SETTLED dispute does not hold the tip);
 * the crew arm follows the same rule; an unknown job is 'closed'; anon and
 * authenticated cannot run either function, service_role can. Exits 1 on any
 * failure.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(fileURLToPath(new URL(`../../../supabase/migrations/${f}`, import.meta.url)), "utf8");
const FIX = mig("20261019043709_auto_tip_skips_closed_payment.sql");
const OLD = /CREATE OR REPLACE FUNCTION public\.auto_tip_candidates[\s\S]*?\n\$\$;/.exec(mig("20260925154606_group_crew_has_no_lead.sql"))[0];
const FUNDED = /CREATE OR REPLACE FUNCTION public\.job_payment_is_funded[\s\S]*?\n\$\$;/.exec(mig("20260907060556_gate_helper_award_on_funded_escrow.sql"))[0];

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create type public.auto_tip_mode as enum ('off','percent','fixed');
  create type public.job_status as enum ('open','accepted','in_progress','completed','cancelled','revision_requested','disputed','pending_approval');
  create table public.profiles(user_id uuid primary key, auto_tip_mode public.auto_tip_mode not null default 'off', auto_tip_enabled_at timestamptz);
  create table public.jobs(id uuid primary key, customer_id uuid, helper_id uuid, budget numeric, status public.job_status,
    completed_at timestamptz, payment_status text, has_active_dispute boolean default false, dispute_status text,
    is_group_job boolean default false, helpers_needed integer, stripe_payment_intent_id text);
  create table public.group_job_helpers(job_id uuid, helper_id uuid, share_cents integer, slot_no integer);
  create table public.tips(job_id uuid, helper_id uuid, source text);
  create table public.payment_refunds(id uuid primary key default gen_random_uuid(), job_id uuid, stripe_payment_intent_id text,
    source text not null, is_partial boolean not null default false);
  create function public.resolve_auto_tip(uuid, numeric) returns numeric language sql as 'select 5::numeric';
  create function public.crew_slot_share_cents(bigint, integer, integer) returns bigint language sql as 'select ($1 / $2)::bigint';
`);
await db.exec(FUNDED);

const P = "00000000-0000-4000-8000-0000000000a1";
const H = "00000000-0000-4000-8000-0000000000b1";
const H2 = "00000000-0000-4000-8000-0000000000b2";
const J = (n) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
// [job, payment_status, has_active_dispute, dispute_status, expected tip_state, refund source, refund by PI only]
const SINGLE = [
  [1, "payout_pending", false, null, "chargeable"],
  [2, "released", false, null, "chargeable"],
  [3, "escrow", false, null, "chargeable"],
  [4, "released", false, "reversal_hold", "held"],        // Stripe pulled the Helpr's payout back: live
  [5, "chargeback", false, "stripe_chargeback", "closed"],
  [6, "refunded", false, null, "closed"],
  [7, "cancelled", false, "resolved", "closed"],
  [8, "released", false, "stripe_chargeback", "held"],    // a card inquiry: money untouched, bank asking
  [9, "payout_pending", false, "auto_resolved", "chargeable"], // a SETTLED dispute does not hold the tip
  [10, "payout_pending", true, "open", "held"],
  [11, "cancelling", false, null, "closed"],
  [12, "failed", false, null, "closed"],
  [13, null, false, null, "closed"],
  [14, "released", false, null, "closed", "stripe_dashboard"],             // Dashboard FULL refund: status stays 'released'
  [15, "payout_pending", false, null, "chargeable", "duplicate_onboarding_fee"], // a duplicate $2 fee returned
  [16, "released", false, null, "closed", "admin_refund_general"],         // an admin's partial refund
  [17, "payout_pending", false, null, "chargeable", "duplicate_funding"],  // a second funding returned
  [18, "payout_pending", false, null, "chargeable", "crew_unfilled_refund"], // unbought crew slots returned
  [19, "released", false, null, "closed", "stripe_dashboard", true],       // refund row with NO job_id, matched by the PaymentIntent
  [20, "payout_pending", false, "dispute_lost", "held"],
  [21, "payout_pending", false, "resolved", "chargeable"],
];
await db.exec(`insert into public.profiles values ('${P}', 'percent', now() - interval '30 days');`);
for (const [n, ps, active, ds] of SINGLE) {
  await db.query(
    `insert into public.jobs (id, customer_id, helper_id, budget, status, completed_at, payment_status, has_active_dispute, dispute_status, stripe_payment_intent_id)
     values ($1, $2, $3, 100, 'completed', now() - interval '2 hours', $4, $5, $6, $7)`,
    [J(n), P, H, ps, active, ds, `pi_${n}`],
  );
}
for (const [n, , , , , src, byPi] of SINGLE) {
  if (src) await db.query(`insert into public.payment_refunds (job_id, stripe_payment_intent_id, source) values ($1, $2, $3)`, [byPi ? null : J(n), `pi_${n}`, src]);
}
// Crews: 30 paid and clean, 31 charged back, 32 refunded in the Dashboard (status still 'released'), 33 its unfilled slots returned.
const CREWS = [[30, "payout_pending", null, null, "chargeable"], [31, "chargeback", "stripe_chargeback", null, "closed"],
  [32, "released", null, "stripe_dashboard", "closed"], [33, "payout_pending", null, "crew_unfilled_refund", "chargeable"]];
for (const [n, ps, ds, src] of CREWS) {
  await db.query(
    `insert into public.jobs (id, customer_id, helper_id, budget, status, completed_at, payment_status, dispute_status, is_group_job, helpers_needed)
     values ($1, $2, null, 200, 'completed', now() - interval '2 hours', $3, $4, true, 2)`,
    [J(n), P, ps, ds],
  );
  await db.query(`insert into public.group_job_helpers values ($1, $2, 5000, 0), ($1, $3, 5000, 1)`, [J(n), H, H2]);
  if (src) await db.query(`insert into public.payment_refunds (job_id, source) values ($1, $2)`, [J(n), src]);
}

const failures = [];
await db.exec(OLD);
const before = (await db.query(`select * from public.auto_tip_candidates()`)).rows;
const closedOrHeld = [...SINGLE, ...CREWS.map(([n, , , , st]) => [n, , , , st])].filter((r) => r[4] !== "chargeable").map((r) => J(r[0]));
const oldHasState = before.length > 0 && "tip_state" in before[0];
const oldOffered = before.filter((r) => closedOrHeld.includes(r.job_id)).length;
if (!oldHasState && oldOffered >= closedOrHeld.length) {
  console.log(`OLD STATE RED: ${oldOffered} candidate rows on closed or disputed jobs, each offered as chargeable (no tip_state)`);
} else {
  console.error("unexpected old state", { oldHasState, oldOffered });
  process.exit(1);
}

for (let i = 0; i < 3; i++) await db.exec(FIX);
const after = (await db.query(`select job_id::text j, helper_id::text h, tip_state from public.auto_tip_candidates()`)).rows;
const stateOf = (j) => [...new Set(after.filter((r) => r.j === j).map((r) => r.tip_state))];
for (const [n, ps, active, ds, want] of SINGLE) {
  const got = stateOf(J(n));
  if (got.length !== 1 || got[0] !== want) failures.push(`job ${n} (payment ${ps}, active ${active}, dispute ${ds}) tip_state=${got}, want ${want}`);
  const rule = (await db.query(`select public.auto_tip_job_state($1) r`, [J(n)])).rows[0].r;
  if (rule !== want) failures.push(`auto_tip_job_state(job ${n}) = ${rule}, want ${want}`);
}
for (const [n, , , , want] of CREWS) {
  const rows = after.filter((r) => r.j === J(n));
  if (rows.length !== 2 || rows.some((r) => r.tip_state !== want)) failures.push(`crew ${n}: ${JSON.stringify(rows)}, want 2 x ${want}`);
}
// A completed job that is cancelled later is closed; an unknown job is closed.
await db.exec(`update public.jobs set status = 'cancelled' where id = '${J(1)}'`);
if ((await db.query(`select public.auto_tip_job_state('${J(1)}') r`)).rows[0].r !== "closed") failures.push("a cancelled job is not closed");
if ((await db.query(`select public.auto_tip_job_state('00000000-0000-4000-8000-0000000000ff') r`)).rows[0].r !== "closed") failures.push("an unknown job is not closed");

for (const [fn, role, want] of [
  ["public.auto_tip_job_state(uuid)", "anon", false],
  ["public.auto_tip_job_state(uuid)", "authenticated", false],
  ["public.auto_tip_job_state(uuid)", "service_role", true],
  ["public.auto_tip_candidates(integer)", "anon", false],
  ["public.auto_tip_candidates(integer)", "authenticated", false],
]) {
  const got = (await db.query(`select has_function_privilege($1, $2, 'execute') g`, [role, fn])).rows[0].g;
  if (got !== want) failures.push(`${role} execute on ${fn} = ${got}, want ${want}`);
}

if (failures.length) {
  console.error("FAIL\n" + failures.join("\n"));
  process.exit(1);
}
const count = (st) => after.filter((r) => r.tip_state === st).length;
console.log(`NEW STATE GREEN (applied 3x): ${after.length} candidate rows: chargeable ${count("chargeable")}, held ${count("held")}, closed ${count("closed")}; every state as expected`);
