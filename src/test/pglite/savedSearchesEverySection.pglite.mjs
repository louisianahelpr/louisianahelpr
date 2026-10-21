#!/usr/bin/env node
/**
 * Q2275 (board 91): saved searches for every section. Runs
 * 20261021042132_saved_searches_every_section.sql VERBATIM (3x) over the
 * definitions it replaces (the newest ones in the migrations before it) and a
 * prod-shaped fixture (saved_searches with its live policies, a stand-in
 * open_jobs_browse and the declutter_items SELECT policy's helpers), then:
 *
 *   - the existing Jobs searches become section 'jobs' with email on, in place;
 *   - a Declutter "chair" search shows "1 new" after a matching item goes live,
 *     and its member gets one in-app alert and one email;
 *   - the email channel is once a day, the in-app throttle hourly;
 *   - a block, the member's switch, the pause and the price each stop it;
 *   - Jobs searches still alert, email only when their email channel is on,
 *     and a Declutter search never matches a job;
 *   - members read and write only their own rows; the count RPC is not
 *     callable by anon; the item sender and the queue are service only.
 *
 *   node src/test/pglite/savedSearchesEverySection.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/savedSearchesEverySection.pglite.mjs   # RED
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20261021042132_saved_searches_every_section.sql";
const RED = process.env.NEW_MIGRATION === "skip";
if (RED) console.log("NEW_MIGRATION=skip: running the PREVIOUS definitions (expect FAILs)");

/** The newest CREATE [OR REPLACE] FUNCTION public.<name>( in migrations sorting before `before`. */
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

const SELLER = "77777777-0000-0000-0000-000000000000";
const BUYER = "77777777-0000-0000-0000-000000000001"; // the "chair" searcher
const OTHER = "77777777-0000-0000-0000-000000000002"; // has the switch off
const POSTER = "77777777-0000-0000-0000-000000000003";
const HELPR = "77777777-0000-0000-0000-000000000004"; // a Jobs searcher
const QUIET = "77777777-0000-0000-0000-000000000005"; // Jobs search, email off

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
CREATE TABLE public.launch_flag (hidden boolean NOT NULL); INSERT INTO public.launch_flag VALUES (true);
CREATE FUNCTION public.seed_jobs_hidden_publicly() RETURNS boolean LANGUAGE sql AS $$ SELECT hidden FROM public.launch_flag $$;
CREATE FUNCTION public.seed_hidden_in_discovery() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.get_user_credential_tier(p_user_id uuid) RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 0 $$;
CREATE FUNCTION public.early_access_delay_minutes(p_user_id uuid) RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 0 $$;
CREATE FUNCTION public.miles_between(a numeric, b numeric, c numeric, d numeric) RETURNS numeric LANGUAGE sql AS $$ SELECT abs(a - c) * 69 $$;
REVOKE ALL ON FUNCTION public.miles_between(numeric, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;
-- The switch: on for everyone in this fixture but OTHER.
CREATE FUNCTION public.feature_enabled_for_user(p_key text, p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE
  AS $$ SELECT p_user_id IS DISTINCT FROM '${OTHER}'::uuid $$;
CREATE FUNCTION public.feature_enabled_for(p_key text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT public.feature_enabled_for_user(p_key, auth.uid()) $$;
CREATE FUNCTION public.declutter_seller_hidden(p_seller uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, email_verified boolean, ban_status text, parish text, latitude numeric, longitude numeric,
  is_seed boolean DEFAULT false);
CREATE TABLE public.notification_preferences (user_id uuid PRIMARY KEY, job_matches boolean);
CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
CREATE TABLE public.ban_settlement_queue (user_id uuid, review_state text);
CREATE TABLE public.error_logs (severity text, message text, tags jsonb);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text, message text, type text, link text, job_id uuid,
  read boolean DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(), status text, payment_status text,
  parent_job_id uuid, offered_to_helper_id uuid, direct_offer_status text, is_seed boolean DEFAULT false, customer_id uuid, helper_id uuid,
  category text, parish text, title text, description text, location text, latitude numeric, longitude numeric, budget numeric DEFAULT 50,
  is_urgent boolean DEFAULT false, credential_tier integer NOT NULL DEFAULT 0);
-- Stand-in for the Browse view (security_invoker = false on prod).
CREATE VIEW public.open_jobs_browse AS SELECT * FROM public.jobs
  WHERE status = 'open' AND customer_id IS NOT NULL AND payment_status IN ('escrow','payout_pending','released') AND NOT is_seed;
GRANT SELECT ON public.open_jobs_browse TO authenticated;
CREATE TABLE public.declutter_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid NOT NULL, title text NOT NULL,
  category text NOT NULL DEFAULT 'furniture', status text NOT NULL DEFAULT 'draft', current_price_cents integer NOT NULL,
  area_lat numeric NOT NULL DEFAULT 30.0, area_lng numeric NOT NULL DEFAULT -92.0, is_seed boolean NOT NULL DEFAULT false,
  live_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
-- saved_searches as it stands on prod before this migration, policies included.
CREATE TABLE public.saved_searches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), notify_enabled boolean NOT NULL DEFAULT true, category text, parish text, max_budget numeric,
  min_budget numeric, query text, location_keyword text, radius_miles numeric, last_notified_at timestamptz);
