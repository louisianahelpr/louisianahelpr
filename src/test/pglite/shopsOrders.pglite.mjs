#!/usr/bin/env node
/**
 * PGlite proof for 20261018154737_shops_orders_checkout (Shops M1: orders and
 * the card-hold checkout; docs/specs/local-shops-prep.md L17-L22, L37/F1, L41
 * + O2, L8, L82, L84, L91; plan ~/.lh-wt/handoffs-1017/shops-s3-plan.md).
 *
 *   node src/test/pglite/shopsOrders.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/shopsOrders.pglite.mjs     # RED: the checks fail
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/shopsOrders.pglite.mjs
 *
 * Setup copied from shopsItems.pglite.mjs (prod-shaped stubs, prod's default
 * function ACL, the newest helper definitions read from the migrations, the
 * switches, Declutter's foundation for the shared strike count), then shops
 * slice 1, slice 2 and categories v2 ONCE (as prod will have them), the
 * Declutter money helpers it reuses (declutter_buyer_fee_cents F1,
 * declutter_card_fee_estimate, declutter_notify) from their newest
 * definitions, then this migration 3x. Items are inserted live as rows:
 * publishing is slice 2's proof; this one is about orders and money.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const SLICE2 = readFileSync(`${MIG_DIR}20261017061157_shops_items.sql`, "utf8");
const CATEGORIES = readFileSync(`${MIG_DIR}20261017224153_shop_categories_v2.sql`, "utf8");
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}20261018154737_shops_orders_checkout.sql`, "utf8");
const SLICE1 = readFileSync(`${MIG_DIR}20261017061155_shops_profiles.sql`, "utf8");
const SWITCHES = readFileSync(`${MIG_DIR}20261012031120_hidden_feature_switches.sql`, "utf8");
const DECLUTTER = readFileSync(`${MIG_DIR}20261014193955_declutter_foundation.sql`, "utf8");

/** The newest CREATE [OR REPLACE] FUNCTION public.<name>( statement in the migrations, any dollar tag. */
function newestDefinition(name) {
  let found = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && !x.startsWith("20261017061155") && !x.startsWith("20261017061157") && !x.startsWith("20261018154737")).sort()) {
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
  stripe_account_id text, stripe_payouts_enabled boolean DEFAULT false, date_of_birth date,
  ban_status text DEFAULT 'active', auto_suspended_until timestamptz,
  idv_status text, stripe_identity_verified boolean NOT NULL DEFAULT false,
  email_verified boolean NOT NULL DEFAULT true, background_check_status text);
CREATE TABLE public.helper_credentials (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
  credential_type text NOT NULL, status text NOT NULL DEFAULT 'pending', expiration_date date, license_number text);
CREATE TABLE public.reviews (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, reviewer_id uuid, reviewee_id uuid NOT NULL,
  rating integer NOT NULL, status text NOT NULL DEFAULT 'published', feedback_visible_at timestamptz);
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid, helper_id uuid, status text NOT NULL,
  date_needed date, start_time time, helper_arrived_at timestamptz, revision_count integer DEFAULT 0, is_group_job boolean DEFAULT false);
CREATE TABLE public.group_job_helpers (job_id uuid, helper_id uuid, helper_arrived_at timestamptz);
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text NOT NULL, handed_over_at timestamptz);
CREATE TABLE public.declutter_reviews (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL, reviewer_id uuid,
  reviewee_id uuid, reviewer_side text NOT NULL, stars smallint NOT NULL, is_seed boolean NOT NULL DEFAULT false);
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
for (const name of ["declutter_buyer_fee_cents", "declutter_card_fee_estimate", "declutter_notify"]) {
  await db.exec(newestDefinition(name).stmt);
}
await db.exec(SLICE2);
await db.exec(CATEGORIES);

const skip = process.env.NEW_MIGRATION === "skip";
if (!skip) {
  for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
}
// Per-section strikes (20261018154740): STRIKES=skip leaves Shops on Declutter's count (RED for section 16).
const STRIKES_SQL = readFileSync(process.env.STRIKES_PATH ?? `${MIG_DIR}20261018154740_shops_own_strike_count.sql`, "utf8");
if (!skip && process.env.STRIKES !== "skip") {
  for (let i = 0; i < 3; i++) await db.exec(STRIKES_SQL);
}

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

