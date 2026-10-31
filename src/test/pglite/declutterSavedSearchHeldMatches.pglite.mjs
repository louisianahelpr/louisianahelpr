#!/usr/bin/env node
/**
 * PGlite proof for 20261031091529_declutter_saved_search_held_matches (BUY-50): a Declutter listing that matches a
 * saved search inside its hour is held and told when the hour is up, with any others held for that member
 * ("…, and 1 more"); nobody hears of one listing twice; a relist starts fresh.
 *
 *   node src/test/pglite/declutterSavedSearchHeldMatches.pglite.mjs                    # applied 3x: all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterSavedSearchHeldMatches.pglite.mjs # RED: the previous bodies
 *   MUTANT=<name> node src/test/pglite/declutterSavedSearchHeldMatches.pglite.mjs      # a planted defect: must FAIL
 *
 * Stubbed, said so: declutter_notify records the bell row; net.http_post records the email body; the search match,
 * miles, feature and seller-hidden helpers answer yes/no. The sweep is played by hand as it runs: it deletes the
 * queue row, then calls the alert. The alert function and the live trigger function are the real bodies.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261031091529_declutter_saved_search_held_matches.sql";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // A re-run reaches every matching search again: the member already told hears of it twice.
  everyoneOnRerun: ["AND (NOT v_rerun OR EXISTS", "AND (true OR EXISTS"],
  // The held listing never comes back on the queue.
  noRequeue: ["IF v_retry IS NOT NULL THEN", "IF false THEN"],
  // The others held are not said.
  noMore: [`CASE WHEN v_more > 0 THEN ', and ' || v_more || ' more' ELSE '' END`, `''`],
  // A relist keeps the old rows (so it would reach only the searches still owed it).
  relistKeepsRows: ["  DELETE FROM public.saved_search_item_matches WHERE item_id = NEW.id;\n", ""],
};
const skip = process.env.NEW_MIGRATION === "skip";

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

await db.exec(definitionBefore("deliver_saved_search_item_alerts", THIS));
await db.exec(definitionBefore("saved_search_on_item_live", THIS));
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
// The triggers as 20261021042132 makes them (this migration restates only their function).
await db.exec(`
CREATE TRIGGER saved_search_on_item_live AFTER UPDATE OF status ON public.declutter_items FOR EACH ROW
  WHEN (NEW.status = 'live' AND OLD.status IS DISTINCT FROM 'live') EXECUTE FUNCTION public.saved_search_on_item_live();
CREATE TRIGGER saved_search_on_item_insert_live AFTER INSERT ON public.declutter_items FOR EACH ROW
  WHEN (NEW.status = 'live') EXECUTE FUNCTION public.saved_search_on_item_live();
`);

const q = async (s, p = []) => (await db.query(s, p)).rows;
for (const u of [SELLER, ANN, BEN]) await q(`INSERT INTO public.profiles (user_id) VALUES ($1)`, [u]);
// Ann's search has not alerted yet; Ben's alerted 10 minutes ago (inside his hour).
await q(`INSERT INTO public.saved_searches (user_id, name, last_notified_at) VALUES ($1, '“mug” in Declutter', NULL)`, [ANN]);
await q(`INSERT INTO public.saved_searches (user_id, name, last_notified_at, last_emailed_at) VALUES ($1, '“mug” in Declutter', now() - interval '10 minutes', now() - interval '2 days')`, [BEN]);

const bells = async (u) => (await q(`SELECT message FROM public.bell WHERE user_id = $1 ORDER BY ctid`, [u])).map((x) => x.message);
// The sweep's step: delete the queue row, then run the alert.
const sweepItem = async (id) => { await q(`DELETE FROM public.saved_search_item_queue WHERE item_id = $1`, [id]); return (await q(`SELECT public.deliver_saved_search_item_alerts($1) AS n`, [id]))[0].n; };
const queued = async (id) => (await q(`SELECT retry_after FROM public.saved_search_item_queue WHERE item_id = $1`, [id]))[0];

const mug1 = (await q(`INSERT INTO public.declutter_items (seller_id, title, current_price_cents, status) VALUES ($1, 'Blue mug', 500, 'live') RETURNING id`, [SELLER]))[0].id;
check(!!(await queued(mug1)), "going live queues the listing");
await sweepItem(mug1);
check(JSON.stringify(await bells(ANN)) === JSON.stringify(["Something new matches “mug” in Declutter: Blue mug ($5)"]), `Ann told of the first mug (${JSON.stringify(await bells(ANN))})`);
check((await bells(BEN)).length === 0, "Ben is inside his hour: not told yet");
const back = await queued(mug1);
const mins = back?.retry_after ? (new Date(back.retry_after).getTime() - Date.now()) / 60000 : null;
check(mins !== null && mins > 45 && mins < 55, `[fix] the first mug is back on the queue for the end of Ben's hour (${mins?.toFixed(1)} min)`);

// A second mug a minute later: both members are now inside their hour.
const mug2 = (await q(`INSERT INTO public.declutter_items (seller_id, title, current_price_cents, status) VALUES ($1, 'Green mug', 700, 'live') RETURNING id`, [SELLER]))[0].id;
await sweepItem(mug2);
check((await bells(ANN)).length === 1 && (await bells(BEN)).length === 0, "the second mug inside both hours: nobody told yet");
check(!!(await queued(mug2))?.retry_after, "[fix] the second mug is back on the queue too");

// The hour passes.
await q(`UPDATE public.saved_searches SET last_notified_at = last_notified_at - interval '2 hours' WHERE last_notified_at IS NOT NULL`);
await sweepItem(mug1);
check(JSON.stringify(await bells(BEN)) === JSON.stringify(["Something new matches “mug” in Declutter: Blue mug ($5), and 1 more"]),
  `[fix] Ben told of the first mug, with the second held for him (${JSON.stringify(await bells(BEN))})`);
check((await bells(ANN)).length === 1, `Ann is not told of the first mug twice (${(await bells(ANN)).length})`);
check(!(await queued(mug1)), "nobody owed the first mug: off the queue");
const mail = (await q(`SELECT body->>'message' AS m FROM net.calls WHERE body->>'user_id' = $1`, [BEN])).map((x) => x.m);
check(JSON.stringify(mail) === JSON.stringify(["Something new matches “mug” in Declutter: Blue mug ($5), and 1 more"]), `[fix] Ben's email says the same (${JSON.stringify(mail)})`);

await q(`UPDATE public.saved_searches SET last_notified_at = last_notified_at - interval '2 hours' WHERE last_notified_at IS NOT NULL`);
await sweepItem(mug2);
check(JSON.stringify(await bells(ANN)) === JSON.stringify(["Something new matches “mug” in Declutter: Blue mug ($5)", "Something new matches “mug” in Declutter: Green mug ($7)"]),
  `[fix] Ann told of the second mug once her hour was up (${JSON.stringify(await bells(ANN))})`);
check((await bells(BEN)).length === 1, `Ben is not told of the second mug again: it came with the first (${(await bells(BEN)).length})`);
check(!(await queued(mug2)), "nobody owed the second mug: off the queue");

// A relist starts fresh: everyone matching hears of it again, as before this change.
await q(`UPDATE public.declutter_items SET status = 'paused' WHERE id = $1`, [mug1]);
await q(`UPDATE public.declutter_items SET status = 'live' WHERE id = $1`, [mug1]);
const left = (await q(`SELECT count(*)::int AS n FROM public.saved_search_item_matches WHERE item_id = $1`, [mug1]).catch(() => [{ n: -1 }]))[0].n;
check(skip || left === 0, `[fix] a relist clears the first mug's rows (${left})`);
await q(`UPDATE public.saved_searches SET last_notified_at = last_notified_at - interval '2 hours' WHERE last_notified_at IS NOT NULL`);
const relistSent = await sweepItem(mug1);
check(relistSent === 2, `the relisted mug reaches both members again (${relistSent})`);

if (!skip) {
  const acl = (await q(`SELECT has_function_privilege('anon', 'public.deliver_saved_search_item_alerts(uuid)', 'EXECUTE') a,
    has_function_privilege('authenticated', 'public.deliver_saved_search_item_alerts(uuid)', 'EXECUTE') u,
    has_function_privilege('service_role', 'public.deliver_saved_search_item_alerts(uuid)', 'EXECUTE') s,
    has_table_privilege('authenticated', 'public.saved_search_item_matches', 'SELECT') t,
    has_table_privilege('anon', 'public.saved_search_item_matches', 'SELECT') ta,
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.saved_search_item_matches'::regclass) rls`))[0];
  check(!acl.a && !acl.u && acl.s, `alert grants: anon ${acl.a}, authenticated ${acl.u}, service_role ${acl.s}`);
  check(!acl.t && !acl.ta && acl.rls, `the match rows: no member read (authenticated ${acl.t}, anon ${acl.ta}), RLS ${acl.rls}`);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
