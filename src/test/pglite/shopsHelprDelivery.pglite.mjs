#!/usr/bin/env node
/**
 * PGlite proof for 20261106194913_shops_helpr_delivery.sql, the MONEY part (Builder 5, 11-06): a Helpr delivery's
 * price follows Declutter's rules (declutter_close_paid_order, declutter_delivery_reserved_cents, row 40).
 *   - no Helpr took it ('unfilled'): one delivery refund (no_helpr), the order stays open as a pickup;
 *   - a refund of the order before the pickup gives the delivery back WITH the order (no second row);
 *   - a refund after a delivery refund, or after the Helpr picked it up, leaves the delivery out (reserved);
 *   - a late cancel or a no-show (nothing else refunded, the shop paid its items) gives the delivery back alone,
 *     unless the Helpr already picked it up: then the Helpr is paid (helpr_task_payouts) and nothing goes back;
 *   - the open task of a closed order is cancelled; the shop is never paid the Helpr's price;
 *   - the payout queues count the app's delivery refunds, so the charge still reads whole;
 *   - members cannot call any of the service functions.
 *
 *   node src/test/pglite/shopsHelprDelivery.pglite.mjs                     # ALL PASS (the migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsHelprDelivery.pglite.mjs  # RED
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/shopsHelprDelivery.pglite.mjs
 *
 * Stub schema in the shape of shopsDelivery.pglite.mjs; check_function_bodies is off, so only what a test CALLS is
 * stubbed or cut. The functions whose behaviour is proved are cut verbatim from their newest CREATE.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const url = (p) => new URL(`../../../supabase/migrations/${p}`, import.meta.url).pathname;
const SLICE1 = readFileSync(url("20261106180902_shops_delivery.sql"), "utf8");
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? url("20261106194913_shops_helpr_delivery.sql"), "utf8");

/** The newest CREATE of a function in one older migration, verbatim (any dollar tag). */
function cutFn(file, name) {
  const s = readFileSync(url(file), "utf8");
  const at = s.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (at < 0) throw new Error(`${name} not in ${file}`);
  const tag = /AS\s+(\$[a-zA-Z_]*\$)/.exec(s.slice(at));
  const bodyStart = at + tag.index + tag[0].length;
  const end = s.indexOf(tag[1], bodyStart) + tag[1].length;
  return `${s.slice(at, end)};`;
}

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const [BUYER, OWNER, HELPR, SHOP] = [1, 11, 21, 91].map(id);

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
CREATE FUNCTION public.require_feature(p_key text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.test_accounts WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501';
  END IF;
END $$;
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.shops_assert_owner_eligible() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT auth.uid() $$;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, stripe_account_id text);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text, message text);
CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid)
RETURNS void LANGUAGE sql AS $$ INSERT INTO public.notifications (user_id, title, message) VALUES (p_user, p_title, p_message) $$;
CREATE FUNCTION public.declutter_consume_fee_debt(p_seller uuid, p_ref text, p_max int) RETURNS int LANGUAGE sql AS $$ SELECT 0 $$;
CREATE TABLE public.shops (id uuid PRIMARY KEY, owner_id uuid UNIQUE, name text, daily_order_cap smallint,
  pin_lat numeric(8,5) NOT NULL, pin_lng numeric(8,5) NOT NULL, updated_at timestamptz);
CREATE TABLE public.shop_pickup_addresses (shop_id uuid PRIMARY KEY, owner_id uuid NOT NULL, line1 text NOT NULL,
  line2 text, city text NOT NULL, postal_code text NOT NULL);
CREATE TABLE public.shop_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, seller_id uuid, shop_id uuid,
  status text NOT NULL DEFAULT 'awaiting_hold', close_reason text, ready_date date NOT NULL DEFAULT '2026-12-01',
  items_cents int NOT NULL, premium_cents int NOT NULL, tax_cents int NOT NULL DEFAULT 0, total_cents int NOT NULL,
  card_fee_cents int, setup_fee_cents int NOT NULL DEFAULT 0, setup_fee_state text,
  stripe_checkout_session_id text UNIQUE, stripe_payment_intent_id text UNIQUE, payment_livemode boolean,
  is_seed boolean NOT NULL DEFAULT false, held_at timestamptz, accept_by timestamptz, accepted_at timestamptz,
  captured_at timestamptz, handed_over_at timestamptz, closed_at timestamptz,
  handover_mode text NOT NULL DEFAULT 'in_person',
  CONSTRAINT shop_orders_total CHECK (total_cents = items_cents + premium_cents + tax_cents));