// --- 1. the switch and who may ask (L82, L45, banned, own shop)
await svc(`UPDATE public.feature_switches SET audience = 'off' WHERE key = 'shops'`);
ok(refused(await request(BUYER, lines([itemA, 1]), D1), /feature_disabled/, "42501"), "switch off: asking for an order is refused (L91: nothing new starts)");
await svc(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'shops'`);
ok(refused(await request(ORDINARY, lines([itemA, 1]), D1), /feature_disabled/, "42501"), "testers only: an ordinary account is refused at the server");
ok(refused(await as("anon", null, `SELECT public.shops_request_order('${shopA}', ${lines([itemA, 1])}, '${D1}', '')`), /permission denied/), "anon cannot ask for an order");
ok(refused(await request(MINOR, lines([itemA, 1]), D1), /under_18/, "42501"), "under 18 cannot order (L82)");
ok(refused(await request(BANNED, lines([itemA, 1]), D1), /account_restricted/, "42501"), "a banned account cannot order");
await svc(`INSERT INTO public.shop_strikes (user_id, offender_side, reason, expires_at)
  SELECT '${STRUCK}', 'buyer', 'test', now() + interval '1 year' FROM generate_series(1, 3)`);
ok(refused(await request(STRUCK, lines([itemA, 1]), D1), /shop_strikes_blocked/, "42501"), "3 strikes cannot order (STRUCK holds 3 Shops AND 3 Declutter strikes here, so this alone does not tell them apart: section 16 does)");
ok(refused(await request(OWNER, lines([itemA, 1]), D1), /own_shop/, "22023"), "a maker cannot order from their own shop");

// --- 2. what may be in an order
ok(refused(await request(BUYER, `'[]'::jsonb`, D1), /invalid_order_lines/, "22023"), "an empty order is refused");
ok(refused(await request(BUYER, lines([itemA, 0]), D1), /invalid_quantity/, "22023"), "quantity 0 is refused");
ok(refused(await request(BUYER, lines([itemA, 21]), D1), /invalid_quantity/, "22023"), "quantity 21 is refused");
ok(refused(await request(BUYER, lines([itemDraft, 1]), D1), /item_unavailable/, "55000"), "a draft item cannot be ordered");
ok(refused(await request(BUYER, lines([itemOther, 1]), D1), /item_unavailable/, "55000"), "an item of another shop cannot be in this shop's order");
ok(refused(await request(BUYER, lines([itemA, 1], [itemA, 2]), D1), /invalid_order_lines/, "22023"), "the same item twice is refused");
ok(refused(await request(BUYER, lines([itemB, 4]), D1), /out_of_stock/, "55000"), "more than the stock count is refused (L20)");
ok(refused(await request(BUYER, `'[{"item_id":"nope","quantity":1}]'::jsonb`, D1), /invalid_order_lines/, "22023"), "a malformed line is refused");

// --- 3. the ready date (L21, D4) and the note
const today = one(await svc(`SELECT ((now() AT TIME ZONE 'America/Chicago')::date)::text`));
ok(refused(await request(BUYER, lines([itemA, 1]), today), /ready_date_too_soon/, "22023"), "a date inside the lead time is refused");
ok(refused(await request(BUYER, lines([itemA, 1]), one(await svc(`SELECT (('${today}'::date) + 91)::text`))), /ready_date_too_far/, "22023"),
  "a date more than 90 days out is refused");
ok(refused(await request(BUYER, lines([itemA, 1]), sunday), /shop_closed_that_day/, "22023"), "a day the shop does not fill orders is refused");
ok(refused(await request(BUYER, lines([itemA, 1]), D1, "Text me at 337 555 1234"), /Phone number detected/, "23514"),
  "a phone number in the note is refused (contact-leak filter)");
await svc(`UPDATE public.shops SET paused = true WHERE id = '${shopA}'`);
ok(refused(await request(BUYER, lines([itemA, 1]), D1), /shop_paused/, "55000"), "a paused shop takes no new order (L84)");
await svc(`UPDATE public.shops SET paused = false WHERE id = '${shopA}'`);

// --- 4. the order, F1 fee frozen (owner 2026-10-18: 5% + 70c, the shop keeps 100%)
const r1 = one(await request(BUYER, lines([itemA, 2], [itemB, 1]), D1, "Extra glaze please"));
const o1 = r1?.order_id;
ok(r1?.items_cents === 6100 && r1?.premium_cents === 375, "6100 cents of items -> a 375-cent buyer's fee (round(5%) + 70)");
const fee = one(await svc(`SELECT public.declutter_buyer_fee_cents(6100)`));
ok(fee === 375, "the fee is Declutter's own F1 function's number");
const row1 = (await svc(`SELECT status, items_cents, premium_cents, tax_cents, total_cents, cancel_policy FROM public.shop_orders WHERE id = '${o1}'`))?.[0];
ok(row1?.status === "awaiting_hold" && row1?.total_cents === 6475 && row1?.cancel_policy === "until_24h_before_ready",
  "the order waits for its hold, total = items + fee, the shop's cancel preset frozen on it");
const l1 = await svc(`SELECT title, kind, unit_cents, quantity, line_cents FROM public.shop_order_lines WHERE order_id = '${o1}' ORDER BY unit_cents`);
ok(Array.isArray(l1) && l1.length === 2 && l1[0].title === "Kolache dozen" && l1[0].line_cents === 3600 && l1[1].line_cents === 2500,
  "the lines snapshot the title, kind and price");
ok(refused(await svc(`UPDATE public.shop_orders SET premium_cents = 100, total_cents = 6200 WHERE id = '${o1}'`), /shop_orders_premium_rule/),
  "the fee is a table CHECK: no write can change it");
ok(refused(await svc(`UPDATE public.shop_orders SET total_cents = 1 WHERE id = '${o1}'`), /shop_orders_total/), "the total is a table CHECK");
ok(refused(await member(BUYER, `SELECT public.shop_attach_checkout_session('${o1}', 'cs_test_x')`), /permission denied/),
  "a member cannot attach a Stripe page (service only)");
await svc(`SELECT public.shop_attach_checkout_session('${o1}', 'cs_test_o1')`);
ok(refused(await svc(`SELECT public.shop_attach_checkout_session('${o1}', 'cs_test_o1b')`), /order_not_payable/, "55000"), "a page attaches once");

// asking again before paying supersedes the unpaid page
const r2 = one(await request(BUYER, lines([itemA, 1]), D1));
const o2 = r2?.order_id;
ok(r2?.superseded_session_id === "cs_test_o1" && one(await svc(`SELECT status FROM public.shop_orders WHERE id = '${o1}'`)) === "superseded",
  "asking again supersedes the unpaid order and hands back its page to expire");
await svc(`SELECT public.shop_attach_checkout_session('${o2}', 'cs_test_o2')`);

// --- 5. the hold lands (webhook)
const held = (session, pi, total, tax) => svc(`SELECT public.shop_mark_order_held('${session}', '${pi}', ${total}, ${tax}, false) AS r`);
ok(one(await held("cs_test_o1", "pi_o1", 6475, 0))?.reason === "order_closed", "a hold on a superseded order is cancelled (order_closed)");
ok(one(await held("cs_test_nope", "pi_nope", 100, 0))?.reason === "order_missing", "a hold on an unknown page is cancelled (order_missing)");
// o2: items 1800, fee 160, tax 150
const h2 = one(await held("cs_test_o2", "pi_o2", 1800 + 160 + 150, 150));
const row2 = (await svc(`SELECT status, tax_cents, total_cents, extract(epoch FROM accept_by - held_at)::int AS w FROM public.shop_orders WHERE id = '${o2}'`))?.[0];
ok(h2?.result === "held" && row2?.status === "held" && row2?.tax_cents === 150 && row2?.total_cents === 2110,
  "the hold lands: Stripe Tax's amount is recorded and the total includes it (O1)");
ok(row2?.w === 86400, "the maker has exactly 24 hours (L18)");
ok(one(await held("cs_test_o2", "pi_o2", 2110, 150))?.result === "already_held", "a replayed webhook finds the order already held");
const notes = await svc(`SELECT user_id, title FROM public.notifications ORDER BY created_at`);
ok(Array.isArray(notes) && notes.some((n) => n.user_id === OWNER && n.title === "New order") && notes.some((n) => n.user_id === BUYER && n.title === "Order sent"),
  "the maker hears of the order and the buyer is told the card is held, not charged");
// a wrong amount is never held
const r3 = one(await request(BUYER2, lines([itemB, 1]), D2));
await svc(`SELECT public.shop_attach_checkout_session('${r3.order_id}', 'cs_test_o3')`);
ok(one(await held("cs_test_o3", "pi_o3", 9999, 0))?.reason === "amount_mismatch"
  && one(await svc(`SELECT status FROM public.shop_orders WHERE id = '${r3.order_id}'`)) === "expired",
  "a payment that does not match the frozen total is cancelled and the order ends");

// --- 6. the daily cap (L22)
await svc(`UPDATE public.shops SET daily_order_cap = 1 WHERE id = '${shopA}'`);
ok(refused(await request(BUYER2, lines([itemB, 1]), D1), /day_full/, "55000"), "a full day greys out (the held order takes the slot)");
const terms = one(await member(BUYER2, `SELECT public.shops_order_terms('${shopA}')`));
ok(terms?.cancel_policy === "until_24h_before_ready" && Array.isArray(terms?.full_days) && terms.full_days.includes(D1)
  && JSON.stringify(terms?.open_weekdays) === "[1,2,3,4,5,6]", "the order terms show the cancel preset, the open days and the full day");
ok(refused(await member(OWNER, `SELECT public.shops_set_cancel_policy('whenever')`), /invalid_cancel_policy/, "22023"), "only the 3 presets (O2)");
ok(one(await member(OWNER, `SELECT public.shops_set_cancel_policy('until_accept')`)) === "until_accept", "the maker picks a preset");
await svc(`UPDATE public.shops SET daily_order_cap = NULL WHERE id = '${shopA}'`);

// --- 7. the maker answers
ok(refused(await member(BUYER, `SELECT public.shops_accept_order('${o2}')`), /order_not_found/, "P0002"), "the buyer cannot accept their own order");
ok(refused(await member(ADMIN, `SELECT public.shops_accept_order('${o2}')`), /order_not_found/, "P0002"), "another shop owner cannot accept it");
await svc(`UPDATE public.feature_switches SET audience = 'off' WHERE key = 'shops'`);
ok(refused(await member(OWNER, `SELECT public.shops_accept_order('${o2}')`), /feature_disabled/, "42501"), "switch off: accepting is new work, refused (L91)");
await svc(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'shops'`);
ok(one(await member(OWNER, `SELECT public.shops_accept_order('${o2}')`))?.result === "accepted", "the maker accepts");
ok(one(await member(OWNER, `SELECT public.shops_accept_order('${o2}')`))?.result === "already_accepted", "a second tap is a no-op");
ok(refused(await member(OWNER, `SELECT public.shops_decline_order('${o2}', NULL)`), /order_not_open/, "55000"), "an accepted order cannot be declined");
ok(refused(await member(BUYER, `SELECT public.shops_cancel_order_request('${o2}')`), /order_accepted/, "55000"),
  "after acceptance the buyer cannot just withdraw (the shop's policy applies, M3)");

