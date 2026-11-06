#!/usr/bin/env node
/**
 * PGlite proof for 20261106221300_shops_custom_balance_edge.sql (Shops custom orders slice 2b part 2, Builder 4,
 * 11-06): the deposit's sales tax goes back on a close where no item changed hands (LEAD 11-06 tax rule), as the
 * order's one shop_refunds row with the new reason unpaid_close_tax. Its fee policy is keep_card_fee (the buyer's own
 * close; the deposit's whole card fee is already kept, so the row keeps 0 more), every other reason is unchanged, and
 * the step is written once.
 *
 *   node src/test/pglite/shopsCustomBalanceEdge.pglite.mjs                      # ALL PASS (2a + 2b p1 + this, 3x)
 *   EDGE_MIGRATION=skip node src/test/pglite/shopsCustomBalanceEdge.pglite.mjs  # RED
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/shopsCustomBalanceEdge.pglite.mjs
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const url = (p) => new URL(`../../../supabase/migrations/${p}`, import.meta.url).pathname;
const SPLIT = readFileSync(url("20261106212437_shops_custom_deposit_split.sql"), "utf8");
const BALANCE = readFileSync(url("20261106215722_shops_custom_deposit_balance.sql"), "utf8");
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? url("20261106221300_shops_custom_balance_edge.sql"), "utf8");

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
const skip = process.env.EDGE_MIGRATION === "skip";
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

const BUYER = "00000000-0000-0000-0000-000000000001";
const SELLER = "00000000-0000-0000-0000-000000000011";
const today = one(await svc(`SELECT d::text FROM public.today`));
const plus = (n) => new Date(Date.parse(`${today}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
let seq = 0;
/** A deposit order, held and accepted with the deposit captured. items 4000, fee 270, tax `tax` -> rest's tax floor(tax/2). */
async function accepted(ready = today, tax = 300) {
  seq += 1;
  const id = one(await svc(`INSERT INTO public.shop_orders (buyer_id, seller_id, items_cents, premium_cents, total_cents, ready_date, payment_plan)
    VALUES ('${BUYER}', '${SELLER}', 4000, 270, 4270, '${ready}', 'deposit_50') RETURNING id`));
  await svc(`UPDATE public.shop_orders SET status = 'held', tax_cents = ${tax}, total_cents = ${4270 + tax},
    stripe_checkout_session_id = 'cs_test_${seq}', stripe_payment_intent_id = 'pi_dep_${seq}', payment_livemode = false WHERE id = '${id}'`);
  await svc(`UPDATE public.shop_orders SET status = 'accepted', captured_at = now(), card_fee_cents = 90 WHERE id = '${id}'`);
  return id;
}

// --- 1. the reason and its fee policy
const policy = async (r) => one(await svc(`SELECT public.shop_refund_fee_policy('${r}') AS p`));
ok(await policy("unpaid_close_tax") === "keep_card_fee", "unpaid_close_tax keeps the card fee (the buyer's own close, not our mistake)");
const before = { buyer_cancelled: "keep_card_fee", problem_no_fault: "keep_card_fee", shop_cancelled: "full_shop_pays_fee",
  no_ready_photo: "full_shop_pays_fee", shop_removed: "full_shop_pays_fee", problem_shop_fault: "full_shop_pays_fee",
  problem_our_mistake: "full_platform_absorbs" };
const got = {};
for (const r of Object.keys(before)) got[r] = await policy(r);
ok(JSON.stringify(got) === JSON.stringify(before), `every other reason is unchanged (${JSON.stringify(got)})`);
ok(await policy("made_up") === null, "an unknown reason has no policy (the table CHECK refuses it)");

// --- 2. the lapse: the deposit's tax back, once
const a = await accepted(plus(-8));
const swept = await svc(`SELECT * FROM public.shop_balance_lapse_sweep()`);
ok(Array.isArray(swept) && swept.some((s) => s.order_id === a), "the order lapses (7 days after the ready date)");
const doneA = one(await svc(`SELECT public.shop_lapse_tax_done('${a}') AS r`));
const ra = await refundOf(a);
ok(doneA?.result === "done" && doneA.tax_cents === 150 && ra && doneA.refund_id === ra.id, `the step is done and writes the refund row (${JSON.stringify(doneA)})`);
ok(ra?.reason === "unpaid_close_tax" && ra.fee_policy === "keep_card_fee" && ra.paid_cents === 150 && ra.tax_cents === 0
  && ra.card_fee_cents === 0 && ra.kept_cents === 0 && ra.tax_kept_cents === 0 && ra.refund_cents === 150,
  `the row gives back the deposit's tax (300 - floor(300/2) = 150) and keeps nothing more (${JSON.stringify(ra && { ...ra, created_at: 0, next_attempt_at: 0 })})`);
