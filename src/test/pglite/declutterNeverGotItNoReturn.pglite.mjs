#!/usr/bin/env node
/**
 * PGlite proof for 20261031010243_declutter_never_got_it_no_return (BUY-25, BUY-23; owner's rulings 10-30).
 * On "never got it" the seller's Refund in full refunds at once, with no return and no payout, as reason seller_no_show:
 * everything back, the seller owes the card fee. "The buyer brings it back" exists only where the seller offered
 * pickup, and the buyer is told the address while it is open.
 *
 *   node src/test/pglite/declutterNeverGotItNoReturn.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterNeverGotItNoReturn.pglite.mjs # RED: the chain without it
 *   MIGRATION_PATH=<planted copy> node ...                                         # RED on a planted defect
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261031010243_declutter_never_got_it_no_return.sql";
const BASES = [
  "20261027171453_declutter_withdraw_refund_not_once_returning.sql",
  "20261027211754_declutter_bundle_discount.sql",
  "20261028200440_declutter_audit3_notices_and_empty_cart.sql",
  "20261028235247_declutter_handover_choices.sql",
  "20261028235709_declutter_handover_photos_at_the_address.sql",
  "20261029000048_declutter_false_report_strike.sql",
  "20261029002010_declutter_handover_photos_live_only.sql",
  "20261029161347_declutter_porch_weekdays.sql",
  "20261029201542_declutter_porch_photo_not_before_the_day.sql",
  "20261029224147_declutter_admin_decision_closes_refund_request.sql",
  "20261029225634_declutter_problem_both_sides_and_photos.sql",
  "20261029232103_declutter_refund_debt_notice.sql",
  "20261030071818_declutter_returns.sql",
  "20261030164712_declutter_porch_places.sql",
];
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");
const { svc, run, one, me, refused, liveItemSql, USERS } = await buildHandoverWorld();
const { SELLER2, BUYER2 } = USERS;

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const short = (r) => JSON.stringify(r)?.slice(0, 240);

for (const f of BASES) {
  const r = await run(readFileSync(`${MIG_DIR}${f}`, "utf8"));
  ok(!r?.error, `base ${f} applies${r?.error ? `: ${r.error}` : ""}`);
}
await run(`CREATE OR REPLACE FUNCTION public.declutter_order_items_named(p_order_id uuid) RETURNS text LANGUAGE sql AS $$ SELECT 'the items'::text $$;`);
if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}

const I = (n) => `eeeeeeee-0000-0000-0000-${String(n).padStart(12, "0")}`;
/** A paid order, handed over just now, its payout row waiting. */
async function handedOver(n, how) {
  await run(liveItemSql({ id: I(n), seller: SELLER2, title: `Refund item ${n}`, price: 3000, floor: 100 }));
  await me(BUYER2, `SELECT public.declutter_buy_now('${I(n)}', 3000)`);
  const o = (await me(BUYER2, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'pickup_home')`))?.[0];
  await svc(`SELECT public.declutter_mark_order_paid('${o?.order_id}', 'pi_never_${n}', ${o?.total_cents}, now(), 150)`);
  await svc(`SELECT public.declutter_complete_handover('${o?.order_id}', 'auto')`);
  // The way the sale was handed over is the fixture; the checkout's own rules for it are not what is proved.
  await run(`ALTER TABLE public.declutter_orders DISABLE TRIGGER USER; UPDATE public.declutter_orders SET handover = '${how}' WHERE id = '${o?.order_id}'; ALTER TABLE public.declutter_orders ENABLE TRIGGER USER;`);
  return { id: o?.order_id, total: o?.total_cents };
}
const ask = (id, reason) => me(BUYER2, `SELECT public.declutter_ask_refund('${id}', '${reason}', 'Words from the buyer') AS r`);
const row = async (id) => (await svc(`SELECT status, refund_id, return_way, settled_at FROM public.declutter_refund_requests WHERE order_id = '${id}'`))?.[0];
const refund = async (id) => (await svc(`SELECT reason, fee_policy, paid_cents, card_fee_cents, refund_cents FROM public.declutter_refunds WHERE order_id = '${id}'`))?.[0];
const payout = async (id) => (await svc(`SELECT status, amount_cents FROM public.declutter_payouts WHERE order_id = '${id}'`))?.[0];
const noteTo = async (uid, title) => one(await svc(`SELECT message FROM public.notifications WHERE user_id = '${uid}' AND title = '${title}' ORDER BY created_at DESC LIMIT 1`));
const view = async (uid, id) => (await me(uid, `SELECT public.declutter_refund_request_view('${id}') AS v`))?.[0]?.v;

// BUY-25.
const N = await handedOver(1, "pickup_home");
const reqN = one(await ask(N.id, "not_received"))?.request_id;
ok(typeof reqN === "string", `the buyer asks: never got it (${reqN})`);
ok(refused(await me(SELLER2, `SELECT public.declutter_accept_refund_with_return('${reqN}', 'collect', NULL, now() + interval '1 day')`), /no_return_needed/), "no way back can be picked");
const ans = await me(SELLER2, `SELECT public.declutter_answer_refund('${reqN}', 'full', NULL) AS r`);
ok(ans?.[0]?.r?.result === "refunded", `Refund in full refunds at once (${short(ans)})`);
const rN = await row(N.id);
ok(rN?.status === "agreed" && !!rN?.refund_id && !!rN?.settled_at && rN?.return_way == null, `  agreed, with its refund, and no return (${short(rN)})`);
const mN = await refund(N.id);
ok(mN?.reason === "seller_no_show" && mN?.fee_policy === "full_seller_pays_fee" && mN?.paid_cents === N.total && mN?.refund_cents === N.total, `  the refund row: everything back, the seller pays the card fee (${short(mN)})`);
const dN = (await svc(`SELECT d.seller_id::text AS seller, d.amount_cents, d.remaining_cents FROM public.declutter_seller_fee_debts d JOIN public.declutter_refunds r ON r.id = d.refund_id WHERE r.order_id = '${N.id}'`))?.[0];
ok(dN?.seller === SELLER2 && dN?.amount_cents === mN?.card_fee_cents && dN?.remaining_cents === mN?.card_fee_cents && mN?.card_fee_cents > 0, `  the card fee is a debt on the seller, so the platform absorbs nothing (${short(dN)})`);
ok(/next Declutter sale/.test(await noteTo(SELLER2, "You owe from a refund") ?? ""), "  the seller is told where it comes from");
// What the Stripe worker (declutter-money) reads and writes: it sends the row's refund_cents and takes no decision on the reason.
await svc(`UPDATE public.declutter_refunds SET created_at = now() - interval '5 minutes' WHERE order_id = '${N.id}'`);
const dueN = (await svc(`SELECT reason, refund_cents, payment_intent_id FROM public.declutter_refunds_due(50) WHERE order_id = '${N.id}'`))?.[0];
ok(dueN?.reason === "seller_no_show" && dueN?.refund_cents === N.total && dueN?.payment_intent_id === "pi_never_1", `  the refund worker picks it up on a handed-over order, for the whole amount (${short(dueN)})`);
const execN = one(await svc(`SELECT public.declutter_refund_executed(r.id, 're_never_1', true) FROM public.declutter_refunds r WHERE r.order_id = '${N.id}'`));
ok(execN === "succeeded", `  and records it (${execN})`);
ok((await payout(N.id))?.amount_cents === 0, "  the payout stays at nothing");
ok((await view(BUYER2, N.id))?.never_got_it_refund_cents === N.total, "  the view gives the buyer the whole amount");
const pN = await payout(N.id);
ok(pN?.amount_cents === 0 && pN?.status === "nothing_due", `  no payout for that sale (${short(pN)})`);
ok(/The seller agreed you never got it/.test(await noteTo(BUYER2, "Refund on its way") ?? ""), "  the buyer's notice says why, not that the item came back");
ok(/You agreed the buyer never got/.test(await noteTo(SELLER2, "Buyer refunded") ?? ""), "  the seller's too");
ok(one(await svc(`SELECT status FROM public.declutter_items WHERE id = '${I(1)}'`)) === "withdrawn", "  the listing is withdrawn, as on any full refund");
ok(refused(await me(SELLER2, `SELECT public.declutter_answer_refund('${reqN}', 'full', NULL)`), /refund_already_answered/), "  a second answer is refused");

// Other reasons still wait for the item.
const D = await handedOver(2, "pickup_home");
const reqD = one(await ask(D.id, "damaged"))?.request_id;
const ansD = await me(SELLER2, `SELECT public.declutter_answer_refund('${reqD}', 'full', NULL) AS r`);
ok(ansD?.[0]?.r?.result === "returning" && !(await refund(D.id)), `any other reason still waits for the item (${short(ansD)})`);

// A payout already sent still refuses.
const S = await handedOver(3, "pickup_home");
const reqS = one(await ask(S.id, "not_received"))?.request_id;
await svc(`INSERT INTO public.payout_send_marks (payout_kind, payout_id) SELECT 'declutter', id FROM public.declutter_payouts WHERE order_id = '${S.id}'`);
ok(refused(await me(SELLER2, `SELECT public.declutter_answer_refund('${reqS}', 'full', NULL)`), /payout_already_sent/), "a payout already sent refuses, and nothing is refunded");
ok(!(await refund(S.id)), "  no refund row");

// BUY-23.
for (const [n, how] of [[4, "meetup"], [5, "seller_delivery"]]) {
  const O = await handedOver(n, how);
  const q = one(await ask(O.id, "damaged"))?.request_id;
  ok(refused(await me(SELLER2, `SELECT public.declutter_accept_refund_with_return('${q}', 'drop_off', (now() AT TIME ZONE 'America/Chicago')::date, NULL)`), /drop_off_not_offered/), `${how}: no drop-off`);
  const coll = await me(SELLER2, `SELECT public.declutter_accept_refund_with_return('${q}', 'collect', NULL, now() + interval '1 day') AS r`);
  ok(coll?.[0]?.r?.return_way === "collect", `  ${how}: "I'll pick it up" still works${coll?.[0]?.r ? "" : `: ${short(coll)}`}`);
  const v = await view(BUYER2, O.id);
  ok(v?.can_drop_off === false && v?.request?.drop_off_address == null, `  ${how}: the buyer's read has no seller address`);
}
const H = await handedOver(8, "pickup_home");
const qH = one(await ask(H.id, "damaged"))?.request_id;
ok((await view(BUYER2, H.id))?.request?.drop_off_address == null, "door pickup: no address before the seller agrees");
const acc = await me(SELLER2, `SELECT public.declutter_accept_refund_with_return('${qH}', 'drop_off', (now() AT TIME ZONE 'America/Chicago')::date, NULL) AS r`);
ok(acc?.[0]?.r?.return_way === "drop_off", `door pickup: the seller offers the drop-off (${short(acc)})`);
const vH = await view(BUYER2, H.id);
ok(typeof vH?.request?.drop_off_address === "string" && vH.request.drop_off_address.length > 3, `  and the buyer reads the address (${vH?.request?.drop_off_address})`);
await me(SELLER2, `SELECT public.declutter_refund_item_returned('${qH}')`);
ok((await view(BUYER2, H.id))?.request?.drop_off_address == null, "  and not once the return has ended");

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