// stock is taken at acceptance (L20)
const o4 = one(await request(BUYER2, lines([itemB, 2]), D3)).order_id;
await svc(`SELECT public.shop_attach_checkout_session('${o4}', 'cs_test_o4')`);
await held("cs_test_o4", "pi_o4", 5000 + 320, 0);
const o5 = one(await request(BUYER, lines([itemB, 2]), D4)).order_id;
await svc(`SELECT public.shop_attach_checkout_session('${o5}', 'cs_test_o5')`);
await held("cs_test_o5", "pi_o5", 5000 + 320, 0);
ok(one(await member(OWNER, `SELECT public.shops_accept_order('${o4}')`))?.result === "accepted"
  && one(await svc(`SELECT stock_count FROM public.shop_items WHERE id = '${itemB}'`)) === 1, "accepting takes the stock (3 -> 1)");
ok(refused(await member(OWNER, `SELECT public.shops_accept_order('${o5}')`), /out_of_stock/, "55000"),
  "a second held order for more than what is left cannot be accepted");

// decline releases the hold; the money step lists it once
ok(one(await member(OWNER, `SELECT public.shops_decline_order('${o5}', 'Sold out this week')`))?.result === "declined", "the maker declines");
ok(one(await member(OWNER, `SELECT public.shops_decline_order('${o5}', NULL)`))?.result === "already_declined", "a second decline is a no-op");
ok(refused(await member(OWNER, `SELECT public.shops_accept_order('${o5}')`), /order_not_open/, "55000"), "a declined order cannot be accepted");
ok(refused(await member(OWNER, `SELECT public.shops_decline_order('${o4}', 'Call 337 555 1234')`), /Phone number detected|order_not_open/),
  "a reason with a phone number is refused");
const rel = await svc(`SELECT order_id FROM public.shop_holds_to_release(50)`);
ok(Array.isArray(rel) && rel.some((x) => x.order_id === o5) && rel.some((x) => x.order_id === o1),
  "the declined order's hold is due to be cancelled, and so is the late hold on the superseded page (review fix 2)");
await svc(`SELECT public.shop_hold_released('${o5}')`);
ok(!(await svc(`SELECT order_id FROM public.shop_holds_to_release(50)`)).some((x) => x.order_id === o5), "a released hold is listed no more");
ok(refused(await member(BUYER, `SELECT * FROM public.shop_holds_to_release(5)`), /permission denied/), "members cannot list holds");

