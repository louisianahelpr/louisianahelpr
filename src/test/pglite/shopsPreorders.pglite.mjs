#!/usr/bin/env node
/**
 * PGlite proof for 20261108184654_shops_preorders.sql (Builder 5, owner 11-08: Shops PREORDERS; pay in full at order,
 * a ready-by date, an optional minimum-orders goal by a deadline).
 *
 *   node src/test/pglite/shopsPreorders.pglite.mjs                               # ALL PASS (migration applied 3x)
 *   PREORDER_MIGRATION=skip node src/test/pglite/shopsPreorders.pglite.mjs       # RED: every behaviour check fails
 *
 * Real code: the shop_refunds table (every CHECK), shop_refund_tax_kept, shop_refund_amounts (newest, 20261107162454),
 * shop_write_refund, shop_lock_open_charged_order, declutter_buyer_fee_cents, the deposit migrations the newest
 * amounts read, and this migration. Stubs: the member gates (ban, strikes, visibility) and the notify sender.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const url = (p) => new URL(`../../../supabase/migrations/${p}`, import.meta.url).pathname;
const read = (p) => readFileSync(url(p), "utf8");
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? url("20261108184654_shops_preorders.sql"), "utf8");

function cutFn(file, name) {
  const s = read(file);
  const at = s.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (at < 0) throw new Error(`${name} not in ${file}`);
  const tag = /AS\s+(\$[a-zA-Z_]*\$)/.exec(s.slice(at));
  const bodyStart = at + tag.index + tag[0].length;
  const end = s.indexOf(tag[1], bodyStart) + tag[1].length;
  return `${s.slice(at, end)};`;
}
function cutTable(file, name) {
  const s = read(file);
  const at = s.indexOf(`CREATE TABLE IF NOT EXISTS public.${name} (`);
  if (at < 0) throw new Error(`${name} not in ${file}`);
  return s.slice(at, s.indexOf("\n);\n", at) + 4);
}

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, onboarding_fee_paid boolean, onboarding_fee_charged_at timestamptz,
  stripe_account_id text, stripe_payouts_enabled boolean);
CREATE TABLE public.shops (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL, name text, paused boolean NOT NULL DEFAULT false,
  offers_selling boolean NOT NULL DEFAULT true, daily_order_cap smallint, cancel_policy text NOT NULL DEFAULT 'until_accept', hidden_at timestamptz);
CREATE TABLE public.shop_custom_requests (id uuid PRIMARY KEY);
CREATE TABLE public.shop_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid NOT NULL, owner_id uuid NOT NULL,
  kind text NOT NULL, status text NOT NULL DEFAULT 'live', title text NOT NULL, price_cents int NOT NULL, stock_count int,
  option_names text[] NOT NULL DEFAULT '{}', updated_at timestamptz);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text, message text);
CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid)
RETURNS void LANGUAGE sql AS $$ INSERT INTO public.notifications (user_id, title, message) VALUES (p_user, p_title, p_message) $$;
CREATE TABLE public.strikes (user_id uuid, reason text, order_id uuid);
CREATE FUNCTION public.shop_give_strike(p_user uuid, p_side text, p_reason text, p_order uuid) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN INSERT INTO public.strikes VALUES (p_user, p_reason, p_order); RETURN gen_random_uuid(); END $$;
CREATE TABLE public.cron_defects (job text, ref text, err text);
CREATE FUNCTION public.log_cron_defect(p_job text, p_ref text, p_err text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO public.cron_defects VALUES (p_job, p_ref, p_err) $$;
CREATE TABLE public.today (d date NOT NULL);
INSERT INTO public.today VALUES ((now() AT TIME ZONE 'America/Chicago')::date);
CREATE FUNCTION public.shop_local_today() RETURNS date LANGUAGE sql STABLE AS $$ SELECT d FROM public.today $$;
CREATE FUNCTION public.declutter_consume_fee_debt(p_seller uuid, p_ref text, p_max int) RETURNS int LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION public.require_feature(p_key text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.shop_active_strike_count(uuid) RETURNS int LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION public.member_under_18(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.shop_visible_to(uuid, uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.are_users_blocked(uuid, uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.shop_owner_sell_block_reason(uuid) RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$;
CREATE FUNCTION public.contact_leak_reason(text) RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$;
CREATE FUNCTION public.shop_cottage_cap_reached(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.shop_line_unit_cents(p_item uuid, p_variant uuid) RETURNS int LANGUAGE sql AS $$ SELECT price_cents FROM public.shop_items WHERE id = p_item $$;
CREATE FUNCTION public.shop_order_unaccounted_hand_refund(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE TABLE public.declutter_seller_fee_debts (seller_id uuid, shop_refund_id uuid UNIQUE, amount_cents int, remaining_cents int);
CREATE TABLE public.shop_cottage_sales (source_ref uuid);
CREATE TABLE public.shop_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, seller_id uuid, shop_id uuid,
  status text NOT NULL DEFAULT 'awaiting_hold', close_reason text, ready_date date NOT NULL DEFAULT '2026-12-01',
  cancel_policy text, note text, is_seed boolean NOT NULL DEFAULT false, handover_mode text NOT NULL DEFAULT 'in_person',
  items_cents int NOT NULL, premium_cents int NOT NULL, tax_cents int NOT NULL DEFAULT 0, delivery_cents int NOT NULL DEFAULT 0,
  fulfillment text NOT NULL DEFAULT 'pickup', total_cents int NOT NULL, setup_fee_cents int NOT NULL DEFAULT 0, setup_fee_state text,
  card_fee_cents int, stripe_checkout_session_id text, stripe_payment_intent_id text, payment_livemode boolean,
  held_at timestamptz, accept_by timestamptz, accepted_at timestamptz,
  captured_at timestamptz, handed_over_at timestamptz, closed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.shop_order_lines (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL, item_id uuid,
  variant_id uuid, variant_label text, title text, kind text, unit_cents int, quantity smallint, line_cents int, is_seed boolean);
CREATE TABLE public.shop_handovers (order_id uuid PRIMARY KEY, ready_at timestamptz, ready_photo_path text,
  shop_confirmed_at timestamptz, confirmed_at timestamptz, confirmed_how text, problem_at timestamptz);
CREATE TABLE public.shop_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL UNIQUE, items_cents int NOT NULL,
  debt_cents int NOT NULL, amount_cents int NOT NULL, status text NOT NULL, next_attempt_at timestamptz, attempts int NOT NULL DEFAULT 0);
CREATE FUNCTION public.shop_delivery_reserved_cents(p_order uuid) RETURNS int LANGUAGE sql STABLE AS $$ SELECT 0 $$;
`;

const db = new PGlite();
await db.exec(SCHEMA);
await db.exec(cutFn("20261014224914_declutter_slice3b_payments.sql", "declutter_card_fee_estimate"));
await db.exec(cutFn("20261102040952_declutter_card_fee_prorated.sql", "declutter_card_fee_left"));
await db.exec(cutFn("20261015023613_declutter_buyer_fee_f1.sql", "declutter_buyer_fee_cents"));
await db.exec(cutFn("20261019071055_shops_refunds_cancels_strikes.sql", "shop_refund_fee_policy"));
await db.exec(cutFn("20261019071055_shops_refunds_cancels_strikes.sql", "shop_refund_tax_kept"));
await db.exec(cutTable("20261019071055_shops_refunds_cancels_strikes.sql", "shop_refunds"));
await db.exec(read("20261106212437_shops_custom_deposit_split.sql"));
await db.exec(read("20261106215722_shops_custom_deposit_balance.sql"));
await db.exec(read("20261106221300_shops_custom_balance_edge.sql"));
await db.exec(cutFn("20261107162454_shops_custom_two_charge_payout.sql", "shop_order_two_charges"));
await db.exec(cutFn("20261107162454_shops_custom_two_charge_payout.sql", "shop_refund_amounts"));
await db.exec(cutFn("20261019071055_shops_refunds_cancels_strikes.sql", "shop_write_refund"));
await db.exec(cutFn("20261103073509_shop_checkout_reach_not_found_is_404.sql", "shop_lock_open_charged_order"));
// The close-reason / status CHECKs as M3 left them (the newest before this migration).
await db.exec(`ALTER TABLE public.shop_orders ADD CONSTRAINT shop_orders_close_reason_check CHECK (close_reason IS NULL OR close_reason IN (
    'superseded', 'page_unpaid', 'no_answer', 'declined', 'buyer_cancelled', 'hold_lost', 'capture_gave_up', 'order_closed',
    'amount_mismatch', 'day_full', 'handed_over', 'buyer_cancelled_free', 'buyer_cancelled_late', 'buyer_no_show', 'shop_cancelled',
    'no_ready_photo', 'admin_refunded', 'refunded_by_hand'));
  ALTER TABLE public.shop_orders ADD CONSTRAINT shop_orders_refunded_captured CHECK (status <> 'refunded' OR (captured_at IS NOT NULL
    AND close_reason IN ('buyer_cancelled_free', 'shop_cancelled', 'no_ready_photo', 'admin_refunded', 'refunded_by_hand')));`);
const skip = process.env.PREORDER_MIGRATION === "skip";
let applyErr = null;
if (!skip) {
  try { for (let i = 0; i < 3; i++) await db.exec(MIGRATION); } catch (e) { applyErr = String(e.message ?? e); }
}

let pass = 0;
let fail = 0;
const ok = (cond, label) => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
};
const svc = async (sql) => {
  try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e), code: e.code }; }
};
const as = async (uid, sql) => {
  try {
    await db.exec(`SELECT set_config('request.jwt.claim.sub', '${uid}', false)`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  } finally {
    await db.exec(`SELECT set_config('request.jwt.claim.sub', '', false)`);
  }
};
const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);
const row = async (id) => (await svc(`SELECT * FROM public.shop_orders WHERE id = '${id}'`))[0] ?? {};
const item = async (id) => (await svc(`SELECT * FROM public.shop_items WHERE id = '${id}'`))[0] ?? {};
const refundOf = async (id) => (await svc(`SELECT * FROM public.shop_refunds WHERE order_id = '${id}'`))[0];
const notes = async (uid, title) => one(await svc(`SELECT count(*)::int FROM public.notifications WHERE user_id = '${uid}' AND title = '${title}'`));

ok(applyErr === null && !skip, `the migration applies 3x (${applyErr ?? (skip ? "skipped" : "ok")})`);

const SELLER = "00000000-0000-0000-0000-000000000011";
const B = ["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002", "00000000-0000-0000-0000-000000000003"];
const today = one(await svc(`SELECT d::text FROM public.today`));
const plus = (n) => new Date(Date.parse(`${today}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const SHOP = one(await svc(`INSERT INTO public.shops (owner_id, name, daily_order_cap) VALUES ('${SELLER}', 'Bayou Bakes', 1) RETURNING id`));
const newItem = async (extra = {}) => one(await svc(`INSERT INTO public.shop_items (shop_id, owner_id, kind, title, price_cents, stock_count, option_names)
  VALUES ('${SHOP}', '${SELLER}', '${extra.kind ?? "made"}', 'King cake', 2000, ${extra.stock ?? "NULL"}, '${extra.options ?? "{}"}') RETURNING id`));
let seq = 0;
/** The buyer orders the preorder and the payment lands (shop_mark_order_held), then the capture is recorded. */
async function preorder(buyer, itemId, qty = 1, { capture = true } = {}) {
  seq += 1;
  const r = await as(buyer, `SELECT public.shops_request_preorder('${SHOP}', '${itemId}', ${qty}, 'hi') AS r`);
  const id = one(r)?.order_id;
  if (!id) return { error: r?.error ?? JSON.stringify(r) };
  const o = await row(id);
  await svc(`UPDATE public.shop_orders SET stripe_checkout_session_id = 'cs_test_p${seq}' WHERE id = '${id}'`);
  const held = one(await svc(`SELECT public.shop_mark_order_held('cs_test_p${seq}', 'pi_p${seq}', ${o.total_cents + 100}, 100, false) AS r`));
  if (capture && held?.result === "held") await svc(`UPDATE public.shop_orders SET captured_at = now(), card_fee_cents = 90 WHERE id = '${id}'`);
  return { id, held };
}

