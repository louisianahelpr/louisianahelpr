#!/usr/bin/env node
/**
 * PGlite proof for 20261118055433_shops_same_day_after_closing.sql (Q2793 server half, Shops launch pass 2,
 * 2026-11-18): once the shop's last closing time today has passed in Louisiana, shops_request_order refuses today
 * (ready_date_too_soon); before closing, or for tomorrow, the order goes through.
 *
 *   node src/test/pglite/shopsSameDayAfterClosing.pglite.mjs                     # ALL PASS (the migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsSameDayAfterClosing.pglite.mjs  # RED: today is accepted after closing
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/shopsSameDayAfterClosing.pglite.mjs
 *
 * Clock: every case runs on a FIXED instant (src/test/pglite/lib/fixedClock.mjs): shop_local_today and
 * shop_closed_for_today are loaded with their clock reads pointed at the probe clock, so the proof never depends
 * on the hour CI runs. Setup is shopsItemVariants.pglite.mjs's (prod-shaped stubs, shops slices 1-2, orders, the
 * newest bodies, variants and its word follow-ups), whose shops_request_order is the body this migration restates.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const SLICE2 = readFileSync(`${MIG_DIR}20261017061157_shops_items.sql`, "utf8");
const CATEGORIES = readFileSync(`${MIG_DIR}20261017224153_shop_categories_v2.sql`, "utf8");
const ORDERS = readFileSync(`${MIG_DIR}20261018164442_shops_orders_checkout.sql`, "utf8");
const H8 = readFileSync(`${MIG_DIR}20261105235833_shops_every_category_sells.sql`, "utf8");
const VARIANTS = readFileSync(`${MIG_DIR}20261106165310_shops_item_variants.sql`, "utf8");
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}20261118055433_shops_same_day_after_closing.sql`, "utf8");
const { installClock, newestFunction, onFixedClock, setClock } = await import("./lib/fixedClock.mjs");
// Option words pass the item word check (Builder 4, 11-06): WORDS_MIGRATION=skip leaves section 8b RED.
const WORDS = readFileSync(process.env.WORDS_PATH ?? `${MIG_DIR}20261106194243_shops_option_words_checked.sql`, "utf8");
// Review follow-ups (11-06): option words hold an item the same way a live title edit does. FOLLOWUP_MIGRATION=skip
// leaves section 8c RED.
const FOLLOWUP = readFileSync(process.env.FOLLOWUP_PATH ?? `${MIG_DIR}20261106201659_shops_option_words_hold_like_edits.sql`, "utf8");
const SLICE1 = readFileSync(`${MIG_DIR}20261017061155_shops_profiles.sql`, "utf8");
const SWITCHES = readFileSync(`${MIG_DIR}20261012031120_hidden_feature_switches.sql`, "utf8");
const DECLUTTER = readFileSync(`${MIG_DIR}20261014193955_declutter_foundation.sql`, "utf8");

/** The newest CREATE [OR REPLACE] FUNCTION public.<name>( statement in the migrations, any dollar tag. */
function newestDefinition(name) {
  let found = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && !x.startsWith("20261017061155") && !x.startsWith("20261017061157") && !x.startsWith("20261018164442") && x < "20261106165310").sort()) {
    const sql = readFileSync(`${MIG_DIR}${f}`, "utf8");
    const re = new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.${name}\s*\(`, "gi");
    let m;
    while ((m = re.exec(sql))) {
      const as = /\bAS\s+(\$\w*\$)/g;
      as.lastIndex = m.index;
      const t = as.exec(sql);
      const end = sql.indexOf(t[1], t.index + t[0].length);
      found = { file: f, stmt: `${sql.slice(m.index, end + t[1].length)};` };
    }
  }
  if (!found) throw new Error(`no definition of ${name}`);
  return found;
}

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
GRANT USAGE ON SCHEMA auth, public, storage TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid, owner_id text, metadata jsonb);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT, DELETE ON storage.objects TO authenticated;
CREATE POLICY "public bucket read (prod: job-photos is public)" ON storage.objects FOR SELECT TO authenticated USING (true);
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
GRANT EXECUTE ON FUNCTION storage.foldername(text) TO anon, authenticated, service_role;
CREATE TABLE public.user_blocks (blocker_id uuid NOT NULL, blocked_id uuid NOT NULL);
CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE TYPE public.app_role AS ENUM ('admin', 'customer', 'helper');
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY, enrolled_at timestamptz NOT NULL DEFAULT now(), note text);
CREATE TABLE public.admin_audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admin_id uuid, action text NOT NULL,
  target_type text, target_id text, details jsonb, created_at timestamptz NOT NULL DEFAULT now());
-- prod's shape (pg_policies, 2026-10-17): RLS on, an admin-only INSERT and an
-- admin-only SELECT, no UPDATE or DELETE policy, every table privilege granted
-- to authenticated. So a member's UPDATE or DELETE reaches no row (the hold).
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can insert audit log" ON public.admin_audit_log FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can view audit log" ON public.admin_audit_log FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
GRANT ALL ON public.admin_audit_log TO authenticated;
CREATE TABLE public.profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE, is_seed boolean DEFAULT false,
  under_13_blocked_at timestamptz, /* prod 20261022002144: is_caller_banned() reads it */ stripe_account_id text, stripe_payouts_enabled boolean DEFAULT false, date_of_birth date,
  ban_status text DEFAULT 'active', auto_suspended_until timestamptz,
  idv_status text, stripe_identity_verified boolean NOT NULL DEFAULT false,
  email_verified boolean NOT NULL DEFAULT true, background_check_status text);
CREATE TABLE public.helper_credentials (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
  credential_type text NOT NULL, status text NOT NULL DEFAULT 'pending', expiration_date date, license_number text);
CREATE TABLE public.reviews (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, reviewer_id uuid, reviewee_id uuid NOT NULL,
  rating integer NOT NULL, status text NOT NULL DEFAULT 'published', feedback_visible_at timestamptz);
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid, helper_id uuid, status text NOT NULL,
  date_needed date, start_time time, helper_arrived_at timestamptz, revision_count integer DEFAULT 0, is_group_job boolean DEFAULT false,
  is_seed boolean DEFAULT false, cancelled_by uuid, cancellation_reason text); -- read by get_public_profile_stats (newest: 20261030015205, 20261031234653)
CREATE TABLE public.group_job_helpers (job_id uuid, helper_id uuid, helper_arrived_at timestamptz);
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text NOT NULL, handed_over_at timestamptz,
  is_seed boolean NOT NULL DEFAULT false); -- read by get_public_profile_stats (newest)
CREATE TABLE public.declutter_reviews (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL, reviewer_id uuid,
  reviewee_id uuid, reviewer_side text NOT NULL, stars smallint NOT NULL, is_seed boolean NOT NULL DEFAULT false,
  removed_at timestamptz); -- prod 20261102040000: get_public_profile_stats (newest) skips removed reviews
CREATE FUNCTION public.seed_hidden_from_caller() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE TABLE public.platform_settings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), feature_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz DEFAULT now());
INSERT INTO public.platform_settings (feature_flags) VALUES ('{}'::jsonb);
CREATE FUNCTION public.seed_review_hidden(uuid, uuid, uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
`;

const U = (n) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const OWNER = U(1), FAN = U(2), ORDINARY = U(3), MINOR = U(4), BANNED = U(5), STRUCK = U(6), NOPAYOUT = U(7), ADMIN = U(8), SEEDY = U(9), ADMIN2 = U(10);

const db = new PGlite();
await db.exec(SCHEMA);
for (const name of ["is_caller_banned", "member_under_18", "helper_award_block_reason", "contact_leak_reason",
  "are_users_blocked", "identity_is_verified", "seed_jobs_hidden_publicly"]) {
  await db.exec(newestDefinition(name).stmt);
}
await db.exec(`
  REVOKE ALL ON FUNCTION public.member_under_18(uuid) FROM PUBLIC, anon, authenticated;
  REVOKE ALL ON FUNCTION public.helper_award_block_reason(uuid) FROM PUBLIC, anon, authenticated;
  REVOKE ALL ON FUNCTION public.is_caller_banned() FROM PUBLIC, anon;
  REVOKE ALL ON FUNCTION public.contact_leak_reason(text) FROM PUBLIC, anon;
  REVOKE ALL ON FUNCTION public.seed_jobs_hidden_publicly() FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION public.seed_jobs_hidden_publicly() TO anon, authenticated, service_role;`);
await db.exec(SWITCHES);
await db.exec(DECLUTTER);
await db.exec(newestDefinition("declutter_area_label_problem").stmt);
await db.exec(newestDefinition("is_test_member").stmt); // 20261030015205: get_public_profile_stats (newest) calls it
// 20261105171508: get_public_profile_stats (newest) calls profile_review_same_person; stubbed false here (its own proof is publicProfileFull's PGlite run).
await db.exec("CREATE OR REPLACE FUNCTION public.profile_review_same_person(uuid, uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;");
await db.exec(newestDefinition("get_public_profile_stats").stmt);
await db.exec(SLICE1);
await db.exec(`
  INSERT INTO auth.users (id) SELECT ('00000000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid FROM generate_series(1, 10) g;
  INSERT INTO public.profiles (user_id, stripe_account_id, stripe_payouts_enabled, date_of_birth, ban_status, is_seed) VALUES
    ('${OWNER}',    'acct_s', true,  '1990-01-01', 'active', false),
    ('${FAN}',      'acct_b', true,  '1991-01-01', 'active', false),
    ('${ORDINARY}', 'acct_o', true,  '1992-01-01', 'active', false),
    ('${MINOR}',    'acct_m', true,  (now() - interval '15 years')::date, 'active', false),
    ('${BANNED}',   'acct_x', true,  '1990-01-01', 'banned', false),
    ('${STRUCK}',   'acct_t', true,  '1990-01-01', 'active', false),
    ('${NOPAYOUT}', NULL,     false, '1990-01-01', 'active', false),
    ('${ADMIN}',    'acct_a', true,  '1980-01-01', 'active', false),
    ('${SEEDY}',    'acct_e', true,  '1990-01-01', 'active', true),
    ('${ADMIN2}',   'acct_c', true,  '1981-01-01', 'active', false);
  INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin'), ('${ADMIN2}', 'admin');
  INSERT INTO public.test_accounts (user_id) VALUES ('${OWNER}'), ('${FAN}'), ('${MINOR}'), ('${BANNED}'), ('${STRUCK}'), ('${NOPAYOUT}'), ('${ADMIN}'), ('${SEEDY}'), ('${ADMIN2}');
  INSERT INTO public.declutter_strikes (user_id, offender_side, reason, expires_at)
    SELECT '${STRUCK}', 'seller', 'seller_no_show', now() + interval '1 year' FROM generate_series(1, 3);
  UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'shops';`);

let pass = 0;
let fail = 0;
const ok = (cond, label) => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
};

// --- what M1 builds on, once (as prod will have it)
await db.exec(`CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
  type text NOT NULL, title text NOT NULL, message text NOT NULL, link text, created_at timestamptz NOT NULL DEFAULT now());`);
// Stubbed, and said so, exactly as shopsRefunds.pglite.mjs and shopsPickupAddress.pglite.mjs: declutter_notify_strict
// (the newest declutter_notify wraps it, 20261028162048) writes the bell row only, and log_cron_defect records a
// swallowed notice. Without them every shop_mark_order_held call failed on a missing log_cron_defect.
await db.exec(`CREATE TABLE public.cron_defects (fn text, ref text, msg text);
CREATE FUNCTION public.log_cron_defect(f text, r text, m text, c jsonb DEFAULT NULL) RETURNS void LANGUAGE sql AS $f$ INSERT INTO public.cron_defects VALUES (f, r, m) $f$;
CREATE FUNCTION public.declutter_notify_strict(p_user uuid, p_type text, p_title text, p_message text, p_link text,
  p_other uuid DEFAULT NULL) RETURNS void LANGUAGE sql AS $f$
  INSERT INTO public.notifications (user_id, type, title, message, link) VALUES (p_user, p_type, p_title, p_message, p_link) $f$;`);
for (const name of ["declutter_buyer_fee_cents", "declutter_card_fee_estimate", "declutter_notify"]) {
  await db.exec(newestDefinition(name).stmt);
}
await db.exec(SLICE2);
await db.exec(CATEGORIES);

await db.exec(ORDERS);
// Per-section strikes (20261018164444): STRIKES=skip leaves Shops on Declutter's count (RED for section 16).
const STRIKES_SQL = readFileSync(process.env.STRIKES_PATH ?? `${MIG_DIR}20261018164444_shops_own_strike_count.sql`, "utf8");
await db.exec(STRIKES_SQL);
// What main has since (the newest bodies before this migration): live at once (H3), the caps (M15), and the newest
// order, publish and item-field bodies with the helpers they call.
for (const name of ["shop_owner_sell_block_reason", "shop_visible_to", "shop_active_strike_count", "shop_day_count",
  "shop_local_today", "shop_line_unit_cents", "shops_assert_owner_eligible", "shops_lock_own_item",
  "shops_check_item_fields", "shops_publish_item", "shops_request_order"]) {
  // A helper defined only in the slices loaded above has no later body: it is already the newest.
  let def = null;
  try { def = newestDefinition(name); } catch { /* only in slices 1-2 or orders: already loaded */ }
  if (def) await db.exec(def.stmt);
}

// H8 as main has it, then the newest stock bodies this migration restates.
await db.exec(H8);
for (const name of ["shops_accept_order", "shop_return_stock"]) await db.exec(newestDefinition(name).stmt);
for (let i = 0; i < 3; i++) await db.exec(VARIANTS);
for (let i = 0; i < 3; i++) await db.exec(WORDS);
for (let i = 0; i < 3; i++) await db.exec(FOLLOWUP);
const skip = process.env.NEW_MIGRATION === "skip";
if (!skip) for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
// The fixed clock: today and "closed for today" read the probe instant, not the machine's.
await installClock(db);
await db.exec(onFixedClock(newestFunction("shop_local_today").stmt));
/** shop_closed_for_today as the migration under test (or its planted copy) defines it. */
function helperFromMigration() {
  const at = MIGRATION.search(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.shop_closed_for_today\s*\(/i);
  if (at < 0) return null;
  const tag = /\bAS\s+(\$\w*\$)/i.exec(MIGRATION.slice(at));
  const close = MIGRATION.indexOf(tag[1], at + tag.index + tag[0].length);
  return MIGRATION.slice(at, MIGRATION.indexOf(";", close + tag[1].length) + 1);
}
const helper = skip ? null : helperFromMigration();
if (helper) await db.exec(onFixedClock(helper));

async function as(role, uid, sql) {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${uid ?? ""}'; SET ROLE ${role};`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  }
}
const svc = async (sql) => {
  try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e), code: e.code }; }
};
const refused = (r, re, code) => !Array.isArray(r) && re.test(r.error) && (code === undefined || r.code === code);
const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);
const member = (uid, sql) => as("authenticated", uid, sql);
const rows = async (uid, sql) => {
  const r = await member(uid, sql);
  return Array.isArray(r) ? r : null;
};
// --- set up: OWNER's shop, open Monday to Saturday 8 AM to 5 PM; a lead-0 item. 2026-11-18 is a Wednesday.
const shopA = one(await member(OWNER, `SELECT public.shops_save_my_shop('Bayou Bakes', 'About us.', 'bakery', ARRAY['Lafayette'],
  'Broussard', false, 30.15, -91.96, true, false, NULL) AS id`));