// the buyer withdraws before acceptance: nothing kept (O2)
const o6 = one(await request(BUYER, lines([itemA, 1]), D5)).order_id;
await svc(`SELECT public.shop_attach_checkout_session('${o6}', 'cs_test_o6')`);
await held("cs_test_o6", "pi_o6", 1800 + 160, 0);
ok(refused(await member(BUYER2, `SELECT public.shops_cancel_order_request('${o6}')`), /order_not_found/, "P0002"), "only the buyer withdraws their order");
ok(one(await member(BUYER, `SELECT public.shops_cancel_order_request('${o6}')`))?.result === "cancelled"
  && (await svc(`SELECT order_id FROM public.shop_holds_to_release(50)`)).some((x) => x.order_id === o6),
  "the buyer withdraws before an answer: the order is cancelled and its hold is due to drop");

// --- 8. the capture
ok(refused(await member(OWNER, `SELECT public.shop_order_captured('${o2}', 66)`), /permission denied/), "members cannot record a capture");
ok(one(await svc(`SELECT public.shop_order_captured('${o2}', 66)`))?.result === "captured", "the capture is recorded");
const cap = (await svc(`SELECT captured_at IS NOT NULL AS c, card_fee_cents FROM public.shop_orders WHERE id = '${o2}'`))?.[0];
ok(cap?.c === true && cap?.card_fee_cents === 66, "with Stripe's real card fee");
ok(one(await svc(`SELECT public.shop_order_captured('${o2}', 66)`))?.result === "already_captured", "a replayed capture is a no-op");
const cottage = await svc(`SELECT amount_cents FROM public.shop_cottage_sales WHERE source_ref = '${o2}'`);
ok(Array.isArray(cottage) && cottage.length === 1 && cottage[0].amount_cents === 1800, "the home-food sale is counted once for the yearly limit (L8)");
ok(one(await svc(`SELECT public.shop_order_captured('${o4}', NULL)`))?.result === "captured"
  && one(await svc(`SELECT card_fee_cents FROM public.shop_orders WHERE id = '${o4}'`)) === 184
  && (await svc(`SELECT 1 FROM public.shop_cottage_sales WHERE source_ref = '${o4}'`)).length === 0,
  "no Stripe fee read -> the 2.9% + 30c estimate; a made-goods order adds nothing to the home-food count");

// a capture Stripe refuses
const o7 = one(await request(BUYER, lines([itemB, 1]), D2)).order_id;
await svc(`SELECT public.shop_attach_checkout_session('${o7}', 'cs_test_o7')`);
await held("cs_test_o7", "pi_o7", 2500 + 195, 0);
await member(OWNER, `SELECT public.shops_accept_order('${o7}')`);
ok(one(await svc(`SELECT public.shop_order_capture_failed('${o7}', 'network', false)`))?.result === "will_retry", "a passing capture error is retried");
await svc(`UPDATE public.shop_orders SET accepted_at = now() - interval '15 minutes', capture_last_attempt_at = now() - interval '10 minutes' WHERE id = '${o7}'`);
ok((await svc(`SELECT order_id FROM public.shop_captures_due(50)`)).some((x) => x.order_id === o7), "the money step picks up the capture to retry");
ok(one(await svc(`SELECT public.shop_order_capture_failed('${o7}', 'authorization expired', true)`))?.result === "cancelled"
  && one(await svc(`SELECT status || ':' || close_reason FROM public.shop_orders WHERE id = '${o7}'`)) === "cancelled:hold_lost"
  && one(await svc(`SELECT stock_count FROM public.shop_items WHERE id = '${itemB}'`)) === 1,
  "a hold that is gone ends the order and gives the stock back (0 -> 1)");
ok(one(await svc(`SELECT hold_released_at IS NOT NULL FROM public.shop_orders WHERE id = '${o7}'`)) === true
  && !(await svc(`SELECT order_id FROM public.shop_holds_to_release(100)`)).some((x) => x.order_id === o7),
  "Stripe said the hold is canceled (p_final): only then is it marked released");

// the cap is checked again at acceptance (two orders held before the maker set a cap of 1)
const capDay = open[6];
const oc1 = one(await request(BUYER, lines([itemA, 1]), capDay)).order_id;
await svc(`SELECT public.shop_attach_checkout_session('${oc1}', 'cs_test_c1')`);
await held("cs_test_c1", "pi_c1", 1800 + 160, 0);
const oc2 = one(await request(BUYER2, lines([itemA, 1]), capDay)).order_id;
await svc(`SELECT public.shop_attach_checkout_session('${oc2}', 'cs_test_c2')`);
await held("cs_test_c2", "pi_c2", 1800 + 160, 0);
await svc(`UPDATE public.shops SET daily_order_cap = 1 WHERE id = '${shopA}'`);
ok(one(await member(OWNER, `SELECT public.shops_accept_order('${oc1}')`))?.result === "accepted"
  && refused(await member(OWNER, `SELECT public.shops_accept_order('${oc2}')`), /day_full/, "55000"),
  "with a cap of 1, the first held order is accepted and the second is refused (L22 at acceptance)");
await svc(`UPDATE public.shops SET daily_order_cap = NULL WHERE id = '${shopA}'`);
await member(OWNER, `SELECT public.shops_decline_order('${oc2}', NULL)`);

// --- 9. the clock (L18) and an unpaid page
const o8 = one(await request(BUYER2, lines([itemA, 1]), D4)).order_id;
await svc(`SELECT public.shop_attach_checkout_session('${o8}', 'cs_test_o8')`);
await held("cs_test_o8", "pi_o8", 1800 + 160, 0);
await svc(`UPDATE public.shop_orders SET held_at = now() - interval '25 hours', accept_by = now() - interval '1 hour' WHERE id = '${o8}'`);
ok(refused(await member(OWNER, `SELECT public.shops_accept_order('${o8}')`), /order_expired/, "55000"), "after 24 hours the maker can no longer accept");
const o9 = one(await request(BUYER, lines([itemA, 1]), D3)).order_id;
await svc(`UPDATE public.shop_orders SET created_at = now() - interval '3 hours' WHERE id = '${o9}'`);
const sw = one(await svc(`SELECT public.shop_order_sweep()`));
ok(sw?.no_answer === 1 && sw?.page_unpaid === 1
  && one(await svc(`SELECT status || ':' || close_reason FROM public.shop_orders WHERE id = '${o8}'`)) === "expired:no_answer",
  "the sweep drops the unanswered order and the unpaid page");