// --- 1. settings: the shop sets a preorder; the limits hold
const it1 = await newItem();
ok((await as(SELLER, `SELECT public.shops_set_item_preorder('${it1}', '${plus(121)}', NULL, NULL, NULL)`))?.error?.includes("preorder_ready_by"), "ready-by more than 120 days out: refused");
ok((await as(SELLER, `SELECT public.shops_set_item_preorder('${it1}', '${plus(30)}', 3, '${plus(31)}', NULL)`))?.error?.includes("preorder_goal_by"), "goal date after ready-by: refused");
ok((await as(SELLER, `SELECT public.shops_set_item_preorder('${it1}', '${plus(30)}', 3, NULL, NULL)`))?.error?.includes("preorder_goal"), "goal with no date: refused");
ok((await as(SELLER, `SELECT public.shops_set_item_preorder('${it1}', '${plus(30)}', 3, '${plus(10)}', 2)`))?.error?.includes("preorder_cap"), "cap below the goal: refused");
ok((await as(B[0], `SELECT public.shops_set_item_preorder('${it1}', '${plus(30)}', NULL, NULL, NULL)`))?.error?.includes("item_not_found"), "another member: refused (not found)");
const stocked = await newItem({ stock: 5 });
ok((await as(SELLER, `SELECT public.shops_set_item_preorder('${stocked}', '${plus(30)}', NULL, NULL, NULL)`))?.error?.includes("preorder_stock"), "an item with a ready-now count: refused");
const svcItem = await newItem({ kind: "service" });
ok((await as(SELLER, `SELECT public.shops_set_item_preorder('${svcItem}', '${plus(30)}', NULL, NULL, NULL)`))?.error?.includes("preorder_kind"), "a service (or digital) item: refused");
const opt = await newItem({ options: "{Size}" });
ok((await as(SELLER, `SELECT public.shops_set_item_preorder('${opt}', '${plus(30)}', NULL, NULL, NULL)`))?.error?.includes("preorder_options"), "an item with options: refused (v1)");
const set1 = one(await as(SELLER, `SELECT public.shops_set_item_preorder('${it1}', '${plus(30)}', 3, '${plus(10)}', 4) AS r`));
ok(set1?.result === "on" && (await item(it1)).preorder_goal === 3, `set: ready by +30, goal 3 by +10, cap 4 (${JSON.stringify(set1)})`);
ok((await svc(`UPDATE public.shop_items SET preorder_ready_by = preorder_set_on + 151 WHERE id = '${it1}'`))?.error?.includes("card_age"),
  "card age: ready-by more than 150 days after it was set is refused by CHECK (150 + 7 = 157 < Stripe's ~180)");