ALTER TABLE public.saved_searches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own saved searches" ON public.saved_searches FOR SELECT USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users can create their own saved searches" ON public.saved_searches FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users can update their own saved searches" ON public.saved_searches FOR UPDATE USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users can delete their own saved searches" ON public.saved_searches FOR DELETE USING ((SELECT auth.uid()) = user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_searches TO authenticated;
CREATE TABLE public.saved_search_alert_queue (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, job_id uuid, notify_at timestamptz,
  search_name text, matched_search_ids uuid[], created_at timestamptz DEFAULT now(), UNIQUE (user_id, job_id));
CREATE TABLE public.parish_match_alert_queue (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, job_id uuid, attempts integer DEFAULT 0,
  retry_after timestamptz);
CREATE FUNCTION public.deliver_parish_match_alert(p_user_id uuid, p_job_id uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
`);
for (const fn of ["early_access_visible_at", "declutter_notify", "notify_saved_searches_on_new_job", "deliver_saved_search_alert",
  "sweep_saved_search_alert_queue"]) {
  await db.exec(definitionBefore(fn, NEW_FILE));
}
const q = async (s, p = []) => (await db.query(s, p)).rows;
// An existing (pre-migration) Jobs search, to prove the in-place migration.
await q(`INSERT INTO public.profiles VALUES ($1, true, 'active', 'Acadia', 30.0, -92.0)`, [HELPR]);
await q(`INSERT INTO public.saved_searches (user_id, name, category) VALUES ($1, 'Yard jobs', 'yard_work')`, [HELPR]);

if (!RED) {
  const sql = readFileSync(MIG_DIR + NEW_FILE, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(sql);
  check("migration applies 3x", true);
}
const has = async (table, col) =>
  (await q(`SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2`, [table, col]))[0].n === 1;
if (!(await has("saved_searches", "section"))) {
  check("saved_searches has a section, an email channel and last_seen_at", false, "no section column");
  console.log(`\n${failures} FAIL`);
  process.exit(1);
}

// ── 1. the Jobs searches are migrated in place ─────────────────────────────
const old = (await q(`SELECT section, notify_email, notify_enabled, category FROM public.saved_searches WHERE user_id = $1`, [HELPR]))[0];
check("the existing Jobs search is now section 'jobs' with email on, nothing else changed",
  old.section === "jobs" && old.notify_email === true && old.notify_enabled === true && old.category === "yard_work", JSON.stringify(old));
let bad = null;
try { await q(`INSERT INTO public.saved_searches (user_id, name, section) VALUES ($1, 'x', 'cars')`, [HELPR]); } catch (e) { bad = e.message; }
check("section is one of the four", bad !== null, bad ?? "accepted 'cars'");

// ── 2. Declutter: "chair" under $100 ───────────────────────────────────────
for (const id of [SELLER, BUYER, OTHER, POSTER, QUIET]) await q(`INSERT INTO public.profiles VALUES ($1, true, 'active', 'Acadia', 30.0, -92.0)`, [id]);
await q(`INSERT INTO public.notification_preferences VALUES ($1, true) ON CONFLICT DO NOTHING`, [BUYER]);
const save = async (user, section, extra = {}) => (await q(
  `INSERT INTO public.saved_searches (user_id, name, section, query, max_budget, radius_miles, notify_email, created_at)
   VALUES ($1, $2, $3, $4, $5, $6, $7, now() - interval '2 days') RETURNING id`,
  [user, extra.name ?? `"chair" in Declutter`, section, extra.query ?? "chair", extra.max ?? 100, extra.radius ?? 25, extra.email ?? true]))[0].id;
const chair = await save(BUYER, "declutter");
await save(OTHER, "declutter");
const sweep = async () => (await q(`SELECT public.sweep_saved_search_alert_queue() n`))[0].n;
const golive = async (title, cents, seller = SELLER) => {
  const id = (await q(`INSERT INTO public.declutter_items (seller_id, title, current_price_cents, status) VALUES ($1, $2, $3, 'pending') RETURNING id`,
    [seller, title, cents]))[0].id;
  await q(`UPDATE public.declutter_items SET status = 'live', live_at = now() - interval '1 day' WHERE id = $1`, [id]);
  return id;
};
const asUser = async (uid, sql, p = []) => {
  await db.exec(`SET request.jwt.claim.sub = '${uid ?? ""}'; SET ROLE ${uid ? "authenticated" : "anon"};`);
  try { return (await db.query(sql, p)).rows; } finally { await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`); }
};
const newCount = async (uid, id) => {
  const rows = await asUser(uid, `SELECT search_id, new_count FROM public.saved_search_new_counts()`);
  return rows.find((r) => r.search_id === id)?.new_count;
};
const alerts = async (u) => (await q(`SELECT link FROM public.notifications WHERE user_id = $1 ORDER BY created_at`, [u]));
const emails = async (u) => (await q(`SELECT count(*)::int n FROM net.calls WHERE body->>'user_id' = $1`, [u]))[0].n;