ok((await svc(`SELECT order_id FROM public.shop_holds_to_release(50)`)).some((x) => x.order_id === o8), "and the unanswered hold is due to drop");

// --- 10. the home-food yearly limit (L8)
const capSet = await svc(`UPDATE public.shop_cottage_settings SET cap_cents = 100000 RETURNING cap_cents`);
await svc(`INSERT INTO public.shop_cottage_sales (owner_id, source_ref, amount_cents) VALUES ('${OWNER}', gen_random_uuid(), 100000)`);
ok(Array.isArray(capSet) && capSet.length === 1, "setup: the yearly limit set to its lowest allowed value ($1,000) and reached");
ok(refused(await request(BUYER, lines([itemA, 1]), D5), /cottage_limit_reached/, "55000"), "no new home-food order at the yearly limit");
ok(typeof one(await request(BUYER, lines([itemB, 1]), D5))?.order_id === "string", "made goods are still fine");
await svc(`UPDATE public.shop_cottage_settings SET cap_cents = 3000000`);

// --- 11. closing a shop or deleting a party with money held fails closed
const o10 = one(await request(BUYER2, lines([itemA, 1]), D5)).order_id;
await svc(`SELECT public.shop_attach_checkout_session('${o10}', 'cs_test_o10')`);
await held("cs_test_o10", "pi_o10", 1800 + 160, 0);
ok(refused(await member(OWNER, `SELECT public.shops_close_my_shop()`), /shop_has_open_orders/, "55000"), "a shop with an open order cannot be closed");
ok(refused(await svc(`DELETE FROM auth.users WHERE id = '${BUYER2}'`), /shop_orders_open_has_parties|violates/),
  "deleting a buyer with a held order fails closed (the money record keeps its parties)");

// --- 12. who reads what
const mine = await rows(BUYER, `SELECT id FROM public.shop_orders`);
const theirs = await rows(BUYER2, `SELECT id FROM public.shop_orders WHERE buyer_id = '${BUYER}'`);
ok(Array.isArray(mine) && mine.length >= 4 && Array.isArray(theirs) && theirs.length === 0, "a buyer reads their own orders; another member reads none of them");
ok((await rows(OWNER, `SELECT id FROM public.shop_orders WHERE id = '${o2}'`))?.length === 1, "the maker reads the orders of their shop");
ok(refused(await member(BUYER, `SELECT stripe_payment_intent_id FROM public.shop_orders`), /permission denied/), "the Stripe ids are not client-readable");
ok(refused(await member(BUYER, `UPDATE public.shop_orders SET status = 'accepted' WHERE id = '${o10}'`), /permission denied/),
  "no client role writes an order (RPCs only)");
const internal = await svc(`SELECT string_agg(p.proname, ',') AS w FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('shop_line_unit_cents', 'shop_day_count', 'shop_attach_checkout_session',
    'shop_mark_order_held', 'shop_order_captured', 'shop_order_capture_failed', 'shop_captures_due', 'shop_holds_to_release',
    'shop_hold_released', 'shop_hold_release_failed', 'shop_order_sweep', 'shop_orders_seed_from_parties', 'shops_refuse_delete_with_open_orders')
    AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))`);
ok(one(internal) === null && !skip, "every service step is closed to members and anon");
const anonExec = await svc(`SELECT string_agg(p.proname, ',') AS w FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'shop%' AND has_function_privilege('anon', p.oid, 'EXECUTE')`);
ok(one(anonExec) === null && !skip, "anon executes no shop function");
const definers = await svc(`SELECT count(*)::int AS n FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname LIKE 'shop%' AND p.prosecdef AND NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')`);
ok(one(definers) === 0 && !skip, "every SECURITY DEFINER shop function pins search_path");
const writes = await svc(`SELECT string_agg(c.relname || ':' || r.rolname || ':' || pr.p, ',') AS w
  FROM pg_class c CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname) CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE')) pr(p)
  WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('shop_orders', 'shop_order_lines') AND has_table_privilege(r.rolname, c.oid, pr.p)`);
ok(one(writes) === null && !skip, "no client role can write an order table");
const seedy = one(await request(SEEDY, lines([itemA, 1]), D5));
ok(one(await svc(`SELECT is_seed FROM public.shop_orders WHERE id = '${seedy?.order_id}'`)) === true, "a test account's order is seed data from birth");

// --- 13. the lh-money-escrow review fixes (66dec6dd0..c69866902, 2026-10-17)
const totalFor = (items) => items + Math.round(items * 0.05) + 70;
const heldOrder = async (buyer, ls, items, day, tag) => {
  const id = one(await request(buyer, ls, day))?.order_id;
  await svc(`SELECT public.shop_attach_checkout_session('${id}', 'cs_test_${tag}')`);
  await held(`cs_test_${tag}`, `pi_${tag}`, totalFor(items), 0);
  return id;
};
const releasable = async () => (await svc(`SELECT order_id FROM public.shop_holds_to_release(100)`)).map((x) => x.order_id);
// fix 2: a hold the webhook cancels is recorded on the closed row, so the money step retries a failed cancel
ok(one(await svc(`SELECT stripe_payment_intent_id FROM public.shop_orders WHERE id = '${o1}'`)) === "pi_o1"
  && one(await svc(`SELECT stripe_payment_intent_id FROM public.shop_orders WHERE id = '${r3.order_id}'`)) === "pi_o3"
  && (await releasable()).includes(r3.order_id),
  "fix 2: an order_closed or amount_mismatch hold keeps its payment id, and its cancel is retried");
ok((await svc(`SELECT 1 FROM public.notifications WHERE user_id = '${BUYER}' AND title = 'Order already closed'`)).length === 1
  && (await svc(`SELECT 1 FROM public.notifications WHERE user_id = '${BUYER2}' AND title = 'Order could not go through'`)).length === 1,
  "fix 8: the buyer is told when a late payment meets a closed order, and when the amount did not add up");
