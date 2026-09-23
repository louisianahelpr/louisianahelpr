#!/usr/bin/env node
/**
 * PGlite proof for 20260923172405_retire_approval_status_reads (docs/OPEN.md Q205 b).
 *
 *   node src/test/pglite/retireApprovalStatusReads.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/retireApprovalStatusReads.pglite.mjs   # RED: the old state
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * The OLD state is not retyped: every function is read from the migration that
 * holds its NEWEST definition before this one (the same files the new
 * migration restates), and the INSERT policy from 20260903023314. The fixture
 * tables carry exactly the columns those bodies read. Stubs: auth.uid() reads
 * a session setting; identity_is_verified() is the live two-input verdict
 * shape; has_role() reads user_roles.
 *
 * The new migration is applied THREE times (replay safety) on top of the old
 * state, then every check below runs.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const NEW = mig("20260923172405_retire_approval_status_reads.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the OLD state (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

/** The last CREATE [OR REPLACE] FUNCTION public.<name>( … ) statement in <file>. */
function oldDef(file, name) {
  const re = new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.${name}\s*\([\s\S]*?\bAS\s+(\$\w*\$)[\s\S]*?\1\s*;`, "gi");
  const all = [...mig(file).matchAll(re)];
  if (!all.length) throw new Error(`no definition of ${name} in ${file}`);
  return all[all.length - 1][0].replace(/^CREATE\s+FUNCTION/i, "CREATE OR REPLACE FUNCTION");
}
const OLD_DEFS = [
  ["20260907062224_public_profile_identity_verdict_matches_the_hire_gate.sql", "get_safe_profiles"],
  ["20260907062224_public_profile_identity_verdict_matches_the_hire_gate.sql", "get_public_profile_stats"],
  ["20260907194823_reviews_overall_only.sql", "get_public_profile_reviews"],
  ["20260830105419_search_profiles_rate_limit.sql", "search_profiles_by_name"],
  ["20260612510000_saved_helpers_available_until.sql", "get_my_saved_helpers"],
  ["20260724194356_grant_admin_rpc_execute_to_authenticated.sql", "get_helper_tiers"],
  ["20260509195035_rewrite_helper_filters_behavior_based.sql", "get_parish_activity"],
  ["20260911201653_job_match_notification_preference.sql", "notify_helpers_on_job_post"],
  ["20260911201653_job_match_notification_preference.sql", "notify_saved_searches_on_new_job"],
  ["20260923121354_seed_subject_never_notifies_real.sql", "sweep_daily_job_digest"],
  ["20260915101102_null_uid_is_not_server.sql", "prevent_self_escalation"],
  ["20260505180000_helper_verifications_history.sql", "log_verification_change"],
  ["20260505234501_three_more_role_column_trigger_fixes.sql", "sync_email_verified"],
  ["20260505234501_three_more_role_column_trigger_fixes.sql", "sync_email_verified_on_insert"],
];
const oldPolicy = (() => {
  const m = mig("20260903023314_pin_trust_columns_on_profile_insert.sql").match(/CREATE POLICY "Users can insert their own profile"[\s\S]*?\n  \);/);
  if (!m) throw new Error("old INSERT policy not found");
  return m[0] + ";";
})();

const U = (n) => `22222222-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const VERIFIED = U(1); // confirmed email, approved (the 59 prod rows look like this)
const FORM_ONLY = U(2); // submitted the signup form, never confirmed: 'approved', unverified
const FRESH_CONFIRMED = U(3); // confirmed, still 'pending' (a row the old trigger missed)
const VIEWER = U(4);
const DRIFT = U(5); // auth confirmed, mirror says false
const NEW_SIGNUP = U(6); // inserted during the test

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email_confirmed_at timestamptz);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

CREATE TYPE public.app_role AS ENUM ('admin', 'customer');
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT auth.uid() IS NULL $$;
CREATE FUNCTION public.identity_is_verified(p_idv_status text, p_stripe_verified boolean) RETURNS boolean
  LANGUAGE sql IMMUTABLE AS $$ SELECT COALESCE(p_idv_status = 'verified', false) OR COALESCE(p_stripe_verified, false) $$;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE NOT NULL,
  full_name text, avatar_url text, bio text, location text, skills text, hourly_rate numeric,
  subscription_tier text, subscription_expires_at timestamptz, portfolio_urls text[],
  created_at timestamptz DEFAULT now(), idv_status text, stripe_identity_verified boolean NOT NULL DEFAULT false,
  stripe_account_id text, stripe_payouts_enabled boolean DEFAULT false,
  is_licensed boolean NOT NULL DEFAULT false, license_status text NOT NULL DEFAULT 'none',
  is_insured boolean NOT NULL DEFAULT false, insurance_status text NOT NULL DEFAULT 'none', business_name text,
  approval_status text NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved')),
  ban_status text DEFAULT 'active', email_verified boolean NOT NULL DEFAULT false, parish text,
  available_until timestamptz, background_check_status text NOT NULL DEFAULT 'none',
  idv_confidence numeric, idv_failure_reason text, idv_session_id text,
  legacy_manual_review boolean NOT NULL DEFAULT false, onboarding_fee_paid boolean NOT NULL DEFAULT false,
  license_expires_at timestamptz, insurance_expires_at timestamptz, apple_original_transaction_id text,
  is_seed boolean NOT NULL DEFAULT false);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT TO authenticated USING (true);
