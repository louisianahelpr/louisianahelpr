#!/usr/bin/env node
/**
 * PGlite proof for 20261021062609_memberships_off_paid_perks (Q1848, owner
 * 2026-10-21): with the 'memberships' switch off for a member, the Elite strike
 * shield, the poster rank boost and priority support are all off; with it on
 * (everyone, or testers for a test account) each perk works exactly as before.
 * Grants are unchanged.
 *
 *   node src/test/pglite/membershipsOffPaidPerks.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/membershipsOffPaidPerks.pglite.mjs # RED: the state on main
 *
 * The "before" bodies are cut from each function's newest migration on main
 * (prosrc md5 equal to prod, 2026-10-21); feature_enabled_for_user is cut from
 * 20261012031120. Helpers the bodies call are stubbed.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const M = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const NEW = M("20261021062609_memberships_off_paid_perks.sql");
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: the state on main (expect FAILs)");

/** The newest CREATE of public.<fn> in a migration, any dollar tag, with a trailing semicolon. */
function cut(file, fn) {
  const sql = M(file);
  const re = new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${fn}\\s*\\([\\s\\S]*?\\$([A-Za-z_]*)\\$[\\s\\S]*?\\$\\1\\$`, "gi");
  const all = [...sql.matchAll(re)];
  return all[all.length - 1][0].replace(/^CREATE FUNCTION/i, "CREATE OR REPLACE FUNCTION") + ";";
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE TABLE auth.cur (uid uuid);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT uid FROM auth.cur LIMIT 1 $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT SELECT ON auth.cur TO anon, authenticated, service_role;
CREATE TYPE public.app_role AS ENUM ('admin', 'user');
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
CREATE FUNCTION public.has_role(u uuid, r public.app_role) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = u AND role = r) $$;
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
CREATE TABLE public.feature_switches (key text PRIMARY KEY, audience text NOT NULL);
INSERT INTO public.feature_switches VALUES ('memberships', 'off');
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text, email text, parish text, latitude numeric, longitude numeric,
  subscription_tier text, subscription_expires_at timestamptz);
-- apply_job_denial_consequence
CREATE TABLE public.user_violations (id uuid DEFAULT gen_random_uuid(), user_id uuid, violation_type text, description text, job_id uuid, action_taken text, created_at timestamptz DEFAULT now());
CREATE TABLE public.notifications (user_id uuid, title text, message text, type text, link text, job_id uuid);
CREATE FUNCTION public.apply_consequence_ladder(p_user uuid, p_violation_type text, p_description text, p_job_id uuid, p_prior_count int,
  p_rungs text[], p_effects text[], p_copy jsonb, p_permanent_requires_review boolean, p_suspension_days int, p_clamp_to_worse_status boolean,
  p_admin_message_format text, p_ban_reason text) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('action', 'laddered') $$;
-- get_ranked_open_jobs (the browse harness of browseRpcsFeeStamp.pglite.mjs)
CREATE TYPE public.job_status AS ENUM ('open', 'accepted', 'in_progress', 'completed', 'cancelled');
CREATE TYPE public.job_category AS ENUM ('yard', 'moving', 'cleaning');
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY, title text, description text, category public.job_category DEFAULT 'yard', budget numeric DEFAULT 100,
  date_needed date, start_time time, location text DEFAULT 'Lafayette, LA', is_urgent boolean DEFAULT false,
  urgent_fee numeric, is_flexible_schedule boolean DEFAULT false, is_recurring boolean DEFAULT false,
  is_group_job boolean DEFAULT false, helpers_needed int DEFAULT 1, estimated_hours numeric, photos text[],
  special_requirements text, status public.job_status DEFAULT 'open', created_at timestamptz DEFAULT now() - interval '3 days',
  boosted_at timestamptz, boost_expires_at timestamptz, expires_at timestamptz,
  recurrence_interval text, parent_job_id uuid, payment_status text DEFAULT 'escrow',
  customer_id uuid, offered_to_helper_id uuid, direct_offer_status text,
  pricing_mode text, latitude numeric DEFAULT 30.22, longitude numeric DEFAULT -92.02, parish text,
  credential_tier int DEFAULT 0, is_seed boolean DEFAULT false, helper_fee_percent numeric, helper_fee_flat_cents integer
);
CREATE TABLE public.ban_settlement_queue (user_id uuid, review_state text);
CREATE FUNCTION public.early_access_cutoff() RETURNS timestamptz LANGUAGE sql AS $$ SELECT now() $$;
CREATE FUNCTION public.seed_hidden_in_discovery() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.get_user_credential_tier(u uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION public.crew_spots_open(j uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
CREATE FUNCTION public.mask_job_location(l text) RETURNS text LANGUAGE sql AS $$ SELECT l $$;
CREATE FUNCTION public.job_offer_cutoff(d date, t time) RETURNS timestamptz LANGUAGE sql AS $$ SELECT now() + interval '1 day' $$;
CREATE FUNCTION public.miles_between(a numeric, b numeric, c numeric, d numeric) RETURNS numeric LANGUAGE sql AS $$ SELECT NULL::numeric $$;
-- admin_support_queue
CREATE TABLE public.reports (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reporter_id uuid, reason text, description text, status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now(), reported_type text DEFAULT 'support');
`);
await db.exec(cut("20261012031120_hidden_feature_switches.sql", "feature_enabled_for_user"));
await db.exec(cut("20261012184444_offer_free_to_refuse.sql", "apply_job_denial_consequence"));
await db.exec(cut("20261017094018_browse_rpcs_carry_fee_stamp.sql", "get_ranked_open_jobs"));
await db.exec(cut("20260915043200_admin_support_queue_admits_plus.sql", "admin_support_queue"));
// Live grants (pg_proc.proacl on prod, 2026-10-21).
await db.exec(`
REVOKE ALL ON FUNCTION public.apply_job_denial_consequence(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_job_denial_consequence(uuid, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.get_ranked_open_jobs(integer, integer, boolean, numeric, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ranked_open_jobs(integer, integer, boolean, numeric, numeric, numeric) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_support_queue(text, text[], integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_support_queue(text, text[], integer) TO authenticated, service_role;
`);
const ACL = async () =>
  JSON.stringify((await db.query(`SELECT proname, proacl::text a FROM pg_proc WHERE pronamespace = 'public'::regnamespace
    AND proname IN ('apply_job_denial_consequence', 'get_ranked_open_jobs', 'admin_support_queue') ORDER BY 1`)).rows);
const aclBefore = await ACL();

let applied = 0;
if (!skip) for (let i = 0; i < 3; i++) { await db.exec(NEW); applied++; }
check("the migration applies three times", skip || applied === 3, String(applied));
check("grants are unchanged", (await ACL()) === aclBefore);

const ELITE = "e1111111-1111-4111-8111-111111111111";
const FREE = "f2222222-2222-4222-8222-222222222222";
const ADMIN = "a3333333-3333-4333-8333-333333333333";
const VIEWER = "b4444444-4444-4444-8444-444444444444";
await db.exec(`
INSERT INTO public.profiles (user_id, full_name, subscription_tier) VALUES ('${ELITE}', 'Elite E.', 'elite'), ('${FREE}', 'Free F.', NULL), ('${ADMIN}', 'Admin A.', NULL), ('${VIEWER}', 'Viewer V.', NULL);
INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
INSERT INTO public.jobs (id, title, customer_id) VALUES
  ('10000000-0000-4000-8000-00000000000e', 'by elite', '${ELITE}'),
  ('10000000-0000-4000-8000-00000000000f', 'by free', '${FREE}');
INSERT INTO public.reports (reporter_id, reason, created_at) VALUES ('${ELITE}', 'elite asks', now() - interval '1 hour'), ('${FREE}', 'free asks', now() - interval '2 hours');
`);

async function as(uid, sql) {
  await db.exec(`DELETE FROM auth.cur; ${uid ? `INSERT INTO auth.cur VALUES ('${uid}');` : ""}`);
  return (await db.query(sql)).rows;
}
async function setSwitch(audience, testers = []) {
  await db.exec(`UPDATE public.feature_switches SET audience = '${audience}' WHERE key = 'memberships'; DELETE FROM public.test_accounts;
    ${testers.map((t) => `INSERT INTO public.test_accounts VALUES ('${t}');`).join("")}`);
}
async function shield(helper) {
  await db.exec("DELETE FROM public.user_violations; DELETE FROM public.notifications;");
  const r = (await db.query(`SELECT public.apply_job_denial_consequence('${helper}', '10000000-0000-4000-8000-00000000000e', 'backed out') r`)).rows[0].r;
  return r.action;
}
async function boost() {
  const rows = await as(VIEWER, "SELECT title, rank_score FROM public.get_ranked_open_jobs() ORDER BY title");
  const by = Object.fromEntries(rows.map((r) => [r.title, Number(r.rank_score)]));
  return Math.round((by["by elite"] - by["by free"]) * 100) / 100;
}
async function priority() {
  const rows = await as(ADMIN, "SELECT reason, priority_support, support_tier FROM public.admin_support_queue()");
  const elite = rows.find((r) => r.reason === "elite asks");
  return { prio: elite?.priority_support, tier: elite?.support_tier, first: rows[0]?.reason };
}

// OFF for everyone.
await setSwitch("off");
check("memberships off: an Elite Helpr's strike is NOT shielded", (await shield(ELITE)) === "laddered");
check("memberships off: an Elite poster's job gets no rank boost", (await boost()) === 0, String(await boost()));
{
  const p = await priority();
  check("memberships off: an Elite member's support request is not priority", p.prio === false && p.tier === "free", JSON.stringify(p));
  check("memberships off: the queue is oldest first, no head start", p.first === "free asks", p.first);
}

// ON for everyone: every perk works as before.
await setSwitch("everyone");
check("memberships on: the Elite shield absorbs the strike", (await shield(ELITE)) === "shielded");
check("memberships on: a free Helpr's strike is never shielded", (await shield(FREE)) === "laddered");
check("memberships on: the Elite poster's job is boosted by 5", (await boost()) === 5, String(await boost()));
{
  const p = await priority();
  check("memberships on: the Elite member's request is priority with its head start", p.prio === true && p.tier === "elite" && p.first === "elite asks", JSON.stringify(p));
}

// TESTERS: only a test account gets the perks.
await setSwitch("testers", [ELITE]);
check("testers, Elite is a tester: shielded", (await shield(ELITE)) === "shielded");
await setSwitch("testers", []);
check("testers, Elite is not a tester: not shielded", (await shield(ELITE)) === "laddered");
check("testers, Elite is not a tester: no boost", (await boost()) === 0);
check("testers, Elite is not a tester: not priority", (await priority()).prio === false);

// A non-admin still gets no support rows (the authorization is untouched).
check("a non-admin still reads no support queue rows", (await as(VIEWER, "SELECT 1 FROM public.admin_support_queue()")).length === 0);

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
