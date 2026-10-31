#!/usr/bin/env node
/**
 * PGlite proof for 20261031004529_declutter_handover_both_confirm (owner 10-30, buying audit finding 24): no refund or
 * pay on one side's word alone. A buyer's no-show report gives the seller 24 hours; the seller's "Picked up" waits for
 * the buyer; silence holds the money, with nudges, a closed address at 7 days, and admin at 60 days.
 *
 *   node src/test/pglite/declutterHandoverBothConfirm.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterHandoverBothConfirm.pglite.mjs # RED: the chain without it
 *   MIGRATION_PATH=<planted copy> node ...                                          # RED on a planted defect
 *
 * World: scripts/declutter/handoverPhotoWorld.mjs, then the newest definitions this migration restates or reads, once
 * each; this migration 3x.
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261031004529_declutter_handover_both_confirm.sql";
const BASES = [
  "20261027211754_declutter_bundle_discount.sql",
  "20261028200440_declutter_audit3_notices_and_empty_cart.sql",
  "20261028235247_declutter_handover_choices.sql",
  "20261028235709_declutter_handover_photos_at_the_address.sql",
  "20261029002010_declutter_handover_photos_live_only.sql",
  "20261029161347_declutter_porch_weekdays.sql",
  "20261029201542_declutter_porch_photo_not_before_the_day.sql",
  "20261029225634_declutter_problem_both_sides_and_photos.sql",
  "20261030004216_declutter_order_talk.sql",
  "20261030134109_declutter_take_back_problem_report.sql",
  "20261030164712_declutter_porch_places.sql",
];
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");
const { svc, run, one, me, refused, liveItemSql, USERS } = await buildHandoverWorld();
const { SELLER2, BUYER, BUYER2, OUTSIDER } = USERS;

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const short = (r) => JSON.stringify(r)?.slice(0, 220);

for (const f of BASES) {
  const r = await run(readFileSync(`${MIG_DIR}${f}`, "utf8"));
  ok(!r?.error, `base ${f} applies${r?.error ? `: ${r.error}` : ""}`);
}
// Prod has these; the world does not need them for anything else. The items-named helper is a stub: its words are not what is proved.
await run(`CREATE TABLE IF NOT EXISTS public.test_accounts (user_id uuid PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS public.notification_preferences (user_id uuid PRIMARY KEY);
  ALTER TABLE public.notification_preferences ADD COLUMN IF NOT EXISTS declutter_pickups boolean;
  CREATE OR REPLACE FUNCTION public.declutter_order_items_named(p_order_id uuid) RETURNS text LANGUAGE sql AS $$ SELECT 'the items'::text $$;
  CREATE SCHEMA IF NOT EXISTS net; CREATE SCHEMA IF NOT EXISTS vault;
  CREATE TABLE IF NOT EXISTS vault.decrypted_secrets (name text, decrypted_secret text);
  CREATE TABLE IF NOT EXISTS public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text NOT NULL DEFAULT 'error',
    message text NOT NULL, tags jsonb NOT NULL DEFAULT '{}', context jsonb NOT NULL DEFAULT '{}');
  CREATE OR REPLACE FUNCTION net.http_post(url text, headers jsonb DEFAULT '{}', body jsonb DEFAULT '{}', timeout_milliseconds integer DEFAULT 5000)
    RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;`);
const remindersBase = await run(readFileSync(`${MIG_DIR}20261027205028_declutter_pickup_reminders.sql`, "utf8"));
ok(!remindersBase?.error, `base pickup reminders applies${remindersBase?.error ? `: ${remindersBase.error}` : ""}`);
// Stubbed, and said so: who counts as test data has its own proof (adminAlertsSkipTestAccounts); nobody here does.
await run(`CREATE OR REPLACE FUNCTION public.is_test_subject(p uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;`);
if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}

const I = (n) => `dddddddd-0000-0000-0000-${String(n).padStart(12, "0")}`;
await svc(`INSERT INTO public.declutter_pickup_windows (seller_id, weekday, starts_local, ends_local)
  SELECT '${SELLER2}', d, '00:00', '23:59' FROM generate_series(0, 6) d ON CONFLICT DO NOTHING`);

/** A paid door pickup whose booked time is `agoHours` in the past. */
async function paidDoor(n, buyer = BUYER, agoHours = 1) {
  await run(liveItemSql({ id: I(n), seller: SELLER2, title: `Handover item ${n}`, price: 2000, floor: 100 }));
  await me(buyer, `SELECT public.declutter_buy_now('${I(n)}', 2000)`);
  const started = await me(buyer, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'pickup_home')`);
  if (!started?.[0]) console.log("checkout refused", n, short(started));
  const o = started?.[0];
  const marked = await svc(`SELECT public.declutter_mark_order_paid('${o?.order_id}', 'pi_both_${n}', ${o?.total_cents}, now(), 150) AS r`);
  await svc(`INSERT INTO public.declutter_bookings (order_id, buyer_id, seller_id, slot_start, slot_end)
    VALUES ('${o?.order_id}', '${buyer}', '${SELLER2}', now() - interval '${agoHours} hours', now() - interval '${agoHours} hours' + interval '30 minutes')`);
  await svc(`INSERT INTO public.declutter_handovers (order_id, code) VALUES ('${o?.order_id}', public.declutter_new_handover_code()) ON CONFLICT DO NOTHING`);
  return o?.order_id;
}
const status = async (id) => one(await svc(`SELECT status FROM public.declutter_orders WHERE id = '${id}'`));
const col = async (id, c) => one(await svc(`SELECT ${c} FROM public.declutter_handovers WHERE order_id = '${id}'`));
const refunds = async (id) => Number(one(await svc(`SELECT count(*) FROM public.declutter_refunds WHERE order_id = '${id}'`)));
const payouts = async (id) => Number(one(await svc(`SELECT count(*) FROM public.declutter_payouts WHERE order_id = '${id}'`)));
const strikes = async (uid) => Number(one(await svc(`SELECT count(*) FROM public.declutter_strikes WHERE user_id = '${uid}'`)));
const notes = async (uid, title) => Number(one(await svc(`SELECT count(*) FROM public.notifications WHERE user_id = '${uid}' AND title = '${title.replace(/'/g, "''")}'`)));
const problems = async (id) => svc(`SELECT reporter_side, reason, reporter_id, status FROM public.declutter_problems WHERE order_id = '${id}'`);
// The world lists every fixture user as a tester (they need the switch to act); the sweep skips testers, so they are
// lifted for its run, all but those named. Before and after, the members act as testers do.
const sweep = async (keepTesters = []) => {
  const keep = keepTesters.map((u) => `'${u}'`).join(",") || "NULL";
  await run(`CREATE TEMP TABLE ta_keep AS SELECT * FROM public.test_accounts; DELETE FROM public.test_accounts WHERE user_id NOT IN (${keep}) OR ${keepTesters.length === 0 ? "true" : "false"};`);
  const r = (await svc(`SELECT public.declutter_handover_sweep() AS r`))?.[0]?.r ?? {};
  await run(`INSERT INTO public.test_accounts SELECT * FROM ta_keep ON CONFLICT DO NOTHING; DROP TABLE ta_keep;`);
  return r;
};
const age = (id, c, hours) => svc(`UPDATE public.declutter_handovers SET ${c} = ${c} - interval '${hours} hours' WHERE order_id = '${id}'`);
const ageSlot = (id, hours) => svc(`UPDATE public.declutter_bookings SET slot_start = slot_start - interval '${hours} hours', slot_end = slot_end - interval '${hours} hours' WHERE order_id = '${id}'`);