GRANT SELECT, INSERT ON public.profiles TO authenticated;

CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid, helper_id uuid,
  status text DEFAULT 'open', category text, date_needed date, start_time time, revision_count int,
  helper_arrived_at timestamptz, poster_completed_at timestamptz, helper_completed_at timestamptz,
  updated_at timestamptz DEFAULT now(), parish text, platform_fee_amount numeric, customer_fee_amount numeric);
CREATE TABLE public.reviews (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reviewee_id uuid, reviewer_id uuid,
  job_id uuid, rating int, feedback text, created_at timestamptz DEFAULT now(), status text DEFAULT 'published',
  feedback_visible_at timestamptz DEFAULT now() - interval '1 day', response_text text, response_at timestamptz);
CREATE TABLE public.helper_credentials (user_id uuid, status text);
CREATE TABLE public.favorite_helpers (customer_id uuid, helper_id uuid, created_at timestamptz DEFAULT now(), private_note text);
CREATE TABLE public.profile_search_rate_log (searcher_id uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.helper_verifications (user_id uuid, changed_by uuid, field text, old_value text, new_value text);
-- The rest of the columns prevent_self_escalation pins (its NEW.x := OLD.x list).
ALTER TABLE public.profiles ADD COLUMN application_count text, ADD COLUMN approval_email_count text, ADD COLUMN auto_suspended_until text, ADD COLUMN denial_email_count text, ADD COLUMN denial_reason text, ADD COLUMN drip_step text, ADD COLUMN has_applied_before text, ADD COLUMN id_verification_status text, ADD COLUMN idv_attempt_count text, ADD COLUMN idv_attempted_at text, ADD COLUMN insurance_rejection_reason text, ADD COLUMN insurance_reviewed_at text, ADD COLUMN insurance_reviewed_by text, ADD COLUMN is_legacy_user text, ADD COLUMN last_approval_email_at text, ADD COLUMN last_denial_email_at text, ADD COLUMN last_drip_at text, ADD COLUMN last_verification_email_at text, ADD COLUMN license_rejection_reason text, ADD COLUMN license_reviewed_at text, ADD COLUMN license_reviewed_by text, ADD COLUMN onboarding_fee_charged_at text, ADD COLUMN stripe_charges_enabled text, ADD COLUMN stripe_customer_id text, ADD COLUMN stripe_identity_verified_at text, ADD COLUMN stripe_subscription_id text, ADD COLUMN subscription_billing_cycle text, ADD COLUMN subscription_cancel_at_period_end text, ADD COLUMN verification_email_count text;
CREATE TABLE public.error_logs (severity text, message text, tags jsonb, context jsonb, created_at timestamptz DEFAULT now());
CREATE POLICY "Users can update their own safe fields" ON public.profiles FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
GRANT UPDATE ON public.profiles TO authenticated;
CREATE INDEX idx_profiles_pending_verified ON public.profiles (approval_status, email_verified)
  WHERE approval_status = 'pending';
`);

// ── OLD state: every function at its previous newest definition ──
for (const [file, name] of OLD_DEFS) await db.exec(oldDef(file, name));
await db.exec(oldPolicy);
// …and the ACLs those migrations left (so the ACL checks below are not red on the old state for a fixture reason).
await db.exec(`
REVOKE ALL ON FUNCTION public.get_public_profile_stats(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_profile_stats(uuid[]) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_public_profile_reviews(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_public_profile_reviews(uuid, integer, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.prevent_self_escalation() FROM PUBLIC, anon;`);
await db.exec(`
CREATE TRIGGER profiles_verification_history AFTER UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.log_verification_change();
CREATE TRIGGER tr_prevent_self_escalation BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_self_escalation();
`);

// Prod-shaped rows, created the way prod creates them (auth row, then profile + customer role).
async function account(uid, { confirmed, approval, emailVerified, name }) {
  await db.query(`INSERT INTO auth.users (id, email_confirmed_at) VALUES ($1, $2)`, [uid, confirmed ? new Date().toISOString() : null]);
  await db.query(`INSERT INTO public.profiles (user_id, full_name, approval_status, email_verified) VALUES ($1, $2, $3, $4)`,
    [uid, name, approval, emailVerified]);
  await db.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'customer')`, [uid]);
}
await account(VERIFIED, { confirmed: true, approval: "approved", emailVerified: true, name: "Vera Verified" });
await account(FORM_ONLY, { confirmed: false, approval: "approved", emailVerified: false, name: "Fran Formonly" });
await account(FRESH_CONFIRMED, { confirmed: true, approval: "pending", emailVerified: true, name: "Faye Freshconfirmed" });
await account(VIEWER, { confirmed: true, approval: "approved", emailVerified: true, name: "Vic Viewer" });
await account(DRIFT, { confirmed: true, approval: "approved", emailVerified: false, name: "Dru Drift" });
await db.exec(`
INSERT INTO public.jobs (id, customer_id, helper_id, status, category, parish)
VALUES ('33333333-0000-0000-0000-000000000001', '${VIEWER}', '${VERIFIED}', 'completed', 'cleaning', 'Orleans'),
       ('33333333-0000-0000-0000-000000000002', '${VIEWER}', '${FRESH_CONFIRMED}', 'completed', 'cleaning', 'Orleans'),
       ('33333333-0000-0000-0000-000000000003', '${VIEWER}', '${FORM_ONLY}', 'completed', 'cleaning', 'Orleans');
INSERT INTO public.reviews (reviewee_id, reviewer_id, job_id, rating)
VALUES ('${VIEWER}', '${FRESH_CONFIRMED}', '33333333-0000-0000-0000-000000000002', 5),
       ('${VIEWER}', '${FORM_ONLY}', '33333333-0000-0000-0000-000000000003', 4);
INSERT INTO public.favorite_helpers (customer_id, helper_id) VALUES
  ('${VIEWER}', '${VERIFIED}'), ('${VIEWER}', '${FORM_ONLY}'), ('${VIEWER}', '${FRESH_CONFIRMED}');
`);

// ── NEW migration, three times ──
if (!MODE) {
  for (let i = 1; i <= 3; i++) {
    await db.exec(NEW);
    console.log(`applied new migration (${i}/3)`);
  }
}

const asUser = async (uid, sql, params = []) => {
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false)`);
  const r = await db.query(sql, params);
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '', false)`);
  return r.rows;
};
const ids = (rows, key = "user_id") => new Set(rows.map((r) => r[key]));
const all = [VERIFIED, FORM_ONLY, FRESH_CONFIRMED, DRIFT];

