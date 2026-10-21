#!/usr/bin/env node
/**
 * PGlite proof for 20261021204947_declutter_sales_outlive_a_deleted_party (Q2307; owner 2026-10-22, Declutter terms
 * #12: finished sales stay for the other side as "Former member").
 *
 *   npx tsx src/test/pglite/declutterSalesOutliveDeletedParty.pglite.mjs [--replay] [--before]
 *
 * The foreign keys and CHECKs are PROD's (pg_constraint, read 2026-10-21): orders and cart lines CASCADE from both
 * parties, payouts and delivery refunds RESTRICT from orders, handovers and problems CASCADE from orders. --before
 * leaves the migration out and the RED checks must FAIL; without it the migration is applied (3x with --replay).
 *
 *   R1 deleting the BUYER of a settled sale with a seller payout and a delivery refund does not error      RED before
 *   R2 ... and the order, its cart line, the payout and the refund all stay, the buyer column NULL         RED before
 *   R3 deleting the SELLER of another settled sale (its item and photos go) keeps the order and the
 *      buyer's cart line with its price (item and seller NULL), and the payout row                        RED before
 *   R4 declutter_scrub_member clears the leaving member's porch note and their problem report's words and
 *      photos, keeping the decision and fault                                                               RED before
 *   R5 the buyer's own list (declutter_my_cart, newest body before this migration for RED) still shows the sale
 *      after the seller deleted their account, as an item from a former member with its price            RED before
 *   R6 the scrub also clears the buyer's drop-off address on the delivery row, their address on a finished Helpr
 *      task, and the review words and tags they wrote, keeping the stars                                 RED before
 *   R7 an order a party has left can never be marked paid again (trigger)                                RED before
 *   K3 (after) declutter_refund_party_gone answers 'already_paid' for the payment that paid a settled order
 *      (a replayed event), refunds any other payment, and refuses an order whose parties are both here
 *   K1 a sale between two members who stay is untouched
 *   K2 a member cannot call declutter_scrub_member
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { effectiveDefs } from "../helpers/effectiveFunctionDefs.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const REPLAY = process.argv.includes("--replay");
const BEFORE = process.argv.includes("--before");

const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261021204947_declutter_sales_outlive_a_deleted_party.sql";
const MIGRATION = readFileSync(DIR + THIS, "utf8");
/** declutter_my_cart as prod runs it before this migration (its newest definition before THIS). */
const MY_CART_BEFORE = effectiveDefs(DIR, { before: THIS }).get("declutter_my_cart").stmt;

let failures = 0;
let redFailures = 0;
const check = (name, ok, detail = "", red = false) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  (${detail})` : ""}`);
  if (!ok) {
    failures++;
    if (red) redFailures++;
  }
};

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const BUYER = U(1), SELLER = U(2), BUYER2 = U(3), SELLER2 = U(4), STAY_B = U(5), STAY_S = U(6);

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
-- PROD shape (pg_constraint / information_schema 2026-10-21), the columns this change touches.
CREATE TABLE public.declutter_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, status text NOT NULL DEFAULT 'sold',
  title text NOT NULL DEFAULT 'Oak dresser', porch_ok boolean NOT NULL DEFAULT true);
CREATE TABLE public.declutter_item_photos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.declutter_items(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE);
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id uuid NOT NULL CONSTRAINT declutter_orders_buyer_id_fkey REFERENCES auth.users(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL CONSTRAINT declutter_orders_seller_id_fkey REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL, items_cents integer NOT NULL DEFAULT 4000, total_cents integer NOT NULL DEFAULT 4270,
  stripe_payment_intent_id text,
  handover text NOT NULL DEFAULT 'pickup_home', premium_cents integer NOT NULL DEFAULT 270, delivery_cents integer NOT NULL DEFAULT 0,
  CONSTRAINT declutter_orders_not_own CHECK (buyer_id <> seller_id));
CREATE UNIQUE INDEX declutter_orders_one_awaiting ON public.declutter_orders (buyer_id, seller_id) WHERE status = 'awaiting_payment';
CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL CONSTRAINT declutter_cart_items_item_id_fkey REFERENCES public.declutter_items(id) ON DELETE CASCADE,
  buyer_id uuid NOT NULL CONSTRAINT declutter_cart_items_buyer_id_fkey REFERENCES auth.users(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL CONSTRAINT declutter_cart_items_seller_id_fkey REFERENCES auth.users(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.declutter_orders(id) ON DELETE SET NULL,
  price_cents integer NOT NULL, status text NOT NULL, checkout_by timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT declutter_cart_not_own CHECK (buyer_id <> seller_id));
CREATE UNIQUE INDEX declutter_cart_one_active ON public.declutter_cart_items (item_id) WHERE status IN ('in_cart', 'paid');
CREATE TABLE public.declutter_payouts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.declutter_orders(id) ON DELETE RESTRICT,
  seller_id uuid REFERENCES auth.users(id) ON DELETE SET NULL, amount_cents integer NOT NULL, status text NOT NULL);