CREATE FUNCTION public.shop_day_count(uuid, date, text[]) RETURNS int LANGUAGE sql STABLE AS $$ SELECT 0 $$;
CREATE TABLE public.shop_handovers (order_id uuid PRIMARY KEY, confirmed_at timestamptz, confirmed_how text,
  problem_at timestamptz, problem_note text, ready_at timestamptz, is_seed boolean NOT NULL DEFAULT false);
CREATE TABLE public.shop_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL UNIQUE, items_cents int NOT NULL,
  debt_cents int NOT NULL, amount_cents int NOT NULL, status text NOT NULL, next_attempt_at timestamptz, attempts int NOT NULL DEFAULT 0,
  CONSTRAINT shop_payouts_amount CHECK (amount_cents = items_cents - debt_cents AND amount_cents >= 0));
CREATE TABLE public.shop_hand_refunds (order_id uuid, failed_at timestamptz, outcome text);
CREATE FUNCTION public.shop_order_free_cancel_until(uuid) RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT now() - interval '1 hour' $$;
CREATE FUNCTION public.shop_lock_open_charged_order(p_order uuid, p_x boolean) RETURNS public.shop_orders LANGUAGE sql AS
  $$ SELECT * FROM public.shop_orders WHERE id = p_order $$;
CREATE FUNCTION public.shop_give_strike(uuid, text, text, uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
-- Declutter's Helpr task, in the columns these functions read (20261017055505:74-140 and later ALTERs).
CREATE TABLE public.helpr_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_kind text NOT NULL CONSTRAINT helpr_tasks_source_kind_check
  CHECK (source_kind IN ('declutter_delivery')), source_id uuid NOT NULL, status text NOT NULL DEFAULT 'open',
  size text NOT NULL DEFAULT 'small', title text NOT NULL DEFAULT 'Order', pay_cents int NOT NULL, fee_cents int NOT NULL,
  raised_cents int NOT NULL DEFAULT 0, customer_id uuid, pickup_contact_id uuid, helpr_id uuid,
  pickup_slot_start timestamptz, picked_up_at timestamptz, latest_pickup_at timestamptz, open_until timestamptz,
  confirmed_at timestamptz, confirmed_by text, closed_at timestamptz, close_note text, updated_at timestamptz,
  stuck_stage text, seller_no_show_reported_at timestamptz, seller_no_show_answered_at timestamptz,
  seller_no_show_settled_at timestamptz, UNIQUE (source_kind, source_id));
CREATE TABLE public.helpr_task_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid NOT NULL UNIQUE, helpr_id uuid, pay_cents int NOT NULL,
  fee_cents int NOT NULL, debt_cents int NOT NULL, amount_cents int NOT NULL, status text NOT NULL,
  attempts int NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.task_log (task_id uuid, event text, note text);
-- The order's own refund row, in the columns shop_refund_executed and the recorded sum read (20261019071055).
CREATE TABLE public.shop_refunds (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL UNIQUE,
  stripe_payment_intent_id text NOT NULL, reason text NOT NULL, refund_cents int NOT NULL, status text NOT NULL DEFAULT 'pending',
  stripe_refund_id text, attempts int NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(), last_error text,
  executed_at timestamptz);
-- What helpr_task_payouts_due joins for a Declutter task (empty here: only shop tasks are read).
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, stripe_payment_intent_id text);
CREATE TABLE public.declutter_delivery_raises (id uuid PRIMARY KEY, task_id uuid, status text, stripe_payment_intent_id text,
  raise_cents int, applied_at timestamptz);
CREATE TABLE public.helpr_task_tips (id uuid PRIMARY KEY, task_id uuid, held boolean, payment_status text, payout_transfer_id text,
  stripe_payment_intent_id text, tip_cents int, paid_at timestamptz);