// --- 2. ordering: ready on the preorder's date, accepted at once, never fills the day, the cap holds
const a = await preorder(B[0], it1, 2);
const ra = await row(a.id);
ok(a.held?.result === "held" && a.held?.preorder === true && ra.status === "accepted" && ra.accepted_at !== null, `paid in full at order: accepted at the hold (${JSON.stringify(a.held)})`);
ok(String(ra.ready_date?.toISOString?.().slice(0, 10) ?? ra.ready_date) === plus(30) && ra.preorder_item_id === it1, "the order is ready on the preorder's date");
ok(await notes(B[0], "Order sent") === 0 && await notes(SELLER, "New preorder") === 1, "no 'card is held, 24 hours' notice; the shop hears 'New preorder'");
const b = await preorder(B[1], it1, 1);
ok((await row(b.id)).status === "accepted", "a second preorder the same day: the daily cap (1) never counts preorders");
const full = await as(B[2], `SELECT public.shops_request_preorder('${SHOP}', '${it1}', 2, '') AS r`);
ok(full?.error?.includes("preorder_full"), `the cap (4) refuses a 5th unit (${full?.error})`);
ok((await svc(`UPDATE public.shop_orders SET status = 'cancelled', close_reason = 'buyer_cancelled_late' WHERE id = '${a.id}'`))?.error?.includes("use_preorder_cancel")
   && (await row(a.id)).status === "accepted",
  "the free-window / late cancel (which pays the shop) can never close a preorder");
