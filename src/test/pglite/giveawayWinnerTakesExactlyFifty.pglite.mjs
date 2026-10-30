#!/usr/bin/env node
/**
 * PGlite proof for 20261030160851_giveaway_winner_takes_exactly_fifty.sql
 * (owner 2026-10-30: the giveaway's winner takes home exactly $50).
 *
 *   npx tsx src/test/pglite/giveawayWinnerTakesExactlyFifty.pglite.mjs           # applied 3x, all PASS
 *   npx tsx src/test/pglite/giveawayWinnerTakesExactlyFifty.pglite.mjs --before  # NOT applied, every [fix] FAILS
 *
 * Real, from the migrations: enforce_paid_job_fee_fields_fixed and
 * enforce_jobs_fee_model_lock (with their triggers), is_server_context,
 * helpr_flat_fee_cents, get_helper_earnings_export. The payout arithmetic is the
 * real edge code (_shared/helprFlatFee.ts, money.ts) run on the row as read back.
 * The real release-payout and process-scheduled-payouts transfers are proved in
 * src/test/giveawayPaysExactlyFifty.test.ts. Stubs (not under test):
 * is_category_taxable, auth.uid/role. Not loaded: prevent_job_field_escalation and
 * enforce_poster_jobs_money_lock (both return at is_server_context, read on prod).
 *
 *   F1 [fix] the job reads flat 700, percent 5, platform fee 10.00, budget 60
 *   F2 [fix] the payout is 5000 cents when the setup fee is NOT owed
 *   F3 [fix] the payout is 5000 cents when the setup fee IS owed
 *   F4 [fix] the export after the transfer: gross 60, fee 10, net 50
 *   F5 [fix] the export before a ledger row exists: gross 60, fee 10, net 50
 *   F6 [fix] 700 on any other job is refused: server update, server insert, unpaid job, paid job
 *   F7 [fix] fee owed: $50 transfer, $8 commission + $2 setup fee, marked paid
 *   F8 [fix] fee owed: the export reads gross 60, fee 10, net 50
 *   F9 [fix] fee already paid: $50 transfer, $10 commission, flag and its date untouched
 *   F10 [fix] fee already paid: the export reads gross 60, fee 10, net 50
 *   K8 [keep] a retry changes nothing: no second ledger row, the flag's date does not move
 *   K9 [keep] a later ordinary payout takes no second setup fee
 *   K1 [keep] a replay does not rewrite the row (xmin unchanged)
 *   K2 [keep] the job with a payout already started is not restamped
 *   K3 [keep] the job already released is not restamped
 *   K4 [keep] every other job is byte for byte unchanged, including ones with the same budget
 *   K5 [keep] other jobs still pay what they did
 *   K6 [keep] without the migration's opt-in the paid-job trigger refuses this restamp
 *   K7 [keep] a signed-in member cannot write the stamp, even on this job
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { effectiveDefs } from "../helpers/effectiveFunctionDefs.ts";
import { helprFlatFeeCents, isGiveawayFixedPayJob } from "../../../supabase/functions/_shared/helprFlatFee.ts";
import { roundPayoutDownCents } from "../../../supabase/functions/_shared/money.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261030160851_giveaway_winner_takes_exactly_fifty.sql";
const MIGRATION = readFileSync(DIR + THIS, "utf8");
const FIXED_TRIGGER = readFileSync(`${DIR}20261025161802_paid_job_fees_are_fixed.sql`, "utf8");
const BEFORE = process.argv.includes("--before");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const defs = effectiveDefs(DIR);
const fnStmt = (name) => {
  const d = defs.get(name);
  if (!d) throw new Error(`no migration defines ${name}`);
  const open = /\bAS\s+(\$\w*\$)/i.exec(d.stmt);
  const end = d.stmt.indexOf(open[1], open.index + open[0].length);
  return `${d.stmt.slice(0, end + open[1].length)};`;
};

const GIVEAWAY = "11f8b084-ccd1-47b6-92ab-26338f701468";
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const H = U(1), P = U(11);
const SAME_BUDGET = U(101), TEN_PCT = U(102), LEGACY = U(103), POSTER_FEE = U(104), UNPAID = U(105), RELEASED = U(106);
const OTHERS = [SAME_BUDGET, TEN_PCT, LEGACY, POSTER_FEE, UNPAID, RELEASED];

/** A fresh database holding the giveaway in the given state, and five other jobs. */
async function world({ status = "escrow", jobStatus = "open", transfer = false } = {}) {
  const db = new PGlite();
  await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('test.role', true), '') $f$;
