#!/usr/bin/env node
/**
 * PGlite proof for 20261019071055_shops_refunds_cancels_strikes (Shops M3:
 * refunds, cancels and strikes; docs/specs/local-shops-prep.md L41-L43, L75,
 * O2, O3; owner 2026-10-18: no-show = late cancel + buyer strike, shop cancel =
 * full refund + card fee billed + shop strike, never absorb a fee, our mistake
 * full, Shops' own strike count).
 *
 *   node src/test/pglite/shopsRefunds.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/shopsRefunds.pglite.mjs   # RED: every check fails
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/shopsRefunds.pglite.mjs
 *
 * Setup copied from shopsHandoverPayout.pglite.mjs (prod-shaped stubs, shops
 * slices 1-2, categories v2, M1 + its strike count, Declutter's fee-debt ledger,
 * M2 + the two free-cancel migrations ONCE as prod has them), then this
 * migration 3x.
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
const M2 = readFileSync(`${MIG_DIR}20261018211820_shops_handover_payout.sql`, "utf8");
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}20261019071055_shops_refunds_cancels_strikes.sql`, "utf8");
// The readiness held-for-review admin tools taught the Shops refund (run 3), applied after it.
const HELD_TOOLS = readFileSync(process.env.HELD_TOOLS_PATH ?? `${MIG_DIR}20261019112103_shops_held_for_review_admin_tools.sql`, "utf8");
const FREE_CANCEL = readFileSync(`${MIG_DIR}20261019013802_shop_free_cancel_ready_tap_day_before.sql`, "utf8");
const READY_TAP = readFileSync(`${MIG_DIR}20261019015018_shop_ready_tap_cancel_choice.sql`, "utf8");
const SLICE1 = readFileSync(`${MIG_DIR}20261017061155_shops_profiles.sql`, "utf8");
const SWITCHES = readFileSync(`${MIG_DIR}20261012031120_hidden_feature_switches.sql`, "utf8");
const DECLUTTER = readFileSync(`${MIG_DIR}20261014193955_declutter_foundation.sql`, "utf8");

/** The newest CREATE [OR REPLACE] FUNCTION public.<name>( statement in the migrations, any dollar tag. */
function newestDefinition(name) {
  let found = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && !x.startsWith("20261017061155") && !x.startsWith("20261017061157") && !x.startsWith("20261018164442") && !x.startsWith("20261018211820") && !x.startsWith("20261019")).sort()) {
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
  ban_status text DEFAULT 'active', auto_suspended_until timestamptz, under_13_blocked_at timestamptz,
  idv_status text, stripe_identity_verified boolean NOT NULL DEFAULT false,
  email_verified boolean NOT NULL DEFAULT true, background_check_status text);
CREATE TABLE public.helper_credentials (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
  credential_type text NOT NULL, status text NOT NULL DEFAULT 'pending', expiration_date date, license_number text);
CREATE TABLE public.reviews (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, reviewer_id uuid, reviewee_id uuid NOT NULL,
  rating integer NOT NULL, status text NOT NULL DEFAULT 'published', feedback_visible_at timestamptz);
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid, helper_id uuid, status text NOT NULL,
  date_needed date, start_time time, helper_arrived_at timestamptz, revision_count integer DEFAULT 0, is_group_job boolean DEFAULT false, is_seed boolean DEFAULT false);
CREATE TABLE public.group_job_helpers (job_id uuid, helper_id uuid, helper_arrived_at timestamptz);
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text NOT NULL, handed_over_at timestamptz,
  is_seed boolean NOT NULL DEFAULT false); -- read by get_public_profile_stats (newest), loaded before the ALTER below
CREATE TABLE public.declutter_reviews (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL, reviewer_id uuid,
  reviewee_id uuid, reviewer_side text NOT NULL, stars smallint NOT NULL, is_seed boolean NOT NULL DEFAULT false);