// 1. Nothing in the database reads approval_status any more.
const readers = (await db.query(`
  SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prosrc ~* 'approval_status' ORDER BY 1`)).rows.map((r) => r.proname);
check("no public function body names approval_status", readers.length === 0, readers.join(", "));
const policyReaders = (await db.query(`
  SELECT policyname FROM pg_policies WHERE schemaname = 'public'
    AND (coalesce(qual, '') ~* 'approval_status' OR coalesce(with_check, '') ~* 'approval_status')`)).rows.map((r) => r.policyname);
check("no RLS policy names approval_status", policyReaders.length === 0, policyReaders.join(", "));
const idx = (await db.query(`
  SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexdef ~* 'approval_status'`)).rows.map((r) => r.indexname);
check("no index is defined over approval_status", idx.length === 0, idx.join(", "));
const statsCols = (await db.query(`
  SELECT unnest(proargnames) AS a FROM pg_proc WHERE proname = 'get_public_profile_stats'`)).rows.map((r) => r.a);
check("get_public_profile_stats no longer returns approval_status", !statsCols.includes("approval_status"), `${statsCols.length} args/cols`);

// 2. The mirror was re-derived from auth.users (drift row fixed; nothing else moved).
const drift = (await db.query(`SELECT email_verified FROM public.profiles WHERE user_id = $1`, [DRIFT])).rows[0];
check("email_verified re-derived from auth.users on a drifted row", drift.email_verified === true);
const formOnly = (await db.query(`SELECT email_verified FROM public.profiles WHERE user_id = $1`, [FORM_ONLY])).rows[0];
check("an unconfirmed account stays unverified", formOnly.email_verified === false);