const itemC = await item(shopA, OWNER, "made", "crafts", "Cypress bowl", 1000, 0, "NULL");
const dayF = open[7];
await svc(`UPDATE public.shops SET daily_order_cap = 1 WHERE id = '${shopA}'`);
const f1 = one(await request(BUYER, lines([itemC, 1]), dayF))?.order_id;
const f2 = one(await request(BUYER2, lines([itemC, 1]), dayF))?.order_id;
await svc(`SELECT public.shop_attach_checkout_session('${f1}', 'cs_test_f1')`);
await svc(`SELECT public.shop_attach_checkout_session('${f2}', 'cs_test_f2')`);
await held("cs_test_f1", "pi_f1", totalFor(1000), 0);
ok(one(await held("cs_test_f2", "pi_f2", totalFor(1000), 0))?.reason === "day_full"
  && one(await svc(`SELECT stripe_payment_intent_id FROM public.shop_orders WHERE id = '${f2}'`)) === "pi_f2"
  && (await releasable()).includes(f2),
  "fix 2: a hold that lands on a full day keeps its payment id, and its cancel is retried");
await svc(`UPDATE public.shops SET daily_order_cap = NULL WHERE id = '${shopA}'`);
// fix 1: a capture that keeps failing is retried past 12 tries, and giving up never marks the hold released
const g = await heldOrder(BUYER, lines([itemC, 1]), 1000, open[8], "g1");
await member(OWNER, `SELECT public.shops_accept_order('${g}')`);
await svc(`UPDATE public.shop_orders SET accepted_at = now() - interval '3 hours', capture_attempts = 12,
  capture_last_attempt_at = now() - interval '30 minutes' WHERE id = '${g}'`);
ok(!(await svc(`SELECT order_id FROM public.shop_captures_due(100)`)).some((x) => x.order_id === g),
  "fix 1: after 12 tries a capture is retried hourly, not every run");
await svc(`UPDATE public.shop_orders SET capture_last_attempt_at = now() - interval '2 hours' WHERE id = '${g}'`);
ok((await svc(`SELECT order_id FROM public.shop_captures_due(100)`)).some((x) => x.order_id === g)
  && one(await svc(`SELECT public.shop_order_capture_failed('${g}', 'api error', false)`))?.result === "will_retry",
  "fix 1: a 13th failure inside the hold's life is still a retry, not the end of the order");
await svc(`UPDATE public.shop_orders SET held_at = now() - interval '6 days 1 hour', accept_by = now() - interval '5 days 1 hour' WHERE id = '${g}'`);
ok(one(await svc(`SELECT public.shop_order_capture_failed('${g}', 'api error', false)`))?.result === "cancelled"
  && one(await svc(`SELECT status || ':' || close_reason || ':' || (hold_released_at IS NULL) FROM public.shop_orders WHERE id = '${g}'`)) === "cancelled:capture_gave_up:true"
  && (await releasable()).includes(g),
  "fix 1 (MUST): giving up on a capture ends the order but leaves the hold for the release step to cancel at Stripe");
// note 6: a release that keeps failing goes to the back of the queue
const before = await releasable();
await svc(`SELECT public.shop_hold_release_failed('${before[0]}', 'stripe down')`);
const after = await releasable();
ok(before.length > 1 && after[after.length - 1] === before[0] && after.length === before.length,
  "note 6: a hold whose cancel failed is retried after the others, never ahead of them");
ok(refused(await member(OWNER, `SELECT public.shop_hold_release_failed('${g}', 'x')`), /permission denied/), "members cannot mark a release failed");
// note 10: the buyer was banned after ordering
const bz = await heldOrder(BUYER2, lines([itemC, 1]), 1000, open[9], "b1");
await svc(`UPDATE public.profiles SET ban_status = 'banned' WHERE user_id = '${BUYER2}'`);
ok(refused(await member(OWNER, `SELECT public.shops_accept_order('${bz}')`), /buyer_unavailable/, "55000"),
  "note 10: an order from a buyer banned since cannot be accepted");
await svc(`UPDATE public.profiles SET ban_status = 'active' WHERE user_id = '${BUYER2}'`);
await member(OWNER, `SELECT public.shops_decline_order('${bz}', NULL)`);
// Q345 (hireRefusedAcrossBlock): a block since the order was sent is refused before any write, as applicant_blocked
const bk = await heldOrder(BUYER2, lines([itemC, 1]), 1000, open[9], "bk");
await svc(`INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES ('${BUYER2}', '${OWNER}')`);
ok(refused(await member(OWNER, `SELECT public.shops_accept_order('${bk}')`), /applicant_blocked/, "42501")
  && one(await svc(`SELECT status || ':' || (accepted_at IS NULL) FROM public.shop_orders WHERE id = '${bk}'`)) === "held:true",
  "Q345: a maker cannot accept across a block made since the order was sent, and nothing is written");
ok(one(await member(OWNER, `SELECT public.shops_decline_order('${bk}', NULL)`))?.result === "declined", "Q345: the maker can still decline it (the hold drops)");
await svc(`DELETE FROM public.user_blocks WHERE blocker_id = '${BUYER2}' AND blocked_id = '${OWNER}'`);
// authz review note 3: an open order can never reach accept with a NULL buyer: shop_orders_open_has_parties refuses it
const bn = await heldOrder(BUYER2, lines([itemC, 1]), 1000, open[9], "bn");
ok(refused(await svc(`UPDATE public.shop_orders SET buyer_id = NULL WHERE id = '${bn}'`), /shop_orders_open_has_parties/, "23514"),
  "a held order cannot lose its buyer (CHECK), so shops_accept_order never meets a NULL buyer");
await member(OWNER, `SELECT public.shops_decline_order('${bn}', NULL)`);
// fix 4: the home-food yearly limit at acceptance counts accepted, not-yet-charged orders and this one
const sold = Number(one(await svc(`SELECT public.shop_cottage_sales_cents('${OWNER}')`)));
const pending = Number(one(await svc(`SELECT COALESCE(sum(ol.line_cents), 0) FROM public.shop_orders x JOIN public.shop_order_lines ol
  ON ol.order_id = x.id AND ol.kind = 'home_food' WHERE x.seller_id = '${OWNER}' AND x.status = 'accepted' AND x.captured_at IS NULL`)));