CREATE FUNCTION public.declutter_order_refunds_recorded_cents(uuid) RETURNS int LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION public.declutter_order_gift_net_cents(uuid) RETURNS int LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION public.helpr_task_log(p_task uuid, p_event text, p_actor uuid, p_note text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO public.task_log VALUES (p_task, p_event, p_note) $$;
`;

const REAL = [
  cutFn("20261017055505_declutter_helpr_delivery.sql", "helpr_task_distance_m"),
  cutFn("20261101175628_declutter_delivery_price_6_plus_150.sql", "declutter_delivery_price_cents"),
  cutFn("20261018211820_shops_handover_payout.sql", "shop_money_rows_seed"),
  cutFn("20261021181118_helpr_delivery_payout_round_down.sql", "helpr_payout_round_down_cents"),
  cutFn("20261014224914_declutter_slice3b_payments.sql", "declutter_card_fee_estimate"),
  cutFn("20261102040952_declutter_card_fee_prorated.sql", "declutter_card_fee_left"),
  cutFn("20261019071055_shops_refunds_cancels_strikes.sql", "shop_refund_fee_policy"),
  cutFn("20261019071055_shops_refunds_cancels_strikes.sql", "shop_refund_tax_kept"),
  cutFn("20261019071055_shops_refunds_cancels_strikes.sql", "shop_refund_amounts"),
  cutFn("20261019071055_shops_refunds_cancels_strikes.sql", "shop_order_unaccounted_hand_refund"),
  cutFn("20261019071055_shops_refunds_cancels_strikes.sql", "shop_payouts_due"),
  cutFn("20261103111244_money_webhooks_not_found_is_404.sql", "shop_refund_executed"),
  cutFn("20261103091013_shops_promotions_team_message_not_found_is_404.sql", "shops_order_cancel_quote"),
  cutFn("20261031231150_helpr_delivery_cant_finish.sql", "helpr_task_confirm"),
  cutFn("20261031181404_declutter_notices_name_the_item_sweep_remind_task.sql", "helpr_task_close"),
  cutFn("20261103162420_q2390_handover_paid_refund_shop_cancel_photo_no_show_decline_not_found_is_404.sql", "shops_report_no_show"),
].join("\n");
const ROUTED = readFileSync(url("20261104105545_declutter_road_miles_routed.sql"), "utf8").split("-- Q807:")[0];

const db = new PGlite();
await db.exec("SET check_function_bodies = off;");
await db.exec(SCHEMA);
await db.exec(REAL);
await db.exec(ROUTED);
await db.exec(SLICE1);
const skip = process.env.NEW_MIGRATION === "skip";
if (!skip) for (let i = 0; i < 3; i++) await db.exec(MIGRATION);

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
const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);
const refused = (r, re) => !Array.isArray(r) && re.test(r.error);

await db.exec(`
  INSERT INTO auth.users (id) VALUES ('${BUYER}'), ('${OWNER}'), ('${HELPR}');
  INSERT INTO public.test_accounts (user_id) VALUES ('${BUYER}'), ('${OWNER}');
  INSERT INTO public.profiles (user_id, stripe_account_id) VALUES ('${OWNER}', 'acct_1'), ('${HELPR}', 'acct_h');
  INSERT INTO public.shops (id, owner_id, name, pin_lat, pin_lng) VALUES ('${SHOP}', '${OWNER}', 'Bayou Bakes', 30.22, -92.02);
  INSERT INTO public.shop_pickup_addresses (shop_id, owner_id, line1, city, postal_code) VALUES ('${SHOP}', '${OWNER}', '12 Oak St', 'Lafayette', '70501');`);

// A charged Helpr order as shop-checkout + capture leave it: items $20, fee $1.70, delivery 4 mi = $6 + $6 = $12.
const DELIVERY = 1200;
let n = 0;
async function helprOrder(taskStatus) {
  n++;
  const o = one(await svc(`
    INSERT INTO public.shop_orders (buyer_id, seller_id, shop_id, items_cents, premium_cents, total_cents, card_fee_cents)
    VALUES ('${BUYER}', '${OWNER}', '${SHOP}', 2000, 170, 2170, 93) RETURNING id`));
  // As shop_set_order_helpr_delivery leaves it (before the Stripe page: the delivery freezes after).
  const set = await svc(`UPDATE public.shop_orders SET fulfillment = 'helpr_delivers', delivery_cents = ${DELIVERY},
      delivery_miles = 4, total_cents = total_cents + ${DELIVERY} WHERE id = '${o}' RETURNING id`);
  const charged = await svc(`UPDATE public.shop_orders SET status = 'accepted', captured_at = now(), stripe_payment_intent_id = 'pi_${n}'
      WHERE id = '${o}' RETURNING id`);
  if (!Array.isArray(set) || !Array.isArray(charged)) console.log("  (helpr order not set:", set.error ?? charged.error, ")");
  let t = null;
  if (taskStatus) {
    t = one(await svc(`INSERT INTO public.helpr_tasks (source_kind, source_id, status, pay_cents, fee_cents, customer_id,
        pickup_contact_id, helpr_id) VALUES ('shop_delivery', '${o}', '${taskStatus}', ${DELIVERY}, 130, '${BUYER}', '${OWNER}',
        ${taskStatus === "open" ? "NULL" : `'${HELPR}'`}) RETURNING id`));
  }
  return { o, t };
}
const deliveryRefunds = async (o) => svc(`SELECT reason, refund_cents, status FROM public.shop_delivery_refunds WHERE order_id = '${o}'`);
const taskStatus = async (t) => one(await svc(`SELECT status FROM public.helpr_tasks WHERE id = '${t}'`));
const amounts = async (o, reason) => (await svc(`SELECT * FROM public.shop_refund_amounts('${o}', '${reason}')`))[0] ?? {};

// --- 1. no Helpr took it (Declutter row 40)
{
  const { o, t } = await helprOrder("open");
  const r = await svc(`SELECT public.shop_delivery_on_task_event('${o}', '${t}', 'unfilled', 'auto') AS r`);
  ok(Array.isArray(r), `the unfilled event runs (${JSON.stringify(r)})`);
  const rows = await deliveryRefunds(o);
  ok(Array.isArray(rows) && rows.length === 1 && rows[0].reason === "no_helpr" && rows[0].refund_cents === DELIVERY,
    `unfilled writes ONE delivery refund of the whole $12 (${JSON.stringify(rows)})`);
  await svc(`SELECT public.shop_delivery_on_task_event('${o}', '${t}', 'unfilled', 'auto')`);
  ok((await deliveryRefunds(o)).length === 1, "a second unfilled event writes no second refund");
  const st = (await svc(`SELECT status, helpr_unfilled_at IS NOT NULL AS u FROM public.shop_orders WHERE id = '${o}'`))[0];
  ok(st?.status === "accepted" && st?.u === true, "the order stays open as a pickup at the shop");
  const a = await amounts(o, "shop_cancelled");
  ok(a.paid_cents === 2170 && a.refund_cents === 2170, `a later full refund leaves the delivery out: refund ${a.refund_cents} of ${a.paid_cents} (not ${2170 + DELIVERY})`);
  ok(one(await svc(`SELECT public.shop_order_refunds_recorded_cents('${o}')`)) === 0, "a pending delivery refund is not yet recorded on the charge");
  const rid = one(await svc(`SELECT id FROM public.shop_delivery_refunds WHERE order_id = '${o}'`));
  ok(one(await svc(`SELECT public.shop_delivery_refund_executed('${rid}', 're_1', true, NULL)`)) === "succeeded", "the money step records the refund");
  ok(one(await svc(`SELECT public.shop_order_refunds_recorded_cents('${o}')`)) === DELIVERY, "a sent delivery refund counts as recorded on the charge");
  ok(refused(await svc(`SELECT public.shop_delivery_refund_executed('${rid}', 'nope', true, NULL)`), /invalid_refund/), "a success needs a Stripe refund id");
  // The shop's payout of this order reads the recorded refund, so declutter-money finds the charge whole.
  await svc(`UPDATE public.shop_orders SET status = 'handed_over' WHERE id = '${o}'`);
  await svc(`INSERT INTO public.shop_payouts (order_id, items_cents, debt_cents, amount_cents, status, next_attempt_at) VALUES ('${o}', 2000, 0, 2000, 'pending', now() - interval '1 minute')`);
  const due = await svc(`SELECT order_id, refunds_recorded_cents FROM public.shop_payouts_due(50) WHERE order_id = '${o}'`);
  ok(Array.isArray(due) && due[0]?.refunds_recorded_cents === DELIVERY, `shop_payouts_due carries the recorded delivery refund (${JSON.stringify(due)})`);
  // Stripe later fails that refund (charge.refund.updated): the row reopens for a new send and stops counting.
  ok(one(await svc(`SELECT public.shop_delivery_refund_reversed('${rid}', 're_other', 'failed')`)) === "unchanged", "another refund id reopens nothing");
  ok(one(await svc(`SELECT public.shop_delivery_refund_reversed('${rid}', 're_1', 'failed: lost')`)) === "reopened", "the recorded refund's failure reopens the row");
  const back = (await svc(`SELECT status, attempts, stripe_refund_id FROM public.shop_delivery_refunds WHERE id = '${rid}'`))[0];
  ok(back?.status === "failed" && back?.attempts === 1 && back?.stripe_refund_id === null, `due again under a new key (${JSON.stringify(back)})`);
  ok(one(await svc(`SELECT public.shop_order_refunds_recorded_cents('${o}')`)) === 0, "a failed refund is no longer counted on the charge");
  ok(Array.isArray(await svc(`SELECT 1 FROM public.shop_delivery_refunds_due(50) WHERE refund_id = '${rid}'`))
     && (await svc(`SELECT 1 FROM public.shop_delivery_refunds_due(50) WHERE refund_id = '${rid}'`)).length === 1, "declutter-money picks it up again");
}

// --- 2. a refund of the order before the pickup: the delivery goes back WITH the order
{
  const { o, t } = await helprOrder("accepted");
  const a = await amounts(o, "shop_cancelled");
  ok(a.paid_cents === 2170 + DELIVERY && a.refund_cents === 2170 + DELIVERY, `before the pickup a shop cancel refunds everything, delivery included (${a.refund_cents})`);
  await svc(`UPDATE public.shop_orders SET status = 'refunded', close_reason = 'shop_cancelled' WHERE id = '${o}'`);
  ok(await taskStatus(t) === "cancelled", "the booked task is cancelled (no Helpr drives to a closed order)");
  ok((await deliveryRefunds(o)).length === 0, "no separate delivery refund: it is inside the order's refund");
  ok(one(await svc(`SELECT count(*)::int FROM public.helpr_task_payouts WHERE task_id = '${t}'`)) === 0, "the Helpr who never picked up is not paid");
}

// --- 3. a refund after the Helpr picked it up: the Helpr is paid, the delivery is reserved
{
  const { o, t } = await helprOrder("picked_up");
  const a = await amounts(o, "problem_shop_fault");
  ok(a.paid_cents === 2170 && a.refund_cents === 2170, `after the pickup the refund leaves the Helpr's $12 out (${a.refund_cents})`);
  await svc(`UPDATE public.shop_orders SET status = 'refunded', close_reason = 'problem_shop_fault' WHERE id = '${o}'`);
  ok(await taskStatus(t) === "confirmed", "the Helpr's trip is confirmed by 'admin'");
  const p = (await svc(`SELECT amount_cents, status FROM public.helpr_task_payouts WHERE task_id = '${t}'`))[0];
  const take = one(await svc(`SELECT public.helpr_payout_round_down_cents(${DELIVERY - 130})`));
  ok(take > 0 && p?.amount_cents === take && p?.status === "pending",
    `the Helpr is owed the price less the Helpr fee, Declutter's round-down (${JSON.stringify(p)}, expected ${take})`);
  ok((await deliveryRefunds(o)).length === 0, "nothing of the delivery goes back");
  // Money review BLOCK on ab7172ee77: once Stripe confirms the order's refund, the Helpr's payout still reads the charge
  // whole (amount_refunded 2170 = recorded 2170), so the trip is paid from what is left of it.
  const rf = one(await svc(`INSERT INTO public.shop_refunds (order_id, stripe_payment_intent_id, reason, refund_cents)
      SELECT '${o}', stripe_payment_intent_id, 'problem_shop_fault', ${a.refund_cents} FROM public.shop_orders WHERE id = '${o}' RETURNING id`));
  const pend = await svc(`SELECT refunds_recorded_cents FROM public.helpr_task_payouts_due(50) WHERE task_id = '${t}'`);
  ok(Array.isArray(pend) && pend[0]?.refunds_recorded_cents === 0, `a pending order refund is not recorded yet (${JSON.stringify(pend)})`);
  ok(one(await svc(`SELECT public.shop_refund_executed('${rf}', 're_order_${n}', true, NULL)`)) === "succeeded", "Stripe confirms the order's refund");
  const due = await svc(`SELECT refunds_recorded_cents, transfer_group, payment_intent_id FROM public.helpr_task_payouts_due(50) WHERE task_id = '${t}'`);
  ok(Array.isArray(due) && due[0]?.refunds_recorded_cents === 2170 && due[0]?.transfer_group === `shop_order_${o}` && due[0]?.payment_intent_id === `pi_${n}`,
    `the Helpr's payout counts the order's refund as recorded, from the shop order's charge (${JSON.stringify(due)})`);
  ok(refused(await svc(`SELECT public.shop_delivery_refund('${o}', 'delivery_not_done')`), /delivery_made/), "a delivery refund is refused once the Helpr made the trip");
}