// 3. Public surfaces gate on the entry gate (email confirmed), not on approval_status.
const safe = ids(await asUser(VIEWER, `SELECT user_id FROM public.get_safe_profiles($1::uuid[])`, [all]));
check("get_safe_profiles lists a confirmed account whatever approval_status says", safe.has(VERIFIED) && safe.has(FRESH_CONFIRMED) && safe.has(DRIFT), [...safe].join(","));
check("get_safe_profiles hides an account that never confirmed its email", !safe.has(FORM_ONLY));
const stats = ids(await asUser(VIEWER, `SELECT user_id FROM public.get_public_profile_stats($1::uuid[])`, [all]));
check("get_public_profile_stats: same gate as get_safe_profiles", stats.has(FRESH_CONFIRMED) && !stats.has(FORM_ONLY) && stats.has(VERIFIED));
const own = ids(await asUser(FORM_ONLY, `SELECT user_id FROM public.get_public_profile_stats($1::uuid[])`, [[FORM_ONLY]]));
check("get_public_profile_stats: your own row is always yours", own.has(FORM_ONLY));
const found = ids(await asUser(VIEWER, `SELECT user_id FROM public.search_profiles_by_name('fr')`));
check("search_profiles_by_name finds the confirmed, not the unconfirmed", found.has(FRESH_CONFIRMED) && !found.has(FORM_ONLY), [...found].join(","));
const saved = ids(await asUser(VIEWER, `SELECT helper_id FROM public.get_my_saved_helpers()`), "helper_id");
check("get_my_saved_helpers: confirmed helpers only", saved.has(VERIFIED) && saved.has(FRESH_CONFIRMED) && !saved.has(FORM_ONLY));
const reviews = await asUser(VIEWER, `SELECT reviewer_name FROM public.get_public_profile_reviews($1)`, [VIEWER]);
const names = reviews.map((r) => r.reviewer_name);
check("get_public_profile_reviews names a confirmed reviewer and not an unconfirmed one",
  names.includes("Faye Freshconfirmed") && !names.includes("Fran Formonly"), JSON.stringify(names));

// 4. The sync triggers keep the mirror and nothing else.
await db.exec(`
  CREATE OR REPLACE TRIGGER sync_email_verified_insert_trigger AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.sync_email_verified_on_insert();
  CREATE OR REPLACE TRIGGER sync_email_verified_trigger AFTER UPDATE OF email_confirmed_at ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.sync_email_verified();`);
