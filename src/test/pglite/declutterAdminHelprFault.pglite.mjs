#!/usr/bin/env node
/**
 * PGlite proof for 20261101000817_declutter_admin_helpr_fault (LEAD-ADMIN-HELPR-FAULT, owner rule 10-30 "Helpr's
 * fault, Helpr bears it"): an admin decides a disputed "the Helpr didn't come" as the Helpr's fault. Full refund,
 * delivery included; the card fee is a debt on the Helpr; the Helpr is not paid; the strike is the Helpr's.
 *
 *   node src/test/pglite/declutterAdminHelprFault.pglite.mjs                    # GREEN (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterAdminHelprFault.pglite.mjs # RED: the chain without it
 *   MIGRATION_PATH=<planted copy> node ...                                      # RED on a planted defect
 *   NEW_MIGRATION=skip-released node ...   # RED: without 20261101020052 (B45), only the released-Helpr cases fail
 *   RELEASED_PATH=<planted copy> node ...  # RED on a planted defect in 20261101020052
 *
 * World: scripts/declutter/handoverPhotoWorld.mjs, the bases helprDeliveryCantFinish uses, then BUY-36's two
 * migrations (this one restates from them). Stubbed, and said so: is_test_subject (false); identity_check_exempt and
 * the review_held_at columns B49's fee migrations read (as helprDeliveryCantFinish.pglite.mjs does). A task reaches "accepted"
 * or "picked up" by a direct update: taking and picking up have their own proofs.
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261101000817_declutter_admin_helpr_fault.sql";
// B45: the released Helpr's id (restates decide_problem from NEW_FILE). NEW_MIGRATION=skip-released leaves only it out.
const RELEASED_FILE = "20261101020052_helpr_task_released_helpr.sql";
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
  // B48 (rebuild on main after #3915): main's FINAL 20261031231150 takes B49's setup_fee_cents off the payout, so the
  // setup-fee files it was rebased on come first, as in helprDeliveryCantFinish.pglite.mjs; 232943 follows it there too.
  "20261031214749_seller_setup_fee_from_payout_restated.sql",
  "20261031220617_helpr_setup_fee_from_payout_restated.sql",
  "20261031225132_setup_fee_never_after_a_send.sql",
];
BASES.push(
  "20261031231150_helpr_delivery_cant_finish.sql",
  "20261031231948_helpr_delivery_talk.sql",
  "20261031232943_setup_fee_admin_check_reads_roles.sql",
);
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");
const { svc, run, one, me, refused, liveItemSql, USERS } = await buildHandoverWorld();
const { SELLER2, BUYER2, BUYER3, ADMIN } = USERS;
const SELLER = SELLER2;
const BUYER = BUYER2;
const HELPR = BUYER3;

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const short = (r) => JSON.stringify(r)?.slice(0, 260);

// B48: what B49's fee migrations read and the world does not build, stubbed exactly as helprDeliveryCantFinish.pglite.mjs
// does (and said so): identity_check_exempt reads a proof-only switch row; the send-tried columns 20261031225132 reads.
const stub6 = await run(`CREATE TABLE public.proof_identity_check (on_for_all boolean NOT NULL);
  INSERT INTO public.proof_identity_check VALUES (false);
  CREATE OR REPLACE FUNCTION public.identity_check_exempt(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS
    $$ SELECT NOT (SELECT on_for_all FROM public.proof_identity_check) $$;
  ALTER TABLE public.declutter_payouts ADD COLUMN IF NOT EXISTS review_held_at timestamptz;
  ALTER TABLE public.helpr_task_payouts ADD COLUMN IF NOT EXISTS review_held_at timestamptz;`);
ok(!stub6?.error, `stubs for B49's fee migrations${stub6?.error ? `: ${stub6.error}` : ""}`);
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
  }
  if (process.env.NEW_MIGRATION !== "skip-released") {
    const rel = readFileSync(process.env.RELEASED_PATH ?? `${MIG_DIR}${RELEASED_FILE}`, "utf8");
    for (let i = 0; i < 3; i++) {
      const r = await run(rel);
      ok(!r?.error, `${RELEASED_FILE} applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
    }
  } else console.log("NEW_MIGRATION=skip-released: running WITHOUT " + RELEASED_FILE + " (expect section 4 FAILs)");
}

const I = (n) => `dddddddd-0000-0000-0000-${String(n).padStart(12, "0")}`;
const DROP = { lat: 30.496234, lng: -91.154321 };
await run(`INSERT INTO public.declutter_pickup_windows (seller_id, weekday, starts_local, ends_local)
  SELECT '${SELLER}', d, '00:00', '23:59' FROM generate_series(0, 6) d ON CONFLICT DO NOTHING`);

/** A paid Helpr delivery a Helpr has taken (picked up when `picked`). */
async function taken(n, picked = false) {
  await run(liveItemSql({ id: I(n), seller: SELLER, title: `Taken item ${n}`, price: 4000, floor: 100 }));
  await svc(`UPDATE public.declutter_items SET delivery_size = 'small' WHERE id = '${I(n)}'`);
  await me(BUYER, `SELECT public.declutter_buy_now('${I(n)}', 4000)`);
  await svc(`SELECT public.declutter_set_delivery_dropoff('${BUYER}', '${SELLER}', '500 Drop Rd', 'North Baton Rouge', ${DROP.lat}, ${DROP.lng})`);
  const o = (await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${SELLER}', 'delivery')`))?.[0];
  if (!o?.order_id) throw new Error(`no order for ${n}`);
  const paid = await svc(`SELECT public.declutter_mark_order_paid('${o.order_id}', 'pi_hf_${n}', ${o.total_cents}, now(), 150)`);
  if (paid?.error) throw new Error(`mark paid: ${paid.error}`);
  const task = one(await svc(`SELECT task_id FROM public.declutter_order_deliveries WHERE order_id = '${o.order_id}'`));
  if (!task) throw new Error(`no task for ${n}`);
  const up = picked
    ? await run(`UPDATE public.helpr_tasks SET status = 'picked_up', helpr_id = '${HELPR}', accepted_at = now(), pickup_slot_start = now() - interval '1 hour',
        picked_up_at = now(), pickup_photo_path = '${HELPR}/task/${task}/pick.jpg' WHERE id = '${task}'`)
    : await run(`UPDATE public.helpr_tasks SET status = 'accepted', helpr_id = '${HELPR}', accepted_at = now() - interval '3 hours',
        pickup_slot_start = now() - interval '2 hours' WHERE id = '${task}'`);
  if (up?.error) throw new Error(up.error);
  return { order: o.order_id, total: o.total_cents, delivery: o.delivery_cents, task };
}
const task = async (id) => (await svc(`SELECT * FROM public.helpr_tasks WHERE id = '${id}'`))?.[0];
const order = async (id) => (await svc(`SELECT * FROM public.declutter_orders WHERE id = '${id}'`))?.[0];
const refund = async (id) => (await svc(`SELECT reason, fee_policy, paid_cents, card_fee_cents, refund_cents FROM public.declutter_refunds WHERE order_id = '${id}'`))?.[0];
const helprPayout = async (t) => (await svc(`SELECT amount_cents FROM public.helpr_task_payouts WHERE task_id = '${t}'`))?.[0];
const strikes = async () => one(await svc(`SELECT count(*)::int FROM public.user_violations WHERE user_id = '${HELPR}'`));
const noteTo = async (uid, title) => one(await svc(`SELECT message FROM public.notifications WHERE user_id = '${uid}' AND title = '${title.replace(/'/g, "''")}' ORDER BY created_at DESC LIMIT 1`));
const report = async (o) => {
  const r = await me(BUYER, `SELECT public.declutter_report_problem('${o}', 'other', 'The Helpr never came.', '{}') AS id`);
  if (typeof r?.[0]?.id !== "string") throw new Error(`report: ${short(r)}`);
  return r[0].id;
};
const decide = (pid, decision, fault, strike = false, part = "NULL") =>
  me(ADMIN, `SELECT public.declutter_admin_decide_problem('${pid}', '${decision}', '${fault}', ${strike}, 'x', false, ${part}) AS r`);

// 1. The Helpr took it and never came: decided as the Helpr's fault.
const A = await taken(1);
const pA = await report(A.order);
ok(refused(await me(BUYER, `SELECT public.declutter_admin_decide_problem('${pA}', 'refund_buyer', 'helpr', true, 'x')`), /not_authorized/), "a member can't decide");
ok(refused(await decide(pA, "pay_seller", "helpr"), /helpr_fault_not_possible/), "the Helpr's fault is never 'pay the seller'");
const strikesBefore = await strikes();
const dA = await decide(pA, "refund_buyer", "helpr", true);
ok(!dA?.error, `refund the buyer, the Helpr's fault (${short(dA)})`);
const rA = await refund(A.order);
ok(rA?.reason === "helpr_fault" && rA?.fee_policy === "full_seller_pays_fee" && rA?.paid_cents === A.total && rA?.refund_cents === A.total && A.delivery > 0,
  `  everything back, delivery included (${short(rA)}, total ${A.total}, delivery ${A.delivery})`);
ok((await order(A.order)).status === "refunded", "  the sale is cancelled");
const tA = await task(A.task);
ok(tA.status === "failed" && tA.helpr_id === HELPR && !(await helprPayout(A.task)), `  the Helpr is not paid (${tA.status})`);
const dbt = (await svc(`SELECT d.seller_id::text AS who, d.amount_cents FROM public.declutter_seller_fee_debts d JOIN public.declutter_refunds r ON r.id = d.refund_id WHERE r.order_id = '${A.order}'`))?.[0];
ok(dbt?.who === HELPR && dbt?.amount_cents === rA?.card_fee_cents && dbt?.amount_cents > 0, `  the Helpr owes the card fee, not the seller (${short(dbt)})`);
ok(one(await svc(`SELECT count(*)::int FROM public.declutter_seller_fee_debts WHERE seller_id = '${SELLER}'`)) === 0, "  the seller owes nothing");
ok((await strikes()) === strikesBefore + 1, "  the strike is the Helpr's");
ok(one(await svc(`SELECT fault FROM public.declutter_problems WHERE id = '${pA}'`)) === "helpr", "  the decision is recorded as the Helpr's fault");
ok(/All \$[\d.]+ is coming back to your card, delivery included\./.test(await noteTo(BUYER, "Refund on its way") ?? ""), `  the buyer's refund notice says all of it (${await noteTo(BUYER, "Refund on its way")})`);
ok(!/card fee/i.test(await noteTo(BUYER, "Refund on its way") ?? "card fee"), "  and never 'the card fee is not refunded'");
ok(/all of your money is coming back, delivery included/.test(await noteTo(BUYER, "Louisiana Helpr decided") ?? ""), "  the decision notice says so too");
ok(/not paid for this delivery/.test(await noteTo(HELPR, "Delivery decided") ?? ""), "  the Helpr is told");

// 2. Where the Helpr's fault is not this decision.
const B = await taken(2, true);
const pB = await report(B.order);
ok(refused(await decide(pB, "refund_buyer", "helpr"), /helpr_fault_not_possible/), "after the pickup: decided as can't finish or damaged instead");
ok((await task(B.task)).status === "picked_up" && !(await refund(B.order)), "  nothing moved");
const C = await taken(3);
const pC = await report(C.order);
const noStrike = await strikes();
const dC = await decide(pC, "refund_buyer", "helpr", false);
ok(!dC?.error && (await refund(C.order))?.reason === "helpr_fault" && (await strikes()) === noStrike, `the admin may decide it without a strike (${short(dC)})`);
ok(refused(await decide(pC, "refund_buyer", "helpr"), /problem_already_decided/), "  once");

// 3. The other faults are unchanged.
const D = await taken(4);
const pD = await report(D.order);
const dD = await decide(pD, "refund_buyer", "none");
ok(!dD?.error && (await refund(D.order))?.reason === "admin_no_fault" && (await refund(D.order))?.fee_policy === "keep_card_fee", `nobody's fault still keeps the card fee (${short(await refund(D.order))})`);
// 20261027172503 rewrote the live body's notices (no fee words); the restatement keeps those words.
ok((await noteTo(BUYER, "Refund on its way")) === "Your refund is on its way.", `  and its notice is the live one (${await noteTo(BUYER, "Refund on its way")})`);

// 4. B45 (20261101020052, lead 10-31): the Helpr was released (the seller said they didn't come; the task is back up
// for another Helpr, helpr_id NULL) before the admin decides. The released Helpr's id is kept and the fault is theirs.
const E = await taken(5);
const rel = await svc(`SELECT public.helpr_task_reopen('${E.task}', 'helpr_no_show', '${HELPR}', 'the seller said the Helpr did not come')`);
ok(!rel?.error, `the Helpr is released (${short(rel)})`);
const tE0 = await task(E.task);
ok(tE0.status === "open" && tE0.helpr_id === null && tE0.released_helpr_id === HELPR, `  back up for another Helpr, the released Helpr kept (${tE0.status}, ${tE0.helpr_id}, ${tE0.released_helpr_id})`);
const pE = await report(E.order);
const strikesE = await strikes();
const dE = await decide(pE, "refund_buyer", "helpr", true);
ok(!dE?.error, `decided as the released Helpr's fault (${short(dE)})`);
const rE = await refund(E.order);
ok(rE?.reason === "helpr_fault" && rE?.paid_cents === E.total && rE?.refund_cents === E.total, `  everything back, delivery included (${short(rE)})`);
const tE = await task(E.task);
ok(tE.status === "failed" && tE.helpr_id === HELPR && !(await helprPayout(E.task)), `  the task is closed on that Helpr, unpaid, no longer offered (${tE.status}, ${tE.helpr_id})`);
const dbtE = (await svc(`SELECT d.seller_id::text AS who, d.amount_cents FROM public.declutter_seller_fee_debts d JOIN public.declutter_refunds r ON r.id = d.refund_id WHERE r.order_id = '${E.order}'`))?.[0];
ok(dbtE?.who === HELPR && dbtE?.amount_cents > 0, `  the released Helpr owes the card fee (${short(dbtE)})`);
ok((await strikes()) === strikesE + 1, "  the strike is the released Helpr's");
ok(/not paid for this delivery/.test(await noteTo(HELPR, "Delivery decided") ?? ""), "  the released Helpr is told");
// Taken again by another Helpr: the task's Helpr is the one now on it (unchanged rule), never the released one.
const F = await taken(6);
await svc(`SELECT public.helpr_task_reopen('${F.task}', 'released', '${HELPR}', NULL)`);
const NEXT = USERS.BUYER;
const upF = await run(`UPDATE public.helpr_tasks SET status = 'picked_up', helpr_id = '${NEXT}', accepted_at = now(), pickup_slot_start = now() - interval '1 hour',
  picked_up_at = now(), pickup_photo_path = '${NEXT}/task/${F.task}/pick.jpg' WHERE id = '${F.task}'`);
ok(!upF?.error && (await task(F.task)).status === "picked_up", `another Helpr takes it and picks it up${upF?.error ? `: ${upF.error}` : ""}`);
const pF = await report(F.order);
const dF = await decide(pF, "refund_buyer", "helpr");
ok(refused(dF, /helpr_fault_not_possible/), `picked up by the next Helpr: still not this decision (${short(dF)})`);
ok((await task(F.task)).released_helpr_id === HELPR, "  the released id stays on the task as a record");
// B48 (lead 10-31): a released Helpr who is also an admin can't decide their own delivery. Released, so helpr_id is
// NULL: only the released_helpr_id check can refuse them (they are neither the buyer nor the seller).
const G = await taken(7);
await svc(`SELECT public.helpr_task_reopen('${G.task}', 'helpr_no_show', '${HELPR}', 'the seller said the Helpr did not come')`);
const pG = await report(G.order);
await svc(`INSERT INTO public.user_roles (user_id, role) VALUES ('${HELPR}', 'admin')`);
ok(one(await svc(`SELECT public.has_role('${HELPR}', 'admin')`)) === true, "the released Helpr is an admin here");
const tG0 = await task(G.task);
ok(tG0.helpr_id === null && tG0.released_helpr_id === HELPR, `released before the decision (${tG0.helpr_id}, ${tG0.released_helpr_id})`);
const dG = await me(HELPR, `SELECT public.declutter_admin_decide_problem('${pG}', 'refund_buyer', 'seller', false, 'x', false, NULL) AS r`);
ok(refused(dG, /not_authorized/), `  a released Helpr who is an admin can't decide their own delivery (${short(dG)})`);
await svc(`DELETE FROM public.user_roles WHERE user_id = '${HELPR}' AND role = 'admin'`);
ok(one(await svc(`SELECT status FROM public.declutter_problems WHERE id = '${pG}'`)) === "open", "  the problem is still open for another admin");
// B48 (lead 10-31): the decision screen's warning. E's released Helpr got the delivery_no_show strike for E's task
// when it was decided; G's has none. problem_case says so per problem (the same test give_job_strike refuses a second by).
const caseOf = async (pid) => (await me(ADMIN, `SELECT * FROM public.declutter_admin_problem_case('${pid}')`))?.[0];
const cE = await caseOf(pE);
ok(cE?.helpr_has_delivery_strike === true, `the screen is told E's released Helpr already has a strike for this delivery (${short(cE)})`);
const cG = await caseOf(pG);
ok(cG?.helpr_has_delivery_strike === false, `  and that G's has none (${short(cG)})`);
const cA = await caseOf(pA);
ok(cA?.helpr_has_delivery_strike === true, `  the Helpr on A (not released) is found too (${short(cA)})`);
// Struck and released before anyone decided (the seller's no-show report does both): only released_helpr_id finds them.
const H = await taken(8);
await svc(`SELECT public.helpr_task_give_job_strike('${HELPR}', 'delivery_no_show', '${H.task}', 'the seller said the Helpr did not come')`);
await svc(`SELECT public.helpr_task_reopen('${H.task}', 'helpr_no_show', '${HELPR}', 'the seller said the Helpr did not come')`);
const pH = await report(H.order);
const cH = await caseOf(pH);
ok((await task(H.task)).helpr_id === null && cH?.helpr_has_delivery_strike === true, `  a released Helpr struck for this delivery is found (${short(cH)})`);
ok(refused(await me(BUYER, `SELECT * FROM public.declutter_admin_problem_case('${pG}')`), /not_admin/), "  a member still can't read it");

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
