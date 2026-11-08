#!/usr/bin/env node
/**
 * PGlite proof for 20261108185110_shops_digital_checkout.sql (Shops digital downloads slice 2, owner 11-08): buying a
 * download. The buyer's order is one line, the same buyer fee; the paid page goes straight to 'accepted'; the capture
 * tells the buyer it is ready and opens the download; 72 hours later with no problem the sweep makes it final and
 * queues the shop's payout; a problem report holds both; no member cancel refunds a download; a refund ends access;
 * a download never takes an order-day slot.
 *
 *   node src/test/pglite/shopsDigitalCheckout.pglite.mjs                     # ALL PASS (the migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsDigitalCheckout.pglite.mjs  # RED
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/shopsDigitalCheckout.pglite.mjs
 *
 * Setup is shopsDigitalDownloads.pglite.mjs's (shops chain + slice 1), plus the order columns and tables the money
 * path reads, as named beside them below.
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
const SLICE1_DIGITAL = readFileSync(`${MIG_DIR}20261108182917_shops_digital_downloads.sql`, "utf8");
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}20261108185110_shops_digital_checkout.sql`, "utf8");
// Option words pass the item word check (Builder 4, 11-06): WORDS_MIGRATION=skip leaves section 8b RED.
const WORDS = readFileSync(`${MIG_DIR}20261106194243_shops_option_words_checked.sql`, "utf8");
// Review follow-ups (11-06): option words hold an item the same way a live title edit does. FOLLOWUP_MIGRATION=skip
// leaves section 8c RED.
const FOLLOWUP = readFileSync(`${MIG_DIR}20261106201659_shops_option_words_hold_like_edits.sql`, "utf8");
const SLICE1 = readFileSync(`${MIG_DIR}20261017061155_shops_profiles.sql`, "utf8");
const SWITCHES = readFileSync(`${MIG_DIR}20261012031120_hidden_feature_switches.sql`, "utf8");
const DECLUTTER = readFileSync(`${MIG_DIR}20261014193955_declutter_foundation.sql`, "utf8");

/** The newest CREATE [OR REPLACE] FUNCTION public.<name>( statement in the migrations, any dollar tag. */
function newestDefinition(name, before = "20261106165310") {
  let found = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && !x.startsWith("20261017061155") && !x.startsWith("20261017061157") && !x.startsWith("20261018164442") && x < before).sort()) {
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
// Main as it stands before this migration: variants, the option word check and its follow-up.
await db.exec(VARIANTS);
await db.exec(WORDS);
await db.exec(FOLLOWUP);
// storage.buckets as prod has it (the columns this migration writes).
await db.exec(`CREATE TABLE IF NOT EXISTS storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false,
  file_size_limit bigint, allowed_mime_types text[]);`);
await db.exec(SLICE1_DIGITAL);
// What the money path reads that the slices above do not create (prod-shaped; each named with its migration):
//   shop_orders columns from 20261018211820 (handed_over_at), 20261105181603 (setup fee), 20261106180902 (delivery,
//   handover_mode); profiles' setup-fee flag; the shop_orders status and close_reason lists from 20261019071055;
//   shop_handovers + shop_payouts with the columns and CHECKs these functions touch (20261018211820, 20261105190034).
// Stubbed, and said so: declutter_consume_fee_debt (no debt), shop_order_unaccounted_hand_refund (none),
//   shop_delivery_open_task (no Helpr delivery on a download), is_test_subject (reads test_accounts, as prod's does).
await db.exec(`
  ALTER TABLE public.shop_orders ADD COLUMN IF NOT EXISTS handed_over_at timestamptz,
    ADD COLUMN IF NOT EXISTS setup_fee_cents integer NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS setup_fee_state text,
    ADD COLUMN IF NOT EXISTS fulfillment text NOT NULL DEFAULT 'pickup', ADD COLUMN IF NOT EXISTS delivery_cents integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS handover_mode text NOT NULL DEFAULT 'in_person';
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS onboarding_fee_paid boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS onboarding_fee_charged_at timestamptz;
  ALTER TABLE public.shop_orders DROP CONSTRAINT IF EXISTS shop_orders_close_reason_check;
  ALTER TABLE public.shop_orders ADD CONSTRAINT shop_orders_close_reason_check CHECK (close_reason IS NULL OR close_reason IN (
    'superseded', 'page_unpaid', 'no_answer', 'declined', 'buyer_cancelled', 'hold_lost', 'capture_gave_up', 'order_closed',
    'amount_mismatch', 'day_full', 'handed_over', 'buyer_cancelled_free', 'buyer_cancelled_late', 'buyer_no_show',
    'shop_cancelled', 'no_ready_photo', 'admin_refunded', 'refunded_by_hand'));
  ALTER TABLE public.shop_orders DROP CONSTRAINT IF EXISTS shop_orders_status_check;
  ALTER TABLE public.shop_orders ADD CONSTRAINT shop_orders_status_check CHECK (status IN (
    'awaiting_hold', 'held', 'accepted', 'declined', 'expired', 'cancelled', 'superseded', 'handed_over', 'refunded', 'partially_refunded'));
  ALTER TABLE public.shop_orders DROP CONSTRAINT IF EXISTS shop_orders_captured_is_accepted;
  ALTER TABLE public.shop_orders ADD CONSTRAINT shop_orders_captured_is_accepted CHECK (
    captured_at IS NULL OR status IN ('accepted', 'handed_over', 'refunded', 'partially_refunded', 'cancelled'));
  CREATE TABLE public.shop_handovers (order_id uuid PRIMARY KEY REFERENCES public.shop_orders(id), ready_photo_path text, ready_at timestamptz,
    shop_confirmed_at timestamptz, confirmed_at timestamptz, confirmed_how text CHECK (confirmed_how IS NULL OR confirmed_how IN ('buyer', 'auto', 'admin')),
    problem_at timestamptz, problem_note text CHECK (problem_note IS NULL OR char_length(problem_note) <= 500),
    held_nudged_at timestamptz, held_admin_at timestamptz, is_seed boolean NOT NULL DEFAULT false,
    CONSTRAINT shop_handovers_confirmed CHECK ((confirmed_at IS NULL) = (confirmed_how IS NULL)),
    CONSTRAINT shop_handovers_problem CHECK ((problem_at IS NULL) = (problem_note IS NULL)));
  CREATE TABLE public.shop_payouts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL UNIQUE REFERENCES public.shop_orders(id),
    items_cents integer NOT NULL CHECK (items_cents > 0), debt_cents integer NOT NULL CHECK (debt_cents >= 0), amount_cents integer NOT NULL,
    status text NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'nothing_due')), attempts integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT shop_payouts_amount CHECK (amount_cents = items_cents - debt_cents AND amount_cents >= 0));
  CREATE TABLE IF NOT EXISTS public.shop_cottage_sales (owner_id uuid, source_ref uuid UNIQUE, amount_cents integer, is_seed boolean);
  CREATE FUNCTION public.declutter_consume_fee_debt(p_seller uuid, p_ref text, p_max int) RETURNS int LANGUAGE sql AS $s$ SELECT 0 $s$;
  CREATE FUNCTION public.shop_order_unaccounted_hand_refund(p_order uuid) RETURNS boolean LANGUAGE sql STABLE AS $s$ SELECT false $s$;
  CREATE FUNCTION public.shop_delivery_open_task(p_order uuid) RETURNS void LANGUAGE sql AS $s$ SELECT $s$;
  CREATE OR REPLACE FUNCTION public.is_test_subject(p uuid) RETURNS boolean LANGUAGE sql STABLE AS
    $s$ SELECT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p) $s$;`);
// The money bodies this migration restates, at their newest before it.
for (const name of ["shop_order_captured", "shop_handover_sweep", "shop_lock_open_charged_order"]) await db.exec(newestDefinition(name, "20261108185110").stmt);
const skip = process.env.NEW_MIGRATION === "skip";
if (!skip) for (let i = 0; i < 3; i++) await db.exec(MIGRATION);

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
const BUYER = FAN, BUYER2 = ADMIN2;

// --- set up: OWNER's shop, open Monday to Saturday (closed Sunday), three items as rows
const shopA = one(await member(OWNER, `SELECT public.shops_save_my_shop('Bayou Bakes', 'About us.', 'bakery', ARRAY['Lafayette'],
  'Broussard', false, 30.15, -91.96, true, false, NULL) AS id`));
if (typeof shopA !== "string") throw new Error(`setup: slice 1 did not open the shop: ${JSON.stringify(shopA)}`);
await member(OWNER, `SELECT public.shops_set_hours('[${[1, 2, 3, 4, 5, 6].map((d) => `{"weekday":${d},"opens":"08:00","closes":"17:00"}`).join(",")}]')`);
const shopB = one(await member(ADMIN, `SELECT public.shops_save_my_shop('Teche Crafts', 'About us.', 'crafts_gifts', ARRAY['Lafayette'],
  'New Iberia', false, 30.0, -91.82, true, false, NULL) AS id`));
const item = async (shop, owner, kind, subtype, title, price, lead, stock, status = "live") => one(await svc(`
  INSERT INTO public.shop_items (shop_id, owner_id, kind, subtype, status, title, price_cents, lead_time_days, stock_count, live_at)
  VALUES ('${shop}', '${owner}', '${kind}', '${subtype}', '${status}', '${title}', ${price}, ${lead}, ${stock}, now()) RETURNING id`));
const itemA = await item(shopA, OWNER, "home_food", "baked_goods", "Kolache dozen", 1800, 2, "NULL");
const itemB = await item(shopA, OWNER, "made", "candles", "Fig candle", 2500, 0, 3);
const itemDraft = await item(shopA, OWNER, "made", "crafts", "Draft thing", 1000, 0, "NULL", "draft");
const itemOther = await item(shopB, ADMIN, "made", "crafts", "Other shop thing", 1000, 0, "NULL");
// Ready dates: open days (Mon-Sat) at least 2 days out, and a Sunday.
const dates = await svc(`SELECT d::text AS d, extract(dow FROM d)::int AS dow FROM generate_series(
  (now() AT TIME ZONE 'America/Chicago')::date + 2, (now() AT TIME ZONE 'America/Chicago')::date + 20, interval '1 day') g(g), LATERAL (SELECT g::date AS d) x`);
const open = dates.filter((r) => r.dow !== 0).map((r) => r.d);
const sunday = dates.find((r) => r.dow === 0).d;
const [D1, D2, D3, D4, D5] = open;
const lines = (...ls) => `'${JSON.stringify(ls.map(([id, q]) => ({ item_id: id, quantity: q })))}'::jsonb`;
const request = (uid, ls, day, note = "") =>
  member(uid, `SELECT public.shops_request_order('${shopA}', ${ls}, '${day}', '${note}') AS r`);

// --- set up: a live download with one checked file in OWNER's shop
const dig = await item(shopA, OWNER, "digital", "digital_coloring", "Bayou coloring book", 1200, 0, "NULL");
await db.exec(`INSERT INTO public.shop_item_files (item_id, owner_id, storage_path, file_name, ext, byte_size, position, checked_at)
  VALUES ('${dig}', '${OWNER}', '${OWNER}/${dig}/00000000-0000-0000-0000-00000000f001.pdf', 'Bayou.pdf', 'pdf', 5000, 0, now())`);
const fileId = one(await svc(`SELECT id FROM public.shop_item_files WHERE item_id = '${dig}'`));
const buy = (uid, itemId = dig) => member(uid, `SELECT public.shops_request_digital_order('${itemId}') AS r`);
const mark = (cs, pi, total, tax = 0) => svc(`SELECT public.shop_digital_mark_paid('${cs}', '${pi}', ${total}, ${tax}, false) AS r`);
const path = async (uid) => one(await svc(`SELECT public.shop_digital_download_path('${fileId}', '${uid}')`));
const ord = async (id) => (await svc(`SELECT * FROM public.shop_orders WHERE id = '${id}'`))[0] ?? {};

// --- 1. the buyer's order
const r1 = one(await buy(BUYER));
const o1 = r1?.order_id ?? "00000000-0000-0000-0000-000000000000";
ok(typeof r1?.order_id === "string", `a buyer asks for a download (${JSON.stringify(r1)})`);
const row1 = await ord(o1);
ok(row1.is_digital === true && row1.items_cents === 1200 && row1.premium_cents === 130 && row1.total_cents === 1330,
  `one download, the same buyer fee 5% + 70c (${row1.items_cents}/${row1.premium_cents}/${row1.total_cents})`);
ok(one(await svc(`SELECT count(*)::int FROM public.shop_order_lines WHERE order_id = '${o1}' AND kind = 'digital' AND quantity = 1 AND tax_kind = 'digital_book'`)) === 1, "one line, quantity 1, its tax answer kept");
ok(refused(await buy(OWNER), /own_shop/), "the seller cannot buy their own download");
ok(refused(await buy(BUYER, itemB), /item_unavailable/, "55000"), "a made item cannot be bought as a download");
ok(refused(await buy(ORDINARY), /feature_disabled/, "42501"), "an ordinary account is refused by the Shops switch");
ok(refused(await buy(BANNED), /account_restricted/, "42501"), "a banned account is refused");

// --- 2. the paid page
await svc(`UPDATE public.shop_orders SET stripe_checkout_session_id = 'cs_test_d1' WHERE id = '${o1}'`);
const bad = one(await mark("cs_test_d1", "pi_d1", 999));
ok(bad?.result === "cancel_hold" && bad?.reason === "amount_mismatch", `a wrong total cancels the hold (${JSON.stringify(bad)})`);
const r2 = one(await buy(BUYER));
const o2 = r2?.order_id ?? "00000000-0000-0000-0000-000000000000";
await svc(`UPDATE public.shop_orders SET stripe_checkout_session_id = 'cs_test_d2' WHERE id = '${o2}'`);
const paid = one(await mark("cs_test_d2", "pi_d2", 1330 + 87, 87));
ok(paid?.result === "accepted", `the paid page goes straight to accepted, no shop answer needed (${JSON.stringify(paid)})`);
ok((await ord(o2)).status === "accepted" && (await ord(o2)).tax_cents === 87 && (await ord(o2)).total_cents === 1417, "tax and total recorded from the page");
ok(one(await mark("cs_test_d2", "pi_d2", 1417, 87))?.result === "already_accepted", "a redelivered event changes nothing");
ok(refused(await member(BUYER, `SELECT public.shop_digital_mark_paid('cs_test_d2', 'pi_d2', 1417, 87, false)`), /permission denied/), "members cannot mark a page paid");
ok(await path(BUYER) == null, "no download before the charge is taken");

// --- 3. the capture opens the download
const cap = one(await svc(`SELECT public.shop_order_captured('${o2}', 71) AS r`));
ok(cap?.result === "captured" && cap?.digital === true, `the capture is recorded (${JSON.stringify(cap)})`);
ok((await path(BUYER))?.storage_path?.endsWith(".pdf"), "the buyer may download from the moment of the charge");
const told = await svc(`SELECT title FROM public.notifications WHERE user_id = '${BUYER}' ORDER BY created_at DESC LIMIT 1`);
ok(Array.isArray(told) && told[0]?.title === "Your download is ready", `the buyer is told it is ready (${JSON.stringify(told)})`);
ok(refused(await buy(BUYER), /already_bought/, "22023"), "a second purchase of the same download is refused");
const files = await rows(BUYER, `SELECT file_name FROM public.shops_my_digital_files('${o2}')`);
ok(Array.isArray(files) && files.length === 1 && files[0].file_name === "Bayou.pdf", "the buyer's order lists the file names (never a path)");
const notMine = await rows(BUYER2, `SELECT file_name FROM public.shops_my_digital_files('${o2}')`);
ok(Array.isArray(notMine) && notMine.length === 0, "another member's call lists nothing");

// --- 4. no member cancel refunds a download; the admin's path still can
ok(refused(await svc(`SELECT public.shop_lock_open_charged_order('${o2}', false)`), /digital_not_cancellable/, "55000"), "buyer cancel, shop cancel and no-show are refused for a download");
ok(Array.isArray(await svc(`SELECT public.shop_lock_open_charged_order('${o2}', true)`)), "the admin refund's lock still opens it");

// --- 5. the day slots
ok(one(await svc(`SELECT public.shop_day_count('${OWNER}', public.shop_local_today(), ARRAY['held', 'accepted', 'handed_over'])`)) === 0, "a download takes no order-day slot");

// --- 6. 72 hours, then final and paid
ok(refused(await svc(`SELECT public.shop_digital_complete('${o2}')`), /too_soon/), "not final before 72 hours");
await svc(`UPDATE public.shop_orders SET captured_at = now() - interval '71 hours' WHERE id = '${o2}'`);
await svc(`SELECT public.shop_handover_sweep()`);
ok((await ord(o2)).status === "accepted", "the sweep leaves a download paid 71 hours ago");
await svc(`UPDATE public.shop_orders SET captured_at = now() - interval '73 hours' WHERE id = '${o2}'`);
const swept = one(await svc(`SELECT public.shop_handover_sweep() AS r`));
ok((await ord(o2)).status === "handed_over", `73 hours with no problem: final (${JSON.stringify(swept)})`);
const pay = (await svc(`SELECT status, amount_cents, next_attempt_at <= now() AS due FROM public.shop_payouts WHERE order_id = '${o2}'`))[0];
ok(pay?.status === "pending" && pay?.amount_cents === 1200 && pay?.due === true, `the shop's payout is queued for the items (${JSON.stringify(pay)})`);
ok((await path(BUYER))?.storage_path != null, "access never expires once final");
ok(one(await svc(`SELECT count(*)::int FROM public.notifications WHERE user_id = '${BUYER}' AND title LIKE 'Did you get%'`)) === 0, "the buyer is never asked if they picked up a download");

// --- 7. a problem report holds the payout; a refund ends access
const r3 = one(await buy(BUYER2));
const o3 = r3?.order_id ?? "00000000-0000-0000-0000-000000000000";
await svc(`UPDATE public.shop_orders SET stripe_checkout_session_id = 'cs_test_d3' WHERE id = '${o3}'`);
await mark("cs_test_d3", "pi_d3", 1330);
await svc(`SELECT public.shop_order_captured('${o3}', NULL)`);
const report = (uid, reason, note = "Pages 3 to 9 are blank.") => member(uid, `SELECT public.shops_report_digital_problem('${o3}', '${reason}', '${note}') AS r`);
ok(refused(await report(BUYER2, "changed_my_mind"), /invalid_reason/, "22023"), "only broken or not-as-described");
ok(refused(await report(BUYER, "broken"), /order_not_found/, "PT404"), "only the buyer of that order can report it");
ok(one(await report(BUYER2, "broken"))?.result === "reported", "the buyer reports a broken file");
await svc(`UPDATE public.shop_orders SET captured_at = now() - interval '80 hours' WHERE id = '${o3}'`);
await svc(`SELECT public.shop_handover_sweep()`);
ok((await ord(o3)).status === "accepted" && one(await svc(`SELECT count(*)::int FROM public.shop_payouts WHERE order_id = '${o3}'`)) === 0, "an open problem holds the finish and the payout");
ok(refused(await report(BUYER2, "broken"), /order_not_open/), "past 72 hours nothing more is reported here");
ok((await path(BUYER2))?.storage_path != null, "while it is decided the buyer can still download");
await svc(`UPDATE public.shop_orders SET status = 'refunded', close_reason = 'admin_refunded' WHERE id = '${o3}'`);
ok(await path(BUYER2) == null, "a refund ends the download");
const listAfter = await rows(BUYER2, `SELECT file_name FROM public.shops_my_digital_files('${o3}')`);
ok(Array.isArray(listAfter) && listAfter.length === 0, "and the order lists no files");

// --- 8. the "did you get it" nudges: a physical order still gets them, a download never does. Both orders belong to
//     ORDINARY (not a test account: the sweep skips test accounts, so a test buyer would prove nothing), written as
//     rows because ORDINARY is outside the Shops switch. Ready 5 days ago, charged 10 hours ago.
const placed = async (digital, pi) => one(await svc(`INSERT INTO public.shop_orders (buyer_id, seller_id, shop_id, ready_date, cancel_policy, items_cents, premium_cents, tax_cents, total_cents, status, stripe_payment_intent_id, held_at, accept_by, accepted_at, captured_at, is_digital)
  VALUES ('${ORDINARY}', '${ADMIN}', '${shopB}', current_date - 5, 'until_accept', 2500, 195, 0, 2695, 'accepted', '${pi}', now(), now(), now(), now() - interval '10 hours', ${digital}) RETURNING id`));
// The second shop's owner leaves the test list for this step, so neither side is a test account (restored after).
await svc(`DELETE FROM public.test_accounts WHERE user_id = '${ADMIN}'`);
const madeOrder = await placed(false, "pi_m1");
const digOrder = await placed(true, "pi_m2");
await svc(`DELETE FROM public.notifications`);
await svc(`SELECT public.shop_handover_sweep()`);
const nudged = await svc(`SELECT count(*)::int AS n FROM public.notifications WHERE user_id = '${ORDINARY}' AND title = 'Did you get your order?'`);
ok(Array.isArray(nudged) && nudged[0].n === 1, `exactly one nudge: the made order's, never the download's (${JSON.stringify(nudged)})`);
ok(Array.isArray(await svc(`SELECT public.shop_lock_open_charged_order('${madeOrder}', false)`)), "a made order's member cancel lock still opens");
await svc(`INSERT INTO public.test_accounts (user_id) VALUES ('${ADMIN}')`);
void digOrder;

// --- 9. grants
const g = await svc(`SELECT
  has_function_privilege('authenticated', 'public.shop_digital_mark_paid(text, text, integer, integer, boolean)', 'EXECUTE') AS a,
  has_function_privilege('authenticated', 'public.shop_digital_complete(uuid)', 'EXECUTE') AS b,
  has_function_privilege('anon', 'public.shops_request_digital_order(uuid)', 'EXECUTE') AS c,
  has_function_privilege('anon', 'public.shops_report_digital_problem(uuid, text, text)', 'EXECUTE') AS d,
  has_function_privilege('anon', 'public.shops_my_digital_files(uuid)', 'EXECUTE') AS e,
  has_function_privilege('authenticated', 'public.shops_request_digital_order(uuid)', 'EXECUTE') AS f`);
ok(Array.isArray(g) && !g[0].a && !g[0].b && !g[0].c && !g[0].d && !g[0].e && g[0].f, `service-only stays service-only; member RPCs are not anon (${JSON.stringify(g)})`);

console.log(`\n${pass} PASS, ${fail} FAIL${skip ? " (NEW_MIGRATION=skip)" : ""}`);
process.exit(fail === 0 ? 0 : 1);