// 1. The buyer's report: no refund, no strike, the seller is told, 24 hours.
const A = await paidDoor(1);
ok(await status(A) === "paid", `setup: order A is paid (${await status(A)})`);
const strikesBefore = await strikes(SELLER2);
const rep = await me(BUYER, `SELECT public.declutter_report_no_show('${A}') AS r`);
ok(rep?.[0]?.r?.result === "seller_told", `the buyer's report answers seller_told (${short(rep)})`);
ok(await status(A) === "paid" && (await refunds(A)) === 0, "  no refund on the tap");
ok((await strikes(SELLER2)) === strikesBefore, "  no strike on the tap");
ok((await notes(SELLER2, "The buyer says you didn't show")) === 1, "  the seller is told at once");
const hoursLeft = Number(one(await svc(`SELECT round(extract(epoch FROM no_show_answer_by - no_show_reported_at) / 3600) FROM public.declutter_handovers WHERE order_id = '${A}'`)));
ok(hoursLeft === 24, `  with 24 hours to answer (${hoursLeft})`);
const twice = await me(BUYER, `SELECT public.declutter_report_no_show('${A}') AS r`);
ok(twice?.[0]?.r?.result === "seller_told" && (await notes(SELLER2, "The buyer says you didn't show")) === 1, "a double tap tells the seller once");
await sweep();
ok(await status(A) === "paid", "before the 24 hours are up, the sweep leaves it");
ok(refused(await me(SELLER2, `SELECT public.declutter_report_no_show('${A}')`), /no_show_reported/), "the seller can't report the buyer back");
ok(refused(await me(SELLER2, `SELECT public.declutter_seller_picked_up('${A}', '')`), /no_show_reported/), "  or tap Picked up instead of answering");

