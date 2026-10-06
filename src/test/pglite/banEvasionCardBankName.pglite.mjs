#!/usr/bin/env node
/**
 * PGlite proof for 20261006014801_ban_evasion_card_bank_and_name (docs/OPEN.md Q1324).
 *
 *   node src/test/pglite/banEvasionCardBankName.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/banEvasionCardBankName.pglite.mjs   # RED: the live state
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture: the ban machinery exactly as it is live, by REPLAYING the five
 * migrations that built it, verbatim and in order (20260903014600,
 * 20260908002148, 20260908003218, 20260908004351, 20260908010034;
 * pg_get_functiondef of retain_ban_for_user / enforce_retained_ban /
 * retain_ban_on_ban on prod matched them on 2026-10-05), over minimal live-
 * shaped tables (profiles' ban columns, user_bans, fraud_flags, error_logs).
 * No vault schema, so ban_fingerprint_salt() uses its replay constant.
 *
 * Then the new migration 3x (replay-safe), and the owner's rules (2026-10-05):
 *   - a banned person's CARD on a new account auto-bans it (same status,
 *     user_bans re-application, ban_evasion_attempt flag); RED on the live state;
 *   - their payout BANK on a new account auto-bans it; RED on the live state;
 *   - the keys survive the banned account's deletion (retained_bans keeps them);
 *   - their NAME on a new account only writes an admin-only match record: the account
 *     stays active and no user_bans row is written;
 *   - only salted hashes are stored: the raw Stripe fingerprint is nowhere;
 *   - an already-banned account is never re-banned at another level;
 *   - a lifted ban releases its card; a spent suspension is retired;
 *   - retrying does not stack fraud flags;
 *   - anon / authenticated can neither run the RPC nor read the table.
 * Review revisions (2026-10-05):
 *   - lh-authz-rls: what export_my_data returns for a flagged account (its
 *     fraud_flags and user_bans sections, cut verbatim from the newest
 *     export_my_data) holds NO other account's ban reason, date or retained
 *     id; the details are in admin-only ban_evasion_matches. RED before.
 *   - owner "ban now, admin settles": a card/bank ban settles NO job (the
 *     settlement functions are not called), opens a ban_settlement_queue
 *     row, holds payouts, and admin_ban_settlement_reviews() lists every job
 *     the settlement would act on; an admin's own ban still settles at once;
 *     admin_confirm_ban_settlement runs the settlement; lifting the ban closes
 *     the review, releases the hold and does not re-ban on the same card.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (name) =>
  readFileSync(new URL(`../../../supabase/migrations/${name}.sql`, import.meta.url).pathname, "utf8");
const PRIOR = [
  "20260903014600_ban_survives_self_deletion",
  "20260908002148_ban_survives_a_new_email_phone_and_identity",
  "20260908003218_ban_fingerprint_salt_was_never_created",
  "20260908004351_ban_evasion_attempt_reaches_an_admin",
  "20260908010034_unban_never_released_the_fingerprint",
];
const NEW = mig("20261006014801_ban_evasion_card_bank_and_name");
// Its follow-up (reviews + owner, 2026-10-05): neutral reason on the older path,
// the money freeze, Q1411's browse hiding, the open-review page.
const FOLLOW_UP = mig("20261006030849_ban_review_freezes_money_hides_posts_neutral_reason");
// Q1411's browse hiding, restated on the crew-era bodies after the crew batch
// (20261006023437 / 031016) redefined the same five objects first.
const HIDE = mig("20261006042617_ban_review_hides_posts_on_crew_surfaces");
// What those crew-era bodies call: crew_spots_open verbatim from 20261006023437,
// over a minimal roster table and the offer-cutoff helper.
const CREW_PREREQ = (() => {
  const src = mig("20261006023437_crew_free_spot_relisted");
  const at = src.indexOf("CREATE OR REPLACE FUNCTION public.crew_spots_open(");
  const end = src.indexOf("$fn$;", at) + "$fn$;".length;
  return `
CREATE TABLE IF NOT EXISTS public.group_job_helpers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL, helper_id uuid);
CREATE OR REPLACE FUNCTION public.job_offer_cutoff(d date, t time) RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT (d + COALESCE(t, time '00:00'))::timestamptz $$;
${src.slice(at, end)}`;
})();
// Final reviews (2026-10-06): during an open review the review alone decides
// the standing; an unban after a confirm finishes the review's cleanup.
// NEW_MIGRATION=skip-standing runs everything but this one (its red proof).
const STANDING = mig("20261006035830_ban_review_decides_standing");
// open_jobs_browse as its newest definition creates it (the DO / EXECUTE block).
const VIEW_SRC = (() => {
  const src = mig("20260927012806_recurring_split_days");
  const at = src.indexOf("CREATE OR REPLACE VIEW public.open_jobs_browse");
  const start = src.lastIndexOf("DO $view$", at);
  const end = src.indexOf("$view$;", at) + "$view$;".length;
  return src.slice(start, end);
})();
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the LIVE (unfixed) state (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const ADMIN = "aaaaaaaa-0000-4000-8000-000000000001";
const BANNED = "bbbbbbbb-0000-4000-8000-000000000002"; // the original offender
const CARD_NEW = "cccccccc-0000-4000-8000-000000000003"; // new email, same card
const BANK_NEW = "dddddddd-0000-4000-8000-000000000004"; // new email, same bank
const NAME_NEW = "eeeeeeee-0000-4000-8000-000000000005"; // new email, same name
const STRANGER = "ffffffff-0000-4000-8000-000000000006"; // nothing in common
const ALREADY = "11111111-0000-4000-8000-000000000007"; // already suspended
const PARDONED = "22222222-0000-4000-8000-000000000008"; // banned then unbanned
const AFTER_PARDON = "33333333-0000-4000-8000-000000000009";
const SPENT = "44444444-0000-4000-8000-00000000000a"; // suspension long over
const AFTER_SPENT = "55555555-0000-4000-8000-00000000000b";
const CARD_A = "Xk3fPq9LmN2bVc8z"; // shaped like a Stripe card fingerprint
const BANK_A = "Bk7Qw2Er5Ty8Ui1o";

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, phone text, raw_user_meta_data jsonb DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now());
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;

CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'customer', 'user');
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE TABLE public.notification_preferences (user_id uuid PRIMARY KEY);
-- profiles: the columns the ban machinery reads and writes (live names/types).
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text, email text, phone text,
  ban_status text DEFAULT 'active', auto_suspended_until timestamptz,
  latitude numeric, longitude numeric, parish text, subscription_tier text, subscription_expires_at timestamptz
);
-- user_bans / fraud_flags / error_logs: live columns (information_schema 2026-10-05).
CREATE TABLE public.user_bans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, ban_type text NOT NULL,
  reason text NOT NULL, banned_by uuid NOT NULL, expires_at timestamptz, is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.fraud_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id uuid, flag_type text NOT NULL, details text, resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.error_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, severity text NOT NULL DEFAULT 'error',
  message text NOT NULL, stack text, url text, user_agent text,
  tags jsonb NOT NULL DEFAULT '{}'::jsonb, context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.profiles TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO anon, authenticated, service_role;
CREATE TABLE public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admin_id uuid, action text NOT NULL,
  target_type text, target_id text, details jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
-- payout_holds as live (20261004162921).
CREATE TABLE public.payout_holds (
  helper_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text NOT NULL, held_by uuid, held_at timestamptz NOT NULL DEFAULT now(),
  denied_reason text, denied_by uuid, denied_at timestamptz
);
-- jobs: every column the browse surfaces, the review list and the settlement
-- predicate read, with the live types (information_schema, prod 2026-10-05).
CREATE TYPE public.job_status AS ENUM ('open','accepted','in_progress','completed','cancelled','revision_requested','disputed','pending_approval');
CREATE TYPE public.job_category AS ENUM ('cleaning','yard_work','moving','errands','handyman','painting','delivery','pet_care','assembly','other','storm_prep','events');
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid, title text, description text,
  category public.job_category DEFAULT 'other', location text, date_needed date, start_time time,
  estimated_hours numeric, budget numeric DEFAULT 100, photos text[], special_requirements text,
  status public.job_status NOT NULL DEFAULT 'open', helper_id uuid,
  created_at timestamptz NOT NULL DEFAULT now() - interval '3 days', updated_at timestamptz DEFAULT now(),
  payment_status text, boosted_at timestamptz, boost_expires_at timestamptz, is_recurring boolean DEFAULT false,
  recurrence_interval text, recurrence_end_date date, parent_job_id uuid, helpers_needed integer DEFAULT 1,
  is_group_job boolean NOT NULL DEFAULT false, expires_at timestamptz, latitude numeric DEFAULT 30.2241,
  longitude numeric DEFAULT -92.0198, is_urgent boolean DEFAULT false, urgent_fee numeric DEFAULT 0,
  is_flexible_schedule boolean DEFAULT false, parish text DEFAULT 'Lafayette', offered_to_helper_id uuid,
  direct_offer_status text, direct_offer_expires_at timestamptz, credential_tier integer DEFAULT 0,
  pricing_mode text DEFAULT 'fixed', recurrence_days smallint[], recurrence_weeks smallint,
  is_seed boolean NOT NULL DEFAULT false, require_photo_proof boolean DEFAULT false, series_split_ok boolean DEFAULT false
);
CREATE TABLE public.group_job_helpers (job_id uuid NOT NULL, helper_id uuid NOT NULL);
CREATE TABLE public.applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES public.jobs(id),
  helper_id uuid NOT NULL, status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.payout_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, stripe_transfer_id text,
  amount_cents integer NOT NULL DEFAULT 100, status text NOT NULL DEFAULT 'pending'
);
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text, message text, type text, link text, job_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- The helpers the browse surfaces and the application gate call, as stubs:
-- every gate but Q1411's is open here, so the proof isolates it.
CREATE FUNCTION public.early_access_cutoff() RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT now() $$;
CREATE FUNCTION public.seed_jobs_hidden_publicly() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.my_credential_tier() RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 0 $$;
CREATE FUNCTION public.get_user_credential_tier(uuid) RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 0 $$;
CREATE FUNCTION public.mask_job_location(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT $1 $$;
CREATE FUNCTION public.miles_between(numeric, numeric, numeric, numeric) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$ SELECT NULL::numeric $$;
CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT COALESCE(current_setting('request.uid', true), '') = '' $$;
CREATE FUNCTION public.are_users_blocked(uuid, uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.ops_alert_normalise(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT lower(btrim($1)) $$;
GRANT EXECUTE ON FUNCTION public.early_access_cutoff(), public.seed_jobs_hidden_publicly(), public.my_credential_tier(),
  public.get_user_credential_tier(uuid), public.mask_job_location(text) TO anon, authenticated;
GRANT SELECT, INSERT ON public.applications TO authenticated;
-- The live triggers whose functions the follow-up restates (stub bodies here).
CREATE FUNCTION public.enforce_application_job_state() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER trg_application_job_state BEFORE INSERT ON public.applications FOR EACH ROW EXECUTE FUNCTION public.enforce_application_job_state();
CREATE FUNCTION public.refuse_payout_claim_while_held() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER trg_refuse_payout_claim_while_held BEFORE INSERT ON public.payout_transfers FOR EACH ROW EXECUTE FUNCTION public.refuse_payout_claim_while_held();
-- The settlement itself is proven by banSettlesOneOffJobs.pglite.mjs; here it
-- only has to say WHETHER it ran, and for whom.
CREATE TABLE public.settle_calls (fn text, user_id uuid, as_of text, at timestamptz DEFAULT clock_timestamp());
CREATE FUNCTION public.settle_one_off_jobs_for_banned_account(p_user uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.settle_calls (fn, user_id) VALUES ('one_off', p_user);
  UPDATE public.jobs SET status = 'cancelled' WHERE customer_id = p_user AND status = 'open';
  RETURN '[]'::jsonb;
END $$;
CREATE FUNCTION public.end_series_for_banned_account(p_user uuid) RETURNS integer LANGUAGE plpgsql AS $$
BEGIN INSERT INTO public.settle_calls (fn, user_id) VALUES ('series', p_user); RETURN 0; END $$;
-- The live trigger functions' bodies (20260927012042 / 20260927012808) and triggers.
CREATE FUNCTION public.settle_one_off_jobs_on_permanent_ban() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM public.settle_one_off_jobs_for_banned_account(NEW.user_id); RETURN NULL; END $$;
CREATE FUNCTION public.end_series_on_permanent_ban() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM public.end_series_for_banned_account(NEW.user_id); RETURN NULL; END $$;
CREATE TRIGGER trg_settle_one_off_jobs_on_permanent_ban AFTER UPDATE OF ban_status ON public.profiles
  FOR EACH ROW WHEN (NEW.ban_status IN ('banned', 'permanently_banned') AND OLD.ban_status IS DISTINCT FROM NEW.ban_status)
  EXECUTE FUNCTION public.settle_one_off_jobs_on_permanent_ban();
CREATE TRIGGER trg_series_end_on_permanent_ban AFTER UPDATE OF ban_status ON public.profiles
  FOR EACH ROW WHEN (NEW.ban_status IN ('banned', 'permanently_banned') AND OLD.ban_status IS DISTINCT FROM NEW.ban_status)
  EXECUTE FUNCTION public.end_series_on_permanent_ban();
`);

for (const name of PRIOR) {
  try { await db.exec(mig(name)); }
  catch (e) { check(`prior migration ${name} replays`, false, e.message); }
}

// The DO block only REPLACES an existing view, so create it from its body first.
try {
  await db.exec(VIEW_SRC.slice(VIEW_SRC.indexOf("$v$") + 3, VIEW_SRC.lastIndexOf("$v$")));
  await db.exec(`GRANT SELECT ON public.open_jobs_browse TO anon, authenticated;`);
}
catch (e) { check("open_jobs_browse (20260927012806) creates", false, e.message); }

if (MODE !== "skip") {
  for (let i = 0; i < 3; i++) {
    try { await db.exec(NEW); }
    catch (e) { check(`migration applies (run ${i + 1})`, false, e.message); }
  }
  for (let i = 0; i < 3; i++) {
    try { await db.exec(FOLLOW_UP); }
    catch (e) { check(`follow-up migration applies (run ${i + 1})`, false, e.message); }
  }
  try { await db.exec(CREW_PREREQ); }
  catch (e) { check("crew-era prerequisites apply", false, e.message); }
  for (let i = 0; i < 3; i++) {
    try { await db.exec(HIDE); }
    catch (e) { check(`browse-hiding migration applies (run ${i + 1})`, false, e.message); }
  }
  if (MODE !== "skip-standing") {
    for (let i = 0; i < 3; i++) {
      try { await db.exec(STANDING); }
      catch (e) { check(`standing migration applies (run ${i + 1})`, false, e.message); }
    }
  }
}
// The follow-up restates the real settlement (proven by
// banSettlesOneOffJobs.pglite.mjs); here a stub says WHETHER it ran, for whom,
// and as of when (app.ban_settlement_as_of).
await db.exec(`
CREATE OR REPLACE FUNCTION public.settle_one_off_jobs_for_banned_account(p_user uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.settle_calls (fn, user_id, as_of) VALUES ('one_off', p_user, NULLIF(current_setting('app.ban_settlement_as_of', true), ''));
  UPDATE public.jobs SET status = 'cancelled' WHERE customer_id = p_user AND status = 'open';
  RETURN '[]'::jsonb;
END $$;`);

const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const one = async (sql, params = []) => (await q(sql, params))[0];
const tryQ = async (sql, params = []) => {
  try { return { rows: await q(sql, params), error: null }; }
  catch (e) { return { rows: null, error: e.message }; }
};

async function newAccount(id, email, name) {
  await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [id, email]);
  await db.query(`INSERT INTO public.profiles (user_id, email, full_name) VALUES ($1, $2, $3)`, [id, email, name]);
}
async function adminBan(id, status, reason, expires = null) {
  await db.query(
    `INSERT INTO public.user_bans (user_id, ban_type, reason, banned_by, expires_at) VALUES ($1, $2, $3, $4, $5)`,
    [id, status, reason, ADMIN, expires],
  );
  await db.query(`UPDATE public.profiles SET ban_status = $2, auto_suspended_until = $3 WHERE user_id = $1`, [id, status, expires]);
}
const enforce = (id, kind, fp) =>
  tryQ(`SELECT public.enforce_retained_payment_ban($1::uuid, $2, $3) AS r`, [id, kind, fp]);
const status = async (id) => (await one(`SELECT ban_status FROM public.profiles WHERE user_id = $1`, [id]))?.ban_status;
const flags = (id, type) =>
  q(`SELECT details FROM public.fraud_flags WHERE user_id = $1 AND flag_type = $2`, [id, type]);
const activeBans = (id) => q(`SELECT ban_type, reason, banned_by FROM public.user_bans WHERE user_id = $1 AND is_active`, [id]);

await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, 'admin@x.test')`, [ADMIN]);

// ── normalisation ──────────────────────────────────────────────────────────
{
  const r = await tryQ(
    `SELECT public.normalize_name_for_ban('  Jane  Q.  DOE ') a, public.normalize_name_for_ban('John') b,
            public.normalize_name_for_ban('Al B') c, public.normalize_name_for_ban(NULL) d`,
  );
  const row = r.rows?.[0];
  check("name normalises case, dots and spacing", row?.a === "jane q doe", JSON.stringify(row ?? r.error));
  check("a single word or under five letters is no name key", row && row.b === null && row.c === null && row.d === null);
}

// ── the offender: pays, attaches a bank, is banned, then deletes the account ─
await newAccount(BANNED, "offender@x.test", "Jane Q Doe");
{
  const c = await enforce(BANNED, "card", CARD_A);
  const b = await enforce(BANNED, "bank", BANK_A);
  check("a clean account's card and bank are recorded, not banned",
    c.rows?.[0]?.r?.banned === false && b.rows?.[0]?.r?.banned === false, c.error ?? b.error ?? "");
  const pf = await tryQ(`SELECT fingerprint_kind, fingerprint_sha256 FROM public.payment_fingerprints WHERE user_id = $1 ORDER BY fingerprint_kind`, [BANNED]);
  check("payment_fingerprints holds one salted hash per kind", pf.rows?.length === 2 && pf.rows.every((r) => /^[0-9a-f]{64}$/.test(r.fingerprint_sha256)), pf.error ?? "");
}
await adminBan(BANNED, "permanently_banned", "Took payment and never showed up");
{
  const rb = await tryQ(
    `SELECT card_sha256, bank_sha256, name_sha256 FROM public.retained_bans
      WHERE email_sha256 = encode(sha256('offender@x.test'::bytea), 'hex')`,
  );
  const row = rb.rows?.[0];
  const want = await tryQ(
    `SELECT public.ban_fingerprint('card', $1) c, public.ban_fingerprint('bank', $2) b, public.ban_fingerprint('name', 'jane q doe') n`,
    [CARD_A, BANK_A],
  );
  const w = want.rows?.[0];
  check("the ban retains the card hash", !!row && !!w && row.card_sha256?.includes(w.c), rb.error ?? "");
  check("the ban retains the bank hash", !!row && !!w && row.bank_sha256?.includes(w.b));
  check("the ban retains the name hash", !!row && !!w && row.name_sha256 === w.n);
}
// The retention call deletion makes, then the account goes (auth cascade).
await db.query(`SELECT public.retain_ban_on_deletion($1)`, [BANNED]);
await db.query(`DELETE FROM public.profiles WHERE user_id = $1`, [BANNED]);
await db.query(`DELETE FROM auth.users WHERE id = $1`, [BANNED]);
{
  const left = await tryQ(`SELECT count(*)::int n FROM public.payment_fingerprints WHERE user_id = $1`, [BANNED]);
  check("deleting the account removes its live fingerprint rows", left.rows?.[0]?.n === 0, left.error ?? "");
  const kept = await tryQ(`SELECT cardinality(card_sha256) c, cardinality(bank_sha256) b FROM public.retained_bans WHERE email_sha256 = encode(sha256('offender@x.test'::bytea), 'hex')`);
  check("the retained ban keeps card and bank after deletion", kept.rows?.[0]?.c === 1 && kept.rows?.[0]?.b === 1, kept.error ?? JSON.stringify(kept.rows));
}
{
  const dump = await tryQ(`SELECT (SELECT string_agg(t::text, ' ') FROM public.retained_bans t) a,
                                  coalesce((SELECT string_agg(t::text, ' ') FROM public.payment_fingerprints t), '') b`);
  const text = dump.rows ? `${dump.rows[0].a} ${dump.rows[0].b}` : null;
  check("no raw Stripe fingerprint is stored anywhere", text !== null && !text.includes(CARD_A) && !text.includes(BANK_A), dump.error ?? "");
}

// ── AUTO-BAN: same card, new email ─────────────────────────────────────────
await newAccount(CARD_NEW, "fresh-start@y.test", "Pat Smith");
{
  const r = await enforce(CARD_NEW, "card", CARD_A);
  check("a banned person's card on a new account reports banned on card",
    r.rows?.[0]?.r?.banned === true && r.rows?.[0]?.r?.matched_on === "card", r.error ?? JSON.stringify(r.rows?.[0]?.r));
  check("…and the account is banned now, pending review ('banned', no end date)", (await status(CARD_NEW)) === "banned");
  const orig = await tryQ(`SELECT original_ban_status FROM public.ban_settlement_queue WHERE user_id = $1`, [CARD_NEW]);
  check("…with the original judgment kept on the review", orig.rows?.[0]?.original_ban_status === "permanently_banned", orig.error ?? JSON.stringify(orig.rows));
  const bans = await activeBans(CARD_NEW);
  check("…with an active user_bans row whose reason is about THIS account, not the other one",
    bans.length === 1 && bans[0].banned_by === CARD_NEW && !bans[0].reason.includes("Took payment") && /payment method on this account/.test(bans[0].reason),
    JSON.stringify(bans));
  const f = await flags(CARD_NEW, "ban_evasion_attempt");
  check("…and one ban_evasion_attempt flag naming the card", f.length === 1 && /this account's card matched/.test(f[0].details), JSON.stringify(f));
  const m = await tryQ(`SELECT matched_on, original_reason, auto_banned FROM public.ban_evasion_matches WHERE user_id = $1`, [CARD_NEW]);
  check("…and the other account's ban details in the admin-only match record",
    m.rows?.length === 1 && m.rows[0].original_reason === "Took payment and never showed up" && m.rows[0].auto_banned === true, m.error ?? JSON.stringify(m.rows));
  const own = await tryQ(`SELECT card_sha256 FROM public.retained_bans WHERE email_sha256 = encode(sha256('fresh-start@y.test'::bytea), 'hex')`);
  check("…and the new account's own ban is retained with the card too", (own.rows?.[0]?.card_sha256?.length ?? 0) === 1, own.error ?? "");
  await enforce(CARD_NEW, "card", CARD_A);
  check("a retry does not stack a second flag", (await flags(CARD_NEW, "ban_evasion_attempt")).length === 1);
}

// ── AUTO-BAN: same payout bank, new email ──────────────────────────────────
await newAccount(BANK_NEW, "another@z.test", "Chris Lee");
{
  const r = await enforce(BANK_NEW, "bank", BANK_A);
  check("a banned person's payout bank on a new account bans it",
    r.rows?.[0]?.r?.banned === true && r.rows?.[0]?.r?.matched_on === "bank" && (await status(BANK_NEW)) === "banned",
    r.error ?? "");
  check("…with a flag naming the bank", (await flags(BANK_NEW, "ban_evasion_attempt")).some((f) => /this account's bank matched/.test(f.details)));
}

// ── SOFT: same name, new email: an admin-only record, never a ban ──────────
await newAccount(NAME_NEW, "jane.doe.2@w.test", "JANE  q. doe");
const nameMatches = () =>
  tryQ(`SELECT original_reason FROM public.ban_evasion_matches WHERE user_id = $1 AND matched_on = 'name'`, [NAME_NEW]);
{
  const nm = await nameMatches();
  check("a banned person's name on a new account files ONE admin-only name match", nm.rows?.length === 1, nm.error ?? JSON.stringify(nm.rows));
  check("…and does NOT ban the account", (await status(NAME_NEW)) === "active");
  check("…and writes no user_bans row", (await activeBans(NAME_NEW)).length === 0);
  check("…and NO fraud_flags row of any kind (it would be exported to them)",
    (await q(`SELECT 1 FROM public.fraud_flags WHERE user_id = $1`, [NAME_NEW])).length === 0);
  await db.query(`UPDATE public.profiles SET full_name = 'Jane Q Doe' WHERE user_id = $1`, [NAME_NEW]);
  check("renaming to the same normalised name does not stack a second record", (await nameMatches()).rows?.length === 1);
}

// ── nothing in common: nothing happens ─────────────────────────────────────
await newAccount(STRANGER, "stranger@v.test", "Morgan Brown");
{
  const r = await enforce(STRANGER, "card", "SomeOtherCard123");
  check("an unrelated card is not banned and not flagged",
    r.rows?.[0]?.r?.banned === false && (await status(STRANGER)) === "active" &&
      (await q(`SELECT 1 FROM public.fraud_flags WHERE user_id = $1`, [STRANGER])).length === 0, r.error ?? "");
}

// ── an already-banned account keeps its own ban ────────────────────────────
await newAccount(ALREADY, "already@u.test", "Robin Gray");
await adminBan(ALREADY, "temp_banned", "Rude messages", new Date(Date.now() + 7 * 864e5).toISOString());
{
  const r = await enforce(ALREADY, "card", CARD_A);
  check("an already-suspended account is not re-banned at another level",
    r.rows?.[0]?.r?.already_banned === true && (await status(ALREADY)) === "temp_banned", r.error ?? "");
  check("…but the admin still gets the flag", (await flags(ALREADY, "ban_evasion_attempt")).length === 1);
}

// ── a lifted ban releases its card ─────────────────────────────────────────
await newAccount(PARDONED, "pardoned@t.test", "Sam Green");
await enforce(PARDONED, "card", "PardonedCard777");
await adminBan(PARDONED, "permanently_banned", "Mistake");
await db.query(`UPDATE public.user_bans SET is_active = false WHERE user_id = $1`, [PARDONED]);
await db.query(`UPDATE public.profiles SET ban_status = 'active' WHERE user_id = $1`, [PARDONED]);
await newAccount(AFTER_PARDON, "pardoned-friend@t.test", "Taylor White");
{
  const r = await enforce(AFTER_PARDON, "card", "PardonedCard777");
  check("a pardoned person's card bans nobody", r.rows?.[0]?.r?.banned === false && (await status(AFTER_PARDON)) === "active", r.error ?? "");
}

// ── a spent suspension is retired, not applied ─────────────────────────────
await newAccount(SPENT, "spent@s.test", "Casey Black");
await enforce(SPENT, "card", "SpentCard999");
await adminBan(SPENT, "temp_banned", "Cooling off", new Date(Date.now() + 864e5).toISOString());
await db.query(`UPDATE public.retained_bans SET expires_at = now() - interval '1 day' WHERE email_sha256 = encode(sha256('spent@s.test'::bytea), 'hex')`);
await newAccount(AFTER_SPENT, "after-spent@s.test", "Jordan Blue");
{
  const r = await enforce(AFTER_SPENT, "card", "SpentCard999");
  check("a spent suspension's card is retired, not applied",
    r.rows?.[0]?.r?.banned === false && r.rows?.[0]?.r?.retired === true && (await status(AFTER_SPENT)) === "active", r.error ?? "");
}

// ── caller errors are errors ───────────────────────────────────────────────
{
  const bad = await enforce(STRANGER, "iban", "x");
  check("an unknown kind raises", !!bad.error && /card or bank/.test(bad.error), bad.error ?? "no error");
  const blank = await enforce(STRANGER, "card", "  ");
  check("a blank fingerprint raises", !!blank.error, blank.error ?? "no error");
}

// ── EXPORT: a flagged account sees nothing about the OTHER account ──────────
// The user_bans and fraud_flags sections, cut verbatim from the newest
// export_my_data, run for each flagged account.
{
  const { readdirSync } = await import("node:fs");
  const dir = new URL("../../../supabase/migrations/", import.meta.url).pathname;
  const latest = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()
    .filter((f) => /CREATE OR REPLACE FUNCTION public\.export_my_data/.test(readFileSync(dir + f, "utf8"))).pop();
  const def = readFileSync(dir + latest, "utf8");
  const sections = ["user_bans", "fraud_flags"].map((t) => {
    const m = new RegExp(`jsonb_build_object\\('${t}', (\\(SELECT[\\s\\S]*?WHERE t\\.user_id = v_uid\\))\\)`).exec(def);
    return m?.[1] ?? null;
  });
  check("both export sections were found in " + latest, sections.every(Boolean));
  const offender = await tryQ(`SELECT id::text, to_char(retained_at AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD') d
                                 FROM public.retained_bans WHERE email_sha256 = encode(sha256('offender@x.test'::bytea), 'hex')`);
  const rid = offender.rows?.[0]?.id ?? "no-row";
  for (const [who, id] of [["card match", CARD_NEW], ["bank match", BANK_NEW], ["name match", NAME_NEW]]) {
    let out = "";
    for (const sec of sections.filter(Boolean)) {
      const r = await tryQ(`SELECT ${sec.replaceAll("v_uid", `'${id}'::uuid`)} AS s`);
      out += JSON.stringify(r.rows?.[0]?.s ?? r.error);
    }
    check(`the ${who}'s data export holds no other account's ban reason, retained id or date`,
      !out.includes("Took payment") && !out.includes(rid), out.slice(0, 300));
  }
  const asUser = await (async () => {
    await db.exec(`SET ROLE authenticated; SELECT set_config('request.uid', '${NAME_NEW}', false);`);
    try { return { rows: (await db.query(`SELECT * FROM public.ban_evasion_matches`)).rows }; }
    catch (e) { return { error: e.message }; }
    finally { await db.exec(`RESET ROLE`); }
  })();
  check("the matched person cannot read the admin-only match records", (asUser.rows?.length ?? 0) === 0, asUser.error ?? JSON.stringify(asUser.rows));
}

// ── BAN NOW, ADMIN SETTLES ──────────────────────────────────────────────────
const REVIEWED = "66666666-0000-4000-8000-00000000000c";
const MANUAL = "77777777-0000-4000-8000-00000000000d";
const HIRED = "88888888-0000-4000-8000-00000000000e";
await db.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'admin')`, [ADMIN]);
const asAdmin = async (sql, params = []) => {
  await db.exec(`SET ROLE authenticated; SELECT set_config('request.uid', '${ADMIN}', false);`);
  try { return { rows: (await db.query(sql, params)).rows }; }
  catch (e) { return { error: e.message }; }
  finally { await db.exec(`RESET ROLE; SELECT set_config('request.uid', '', false);`); }
};
await newAccount(REVIEWED, "reviewed@r.test", "Avery Stone");
await newAccount(HIRED, "hired@r.test", "Quinn Field");
await db.query(`INSERT INTO public.jobs (title, customer_id, helper_id, status, payment_status) VALUES
  ('Open funded job', $1, NULL, 'open', 'escrow'),
  ('Booked job', $1, $2, 'accepted', 'escrow'),
  ('Job they work', $2, $1, 'in_progress', 'escrow'),
  ('Finished, payout pending', $2, $1, 'completed', 'payout_pending'),
  ('Long done', $1, $2, 'completed', 'released')`, [REVIEWED, HIRED]);
const crew = (await q(`INSERT INTO public.jobs (title, customer_id, status, payment_status, is_group_job)
                       VALUES ('Crew job, their share unpaid', $1, 'completed', 'escrow', true) RETURNING id`, [HIRED]))[0].id;
await db.query(`INSERT INTO public.group_job_helpers (job_id, helper_id) VALUES ($1, $2)`, [crew, REVIEWED]);
const settled = async (id) => (await q(`SELECT fn FROM public.settle_calls WHERE user_id = $1 ORDER BY fn`, [id])).map((r) => r.fn);
const reviewOf = (id) => tryQ(`SELECT review_state FROM public.ban_settlement_queue WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [id]);
{
  const r = await enforce(REVIEWED, "card", CARD_A);
  check("a card match bans at once", r.rows?.[0]?.r?.banned === true && (await status(REVIEWED)) === "banned", r.error ?? "");
  check("…but settles NO job (no cancellation, no fee, no refund)", (await settled(REVIEWED)).length === 0, JSON.stringify(await settled(REVIEWED)));
  const jobs = await q(`SELECT status FROM public.jobs WHERE customer_id = $1 OR helper_id = $1 ORDER BY title`, [REVIEWED]);
  check("…every job keeps its status", jobs.map((j) => j.status).join(",") === "accepted,completed,in_progress,completed,open", JSON.stringify(jobs));
  const rv = await reviewOf(REVIEWED);
  check("…and opens a ban settlement review", rv.rows?.[0]?.review_state === "open", rv.error ?? JSON.stringify(rv.rows));
  const hold = await tryQ(`SELECT reason, held_by FROM public.payout_holds WHERE helper_id = $1`, [REVIEWED]);
  check("…and holds their payouts (can't get paid)", hold.rows?.length === 1 && hold.rows[0].held_by === null, hold.error ?? JSON.stringify(hold.rows));

  const list = await asAdmin(`SELECT public.admin_ban_settlement_reviews() AS r`);
  const mine = (list.rows?.[0]?.r ?? []).find((x) => x.user_id === REVIEWED);
  const titles = (mine?.jobs ?? []).map((j) => j.title).sort();
  check("the admin queue lists EVERY job the settlement would act on (none stranded)",
    JSON.stringify(titles) === JSON.stringify(["Booked job", "Crew job, their share unpaid", "Finished, payout pending", "Job they work", "Open funded job"]), list.error ?? JSON.stringify(titles));
  check("…with the match details for the admin", (mine?.matches ?? []).some((m) => m.original_reason === "Took payment and never showed up"));
  const notAdmin = await (async () => {
    await db.exec(`SET ROLE authenticated; SELECT set_config('request.uid', '${HIRED}', false);`);
    try { await db.query(`SELECT public.admin_ban_settlement_reviews()`); return "ran"; }
    catch (e) { return e.message; }
    finally { await db.exec(`RESET ROLE`); }
  })();
  check("a non-admin cannot read the review queue", /admin_only/.test(notAdmin), notAdmin);

  const conf = await asAdmin(`SELECT public.admin_confirm_ban_settlement($1) AS r`, [REVIEWED]);
  check("an admin's confirm runs the normal settlement", JSON.stringify(await settled(REVIEWED)) === JSON.stringify(["one_off", "series"]), conf.error ?? "");
  check("…and closes the review as confirmed", (await reviewOf(REVIEWED)).rows?.[0]?.review_state === "confirmed");
  check("…and is audited", (await q(`SELECT 1 FROM public.admin_audit_log WHERE action = 'ban_settlement_confirmed' AND target_id = $1`, [REVIEWED])).length === 1);
}
{
  // A name match is marked checked through the audited admin RPC only.
  const nm = (await q(`SELECT id FROM public.ban_evasion_matches WHERE user_id = $1 AND matched_on = 'name'`, [NAME_NEW]))[0]?.id;
  const byUser = await (async () => {
    await db.exec(`SET ROLE authenticated; SELECT set_config('request.uid', '${NAME_NEW}', false);`);
    try { await db.query(`SELECT public.admin_resolve_ban_evasion_match($1)`, [nm]); return "ran"; }
    catch (e) { return e.message; }
    finally { await db.exec(`RESET ROLE`); }
  })();
  check("a non-admin cannot mark a name match checked", /admin_only/.test(byUser), byUser);
  const directWrite = await (async () => {
    await db.exec(`SET ROLE authenticated; SELECT set_config('request.uid', '${ADMIN}', false);`);
    try { await db.query(`UPDATE public.ban_evasion_matches SET resolved = true`); return "wrote"; }
    catch (e) { return e.message; }
    finally { await db.exec(`RESET ROLE`); }
  })();
  check("no client writes the match table directly (not even an admin)", /permission denied/.test(directWrite), directWrite);
  const res = await asAdmin(`SELECT public.admin_resolve_ban_evasion_match($1) AS r`, [nm]);
  check("an admin marks it checked, audited", res.rows?.[0]?.r === true &&
    (await q(`SELECT 1 FROM public.admin_audit_log WHERE action = 'ban_evasion_match_checked' AND target_id = $1`, [NAME_NEW])).length === 1, res.error ?? "");
}
{
  // An admin's own ban settles at once, exactly as before.
  await newAccount(MANUAL, "manual@r.test", "Drew Hill");
  await adminBan(MANUAL, "permanently_banned", "Fraud");
  check("an admin's manual ban still settles at once", JSON.stringify(await settled(MANUAL)) === JSON.stringify(["one_off", "series"]), JSON.stringify(await settled(MANUAL)));
  check("…and opens no review", (await reviewOf(MANUAL)).rows?.length === 0);
}
{
  // Lift: the admin unbans (set_ban_status 'active').
  const LIFTED = "99999999-0000-4000-8000-00000000000f";
  await newAccount(LIFTED, "spouse@r.test", "Sky Rivers");
  await db.query(`INSERT INTO public.jobs (title, customer_id, status, payment_status) VALUES ('Spouse job', $1, 'open', 'escrow')`, [LIFTED]);
  await enforce(LIFTED, "card", CARD_A);
  check("(lift) the shared-card account was banned and queued", (await status(LIFTED)) === "banned" && (await reviewOf(LIFTED)).rows?.[0]?.review_state === "open");
  const stray = await tryQ(`UPDATE public.profiles SET ban_status = 'active', auto_suspended_until = NULL WHERE user_id = $1`, [LIFTED]);
  check("authz: nothing but an admin lift can unban during an open review (an expiry, stray SQL)", !!stray.error && /ban_review_open/.test(stray.error), stray.error ?? "updated");
  check("…and it left the review open and the match uncleared",
    (await reviewOf(LIFTED)).rows?.[0]?.review_state === "open" &&
      (await q(`SELECT 1 FROM public.ban_evasion_matches WHERE user_id = $1 AND cleared_at IS NOT NULL`, [LIFTED])).length === 0);
  const notAdminLift = await tryQ(`SELECT public.lift_ban_settlement_review($1, $2, 'active')`, [LIFTED, LIFTED]);
  check("a lift must name an admin", !!notAdminLift.error && /admin_only/.test(notAdminLift.error), notAdminLift.error ?? "ran");
  const lift = await tryQ(`SELECT public.lift_ban_settlement_review($1, $2, 'active') AS r`, [LIFTED, ADMIN]);
  check("an admin lift unbans", lift.rows?.[0]?.r?.lifted === true && (await status(LIFTED)) === "active", lift.error ?? JSON.stringify(lift.rows));
  check("…attributed to that admin", (await tryQ(`SELECT decided_by FROM public.ban_settlement_queue WHERE user_id = $1`, [LIFTED])).rows?.[0]?.decided_by === ADMIN);
  check("lifting the ban closes the review as lifted", (await reviewOf(LIFTED)).rows?.[0]?.review_state === "lifted");
  check("…releases the payout hold this path placed", (await q(`SELECT 1 FROM public.payout_holds WHERE helper_id = $1`, [LIFTED])).length === 0);
  check("…and the job simply resumes (never settled)",
    (await settled(LIFTED)).length === 0 && (await q(`SELECT status FROM public.jobs WHERE customer_id = $1`, [LIFTED]))[0]?.status === "open");
  const again = await enforce(LIFTED, "card", CARD_A);
  check("the same card does not ban the cleared account again", again.rows?.[0]?.r?.banned === false && (await status(LIFTED)) === "active", again.error ?? JSON.stringify(again.rows?.[0]?.r));
}

// ── Follow-up (reviews + owner, 2026-10-05) ────────────────────────────────
const asRole = async (who, sql, params = []) => {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who ?? ""}', false);`);
  await db.exec(who ? "SET ROLE authenticated" : "SET ROLE anon");
  try { return { rows: (await db.query(sql, params)).rows }; }
  catch (e) { return { error: e.message }; }
  finally { await db.exec(`RESET ROLE; SELECT set_config('request.uid', '', false);`); }
};
const HIDER = "abababab-0000-4000-8000-000000000010"; // banned on a card match, posts open jobs
const APPLICANT = "cdcdcdcd-0000-4000-8000-000000000011";
const EARLIER = "efefefef-0000-4000-8000-000000000012";
await newAccount(HIDER, "hider@h.test", "Lee Morgan");
await newAccount(APPLICANT, "applicant@h.test", "Ray Hunt");
await newAccount(EARLIER, "earlier@h.test", "Kai West");
const hiddenJob = (await q(`INSERT INTO public.jobs (title, customer_id, status, payment_status, date_needed)
                             VALUES ('Hider job', $1, 'open', 'escrow', CURRENT_DATE + 7) RETURNING id`, [HIDER]))[0].id;
await db.query(`INSERT INTO public.applications (job_id, helper_id) VALUES ($1, $2)`, [hiddenJob, EARLIER]);
const surfaces = async () => {
  const seen = {};
  const b = await asRole(APPLICANT, `SELECT id FROM public.open_jobs_browse`);
  seen.browse = (b.rows ?? []).some((r) => r.id === hiddenJob) ? "shown" : (b.error ?? "hidden");
  const m = await asRole(APPLICANT, `SELECT id FROM public.get_open_jobs_for_map()`);
  seen.map = (m.rows ?? []).some((r) => r.id === hiddenJob) ? "shown" : (m.error ?? "hidden");
  const pub = await asRole(null, `SELECT id FROM public.get_public_open_jobs(50)`);
  seen.public = (pub.rows ?? []).some((r) => r.id === hiddenJob) ? "shown" : (pub.error ?? "hidden");
  const rk = await asRole(APPLICANT, `SELECT id FROM public.get_ranked_open_jobs(50, 0, true, NULL, NULL, NULL)`);
  seen.ranked = (rk.rows ?? []).some((r) => r.id === hiddenJob) ? "shown" : (rk.error ?? "hidden");
  const ann = await tryQ(`SELECT public.job_announceable_to(j, $2) AS a FROM public.jobs j WHERE j.id = $1`, [hiddenJob, APPLICANT]);
  seen.announce = ann.rows?.[0]?.a === true ? "shown" : (ann.error ?? "hidden");
  return seen;
};
{
  const before = await surfaces();
  check("Q1411: before any review the post shows on every surface (inventory floor)",
    Object.values(before).every((v) => v === "shown"), JSON.stringify(before));
  await enforce(HIDER, "card", CARD_A);
  const during = await surfaces();
  check("Q1411: while the poster's review is open the post is on NO browse surface",
    Object.values(during).every((v) => v === "hidden"), JSON.stringify(during));
  const apply = await asRole(APPLICANT, `INSERT INTO public.applications (job_id, helper_id) VALUES ($1, $2)`, [hiddenJob, APPLICANT]);
  check("Q1411: it takes no NEW application (neutral job_not_available)", !!apply.error && /job_not_available/.test(apply.error), apply.error ?? "inserted");
  check("Q1411: the existing application is untouched",
    (await q(`SELECT 1 FROM public.applications WHERE job_id = $1 AND helper_id = $2`, [hiddenJob, EARLIER])).length === 1);

  // Money freeze: a transfer claim and escrow -> payout_pending on the job.
  const claim = await tryQ(`INSERT INTO public.payout_transfers (job_id, helper_id, status) VALUES ($1, $2, 'pending')`, [hiddenJob, EARLIER]);
  check("money: no transfer may be claimed on a job whose POSTER is under review", !!claim.error && /payout_held/.test(claim.error), claim.error ?? "claimed");
  const recorded = await tryQ(`INSERT INTO public.payout_transfers (job_id, helper_id, status, stripe_transfer_id) VALUES ($1, $2, 'paid', 'tr_recorded')`, [hiddenJob, EARLIER]);
  check("…but a row RECORDING money that already moved is still accepted", !recorded.error, recorded.error ?? "");
  const move = await tryQ(`UPDATE public.jobs SET payment_status = 'payout_pending' WHERE id = $1`, [hiddenJob]);
  check("money: the job cannot move escrow -> payout_pending on any path", !!move.error && /ban_review_open/.test(move.error), move.error ?? "moved");

  const lift = await tryQ(`SELECT public.lift_ban_settlement_review($1, $2, 'active') AS r`, [HIDER, ADMIN]);
  const after = await surfaces();
  check("Q1411: after an admin lift the post is back everywhere, unchanged",
    !lift.error && Object.values(after).every((v) => v === "shown") &&
      (await q(`SELECT status::text, payment_status FROM public.jobs WHERE id = $1`, [hiddenJob]))[0]?.payment_status === "escrow",
    lift.error ?? JSON.stringify(after));
  const claimAfter = await tryQ(`INSERT INTO public.payout_transfers (job_id, helper_id, status) VALUES ($1, $2, 'pending')`, [hiddenJob, EARLIER]);
  check("…and its money moves again", !claimAfter.error, claimAfter.error ?? "");
}

{
  // Confirm reproduces the ban-time outcome; lift after confirm cleans up.
  const CONF = "12121212-0000-4000-8000-000000000013";
  await newAccount(CONF, "conf@c.test", "Dee Ford");
  await enforce(CONF, "card", CARD_A);
  const opened = (await q(`SELECT created_at::text c FROM public.ban_settlement_queue WHERE user_id = $1 AND review_state = 'open'`, [CONF]))[0]?.c;
  await db.query(`UPDATE public.ban_settlement_queue SET created_at = created_at - interval '2 days' WHERE user_id = $1`, [CONF]);
  const banTime = (await q(`SELECT created_at FROM public.ban_settlement_queue WHERE user_id = $1`, [CONF]))[0]?.created_at;
  await asAdmin(`SELECT public.admin_confirm_ban_settlement($1)`, [CONF]);
  const call = (await q(`SELECT as_of FROM public.settle_calls WHERE user_id = $1 AND fn = 'one_off'`, [CONF]))[0];
  check("confirm settles AS OF THE BAN (late-cancel fee priced then, not at the confirm)",
    !!opened && !!call?.as_of && Math.abs(new Date(call.as_of).getTime() - new Date(banTime).getTime()) < 1000, JSON.stringify({ call, banTime }));
  check("confirm applies the retained judgment (permanently_banned)", (await status(CONF)) === "permanently_banned");
  check("…and its triggers did not settle a second time, as of now",
    (await q(`SELECT 1 FROM public.settle_calls WHERE user_id = $1 AND fn = 'one_off'`, [CONF])).length === 1);
  const again = await asAdmin(`SELECT public.admin_confirm_ban_settlement($1)`, [CONF]);
  check("a second confirm finds no open review", /no_open_review/.test(again.error ?? ""), again.error ?? "ran");
  // Money review: a lift AFTER a confirm must release and clear as well.
  const lift = await tryQ(`SELECT public.lift_ban_settlement_review($1, $2, 'active') AS r`, [CONF, ADMIN]);
  check("a lift after a confirm unbans and closes the review as lifted",
    lift.rows?.[0]?.r?.lifted === true && lift.rows[0].r.review_state_was === "confirmed" && (await status(CONF)) === "active", lift.error ?? JSON.stringify(lift.rows));
  check("…releases the system payout hold", (await q(`SELECT 1 FROM public.payout_holds WHERE helper_id = $1`, [CONF])).length === 0);
  const re = await enforce(CONF, "card", CARD_A);
  check("…and clears the match, so the same card does not re-ban", re.rows?.[0]?.r?.banned === false && (await status(CONF)) === "active", re.error ?? JSON.stringify(re.rows?.[0]?.r));
}

{
  // A temporary original judgment: banned with NO end date while open.
  const TEMPO = "13131313-0000-4000-8000-000000000014";
  const TEMP_SRC = "14141414-0000-4000-8000-000000000015";
  await newAccount(TEMP_SRC, "temp-src@t.test", "Ash Gale");
  await enforce(TEMP_SRC, "card", "TempCard555");
  await adminBan(TEMP_SRC, "temp_banned", "Cooling off", new Date(Date.now() + 2 * 864e5).toISOString());
  await newAccount(TEMPO, "tempo@t.test", "Bo Lake");
  await enforce(TEMPO, "card", "TempCard555");
  const p = (await q(`SELECT ban_status, auto_suspended_until FROM public.profiles WHERE user_id = $1`, [TEMPO]))[0];
  check("authz: a match on a TEMPORARY ban still has no end date while the review is open (no expiry lifts it)",
    p?.ban_status === "banned" && p?.auto_suspended_until === null, JSON.stringify(p));
  check("…the temporary judgment is kept for the confirm",
    (await tryQ(`SELECT original_ban_status FROM public.ban_settlement_queue WHERE user_id = $1`, [TEMPO])).rows?.[0]?.original_ban_status === "temp_banned");
}

{
  // The admin alerts close themselves (Q355): their titles have a close rule
  // that re-asks the queue.
  const rule = await tryQ(`SELECT public.admin_alert_close_rule('Ban settlement review: an account was banned automatically') AS a,
                                  public.admin_alert_close_rule('Ban settlement review still waiting') AS b`);
  check("Q355: both review alert titles have the ban-settlement-review close rule",
    rule.rows?.[0]?.a === "ban-settlement-review" && rule.rows?.[0]?.b === "ban-settlement-review", rule.error ?? JSON.stringify(rule.rows));
  const pend = await tryQ(`SELECT public.admin_queue_still_pending('ban-settlement-review', '{}'::jsonb, now() - interval '1 day') AS p`);
  check("…which stays open while a review is open", pend.rows?.[0]?.p === true, pend.error ?? JSON.stringify(pend.rows));
}

{
  // An open review pages after 24 hours, once a day.
  const WAIT = "15151515-0000-4000-8000-000000000016";
  await newAccount(WAIT, "wait@w.test", "Cy Moon");
  await enforce(WAIT, "card", CARD_A);
  check("opening a review alerts every admin at once",
    (await q(`SELECT 1 FROM public.notifications WHERE type = 'admin_alert' AND user_id = $1 AND title LIKE 'Ban settlement review:%'`, [ADMIN])).length >= 1);
  await db.query(`UPDATE public.ban_settlement_queue SET created_at = now() - interval '25 hours' WHERE user_id = $1`, [WAIT]);
  const sw = await tryQ(`SELECT public.sweep_open_ban_settlement_reviews() AS r`);
  check("a review open over 24 hours pages (fatal error_logs)", (sw.rows?.[0]?.r?.paged ?? 0) >= 1 &&
    (await q(`SELECT 1 FROM public.error_logs WHERE severity = 'fatal' AND tags->>'source' = 'ban-settlement-review-open'`)).length >= 1, sw.error ?? JSON.stringify(sw.rows));
  const sw2 = await tryQ(`SELECT public.sweep_open_ban_settlement_reviews() AS r`);
  check("…and not again within 24 hours", sw2.rows?.[0]?.r?.paged === 0, JSON.stringify(sw2.rows));
}

{
  // The older retained-ban path (email / phone / identity) is neutral too.
  const EMAIL_SRC = "16161616-0000-4000-8000-000000000017";
  const EMAIL_NEW = "17171717-0000-4000-8000-000000000018";
  await newAccount(EMAIL_SRC, "repeat@e.test", "Flo Reed");
  await adminBan(EMAIL_SRC, "permanently_banned", "Threatened a Helpr");
  await db.query(`SELECT public.retain_ban_on_deletion($1)`, [EMAIL_SRC]);
  await db.query(`DELETE FROM public.profiles WHERE user_id = $1`, [EMAIL_SRC]);
  await db.query(`DELETE FROM auth.users WHERE id = $1`, [EMAIL_SRC]);
  await newAccount(EMAIL_NEW, "repeat@e.test", "Flo Reed");
  const r = await tryQ(`SELECT public.enforce_retained_ban($1, 'repeat@e.test', NULL, NULL) AS r`, [EMAIL_NEW]);
  check("email match still re-applies the ban", r.rows?.[0]?.r?.banned === true, r.error ?? JSON.stringify(r.rows));
  const bans = await activeBans(EMAIL_NEW);
  check("…with a neutral user_bans reason (not the retained one)", bans.length >= 1 && bans.every((b) => !b.reason.includes("Threatened")), JSON.stringify(bans));
  const f = await flags(EMAIL_NEW, "ban_evasion_attempt");
  check("…and a fraud flag with no retained reason or date", f.length === 1 && !f[0].details.includes("Threatened") && !/recorded \d{4}/.test(f[0].details), JSON.stringify(f));
  check("…while admins get the retained details in ban_evasion_matches",
    (await q(`SELECT original_reason FROM public.ban_evasion_matches WHERE user_id = $1 AND matched_on = 'email'`, [EMAIL_NEW]))[0]?.original_reason === "Threatened a Helpr");
}

{
  // Final authz review: a strike-ladder write during an open review (a
  // poster's no-show report, a job denial) keeps the standing, raises nothing
  // and so tells the reporter nothing; the strike is still the ladder's.
  const LAD = "18181818-0000-4000-8000-000000000019";
  await newAccount(LAD, "ladder@l.test", "Lee Park");
  await enforce(LAD, "card", CARD_A);
  const tryExec = async (sql) => { try { await db.exec(sql); return { error: null }; } catch (e) { return { error: e.message }; } };
  const fw = await tryExec(`BEGIN; SELECT set_config('app.trusted_ladder_write', 'on', true);
    UPDATE public.profiles SET ban_status = 'final_warning' WHERE user_id = '${LAD}'; COMMIT;`);
  if (fw.error) await db.exec("ROLLBACK").catch(() => {});
  check("a ladder final_warning during an open review raises nothing (no review leaked to the reporter)", fw.error === null, fw.error ?? "");
  check("…and leaves the account 'banned' under the review", (await status(LAD)) === "banned");
  const sus = await tryExec(`BEGIN; SELECT set_config('app.trusted_ladder_write', 'on', true);
    UPDATE public.profiles SET ban_status = 'temp_banned', auto_suspended_until = now() + interval '3 days' WHERE user_id = '${LAD}'; COMMIT;`);
  if (sus.error) await db.exec("ROLLBACK").catch(() => {});
  const after = (await q(`SELECT ban_status, auto_suspended_until FROM public.profiles WHERE user_id = $1`, [LAD]))[0];
  check("a ladder suspension during an open review keeps 'banned' with no end date (nothing for the expiry sweep)",
    sus.error === null && after?.ban_status === "banned" && after?.auto_suspended_until === null, sus.error ?? JSON.stringify(after));

  // Final money review: an admin's second ban during an open review is refused
  // (confirm or lift first), so nothing settles priced as of now.
  const calls0 = (await q(`SELECT count(*)::int n FROM public.settle_calls WHERE user_id = $1`, [LAD]))[0].n;
  const second = await tryQ(`UPDATE public.profiles SET ban_status = 'permanently_banned' WHERE user_id = $1`, [LAD]);
  check("a second ban during an open review is refused until the review is confirmed or lifted", /ban_review_open/.test(second.error ?? ""), second.error ?? "ran");
  const calls1 = (await q(`SELECT count(*)::int n FROM public.settle_calls WHERE user_id = $1`, [LAD]))[0].n;
  check("…and settles nothing", calls1 === calls0, JSON.stringify({ calls0, calls1 }));

  // After a CONFIRM, only an ADMIN's unban or the expiry sweep finishes the
  // review (lh-authz-rls review of fbdfa47c7, must-fix): the strike ladder,
  // run inside a banned person's own RPC, used to lift it in their name.
  const asUid = async (uid, sql, params = []) => {
    await db.exec(`SELECT set_config('request.uid', '${uid}', false);`);
    try { return { rows: (await db.query(sql, params)).rows }; }
    catch (e) { return { error: e.message }; }
    finally { await db.exec(`SELECT set_config('request.uid', '', false);`); }
  };
  const holds = async (id) => (await q(`SELECT 1 FROM public.payout_holds WHERE helper_id = $1`, [id])).length;
  const review = async (id) => (await q(`SELECT review_state, decided_by FROM public.ban_settlement_queue WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [id]))[0];
  const liveMatch = async (id) => (await q(`SELECT 1 FROM public.ban_evasion_matches WHERE user_id = $1 AND matched_on = 'card' AND cleared_at IS NULL`, [id])).length;
  const lifts = async (id) => q(`SELECT admin_id, details->>'via' via FROM public.admin_audit_log WHERE action = 'ban_settlement_lifted' AND target_id = $1`, [id]);

  // 1. An admin's unban (admin_reverse_violation's write) finishes it, in the admin's name.
  const UNB = "19191919-0000-4000-8000-000000000020";
  await newAccount(UNB, "unban@u.test", "Kay Moss");
  await enforce(UNB, "card", CARD_A);
  await asAdmin(`SELECT public.admin_confirm_ban_settlement($1)`, [UNB]);
  check("(setup) the confirm leaves the system payout hold in place", (await holds(UNB)) === 1);
  const un = await asUid(ADMIN, `UPDATE public.profiles SET ban_status = 'active' WHERE user_id = $1`, [UNB]);
  check("an admin's unban after a confirm releases the system payout hold", !un.error && (await holds(UNB)) === 0, un.error ?? "");
  const r1 = await review(UNB);
  check("…closes the review as lifted, decided by that admin", r1?.review_state === "lifted" && r1?.decided_by === ADMIN, JSON.stringify(r1));
  check("…audits it in the admin's name", JSON.stringify(await lifts(UNB)) === JSON.stringify([{ admin_id: ADMIN, via: "unban" }]), JSON.stringify(await lifts(UNB)));
  const re2 = await enforce(UNB, "card", CARD_A);
  check("…and clears the match, so the same card does not re-ban", re2.rows?.[0]?.r?.banned === false && (await status(UNB)) === "active", re2.error ?? JSON.stringify(re2.rows?.[0]?.r));

  // 2. The strike ladder after a confirm (the banned person declining an offer)
  //    lifts nothing and lowers nothing.
  const LADC = "20202020-0000-4000-8000-000000000021";
  await newAccount(LADC, "ladc@u.test", "Rory Vale");
  await enforce(LADC, "card", CARD_A);
  await asAdmin(`SELECT public.admin_confirm_ban_settlement($1)`, [LADC]);
  const before = await status(LADC);
  await db.exec(`SELECT set_config('request.uid', '${LADC}', false);`);
  const lw = await tryExec(`BEGIN; SELECT set_config('app.trusted_ladder_write', 'on', true);
    UPDATE public.profiles SET ban_status = 'final_warning' WHERE user_id = '${LADC}'; COMMIT;`);
  if (lw.error) await db.exec("ROLLBACK").catch(() => {});
  await db.exec(`SELECT set_config('request.uid', '', false);`);
  check("a ladder write after a confirm does not lower the ban", lw.error === null && (await status(LADC)) === before, lw.error ?? `${before} -> ${await status(LADC)}`);
  check("…keeps the system payout hold", (await holds(LADC)) === 1);
  check("…keeps the review confirmed and the card match live", (await review(LADC))?.review_state === "confirmed" && (await liveMatch(LADC)) === 1);
  check("…and writes no lift in anyone's name", (await lifts(LADC)).length === 0, JSON.stringify(await lifts(LADC)));
  // A non-admin caller that somehow wrote an unban still finishes nothing.
  const nonAdmin = await asUid(LADC, `UPDATE public.profiles SET ban_status = 'active' WHERE user_id = $1`, [LADC]);
  check("a non-admin's unban write after a confirm releases no hold and lifts nothing",
    !nonAdmin.error && (await holds(LADC)) === 1 && (await review(LADC))?.review_state === "confirmed", nonAdmin.error ?? "");

  // 3. The expiry sweep (no caller) at a confirmed temporary ban's end: hold
  //    released, review closed, but the match KEPT and the confirmer's name kept.
  const EXP = "21212121-0000-4000-8000-000000000022";
  await newAccount(EXP, "expiry@u.test", "Sam Lake");
  await enforce(EXP, "card", CARD_A);
  await asAdmin(`SELECT public.admin_confirm_ban_settlement($1)`, [EXP]);
  const confirmer = (await review(EXP))?.decided_by;
  // A caller-less unban that is NOT the sweep (a service-role edge write)
  // finishes nothing (both reviews of f2644839e: it was logged as an expiry).
  const svc = await tryExec(`UPDATE public.profiles SET ban_status = 'active', auto_suspended_until = NULL WHERE user_id = '${EXP}'`);
  check("a caller-less unban that is not the expiry sweep releases no hold and closes nothing",
    !svc.error && (await holds(EXP)) === 1 && (await review(EXP))?.review_state === "confirmed", svc.error ?? JSON.stringify(await review(EXP)));
  await db.query(`UPDATE public.profiles SET ban_status = 'temp_banned', auto_suspended_until = now() - interval '1 minute' WHERE user_id = $1`, [EXP]);
  // The sweep's own write, as sweep_expired_auto_bans issues it (it names itself).
  const sw = await tryExec(`BEGIN; SELECT set_config('app.ban_expiry_sweep', 'on', true);
    UPDATE public.profiles SET ban_status = 'active', auto_suspended_until = NULL WHERE user_id = '${EXP}'; COMMIT;`);
  if (sw.error) await db.exec("ROLLBACK").catch(() => {});
  const r3 = await review(EXP);
  check("an expiry after a confirm releases the system hold and closes the review", (await holds(EXP)) === 0 && r3?.review_state === "lifted", JSON.stringify(r3));
  check("…keeping the confirming admin's name on the review", r3?.decided_by === confirmer && confirmer === ADMIN, JSON.stringify({ confirmer, r3 }));
  check("…keeping the card match, so a later ban of the original account still re-bans", (await liveMatch(EXP)) === 1);
  check("…and logging a system row, not an admin's", JSON.stringify(await lifts(EXP)) === JSON.stringify([{ admin_id: null, via: "expiry" }]), JSON.stringify(await lifts(EXP)));

  // 4. A system hold an admin refused to release is never deleted by an unban.
  const DEN = "22222222-1111-4000-8000-000000000023";
  await newAccount(DEN, "denied@u.test", "Jo Park");
  await enforce(DEN, "card", CARD_A);
  await asAdmin(`SELECT public.admin_confirm_ban_settlement($1)`, [DEN]);
  await db.query(`UPDATE public.payout_holds SET denied_by = $2, denied_reason = 'still checking', denied_at = now() WHERE helper_id = $1`, [DEN, ADMIN]);
  await asUid(ADMIN, `UPDATE public.profiles SET ban_status = 'active' WHERE user_id = $1`, [DEN]);
  check("an unban leaves a system hold whose release an admin denied", (await holds(DEN)) === 1);

  // 5. LIVE BUG closed (lh-authz-rls): with no review at all, the unclamped
  //    ladder let a temp-banned Helpr move themselves to final_warning, and its
  //    suspend rung cut a longer suspension to 7 days. A raise still applies.
  const SELF = "23232323-0000-4000-8000-000000000024";
  await newAccount(SELF, "self@u.test", "Ari Bell");
  await db.query(`UPDATE public.profiles SET ban_status = 'temp_banned', auto_suspended_until = now() + interval '30 days' WHERE user_id = $1`, [SELF]);
  const ladder = (sql) => tryExec(`BEGIN; SELECT set_config('app.trusted_ladder_write', 'on', true); ${sql}; COMMIT;`);
  await ladder(`UPDATE public.profiles SET ban_status = 'final_warning' WHERE user_id = '${SELF}'`);
  check("the ladder cannot move a temp ban to final_warning (self-unban)", (await status(SELF)) === "temp_banned");
  await ladder(`UPDATE public.profiles SET ban_status = 'temp_banned', auto_suspended_until = now() + interval '7 days' WHERE user_id = '${SELF}'`);
  const longEnd = (await q(`SELECT auto_suspended_until > now() + interval '20 days' AS ok FROM public.profiles WHERE user_id = $1`, [SELF]))[0]?.ok;
  check("…nor shorten a 30-day suspension to 7 days", longEnd === true);
  await ladder(`UPDATE public.profiles SET ban_status = 'temp_banned', auto_suspended_until = now() + interval '60 days' WHERE user_id = '${SELF}'`);
  const longer = (await q(`SELECT auto_suspended_until > now() + interval '50 days' AS ok FROM public.profiles WHERE user_id = $1`, [SELF]))[0]?.ok;
  check("…while a LONGER suspension still applies", longer === true);
  await db.query(`UPDATE public.profiles SET ban_status = 'active', auto_suspended_until = NULL WHERE user_id = $1`, [SELF]);
  await ladder(`UPDATE public.profiles SET ban_status = 'final_warning' WHERE user_id = '${SELF}'`);
  check("…and a ladder rung on an unbanned account still applies", (await status(SELF)) === "final_warning");

  // 6. enforce_retained_ban on an account under an OPEN review records the
  //    match (for the admin deciding) instead of failing the IDV webhook. The
  //    matched row is ANOTHER (deleted) account's, with a different status, so
  //    the write really changes the standing (the earlier case matched the
  //    account's own 'banned' row and never exercised it: lh-authz-rls).
  const GONE = "26262626-0000-4000-8000-000000000027";
  await newAccount(GONE, "gone@e.test", "Gil Ode");
  await adminBan(GONE, "permanently_banned", "Threatened a poster");
  await db.query(`SELECT public.retain_ban_on_deletion($1)`, [GONE]);
  await db.query(`DELETE FROM public.profiles WHERE user_id = $1`, [GONE]);
  await db.query(`DELETE FROM auth.users WHERE id = $1`, [GONE]);
  const RET = "24242424-0000-4000-8000-000000000025";
  await newAccount(RET, "ret@e.test", "Flo Reed");
  await enforce(RET, "card", CARD_A);
  const rr = await tryQ(`SELECT public.enforce_retained_ban($1, 'gone@e.test', NULL, NULL) AS r`, [RET]);
  check("an identity/email match during an open review does not fail (stripe-idv-webhook would 500)", !rr.error, rr.error ?? "");
  check("…and the match is recorded for the admin", (await q(`SELECT 1 FROM public.ban_evasion_matches WHERE user_id = $1 AND matched_on = 'email'`, [RET])).length === 1);
  check("…while the review still decides the standing", (await review(RET))?.review_state === "open" && (await status(RET)) === "banned", await status(RET));

  // 6b. Never soften: an account already PERMANENTLY banned that matches a
  //     weaker (temporary) retained row keeps its permanent ban. complete-signup
  //     reaches this with any JWT and a phone from the request body.
  const TMP = "27272727-0000-4000-8000-000000000028";
  await newAccount(TMP, "tmp@e.test", "Tam Pell");
  await adminBan(TMP, "temp_banned", "Spam", new Date(Date.now() + 2 * 864e5).toISOString());
  await db.query(`SELECT public.retain_ban_on_deletion($1)`, [TMP]);
  await db.query(`DELETE FROM public.profiles WHERE user_id = $1`, [TMP]);
  await db.query(`DELETE FROM auth.users WHERE id = $1`, [TMP]);
  const PERM = "28282828-0000-4000-8000-000000000029";
  await newAccount(PERM, "perm@e.test", "Pat Erm");
  await adminBan(PERM, "permanently_banned", "Fraud");
  const soft = await tryQ(`SELECT public.enforce_retained_ban($1, 'tmp@e.test', NULL, NULL) AS r`, [PERM]);
  const permRow = (await q(`SELECT ban_status, auto_suspended_until FROM public.profiles WHERE user_id = $1`, [PERM]))[0];
  check("a weaker retained row never softens an existing permanent ban", !soft.error && permRow?.ban_status === "permanently_banned" && permRow?.auto_suspended_until === null, soft.error ?? JSON.stringify(permRow));

  // 7. A crew member under review cannot claim a transfer (jobs.helper_id is
  //    NULL on a crew job; the claim's recipient is checked too).
  const CREWJ = (await q(`INSERT INTO public.jobs (title, customer_id, helper_id, status, payment_status) VALUES ('Crew', $1, NULL, 'in_progress', 'escrow') RETURNING id`, [STRANGER]))[0].id;
  const LADR = "25252525-0000-4000-8000-000000000026";
  await newAccount(LADR, "crew@u.test", "Cam Ray");
  await enforce(LADR, "card", CARD_A);
  await db.query(`DELETE FROM public.payout_holds WHERE helper_id = $1`, [LADR]);
  const cc = await tryQ(`INSERT INTO public.payout_transfers (job_id, helper_id, status) VALUES ($1, $2, 'pending')`, [CREWJ, LADR]);
  check("a crew member under an open review cannot claim a transfer, even with no hold row", /payout_held/.test(cc.error ?? ""), cc.error ?? "claimed");
}

// ── grants ─────────────────────────────────────────────────────────────────
for (const role of ["anon", "authenticated"]) {
  const fn = await tryQ(`SELECT has_function_privilege('${role}', 'public.enforce_retained_payment_ban(uuid,text,text)', 'EXECUTE') ok`);
  check(`${role} cannot run enforce_retained_payment_ban`, fn.rows?.[0]?.ok === false, fn.error ?? "");
  const tb = await tryQ(`SELECT has_table_privilege('${role}', 'public.payment_fingerprints', 'SELECT') ok`);
  check(`${role} cannot read payment_fingerprints`, tb.rows?.[0]?.ok === false, tb.error ?? "");
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
