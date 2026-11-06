#!/usr/bin/env node
/**
 * PGlite proof for 20261105235833_shops_every_category_sells.sql (Shops H8, owner answer 1, 11-05): a service or
 * rental shop lists what it sells, with a price, and it can be ordered; a taxed service's order line keeps its tax
 * answer; inflatables and off-list kinds still wait or are refused.
 *
 *   node src/test/pglite/shopsEveryCategorySells.pglite.mjs                     # ALL PASS (the migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsEveryCategorySells.pglite.mjs  # RED: services and rentals refused
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/shopsEveryCategorySells.pglite.mjs
 *
 * Setup is shopsOrders.pglite.mjs's (prod-shaped stubs, Declutter's foundation, shops slices 1-2, orders and the
 * per-section strikes), then the newest bodies before this migration (newestDefinition, any dollar tag).
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const SLICE2 = readFileSync(`${MIG_DIR}20261017061157_shops_items.sql`, "utf8");
const CATEGORIES = readFileSync(`${MIG_DIR}20261017224153_shop_categories_v2.sql`, "utf8");
const ORDERS = readFileSync(`${MIG_DIR}20261018164442_shops_orders_checkout.sql`, "utf8");
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}20261105235833_shops_every_category_sells.sql`, "utf8");
const SLICE1 = readFileSync(`${MIG_DIR}20261017061155_shops_profiles.sql`, "utf8");
const SWITCHES = readFileSync(`${MIG_DIR}20261012031120_hidden_feature_switches.sql`, "utf8");
const DECLUTTER = readFileSync(`${MIG_DIR}20261014193955_declutter_foundation.sql`, "utf8");

/** The newest CREATE [OR REPLACE] FUNCTION public.<name>( statement in the migrations, any dollar tag. */
function newestDefinition(name) {
  let found = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && !x.startsWith("20261017061155") && !x.startsWith("20261017061157") && !x.startsWith("20261018164442") && x < "20261105235833").sort()) {
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


// --- 1. the item fields: services and rentals are kinds that sell (owner answer 1), the $5,000 cap stays
const fields = (kind, sub, price = 5000) => svc(`SELECT public.shops_check_item_fields('${kind}', '${sub}', 'Gutter cleaning', 'Both sides.', ${price}, 2, NULL)`);
ok(Array.isArray(await fields("service", "home_service")), "a service item with a service type passes the field check");
ok(Array.isArray(await fields("rental", "party_rental")), "a rental item with a rental type passes the field check (no rental_not_available)");
ok(Array.isArray(await fields("service", "item_repair", 500000)), "a service may cost up to $5,000 (the caps body kept)");
ok(refused(await fields("service", "home_service", 500001), /invalid_price/, "22023"), "over $5,000 is still refused");
ok(refused(await fields("rental", "item_repair"), /invalid_subtype/, "22023"), "a service type on a rental is refused");
ok(refused(await fields("auction", "home_service"), /invalid_kind/, "22023"), "a kind off the list is still refused");
ok(one(await svc(`SELECT count(*)::int FROM public.shop_item_subtypes WHERE kind IN ('service', 'rental')`)) === 15, "15 service and rental types (no inflatable)");
ok(one(await svc(`SELECT count(*)::int FROM public.shop_item_subtypes WHERE slug ~ 'bounce|inflat'`)) === 0, "no bounce-house type (Q1949's paperwork gate)");
ok(refused(await svc(`INSERT INTO public.shop_item_subtypes (slug, kind, label, position, tax_kind) VALUES ('x_bad', 'made', 'Bad', 999, 'item_repair')`), /tax_kind_valid/), "a tax answer only on a service type");

// --- 2. the confirmations and the word check
const st = async (k, s) => one(await svc(`SELECT public.shop_item_required_statements('${k}', '${s}')`));
ok(JSON.stringify(await st("service", "lessons")) === JSON.stringify(["i_do_this_work", "licensed_if_needed", "not_banned"]), "a service ticks its own three statements");
ok(JSON.stringify(await st("rental", "equipment_rental")) === JSON.stringify(["i_own_it", "safe_to_use", "not_inflatable", "not_banned"]), "a rental ticks its own four statements, inflatables named");
const flag = async (k, t) => one(await svc(`SELECT public.shop_item_text_flag('${k}', '${t}', '')`));
ok(await flag("service", "Swim lessons for kids") === null, "a service for kids is not flagged as a children's item");
ok(await flag("service", "Puppy grooming") === null, "pet care naming a puppy is not flagged as a live animal");
ok(await flag("rental", "Used tiller, works great") === null, "a rental may be used");
ok(/children/.test(await flag("made", "Kids toy chest") ?? ""), "a made item for kids is still flagged");
ok(/inflatable/.test(await flag("rental", "Bounce house for parties") ?? ""), "a bounce-house rental waits for an admin");
ok(/alcohol/.test(await flag("service", "Bartending with rum punch") ?? ""), "the banned-goods words still flag a service");

// --- 3. publish: a service draft goes live at once
const svcDraft = await item(shopA, OWNER, "service", "item_repair", "Lawn mower tune-up", 6000, 1, "NULL", "draft");
// Without the migration the draft row itself is refused (the kind CHECK): nothing to set up.
if (svcDraft) await db.exec(`INSERT INTO public.shop_item_private (item_id, owner_id) VALUES ('${svcDraft}', '${OWNER}');
  INSERT INTO public.shop_item_photos (item_id, owner_id, storage_path, position)
    SELECT '${svcDraft}', '${OWNER}', '${OWNER}/shop-items/${svcDraft}/p' || g || '.jpg', g FROM generate_series(0, 2) g;
  INSERT INTO public.shop_item_attestations (item_id, owner_id, statements)
    VALUES ('${svcDraft}', '${OWNER}', ARRAY['i_do_this_work', 'licensed_if_needed', 'not_banned']);`);
const pub = await member(OWNER, `SELECT public.shops_publish_item('${svcDraft}') AS s`);
ok(one(pub) === "live", `a service with its photos and statements goes live (${JSON.stringify(pub)})`);
ok(refused(await member(ORDINARY, `SELECT public.shops_publish_item('${svcDraft}')`), /feature_disabled/, "42501"), "an ordinary account is still refused by the switch");
const rentDraft = await item(shopA, OWNER, "rental", "equipment_rental", "Pressure washer, one day", 4500, 0, 1, "draft");
// Without the migration the draft row itself is refused (the kind CHECK): nothing to set up.
if (rentDraft) await db.exec(`INSERT INTO public.shop_item_private (item_id, owner_id) VALUES ('${rentDraft}', '${OWNER}');
  INSERT INTO public.shop_item_photos (item_id, owner_id, storage_path, position)
    SELECT '${rentDraft}', '${OWNER}', '${OWNER}/shop-items/${rentDraft}/p' || g || '.jpg', g FROM generate_series(0, 2) g;
  INSERT INTO public.shop_item_attestations (item_id, owner_id, statements)
    VALUES ('${rentDraft}', '${OWNER}', ARRAY['i_own_it', 'not_banned', 'not_inflatable', 'safe_to_use']);`);
const pubR = await member(OWNER, `SELECT public.shops_publish_item('${rentDraft}') AS s`);
ok(one(pubR) === "live", `a rental with its photos and statements goes live (${JSON.stringify(pubR)})`);

// --- 4. ordering a service and a rental; the order line keeps the tax answer
const repair = await item(shopA, OWNER, "service", "item_repair", "Bike repair", 4000, 1, "NULL");
const lesson = await item(shopA, OWNER, "service", "lessons", "Guitar lesson", 3000, 1, "NULL");
const tent = await item(shopA, OWNER, "rental", "party_rental", "20x20 tent, one weekend", 25000, 2, 1);
const r = await request(BUYER, lines([repair, 1], [lesson, 2], [tent, 1], [itemB, 1]), D3);
const orderId = one(r)?.order_id ?? "00000000-0000-0000-0000-000000000000";
ok(typeof one(r)?.order_id === "string", `a buyer orders a service, a lesson, a rental and a candle together (${JSON.stringify(r)})`);
const ls = await svc(`SELECT title, kind, tax_kind FROM public.shop_order_lines WHERE order_id = '${orderId}' ORDER BY title`);
const by = Object.fromEntries((Array.isArray(ls) ? ls : []).map((l) => [l.title, l]));
ok(by["Bike repair"]?.kind === "service" && by["Bike repair"]?.tax_kind === "item_repair", "the repair line keeps item_repair (taxed, R.S. 47:301.3)");
ok(by["Guitar lesson"]?.kind === "service" && by["Guitar lesson"]?.tax_kind === null, "the lesson line has no tax answer (untaxed)");
ok(by["20x20 tent, one weekend"]?.kind === "rental" && by["20x20 tent, one weekend"]?.tax_kind === null, "the rental line is kind rental");
ok(by["Fig candle"]?.kind === "made" && by["Fig candle"]?.tax_kind === null, "a made line has no tax answer");
ok(refused(await request(BUYER2, lines([tent, 2]), D3), /out_of_stock/, "55000"), "a rental's stock count still holds");
await svc(`UPDATE public.shop_item_subtypes SET tax_kind = NULL WHERE slug = 'item_repair'`);
ok(one(await svc(`SELECT tax_kind FROM public.shop_order_lines WHERE order_id = '${orderId}' AND title = 'Bike repair'`)) === "item_repair", "a later type change never moves an order's tax answer");
await svc(`UPDATE public.shop_item_subtypes SET tax_kind = 'item_repair' WHERE slug = 'item_repair'`);
// A writer that names a tax answer for an untaxed service (a lesson) never gets it: the item's type decides.
await svc(`DELETE FROM public.shop_order_lines WHERE order_id = '${orderId}' AND item_id = '${lesson ?? orderId}'`);
const forced = await svc(`INSERT INTO public.shop_order_lines (order_id, item_id, title, kind, unit_cents, quantity, line_cents, tax_kind)
  VALUES ('${orderId}', '${lesson ?? orderId}', 'Forced', 'service', 3000, 1, 3000, 'clothes_cleaning') RETURNING tax_kind`);
ok(Array.isArray(forced) && forced[0].tax_kind === null, `the trigger sets the answer from the item, never from the writer (${JSON.stringify(forced)})`);

// --- 5. grants
const g = await svc(`SELECT has_function_privilege('authenticated', 'public.shop_order_line_snapshot_tax_kind()', 'EXECUTE') AS a,
  has_function_privilege('anon', 'public.shop_order_line_snapshot_tax_kind()', 'EXECUTE') AS b`);
ok(Array.isArray(g) && g[0].a === false && g[0].b === false, "the trigger function is not callable by members or anon");

console.log(`\n${pass} PASS, ${fail} FAIL${skip ? " (NEW_MIGRATION=skip)" : ""}`);
process.exit(fail === 0 ? 0 : 1);
