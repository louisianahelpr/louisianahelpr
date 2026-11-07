#!/usr/bin/env node
/**
 * PGlite proof for 20261107170121_shops_custom_balance_buyer_pays.sql (Builder 4, 11-07; lh-money-escrow review of 2b,
 * LEAD 11-07): the rest of a 50% deposit order never silently runs out on the buyer. A due order with no saved card is
 * listed (the edge makes it the buyer's at once); the 3rd failed try of any kind is the buyer's (notice once); a payment
 * of any amount but the rest owed is answered 'refund'; an unpaid close of a shop-delivers order gives back the
 * deposit's tax AND the deposit's half of the delivery (and the buyer's notice says so).
 *
 *   node src/test/pglite/shopsCustomBalanceBuyerPays.pglite.mjs                               # ALL PASS (3x)
 *   BUYER_PAYS_MIGRATION=skip node src/test/pglite/shopsCustomBalanceBuyerPays.pglite.mjs      # RED
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const url = (p) => new URL(`../../../supabase/migrations/${p}`, import.meta.url).pathname;
const SPLIT = readFileSync(url("20261106212437_shops_custom_deposit_split.sql"), "utf8");
const BALANCE = readFileSync(url("20261106215722_shops_custom_deposit_balance.sql"), "utf8");
const EDGE = readFileSync(url("20261106221300_shops_custom_balance_edge.sql"), "utf8");
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? url("20261107170121_shops_custom_balance_buyer_pays.sql"), "utf8");

function cutFn(file, name) {
  const s = readFileSync(url(file), "utf8");
  const at = s.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (at < 0) throw new Error(`${name} not in ${file}`);
  const tag = /AS\s+(\$[a-zA-Z_]*\$)/.exec(s.slice(at));
  const bodyStart = at + tag.index + tag[0].length;
  const end = s.indexOf(tag[1], bodyStart) + tag[1].length;
  return `${s.slice(at, end)};`;
}
/** The real shop_refunds table (every CHECK), as 20261019071055 creates it. */
function cutTable(file, name) {
  const s = readFileSync(url(file), "utf8");
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
CREATE TABLE public.shops (id uuid PRIMARY KEY);
CREATE TABLE public.shop_custom_requests (id uuid PRIMARY KEY);
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
CREATE TABLE public.shop_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, seller_id uuid, shop_id uuid,
  status text NOT NULL DEFAULT 'awaiting_hold', close_reason text, ready_date date NOT NULL DEFAULT '2026-12-01',
  items_cents int NOT NULL, premium_cents int NOT NULL, tax_cents int NOT NULL DEFAULT 0, delivery_cents int NOT NULL DEFAULT 0,
  fulfillment text NOT NULL DEFAULT 'pickup', total_cents int NOT NULL, setup_fee_cents int NOT NULL DEFAULT 0, setup_fee_state text,
  card_fee_cents int, stripe_checkout_session_id text, stripe_payment_intent_id text, payment_livemode boolean,
  captured_at timestamptz, handed_over_at timestamptz, closed_at timestamptz);
CREATE TABLE public.shop_handovers (order_id uuid PRIMARY KEY, ready_at timestamptz, ready_photo_path text,
  shop_confirmed_at timestamptz, confirmed_at timestamptz, confirmed_how text, problem_at timestamptz);
CREATE TABLE public.shop_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL UNIQUE, items_cents int NOT NULL,
  debt_cents int NOT NULL, amount_cents int NOT NULL, status text NOT NULL, next_attempt_at timestamptz);