ok(ra?.stripe_payment_intent_id === "pi_dep_1" && ra.status === "pending", "on the deposit's payment, pending for declutter-money to send");
ok((await row(a)).lapse_tax_done_at instanceof Date, "the order records the step done");
ok(one(await svc(`SELECT public.shop_lapse_tax_done('${a}') AS r`))?.result === "not_owed"
  && one(await svc(`SELECT count(*)::int FROM public.shop_refunds WHERE order_id = '${a}'`)) === 1, "a second call writes nothing");
ok(!(await svc(`SELECT * FROM public.shop_lapse_tax_due(50)`)).some((t) => t.order_id === a), "no longer listed as owed");

// --- 3. odd tax: the deposit took the larger half
const b = await accepted(today, 301);
await svc(`UPDATE public.shop_orders SET status = 'cancelled', close_reason = 'buyer_cancelled_late', closed_at = now() WHERE id = '${b}'`);
await svc(`SELECT public.shop_lapse_tax_done('${b}')`);
ok((await refundOf(b))?.refund_cents === 151, "a late cancel with the rest unpaid: tax 301 -> the deposit's 151 back");

// --- 4. no tax: the step is done, no row
const c = await accepted(today, 0);
await svc(`UPDATE public.shop_orders SET status = 'cancelled', close_reason = 'buyer_no_show', closed_at = now() WHERE id = '${c}'`);
const doneC = one(await svc(`SELECT public.shop_lapse_tax_done('${c}') AS r`));
ok(doneC?.result === "done" && doneC.refund_id === null && (await refundOf(c)) === undefined, "no tax on the order: done, no refund row");

// --- 5. an order that already has its refund row: logged, never a second row
const d = await accepted(today, 300);
await svc(`INSERT INTO public.shop_refunds (order_id, stripe_payment_intent_id, reason, fee_policy, paid_cents, tax_cents, card_fee_cents,
  kept_cents, tax_kept_cents, refund_cents) VALUES ('${d}', 'pi_other_d', 'problem_our_mistake', 'full_platform_absorbs', 100, 0, 0, 0, 0, 100)`);
await svc(`UPDATE public.shop_orders SET status = 'cancelled', close_reason = 'buyer_cancelled_late', closed_at = now() WHERE id = '${d}'`);
const doneD = one(await svc(`SELECT public.shop_lapse_tax_done('${d}') AS r`));
ok(doneD?.refund_id === null && one(await svc(`SELECT count(*)::int FROM public.shop_refunds WHERE order_id = '${d}'`)) === 1
  && one(await svc(`SELECT count(*)::int FROM public.cron_defects WHERE job = 'shop_lapse_tax_done' AND ref = '${d}'`)) === 1,
  "an order with a refund row already: a cron defect for a person, never a second row");

// --- 6. only an order that owes it
const e = await accepted(today, 300);
ok(one(await svc(`SELECT public.shop_lapse_tax_done('${e}') AS r`))?.result === "not_owed" && (await refundOf(e)) === undefined,
  "an open order owes no tax step");
ok(!Array.isArray(await svc(`INSERT INTO public.shop_refunds (order_id, stripe_payment_intent_id, reason, fee_policy, paid_cents, tax_cents,
  card_fee_cents, kept_cents, tax_kept_cents, refund_cents) VALUES ('${e}', 'pi_x_e', 'unpaid_close_tax', 'full_platform_absorbs', 150, 0, 0, 0, 0, 150)`)),
  "the table refuses unpaid_close_tax under any policy but keep_card_fee");

// --- 7. grants
const grants = await svc(`SELECT p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS m,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS a FROM pg_proc p
  WHERE p.proname IN ('shop_refund_fee_policy', 'shop_lapse_tax_done')`);
ok(Array.isArray(grants) && grants.length === 2 && grants.every((x) => !x.m && !x.a), `service only (${JSON.stringify(grants)})`);

console.log(`\n${pass} PASS, ${fail} FAIL${skip ? " (EDGE_MIGRATION=skip)" : ""}`);
process.exit(fail ? 1 : 0);
