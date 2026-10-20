#!/usr/bin/env node
/**
 * PGlite proof for 20261020024605_shipping_s1_data_model (docs/specs/shipping-draft.md S1;
 * owner decisions 2026-10-20; Q2239), on top of Declutter slices 1-5 (F1, slice 4, the
 * refund/bucket/porch migrations, Helpr delivery and the no-code handover). The new
 * migration is applied 3 times (replay-safe).
 *
 *   node src/test/pglite/shippingS1.pglite.mjs                     # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/shippingS1.pglite.mjs  # RED: the migration absent
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/shippingS1.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { setupStatements, liveItemSql, CARDS_SQL, USERS, FEE_F1_FILE, SLICE4_FILE, NO_QR_FILE } from "../../../scripts/declutter/slice3Harness.mjs";

const NEW_FILE = "20261020024605_shipping_s1_data_model.sql";
const BEFORE = [
  "20261017055500_declutter_refund_hand_settle.sql",
  "20261017055502_declutter_handover_private_bucket.sql",
  "20261017055504_declutter_porch_default.sql",
  "20261017055505_declutter_helpr_delivery.sql",
  NO_QR_FILE,
];
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const { SELLER, BUYER, SELLER2, BUYER2 } = USERS;
const skip = process.env.NEW_MIGRATION === "skip";

const db = new PGlite();
await db.exec(`CREATE SCHEMA IF NOT EXISTS storage;
  CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false,
    file_size_limit bigint, allowed_mime_types text[]);
  INSERT INTO storage.buckets (id, name, public) VALUES ('job-photos', 'job-photos', true);`);
const extra = [{ file: FEE_F1_FILE, times: 1 }, { file: SLICE4_FILE, times: 1 }, ...BEFORE.map((file) => ({ file, times: 1 }))];
if (!skip) extra.push(process.env.MIGRATION_PATH ? { path: process.env.MIGRATION_PATH, times: 3 } : { file: NEW_FILE, times: 3 });
for (const sql of setupStatements({ times: 1, times3b: 1, extra })) await db.exec(sql);
await db.exec(CARDS_SQL);

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const svc = async (sql) => { try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e), code: e.code }; } };
async function me(uid, sql) {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${uid}'; SET ROLE authenticated;`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  }
}
const refused = (r, re) => !Array.isArray(r) && re.test(r.error);
const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);
const I = (n) => `55555555-0000-0000-0000-${String(n).padStart(12, "0")}`;
const item = (n, seller, price) => db.exec(liveItemSql({ id: I(n), seller, title: `Ship item ${n}`, price, floor: Math.min(price, 100) }));
const buy = (uid, n, cents) => me(uid, `SELECT public.declutter_buy_now('${I(n)}', ${cents})`);
const checkout = async (uid, seller) => (await me(uid, `SELECT * FROM public.declutter_start_checkout('${seller}', 'porch')`))[0];

// 1. The switch exists and is OFF.
ok(one(await svc(`SELECT audience FROM public.feature_switches WHERE key = 'shipping'`)) === "off", "the 'shipping' switch exists and is off");

// 2. The shipped-order fee: 5% of (items + shipping) + 70c (decision 2), same numbers as src/lib/shipping/policy.ts.
ok(Number(one(await svc(`SELECT public.declutter_buyer_fee_cents_ship(500, 733)`))) === 132, "fee on a $5 item + $7.33 shipping = $1.32");
ok(Number(one(await svc(`SELECT public.declutter_buyer_fee_cents_ship(1000, 1637)`))) === 202, "fee on a $10 item + $16.37 shipping = $2.02");
ok(Number(one(await svc(`SELECT public.declutter_buyer_fee_cents_ship(10, 0)`))) === 71, "rounds half away from zero (0.5c -> 1c)");
ok(refused(await db.query(`SET ROLE anon`).then(() => db.query(`SELECT public.declutter_buyer_fee_cents_ship(1, 1)`)).then((r) => r.rows, (e) => ({ error: String(e.message) })).finally(() => db.exec("RESET ROLE")), /permission denied/),
  "anon cannot call the fee function");

// 3. Today's checkout is unchanged: F1 on items only, no shipping.
await item(1, SELLER, 1000);
await buy(BUYER, 1, 1000);
const o = await checkout(BUYER, SELLER);
ok(o?.premium_cents === 120 && o.total_cents === 1120, "a porch checkout still freezes F1 ($10 -> $1.20 fee, $11.20 total)");
const row = (await svc(`SELECT fee_rule, shipping_cents FROM public.declutter_orders WHERE id = '${o?.order_id}'`))[0];
ok(row?.fee_rule === "f1" && row.shipping_cents === 0, "and is fee rule f1 with shipping 0");
ok(Array.isArray(await me(BUYER, `SELECT shipping_cents FROM public.declutter_orders WHERE id = '${o?.order_id}'`)),
  "the buyer can read shipping_cents on their order (column grant)");

// 4. No order can carry shipping yet: the insert trigger still forces f1, and f1 requires shipping = 0.
ok(refused(await svc(`INSERT INTO public.declutter_orders (buyer_id, seller_id, handover, items_cents, premium_cents, total_cents, shipping_cents)
                      VALUES ('${BUYER2}', '${SELLER2}', 'porch', 500, 132, 1365, 733)`), /declutter_orders_premium_rule/),
  "an order with shipping is refused until S2 (f1 is pinned to shipping = 0)");

// 5. The freeze. The planted change is valid for every CHECK (f1_ship, the right fee and
//    total), so only the freeze trigger can refuse it. NOTE (measured 2026-10-20 with a
//    planted copy): the trigger's shipping_cents line is defence in depth and cannot fail on
//    its own: any shipping change must also move total_cents (the total CHECK), which the
//    freeze already names (same as tax_cents in the F1 proof).
ok(refused(await svc(`UPDATE public.declutter_orders SET fee_rule = 'f1_ship', shipping_cents = 733,
                        premium_cents = round((items_cents + 733) * 0.05)::integer + 70,
                        total_cents = items_cents + round((items_cents + 733) * 0.05)::integer + 70 + tax_cents + delivery_cents + 733
                      WHERE id = '${o?.order_id}'`), /order_amounts_frozen/),
  "shipping cannot be added to an order after checkout froze it");

// 6. The CHECKs themselves (freeze trigger off for the probe, back on after).
await svc(`ALTER TABLE public.declutter_orders DISABLE TRIGGER trg_declutter_orders_amounts_frozen`);
const setShip = (fee, total, ship = 733, rule = "f1_ship") => svc(`UPDATE public.declutter_orders SET fee_rule = '${rule}', shipping_cents = ${ship},
  premium_cents = ${fee}, total_cents = ${total} WHERE id = '${o?.order_id}' RETURNING id`);
ok(refused(await setShip(120, 1120 + 733), /declutter_orders_premium_rule/), "f1_ship refuses the items-only fee on a shipped order");
ok(refused(await setShip(157, 1000 + 157), /declutter_orders_total/), "the total must include the shipping");
ok(refused(await setShip(70 + 50, 1000 + 120 + 0, 0), /declutter_orders_premium_rule/), "f1_ship needs shipping > 0");
ok(refused(await setShip(120, 1120 + 733, 733, "f1"), /declutter_orders_premium_rule/), "f1 refuses an order with shipping");
ok(Array.isArray(await setShip(157, 1000 + 157 + 733)) , "f1_ship accepts $10 + $7.33 shipping with fee $1.57, total $18.90");
ok(refused(await svc(`UPDATE public.declutter_orders SET shipping_cents = -1 WHERE id = '${o?.order_id}'`), /declutter_orders_(shipping|premium_rule|total)/),
  "shipping is never negative");
await svc(`UPDATE public.declutter_orders SET fee_rule = 'f1', shipping_cents = 0, premium_cents = 120, total_cents = 1120 WHERE id = '${o?.order_id}'`);
await svc(`ALTER TABLE public.declutter_orders ENABLE TRIGGER trg_declutter_orders_amounts_frozen`);

// 7. Shipments: service role only, one label per order, Louisiana only.
const ship = (over = {}) => {
  const v = { key: `'declutter:${o?.order_id}'`, order: `'${o?.order_id}'`, mode: "'test'", zip: "70112", state: "'claimed'", weight: 16, extra: "", ...over };
  const shipTo = over.shipTo ?? `'{"zip":"${v.zip}","line1":"1 Main St"}'`;
  const parcel = over.parcel ?? `'{"weight_oz":${v.weight}}'`;
  return svc(`INSERT INTO public.shipments (declutter_order_id, idempotency_key, label_mode, service, quoted_cents, ship_to, parcel, label_state${v.extra ? ", provider_shipment_id, label_cost_cents, tracking_code" : ""})
    VALUES (${v.order}, ${v.key}, ${v.mode}, 'usps_ground_advantage', 733, ${shipTo}, ${parcel}, ${v.state}${v.extra}) RETURNING id`);
};
ok(refused(await ship({ zip: "75201" }), /shipments_ship_to_check|ship_to/), "a Texas address is refused (Louisiana only)");
ok(refused(await ship({ zip: "70912" }), /ship_to/), "709xx is not Louisiana and is refused");
ok(refused(await ship({ weight: 321 }), /parcel/), "a parcel over 20 lb is refused");
// A CHECK that evaluates to NULL passes: missing keys must still be refused (lh-authz-rls review of S1, finding 2).
ok(refused(await ship({ shipTo: "'{}'" }), /ship_to/), "an address with no ZIP is refused");
ok(refused(await ship({ shipTo: `'["a"]'` }), /ship_to/), "an address that is not an object is refused");
ok(refused(await ship({ parcel: "'{}'" }), /parcel/), "a parcel with no weight is refused");
ok(refused(await ship({ parcel: `'{"weight_oz":5,"width_in":200}'` }), /parcel/), "a box with any side over 22 in is refused");
ok(refused(await ship({ order: "NULL" }), /shipment_needs_one_order/), "a shipment with no order is refused at birth");
ok(refused(await ship({ mode: "'sandbox'" }), /label_mode/), "mode is test or live only");
ok(refused(await ship({ key: `'declutter:${I(9)}'` }), /shipments_key_matches_order/), "the key must name its own order");
ok(refused(await ship({ state: "'bought'" }), /shipments_bought_has_label/), "a bought label must record its shipment, cost and tracking");
const first = await ship();
ok(Array.isArray(first) && first.length === 1, "a claim row for the order is accepted");
ok(refused(await ship(), /duplicate key|unique/i), "a second claim for the same order is refused (one label per order, ever)");
const born = (await svc(`SELECT buyer_id, is_seed FROM public.shipments WHERE id = '${first?.[0]?.id}'`))[0];
ok(born?.buyer_id === BUYER && born.is_seed === false, "the buyer and seed flag are copied from the order at birth");
ok(refused(await svc(`UPDATE public.shipments SET quoted_cents = 999 WHERE id = '${first?.[0]?.id}'`), /shipment_frozen/), "what the buyer paid for is frozen");
ok(refused(await svc(`UPDATE public.shipments SET ship_to = '{"zip":"70801"}' WHERE id = '${first?.[0]?.id}'`), /shipment_frozen/), "the address cannot be changed");
ok(refused(await me(BUYER, `SELECT id FROM public.shipments`), /permission denied/), "the buyer cannot read shipments (private address)");
ok(refused(await me(SELLER, `SELECT id FROM public.shipments`), /permission denied/), "the seller cannot read shipments directly");
ok(refused(await me(BUYER, `INSERT INTO public.shipments (idempotency_key, label_mode, service, quoted_cents, ship_to, parcel)
  VALUES ('declutter:${I(8)}', 'live', 'usps_priority', 1, '{"zip":"70112"}', '{"weight_oz":1}')`), /permission denied/), "no client can write a shipment");
ok(refused(await db.query(`SET ROLE anon`).then(() => db.query(`SELECT id FROM public.shipments`)).then((r) => r.rows, (e) => ({ error: String(e.message) })).finally(() => db.exec("RESET ROLE")), /permission denied/),
  "anon cannot read shipments");
ok(Array.isArray(await svc(`UPDATE public.shipments SET label_state = 'bought', provider_shipment_id = 'shp_1', label_cost_cents = 733, tracking_code = '9400' WHERE id = '${first?.[0]?.id}' RETURNING id`)),
  "the worker can record a bought label");
ok(refused(await svc(`UPDATE public.shipments SET tracking_status = 'delivered' WHERE id = '${first?.[0]?.id}'`), /shipments_delivered_has_time/),
  "delivered needs its delivery time");
ok(refused(await svc(`UPDATE public.shipments SET label_state = 'claimed' WHERE id = '${first?.[0]?.id}'`), /shipment_state_backwards/),
  "a bought label never goes back to claimed (so it can never be bought twice; finding 4)");
ok(refused(await svc(`UPDATE public.shipments SET label_cost_cents = 1 WHERE id = '${first?.[0]?.id}'`), /shipment_frozen/), "a recorded label cost cannot be rewritten");

// 8. A money record outlives the order: deleting the order keeps the shipment (order id cleared, key kept).
await svc(`ALTER TABLE public.declutter_orders DISABLE TRIGGER USER`);
const del = await svc(`DELETE FROM public.declutter_orders WHERE id = '${o?.order_id}' RETURNING id`);
await svc(`ALTER TABLE public.declutter_orders ENABLE TRIGGER USER`);
const kept = (await svc(`SELECT declutter_order_id, idempotency_key FROM public.shipments WHERE id = '${first?.[0]?.id}'`))[0];
ok(Array.isArray(del) && kept?.declutter_order_id === null && kept.idempotency_key === `declutter:${o?.order_id}`,
  "deleting the order keeps the shipment row (SET NULL, key still names the order)");
const after = one(await svc(`SELECT ship_to FROM public.shipments WHERE id = '${first?.[0]?.id}'`));
ok(after?.zip === "70112" && after.redacted === true && after.line1 === undefined, "and its address is redacted to the ZIP (finding 3)");

console.log(`\n${pass} passed, ${fail} failed${skip ? " (NEW_MIGRATION=skip: RED baseline)" : ""}`);
process.exit(fail ? 1 : 0);