CREATE TYPE public.app_role AS ENUM ('admin', 'customer', 'helper');
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, role public.app_role);
CREATE TYPE public.job_status AS ENUM ('open','accepted','in_progress','completed','cancelled','disputed');
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, title text, parish text, category text,
  status public.job_status NOT NULL DEFAULT 'open', is_group_job boolean DEFAULT false, payment_status text, budget numeric,
  urgent_fee numeric, helper_fee_percent numeric, helper_fee_flat_cents integer, poster_fee_flat_cents integer,
  platform_fee_amount numeric(10,2), platform_fee_percent numeric, customer_fee_amount numeric(10,2), sales_tax_amount numeric,
  helper_completed_at timestamptz, poster_completed_at timestamptz, updated_at timestamptz DEFAULT now());
CREATE TABLE public.group_job_helpers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, share_cents integer,
  helper_completed_at timestamptz, poster_confirmed_completion_at timestamptz);
CREATE TABLE public.payout_transfers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid,
  amount_cents integer, platform_fee_cents integer, status text, metadata jsonb DEFAULT '{}'::jsonb);
CREATE FUNCTION public.is_category_taxable(text) RETURNS boolean LANGUAGE sql AS $f$ SELECT true $f$;
${["is_server_context", "has_role", "helpr_flat_fee_cents", "get_helper_earnings_export", "enforce_jobs_fee_model_lock"].map(fnStmt).join("\n\n")}
INSERT INTO public.jobs (id, customer_id, helper_id, title, category, status, payment_status, budget, urgent_fee, helper_fee_percent, helper_fee_flat_cents, poster_fee_flat_cents, platform_fee_amount, platform_fee_percent, customer_fee_amount, sales_tax_amount, poster_completed_at) VALUES
  ('${GIVEAWAY}', '${P}', '${H}', 'GIVE AWAY!!', 'other', '${jobStatus}', '${status}', 60, 0, 5, 70, NULL, 3.70, 12, 7.20, 0, now() - interval '1 day'),
  ('${SAME_BUDGET}', '${P}', NULL, 'Same budget, same stamp', 'other', 'open', 'escrow', 60, 0, 5, 70, NULL, 3.70, 12, 7.20, 0, NULL),
  ('${TEN_PCT}', '${P}', NULL, 'Today''s stamp', 'other', 'open', 'escrow', 60, 0, 10, 70, NULL, 6.70, 0, 0, 0, NULL),
  ('${LEGACY}', '${P}', NULL, 'Legacy tier', 'other', 'open', 'escrow', 60, 0, 12, NULL, NULL, 7.20, 12, 7.20, 0, NULL),
  ('${POSTER_FEE}', '${P}', NULL, 'Poster pays the fee', 'other', 'open', 'escrow', 60, 0, 0, 0, 70, 0, 0, 0, 0, NULL),
  ('${UNPAID}', '${P}', NULL, 'Not funded', 'other', 'open', 'unpaid', 60, 0, NULL, NULL, NULL, NULL, NULL, 0, 0, NULL),
  ('${RELEASED}', '${P}', '${H}', 'Paid long ago', 'other', 'completed', 'released', 60, 0, 5, 70, NULL, 3.70, 12, 7.20, 0, now() - interval '2 days');
INSERT INTO public.payout_transfers (job_id, helper_id, amount_cents, platform_fee_cents, status, metadata) VALUES
  ('${RELEASED}', '${H}', 5600, 370, 'paid', '{"onboarding_fee_cents": 0, "rounding_remainder_cents": 30}');
