#!/usr/bin/env node
/**
 * PGlite proof for BUY-52: 20261031220326_saved_search_price_drop_alerts (the alert half, PR #3906) and
 * 20261031224850_saved_search_price_drop_counts (the count half), with 20261031222115 (BUY-13) between them as on the
 * branch: a live Declutter listing whose price drops
 * into a saved search's budget alerts that search; a member already told of the listing is not told again; a price
 * rise, or a change on a listing that is not live, queues nothing. A drop every night still tells each search once. The
 * "N new" count (saved_search_new_counts) counts a listing that dropped into the search's budget since the last look,
 * once however many drops, also for a search with alerts off; declutter_dropped_into_budget gives Browse the same ids.
 *
 *   node src/test/pglite/declutterSavedSearchPriceDrop.pglite.mjs                    # applied 3x: all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterSavedSearchPriceDrop.pglite.mjs # RED: 224850 skipped, no drop counts
 *   MUTANT=<name> node src/test/pglite/declutterSavedSearchPriceDrop.pglite.mjs      # a planted defect: must FAIL
 *
 * Stubbed, said so: declutter_notify records the bell row; net.http_post records the email body; the search match,
 * miles, feature and seller-hidden helpers answer yes. The sweep is played by hand as it runs: it deletes the queue
 * row, then calls the alert. Before this migration: 20261031023451 (the count) and 20261031091529 (held matches) are
 * applied as on prod. auth.uid() reads a setting the test sets.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const BEFORE = ["20261031023451_saved_search_keeps_its_origin.sql", "20261031091529_declutter_saved_search_held_matches.sql"];
const ALERT = "20261031220326_saved_search_price_drop_alerts.sql", B13 = "20261031222115_saved_search_keeps_declutter_filters.sql";
const THIS = "20261031224850_saved_search_price_drop_counts.sql";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // A re-run reaches only searches with a held row again (the old rule): the newly-in-budget search is skipped.
  heldOnly: [B13, "AND (NOT v_rerun OR NOT EXISTS (SELECT 1 FROM public.saved_search_item_matches m\n                                       WHERE m.item_id = v_item.id AND m.search_id = s.id AND NOT m.held))",
    "AND (NOT v_rerun OR EXISTS (SELECT 1 FROM public.saved_search_item_matches m\n                                       WHERE m.item_id = v_item.id AND m.search_id = s.id AND m.held))"],
  // A re-run reaches every matching search: a member already told hears of it twice.
  everyone: [B13, "AND (NOT v_rerun OR NOT EXISTS", "AND (true OR NOT EXISTS"],
  // The drop trigger also fires on a rise.
  onRise: [ALERT, "AND NEW.current_price_cents < OLD.current_price_cents)", "AND NEW.current_price_cents <> OLD.current_price_cents)"],
  // The count goes back to live_at only: a drop into budget is never "new".
  countLiveOnly: [THIS, "OR i.id IN (SELECT public.declutter_dropped_into_budget(", "OR false AND i.id IN (SELECT public.declutter_dropped_into_budget("],
  // Any drop since the last look counts, even one from a price already in budget.
  anyDrop: [THIS, "AND d.from_cents > p_max_budget * 100", "AND d.from_cents > 0"],
  // The drop is not written down.
  noLog: [THIS, "  INSERT INTO public.declutter_item_price_drops (item_id, from_cents, to_cents)\n  VALUES (NEW.id, OLD.current_price_cents, NEW.current_price_cents);\n", ""],
};
const skip = process.env.NEW_MIGRATION === "skip";

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `77777777-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SELLER = U(1), ANN = U(2), BEN = U(3), CARA = U(4), DEE = U(5), ERIN = U(6);

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
  is_seed boolean NOT NULL DEFAULT false, live_at timestamptz, porch_ok boolean NOT NULL DEFAULT true,
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
CREATE TRIGGER saved_search_on_item_live AFTER UPDATE OF status ON public.declutter_items FOR EACH ROW
  WHEN (NEW.status = 'live' AND OLD.status IS DISTINCT FROM 'live') EXECUTE FUNCTION public.saved_search_on_item_live();
CREATE TRIGGER saved_search_on_item_insert_live AFTER INSERT ON public.declutter_items FOR EACH ROW
  WHEN (NEW.status = 'live') EXECUTE FUNCTION public.saved_search_on_item_live();
`);
{
  const files = skip ? [ALERT, B13] : [ALERT, B13, THIS];
  const read = (name) => {
    let sql = readFileSync(MIG_DIR + name, "utf8");
    const m = MUTANTS[MUTANT];
    if (MUTANT && m && m[0] === name) {
      if (!sql.includes(m[1])) throw new Error(`mutant ${MUTANT} did not apply`);
      sql = sql.replace(m[1], m[2]);
    }
    return sql;
  };
  if (MUTANT && !MUTANTS[MUTANT]) throw new Error(`no mutant ${MUTANT}`);
  for (let k = 1; k <= 3; k++) {
    try { for (const name of files) await db.exec(read(name)); check(true, `the migrations apply (run ${k})`); } catch (e) { check(false, `the migrations apply (run ${k}): ${e.message}`); }
  }
}

const q = async (s, p = []) => (await db.query(s, p)).rows;
for (const u of [SELLER, ANN, BEN, CARA, DEE, ERIN]) await q(`INSERT INTO public.profiles (user_id) VALUES ($1)`, [u]);
// Ann: lamps up to $50. Ben: any lamp.
await q(`INSERT INTO public.saved_searches (user_id, name, max_budget) VALUES ($1, '“lamp” in Declutter', 50)`, [ANN]);
await q(`INSERT INTO public.saved_searches (user_id, name) VALUES ($1, '“lamp” in Declutter')`, [BEN]);
const bells = async (u) => (await q(`SELECT message FROM public.bell WHERE user_id = $1 ORDER BY ctid`, [u])).map((x) => x.message);
const sweepItem = async (id) => { await q(`DELETE FROM public.saved_search_item_queue WHERE item_id = $1`, [id]); return (await q(`SELECT public.deliver_saved_search_item_alerts($1) AS n`, [id]))[0].n; };
const queued = async (id) => (await q(`SELECT 1 FROM public.saved_search_item_queue WHERE item_id = $1`, [id])).length > 0;
const hourPasses = () => q(`UPDATE public.saved_searches SET last_notified_at = last_notified_at - interval '2 hours', last_emailed_at = last_emailed_at - interval '2 days' WHERE last_notified_at IS NOT NULL`);

const lamp = (await q(`INSERT INTO public.declutter_items (seller_id, title, current_price_cents, status) VALUES ($1, 'Brass lamp', 6000, 'live') RETURNING id`, [SELLER]))[0].id;
await sweepItem(lamp);
check(JSON.stringify(await bells(BEN)) === JSON.stringify(["Something new matches “lamp” in Declutter: Brass lamp ($60)"]), `Ben told at listing (${JSON.stringify(await bells(BEN))})`);
check((await bells(ANN)).length === 0, "Ann's budget is $50: not told of a $60 lamp");

await hourPasses();
await q(`UPDATE public.declutter_items SET current_price_cents = 4000 WHERE id = $1`, [lamp]);
check(await queued(lamp), "[fix] a price drop on a live listing queues it");
await sweepItem(lamp);
check(JSON.stringify(await bells(ANN)) === JSON.stringify(["Something new matches “lamp” in Declutter: Brass lamp ($40)"]), `[fix] Ann told once the lamp is in her budget (${JSON.stringify(await bells(ANN))})`);
check((await bells(BEN)).length === 1, `Ben, already told, is not told again (${(await bells(BEN)).length})`);

await hourPasses();
await q(`UPDATE public.declutter_items SET current_price_cents = 3500 WHERE id = $1`, [lamp]);
await sweepItem(lamp);
check((await bells(ANN)).length === 1 && (await bells(BEN)).length === 1, `a second drop tells nobody again (Ann ${(await bells(ANN)).length}, Ben ${(await bells(BEN)).length})`);

await q(`UPDATE public.declutter_items SET current_price_cents = 4500 WHERE id = $1`, [lamp]);
check(!(await queued(lamp)), "a price rise queues nothing");
await q(`UPDATE public.declutter_items SET status = 'paused' WHERE id = $1`, [lamp]);
await q(`UPDATE public.declutter_items SET current_price_cents = 1000 WHERE id = $1`, [lamp]);
check(!(await queued(lamp)), "a drop on a listing that is not live queues nothing");

// Owner's ask: a drop every night still tells each search of a listing once. Cara: chairs up to $30, and inside her
// hour when the chair first drops into it (held, BUY-50), so she is told at the end of the hour; then nightly drops.
await q(`INSERT INTO public.saved_searches (user_id, name, max_budget, last_notified_at) VALUES ($1, '“chair” in Declutter', 30, now())`, [CARA]);
const chair = (await q(`INSERT INTO public.declutter_items (seller_id, title, current_price_cents, status) VALUES ($1, 'Oak chair', 5000, 'live') RETURNING id`, [SELLER]))[0].id;
await sweepItem(chair);
await q(`UPDATE public.declutter_items SET current_price_cents = 2900 WHERE id = $1`, [chair]);
await sweepItem(chair);
check((await bells(CARA)).length === 0, "inside her hour, Cara is held, not told yet");
for (let night = 1; night <= 5; night++) {
  await hourPasses();
  await q(`UPDATE public.declutter_items SET current_price_cents = current_price_cents - 100 WHERE id = $1`, [chair]);
  await sweepItem(chair);
}
check((await bells(CARA)).length === 1, `[fix] five nightly drops: Cara told once (${(await bells(CARA)).length})`);
// (The match helper is stubbed to yes, so Ann's and Ben's searches match the chair too.)
const chairBells = async (u) => (await bells(u)).filter((m) => m.includes("Oak chair")).length;
check(await chairBells(ANN) === 1 && await chairBells(BEN) === 1, `[fix] Ann and Ben each told of the chair once (Ann ${await chairBells(ANN)}, Ben ${await chairBells(BEN)})`);

// The "N new" count. Dee: tables up to $50, alerts OFF (no match rows), last looked after the table went live at $80.
// Erin: any table, no top price.
const as = (u) => q(`SELECT set_config('test.uid', $1, false)`, [u]);
const newCount = async (u) => { await as(u); return (await q(`SELECT new_count FROM public.saved_search_new_counts()`))[0].new_count; };
const table = (await q(`INSERT INTO public.declutter_items (seller_id, title, category, current_price_cents, status, live_at)
  VALUES ($1, 'Pine table', 'furniture', 8000, 'paused', now() - interval '2 days') RETURNING id`, [SELLER]))[0].id;
await q(`UPDATE public.declutter_items SET status = 'live' WHERE id = $1`, [table]);
await q(`DELETE FROM public.saved_search_item_queue`);
await q(`INSERT INTO public.saved_searches (user_id, name, category, max_budget, notify_enabled, last_seen_at) VALUES ($1, 'Furniture in Declutter', 'furniture', 50, false, now() - interval '1 day')`, [DEE]);
await q(`INSERT INTO public.saved_searches (user_id, name, category, last_seen_at) VALUES ($1, 'Furniture in Declutter', 'furniture', now() - interval '1 day')`, [ERIN]);
const drop = (cents) => q(`UPDATE public.declutter_items SET current_price_cents = $2 WHERE id = $1`, [table, cents]);
check(await newCount(DEE) === 0, "Dee: the $80 table went live before her last look: 0 new");
await drop(6000);
check(await newCount(DEE) === 0, "a drop to $60 is still over her $50: 0 new");
await drop(4500);
check(await newCount(DEE) === 1, `[fix] a drop to $45, into her budget: 1 new (${await newCount(DEE)})`);
let ids = [];
try { await as(DEE); ids = (await q(`SELECT x FROM public.declutter_dropped_into_budget(now() - interval '1 day', 50) x`)).map((r) => r.x); } catch (e) { console.log("  (helper: " + e.message + ")"); }
check(ids.length === 1 && ids[0] === table, `[fix] Browse's helper gives the same table (${JSON.stringify(ids)})`);
await drop(4000);
check(await newCount(DEE) === 1, `[fix] another drop: still 1 new, never 2 (${await newCount(DEE)})`);
check(await newCount(ERIN) === 0, `Erin has no top price: a drop is not new (${await newCount(ERIN)})`);
// She looks (PGlite's clock can give two statements the same instant, so the earlier drops are moved a minute back).
await q(`UPDATE public.declutter_item_price_drops SET at = at - interval '1 minute'`).catch((e) => console.log("  (" + e.message + ")"));
await q(`UPDATE public.saved_searches SET last_seen_at = now() - interval '30 seconds' WHERE user_id = $1`, [DEE]);
check(await newCount(DEE) === 0, `after she looks: 0 new (${await newCount(DEE)})`);
await drop(3500);
check(await newCount(DEE) === 0, `[fix] after she looks, a drop from $40 (already in budget) is not new (${await newCount(DEE)})`);
await as("");

if (!skip) {
  const acl = (await q(`SELECT has_function_privilege('anon', 'public.saved_search_on_item_price_drop()', 'EXECUTE') a,
    has_function_privilege('authenticated', 'public.saved_search_on_item_price_drop()', 'EXECUTE') u,
    has_function_privilege('anon', 'public.deliver_saved_search_item_alerts(uuid)', 'EXECUTE') da,
    has_function_privilege('authenticated', 'public.deliver_saved_search_item_alerts(uuid)', 'EXECUTE') du,
    has_function_privilege('service_role', 'public.deliver_saved_search_item_alerts(uuid)', 'EXECUTE') ds`))[0];
  check(!acl.a && !acl.u, `the drop trigger function: anon ${acl.a}, authenticated ${acl.u}`);
  check(!acl.da && !acl.du && acl.ds, `alert grants: anon ${acl.da}, authenticated ${acl.du}, service_role ${acl.ds}`);
  const g = (await q(`SELECT has_function_privilege('anon', 'public.declutter_dropped_into_budget(timestamptz, numeric)', 'EXECUTE') a,
    has_function_privilege('authenticated', 'public.declutter_dropped_into_budget(timestamptz, numeric)', 'EXECUTE') u,
    has_table_privilege('authenticated', 'public.declutter_item_price_drops', 'SELECT') t,
    has_table_privilege('anon', 'public.declutter_item_price_drops', 'SELECT') ta,
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.declutter_item_price_drops'::regclass) rls`))[0];
  check(!g.a && g.u && !g.t && !g.ta && g.rls, `drop helper anon ${g.a}, authenticated ${g.u}; drop rows readable by authenticated ${g.t}, anon ${g.ta}; RLS ${g.rls}`);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
