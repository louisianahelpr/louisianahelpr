#!/usr/bin/env node
/**
 * PGlite proof for 20261018211820_shops_handover_payout (Shops M2: the handover
 * and the shop's payout; docs/specs/local-shops-prep.md L23, L40; owner pop-up
 * 2026-10-18: the shop picks "left out" (required photo) or "in person", no codes).
 *
 *   node src/test/pglite/shopsHandoverPayout.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/shopsHandoverPayout.pglite.mjs   # RED: the checks fail
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/shopsHandoverPayout.pglite.mjs
 *   FREE_CANCEL=skip READY_TAP=skip node src/test/pglite/shopsHandoverPayout.pglite.mjs   # RED: section 8 on M2's own window (an early ready tap)
 *   FREE_CANCEL_PATH=<planted copy> node src/test/pglite/shopsHandoverPayout.pglite.mjs
 *   READY_TAP=skip node src/test/pglite/shopsHandoverPayout.pglite.mjs   # RED: section 9 without the shop's ready-tap choice
 *   READY_TAP_PATH=<planted copy> node src/test/pglite/shopsHandoverPayout.pglite.mjs
 *
 * Setup copied from shopsOrders.pglite.mjs (prod-shaped stubs, prod's default
 * function ACL, shops slices 1-2, categories v2, M1 + its strike count ONCE as
 * prod has them), plus Declutter's fee-debt ledger and declutter_consume_fee_debt
 * from its newest definition, then this migration 3x, then
 * 20261019013802_shop_free_cancel_ready_tap_day_before 3x (owner 2026-10-19: a ready
 * tap ends free cancel only from the day before the ready date), then
 * 20261019015018_shop_ready_tap_cancel_choice 3x (owner 2026-10-19: "LET THE SHOPS
 * DECIDE THIS": each shop picks what an early ready tap does; section 9).
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const SLICE2 = readFileSync(`${MIG_DIR}20261017061157_shops_items.sql`, "utf8");
const CATEGORIES = readFileSync(`${MIG_DIR}20261017224153_shop_categories_v2.sql`, "utf8");
const M1 = readFileSync(`${MIG_DIR}20261018164442_shops_orders_checkout.sql`, "utf8");
const M1_STRIKES = readFileSync(`${MIG_DIR}20261018164444_shops_own_strike_count.sql`, "utf8");
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}20261018211820_shops_handover_payout.sql`, "utf8");
const FREE_CANCEL = readFileSync(process.env.FREE_CANCEL_PATH ?? `${MIG_DIR}20261019013802_shop_free_cancel_ready_tap_day_before.sql`, "utf8");
const READY_TAP = readFileSync(process.env.READY_TAP_PATH ?? `${MIG_DIR}20261019015018_shop_ready_tap_cancel_choice.sql`, "utf8");
const SLICE1 = readFileSync(`${MIG_DIR}20261017061155_shops_profiles.sql`, "utf8");
const SWITCHES = readFileSync(`${MIG_DIR}20261012031120_hidden_feature_switches.sql`, "utf8");
const DECLUTTER = readFileSync(`${MIG_DIR}20261014193955_declutter_foundation.sql`, "utf8");

/** The newest CREATE [OR REPLACE] FUNCTION public.<name>( statement in the migrations, any dollar tag. */
function newestDefinition(name) {
  let found = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && !x.startsWith("20261017061155") && !x.startsWith("20261017061157") && !x.startsWith("20261018164442") && !x.startsWith("20261018211820")).sort()) {
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
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
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
CREATE TABLE public.cron_defects (fn text, ref text, msg text);
CREATE FUNCTION public.log_cron_defect(f text, r text, m text, c jsonb DEFAULT NULL) RETURNS void LANGUAGE sql AS $f$ INSERT INTO public.cron_defects VALUES (f, r, m) $f$;
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

await db.exec(M1);
await db.exec(M1_STRIKES);
// Declutter's fee-debt ledger (20261014224914; refund_id's FK left out: refunds are not built here).
await db.exec(`CREATE TABLE public.declutter_seller_fee_debts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid NOT NULL,
  refund_id uuid UNIQUE, amount_cents integer NOT NULL CHECK (amount_cents > 0), remaining_cents integer NOT NULL,
  is_seed boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT declutter_fee_debt_remaining CHECK (remaining_cents BETWEEN 0 AND amount_cents));
CREATE TABLE public.declutter_fee_debt_deductions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  debt_id uuid NOT NULL REFERENCES public.declutter_seller_fee_debts(id), payout_ref text NOT NULL, deducted_cents integer NOT NULL CHECK (deducted_cents > 0),
  created_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT declutter_fee_deduction_once UNIQUE (payout_ref, debt_id));`);
await db.exec(newestDefinition("declutter_consume_fee_debt").stmt);

const skip = process.env.NEW_MIGRATION === "skip";
if (!skip) {
  for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
  if (process.env.FREE_CANCEL !== "skip") for (let i = 0; i < 3; i++) await db.exec(FREE_CANCEL);
  if (process.env.READY_TAP !== "skip") for (let i = 0; i < 3; i++) await db.exec(READY_TAP);
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

// --- helpers: an order the shop accepted and whose hold was captured
let n = 0;
const charged = async (buyer = BUYER, qty = 1, day = D1) => {
  n++;
  const r = one(await request(buyer, lines([itemA, qty]), day));
  const id = r?.order_id;
  if (!id) return null;
  await svc(`SELECT public.shop_attach_checkout_session('${id}', 'cs_test_m2_${n}')`);
  await svc(`SELECT public.shop_mark_order_held('cs_test_m2_${n}', 'pi_m2_${n}', ${r.items_cents + r.premium_cents}, 0, false)`);
  await member(OWNER, `SELECT public.shops_accept_order('${id}')`);
  await svc(`SELECT public.shop_order_captured('${id}', 50)`);
  return id;
};
const status = async (id) => one(await svc(`SELECT status FROM public.shop_orders WHERE id = '${id}'`));
const payout = async (id) => (await svc(`SELECT * FROM public.shop_payouts WHERE order_id = '${id}'`))?.[0];
const photo = async (uid, id, file = "a.jpg") => {
  const path = `${uid}/shops/handover/${id}/${file}`;
  await svc(`INSERT INTO storage.objects (bucket_id, name) VALUES ('shop-handover', '${path}')`);
  return path;
};
// Past the automatic finish: the ready date three days ago, any ready tap two days ago.
const pastDue = async (id) => {
  await svc(`UPDATE public.shop_orders SET ready_date = ((now() AT TIME ZONE 'America/Chicago')::date - 3) WHERE id = '${id}'`);
  await svc(`UPDATE public.shop_handovers SET ready_at = now() - interval '48 hours' WHERE order_id = '${id}' AND ready_at IS NOT NULL`);
};
const sweep = async () => one(await svc(`SELECT public.shop_handover_sweep() AS r`))?.auto_handed_over;

// --- 1. the shop's choice (owner pop-up 2026-10-18), default in person, frozen per order
ok(one(await svc(`SELECT handover_mode FROM public.shops WHERE id = '${shopA}'`)) === "in_person", "a shop hands over in person by default");
ok(refused(await member(OWNER, `SELECT public.shops_set_handover_mode('code')`), /invalid_handover_mode/, "22023"), "only 'porch' or 'in_person' (no codes)");
ok(one(await member(OWNER, `SELECT public.shops_set_handover_mode('porch')`)) === "porch", "the shop picks left out");
const oP = await charged();
ok(one(await svc(`SELECT handover_mode FROM public.shop_orders WHERE id = '${oP}'`)) === "porch", "a new order freezes the shop's choice");
ok(refused(await svc(`UPDATE public.shop_orders SET handover_mode = 'in_person' WHERE id = '${oP}'`), /handover_mode_frozen/),
  "an order's handover choice never changes after it is asked for");

// --- 2. left out: the ready photo is required, the buyer finishes it or the clock does (with the photo)
const oHeld = one(await request(BUYER, lines([itemA, 1]), D2))?.order_id;
await svc(`SELECT public.shop_attach_checkout_session('${oHeld}', 'cs_test_m2_h')`);
await svc(`SELECT public.shop_mark_order_held('cs_test_m2_h', 'pi_m2_h', 1960, 0, false)`);
ok(refused(await member(BUYER, `SELECT public.shops_confirm_pickup('${oHeld}')`), /order_not_charged_yet/, "55000"),
  "an order not charged yet cannot be handed over");
ok(refused(await member(OWNER, `SELECT public.shops_mark_ready('${oHeld}', NULL)`), /order_not_charged_yet/, "55000"),
  "an order not charged yet cannot be marked ready");
ok(refused(await member(OWNER, `SELECT public.shops_mark_ready('${oP}', NULL)`), /photo_not_uploaded/, "22023"), "left out: the photo is required");
ok(refused(await member(OWNER, `SELECT public.shops_mark_ready('${oP}', '${OWNER}/shops/handover/${oP}/missing.jpg')`), /photo_not_uploaded/, "22023"),
  "a photo that was never uploaded is refused");
const pBuyer = await photo(BUYER, oP, "b.jpg");
ok(refused(await member(BUYER, `SELECT public.shops_mark_ready('${oP}', '${pBuyer}')`), /order_not_found/, "P0002"), "the buyer cannot mark it ready");
ok(refused(await member(OWNER, `SELECT public.shops_mark_ready('${oP}', '${pBuyer}')`), /photo_not_uploaded/, "22023"), "the shop cannot use a photo from someone else's folder");
const pOwner = await photo(OWNER, oP);
ok(one(await member(OWNER, `SELECT public.shops_mark_ready('${oP}', '${pOwner}')`))?.result === "ready", "the shop marks it ready with its photo");
ok(Number(one(await svc(`SELECT count(*) FROM public.notifications WHERE user_id = '${BUYER}' AND title = 'Your order is ready' AND message LIKE '%left out%'`))) === 1,
  "the buyer is told it is left out for them");
const firstReady = one(await svc(`SELECT ready_at::text FROM public.shop_handovers WHERE order_id = '${oP}'`));
const pOwner2 = await photo(OWNER, oP, "c.jpg");
ok(one(await member(OWNER, `SELECT public.shops_mark_ready('${oP}', '${pOwner2}')`))?.result === "ready"
  && one(await svc(`SELECT ready_at::text FROM public.shop_handovers WHERE order_id = '${oP}'`)) === firstReady
  && one(await svc(`SELECT ready_photo_path FROM public.shop_handovers WHERE order_id = '${oP}'`)) === pOwner2
  && Number(one(await svc(`SELECT count(*) FROM public.notifications WHERE user_id = '${BUYER}' AND title = 'Your order is ready'`))) === 1,
  "a retake replaces the photo, keeps the first ready time (the clock never moves later) and tells nobody again");
ok(Number(await sweep()) === 0 && (await status(oP)) === "accepted", "the clock does not finish it before 24 h after the ready date");
await pastDue(oP);
ok(Number(await sweep()) === 1 && (await status(oP)) === "handed_over", "24 h after the ready date, with the photo, the clock finishes it");
const pP = await payout(oP);
ok(pP?.status === "pending" && pP?.items_cents === 1800 && pP?.amount_cents === 1800 && pP?.debt_cents === 0,
  "the shop is owed its full item price (the buyer's fee and the tax are not the shop's)");
ok(one(await svc(`SELECT confirmed_how FROM public.shop_handovers WHERE order_id = '${oP}'`)) === "auto", "recorded as finished by the clock");
const oP2 = await charged();
await pastDue(oP2);
ok(Number(await sweep()) === 0 && (await status(oP2)) === "accepted", "left out WITHOUT the ready photo: the clock never finishes it");
ok(one(await member(BUYER, `SELECT public.shops_confirm_pickup('${oP2}')`))?.result === "handed_over", "the buyer's \"I got it\" finishes it");
ok(one(await member(BUYER, `SELECT public.shops_confirm_pickup('${oP2}')`))?.result === "already_handed_over", "a second tap is a no-op");
ok(refused(await member(BUYER, `SELECT public.shops_report_not_received('${oP2}', 'late')`), /order_not_open/, "55000"),
  "once the buyer said \"I got it\" the order is final: no report after it");
ok(Number(one(await svc(`SELECT count(*) FROM public.shop_payouts WHERE order_id = '${oP2}'`))) === 1, "one payout per order, ever");

// --- 3. in person: the BUYER must confirm ("I got it") or the clock finishes it.
// Owner 2026-10-18 ~21:00Z: the shop's own "Picked up" NEVER completes an order.
await member(OWNER, `SELECT public.shops_set_handover_mode('in_person')`);
const oI = await charged();
ok(refused(await member(ORDINARY, `SELECT public.shops_confirm_pickup('${oI}')`), /order_not_found|feature/), "a stranger cannot finish it");
ok(refused(await member(OWNER, `SELECT public.shops_confirm_pickup('${oI}')`), /order_not_found/, "P0002"), "the shop cannot tap the buyer's \"I got it\"");
ok(one(await member(OWNER, `SELECT public.shops_mark_ready('${oI}', NULL)`))?.result === "ready", "in person: ready without a photo");
ok(one(await member(BUYER, `SELECT public.shops_confirm_pickup('${oI}')`))?.result === "handed_over"
  && one(await svc(`SELECT confirmed_how FROM public.shop_handovers WHERE order_id = '${oI}'`)) === "buyer",
  "in person: the buyer's \"I got it\" finishes it");
const pI = (await svc(`SELECT status, next_attempt_at <= now() AS due FROM public.shop_payouts WHERE order_id = '${oI}'`))?.[0];
ok(pI?.status === "pending" && pI?.due === true, "after the buyer's \"I got it\" the shop is owed right away");
const oI2 = await charged();
ok(refused(await member(BUYER, `SELECT public.shops_report_not_received('${oI2}', 'early')`), /order_not_open/, "55000"),
  "the buyer cannot report before the ready date (nothing is due yet) unless the shop marked it ready");
ok(one(await member(OWNER, `SELECT public.shops_mark_ready('${oI2}', NULL)`))?.result === "ready", "the shop marks it ready");
await pastDue(oI2);
// GUARD: every member-callable shop function, called BY THE SHOP on its own due, ready, in-person
// order with every argument filled in, leaves the order unfinished and unpaid. Red on the old
// shops_mark_picked_up (MIGRATION_PATH=<bbeb5d877's migration>) and on any new shop "Picked up".
const lit = (t) => ({ uuid: `'${oI2}'::uuid`, text: `'Picked up'`, boolean: "true", integer: "1", bigint: "1", date: "current_date" })[t] ?? `NULL::${t}`;
const shopFns = await svc(`SELECT p.proname AS name, array(SELECT format_type(t, NULL) FROM unnest(p.proargtypes::oid[]) t) AS types
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname ~ '^shops?_' AND p.prokind = 'f'
   AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND 'uuid'::regtype = ANY (p.proargtypes::oid[])
 ORDER BY 1`);
const probed = [];
for (const f of Array.isArray(shopFns) ? shopFns : []) {
  await member(OWNER, `SELECT public.${f.name}(${f.types.map(lit).join(", ")})`);
  probed.push(f.name);
}
ok(probed.length >= 3 && probed.includes("shops_mark_ready") && probed.includes("shops_confirm_pickup"),
  `the probe reached the member shop functions that take an order (${probed.length}: ${probed.join(", ")})`);
ok((await status(oI2)) === "accepted"
  && one(await svc(`SELECT count(*) FROM public.shop_handovers WHERE order_id = '${oI2}' AND confirmed_at IS NOT NULL`)) === 0
  && Number(one(await svc(`SELECT count(*) FROM public.shop_payouts WHERE order_id = '${oI2}'`))) === 0,
  "NO member function lets the SHOP finish its own order: only the buyer's \"I got it\" or the clock does");
ok(refused(await svc(`SELECT public.shop_complete_handover('${oI2}', 'shop')`), /invalid_method/, "22023"),
  "the transition itself refuses 'shop' as the way an order was finished");
ok(refused(await svc(`UPDATE public.shop_handovers SET confirmed_at = now(), confirmed_how = 'shop' WHERE order_id = '${oI2}'`),
  /check constraint/), "and the table never records a shop-finished handover");
ok(one(await member(BUYER, `SELECT public.shops_report_not_received('${oI2}', 'I never got it')`))?.result === "reported",
  "from the ready date the buyer can say they did not get it");
ok(Number(one(await svc(`SELECT count(*) FROM public.notifications WHERE user_id IN ('${ADMIN}', '${ADMIN2}') AND title = 'Shops pickup problem reported'`))) === 2,
  "every admin is told of the report");
ok(Number(await sweep()) === 0 && (await status(oI2)) === "accepted", "a reported in-person order is never finished by the clock");
const oI3 = await charged();
await pastDue(oI3);
ok(Number(await sweep()) === 1 && (await status(oI3)) === "handed_over", "in person: the clock finishes it without any tap");
ok(Number(one(await svc(`SELECT count(*) FROM public.notifications WHERE user_id = '${BUYER}' AND title = 'Order finished' AND message LIKE '%on its own 24 hours%'`))) >= 1,
  "the clock's finish is not called a pickup (money review of 201265b4c)");

// --- 4. the buyer did not get it: no clock, no payout, until Louisiana Helpr decides
const oX = await charged();
await pastDue(oX);
ok(refused(await member(BUYER, `SELECT public.shops_report_not_received('${oX}', 'Call me 337 555 1234')`), /Phone number detected/),
  "contact details are refused in the note");
ok(refused(await member(OWNER, `SELECT public.shops_report_not_received('${oX}', 'x')`), /order_not_found/, "P0002"), "only the buyer reports it");
ok(one(await member(BUYER, `SELECT public.shops_report_not_received('${oX}', 'Nobody was there')`))?.result === "reported", "the buyer reports it");
ok(refused(await member(OWNER, `SELECT public.shops_mark_ready('${oX}', NULL)`), /problem_open/, "55000"), "the shop cannot mark a reported order ready (no false 'ready' to the buyer)");
ok(Number(await sweep()) === 0 && (await status(oX)) === "accepted", "a reported order is never finished by the clock");
ok(refused(await member(BUYER, `SELECT public.shops_confirm_pickup('${oX}')`), /problem_open/, "55000"), "nor by the buyer's tap (an admin decides)");
ok(refused(await member(BUYER, `SELECT public.shop_complete_handover('${oX}', 'admin')`), /permission denied/), "members cannot call the transition");
ok(one(await svc(`SELECT public.shop_complete_handover('${oX}', 'admin')`))?.result === "handed_over", "an admin decision can hand it over");

// --- 5. the shop's card-fee debt comes out first (one ledger with Declutter)
await svc(`INSERT INTO public.declutter_seller_fee_debts (seller_id, amount_cents, remaining_cents) VALUES ('${OWNER}', 500, 500)`);
const oD = await charged();
await member(BUYER, `SELECT public.shops_confirm_pickup('${oD}')`);
const pD = await payout(oD);
ok(pD?.debt_cents === 500 && pD?.amount_cents === 1300 && pD?.status === "pending", "a 500-cent debt comes out of an 1800-cent payout");
ok(Number(one(await svc(`SELECT sum(remaining_cents) FROM public.declutter_seller_fee_debts WHERE seller_id = '${OWNER}'`))) === 0
  && one(await svc(`SELECT payout_ref FROM public.declutter_fee_debt_deductions`)) === `shop_order_${oD}`,
  "the debt is paid off, recorded against this order");
await svc(`INSERT INTO public.declutter_seller_fee_debts (seller_id, amount_cents, remaining_cents) VALUES ('${OWNER}', 5000, 5000)`);
const oD2 = await charged();
await member(BUYER, `SELECT public.shops_confirm_pickup('${oD2}')`);
const pD2 = await payout(oD2);
ok(pD2?.status === "nothing_due" && pD2?.amount_cents === 0 && pD2?.debt_cents === 1800, "a debt bigger than the sale takes it all (nothing_due)");
ok(refused(await svc(`UPDATE public.shop_payouts SET amount_cents = 1800 WHERE id = '${pD2.id}'`), /shop_payouts_amount|shop_payouts_nothing_due/),
  "the payout amount is a table CHECK");

// --- 6. the payout queue and its bookkeeping (service only)
const due = await svc(`SELECT * FROM public.shop_payouts_due(100)`);
const dueIds = new Set((due ?? []).map((d) => d.order_id));
ok(Array.isArray(due) && dueIds.has(oP) && dueIds.has(oX) && dueIds.has(oD) && !dueIds.has(oD2),
  "the queue offers every pending payout, never a nothing_due one");
const dP = due.find((d) => d.order_id === oP);
ok(dP?.stripe_account_id === "acct_s" && dP?.payment_intent_id?.startsWith("pi_m2_") && dP?.livemode === false
  && dP?.checkout_session_id?.startsWith("cs_test_m2_") && dP?.amount_cents === 1800,
  "a queue row carries the shop's payout account, the order's payment and its Stripe mode");
ok(refused(await member(OWNER, `SELECT * FROM public.shop_payouts_due(10)`), /permission denied/), "members cannot read the queue");
ok(refused(await member(OWNER, `SELECT public.shop_payout_executed('${dP.payout_id}', 'tr_x', true, NULL)`), /permission denied/), "members cannot record a transfer");
ok(refused(await svc(`SELECT public.shop_payout_executed('${dP.payout_id}', NULL, true, NULL)`), /invalid_transfer/, "22023"), "a success needs a transfer id");
const dX = due.find((d) => d.order_id === oX);
ok(one(await svc(`SELECT public.shop_payout_executed('${dX.payout_id}', NULL, false, 'card declined')`)) === "failed"
  && !(await svc(`SELECT order_id FROM public.shop_payouts_due(100)`)).some((d) => d.order_id === oX),
  "a failed transfer backs off (not offered again at once)");
ok(one(await svc(`SELECT public.shop_payout_executed('${dP.payout_id}', 'tr_m2_1', true, NULL)`)) === "succeeded", "a transfer is recorded");
ok(one(await svc(`SELECT public.shop_payout_executed('${dP.payout_id}', 'tr_m2_2', true, NULL)`)) === "succeeded"
  && one(await svc(`SELECT stripe_transfer_id FROM public.shop_payouts WHERE id = '${dP.payout_id}'`)) === "tr_m2_1",
  "a succeeded payout is final (a replay never records a second transfer)");

// --- 7. who reads what
ok(Number(one(await member(OWNER, `SELECT count(*) FROM public.shop_payouts`))) >= 5, "the shop reads its own payouts");
ok(Number(one(await member(BUYER, `SELECT count(*) FROM public.shop_payouts`))) === 0, "the buyer reads no payout");
ok(Number(one(await member(BUYER, `SELECT count(*) FROM public.shop_handovers WHERE order_id = '${oP}' AND ready_photo_path IS NOT NULL`))) === 1
  && Number(one(await member(ORDINARY, `SELECT count(*) FROM public.shop_handovers`))) === 0,
  "the buyer sees the ready photo; a stranger sees no handover");
ok(refused(await member(OWNER, `SELECT last_error FROM public.shop_payouts`), /permission denied/), "the transfer error text is ours, not the member's");
const acc = async (uid, path, w) => one(await member(uid, `SELECT public.shop_handover_photo_access('${path}', ${w})`));
const oOpen = await charged();
ok(await acc(OWNER, `${OWNER}/shops/handover/${oOpen}/x.jpg`, true) === true, "the shop may upload a ready photo for its charged order");
ok(await acc(BUYER, `${BUYER}/shops/handover/${oOpen}/x.jpg`, true) === false, "the buyer may not upload one");
ok(await acc(OWNER, `${OWNER}/shops/handover/${oP}/y.jpg`, true) === false, "no upload once the order is handed over");
ok(await acc(OWNER, `${OWNER}/shops/handover/${oOpen}/x.jpg/z`, true) === false, "no extra path segments");
ok(await acc(BUYER, pOwner, false) === true && await acc(ORDINARY, pOwner, false) === false, "the buyer reads the photo, a stranger does not");
ok(one(await svc(`SELECT public FROM storage.buckets WHERE id = 'shop-handover'`)) === false, "the bucket is private");
for (const fn of ["shop_complete_handover", "shop_handover_sweep", "shop_payouts_due", "shop_payout_executed"]) {
  const acl = one(await svc(`SELECT array_to_string(proacl, ',') FROM pg_proc WHERE proname = '${fn}'`)) ?? "";
  ok(!skip && !/(^|,)(anon|authenticated)=/.test(acl) && !/(^|,)=X/.test(acl) && /service_role=X/.test(acl), `${fn}: service_role only (${acl})`);
}
for (const fn of ["shops_mark_ready", "shops_confirm_pickup", "shops_report_not_received", "shops_set_handover_mode"]) {
  const acl = one(await svc(`SELECT array_to_string(proacl, ',') FROM pg_proc WHERE proname = '${fn}'`)) ?? "";
  ok(!skip && !/(^|,)anon=/.test(acl) && !/(^|,)=X/.test(acl) && /authenticated=X/.test(acl), `${fn}: members, never anon (${acl})`);
}
ok(refused(await svc(`UPDATE public.shop_orders SET status = 'handed_over', handed_over_at = now() WHERE id = '${oHeld}'`), /shop_orders_handed_over_captured|shop_orders_held_has/),
  "an order never charged cannot be marked handed over (table CHECK)");
ok(Number(one(await svc(`SELECT count(*) FROM public.cron_defects`))) === 0, "the clock logged no defect");

// --- 8. when a buyer's cancel stops being free (O2; owner pop-up 2026-10-18 ~22:30Z, Q2155):
// "cancel any time before pickup" closes when the ready date begins or at the shop's ready tap, never at the handover.
const freeUntil = async (id) => one(await svc(`SELECT public.shop_order_free_cancel_until('${id}')::text AS t`));
const dayStart = async (id) => one(await svc(`SELECT ((ready_date::timestamp AT TIME ZONE 'America/Chicago'))::text FROM public.shop_orders WHERE id = '${id}'`));
const closed = async (id) => one(await svc(`SELECT COALESCE(public.shop_order_free_cancel_until('${id}') <= now(), true) AS c`)) === true;
await member(OWNER, `SELECT public.shops_set_handover_mode('in_person')`);
await member(OWNER, `SELECT public.shops_set_cancel_policy('until_handover')`);
const oC1 = await charged(BUYER, 1, D2);
ok(oC1 && one(await svc(`SELECT cancel_policy FROM public.shop_orders WHERE id = '${oC1}'`)) === "until_handover", "setup: an accepted, charged order under 'until_handover'");
ok(!skip && await freeUntil(oC1) === await dayStart(oC1) && !(await closed(oC1)),
  "until_handover: an accepted order cancels free until its ready date begins (not later)");
// The day before the ready date (Louisiana time): the ready date is tomorrow.
await svc(`UPDATE public.shop_orders SET ready_date = ((now() AT TIME ZONE 'America/Chicago')::date + 1) WHERE id = '${oC1}'`);
await member(OWNER, `SELECT public.shops_mark_ready('${oC1}', NULL)`);
const readyAt1 = one(await svc(`SELECT ready_at::text FROM public.shop_handovers WHERE order_id = '${oC1}'`));
ok(!skip && typeof readyAt1 === "string" && await freeUntil(oC1) === readyAt1 && await closed(oC1),
  "until_handover: the shop's ready tap on the day before the ready date (in person, no photo) closes free cancel at once");
// Owner 2026-10-19 ~01:30Z (Q2155): a ready tap counts only from the day before the ready date.
const oE = await charged(BUYER, 1, D2);
await svc(`UPDATE public.shop_orders SET ready_date = ((now() AT TIME ZONE 'America/Chicago')::date + 3) WHERE id = '${oE}'`);
await member(OWNER, `SELECT public.shops_mark_ready('${oE}', NULL)`);
const tappedE = one(await svc(`SELECT ready_at IS NOT NULL FROM public.shop_handovers WHERE order_id = '${oE}'`)) === true;
const dayBeforeE = one(await svc(`SELECT (((ready_date - 1)::timestamp AT TIME ZONE 'America/Chicago'))::text FROM public.shop_orders WHERE id = '${oE}'`));
ok(!skip && tappedE && !(await closed(oE)) && await freeUntil(oE) === dayBeforeE,
  "until_handover: an early ready tap (3 days before the ready date) leaves free cancel open until the day before begins (M2's window closed it at the tap)");
const oC2 = await charged(BUYER, 1, D2);
await svc(`UPDATE public.shop_orders SET ready_date = ((now() AT TIME ZONE 'America/Chicago')::date - 1) WHERE id = '${oC2}'`);
ok(!skip && await closed(oC2) && one(await svc(`SELECT status FROM public.shop_orders WHERE id = '${oC2}'`)) === "accepted",
  "until_handover: once the ready date began, free cancel is closed though nobody tapped ready and the buyer never confirmed (the old until-pickup window stayed open)");
const oC3 = await charged(BUYER, 1, D2);
await member(BUYER, `SELECT public.shops_confirm_pickup('${oC3}')`);
ok(!skip && await status(oC3) === "handed_over" && await freeUntil(oC3) === "-infinity" && await closed(oC3),
  "until_handover: an early \"I got it\" (before the ready date, no ready tap) closes free cancel (the shop is owed)");
await member(OWNER, `SELECT public.shops_set_cancel_policy('until_24h_before_ready')`);
const oC4 = await charged(BUYER, 1, D3);
await member(BUYER, `SELECT public.shops_confirm_pickup('${oC4}')`);
ok(!skip && await freeUntil(oC4) === "-infinity", "until_24h_before_ready: an early \"I got it\" closes it too");
const oC4b = await charged(BUYER, 1, D4);
ok(!skip && await freeUntil(oC4b) === one(await svc(`SELECT ((ready_date::timestamp AT TIME ZONE 'America/Chicago') - interval '24 hours')::text FROM public.shop_orders WHERE id = '${oC4b}'`)),
  "until_24h_before_ready: 24 hours before the ready date begins");
await member(OWNER, `SELECT public.shops_set_cancel_policy('until_accept')`);
const oC5 = await charged(BUYER, 1, D3);
ok(!skip && await freeUntil(oC5) === one(await svc(`SELECT accepted_at::text FROM public.shop_orders WHERE id = '${oC5}'`)) && await closed(oC5),
  "until_accept: the shop's accept");
ok(!skip && await freeUntil("00000000-0000-0000-0000-00000000c0de") === null, "no such order: NULL (closed)");
const oC6 = one(await request(BUYER, lines([itemA, 1]), D4))?.order_id;
ok(!skip && typeof oC6 === "string" && await freeUntil(oC6) === "-infinity", "an order the shop has not accepted has no window here (its hold just drops)");
const aclFree = one(await svc(`SELECT array_to_string(proacl, ',') FROM pg_proc WHERE proname = 'shop_order_free_cancel_until'`)) ?? "";
ok(!skip && !/(^|,)(anon|authenticated)=/.test(aclFree) && !/(^|,)=X/.test(aclFree) && /service_role=X/.test(aclFree),
  `shop_order_free_cancel_until: service_role only (${aclFree})`);

// --- 9. THE SHOP DECIDES what an early ready tap does to free cancel (owner pop-up 2026-10-19: "LET THE SHOPS
// DECIDE THIS."; Q2155). shops.ready_tap_cancel, the shop's own choice, frozen on each order at insert.
const tapChoice = async (shop) => one(await svc(`SELECT ready_tap_cancel FROM public.shops WHERE id = '${shop}'`));
const orderChoice = async (id) => one(await svc(`SELECT ready_tap_cancel FROM public.shop_orders WHERE id = '${id}'`));
const readyIn = async (id, days) => svc(`UPDATE public.shop_orders SET ready_date = ((now() AT TIME ZONE 'America/Chicago')::date + ${days}) WHERE id = '${id}'`);
const readyAt = async (id) => one(await svc(`SELECT ready_at::text FROM public.shop_handovers WHERE order_id = '${id}'`));
const dayBefore = async (id) => one(await svc(`SELECT (((ready_date - 1)::timestamp AT TIME ZONE 'America/Chicago'))::text FROM public.shop_orders WHERE id = '${id}'`));
await member(OWNER, `SELECT public.shops_set_cancel_policy('until_handover')`);
ok(!skip && await tapChoice(shopA) === "from_day_before" && await tapChoice(shopB) === "from_day_before",
  "a shop's default is 'from the day before' (the behaviour built before the choice)");
const termsT = one(await member(BUYER, `SELECT public.shops_order_terms('${shopA}')`));
ok(!skip && termsT?.ready_tap_cancel === "from_day_before" && termsT?.cancel_policy === "until_handover",
  "the buyer reads the shop's choice before paying (shops_order_terms)");
ok(refused(await member(OWNER, `SELECT public.shops_set_ready_tap_cancel('whenever')`), /invalid_ready_tap_cancel/, "22023")
  && refused(await member(OWNER, `SELECT public.shops_set_ready_tap_cancel(NULL)`), /invalid_ready_tap_cancel/, "22023"),
  "only the three choices");
ok(refused(await svc(`UPDATE public.shops SET ready_tap_cancel = 'whenever' WHERE id = '${shopA}'`), /shops_ready_tap_cancel_check/),
  "the table refuses anything else (CHECK)");
ok(one(await svc(`SELECT bool_and(convalidated) FROM pg_constraint WHERE conname IN ('shops_ready_tap_cancel_check', 'shop_orders_ready_tap_cancel_check')`)) === true
  && Number(one(await svc(`SELECT count(*) FROM pg_constraint WHERE conname IN ('shops_ready_tap_cancel_check', 'shop_orders_ready_tap_cancel_check')`))) === 2,
  "both CHECKs exist and are validated (never NOT VALID)");
// Authz: only the shop's OWNER sets it, for its OWN shop.
// The buyer (in the 'shops' cohort, no shop of their own) is refused by the RPC's own-shop write, not the switch.
const ordinaryT = await member(BUYER, `SELECT public.shops_set_ready_tap_cancel('ends_at_tap')`);
ok(!skip && refused(ordinaryT, /^shop_not_found$/, "P0002") && await tapChoice(shopA) === "from_day_before",
  "a member without a shop cannot set it (refused; the shop is unchanged)");
ok(!skip && one(await member(ADMIN, `SELECT public.shops_set_ready_tap_cancel('ends_at_tap')`)) === "ends_at_tap"
  && await tapChoice(shopB) === "ends_at_tap" && await tapChoice(shopA) === "from_day_before",
  "another shop's owner sets only their own shop, never this one");
await member(ADMIN, `SELECT public.shops_set_ready_tap_cancel('from_day_before')`);
ok(refused(await member(OWNER, `UPDATE public.shops SET ready_tap_cancel = 'ends_at_tap' WHERE id = '${shopA}'`), /permission denied/),
  "not even the owner writes the column directly (only through the RPC)");
const aclT = one(await svc(`SELECT array_to_string(proacl, ',') FROM pg_proc WHERE proname = 'shops_set_ready_tap_cancel'`)) ?? "";
ok(!skip && !/(^|,)anon=/.test(aclT) && !/(^|,)=X/.test(aclT) && /authenticated=X/.test(aclT), `shops_set_ready_tap_cancel: members, never anon (${aclT})`);

// (a) 'ends_at_tap': an early tap (3 days before the ready date) ends free cancel at the tap.
ok(!skip && one(await member(OWNER, `SELECT public.shops_set_ready_tap_cancel('ends_at_tap')`)) === "ends_at_tap", "the owner picks 'ends at the tap'");
const oTa = await charged(BUYER, 1, D3);
await readyIn(oTa, 3);
await member(OWNER, `SELECT public.shops_mark_ready('${oTa}', NULL)`);
ok(!skip && await orderChoice(oTa) === "ends_at_tap" && typeof (await readyAt(oTa)) === "string" && await freeUntil(oTa) === await readyAt(oTa) && await closed(oTa),
  "(a) ends at the tap: an early ready tap ends free cancel at once (the default kept it open until the day before)");
const oTa2 = await charged(BUYER, 1, D3);
ok(!skip && await freeUntil(oTa2) === await dayStart(oTa2) && !(await closed(oTa2)), "(a) with no tap: until the ready date begins");
// (c) 'never_shortens': a tap on the day before (or earlier) never shortens it; the ready date's start ends it.
await member(OWNER, `SELECT public.shops_set_ready_tap_cancel('never_shortens')`);
const oTc = await charged(BUYER, 1, D4);
await readyIn(oTc, 1);
await member(OWNER, `SELECT public.shops_mark_ready('${oTc}', NULL)`);
ok(!skip && await orderChoice(oTc) === "never_shortens" && typeof (await readyAt(oTc)) === "string" && await freeUntil(oTc) === await dayStart(oTc) && !(await closed(oTc)),
  "(c) never shortens: a ready tap on the day before leaves free cancel open until the ready date begins (the default closed it at the tap)");
const oTc2 = await charged(BUYER, 1, D4);
await readyIn(oTc2, -1);
ok(!skip && await closed(oTc2), "(c) once the ready date began, free cancel is closed");
// (b) 'from_day_before' (default): an early tap counts from the day before; a day-before tap ends it at the tap.
await member(OWNER, `SELECT public.shops_set_ready_tap_cancel('from_day_before')`);
const oTb = await charged(BUYER, 1, D5);
await readyIn(oTb, 3);
await member(OWNER, `SELECT public.shops_mark_ready('${oTb}', NULL)`);
ok(!skip && await orderChoice(oTb) === "from_day_before" && await freeUntil(oTb) === await dayBefore(oTb) && !(await closed(oTb)),
  "(b) from the day before: an early ready tap leaves free cancel open until the day before begins");
const oTb2 = await charged(BUYER, 1, D5);
await readyIn(oTb2, 1);
await member(OWNER, `SELECT public.shops_mark_ready('${oTb2}', NULL)`);
ok(!skip && await freeUntil(oTb2) === await readyAt(oTb2) && await closed(oTb2), "(b) a tap on the day before ends it at the tap");
// Frozen: the shop switching later never moves an order already asked for, and nobody rewrites the order's copy.
await member(OWNER, `SELECT public.shops_set_ready_tap_cancel('ends_at_tap')`);
ok(!skip && await orderChoice(oTb) === "from_day_before" && await orderChoice(oTc) === "never_shortens" && await freeUntil(oTb) === await dayBefore(oTb),
  "a later switch of the shop's choice never changes an order already placed (the buyer paid under its terms)");
ok(!skip && refused(await svc(`UPDATE public.shop_orders SET ready_tap_cancel = 'ends_at_tap' WHERE id = '${oTb}'`), /ready_tap_cancel_frozen/, "55000"),
  "the order's copy is frozen (even the service role cannot rewrite it)");
await member(OWNER, `SELECT public.shops_set_ready_tap_cancel('from_day_before')`);
await member(OWNER, `SELECT public.shops_set_cancel_policy('until_24h_before_ready')`);
const oTx = await charged(BUYER, 1, D5);
await readyIn(oTx, 3);
await member(OWNER, `SELECT public.shops_mark_ready('${oTx}', NULL)`);
ok(!skip && await freeUntil(oTx) === one(await svc(`SELECT ((ready_date::timestamp AT TIME ZONE 'America/Chicago') - interval '24 hours')::text FROM public.shop_orders WHERE id = '${oTx}'`)),
  "the choice changes nothing under the other presets (24 hours before: a ready tap is ignored)");

console.log(`\n${pass} PASS, ${fail} FAIL${skip ? " (NEW_MIGRATION=skip)" : ""}`);
process.exit(fail === 0 ? 0 : 1);
