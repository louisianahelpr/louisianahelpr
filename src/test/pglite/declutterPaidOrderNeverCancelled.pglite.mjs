#!/usr/bin/env node
/**
 * PGlite proof for 20261030002630_declutter_paid_order_never_cancelled (owner 2026-10-29, Q2477: "once they pay it
 * can only be rescheduled once. never cancelled."). On a paid seller delivery:
 *   - the buyer's and the seller's cancel RPCs refuse with paid_order_not_cancellable; the order stays paid, no
 *     refund row, no strike;
 *   - a stranger still learns nothing (item_not_found), the wrong side gets wrong_side, anon cannot call either;
 *   - each side may ask for a new time ONCE (proposals_per_side = 1): a second ask, even after taking the first
 *     back, is reschedule_used; the booking shows proposals_left 1, then 0.
 *
 *   node src/test/pglite/declutterPaidOrderNeverCancelled.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterPaidOrderNeverCancelled.pglite.mjs # RED: the chain without it
 *
 * World: scripts/declutter/handoverPhotoWorld.mjs (seller delivery at 20261027153244, the bodies prod runs for the
 * cancel RPCs: buyer md5 = the repo text; the seller's in-place notice rewrite does not change what it refunds).
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261030002630_declutter_paid_order_never_cancelled.sql";
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");
const { svc, run, one, me, refused, liveItemSql, USERS } = await buildHandoverWorld();
const { SELLER, BUYER, BUYER2, BUYER3 } = USERS;

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

const DROPOFF = { lat: 30.496234, lng: -91.154321 };
const I = (n) => `bbbbbbbb-0000-0000-0000-${String(n).padStart(12, "0")}`;
const status = async (id) => one(await svc(`SELECT status FROM public.declutter_orders WHERE id = '${id}'`));
const refunds = async (id) => Number(one(await svc(`SELECT count(*) FROM public.declutter_refunds WHERE order_id = '${id}'`)) ?? -1);
const NOT_CANCELLABLE = /paid_order_not_cancellable/;

await me(SELLER, `SELECT public.declutter_set_seller_delivery(true, 2000, 10)`);
const windows = JSON.stringify([0, 1, 2, 3, 4, 5, 6].map((d) => ({ weekday: d, starts: "09:00", ends: "17:00" })));
await me(SELLER, `SELECT public.declutter_set_delivery_schedule('${windows}'::jsonb, ARRAY[]::date[])`);

async function paidDelivery(n, buyer) {
  await run(liveItemSql({ id: I(n), seller: SELLER, title: `Delivered item ${n}`, price: 5000, floor: 100 }));
  await me(buyer, `SELECT public.declutter_buy_now('${I(n)}', 5000)`);
  await svc(`SELECT public.declutter_set_delivery_dropoff('${buyer}', '${SELLER}', '500 Drop Rd, Baton Rouge, LA 70805', 'North Baton Rouge', ${DROPOFF.lat}, ${DROPOFF.lng})`);
  const slot = one(await me(buyer, `SELECT public.declutter_seller_delivery_offer('${SELLER}')`))?.slots?.[0];
  const o = (await me(buyer, `SELECT * FROM public.declutter_start_checkout('${SELLER}', 'seller_delivery', '${slot}', 'leave')`))?.[0];
  await svc(`SELECT public.declutter_mark_order_paid('${o?.order_id}', 'pi_nc_${n}', ${o?.total_cents}, now(), 150)`);
  return o?.order_id;
}

// 1. The rules: one new-time ask per side, no buyer cancel window.
{
  const rules = one(await svc(`SELECT public.declutter_seller_delivery_rules()`));
  ok(rules?.proposals_per_side === 1, `proposals_per_side is 1 (got ${rules?.proposals_per_side})`);
  ok(rules && !("buyer_cancel_hours" in rules), "buyer_cancel_hours is gone from the rules");
}

// 2. Neither side cancels a paid delivery.
const A = await paidDelivery(1, BUYER);
ok(!!A && await status(A) === "paid", "fixture: a paid seller delivery, days before its time");
{
  const r = await me(BUYER, `SELECT public.declutter_buyer_cancel_delivery('${A}')`);
  ok(refused(r, NOT_CANCELLABLE), `the buyer's cancel: paid_order_not_cancellable${Array.isArray(r) ? " (it went through)" : ` (${r?.error})`}`);
  ok(await status(A) === "paid" && await refunds(A) === 0, "  the order is still paid and nothing was refunded");
  const s = await me(SELLER, `SELECT public.declutter_seller_cancel_delivery('${A}')`);
  ok(refused(s, NOT_CANCELLABLE), `the seller's cancel: paid_order_not_cancellable${Array.isArray(s) ? " (it went through)" : ` (${s?.error})`}`);
  ok(await status(A) === "paid" && await refunds(A) === 0, "  the order is still paid and nothing was refunded");
  ok(Number(one(await svc(`SELECT count(*) FROM public.declutter_strikes WHERE user_id = '${SELLER}'`))) === 0, "  and the seller got no strike");
  ok(one(await svc(`SELECT status FROM public.declutter_seller_deliveries WHERE order_id = '${A}'`)) === "booked", "  the delivery is still booked");
}

// 3. The refusals before it are unchanged: a stranger, the wrong side, anon.
{
  ok(refused(await me(BUYER3, `SELECT public.declutter_buyer_cancel_delivery('${A}')`), /item_not_found/), "a stranger: item_not_found");
  ok(refused(await me(BUYER3, `SELECT public.declutter_seller_cancel_delivery('${A}')`), /item_not_found/), "a stranger (seller cancel): item_not_found");
  ok(refused(await me(SELLER, `SELECT public.declutter_buyer_cancel_delivery('${A}')`), /wrong_side/), "the seller on the buyer's cancel: wrong_side");
  ok(refused(await me(BUYER, `SELECT public.declutter_seller_cancel_delivery('${A}')`), /wrong_side/), "the buyer on the seller's cancel: wrong_side");
  ok(refused(await me(null, `SELECT public.declutter_buyer_cancel_delivery('${A}')`), /permission denied|not_authenticated/), "anon: refused");
  const acl = await svc(`SELECT has_function_privilege('anon', 'public.declutter_buyer_cancel_delivery(uuid)', 'EXECUTE') AS b,
    has_function_privilege('anon', 'public.declutter_seller_cancel_delivery(uuid)', 'EXECUTE') AS s`);
  ok(acl?.[0]?.b === false && acl?.[0]?.s === false, "anon holds EXECUTE on neither cancel RPC");
}

// 4. Rescheduled once per side.
{
  const left = async (uid) => one(await me(uid, `SELECT public.declutter_seller_delivery_booking('${A}')`))?.proposals_left;
  ok(await left(BUYER) === 1 && await left(SELLER) === 1, "each side starts with one new-time ask");
  const current = one(await svc(`SELECT slot_start FROM public.declutter_seller_deliveries WHERE order_id = '${A}'`));
  const slots = (await svc(`SELECT s FROM public.declutter_delivery_open_slots('${SELLER}', '${A}') s ORDER BY s`)) ?? [];
  const other = Array.isArray(slots) ? slots.map((r) => r.s).filter((s) => String(s) !== String(current)) : [];
  ok(other.length >= 3, `fixture: at least 3 other open times (${other.length})`);
  const iso = (d) => new Date(d).toISOString();
  const p1 = await me(BUYER, `SELECT public.declutter_propose_delivery_time('${A}', '${iso(other[0])}')`);
  ok(one(p1)?.result === "proposed", `the buyer's first ask: proposed${Array.isArray(p1) ? "" : ` (${p1?.error})`}`);
  ok(await left(BUYER) === 0, "  the buyer has none left");
  await me(BUYER, `SELECT public.declutter_answer_delivery_time('${A}', false)`);
  ok(refused(await me(BUYER, `SELECT public.declutter_propose_delivery_time('${A}', '${iso(other[1])}')`), /reschedule_used/),
    "the buyer asks again after taking it back: reschedule_used");
  const s1 = await me(SELLER, `SELECT public.declutter_propose_delivery_time('${A}', '${iso(other[1])}')`);
  ok(one(s1)?.result === "proposed", `the seller's own one ask: proposed${Array.isArray(s1) ? "" : ` (${s1?.error})`}`);
  const acc = await me(BUYER, `SELECT public.declutter_answer_delivery_time('${A}', true)`);
  ok(Array.isArray(acc) && one(await svc(`SELECT slot_start FROM public.declutter_seller_deliveries WHERE order_id = '${A}'`)) !== current,
    "the buyer accepts: the delivery moved");
  ok(refused(await me(SELLER, `SELECT public.declutter_propose_delivery_time('${A}', '${iso(other[2])}')`), /reschedule_used/),
    "the seller asks a second time: reschedule_used");
}

// 5. A second order: the cancel still refuses after a move (the move never re-opens a cancel).
{
  const B = await paidDelivery(2, BUYER2);
  ok(!!B && await status(B) === "paid", "fixture: a second paid seller delivery");
  ok(refused(await me(BUYER2, `SELECT public.declutter_buyer_cancel_delivery('${B}')`), NOT_CANCELLABLE), "its buyer's cancel: paid_order_not_cancellable");
  ok(await status(B) === "paid" && await refunds(B) === 0, "  still paid, nothing refunded");
}

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
