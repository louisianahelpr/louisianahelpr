#!/usr/bin/env node
/**
 * Q2105 step 2 (PGlite proof for 20261111025213_shops_gift_hold_steps): the two Shops hold steps add the order's
 * gift_cents back to the card page's amount, both in the amount check and in the total_cents they write.
 *   (1) a pickup order with a gift: the page charges the price less the gift; shop_mark_order_held records it HELD,
 *       total_cents is the whole price (the order's total CHECK and the gift CHECK hold), the gift stays reserved; the
 *       capture then redeems it;
 *   (2) the same with the one-time setup fee on the page (outside total_cents);
 *   (3) a gift order whose page names another tax than the one the gift was sized on: amount_mismatch, the hold goes
 *       back, the gift is put back to 'sent';
 *   (4) a gift order whose page charges the whole price (the gift not taken off): amount_mismatch, gift put back;
 *   (5) an order with no gift is unchanged (the whole price on the page: held, same total);
 *   (6) shop_digital_mark_paid: a gift download is accepted with the whole price as total_cents; a wrong tax refused;
 *   (7) grants service_role only; the file replays 3x.
 *
 *   node src/test/pglite/shopsGiftHoldSteps.pglite.mjs                       # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/shopsGiftHoldSteps.pglite.mjs    # RED: the old hold steps
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/shopsGiftHoldSteps.pglite.mjs  # RED on a planted defect
 *
 * Real: 20261111015126 (the gift ledger) and this file, applied verbatim (this one 3x). With NEW_MIGRATION=skip the
 * old hold steps are read from their newest CREATEs (20261108184654 6a and 20261108185110 2), verbatim.
 * Stubbed, said so: shop_orders, gift_cards, shops, shop_items, shop_order_lines and profiles reduced to the columns
 * read; declutter_notify, shop_day_count, shop_preorder_units, shop_local_today, are_users_blocked are no-op stubs.
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const LEDGER = "20261111015126_shops_gift_card_ledger.sql";
const THIS = "20261111025213_shops_gift_hold_steps.sql";
const skip = process.env.NEW_MIGRATION === "skip";

let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };
const U = (n) => `5d0b5d0c-0000-0000-0000-${String(n).padStart(12, "0")}`;
const BUYER = U(1), SELLER = U(2), SHOP = U(3);

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE public.shops (id uuid PRIMARY KEY, owner_id uuid, name text, daily_order_cap smallint);
CREATE TABLE public.shop_items (id uuid PRIMARY KEY, title text, preorder_ready_by date, preorder_goal_missed_at timestamptz,
  preorder_goal_by date, preorder_cap integer);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, onboarding_fee_paid boolean, onboarding_fee_charged_at timestamptz);
CREATE TABLE public.shop_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid, buyer_id uuid, seller_id uuid,
  status text NOT NULL, items_cents integer NOT NULL, premium_cents integer NOT NULL DEFAULT 0, tax_cents integer NOT NULL DEFAULT 0,
  delivery_cents integer NOT NULL DEFAULT 0, total_cents integer NOT NULL,
  CONSTRAINT shop_orders_total_check CHECK (total_cents = items_cents + premium_cents + tax_cents + delivery_cents),
  stripe_payment_intent_id text, stripe_checkout_session_id text, captured_at timestamptz, card_fee_cents integer,
  setup_fee_cents integer NOT NULL DEFAULT 0, setup_fee_state text, payment_plan text NOT NULL DEFAULT 'full_hold',
  payment_livemode boolean, close_reason text, closed_at timestamptz, held_at timestamptz, accept_by timestamptz,
  accepted_at timestamptz, preorder_item_id uuid, ready_date date, is_digital boolean NOT NULL DEFAULT false,
  capture_attempts integer NOT NULL DEFAULT 0);
CREATE TABLE public.shop_order_lines (order_id uuid, quantity integer);
CREATE TABLE public.gift_cards (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), donor_id uuid, recipient_id uuid, recipient_email text,
  amount numeric NOT NULL, status text NOT NULL, payment_status text, category text, message text, parent_credit_id uuid,
  job_id uuid, declutter_order_id uuid, expires_at timestamptz, redeemed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION public.declutter_notify(uuid, text, text, text, text, uuid) RETURNS void LANGUAGE sql AS 'SELECT NULL::void';
CREATE FUNCTION public.shop_day_count(uuid, date, text[]) RETURNS integer LANGUAGE sql AS 'SELECT 0';
CREATE FUNCTION public.shop_preorder_units(uuid, boolean) RETURNS integer LANGUAGE sql AS 'SELECT 0';
CREATE FUNCTION public.shop_local_today() RETURNS date LANGUAGE sql AS 'SELECT current_date';
CREATE FUNCTION public.are_users_blocked(uuid, uuid) RETURNS boolean LANGUAGE sql AS 'SELECT false';
INSERT INTO public.shops VALUES ('${SHOP}', '${SELLER}', 'Proof Shop', NULL);
INSERT INTO public.profiles VALUES ('${BUYER}', false, NULL);
`);
await db.exec(readFileSync(MIG_DIR + LEDGER, "utf8"));
const between = (file, from, to) => {
  const s = readFileSync(MIG_DIR + file, "utf8");
  const a = s.indexOf(from);
  const b = s.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error(`cannot find the old definition in ${file}`);
  return s.slice(a, b);
};
if (skip) {
  await db.exec(between("20261108184654_shops_preorders.sql", "CREATE OR REPLACE FUNCTION public.shop_mark_order_held", "-- 6b."));
  await db.exec(between("20261108185110_shops_digital_checkout.sql", "CREATE OR REPLACE FUNCTION public.shop_digital_mark_paid", "-- 2b."));
} else {
  const mig = readFileSync(process.env.MIGRATION_PATH ?? MIG_DIR + THIS, "utf8"); // MIGRATION_PATH: a planted copy (vacuity)
  for (let k = 1; k <= 3; k++) await db.exec(mig);
}

const q = async (s, p = []) => (await db.query(s, p)).rows;
const row = async (t, id) => (await q(`SELECT * FROM public.${t} WHERE id = $1`, [id]))[0];
let n = 100;
/** An order as shop-checkout leaves it before the gift: awaiting_hold, total = items + premium + delivery, no tax yet. */
const order = async ({ items = 2000, premium = 170, delivery = 0, fee = 0, digital = false } = {}) => {
  n++;
  const id = U(n);
  await q(`INSERT INTO public.shop_orders (id, shop_id, buyer_id, seller_id, status, items_cents, premium_cents, delivery_cents, total_cents,
             setup_fee_cents, stripe_checkout_session_id, ready_date, is_digital)
           VALUES ($1, $2, $3, $4, 'awaiting_hold', $5, $6, $7, $5::int + $6::int + $7::int, $8, $9, current_date + 2, $10)`,
  [id, SHOP, BUYER, SELLER, items, premium, delivery, fee, null, digital]);
  return id;
};
const gift = async (dollars) => (await q(`INSERT INTO public.gift_cards (donor_id, recipient_id, amount, status, payment_status)
  VALUES ($1, $2, $3, 'sent', 'paid') RETURNING id`, [U(999), BUYER, dollars]))[0].id;