CREATE FUNCTION public.shop_delivery_reserved_cents(p_order uuid) RETURNS int LANGUAGE sql STABLE AS $$ SELECT 0 $$;
`;

const db = new PGlite();
await db.exec(SCHEMA);
await db.exec(cutFn("20261014224914_declutter_slice3b_payments.sql", "declutter_card_fee_estimate"));
await db.exec(cutFn("20261102040952_declutter_card_fee_prorated.sql", "declutter_card_fee_left"));
await db.exec(cutFn("20261019071055_shops_refunds_cancels_strikes.sql", "shop_refund_fee_policy"));
await db.exec(cutFn("20261019071055_shops_refunds_cancels_strikes.sql", "shop_refund_tax_kept"));
await db.exec(cutTable("20261019071055_shops_refunds_cancels_strikes.sql", "shop_refunds"));
await db.exec(SPLIT);
await db.exec(BALANCE);
await db.exec(EDGE);
const skip = process.env.BUYER_PAYS_MIGRATION === "skip";
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
const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);
const row = async (id) => (await svc(`SELECT * FROM public.shop_orders WHERE id = '${id}'`))[0] ?? {};
const refundOf = async (id) => (await svc(`SELECT * FROM public.shop_refunds WHERE order_id = '${id}'`))[0];
const notes = async (title) => one(await svc(`SELECT count(*)::int FROM public.notifications WHERE title = '${title}'`));

const BUYER = "00000000-0000-0000-0000-000000000001";
const SELLER = "00000000-0000-0000-0000-000000000011";
const today = one(await svc(`SELECT d::text FROM public.today`));
const plus = (n) => new Date(Date.parse(`${today}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
let seq = 0;
/** An accepted deposit order (items 4000, fee 270, tax `tax`, delivery `delivery` when the shop delivers). */
async function accepted({ ready = today, tax = 300, delivery = 0, card = true } = {}) {
  seq += 1;
  const fulfillment = delivery > 0 ? "shop_delivers" : "pickup";
  const id = one(await svc(`INSERT INTO public.shop_orders (buyer_id, seller_id, items_cents, premium_cents, total_cents, ready_date,
      payment_plan, delivery_cents, fulfillment)
    VALUES ('${BUYER}', '${SELLER}', 4000, 270, ${4270 + delivery}, '${ready}', 'deposit_50', ${delivery}, '${fulfillment}') RETURNING id`));
  await svc(`UPDATE public.shop_orders SET status = 'held', tax_cents = ${tax}, total_cents = ${4270 + delivery + tax},
    stripe_checkout_session_id = 'cs_test_${seq}', stripe_payment_intent_id = 'pi_dep_${seq}', payment_livemode = false WHERE id = '${id}'`);
  await svc(`UPDATE public.shop_orders SET status = 'accepted', captured_at = now(), card_fee_cents = 90 WHERE id = '${id}'`);
  if (card) await svc(`SELECT public.shop_order_record_saved_card('${id}', 'cus_${seq}', 'pm_${seq}')`);
  return id;
}

// --- 1. a due order with no saved card is listed (the edge makes it the buyer's at once)
const nc = await accepted({ card: false });
const withCard = await accepted();
const due = await svc(`SELECT * FROM public.shop_balances_due(50)`);
const ids = Array.isArray(due) ? due.map((d) => d.order_id) : [];
ok(ids.includes(nc) && ids.includes(withCard), `no saved card is listed too (${JSON.stringify(due).slice(0, 200)})`);
ok(Array.isArray(due) && due.find((d) => d.order_id === nc)?.payment_method_id === null, "...with no card (the edge calls shop_balance_failed as the buyer's)");
const later = await accepted({ ready: plus(3), card: false });
ok(!ids.includes(later) && !(await svc(`SELECT * FROM public.shop_balances_due(50)`)).some((d) => d.order_id === later), "not before the ready date");

// --- 2. the 3rd failed try of any kind is the buyer's to pay (told once)
const f = await accepted();
const t1 = one(await svc(`SELECT public.shop_balance_failed('${f}', 'api down', false) AS r`));
const t2 = one(await svc(`SELECT public.shop_balance_failed('${f}', 'api down', false) AS r`));
ok(t1?.result === "will_retry" && t2?.result === "will_retry" && (await row(f)).balance_failed_at === null, "tries 1 and 2 (not the card's): will retry, nobody told");
const before = await notes("Pay the rest of your order");
const t3 = one(await svc(`SELECT public.shop_balance_failed('${f}', 'api down', false) AS r`));
const rf = await row(f);
ok(t3?.result === "buyer_pays" && rf.balance_failed_at instanceof Date && rf.balance_attempts === 3, `the 3rd try is the buyer's (${JSON.stringify(t3)})`);
ok(await notes("Pay the rest of your order") === before + 1, "the buyer is told once");
const msg = one(await svc(`SELECT message FROM public.notifications WHERE title = 'Pay the rest of your order' ORDER BY ctid DESC LIMIT 1`));
ok(/automatically/.test(msg ?? "") && !/to your card/.test(msg ?? ""), `the notice does not say "your card" (${msg})`);
await svc(`SELECT public.shop_balance_failed('${f}', 'api down', false)`);
ok(await notes("Pay the rest of your order") === before + 1, "never told twice");
ok(!(await svc(`SELECT * FROM public.shop_balances_due(50)`)).some((d) => d.order_id === f), "no longer charged by the clock");
const card = await accepted();
ok(one(await svc(`SELECT public.shop_balance_failed('${card}', 'declined', true) AS r`))?.result === "buyer_pays", "a card error is still the buyer's at once");

