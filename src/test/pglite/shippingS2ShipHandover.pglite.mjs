#!/usr/bin/env node
/**
 * PGlite proof for 20261030000030_shipping_s2_ship_handover (docs/specs/shipping-draft.md S2, money review
 * must-fix 1; owner decisions 2026-10-20; Q2259): the 'ship' handover joins the order CHECK together with every
 * handover-generic path that would catch it, and the two GUARDS the spec requires:
 *   GUARD a: a label may never cost more than the shipping the buyer paid (claim refused, rate refused).
 *   GUARD b: the buyer's fee covers the card fee on EVERY shipped order (US 2.9% + 30c and international
 *            4.4% + 30c, stripe.com/pricing as quoted in the spec 5.1), over every fee base up to $20,000.
 *
 *   node src/test/pglite/shippingS2ShipHandover.pglite.mjs                     # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/shippingS2ShipHandover.pglite.mjs  # RED: the migration absent
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/shippingS2ShipHandover.pglite.mjs
 *
 * World: scripts/declutter/handoverPhotoWorld.mjs (slices 1-4, S1 shipments, seller delivery, Free, meetup,
 * pickup reminders, porch pick a day: the newest definitions of every function restated here), then this
 * migration 3 times. pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261030000030_shipping_s2_ship_handover.sql";
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");
const { svc, run, one, me, refused, liveItemSql, USERS } = await buildHandoverWorld();
const { SELLER, SELLER2, BUYER, BUYER2 } = USERS;

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };

if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}

const I = (n) => `5a5a5a5a-0000-0000-0000-${String(n).padStart(12, "0")}`;
const fee = (items, ship) => Math.floor(((items + ship) * 5 + 50) / 100) + 70; // src/lib/shipping/policy.ts
/** A shipped order as checkout will write it (S3): the trigger picks the fee rule; we give the amounts. */
async function shipOrder(n, { buyer = BUYER, seller = SELLER, items = 1000, ship = 733, paidDaysAgo = null } = {}) {
  const p = fee(items, ship);
  const r = await svc(`INSERT INTO public.declutter_orders (id, buyer_id, seller_id, handover, items_cents, premium_cents, total_cents, shipping_cents)
    VALUES ('${I(n)}', '${buyer}', '${seller}', 'ship', ${items}, ${p}, ${items + p + ship}, ${ship}) RETURNING id, fee_rule, premium_cents, total_cents`);
  if (Array.isArray(r) && paidDaysAgo !== null) {
    await svc(`UPDATE public.declutter_orders SET status = 'paid', paid_at = now() - interval '${paidDaysAgo} days',
      stripe_payment_intent_id = 'pi_ship_${n}' WHERE id = '${I(n)}'`);
  }
  return r;
}
const status = async (id) => one(await svc(`SELECT status FROM public.declutter_orders WHERE id = '${id}'`));

// 1. The handover and its fee rule (decision 2).
{
  const r = await shipOrder(1);
  ok(Array.isArray(r) && r[0]?.fee_rule === "f1_ship", `a 'ship' order is accepted with fee rule f1_ship${Array.isArray(r) ? ` (got ${r[0]?.fee_rule})` : `: ${r?.error}`}`);
  ok(Array.isArray(r) && r[0]?.premium_cents === 157 && r[0]?.total_cents === 1890, "  $10 item + $7.33 shipping: fee $1.57, total $18.90");
  const wrong = await svc(`INSERT INTO public.declutter_orders (buyer_id, seller_id, handover, items_cents, premium_cents, total_cents, shipping_cents)
    VALUES ('${BUYER2}', '${SELLER}', 'ship', 1000, 120, 1853, 733)`);
  ok(refused(wrong, /declutter_orders_premium_rule/), "  the items-only fee on a shipped order is refused (the CHECK prices shipping in)");
  const noShip = await svc(`INSERT INTO public.declutter_orders (buyer_id, seller_id, handover, items_cents, premium_cents, total_cents, shipping_cents)
    VALUES ('${BUYER2}', '${SELLER2}', 'ship', 1000, 120, 1120, 0)`);
  ok(refused(noShip, /declutter_orders_premium_rule/), "  a shipped order with no shipping is refused (f1_ship needs shipping > 0)");
  await svc(`DELETE FROM public.declutter_orders WHERE id = '${I(1)}'`);
}

