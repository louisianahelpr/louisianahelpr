#!/usr/bin/env node
/**
 * PGlite proof for 20261102025235_declutter_saved_search_alerts_wanted_matches (Q2464, lead 2026-11-01): a Declutter
 * saved-search alert goes out as type declutter_wanted (bell and email) and follows the member's Wanted matches switch
 * (notification_preferences.declutter_wanted), not Job matches (job_matches).
 *
 *   node src/test/pglite/declutterSavedSearchWantedMatches.pglite.mjs                    # applied 3x: all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterSavedSearchWantedMatches.pglite.mjs # RED: still job_match / job_matches
 *   MUTANT=<name> node src/test/pglite/declutterSavedSearchWantedMatches.pglite.mjs      # a planted defect: must FAIL
 *
 * Stubbed, said so: declutter_notify records the kind it was given and the bell row; net.http_post records the email
 * body; the search match, miles, feature and seller-hidden helpers answer yes. Supabase's default anon/authenticated
 * EXECUTE grant on new functions is emulated (ALTER DEFAULT PRIVILEGES). CREATE OR REPLACE keeps the function's existing ACL,
 * so dropping this file's REVOKE alone stays green (measured); the grant check proves the end state.
 * Before this migration: 20261031023451, 20261031091529, 20261031220326 and 20261031222115 are applied (prod today).
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const BEFORE = ["20261031023451_saved_search_keeps_its_origin.sql", "20261031091529_declutter_saved_search_held_matches.sql",
  "20261031220326_saved_search_price_drop_alerts.sql", "20261031222115_saved_search_keeps_declutter_filters.sql"];
const THIS = "20261102025235_declutter_saved_search_alerts_wanted_matches.sql";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // The gate stays on Job matches (the bug).
  gateJobMatches: ["AND COALESCE(np.declutter_wanted, true) IS TRUE", "AND COALESCE(np.job_matches, true) IS TRUE"],
  // The bell keeps the Jobs type.
  bellJobMatch: ["PERFORM public.declutter_notify(r.user_id, 'declutter_wanted',", "PERFORM public.declutter_notify(r.user_id, 'job_match',"],
  // The email keeps the Jobs type (send-notification-email would gate it on email_job_matches).
  emailJobMatch: ["'type', 'declutter_wanted',", "'type', 'job_match',"],
};
const skip = process.env.NEW_MIGRATION === "skip";

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `77777777-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SELLER = U(1), FAY = U(2), GUS = U(3), HAL = U(4);

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA net; CREATE SCHEMA vault; CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;
CREATE FUNCTION public.feature_enabled_for(p_key text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.seed_hidden_in_discovery() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.saved_search_category_matches(a text, b text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE TABLE public.open_jobs_browse (created_at timestamptz, customer_id uuid, category text, parish text, budget numeric,
  title text, description text, location text, latitude numeric, longitude numeric);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE net.calls (body jsonb);
CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.calls VALUES (body); SELECT 1::bigint $$;
CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
INSERT INTO vault.decrypted_secrets VALUES ('supabase_url','http://x'),('service_role_key','k');
CREATE FUNCTION public.seed_jobs_hidden_publicly() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.miles_between(a numeric, b numeric, c numeric, d numeric) RETURNS numeric LANGUAGE sql AS $$ SELECT 1::numeric $$;
CREATE FUNCTION public.feature_enabled_for_user(p_key text, p_user_id uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.declutter_seller_hidden(p_seller uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.declutter_search_matches(q text, t text, d text, c text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, email_verified boolean DEFAULT true, ban_status text DEFAULT 'active',
  latitude numeric, longitude numeric, is_seed boolean DEFAULT false, parish text);
CREATE TABLE public.notification_preferences (user_id uuid PRIMARY KEY, job_matches boolean, declutter_wanted boolean, saved_searches_paused boolean DEFAULT false);
CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
CREATE TABLE public.bell (user_id uuid, kind text, title text, message text, link text);
CREATE FUNCTION public.declutter_notify(p_user uuid, p_kind text, p_title text, p_message text, p_link text, p_other uuid) RETURNS void
  LANGUAGE sql AS $$ INSERT INTO public.bell VALUES (p_user, p_kind, p_title, p_message, p_link) $$;
CREATE TABLE public.declutter_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid NOT NULL, title text NOT NULL,
  description text NOT NULL DEFAULT '', category text NOT NULL DEFAULT 'kitchen', status text NOT NULL DEFAULT 'draft',
  current_price_cents integer NOT NULL, area_lat numeric NOT NULL DEFAULT 30.0, area_lng numeric NOT NULL DEFAULT -92.0,
  is_seed boolean NOT NULL DEFAULT false, live_at timestamptz DEFAULT now() - interval '1 minute', porch_ok boolean NOT NULL DEFAULT true,
  condition_stars smallint NOT NULL DEFAULT 4, sale_mode text NOT NULL DEFAULT 'fixed', drops_stopped boolean NOT NULL DEFAULT false, drop_pct integer);
CREATE TABLE public.saved_searches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, name text NOT NULL,
  section text NOT NULL DEFAULT 'declutter', created_at timestamptz NOT NULL DEFAULT now(), notify_enabled boolean NOT NULL DEFAULT true,
  notify_email boolean NOT NULL DEFAULT true, category text, max_budget numeric, min_budget numeric, query text,
  radius_miles numeric, last_notified_at timestamptz, last_emailed_at timestamptz, origin_lat numeric, origin_lng numeric,
  last_seen_at timestamptz, parish text, location_keyword text);
CREATE TABLE public.saved_search_item_queue (item_id uuid PRIMARY KEY REFERENCES public.declutter_items(id) ON DELETE CASCADE,
  queued_at timestamptz NOT NULL DEFAULT now(), attempts integer NOT NULL DEFAULT 0, retry_after timestamptz);
`);

for (const f of BEFORE) await db.exec(readFileSync(MIG_DIR + f, "utf8"));
if (!skip) {
  let mig = readFileSync(MIG_DIR + THIS, "utf8");
  if (MUTANT) {
    const m = MUTANTS[MUTANT];
    if (!m || !mig.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
    mig = mig.replace(m[0], m[1]);
  }
  for (let k = 1; k <= 3; k++) {
    try { await db.exec(mig); check(true, `the migration applies (run ${k})`); } catch (e) { check(false, `the migration applies (run ${k}): ${e.message}`); }
  }
}

const q = async (s, p = []) => (await db.query(s, p)).rows;
for (const u of [SELLER, FAY, GUS, HAL]) await q(`INSERT INTO public.profiles (user_id) VALUES ($1)`, [u]);
// Fay muted Job matches but not Wanted matches. Gus muted Wanted matches but not Job matches. Hal never opened settings.
await q(`INSERT INTO public.notification_preferences (user_id, job_matches, declutter_wanted) VALUES ($1, false, true), ($2, true, false)`, [FAY, GUS]);
for (const u of [FAY, GUS, HAL]) await q(`INSERT INTO public.saved_searches (user_id, name) VALUES ($1, 'Everything in Declutter')`, [u]);

const id = (await q(`INSERT INTO public.declutter_items (seller_id, title, current_price_cents, status) VALUES ($1, 'Oak chair', 2000, 'live') RETURNING id`, [SELLER]))[0].id;
await q(`DELETE FROM public.saved_search_item_queue WHERE item_id = $1`, [id]);
await q(`SELECT public.deliver_saved_search_item_alerts($1)`, [id]);
const bells = async (u) => q(`SELECT kind FROM public.bell WHERE user_id = $1`, [u]);
const mails = async (u) => (await q(`SELECT body->>'type' AS type FROM net.calls WHERE body->>'user_id' = $1`, [u])).map((r) => r.type);

const fay = await bells(FAY), gus = await bells(GUS), hal = await bells(HAL);
check(fay.length === 1, `[fix] Fay (Job matches off, Wanted matches on) is told (${fay.length})`);
check(gus.length === 0, `[fix] Gus (Wanted matches off) is not told (${gus.length})`);
check(hal.length === 1, `Hal (no settings row) is told (${hal.length})`);
check([...fay, ...hal].length > 0 && [...fay, ...hal].every((b) => b.kind === "declutter_wanted"), `[fix] the bell type is declutter_wanted (${[...fay, ...hal].map((b) => b.kind)})`);
const fm = await mails(FAY), gm = await mails(GUS);
check(fm.length === 1 && fm[0] === "declutter_wanted", `[fix] Fay's email goes as declutter_wanted (${fm})`);
check(gm.length === 0, `[fix] Gus gets no email (${gm})`);

if (!skip) {
  const acl = (await q(`SELECT has_function_privilege('anon', 'public.deliver_saved_search_item_alerts(uuid)', 'EXECUTE') a,
    has_function_privilege('authenticated', 'public.deliver_saved_search_item_alerts(uuid)', 'EXECUTE') u,
    has_function_privilege('service_role', 'public.deliver_saved_search_item_alerts(uuid)', 'EXECUTE') s`))[0];
  check(!acl.a && !acl.u && acl.s, `grants: anon ${acl.a}, authenticated ${acl.u}, service_role ${acl.s}`);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