CREATE TABLE public.declutter_delivery_refunds (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.declutter_orders(id) ON DELETE RESTRICT, refund_cents integer NOT NULL);
CREATE TABLE public.declutter_handovers (order_id uuid PRIMARY KEY REFERENCES public.declutter_orders(id) ON DELETE CASCADE,
  set_out_note text, set_out_photo_path text, set_out_at timestamptz,
  CONSTRAINT declutter_handovers_set_out CHECK ((set_out_at IS NULL) = (set_out_photo_path IS NULL)),
  CONSTRAINT declutter_handovers_set_out_note_len CHECK (set_out_note IS NULL OR char_length(set_out_note) BETWEEN 1 AND 200));
CREATE TABLE public.declutter_problems (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.declutter_orders(id) ON DELETE CASCADE,
  reporter_id uuid REFERENCES auth.users(id) ON DELETE SET NULL, note text NOT NULL,
  photo_paths text[] NOT NULL DEFAULT '{}', decision text, fault text,
  CONSTRAINT declutter_problems_note_check CHECK (char_length(btrim(note)) BETWEEN 1 AND 1000),
  CONSTRAINT declutter_problems_photo_paths_check CHECK (cardinality(photo_paths) <= 6));
CREATE TABLE public.declutter_order_deliveries (order_id uuid PRIMARY KEY REFERENCES public.declutter_orders(id) ON DELETE CASCADE, task_id uuid,
  dropoff_address text NOT NULL DEFAULT '500 Drop Rd', dropoff_area text NOT NULL DEFAULT 'North BR',
  dropoff_lat numeric NOT NULL DEFAULT 30.5, dropoff_lng numeric NOT NULL DEFAULT -91.1);
CREATE TABLE public.declutter_reviews (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.declutter_orders(id) ON DELETE CASCADE,
  reviewer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL, reviewee_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  stars smallint NOT NULL DEFAULT 5, comment text, tags text[] NOT NULL DEFAULT '{}');
CREATE TABLE public.helpr_tasks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text NOT NULL,
  customer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL, pickup_contact_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  pickup_address text NOT NULL, pickup_area text NOT NULL, pickup_lat numeric NOT NULL, pickup_lng numeric NOT NULL,
  dropoff_address text NOT NULL, dropoff_area text NOT NULL, dropoff_lat numeric NOT NULL, dropoff_lng numeric NOT NULL);
-- The refund recorder and its answer are their own proofs' (declutterSlice3b); here they only say what was asked.
CREATE TABLE public.declutter_refunds (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, stripe_payment_intent_id text UNIQUE, reason text);
CREATE FUNCTION public.declutter_record_refund(p_order uuid, p_pi text, p_reason text, p_paid integer, p_fee integer) RETURNS uuid
  LANGUAGE sql AS $$ INSERT INTO public.declutter_refunds (order_id, stripe_payment_intent_id, reason) VALUES (p_order, p_pi, p_reason) RETURNING id $$;