// 2. No answer: refund + strike, once.
await svc(`UPDATE public.declutter_handovers SET no_show_answer_by = now() - interval '1 minute' WHERE order_id = '${A}'`);
const after = await sweep();
ok(after.no_show_unanswered === 1, `no answer in 24 hours: the sweep closes it (${short(after)})`);
ok(await status(A) === "refunded" && (await refunds(A)) === 1, `  refunded (${await status(A)})`);
ok((await strikes(SELLER2)) === strikesBefore + 1, "  with one strike on the seller");
await sweep();
ok((await strikes(SELLER2)) === strikesBefore + 1 && (await refunds(A)) === 1, "  and a later sweep does nothing more");

// 3. The seller answers: admin, money held, no strike until decided.
const B = await paidDoor(2);
await me(BUYER, `SELECT public.declutter_report_no_show('${B}')`);
const s2 = await strikes(SELLER2);
ok(refused(await me(BUYER, `SELECT public.declutter_answer_no_show('${B}', 'Not me')`), /wrong_side/), "the buyer can't answer for the seller");
ok(refused(await me(OUTSIDER, `SELECT public.declutter_answer_no_show('${B}', 'Stranger')`), /item_not_found/), "a stranger can't answer");
ok(refused(await me(SELLER2, `SELECT public.declutter_answer_no_show('${B}', '   ')`), /note_required/), "an empty answer is refused");
const ans = await me(SELLER2, `SELECT public.declutter_answer_no_show('${B}', 'I was on the porch from nine.') AS id`);
ok(typeof ans?.[0]?.id === "string", `the seller answers (${short(ans)})`);
const pb = await problems(B);
ok(pb.length === 1 && pb[0].reason === "no_show" && pb[0].reporter_side === "buyer" && pb[0].reporter_id === BUYER && pb[0].status === "open", `  a problem is open for admin, reported by the buyer (${short(pb)})`);
ok(one(await svc(`SELECT other_side_note FROM public.declutter_problems WHERE order_id = '${B}'`)) === "I was on the porch from nine.", "  the seller's words are the answer, on the other side");
const again = await me(SELLER2, `SELECT public.declutter_answer_no_show('${B}', 'I was on the porch from nine.') AS id`);
ok(again?.[0]?.id === ans?.[0]?.id, "  the same answer sent again answers the same problem");
ok(refused(await me(SELLER2, `SELECT public.declutter_answer_no_show('${B}', 'Something different')`), /problem_already_open/), "  a different second answer goes on the open problem");
ok((await problems(B)).length === 1, "  still one problem");
ok(/seller answered/i.test(one(await svc(`SELECT title FROM public.notifications WHERE user_id = '${BUYER}' AND title = 'The seller answered your report' LIMIT 1`)) ?? ""), "  the buyer is told the seller answered");
await svc(`UPDATE public.declutter_handovers SET no_show_answer_by = now() - interval '1 minute' WHERE order_id = '${B}'`);
await sweep();
ok(await status(B) === "paid" && (await refunds(B)) === 0 && (await payouts(B)) === 0, "  money held past the 24 hours");
ok((await strikes(SELLER2)) === s2, "  no strike until it is decided");

// T9: the buyer takes back a report the seller answered. The report is over: no refund and no strike on the seller who
// answered, even though the 24 hours have passed; and it can't be made again.
const W = await paidDoor(40);
await ageSlot(W, 1);
await me(BUYER, `SELECT public.declutter_report_no_show('${W}')`);
const wAns = await me(SELLER2, `SELECT public.declutter_answer_no_show('${W}', 'I was there.') AS id`);
const wS = await strikes(SELLER2);
await svc(`UPDATE public.declutter_handovers SET no_show_answer_by = now() - interval '1 minute' WHERE order_id = '${W}'`);
const wBack = await me(BUYER, `SELECT public.declutter_withdraw_problem('${wAns?.[0]?.id}') AS r`);
ok(wBack?.[0]?.r?.result === "withdrawn", `the buyer can take back the report the seller answered (${short(wBack)})`);
ok(one(await svc(`SELECT no_show_reported_at FROM public.declutter_handovers WHERE order_id = '${W}'`)) == null, "  the report is over");
await sweep();
ok(await status(W) === "paid" && (await refunds(W)) === 0 && (await strikes(SELLER2)) === wS, "  the sweep doesn't read it as no answer: no refund, no strike");
ok(refused(await me(BUYER, `SELECT public.declutter_report_no_show('${W}')`), /problem_taken_back/), "  and it can't be reported again");
const W2 = await paidDoor(41);
await ageSlot(W2, 1);
await me(BUYER, `SELECT public.declutter_report_no_show('${W2}')`);
const wAns2 = await me(SELLER2, `SELECT public.declutter_answer_no_show('${W2}', 'I was there too.') AS id`);
ok(refused(await me(SELLER2, `SELECT public.declutter_withdraw_problem('${wAns2?.[0]?.id}')`), /problem_not_found/), "the seller can't take back the buyer's report");

