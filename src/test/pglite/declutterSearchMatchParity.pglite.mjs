#!/usr/bin/env node
/**
 * Audit DA-1 (2026-10-30): Declutter search matches every WORD, in the title, description or category, with simple
 * plurals folded, in Browse AND in the saved-search alerts and "N new" counts.
 *
 * Runs 20261030043900_declutter_search_words.sql VERBATIM (3x) on a prod-shaped fixture, then:
 *   1. public.declutter_search_matches agrees with Browse's TypeScript rule (src/lib/declutter/searchMatch.ts,
 *      imported here) on every case in CASES, including the audit's three misses ("mug blue", "mugs", "kitchen");
 *   2. a saved Declutter search "mug blue" counts the "Blue coffee mug" listing as 1 new, and "mugs" alerts its
 *      member in the app when that listing goes live; "teapot" stays 0 / no alert;
 *   3. the two helpers are not callable by anon or authenticated.
 *
 *   node src/test/pglite/declutterSearchMatchParity.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/declutterSearchMatchParity.pglite.mjs   # RED: the previous definitions
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import { matchesSearch } from "../../lib/declutter/searchMatch.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20261030043900_declutter_search_words.sql";
const RED = process.env.NEW_MIGRATION === "skip";
if (RED) console.log("NEW_MIGRATION=skip: running the PREVIOUS definitions (expect FAILs)");

/** The newest CREATE [OR REPLACE] FUNCTION public.<name>( in migrations sorting before `before`, any dollar tag. */
function definitionBefore(name, before) {
  let last = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && x < before).sort()) {
    const sql = readFileSync(MIG_DIR + f, "utf8");
    const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
    for (const m of sql.matchAll(head)) {
      const rest = sql.slice(m.index);
      const tag = /\bAS\s+(\$\w*\$)/i.exec(rest);
      const end = rest.indexOf(tag[1], tag.index + tag[0].length);
      last = rest.slice(0, end + tag[1].length) + ";";
    }
  }
  if (!last) throw new Error(`no definition of ${name} before ${before}`);
  return last;
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

// [query, title, description, category, expected]
const CASES = [
  ["mug blue", "Blue coffee mug", "Barely used", "kitchen", true],   // audit: words in any order
  ["mugs", "Blue coffee mug", "", "kitchen", true],                  // audit: plural
  ["kitchen", "Blue coffee mug", "", "kitchen", true],               // audit: the category
  ["mug", "Set of 4 mugs", "", "kitchen", true],
  ["dishes", "Dish rack", "", "kitchen", true],
  ["boxes", "Moving box", "", "other", true],
  ["berries", "Berry bowl", "", "kitchen", true],
  ["glass", "Glass vase", "", "home_decor", true],
  ["glasses", "Wine glass", "", "kitchen", true],
  ["home decor", "Vase", "", "home_decor", true],
  ["oak", "Table", "Solid oak, seats six", "furniture", true],       // the description
  ["phone", "iPhone 12", "", "electronics", true],                   // still finds it inside a word
  ["lam", "Floor lamp", "", "home_decor", true],                     // half-typed
  ["  Blue,  MUG! ", "Blue coffee mug", "", "kitchen", true],        // punctuation and case
  ["", "Anything", "", "other", true],                                // empty query
  ["   ", "Anything", "", "other", true],
  ["teapot", "Blue coffee mug", "", "kitchen", false],
  ["mug red", "Blue coffee mug", "", "kitchen", false],              // every word must match
  ["chairs", "Table", "", "furniture", false],
  ["and", "Rake", "", "outdoor_garden", false],                       // the label's "and" is not a category word
  ["toys", "Lego set", "", "toys_games", true],
];