if (typeof shopA !== "string") throw new Error(`setup: slice 1 did not open the shop: ${JSON.stringify(shopA)}`);
const setHours = (extra = []) => member(OWNER, `SELECT public.shops_set_hours('[${[
  ...[1, 2, 3, 4, 5, 6].map((d) => `{"weekday":${d},"opens":"08:00","closes":"17:00"}`), ...extra].join(",")}]')`);
await setHours();
const itemB = one(await svc(`
  INSERT INTO public.shop_items (shop_id, owner_id, kind, subtype, status, title, price_cents, lead_time_days, stock_count, live_at)
  VALUES ('${shopA}', '${OWNER}', 'made', 'candles', 'live', 'Fig candle', 2500, 0, NULL, now()) RETURNING id`));
const lines = (...ls) => `'${JSON.stringify(ls.map(([id, q]) => ({ item_id: id, quantity: q })))}'::jsonb`;
const request = (uid, day) => member(uid, `SELECT public.shops_request_order('${shopA}', ${lines([itemB, 1])}, '${day}', '') AS r`);
const closedNow = async () => one(await svc(`SELECT public.shop_closed_for_today('${shopA}')`));
const TODAY = "2026-11-18", TOMORROW = "2026-11-19";

// 1. Before closing (4:59 PM in Louisiana = 22:59Z in November): today is fine.
await setClock(db, "2026-11-18T22:59:00Z");
ok(one(await svc(`SELECT public.shop_local_today()::text`)) === TODAY, "setup: the fixed clock's Louisiana day is Wednesday Nov 18");
{ const r = await request(FAN, TODAY); ok(Array.isArray(r), "before 5 PM a same-day order goes through"); }