CREATE FUNCTION public.seed_hidden_from_caller() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE TABLE public.platform_settings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), feature_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz DEFAULT now());
INSERT INTO public.platform_settings (feature_flags) VALUES ('{}'::jsonb);
CREATE TABLE public.cron_defects (fn text, ref text, msg text);
CREATE FUNCTION public.log_cron_defect(f text, r text, m text, c jsonb DEFAULT NULL) RETURNS void LANGUAGE sql AS $f$ INSERT INTO public.cron_defects VALUES (f, r, m) $f$;
CREATE FUNCTION public.seed_review_hidden(uuid, uuid, uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.is_test_member(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
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
// Stubbed, and said so: declutter_notify_strict (the newest declutter_notify wraps it, 20261028162048) writes the bell
// row only. Its link and preference helpers are not what this proof checks; without it every notice here was swallowed
// into cron_defects and the facilitator alert counted 0 notices.
await db.exec(`CREATE FUNCTION public.declutter_notify_strict(p_user uuid, p_type text, p_title text, p_message text, p_link text,
  p_other uuid DEFAULT NULL) RETURNS void LANGUAGE sql AS $f$
  INSERT INTO public.notifications (user_id, type, title, message, link) VALUES (p_user, p_type, p_title, p_message, p_link) $f$;`);
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

// M2 and the two free-cancel migrations, once, as prod has them.
await db.exec(M2);
await db.exec(FREE_CANCEL);
await db.exec(READY_TAP);
// The payout holds table (20261004162921), read by the admin queue.
await db.exec(`CREATE TABLE public.payout_holds (helper_id uuid PRIMARY KEY, reason text NOT NULL, held_by uuid,
  held_at timestamptz NOT NULL DEFAULT now(), denied_reason text, denied_by uuid, denied_at timestamptz);`);
// Declutter's item total and seed flag (20261014210518), read by the facilitator counter.
await db.exec(`ALTER TABLE public.declutter_orders ADD COLUMN items_cents integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS is_seed boolean NOT NULL DEFAULT false;`);
// Payout readiness (20261019070737), as prod has it under this migration: a shop payout can be
// held for review (only an admin moves it on).
await db.exec(`ALTER TABLE public.shop_payouts DROP CONSTRAINT IF EXISTS shop_payouts_status_check;
ALTER TABLE public.shop_payouts ADD CONSTRAINT shop_payouts_status_check
  CHECK (status IN ('pending', 'succeeded', 'failed', 'nothing_due', 'held_for_review', 'settled_by_hand'));
ALTER TABLE public.shop_payouts ADD COLUMN review_reason text, ADD COLUMN review_held_at timestamptz,
  ADD COLUMN settled_by_hand_ref text, ADD COLUMN settled_by_hand_cents integer, ADD COLUMN settled_by_hand_note text,
  ADD COLUMN held_notified_at timestamptz;
-- The other held-for-review kinds, as the admin tools read them (shapes from payoutWaitsForPayee.pglite.mjs).
ALTER TABLE public.declutter_orders ADD COLUMN buyer_id uuid;
CREATE TABLE public.declutter_payouts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, seller_id uuid, amount_cents integer,
  status text, stripe_transfer_id text, review_reason text, review_held_at timestamptz, held_notified_at timestamptz,
  settled_by_hand_ref text, settled_by_hand_cents integer, settled_by_hand_note text, executed_at timestamptz);
CREATE TABLE public.helpr_tasks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_kind text, source_id uuid);
CREATE TABLE public.helpr_task_payouts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid, helpr_id uuid, amount_cents integer,
  status text, stripe_transfer_id text, review_reason text, review_held_at timestamptz, held_notified_at timestamptz,
  settled_by_hand_ref text, settled_by_hand_cents integer, settled_by_hand_note text, executed_at timestamptz);
CREATE TABLE public.declutter_refunds (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, stripe_payment_intent_id text,
  refund_cents integer, status text, stripe_refund_ref text, payment_livemode boolean, is_seed boolean NOT NULL DEFAULT false,
  review_reason text, review_held_at timestamptz, held_notified_at timestamptz,
  settled_by_hand_ref text, settled_by_hand_cents integer, settled_by_hand_note text, executed_at timestamptz);
CREATE TABLE public.declutter_delivery_refunds (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, stripe_payment_intent_id text,
  refund_cents integer, status text, stripe_refund_ref text, is_seed boolean NOT NULL DEFAULT false,
  review_reason text, review_held_at timestamptz, held_notified_at timestamptz,
  settled_by_hand_ref text, settled_by_hand_cents integer, settled_by_hand_note text, executed_at timestamptz);
CREATE TABLE public.declutter_hand_refunds (stripe_refund_id text PRIMARY KEY, stripe_payment_intent_id text NOT NULL,
  order_id uuid, refund_row_id uuid, amount_cents integer NOT NULL, livemode boolean NOT NULL, hand_outcome text NOT NULL, failed_at timestamptz);
CREATE TABLE public.payout_payee_waits (payout_kind text NOT NULL, payout_id uuid NOT NULL, ops_paged_at timestamptz, paged_category text);
CREATE TABLE public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text, message text, tags jsonb, context jsonb,
  created_at timestamptz NOT NULL DEFAULT now());`);
{ // and its money_ref_in_use (every text column holding a Stripe transfer / refund id), verbatim.
  const ready = readFileSync(`${MIG_DIR}20261019070737_payout_waits_for_payee_setup.sql`, "utf8");
  const i = ready.indexOf("CREATE OR REPLACE FUNCTION public.money_ref_in_use(");
  const j = ready.indexOf("$fn$;", ready.indexOf("AS $fn$", i) + 7);
  await db.exec(ready.slice(i, j + 5));
  // and its settle ledger, verbatim (this migration widens its row_kind CHECK).
  const t = ready.indexOf("CREATE TABLE IF NOT EXISTS public.payout_settlements (");
  await db.exec(ready.slice(t, ready.indexOf(");", t) + 2));
}
const skip = process.env.NEW_MIGRATION === "skip";
if (!skip) {
  for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
  for (let i = 0; i < 3; i++) await db.exec(HELD_TOOLS);
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

// A charged order with sales tax (Stripe Tax's figure on the completed page).
const chargedTax = async (buyer = BUYER, ls = lines([itemA, 1]), day = D1, tax = 150, fee = 50) => {
  n++;
  const raw = await member(buyer, `SELECT public.shops_request_order('${shopA}', ${ls}, '${day}', '') AS r`);
  const r = one(raw);
  const id = r?.order_id;
  if (!id) { console.log("  setup: order refused", JSON.stringify(raw)); return null; }
  await svc(`SELECT public.shop_attach_checkout_session('${id}', 'cs_test_m3_${n}')`);
  await svc(`SELECT public.shop_mark_order_held('cs_test_m3_${n}', 'pi_m3_${n}', ${r.items_cents + r.premium_cents + tax}, ${tax}, false)`);
  await member(OWNER, `SELECT public.shops_accept_order('${id}')`);
  await svc(`SELECT public.shop_order_captured('${id}', ${fee})`);
  return id;
};
const order = async (id) => (await svc(`SELECT * FROM public.shop_orders WHERE id = '${id}'`))?.[0];
const refund = async (id) => (await svc(`SELECT * FROM public.shop_refunds WHERE order_id = '${id}'`))?.[0];
const debts = async (seller) => (await svc(`SELECT * FROM public.declutter_seller_fee_debts WHERE seller_id = '${seller}' ORDER BY created_at`)) ?? [];
const strikes = async (uid) => Number(one(await svc(`SELECT public.shop_active_strike_count('${uid}')`)));
const notes = async (uid, title) => Number(one(await svc(`SELECT count(*) FROM public.notifications WHERE user_id = '${uid}' AND title = '${title}'`)));
const stockB = async () => Number(one(await svc(`SELECT stock_count FROM public.shop_items WHERE id = '${itemB}'`)));
const pastReady = async (id, days = 1) => svc(`UPDATE public.shop_orders SET ready_date = ((now() AT TIME ZONE 'America/Chicago')::date - ${days}) WHERE id = '${id}'`);
const cancel = (uid, id, expect) => member(uid, `SELECT public.shops_buyer_cancel_order('${id}', '${expect}') AS r`);

// --- 1. buyer cancel INSIDE the window (default preset: free until 24 h before the ready date)
const oF = await chargedTax(BUYER, lines([itemA, 1], [itemB, 1]));
const fRow = await order(oF);
ok(fRow?.status === "accepted" && fRow.captured_at && fRow.total_cents === 1800 + 2500 + 285 + 150, "setup: an accepted, charged, taxed order");
const q = one(await member(BUYER, `SELECT public.shops_order_cancel_quote('${oF}')`));
const taxKept = Math.ceil((50 * 150) / (fRow.total_cents - 150));
ok(q?.can_cancel === true && q.free === true && q.refund_cents === fRow.total_cents - 50 - taxKept && q.kept_cents === 50 + taxKept,
  "the buyer's quote: free, the price back less the card fee and the tax on it (J3)");
ok(refused(await member(ORDINARY, `SELECT public.shops_order_cancel_quote('${oF}')`), /order_not_found/, "P0002"), "only the buyer reads the quote");
ok(refused(await cancel(BUYER, oF, "late"), /cancel_terms_changed/, "55000") && (await order(oF)).status === "accepted",
  "a screen that showed the wrong window changes nothing (cancel_terms_changed)");
ok(refused(await cancel(ORDINARY, oF, "free"), /order_not_found/, "P0002"), "another member cannot cancel it");
ok(refused(await cancel(OWNER, oF, "free"), /order_not_found/, "P0002"), "the shop cannot use the buyer's cancel");
ok(refused(await cancel(BUYER, oF, "maybe"), /invalid_expect/, "22023"), "expect is free or late");
const stockBefore = await stockB();
const fr = one(await cancel(BUYER, oF, "free"));
const fAfter = await order(oF);
const fRef = await refund(oF);
ok(fr?.result === "cancelled_free" && fr.refund_id === fRef?.id, "the free cancel answers with its refund row");
ok(fAfter.status === "refunded" && fAfter.close_reason === "buyer_cancelled_free" && fAfter.closed_at,
  "recorded on the order before commit: refunded, buyer_cancelled_free");
ok(fRef?.reason === "buyer_cancelled" && fRef.fee_policy === "keep_card_fee" && fRef.status === "pending"
  && fRef.paid_cents === fAfter.total_cents && fRef.kept_cents === 50 && fRef.tax_kept_cents === taxKept
  && fRef.refund_cents === fAfter.total_cents - 50 - taxKept && fRef.stripe_payment_intent_id === fAfter.stripe_payment_intent_id,
  "the refund keeps exactly Stripe's card fee and the sales tax on it, nothing more");
ok((await debts(OWNER)).length === 0, "a buyer's free cancel bills the shop nothing");
ok(await stockB() === stockBefore + 1, "the stock comes back");
ok(Number(one(await svc(`SELECT count(*) FROM public.shop_cottage_sales WHERE source_ref = '${oF}'`))) === 0,
  "the home-food sale leaves the yearly count (L8)");
ok(await notes(OWNER, "Order cancelled") >= 1 && await notes(BUYER, "Order cancelled") >= 1, "both sides are told");
ok(refused(await cancel(BUYER, oF, "free"), /order_not_open/, "55000"), "a second cancel is refused (one refund per order)");
ok(Number(one(await svc(`SELECT count(*) FROM public.shop_refunds WHERE order_id = '${oF}'`))) === 1, "exactly one refund row");
ok(one(await member(BUYER, `SELECT public.shops_order_cancel_quote('${oF}')`))?.can_cancel === false, "a closed order offers no cancel");

// --- 2. buyer cancel OUTSIDE the window: nothing back, the shop is paid
await member(OWNER, `SELECT public.shops_set_cancel_policy('until_accept')`);
const oL = await chargedTax(BUYER, lines([itemA, 1]), D2);
ok(one(await member(BUYER, `SELECT public.shops_order_cancel_quote('${oL}')`))?.free === false, "free until the accept: after it, the quote says late");
ok(refused(await cancel(BUYER, oL, "free"), /cancel_terms_changed/, "55000"), "a buyer expecting free is not charged by surprise");
const lr = one(await cancel(BUYER, oL, "late"));
const lAfter = await order(oL);
const lPay = await payout(oL);
ok(lr?.result === "cancelled_late" && lr.refund_id === null && lAfter.status === "cancelled" && lAfter.close_reason === "buyer_cancelled_late",
  "a late cancel closes the order as cancelled_late");
ok(!(await refund(oL)), "a late cancel refunds nothing (all kept, so all its tax is kept)");
ok(lPay?.status === "pending" && lPay.amount_cents === 1800 && lPay.items_cents === 1800, "the shop is owed its items");
ok((await svc(`SELECT order_id FROM public.shop_payouts_due(50)`)).some((r) => r.order_id === oL), "the payout queue sends it");
await member(OWNER, `SELECT public.shops_set_cancel_policy('until_24h_before_ready')`);

// --- 3. the shop cancels an accepted order (L42): full refund, card fee billed, shop strike
const oS = await chargedTax(BUYER, lines([itemB, 1]), D3, 200, 80);
ok(refused(await member(ORDINARY, `SELECT public.shops_shop_cancel_order('${oS}', NULL)`), /order_not_found/, "P0002"), "another member cannot cancel the shop's order");
ok(refused(await member(BUYER, `SELECT public.shops_shop_cancel_order('${oS}', NULL)`), /order_not_found/, "P0002"), "the buyer cannot use the shop's cancel");
ok(refused(await member(OWNER, `SELECT public.shops_shop_cancel_order('${oS}', 'call me 337-555-1212')`), /contact|phone/i), "the reason is contact-leak filtered");
const sStock = await stockB();
const sr = one(await member(OWNER, `SELECT public.shops_shop_cancel_order('${oS}', 'Oven broke') AS r`));
const sAfter = await order(oS);
const sRef = await refund(oS);
const sDebt = (await debts(OWNER)).find((d) => d.shop_refund_id === sRef?.id);
ok(sr?.result === "cancelled" && sAfter.status === "refunded" && sAfter.close_reason === "shop_cancelled", "the order is refunded as shop_cancelled");
ok(sRef?.fee_policy === "full_shop_pays_fee" && sRef.refund_cents === sAfter.total_cents && sRef.kept_cents === 0 && sRef.tax_kept_cents === 0,
  "the buyer gets EVERYTHING back, tax included");
ok(sDebt?.amount_cents === 80 && sDebt.remaining_cents === 80 && sDebt.refund_id === null, "Stripe's card fee is the shop's fee debt (the one shared ledger)");
ok(await strikes(OWNER) === 1, "the shop gets a Shops strike");
ok(Number(one(await svc(`SELECT count(*) FROM public.declutter_strikes WHERE user_id = '${OWNER}'`))) === 0, "never a Declutter strike (per section)");
ok(await stockB() === sStock + 1, "the stock comes back");
ok(await notes(BUYER, "Order cancelled by the shop") === 1, "the buyer is told");
// The debt comes out of the shop's next payout.
const oNext = await chargedTax(BUYER, lines([itemA, 1]), D4, 0, 50);
await member(BUYER, `SELECT public.shops_confirm_pickup('${oNext}')`);
ok((await payout(oNext))?.debt_cents === 80 && (await payout(oNext))?.amount_cents === 1720, "the next payout pays the debt first");

// --- 4. buyer no-show (O3): a late cancel + a buyer strike, in-person orders, after the ready date
const oN = await chargedTax(BUYER, lines([itemA, 1]), D1, 0);
// /code-review of shops-m3-v1 #2: only an order the shop marked ready can be a no-show.
await pastReady(oN, 1);
ok(refused(await member(OWNER, `SELECT public.shops_report_no_show('${oN}')`), /not_ready/, "55000")
  && (await order(oN)).status === "accepted" && await strikes(BUYER) === 0,
  "a shop that never marked the order ready cannot report a no-show (not_ready): no strike, nothing paid");
await svc(`INSERT INTO public.shop_handovers (order_id, ready_at) VALUES ('${oN}', now() - interval '30 hours')`);
await svc(`UPDATE public.shop_orders SET ready_date = ((now() AT TIME ZONE 'America/Chicago')::date + 1) WHERE id = '${oN}'`);
ok(refused(await member(OWNER, `SELECT public.shops_report_no_show('${oN}')`), /too_early_for_no_show/, "55000"), "not before the ready date is over");
await pastReady(oN, 1);
ok(refused(await member(BUYER, `SELECT public.shops_report_no_show('${oN}')`), /order_not_found/, "P0002"), "only the shop reports a no-show");
const nr = one(await member(OWNER, `SELECT public.shops_report_no_show('${oN}') AS r`));
const nAfter = await order(oN);
ok(nr?.result === "no_show" && nAfter.status === "cancelled" && nAfter.close_reason === "buyer_no_show" && !(await refund(oN)),
  "a no-show closes as a late cancel: nothing refunded");
ok((await payout(oN))?.status === "pending", "the shop is paid");
ok(await strikes(BUYER) === 1, "the buyer gets a Shops strike");
await member(OWNER, `SELECT public.shops_set_handover_mode('porch')`);
const oPorch = await chargedTax(BUYER, lines([itemA, 1]), D2, 0);
await pastReady(oPorch, 1);
ok(refused(await member(OWNER, `SELECT public.shops_report_no_show('${oPorch}')`), /not_in_person/, "55000"), "a left-out order cannot be a no-show");

// --- 5. the clock: a left-out order with no ready photo 3 days after its date (Q2155 a)
const oKeep = await chargedTax(BUYER, lines([itemA, 1]), D3, 0);
await svc(`UPDATE public.shop_orders SET ready_date = ((now() AT TIME ZONE 'America/Chicago')::date - 5) WHERE id IN ('${oPorch}', '${oKeep}')`);
await svc(`INSERT INTO public.shop_handovers (order_id, ready_photo_path, ready_at) VALUES ('${oKeep}', '${OWNER}/shops/handover/${oKeep}/a.jpg', now() - interval '5 days')`);
const swept = one(await svc(`SELECT public.shop_refund_sweep() AS r`));
ok(swept?.no_ready_photo_refunded === 1 && (await order(oPorch)).close_reason === "no_ready_photo"
  && (await refund(oPorch))?.fee_policy === "full_shop_pays_fee", "no photo 3 days on: refunded in full as the shop's fault");
ok((await order(oKeep)).status === "accepted" && !(await refund(oKeep)), "an order with its ready photo is left to the handover clock");
ok(await strikes(OWNER) === 2 && await notes(ADMIN, "Shops order refunded by the clock") === 1, "the shop gets a strike and every admin is told");
ok(one(await svc(`SELECT public.shop_refund_sweep() AS r`))?.no_ready_photo_refunded === 0, "the sweep never refunds twice");
await member(OWNER, `SELECT public.shops_set_handover_mode('in_person')`);

// --- 6. a reported problem: nobody but an admin acts; the admin decides by reason
const problem = async (id) => {
  await pastReady(id, 0);
  return member(BUYER, `SELECT public.shops_report_not_received('${id}', 'Nobody was there')`);
};
const oP1 = await chargedTax(BUYER, lines([itemA, 1]), D1, 150, 60);
await problem(oP1);
ok(refused(await cancel(BUYER, oP1, "late"), /problem_open/, "55000") && refused(await member(OWNER, `SELECT public.shops_shop_cancel_order('${oP1}', NULL)`), /problem_open/, "55000"),
  "an open problem freezes both sides' cancels");
ok(refused(await member(OWNER, `SELECT public.shops_admin_refund_order('${oP1}', 'problem_no_fault', 'x')`), /admin_only/, "42501"), "a member cannot refund as admin");
ok(refused(await member(ADMIN, `SELECT public.shops_admin_refund_order('${oP1}', 'problem_no_fault', '')`), /invalid_note/, "22023"), "an admin refund needs a note");
ok(refused(await member(ADMIN, `SELECT public.shops_admin_refund_order('${oP1}', 'buyer_cancelled', 'x')`), /invalid_reason/, "22023"), "an admin refunds only by an admin reason");
const p1 = one(await member(ADMIN, `SELECT public.shops_admin_refund_order('${oP1}', 'problem_no_fault', 'Photo shows it was there') AS r`));
const p1Ref = await refund(oP1);
const p1Tax = Math.ceil((60 * 150) / ((await order(oP1)).total_cents - 150));
ok(p1?.result === "refunded" && p1Ref?.fee_policy === "keep_card_fee" && p1Ref.kept_cents === 60 && p1Ref.tax_kept_cents === p1Tax
  && (await order(oP1)).close_reason === "admin_refunded", "no fault (L43): the price back, the card fee and its tax kept");
ok(Number(one(await svc(`SELECT count(*) FROM public.admin_audit_log WHERE action = 'shops_admin_refund_order' AND target_id = '${oP1}'`))) === 1, "audited");
const oP2 = await chargedTax(BUYER, lines([itemA, 1]), D2, 150, 60);
await problem(oP2);
const debtsBefore = (await debts(OWNER)).length;
await member(ADMIN, `SELECT public.shops_admin_refund_order('${oP2}', 'problem_our_mistake', 'Our app showed the wrong day')`);
ok((await refund(oP2))?.fee_policy === "full_platform_absorbs" && (await refund(oP2))?.refund_cents === (await order(oP2)).total_cents
  && (await debts(OWNER)).length === debtsBefore, "our mistake: full refund, the shop is not billed (owner 10-14)");
// shop_removed (L75): the shop was taken down; the buyer gets everything back and the shop is billed the card fee
// (never the platform: owner 10-14), with no strike (the removal itself is the consequence).
const oP2b = await chargedTax(BUYER, lines([itemA, 1]), D2, 150, 60);
const sBeforeRemoved = await strikes(OWNER);
await member(ADMIN, `SELECT public.shops_admin_refund_order('${oP2b}', 'shop_removed', 'Shop taken down for policy')`);
ok((await refund(oP2b))?.reason === "shop_removed" && (await refund(oP2b))?.fee_policy === "full_shop_pays_fee"
  && (await refund(oP2b))?.refund_cents === (await order(oP2b)).total_cents && (await debts(OWNER)).length === debtsBefore + 1
  && await strikes(OWNER) === sBeforeRemoved, "shop removed: full refund, the card fee billed to the shop, no strike");
const oP3 = await chargedTax(BUYER, lines([itemA, 1]), D3, 150, 60);
await problem(oP3);
const sBefore = await strikes(OWNER);
await member(ADMIN, `SELECT public.shops_admin_refund_order('${oP3}', 'problem_shop_fault', 'Shop was closed')`);
ok((await refund(oP3))?.fee_policy === "full_shop_pays_fee" && (await debts(OWNER)).length === debtsBefore + 2 && await strikes(OWNER) === sBefore + 1,
  "the shop's fault: full refund, card fee billed, shop strike");
ok(await strikes(OWNER) === 3 && refused(await request(BUYER, lines([itemA, 1]), D4), /shop_not_found/, "P0002"),
  "3 Shops strikes take the shop out of ordering");
await svc(`UPDATE public.shop_strikes SET removed_at = now() WHERE id = (SELECT id FROM public.shop_strikes WHERE user_id = '${OWNER}' AND reason = 'no_ready_photo')`);
const oP4 = await chargedTax(BUYER, lines([itemA, 1]), D4, 0, 50);
const pr4 = await problem(oP4);
if (!oP4 || !Array.isArray(pr4)) console.log("  setup oP4:", oP4, JSON.stringify(pr4));
ok(refused(await member(OWNER, `SELECT public.shops_admin_pay_shop('${oP4}', 'x')`), /admin_only/, "42501"), "a member cannot pay as admin");
ok(one(await member(ADMIN, `SELECT public.shops_admin_pay_shop('${oP4}', 'Photo shows the pickup') AS r`))?.result === "handed_over"
  && (await svc(`SELECT order_id FROM public.shop_payouts_due(50)`)).some((r) => r.order_id === oP4), "an admin pays the shop and the payout is sent");

// --- 7. a handed-over order is final (Q2155 b); an uncaptured order waits
ok(refused(await cancel(BUYER, oNext, "late"), /order_final/, "55000"), "the buyer cannot cancel after pickup");
ok(refused(await member(ADMIN, `SELECT public.shops_admin_refund_order('${oNext}', 'problem_our_mistake', 'x')`), /order_final/, "55000"),
  "no refund path touches a handed-over order (its fee-debt deduction is never orphaned)");
const oU = one(await request(BUYER, lines([itemA, 1]), D5))?.order_id;
await svc(`SELECT public.shop_attach_checkout_session('${oU}', 'cs_test_m3_u')`);
await svc(`SELECT public.shop_mark_order_held('cs_test_m3_u', 'pi_m3_u', 1960, 0, false)`);
await member(OWNER, `SELECT public.shops_accept_order('${oU}')`);
ok(refused(await cancel(BUYER, oU, "free"), /order_not_charged_yet/, "55000") && refused(await member(OWNER, `SELECT public.shops_shop_cancel_order('${oU}', NULL)`), /order_not_charged_yet/, "55000"),
  "while the capture is in flight nobody cancels (no refund of money not yet taken)");

// --- 8. the table CHECKs hold reason -> policy -> amounts even against the service role
await svc(`SELECT public.shop_order_captured('${oU}', 40)`);
const badRefund = (reason, policy, kept, taxKept, refundCents) => svc(`INSERT INTO public.shop_refunds (order_id, stripe_payment_intent_id, reason,
  fee_policy, paid_cents, tax_cents, card_fee_cents, kept_cents, tax_kept_cents, refund_cents) VALUES ('${oU}', 'pi_m3_bad', '${reason}', '${policy}',
  2000, 100, 40, ${kept}, ${taxKept}, ${refundCents})`);
ok(refused(await badRefund("buyer_cancelled", "full_platform_absorbs", 0, 0, 2000), /shop_refunds_policy/), "a buyer cancel can never be a full refund the platform pays for");
ok(refused(await badRefund("shop_cancelled", "keep_card_fee", 40, 3, 1957), /shop_refunds_policy/), "a shop cancel can never keep the buyer's card fee");
ok(refused(await badRefund("buyer_cancelled", "keep_card_fee", 40, 0, 1960), /shop_refunds_tax_kept/), "the tax on a kept fee must be kept (J3)");
ok(refused(await badRefund("buyer_cancelled", "keep_card_fee", 40, 3, 1960), /shop_refunds_amount/), "the refund is exactly paid - kept - tax kept");
ok(refused(await svc(`INSERT INTO public.declutter_seller_fee_debts (seller_id, amount_cents, remaining_cents) VALUES ('${OWNER}', 10, 10)`), /one_source/),
  "a fee debt comes from exactly one refund (Declutter or Shops)");

// --- 9. sending: the queue, success, failure back-off
const fId = fRef.id;
ok(!(await svc(`SELECT refund_id FROM public.shop_refunds_due(50)`)).some((r) => r.refund_id === fId), "the tap's own refund is not swept in its first 2 minutes");
await svc(`UPDATE public.shop_refunds SET created_at = now() - interval '5 minutes' WHERE id = '${fId}'`);
ok((await svc(`SELECT refund_id FROM public.shop_refunds_due(50)`)).some((r) => r.refund_id === fId), "an unsent refund is retried by the money step");
ok(one(await svc(`SELECT public.shop_refund_executed('${fId}', NULL, false, 'card_declined')`)) === "failed"
  && !(await svc(`SELECT refund_id FROM public.shop_refunds_due(50)`)).some((r) => r.refund_id === fId), "a failure backs off");
ok(refused(await svc(`SELECT public.shop_refund_executed('${fId}', 'tr_x', true, NULL)`), /invalid_refund/), "success needs a Stripe refund id");
ok(one(await svc(`SELECT public.shop_refund_executed('${fId}', 're_m3_1', true, NULL)`)) === "succeeded"
  && one(await svc(`SELECT public.shop_refund_executed('${fId}', 're_m3_2', true, NULL)`)) === "succeeded"
  && one(await svc(`SELECT stripe_refund_id FROM public.shop_refunds WHERE id = '${fId}'`)) === "re_m3_1", "a succeeded refund is final");
ok(one(await svc(`SELECT public.shop_refund_reversed('${fId}', 're_other')`)) === false
  && one(await svc(`SELECT status FROM public.shop_refunds WHERE id = '${fId}'`)) === "succeeded", "only the refund the row recorded can reopen it");
ok(one(await svc(`SELECT public.shop_refund_reversed('${fId}', 're_m3_1')`)) === true
  && (await svc(`SELECT refund_id FROM public.shop_refunds_due(50)`)).some((r) => r.refund_id === fId),
  "a refund Stripe failed later is reopened and sent again");
// /code-review of shops-m3-v1 #4: a reversal starts a fresh run of tries (new keys via reversals),
// so a row on its last try is re-sent, and can still reach the give-up page 12 tries later.
const fDue = (await svc(`SELECT refund_id, attempts, reversals FROM public.shop_refunds_due(50)`)).find((r) => r.refund_id === fId);
ok(fDue?.attempts === 0 && fDue.reversals === 1, "a reversed refund is due again with attempts reset and one reversal counted");
await svc(`UPDATE public.shop_refunds SET attempts = 11 WHERE id = '${fId}'`);
await svc(`SELECT public.shop_refund_executed('${fId}', 're_m3_3', true, NULL)`);
ok(one(await svc(`SELECT public.shop_refund_reversed('${fId}', 're_m3_3')`)) === true
  && (await svc(`SELECT refund_id, attempts, reversals FROM public.shop_refunds_due(50)`)).some((r) => r.refund_id === fId && r.attempts === 0 && r.reversals === 2),
  "a refund reversed after its 11th try is re-sent (never pushed past the queue's limit)");
ok(Array.isArray(await rows(BUYER, `SELECT id FROM public.shop_refunds WHERE order_id = '${oF}'`)) && (await rows(BUYER, `SELECT id FROM public.shop_refunds WHERE order_id = '${oF}'`)).length === 1
  && (await rows(ORDINARY, `SELECT id FROM public.shop_refunds`)).length === 0, "the two sides read their refund; nobody else does");
ok(refused(await member(BUYER, `SELECT stripe_payment_intent_id FROM public.shop_refunds`), /permission denied/), "members never read the Stripe ids");

// --- 10. strikes: Shops' own count, admin management, 3 blocks ordering
const k1 = one(await svc(`SELECT id FROM public.shop_strikes WHERE user_id = '${BUYER}' LIMIT 1`));
ok(refused(await member(OWNER, `SELECT public.shops_admin_remove_strike('${k1}', 'x')`), /admin_only/, "42501"), "a member cannot remove a strike");
ok(one(await member(ADMIN, `SELECT public.shops_admin_remove_strike('${k1}', 'Buyer showed a pickup photo')`))?.active === 0 && await strikes(BUYER) === 0,
  "an admin removes a strike (with a note)");
ok(refused(await member(ADMIN, `SELECT public.shops_admin_remove_strike('${k1}', 'again')`), /strike_not_found/, "P0002"), "a removed strike cannot be removed twice");
ok(one(await member(ADMIN, `SELECT public.shops_admin_give_strike('${oN}', 'buyer', 'Repeat no-show')`))?.active === 1, "an admin gives a strike for an order");
ok(refused(await member(ADMIN, `SELECT public.shops_admin_give_strike('${oN}', 'buyer', 'again')`), /strike_exists/), "once per order and side");
await svc(`INSERT INTO public.shop_strikes (user_id, offender_side, reason, expires_at) SELECT '${BUYER}', 'buyer', 'test', now() + interval '1 year' FROM generate_series(1, 2)`);
ok(refused(await request(BUYER, lines([itemA, 1]), D5), /shop_strikes_blocked/, "42501"), "3 Shops strikes stop new orders");
await svc(`DELETE FROM public.shop_strikes WHERE user_id = '${BUYER}' AND reason = 'test'`);

// --- 11. the admin queue
const queue = one(await member(ADMIN, `SELECT public.shops_admin_queue()`));
ok(Array.isArray(queue?.problems) && Array.isArray(queue.refunds) && queue.refunds.some((r) => r.order_id === oS)
  && queue.payouts.some((p) => p.order_id === oL) && queue.strikes.some((s) => s.user_id === OWNER), "the admin queue shows refunds, payouts and strikes");
await svc(`INSERT INTO public.payout_holds (helper_id, reason) VALUES ('${OWNER}', 'review')`);
ok(one(await member(ADMIN, `SELECT public.shops_admin_queue()`))?.payouts.every((p) => p.on_hold === true), "a payout hold shows on the shop's payouts");
ok(refused(await member(OWNER, `SELECT public.shops_admin_queue()`), /admin_only/, "42501"), "members cannot read the queue");
// /code-review of shops-m3-v1 #6: a payout held for review is in the admin's queue.
await svc(`UPDATE public.shop_payouts SET status = 'held_for_review', review_reason = 'payee_deleted' WHERE order_id = '${oL}'`);
ok(one(await member(ADMIN, `SELECT public.shops_admin_queue()`))?.payouts.some((p) => p.order_id === oL && p.status === "held_for_review" && p.review_reason === "payee_deleted"),
  "a payout held for review shows in the admin queue");
await svc(`UPDATE public.shop_payouts SET status = 'pending', review_reason = NULL WHERE order_id = '${oL}'`);

// --- 11b. ONE refund formula (/code-review of shops-m3-v1 #7): the table CHECKs, the quote
//      and the write all use shop_refund_fee_policy / shop_refund_tax_kept / shop_refund_amounts.
// The shop's strikes are cleared so it takes orders again for the checks below.
await svc(`UPDATE public.shop_strikes SET removed_at = now() WHERE user_id = '${OWNER}' AND removed_at IS NULL`);
const conDef = async (name) => one(await svc(`SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = '${name}'`)) ?? "";
ok(!skip && /shop_refund_fee_policy\(reason\)/.test(await conDef("shop_refunds_policy"))
  && /shop_refund_tax_kept\(kept_cents, tax_cents, paid_cents\)/.test(await conDef("shop_refunds_tax_kept")),
  "the table CHECKs call the shared policy and tax-kept functions");
const bodyOf = async (fn) => {
  const d = one(await svc(`SELECT pg_get_functiondef('public.${fn}'::regprocedure)`)) ?? "";
  const m = /\bAS\s+\$\w*\$/.exec(d);
  return m ? d.slice(m.index) : "";
};
const qb = await bodyOf("shops_order_cancel_quote(uuid)"), wb = await bodyOf("shop_write_refund(uuid, text, text)");
ok(!skip && /shop_refund_amounts\(/.test(qb) && /shop_refund_amounts\(/.test(wb) && !/ceil\(|card_fee_estimate/.test(qb) && !/ceil\(|card_fee_estimate|CASE\s+WHEN p_reason/.test(wb),
  "the quote and the write read shop_refund_amounts, with no formula of their own");
const oQ = await chargedTax(BUYER, lines([itemA, 1]), D5, 120, 70);
const qq = one(await member(BUYER, `SELECT public.shops_order_cancel_quote('${oQ}')`));
const qa = (await svc(`SELECT * FROM public.shop_refund_amounts('${oQ}', 'buyer_cancelled')`))?.[0];
ok(!skip && qq?.free === true && qa && qq.refund_cents === qa.refund_cents && qq.kept_cents === qa.kept_cents + qa.tax_kept_cents,
  "the buyer's quote is exactly shop_refund_amounts");
const qr = one(await cancel(BUYER, oQ, "free"));
ok(!skip && qr?.refund_cents === qq.refund_cents, "and the refund written is exactly the quote");

// --- 11c. refunds made BY HAND in Stripe (/code-review of shops-m3-v1 #1)
const hand = (pi, re, cents, how = "webhook") => svc(`SELECT public.shop_record_hand_refund('${pi}', '${re}', ${cents}, false, '${how}', NULL, NULL) AS r`);
const pi = async (id) => (await order(id)).stripe_payment_intent_id;
// a) an open accepted order refunded in full by hand: closed, stock back, never auto-finished, never paid
const oH1 = await chargedTax(BUYER, lines([itemB, 1]), D1, 0, 50);
const h1Stock = await stockB();
const h1 = await order(oH1);
ok(one(await hand(h1.stripe_payment_intent_id, "re_hand1", h1.total_cents)) === "closed_refunded", "a full hand refund on an open order closes it");
ok((await order(oH1)).status === "refunded" && (await order(oH1)).close_reason === "refunded_by_hand" && await stockB() === h1Stock + 1,
  "refunded, refunded_by_hand, stock back");
await pastDue(oH1);
await sweep();
ok((await order(oH1)).status === "refunded" && !(await payout(oH1)), "the handover clock never finishes or pays a hand-refunded order");
ok(one(await hand(h1.stripe_payment_intent_id, "re_hand1", h1.total_cents)) === "already", "one Stripe refund is recorded once");
// b) a handed-over order with its payout not sent: partially refunded, payout held for review, never due
const oH2 = await chargedTax(BUYER, lines([itemA, 1]), D2, 0, 50);
await member(BUYER, `SELECT public.shops_confirm_pickup('${oH2}')`);
ok((await svc(`SELECT order_id FROM public.shop_payouts_due(50)`)).some((r) => r.order_id === oH2), "setup: the payout is due");
ok(one(await hand(await pi(oH2), "re_hand2", 500)) === "closed_partially_refunded", "a partial hand refund after pickup is recorded");
ok((await order(oH2)).status === "partially_refunded" && (await payout(oH2))?.status === "held_for_review"
  && /refunded_by_hand/.test((await payout(oH2))?.review_reason ?? "")
  && !(await svc(`SELECT order_id FROM public.shop_payouts_due(50)`)).some((r) => r.order_id === oH2),
  "partially_refunded, the shop payout held for review and out of the queue");
// Defence in depth: even a payout and order moved back by hand are never sent while a live hand refund stands.
await svc(`UPDATE public.shop_payouts SET status = 'pending' WHERE order_id = '${oH2}'`);
await svc(`UPDATE public.shop_orders SET status = 'handed_over', close_reason = 'handed_over' WHERE id = '${oH2}'`);
ok(!(await svc(`SELECT order_id FROM public.shop_payouts_due(50)`)).some((r) => r.order_id === oH2),
  "a payout is never sent while a live hand refund stands on its order");
await svc(`UPDATE public.shop_orders SET status = 'partially_refunded', close_reason = 'refunded_by_hand' WHERE id = '${oH2}'`);
// c) rule A (/code-review of shops-m3 v2): a hand refund on an order with an UNSENT app refund holds that
//    row (full or short, it is never sent on top), and the order refuses every refund path from then on.
const oH3 = await chargedTax(BUYER, lines([itemA, 1]), D3, 0, 50);
await member(OWNER, `SELECT public.shops_shop_cancel_order('${oH3}', NULL)`);
const h3r = await refund(oH3);
await svc(`UPDATE public.shop_refunds SET created_at = now() - interval '5 minutes' WHERE id = '${h3r.id}'`);
ok((await svc(`SELECT refund_id FROM public.shop_refunds_due(50)`)).some((r) => r.refund_id === h3r.id), "setup: the app refund is due");
ok(one(await hand(await pi(oH3), "re_hand3", h3r.refund_cents - 1)) === "recorded_refund_held" && (await refund(oH3)).status === "held_for_review"
  && /refunded_by_hand: re_hand3/.test((await refund(oH3)).review_reason ?? ""),
  "a SHORT hand refund holds the unsent app refund (never sent on top)");
ok(!(await svc(`SELECT refund_id FROM public.shop_refunds_due(50)`)).some((r) => r.refund_id === h3r.id)
  && (await svc(`SELECT refund_id FROM public.shop_refund_to_send('${h3r.id}')`)).length === 0, "a held app refund is in no queue and the tap cannot send it");
await svc(`UPDATE public.shop_refunds SET status = 'pending' WHERE id = '${h3r.id}'`);
ok(!(await svc(`SELECT refund_id FROM public.shop_refunds_due(50)`)).some((r) => r.refund_id === h3r.id)
  && (await svc(`SELECT refund_id FROM public.shop_refund_to_send('${h3r.id}')`)).length === 0,
  "even moved back to pending, an app refund is never sent while a live hand refund stands on the order");
await svc(`UPDATE public.shop_refunds SET status = 'held_for_review' WHERE id = '${h3r.id}'`);
const oH3b = await chargedTax(BUYER, lines([itemA, 1]), D3, 0, 50);
await member(OWNER, `SELECT public.shops_shop_cancel_order('${oH3b}', NULL)`);
ok(one(await hand(await pi(oH3b), "re_hand3b", (await refund(oH3b)).refund_cents)) === "recorded_refund_held" && (await refund(oH3b)).status === "held_for_review",
  "a hand refund that COVERS the unsent app refund holds it too: an admin settles it, nothing automatic");
await svc(`UPDATE public.shop_refunds SET status = 'succeeded', stripe_refund_id = 're_app3c' WHERE order_id = '${oH3b}'`);
ok(one(await hand(await pi(oH3b), "re_hand3c", 100)) === "recorded_row_already_settled", "a hand refund after the app's refund went out says so (two refunds)");
// d) a hand refund that fails later never reopens anything: the order stays held, a person decides.
ok(one(await svc(`SELECT public.shop_hand_refund_failed('re_hand3')`)) === "marked_failed" && (await refund(oH3)).status === "held_for_review"
  && !(await svc(`SELECT refund_id FROM public.shop_refunds_due(50)`)).some((r) => r.refund_id === h3r.id),
  "a failed hand refund marks it failed and leaves the order held (no automatic re-send)");
// e) the same re_ id on a different order's payment is never adopted.
ok(one(await hand(await pi(oH3b), "re_hand1", 100)) === "recorded_other_order"
  && Number(one(await svc(`SELECT count(*) FROM public.shop_hand_refunds WHERE stripe_refund_id = 're_hand1'`))) === 1,
  "a refund id recorded on another payment answers recorded_other_order and changes nothing");
// A refund on an order never recorded as captured: recorded (it blocks any payout), nothing else changed, a person checks.
const oH5 = one(await request(BUYER, lines([itemA, 1]), D5))?.order_id;
await svc(`SELECT public.shop_attach_checkout_session('${oH5}', 'cs_test_m3_h5')`);
await svc(`SELECT public.shop_mark_order_held('cs_test_m3_h5', 'pi_m3_h5', 1960, 0, false)`);
ok(one(await hand("pi_m3_h5", "re_hand5", 100)) === "recorded_not_charged" && (await order(oH5)).status === "held",
  "a refund on an order not recorded as captured is recorded and changes nothing else (never a webhook loop)");
// f) once a hand refund stands, no refund path acts on the order (the lock refuses it).
await member(OWNER, `SELECT public.shops_accept_order('${oH5}')`);
await svc(`SELECT public.shop_order_captured('${oH5}', 50)`);
ok(refused(await cancel(BUYER, oH5, "late"), /refunded_in_stripe/, "55000") && (await order(oH5)).status === "accepted",
  "the lock itself refuses an order with a live hand refund (a late cancel writes no refund row, and is refused too)");
ok(refused(await cancel(BUYER, oH5, "free"), /refunded_in_stripe/, "55000")
  && refused(await member(OWNER, `SELECT public.shops_shop_cancel_order('${oH5}', NULL)`), /refunded_in_stripe/, "55000")
  && refused(await member(ADMIN, `SELECT public.shops_admin_refund_order('${oH5}', 'problem_our_mistake', 'x')`), /refunded_in_stripe/, "55000")
  && refused(await svc(`SELECT public.shop_write_refund('${oH5}', 'problem_our_mistake', NULL)`), /refunded_in_stripe/, "55000") && !(await refund(oH5)),
  "with a live hand refund, every cancel / refund path and shop_write_refund refuse (refunded_in_stripe)");
ok(one(await hand("pi_nobody", "re_handx", 100)) === "not_shops", "a payment no Shops order knows is not Shops");
// d) the admin path: records, audits, refuses members and bad input, makes no Stripe refund (no new shop_refunds row)
const oH4 = await chargedTax(BUYER, lines([itemA, 1]), D4, 0, 50);
const adm = (uid, re, cents, note = "Refunded in the Dashboard") => svc(`SELECT public.shops_admin_record_hand_refund(${uid ? `'${uid}'` : "NULL"}, '${oH4}', '${re}', ${cents}, '${note}') AS r`);
ok(refused(await adm(OWNER, "re_hand4", 100), /admin_only/, "42501") && refused(await adm(null, "re_hand4", 100), /admin_only/, "42501"),
  "only an admin's id records a hand refund");
ok(refused(await adm(ADMIN, "tr_nope", 100), /invalid_stripe_ref/, "22023") && refused(await adm(ADMIN, "re_hand4", 0), /invalid_amount/, "22023")
  && refused(await adm(ADMIN, "re_hand4", 100, ""), /invalid_note/, "22023") && refused(await adm(ADMIN, "re_hand4", 999999), /invalid_amount/, "22023"),
  "it needs a re_ id, an amount up to what was paid, and a note");
ok(one(await adm(ADMIN, "re_hand4", (await order(oH4)).total_cents))?.result === "closed_refunded" && !(await refund(oH4))
  && (await order(oH4)).status === "refunded"
  && Number(one(await svc(`SELECT count(*) FROM public.admin_audit_log WHERE action = 'shops_admin_record_hand_refund' AND target_id = '${oH4}'`))) === 1,
  "an admin records it: the order closes, it is audited, and no app refund is made");
ok(refused(await svc(`SELECT public.shops_admin_record_hand_refund('${ADMIN}', '${oH4}', 're_app3c', 100, 'x')`), /ref_already_used/, "23505"),
  "a re_ id another order's money row holds is refused");
ok(one(await svc(`SELECT public.shop_hand_refund_failed('re_hand4')`)) === "marked_failed"
  && one(await svc(`SELECT public.shop_hand_refund_failed('re_hand4')`)) === "already"
  && one(await svc(`SELECT public.shop_hand_refund_failed('re_unknown')`)) === "not_shops", "a hand refund Stripe failed later stops counting, once");

// --- 11d. the readiness held-for-review admin tools know a held Shops refund (kind 'shop_refund'),
//      never release a Shops row the queues would not send, and settle it by Stripe id only
//      through the Stripe-checked service path (20261019112103 + section 13; /code-review of run 3).
const heldList = async () => one(await member(ADMIN, `SELECT public.admin_payouts_held_for_review()`)) ?? [];
const release = (uid, kind, id, confirm = true) =>
  member(uid, `SELECT public.admin_payout_release('${kind}', '${id}', 'checked Stripe', ${confirm})`);
const settle = (uid, kind, id, ref, cents, note = "settled after checking Stripe") =>
  member(uid, `SELECT public.admin_payout_settle_by_hand('${kind}', '${id}', '${ref}', ${cents}, '${note}')`);
const settleStripe = (uid, id, re, cents, note = "the Dashboard refund covers it") =>
  svc(`SELECT public.shops_admin_settle_held_refund(${uid ? `'${uid}'` : "NULL"}, '${id}', '${re}', ${cents}, '${note}') AS r`);
// A buyer's free cancel writes the refund row (no strike for anyone, so the shop stays open for the rest).
const cancelledFree = async (day) => {
  const id = await chargedTax(BUYER, lines([itemA, 1]), day, 0, 50);
  await cancel(BUYER, id, "free");
  return id;
};
// a) a held Shops refund is listed, and cannot be released while the refund made in Stripe stands
const oS1 = await cancelledFree(D5);
const s1 = await refund(oS1);
ok(one(await hand(await pi(oS1), "re_s1", s1.refund_cents)) === "recorded_refund_held" && (await refund(oS1)).status === "held_for_review", "setup: a held Shops refund");
const s1Row = (await heldList()).find((h) => h.kind === "shop_refund" && h.id === s1.id);
ok(!skip && s1Row?.payee_id === BUYER && s1Row.amount_cents === s1.refund_cents && s1Row.stripe_group === s1.stripe_payment_intent_id
  && /re_s1/.test(s1Row.reason ?? ""), "the admin held list shows it: the buyer, the refund owed, its PaymentIntent, why");
ok(refused(await member(OWNER, `SELECT public.admin_payouts_held_for_review()`), /admin_only/), "only admins see the held list");
ok(refused(await release(ADMIN, "shop_refund", s1.id, false), /confirm_no_transfer_required/, "22023"), "release always needs the confirmation");
ok(refused(await release(ADMIN, "shop_refund", s1.id), /refunded_in_stripe/, "55000") && (await refund(oS1)).status === "held_for_review",
  "a held Shops refund is never released while a refund made in Stripe stands on its order");
// b) the client RPC settles a Shops refund only by "other: ..." for its whole amount; a Stripe id goes through the checked path
ok(refused(await settle(ADMIN, "shop_refund", s1.id, "re_s1", s1.refund_cents), /stripe_check_required/, "22023"),
  "the client RPC never takes a Stripe id for a Shops refund (it must be checked with Stripe first)");
ok(refused(await settle(ADMIN, "shop_refund", s1.id, "other: paid back in cash", s1.refund_cents - 1), /settle_amount_differs/, "22023")
  && refused(await settle(ADMIN, "shop_refund", s1.id, "other: paid back in cash", s1.refund_cents + 1), /settle_amount_differs/, "22023"),
  "a Shops refund settles only for its whole amount");
ok(refused(await settleStripe(OWNER, s1.id, "re_s1", s1.refund_cents), /admin_only/, "42501") && refused(await settleStripe(null, s1.id, "re_s1", s1.refund_cents), /admin_only/, "42501"),
  "only an admin's id settles through the checked path");
ok(refused(await settleStripe(ADMIN, s1.id, "re_app3c", s1.refund_cents), /ref_already_used/, "23505")
  && refused(await settleStripe(ADMIN, s1.id, "re_hand2", s1.refund_cents), /ref_already_used/, "23505")
  && refused(await settleStripe(ADMIN, s1.id, "tr_s1", s1.refund_cents), /invalid_stripe_ref/, "22023"),
  "the global Stripe-id check: another order's app refund or hand refund is refused; a transfer id is not a refund");
ok(refused(await settleStripe(ADMIN, s1.id, "re_s1", s1.refund_cents - 1), /hand_refund_short/, "22023"), "a Stripe refund short of what the row owes never settles it");
const s1Done = one(await settleStripe(ADMIN, s1.id, "re_s1", s1.refund_cents));
const s1After = await refund(oS1);
ok(!skip && s1Done?.result === "settled" && s1Done.adopted_hand_refund === true && s1After.status === "succeeded" && s1After.stripe_refund_id === "re_s1"
  && s1After.settled_by_hand_cents === s1.refund_cents
  && one(await svc(`SELECT outcome FROM public.shop_hand_refunds WHERE stripe_refund_id = 're_s1' AND shop_refund_id = '${s1.id}'`)) === "settled"
  && Number(one(await svc(`SELECT count(*) FROM public.payout_settlements WHERE row_kind = 'shop_refund' AND row_id = '${s1.id}' AND stripe_ref = 're_s1'`))) === 1
  && Number(one(await svc(`SELECT count(*) FROM public.admin_audit_log WHERE action = 'shops_admin_settle_held_refund' AND target_id = '${s1.id}'`))) === 1,
  "settled with the refund made in Stripe on its own payment: adopted, succeeded with that id, in the settle ledger, audited");
ok(refused(await settleStripe(ADMIN, s1.id, "re_s1", s1.refund_cents), /not_held_for_review/, "55000"), "settled once");
ok(!skip && one(await svc(`SELECT public.shop_order_unaccounted_hand_refund('${oS1}')`)) === false,
  "a hand refund settled as the order's own refund is accounted for (it no longer blocks the order)");
// c) "other: ..." settles it by hand; the table refuses part of it
const oS2 = await cancelledFree(D5);
const s2 = await refund(oS2);
await hand(await pi(oS2), "re_s2", s2.refund_cents - 100);
const s2Done = one(await settle(ADMIN, "shop_refund", s2.id, "other: re_s2 plus re_s2b for the rest", s2.refund_cents));
ok(!skip && s2Done?.status === "settled_by_hand" && (await refund(oS2)).status === "settled_by_hand" && !(await refund(oS2)).stripe_refund_id
  && Number(one(await svc(`SELECT count(*) FROM public.payout_settlements WHERE row_id = '${s2.id}' AND off_stripe_note LIKE 're_s2 plus%'`))) === 1,
  "\"other: ...\" settles it by hand, recorded by its note");
ok(refused(await svc(`UPDATE public.shop_refunds SET settled_by_hand_cents = refund_cents - 1 WHERE id = '${s2.id}'`), /shop_refunds_settled_in_full/),
  "the table refuses a settle for part of the refund (CHECK)");
// d) a refund id the ledger did not know is recorded in it (and the order held); its later FAILURE reopens the settled row
const oS3 = await chargedTax(BUYER, lines([itemA, 1]), D2, 0, 50);
await member(BUYER, `SELECT public.shops_confirm_pickup('${oS3}')`);
await svc(`INSERT INTO public.shop_refunds (order_id, stripe_payment_intent_id, reason, fee_policy, paid_cents, tax_cents, card_fee_cents,
  kept_cents, tax_kept_cents, refund_cents, status, review_reason)
  SELECT o.id, o.stripe_payment_intent_id, 'problem_our_mistake', 'full_platform_absorbs', o.total_cents, o.tax_cents, 50, 0, 0, o.total_cents,
         'held_for_review', 'setup' FROM public.shop_orders o WHERE o.id = '${oS3}'`);
const s3 = await refund(oS3);
ok(!skip && s3 && (await payout(oS3))?.status === "pending", "setup: a held app refund on an order whose shop payout is still pending");
const s3Done = one(await settleStripe(ADMIN, s3.id, "re_s3new", s3.refund_cents + 5));
ok(!skip && s3Done?.adopted_hand_refund === false && (await refund(oS3)).stripe_refund_id === "re_s3new"
  && one(await svc(`SELECT recorded_how || ':' || shop_refund_id || ':' || outcome FROM public.shop_hand_refunds WHERE stripe_refund_id = 're_s3new'`)) === `admin:${s3.id}:settled`
  && (await payout(oS3))?.status === "held_for_review",
  "a new refund id goes into the hand-refund ledger (settled, linked) and the order's pending payout is held, never silently skipped");
ok(!skip && s3Done?.owed_cents === s3.refund_cents && s3Done?.over_refunded_cents === 5
  && Number(one(await svc(`SELECT (details ->> 'over_refunded_cents')::int FROM public.admin_audit_log WHERE action = 'shops_admin_settle_held_refund' AND target_id = '${s3.id}'`))) === 5,
  "a Stripe refund LARGER than owed settles, and the difference is answered (for the ops page) and audited");
const p3 = await payout(oS3);
ok(!skip && one(await release(ADMIN, "shop", p3.id))?.result === "released" && (await payout(oS3)).status === "pending",
  "a settled (accounted) hand refund does not block releasing the shop payout");
await svc(`UPDATE public.shop_payouts SET status = 'held_for_review' WHERE id = '${p3.id}'`);
ok(!skip && one(await svc(`SELECT public.shop_hand_refund_failed('re_s3new')`)) === "reopened_held"
  && (await refund(oS3)).status === "held_for_review" && !(await refund(oS3)).stripe_refund_id && (await refund(oS3)).settled_by_hand_cents === null
  && /FAILED/.test((await refund(oS3)).review_reason ?? "") && (await refund(oS3)).executed_at === null
  && one(await svc(`SELECT voided_at IS NOT NULL FROM public.payout_settlements WHERE row_kind = 'shop_refund' AND row_id = '${s3.id}' AND stripe_ref = 're_s3new'`)) === true,
  "when Stripe fails the refund that settled the row, the row is REOPENED to held for review, executed_at cleared and its settle entry voided");
ok(!skip && one(await svc(`SELECT public.shop_hand_refund_failed('re_s3new')`)) === "already", "and only once");
// e) once the refund made in Stripe FAILED, the held app refund may go back to the queue with a fresh run of tries; ops paged daily, buyer not told
const oS4 = await cancelledFree(D5);
const s4 = await refund(oS4);
await hand(await pi(oS4), "re_s4", 300);
const buyerNotes = await notes(BUYER, "Your refund needs a quick review");
await svc(`SELECT public.payout_held_check()`);
ok(!skip && Number(one(await svc(`SELECT count(*) FROM public.error_logs WHERE tags ->> 'row_kind' = 'shop_refund' AND tags ->> 'row_id' = '${s4.id}'`))) === 1
  && await notes(BUYER, "Your refund needs a quick review") === buyerNotes && (await refund(oS4)).held_notified_at !== null,
  "a held Shops refund is paged to ops daily; the buyer (already refunded in Stripe) is not told it needs review");
await svc(`SELECT public.shop_hand_refund_failed('re_s4')`);
ok(refused(await settleStripe(ADMIN, s4.id, "re_s4", s4.refund_cents), /ref_already_used/, "23505"),
  "a refund made in Stripe that FAILED is never adopted to settle a row");
await svc(`UPDATE public.shop_refunds SET attempts = 12 WHERE id = '${s4.id}'`);
const s4Reversals = (await refund(oS4)).reversals;
ok(!skip && one(await release(ADMIN, "shop_refund", s4.id))?.result === "released" && (await refund(oS4)).status === "pending" && (await refund(oS4)).attempts === 0
  && (await refund(oS4)).reversals === s4Reversals + 1
  && Number(one(await svc(`SELECT count(*) FROM public.admin_audit_log WHERE action = 'admin_payout_release' AND target_id = '${s4.id}'`))) === 1,
  "with the Stripe refund failed, an admin releases the held app refund, with a fresh run of tries (attempts 0) under NEW keys (reversals + 1)");
await svc(`UPDATE public.shop_refunds SET created_at = now() - interval '5 minutes' WHERE id = '${s4.id}'`);
ok(!skip && (await svc(`SELECT refund_id FROM public.shop_refunds_due(50)`)).some((r) => r.refund_id === s4.id), "and the queue sends it");
// f) a held SHOP PAYOUT on a hand-refunded order stays held: release refused; the admin settles it by hand
await svc(`UPDATE public.shop_payouts SET status = 'held_for_review' WHERE order_id = '${oH2}'`); // as rule A left it (11c moved it by hand)
const p2 = await payout(oH2);
ok(p2?.status === "held_for_review" && refused(await release(ADMIN, "shop", p2.id), /refunded_in_stripe/, "55000") && (await payout(oH2)).status === "held_for_review",
  "a held shop payout is never released while a refund made in Stripe stands on its order");
await svc(`SELECT public.shop_hand_refund_failed('re_hand2')`);
ok(refused(await release(ADMIN, "shop", p2.id), /refunded_in_stripe/, "55000") && (await payout(oH2)).status === "held_for_review",
  "nor once that refund failed: the order was closed by it (refunded_by_hand), so no queue would ever send it");
ok(!skip && one(await settle(ADMIN, "shop", p2.id, "tr_soh2", p2.amount_cents))?.status === "succeeded" && (await payout(oH2)).stripe_transfer_id === "tr_soh2",
  "the admin decides it by hand (settled with the transfer they made)");
// g) a held shop payout the queue would skip (open problem) is not released; released once payable, with a fresh run of tries
const oS5 = await chargedTax(BUYER, lines([itemA, 1]), D2, 0, 50);
await member(BUYER, `SELECT public.shops_confirm_pickup('${oS5}')`);
const p5 = await payout(oS5);
await svc(`UPDATE public.shop_payouts SET status = 'held_for_review', review_reason = 'payee_deleted', attempts = 12 WHERE id = '${p5.id}'`);
await svc(`UPDATE public.shop_handovers SET problem_at = now(), problem_note = 'The jar was cracked' WHERE order_id = '${oS5}'`);
ok(!skip && p5 && refused(await release(ADMIN, "shop", p5.id), /shop_payout_not_due/, "55000"), "a held shop payout the queue would skip (open problem) is not released");
await svc(`UPDATE public.shop_handovers SET problem_at = NULL, problem_note = NULL WHERE order_id = '${oS5}'`);
ok(!skip && one(await release(ADMIN, "shop", p5.id))?.result === "released" && (await payout(oS5)).status === "pending" && (await payout(oS5)).attempts === 0
  && (await svc(`SELECT order_id FROM public.shop_payouts_due(50)`)).some((r) => r.order_id === oS5),
  "a payable held shop payout is released (attempts 0) and due again");
// h) the newest readiness rule survives the restatement (lead, train12): a Declutter refund settled short is refused
await svc(`INSERT INTO public.declutter_refunds (id, order_id, stripe_payment_intent_id, refund_cents, status)
  VALUES ('0000000d-0000-4000-8000-000000000001', gen_random_uuid(), 'pi_dshort', 1000, 'held_for_review')`);
ok(refused(await settle(ADMIN, "declutter_refund", "0000000d-0000-4000-8000-000000000001", "re_dshort", 900), /settle_amount_short/, "22023"),
  "a Declutter refund is still never settled 'succeeded' for less than it owes (settle_amount_short kept)");
// i) one lock order (run-3 review #7): the order row before the refund / payout / hand-refund rows, in every Shops body
const lockOrder = async (sig, first, then) => {
  const b = await bodyOf(sig);
  const i = b.indexOf(first), k = b.indexOf(then);
  return i > 0 && k > i;
};
ok(!skip && await lockOrder("shop_hand_refund_failed(text)", "FROM public.shop_orders WHERE id = v_order FOR UPDATE", "FROM public.shop_hand_refunds WHERE stripe_refund_id = p_stripe_refund_id FOR UPDATE")
  && await lockOrder("shops_admin_settle_held_refund(uuid, uuid, text, integer, text)", "FROM public.shop_orders WHERE id = v_order FOR UPDATE", "FROM public.shop_refunds WHERE id = p_refund_id FOR UPDATE")
  && await lockOrder("admin_payout_release(text, uuid, text, boolean)", "FROM public.shop_orders WHERE id = v_order FOR UPDATE", "FROM public.shop_payouts WHERE id = p_id FOR UPDATE")
  && await lockOrder("admin_payout_settle_by_hand(text, uuid, text, integer, text)", "FROM public.shop_orders WHERE id = v_order FOR UPDATE", "FROM public.shop_refunds WHERE id = p_id FOR UPDATE"),
  "every Shops path locks the order row before the refund / payout / hand-refund rows");

// --- 12. grants: service steps closed to members, member RPCs closed to anon
const can = async (role, fn) => one(await svc(`SELECT has_function_privilege('${role}', 'public.${fn}', 'EXECUTE')`));
let closed = true;
for (const fn of ["shop_write_refund(uuid, text, text)", "shop_owe_shop(uuid)", "shop_return_stock(uuid)", "shop_give_strike(uuid, text, text, uuid)",
  "shop_lock_open_charged_order(uuid, boolean)", "shop_refunds_due(integer)", "shop_refund_to_send(uuid)", "shop_refund_executed(uuid, text, boolean, text)",
  "shop_refund_sweep()", "shop_payouts_due(integer)", "shop_refund_reversed(uuid, text)",
  "shop_refund_amounts(uuid, text)", "shop_refund_fee_policy(text)", "shop_refund_tax_kept(integer, integer, integer)",
  "shop_record_hand_refund(text, text, integer, boolean, text, uuid, text)", "shop_hand_refund_failed(text)",
  "shop_hold_order_for_hand_refund(uuid, text)", "shops_admin_record_hand_refund(uuid, uuid, text, integer, text)",
  "shop_order_unaccounted_hand_refund(uuid)", "shops_admin_settle_held_refund(uuid, uuid, text, integer, text)"]) {
  if (await can("authenticated", fn) || await can("anon", fn)) { closed = false; console.log(`  open to members: ${fn}`); }
}
ok(!skip && closed, "every service step is closed to members and anon");
let anonClosed = true;
for (const fn of ["shops_buyer_cancel_order(uuid, text)", "shops_order_cancel_quote(uuid)", "shops_shop_cancel_order(uuid, text)", "shops_report_no_show(uuid)",
  "shops_admin_pay_shop(uuid, text)", "shops_admin_refund_order(uuid, text, text)", "shops_admin_remove_strike(uuid, text)",
  "shops_admin_give_strike(uuid, text, text)", "shops_admin_queue()"]) {
  if (await can("anon", fn) || !(await can("authenticated", fn))) { anonClosed = false; console.log(`  wrong grant: ${fn}`); }
}
ok(!skip && anonClosed, "member RPCs: authenticated yes, anon no");

// --- 13. the lock ORDER in the applied bodies (lh-money-escrow of a90c008a0): the row
//     lock, then ONE free-cancel reading, then the status write; never an http call.
// The body only (after AS $...$), so the function's own name in its header is not read as a call.
const body = async (fn) => {
  const d = one(await svc(`SELECT pg_get_functiondef('public.${fn}'::regprocedure)`)) ?? "";
  const m = /\bAS\s+\$\w*\$/.exec(d);
  return m ? d.slice(m.index) : "";
};
const bc = await body("shops_buyer_cancel_order(uuid, text)");
const iLock = bc.indexOf("FOR UPDATE"), iRead = bc.indexOf("shop_order_free_cancel_until("), iWrite = bc.indexOf("UPDATE public.shop_orders SET status");
ok(!skip && iLock > 0 && iRead > iLock && iWrite > iRead && bc.split("shop_order_free_cancel_until(").length === 2,
  "buyer cancel: FOR UPDATE, then one free-cancel reading, then the status write");
let noHttp = true;
for (const fn of ["shops_buyer_cancel_order(uuid, text)", "shops_shop_cancel_order(uuid, text)", "shops_report_no_show(uuid)", "shop_refund_sweep()",
  "shops_admin_refund_order(uuid, text, text)", "shop_write_refund(uuid, text, text)"]) {
  const b = await body(fn);
  if (/net\.http|http_post|pg_net/i.test(b)) noHttp = false;
  const lock = b.indexOf("FOR UPDATE") >= 0 ? b.indexOf("FOR UPDATE") : b.indexOf("shop_lock_open_charged_order(");
  const write = b.search(/UPDATE public\.shop_orders SET status|shop_write_refund\(|INSERT INTO public\.shop_refunds/);
  if (!(lock >= 0 && write > lock)) { noHttp = false; console.log(`  lock order wrong: ${fn}`); }
}
ok(!skip && noHttp, "every refund/cancel path locks the order before it writes, and calls no network (Stripe runs after commit)");

// --- 14. the Louisiana marketplace-facilitator counter (R.S. 47:340.1): completed facilitated
//     sales only (items, no fee, no tax), this calendar year in Louisiana time; the alert threshold (facilitator_threshold_check) fires once a year.
const year = Number(one(await svc(`SELECT extract(year FROM (now() AT TIME ZONE 'America/Chicago'))::int`)));
const ytd = async () => Number(one(await svc(`SELECT public.facilitated_la_sales_cents(${year})`)));
const expected = Number(one(await svc(`SELECT COALESCE(sum(items_cents), 0) FROM public.shop_orders WHERE NOT is_seed AND (status = 'handed_over'
  OR (status = 'cancelled' AND close_reason IN ('buyer_cancelled_late', 'buyer_no_show')))`)));
ok(!skip && expected > 0 && await ytd() === expected,
  "counts handed-over Shops orders and the late cancels / no-shows the shop is paid for: items only");
ok(!skip && Number(one(await svc(`SELECT count(*) FROM public.shop_orders WHERE status IN ('refunded', 'accepted', 'expired', 'declined')`))) > 0,
  "setup: refunded and open orders exist (and are not counted above)");
await svc(`INSERT INTO public.declutter_orders (status, handed_over_at, items_cents) VALUES ('handed_over', now(), 5000), ('paid', NULL, 7000),
  ('refunded', NULL, 9000), ('handed_over', now(), 4000)`);
await svc(`UPDATE public.declutter_orders SET is_seed = true WHERE items_cents = 4000`);
await svc(`INSERT INTO public.declutter_orders (status, handed_over_at, items_cents) VALUES ('handed_over', now() - interval '400 days', 6000000)`);
ok(!skip && await ytd() === expected + 5000, "Declutter: handed over this year only; never paid-but-open, refunded, seed or last year's");
let check = one(await svc(`SELECT public.facilitator_threshold_check()`));
ok(!skip && check?.crossed_now === false && check.ops_alert_due === false && check.duty_cents === 10000000, "under $80,000: no alert");
await svc(`INSERT INTO public.declutter_orders (status, handed_over_at, items_cents) VALUES ('handed_over', now(), ${8000000 - expected - 5000})`);
check = one(await svc(`SELECT public.facilitator_threshold_check()`));
ok(!skip && check?.crossed_now === true && check.ops_alert_due === true && check.total_cents === 8000000
  && await notes(ADMIN, "Louisiana sales tax registration coming") === 1 && await notes(ADMIN2, "Louisiana sales tax registration coming") === 1,
  "at $80,000 every admin is told and the ops alert is due");
check = one(await svc(`SELECT public.facilitator_threshold_check()`));
ok(!skip && check?.crossed_now === false && check.ops_alert_due === true && await notes(ADMIN, "Louisiana sales tax registration coming") === 1,
  "the admins are told once a year; the ops alert stays due until it is sent");
await svc(`SELECT public.facilitator_alert_sent(${year})`);
check = one(await svc(`SELECT public.facilitator_threshold_check()`));
ok(!skip && check?.crossed_now === false && check.ops_alert_due === false, "once sent, it never fires again that year");
ok(!skip && one(await member(ADMIN, `SELECT public.shops_admin_queue()`))?.facilitator?.ytd_cents === 8000000, "the admin Shops page shows the year-to-date total");
ok(!skip && !(await can("authenticated", "facilitated_la_sales_cents(integer)")) && !(await can("authenticated", "facilitator_threshold_check()"))
  && !(await can("authenticated", "facilitator_alert_sent(integer)")), "the counter's functions are service only");

console.log(`\n${pass} PASS, ${fail} FAIL${skip ? " (NEW_MIGRATION=skip)" : ""}`);
process.exit(fail === 0 ? 0 : 1);