await db.query(`INSERT INTO public.profiles (user_id, full_name) VALUES ($1, 'Nia Newsignup')`, [NEW_SIGNUP]);
const nsBefore = (await db.query(`SELECT approval_status FROM public.profiles WHERE user_id = $1`, [NEW_SIGNUP])).rows[0].approval_status;
await db.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'customer')`, [NEW_SIGNUP]);
await db.query(`INSERT INTO auth.users (id, email_confirmed_at) VALUES ($1, NULL)`, [NEW_SIGNUP]);
await db.query(`UPDATE auth.users SET email_confirmed_at = now() WHERE id = $1`, [NEW_SIGNUP]);
const ns = (await db.query(`SELECT email_verified, approval_status FROM public.profiles WHERE user_id = $1`, [NEW_SIGNUP])).rows[0];
check("confirming an email sets email_verified", ns.email_verified === true);
check("confirming an email no longer writes approval_status", ns.approval_status === nsBefore, `${nsBefore} -> ${ns.approval_status}`);
const pendingLeft = (await db.query(`SELECT count(*)::int AS n FROM public.profiles WHERE approval_status = 'pending'`)).rows[0].n;
check("no row is 'pending' and a new row defaults to 'approved' (pre-Q193 bundles cannot be stranded)",
  pendingLeft === 0 && nsBefore === "approved", `pending=${pendingLeft}, new row=${nsBefore}`);
const nsVisible = ids(await asUser(VIEWER, `SELECT user_id FROM public.get_safe_profiles($1::uuid[])`, [[NEW_SIGNUP]]));
check("a new signup is public the moment it confirms, with no approval step", nsVisible.has(NEW_SIGNUP));
const history = (await db.query(`SELECT count(*)::int AS n FROM public.helper_verifications WHERE field = 'approval_status'`)).rows[0].n;
check("no approval_status history rows are written", history === 0, `${history}`);

// 4b. email_verified is now the public gate: a member cannot set it.
const selfUpd = async (uid, target) => {
  await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${uid}', false)`);
  try { await db.query(`UPDATE public.profiles SET email_verified = true WHERE user_id = $1`, [target]); }
  catch { /* refused outright also counts as held */ }
  finally { await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false)`); }
  return (await db.query(`SELECT email_verified FROM public.profiles WHERE user_id = $1`, [target])).rows[0].email_verified;
};
check("another member cannot set someone's email_verified", (await selfUpd(VIEWER, FORM_ONLY)) === false);
await db.exec(`SET ROLE anon`);
let anonHeld = true;
try { await db.query(`UPDATE public.profiles SET email_verified = true WHERE user_id = $1`, [FORM_ONLY]); } catch { /* no grant */ }
await db.exec(`RESET ROLE`);
anonHeld = (await db.query(`SELECT email_verified FROM public.profiles WHERE user_id = $1`, [FORM_ONLY])).rows[0].email_verified === false;
check("anon cannot set email_verified", anonHeld);
// Last: if the pin is missing this write lands, and the checks above must not depend on it.
check("an unconfirmed member cannot set their own email_verified", (await selfUpd(FORM_ONLY, FORM_ONLY)) === false);

// 5. The INSERT policy still pins every gate input, including email_verified.
const ins = async (cols) => {
  const uid = U(40 + Math.floor(Math.random() * 50));
  await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${uid}', false)`);
  try {
    await db.query(`INSERT INTO public.profiles (user_id${cols ? ", " + Object.keys(cols).join(", ") : ""}) VALUES ($1${cols ? Object.keys(cols).map((_, i) => `, $${i + 2}`).join("") : ""})`, [uid, ...Object.values(cols ?? {})]);
    return "ok";
  } catch (e) {
    return e.code ?? e.message;
  } finally {
    await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false)`);
  }
};
check("self-insert at defaults is allowed", (await ins(null)) === "ok");
check("self-insert with email_verified = true is refused", (await ins({ email_verified: true })) === "42501");
check("self-insert with ban_status = banned is still refused", (await ins({ ban_status: "banned" })) === "42501");

// 6. ACLs restated as their source migrations left them.
const acl = async (sig) => (await db.query(`SELECT coalesce(proacl::text, '') AS a FROM pg_proc WHERE oid = to_regprocedure($1)`, [sig])).rows[0]?.a ?? "missing";
const statsAcl = await acl("public.get_public_profile_stats(uuid[])");
check("get_public_profile_stats: anon + authenticated EXECUTE (guest cards), PUBLIC none",
  /anon=X/.test(statsAcl) && /authenticated=X/.test(statsAcl) && !/(^|[{,])=X/.test(statsAcl), statsAcl);
const revAcl = await acl("public.get_public_profile_reviews(uuid,integer,integer)");
check("get_public_profile_reviews: no anon, no PUBLIC", !/anon=/.test(revAcl) && !/(^|[{,])=X/.test(revAcl), revAcl);
const pseAcl = await acl("public.prevent_self_escalation()");
check("prevent_self_escalation: no anon, no PUBLIC", !/anon=/.test(pseAcl) && !/(^|[{,])=X/.test(pseAcl), pseAcl);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
