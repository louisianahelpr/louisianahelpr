#!/usr/bin/env node
/**
 * PGlite proof for 20261112074135_shops_hide_refunds_open_orders.sql (Shops audit 11-12 S001, spec L75): hiding a shop
 * refunds its charged open orders IN FULL (shop pays the card cost), declines / closes its waiting ones with no charge,
 * tells the buyers and the shop, leaves handed-over orders alone, and refuses the whole hide while an order is still
 * being charged (nothing left open, nothing refunded twice).
 *
 *   node src/test/pglite/shopsHideRefunds.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsHideRefunds.pglite.mjs # RED: the old shops_admin_set_hidden
 *   MUTANT=<name> node ...                                               # each must FAIL
 *
 * Real: shops_admin_set_hidden (this file, or with skip its newest CREATE in 20261110195956), shop_lock_open_charged_order
 * (verbatim from 20261109224952), shop_refund_fee_policy (verbatim from 20261108184654). Stubbed, and said so: tables cut
 * to the columns read; shop_write_refund writes a row with the policy and a 30-cent fee (its own proof is shopsRefunds);
 * has_role from user_roles; auth.uid() from a setting; declutter_notify records the notice.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261112074135_shops_hide_refunds_open_orders.sql";
const skip = process.env.NEW_MIGRATION === "skip";

const MUTANTS = {
  noRefund: ["      r := public.shop_write_refund(o.id, 'shop_removed', left(btrim(p_reason), 500));\n", "      r := NULL;\n"],
  buyerPaysFee: ["public.shop_write_refund(o.id, 'shop_removed',", "public.shop_write_refund(o.id, 'buyer_cancelled',"],
  heldLeftOpen: ["              WHERE so.shop_id = p_shop_id AND so.status IN ('held', 'awaiting_hold') ORDER BY so.id FOR UPDATE", "              WHERE false"],
  hideOnlyNew: ["  IF p_hidden THEN\n    FOR c IN", "  IF p_hidden AND (SELECT hidden_at IS NULL FROM public.shops WHERE id = p_shop_id) THEN\n    FOR c IN"],
  skipUncharged: ["      o := public.shop_lock_open_charged_order(c.id, true);", "      CONTINUE WHEN (SELECT captured_at IS NULL FROM public.shop_orders WHERE id = c.id);\n      o := public.shop_lock_open_charged_order(c.id, true);"],
  noBuyerNotice: ["      PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Order refunded',", "      PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Something',"],
};

let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };
const U = (n) => `6e0b6e0c-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ADMIN = U(1), OWNER = U(2), BUYER = U(3), SHOP = U(4), SHOP2 = U(5);

function fnFrom(file, name) {
  const t = readFileSync(MIG_DIR + file, "utf8");
  const s = t.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (s < 0) throw new Error(`${name} not in ${file}`);
  const tag = t.slice(s).match(/\nAS (\$[a-z_]*\$)/)[1];
  const open = t.indexOf(`\nAS ${tag}`, s) + 4 + tag.length;
  const end = t.indexOf(`\n${tag}`, open) + 1 + tag.length;
  return t.slice(s, end) + ";";
}

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('test.uid', true), '')::uuid $f$;
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE FUNCTION public.has_role(p uuid, r text) RETURNS boolean LANGUAGE sql STABLE AS
  $f$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p AND role = r) $f$;
CREATE FUNCTION public.require_feature(text) RETURNS void LANGUAGE sql AS 'SELECT NULL::void';
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS 'SELECT false';
CREATE TABLE public.shops (id uuid PRIMARY KEY, owner_id uuid, name text, hidden_at timestamptz, hidden_by uuid, hidden_reason text,
  updated_at timestamptz);
CREATE TABLE public.admin_audit_log (admin_id uuid, action text, target_type text, target_id text, details jsonb);
CREATE TABLE public.shop_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid, buyer_id uuid, seller_id uuid,
  status text NOT NULL, captured_at timestamptz, close_reason text, closed_at timestamptz, ready_date date DEFAULT current_date,
  is_digital boolean NOT NULL DEFAULT false, stripe_payment_intent_id text, total_cents integer NOT NULL DEFAULT 2000);
CREATE TABLE public.shop_handovers (order_id uuid PRIMARY KEY, problem_at timestamptz);
CREATE FUNCTION public.shop_order_unaccounted_hand_refund(uuid) RETURNS boolean LANGUAGE sql AS 'SELECT false';
CREATE TABLE public.shop_refunds (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, reason text, fee_policy text,
  card_fee_cents integer, kept_cents integer, tax_kept_cents integer, refund_cents integer, note text);
CREATE TABLE public.notices (user_id uuid, title text, message text);
CREATE FUNCTION public.declutter_notify(u uuid, ty text, ti text, m text, l text, a uuid DEFAULT NULL) RETURNS void LANGUAGE sql AS
  $f$ INSERT INTO public.notices VALUES (u, ti, m) $f$;
${fnFrom("20261108184654_shops_preorders.sql", "shop_refund_fee_policy")}
CREATE FUNCTION public.shop_write_refund(p uuid, reason text, note text) RETURNS public.shop_refunds LANGUAGE plpgsql AS $f$
DECLARE r public.shop_refunds; v_pol text := public.shop_refund_fee_policy(reason); v_total integer;
BEGIN
  SELECT total_cents INTO v_total FROM public.shop_orders WHERE id = p;
  INSERT INTO public.shop_refunds (order_id, reason, fee_policy, card_fee_cents, kept_cents, tax_kept_cents, refund_cents, note)
  VALUES (p, reason, v_pol, 30, CASE WHEN v_pol = 'keep_card_fee' THEN 30 ELSE 0 END, 0,
          v_total - CASE WHEN v_pol = 'keep_card_fee' THEN 30 ELSE 0 END, note) RETURNING * INTO r;
  RETURN r;
END $f$;
${fnFrom("20261109224952_notices_card_fee_and_our_team.sql", "shop_lock_open_charged_order")}
INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
INSERT INTO public.shops (id, owner_id, name) VALUES ('${SHOP}', '${OWNER}', 'Mimi''s Kitchen'), ('${SHOP2}', '${OWNER}', 'Second');
`);
if (skip) {
  await db.exec(fnFrom("20261110195956_shops_paperwork_queue.sql", "shops_admin_set_hidden"));
} else {
  let mig = readFileSync(MIG_DIR + THIS, "utf8");
  const M = process.env.MUTANT ?? "";
  if (M) {
    const m = MUTANTS[M];
    if (!m || mig.split(m[0]).length !== 2) throw new Error(`mutant ${M} did not apply`);
    mig = mig.replace(m[0], m[1]);
  }
  for (let k = 1; k <= 3; k++) await db.exec(mig);
}

const q = async (s) => (await db.query(s)).rows;
const order = async (shop, status, captured, extra = "") =>
  (await q(`INSERT INTO public.shop_orders (shop_id, buyer_id, seller_id, status, captured_at, stripe_payment_intent_id ${extra ? ", is_digital" : ""})
    VALUES ('${shop}', '${BUYER}', '${OWNER}', '${status}', ${captured ? "now()" : "NULL"}, 'pi_x' ${extra ? `, ${extra}` : ""}) RETURNING id`))[0].id;
const hide = async (shop, hidden = true) => {
  await db.exec(`SELECT set_config('test.uid', '${ADMIN}', false)`);
  try { await q(`SELECT public.shops_admin_set_hidden('${shop}', ${hidden}, 'Selling alcohol')`); return null; } catch (e) { return e.message; }
};
const st = async (id) => (await q(`SELECT status, close_reason FROM public.shop_orders WHERE id = '${id}'`))[0];
const refunds = async (id) => q(`SELECT * FROM public.shop_refunds WHERE order_id = '${id}'`);

try {
  const charged = await order(SHOP, "accepted", true);
  const digital = await order(SHOP, "accepted", true, "true");
  const held = await order(SHOP, "held", false);
  const waiting = await order(SHOP, "awaiting_hold", false);
  const done = await order(SHOP, "handed_over", true);
  const err = await hide(SHOP);
  check(err === null, "the hide goes through", err ?? "");
  const r1 = await refunds(charged);
  check((await st(charged)).status === "refunded" && r1.length === 1 && r1[0].reason === "shop_removed",
    "S001: a charged open order is refunded and closed", JSON.stringify([await st(charged), r1]));
  check(r1[0]?.fee_policy === "full_shop_pays_fee" && r1[0]?.refund_cents === 2000 && r1[0]?.kept_cents === 0,
    "S001: refunded IN FULL; the shop pays the card cost", JSON.stringify(r1[0]));
  check((await st(digital)).status === "refunded" && (await refunds(digital)).length === 1, "S001: a paid download is refunded too");
  check((await st(held)).status === "declined", "S001: an order waiting for the shop's answer is declined (the hold goes back, no charge)");
  check((await st(waiting)).status === "cancelled", "S001: an order still on its pay page is closed (a late payment is cancel_hold)");
  check((await st(done)).status === "handed_over" && (await refunds(done)).length === 0, "S001: a handed-over order is final and untouched");
  const buyerNotices = await q(`SELECT title, message FROM public.notices WHERE user_id = '${BUYER}'`);
  check(buyerNotices.filter((n) => n.title === "Order refunded" && /\$20\.00 is on its way back to your card/.test(n.message)).length === 2,
    "S001: each refunded buyer is told \"Order refunded ... $20.00 is on its way back to your card\"", JSON.stringify(buyerNotices));
  const ownerNotice = await q(`SELECT message FROM public.notices WHERE user_id = '${OWNER}'`);
  check(ownerNotice.length === 1 && /2 refunded to the buyers in full and 2 not charged/.test(ownerNotice[0].message) && /\$0\.60 card cost/.test(ownerNotice[0].message),
    "S001: the shop is told once, with the counts and its card cost", JSON.stringify(ownerNotice));
  const audit = await q(`SELECT details FROM public.admin_audit_log WHERE action = 'shop_hidden'`);
  check(audit[0]?.details?.orders_refunded === 2 && audit[0]?.details?.orders_closed === 2, "S001: the audit log records the counts");

  // A repeat hide refunds nothing twice; an unhide does nothing to orders.
  const err2 = await hide(SHOP);
  check(err2 === null && (await refunds(charged)).length === 1, "S001: hiding an already hidden shop refunds nothing twice", err2 ?? "");
  // An order left open on a shop hidden before this rule (or slipped in): hiding again closes it.
  const stray = await order(SHOP, "accepted", true);
  await hide(SHOP);
  check((await st(stray)).status === "refunded", "S001: hiding again closes an order left open on an already hidden shop");
  await hide(SHOP, false);
  const after = await order(SHOP, "accepted", true);
  await hide(SHOP, false);
  check((await st(after)).status === "accepted", "S001: unhiding touches no order");

  // An order still being charged refuses the whole hide (nothing left open on a hidden shop).
  const charging = await order(SHOP2, "accepted", false);
  const other = await order(SHOP2, "accepted", true);
  const err3 = await hide(SHOP2);
  const hiddenNow = (await q(`SELECT hidden_at FROM public.shops WHERE id = '${SHOP2}'`))[0].hidden_at;
  check(/order_not_charged_yet/.test(err3 ?? "") && hiddenNow === null && (await st(other)).status === "accepted" && (await refunds(other)).length === 0,
    "S001: an order still being charged refuses the whole hide, and nothing is refunded", err3 ?? "no error");
  await db.exec(`UPDATE public.shop_orders SET captured_at = now() WHERE id = '${charging}'`);
  const err4 = await hide(SHOP2);
  check(err4 === null && (await st(charging)).status === "refunded" && (await st(other)).status === "refunded",
    "S001: once charged, the hide goes through and refunds both", err4 ?? "");
} catch (e) {
  check(false, `threw: ${e.message}`);
}

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