const redeem = async (g, o, tax) => (await q(`SELECT public.redeem_gift_card_for_shop_order($1, $2, $3, $4, NULL) AS r`, [g, o, BUYER, tax]))[0].r;
/** The page opens after the redeem (shop-checkout attaches it): its session id goes on the order. */
const attach = (o) => q(`UPDATE public.shop_orders SET stripe_checkout_session_id = 'cs_' || $1::text WHERE id = $1`, [o]);
const held = async (o, amount, tax) => {
  try { return (await q(`SELECT public.shop_mark_order_held('cs_' || $1::text, 'pi_' || md5($1::text), $2, $3, false) AS r`, [o, amount, tax]))[0].r; }
  catch (e) { return { error: e.message }; }
};
const paidDl = async (o, amount, tax) => {
  try { return (await q(`SELECT public.shop_digital_mark_paid('cs_' || $1::text, 'pi_' || md5($1::text), $2, $3, false, true) AS r`, [o, amount, tax]))[0].r; }
  catch (e) { return { error: e.message }; }
};

// (1) Pickup order, items 2000 + fee 170, tax 195 (whole price 2365); a $10 gift: the page charges 1365.
{
  const o = await order();
  const g = await gift(10);
  const r = await redeem(g, o, 195);
  check(r.outcome === "needs_hold" && r.difference_cents === 1365, "(1) the gift leaves 1365 for the card", JSON.stringify(r));
  await attach(o);
  const h = await held(o, 1365, 195);
  const after = await row("shop_orders", o);
  check(h.result === "held", "(1) the page of price - gift is recorded HELD", JSON.stringify(h));
  check(after.status === "held" && after.total_cents === 2365 && after.tax_cents === 195 && after.gift_cents === 1000,
    "(1) total_cents is the whole price, tax and gift kept", JSON.stringify({ s: after.status, t: after.total_cents, tax: after.tax_cents, g: after.gift_cents }));
  check((await row("gift_cards", g)).status === "reserved", "(1) held alone leaves the gift reserved");
  await q(`UPDATE public.shop_orders SET status = 'accepted', accepted_at = now() WHERE id = $1`, [o]);
  await q(`UPDATE public.shop_orders SET captured_at = now(), card_fee_cents = 70 WHERE id = $1`, [o]);
  check((await row("gift_cards", g)).status === "redeemed", "(1) the capture redeems the gift");
  // A redelivery of the same event is 'already_held' and changes nothing.
  const again = await held(o, 1365, 195);
  check(again.result === "already_held" && (await row("shop_orders", o)).total_cents === 2365, "(1) a redelivery changes nothing", JSON.stringify(again));
}