// T9: the pickup time stands during the seller's 24 hours (a trigger, so every way of moving it agrees).
const MV = await paidDoor(42);
await ageSlot(MV, 1);
const mv0 = await run(`UPDATE public.declutter_bookings SET slot_start = slot_start + interval '1 minute', slot_end = slot_end + interval '1 minute' WHERE order_id = '${MV}'`);
ok(!mv0?.error, `before a report the time can move${mv0?.error ? `: ${mv0.error}` : ""}`);
await me(BUYER, `SELECT public.declutter_report_no_show('${MV}')`);
const moved = await run(`UPDATE public.declutter_bookings SET slot_start = slot_start + interval '1 day' WHERE order_id = '${MV}'`);
ok(/no_show_waiting/.test(String(moved?.error ?? "")), `after it the time can't move (${short(moved)})`);
const movedDay = await run(`UPDATE public.declutter_bookings SET pickup_day = current_date + 1 WHERE order_id = '${MV}'`);
ok(/no_show_waiting/.test(String(movedDay?.error ?? "")), "  nor a porch day");

// A late answer.
const L = await paidDoor(3);
await me(BUYER, `SELECT public.declutter_report_no_show('${L}')`);
await svc(`UPDATE public.declutter_handovers SET no_show_answer_by = now() - interval '1 minute' WHERE order_id = '${L}'`);
ok(refused(await me(SELLER2, `SELECT public.declutter_answer_no_show('${L}', 'Too late')`), /no_show_answer_late/), "an answer after the 24 hours is refused");

// 4. The seller's "Picked up": recorded, not paid; 24 + 24 hours; the buyer can still say.
const C = await paidDoor(4, BUYER2);
const pick = await me(SELLER2, `SELECT public.declutter_seller_picked_up('${C}', '') AS r`);
ok(pick?.[0]?.r?.result === "seller_confirmed", `Picked up is recorded (${short(pick)})`);
ok(await status(C) === "paid" && (await payouts(C)) === 0, "  no handover and no payout row on the seller's word");
ok((await notes(BUYER2, "The seller says you have it")) === 1, "  the buyer is told");
await me(SELLER2, `SELECT public.declutter_seller_picked_up('${C}', '')`);
ok((await notes(BUYER2, "The seller says you have it")) === 1, "  a second tap tells them once");
ok(refused(await me(BUYER2, `SELECT public.declutter_report_no_show('${C}')`), /seller_confirmed/), "the buyer can't one-tap a no-show after it: a problem report is the way");
ok(refused(await me(SELLER2, `SELECT public.declutter_report_no_show('${C}')`), /already_confirmed/), "the seller can't report the buyer missing after saying they got it");
await ageSlot(C, 30);
await sweep();
ok(await status(C) === "paid", "23 hours after Picked up (slot long past), still held");
await age(C, "seller_confirmed_at", 25);
const fin = await sweep();
ok(await status(C) === "handed_over" && (await payouts(C)) === 1, `24 hours after it the handover finishes (${short(fin)})`);
ok(one(await svc(`SELECT public.declutter_sale_final('${C}')`)) === false, "  and the sale isn't final yet: the money moves a day later, about 48 hours in all");
await svc(`UPDATE public.declutter_orders SET handed_over_at = handed_over_at - interval '25 hours' WHERE id = '${C}'`);
ok(one(await svc(`SELECT public.declutter_sale_final('${C}')`)) === true, "  48 hours in, it is final");

// The buyer's "I got it" alone finishes it (owner 10-30).
const D = await paidDoor(5, BUYER2);
const got = await me(BUYER2, `SELECT public.declutter_confirm_handover('${D}', 'buyer', NULL) AS r`);
ok(got?.[0]?.r?.result === "handed_over" && (await status(D)) === "handed_over", `the buyer's I got it alone finishes the order (${short(got)})`);

// A problem while the seller's clock runs: held.
const E = await paidDoor(6, BUYER2);
await me(SELLER2, `SELECT public.declutter_seller_picked_up('${E}', '')`);
await me(BUYER2, `SELECT public.declutter_report_problem('${E}', 'not_received', 'I never got it', '{}')`);
await ageSlot(E, 30);
await age(E, "seller_confirmed_at", 25);
await sweep();
ok(await status(E) === "paid" && (await payouts(E)) === 0, "a problem report holds it past the seller's clock");