check("before anything is listed the chair search shows 0 new", (await newCount(BUYER, chair)) === 0);
const item1 = await golive("Oak dining chair", 4500);
await golive("Chair, leather", 15000); // over $100: no match
check("a listing going live is queued once", (await q(`SELECT count(*)::int n FROM public.saved_search_item_queue`))[0].n === 2);
check('the chair search shows "1 new" after a matching item goes live', (await newCount(BUYER, chair)) === 1, `got ${await newCount(BUYER, chair)}`);
await sweep();
const a1 = await alerts(BUYER);
check("the sweep alerts the member once, linking the item", a1.length === 1 && a1[0].link === `/declutter/item/${item1}`, JSON.stringify(a1));
check("and emails them once (email channel on)", (await emails(BUYER)) === 1);
check("the queue is drained", (await q(`SELECT count(*)::int n FROM public.saved_search_item_queue`))[0].n === 0);
check("a member whose Declutter switch is off gets nothing and counts nothing",
  (await alerts(OTHER)).length === 0 && (await newCount(OTHER, (await q(`SELECT id FROM public.saved_searches WHERE user_id=$1`, [OTHER]))[0].id)) === 0);
check("the seller is never alerted about their own listing", (await alerts(SELLER)).length === 0);

await golive("Rocking chair", 3000);
await sweep();
check("a second match inside the hour is throttled (in-app)", (await alerts(BUYER)).length === 1);
await q(`UPDATE public.saved_searches SET last_notified_at = now() - interval '2 hours' WHERE id = $1`, [chair]);
await golive("Kitchen chair", 2000);
await sweep();
check("past the hour the app alerts again, but email waits for the day", (await alerts(BUYER)).length === 2 && (await emails(BUYER)) === 1,
  `alerts ${(await alerts(BUYER)).length}, emails ${await emails(BUYER)}`);

// Looking resets the count; a member can stamp only their own row.
const stamped = await asUser(BUYER, `UPDATE public.saved_searches SET last_seen_at = now() WHERE id = $1 RETURNING id`, [chair]);
check("opening the results (last_seen_at) resets the count to 0", stamped.length === 1 && (await newCount(BUYER, chair)) === 0);

// A block either way.
await q(`INSERT INTO public.user_blocks VALUES ($1, $2)`, [BUYER, SELLER]);
await q(`UPDATE public.saved_searches SET last_notified_at = NULL, last_seen_at = now() - interval '3 days' WHERE id = $1`, [chair]);
const before = (await alerts(BUYER)).length;
await golive("Blocked seller's chair", 1000);
await sweep();
check("a blocked seller's item neither alerts nor counts", (await alerts(BUYER)).length === before && (await newCount(BUYER, chair)) === 0,
  `alerts +${(await alerts(BUYER)).length - before}, count ${await newCount(BUYER, chair)}`);
await q(`DELETE FROM public.user_blocks`);

// Pause all alerts.
await q(`UPDATE public.notification_preferences SET saved_searches_paused = true WHERE user_id = $1`, [BUYER]);
await golive("Paused chair", 1000);
await sweep();
check('"Pause all alerts" stops the alert (the search stays)', (await alerts(BUYER)).length === before
  && (await q(`SELECT count(*)::int n FROM public.saved_searches WHERE id = $1`, [chair]))[0].n === 1);
await q(`UPDATE public.notification_preferences SET saved_searches_paused = false WHERE user_id = $1`, [BUYER]);