// --- 3. only exactly the rest owed is recorded
const p = await accepted();
const rest = (await row(p)).balance_cents;
const wrong = one(await svc(`SELECT public.shop_balance_paid('${p}', 'pi_rest_w', 50, ${rest + 1}) AS r`));
ok(wrong?.result === "refund" && wrong.reason === "amount_differs" && (await row(p)).balance_payment_intent_id === null,
  `a payment of another amount is given back, never recorded (${JSON.stringify(wrong)})`);
ok((await svc(`SELECT public.shop_balance_paid('${p}', 'pi_rest_n', 50, NULL)`))?.error?.includes("invalid_payment"), "no amount: refused");
const right = one(await svc(`SELECT public.shop_balance_paid('${p}', 'pi_rest_ok', 50, ${rest}) AS r`));
ok(right?.result === "paid" && (await row(p)).balance_payment_intent_id === "pi_rest_ok", "exactly the rest: paid");
ok(one(await svc(`SELECT count(*)::int FROM pg_proc WHERE proname = 'shop_balance_paid'`)) === 1, "the 3-argument version is gone (one signature)");

// --- 4. an unpaid close gives back the deposit's tax and, for shop delivery, the deposit's half of the delivery
const d = await accepted({ ready: plus(-8), tax: 301, delivery: 501 });
const pick = await accepted({ ready: plus(-8), tax: 301 });
const notax = await accepted({ ready: plus(-8), tax: 0, delivery: 500 });
const swept = await svc(`SELECT * FROM public.shop_balance_lapse_sweep()`);
ok(Array.isArray(swept) && [d, pick, notax].every((x) => swept.some((s) => s.order_id === x)), "all three lapse");
const lapseMsg = async (id) => one(await svc(`SELECT n.message FROM public.notifications n WHERE n.title = 'Custom order cancelled' AND n.user_id = '${BUYER}'
  AND n.message LIKE '%' || to_char((SELECT ready_date FROM public.shop_orders WHERE id = '${id}'), 'FMMonth FMDD') || '%' ORDER BY ctid DESC LIMIT 1`));
ok(/its share of the delivery price/.test((await lapseMsg(d)) ?? ""), "the buyer's notice names the delivery share");
for (const id of [d, pick, notax]) await svc(`SELECT public.shop_lapse_tax_done('${id}')`);
const rd = await refundOf(d);
ok(rd?.refund_cents === (301 - 150) + (501 - 250) && rd.paid_cents === rd.refund_cents && rd.reason === "unpaid_close_tax" && rd.kept_cents === 0,
  `shop delivers: tax 151 + delivery 251 = 402 back (${rd?.refund_cents})`);
ok((await refundOf(pick))?.refund_cents === 151, "pickup: the deposit's tax only, as before");
ok((await refundOf(notax))?.refund_cents === 250, "no tax, shop delivers: the delivery half alone (250)");

// --- 5. grants
const grants = await svc(`SELECT p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS m,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS a FROM pg_proc p
  WHERE p.proname IN ('shop_balances_due', 'shop_balance_failed', 'shop_balance_paid', 'shop_lapse_tax_done', 'shop_balance_lapse_sweep')`);
ok(Array.isArray(grants) && grants.length === 5 && grants.every((x) => !x.m && !x.a), `service only (${JSON.stringify(grants)})`);

console.log(`\n${pass} PASS, ${fail} FAIL${skip ? " (BUYER_PAYS_MIGRATION=skip)" : ""}`);
process.exit(fail ? 1 : 0);
