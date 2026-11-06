#!/usr/bin/env node
/**
 * PGlite proof for 20261106180902_shops_delivery.sql (Shops delivery slice 1, "Shop delivers"; owner 11-05 answer 3):
 * the shop sets a fee and a radius; shop-checkout (service role) turns a just-asked order into a delivery measured
 * from the shop's public pin; the fee is frozen into total_cents, the hold must add up to it, the shop is paid it at
 * handover, and the drop-off address is read by the buyer and by the shop only while the order is accepted.
 *
 *   node src/test/pglite/shopsDelivery.pglite.mjs                     # ALL PASS (the migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsDelivery.pglite.mjs  # RED: no delivery
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/shopsDelivery.pglite.mjs
 *
 * Stub schema in the shape of shopsSetupFee.pglite.mjs (prod-shaped columns only for what these functions read);
 * the restated bodies' --before state is cut verbatim from their newest CREATE.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const url = (p) => new URL(`../../../supabase/migrations/${p}`, import.meta.url).pathname;
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? url("20261106180902_shops_delivery.sql"), "utf8");

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
const [BUYER, OTHER, OWNER, OWNER2, BANNED_OWNER, SHOP, SHOP2] = [1, 2, 11, 12, 13, 91, 92].map(id);

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
-- The switch: on for test accounts only (require_feature's contract, 20261012031120).
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
CREATE FUNCTION public.require_feature(p_key text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.test_accounts WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501';
  END IF;
END $$;
CREATE TABLE public.banned (user_id uuid PRIMARY KEY);
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT EXISTS (SELECT 1 FROM public.banned WHERE user_id = auth.uid()) $$;
CREATE FUNCTION public.shops_assert_owner_eligible() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF public.is_caller_banned() THEN RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501'; END IF;
  RETURN auth.uid();
END $$;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, stripe_account_id text, onboarding_fee_paid boolean NOT NULL DEFAULT true,
  onboarding_fee_charged_at timestamptz);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text, message text);
CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid)
RETURNS void LANGUAGE sql AS $$ INSERT INTO public.notifications (user_id, title, message) VALUES (p_user, p_title, p_message) $$;
-- The card-fee debt ledger: a fixed debt per seller, consumed up to the amount (shape of 20261026 declutter_consume_fee_debt).
CREATE TABLE public.fee_debt (seller_id uuid PRIMARY KEY, cents int NOT NULL);
CREATE FUNCTION public.declutter_consume_fee_debt(p_seller uuid, p_ref text, p_max int) RETURNS int LANGUAGE plpgsql AS $$
DECLARE v int;
BEGIN
  SELECT least(cents, p_max) INTO v FROM public.fee_debt WHERE seller_id = p_seller;
  UPDATE public.fee_debt SET cents = cents - COALESCE(v, 0) WHERE seller_id = p_seller;
  RETURN COALESCE(v, 0);
END $$;
CREATE TABLE public.shops (id uuid PRIMARY KEY, owner_id uuid UNIQUE, name text, daily_order_cap smallint,
  pin_lat numeric(8,5) NOT NULL, pin_lng numeric(8,5) NOT NULL, updated_at timestamptz);
CREATE TABLE public.shop_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, seller_id uuid, shop_id uuid,
  status text NOT NULL DEFAULT 'awaiting_hold', close_reason text, ready_date date NOT NULL DEFAULT '2026-12-01',
  items_cents int NOT NULL, premium_cents int NOT NULL, tax_cents int NOT NULL DEFAULT 0, total_cents int NOT NULL,
  setup_fee_cents int NOT NULL DEFAULT 0, setup_fee_state text,
  stripe_checkout_session_id text UNIQUE, stripe_payment_intent_id text UNIQUE, payment_livemode boolean,
  is_seed boolean NOT NULL DEFAULT false, held_at timestamptz, accept_by timestamptz, accepted_at timestamptz,
  captured_at timestamptz, handed_over_at timestamptz, closed_at timestamptz,
  CONSTRAINT shop_orders_total CHECK (total_cents = items_cents + premium_cents + tax_cents));
CREATE FUNCTION public.shop_day_count(uuid, date, text[]) RETURNS int LANGUAGE sql STABLE AS $$ SELECT 0 $$;
CREATE TABLE public.shop_handovers (order_id uuid PRIMARY KEY, confirmed_at timestamptz, confirmed_how text, problem_at timestamptz);
CREATE TABLE public.shop_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL UNIQUE, items_cents int NOT NULL,
  debt_cents int NOT NULL, amount_cents int NOT NULL, status text NOT NULL, next_attempt_at timestamptz,
  CONSTRAINT shop_payouts_amount CHECK (amount_cents = items_cents - debt_cents AND amount_cents >= 0));
`;

const REAL = [
  cutFn("20261017055505_declutter_helpr_delivery.sql", "helpr_task_distance_m"),
  // The --before state of what the migration restates, and the miles it measures with (newest bodies).
  cutFn("20261105181603_shops_setup_fee.sql", "shop_mark_order_held"),
  cutFn("20261105182903_shops_handover_rule.sql", "shop_complete_handover"),
  // Late cancel / no-show (money BLOCK on 33156ebb22): the shop is owed items + delivery.
  cutFn("20261019071055_shops_refunds_cancels_strikes.sql", "shop_owe_shop"),
  cutFn("20261103162420_q2390_handover_paid_refund_shop_cancel_photo_no_show_decline_not_found_is_404.sql", "shops_report_no_show"),
].join("\n");
// What shops_report_no_show reads, in the shape it needs (prod: 20261018211820 handover_mode, ready_at; the lock and
// the strike are their own proofs, shopsRefunds.pglite.mjs).
const NO_SHOW_STUBS = `
ALTER TABLE public.shop_orders ADD COLUMN handover_mode text NOT NULL DEFAULT 'in_person';
ALTER TABLE public.shop_handovers ADD COLUMN ready_at timestamptz;
CREATE FUNCTION public.shop_lock_open_charged_order(p_order uuid, p_x boolean) RETURNS public.shop_orders LANGUAGE sql AS
  $$ SELECT * FROM public.shop_orders WHERE id = p_order $$;
CREATE FUNCTION public.shop_give_strike(uuid, text, text, uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
`;
const ROUTED = readFileSync(url("20261104105545_declutter_road_miles_routed.sql"), "utf8")
  .split("-- Q807:")[0]; // the table and declutter_road_miles; the unconfirmed-email gate needs prod's helper

const db = new PGlite();
await db.exec(SCHEMA);
await db.exec(NO_SHOW_STUBS);
await db.exec(REAL);
await db.exec(ROUTED);
const skip = process.env.NEW_MIGRATION === "skip";
if (!skip) for (let i = 0; i < 3; i++) await db.exec(MIGRATION);

let pass = 0;
let fail = 0;
const ok = (cond, label) => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
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
const svc = async (sql) => {
  try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e), code: e.code }; }
};
const member = (uid, sql) => as("authenticated", uid, sql);
const refused = (r, re, code) => !Array.isArray(r) && re.test(r.error) && (code === undefined || r.code === code);
const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);

await db.exec(`
  INSERT INTO auth.users (id) VALUES ('${BUYER}'), ('${OTHER}'), ('${OWNER}'), ('${OWNER2}'), ('${BANNED_OWNER}');
  INSERT INTO public.test_accounts (user_id) VALUES ('${BUYER}'), ('${OWNER}'), ('${OWNER2}'), ('${BANNED_OWNER}');
  INSERT INTO public.banned VALUES ('${BANNED_OWNER}');
  INSERT INTO public.profiles (user_id, stripe_account_id) VALUES ('${OWNER}', 'acct_1'), ('${OWNER2}', 'acct_2');
  -- Lafayette-ish pin (2 decimals, a home maker), and a second shop.
  INSERT INTO public.shops (id, owner_id, name, pin_lat, pin_lng) VALUES ('${SHOP}', '${OWNER}', 'Bayou Bakes', 30.22, -92.02),
    ('${SHOP2}', '${OWNER2}', 'Teche Crafts', 30.00, -91.82);`);

// A just-asked order (as shops_request_order leaves it): items $20, fee 5% + 70c = $1.70.
const newOrder = async (shop = SHOP, seller = OWNER, buyer = BUYER) => one(await svc(`
  INSERT INTO public.shop_orders (buyer_id, seller_id, shop_id, items_cents, premium_cents, total_cents)
  VALUES ('${buyer}', '${seller}', '${shop}', 2000, 170, 2170) RETURNING id`));
const setDelivery = (uid, on, fee, radius) => member(uid, `SELECT public.shops_set_delivery(${on}, ${fee}, ${radius}) AS r`);
// ~2.6 straight miles from the pin; and ~45 miles away (Baton Rouge-ish).
const NEAR = { line1: "100 Main St", city: "Lafayette", zip: "70501", lat: 30.24, lng: -92.06 };
const FAR = { line1: "1 Capitol Dr", city: "Baton Rouge", zip: "70802", lat: 30.45, lng: -91.19 };
const deliver = (order, a = NEAR, buyer = BUYER, role = "service_role") => as(role, role === "service_role" ? null : buyer,
  `SELECT public.shop_set_order_delivery('${order}', '${buyer}', '${a.line1}', NULL, '${a.city}', '${a.zip}', ${a.lat}, ${a.lng}) AS r`);
const orderRow = async (o) => (await svc(`SELECT status, fulfillment, delivery_cents, delivery_miles, total_cents FROM public.shop_orders WHERE id = '${o}'`))[0] ?? {};

// --- 1. the shop's offer
ok(one(await setDelivery(OWNER, true, 800, 10))?.delivery_fee_cents === 800, "the owner offers delivery: $8 within 10 miles");
const shopRow = (await svc(`SELECT delivers, delivery_fee_cents, delivery_radius_miles FROM public.shops WHERE id = '${SHOP}'`))[0] ?? {};
ok(shopRow.delivers === true && shopRow.delivery_fee_cents === 800 && shopRow.delivery_radius_miles === 10, "the shop row holds the offer");
ok(refused(await setDelivery(OWNER, true, 450, 10), /invalid_delivery_fee/), "a fee under $5 (not free) is refused");
ok(refused(await setDelivery(OWNER, true, 850, 10), /invalid_delivery_fee/), "a fee that is not whole dollars is refused");
ok(refused(await setDelivery(OWNER, true, 15100, 10), /invalid_delivery_fee/), "a fee over $150 is refused");
ok(refused(await setDelivery(OWNER, true, 800, 51), /invalid_delivery_radius/), "a radius over 50 miles is refused");
ok(refused(await setDelivery(OWNER, true, 800, 0), /invalid_delivery_radius/), "a radius under 1 mile is refused");
ok(refused(await setDelivery(OTHER, true, 800, 10), /feature_disabled/, "42501"), "the switch gates the setter (an ordinary account)");
ok(refused(await setDelivery(BANNED_OWNER, true, 800, 10), /account_restricted/), "a banned member cannot set it");
ok(refused(await as("anon", null, `SELECT public.shops_set_delivery(true, 800, 10)`), /permission denied/), "anon cannot call the setter");
ok(refused(await svc(`UPDATE public.shops SET delivery_fee_cents = 333 WHERE id = '${SHOP}'`), /shops_delivery_offer/), "the table refuses a bad fee too");

// --- 2. turning an order into a delivery
const o1 = await newOrder();
ok(refused(await deliver(o1, NEAR, BUYER, "authenticated"), /permission denied/), "a member cannot call the service setter");
ok(refused(await deliver(o1, NEAR, OTHER), /order_not_found/, "PT404"), "the service setter checks the order is this buyer's");
ok(refused(await deliver(o1, FAR), /delivery_too_far/), "a drop-off past the radius is refused");
ok(refused(await deliver(o1, { ...NEAR, zip: "71601" }), /delivery_outside_louisiana/), "an Arkansas ZIP (716xx) is refused");
ok(refused(await deliver(o1, { ...NEAR, zip: "70201" }), /delivery_outside_louisiana/), "an unassigned 702xx ZIP is refused");
ok(refused(await deliver(o1, { ...NEAR, lat: 40.7, lng: -74.0 }), /delivery_outside_louisiana/), "a point outside Louisiana is refused");
ok((await orderRow(o1)).fulfillment === "pickup" && (await orderRow(o1)).total_cents === 2170, "a refused delivery changes nothing");
const d1 = await deliver(o1);
ok(one(d1)?.delivery_cents === 800 && one(d1)?.total_cents === 2970, `a near drop-off freezes the $8 fee into the total (${JSON.stringify(d1)})`);
let r = await orderRow(o1);
ok(r.fulfillment === "shop_delivers" && r.delivery_cents === 800 && r.delivery_miles >= 1 && r.delivery_miles <= 10, `the order carries the delivery (${JSON.stringify(r)})`);
const expectMiles = one(await svc(`SELECT public.declutter_road_miles(30.22, -92.02, 30.24, -92.06)`));
ok(r.delivery_miles === expectMiles, `the miles are measured from the shop's public pin (${r.delivery_miles} = ${expectMiles})`);
ok(refused(await deliver(o1), /delivery_frozen/), "an order already set for delivery cannot be set again");
// The shop changing its fee later never moves the order.
await setDelivery(OWNER, true, 1500, 10);
ok((await orderRow(o1)).delivery_cents === 800, "a later fee change never moves an asked order");
await setDelivery(OWNER, true, 800, 10);
// No delivery once the Stripe page exists, and none from a shop that does not deliver.
const o2 = await newOrder();
await svc(`UPDATE public.shop_orders SET stripe_checkout_session_id = 'cs_test_o2' WHERE id = '${o2}'`);
ok(refused(await deliver(o2), /delivery_frozen/), "no delivery once the Stripe page is open");
const o3 = await newOrder(SHOP2, OWNER2);
ok(refused(await deliver(o3), /shop_does_not_deliver/), "a shop that does not deliver refuses it");
ok(refused(await svc(`UPDATE public.shop_orders SET delivery_cents = 800, fulfillment = 'shop_delivers', delivery_miles = 4, total_cents = 2970
  WHERE id = '${o2}'`), /delivery_frozen/), "the trigger freezes the delivery once the page is open");
ok(refused(await svc(`UPDATE public.shop_orders SET total_cents = 2170 WHERE id = '${o1}'`), /shop_orders_total/), "the total must hold the delivery (CHECK)");

// --- 3. the hold must add up to items + fee + delivery + tax
await svc(`UPDATE public.shop_orders SET stripe_checkout_session_id = 'cs_test_o1' WHERE id = '${o1}'`);
const short = await svc(`SELECT public.shop_mark_order_held('cs_test_o1', 'pi_short1', 2170 + 150, 150, false) AS r`);
ok(one(short)?.reason === "amount_mismatch", `a page without the delivery is refused (${JSON.stringify(short)})`);
const o4 = await newOrder();
await deliver(o4);
await svc(`UPDATE public.shop_orders SET stripe_checkout_session_id = 'cs_test_o4' WHERE id = '${o4}'`);
const held = await svc(`SELECT public.shop_mark_order_held('cs_test_o4', 'pi_ok4', 2970 + 150, 150, false) AS r`);
ok(one(held)?.result === "held", `a page with the delivery holds (${JSON.stringify(held)})`);
r = await orderRow(o4);
ok(r.status === "held" && r.total_cents === 3120 && r.delivery_cents === 800, `the held order's total is items + fee + tax + delivery (${JSON.stringify(r)})`);

// --- 4. the address: buyer always, the shop only while accepted
const addr = (uid, o) => member(uid, `SELECT line1, city, postal_code FROM public.shops_order_delivery_address('${o}')`);
ok((await addr(BUYER, o4))[0]?.line1 === "100 Main St", "the buyer reads their own drop-off");
ok(Array.isArray(await addr(OWNER, o4)) && (await addr(OWNER, o4)).length === 0, "the shop cannot read it while the order is only held");
ok((await addr(OTHER, o4)).length === 0, "another member reads nothing");
ok(refused(await as("anon", null, `SELECT * FROM public.shops_order_delivery_address('${o4}')`), /permission denied/), "anon cannot call the read");
ok(refused(await member(BUYER, `SELECT * FROM public.shop_order_delivery_addresses`), /permission denied/), "no member reads the table");
await svc(`UPDATE public.shop_orders SET status = 'accepted', accepted_at = now(), captured_at = now() WHERE id = '${o4}'`);
ok((await addr(OWNER, o4))[0]?.line1 === "100 Main St", "the shop reads it once it accepted");

// --- 5. the shop is paid its items and its delivery fee
await svc(`INSERT INTO public.fee_debt VALUES ('${OWNER}', 300)`);
const done = await svc(`SELECT public.shop_complete_handover('${o4}', 'buyer') AS r`);
ok(one(done)?.result === "handed_over", `the handover completes (${JSON.stringify(done)})`);
const pay = (await svc(`SELECT items_cents, debt_cents, amount_cents FROM public.shop_payouts WHERE order_id = '${o4}'`))[0] ?? {};
ok(pay.items_cents === 2800 && pay.debt_cents === 300 && pay.amount_cents === 2500, `the payout is items + delivery - debt (${JSON.stringify(pay)})`);
const note = one(await svc(`SELECT message FROM public.notifications WHERE user_id = '${OWNER}' AND title = 'Order picked up'`));
ok(typeof note === "string" && note.includes("$25.00"), `the shop's notice names the delivery-inclusive amount (${note})`);
ok((await addr(OWNER, o4)).length === 0, "after the handover the shop no longer reads the address");
// A pickup order is paid exactly as before.
const o5 = await newOrder();
await svc(`UPDATE public.shop_orders SET status = 'accepted', captured_at = now() WHERE id = '${o5}'`);
await svc(`SELECT public.shop_complete_handover('${o5}', 'buyer')`);
ok((await svc(`SELECT items_cents FROM public.shop_payouts WHERE order_id = '${o5}'`))[0]?.items_cents === 2000, "a pickup order's payout is its items only");

// --- 5b. a late cancel or a no-show pays the shop items + delivery (money BLOCK on 33156ebb22, lead 11-06)
const late = await newOrder();
await deliver(late);
await svc(`UPDATE public.shop_orders SET status = 'cancelled', close_reason = 'buyer_cancelled_late', captured_at = now() WHERE id = '${late}'`);
const owed = one(await svc(`SELECT public.shop_owe_shop('${late}') AS r`));
const latePay = (await svc(`SELECT items_cents, debt_cents, amount_cents FROM public.shop_payouts WHERE order_id = '${late}'`))[0] ?? {};
ok(owed === 2800 && latePay.items_cents === 2800 && latePay.amount_cents === 2800,
  `a late-cancelled delivery order pays the shop items + delivery ($28) (${owed} ${JSON.stringify(latePay)})`);
const ns = await newOrder();
await deliver(ns);
await svc(`UPDATE public.shop_orders SET status = 'accepted', accepted_at = now(), captured_at = now(), ready_date = current_date - 2 WHERE id = '${ns}'`);
await svc(`INSERT INTO public.shop_handovers (order_id, ready_at) VALUES ('${ns}', now() - interval '2 days')`);
const nsr = await member(OWNER, `SELECT public.shops_report_no_show('${ns}') AS r`);
ok(one(nsr)?.result === "no_show", `the shop reports a delivery no-show (${JSON.stringify(nsr)})`);
const nsPay = (await svc(`SELECT items_cents, amount_cents FROM public.shop_payouts WHERE order_id = '${ns}'`))[0] ?? {};
ok(nsPay.items_cents === 2800 && nsPay.amount_cents === 2800, `a delivery no-show pays the shop items + delivery (${JSON.stringify(nsPay)})`);
const nsNote = (await svc(`SELECT title, message FROM public.notifications WHERE user_id = '${BUYER}' AND title LIKE 'Missed%' ORDER BY title`))[0] ?? {};
ok(nsNote.title === "Missed delivery" && /didn't receive the delivery/.test(nsNote.message ?? ""),
  `a delivery no-show tells the buyer they didn't receive the delivery (${JSON.stringify(nsNote)})`);

// --- 6. grants, seed and purge
const gr = (await svc(`SELECT has_function_privilege('authenticated', 'public.shop_set_order_delivery(uuid, uuid, text, text, text, text, numeric, numeric)', 'EXECUTE') AS a,
  has_function_privilege('anon', 'public.shops_order_delivery_address(uuid)', 'EXECUTE') AS b,
  has_table_privilege('authenticated', 'public.shop_order_delivery_addresses', 'SELECT') AS c,
  has_column_privilege('authenticated', 'public.shop_orders', 'delivery_cents', 'SELECT') AS d`))[0] ?? {};
ok(gr.a === false && gr.b === false && gr.c === false && gr.d === true, `grants (${JSON.stringify(gr)})`);
const o6 = await newOrder();
await svc(`UPDATE public.shop_orders SET is_seed = true WHERE id = '${o6}'`);
await deliver(o6);
ok((await svc(`SELECT is_seed FROM public.shop_order_delivery_addresses WHERE order_id = '${o6}'`))[0]?.is_seed === true, "a test order's address is seed data");
ok(one(await svc(`SELECT count(*)::int FROM public.shop_order_delivery_addresses WHERE buyer_id = '${BUYER}'`)) === 5, "five of the buyer's orders carry an address");
// Account deletion (the buyer's auth row goes; the order outlives its buyer): the addresses go with the account.
await svc(`DELETE FROM auth.users WHERE id = '${BUYER}'`);
ok(one(await svc(`SELECT count(*)::int FROM public.shop_order_delivery_addresses`)) === 0, "deleting the buyer leaves none of their addresses");

console.log(`\n${pass} PASS, ${fail} FAIL${skip ? " (NEW_MIGRATION=skip)" : ""}`);
process.exit(fail === 0 ? 0 : 1);
