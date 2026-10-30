#!/usr/bin/env node
/**
 * PGlite proof for 20261030134109_declutter_take_back_problem_report (owner 2026-10-30: "take back my report" until
 * Louisiana Helpr acts). The reporter withdraws an OPEN problem; the payout hold lifts on the ORIGINAL clock (not
 * restarted); a refund request that went to Louisiana Helpr with a buyer's report is withdrawn with it; nobody else
 * can withdraw it; a decided problem cannot be withdrawn; the reporter cannot report that sale again.
 *
 *   node src/test/pglite/declutterTakeBackProblemReport.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterTakeBackProblemReport.pglite.mjs  # RED: no withdraw
 *   MIGRATION_PATH=<planted copy> node ...                                             # RED on a planted defect
 *
 * World: scripts/declutter/handoverPhotoWorld.mjs, then the bodies this migration sits on, as
 * declutterProblemBothSides.pglite.mjs builds them: decide_problem 20261029000048 (statement only), D2-5
 * 20261029224147, D2-3 20261029225634 (the effective declutter_report_problem), each once; then this migration 3x.
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261030134109_declutter_take_back_problem_report.sql";
const D23 = "20261029225634_declutter_problem_both_sides_and_photos.sql";
const D25 = "20261029224147_declutter_admin_decision_closes_refund_request.sql";
const DECIDE_BASE = "20261029000048_declutter_false_report_strike.sql";
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");
const { svc, run, one, me, refused, liveItemSql, USERS } = await buildHandoverWorld();
const { SELLER, BUYER, BUYER2, BUYER3, ADMIN } = USERS;

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };

{
  const s = readFileSync(`${MIG_DIR}${DECIDE_BASE}`, "utf8");
  const r = await run(s.slice(s.indexOf("DROP FUNCTION IF EXISTS public.declutter_admin_decide_problem(")));
  ok(!r?.error, `base ${DECIDE_BASE} (decide_problem) applies${r?.error ? `: ${r.error}` : ""}`);
}
await run(`DO $$ BEGIN
  IF to_regprocedure('public.declutter_order_items_named(uuid)') IS NULL THEN
    CREATE FUNCTION public.declutter_order_items_named(p_order uuid) RETURNS text LANGUAGE sql STABLE AS
      $f$ SELECT '"' || string_agg(i.title, '", "') || '"' FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id WHERE c.order_id = p_order $f$;
  END IF;
END $$;`);
for (const f of [D25, D23]) {
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

const I = (n) => `77557755-0000-0000-0000-${String(n).padStart(12, "0")}`;
async function paid(n, buyer, price) {
  await run(liveItemSql({ id: I(n), seller: SELLER, title: `Take back item ${n}`, price, floor: Math.min(price, 100) }));
  await me(buyer, `SELECT public.declutter_buy_now('${I(n)}', ${price})`);
  const o = (await me(buyer, `SELECT * FROM public.declutter_start_checkout('${SELLER}', 'pickup_home')`))?.[0] ?? {};
  await svc(`SELECT public.declutter_mark_order_paid('${o.order_id}', 'pi_takeback_${n}', ${o.total_cents}, now(), 150)`);
  return o.order_id;
}
const gotIt = (buyer, id) => me(buyer, `SELECT public.declutter_confirm_handover('${id}', 'buyer', NULL) AS r`);
const report = (uid, id, reason, note) => me(uid, `SELECT public.declutter_report_problem('${id}', '${reason}', '${note}', NULL) AS r`);
const withdraw = (uid, pid) => me(uid, `SELECT public.declutter_withdraw_problem('${pid}') AS r`);
const problemRow = async (pid) => (await svc(`SELECT * FROM public.declutter_problems WHERE id = '${pid}'`))?.[0] ?? {};
const due = async (orderId) => {
  const r = await svc(`SELECT order_id FROM public.declutter_payouts_due(100)`);
  return Array.isArray(r) && r.some((x) => x.order_id === orderId);
};
const lastNote = async (uid, title) => (await svc(`SELECT message, link FROM public.notifications WHERE user_id = '${uid}' AND title = '${title}' ORDER BY created_at DESC LIMIT 1`))?.[0];

// 1. The buyer's report after the handover holds the payout; taking it back lifts the hold on the original clock.
const A = await paid(1, BUYER, 1200);
await gotIt(BUYER, A);
const pA = one(await report(BUYER, A, "damaged", "The leg is cracked."));
ok(typeof pA === "string", "fixture: the buyer reports a problem in the 24 hours after the handover");
// The 24 hours ran out while the problem was open; the payout is otherwise ready.
await run(`UPDATE public.declutter_orders SET handed_over_at = now() - interval '30 hours' WHERE id = '${A}';
           UPDATE public.declutter_payouts SET next_attempt_at = now() - interval '1 minute' WHERE order_id = '${A}'`);
ok(one(await svc(`SELECT count(*) FROM public.declutter_payouts WHERE order_id = '${A}'`)) >= 1, "fixture: the sale has a payout row");
ok((await due(A)) === false, "while the problem is open, the payout is held (not in declutter_payouts_due)");
ok(refused(await withdraw(SELLER, pA), /problem_not_found/), "the other side cannot take it back (problem_not_found)");
ok(refused(await withdraw(BUYER3, pA), /problem_not_found/), "a stranger cannot (problem_not_found)");
ok(refused(await withdraw(ADMIN, pA), /problem_not_found/), "an admin who is not a side cannot either (they decide instead)");
const w = one(await withdraw(BUYER, pA));
ok(w?.result === "withdrawn", `the buyer takes back their report (${JSON.stringify(w) ?? "error"})`);
const rowA = await problemRow(pA);
ok(rowA.status === "withdrawn" && !!rowA.withdrawn_at && rowA.decision === null && rowA.decided_at === null, "  the problem is 'withdrawn' with withdrawn_at, no decision");
ok((await due(A)) === true, "  the hold lifts: the payout is due at once, because the 24 hours ran from the handover (not restarted)");
ok(one(await withdraw(BUYER, pA))?.result === "already", "taking it back again answers 'already'");
const told = await lastNote(SELLER, "Problem report taken back");
ok(/The buyer took back their problem report on "Take back item 1"/.test(told?.message ?? "") && told?.link === "/declutter?view=selling",
  `  the seller is told, on their Selling tab (got: ${told?.message})`);
ok(!!(await lastNote(ADMIN, "Declutter problem taken back")), "  the admins are told it left the queue");
ok(refused(await report(BUYER, A, "damaged", "Again."), /problem_taken_back|sale_final/), "the buyer cannot report that sale again");

// 2. Before the handover: the buyer cannot report again after taking it back; the seller still can.
const B = await paid(2, BUYER2, 2000);
const pB = one(await report(BUYER2, B, "not_received", "It never came."));
ok(one(await withdraw(BUYER2, pB))?.result === "withdrawn", "fixture: a paid (not handed over) sale's report is taken back");
ok(refused(await report(BUYER2, B, "damaged", "Now it is broken."), /problem_taken_back/), "the buyer who took it back cannot report that sale again (problem_taken_back)");
const pB2 = one(await report(SELLER, B, "no_show", "The buyer never came."));
ok(typeof pB2 === "string" && pB2 !== pB, "the seller can still report that sale (a new open problem)");

// 3. A decided problem cannot be taken back.
await me(ADMIN, `SELECT public.declutter_admin_decide_problem('${pB2}', 'pay_seller', 'none', false, 'ok', false)`);
ok((await problemRow(pB2)).status === "decided", "fixture: Louisiana Helpr decides the seller's report");
ok(refused(await withdraw(SELLER, pB2), /problem_already_decided/), "after the decision it is too late (problem_already_decided)");

// 4. A refund request that went to Louisiana Helpr with the buyer's report is withdrawn with it.
const C = await paid(3, BUYER3, 1500);
await gotIt(BUYER3, C);
const ask = one(await me(BUYER3, `SELECT public.declutter_ask_refund('${C}', 'damaged', 'Torn shade.', NULL) AS r`));
ok(ask?.result === "asked", `fixture: the buyer asks for a refund (${JSON.stringify(ask) ?? "error"})`);
await svc(`UPDATE public.declutter_refund_requests SET status = 'declined', declined_at = now() WHERE order_id = '${C}'`);
const pC = one(await report(BUYER3, C, "damaged", "The seller said no."));
const reqC = async () => (await svc(`SELECT status, problem_id FROM public.declutter_refund_requests WHERE order_id = '${C}'`))?.[0] ?? {};
ok((await reqC()).status === "to_admin" && (await reqC()).problem_id === pC, "fixture: the declined request went to Louisiana Helpr with the report");
ok(one(await withdraw(BUYER3, pC))?.refund_requests_withdrawn === 1, "the buyer takes back the report and the request with it");
ok((await reqC()).status === "withdrawn", "  the request is 'withdrawn', not left 'to_admin' with no open problem");

// 5. Refusals that keep money safe: a return already agreed; a seller's report carrying the buyer's request.
const D = await paid(4, BUYER, 1100);
await gotIt(BUYER, D);
await me(BUYER, `SELECT public.declutter_ask_refund('${D}', 'damaged', 'Dented.', NULL)`);
await svc(`UPDATE public.declutter_refund_requests SET status = 'declined', declined_at = now() WHERE order_id = '${D}'`);
const pD = one(await report(BUYER, D, "damaged", "Dented badly."));
await svc(`UPDATE public.declutter_refund_requests SET return_agreed_at = now() WHERE order_id = '${D}'`);
ok(refused(await withdraw(BUYER, pD), /problem_has_return/), "a report whose request had a return agreed cannot be taken back (problem_has_return)");
ok((await problemRow(pD)).status === "open", "  and it stays open");
await run(`UPDATE public.declutter_refund_requests SET return_agreed_at = NULL WHERE order_id = '${D}';
           UPDATE public.declutter_problems SET reporter_id = '${SELLER}', reporter_side = 'seller' WHERE id = '${pD}'`);
ok(refused(await withdraw(SELLER, pD), /problem_has_refund_request/), "a seller's report carrying the buyer's request cannot be taken back (problem_has_refund_request)");

// 6. The table rule: a withdrawn row has no decision.
const chk = await svc(`UPDATE public.declutter_problems SET decision = 'refund_buyer' WHERE id = '${pA}'`);
ok(refused(chk, /declutter_problems_decided/), "a withdrawn problem with a decision is refused by the CHECK");

// 7. The admin queue drops it (when the queue function is in this world).
if (one(await svc(`SELECT to_regprocedure('public.declutter_admin_open_problems(boolean)') IS NOT NULL`))) {
  const q = await me(ADMIN, `SELECT problem_id FROM public.declutter_admin_open_problems(true)`);
  ok(Array.isArray(q) && !q.some((x) => x.problem_id === pA) && !q.some((x) => x.problem_id === pC), "the admin queue no longer lists the withdrawn problems");
}

// 8. Grants.
const acl = (await svc(`SELECT has_function_privilege('anon', 'public.declutter_withdraw_problem(uuid)', 'EXECUTE') AS a,
                               has_function_privilege('authenticated', 'public.declutter_withdraw_problem(uuid)', 'EXECUTE') AS m`))?.[0];
ok(acl?.a === false && acl?.m === true, "anon cannot run declutter_withdraw_problem; members can");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