// --- 4. a late cancel before the pickup: the shop is paid its items, the delivery goes back alone
{
  const { o, t } = await helprOrder("accepted");
  const q = await as("authenticated", BUYER, `SELECT public.shops_order_cancel_quote('${o}') AS q`);
  const qq = Array.isArray(q) ? q[0].q : q;
  ok(qq?.free === false && qq?.refund_cents === DELIVERY && qq?.kept_cents === 2170, `the late-cancel quote shows the delivery coming back (${JSON.stringify(qq)})`);
  await svc(`UPDATE public.shop_orders SET status = 'cancelled', close_reason = 'buyer_cancelled_late' WHERE id = '${o}'`);
  const owed = one(await svc(`SELECT public.shop_owe_shop('${o}')`));
  ok(owed === 2000, `the shop is owed its items only, never the Helpr's price (${owed})`);
  ok(await taskStatus(t) === "cancelled", "the booked task is cancelled");
  const rows = await deliveryRefunds(o);
  ok(Array.isArray(rows) && rows.length === 1 && rows[0].reason === "delivery_not_done" && rows[0].refund_cents === DELIVERY,
    `the delivery nobody made goes back (${JSON.stringify(rows)})`);
  const note = one(await svc(`SELECT message FROM public.notifications WHERE user_id = '${BUYER}' AND title = 'Delivery money coming back' ORDER BY id LIMIT 1`));
  ok(typeof note === "string" && note.includes("$12.00"), `the buyer is told the $12 comes back (${note})`);
}