await svc(`UPDATE public.shop_cottage_settings SET cap_cents = ${sold + pending + 1800}`);
const hf1 = await heldOrder(BUYER, lines([itemA, 1]), 1800, open[10], "h1");
const hf2 = await heldOrder(BUYER2, lines([itemA, 1]), 1800, open[11], "h2");
ok(one(await svc(`SELECT status FROM public.shop_orders WHERE id = '${hf2}'`)) === "held"
  && one(await member(OWNER, `SELECT public.shops_accept_order('${hf1}')`))?.result === "accepted",
  "fix 4: both home-food orders could be asked for; the first fits the yearly limit exactly and is accepted");
ok(refused(await member(OWNER, `SELECT public.shops_accept_order('${hf2}')`), /cottage_limit_reached/, "55000"),
  "fix 4: the second would go over the yearly limit with the first still uncharged, so it cannot be accepted");
await svc(`UPDATE public.shop_cottage_settings SET cap_cents = 3000000`);

// --- 14. the lh-authz-rls review fixes (2026-10-18)
const hz = await heldOrder(BUYER, lines([itemC, 1]), 1000, open[12], "z1");
await svc(`UPDATE public.shops SET hidden_at = now(), hidden_reason = 'policy' WHERE id = '${shopA}'`);
ok(refused(await member(OWNER, `SELECT public.shops_accept_order('${hz}')`), /shop_hidden/, "42501"),
  "authz 1: a shop Louisiana Helpr hid cannot accept (charge) its held orders");
ok(one(await member(OWNER, `SELECT public.shops_decline_order('${hz}', NULL)`))?.result === "declined", "authz 1: it can still decline them");
await svc(`UPDATE public.shops SET hidden_at = NULL, hidden_reason = NULL WHERE id = '${shopA}'`);
await svc(`INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES ('${OWNER}', '${BUYER2}')`);
ok(refused(await member(BUYER2, `SELECT public.shops_order_terms('${shopA}')`), /shop_not_found/, "P0002"),
  "authz 3: a member the owner blocked gets no order terms");
await svc(`DELETE FROM public.user_blocks WHERE blocker_id = '${OWNER}' AND blocked_id = '${BUYER2}'`);
await svc(`INSERT INTO public.shop_orders (buyer_id, seller_id, shop_id, status, close_reason, closed_at, ready_date, cancel_policy, items_cents, premium_cents, total_cents)
  SELECT '${BUYER}', '${OWNER}', '${shopA}', 'superseded', 'superseded', now(), '${open[12]}', 'until_accept', 1000, 120, 1120 FROM generate_series(1, 30)`);
ok(refused(await request(BUYER, lines([itemC, 1]), open[12]), /too_many_order_requests/, "54000"),
  "authz 2: at most 30 orders asked for in an hour (the RPC is callable past the edge function's rate limit)");

// --- 16. strikes are PER SECTION (owner 2026-10-18, overrides L45's one shared count)
{
  await svc(`DELETE FROM public.shop_strikes WHERE user_id = '${STRUCK}'`);
  const dStruck = Number(one(await svc(`SELECT public.declutter_active_strike_count('${STRUCK}')`)));
  const r = await request(STRUCK, lines([itemC, 1]), open[13]);
  ok(dStruck === 3 && typeof one(r)?.order_id === "string",
    `per section: 3 Declutter strikes do not stop a Shops order (${dStruck} Declutter strikes; ${JSON.stringify(r).slice(0, 80)})`);
  await svc(`INSERT INTO public.declutter_strikes (user_id, offender_side, reason, expires_at)
    SELECT '${OWNER}', 'seller', 'seller_no_show', now() + interval '1 year' FROM generate_series(1, 3)`);
  ok(one(await member(BUYER, `SELECT public.shop_publicly_visible('${shopA}')`)) === true
    && one(await svc(`SELECT public.shop_owner_sell_block_reason('${OWNER}')`)) == null,
    "per section: a shop owner with 3 Declutter strikes stays visible and can sell");
  // shops_assert_owner_eligible (the open/save-a-shop gate) reads the Shops count too (money review note 1).
  const eligible = await as("service_role", OWNER, `SELECT public.shops_assert_owner_eligible()`);
  ok(!refused(eligible, /shop_strikes_blocked/),
    `per section: 3 Declutter strikes do not stop the owner keeping a shop (${JSON.stringify(eligible).slice(0, 80)})`);
  await svc(`DELETE FROM public.declutter_strikes WHERE user_id = '${OWNER}'`);
  await svc(`INSERT INTO public.shop_strikes (user_id, offender_side, reason, expires_at)
    SELECT '${OWNER}', 'shop', 'test', now() + interval '1 year' FROM generate_series(1, 3)`);
  ok(one(await member(BUYER, `SELECT public.shop_publicly_visible('${shopA}')`)) === false
    && one(await svc(`SELECT public.shop_owner_sell_block_reason('${OWNER}')`)) === "shop_strikes_blocked"
    && Number(one(await svc(`SELECT public.declutter_active_strike_count('${OWNER}')`))) === 0,
    "per section: 3 Shops strikes hide the shop and stop selling, and count nothing in Declutter");
  ok(refused(await as("service_role", OWNER, `SELECT public.shops_assert_owner_eligible()`), /shop_strikes_blocked/, "42501"),
    "per section: 3 Shops strikes stop the owner opening or saving a shop (shops_assert_owner_eligible)");
  await svc(`UPDATE public.shop_strikes SET removed_at = now() WHERE user_id = '${OWNER}'`);
  ok(one(await member(BUYER, `SELECT public.shop_publicly_visible('${shopA}')`)) === true
    && one(await svc(`SELECT public.shop_owner_sell_block_reason('${OWNER}')`)) == null,
    "per section: removed Shops strikes no longer count");
  // Expired strikes (money review note 2): 3 that ran out a second ago count for nothing.
  await svc(`INSERT INTO public.shop_strikes (user_id, offender_side, reason, given_at, expires_at)
    SELECT '${OWNER}', 'shop', 'test', now() - interval '1 year', now() - interval '1 second' FROM generate_series(1, 3)`);
  ok(Number(one(await svc(`SELECT public.shop_active_strike_count('${OWNER}')`))) === 0
    && one(await svc(`SELECT public.shop_owner_sell_block_reason('${OWNER}')`)) == null
    && one(await member(BUYER, `SELECT public.shop_publicly_visible('${shopA}')`)) === true,
    "per section: expired Shops strikes no longer count");
  await svc(`DELETE FROM public.shop_strikes WHERE user_id = '${OWNER}'`);
  ok(refused(await member(BUYER, `SELECT count(*) FROM public.shop_strikes`), /permission denied/)
    && refused(await member(BUYER, `SELECT public.shop_active_strike_count('${BUYER}')`), /permission denied/),
    "members cannot read the Shops strike table or call its count");
}