CREATE FUNCTION public.declutter_refund_answer(p_id uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('result', 'refund', 'refund_id', id, 'reason', reason) FROM public.declutter_refunds WHERE id = p_id $$;
GRANT USAGE ON SCHEMA public, auth TO authenticated, service_role;
${MY_CART_BEFORE};
GRANT EXECUTE ON FUNCTION public.declutter_my_cart() TO authenticated;

INSERT INTO auth.users VALUES ('${BUYER}'), ('${SELLER}'), ('${BUYER2}'), ('${SELLER2}'), ('${STAY_B}'), ('${STAY_S}');
`;

const db = new PGlite();
await db.exec(SCHEMA);
if (!BEFORE) for (let i = 0; i < (REPLAY ? 3 : 1); i++) await db.exec(MIGRATION);

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
async function sale(buyer, seller, withMoney) {
  const item = (await one(`INSERT INTO public.declutter_items (seller_id) VALUES ($1) RETURNING id`, [seller])).id;
  await db.query(`INSERT INTO public.declutter_item_photos (item_id, seller_id) VALUES ($1, $2)`, [item, seller]);
  const order = (await one(`INSERT INTO public.declutter_orders (buyer_id, seller_id, status) VALUES ($1, $2, 'handed_over') RETURNING id`, [buyer, seller])).id;
  const line = (await one(`INSERT INTO public.declutter_cart_items (item_id, buyer_id, seller_id, order_id, price_cents, status) VALUES ($1, $2, $3, $4, 4000, 'paid') RETURNING id`, [item, buyer, seller, order])).id;
  if (withMoney) {
    await db.query(`INSERT INTO public.declutter_payouts (order_id, seller_id, amount_cents, status) VALUES ($1, $2, 4000, 'succeeded')`, [order, seller]);
    await db.query(`INSERT INTO public.declutter_delivery_refunds (order_id, refund_cents) VALUES ($1, 1200)`, [order]);
  }
  await db.query(`INSERT INTO public.declutter_handovers (order_id, set_out_note, set_out_photo_path, set_out_at) VALUES ($1, 'Blue bin by the gate', 'p/porch.jpg', now())`, [order]);
  await db.query(`INSERT INTO public.declutter_problems (order_id, reporter_id, note, photo_paths, decision, fault) VALUES ($1, $2, 'It arrived cracked', '{a.jpg,b.jpg}', 'refund_buyer', 'seller')`, [order, buyer]);
  await db.query(`INSERT INTO public.declutter_order_deliveries (order_id) VALUES ($1)`, [order]);
  await db.query(`INSERT INTO public.declutter_reviews (order_id, reviewer_id, reviewee_id, comment, tags) VALUES ($1, $2, $3, 'Lovely seller', '{on_time}')`, [order, buyer, seller]);
  await db.query(`INSERT INTO public.helpr_tasks (status, customer_id, pickup_contact_id, pickup_address, pickup_area, pickup_lat, pickup_lng, dropoff_address, dropoff_area, dropoff_lat, dropoff_lng)
    VALUES ('confirmed', $1, $2, '1 Seller St', 'Mid City', 30.4, -91.2, '500 Drop Rd', 'North BR', 30.5, -91.1)`, [buyer, seller]);
  return { item, order, line };
}
async function del(uid) {
  try {
    await db.query(`DELETE FROM auth.users WHERE id = $1`, [uid]);
    return null;
  } catch (e) {
    return String(e.message);
  }
}
const count = async (sql, params) => Number((await one(sql, params)).n);

console.log(`${BEFORE ? "BEFORE (migration left out)" : `AFTER (applied ${REPLAY ? 3 : 1}x)`}`);
const a = await sale(BUYER, SELLER, true);
const b = await sale(BUYER2, SELLER2, false);
const k = await sale(STAY_B, STAY_S, true);

// R4 first, as the purge runs it: before the auth user goes.
let scrub = null;
try {
  scrub = (await one(`SELECT public.declutter_scrub_member($1) AS r`, [BUYER])).r;
} catch (e) {
  scrub = { error: String(e.message) };
}
const h = await one(`SELECT set_out_note, set_out_photo_path FROM public.declutter_handovers WHERE order_id = $1`, [a.order]);
const p = await one(`SELECT note, photo_paths, decision, fault FROM public.declutter_problems WHERE order_id = $1`, [a.order]);
check("R4 the scrub clears the leaving member's porch note and problem words/photos, keeping decision and fault",
  !scrub?.error && h.set_out_note === null && p.note === "Removed: this member deleted their account." && p.photo_paths.length === 0
  && p.decision === "refund_buyer" && p.fault === "seller", JSON.stringify(scrub), true);

const dv = await one(`SELECT dropoff_address, dropoff_lat FROM public.declutter_order_deliveries WHERE order_id = $1`, [a.order]);
const rv = await one(`SELECT comment, tags, stars FROM public.declutter_reviews WHERE order_id = $1`, [a.order]);
const tk = await one(`SELECT dropoff_address, pickup_address FROM public.helpr_tasks WHERE customer_id = $1`, [BUYER]);
check("R6 the scrub clears the buyer's drop-off address (delivery row and finished task) and their review words, keeping the stars",
  dv?.dropoff_address === "Removed: account deleted" && Number(dv?.dropoff_lat) === 0 && rv?.comment === null && rv?.tags.length === 0
  && rv?.stars === 5 && tk?.dropoff_address === "Removed: account deleted" && tk?.pickup_address === "1 Seller St",
  JSON.stringify({ dv, rv, tk }), true);

const e1 = await del(BUYER);
check("R1 deleting the buyer of a settled sale with a payout and a delivery refund does not error", e1 === null, e1 ?? "", true);
const o1 = await one(`SELECT buyer_id, seller_id FROM public.declutter_orders WHERE id = $1`, [a.order]);
check("R2 the order, its line, the payout and the refund stay; the buyer column is NULL",
  o1?.buyer_id === null && o1?.seller_id === SELLER
  && (await count(`SELECT count(*) AS n FROM public.declutter_cart_items WHERE id = $1 AND buyer_id IS NULL AND price_cents = 4000`, [a.line])) === 1
  && (await count(`SELECT count(*) AS n FROM public.declutter_payouts WHERE order_id = $1`, [a.order])) === 1
  && (await count(`SELECT count(*) AS n FROM public.declutter_delivery_refunds WHERE order_id = $1`, [a.order])) === 1,
  JSON.stringify(o1), true);

let paidErr = null;
try {
  await db.query(`UPDATE public.declutter_orders SET status = 'paid' WHERE id = $1`, [a.order]);
} catch (e) {
  paidErr = String(e.message);
}
check("R7 an order a party has left can never be marked paid again", /order_party_gone/.test(paidErr ?? ""), paidErr ?? "allowed", true);

const e2 = await del(SELLER2);
const o2 = await one(`SELECT buyer_id, seller_id FROM public.declutter_orders WHERE id = $1`, [b.order]);
const l2 = await one(`SELECT item_id, seller_id, buyer_id, price_cents FROM public.declutter_cart_items WHERE id = $1`, [b.line]);
check("R3 deleting the seller keeps the order and the buyer's line with its price (item and seller NULL); listing and photos go",
  e2 === null && o2?.seller_id === null && o2?.buyer_id === BUYER2 && l2?.item_id === null && l2?.seller_id === null
  && l2?.price_cents === 4000 && (await count(`SELECT count(*) AS n FROM public.declutter_items WHERE id = $1`, [b.item])) === 0
  && (await count(`SELECT count(*) AS n FROM public.declutter_item_photos WHERE item_id = $1`, [b.item])) === 0,
  `${e2} ${JSON.stringify(o2)} ${JSON.stringify(l2)}`, true);

await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${BUYER2}', false);`);
const myCart = (await db.query("SELECT * FROM public.declutter_my_cart()")).rows;
await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);");
const kept = myCart.find((r) => r.line_id === b.line);
check("R5 the buyer's own list still shows the sale as an item from a former member, with its price",
  kept?.item_title === "An item from a former member" && kept?.price_cents === 4000 && kept?.seller_id === null && kept?.my_side === "buyer",
  JSON.stringify(myCart), true);