// 2. GUARD b: the fee covers the card fee on every shipped order. Every fee base (items + shipping) from $1.01
//    to $20,000 through the DB's own fee function (the one the premium CHECK mirrors), US and international cards.
{
  const bad = (await svc(`SELECT count(*) FILTER (WHERE f < round((b + f) * 0.029)::int + 30)::int AS us,
                                 count(*) FILTER (WHERE f < round((b + f) * 0.044)::int + 30)::int AS intl,
                                 min(f - (round((b + f) * 0.044)::int + 30))::int AS min_intl_margin, count(*)::int AS n
                            FROM (SELECT b, public.declutter_buyer_fee_cents_ship(b - 1, 1) AS f FROM generate_series(101, 2000000) b) x`))[0];
  ok(bad?.n === 1999900 && bad.us === 0, `US card: fee >= card fee for all ${bad?.n} fee bases ($1.01-$20,000)`);
  ok(bad?.intl === 0 && bad.min_intl_margin >= 30, `international card: fee >= card fee for all of them (smallest margin ${bad?.min_intl_margin}c)`);
  // ... and the DB actually charges THAT fee on shipped orders: a grid of real inserts, each priced by the CHECK.
  let made = 0;
  let short = 0;
  let n = 100;
  for (const items of [100, 499, 1000, 2500, 9999, 100000]) {
    for (const ship of [1, 733, 1167, 1637, 2000, 5000]) {
      const r = await shipOrder(++n, { buyer: BUYER2, seller: SELLER2, items, ship });
      if (Array.isArray(r) && r[0]?.fee_rule === "f1_ship") {
        made++;
        if (r[0].premium_cents < Math.round(r[0].total_cents * 0.044) + 30) short++;
      }
      await svc(`DELETE FROM public.declutter_orders WHERE id = '${I(n)}'`);
    }
  }
  ok(made === 36 && short === 0, `36 real shipped orders, each priced f1_ship by the database, each covers an international card fee (${made} made, ${short} short)`);
}

