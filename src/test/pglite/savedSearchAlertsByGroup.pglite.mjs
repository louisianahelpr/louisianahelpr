#!/usr/bin/env node
/**
 * PGlite proof for 20261021072206_saved_search_alerts_by_group.sql.
 *
 *   node src/test/pglite/savedSearchAlertsByGroup.pglite.mjs
 *   MUTATE=1 node src/test/pglite/savedSearchAlertsByGroup.pglite.mjs   (must FAIL)
 *
 * The whole migration file, verbatim, applied 3x (replay). The tables and
 * functions the two rewritten bodies read are cut down to the columns they use.
 * Checks: a GROUP search ("home") alerts on every category in the group and on
 * nothing outside it; an old single-category search ("handyman") still alerts
 * on exactly that category; a no-category search alerts on everything; the
 * "N new" count reads the same rule; the helpers are not executable by anon or
 * authenticated. MUTATE=1 puts the old line (`s.category = NEW.category::text`)
 * back in the trigger, and the group checks must go red.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
let SQL = readFileSync(DIR + "20261021072206_saved_search_alerts_by_group.sql", "utf8");
if (process.env.MUTATE) {
  const from = "AND public.saved_search_category_matches(s.category, NEW.category)";
  if (!SQL.includes(from)) throw new Error("mutation target not found");
  SQL = SQL.replace(from, "AND (s.category IS NULL OR s.category = NEW.category::text)");
}

const CATS = ["cleaning", "yard_work", "moving", "errands", "handyman", "painting", "delivery", "pet_care", "assembly", "other", "storm_prep", "events", "electrical", "plumbing", "hvac", "roofing", "welding", "carpentry", "auto_repair", "appliance_repair", "flooring", "concrete_masonry", "fencing", "pressure_washing", "declutter_help"];
const U = (n) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const POSTER = U(1);
const HOME = U(2), LEGACY = U(3), ANY = U(4), TRADES = U(5), EVENTS = U(6), YARD = U(7);

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
  CREATE TYPE public.job_category AS ENUM (${CATS.map((c) => `'${c}'`).join(", ")});
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, email_verified boolean DEFAULT true, ban_status text, latitude numeric, longitude numeric, parish text);
  CREATE TABLE public.notification_preferences (user_id uuid PRIMARY KEY, job_matches boolean, saved_searches_paused boolean);
  CREATE TABLE public.saved_searches (
    id uuid PRIMARY KEY, user_id uuid, name text, created_at timestamptz DEFAULT now() - interval '1 day',
    notify_enabled boolean DEFAULT true, section text DEFAULT 'jobs', category text, parish text,
    max_budget numeric, min_budget numeric, query text, location_keyword text, radius_miles numeric,
    last_notified_at timestamptz, last_seen_at timestamptz);
  CREATE TABLE public.saved_search_alert_queue (user_id uuid, job_id uuid, notify_at timestamptz, search_name text, matched_search_ids uuid[], UNIQUE (user_id, job_id));
  CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
  CREATE TABLE public.declutter_items (id uuid, status text, live_at timestamptz, seller_id uuid, is_seed boolean, category text, current_price_cents int, title text, area_lat numeric, area_lng numeric);
  CREATE TABLE public.jobs (
    id uuid PRIMARY KEY, customer_id uuid, status text DEFAULT 'open', parent_job_id uuid, payment_status text DEFAULT 'escrow',
    offered_to_helper_id uuid, direct_offer_status text, is_seed boolean DEFAULT false, category public.job_category,
    parish text, budget numeric DEFAULT 100, title text DEFAULT 'A job', description text, location text,
    latitude numeric, longitude numeric, created_at timestamptz DEFAULT now());
  CREATE VIEW public.open_jobs_browse AS SELECT * FROM public.jobs WHERE status = 'open';
  CREATE FUNCTION public.seed_jobs_hidden_publicly() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
  CREATE FUNCTION public.seed_hidden_in_discovery() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
  CREATE FUNCTION public.feature_enabled_for(text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
  CREATE FUNCTION public.declutter_seller_hidden(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
  CREATE FUNCTION public.early_access_visible_at(uuid, timestamptz) RETURNS timestamptz LANGUAGE sql AS $$ SELECT $2 $$;
  CREATE FUNCTION public.miles_between(numeric, numeric, numeric, numeric) RETURNS numeric LANGUAGE sql AS $$ SELECT 0::numeric $$;
  INSERT INTO public.profiles (user_id) VALUES ('${POSTER}'), ('${HOME}'), ('${LEGACY}'), ('${ANY}'), ('${TRADES}'), ('${EVENTS}'), ('${YARD}');
  INSERT INTO public.saved_searches (id, user_id, name, category) VALUES
    ('${U(12)}', '${HOME}', 'Home jobs', 'home'),
    ('${U(13)}', '${LEGACY}', 'Handyman', 'handyman'),
    ('${U(14)}', '${ANY}', 'Anything', NULL),
    ('${U(15)}', '${TRADES}', 'Trades', 'trades'),
    ('${U(16)}', '${EVENTS}', 'Events', 'events'),
    ('${U(17)}', '${YARD}', 'Yard', 'yard');
`);
for (let i = 0; i < 3; i++) await db.exec(SQL);
await db.exec(`CREATE TRIGGER t AFTER INSERT ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.notify_saved_searches_on_new_job();`);

const checks = [];
const check = (name, ok) => { checks.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); };
let n = 40;
/** Post one funded open job of `category`; who got an alert queued for it? */
const alerted = async (category) => {
  const id = U(n++);
  await db.exec(`INSERT INTO public.jobs (id, customer_id, category) VALUES ('${id}', '${POSTER}', '${category}')`);
  const r = await db.query(`SELECT user_id::text FROM public.saved_search_alert_queue WHERE job_id = '${id}' ORDER BY 1`);
  return r.rows.map((x) => x.user_id).sort();
};
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

