#!/usr/bin/env node
/**
 * PGlite proof for 20261102031000_declutter_seller_delivery_book_by (A3-72; lead 11-01 5:34 PM and 9:05 PM): a
 * seller-delivered order whose delivery lost its time (needs_time) gets book_by = paid + 7 days, reminders to BOTH
 * sides 24 h and 2 h before it, and at the mark the handover sweep closes it and refunds the full payment (item,
 * delivery, buyer fee, tax), the platform absorbing the card fee, with no strike and no seller debt.
 *
 *   node src/test/pglite/declutterSellerDeliveryBookBy.pglite.mjs                    # GREEN (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterSellerDeliveryBookBy.pglite.mjs # RED: the chain without it
 *   MIGRATION_PATH=<planted copy> node ...                                           # RED on a planted defect
 *
 * World: scripts/declutter/handoverPhotoWorld.mjs, the bases declutterAdminHelprFault.pglite.mjs uses (the newest
 * declutter_close_paid_order and declutter_record_refund), and the bases declutterBookBy.pglite.mjs uses up to B117's
 * 20261101230519, all applied in file order. Stubs as in declutterAdminHelprFault (said there). The anon check emulates
 * Supabase's default grant (EXECUTE to anon on every new function) before reading the privileges.
 * An order becomes seller-delivered by a direct update while it awaits payment (the seller-delivery checkout has its
 * own proof); its held slot is already past, so the payment trigger turns it to needs_time, as on prod.
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261102031000_declutter_seller_delivery_book_by.sql";
const HELPR_FAULT_BASES = [
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
  // B48 (rebuild on main after #3915): main's FINAL 20261031231150 takes B49's setup_fee_cents off the payout, so the
  // setup-fee files it was rebased on come first, as in helprDeliveryCantFinish.pglite.mjs; 232943 follows it there too.
  "20261031214749_seller_setup_fee_from_payout_restated.sql",
  "20261031220617_helpr_setup_fee_from_payout_restated.sql",
  "20261031225132_setup_fee_never_after_a_send.sql",
];
HELPR_FAULT_BASES.push(
  "20261031231150_helpr_delivery_cant_finish.sql",
  "20261031231948_helpr_delivery_talk.sql",
  "20261031232943_setup_fee_admin_check_reads_roles.sql",
);
const BOOK_BY_BASES = [
  "20261028195840_declutter_pickup_window_reads.sql",
  "20261028225038_declutter_porch_pick_a_day.sql",
  "20261031145652_declutter_place_hours.sql",
  "20261031164337_declutter_door_pickup_uses_places.sql",
  "20261031163021_declutter_porch_next_step_is_a_time.sql",
  "20261031171727_declutter_porch_days_without_places.sql",
  "20261101000817_declutter_admin_helpr_fault.sql",
  "20261101020052_helpr_task_released_helpr.sql",
  "20261101030040_declutter_buy_now_30_minutes.sql",
  "20261101032626_declutter_checkout_page_inside_hold.sql",
  "20261101191500_declutter_checkout_pickup_time.sql",
  "20261101230519_declutter_book_by.sql",
  // The handover sweep's world (declutterNoticesNameTheItemSweepRemindTask.pglite.mjs): the both-confirm columns it reads.
  "20261029225634_declutter_problem_both_sides_and_photos.sql",
  "20261030004216_declutter_order_talk.sql",
  "20261030134109_declutter_take_back_problem_report.sql",
  "20261031004529_declutter_handover_both_confirm.sql",
];
const BASES = [...new Set([...HELPR_FAULT_BASES, ...BOOK_BY_BASES])].sort();
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");
const { svc, run, one, me, liveItemSql, USERS } = await buildHandoverWorld();
const { SELLER2, BUYER2 } = USERS;
const SELLER = SELLER2;
const BUYER = BUYER2;

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const short = (r) => JSON.stringify(r)?.slice(0, 300);

// B48: what B49's fee migrations read and the world does not build, stubbed exactly as helprDeliveryCantFinish.pglite.mjs
// does (and said so): identity_check_exempt reads a proof-only switch row; the send-tried columns 20261031225132 reads.
const stub6 = await run(`CREATE TABLE public.proof_identity_check (on_for_all boolean NOT NULL);
  INSERT INTO public.proof_identity_check VALUES (false);
  CREATE OR REPLACE FUNCTION public.identity_check_exempt(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS
    $$ SELECT NOT (SELECT on_for_all FROM public.proof_identity_check) $$;
  ALTER TABLE public.declutter_payouts ADD COLUMN IF NOT EXISTS review_held_at timestamptz;
  ALTER TABLE public.helpr_task_payouts ADD COLUMN IF NOT EXISTS review_held_at timestamptz;`);
ok(!stub6?.error, `stubs for B49's fee migrations${stub6?.error ? `: ${stub6.error}` : ""}`);
await svc(`ALTER TABLE public.declutter_items ADD COLUMN IF NOT EXISTS seller_hidden boolean NOT NULL DEFAULT false`);
for (const f of BASES) {
  const r = await run(readFileSync(`${MIG_DIR}${f}`, "utf8"));
  ok(!r?.error, `base ${f} applies${r?.error ? `: ${r.error}` : ""}`);
}
await run(`CREATE OR REPLACE FUNCTION public.is_test_subject(p uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
  CREATE TABLE IF NOT EXISTS public.test_accounts (user_id uuid PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS public.notification_preferences (user_id uuid PRIMARY KEY);
  ALTER TABLE public.notification_preferences ADD COLUMN IF NOT EXISTS declutter_pickups boolean;`);
if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}

const I = (n) => `abababab-0000-0000-0000-${String(n).padStart(12, "0")}`;
await run(`INSERT INTO public.declutter_pickup_windows (seller_id, weekday, starts_local, ends_local)
  SELECT '${SELLER}', d, '00:00', '23:59' FROM generate_series(0, 6) d ON CONFLICT DO NOTHING`);
const RATE = 800;
/** A paid seller-delivered order whose time went to someone else (needs_time), or a booked one when `booked`. */
async function sdOrder(n, booked = false) {
  await run(liveItemSql({ id: I(n), seller: SELLER, title: `Lamp ${n}`, price: 3000, floor: 100 }));
  await me(BUYER, `SELECT public.declutter_buy_now('${I(n)}', 3000)`);
  const o = (await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${SELLER}', 'pickup_home')`))?.[0];
  if (!o?.order_id) throw new Error(`no order for ${n}: ${short(o)}`);
  // The amounts are frozen once checkout starts (order_amounts_frozen): the setup update skips the triggers, said so.
  const up = await run(`SET session_replication_role = replica;
    UPDATE public.declutter_orders SET handover = 'seller_delivery', fee_rule = 'f1_seller_delivery', delivery_cents = ${RATE},
      premium_cents = round((items_cents + ${RATE}) * 0.05)::integer + 70,
      total_cents = items_cents + round((items_cents + ${RATE}) * 0.05)::integer + 70 + tax_cents + ${RATE}
    WHERE id = '${o.order_id}';
    SET session_replication_role = DEFAULT;
    INSERT INTO public.declutter_seller_deliveries (order_id, buyer_id, seller_id, status, slot_start, slot_end, held_until,
      dropoff_address, dropoff_area, dropoff_lat, dropoff_lng)
    VALUES ('${o.order_id}', '${BUYER}', '${SELLER}', 'held',
      now() ${booked ? "+ interval '3 days'" : "- interval '1 hour'"}, now() ${booked ? "+ interval '3 days 1 hour'" : ""},
      now() + interval '30 minutes', '12 Oak Street, Lafayette', 'Lafayette', 30.2, -92.0)`);
  if (up?.error) throw new Error(`make seller delivery ${n}: ${up.error}`);
  const total = one(await svc(`SELECT total_cents FROM public.declutter_orders WHERE id = '${o.order_id}'`));
  const paid = await svc(`SELECT public.declutter_mark_order_paid('${o.order_id}', 'pi_sdbb_${n}', ${total}, now(), 150)`);
  if (paid?.error) throw new Error(`mark paid ${n}: ${paid.error}`);
  return { order: o.order_id, total };
}
const order = async (id) => (await svc(`SELECT * FROM public.declutter_orders WHERE id = '${id}'`))?.[0];
const dstatus = async (id) => one(await svc(`SELECT status FROM public.declutter_seller_deliveries WHERE order_id = '${id}'`));
const refund = async (id) => (await svc(`SELECT reason, fee_policy, paid_cents, refund_cents, kept_cents FROM public.declutter_refunds WHERE order_id = '${id}'`))?.[0];
const notes = async (uid, like) => (await svc(`SELECT title, message, link FROM public.notifications WHERE user_id = '${uid}' AND (title ILIKE '${like}' OR message ILIKE '${like}') ORDER BY created_at, id`)) ?? [];
const strikes = async (uid) => one(await svc(`SELECT count(*)::int FROM public.declutter_strikes WHERE user_id = '${uid}'`));
const debts = async () => one(await svc(`SELECT count(*)::int FROM public.declutter_seller_fee_debts WHERE seller_id = '${SELLER}'`));
const sweep = async () => { const x = await svc(`SELECT public.declutter_handover_sweep() AS r`); if (!Array.isArray(x)) console.log("sweep:", short(x)); return x?.[0]?.r ?? {}; };

// 1. book_by on payment.
const A = await sdOrder(1);
const oA = await order(A.order);
ok((await dstatus(A.order)) === "needs_time", `setup: the payment landed after the slot went, so the delivery needs a time (${await dstatus(A.order)})`);
ok(oA.book_by && Math.abs(Date.parse(oA.book_by) - Date.parse(oA.paid_at) - 7 * 864e5) < 2000,
  `book_by = paid + 7 days on a seller-delivered order (${oA.book_by} vs paid ${oA.paid_at})`);
const nextStep = one(await svc(`SELECT public.declutter_paid_next_step('${A.order}')`));
ok(/^Next: pick a new delivery time in Buying, by \w{3} \d+\/\d+, \d+:\d\d [AP]M\.$/.test(nextStep ?? ""), `the next step says by when (${nextStep})`);

// 2. Reminders, both sides, 24 h and 2 h before; never in quiet hours; never for a booked delivery.
const NOON = "2026-11-03T18:00:00Z"; // noon in Louisiana
const remind = async (at) => one(await svc(`SELECT public.declutter_book_by_reminder_sweep('${at}'::timestamptz)`));
await svc(`UPDATE public.declutter_orders SET book_by = '${NOON}'::timestamptz + interval '20 hours', book_by_reminded_24_at = NULL, book_by_reminded_2_at = NULL WHERE id = '${A.order}'`);
const B = await sdOrder(2, true);
ok((await dstatus(B.order)) === "booked", `setup: a second order with its time booked (${await dstatus(B.order)})`);
await svc(`UPDATE public.declutter_orders SET book_by = '${NOON}'::timestamptz + interval '20 hours' WHERE id = '${B.order}'`);
ok((await remind("2026-11-03T04:00:00Z")) === 0, "quiet hours (10 PM): nothing is sent");
const sent24 = await remind(NOON);
const b24 = await notes(BUYER, "Pick a delivery time by%");
const s24 = await notes(SELLER, "The buyer hasn''t picked a delivery time");
ok(sent24 === 1, `one order is reminded at 24 h (the booked one is not) (${sent24})`);
ok(b24.length === 1 && /Lamp 1/.test(b24[0].message) && /your full payment is refunded/.test(b24[0].message) && b24[0].link.includes("tab=buying"),
  `the buyer is told: by when, or a full refund (${short(b24)})`);
ok(s24.length === 1 && /Lamp 1/.test(s24[0].message) && /their full payment is refunded/.test(s24[0].message) && s24[0].link.includes("tab=selling"),
  `the seller is told too (${short(s24)})`);
ok((await remind(NOON)) === 0, "the 24-hour reminder goes once");
const LATE = "2026-11-04T12:30:00Z"; // 6:30 AM Louisiana... quiet; use 1h30 before book_by instead
const at2 = new Date(Date.parse(NOON) + 18.5 * 3600e3).toISOString(); // 6:30 AM next day: quiet hours
ok((await remind(at2)) === 0, `the 2-hour edge in quiet hours sends nothing (${at2})`);
await svc(`UPDATE public.declutter_orders SET book_by = '${NOON}'::timestamptz + interval '1 hour 30 minutes' WHERE id = '${A.order}'`);
ok((await remind(NOON)) === 1, "the 2-hour reminder goes");
ok((await notes(BUYER, "Pick a delivery time: 2 hours left")).length === 1 && (await notes(SELLER, "No delivery time yet: 2 hours left")).length === 1,
  "  to both sides");
void LATE;

// 3. The sweep at book_by: a full refund, no strike, no debt, the item back on sale.
await svc(`UPDATE public.declutter_orders SET book_by = now() + interval '1 hour' WHERE id = '${A.order}'`);
const sw0 = await sweep();
ok((await order(A.order)).status === "paid", `before book_by nothing closes (${short(sw0)})`);
await svc(`UPDATE public.declutter_orders SET book_by = now() - interval '1 minute' WHERE id = '${B.order}'`);
const strikesBefore = [await strikes(BUYER), await strikes(SELLER)];
await svc(`UPDATE public.declutter_orders SET book_by = now() - interval '1 minute' WHERE id = '${A.order}'`);
const sw = await sweep();
const rA = await refund(A.order);
ok((await order(A.order)).status === "refunded" && Number(sw.delivery_never_booked) === 1, `at book_by the sweep closes it (${short(sw)})`);
ok(rA?.reason === "delivery_never_booked" && rA?.fee_policy === "full_platform_absorbs" && rA?.paid_cents === A.total && rA?.refund_cents === A.total && rA?.kept_cents === 0,
  `  the full payment is refunded, item + delivery + fee + tax (${short(rA)}, total ${A.total})`);
ok(A.total > 3000 + RATE, `  (the total carries the delivery and the fee: ${A.total})`);
ok((await strikes(BUYER)) === strikesBefore[0] && (await strikes(SELLER)) === strikesBefore[1], "  no strike for either side");
ok((await debts()) === 0, "  the seller owes nothing (the platform absorbs the card fee)");
ok((await dstatus(A.order)) === "cancelled", "  the delivery row is cancelled (by the order trigger on the refund)");
ok(one(await svc(`SELECT status FROM public.declutter_items WHERE id = '${I(1)}'`)) === "live", "  the item is back on sale");
const bn = await notes(BUYER, "No delivery time was picked within 7 days%");
const sn = await notes(SELLER, "No delivery time was picked within 7 days%");
ok(bn.length === 1 && bn[0].message.includes(`All $${(A.total / 100).toFixed(2)} is coming back to your card.`), `  the buyer is told all of it comes back (${short(bn)})`);
ok(sn.length === 1 && /Your item is back on sale\./.test(sn[0].message), `  the seller is told why (${short(sn)})`);
ok((await order(B.order)).status === "paid" && !(await refund(B.order)), "a booked delivery past book_by is never closed by this");
const again = await sweep();
ok(!Number(again.delivery_never_booked), "a second run closes nothing more");

// 4. An open problem holds it.
const C = await sdOrder(3);
await svc(`INSERT INTO public.declutter_problems (order_id, reporter_id, reporter_side, reason, note, photo_paths)
  VALUES ('${C.order}', '${BUYER}', 'buyer', 'other', 'x', '{}')`);
await svc(`UPDATE public.declutter_orders SET book_by = now() - interval '1 minute' WHERE id = '${C.order}'`);
await sweep();
ok((await order(C.order)).status === "paid", "an open problem holds the close");

// 5. Pickups unchanged: a pickup reminder still goes to the buyer only, with the item-price words.
const P = (await (async () => {
  await run(liveItemSql({ id: I(9), seller: SELLER, title: "Chair 9", price: 2000, floor: 100 }));
  await me(BUYER, `SELECT public.declutter_buy_now('${I(9)}', 2000)`);
  const o = (await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${SELLER}', 'pickup_home')`))?.[0];
  await svc(`SELECT public.declutter_mark_order_paid('${o.order_id}', 'pi_sdbb_9', ${o.total_cents}, now(), 150)`);
  return o.order_id;
})());
await svc(`UPDATE public.declutter_orders SET book_by = '${NOON}'::timestamptz + interval '20 hours' WHERE id = '${P}'`);
const DAY2 = new Date(Date.parse(NOON) + 3600e3).toISOString();
await svc(`UPDATE public.declutter_orders SET book_by = '${DAY2}'::timestamptz + interval '20 hours' WHERE id = '${P}'`);
ok((await remind(DAY2)) === 1, "a pickup order is still reminded");
const pk = await notes(BUYER, "Pick a pickup time by%");
ok(pk.length === 1 && /item price refunded/.test(pk[0].message), `  with its own words (${short(pk)})`);
ok((await notes(SELLER, "%Chair 9%")).filter((x) => /pick/i.test(x.title)).length === 0, "  and the seller gets no pickup reminder");

// 6. Grants: service_role only, with Supabase's default anon grant emulated first.
const g = await run(`GRANT EXECUTE ON FUNCTION public.declutter_handover_sweep() TO anon;
  GRANT EXECUTE ON FUNCTION public.declutter_book_by_reminder_sweep(timestamptz) TO anon;`);
ok(!g?.error && one(await svc(`SELECT has_function_privilege('anon', 'public.declutter_handover_sweep()', 'EXECUTE')`)) === true,
  `setup: anon holds the default grant before the re-apply${g?.error ? `: ${g.error}` : ""}`);
if (!skip) {
  const r = await run(readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8"));
  ok(!r?.error, `the migration re-applies over the default grant${r?.error ? `: ${r.error}` : ""}`);
}
const acl = one(await svc(`SELECT NOT has_function_privilege('anon', 'public.declutter_handover_sweep()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.declutter_handover_sweep()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.declutter_book_by_reminder_sweep(timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.declutter_close_paid_order(uuid, text, text, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.declutter_close_paid_order(uuid, text, text, text, text)', 'EXECUTE')`));
ok(acl === true, "the sweeps and the close stay service_role only (anon and members refused)");

console.log(`\n${fail ? "FAILED" : "ALL OK"}  ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
