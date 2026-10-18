#!/usr/bin/env node
/**
 * PGlite proof for 20261018180859_shops_pickup_address (Shops M1b part 2: the
 * maker's exact pickup address, private; lead decision 2026-10-18; tax memo
 * Q3). Setup copied from shopsOrders.pglite.mjs (Shops slices 1-2, categories
 * v2, M1 and its per-section strikes, once, as prod will have them), then this
 * migration 3x.
 *
 *   node src/test/pglite/shopsPickupAddress.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/shopsPickupAddress.pglite.mjs   # RED: the checks fail
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/shopsPickupAddress.pglite.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const SLICE2 = readFileSync(`${MIG_DIR}20261017061157_shops_items.sql`, "utf8");
const CATEGORIES = readFileSync(`${MIG_DIR}20261017224153_shop_categories_v2.sql`, "utf8");
const MIGRATION = readFileSync(`${MIG_DIR}20261018164442_shops_orders_checkout.sql`, "utf8");
const SLICE1 = readFileSync(`${MIG_DIR}20261017061155_shops_profiles.sql`, "utf8");
const SWITCHES = readFileSync(`${MIG_DIR}20261012031120_hidden_feature_switches.sql`, "utf8");
const DECLUTTER = readFileSync(`${MIG_DIR}20261014193955_declutter_foundation.sql`, "utf8");

/** The newest CREATE [OR REPLACE] FUNCTION public.<name>( statement in the migrations, any dollar tag. */
function newestDefinition(name) {
  let found = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && !x.startsWith("20261017061155") && !x.startsWith("20261017061157") && !x.startsWith("20261018164442")).sort()) {
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
{
  for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
}
// M1's per-section strikes (20261018164444), as prod will have them.
const STRIKES_SQL = readFileSync(process.env.STRIKES_PATH ?? `${MIG_DIR}20261018164444_shops_own_strike_count.sql`, "utf8");
{
  for (let i = 0; i < 3; i++) await db.exec(STRIKES_SQL);
}

// THIS migration, 3x (replay-safe); NEW_MIGRATION=skip leaves it out (RED).
const PICKUP = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}20261018180859_shops_pickup_address.sql`, "utf8");
if (!skip) {
  for (let i = 0; i < 3; i++) await db.exec(PICKUP);
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


const addr = (uid, l1, l2, city, zip) => member(uid, `SELECT public.shops_save_my_pickup_address(${l1 === null ? "NULL" : `'${l1}'`}, ${l2 === null ? "NULL" : `'${l2}'`}, ${city === null ? "NULL" : `'${city}'`}, ${zip === null ? "NULL" : `'${zip}'`})`);
const pickupFor = (uid, order) => rows(uid, `SELECT * FROM public.shops_order_pickup_address('${order}')`);

// --- 1. nobody reads the table directly; no address, no order
ok(refused(await member(OWNER, `SELECT * FROM public.shop_pickup_addresses`), /permission denied/), "a member cannot read shop_pickup_addresses directly, not even the shop's owner");
ok(refused(await as("anon", null, `SELECT * FROM public.shop_pickup_addresses`), /permission denied/), "anon cannot read shop_pickup_addresses");
ok(refused(await request(BUYER, lines([itemA, 1]), D1), /pickup_address_missing/, "55000"), "a shop with no pickup address cannot take an order (M1 is pickup only)");

// --- 2. saving it: the shop's owner only, Louisiana only
ok(refused(await addr(OWNER, "12 Main St", null, "Broussard", "90210"), /pickup_address_not_in_louisiana/, "22023"), "a ZIP outside Louisiana is refused");
ok(refused(await addr(OWNER, "x", null, "Broussard", "70518"), /invalid_pickup_address/, "22023"), "a one-letter street line is refused");
ok(refused(await addr(OWNER, "12 Main St", null, null, "70518"), /invalid_pickup_address/, "22023"), "a missing city is refused");
const noShop = await addr(BUYER, "12 Main St", null, "Broussard", "70518");
ok(!Array.isArray(noShop), `a tester with no shop cannot save one (${JSON.stringify(noShop)})`);
ok(refused(await addr(ORDINARY, "12 Main St", null, "Broussard", "70518"), /feature_disabled/, "42501"), "testers only: an ordinary account is refused at the server");
ok(refused(await addr(BANNED, "12 Main St", null, "Broussard", "70518"), /account_restricted/, "42501"), "a banned account cannot save one");
await svc(`UPDATE public.feature_switches SET audience = 'off' WHERE key = 'shops'`);
ok(refused(await addr(OWNER, "12 Main St", null, "Broussard", "70518"), /feature_disabled/, "42501"), "switch off: the address cannot be saved");
await svc(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'shops'`);
ok(refused(await as("anon", null, `SELECT public.shops_save_my_pickup_address('12 Main St', NULL, 'Broussard', '70518')`), /permission denied/), "anon cannot save one");
const saved = await addr(OWNER, " 12 Main St ", "  ", "Broussard", "70518");
ok(Array.isArray(saved), `the owner saves the shop's pickup address (${JSON.stringify(saved)})`);
const mine = await rows(OWNER, `SELECT * FROM public.shops_my_pickup_address()`);
ok(mine?.length === 1 && mine[0].line1 === "12 Main St" && mine[0].line2 === null && mine[0].state === "LA" && mine[0].postal_code === "70518",
  `the owner reads it back, trimmed, blank line 2 stored as none (${JSON.stringify(mine)})`);