const reads = await as(B[2], `SELECT * FROM public.shops_item_preorders('${SHOP}')`);
const r1 = Array.isArray(reads) ? reads.find((x) => x.item_id === it1) : null;
ok(r1?.ordered === 3 && r1?.goal === 3 && r1?.cap === 4 && r1?.open === true, `the product page reads 3 of 3 ordered, cap 4, open (${JSON.stringify(r1)})`);

// --- 3. goal met: stamped once, buyers and shop told; a cancel after it keeps it met and refunds (card fee kept)
const s1 = one(await svc(`SELECT public.shop_preorder_sweep() AS r`));
ok(s1?.goal_met === 1 && (await item(it1)).preorder_goal_met_at !== null, `goal met at 3 paid units (${JSON.stringify(s1)})`);
ok(await notes(B[0], "Your preorder is happening") === 1 && await notes(SELLER, "Preorder goal reached") === 1, "buyers and the shop are told");
const c1 = one(await as(B[1], `SELECT public.shops_cancel_preorder('${b.id}') AS r`));
const rb = await refundOf(b.id);
ok(c1?.result === "cancelled" && rb?.reason === "buyer_cancelled" && rb.kept_cents === 90 && (await row(b.id)).close_reason === "preorder_cancelled",
  `buyer cancel: refunded less the card fee (${JSON.stringify(c1)}, kept ${rb?.kept_cents})`);
