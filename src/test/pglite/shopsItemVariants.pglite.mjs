#!/usr/bin/env node
/**
 * PGlite proof for 20261106165310_shops_item_variants.sql (Shops variants, owner answer 4, 11-05): an item has up to
 * 3 option lists and one price and stock per combination; an order freezes the combination, its label and its price;
 * accept takes the combination's stock and a cancel or failed capture gives it back; the item row follows.
 *
 *   node src/test/pglite/shopsItemVariants.pglite.mjs                     # ALL PASS (the migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsItemVariants.pglite.mjs  # RED: no variants
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/shopsItemVariants.pglite.mjs
 *
 * Setup is shopsEveryCategorySells.pglite.mjs's (prod-shaped stubs, Declutter's foundation, shops slices 1-2, orders,
 * the per-section strikes, the newest bodies), then H8 (20261105235833) as main has it.
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
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}20261106165310_shops_item_variants.sql`, "utf8");
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
const skip = process.env.NEW_MIGRATION === "skip";
if (!skip) for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
if (!skip) for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
const skipWords = skip || process.env.WORDS_MIGRATION === "skip";
if (!skipWords) for (let i = 0; i < 3; i++) await db.exec(WORDS);
const skipFollowup = skipWords || process.env.FOLLOWUP_MIGRATION === "skip";
if (!skipFollowup) for (let i = 0; i < 3; i++) await db.exec(FOLLOWUP);

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



// The variant ids the owner's set returns are read back by their values.
const setVariants = (uid, itemId, names, variants) => member(uid,
  `SELECT public.shops_set_item_variants('${itemId}', ARRAY[${names.map((n) => `'${n}'`).join(",")}]::text[], '${JSON.stringify(variants)}'::jsonb) AS r`);
const variantId = async (itemId, values) => one(await svc(`SELECT id FROM public.shop_item_variants
  WHERE item_id = '${itemId}' AND option_values = ARRAY[${values.map((v) => `'${v}'`).join(",")}]::text[]`));
const itemRow = async (id) => (await svc(`SELECT price_cents, stock_count, option_names FROM public.shop_items WHERE id = '${id}'`))[0] ?? {};
const vRow = async (id) => (await svc(`SELECT price_cents, stock_count, active FROM public.shop_item_variants WHERE id = '${id}'`))[0] ?? {};
const vlines = (...ls) => `'${JSON.stringify(ls.map(([id, v, q]) => ({ item_id: id, variant_id: v, quantity: q })))}'::jsonb`;
const holdIt = (order) => svc(`UPDATE public.shop_orders SET status = 'held', held_at = now(), stripe_payment_intent_id = 'pi_' || replace(id::text, '-', ''), accept_by = now() + interval '1 day' WHERE id = '${order}'`);

// --- 1. the owner sets two option lists with a price and a stock per combination
const candle = await item(shopA, OWNER, "made", "candles", "Soy candle", 1500, 0, "NULL");
const set1 = await setVariants(OWNER, candle, ["Size", "Scent"], [
  { values: ["Small", "Fig"], price_cents: 1500, stock_count: 3 },
  { values: ["Small", "Vanilla"], price_cents: 1500, stock_count: 2 },
  { values: ["Large", "Fig"], price_cents: 2400, stock_count: 1 },
  { values: ["Large", "Vanilla"], price_cents: 2600, stock_count: null, active: false },
]);
ok(one(set1)?.variant_count === 4, `the owner saves 2 lists and 4 combinations (${JSON.stringify(set1)})`);
const smallFig = await variantId(candle, ["Small", "Fig"]);
const largeFig = await variantId(candle, ["Large", "Fig"]);
const largeVan = await variantId(candle, ["Large", "Vanilla"]);
let ir = await itemRow(candle);
ok(ir.price_cents === 1500 && ir.stock_count === 6, `the item shows the lowest active price and the active stock sum (${JSON.stringify(ir)})`);
ok(JSON.stringify(ir.option_names) === JSON.stringify(["Size", "Scent"]), "the item keeps its option list names in order");

// --- 2. who may set them, and the limits
ok(refused(await setVariants(BUYER, candle, ["Size"], [{ values: ["S"], price_cents: 100 }]), /not_found|not_owner|item_not_found/), "another member cannot set a shop's options");
ok(refused(await setVariants(ORDINARY, candle, ["Size"], [{ values: ["S"], price_cents: 100 }]), /feature_disabled/, "42501"), "the switch still gates it");
ok(refused(await as("anon", null, `SELECT public.shops_set_item_variants('${candle}', ARRAY['Size'], '[]'::jsonb)`), /permission denied/), "anon cannot call the setter");
ok(refused(await setVariants(OWNER, candle, ["A", "B", "C", "D"], [{ values: ["1", "2", "3", "4"], price_cents: 100 }]), /too_many_option_lists/), "at most 3 option lists");
ok(refused(await setVariants(OWNER, candle, ["Size", "size"], [{ values: ["S", "M"], price_cents: 100 }]), /invalid_option_name/), "two lists with the same name are refused");
ok(refused(await setVariants(OWNER, candle, ["Size"], [{ values: ["S", "M"], price_cents: 100 }]), /invalid_variants/), "a combination needs exactly one value per list");
ok(refused(await setVariants(OWNER, candle, ["Size"], [{ values: ["S"], price_cents: 99 }]), /invalid_price/), "a combination under $1 is refused");
ok(refused(await setVariants(OWNER, candle, ["Size"], [{ values: ["S"], price_cents: 500001 }]), /invalid_price/), "a combination over $5,000 is refused");
ok(refused(await setVariants(OWNER, candle, ["Size"], [{ values: ["S"], price_cents: 500, stock_count: 10000 }]), /invalid_stock/), "stock over 9999 is refused");
ok(refused(await setVariants(OWNER, candle, ["Size"], [{ values: ["S"], price_cents: 500 }, { values: [" S "], price_cents: 600 }]), /invalid_variants/), "the same combination twice is refused");
ok(refused(await setVariants(OWNER, candle, ["Size"], [{ values: ["S"], price_cents: 500, active: false }]), /invalid_variants/), "at least one combination must be offered");
ok(refused(await setVariants(OWNER, candle, ["Size"], Array.from({ length: 11 }, (_, i) => ({ values: [`v${i}`], price_cents: 500 }))), /too_many_option_values/), "at most 10 choices in a list");
ok(refused(await setVariants(OWNER, candle, ["Size"], [{ values: ["Call 337-555-1234"], price_cents: 500 }]), /phone|contact/i), "contact details in an option are refused");
ok(refused(await setVariants(OWNER, candle, [], [{ values: [], price_cents: 500 }]), /invalid_variants/), "combinations without a list are refused");
ir = await itemRow(candle);
ok(ir.price_cents === 1500 && ir.stock_count === 6 && JSON.stringify(ir.option_names) === JSON.stringify(["Size", "Scent"]), "a refused save changes nothing");

// --- 3. the read
const mine = await member(OWNER, `SELECT public.shops_item_variants('${shopA}') AS r`);
const mineItem = (one(mine) ?? []).find((x) => x.item_id === candle);
ok(mineItem?.variants?.length === 4, "the owner reads all 4 combinations, the switched-off one too");
const theirs = await member(BUYER, `SELECT public.shops_item_variants('${shopA}') AS r`);
const theirItem = (one(theirs) ?? []).find((x) => x.item_id === candle);
ok(theirItem?.variants?.length === 3 && theirItem.variants.every((v) => v.active), "a visitor reads only the 3 offered combinations");
ok(refused(await as("anon", null, `SELECT public.shops_item_variants('${shopA}')`), /permission denied/), "anon cannot read combinations");
ok(refused(await member(ORDINARY, `SELECT public.shops_item_variants('${shopA}')`), /feature_disabled/), "the read is behind the switch");

// --- 4. ordering: the combination's price, label and stock
const plainR = await request(BUYER, lines([candle, 1]), D1);
ok(refused(plainR, /variant_required/), `an item with options needs a pick (${JSON.stringify(plainR)})`);
ok(refused(await request(BUYER, vlines([candle, largeVan, 1]), D1), /variant_not_available/), "a switched-off combination cannot be ordered");
ok(refused(await request(BUYER, vlines([itemB, smallFig, 1]), D1), /variant_not_available/), "a combination of another item cannot be named");
ok(refused(await request(BUYER, vlines([candle, largeFig, 2]), D1), /out_of_stock/), "a combination's own stock is checked (1 left, 2 asked)");
const r1 = await request(BUYER, vlines([candle, smallFig, 2], [candle, largeFig, 1]), D1);
const o1 = one(r1)?.order_id ?? "00000000-0000-0000-0000-000000000000";
ok(one(r1)?.items_cents === 2 * 1500 + 2400, `two combinations of one item in one order, each at its own price (${JSON.stringify(r1)})`);
const l1 = await svc(`SELECT variant_id, variant_label, title, unit_cents, line_cents FROM public.shop_order_lines WHERE order_id = '${o1}' ORDER BY unit_cents`);
ok(Array.isArray(l1) && l1.length === 2 && l1[1].unit_cents === 2400 && l1[1].variant_id === largeFig, "the line freezes the combination and its price");
ok(Array.isArray(l1) && l1[1].variant_label === "Large / Fig" && l1[1].title === "Soy candle (Large / Fig)", "the line keeps the label and a labelled title");
ok(refused(await request(BUYER2, vlines([candle, smallFig, 1], [candle, smallFig, 1]), D2), /invalid_order_lines/), "the same combination twice in one order is refused");
// A price change after the order never moves it.
await setVariants(OWNER, candle, ["Size", "Scent"], [
  { values: ["Small", "Fig"], price_cents: 1900, stock_count: 3 },
  { values: ["Small", "Vanilla"], price_cents: 1500, stock_count: 2 },
  { values: ["Large", "Fig"], price_cents: 2400, stock_count: 1 },
  { values: ["Large", "Vanilla"], price_cents: 2600, stock_count: null, active: false },
]);
ok(one(await svc(`SELECT unit_cents FROM public.shop_order_lines WHERE order_id = '${o1}' AND variant_id = '${smallFig}'`)) === 1500, "an order keeps the price it was asked at");
ok(await variantId(candle, ["Small", "Fig"]) === smallFig, "a kept combination keeps its id");

// --- 5. accepting takes the combination's stock; the item follows
await holdIt(o1);
const acc = await member(OWNER, `SELECT public.shops_accept_order('${o1}') AS r`);
ok(one(acc)?.result === "accepted", `the shop accepts (${JSON.stringify(acc)})`);
ok((await vRow(smallFig)).stock_count === 1 && (await vRow(largeFig)).stock_count === 0, "each combination's stock goes down by its line");
ir = await itemRow(candle);
ok(ir.stock_count === 3, `the item's stock is the active sum again (1 + 2 + 0 = 3, got ${ir.stock_count})`);
ok(ir.price_cents === 1500, "the item still shows the lowest active price");
ok(refused(await request(BUYER2, vlines([candle, largeFig, 1]), D2), /out_of_stock/), "a sold-out combination cannot be asked for");
// A second held order the stock cannot cover is refused at accept.
const r2 = await request(BUYER2, vlines([candle, smallFig, 1]), D2);
const o2 = one(r2)?.order_id ?? "00000000-0000-0000-0000-000000000000";
await svc(`UPDATE public.shop_item_variants SET stock_count = 0 WHERE id = '${smallFig}'`);
await holdIt(o2);
ok(refused(await member(OWNER, `SELECT public.shops_accept_order('${o2}')`), /out_of_stock/, "55000"), "accept refuses when the combination ran out since the order");
await svc(`UPDATE public.shop_item_variants SET stock_count = 1 WHERE id = '${smallFig}'`);

// --- 6. stock comes back on a cancel, and on a failed capture
await svc(`SELECT public.shop_return_stock('${o1}')`);
ok((await vRow(smallFig)).stock_count === 3 && (await vRow(largeFig)).stock_count === 1, "shop_return_stock gives each combination its stock back");
ok((await itemRow(candle)).stock_count === 6, "the item's stock follows (3 + 2 + 1)");
await svc(`SELECT public.shop_return_stock('${o1}')`); // undo-proof setup for the capture case
await svc(`UPDATE public.shop_item_variants SET stock_count = CASE id WHEN '${smallFig}' THEN 1 WHEN '${largeFig}' THEN 0 ELSE stock_count END WHERE item_id = '${candle}'`);
const cf = await svc(`SELECT public.shop_order_capture_failed('${o1}', 'card_declined', true) AS r`);
ok(one(cf)?.result === "cancelled", `a final capture failure cancels the order (${JSON.stringify(cf)})`);
ok((await vRow(smallFig)).stock_count === 3 && (await vRow(largeFig)).stock_count === 1, "a failed capture gives each combination its stock back");

// --- 7. a plain item is untouched
const r3 = await request(BUYER2, lines([itemB, 1]), D3);
const o3 = one(r3)?.order_id ?? "00000000-0000-0000-0000-000000000000";
ok(one(r3)?.items_cents === 2500, `a plain item still orders at its own price (${JSON.stringify(r3)})`);
ok(refused(await request(BUYER2, vlines([itemB, smallFig, 1]), D4), /variant_not_available/, "55000"), "a plain item takes no variant (the order's own check)");
ok(refused(await svc(`SELECT public.shop_line_unit_cents('${itemB}', '${smallFig}')`), /variant_not_available/), "the price read refuses another item's combination too");
ok(refused(await svc(`SELECT public.shop_line_unit_cents('${candle}', NULL)`), /variant_required/), "the price read never prices an item with options without a pick");
const stockB = (await itemRow(itemB)).stock_count;
await holdIt(o3);
await member(OWNER, `SELECT public.shops_accept_order('${o3}')`);
ok((await itemRow(itemB)).stock_count === stockB - 1, "a plain item's stock still goes down on accept");
await svc(`SELECT public.shop_return_stock('${o3}')`);
ok((await itemRow(itemB)).stock_count === stockB, "and comes back on a cancel");

// --- 8. removing combinations: one an order names is only switched off
const rm = await setVariants(OWNER, candle, ["Size", "Scent"], [{ values: ["Small", "Vanilla"], price_cents: 1500, stock_count: 2 }]);
ok(one(rm)?.variant_count === 1, "the owner keeps one combination");
ok((await vRow(smallFig)).active === false, "a combination an order names stays, switched off");
ok(one(await svc(`SELECT count(*)::int FROM public.shop_item_variants WHERE id = '${largeVan}'`)) === 0, "a combination no order names is removed");
ir = await itemRow(candle);
ok(ir.price_cents === 1500 && ir.stock_count === 2, `the item follows its one combination (${JSON.stringify(ir)})`);
// The owner's direct price and stock writes cannot drift from the combinations.
await svc(`UPDATE public.shop_items SET price_cents = 9900, stock_count = 50 WHERE id = '${candle}'`);
ir = await itemRow(candle);
ok(ir.price_cents === 1500 && ir.stock_count === 2, "a direct item write is overridden by the combinations");

// --- 8b. the option lists and choices pass the same word check as the title (owner rule: live at once, only a
// failed automatic check goes to an admin; recommendation logged 11-06)
const withPrivate = async (id) => { await svc(`INSERT INTO public.shop_item_private (item_id, owner_id) VALUES ('${id}', '${OWNER}')`); return id; };
const wordsRow = async (id) => (await svc(`SELECT i.status, p.text_flag_reason AS flag FROM public.shop_items i
  JOIN public.shop_item_private p ON p.item_id = i.id WHERE i.id = '${id}'`))[0] ?? {};
const gift = await withPrivate(await item(shopA, OWNER, "made", "crafts", "Gift box", 2000, 0, "NULL"));
const clean = await setVariants(OWNER, gift, ["Flavor"], [{ values: ["Pecan"], price_cents: 2000 }, { values: ["Plain"], price_cents: 1800 }]);
ok(one(clean)?.held_for_review === false && (await wordsRow(gift)).status === "live" && (await wordsRow(gift)).flag === null,
  `clean options keep a live item live (${JSON.stringify(clean)} ${JSON.stringify(await wordsRow(gift))})`);
const boozy = await setVariants(OWNER, gift, ["Flavor"], [{ values: ["Bourbon pecan"], price_cents: 2000 }, { values: ["Plain"], price_cents: 1800 }]);
let wr = await wordsRow(gift);
ok(one(boozy)?.held_for_review === true && wr.status === "pending_review" && /alcohol/i.test(wr.flag ?? ""),
  `an option choice that fails the word check sends a live item to an admin (${JSON.stringify(boozy)} ${JSON.stringify(wr)})`);
const gift2 = await withPrivate(await item(shopA, OWNER, "made", "crafts", "Mug", 2000, 0, "NULL"));
await setVariants(OWNER, gift2, ["Vape flavor"], [{ values: ["Mint"], price_cents: 2000 }]);
wr = await wordsRow(gift2);
ok(wr.status === "pending_review" && /vape|tobacco/i.test(wr.flag ?? ""), `an option list NAME is checked too (${JSON.stringify(wr)})`);
// A switched-off choice is not shown to buyers, so it is not what the check reads.
const gift3 = await withPrivate(await item(shopA, OWNER, "made", "crafts", "Tote", 2000, 0, "NULL"));
await setVariants(OWNER, gift3, ["Print"], [{ values: ["Wine glass"], price_cents: 2000, active: false }, { values: ["Fleur"], price_cents: 2000 }]);
ok((await wordsRow(gift3)).status === "live", "a switched-off choice does not hold the item");
// A draft is checked when it is listed: shops_publish_item reads the options too.
const draft2 = await withPrivate(await item(shopA, OWNER, "made", "crafts", "Draft box", 2000, 0, "NULL", "draft"));
await setVariants(OWNER, draft2, ["Fill"], [{ values: ["Whiskey truffles"], price_cents: 2000 }]);
ok((await wordsRow(draft2)).status === "draft", "setting options on a draft leaves it a draft");
for (let i = 0; i < 3; i++) await svc(`INSERT INTO public.shop_item_photos (item_id, owner_id, storage_path, position)
  VALUES ('${draft2}', '${OWNER}', '${OWNER}/shop-items/${draft2}/p${i}.jpg', ${i})`);
await svc(`INSERT INTO public.shop_item_attestations (item_id, owner_id, statements)
  SELECT '${draft2}', '${OWNER}', array_agg(DISTINCT y ORDER BY y) FROM unnest(public.shop_item_required_statements('made', 'crafts')) y`);
const pub = await member(OWNER, `SELECT public.shops_publish_item('${draft2}') AS r`);
wr = await wordsRow(draft2);
ok(one(pub) === "pending_review" && /alcohol/i.test(wr.flag ?? ""), `listing a draft whose option fails the check waits for an admin (${JSON.stringify(pub)} ${JSON.stringify(wr)})`);
ok(refused(await member(OWNER, `SELECT public.shop_item_option_words('${gift}')`), /permission denied/), "members cannot call the option-words helper");

// --- 8c. review follow-ups (11-06): the same rule as a live title edit (shops_update_item)
const holdRow = async (id) => (await svc(`SELECT i.status, i.live_at, i.submitted_at, i.admin_approved_at,
  p.ai_checked_at, p.ai_flag_reason, p.text_flag_reason AS flag
  FROM public.shop_items i JOIN public.shop_item_private p ON p.item_id = i.id WHERE i.id = '${id}'`))[0] ?? {};
const OLD = "2026-01-02 03:04:05+00";
const aged = async (id, approved) => {
  await svc(`UPDATE public.shop_items SET live_at = '${OLD}', submitted_at = '${OLD}',
    admin_approved_at = ${approved ? `'${OLD}'` : "NULL"} WHERE id = '${id}'`);
  await svc(`UPDATE public.shop_item_private SET ai_checked_at = '${OLD}', ai_flag_reason = NULL WHERE item_id = '${id}'`);
};
// 1. New option words that hold a live item: submitted_at moves to now, live_at and the AI verdict clear.
const basket = await withPrivate(await item(shopA, OWNER, "made", "crafts", "Basket", 2000, 0, "NULL"));
await setVariants(OWNER, basket, ["Fill"], [{ values: ["Pralines"], price_cents: 2000 }]);
await aged(basket, false);
const held = await setVariants(OWNER, basket, ["Fill"], [{ values: ["Rum pralines"], price_cents: 2000 }]);
let hr = await holdRow(basket);
ok(one(held)?.held_for_review === true && hr.status === "pending_review", `new option words that fail the check hold a live item (${JSON.stringify(held)})`);
ok(hr.live_at === null, `a held item is no longer live: live_at clears (${JSON.stringify(hr)})`);
ok(hr.submitted_at instanceof Date && hr.submitted_at.getTime() > new Date(OLD).getTime(), `a held item's submitted_at moves to now (${JSON.stringify(hr)})`);
ok(hr.ai_checked_at === null && hr.ai_flag_reason === null, `the AI verdict on the old words is cleared (${JSON.stringify(hr)})`);
// Clean new words keep a live item live with its live_at, and still clear the old AI verdict and approval.
const crate = await withPrivate(await item(shopA, OWNER, "made", "crafts", "Crate", 2000, 0, "NULL"));
await setVariants(OWNER, crate, ["Wood"], [{ values: ["Pine"], price_cents: 2000 }]);
await aged(crate, true);
await setVariants(OWNER, crate, ["Wood"], [{ values: ["Cypress"], price_cents: 2000 }]);
hr = await holdRow(crate);
ok(hr.status === "live" && hr.live_at instanceof Date && hr.live_at.getTime() === new Date(OLD).getTime(),
  `clean new words keep a live item live, live_at unchanged (${JSON.stringify(hr)})`);
ok(hr.ai_checked_at === null && hr.admin_approved_at === null, `new words clear the AI verdict and the approval (${JSON.stringify(hr)})`);
// 2. An item an admin approved with its words is not re-held by a price-only option save.
const approved = await withPrivate(await item(shopA, OWNER, "made", "crafts", "Cake stand", 2000, 0, "NULL"));
await setVariants(OWNER, approved, ["Finish"], [{ values: ["Bourbon brown"], price_cents: 2000 }]);
await svc(`UPDATE public.shop_items SET status = 'live', live_at = '${OLD}', admin_approved_at = '${OLD}' WHERE id = '${approved}'`);
const priceOnly = await setVariants(OWNER, approved, ["Finish"], [{ values: ["Bourbon brown"], price_cents: 2600, stock_count: 4 }]);
hr = await holdRow(approved);
ok(one(priceOnly)?.held_for_review === false && hr.status === "live" && hr.admin_approved_at instanceof Date,
  `a price-only option save leaves an admin-approved item live and approved (${JSON.stringify(priceOnly)} ${JSON.stringify(hr)})`);
const reworded = await setVariants(OWNER, approved, ["Finish"], [{ values: ["Bourbon brown"], price_cents: 2600 }, { values: ["Whiskey oak"], price_cents: 2600 }]);
ok(one(reworded)?.held_for_review === true && (await holdRow(approved)).status === "pending_review",
  `new option words on an approved item run the check again (${JSON.stringify(reworded)})`);
// A live item with new words waits after a rejection in the last 30 days, as a live title edit does.
const tray = await withPrivate(await item(shopA, OWNER, "made", "crafts", "Tray", 2000, 0, "NULL"));
await setVariants(OWNER, tray, ["Color"], [{ values: ["Blue"], price_cents: 2000 }]);
const rej = one(await svc(`INSERT INTO public.admin_audit_log (admin_id, action, details)
  VALUES ('${ADMIN}', 'shop_item_rejected', jsonb_build_object('owner_id', '${OWNER}')) RETURNING id`));
await setVariants(OWNER, tray, ["Color"], [{ values: ["Green"], price_cents: 2000 }]);
ok((await holdRow(tray)).status === "pending_review", "after a recent rejection, new option words on a live item wait for an admin");
await svc(`DELETE FROM public.admin_audit_log WHERE id = '${rej}'`);
// Lead nit (11-06): an item already waiting for an admin keeps the reasons it was held for when its words change.
const jar = await withPrivate(await item(shopA, OWNER, "made", "crafts", "Jar", 2000, 0, "NULL", "pending_review"));
await svc(`UPDATE public.shop_item_private SET text_flag_reason = 'Mentions alcohol (not allowed in Shops).',
  ai_checked_at = '${OLD}', ai_flag_reason = 'A photo shows a bottle' WHERE item_id = '${jar}'`);
await setVariants(OWNER, jar, ["Lid"], [{ values: ["Copper"], price_cents: 2000 }]);
hr = await holdRow(jar);
ok(hr.status === "pending_review" && /alcohol/i.test(hr.flag ?? ""), `a waiting item keeps its word flag when clean option words are saved (${JSON.stringify(hr)})`);
ok(hr.ai_flag_reason === "A photo shows a bottle" && hr.ai_checked_at instanceof Date, `a waiting item keeps its AI photo flag (${JSON.stringify(hr)})`);
await setVariants(OWNER, jar, ["Lid"], [{ values: ["Vape cap"], price_cents: 2000 }]);
hr = await holdRow(jar);
ok(/vape|tobacco/i.test(hr.flag ?? ""), `a new word flag on a waiting item shows the newest reason (${JSON.stringify(hr)})`);
ok(hr.ai_flag_reason === "A photo shows a bottle", "and the AI photo flag stays");

// --- 9. grants and seed
const gr = await svc(`SELECT has_table_privilege('authenticated', 'public.shop_item_variants', 'SELECT') AS a,
  has_table_privilege('anon', 'public.shop_item_variants', 'SELECT') AS b,
  has_function_privilege('authenticated', 'public.shop_line_unit_cents(uuid, uuid)', 'EXECUTE') AS c,
  has_function_privilege('authenticated', 'public.shop_return_stock(uuid)', 'EXECUTE') AS d`);
ok(Array.isArray(gr) && !gr[0].a && !gr[0].b && !gr[0].c && !gr[0].d, "the table and the price and stock helpers are not open to members or anon");
await svc(`UPDATE public.shop_items SET is_seed = true WHERE id = '${candle}'`);
await setVariants(OWNER, candle, ["Size", "Scent"], [{ values: ["Small", "Vanilla"], price_cents: 1500, stock_count: 2 }, { values: ["Tiny", "Vanilla"], price_cents: 900, stock_count: 1 }]);
ok((await svc(`SELECT is_seed FROM public.shop_item_variants WHERE item_id = '${candle}' AND option_values[1] = 'Tiny'`))[0]?.is_seed === true, "a test item's combination is seed data");
// The item is deleted: its combinations go with it; the order line keeps its frozen label.
await svc(`DELETE FROM public.shop_order_lines WHERE item_id = '${candle}' AND order_id <> '${o1}'`);
const del = await svc(`DELETE FROM public.shop_items WHERE id = '${candle}' RETURNING id`);
ok(Array.isArray(del) && del.length === 1 && one(await svc(`SELECT count(*)::int FROM public.shop_item_variants WHERE item_id = '${candle}'`)) === 0, `deleting the item purges its combinations (${JSON.stringify(del)})`);
ok(one(await svc(`SELECT variant_label FROM public.shop_order_lines WHERE order_id = '${o1}' AND unit_cents = 2400`)) === "Large / Fig", "the order line keeps its label after the purge");

console.log(`\n${pass} PASS, ${fail} FAIL${skip ? " (NEW_MIGRATION=skip)" : skipWords ? " (WORDS_MIGRATION=skip)" : skipFollowup ? " (FOLLOWUP_MIGRATION=skip)" : ""}`);
process.exit(fail === 0 ? 0 : 1);