// A test seller with the launch switch OFF (seeds shown publicly): the item is
// live for everyone, but a real member is never alerted or emailed about it.
const SEEDER = "77777777-0000-0000-0000-000000000009";
await q(`INSERT INTO public.profiles VALUES ($1, true, 'active', 'Acadia', 30.0, -92.0, true)`, [SEEDER]);
await q(`UPDATE public.launch_flag SET hidden = false`);
await q(`UPDATE public.saved_searches SET last_notified_at = NULL, last_emailed_at = NULL WHERE id = $1`, [chair]);
const seedBefore = { a: (await alerts(BUYER)).length, e: await emails(BUYER) };
await golive("Test seller's chair", 1000, SEEDER);
await sweep();
check("a test seller's item never alerts or emails a real member (seed boundary, Q137)",
  (await alerts(BUYER)).length === seedBefore.a && (await emails(BUYER)) === seedBefore.e,
  `alerts +${(await alerts(BUYER)).length - seedBefore.a}, emails +${(await emails(BUYER)) - seedBefore.e}`);
await q(`UPDATE public.launch_flag SET hidden = true`);

// ── 3. Jobs still alert; email follows the channel ─────────────────────────
await q(`UPDATE public.saved_searches SET category = NULL WHERE user_id = $1`, [HELPR]);
await save(QUIET, "jobs", { query: "fence", max: null, radius: null, email: false, name: "Fence jobs" });
await save(BUYER, "declutter", { query: "fence", max: null, radius: null, name: "fence in Declutter" });
await db.exec(`CREATE TRIGGER t AFTER INSERT ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.notify_saved_searches_on_new_job();`);
const job = (await q(`INSERT INTO public.jobs (status, payment_status, customer_id, category, parish, title, created_at, latitude, longitude)
  VALUES ('open','escrow',$1,'yard_work','Acadia','Fix my fence', now() - interval '1 day', 30.0, -92.0) RETURNING id`, [POSTER]))[0].id;
const buyerBefore = (await alerts(BUYER)).length;
await sweep();
check("a Jobs search still alerts on a new job", (await alerts(HELPR)).some((n) => n.link === `/home?job=${job}`));
check("with its email channel on it emails", (await emails(HELPR)) === 1);
check("with its email channel off it alerts in the app only", (await alerts(QUIET)).length === 1 && (await emails(QUIET)) === 0);
check("a Declutter search never matches a job", (await alerts(BUYER)).length === buyerBefore);
const helprSearch = (await q(`SELECT id FROM public.saved_searches WHERE user_id = $1`, [HELPR]))[0].id;
await q(`UPDATE public.saved_searches SET last_seen_at = now() - interval '3 days' WHERE id = $1`, [helprSearch]);
check("the Jobs search counts the new job", (await newCount(HELPR, helprSearch)) === 1, `got ${await newCount(HELPR, helprSearch)}`);

// ── 4. who can touch what ──────────────────────────────────────────────────
const theirs = await asUser(HELPR, `SELECT id FROM public.saved_searches WHERE user_id = $1`, [BUYER]);
check("a member cannot read another member's saved searches", theirs.length === 0);
const upd = await asUser(HELPR, `UPDATE public.saved_searches SET notify_email = false WHERE id = $1 RETURNING id`, [chair]);
check("nor change them", upd.length === 0);
let ins = null;
try { await asUser(HELPR, `INSERT INTO public.saved_searches (user_id, name, section) VALUES ($1, 'x', 'declutter')`, [BUYER]); } catch (e) { ins = e.message; }
check("nor create one for someone else", ins !== null);
check("the count RPC returns only the caller's searches",
  (await asUser(HELPR, `SELECT search_id FROM public.saved_search_new_counts()`)).every((r) => r.search_id === helprSearch));
const acl = (await q(`SELECT
  has_function_privilege('anon', 'public.saved_search_new_counts()', 'EXECUTE') c_anon,
  has_function_privilege('authenticated', 'public.saved_search_new_counts()', 'EXECUTE') c_auth,
  has_function_privilege('authenticated', 'public.deliver_saved_search_item_alerts(uuid)', 'EXECUTE') d_auth,
  has_function_privilege('anon', 'public.deliver_saved_search_item_alerts(uuid)', 'EXECUTE') d_anon,
  has_function_privilege('service_role', 'public.deliver_saved_search_item_alerts(uuid)', 'EXECUTE') d_svc,
  has_table_privilege('authenticated', 'public.saved_search_item_queue', 'SELECT') q_auth`))[0];
check("count RPC: members yes, anon no; the item sender and its queue are service only",
  !acl.c_anon && acl.c_auth && !acl.d_auth && !acl.d_anon && acl.d_svc && !acl.q_auth, JSON.stringify(acl));

console.log(failures ? `\n${failures} FAIL` : "\nall PASS");
process.exit(failures ? 1 : 0);
