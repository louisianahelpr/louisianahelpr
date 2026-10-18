#!/usr/bin/env node
/**
 * PGlite proof for 20261018050953_offer_notices_wait_for_funding (docs/OPEN.md
 * Q2093; owner 2026-10-17: "The job shouldn't post until the money is paid").
 *
 *   npx tsx src/test/pglite/offerNoticesWaitForFunding.pglite.mjs [--before]
 *
 * settle_one_off_jobs_for_banned_account and jobs_offer_target_gone_retires_offer
 * are loaded at their EFFECTIVE definition before this migration
 * (src/test/helpers/effectiveFunctionDefs.ts), with the real helpers the
 * settlement prices with and the real job_payment_is_funded; the schema is
 * sqlNoticesFlatFee.pglite.mjs's. Stubs (not under test):
 * apply_cancellation_violation_consequence, is_category_taxable,
 * helper_has_advanced_analytics. Without --before the migration is applied 3x
 * (replay-safe) and every check must PASS; with --before the U-checks and G
 * must FAIL (G only because the fixture grants nothing; prod never let anon
 * run the trigger function, the migration restates the grants)
 * and the F-checks pin the funded wording, green both ways.
 *
 *   U1 / F1 a banned poster's job with a pending direct offer: the offered
 *      Helpr is told "Offer closed" only when the job's money had arrived
 *   U2 / F2 a pending direct offer TO a banned account: the poster is told the
 *      job is "open to everyone again" only when its money had arrived
 *   U3 / F3 the offered Helpr's account goes (offered_to_helper_id -> NULL):
 *      the poster is told "The job is now open to everyone" only when funded
 *   S  every job's state change is the same either way (offer closed, job
 *      cancelled / declined / expired as before)
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { effectiveDefs } from "../helpers/effectiveFunctionDefs.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261018050953_offer_notices_wait_for_funding.sql";
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
const P = U(1), H = U(2), BP = U(6), BH = U(7), GONE = U(8);
const BAN_UNPAID = U(201), BAN_PAID = U(202), TO_UNPAID = U(203), TO_PAID = U(204), GONE_UNPAID = U(205), GONE_PAID = U(206);

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
  "job_payment_is_funded", "settle_one_off_jobs_for_banned_account", "jobs_offer_target_gone_retires_offer",
].map(fnStmt).join("\n\n")}
REVOKE ALL ON FUNCTION public.settle_one_off_jobs_for_banned_account(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_one_off_jobs_for_banned_account(uuid) TO service_role;
CREATE TRIGGER zzz_jobs_offer_target_gone_retires_offer
  BEFORE UPDATE OF offered_to_helper_id ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.jobs_offer_target_gone_retires_offer();
`;

const SOON = `((now() + interval '3 days') AT TIME ZONE 'America/Chicago')`;
const job = (id, over) => {
  const cols = { id: `'${id}'`, customer_id: `'${P}'`, title: `'Job ${id.slice(-3)}'`, budget: 100, status: `'open'`,
    date_needed: `${SOON}::date`, start_time: `${SOON}::time`, helper_fee_percent: 5, helper_fee_flat_cents: 70,
    direct_offer_status: `'pending'`, direct_offer_expires_at: "now() + interval '2 hours'", ...over };
  return `INSERT INTO public.jobs (${Object.keys(cols).join(", ")}) VALUES (${Object.values(cols).join(", ")});`;
};

const db = new PGlite();
await db.exec(SCHEMA);
if (!BEFORE) for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
console.log(BEFORE ? "-- BEFORE: migration NOT applied (U-checks must FAIL)" : "-- AFTER: migration applied 3x");

const notices = async (uid, jobId) => (await db.query(
  `SELECT title, message FROM public.notifications WHERE user_id = '${uid}' AND (job_id = '${jobId}' OR link LIKE '%${jobId}%')`)).rows;
const row = async (id) => (await db.query(`SELECT status::text s, direct_offer_status o FROM public.jobs WHERE id = '${id}'`)).rows[0];

// 1. A banned poster's open job carries a pending direct offer to H.
await db.exec(job(BAN_UNPAID, { customer_id: `'${BP}'`, offered_to_helper_id: `'${H}'`, payment_status: `'unpaid'` }));
await db.exec(job(BAN_PAID, { customer_id: `'${BP}'`, offered_to_helper_id: `'${H}'`, payment_status: `'escrow'` }));
// 2. A pending direct offer TO the account that is banned.
await db.exec(job(TO_UNPAID, { offered_to_helper_id: `'${BH}'`, payment_status: `'unpaid'` }));
await db.exec(job(TO_PAID, { offered_to_helper_id: `'${BH}'`, payment_status: `'escrow'` }));
await db.exec(`SELECT public.settle_one_off_jobs_for_banned_account('${BP}')`);
await db.exec(`SELECT public.settle_one_off_jobs_for_banned_account('${BH}')`);

const u1 = await notices(H, BAN_UNPAID), f1 = await notices(H, BAN_PAID);
check("U1 a banned poster's UNFUNDED job: the offered Helpr gets no notice", u1.length === 0, JSON.stringify(u1).slice(0, 160));
check("F1 a banned poster's FUNDED job: the offered Helpr is told \"Offer closed\"", f1.length === 1 && f1[0].title === "Offer closed", JSON.stringify(f1).slice(0, 160));

const u2 = await notices(P, TO_UNPAID), f2 = await notices(P, TO_PAID);
check("U2 an UNFUNDED offer to a banned account: the poster is told it is closed, never \"open to everyone\"",
  u2.length === 1 && /offer is closed/.test(u2[0].message) && !/open to everyone/i.test(u2[0].message), JSON.stringify(u2).slice(0, 200));
check("F2 a FUNDED offer to a banned account: the poster is told the job is open to everyone again",
  f2.length === 1 && /open to everyone again/.test(f2[0].message), JSON.stringify(f2).slice(0, 200));

// 3. The offered Helpr's account goes: purge / FK ON DELETE SET NULL clears the column.
await db.exec(job(GONE_UNPAID, { offered_to_helper_id: `'${GONE}'`, payment_status: `'unpaid'` }));
await db.exec(job(GONE_PAID, { offered_to_helper_id: `'${GONE}'`, payment_status: `'escrow'` }));
await db.exec(`UPDATE public.jobs SET offered_to_helper_id = NULL WHERE id IN ('${GONE_UNPAID}', '${GONE_PAID}')`);
const u3 = await notices(P, GONE_UNPAID), f3 = await notices(P, GONE_PAID);
check("U3 the offered Helpr's account goes, UNFUNDED job: the poster is told the offer is closed, never \"open to everyone\"",
  u3.length === 1 && /offer is closed/.test(u3[0].message) && !/open to everyone/i.test(u3[0].message), JSON.stringify(u3).slice(0, 200));
check("F3 the offered Helpr's account goes, FUNDED job: \"The job is now open to everyone\"",
  f3.length === 1 && /now open to everyone/.test(f3[0].message), JSON.stringify(f3).slice(0, 200));

// S. State changes are the same funded or not.
const s = {};
for (const [k, id] of Object.entries({ BAN_UNPAID, BAN_PAID, TO_UNPAID, TO_PAID, GONE_UNPAID, GONE_PAID })) s[k] = await row(id);
check("S the ban settlement and the retire trigger change each job the same way, funded or not",
  JSON.stringify(s.BAN_UNPAID) === JSON.stringify(s.BAN_PAID) && JSON.stringify(s.TO_UNPAID) === JSON.stringify(s.TO_PAID)
    && JSON.stringify(s.GONE_UNPAID) === JSON.stringify(s.GONE_PAID) && s.TO_PAID.o === "declined" && s.GONE_PAID.o === "expired"
    && s.BAN_PAID.s === "cancelled",
  JSON.stringify(s));

// Grants as before.
const g = (await db.query(`SELECT has_function_privilege('authenticated', 'public.settle_one_off_jobs_for_banned_account(uuid)', 'EXECUTE') a,
  has_function_privilege('anon', 'public.jobs_offer_target_gone_retires_offer()', 'EXECUTE') b,
  has_function_privilege('service_role', 'public.settle_one_off_jobs_for_banned_account(uuid)', 'EXECUTE') c`)).rows[0];
check("G grants: the settlement is service_role only; the trigger function is not callable by anon", !g.a && !g.b && g.c, JSON.stringify(g));

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