// 5. Neither side says anything: no auto-pay, no refund, no strike, no admin problem; nudged at 24 h, then weekly.
const F = await paidDoor(7, BUYER2, 2);
const s3 = await strikes(SELLER2);
await sweep();
ok((await notes(BUYER2, "Did you get your item?")) === 0, "before 24 hours after the time, no nudge");
await ageSlot(F, 30);
const held = await sweep();
ok(held.auto_paid === 0 && await status(F) === "paid" && (await payouts(F)) === 0 && (await refunds(F)) === 0, `silence past 24 hours: no auto-pay and no refund (${short(held)})`);
ok((await strikes(SELLER2)) === s3 && (await problems(F)).length === 0, "  no strike and no admin problem");
ok((await notes(BUYER2, "Did you get your item?")) >= 1 && (await notes(SELLER2, "Did the buyer get this item?")) >= 1, "  both are nudged at 24 hours");
const n1 = await notes(BUYER2, "Did you get your item?");
await sweep();
ok((await notes(BUYER2, "Did you get your item?")) === n1, "  not again on the next run");
await age(F, "held_nudged_at", 7 * 24 + 1);
await sweep();
ok((await notes(BUYER2, "Did you get your item?")) === n1 + 1, "  again a week later");

// Notice settings and test data.
await svc(`INSERT INTO public.notification_preferences (user_id, declutter_pickups) VALUES ('${BUYER2}', false) ON CONFLICT (user_id) DO UPDATE SET declutter_pickups = false`);
await age(F, "held_nudged_at", 7 * 24 + 1);
const sellerNotes = await notes(SELLER2, "Did the buyer get this item?");
await sweep();
ok((await notes(BUYER2, "Did you get your item?")) === n1 + 1, "the buyer's Pickups switch off: no nudge to them");
ok((await notes(SELLER2, "Did the buyer get this item?")) === sellerNotes + 1, "  the seller's stays on");
await svc(`DELETE FROM public.notification_preferences WHERE user_id = '${BUYER2}'`);

const T = await paidDoor(8, BUYER, 900 * 24 / 15);
const tNudges = await notes(BUYER, "Did you get your item?");
await sweep([BUYER]);
ok((await notes(BUYER, "Did you get your item?")) === tNudges, "a test account's order is not nudged");
ok((await problems(T)).length === 0, "  and doesn't reach admin at 60 days");
await svc(`UPDATE public.declutter_orders SET is_seed = true WHERE id = '${T}'`);
await sweep();
ok((await notes(BUYER, "Did you get your item?")) === tNudges && (await problems(T)).length === 0, "  a seed order the same");

// 6. The address closes at 7 days; chat stays open; a problem or a seller's word keeps it open.
const G = await paidDoor(9, BUYER2, 1);
const addr = async (uid, n) => me(uid, `SELECT * FROM public.declutter_item_address('${I(n)}')`);
ok((await addr(BUYER2, 9))?.length === 1, "before 7 days the buyer has the address");
await ageSlot(G, 7 * 24 - 2);
ok((await addr(BUYER2, 9))?.length === 1, "at just under 7 days, still");
await ageSlot(G, 3);
const closed = await addr(BUYER2, 9);
ok(Array.isArray(closed) && closed.length === 0, `7 days after the time, no address and no error (${short(closed)})`);
ok((await addr(SELLER2, 9))?.length === 1, "  the seller still reads their own");
ok(refused(await addr(OUTSIDER, 9), /item_not_found|feature_disabled/), "  a stranger is refused as before");
const talk = one(await svc(`SELECT public.declutter_order_talk_until('${G}')::text`));
ok(talk === "infinity", `  chat stays open (${talk})`);
// Review 7496d29c8b #4: a problem filed after the close doesn't reopen it. One filed before the close keeps it open.
await me(BUYER2, `SELECT public.declutter_report_problem('${G}', 'other', 'Where is it?', '{}')`);
const stillClosed = await addr(BUYER2, 9);
ok(Array.isArray(stillClosed) && stillClosed.length === 0, `a problem filed after the close doesn't reopen the address (${short(stillClosed)})`);
await svc(`UPDATE public.declutter_problems SET created_at = now() - interval '8 days' WHERE order_id = '${G}'`);
ok((await addr(BUYER2, 9))?.length === 1, "  one filed before the close keeps it open");

