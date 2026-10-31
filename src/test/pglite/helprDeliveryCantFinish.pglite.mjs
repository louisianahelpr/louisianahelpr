#!/usr/bin/env node
/**
 * PGlite proof for 20261031231150_helpr_delivery_cant_finish (BUY-36; "Delivery Helpr can't finish after pickup", owner 10-30).
 *
 *   node src/test/pglite/helprDeliveryCantFinish.pglite.mjs                    # GREEN (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/helprDeliveryCantFinish.pglite.mjs # RED: the chain without it
 *   MIGRATION_PATH=<planted copy> node ...                                     # RED on a planted defect
 *
 * World: scripts/declutter/handoverPhotoWorld.mjs (the real money functions), then the newest definitions this migration
 * restates or reads. Stubbed, and said so: is_test_subject (false). A task reaches "picked up" by a direct update: taking
 * and picking up have their own proofs.
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261031231150_helpr_delivery_cant_finish.sql";
const TALK_FILE = "20261031231948_helpr_delivery_talk.sql";
const BASES = [
  "20261027171453_declutter_withdraw_refund_not_once_returning.sql",
  "20261027211754_declutter_bundle_discount.sql",
  "20261028200440_declutter_audit3_notices_and_empty_cart.sql",
  "20261028171944_declutter_notice_copy.sql",
  "20261028210552_declutter_sale_notices_name_inline.sql",
  "20261028232338_declutter_damage_no_enjoy_notice.sql",
  "20261028235247_declutter_handover_choices.sql",
  "20261028235709_declutter_handover_photos_at_the_address.sql",
  "20261029000048_declutter_false_report_strike.sql",
  "20261029002010_declutter_handover_photos_live_only.sql",
  "20261029161347_declutter_porch_weekdays.sql",
  "20261029201542_declutter_porch_photo_not_before_the_day.sql",
  "20261029224147_declutter_admin_decision_closes_refund_request.sql",
  "20261029225634_declutter_problem_both_sides_and_photos.sql",
  "20261029231235_declutter_admin_part_refund.sql",
  "20261029232103_declutter_refund_debt_notice.sql",
  "20261027194235_helpr_my_route.sql",
  "20261027201327_delivery_dropoff_on_accept.sql",
  "20261030012018_helpr_delivery_seller_handover.sql",
  "20261030031642_helpr_delivery_notices_name_the_item.sql",
  "20261030164712_declutter_porch_places.sql",
  "20261031014011_helpr_delivery_still_in_hand_nudge.sql",
  // B36: what main applied since (the newest CREATEs this file is restated from, and their neighbours).
  "20261031075157_helpr_open_deliveries_hide_backed_out.sql",
  "20261031082308_helpr_task_confirm_not_on_the_road.sql",
  "20261031082821_helpr_open_count_and_windows_hide_backed_out.sql",
  "20261031085000_helpr_same_pickup_slot_hides_backed_out.sql",
  "20261031095846_helpr_task_seller_move_pickup.sql",
  "20261031102758_helpr_backout_after_seller_move_is_free.sql",
  "20261031103443_declutter_taken_back_notice_opens_the_tab.sql",
  "20261031105148_declutter_refund_debt_notice_names_the_item.sql",
  "20261031133938_declutter_no_helpr_buyer_refund.sql",
  "20261031134217_helpr_delivery_seller_reports_no_show.sql",
  "20261031140431_helpr_delivery_seller_told_delivered.sql",
  "20261031170803_declutter_no_helpr_notice_offers_refund.sql",
  "20261031181404_declutter_notices_name_the_item_sweep_remind_task.sql",
  "20261031184929_declutter_damage_notices_name_the_item.sql",
  "20261031200034_declutter_payout_tries_restart.sql",
  "20261031202929_helpr_my_tasks_ended_at.sql",
];
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");
const { svc, run, one, me, refused, liveItemSql, USERS } = await buildHandoverWorld();
const { SELLER2, BUYER2, BUYER3, OUTSIDER, ADMIN } = USERS;
const SELLER = SELLER2;
const BUYER = BUYER2;
const HELPR = BUYER3;

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const short = (r) => JSON.stringify(r)?.slice(0, 260);

for (const f of BASES) {
  const r = await run(readFileSync(`${MIG_DIR}${f}`, "utf8"));
  ok(!r?.error, `base ${f} applies${r?.error ? `: ${r.error}` : ""}`);
}
await run(`CREATE OR REPLACE FUNCTION public.is_test_subject(p uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;`);
if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
    const r2 = await run(readFileSync(process.env.TALK_PATH ?? `${MIG_DIR}${TALK_FILE}`, "utf8"));
    ok(!r2?.error, `the chat's migration applies (run ${i + 1} of 3)${r2?.error ? `: ${r2.error}` : ""}`);
  }
}

const I = (n) => `dddddddd-0000-0000-0000-${String(n).padStart(12, "0")}`;
const PICK = { lat: 30.451234, lng: -91.154321 };
const DROP = { lat: 30.496234, lng: -91.154321 };
await run(`INSERT INTO public.declutter_pickup_windows (seller_id, weekday, starts_local, ends_local)
  SELECT '${SELLER}', d, '00:00', '23:59' FROM generate_series(0, 6) d ON CONFLICT DO NOTHING`);

/** A paid Helpr delivery the Helpr has picked up. */
async function carried(n) {
  await run(liveItemSql({ id: I(n), seller: SELLER, title: `Carried item ${n}`, price: 4000, floor: 100 }));
  await svc(`UPDATE public.declutter_items SET delivery_size = 'small' WHERE id = '${I(n)}'`);
  await me(BUYER, `SELECT public.declutter_buy_now('${I(n)}', 4000)`);
  await svc(`SELECT public.declutter_set_delivery_dropoff('${BUYER}', '${SELLER}', '500 Drop Rd', 'North Baton Rouge', ${DROP.lat}, ${DROP.lng})`);
  const o = (await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${SELLER}', 'delivery')`))?.[0];
  if (!o?.order_id) throw new Error(`no order for ${n}`);
  const paid = await svc(`SELECT public.declutter_mark_order_paid('${o.order_id}', 'pi_stuck_${n}', ${o.total_cents}, now(), 150)`);
  if (paid?.error) throw new Error(`mark paid: ${paid.error}`);
  const task = one(await svc(`SELECT task_id FROM public.declutter_order_deliveries WHERE order_id = '${o.order_id}'`));
  const up = await run(`UPDATE public.helpr_tasks SET status = 'picked_up', helpr_id = '${HELPR}', accepted_at = now(), pickup_slot_start = now() - interval '1 hour',
    picked_up_at = now(), pickup_photo_path = '${HELPR}/task/${task}/pick.jpg' WHERE id = '${task}'`);
  if (!task) throw new Error(`no task for ${n}: ${JSON.stringify(paid)} ${JSON.stringify(await svc(`SELECT status, handover, total_cents FROM public.declutter_orders WHERE id = '${o.order_id}'`))} ${JSON.stringify(await svc(`SELECT count(*) FROM public.declutter_order_deliveries`))}`);
  if (up?.error) throw new Error(up.error);
  return { order: o.order_id, total: o.total_cents, delivery: o.delivery_cents, task };
}
const task = async (id) => (await svc(`SELECT * FROM public.helpr_tasks WHERE id = '${id}'`))?.[0];
const order = async (id) => (await svc(`SELECT * FROM public.declutter_orders WHERE id = '${id}'`))?.[0];
const refund = async (id) => (await svc(`SELECT reason, fee_policy, paid_cents, card_fee_cents, refund_cents FROM public.declutter_refunds WHERE order_id = '${id}'`))?.[0];
const helprPayout = async (t) => (await svc(`SELECT amount_cents, debt_cents, status FROM public.helpr_task_payouts WHERE task_id = '${t}'`))?.[0];
const sellerPayout = async (id) => (await svc(`SELECT amount_cents, status FROM public.declutter_payouts WHERE order_id = '${id}'`))?.[0];
const openProblem = async (id) => (await svc(`SELECT id, reporter_side, reason FROM public.declutter_problems WHERE order_id = '${id}' AND status = 'open'`))?.[0];
const strikes = async () => one(await svc(`SELECT count(*)::int FROM public.user_violations WHERE user_id = '${HELPR}'`));
const noteTo = async (uid, title) => one(await svc(`SELECT message FROM public.notifications WHERE user_id = '${uid}' AND title = '${title.replace(/'/g, "''")}' ORDER BY created_at DESC LIMIT 1`));
const cantFinish = (t, reason, note = "") => me(HELPR, `SELECT public.helpr_task_cant_finish('${t}', '${reason}', '${note}') AS r`);
const sweep = async () => one(await svc(`SELECT public.helpr_task_sweep()`));
async function bringBack(t, name = "back.jpg", at = PICK) {
  await svc(`INSERT INTO storage.objects (bucket_id, name) VALUES ('helpr-tasks', '${HELPR}/task/${t}/${name}')`);
  return me(HELPR, `SELECT public.helpr_task_returned('${t}', '${HELPR}/task/${t}/${name}', ${at.lat}, ${at.lng}) AS r`);
}

// Who may.
const A = await carried(1);
ok(refused(await me(BUYER, `SELECT public.helpr_task_cant_finish('${A.task}', 'cant_finish', '')`), /task_not_found/), "the buyer can't report for the Helpr");
ok(refused(await me(OUTSIDER, `SELECT public.helpr_task_cant_finish('${A.task}', 'cant_finish', '')`), /task_not_found/), "nor a stranger");
ok(refused(await cantFinish(A.task, "made_up"), /invalid_reason/), "a reason it doesn't know is refused");
ok(refused(await me(BUYER, `SELECT public.declutter_delivery_return_finish('${A.task}')`), /permission denied/), "a member can't finish a return");

// 1. Nobody's fault: one retry, then back, then the money.
const rep = await cantFinish(A.task, "wrong_address", "The pin is in a field.");
ok(rep?.[0]?.r?.result === "waiting_fix" && rep?.[0]?.r?.strike === false, `wrong address: the buyer gets to fix it (${short(rep)})`);
ok((await task(A.task)).status === "picked_up" && !(await refund(A.order)) && !(await helprPayout(A.task)), "  no status or money moved");
ok(/within 24 hours/.test(await noteTo(BUYER, "Your Helpr can't get to you") ?? ""), "  the buyer is told");
ok(refused(await cantFinish(A.task, "cant_get_in"), /already_reported/), "  a second report waits");
await svc(`INSERT INTO storage.objects (bucket_id, name) VALUES ('helpr-tasks', '${HELPR}/task/${A.task}/d.jpg')`);
const drop = `SELECT public.helpr_task_delivered('${A.task}', '${HELPR}/task/${A.task}/d.jpg', ${DROP.lat}, ${DROP.lng}, NULL)`;
ok(refused(await me(HELPR, drop), /delivery_on_hold/), "  the drop-off waits for the fix");
ok(refused(await me(SELLER, `SELECT public.helpr_task_buyer_fix('${A.task}', 'x', NULL, NULL, NULL)`), /task_not_found/), "  the seller can't fix it");
ok(refused(await me(BUYER, `SELECT public.helpr_task_buyer_fix('${A.task}', '', NULL, NULL, NULL)`), /note_required/), "  an empty fix is refused");
ok(refused(await me(BUYER, `SELECT public.helpr_task_buyer_fix('${A.task}', '', 'Far away', 32.5, -91.15)`), /fix_too_far/), "  an address over 25 miles away is refused");
const fix = await me(BUYER, `SELECT public.helpr_task_buyer_fix('${A.task}', 'Gate code 1234', '510 Drop Rd', ${DROP.lat + 0.001}, ${DROP.lng}) AS r`);
ok(fix?.[0]?.r?.result === "retrying", `the buyer fixes it (${short(fix)})`);
const tA = await task(A.task);
ok(tA.dropoff_address === "510 Drop Rd" && tA.stuck_fix_note === "Gate code 1234", "  the address and the note are on the task");
const vH = await me(HELPR, `SELECT public.helpr_task_view('${A.task}') AS v`);
ok(vH?.[0]?.v?.stuck_fix_note === "Gate code 1234", `  the Helpr sees it${vH?.[0]?.v ? "" : `: ${short(vH)}`}`);
ok((await me(SELLER, `SELECT public.helpr_task_view('${A.task}') AS v`))?.[0]?.v?.stuck_fix_note == null, "  the seller doesn't");
ok(refused(await me(BUYER, `SELECT public.helpr_task_buyer_fix('${A.task}', 'again', NULL, NULL, NULL)`), /nothing_to_fix/), "  one fix only");
const again = await cantFinish(A.task, "cant_get_in", "Still shut.");
ok(again?.[0]?.r?.result === "returning" && again?.[0]?.r?.strike === false, `the retry fails: back to the seller, no strike (${short(again)})`);
ok(refused(await bringBack(A.task, "far.jpg", DROP), /not_at_pickup/), "  the return photo must be at the pickup address");
ok(refused(await me(BUYER, `SELECT public.helpr_task_customer_confirm('${A.task}')`), /item_going_back/), "  the buyer can't confirm an item going back");
const back = await bringBack(A.task);
ok(back?.[0]?.r?.result === "returned", `the Helpr brings it back (${short(back)})`);
ok(!(await refund(A.order)), "  nothing moves on the Helpr's word");
ok(refused(await me(BUYER, `SELECT public.helpr_task_seller_return_answer('${A.task}', true, '')`), /task_not_found/), "  only the seller answers");
const yes = await me(SELLER, `SELECT public.helpr_task_seller_return_answer('${A.task}', true, '') AS r`);
ok(!yes?.error, `the seller confirms (${short(yes)})`);
const rA = await refund(A.order);
ok(rA?.reason === "admin_no_fault" && rA?.fee_policy === "keep_card_fee" && rA?.paid_cents === A.total - A.delivery && rA?.refund_cents === A.total - A.delivery - rA?.card_fee_cents && rA?.card_fee_cents > 0,
  `  the buyer gets back all but the delivery fee and the card fee (${short(rA)})`);
ok((await order(A.order)).status === "refunded", "  the sale is cancelled");
const pA = await helprPayout(A.task);
ok((await task(A.task)).status === "confirmed" && pA?.amount_cents > 0 && pA?.debt_cents === 0, `  the Helpr is paid for the trip (${short(pA)})`);
ok(one(await svc(`SELECT status FROM public.declutter_items WHERE id = '${I(1)}'`)) === "live", "  the item is back on sale");
ok((await strikes()) === 0, "  no strike");
ok(/card network kept/.test(await noteTo(BUYER, "Your delivery couldn't be finished") ?? ""), "  the buyer is told about the card fee");

// 2. Not fixed in 24 hours; not brought back in 48.
const B = await carried(2);
await cantFinish(B.task, "nobody_there");
await svc(`UPDATE public.helpr_tasks SET stuck_fix_by = now() - interval '1 minute' WHERE id = '${B.task}'`);
await sweep();
ok((await task(B.task)).stuck_stage === "returning", "not fixed in 24 hours: it goes back");
ok(refused(await me(BUYER, `SELECT public.helpr_task_buyer_fix('${B.task}', 'late', NULL, NULL, NULL)`), /nothing_to_fix/), "  too late to fix");
await svc(`UPDATE public.helpr_tasks SET stuck_return_by = now() - interval '1 minute' WHERE id = '${B.task}'`);
await sweep();
const pB = await openProblem(B.order);
ok(pB?.reason === "other" && (await order(B.order)).status === "paid" && !(await refund(B.order)), `not back in 48 hours: Louisiana Helpr decides, money held (${short(pB)})`);
ok((await strikes()) === 0, "  no strike");
await sweep();
ok(one(await svc(`SELECT count(*)::int FROM public.declutter_problems WHERE order_id = '${B.order}'`)) === 1, "  once");

// Admin: fault words and outcomes.
const pay = await me(ADMIN, `SELECT public.declutter_admin_decide_problem('${pB?.id}', 'pay_seller', 'none', false, 'x')`);
ok(refused(pay, /delivery_decision_needed/), `"Pay the seller" is refused (${short(pay)})`);
const hint = (await svc(`SELECT pg_get_functiondef('public.declutter_admin_decide_problem'::regproc) AS d`))?.[0]?.d ?? "";
ok(/IF v_task\.status IN \('picked_up', 'delivered'\) THEN\s+RAISE EXCEPTION 'delivery_decision_needed'[\s\S]*?The Helpr has this item/.test(hint), "  after pickup its words say the Helpr has it, never that it never left the seller");
ok(refused(await me(ADMIN, `SELECT public.declutter_admin_decide_problem('${pB?.id}', 'refund_buyer', 'none', false, 'x')`), /delivery_decision_needed/), "  a plain refund, which would pay the Helpr, is refused");
ok(refused(await me(BUYER, `SELECT public.declutter_admin_decide_stuck_delivery('${pB?.id}', 'none', 'x')`), /not_authorized/), "  a member can't decide");
const dB = await me(ADMIN, `SELECT public.declutter_admin_decide_stuck_delivery('${pB?.id}', 'none', 'Nobody') AS r`);
const rB = await refund(B.order);
ok(!dB?.error && rB?.reason === "admin_no_fault" && (await helprPayout(B.task))?.amount_cents > 0 && (await strikes()) === 0, `  nobody's fault: the same outcome as a return (${short(dB)})`);

// 3. Helpr's fault, full refund.
const C = await carried(3);
const repC = await cantFinish(C.task, "cant_finish", "My truck died.");
ok(repC?.[0]?.r?.result === "returning" && repC?.[0]?.r?.strike === true && (await strikes()) === 1, `Helpr's fault: a strike when they report (${short(repC)})`);
ok(refused(await me(SELLER, `SELECT public.helpr_task_buyer_choose('${C.task}', 'refund', '')`), /task_not_found/), "  only the buyer chooses");
const chC = await me(BUYER, `SELECT public.helpr_task_buyer_choose('${C.task}', 'refund', '') AS r`);
ok(chC?.[0]?.r?.choice === "refund" && !(await refund(C.order)), `  the buyer picks the refund; it waits for the item (${short(chC)})`);
await bringBack(C.task);
await svc(`UPDATE public.helpr_tasks SET return_answer_by = now() - interval '1 minute' WHERE id = '${C.task}'`);
await sweep();
const rC = await refund(C.order);
ok(rC?.reason === "helpr_fault" && rC?.fee_policy === "full_seller_pays_fee" && rC?.refund_cents === C.total && rC?.paid_cents === C.total, `  the seller said nothing for 24 hours: everything back, delivery too (${short(rC)})`);
ok((await task(C.task)).status === "failed" && !(await helprPayout(C.task)), "  the Helpr is not paid");
ok(!(await sellerPayout(C.order)), "  the seller is not paid");
const dC = (await svc(`SELECT d.seller_id::text AS who, d.amount_cents, d.remaining_cents FROM public.declutter_seller_fee_debts d JOIN public.declutter_refunds r ON r.id = d.refund_id WHERE r.order_id = '${C.order}'`))?.[0];
ok(dC?.who === HELPR && dC?.amount_cents === rC?.card_fee_cents && dC?.amount_cents > 0, `  the Helpr owes the card fee, not the seller (${short(dC)})`);
ok(/next Declutter payout/.test(await noteTo(HELPR, "You owe from a refund") ?? ""), "  and is told");
ok(one(await svc(`SELECT count(*)::int FROM public.declutter_seller_fee_debts WHERE seller_id = '${SELLER}'`)) === 0, "  the seller owes nothing");
ok((await strikes()) === 1, "  still one strike");

// The debt comes off the Helpr's next delivery payout.
const D = await carried(4);
// BUY-39 (main 20261031082308): "I got it" only from the drop-off or after 24 h in the Helpr's hands.
await svc(`UPDATE public.helpr_tasks SET picked_up_at = now() - interval '25 hours' WHERE id = '${D.task}'`);
await me(BUYER, `SELECT public.helpr_task_customer_confirm('${D.task}')`);
const pD = await helprPayout(D.task);
const full = one(await svc(`SELECT public.helpr_payout_round_down_cents(t.pay_cents - t.fee_cents) FROM public.helpr_tasks t WHERE t.id = '${D.task}'`));
ok(pD?.debt_cents === dC?.amount_cents && pD?.amount_cents === full - dC?.amount_cents, `the next payout pays it off (${short(pD)}, full ${full})`);
ok(one(await svc(`SELECT remaining_cents FROM public.declutter_seller_fee_debts WHERE seller_id = '${HELPR}'`)) === 0, "  nothing left owing");

// Money review 10-31 (1): a debt bigger than the payout, on a delivery the buyer raised. The raise is sent whole from
// its own charge (helprPayoutParts throws when the order part goes below 0), so the take leaves the order part at $1
// and the rest waits for the next payout. Before the cap the whole payout went to the debt and was never sendable.
const R = await carried(12);
const fullR = one(await svc(`SELECT public.helpr_payout_round_down_cents(t.pay_cents - t.fee_cents) FROM public.helpr_tasks t WHERE t.id = '${R.task}'`));
const raisedR = fullR - 300;
await svc(`UPDATE public.helpr_tasks SET raised_cents = ${raisedR}, picked_up_at = now() - interval '25 hours' WHERE id = '${R.task}'`);
await svc(`INSERT INTO public.declutter_seller_fee_debts (seller_id, refund_id, amount_cents, remaining_cents)
  SELECT '${HELPR}', r.id, 5000, 5000 FROM public.declutter_refunds r WHERE r.order_id = '${A.order}'`);
await me(BUYER, `SELECT public.helpr_task_customer_confirm('${R.task}')`);
const pR = await helprPayout(R.task);
ok(pR?.debt_cents === 200 && pR?.amount_cents === fullR - 200 && pR.amount_cents - raisedR === 100 && pR?.status === "pending",
  `a debt bigger than a raised payout: the take stops at $1 of order part (${short(pR)}, full ${fullR}, raised ${raisedR})`);
ok(one(await svc(`SELECT remaining_cents FROM public.declutter_seller_fee_debts WHERE seller_id = '${HELPR}' AND remaining_cents > 0`)) === 4800, "  the rest waits for the next payout");
await svc(`UPDATE public.declutter_seller_fee_debts SET remaining_cents = 0 WHERE seller_id = '${HELPR}'`);

// 4. Helpr's fault, re-post; a buyer who hasn't chosen.
const E = await carried(5);
await cantFinish(E.task, "cant_finish");
await bringBack(E.task);
await me(SELLER, `SELECT public.helpr_task_seller_return_answer('${E.task}', true, '')`);
ok((await task(E.task)).stuck_stage === "awaiting_choice" && !(await refund(E.order)), "nothing chosen when it's back: the buyer gets 48 hours");
ok(refused(await me(BUYER, `SELECT public.helpr_task_buyer_choose('${E.task}', 'collect', 'Here')`), /too_late_to_collect/), "  it's too late to collect from the Helpr");
const chE = await me(BUYER, `SELECT public.helpr_task_buyer_choose('${E.task}', 'repost', '') AS r`);
const tE = await task(E.task);
ok(chE?.[0]?.r?.result === "reposted" && tE.status === "open" && tE.helpr_id === null && tE.picked_up_at === null && tE.stuck_stage === null, `re-post: the delivery reopens from the seller (${short(chE)})`);
ok((await order(E.order)).status === "paid" && !(await refund(E.order)) && !(await helprPayout(E.task)), "  no money moved");

const F = await carried(6);
await cantFinish(F.task, "cant_finish");
await bringBack(F.task);
await me(SELLER, `SELECT public.helpr_task_seller_return_answer('${F.task}', true, '')`);
await svc(`UPDATE public.helpr_tasks SET stuck_choice_by = now() - interval '1 minute' WHERE id = '${F.task}'`);
await sweep();
ok(!!(await openProblem(F.order)) && !(await refund(F.order)), "no choice in 48 hours: Louisiana Helpr decides, no automatic refund");
const before = await strikes();
const dF = await me(ADMIN, `SELECT public.declutter_admin_decide_stuck_delivery('${(await openProblem(F.order))?.id}', 'helpr', 'Helpr') AS r`);
const rF = await refund(F.order);
ok(!dF?.error && rF?.reason === "helpr_fault" && (await task(F.task)).status === "failed" && (await strikes()) === before, `  Helpr's fault decided: the same outcome, no second strike (${short(dF)})`);

// 5. The buyer collects: the sale goes ahead.
const G = await carried(7);
await cantFinish(G.task, "cant_finish");
ok(refused(await me(BUYER, `SELECT public.helpr_task_buyer_choose('${G.task}', 'collect', '')`), /note_required/), "collect needs a where and when");
await me(BUYER, `SELECT public.helpr_task_buyer_choose('${G.task}', 'collect', 'Mall lot at noon')`);
ok((await me(HELPR, `SELECT public.helpr_task_view('${G.task}') AS v`))?.[0]?.v?.stuck_collect_note === "Mall lot at noon", "  the Helpr sees it");
ok((await me(SELLER, `SELECT public.helpr_task_view('${G.task}') AS v`))?.[0]?.v?.stuck_collect_note == null, "  the seller doesn't");
const gotG = await me(BUYER, `SELECT public.helpr_task_customer_confirm('${G.task}') AS r`);
ok(!gotG?.error && (await order(G.order)).status === "handed_over", `"I got it": the sale goes ahead (${short(gotG)})`);
ok((await task(G.task)).status === "failed" && !(await helprPayout(G.task)), "  the Helpr is not paid");
ok((await sellerPayout(G.order))?.amount_cents === 4000, "  the seller is paid the item price");
ok(one(await svc(`SELECT refund_cents FROM public.declutter_delivery_refunds WHERE order_id = '${G.order}'`)) === G.delivery, "  the delivery fee goes back");

// 6. A disagreement, and a report of damage: Louisiana Helpr, money held.
const H = await carried(8);
await cantFinish(H.task, "wrong_address");
const dis = await me(BUYER, `SELECT public.declutter_report_problem('${H.order}', 'other', 'The address was right.', '{}') AS id`);
ok(typeof dis?.[0]?.id === "string", `the buyer disagrees (${short(dis)})`);
await svc(`UPDATE public.helpr_tasks SET stuck_fix_by = now() - interval '1 minute' WHERE id = '${H.task}'`);
await sweep();
ok((await task(H.task)).stuck_stage === "waiting_fix" && !(await refund(H.order)), "  the clocks wait for the decision");
const I2 = await carried(9);
const strikesI = await strikes();
ok(refused(await cantFinish(I2.task, "damaged"), /note_required/), "damage needs words");
const dmg = await cantFinish(I2.task, "damaged", "It fell over.");
const pI = await openProblem(I2.order);
ok(dmg?.[0]?.r?.result === "with_admin" && pI?.reporter_side === "helpr" && pI?.reason === "damaged", `damage goes to Louisiana Helpr (${short(dmg)})`);
ok(!(await refund(I2.order)) && (await strikes()) === strikesI, "  no money and no strike until it decides");
const adminNotes = async () => one(await svc(`SELECT count(*)::int FROM public.notifications WHERE user_id = '${ADMIN}' AND title = 'Declutter problem reported'`));
ok((await adminNotes()) > 0, "  a real report reaches the admin");
await run(`CREATE OR REPLACE FUNCTION public.is_test_subject(p uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT p = '${HELPR}'::uuid $$;`);
const adminBefore = await adminNotes();
const T1 = await carried(21);
await cantFinish(T1.task, "damaged", "Test Helpr.");
ok((await openProblem(T1.order))?.reason === "damaged" && (await adminNotes()) === adminBefore, "  a test Helpr's report opens the problem, and no admin hears of it");
await run(`CREATE OR REPLACE FUNCTION public.is_test_subject(p uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;`);
ok(refused(await me(HELPR, `SELECT public.helpr_task_cant_finish('${I2.task}', 'cant_finish', '')`), /problem_open/), "  and the Helpr can't report again meanwhile");

// 7. The seller says it didn't come back.
const J = await carried(10);
await cantFinish(J.task, "cant_finish");
await bringBack(J.task);
ok(refused(await me(SELLER, `SELECT public.helpr_task_seller_return_answer('${J.task}', false, '')`), /note_required/), "the seller says what happened");
const noJ = await me(SELLER, `SELECT public.helpr_task_seller_return_answer('${J.task}', false, 'Nothing here.') AS r`);
ok(noJ?.[0]?.r?.result === "with_admin" && (await openProblem(J.order))?.reporter_side === "seller", `it didn't come back: Louisiana Helpr (${short(noJ)})`);
await svc(`UPDATE public.helpr_tasks SET return_answer_by = now() - interval '1 minute' WHERE id = '${J.task}'`);
await sweep();
ok(!(await refund(J.order)), "  money held past the 24 hours");

// 8. BUY-37's nudge leaves a reported delivery alone.
const K = await carried(11);
await cantFinish(K.task, "nobody_there");
await svc(`UPDATE public.helpr_tasks SET picked_up_at = now() - interval '30 hours' WHERE id = '${K.task}'`);
await sweep();
ok((await task(K.task)).in_hand_nudged_at === null, "a delivery already reported isn't nudged");
ok(one(await svc(`SELECT count(*)::int FROM public.cron_defects_seen WHERE fn = 'helpr_task_sweep'`)) === 0, "no sweep step failed");

// 9. BUY-44 (the seller hears it was delivered) is no longer in this file's migration: main's 20261031140431 and
// 20261031170803 carry it, with their own proofs. (These two checks also read item 1, which this flow brings back.)

// 10. The delivery chat: the three of them, nobody else, and it ends with the delivery.
const L = await carried(30);
const say = (who, words) => me(who, `SELECT public.helpr_task_send_message('${L.task}', '${words}') AS id`);
const view = async (who) => (await me(who, `SELECT public.helpr_task_talk_view('${L.task}') AS r`))?.[0]?.r;
ok(!(await say(HELPR, "I am at the gate."))?.error, "the Helpr can send");
ok(!(await say(BUYER, "Coming down."))?.error && !(await say(SELLER, "Thanks."))?.error, "  the buyer and the seller can too");
const vB = await view(BUYER);
ok(vB?.side === "buyer" && vB?.open === true && vB?.messages?.length === 3 && vB.messages[0].side === "helpr" && vB.messages[0].mine === false && vB.messages[1].mine === true,
  `  each reads all three, as sides (${short(vB)})`);
ok(vB != null && !JSON.stringify(vB).includes(HELPR) && !JSON.stringify(vB).includes(SELLER), "  no one's id in what they read");
ok(refused(await say(OUTSIDER, "hello"), /task_not_found/), "a stranger can't send");
ok(refused(await me(OUTSIDER, `SELECT public.helpr_task_talk_view('${L.task}')`), /task_not_found/), "  or read");
ok(refused(await say(BUYER, "call me at 225-555-0123"), /contact|phone|Keep contact/i), "the contact filter runs");
ok(refused(await me(BUYER, `SELECT * FROM public.helpr_task_talk_messages`), /permission denied/), "the table can't be read directly");
const told = async (uid) => one(await svc(`SELECT count(*)::int FROM public.notifications WHERE user_id = '${uid}' AND title = 'New message about a delivery'`));
const toldBuyer = await told(BUYER);
ok(toldBuyer >= 1 && (await told(SELLER)) >= 1 && (await told(HELPR)) >= 1, "each is told");
await say(HELPR, "Second message.");
ok((await told(BUYER)) === toldBuyer, "  a second message within 15 minutes tells nobody again");
const noWords = one(await svc(`SELECT count(*)::int FROM public.notifications WHERE title = 'New message about a delivery' AND message LIKE '%gate%'`));
ok(noWords === 0, "  the notice never carries the words");
await svc(`INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES ('${SELLER}', '${HELPR}')`);
ok(refused(await say(HELPR, "Blocked?"), /talk_blocked/), "a blocked pair can't reach each other here");
await svc(`DELETE FROM public.user_blocks WHERE blocker_id = '${SELLER}' AND blocked_id = '${HELPR}'`);
// B36: the row's own CHECK (helpr_tasks_confirmed) wants confirmed_at and confirmed_by with the status; without them
// this UPDATE was refused silently and the chat stayed open.
const endL = await svc(`UPDATE public.helpr_tasks SET status = 'confirmed', confirmed_at = now(), confirmed_by = 'customer' WHERE id = '${L.task}' RETURNING status`);
ok(endL?.[0]?.status === "confirmed", `  (the delivery is confirmed: ${short(endL)})`);
ok(refused(await say(HELPR, "After."), /talk_closed/), "it ends with the delivery");
ok((await view(BUYER))?.open === false && (await view(BUYER))?.messages?.length === 4, "  the history stays");
// export_my_data reads most of the schema, which this world lacks, so its chat line is run on its own: the exact
// line, read from the newest migration that defines export_my_data (it applied above, so the function parses).
const talkSql = readFileSync(process.env.TALK_PATH ?? `${MIG_DIR}${TALK_FILE}`, "utf8");
const expLine = /jsonb_build_object\('helpr_task_talk_messages', (\(SELECT [^\n]*?WHERE t\.sender_id = v_uid\))\);/.exec(talkSql)?.[1];
const exp = expLine ? await svc(`SELECT ${expLine.replace(/v_uid/g, `'${HELPR}'::uuid`)} AS d`) : null;
ok(Array.isArray(exp?.[0]?.d) && exp[0].d.length === 2, `the Helpr's export carries what they wrote (${short(exp?.[0]?.d ?? exp)})`);

// Money review 10-31 (2): a re-post keeps the task id. The new Helpr reads only their own run of the chat, never what
// the buyer and the seller said to the Helpr before, and is told of the buyer's first message to them.
const M = await carried(31);
const sayM = (who, words) => me(who, `SELECT public.helpr_task_send_message('${M.task}', '${words}') AS id`);
const viewM = async (who) => (await me(who, `SELECT public.helpr_task_talk_view('${M.task}') AS r`))?.[0]?.r;
await sayM(BUYER, "Old run: the side door is open.");
await sayM(HELPR, "Old run: on my way.");
await cantFinish(M.task, "cant_finish");
await bringBack(M.task);
await me(SELLER, `SELECT public.helpr_task_seller_return_answer('${M.task}', true, '')`);
const reM = await me(BUYER, `SELECT public.helpr_task_buyer_choose('${M.task}', 'repost', '') AS r`);
ok(reM?.[0]?.r?.result === "reposted", `  (re-posted: ${short(reM)})`);
const NEW_HELPR = OUTSIDER;
const accM = await svc(`UPDATE public.helpr_tasks SET status = 'accepted', helpr_id = '${NEW_HELPR}', accepted_at = now(), pickup_slot_start = now() + interval '1 hour' WHERE id = '${M.task}' RETURNING status`);
ok(accM?.[0]?.status === "accepted", `  (a new Helpr takes it: ${short(accM)})`);
const vNew = await viewM(NEW_HELPR);
ok(vNew?.side === "helpr" && vNew?.open === true && Array.isArray(vNew?.messages) && vNew.messages.length === 0,
  `the new Helpr reads none of the old run's chat (${short(vNew ?? await me(NEW_HELPR, `SELECT public.helpr_task_talk_view('${M.task}') AS r`))})`);
ok(refused(await me(HELPR, `SELECT public.helpr_task_talk_view('${M.task}')`), /task_not_found/), "  the old Helpr is no longer in it");
const toldNew = await told(NEW_HELPR);
ok(!(await sayM(BUYER, "New run: hello."))?.error && (await told(NEW_HELPR)) === toldNew + 1, "  the buyer's first message to the new Helpr tells them");
const vNew2 = await viewM(NEW_HELPR);
ok(vNew2?.messages?.length === 1 && vNew2.messages[0].body === "New run: hello.", `  and it is the only one they read (${short(vNew2)})`);
// The column CHECK allows only 'declutter_delivery' today; the chat checks it too, for the next kind of task. The CHECK
// is lifted for this one case so the check is really exercised, then put back.
const kindOff = await run(`ALTER TABLE public.helpr_tasks DROP CONSTRAINT IF EXISTS helpr_tasks_source_kind_check;
  UPDATE public.helpr_tasks SET source_kind = 'haul_away' WHERE id = '${M.task}';`);
ok(!kindOff?.error, `  (a task of another kind: ${short(kindOff)})`);
ok(refused(await me(BUYER, `SELECT public.helpr_task_talk_view('${M.task}')`), /task_not_found/), "the chat is for Declutter deliveries only: no read");
ok(refused(await sayM(BUYER, "Other kind."), /task_not_found/), "  and no send");
await run(`UPDATE public.helpr_tasks SET source_kind = 'declutter_delivery' WHERE id = '${M.task}';
  ALTER TABLE public.helpr_tasks ADD CONSTRAINT helpr_tasks_source_kind_check CHECK (source_kind IN ('declutter_delivery'));`);

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