check("a 'home' search alerts on painting (a Home category); 'anything' too; handyman/trades/yard do not",
  same(await alerted("painting"), [HOME, ANY]));
check("a 'home' search alerts on handyman, and the old 'handyman' search still alerts on it",
  same(await alerted("handyman"), [HOME, LEGACY, ANY]));
check("pressure washing (Home) alerts the 'home' search", same(await alerted("pressure_washing"), [HOME, ANY]));
check("a 'trades' search alerts on hvac; 'home' does not", same(await alerted("hvac"), [TRADES, ANY]));
check("'events' is a group id AND a category: an events search alerts on events", same(await alerted("events"), [EVENTS, ANY]));
check("'yard' alerts on yard work", same(await alerted("yard_work"), [YARD, ANY]));
check("a category outside every saved group alerts only the no-category search", same(await alerted("auto_repair"), [ANY]));

// Every enum value has a group (the table in the migration is the TS GROUP_OF; the vitest guard checks equality).
const grouped = await db.query(`SELECT count(*)::int AS n FROM unnest(enum_range(NULL::public.job_category)) c WHERE public.job_category_group(c) IS NULL`);
check("every job_category value has a group", grouped.rows[0].n === 0 && CATS.length > 20);

// "N new since you looked" reads the same rule (the jobs posted above are all newer than the searches).
await db.exec(`SET test.uid = '${HOME}'`);
const homeCount = (await db.query(`SELECT new_count FROM public.saved_search_new_counts()`)).rows[0]?.new_count;
check("the 'home' search counts its 3 Home jobs as new (painting, handyman, pressure washing)", homeCount === 3);
await db.exec(`SET test.uid = '${LEGACY}'`);
const legacyCount = (await db.query(`SELECT new_count FROM public.saved_search_new_counts()`)).rows[0]?.new_count;
check("the old 'handyman' search counts exactly its 1 handyman job", legacyCount === 1);

// Authz: members cannot call the helpers.
const priv = await db.query(`SELECT
  has_function_privilege('anon', 'public.job_category_group(public.job_category)', 'EXECUTE') AS a1,
  has_function_privilege('authenticated', 'public.job_category_group(public.job_category)', 'EXECUTE') AS a2,
  has_function_privilege('anon', 'public.saved_search_category_matches(text, public.job_category)', 'EXECUTE') AS a3,
  has_function_privilege('authenticated', 'public.saved_search_category_matches(text, public.job_category)', 'EXECUTE') AS a4,
  has_function_privilege('anon', 'public.notify_saved_searches_on_new_job()', 'EXECUTE') AS a5,
  has_function_privilege('anon', 'public.saved_search_new_counts()', 'EXECUTE') AS a6,
  has_function_privilege('authenticated', 'public.saved_search_new_counts()', 'EXECUTE') AS a7`);
const p = priv.rows[0];
check("anon and authenticated have no EXECUTE on either helper or the trigger; new_counts stays authenticated-only",
  !p.a1 && !p.a2 && !p.a3 && !p.a4 && !p.a5 && !p.a6 && p.a7);

const failed = checks.filter((x) => !x).length;
console.log(`\n${checks.length - failed}/${checks.length} passed${process.env.MUTATE ? " (MUTATE=1: failures expected)" : ""}`);
process.exit(failed ? 1 : 0);