// 7. Held 60 days: admin decides, no money moves; decided by the existing function.
const H = await paidDoor(10, BUYER2, 1);
await ageSlot(H, 60 * 24);
const toAdmin = await sweep();
ok(toAdmin.held_to_admin >= 1, `held 60 days: it goes to admin (${short(toAdmin)})`);
const ph = await problems(H);
ok(ph.length === 1 && ph[0].reporter_side === "system" && ph[0].reporter_id === null && ph[0].status === "open", `  as nobody's report (${short(ph)})`);
ok(await status(H) === "paid" && (await refunds(H)) === 0 && (await payouts(H)) === 0, "  and no money moved");
const hItem = one(await svc(`SELECT c.item_id FROM public.declutter_cart_items c WHERE c.order_id = '${H}' LIMIT 1`));
const hAddr = await me(BUYER2, `SELECT * FROM public.declutter_item_address('${hItem}')`);
ok(Array.isArray(hAddr) && hAddr.length === 0, `  the 60-day problem doesn't reopen the address (${short(hAddr)})`);
await sweep();
ok((await problems(H)).length === 1, "  once");
const gotH = await me(BUYER2, `SELECT public.declutter_confirm_handover('${H}', 'buyer', NULL) AS r`);
ok(gotH?.[0]?.r?.result === "handed_over" && await status(H) === "handed_over", `the buyer's I got it still finishes it (${short(gotH)})`);
ok((await problems(H))[0]?.status === "withdrawn", "  and closes the 60-day problem");
ok((await payouts(H)) === 1 && one(await svc(`SELECT public.declutter_sale_final('${H}')`)) === false, "  the seller's payout row exists, and waits the usual 24 hours");
const HP = await paidDoor(11, BUYER2, 1);
await me(BUYER2, `SELECT public.declutter_report_problem('${HP}', 'other', 'Something is wrong', '{}')`);
ok(refused(await me(BUYER2, `SELECT public.declutter_confirm_handover('${HP}', 'buyer', NULL)`), /problem_open/), "a person's own report still holds I got it");

// 8. Seller delivery's "It wasn't delivered" goes the same way.
const { SELLER } = USERS;
await me(SELLER, `SELECT public.declutter_set_seller_delivery(true, 2000, 10)`);
const deliveryWindows = JSON.stringify([0, 1, 2, 3, 4, 5, 6].map((d) => ({ weekday: d, starts: "09:00", ends: "17:00" })));
await me(SELLER, `SELECT public.declutter_set_delivery_schedule('${deliveryWindows}'::jsonb, ARRAY[]::date[])`);
async function paidDelivery(n) {
  await run(liveItemSql({ id: I(n), seller: SELLER, title: `Delivered item ${n}`, price: 5000, floor: 100 }));
  await me(BUYER2, `SELECT public.declutter_buy_now('${I(n)}', 5000)`);
  await svc(`SELECT public.declutter_set_delivery_dropoff('${BUYER2}', '${SELLER}', '500 Drop Rd, Baton Rouge, LA 70805', 'North Baton Rouge', 30.51, -91.15)`);
  const slot = one(await me(BUYER2, `SELECT public.declutter_seller_delivery_offer('${SELLER}')`))?.slots?.[0];
  const o = (await me(BUYER2, `SELECT * FROM public.declutter_start_checkout('${SELLER}', 'seller_delivery', '${slot}', 'hand')`))?.[0];
  await svc(`SELECT public.declutter_mark_order_paid('${o?.order_id}', 'pi_both_${n}', ${o?.total_cents}, now(), 150)`);
  await svc(`UPDATE public.declutter_seller_deliveries SET slot_start = now() - interval '2 hours', slot_end = now() - interval '1 hour' WHERE order_id = '${o?.order_id}'`);
  return o?.order_id;
}
const SD = await paidDelivery(20);
ok(await status(SD) === "paid", `setup: a paid seller delivery (${await status(SD)})`);
const sdStrikes = await strikes(SELLER);
const told = await me(BUYER2, `SELECT public.declutter_report_not_delivered('${SD}') AS r`);
ok(told?.[0]?.r?.result === "seller_told" && await status(SD) === "paid" && (await refunds(SD)) === 0, `It wasn't delivered: no refund on the tap (${short(told)})`);
ok((await strikes(SELLER)) === sdStrikes, "  no strike on the tap");
ok((await notes(SELLER, "The buyer says it wasn't delivered")) === 1, "  the seller is told at once");
ok(refused(await me(SELLER, `SELECT public.declutter_seller_delivered('${SD}', '')`), /no_show_reported/), "  and can't mark it delivered instead of answering");
await svc(`UPDATE public.declutter_handovers SET no_show_answer_by = now() - interval '1 minute' WHERE order_id = '${SD}'`);
await sweep();
ok(await status(SD) === "refunded" && (await strikes(SELLER)) === sdStrikes + 1, `no answer: refund + strike (${await status(SD)})`);
const SD2 = await paidDelivery(21);
await me(BUYER2, `SELECT public.declutter_report_not_delivered('${SD2}')`);
const sdAns = await me(SELLER, `SELECT public.declutter_answer_no_show('${SD2}', 'I handed it over at noon.') AS id`);
ok(typeof sdAns?.[0]?.id === "string", `an answer on a delivery goes to admin (${short(sdAns)})`);
await svc(`UPDATE public.declutter_handovers SET no_show_answer_by = now() - interval '1 minute' WHERE order_id = '${SD2}'`);
await sweep();
ok(await status(SD2) === "paid" && (await strikes(SELLER)) === sdStrikes + 1, "  money held, no second strike");
// Held delivery, nobody speaking: nudged from slot end + 24 hours; not auto-paid.
const SD3 = await paidDelivery(22);
await svc(`UPDATE public.declutter_seller_deliveries SET slot_start = now() - interval '30 hours', slot_end = now() - interval '29 hours' WHERE order_id = '${SD3}'`);
await sweep();
ok((await notes(BUYER2, "Did your delivery come?")) >= 1 && (await notes(SELLER, "Did you make this delivery?")) >= 1, "a delivery nobody speaks about is nudged");
ok(await status(SD3) === "paid", "  and stays held");