// 3. GUARD a: no label above the collected shipping.
{
  await shipOrder(2, { paidDaysAgo: 0 });
  const claim = (quoted, order = I(2)) => svc(`INSERT INTO public.shipments (declutter_order_id, idempotency_key, label_mode, service, quoted_cents, ship_to, parcel)
    VALUES ('${order}', 'declutter:${order}', 'test', 'usps_ground_advantage', ${quoted}, '{"zip":"70501","line1":"1 Main St"}', '{"weight_oz":12}') RETURNING id`);
  ok(refused(await claim(734), /label_over_collected_shipping/), "a label budget 1c above the shipping the buyer paid ($7.33) is refused");
  const s = await claim(733);
  ok(Array.isArray(s) && s.length === 1, `a label budget equal to the shipping paid is accepted${Array.isArray(s) ? "" : `: ${s?.error}`}`);
  const sid = s?.[0]?.id;
  const buyable = async (rate) => one(await svc(`SELECT public.shipping_rate_buyable(${sid ? `'${sid}'` : "NULL"}, ${rate})`));
  ok(await buyable(734) === false, "shipping_rate_buyable: a rate 1c above what the buyer paid is refused");
  ok(await buyable(733) === true, "  a rate equal to it may be bought");
  ok(await buyable(500) === true, "  a cheaper rate may be bought");
  ok(await buyable("NULL") === false && await buyable(0) === false, "  a missing or zero rate is refused");
  ok(one(await svc(`SELECT public.shipping_rate_buyable(NULL, 500)`)) === false, "  an unknown shipment is refused");
  ok(refused(await me(BUYER, `SELECT public.shipping_rate_buyable('${sid}', 1)`), /permission denied/), "  members cannot call it (service role only)");
  // A porch order can never get a label.
  await run(liveItemSql({ id: I(50), seller: SELLER2, title: "Porch lamp", price: 1200, floor: 100 }));
  await me(BUYER, `SELECT public.declutter_buy_now('${I(50)}', 1200)`);
  const porch = (await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'porch')`))?.[0];
  ok(refused(await claim(733, porch?.order_id), /shipment_order_not_shipped/), "a shipment on a porch order is refused");
  const row = (await svc(`SELECT fee_rule, shipping_cents, premium_cents FROM public.declutter_orders WHERE id = '${porch?.order_id}'`))[0];
  ok(row?.fee_rule === "f1" && row.shipping_cents === 0 && row.premium_cents === 130, "  and that porch order is unchanged: f1, items-only fee ($12 -> $1.30)");
}

// 4. The sweeps never touch a shipped order (must-fix 1).
{
  await shipOrder(3, { buyer: BUYER2, paidDaysAgo: 8 });
  const sweep = await svc(`SELECT public.declutter_handover_sweep() AS r`);
  ok(Array.isArray(sweep), `the handover sweep runs${Array.isArray(sweep) ? "" : `: ${sweep?.error}`}`);
  ok(await status(I(3)) === "paid", "a shipped order paid 8 days ago with no pickup booked is NOT closed as a buyer no-show");
  ok(Number(one(await svc(`SELECT count(*) FROM public.cron_defects_seen WHERE ref = '${I(3)}'`))) === 0, "  and the sweep logged no defect for it");
  // No pickup slot (which would start the 24 h auto-pay).
  const book = await svc(`INSERT INTO public.declutter_bookings (order_id, buyer_id, seller_id, slot_start, slot_end)
    VALUES ('${I(3)}', '${BUYER2}', '${SELLER}', now() - interval '2 days', now() - interval '2 days' + interval '30 minutes')`);
  ok(refused(book, /delivery_order/), "a pickup slot on a shipped order is refused");
  ok(refused(await me(BUYER2, `SELECT public.declutter_book_pickup('${I(3)}', now() + interval '1 day')`), /delivery_order|invalid_slot/),
    "  through the booking RPC too");
  ok(await status(I(3)) === "paid", "  and the order is still paid");
}

// 5. The seller's home address is never given to the buyer of a shipped order.
{
  await run(liveItemSql({ id: I(60), seller: SELLER, title: "Ship mug", price: 1000, floor: 100 }));
  // The buyer's real cart line (buy now), then the server's own paid marking of it onto the shipped order.
  await me(BUYER, `SELECT public.declutter_buy_now('${I(60)}', 1000)`);
  const line = await svc(`UPDATE public.declutter_cart_items SET status = 'paid', order_id = '${I(2)}'
    WHERE item_id = '${I(60)}' AND buyer_id = '${BUYER}' RETURNING id`);
  if (!Array.isArray(line)) console.log(`  fixture error: ${line?.error}`);
  const has = one(await svc(`SELECT count(*)::int FROM public.declutter_cart_items WHERE item_id = '${I(60)}' AND order_id = '${I(2)}'`));
  ok(has === 1, "fixture: the shipped order's paid cart line");
  ok(one(await svc(`SELECT public.declutter_address_access('${I(60)}', '${BUYER}')`)) == null, "declutter_address_access: the shipped buyer is not 'paid_buyer'");
  ok(one(await svc(`SELECT public.declutter_address_access('${I(60)}', '${SELLER}')`)) === "seller", "  the seller still reads their own");
}

// 6. "I got it" only after the USPS delivered scan.
{
  const early = await me(BUYER, `SELECT public.declutter_confirm_handover('${I(2)}', 'buyer', NULL)`);
  ok(refused(early, /not_delivered_yet/), `before the delivered scan the buyer's "I got it" is refused${refused(early, /not_delivered_yet/) ? "" : ` (got ${JSON.stringify(early)?.slice(0, 140)})`}`);
  ok(await status(I(2)) === "paid", "  and the order stays paid");
  await svc(`UPDATE public.shipments SET label_state = 'bought', provider_shipment_id = 'shp_test_1', label_cost_cents = 733, tracking_code = '9400TEST'
    WHERE declutter_order_id = '${I(2)}'`);
  await svc(`UPDATE public.shipments SET tracking_status = 'in_transit', accepted_at = now() WHERE declutter_order_id = '${I(2)}'`);
  ok(refused(await me(BUYER, `SELECT public.declutter_confirm_handover('${I(2)}', 'buyer', NULL)`), /not_delivered_yet/), "  in transit: still refused");
  await svc(`UPDATE public.shipments SET tracking_status = 'delivered', delivered_at = now() WHERE declutter_order_id = '${I(2)}'`);
  const got = await me(BUYER, `SELECT public.declutter_confirm_handover('${I(2)}', 'buyer', NULL) AS r`);
  ok(Array.isArray(got) && await status(I(2)) === "handed_over", `after the delivered scan "I got it" hands it over${Array.isArray(got) ? "" : `: ${got?.error}`}`);
}

// 7. Grants.
const acl = async (s, role) => one(await svc(`SELECT has_function_privilege('${role}', '${s}', 'EXECUTE')`));
ok(await acl("public.declutter_confirm_handover(uuid, text, text)", "anon") === false
  && await acl("public.declutter_confirm_handover(uuid, text, text)", "authenticated") === true, "confirm_handover: anon revoked, members granted");
for (const s of ["public.declutter_handover_sweep()", "public.declutter_address_access(uuid, uuid)", "public.shipping_rate_buyable(uuid, integer)"]) {
  ok(await acl(s, "anon") === false && await acl(s, "authenticated") === false, `${s}: not callable by anon or members`);
}

console.log(`\n${pass} passed, ${fail} failed${skip ? " (NEW_MIGRATION=skip: RED baseline)" : ""}`);
process.exit(fail > 0 ? 1 : 0);
