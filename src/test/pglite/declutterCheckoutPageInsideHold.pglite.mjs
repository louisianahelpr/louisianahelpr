#!/usr/bin/env node
/**
 * PGlite proof for 20261101032626_declutter_checkout_page_inside_hold (BUY-1 follow-ups, lh-money-escrow approve of
 * 20261101030040, lead 10-31):
 *   1. declutter_start_checkout opens no new checkout for a line whose own hold plus 10 minutes is over (cart_empty,
 *      no order), so no Stripe page can outlive the hold's release; inside that window it still opens one.
 *   2. declutter_reopen_voided_offers tells the seller too.
 *
 *   node src/test/pglite/declutterCheckoutPageInsideHold.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterCheckoutPageInsideHold.pglite.mjs # RED: 030040 without it
 *   MIGRATION_PATH=<planted copy> node ...                                             # RED on a planted defect
 *
 * World: scripts/declutter/handoverPhotoWorld.mjs, the bases the door-pickup proof applies, 20261031164337 (the newest
 * declutter_start_checkout before this one) and 20261031171727, then 20261101030040 (BUY-1) once; this migration 3x.
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261101032626_declutter_checkout_page_inside_hold.sql";
const BASES = [
  "20261027211754_declutter_bundle_discount.sql",
  "20261028195840_declutter_pickup_window_reads.sql",
  "20261028200440_declutter_audit3_notices_and_empty_cart.sql",
  "20261028235247_declutter_handover_choices.sql",
  "20261028235709_declutter_handover_photos_at_the_address.sql",
  "20261029002010_declutter_handover_photos_live_only.sql",
  "20261029161347_declutter_porch_weekdays.sql",
  "20261029201542_declutter_porch_photo_not_before_the_day.sql",
  "20261030164712_declutter_porch_places.sql",
  "20261031145652_declutter_place_hours.sql",
  "20261031164337_declutter_door_pickup_uses_places.sql",
  "20261031171727_declutter_porch_days_without_places.sql",
  "20261101030040_declutter_buy_now_30_minutes.sql",
];
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");
const { svc, run, one, me, refused, liveItemSql, USERS } = await buildHandoverWorld();
const { SELLER2, BUYER, BUYER2 } = USERS;

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const short = (r) => JSON.stringify(r)?.slice(0, 260);

await svc(`ALTER TABLE public.declutter_items ADD COLUMN IF NOT EXISTS seller_hidden boolean NOT NULL DEFAULT false`);
for (const f of BASES) {
  const r = await run(readFileSync(`${MIG_DIR}${f}`, "utf8"));
  ok(!r?.error, `base ${f} applies${r?.error ? `: ${r.error}` : ""}`);
}
if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}
const acl = one(await svc(`SELECT has_function_privilege('authenticated', 'public.declutter_start_checkout(uuid, text, timestamptz, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.declutter_start_checkout(uuid, text, timestamptz, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.declutter_reopen_voided_offers(uuid)', 'EXECUTE')`));
ok(acl === true, "grants unchanged: start_checkout for signed-in members only; the reopen helper service_role only");

const I = (n) => `abababab-0000-0000-0000-${String(n).padStart(12, "0")}`;
const lineOf = async (n) => one(await svc(`SELECT id FROM public.declutter_cart_items WHERE item_id = '${I(n)}'`));
// A Buy now hold as declutter_take_item makes it (item reserved, one 'buy' line in the cart).
const buyNow = async (n, buyer, price) => {
  await run(liveItemSql({ id: I(n), seller: SELLER2, title: `Hold item ${n}`, price, floor: 100 }));
  await svc(`UPDATE public.declutter_items SET status = 'reserved' WHERE id = '${I(n)}'`);
  return svc(`INSERT INTO public.declutter_cart_items (item_id, buyer_id, seller_id, price_cents, source, status, checkout_by)
    VALUES ('${I(n)}', '${buyer}', '${SELLER2}', ${price}, 'buy', 'in_cart', now() + interval '30 minutes') RETURNING id`);
};
const orders = async (buyer) =>
  Number(one(await svc(`SELECT count(*) FROM public.declutter_orders WHERE buyer_id = '${buyer}' AND seller_id = '${SELLER2}'`)));

// 1a. A Buy now line made 45 minutes ago (hold 30 min + 10 over), still in the cart because checkout stretched it.
const b1 = await buyNow(1, BUYER, 1500);
ok(Array.isArray(b1), `fixture: Buy now puts item 1 in the cart${Array.isArray(b1) ? "" : ` (got ${short(b1)})`}`);
await svc(`UPDATE public.declutter_cart_items SET created_at = now() - interval '45 minutes', checkout_by = now() + interval '5 minutes' WHERE id = '${await lineOf(1)}'`);
const late = await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'pickup_home')`);
ok(refused(late, /cart_empty/), `past its hold + 10 min: no new checkout (cart_empty)${refused(late, /cart_empty/) ? "" : ` (got ${short(late)})`}`);
ok(await orders(BUYER) === 0, "  and no order is made, so no Stripe page can be opened for it");

// 1b. Inside the window (made 25 minutes ago): checkout still opens.
const b2 = await buyNow(2, BUYER2, 1500);
ok(Array.isArray(b2), `fixture: Buy now puts item 2 in the cart${Array.isArray(b2) ? "" : ` (got ${short(b2)})`}`);
await svc(`UPDATE public.declutter_cart_items SET created_at = now() - interval '25 minutes', checkout_by = now() + interval '5 minutes' WHERE id = '${await lineOf(2)}'`);
const inTime = (await me(BUYER2, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'pickup_home')`));
ok(Array.isArray(inTime) && inTime[0]?.order_id, `inside its hold: checkout opens an order${Array.isArray(inTime) ? "" : ` (got ${short(inTime)})`}`);
// 1c. The edge of the window: 39 minutes in (hold 30 + 9) still opens; a line just past 40 does not (1a).
await svc(`UPDATE public.declutter_orders SET status = 'superseded', close_reason = 'superseded', closed_at = now() WHERE buyer_id = '${BUYER2}'`);
await svc(`UPDATE public.declutter_cart_items SET order_id = NULL, created_at = now() - interval '39 minutes' WHERE id = '${await lineOf(2)}'`);
const edge = await me(BUYER2, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'pickup_home')`);
ok(Array.isArray(edge) && edge[0]?.order_id, `39 minutes in (inside hold + 10): still opens${Array.isArray(edge) ? "" : ` (got ${short(edge)})`}`);

// 1d. Mixed cart: the line past its hold + 10 min (item 1) never joins the order of a line still inside (item 4).
await buyNow(4, BUYER, 2500);
const mixed = await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'pickup_home')`);
const l1 = (await svc(`SELECT order_id FROM public.declutter_cart_items WHERE id = '${await lineOf(1)}'`))?.[0];
const l4 = (await svc(`SELECT order_id FROM public.declutter_cart_items WHERE id = '${await lineOf(4)}'`))?.[0];
ok(Array.isArray(mixed) && mixed[0]?.items_cents === 2500 && l4?.order_id === mixed[0]?.order_id && !l1?.order_id,
  `a mixed cart checks out only the line still inside its hold (${short(mixed)}; line 1 order ${l1?.order_id ?? "none"})`);

// 2. The seller is told when an offer the hold closed opens again.
await run(liveItemSql({ id: I(3), seller: SELLER2, title: "Reopen lamp", price: 2000, floor: 100 }));
await svc(`INSERT INTO public.declutter_cart_items (item_id, buyer_id, seller_id, price_cents, source, status, checkout_by)
  VALUES ('${I(3)}', '${BUYER}', '${SELLER2}', 2000, 'buy', 'missed', now() - interval '1 minute')`);
const line3 = await lineOf(3);
const offerIns = await svc(`INSERT INTO public.declutter_offers (item_id, buyer_id, seller_id, amount_cents, awaiting, status, respond_by, voided_by_line)
  VALUES ('${I(3)}', '${BUYER2}', '${SELLER2}', 1500, 'seller', 'voided', now() + interval '1 hour', '${line3}') RETURNING id`);
ok(Array.isArray(offerIns), `fixture: an offer item 3's hold voided${Array.isArray(offerIns) ? "" : ` (got ${short(offerIns)})`}`);
const n = one(await svc(`SELECT public.declutter_reopen_voided_offers('${line3}')`));
ok(Number(n) === 1, `the reopen opens that one offer (got ${short(n)})`);
const sellerNote = await svc(`SELECT title, message FROM public.notifications WHERE user_id = '${SELLER2}' AND message LIKE '%Reopen lamp%'`);
ok(Array.isArray(sellerNote) && sellerNote.some((x) => /open again/.test(x.title) && /48 hours/.test(x.message)),
  `the seller is told the offer is open again, with their 48 hours (${short(sellerNote)})`);
const buyerNote = await svc(`SELECT title FROM public.notifications WHERE user_id = '${BUYER2}' AND message LIKE '%Reopen lamp%'`);
ok(Array.isArray(buyerNote) && buyerNote.some((x) => /open again/.test(x.title)), "the offer's buyer is still told");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