ok((await rows(BUYER, `SELECT * FROM public.shops_my_pickup_address()`))?.length === 0, "another member reads no pickup address of their own");
const ownerRow = (await svc(`SELECT owner_id FROM public.shop_pickup_addresses WHERE shop_id = '${shopA}'`))[0];
ok(ownerRow?.owner_id === OWNER, "the row's owner is the shop's owner");
await svc(`INSERT INTO public.shop_pickup_addresses (shop_id, owner_id, line1, city, postal_code) VALUES ('${shopB}', '${BUYER}', '9 Bayou Rd', 'New Iberia', '70560')`);
ok((await svc(`SELECT owner_id FROM public.shop_pickup_addresses WHERE shop_id = '${shopB}'`))[0]?.owner_id === ADMIN,
  "a row written with someone else's owner_id is corrected to the shop's owner (trigger)");

// --- 3. the order: the seller sees it, the buyer only after acceptance, nobody else
const o1 = one(await request(BUYER, lines([itemA, 1]), D1))?.order_id;
ok(typeof o1 === "string", "with a pickup address the shop takes the order");
ok((await pickupFor(BUYER, o1))?.length === 0, "the buyer does not see the address while the order waits for a hold");
ok((await pickupFor(OWNER, o1))?.length === 1, "the seller sees the order's pickup address");
ok((await pickupFor(ORDINARY, o1))?.length === 0, "a stranger sees nothing");
ok(refused(await as("anon", null, `SELECT * FROM public.shops_order_pickup_address('${o1}')`), /permission denied/), "anon cannot ask");
const o1row = (await svc(`SELECT items_cents + premium_cents AS t FROM public.shop_orders WHERE id = '${o1}'`))[0];
await svc(`SELECT public.shop_attach_checkout_session('${o1}', 'cs_test_p1')`);
const h1 = one(await svc(`SELECT public.shop_mark_order_held('cs_test_p1', 'pi_p1', ${o1row.t}, 0, false) AS r`));
ok((await svc(`SELECT status FROM public.shop_orders WHERE id = '${o1}'`))[0]?.status === "held" && (await pickupFor(BUYER, o1))?.length === 0,
  `held (the maker has not accepted): the buyer still sees nothing (${JSON.stringify(h1)})`);
const o2 = one(await request(BUYER2, lines([itemB, 1]), D2))?.order_id;
const o2row = (await svc(`SELECT items_cents + premium_cents AS t FROM public.shop_orders WHERE id = '${o2}'`))[0];
await svc(`SELECT public.shop_attach_checkout_session('${o2}', 'cs_test_p2')`);
await svc(`SELECT public.shop_mark_order_held('cs_test_p2', 'pi_p2', ${o2row.t}, 0, false)`);
const dec = await member(OWNER, `SELECT public.shops_decline_order('${o2}', 'sold_out')`);
ok((await svc(`SELECT status FROM public.shop_orders WHERE id = '${o2}'`))[0]?.status === "declined" && (await pickupFor(BUYER2, o2))?.length === 0,
  `declined: the buyer never sees it (${JSON.stringify(dec)})`);
const acc = await member(OWNER, `SELECT public.shops_accept_order('${o1}')`);
ok((await svc(`SELECT status FROM public.shop_orders WHERE id = '${o1}'`))[0]?.status === "accepted", `the maker accepts (${JSON.stringify(acc)})`);
const seen = await pickupFor(BUYER, o1);
ok(seen?.length === 1 && seen[0].line1 === "12 Main St" && seen[0].city === "Broussard", `accepted: the buyer sees where to pick up (${JSON.stringify(seen)})`);
// handed_over is M2's; until then accepted is the last state a buyer reaches.
ok((await pickupFor(BUYER2, o1))?.length === 0, "another buyer sees nothing of this order");

