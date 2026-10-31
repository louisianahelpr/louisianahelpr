#!/usr/bin/env node
/**
 * PGlite proof for 20261031220326_saved_search_price_drop_alerts (BUY-52): a live Declutter listing whose price drops
 * into a saved search's budget alerts that search; a member already told of the listing is not told again; a price
 * rise, or a change on a listing that is not live, queues nothing.
 *
 *   node src/test/pglite/declutterSavedSearchPriceDrop.pglite.mjs                    # applied 3x: all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterSavedSearchPriceDrop.pglite.mjs # RED: no alert on a drop
 *   MUTANT=<name> node src/test/pglite/declutterSavedSearchPriceDrop.pglite.mjs      # a planted defect: must FAIL
 *
 * Stubbed, said so: declutter_notify records the bell row; net.http_post records the email body; the search match,
 * miles, feature and seller-hidden helpers answer yes. The sweep is played by hand as it runs: it deletes the queue
 * row, then calls the alert. Before this migration: 20261031091529 (held matches) is applied as on prod.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const BEFORE = ["20261021042132_saved_searches_every_section.sql", "20261031091529_declutter_saved_search_held_matches.sql"];
const THIS = "20261031220326_saved_search_price_drop_alerts.sql";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // A re-run reaches only searches with a held row again (the old rule): the newly-in-budget search is skipped.
  heldOnly: ["AND (NOT v_rerun OR NOT EXISTS (SELECT 1 FROM public.saved_search_item_matches m\n                                       WHERE m.item_id = v_item.id AND m.search_id = s.id AND NOT m.held))",
    "AND (NOT v_rerun OR EXISTS (SELECT 1 FROM public.saved_search_item_matches m\n                                       WHERE m.item_id = v_item.id AND m.search_id = s.id AND m.held))"],
  // A re-run reaches every matching search: a member already told hears of it twice.
  everyone: ["AND (NOT v_rerun OR NOT EXISTS", "AND (true OR NOT EXISTS"],
  // The drop trigger also fires on a rise.
  onRise: ["AND NEW.current_price_cents < OLD.current_price_cents)", "AND NEW.current_price_cents <> OLD.current_price_cents)"],
};
const skip = process.env.NEW_MIGRATION === "skip";

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `77777777-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SELLER = U(1), ANN = U(2), BEN = U(3);

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA net; CREATE SCHEMA vault;
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
  latitude numeric, longitude numeric, is_seed boolean DEFAULT false);
CREATE TABLE public.notification_preferences (user_id uuid PRIMARY KEY, job_matches boolean, saved_searches_paused boolean DEFAULT false);
CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
CREATE TABLE public.bell (user_id uuid, title text, message text, link text);
CREATE FUNCTION public.declutter_notify(p_user uuid, p_kind text, p_title text, p_message text, p_link text, p_other uuid) RETURNS void
  LANGUAGE sql AS $$ INSERT INTO public.bell VALUES (p_user, p_title, p_message, p_link) $$;
CREATE TABLE public.declutter_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid NOT NULL, title text NOT NULL,
  description text NOT NULL DEFAULT '', category text NOT NULL DEFAULT 'kitchen', status text NOT NULL DEFAULT 'draft',
  current_price_cents integer NOT NULL, area_lat numeric NOT NULL DEFAULT 30.0, area_lng numeric NOT NULL DEFAULT -92.0,
  is_seed boolean NOT NULL DEFAULT false);
CREATE TABLE public.saved_searches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, name text NOT NULL,
  section text NOT NULL DEFAULT 'declutter', created_at timestamptz NOT NULL DEFAULT now(), notify_enabled boolean NOT NULL DEFAULT true,
  notify_email boolean NOT NULL DEFAULT true, category text, max_budget numeric, min_budget numeric, query text,
  radius_miles numeric, last_notified_at timestamptz, last_emailed_at timestamptz, origin_lat numeric, origin_lng numeric);
CREATE TABLE public.saved_search_item_queue (item_id uuid PRIMARY KEY REFERENCES public.declutter_items(id) ON DELETE CASCADE,
  queued_at timestamptz NOT NULL DEFAULT now(), attempts integer NOT NULL DEFAULT 0, retry_after timestamptz);
`);

// What prod has before this migration: the held-matches table, alert and live trigger (20261031091529), and the live
// triggers from 20261021042132.
await db.exec(readFileSync(MIG_DIR + BEFORE[1], "utf8"));
await db.exec(`
CREATE TRIGGER saved_search_on_item_live AFTER UPDATE OF status ON public.declutter_items FOR EACH ROW
  WHEN (NEW.status = 'live' AND OLD.status IS DISTINCT FROM 'live') EXECUTE FUNCTION public.saved_search_on_item_live();
CREATE TRIGGER saved_search_on_item_insert_live AFTER INSERT ON public.declutter_items FOR EACH ROW
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
for (const u of [SELLER, ANN, BEN]) await q(`INSERT INTO public.profiles (user_id) VALUES ($1)`, [u]);
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

if (!skip) {
  const acl = (await q(`SELECT has_function_privilege('anon', 'public.saved_search_on_item_price_drop()', 'EXECUTE') a,
    has_function_privilege('authenticated', 'public.saved_search_on_item_price_drop()', 'EXECUTE') u,
    has_function_privilege('anon', 'public.deliver_saved_search_item_alerts(uuid)', 'EXECUTE') da,
    has_function_privilege('authenticated', 'public.deliver_saved_search_item_alerts(uuid)', 'EXECUTE') du,
    has_function_privilege('service_role', 'public.deliver_saved_search_item_alerts(uuid)', 'EXECUTE') ds`))[0];
  check(!acl.a && !acl.u, `the drop trigger function: anon ${acl.a}, authenticated ${acl.u}`);
  check(!acl.da && !acl.du && acl.ds, `alert grants: anon ${acl.da}, authenticated ${acl.du}, service_role ${acl.ds}`);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