ok((await item(it1)).preorder_goal_met_at !== null && one(await svc(`SELECT public.shop_preorder_sweep() AS r`))?.goal_missed === 0, "the goal stays met after the cancel");
ok((await as(B[0], `SELECT public.shops_cancel_preorder('${b.id}')`))?.error?.includes("order_not_found"), "another buyer cannot cancel it");
// Money review 11-08 (1): the ready tap counts only from ready-by - 14 days (a's ready-by is +30).
const early = await svc(`INSERT INTO public.shop_handovers (order_id, ready_at) VALUES ('${a.id}', now())`);
ok(early?.error?.includes("preorder_not_ready_yet") && (await svc(`SELECT 1 FROM public.shop_handovers WHERE order_id = '${a.id}'`)).length === 0,
  `a ready tap 30 days before ready-by is refused (${early?.error})`);
await svc(`INSERT INTO public.shop_handovers (order_id) VALUES ('${a.id}')`);
ok((await svc(`UPDATE public.shop_handovers SET ready_at = now() WHERE order_id = '${a.id}'`))?.error?.includes("preorder_not_ready_yet"),
  "...on an existing handover row too (the held-nudge sweep's empty row)");
await svc(`UPDATE public.today SET d = '${plus(16)}'`);
const onTime = await svc(`INSERT INTO public.shop_handovers (order_id, ready_at) VALUES ('${a.id}', now())
  ON CONFLICT (order_id) DO UPDATE SET ready_at = COALESCE(public.shop_handovers.ready_at, EXCLUDED.ready_at)`);
ok(!onTime?.error && (await svc(`SELECT ready_at FROM public.shop_handovers WHERE order_id = '${a.id}'`))[0]?.ready_at != null,
  `from ready-by - 14 the ready tap is accepted (${onTime?.error ?? "ok"})`);
await svc(`UPDATE public.today SET d = '${today}'`);
ok(!(await svc(`INSERT INTO public.shop_handovers (order_id, ready_at) VALUES ('${a.id}', now())
  ON CONFLICT (order_id) DO UPDATE SET ready_photo_path = 'retake'`))?.error, "a retake of an order already marked ready is left alone");
ok((await as(B[0], `SELECT public.shops_cancel_preorder('${a.id}')`))?.error?.includes("preorder_ready"), "no cancel once the shop marked it ready");
// Money review 11-08 (2): an ordinary order's line can never name a preorder item (shops_request_order skips the cap,
// the goal and the refunds); the preorder's own order can, and an ordinary item is unaffected.
const plain = await newItem();
const ord = one(await svc(`INSERT INTO public.shop_orders (buyer_id, seller_id, shop_id, items_cents, premium_cents, total_cents)
  VALUES ('${B[2]}', '${SELLER}', '${SHOP}', 2000, 170, 2170) RETURNING id`));
const viaOrdinary = await svc(`INSERT INTO public.shop_order_lines (order_id, item_id, title, kind, unit_cents, quantity, line_cents)
  VALUES ('${ord}', '${it1}', 'King cake', 'made', 2000, 1, 2000)`);
ok(viaOrdinary?.error?.includes("preorder_use_preorder_checkout"), `an ordinary order of a preorder item is refused (${viaOrdinary?.error})`);
ok(!(await svc(`INSERT INTO public.shop_order_lines (order_id, item_id, title, kind, unit_cents, quantity, line_cents)
  VALUES ('${ord}', '${plain}', 'Plain', 'made', 2000, 1, 2000)`))?.error, "an ordinary item on an ordinary order is unaffected");
