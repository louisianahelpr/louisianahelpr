#!/usr/bin/env node
/**
 * PGlite proof for 20261031222115_saved_search_keeps_declutter_filters (BUY-13): a saved Declutter search keeps Free,
 * porch pickup, price drops and condition, and its alert (deliver_saved_search_item_alerts) and "N new" count
 * (saved_search_new_counts) apply them as Declutter Browse does. "Free" plus a category no longer alerts on the paid
 * listings in that category. A Jobs search can't carry them; condition stars are 1 to 5.
 *
 *   node src/test/pglite/savedSearchKeepsDeclutterFilters.pglite.mjs                    # applied 3x: all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/savedSearchKeepsDeclutterFilters.pglite.mjs # RED: the filters are not kept
 *   MUTANT=<name> node src/test/pglite/savedSearchKeepsDeclutterFilters.pglite.mjs      # a planted defect: must FAIL
 *
 * Stubbed, said so: declutter_notify records the bell row; net.http_post records the email body; the search match,
 * miles, feature and seller-hidden helpers answer yes; auth.uid() reads a setting. Before this migration: 20261031023451,
 * 20261031091529 and 20261031220326 (BUY-52, the same branch) are applied. Each listing is alerted by calling the
 * alert as the sweep does.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const BEFORE = ["20261031023451_saved_search_keeps_its_origin.sql", "20261031091529_declutter_saved_search_held_matches.sql", "20261031220326_saved_search_price_drop_alerts.sql"];
const THIS = "20261031222115_saved_search_keeps_declutter_filters.sql";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // The alert ignores Free (the bug: "Free" plus a category alerted on everything in it).
  alertFree: ["      AND (NOT s.free_only OR v_item.current_price_cents = 0)\n", ""],
  // The count ignores the condition stars.
  countStars: ["           AND (cardinality(s.conditions) = 0 OR i.condition_stars = ANY (s.conditions))\n", ""],
  // Drops: a stopped listing still counts as on the drops.
  alertStopped: ["AND (NOT s.drops_only OR (v_item.sale_mode = 'offers' AND NOT v_item.drops_stopped AND", "AND (NOT s.drops_only OR (v_item.sale_mode = 'offers' AND"],
  // Porch is never checked.
  alertPorch: ["      AND (NOT s.porch_only OR v_item.porch_ok)\n", ""],
};
const skip = process.env.NEW_MIGRATION === "skip";

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `77777777-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SELLER = U(1), FAY = U(2), GUS = U(3), HAL = U(4), IVY = U(5), JO = U(6);

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
CREATE TABLE public.notification_preferences (user_id uuid PRIMARY KEY, job_matches boolean, saved_searches_paused boolean DEFAULT false);
CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
CREATE TABLE public.bell (user_id uuid, title text, message text, link text);
CREATE FUNCTION public.declutter_notify(p_user uuid, p_kind text, p_title text, p_message text, p_link text, p_other uuid) RETURNS void
  LANGUAGE sql AS $$ INSERT INTO public.bell VALUES (p_user, p_title, p_message, p_link) $$;
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

// What prod has before this migration: the count (20261031023451), the held-matches table, alert and live trigger
// (20261031091529), and the live triggers from 20261021042132.
for (const f of BEFORE) await db.exec(readFileSync(MIG_DIR + f, "utf8"));
await db.exec(`
CREATE TRIGGER saved_search_on_item_live_t AFTER UPDATE OF status ON public.declutter_items FOR EACH ROW
  WHEN (NEW.status = 'live' AND OLD.status IS DISTINCT FROM 'live') EXECUTE FUNCTION public.saved_search_on_item_live();
CREATE TRIGGER saved_search_on_item_insert_live_t AFTER INSERT ON public.declutter_items FOR EACH ROW
  WHEN (NEW.status = 'live') EXECUTE FUNCTION public.saved_search_on_item_live();
`);
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
const tryQ = async (s, p = []) => { try { return await q(s, p); } catch (e) { console.log("  (" + e.message + ")"); return null; } };
for (const u of [SELLER, FAY, GUS, HAL, IVY, JO]) await q(`INSERT INTO public.profiles (user_id) VALUES ($1)`, [u]);
const bells = async (u) => (await q(`SELECT message FROM public.bell WHERE user_id = $1 ORDER BY ctid`, [u])).map((x) => x.message);
const as = (u) => q(`SELECT set_config('test.uid', $1, false)`, [u]);
const newCount = async (u) => { await as(u); return (await q(`SELECT new_count FROM public.saved_search_new_counts()`))[0]?.new_count ?? null; };
const old = "now() - interval '1 day'";

// Fay: Free chairs (furniture). Gus: porch pickup only. Hal: 4 or 5 stars. Ivy: on price drops. Each looked a day ago.
await tryQ(`INSERT INTO public.saved_searches (user_id, name, category, free_only, last_seen_at) VALUES ($1, 'Furniture in Declutter', 'furniture', true, ${old})`, [FAY]);
await tryQ(`INSERT INTO public.saved_searches (user_id, name, porch_only, last_seen_at) VALUES ($1, 'Everything in Declutter', true, ${old})`, [GUS]);
await tryQ(`INSERT INTO public.saved_searches (user_id, name, conditions, last_seen_at) VALUES ($1, 'Everything in Declutter', '{4,5}', ${old})`, [HAL]);
await tryQ(`INSERT INTO public.saved_searches (user_id, name, drops_only, last_seen_at) VALUES ($1, 'Everything in Declutter', true, ${old})`, [IVY]);

const list = async (cols, vals) => {
  const id = (await q(`INSERT INTO public.declutter_items (seller_id, title, category, current_price_cents, status, ${cols}) VALUES ($1, 'Item', 'furniture', $2, 'live', ${vals}) RETURNING id`, [SELLER, cols.includes("free") ? 0 : 2000]))[0].id;
  await q(`DELETE FROM public.saved_search_item_queue WHERE item_id = $1`, [id]);
  await q(`SELECT public.deliver_saved_search_item_alerts($1)`, [id]);
  await q(`UPDATE public.saved_searches SET last_notified_at = NULL, last_emailed_at = NULL`);
  return id;
};
// A $20 chair: porch off, 3 stars, fixed price (no drops).
await list("porch_ok, condition_stars, sale_mode", "false, 3, 'fixed'");
check((await bells(FAY)).length === 0, `[fix] Fay (Free): a $20 chair does not alert (${(await bells(FAY)).length})`);
check((await bells(GUS)).length === 0, `[fix] Gus (porch): a listing with no porch pickup does not alert (${(await bells(GUS)).length})`);
check((await bells(HAL)).length === 0, `[fix] Hal (4 or 5 stars): a 3-star listing does not alert (${(await bells(HAL)).length})`);
check((await bells(IVY)).length === 0, `[fix] Ivy (drops): a fixed-price listing does not alert (${(await bells(IVY)).length})`);
// A stopped one on offers.
await list("sale_mode, drops_stopped, drop_pct", "'offers', true, 10");
check((await bells(IVY)).length === 0, `[fix] Ivy: a listing whose drops are stopped does not alert (${(await bells(IVY)).length})`);
// The ones each wants.
// (Listings default to porch pickup on and 4 stars, so the stopped one above was porch and 4 stars too.)
await list("porch_ok, condition_stars, sale_mode", "true, 5, 'offers'");
check((await bells(GUS)).length === 2, `Gus told of the two porch listings (${(await bells(GUS)).length})`);
check((await bells(HAL)).length === 2, `Hal told of the 4- and 5-star ones (${(await bells(HAL)).length})`);
check((await bells(IVY)).length === 1, `Ivy told of a listing on the drops (${(await bells(IVY)).length})`);
check((await bells(FAY)).length === 0, `[fix] Fay: still nothing paid (${(await bells(FAY)).length})`);
const freeId = (await q(`INSERT INTO public.declutter_items (seller_id, title, category, current_price_cents, status) VALUES ($1, 'Free chair', 'furniture', 0, 'live') RETURNING id`, [SELLER]))[0].id;
await q(`SELECT public.deliver_saved_search_item_alerts($1)`, [freeId]);
check((await bells(FAY)).length === 1, `Fay told of the free chair (${(await bells(FAY)).length})`);

// The counts: 4 listings went live since each looked ($20 3-star no-porch fixed; stopped; 5-star on drops; free).
check(await newCount(FAY) === 1, `[fix] Fay's count: the free one only (${await newCount(FAY)})`);
check(await newCount(GUS) === 3, `[fix] Gus's count: the 3 with porch pickup (${await newCount(GUS)})`);
check(await newCount(HAL) === 3, `[fix] Hal's count: the three with 4 or 5 stars, not the 3-star one (${await newCount(HAL)})`);
check(await newCount(IVY) === 1, `[fix] Ivy's count: the one on the drops (${await newCount(IVY)})`);
await as("");

// Only Declutter carries them; stars 1..5.
const refused = async (sql) => (await tryQ(sql)) === null;
check(await refused(`INSERT INTO public.saved_searches (user_id, name, section, free_only) VALUES ('${JO}', 'Jobs', 'jobs', true)`), "[fix] a Jobs search can't be Free only");
check(await refused(`INSERT INTO public.saved_searches (user_id, name, conditions) VALUES ('${JO}', 'x', '{6}')`), "[fix] 6 stars is refused");
check((await tryQ(`INSERT INTO public.saved_searches (user_id, name, section) VALUES ('${JO}', 'Jobs', 'jobs')`)) !== null, "a plain Jobs search still saves");

if (!skip) {
  const acl = (await q(`SELECT has_function_privilege('anon', 'public.saved_search_new_counts()', 'EXECUTE') ca,
    has_function_privilege('authenticated', 'public.saved_search_new_counts()', 'EXECUTE') cu,
    has_function_privilege('anon', 'public.deliver_saved_search_item_alerts(uuid)', 'EXECUTE') da,
    has_function_privilege('authenticated', 'public.deliver_saved_search_item_alerts(uuid)', 'EXECUTE') du`))[0];
  check(!acl.ca && acl.cu && !acl.da && !acl.du, `grants: count anon ${acl.ca} authenticated ${acl.cu}; alert anon ${acl.da} authenticated ${acl.du}`);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