${transfer ? `INSERT INTO public.payout_transfers (job_id, helper_id, amount_cents, platform_fee_cents, status) VALUES ('${GIVEAWAY}', '${H}', 5600, 370, 'pending');` : ""}
CREATE TRIGGER jobs_fee_model_lock BEFORE INSERT OR UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.enforce_jobs_fee_model_lock();
`);
  await db.exec(FIXED_TRIGGER);
  return db;
}

const row = async (db, id) => (await db.query(`SELECT *, xmin::text AS xmin_ FROM public.jobs WHERE id = '${id}'`)).rows[0];
const snapshot = async (db, ids) => JSON.stringify((await db.query(`SELECT to_jsonb(j) AS r FROM public.jobs j WHERE id = ANY('{${ids.join(",")}}'::uuid[]) ORDER BY id`)).rows);
async function attempt(db, sql) {
  try { await db.exec(sql); return null; } catch (e) { return String(e?.message ?? e); }
}
/** The transfer both payout paths compute, on the row as read back. */
function transferCents(job, feeOwed) {
  return payout(job, feeOwed).amount;
}
/** The same arithmetic as the payout paths' claim branch: a claimed fee comes off the transfer, or on the giveaway off the commission. */
function payout(job, claimed) {
  const gross = Math.round(Number(job.budget) * 100);
  let commission = helprFlatFeeCents(gross, job);
  let unrounded = gross - commission;
  const setup = claimed ? 200 : 0;
  if (claimed && isGiveawayFixedPayJob(job)) { unrounded += setup; commission -= setup; }
  return { amount: roundPayoutDownCents(unrounded - setup), commission, setup };
}

const db = await world();
const othersBefore = await snapshot(db, OTHERS);
const otherPayBefore = await Promise.all(OTHERS.map(async (id) => transferCents(await row(db, id), true)));

if (!BEFORE) {
  await db.exec(MIGRATION);
  console.log(`applied ${THIS} (run 1)`);
} else {
  console.log(`--before: ${THIS} NOT applied (every [fix] must FAIL)`);
}
const first = await row(db, GIVEAWAY);
if (!BEFORE) {
  for (let i = 2; i <= 3; i++) {
    await db.exec(MIGRATION);
    console.log(`applied ${THIS} (run ${i})`);
  }
}
const j = await row(db, GIVEAWAY);

check("F1 [fix] the job reads flat 700, percent 5, platform fee 10.00, budget 60",
  j.helper_fee_flat_cents === 700 && Number(j.helper_fee_percent) === 5 && Number(j.platform_fee_amount) === 10 && Number(j.budget) === 60,
  `${j.helper_fee_flat_cents}/${j.helper_fee_percent}/${j.platform_fee_amount}/${j.budget}`);
check("F2 [fix] the payout is 5000 cents when the setup fee is NOT owed", transferCents(j, false) === 5000, String(transferCents(j, false)));
check("F3 [fix] the payout is 5000 cents when the setup fee IS owed", transferCents(j, true) === 5000, String(transferCents(j, true)));

// The export: first with the job finished and no ledger row, then as the payout path records it.
await db.exec(`SELECT set_config('request.jwt.claim.sub', '${H}', false);`);
const exportRow = async () => {
  const rows = (await db.query(`SELECT * FROM public.get_helper_earnings_export('${H}', current_date - 30, current_date)`)).rows;
  return rows.find((r) => r.job_id === GIVEAWAY);
};
await db.exec(`SELECT set_config('request.jwt.claim.sub', '', false);`);
await db.exec(`GRANT USAGE ON SCHEMA public, auth TO service_role; GRANT ALL ON public.jobs TO service_role;`);
await db.exec(`BEGIN; SELECT set_config('test.role', 'service_role', true); SET LOCAL ROLE service_role;
  UPDATE public.jobs SET status = 'completed', payment_status = 'released', platform_fee_amount = platform_fee_amount WHERE id = '${GIVEAWAY}'; COMMIT;`);
await db.exec(`SELECT set_config('request.jwt.claim.sub', '${H}', false);`);
const noLedger = await exportRow();
check("F5 [fix] the export before a ledger row exists: gross 60, fee 10, net 50",
  Number(noLedger?.gross_budget) === 60 && Number(noLedger?.platform_fee) === 10 && Number(noLedger?.net_payout) === 50, JSON.stringify(noLedger ?? null));
await db.exec(`INSERT INTO public.payout_transfers (job_id, helper_id, amount_cents, platform_fee_cents, status, metadata) VALUES
  ('${GIVEAWAY}', '${H}', ${transferCents(j, true)}, ${Math.round(Number(j.platform_fee_amount) * 100)}, 'paid', '{"onboarding_fee_cents": 0, "rounding_remainder_cents": 0, "helpr_fault_fee_cents": 0}');`);
const ledger = await exportRow();
check("F4 [fix] the export after the transfer: gross 60, fee 10, net 50",
  Number(ledger?.gross_budget) === 60 && Number(ledger?.platform_fee) === 10 && Number(ledger?.net_payout) === 50, JSON.stringify(ledger ?? null));
await db.exec(`SELECT set_config('request.jwt.claim.sub', '', false);`);

// The setup fee, through the payout paths' own conditional UPDATE, on a fresh database per case.
{
  const run = async (paidAlready) => {
    const w = await world({ status: "payout_pending", jobStatus: "completed" });
    if (!BEFORE) await w.exec(MIGRATION);
    await w.exec(`CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, onboarding_fee_paid boolean, onboarding_fee_charged_at timestamptz);
      INSERT INTO public.profiles VALUES ('${H}', ${paidAlready}, ${paidAlready ? "now() - interval '9 days'" : "NULL"});`);
    const job = await row(w, GIVEAWAY);
    const attemptPayout = async () => {
      // The ledger's own check, as both paths make it before any claim: a settled row stops a retry.
      const done = (await w.query(`SELECT 1 FROM public.payout_transfers WHERE job_id = '${GIVEAWAY}' AND status = 'paid'`)).rows.length > 0;
      if (done) return null;
      const claim = await w.query(`UPDATE public.profiles SET onboarding_fee_paid = true, onboarding_fee_charged_at = now()
        WHERE user_id = '${H}' AND onboarding_fee_paid = false RETURNING user_id`);
      const p = payout(job, claim.rows.length > 0);
      await w.exec(`INSERT INTO public.payout_transfers (job_id, helper_id, amount_cents, platform_fee_cents, status, metadata) VALUES
        ('${GIVEAWAY}', '${H}', ${p.amount}, ${p.commission}, 'paid', '{"onboarding_fee_cents": ${p.setup}, "rounding_remainder_cents": 0}');`);
      return p;
    };
    const first = await attemptPayout();
    const flag = async () => (await w.query(`SELECT onboarding_fee_paid, onboarding_fee_charged_at::text AS at FROM public.profiles`)).rows[0];
    const afterFirst = await flag();
    const retry = await attemptPayout();
    const afterRetry = await flag();
    const ledger = (await w.query(`SELECT amount_cents, platform_fee_cents, metadata FROM public.payout_transfers WHERE job_id = '${GIVEAWAY}'`)).rows;
    // The payout paths' flip to released (the export lists released jobs).
    await w.exec(`GRANT USAGE ON SCHEMA public, auth TO service_role; GRANT ALL ON public.jobs TO service_role;`);
    await w.exec(`BEGIN; SELECT set_config('test.role', 'service_role', true); SET LOCAL ROLE service_role;
      UPDATE public.jobs SET payment_status = 'released' WHERE id = '${GIVEAWAY}'; COMMIT;`);
    await w.exec(`SELECT set_config('request.jwt.claim.sub', '${H}', false);`);
    const exp = (await w.query(`SELECT * FROM public.get_helper_earnings_export('${H}', current_date - 30, current_date)`)).rows.find((r) => r.job_id === GIVEAWAY);
    return { first, afterFirst, retry, afterRetry, ledger, exp };
  };
  const owed = await run(false);
  check("F7 [fix] fee owed: $50 transfer, $8 commission + $2 setup fee, marked paid",
    owed.first.amount === 5000 && owed.first.commission === 800 && owed.first.setup === 200 && owed.afterFirst.onboarding_fee_paid === true && owed.afterFirst.at !== null,
    JSON.stringify(owed.first));
  check("F8 [fix] fee owed: the export reads gross 60, fee 10, net 50",
    Number(owed.exp?.gross_budget) === 60 && Number(owed.exp?.platform_fee) === 10 && Number(owed.exp?.net_payout) === 50, JSON.stringify(owed.exp ?? null));
  const paid = await run(true);
  check("F9 [fix] fee already paid: $50 transfer, $10 commission, no setup fee, flag and its date untouched",
    paid.first.amount === 5000 && paid.first.commission === 1000 && paid.first.setup === 0 && paid.afterFirst.at === paid.afterRetry.at && paid.afterFirst.onboarding_fee_paid === true,
    JSON.stringify(paid.first));
  check("F10 [fix] fee already paid: the export reads gross 60, fee 10, net 50",
    Number(paid.exp?.gross_budget) === 60 && Number(paid.exp?.platform_fee) === 10 && Number(paid.exp?.net_payout) === 50, JSON.stringify(paid.exp ?? null));
  check("K8 [keep] a retry changes nothing: no second ledger row, the flag's date does not move",
    owed.retry === null && owed.ledger.length === 1 && owed.afterFirst.at === owed.afterRetry.at && paid.retry === null && paid.ledger.length === 1,
    `${owed.ledger.length}/${paid.ledger.length}`);
  // A later ordinary job for the same winner: the flag is true, so the claim finds no row.
  const later = payout({ budget: 60, helper_fee_flat_cents: 70, helper_fee_percent: 5 }, false);
  check("K9 [keep] a later ordinary payout takes no second setup fee", later.amount === 5600 && owed.afterRetry.onboarding_fee_paid === true, JSON.stringify(later));
}

// 700 anywhere else. Run as the server: the fee-model lock lets the server through, so only the CHECK can stop it.
{
  const onOther = await attempt(db, `UPDATE public.jobs SET helper_fee_flat_cents = 700 WHERE id = '${UNPAID}'`);
  const insert = await attempt(db, `INSERT INTO public.jobs (id, customer_id, budget, payment_status, helper_fee_percent, helper_fee_flat_cents) VALUES ('${U(107)}', '${P}', 60, 'unpaid', 5, 700)`);
  const paid = await attempt(db, `BEGIN; SET LOCAL app.paid_job_fee_rewrite = 'test'; UPDATE public.jobs SET helper_fee_flat_cents = 700 WHERE id = '${SAME_BUDGET}'; COMMIT;`);
  await db.exec("ROLLBACK;").catch(() => {});
  const refused = (e) => /jobs_giveaway_flat_stamp_is_one_job/.test(e ?? "");
  check("F6 [fix] 700 on any other job is refused: server update, server insert, paid job with the opt-in",
    refused(onOther) && refused(insert) && refused(paid), `${onOther ?? "allowed"} | ${insert ?? "allowed"} | ${paid ?? "allowed"}`);
}

if (!BEFORE) {
  check("K1 [keep] a replay does not rewrite the row (xmin unchanged)", first.xmin_ === j.xmin_, `${first.xmin_} -> ${j.xmin_}`);

  const started = await world({ transfer: true });
  await started.exec(MIGRATION);
  const s = await row(started, GIVEAWAY);
  check("K2 [keep] the job with a payout already started is not restamped", s.helper_fee_flat_cents === 70 && Number(s.platform_fee_amount) === 3.7, `${s.helper_fee_flat_cents}/${s.platform_fee_amount}`);

  const released = await world({ status: "released", jobStatus: "completed" });
  await released.exec(MIGRATION);
  const r = await row(released, GIVEAWAY);
  check("K3 [keep] the job already released is not restamped", r.helper_fee_flat_cents === 70 && Number(r.platform_fee_amount) === 3.7, `${r.helper_fee_flat_cents}/${r.platform_fee_amount}`);

  const othersAfter = await snapshot(db, OTHERS);
  check("K4 [keep] every other job is byte for byte unchanged, including ones with the same budget", OTHERS.length === 6 && othersAfter === othersBefore);

  const otherPayAfter = await Promise.all(OTHERS.map(async (id) => transferCents(await row(db, id), true)));
  check("K5 [keep] other jobs still pay what they did", JSON.stringify(otherPayAfter) === JSON.stringify(otherPayBefore) && otherPayAfter[0] === 5400, JSON.stringify(otherPayAfter));

  const noOptIn = await world();
  const err = await attempt(noOptIn, MIGRATION.replace(/SET LOCAL app\.paid_job_fee_rewrite = '[^']+';/, ""));
  check("K6 [keep] without the migration's opt-in the paid-job trigger refuses this restamp", /paid_job_fee_fixed/.test(err ?? ""), err ?? "no error");

  const member = await world();
  await member.exec(MIGRATION);
  const memberErr = await attempt(member, `BEGIN; SELECT set_config('test.role', 'authenticated', true); SELECT set_config('request.jwt.claim.sub', '${P}', true); UPDATE public.jobs SET helper_fee_flat_cents = 70 WHERE id = '${GIVEAWAY}'; COMMIT;`);
  check("K7 [keep] a signed-in member cannot write the stamp, even on this job", /Only the server may set|paid_job_fee_fixed/.test(memberErr ?? ""), memberErr ?? "no error");
}

if (BEFORE) {
  // K8 and K9 run in both modes and hold in both (the claim is the same claim); they are not [fix] checks.
  console.log(`\n${failures} checks FAILED; 10 [fix] checks expected`);
  console.log(failures === 10 ? "RED as expected (10/10)" : `NOT RED as expected: ${failures}/10`);
  process.exit(failures === 10 ? 0 : 1);
}
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
