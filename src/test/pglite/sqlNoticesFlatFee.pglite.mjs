#!/usr/bin/env node
/**
 * PGlite proof for 20261017104746_sql_notices_exports_flat_fee (docs/OPEN.md
 * Q1840): the SQL money notices and exports price a flat-model job (F3,
 * jobs.helper_fee_flat_cents stamped) at 5% + 70c, the payout paths' rule.
 *
 *   npx tsx src/test/pglite/sqlNoticesFlatFee.pglite.mjs [--before]
 *
 * The four functions are loaded at their EFFECTIVE definition before this
 * migration (src/test/helpers/effectiveFunctionDefs.ts), with the real
 * helpers they price with (job_hours_until_start, cancellation_fee_percent,
 * is_late_cancellation, crew_fee_pays_unconfirmed, crew_slot_share_cents,
 * ban_settlement_action, has_role). Stubs (not under test):
 * apply_cancellation_violation_consequence, is_category_taxable,
 * helper_has_advanced_analytics (a toggle). Without --before the migration is
 * applied 3x (replay-safe) and every check must PASS; with --before it is not,
 * and the F-checks must FAIL (the L-checks are legacy pins, green both ways).
 *
 *   F0 helpr_flat_fee_cents equals _shared/helprFlatFee.ts helprFlatFeeCents
 *      at every share 0..$2,000 (step 7c), stamped 5/70, stamped 4/50 and
 *      unstamped (NULL percent/flat read as 5/70)
 *   F1 poster_cancel_job, solo flat job cancelled late: the Helpr is told the
 *      fee minus 5% + 70c of it, as void-cancelled-payments pays
 *   F2 poster_cancel_job, flat crew of 3 ($100 = 3334/3333/3333): each member
 *      is told their share minus 5% + 70c of THEIR share
 *   F3 settle_one_off_jobs_for_banned_account, the poster of a flat job is
 *      banned late: the Helpr's "about $X" is the fee minus 5% + 70c
 *   F4 get_helper_earnings_export, a flat job with no ledger rows: gross =
 *      budget + urgent bonus, fee = 5% + 70c of it, net = gross - fee
 *   F5 get_helper_analytics: the jobs list (entitled) and the preview (not)
 *      carry helper_fee_flat_cents
 *   F6 grants: helpr_flat_fee_cents is service_role only; the four functions
 *      keep the grants live holds (2026-10-17 proacl)
 *   L1 a legacy solo cancel, L2 a legacy crew cancel, L3 a legacy ban
 *      settlement and L4 a legacy no-ledger export row read exactly as before;
 *      L5 a ledger row is untouched
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { effectiveDefs } from "../helpers/effectiveFunctionDefs.ts";
import { helprFlatFeeCents } from "../../../supabase/functions/_shared/helprFlatFee.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261017104746_sql_notices_exports_flat_fee.sql";
const MIGRATION = readFileSync(DIR + THIS, "utf8");
const BEFORE = process.argv.includes("--before");

const BEFORE_DEFS = effectiveDefs(DIR, { before: THIS });
function fnStmt(name) {
  const d = BEFORE_DEFS.get(name);
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

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const P = U(1), H = U(2), M1 = U(3), M2 = U(4), M3 = U(5), BP = U(6), BH = U(7);
const FLAT_SOLO = U(101), LEG_SOLO = U(102), FLAT_CREW = U(103), LEG_CREW = U(104);
const FLAT_BAN = U(105), LEG_BAN = U(106), FLAT_EXP = U(107), LEG_EXP = U(108), LEDGER_EXP = U(109);

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TYPE public.app_role AS ENUM ('admin', 'customer', 'helper');
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, role public.app_role);
CREATE TYPE public.job_status AS ENUM ('open','pending_approval','accepted','in_progress','revision_requested','completed','cancelled','disputed');
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, title text, parish text, category text, zip_code text,
  status public.job_status NOT NULL DEFAULT 'open', is_group_job boolean DEFAULT false, helpers_needed integer DEFAULT 1,
  payment_status text DEFAULT 'escrow', budget numeric, urgent_fee numeric, helper_fee_percent numeric,
  helper_fee_flat_cents integer, platform_fee_amount numeric, sales_tax_amount numeric,
  date_needed date, start_time time, helper_confirmed_at timestamptz, helper_arrived_at timestamptz,
  helper_completed_at timestamptz, poster_completed_at timestamptz, proof_before_urls text[], proof_after_urls text[],
  cancelled_by uuid, cancelled_at timestamptz, cancellation_reason text, late_cancellation boolean,
  cancellation_fee numeric, cancellation_fee_status text, direct_offer_status text, direct_offer_expires_at timestamptz,
  offered_to_helper_id uuid, parent_job_id uuid, recurrence_days integer[], is_seed boolean DEFAULT false,
  is_auto_created boolean DEFAULT false, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.group_job_helpers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  helper_id uuid, status text DEFAULT 'accepted', joined_at timestamptz DEFAULT now(), slot_no integer, share_cents integer,
  helper_confirmed_at timestamptz, helper_completed_at timestamptz, poster_confirmed_completion_at timestamptz,
  UNIQUE (job_id, helper_id));
CREATE TABLE public.crew_cancellation_fee_shares (job_id uuid, helper_id uuid, committed boolean, share_basis_cents bigint,
  fee_percent integer, share_amount numeric, PRIMARY KEY (job_id, helper_id));
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text, message text,
  type text, link text, job_id uuid, created_at timestamptz DEFAULT clock_timestamp());
CREATE TABLE public.payout_transfers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid,
  amount_cents integer, platform_fee_cents integer, status text, metadata jsonb DEFAULT '{}'::jsonb);
CREATE TABLE public.applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, status text,
  closed_reason text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.disputes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, status text, opener_id uuid,
  reason text, description text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, subscription_tier text, parish text, full_name text);
CREATE TABLE public.louisiana_zip_parishes (zip_code text PRIMARY KEY, parish text);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE FUNCTION public.apply_cancellation_violation_consequence(uuid) RETURNS jsonb LANGUAGE sql AS
  $$ SELECT jsonb_build_object('action', 'none', 'prior_count', 0) $$;
CREATE FUNCTION public.is_category_taxable(text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql AS $$ SELECT auth.uid() IS NULL $$;
CREATE TABLE public.analytics_toggle (on_ boolean);
INSERT INTO public.analytics_toggle VALUES (true);
CREATE FUNCTION public.helper_has_advanced_analytics(uuid) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT on_ FROM public.analytics_toggle $$;

${[
  "has_role", "job_hours_until_start", "cancellation_fee_percent", "is_late_cancellation", "crew_fee_pays_unconfirmed",
  "crew_slot_share_cents", "ban_settlement_action",
  "poster_cancel_job", "settle_one_off_jobs_for_banned_account", "get_helper_earnings_export", "get_helper_analytics",
].map(fnStmt).join("\n\n")}
REVOKE ALL ON FUNCTION public.poster_cancel_job(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.poster_cancel_job(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.settle_one_off_jobs_for_banned_account(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_one_off_jobs_for_banned_account(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.get_helper_earnings_export(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_helper_earnings_export(uuid, date, date) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_helper_analytics(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_helper_analytics(integer) TO authenticated, service_role;
`;

// Start 6 h from now, Louisiana clock: a committed late cancel (the top tier).
const SOON = `((now() + interval '6 hours') AT TIME ZONE 'America/Chicago')`;
const job = (id, over) => {
  const cols = { id: `'${id}'`, customer_id: `'${P}'`, title: `'Job ${id.slice(-3)}'`, budget: 100, status: `'accepted'`,
    date_needed: `${SOON}::date`, start_time: `${SOON}::time`, ...over };
  return `INSERT INTO public.jobs (${Object.keys(cols).join(", ")}) VALUES (${Object.values(cols).join(", ")});`;
};
const FLAT = { helper_fee_percent: 5, helper_fee_flat_cents: 70 };
const TIERED = { helper_fee_percent: 10, helper_fee_flat_cents: "NULL" };

const db = new PGlite();
await db.exec(SCHEMA);
if (!BEFORE) for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
console.log(BEFORE ? "-- BEFORE: migration NOT applied (F-checks must FAIL)" : "-- AFTER: migration applied 3x");

const dollars = (c) => (c / 100).toFixed(2);
const asUser = async (uid, sql) => {
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${uid}', false)`);
  try { return await db.query(sql); } finally { await db.exec(`SELECT set_config('request.jwt.claim.sub', '', false)`); }
};
const notice = async (uid, jobId) => (await db.query(
  `SELECT message FROM public.notifications WHERE user_id = '${uid}' AND (job_id = '${jobId}' OR link LIKE '%${jobId}%') ORDER BY created_at DESC LIMIT 1`)).rows[0]?.message ?? "";
const feeCents = async (jobId) => Math.round(Number((await db.query(`SELECT cancellation_fee f FROM public.jobs WHERE id = '${jobId}'`)).rows[0].f) * 100);

// F0 parity with the TS rule.
{
  let ok = true, detail = "";
  try {
    const r = await db.query(`SELECT c, public.helpr_flat_fee_cents(c, 5, 70)::int a, public.helpr_flat_fee_cents(c, 4, 50)::int b,
      public.helpr_flat_fee_cents(c, NULL, NULL)::int d FROM generate_series(0, 200000, 7) c`);
    for (const row of r.rows) {
      const want = [helprFlatFeeCents(row.c, FLAT), helprFlatFeeCents(row.c, { helper_fee_percent: 4, helper_fee_flat_cents: 50 }), helprFlatFeeCents(row.c)];
      if (row.a !== want[0] || row.b !== want[1] || row.d !== want[2]) { ok = false; detail = `share ${row.c}: sql ${row.a}/${row.b}/${row.d} ts ${want}`; break; }
    }
    if (ok) detail = `${r.rows.length} shares`;
  } catch (e) { ok = false; detail = String(e.message).slice(0, 100); }
  check("F0 helpr_flat_fee_cents == helprFlatFeeCents (5/70, 4/50, unstamped)", ok, detail);
}

// F1 / L1 solo cancels.
await db.exec(job(FLAT_SOLO, { helper_id: `'${H}'`, helper_confirmed_at: "now()", ...FLAT }));
await db.exec(job(LEG_SOLO, { helper_id: `'${H}'`, helper_confirmed_at: "now()", ...TIERED }));
for (const [id, flat, label] of [[FLAT_SOLO, true, "F1 solo flat cancel"], [LEG_SOLO, false, "L1 solo legacy cancel"]]) {
  await asUser(P, `SELECT public.poster_cancel_job('${id}', 'x')`);
  const fee = await feeCents(id);
  const want = flat ? fee - helprFlatFeeCents(fee, FLAT) : Math.round(fee - Math.round(fee * 10 / 100));
  const msg = await notice(H, id);
  check(`${label}: the Helpr is told about $${dollars(want)} of a $${dollars(fee)} fee`, fee > 0 && msg.includes(`$${dollars(want)} `), msg.slice(0, 160));
}

// F2 / L2 crews of 3 on $100 (3334/3333/3333).
for (const [id, stamp] of [[FLAT_CREW, FLAT], [LEG_CREW, TIERED]]) {
  await db.exec(job(id, { is_group_job: true, helpers_needed: 3, ...stamp }));
  await db.exec(`INSERT INTO public.group_job_helpers (job_id, helper_id, slot_no, share_cents, helper_confirmed_at, joined_at) VALUES
    ('${id}', '${M1}', 1, 3334, now(), now() - interval '3 min'), ('${id}', '${M2}', 2, 3333, now(), now() - interval '2 min'),
    ('${id}', '${M3}', 3, 3333, now(), now() - interval '1 min')`);
  await asUser(P, `SELECT public.poster_cancel_job('${id}', 'x')`);
  const shares = (await db.query(`SELECT helper_id, share_amount FROM public.crew_cancellation_fee_shares WHERE job_id = '${id}' ORDER BY helper_id`)).rows;
  const bad = [];
  for (const s of shares) {
    const c = Math.round(Number(s.share_amount) * 100);
    const want = stamp === FLAT ? c - helprFlatFeeCents(c, FLAT) : c - Math.round(c * 10 / 100);
    const msg = await notice(s.helper_id, id);
    if (!(c > 0 && msg.includes(`$${dollars(want)} `))) bad.push(`${dollars(c)} -> want $${dollars(want)}: ${msg.slice(60, 150)}`);
  }
  check(`${stamp === FLAT ? "F2 flat" : "L2 legacy"} crew cancel: each member is told their own share minus the fee`, shares.length === 3 && bad.length === 0, bad.join(" | ") || `${shares.length} shares`);
}

// F3 / L3 a banned poster, settled late.
for (const [id, poster, stamp, label] of [[FLAT_BAN, BP, FLAT, "F3 ban settlement, flat"], [LEG_BAN, BP, TIERED, "L3 ban settlement, legacy"]]) {
  await db.exec(job(id, { customer_id: `'${poster}'`, helper_id: `'${BH}'`, helper_confirmed_at: "now()", ...stamp }));
}
await db.exec(`SELECT public.settle_one_off_jobs_for_banned_account('${BP}')`);
for (const [id, stamp, label] of [[FLAT_BAN, FLAT, "F3 ban settlement, flat"], [LEG_BAN, TIERED, "L3 ban settlement, legacy"]]) {
  const fee = await feeCents(id);
  const want = stamp === FLAT ? fee - helprFlatFeeCents(fee, FLAT) : fee - Math.round(fee * 10 / 100);
  const msg = await notice(BH, id);
  check(`${label}: the Helpr is told about $${dollars(want)} of a $${dollars(fee)} fee`, fee > 0 && msg.includes(`$${dollars(want)} `), msg.slice(0, 160));
}

// F4 / L4 / L5 the export.
await db.exec(job(FLAT_EXP, { helper_id: `'${H}'`, status: `'completed'`, payment_status: `'released'`, urgent_fee: 15, helper_completed_at: "now()", ...FLAT }));
await db.exec(job(LEG_EXP, { helper_id: `'${H}'`, status: `'completed'`, payment_status: `'released'`, urgent_fee: 15, helper_completed_at: "now()", ...TIERED }));
await db.exec(job(LEDGER_EXP, { helper_id: `'${H}'`, status: `'completed'`, payment_status: `'released'`, helper_completed_at: "now()", ...FLAT }));
await db.exec(`INSERT INTO public.payout_transfers (job_id, helper_id, amount_cents, platform_fee_cents, status, metadata)
  VALUES ('${LEDGER_EXP}', '${H}', 9400, 570, 'paid', '{"rounding_remainder_cents": 30}')`);
const exp = (await asUser(H, `SELECT * FROM public.get_helper_earnings_export('${H}', (now() - interval '1 day')::date, (now() + interval '1 day')::date)`)).rows;
const row = (id) => exp.find((r) => r.job_id === id) ?? {};
const n = (v) => Math.round(Number(v) * 100);
{
  const r = row(FLAT_EXP), gross = 11_500, fee = helprFlatFeeCents(gross, FLAT);
  check("F4 a flat no-ledger row: gross $115 (budget + bonus), fee 5% + 70c, net = gross - fee",
    n(r.gross_budget) === gross && n(r.platform_fee) === fee && n(r.net_payout) === gross - fee, JSON.stringify([r.gross_budget, r.platform_fee, r.net_payout]));
  const l = row(LEG_EXP);
  check("L4 a legacy no-ledger row is unchanged ($100, 10%, $90)", n(l.gross_budget) === 10_000 && n(l.platform_fee) === 1_000 && n(l.net_payout) === 9_000,
    JSON.stringify([l.gross_budget, l.platform_fee, l.net_payout]));
  const g = row(LEDGER_EXP);
  check("L5 a ledger row is untouched (paid $94, fee $5.70 + 30c withheld)", n(g.gross_budget) === 10_000 && n(g.platform_fee) === 600 && n(g.net_payout) === 9_400,
    JSON.stringify([g.gross_budget, g.platform_fee, g.net_payout]));
}

// F5 analytics (entitled: jobs list; not entitled: preview).
{
  const list = (await asUser(H, `SELECT public.get_helper_analytics(365) a`)).rows[0].a;
  const jobs = list?.jobs ?? [];
  const flatRow = jobs.find((j) => j.id === FLAT_EXP);
  check("F5a entitled: the jobs list carries helper_fee_flat_cents", flatRow?.helper_fee_flat_cents === 70, JSON.stringify(flatRow ?? Object.keys(list ?? {})).slice(0, 160));
  await db.exec(`UPDATE public.analytics_toggle SET on_ = false`);
  const prev = (await asUser(H, `SELECT public.get_helper_analytics(365) a`)).rows[0].a;
  const pj = prev?.preview?.jobs ?? [];
  check("F5b not entitled: the preview carries helper_fee_flat_cents", pj.length === 3 && pj.filter((j) => j.helper_fee_flat_cents === 70).length === 2,
    JSON.stringify(pj).slice(0, 160));
}

// F6 grants.
{
  const r = (await db.query(`SELECT
      to_regprocedure('public.helpr_flat_fee_cents(numeric,numeric,numeric)') IS NOT NULL AS exists_,
      CASE WHEN to_regprocedure('public.helpr_flat_fee_cents(numeric,numeric,numeric)') IS NULL THEN NULL ELSE
        array[has_function_privilege('anon', 'public.helpr_flat_fee_cents(numeric,numeric,numeric)', 'EXECUTE'),
              has_function_privilege('authenticated', 'public.helpr_flat_fee_cents(numeric,numeric,numeric)', 'EXECUTE'),
              has_function_privilege('service_role', 'public.helpr_flat_fee_cents(numeric,numeric,numeric)', 'EXECUTE')] END AS h,
      array[has_function_privilege('anon', 'public.poster_cancel_job(uuid,text)', 'EXECUTE'),
            has_function_privilege('authenticated', 'public.poster_cancel_job(uuid,text)', 'EXECUTE'),
            has_function_privilege('authenticated', 'public.settle_one_off_jobs_for_banned_account(uuid)', 'EXECUTE'),
            has_function_privilege('service_role', 'public.settle_one_off_jobs_for_banned_account(uuid)', 'EXECUTE'),
            has_function_privilege('anon', 'public.get_helper_earnings_export(uuid,date,date)', 'EXECUTE'),
            has_function_privilege('authenticated', 'public.get_helper_earnings_export(uuid,date,date)', 'EXECUTE'),
            has_function_privilege('anon', 'public.get_helper_analytics(integer)', 'EXECUTE'),
            has_function_privilege('authenticated', 'public.get_helper_analytics(integer)', 'EXECUTE')] AS others`)).rows[0];
  check("F6 helpr_flat_fee_cents exists, service_role only; the four keep live's grants",
    r.exists_ && JSON.stringify(r.h) === "[false,false,true]" && JSON.stringify(r.others) === "[false,true,false,true,false,true,false,true]",
    JSON.stringify(r));
}

await db.close();
if (failures) {
  console.log(`${failures} FAILED`);
  process.exit(1);
}
console.log("ALL CHECKS PASSED");