// (2) The same with the one-time setup fee (1500, outside total_cents) on the page: price 2365 + 1500, gift $20.
{
  const o = await order({ fee: 1500 });
  const g = await gift(20);
  const r = await redeem(g, o, 195);
  check(r.difference_cents === 1865, "(2) the gift leaves 3865 - 2000 = 1865 for the card", JSON.stringify(r));
  await attach(o);
  const h = await held(o, 1865, 195);
  const after = await row("shop_orders", o);
  check(h.result === "held" && after.total_cents === 2365 && after.setup_fee_state === "claimed",
    "(2) held, total_cents the sale, the setup fee claimed", JSON.stringify({ h, t: after.total_cents, f: after.setup_fee_state }));
  await q(`UPDATE public.profiles SET onboarding_fee_paid = false WHERE user_id = $1`, [BUYER]);
}

// (3) A gift order whose page names another tax (0 instead of 195), the amount adding up with that tax.
{
  const o = await order();
  const g = await gift(10);
  await redeem(g, o, 195);
  await attach(o);
  const h = await held(o, 1170, 0);
  const after = await row("shop_orders", o);
  check(h.result === "cancel_hold" && h.reason === "amount_mismatch" && after.status === "expired",
    "(3) another tax than the gift was sized on: amount_mismatch", JSON.stringify(h));
  check((await row("gift_cards", g)).status === "sent", "(3) the gift is put back to 'sent'");
}

// (4) A gift order whose page charges the whole price (the gift not taken off).
{
  const o = await order();
  const g = await gift(10);
  await redeem(g, o, 195);
  await attach(o);
  const h = await held(o, 2365, 195);
  check(h.result === "cancel_hold" && h.reason === "amount_mismatch", "(4) the whole price on a gift page: amount_mismatch", JSON.stringify(h));
  check((await row("gift_cards", g)).status === "sent", "(4) the gift is put back to 'sent'");
}

// (5) No gift: the whole price on the page, held, the same total as before.
{
  const o = await order({ delivery: 500 });
  await attach(o);
  const h = await held(o, 2865, 195);
  const after = await row("shop_orders", o);
  check(h.result === "held" && after.total_cents === 2865 && after.gift_cents === 0, "(5) an order with no gift is unchanged",
    JSON.stringify({ h, t: after.total_cents }));
  const o2 = await order();
  await attach(o2);
  const h2 = await held(o2, 2000, 195);
  check(h2.reason === "amount_mismatch", "(5) a short page with no gift is still refused", JSON.stringify(h2));
}

// (6) A download: shop_digital_mark_paid adds the gift back the same way.
{
  const o = await order({ digital: true });
  const g = await gift(5);
  await redeem(g, o, 195);
  await attach(o);
  const p = await paidDl(o, 1865, 195);
  const after = await row("shop_orders", o);
  check(p.result === "accepted" && after.status === "accepted" && after.total_cents === 2365,
    "(6) a gift download is accepted with the whole price as total_cents", JSON.stringify({ p, t: after.total_cents }));
  const o2 = await order({ digital: true });
  const g2 = await gift(5);
  await redeem(g2, o2, 195);
  await attach(o2);
  const p2 = await paidDl(o2, 1670, 0);
  check(p2.reason === "amount_mismatch" && (await row("gift_cards", g2)).status === "sent",
    "(6) a download page with another tax: refused, gift back", JSON.stringify(p2));
}

// (7) Grants: service_role only.
for (const fn of ["shop_mark_order_held(text,text,integer,integer,boolean)", "shop_digital_mark_paid(text,text,integer,integer,boolean,boolean)"]) {
  const [g] = await q(`SELECT has_function_privilege('anon', 'public.${fn}', 'EXECUTE') AS a,
                              has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE') AS u,
                              has_function_privilege('service_role', 'public.${fn}', 'EXECUTE') AS s`);
  check(!g.a && !g.u && g.s, `(7) ${fn.split("(")[0]}: service_role only`, JSON.stringify(g));
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