ok((await svc(`UPDATE public.shop_order_lines SET item_id = '${it1}' WHERE order_id = '${ord}'`))?.error?.includes("preorder_use_preorder_checkout"),
  "moving a line onto a preorder item is refused too");
// --- 4. goal missed: every paid preorder refunded IN FULL (buyer fee included; the shop carries the card fee), once
const it2 = await newItem();
await as(SELLER, `SELECT public.shops_set_item_preorder('${it2}', '${plus(40)}', 5, '${plus(2)}', NULL)`);
const m1 = await preorder(B[0], it2, 1);
const m2 = await preorder(B[1], it2, 2);
const m3 = await preorder(B[2], it2, 1, { capture: false });
await svc(`UPDATE public.today SET d = '${plus(3)}'`);
// the clock compares the goal date with Louisiana's real date: move the goal date back instead of the clock.
await svc(`UPDATE public.shop_items SET preorder_goal_by = preorder_set_on WHERE id = '${it2}'`);
await svc(`UPDATE public.shop_items SET preorder_set_on = preorder_set_on - 3, preorder_goal_by = preorder_set_on - 3 WHERE id = '${it2}'`);
const s2 = one(await svc(`SELECT public.shop_preorder_sweep() AS r`));
const rm1 = await refundOf(m1.id);
const om1 = await row(m1.id);
ok(s2?.goal_missed === 1 && s2?.goal_missed_refunds === 2, `goal missed: the 2 paid preorders refunded (${JSON.stringify(s2)})`);
ok(rm1?.reason === "preorder_goal_missed" && rm1.fee_policy === "full_shop_pays_fee" && rm1.refund_cents === om1.total_cents && rm1.kept_cents === 0,
  `a FULL refund: ${rm1?.refund_cents} = total ${om1.total_cents} (items + buyer fee + tax), nothing kept from the buyer`);
ok(one(await svc(`SELECT count(*)::int FROM public.declutter_seller_fee_debts WHERE shop_refund_id = '${rm1?.id}'`)) === 1,
  "the card fee is the shop's (owner 10-14: we never absorb a fee)");
ok(om1.status === "refunded" && om1.close_reason === "preorder_goal_missed", "the order is closed refunded");
ok(await notes(B[1], "Preorder refunded") === 1 && await notes(SELLER, "Preorder goal not reached") === 1, "buyer and shop told");
ok((await refundOf(m3.id)) === undefined, "a preorder not captured yet is not refunded yet...");
await svc(`UPDATE public.shop_orders SET captured_at = now(), card_fee_cents = 90 WHERE id = '${m3.id}'`);
const s3 = one(await svc(`SELECT public.shop_preorder_sweep() AS r`));
ok(s3?.goal_missed_refunds === 1 && (await refundOf(m3.id))?.reason === "preorder_goal_missed", "...and is refunded by the next run once captured");
const s4 = one(await svc(`SELECT public.shop_preorder_sweep() AS r`));
ok(s4?.goal_missed_refunds === 0 && s4?.goal_missed === 0 && one(await svc(`SELECT count(*)::int FROM public.shop_refunds WHERE reason = 'preorder_goal_missed'`)) === 3,
  "a repeat run refunds nothing twice (one refund row per order)");
ok((await as(B[2], `SELECT public.shops_request_preorder('${SHOP}', '${it2}', 1, '')`))?.error?.includes("preorder_closed"), "no new preorders after a miss");
await svc(`UPDATE public.today SET d = '${today}'`);