// --- 4. the Stripe Tax location is dropped when the address changes, kept when it does not
await svc(`UPDATE public.shop_pickup_addresses SET stripe_tax_location_id = 'taxloc_test1', stripe_tax_location_mode = 'test' WHERE shop_id = '${shopA}'`);
await addr(OWNER, "12 Main St", null, "Broussard", "70518");
ok((await svc(`SELECT stripe_tax_location_id FROM public.shop_pickup_addresses WHERE shop_id = '${shopA}'`))[0]?.stripe_tax_location_id === "taxloc_test1",
  "saving the same address keeps the Stripe Tax location");
await addr(OWNER, "14 Main St", null, "Broussard", "70518");
const moved = (await svc(`SELECT stripe_tax_location_id, stripe_tax_location_mode FROM public.shop_pickup_addresses WHERE shop_id = '${shopA}'`))[0];
ok(moved?.stripe_tax_location_id === null && moved?.stripe_tax_location_mode === null, "a new address drops the old Stripe Tax location");
ok(!Array.isArray(await svc(`UPDATE public.shop_pickup_addresses SET stripe_tax_location_id = 'taxloc_x' WHERE shop_id = '${shopA}'`)),
  "a location id without its mode is refused (pair CHECK)");

// --- 4b. Download My Data (20261018180900): the owner's own address, without the Stripe Tax location
{
  const EXPORT_FILE = process.env.EXPORT_PATH ?? `${MIG_DIR}20261018180900_export_my_data_shop_pickup_address.sql`;
  const EXPORT_SQL = readFileSync(EXPORT_FILE, "utf8");
  // The function reads ~120 tables this proof does not build: the migration is
  // applied 3x (plpgsql resolves tables at run time) and the section's SELECT
  // is lifted out of the newest body and run with v_uid bound.
  if (!skip) for (let i = 0; i < 3; i++) await db.exec(EXPORT_SQL);
  const body = process.env.EXPORT_PATH ? EXPORT_SQL : newestDefinition("export_my_data").stmt;
  const m = /jsonb_build_object\('shop_pickup_addresses', \(([\s\S]*?)\)\);\n/.exec(body);
  const run = async (uid) => (m ? one(await svc(`SELECT (${m[1].replaceAll("v_uid", `'${uid}'::uuid`)}) AS v`)) : null);
  await svc(`UPDATE public.shop_pickup_addresses SET stripe_tax_location_id = 'taxloc_test2', stripe_tax_location_mode = 'live' WHERE shop_id = '${shopA}'`);
  const own = await run(OWNER);
  ok(Array.isArray(own) && own.length === 1 && own[0].line1 === "14 Main St" && own[0].owner_id === OWNER
    && !("stripe_tax_location_id" in own[0]) && !("stripe_tax_location_mode" in own[0]),
    `export: the owner gets their shop's pickup address, without the Stripe Tax location (${JSON.stringify(own)})`);
  const buyer = await run(BUYER);
  ok(Array.isArray(buyer) && buyer.length === 0, `export: a buyer who saw it on an accepted order does not get the shop's address (${JSON.stringify(buyer)})`);
  const acl = one(await svc(`SELECT array_to_string(proacl, ',') FROM pg_proc WHERE proname = 'export_my_data'`)) ?? "";
  ok(skip || (!/(^|,)anon=/.test(acl) && !/(^|,)authenticated=/.test(acl) && /service_role=X/.test(acl)), `export: only service_role may run export_my_data (${acl})`);
}

// --- 5. grants, and no public read touches the table
for (const fn of ["shops_save_my_pickup_address", "shops_my_pickup_address", "shops_order_pickup_address"]) {
  const acl = one(await svc(`SELECT array_to_string(proacl, ',') FROM pg_proc WHERE proname = '${fn}'`)) ?? "";
  ok(!skip && !/(^|,)anon=/.test(acl) && !/(^|,)=X/.test(acl) && /authenticated=X/.test(acl), `${fn}: members only, never anon or PUBLIC (${acl})`);
}
for (const fn of ["shops_get_shop", "shops_browse"]) {
  const def = one(await svc(`SELECT string_agg(pg_get_functiondef(p.oid), ' ') FROM pg_proc p WHERE p.proname = '${fn}'`)) ?? "";
  ok(def.length > 0 && !/shop_pickup_addresses/.test(def), `${fn} never reads the pickup address`);
}

console.log(`\n${pass} PASS, ${fail} FAIL${skip ? " (NEW_MIGRATION=skip)" : ""}`);
process.exit(fail === 0 ? 0 : 1);