// --- 15. Download My Data (20261018154738): the shop_orders, shop_order_lines and
// shop_strikes sections of the NEWEST export_my_data, run as written against this schema.
// The function itself reads about 120 tables (counted 2026-10-18) this proof does not build, so each
// section's SELECT is lifted out of the body and run with v_uid bound; the
// whole migration is also applied 3x (replay-safe).
{
  const EXPORT_FILE = process.env.EXPORT_PATH ?? `${MIG_DIR}20261018154738_export_my_data_shop_orders.sql`;
  const EXPORT_SQL = readFileSync(EXPORT_FILE, "utf8");
  if (!skip) for (let i = 0; i < 3; i++) await db.exec(EXPORT_SQL);
  const newest = newestDefinition("export_my_data");
  ok(skip || newest.file === EXPORT_FILE.split("/").pop() || !!process.env.EXPORT_PATH, `export: the newest export_my_data is the order-sections restatement (${newest.file})`);
  const body = process.env.EXPORT_PATH ? EXPORT_SQL : newest.stmt;
  const section = (name) => {
    const m = new RegExp(String.raw`jsonb_build_object\('${name}', \(([\s\S]*?)\)\);\n`).exec(body);
    return m ? m[1] : null;
  };
  const run = async (name, uid) => {
    const sel = section(name);
    if (!sel) return null;
    return one(await svc(`SELECT (${sel.replaceAll("v_uid", `'${uid}'::uuid`)}) AS v`));
  };
  const bOrders = await run("shop_orders", BUYER);
  const sOrders = await run("shop_orders", OWNER);
  const xOrders = await run("shop_orders", ORDINARY);
  const mine = Number(one(await svc(`SELECT count(*) FROM public.shop_orders WHERE buyer_id = '${BUYER}' OR seller_id = '${BUYER}'`)));
  const shops = Number(one(await svc(`SELECT count(*) FROM public.shop_orders WHERE buyer_id = '${OWNER}' OR seller_id = '${OWNER}'`)));
  ok(Array.isArray(bOrders) && bOrders.length === mine && mine > 0, `export: the buyer gets every order they asked for (${bOrders?.length}/${mine})`);
  ok(Array.isArray(sOrders) && sOrders.length === shops && shops > 0, `export: the shop owner gets every order of their shop (${sOrders?.length}/${shops})`);
  ok(Array.isArray(xOrders) && xOrders.length === 0 && Number(one(await svc(`SELECT count(*) FROM public.shop_orders WHERE buyer_id <> '${ORDINARY}'`))) > 0,
    "export: a member with no orders gets none of anyone else's");
  const keys = new Set((bOrders ?? []).flatMap((o) => Object.keys(o)));
  ok(keys.has("ready_date") && keys.has("total_cents") && ["stripe_checkout_session_id", "stripe_payment_intent_id", "capture_last_error", "hold_release_last_error"].every((k) => !keys.has(k)),
    "export: an order row carries its own fields, never the Stripe ids or the capture / release error text");
  const bLines = await run("shop_order_lines", BUYER);
  const xLines = await run("shop_order_lines", ORDINARY);
  const myLines = Number(one(await svc(`SELECT count(*) FROM public.shop_order_lines l JOIN public.shop_orders o ON o.id = l.order_id WHERE o.buyer_id = '${BUYER}' OR o.seller_id = '${BUYER}'`)));
  ok(Array.isArray(bLines) && bLines.length === myLines && myLines > 0 && Array.isArray(xLines) && xLines.length === 0,
    `export: the lines of the member's own orders, and nobody else's (${bLines?.length}/${myLines}, stranger ${xLines?.length})`);
  // shop_strikes (20261018154740; authz review note 2): the member's own, without removed_by, nobody else's.
  await svc(`INSERT INTO public.shop_strikes (user_id, offender_side, reason, expires_at, removed_at, removed_by) VALUES
    ('${BUYER}', 'buyer', 'test', now() + interval '1 year', now(), '${ADMIN}'),
    ('${OWNER}', 'shop', 'test', now() + interval '1 year', NULL, NULL)`);
  const bStrikes = await run("shop_strikes", BUYER);
  const xStrikes = await run("shop_strikes", ORDINARY);
  ok(Array.isArray(bStrikes) && bStrikes.length === 1 && bStrikes[0].user_id === BUYER && !("removed_by" in bStrikes[0]) && "removed_at" in bStrikes[0]
    && Array.isArray(xStrikes) && xStrikes.length === 0,
    `export: the member's own Shops strikes without who removed them, and nobody else's (${bStrikes?.length}, stranger ${xStrikes?.length})`);
  await svc(`DELETE FROM public.shop_strikes WHERE user_id IN ('${BUYER}', '${OWNER}')`);
  const acl = one(await svc(`SELECT array_to_string(proacl, ',') FROM pg_proc WHERE proname = 'export_my_data'`)) ?? "";
  ok(skip || (!/(^|,)anon=/.test(acl) && !/(^|,)authenticated=/.test(acl) && !/(^|,)=X/.test(acl) && /service_role=X/.test(acl)),
    `export: only service_role may run export_my_data (${acl})`);
}

console.log(`\n${pass} PASS, ${fail} FAIL${skip ? " (NEW_MIGRATION=skip)" : ""}`);
process.exit(fail === 0 ? 0 : 1);