// --- 5. push the date once (<= 30 days), buyers told; a cancel then is a FULL refund (shop pays the card fee)
const it3 = await newItem();
await as(SELLER, `SELECT public.shops_set_item_preorder('${it3}', '${plus(20)}', NULL, NULL, NULL)`);
const p1 = await preorder(B[0], it3, 1);
ok((await as(SELLER, `SELECT public.shops_push_preorder_date('${it3}', '${plus(51)}')`))?.error?.includes("preorder_push_range"), "push by more than 30 days: refused");
const pushed = one(await as(SELLER, `SELECT public.shops_push_preorder_date('${it3}', '${plus(50)}') AS r`));
ok(pushed?.result === "moved" && pushed.orders === 1 && String((await row(p1.id)).ready_date?.toISOString?.().slice(0, 10)) === plus(50), `pushed 30 days; the order moved too (${JSON.stringify(pushed)})`);
ok(await notes(B[0], "Preorder date moved") === 1, "the buyer is told and may cancel");
ok((await as(SELLER, `SELECT public.shops_push_preorder_date('${it3}', '${plus(51)}')`))?.error?.includes("preorder_already_moved"), "only once");
const pc = one(await as(B[0], `SELECT public.shops_cancel_preorder('${p1.id}') AS r`));
const rp = await refundOf(p1.id);
ok(rp?.reason === "preorder_date_moved" && rp.fee_policy === "full_shop_pays_fee" && rp.kept_cents === 0 && pc?.refund_cents === (await row(p1.id)).total_cents,
  `after a push the cancel is a full refund, the shop pays the card fee (${JSON.stringify(pc)})`);
ok(one(await svc(`SELECT count(*)::int FROM public.declutter_seller_fee_debts WHERE shop_refund_id = '${rp?.id}'`)) === 1, "...as a fee debt on the shop");

// --- 6. late: warned at ready-by + 4, refunded at ready-by + 7 if not marked ready (shop pays the card fee)
const it4 = await newItem();
await as(SELLER, `SELECT public.shops_set_item_preorder('${it4}', '${plus(10)}', NULL, NULL, NULL)`);
const l1 = await preorder(B[0], it4, 1);
const l2 = await preorder(B[1], it4, 1);
await svc(`INSERT INTO public.shop_handovers (order_id, ready_at) VALUES ('${l2.id}', now())`);
// The clocks read real time: move the dates back (ready-by 5 days ago -> warning, not yet late).
await svc(`UPDATE public.shop_items SET preorder_set_on = '${plus(-30)}', preorder_ready_by = '${plus(-5)}' WHERE id = '${it4}'`);
await svc(`UPDATE public.shop_orders SET ready_date = '${plus(-5)}' WHERE preorder_item_id = '${it4}'`);
const w = one(await svc(`SELECT public.shop_preorder_sweep() AS r`));
ok(w?.late_warned === 1 && w?.late_refunds === 0 && await notes(SELLER, "Preorder is late") === 1, `warned 3 days before the refunds, nothing refunded yet (${JSON.stringify(w)})`);
ok(one(await svc(`SELECT public.shop_preorder_sweep() AS r`))?.late_warned === 0, "warned once");
await svc(`UPDATE public.shop_items SET preorder_ready_by = '${plus(-8)}' WHERE id = '${it4}'`);
await svc(`UPDATE public.shop_orders SET ready_date = '${plus(-8)}' WHERE preorder_item_id = '${it4}'`);
const late = one(await svc(`SELECT public.shop_preorder_sweep() AS r`));
const rl = await refundOf(l1.id);
ok(late?.late_refunds === 1 && rl?.reason === "preorder_shop_late" && rl.fee_policy === "full_shop_pays_fee" && rl.refund_cents === (await row(l1.id)).total_cents,
  `7 days late: refunded in full (${JSON.stringify(late)})`);
ok((await refundOf(l2.id)) === undefined && (await row(l2.id)).status === "accepted", "an order marked ready is left alone");
ok(await notes(SELLER, "Preorder refunded") === 1, "the shop is told");
// The porch no-photo clock (3 days, with a strike) never fires on a preorder.
const it5 = await newItem();
await as(SELLER, `SELECT public.shops_set_item_preorder('${it5}', '${plus(10)}', NULL, NULL, NULL)`);
const porch = await preorder(B[2], it5, 1);
await svc(`UPDATE public.shop_orders SET handover_mode = 'porch', ready_date = '${plus(-5)}' WHERE id = '${porch.id}'`);
const nophoto = one(await svc(`SELECT public.shop_refund_sweep() AS r`));
ok(nophoto?.no_ready_photo_refunded === 0 && (await refundOf(porch.id)) === undefined, "the porch no-photo clock skips preorders");

