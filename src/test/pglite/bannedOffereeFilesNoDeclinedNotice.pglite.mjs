#!/usr/bin/env node
/**
 * PGlite proof for 20261103210601_banned_offeree_files_no_declined_notice
 * (docs/OPEN.md Q2132, finding: lh-money-escrow@25dc6611c#2).
 *
 *   npx tsx src/test/pglite/bannedOffereeFilesNoDeclinedNotice.pglite.mjs [--before]
 *
 * record_backout_notice, the ban settlement and the decline RPC are loaded at
 * their EFFECTIVE definition before this migration
 * (src/test/helpers/effectiveFunctionDefs.ts); the schema is
 * offerNoticesWaitForFunding.pglite.mjs's plus profiles.ban_status. Stubs (not
 * under test): apply_cancellation_violation_consequence, is_category_taxable,
 * helper_has_advanced_analytics, member_display_name (first word of the name),
 * send_backout_email (records its calls). Without --before the migration is
 * applied 3x (replay-safe) and every check must PASS; with --before B1 and B2
 * must FAIL and the C-checks pass both ways.
 *
 *   B1 the ban settlement closes a FUNDED pending offer TO a banned account:
 *      no "declined your offer" back-out row or email; the poster's own
 *      "Offer closed" notification still goes out
 *   B2 the same move for a 'permanently_banned' offeree (the trigger alone)
 *   C1 a Helpr who is not banned declines a funded offer: the back-out row
 *      and email are filed as before (offer_declined)
 *   C2 a banned offeree's offer EXPIRES: offer_expired is filed as before
 *   M  the definition before this migration equals prod's (md5 of prosrc and of
 *      pg_get_functiondef, read 2026-11-03)
 *   G  the trigger function stays callable by nobody but its owner and service_role
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { effectiveDefs } from "../helpers/effectiveFunctionDefs.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261103210601_banned_offeree_files_no_declined_notice.sql";
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
const P = U(1), H = U(2), BH = U(7), PB = U(9);
const TO_PAID = U(301), PERM_PAID = U(302), DEC_PAID = U(303), EXP_PAID = U(304);

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
  is_auto_created boolean DEFAULT false, instant_decline_until timestamptz, response_deadline timestamptz,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
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
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, subscription_tier text, parish text, full_name text, ban_status text);
CREATE TABLE public.louisiana_zip_parishes (zip_code text PRIMARY KEY, parish text);
CREATE TABLE public.job_accept_pending (job_id uuid, helper_id uuid);
CREATE TABLE public.backout_notices (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL, user_id uuid NOT NULL,
  actor_name text, backout_kind text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), acknowledged_at timestamptz, last_push_at timestamptz);
CREATE TABLE public.backout_emails (user_id uuid, job_id uuid, title text, message text);
CREATE FUNCTION public.send_backout_email(p_user uuid, p_job uuid, p_title text, p_message text, p_link text) RETURNS void
  LANGUAGE sql AS $$ INSERT INTO public.backout_emails VALUES (p_user, p_job, p_title, p_message) $$;
CREATE FUNCTION public.member_display_name(p_full_name text, p_x text) RETURNS text LANGUAGE sql IMMUTABLE AS
  $$ SELECT p_full_name $$;
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
  "crew_slot_share_cents", "ban_settlement_action", "job_payment_is_funded", "job_payment_is_listed",
  "settle_one_off_jobs_for_banned_account", "jobs_offer_target_gone_retires_offer",
  "respond_to_direct_offer", "backout_notice_text", "record_backout_notice",
].map(fnStmt).join("\n\n")}
REVOKE ALL ON FUNCTION public.record_backout_notice() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_jobs_record_backout_notice
  AFTER UPDATE OF status, helper_id, direct_offer_status ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.record_backout_notice();
CREATE TRIGGER zzz_jobs_offer_target_gone_retires_offer
  BEFORE UPDATE OF offered_to_helper_id ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.jobs_offer_target_gone_retires_offer();
`;

const SOON = `((now() + interval '3 days') AT TIME ZONE 'America/Chicago')`;
const job = (id, over) => {
  const cols = { id: `'${id}'`, customer_id: `'${P}'`, title: `'Job ${id.slice(-3)}'`, budget: 100, status: `'open'`,
    date_needed: `${SOON}::date`, start_time: `${SOON}::time`, helper_fee_percent: 5, helper_fee_flat_cents: 70,
    direct_offer_status: `'pending'`, direct_offer_expires_at: "now() + interval '2 hours'", payment_status: `'escrow'`, ...over };
  return `INSERT INTO public.jobs (${Object.keys(cols).join(", ")}) VALUES (${Object.values(cols).join(", ")});`;
};

const db = new PGlite();
await db.exec(SCHEMA);
// Base check: the body this migration restates is the live one. Both prod hashes, read-only 2026-11-03: md5(prosrc) cebd8eb5fe81315721e7877bfc464dc6 and
// md5(pg_get_functiondef) 84ff431a6979f58fbf4c1dc42d6460fa (one overload).
const base = (await db.query(`SELECT md5(prosrc) s, md5(pg_get_functiondef(oid)) d FROM pg_proc WHERE oid = 'public.record_backout_notice'::regproc`)).rows[0];
check("M the body restated is the live one (md5 of prosrc and of pg_get_functiondef before this migration equal prod's)",
  base.s === "cebd8eb5fe81315721e7877bfc464dc6" && base.d === "84ff431a6979f58fbf4c1dc42d6460fa", JSON.stringify(base));
if (!BEFORE) for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
console.log(BEFORE ? "-- BEFORE: migration NOT applied (B-checks must FAIL)" : "-- AFTER: migration applied 3x");

await db.exec(`INSERT INTO public.profiles (user_id, full_name, ban_status) VALUES
  ('${P}', 'Pat Poster', NULL), ('${H}', 'Hal Helpr', NULL), ('${BH}', 'Ben Banned', 'banned'), ('${PB}', 'Perm Banned', 'permanently_banned')`);

const backouts = async (id) => (await db.query(
  `SELECT (SELECT coalesce(string_agg(backout_kind, ','), '') FROM public.backout_notices WHERE job_id = $1) AS kinds,
          (SELECT count(*)::int FROM public.backout_emails WHERE job_id = $1) AS e`, [id])).rows[0];

// B1. The real ban settlement closes a funded pending offer TO the banned account.
await db.exec(job(TO_PAID, { offered_to_helper_id: `'${BH}'` }));
await db.exec(`SELECT public.settle_one_off_jobs_for_banned_account('${BH}')`);
const b1 = await backouts(TO_PAID);
const b1note = (await db.query(`SELECT title FROM public.notifications WHERE user_id = '${P}' AND job_id = '${TO_PAID}'`)).rows;
const b1row = (await db.query(`SELECT direct_offer_status o FROM public.jobs WHERE id = '${TO_PAID}'`)).rows[0];
check("B1 the ban settlement's closed offer files no \"declined your offer\" banner or email",
  b1.kinds === "" && b1.e === 0 && b1row.o === "declined", JSON.stringify({ b1, b1row }));
check("B1' the poster's own \"Offer closed\" notification still goes out", b1note.length === 1 && b1note[0].title === "Offer closed",
  JSON.stringify(b1note));

// B2. A permanently banned offeree, the trigger alone.
await db.exec(job(PERM_PAID, { offered_to_helper_id: `'${PB}'` }));
await db.exec(`UPDATE public.jobs SET direct_offer_status = 'declined', direct_offer_expires_at = NULL WHERE id = '${PERM_PAID}'`);
const b2 = await backouts(PERM_PAID);
check("B2 a permanently banned offeree's closed offer files no back-out banner or email", b2.kinds === "" && b2.e === 0, JSON.stringify(b2));

// C1. A Helpr who is not banned declines through the RPC: filed as before.
await db.exec(job(DEC_PAID, { offered_to_helper_id: `'${H}'` }));
await db.exec(`SELECT set_config('request.jwt.claim.sub', '${H}', false)`);
await db.query(`SELECT public.respond_to_direct_offer('${DEC_PAID}', false)`);
await db.exec(`SELECT set_config('request.jwt.claim.sub', '', false)`);
const c1 = await backouts(DEC_PAID);
check("C1 a real decline still files offer_declined and its email", c1.kinds === "offer_declined" && c1.e === 1, JSON.stringify(c1));

// C2. A banned offeree's offer that EXPIRES: unchanged.
await db.exec(job(EXP_PAID, { offered_to_helper_id: `'${BH}'` }));
await db.exec(`UPDATE public.jobs SET direct_offer_status = 'expired' WHERE id = '${EXP_PAID}'`);
const c2 = await backouts(EXP_PAID);
check("C2 an expiry still files offer_expired", c2.kinds === "offer_expired" && c2.e === 1, JSON.stringify(c2));

const g = (await db.query(`SELECT has_function_privilege('anon', 'public.record_backout_notice()', 'EXECUTE') a,
  has_function_privilege('authenticated', 'public.record_backout_notice()', 'EXECUTE') b`)).rows[0];
check("G record_backout_notice is not callable by anon or authenticated", !g.a && !g.b, JSON.stringify(g));

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