// --- 5. a late cancel after the pickup: the Helpr is paid, nothing goes back
{
  const { o, t } = await helprOrder("delivered");
  await svc(`UPDATE public.shop_orders SET status = 'cancelled', close_reason = 'buyer_cancelled_late' WHERE id = '${o}'`);
  ok(await taskStatus(t) === "confirmed", "the Helpr who delivered is confirmed");
  ok((await deliveryRefunds(o)).length === 0, "no delivery refund after the trip was made");
  ok(one(await svc(`SELECT public.shop_delivery_reserved_cents('${o}')`)) === DELIVERY, "the delivery is reserved");
}

// --- 6. a no-show reported by the shop: as a late cancel
{
  const { o, t } = await helprOrder("open");
  await svc(`UPDATE public.shop_orders SET status = 'cancelled', close_reason = 'buyer_no_show' WHERE id = '${o}'`);
  ok(await taskStatus(t) === "cancelled", "a no-show cancels the open task");
  ok((await deliveryRefunds(o))[0]?.reason === "delivery_not_done", "a no-show gives the delivery back");
}

// --- 7. what is NOT a Helpr delivery is untouched
{
  const o = one(await svc(`INSERT INTO public.shop_orders (buyer_id, seller_id, shop_id, items_cents, premium_cents, total_cents, status,
      captured_at, stripe_payment_intent_id) VALUES ('${BUYER}', '${OWNER}', '${SHOP}', 2000, 170, 2170, 'accepted', now(), 'pi_pickup') RETURNING id`));
  ok(refused(await svc(`SELECT public.shop_delivery_refund('${o}', 'no_helpr')`), /no_delivery_fee/), "a pickup order has no delivery refund");
  await svc(`UPDATE public.shop_orders SET status = 'cancelled', close_reason = 'buyer_cancelled_late' WHERE id = '${o}'`);
  ok((await deliveryRefunds(o)).length === 0, "a late cancel of a pickup order writes nothing");
  ok((await amounts(o, "shop_cancelled")).refund_cents === 2170, "a pickup order's refund is unchanged");
}

// --- 8. the service functions are not members'
for (const fn of ["shop_delivery_refund(uuid, text)", "shop_delivery_refund_executed(uuid, text, boolean, text)",
                  "shop_delivery_refunds_due(integer)", "shop_delivery_reserved_cents(uuid)", "shop_order_refunds_recorded_cents(uuid)"]) {
  const r = await svc(`SELECT has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE') AS m,
                              has_function_privilege('anon', 'public.${fn}', 'EXECUTE') AS a`);
  ok(Array.isArray(r) && r[0].m === false && r[0].a === false, `members and anon cannot call ${fn}`);
}
const tbl = await svc(`SELECT has_table_privilege('authenticated', 'public.shop_delivery_refunds', 'SELECT') AS s`);
ok(Array.isArray(tbl) && tbl[0].s === false, "members cannot read shop_delivery_refunds");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