// 2. At and after closing: today is refused with the closed-for-today hint; tomorrow still goes through.
await setClock(db, "2026-11-18T23:00:00Z");
ok(skip || (await closedNow()) === true, "at 5 PM the shop counts as closed for today");
const late = await request(ADMIN2, TODAY);
ok(refused(late, /ready_date_too_soon/, "22023"), "at 5 PM a same-day order is refused (ready_date_too_soon)");
await setClock(db, "2026-11-19T03:30:00Z"); // 9:30 PM Wednesday in Louisiana
ok(refused(await request(ADMIN2, TODAY), /ready_date_too_soon/, "22023"), "at 9:30 PM a same-day order is refused");
ok(Array.isArray(await request(ADMIN2, TOMORROW)), "at 9:30 PM an order for tomorrow goes through");

// 3. Split hours: a second window later in the day keeps today open until it closes.
await setHours(['{"weekday":3,"opens":"18:00","closes":"20:00"}']);
await setClock(db, "2026-11-18T23:30:00Z"); // 5:30 PM, between the windows
ok(skip || (await closedNow()) === false, "between two windows the shop is not closed for today");
ok(Array.isArray(await request(ADMIN2, TODAY)), "between two windows a same-day order goes through");
await setClock(db, "2026-11-19T02:00:00Z"); // 8:00 PM, the last window closed
ok(refused(await request(ADMIN2, TODAY), /ready_date_too_soon/, "22023"), "after the last window closes a same-day order is refused");
await setHours();

// 4. A day with no hours is not "closed for today" here (shop_closed_that_day already refuses it).
await setClock(db, "2026-11-22T23:30:00Z"); // Sunday 5:30 PM
ok(skip || (await closedNow()) === false, "a day with no hours row does not count as closed for today");
ok(refused(await request(ADMIN2, "2026-11-22"), /shop_closed_that_day/), "a Sunday order is still refused as a closed day");

// 5. The helper is not callable by anon.
if (!skip) ok(refused(await as("anon", null, `SELECT public.shop_closed_for_today('${shopA}')`), /permission denied/), "anon cannot call shop_closed_for_today");

console.log(`\n${pass} PASS, ${fail} FAIL${skip ? " (NEW_MIGRATION=skip)" : ""}`);
process.exit(fail ? 1 : 0);