// Review 7496d29c8b #1: any problem stops the clock; a seller's response of any kind counts; a withdrawal clears it.
const F1 = await paidDoor(50, BUYER2, 1);
await me(BUYER2, `SELECT public.declutter_report_no_show('${F1}')`);
await me(BUYER2, `SELECT public.declutter_report_problem('${F1}', 'other', 'It is also the wrong colour', '{}')`);
const f1Id = one(await svc(`SELECT id FROM public.declutter_problems WHERE order_id = '${F1}'`));
const f1Ans = await me(SELLER2, `SELECT public.declutter_answer_no_show('${F1}', 'I was there all morning.') AS id`);
ok(f1Ans?.[0]?.id === f1Id, `the seller's answer lands on the buyer's other problem, not refused (${short(f1Ans)})`);
ok(one(await svc(`SELECT other_side_note FROM public.declutter_problems WHERE id = '${f1Id}'`)) === "I was there all morning.", "  as the seller's side");
const f1S = await strikes(SELLER2);
await svc(`UPDATE public.declutter_handovers SET no_show_answer_by = now() - interval '1 minute' WHERE order_id = '${F1}'`);
await me(BUYER2, `SELECT public.declutter_withdraw_problem('${f1Id}')`);
ok(one(await svc(`SELECT no_show_reported_at FROM public.declutter_handovers WHERE order_id = '${F1}'`)) == null, "the buyer takes back the other problem: the clock is cleared");
await sweep();
ok(await status(F1) === "paid" && (await refunds(F1)) === 0 && (await strikes(SELLER2)) === f1S, "  so the sweep can't refund and strike a seller who responded");
ok(refused(await me(BUYER2, `SELECT public.declutter_report_no_show('${F1}')`), /problem_taken_back/), "  and a report can't be made again, whatever was taken back");
// The same, the seller responding through "Add your side".
const F2 = await paidDoor(51, BUYER2, 1);
await me(BUYER2, `SELECT public.declutter_report_no_show('${F2}')`);
await me(BUYER2, `SELECT public.declutter_report_problem('${F2}', 'other', 'Something else', '{}')`);
const f2Id = one(await svc(`SELECT id FROM public.declutter_problems WHERE order_id = '${F2}'`));
await me(SELLER2, `SELECT public.declutter_problem_add_side('${f2Id}', 'My side.')`);
await svc(`UPDATE public.declutter_handovers SET no_show_answer_by = now() - interval '1 minute' WHERE order_id = '${F2}'`);
await sweep();
ok(await status(F2) === "paid" && (await refunds(F2)) === 0, "an open problem stops the clock");
await me(BUYER2, `SELECT public.declutter_withdraw_problem('${f2Id}')`);
await sweep();
ok(await status(F2) === "paid" && (await refunds(F2)) === 0, "  and taking it back after Add your side doesn't refund either");
// The seller takes back their own response in time: their answer is gone, and the clock runs on.
const F3 = await paidDoor(52, BUYER2, 1);
await me(BUYER2, `SELECT public.declutter_report_no_show('${F3}')`);
await me(SELLER2, `SELECT public.declutter_report_problem('${F3}', 'other', 'The buyer never came.', '{}')`);
const f3Id = one(await svc(`SELECT id FROM public.declutter_problems WHERE order_id = '${F3}'`));
await me(SELLER2, `SELECT public.declutter_withdraw_problem('${f3Id}')`);
ok(one(await svc(`SELECT no_show_reported_at FROM public.declutter_handovers WHERE order_id = '${F3}'`)) != null, "a seller's own withdrawal doesn't erase the buyer's report");

