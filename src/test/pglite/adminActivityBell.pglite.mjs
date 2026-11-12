#!/usr/bin/env node
/**
 * PGlite proof for 20261112061000 (owner via the lead, 11-12): the admin bell gets a short notice for every real
 * member activity (Declutter, Jobs, Shops, reports), type admin_activity (bell only: push and email switches default
 * OFF), never for a test subject (actor or other party), never for an admin's own action, one per actor per kind per
 * 10 minutes (collapsed in place), and a failing notice never fails the member's action.
 *
 *   node src/test/pglite/adminActivityBell.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/adminActivityBell.pglite.mjs # RED
 *   MUTANT=<name> node ...                                                # each must FAIL (see MUTANTS)
 *
 * World: cut-down tables carrying the columns the triggers read. member_display_name is read from its file
 * (20261021131322). Stubbed, and said so: auth.uid() unused; is_test_subject = profiles.is_seed OR an email ending
 * @mailinator.com (the real one also reads test_accounts and reserved domains; its own proof is
 * adminAlertsSkipTestAccounts.pglite.mjs); has_role from user_roles.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const THIS = readdirSync(MIG_DIR).find((f) => f.endsWith("_admin_activity_bell.sql"));
if (!THIS) throw new Error("migration not found");
function fnFrom(file, head) {
  const t = readFileSync(MIG_DIR + file, "utf8");
  const s = t.indexOf(head);
  if (s < 0) throw new Error(`${head} not in ${file}`);
  const tag = t.slice(s).match(/\nAS (\$[a-z_]*\$)/)[1];
  const open = t.indexOf(`\nAS ${tag}`, s);
  return t.slice(s, t.indexOf(`${tag};`, open + tag.length + 4) + tag.length + 1);
}
const displayName = fnFrom("20261021131322_member_names_first_and_initial.sql", "CREATE OR REPLACE FUNCTION public.member_display_name(");

const MUTANTS = {
  noTestSkip: ["  IF public.is_test_subject(p_actor) OR (p_other IS NOT NULL AND public.is_test_subject(p_other)) THEN", "  IF false THEN"],
  noOtherSkip: ["  IF public.is_test_subject(p_actor) OR (p_other IS NOT NULL AND public.is_test_subject(p_other)) THEN", "  IF public.is_test_subject(p_actor) THEN"],
  noAdminSkip: ["  IF public.has_role(p_actor, 'admin') THEN\n    RETURN 'admin';", "  IF false THEN\n    RETURN 'admin';"],
  noCollapse: ["  IF FOUND AND v_last.sent_at > now() - interval '10 minutes' THEN", "  IF false THEN"],
  alertType: ["  SELECT ur.user_id, p_title, p_message, 'admin_activity', p_link, p_actor", "  SELECT ur.user_id, p_title, p_message, 'admin_alert', p_link, p_actor"],
  draftRings: ["  IF NEW.status = 'live' AND NOT coalesce(NEW.is_seed, false)\n     AND (TG_OP = 'INSERT' OR OLD.status IN ('draft', 'pending_review')) THEN", "  IF NOT coalesce(NEW.is_seed, false) THEN"],
  noCatch: ["EXCEPTION WHEN OTHERS THEN\n  RAISE WARNING 'admin_activity_on_declutter_item: %', SQLERRM;\n  RETURN NULL;\n", ""],
  pushOn: ["ADD COLUMN IF NOT EXISTS admin_activity boolean NOT NULL DEFAULT false;", "ADD COLUMN IF NOT EXISTS admin_activity boolean NOT NULL DEFAULT true;"],
};
let mig = readFileSync(MIG_DIR + THIS, "utf8");
const MUTANT = process.env.MUTANT ?? "";
if (MUTANT) {
  const m = MUTANTS[MUTANT];
  if (!m || mig.split(m[0]).length !== 2) throw new Error(`mutant ${MUTANT} did not apply`);
  mig = mig.replace(m[0], m[1]);
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `11111111-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const SARAH = U(1), BEN = U(2), OWNER = U(3), SEED = U(4), MAIL = U(5), BOOM = U(6);
const I = (n) => `22222222-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const O = (n) => `33333333-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;

const db = await PGlite.create();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text, is_seed boolean NOT NULL DEFAULT false);
  CREATE TABLE public.user_roles (id uuid DEFAULT gen_random_uuid(), user_id uuid, role text);
  CREATE FUNCTION public.has_role(p uuid, r text) RETURNS boolean LANGUAGE sql STABLE AS
    $f$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p AND role = r) $f$;
  -- BOOM's test check throws: the trigger must swallow it and the member's write must still land.
  CREATE FUNCTION public.is_test_subject(p uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $f$
  BEGIN
    IF p = '${BOOM}' THEN RAISE EXCEPTION 'boom'; END IF;
    RETURN p IS NOT NULL AND (EXISTS (SELECT 1 FROM public.profiles WHERE user_id = p AND is_seed)
      OR EXISTS (SELECT 1 FROM auth.users WHERE id = p AND email LIKE '%@mailinator.com'));
  END $f$;
  ${displayName}
  CREATE TABLE public.notification_preferences (user_id uuid PRIMARY KEY, push_enabled boolean DEFAULT true);
  CREATE TABLE public.notification_type_pref_map (type text PRIMARY KEY, pref_column text, description text);
  CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text, message text,
    type text, link text, actor_id uuid, read boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT notifications_type_check CHECK (type IN ('info', 'admin_alert')));
  CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, seller_id uuid, title text, status text, price_cents integer,
    current_price_cents integer, is_seed boolean NOT NULL DEFAULT false);
  CREATE TABLE public.declutter_wanted (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, what text,
    max_price_cents integer, is_seed boolean NOT NULL DEFAULT false);
  CREATE TABLE public.declutter_offers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, buyer_id uuid, seller_id uuid,
    amount_cents integer, is_seed boolean NOT NULL DEFAULT false);
  CREATE TABLE public.declutter_swap_offers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, buyer_id uuid,
    seller_id uuid, is_seed boolean NOT NULL DEFAULT false);
  CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, buyer_id uuid, seller_id uuid, status text, paid_at timestamptz,
    total_cents integer, is_seed boolean NOT NULL DEFAULT false);
  CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, item_title text,
    order_id uuid, created_at timestamptz DEFAULT now());
  CREATE TABLE public.declutter_free_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, requester_id uuid,
    seller_id uuid, status text DEFAULT 'open');
  CREATE TABLE public.declutter_refund_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid,
    is_seed boolean NOT NULL DEFAULT false);
  CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, title text, budget numeric, status text,
    is_seed boolean NOT NULL DEFAULT false, is_auto_created boolean DEFAULT false);
  CREATE TABLE public.applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid);
  CREATE TABLE public.shops (id uuid PRIMARY KEY, name text);
  CREATE TABLE public.shop_orders (id uuid PRIMARY KEY, shop_id uuid, buyer_id uuid, seller_id uuid, held_at timestamptz,
    total_cents integer, is_seed boolean NOT NULL DEFAULT false);
  CREATE TABLE public.reports (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reporter_id uuid, reported_type text, reason text);
  INSERT INTO auth.users VALUES ('${SARAH}', 's@x.com'), ('${BEN}', 'b@x.com'), ('${OWNER}', 'o@x.com'),
    ('${SEED}', 'seed@x.com'), ('${MAIL}', 'audit1@mailinator.com'), ('${BOOM}', 'boom@x.com');
  INSERT INTO public.profiles VALUES ('${SARAH}', 'Sarah Smith', false), ('${BEN}', 'Ben Lee', false),
    ('${OWNER}', 'Owner Person', false), ('${SEED}', 'SEED Journey', true), ('${MAIL}', 'Audit Throwaway', false),
    ('${BOOM}', 'Boom Bah', false);
  INSERT INTO public.user_roles (user_id, role) VALUES ('${OWNER}', 'admin');
  INSERT INTO public.shops VALUES ('44444444-0000-0000-0000-000000000001', 'Kaci''s Candles');
`);

const runs = process.env.NEW_MIGRATION === "skip" ? 0 : 3;
let applyError = null;
for (let i = 0; i < runs; i++) {
  try { await db.exec(mig); } catch (e) { applyError = String(e.message ?? e); break; }
}
check(applyError === null, `applied ${THIS} x${runs} -> ${applyError ?? "ok"}`);

const bell = async () => (await db.query(`SELECT title, message, type, link FROM public.notifications WHERE user_id = '${OWNER}' ORDER BY created_at, title`)).rows;
const clear = async () => db.exec(`DELETE FROM public.notifications; DELETE FROM public.admin_activity_last;`).catch(() => {});
const run = async (sql) => { try { await db.exec(sql); return "ok"; } catch (e) { return String(e.message ?? e); } };
const one = async (sql, title, re, label) => {
  await clear();
  const r = await run(sql);
  const b = await bell();
  const hit = b.find((n) => n.title === title);
  check(r === "ok" && b.length === 1 && hit && hit.type === "admin_activity" && re.test(hit.message), `${label} -> ${r === "ok" ? JSON.stringify(b.map((n) => n.message)) : r}`);
  return hit;
};
const none = async (sql, label) => {
  await clear();
  const r = await run(sql);
  const b = await bell();
  check(r === "ok" && b.length === 0, `${label} -> ${r === "ok" ? JSON.stringify(b.map((n) => n.message)) : r}`);
};

// Declutter.
await none(`INSERT INTO public.declutter_items VALUES ('${I(1)}', '${SARAH}', 'Brown Loveseat', 'draft', 4000, 4000)`, "a draft rings nobody");
const pub = await one(`UPDATE public.declutter_items SET status = 'live' WHERE id = '${I(1)}'`, "New listing", /^Sarah S\. listed Brown Loveseat · \$40$/, "publishing a draft: 'Sarah S. listed Brown Loveseat · $40'");
check(pub?.link === `/declutter/item/${I(1)}`, `the listing notice opens the item -> ${pub?.link}`);
await none(`UPDATE public.declutter_items SET status = 'paused' WHERE id = '${I(1)}'; UPDATE public.declutter_items SET status = 'live' WHERE id = '${I(1)}'`, "un-pausing is not a new listing");
await one(`INSERT INTO public.declutter_items VALUES ('${I(2)}', '${SARAH}', 'Lamp', 'live', 0, 0)`, "New Free item", /^Sarah S\. listed Lamp · Free$/, "a Free item");
await none(`INSERT INTO public.declutter_items VALUES ('${I(3)}', '${SEED}', 'Seed chair', 'live', 500, 500)`, "a seed seller's listing rings nobody");
await none(`INSERT INTO public.declutter_items VALUES ('${I(4)}', '${MAIL}', 'Audit chair', 'live', 500, 500)`, "a fixture-email (unmarked test) seller rings nobody");
await none(`INSERT INTO public.declutter_items VALUES ('${I(5)}', '${OWNER}', 'Owner lamp', 'live', 500, 500)`, "the admin's own listing rings nobody");
await none(`INSERT INTO public.declutter_items (id, seller_id, title, status, price_cents, is_seed) VALUES ('${I(6)}', '${SARAH}', 'x', 'live', 500, true)`, "an is_seed row rings nobody");
// Flood: 5 listings in a row -> one notice, rewritten.
await clear();
for (let n = 10; n < 15; n++) await run(`INSERT INTO public.declutter_items VALUES ('${I(n)}', '${SARAH}', 'Item ${n}', 'live', 1000, 1000)`);
const flood = await bell();
check(flood.length === 1 && flood[0].message === "Sarah S. listed 5 items", `5 listings in 10 minutes collapse into one -> ${JSON.stringify(flood.map((n) => n.message))}`);
await db.exec(`UPDATE public.admin_activity_last SET sent_at = now() - interval '11 minutes'`).catch(() => {});
await run(`INSERT INTO public.declutter_items VALUES ('${I(20)}', '${SARAH}', 'Rug', 'live', 2500, 2500)`);
check((await bell()).length === 2, "after 10 minutes a new notice is a new row");
// A failing notice never fails the member's write.
await clear();
const boom = await run(`INSERT INTO public.declutter_items VALUES ('${I(21)}', '${BOOM}', 'Boom', 'live', 100, 100)`);
const landed = (await db.query(`SELECT count(*)::int AS n FROM public.declutter_items WHERE id = '${I(21)}'`)).rows[0].n;
check(boom === "ok" && landed === 1, `a notice that throws never fails the listing -> ${boom}, rows ${landed}`);

await one(`INSERT INTO public.declutter_wanted (user_id, what, max_price_cents) VALUES ('${BEN}', 'a crib', 5000)`, "New Wanted post", /^Ben L\. is looking for a crib · up to \$50$/, "a Wanted post");
await one(`INSERT INTO public.declutter_offers (item_id, buyer_id, seller_id, amount_cents) VALUES ('${I(1)}', '${BEN}', '${SARAH}', 3000)`, "New offer", /^Ben L\. offered \$30 for Brown Loveseat$/, "an offer");
await none(`INSERT INTO public.declutter_offers (item_id, buyer_id, seller_id, amount_cents) VALUES ('${I(1)}', '${BEN}', '${SEED}', 3000)`, "an offer to a seed seller rings nobody (the other party)");
await one(`INSERT INTO public.declutter_swap_offers (item_id, buyer_id, seller_id) VALUES ('${I(1)}', '${BEN}', '${SARAH}')`, "New trade offer", /^Ben L\. offered a trade for Brown Loveseat$/, "a trade offer");
await one(`INSERT INTO public.declutter_orders VALUES ('${O(1)}', '${BEN}', '${SARAH}', 'awaiting_payment', NULL, 385);
           INSERT INTO public.declutter_cart_items (item_id, item_title, order_id) VALUES ('${I(2)}', 'Lamp', '${O(1)}')`, "Checkout started", /^Ben L\. started checkout for (Lamp|a Declutter order)/, "a checkout started");
await one(`UPDATE public.declutter_orders SET paid_at = now(), status = 'paid' WHERE id = '${O(1)}'`, "Order paid", /^Ben L\. paid \$3\.85 for Lamp$/, "an order paid: 'Ben L. paid $3.85 for Lamp'");
await one(`UPDATE public.declutter_orders SET status = 'handed_over' WHERE id = '${O(1)}'`, "Order handed over", /^Sarah S\. handed over Lamp to Ben L\.$/, "an order handed over");
await run(`INSERT INTO public.declutter_orders VALUES ('${O(2)}', '${BEN}', '${SARAH}', 'paid', now(), 900)`);
await one(`UPDATE public.declutter_orders SET status = 'refunded' WHERE id = '${O(2)}'`, "Order cancelled", /^The order for a Declutter order \(Ben L\. from Sarah S\.\) was cancelled$/, "a paid order cancelled");
await one(`INSERT INTO public.declutter_refund_requests (order_id) VALUES ('${O(1)}')`, "Refund requested", /^Ben L\. asked for a refund on Lamp$/, "a refund request");
await none(`INSERT INTO public.declutter_orders VALUES ('${O(3)}', '${SEED}', '${SARAH}', 'awaiting_payment', NULL, 100)`, "a seed buyer's checkout rings nobody");
await one(`INSERT INTO public.declutter_free_requests (item_id, requester_id, seller_id) VALUES ('${I(2)}', '${BEN}', '${SARAH}')`, "Free item asked for", /^Ben L\. asked for Lamp$/, "a Free item asked for");
await one(`UPDATE public.declutter_free_requests SET status = 'picked' WHERE item_id = '${I(2)}'`, "Free item given", /^Sarah S\. picked Ben L\. for Lamp$/, "a Free asker picked");

// Jobs.
await one(`INSERT INTO public.jobs VALUES ('${O(10)}', '${SARAH}', NULL, 'Mow the lawn', 60, 'open')`, "New job", /^Sarah S\. posted Mow the lawn · \$60$/, "a job posted");
check((await bell())[0]?.link === `/admin?view=jobs&job=${O(10)}`, "the job notice opens the admin job view");
await none(`INSERT INTO public.jobs (id, customer_id, title, budget, status, is_auto_created) VALUES ('${O(11)}', '${SARAH}', 'Visit 2', 60, 'open', true)`, "an auto-created repeat visit rings nobody");
await one(`INSERT INTO public.applications (job_id, helper_id) VALUES ('${O(10)}', '${BEN}')`, "New application", /^Ben L\. applied to Mow the lawn$/, "an application");
await one(`UPDATE public.jobs SET status = 'accepted', helper_id = '${BEN}' WHERE id = '${O(10)}'`, "Helpr hired", /^Sarah S\. hired Ben L\. for Mow the lawn$/, "a hire");
await one(`UPDATE public.jobs SET status = 'completed' WHERE id = '${O(10)}'`, "Job done", /^Mow the lawn is done/, "a job done");
await one(`INSERT INTO public.jobs VALUES ('${O(12)}', '${BEN}', NULL, 'Paint', 100, 'open'); UPDATE public.admin_activity_last SET sent_at = now() - interval '1 hour';
           UPDATE public.jobs SET status = 'cancelled' WHERE id = '${O(12)}'; DELETE FROM public.notifications WHERE title = 'New job'`, "Job cancelled", /^Paint \(Ben L\.\) was cancelled$/, "a job cancelled");
await none(`INSERT INTO public.jobs VALUES ('${O(13)}', '${SEED}', NULL, 'Seed job', 10, 'open')`, "a seed poster's job rings nobody");

// Shops and reports.
await one(`INSERT INTO public.shop_orders VALUES ('${O(20)}', '44444444-0000-0000-0000-000000000001', '${BEN}', '${SARAH}', NULL, 1250);
           UPDATE public.shop_orders SET held_at = now() WHERE id = '${O(20)}'`, "New Shops order", /^Ben L\. ordered from Kaci's Candles · \$12\.50$/, "a Shops order");
await one(`INSERT INTO public.reports (reporter_id, reported_type, reason) VALUES ('${BEN}', 'declutter_item', 'Counterfeit')`, "New report", /^Ben L\. reported a declutter item · Counterfeit$/, "a report");
await none(`INSERT INTO public.reports (reporter_id, reported_type, reason) VALUES ('${MAIL}', 'user', 'x')`, "a test reporter rings nobody");

// Bell only: the type is admin_activity, its push switch and email switch default OFF.
const pref = (await db.query(`SELECT pref_column FROM public.notification_type_pref_map WHERE type = 'admin_activity'`)).rows[0];
await db.exec(`INSERT INTO public.notification_preferences (user_id) VALUES ('${OWNER}') ON CONFLICT DO NOTHING`);
const p = await db.query(`SELECT admin_activity, email_admin_activity FROM public.notification_preferences WHERE user_id = '${OWNER}'`).then((r) => r.rows[0], () => ({}));
check(pref?.pref_column === "admin_activity" && p.admin_activity === false && p.email_admin_activity === false, `push and email are off by default (bell only) -> ${JSON.stringify({ pref, p })}`);
await clear();
await run(`INSERT INTO public.reports (reporter_id, reported_type, reason) VALUES ('${SARAH}', 'user', 'x')`);
const types = (await db.query(`SELECT DISTINCT type FROM public.notifications`)).rows.map((r) => r.type);
check(types.length === 1 && types[0] === "admin_activity", `every notice is admin_activity, never the Slack-paged admin_alert -> ${types}`);
const g = (await db.query(`SELECT has_function_privilege('authenticated', 'public.admin_activity_notice(uuid, uuid, text, text, text, text, text)', 'EXECUTE') AS auth,
  has_function_privilege('anon', 'public.admin_activity_notice(uuid, uuid, text, text, text, text, text)', 'EXECUTE') AS anon`).then((r) => r.rows[0], () => ({})));
check(g.auth === false && g.anon === false, `no member may call the helper -> ${JSON.stringify(g)}`);

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