// --- 6b. Money review 11-08 (3): a buyer's cancel after the sweep's own trigger is filed as the sweep would file it
//         (the shop pays the card fee), never as the buyer's own cancel.
const it6 = await newItem();
await as(SELLER, `SELECT public.shops_set_item_preorder('${it6}', '${plus(40)}', 5, '${plus(5)}', NULL)`);
const g1 = await preorder(B[0], it6, 1);
await svc(`UPDATE public.shop_items SET preorder_goal_missed_at = now() WHERE id = '${it6}'`);  // stamped; refunds not sent yet
one(await as(B[0], `SELECT public.shops_cancel_preorder('${g1.id}') AS r`));
const rg = await refundOf(g1.id);
ok(rg?.reason === "preorder_goal_missed" && rg.fee_policy === "full_shop_pays_fee" && rg.kept_cents === 0
   && (await row(g1.id)).close_reason === "preorder_goal_missed",
  `a cancel after the goal-missed stamp: filed as goal missed, full refund, the shop pays the fee (${rg?.reason}, kept ${rg?.kept_cents})`);
const it7 = await newItem();
await as(SELLER, `SELECT public.shops_set_item_preorder('${it7}', '${plus(10)}', NULL, NULL, NULL)`);
const lt = await preorder(B[1], it7, 1);
await svc(`UPDATE public.shop_items SET preorder_set_on = '${plus(-30)}', preorder_ready_by = '${plus(-8)}' WHERE id = '${it7}'`);
await svc(`UPDATE public.shop_orders SET ready_date = '${plus(-8)}' WHERE id = '${lt.id}'`);
one(await as(B[1], `SELECT public.shops_cancel_preorder('${lt.id}') AS r`));
const rlt = await refundOf(lt.id);
ok(rlt?.reason === "preorder_shop_late" && rlt.fee_policy === "full_shop_pays_fee" && rlt.kept_cents === 0
   && (await row(lt.id)).close_reason === "preorder_shop_late",
  `a cancel after ready-by + 7: filed as late, full refund, the shop pays the fee (${rlt?.reason}, kept ${rlt?.kept_cents})`);
const it8 = await newItem();
await as(SELLER, `SELECT public.shops_set_item_preorder('${it8}', '${plus(10)}', NULL, NULL, NULL)`);
const ot = await preorder(B[2], it8, 1);
await svc(`UPDATE public.shop_items SET preorder_set_on = '${plus(-30)}', preorder_ready_by = '${plus(-6)}' WHERE id = '${it8}'`);
await svc(`UPDATE public.shop_orders SET ready_date = '${plus(-6)}' WHERE id = '${ot.id}'`);
one(await as(B[2], `SELECT public.shops_cancel_preorder('${ot.id}') AS r`));
ok((await refundOf(ot.id))?.reason === "buyer_cancelled", "before the late time (ready-by + 6) the buyer's own cancel keeps the card fee");

// --- 7. grants
const grants = await svc(`SELECT p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS m,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS a FROM pg_proc p
  WHERE p.proname IN ('shop_preorder_sweep', 'shop_preorder_units', 'shops_set_item_preorder', 'shops_push_preorder_date',
                      'shops_request_preorder', 'shops_cancel_preorder', 'shops_item_preorders')`);
const g = (n) => (Array.isArray(grants) ? grants.find((x) => x.proname === n) : null);
ok(Array.isArray(grants) && grants.length === 7, `7 functions (${Array.isArray(grants) ? grants.length : JSON.stringify(grants)})`);
ok(g("shop_preorder_sweep") && !g("shop_preorder_sweep").m && !g("shop_preorder_units").m && grants.every((x) => !x.a),
  "the sweep and the count are service-only; nothing for anon");
ok(["shops_set_item_preorder", "shops_push_preorder_date", "shops_request_preorder", "shops_cancel_preorder", "shops_item_preorders"].every((n) => g(n)?.m),
  "the member RPCs are callable by members (each checks auth.uid())");
ok(one(await svc(`SELECT count(*)::int FROM public.cron_defects`)) === 0, `no cron defects (${JSON.stringify(await svc(`SELECT * FROM public.cron_defects`))})`);

console.log(`\n${pass} PASS, ${fail} FAIL${skip ? " (PREORDER_MIGRATION=skip)" : ""}`);
process.exit(fail ? 1 : 0);