const ko = await one(`SELECT buyer_id, seller_id FROM public.declutter_orders WHERE id = $1`, [k.order]);
const kh = await one(`SELECT set_out_note FROM public.declutter_handovers WHERE order_id = $1`, [k.order]);
check("K1 a sale between two members who stay is untouched", ko?.buyer_id === STAY_B && ko?.seller_id === STAY_S && kh?.set_out_note === "Blue bin by the gate");

if (!BEFORE) {
  await db.query(`UPDATE public.declutter_orders SET stripe_payment_intent_id = 'pi_paid_a' WHERE id = $1`, [a.order]);
  const replay = (await one(`SELECT public.declutter_refund_party_gone($1, 'pi_paid_a', 4270, 150) AS r`, [a.order])).r;
  const late = (await one(`SELECT public.declutter_refund_party_gone($1, 'pi_late_a', 4270, 150) AS r`, [a.order])).r;
  const lateAgain = (await one(`SELECT public.declutter_refund_party_gone($1, 'pi_late_a', 4270, 150) AS r`, [a.order])).r;
  let present = null;
  try {
    await db.query(`SELECT public.declutter_refund_party_gone($1, 'pi_x', 4270, 150)`, [k.order]);
  } catch (e) {
    present = String(e.message);
  }
  check("K3 party-gone refund: the order's own payment is 'already_paid'; another is refunded once (order_closed); both parties here is refused",
    replay?.result === "already_paid" && late?.result === "refund" && late?.reason === "order_closed" && lateAgain?.refund_id === late?.refund_id
    && /party_present/.test(present ?? ""), JSON.stringify({ replay, late, lateAgain, present }));

  let memberErr = null;
  await db.exec(`SET ROLE authenticated;`);
  try {
    await db.query(`SELECT public.declutter_scrub_member($1)`, [STAY_B]);
  } catch (e) {
    memberErr = String(e.message);
  } finally {
    await db.exec(`RESET ROLE;`);
  }
  check("K2 a member cannot call declutter_scrub_member", /permission denied/.test(memberErr ?? ""), memberErr ?? "allowed");
}

const expectedRed = 7;
console.log(`\n${failures} failure(s)${BEFORE ? `, ${redFailures} of them RED checks (expected: ${expectedRed})` : ""}`);
if (BEFORE) process.exit(redFailures === expectedRed && failures === expectedRed ? 0 : 1);
process.exit(failures === 0 ? 0 : 1);