// Review 7496d29c8b #2: a delivery's time stands during the 24 hours too, as a pickup's does.
const M1 = await paidDelivery(53);
const m1Slot = one(await svc(`SELECT s::text FROM public.declutter_delivery_open_slots('${SELLER}', '${M1}') s LIMIT 1`));
await svc(`UPDATE public.declutter_seller_deliveries SET proposed_start = now() + interval '3 days', proposed_by = 'seller', proposed_at = now() WHERE order_id = '${M1}'`);
await me(BUYER2, `SELECT public.declutter_report_not_delivered('${M1}')`);
ok(refused(await me(BUYER2, `SELECT public.declutter_answer_delivery_time('${M1}', true)`), /no_show_waiting/), "accepting a new delivery time waits for the answer");
ok(refused(await me(BUYER2, `SELECT public.declutter_propose_delivery_time('${M1}', '${m1Slot}')`), /no_show_waiting/), `  and so does asking for one (slot ${m1Slot})`);
const m1Kept = await me(BUYER2, `SELECT public.declutter_answer_delivery_time('${M1}', false) AS r`);
ok(m1Kept?.[0]?.r?.result === "kept", `  turning a proposal down still works (${short(m1Kept)})`);

// Review 7496d29c8b #3: a late porch photo: the later of the pickup time and the photo, plus 24 hours.
const P1 = await paidDoor(54, BUYER2, 30);
await run(`ALTER TABLE public.declutter_orders DISABLE TRIGGER USER; UPDATE public.declutter_orders SET handover = 'porch' WHERE id = '${P1}'; ALTER TABLE public.declutter_orders ENABLE TRIGGER USER;`);
await svc(`UPDATE public.declutter_handovers SET set_out_at = now() - interval '1 hour', set_out_photo_path = 'x/declutter/handover/${P1}/out.jpg' WHERE order_id = '${P1}'`);
await sweep();
ok(await status(P1) === "paid", "a porch photo an hour old, the pickup time 30 hours ago: not paid yet");
await svc(`UPDATE public.declutter_handovers SET set_out_at = now() - interval '25 hours' WHERE order_id = '${P1}'`);
await sweep();
ok(await status(P1) === "handed_over", "  25 hours after the photo it is");
const P2 = await paidDoor(55, BUYER2, 1);
await run(`ALTER TABLE public.declutter_orders DISABLE TRIGGER USER; UPDATE public.declutter_orders SET handover = 'porch' WHERE id = '${P2}'; ALTER TABLE public.declutter_orders ENABLE TRIGGER USER;`);
await svc(`UPDATE public.declutter_handovers SET set_out_at = now() - interval '30 hours', set_out_photo_path = 'x/declutter/handover/${P2}/out.jpg' WHERE order_id = '${P2}'`);
await sweep();
ok(await status(P2) === "paid", "a photo early, the pickup time an hour ago: not paid yet either");

// Porch: the set-out photo is refused during the seller's 24 hours (the trigger on the handover row).
const PR = await paidDoor(30, BUYER2, 30);
await me(BUYER2, `SELECT public.declutter_report_no_show('${PR}')`);
ok(refused(await run(`UPDATE public.declutter_handovers SET set_out_at = now() WHERE order_id = '${PR}'`), /no_show_reported/), "setting it out during the 24 hours is refused");
ok(refused(await me(SELLER2, `UPDATE public.declutter_handovers SET no_show_reported_at = now()`), /permission denied/), "members can't write the clock directly");
const acl = await svc(`SELECT p.proname, p.proacl::text AS acl FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname IN ('declutter_start_no_show_answer', 'declutter_held_address_closed', 'declutter_refuse_given_during_no_show', 'declutter_answer_no_show')`);
ok(Array.isArray(acl) && acl.length === 4 && acl.every((a) => !/anon=/.test(a.acl ?? "") && !/(^|[{,])=X/.test(a.acl ?? "")), `no new function runs for anon or PUBLIC (${short(acl)})`);
ok(acl.filter?.((a) => /authenticated=X/.test(a.acl ?? "")).map((a) => a.proname).join() === "declutter_answer_no_show", "  only the answer runs for members");

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