const SELLER = "88888888-0000-0000-0000-000000000000";
const BLUE = "88888888-0000-0000-0000-000000000001"; // saved "mug blue"
const PLURAL = "88888888-0000-0000-0000-000000000002"; // saved "mugs"
const TEA = "88888888-0000-0000-0000-000000000003"; // saved "teapot"

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA net; CREATE SCHEMA vault; CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
CREATE TABLE net.calls (body jsonb);
CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.calls VALUES (body); SELECT 1::bigint $$;
CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
INSERT INTO vault.decrypted_secrets VALUES ('supabase_url','http://x'),('service_role_key','k');
CREATE FUNCTION public.seed_jobs_hidden_publicly() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.seed_hidden_in_discovery() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.miles_between(a numeric, b numeric, c numeric, d numeric) RETURNS numeric LANGUAGE sql AS $$ SELECT abs(a - c) * 69 $$;
CREATE FUNCTION public.feature_enabled_for_user(p_key text, p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE FUNCTION public.feature_enabled_for(p_key text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE FUNCTION public.declutter_seller_hidden(p_seller uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.saved_search_category_matches(p_search_category text, p_category text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, email_verified boolean, ban_status text, parish text, latitude numeric, longitude numeric,
  is_seed boolean DEFAULT false);
CREATE TABLE public.notification_preferences (user_id uuid PRIMARY KEY, job_matches boolean, saved_searches_paused boolean DEFAULT false);
CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
CREATE TABLE public.notifications (user_id uuid, title text, message text, link text);
-- declutter_notify is not what this file changes: a stand-in that records the in-app alert.
CREATE FUNCTION public.declutter_notify(p_user uuid, p_kind text, p_title text, p_message text, p_link text, p_actor uuid) RETURNS void
  LANGUAGE sql AS $$ INSERT INTO public.notifications VALUES (p_user, p_title, p_message, p_link) $$;
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(), customer_id uuid,
  category text, parish text, title text, description text, location text, latitude numeric, longitude numeric, budget numeric);
CREATE VIEW public.open_jobs_browse AS SELECT * FROM public.jobs;
CREATE TABLE public.declutter_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid NOT NULL, title text NOT NULL,
  description text NOT NULL DEFAULT '', category text NOT NULL DEFAULT 'furniture', status text NOT NULL DEFAULT 'draft',
  current_price_cents integer NOT NULL, area_lat numeric NOT NULL DEFAULT 30.0, area_lng numeric NOT NULL DEFAULT -92.0,
  is_seed boolean NOT NULL DEFAULT false, live_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.saved_searches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, name text NOT NULL,
  section text NOT NULL DEFAULT 'jobs', created_at timestamptz NOT NULL DEFAULT now(), notify_enabled boolean NOT NULL DEFAULT true,
  notify_email boolean NOT NULL DEFAULT false, category text, parish text, max_budget numeric, min_budget numeric, query text,
  location_keyword text, radius_miles numeric, last_notified_at timestamptz, last_emailed_at timestamptz, last_seen_at timestamptz);
`);

if (RED) {
  await db.exec(definitionBefore("deliver_saved_search_item_alerts", NEW_FILE));
  await db.exec(definitionBefore("saved_search_new_counts", NEW_FILE));
} else {
  const sql = readFileSync(MIG_DIR + NEW_FILE, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(sql);
  check("migration applies 3x", true);
}
const q = async (s, p = []) => (await db.query(s, p)).rows;

// ── 1. one rule: SQL agrees with Browse's TypeScript on every case ─────────
const hasSql = (await q(`SELECT to_regprocedure('public.declutter_search_matches(text,text,text,text)') IS NOT NULL AS ok`))[0].ok;
check("the inventory read something", CASES.length > 15);
for (const [query, title, desc, cat, want] of CASES) {
  const ts = matchesSearch(query, { title, description: desc, category: cat });
  const sql = hasSql ? (await q(`SELECT public.declutter_search_matches($1, $2, $3, $4) AS m`, [query, title, desc, cat]))[0].m : null;
  check(`"${query}" vs "${title}" / ${cat} -> ${want}`, ts === want && sql === want, `ts ${ts}, sql ${sql}`);
}
if (hasSql) {
  check("a NULL query matches everything (no search)", (await q(`SELECT public.declutter_search_matches(NULL, 'x', NULL, NULL) AS m`))[0].m === true);
}

// ── 2. the alerts and counts use it ────────────────────────────────────────
for (const id of [SELLER, BLUE, PLURAL, TEA]) await q(`INSERT INTO public.profiles VALUES ($1, true, 'active', 'Acadia', 30.0, -92.0)`, [id]);
const save = async (user, query) => (await q(
  `INSERT INTO public.saved_searches (user_id, name, section, query, created_at) VALUES ($1, $2, 'declutter', $2, now() - interval '2 days') RETURNING id`,
  [user, query]))[0].id;
const sBlue = await save(BLUE, "mug blue");
const sPlural = await save(PLURAL, "mugs");
const sTea = await save(TEA, "teapot");
const item = (await q(
  `INSERT INTO public.declutter_items (seller_id, title, description, category, status, current_price_cents, live_at)
   VALUES ($1, 'Blue coffee mug', 'Barely used', 'kitchen', 'live', 500, now() - interval '1 day') RETURNING id`, [SELLER]))[0].id;
const newCount = async (uid, id) => {
  await db.exec(`SET request.jwt.claim.sub = '${uid}'`);
  try { return (await q(`SELECT new_count FROM public.saved_search_new_counts() WHERE search_id = $1`, [id]))[0]?.new_count; }
  finally { await db.exec(`RESET request.jwt.claim.sub`); }
};
check('"mug blue" counts the "Blue coffee mug" as 1 new', (await newCount(BLUE, sBlue)) === 1, `got ${await newCount(BLUE, sBlue)}`);
check('"mugs" counts it as 1 new', (await newCount(PLURAL, sPlural)) === 1, `got ${await newCount(PLURAL, sPlural)}`);
check('"teapot" counts 0', (await newCount(TEA, sTea)) === 0);
const sent = (await q(`SELECT public.deliver_saved_search_item_alerts($1) AS n`, [item]))[0].n;
const who = (await q(`SELECT user_id FROM public.notifications ORDER BY user_id`)).map((r) => r.user_id);
check('the listing alerts the "mug blue" and "mugs" members, not "teapot"', sent === 2 && who.join() === [BLUE, PLURAL].join(), `sent ${sent}, ${who.join()}`);

// ── 3. grants ──────────────────────────────────────────────────────────────
if (hasSql) {
  for (const role of ["anon", "authenticated"]) {
    const ok = (await q(`SELECT has_function_privilege($1, 'public.declutter_search_matches(text,text,text,text)', 'EXECUTE')
                          OR has_function_privilege($1, 'public.declutter_search_stem(text)', 'EXECUTE') AS x`, [role]))[0].x;
    check(`${role} cannot call the search helpers`, ok === false);
  }
}

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
