#!/usr/bin/env node
/**
 * PGlite proof for 20261029231235_declutter_admin_part_refund (Declutter audit 1b #14; owner decided 2026-10-29: "allow
 * partial"): Louisiana Helpr refunds exactly the part it decides (the seller's last offer pre-fills it on the card),
 * only after the handover, above $0 and below the item price; the buyer keeps the item, the seller's payout is
 * rebooked by that amount, and the refund request closes as agreed with that refund.
 *
 *   node src/test/pglite/declutterAdminPartRefund.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterAdminPartRefund.pglite.mjs  # RED: the bodies before it
 *   MIGRATION_PATH=<planted copy> node ...                                       # RED on a planted defect
 *
 * World: scripts/declutter/handoverPhotoWorld.mjs, the newest declutter_admin_decide_problem before D2-5 (20261029000048,
 * its statement only), D2-5 (20261029224147), D2-3 (20261029225634) once each, this migration 3x. The admin card read
 * (declutter_admin_open_problems, 20261028195212) is applied first, as on prod.
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261029231235_declutter_admin_part_refund.sql";
const CHAIN = ["20261029224147_declutter_admin_decision_closes_refund_request.sql", "20261029225634_declutter_problem_both_sides_and_photos.sql"];
const DECIDE_BASE = "20261029000048_declutter_false_report_strike.sql";
const OPEN = "20261028195212_declutter_admin_open_problems.sql";
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
END $$;
ALTER TABLE public.declutter_orders ADD COLUMN IF NOT EXISTS bundle_discount_cents integer NOT NULL DEFAULT 0;`);
for (const f of [OPEN, ...CHAIN]) {
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

const I = (n) => `55775577-0000-0000-0000-${String(n).padStart(12, "0")}`;
const CARD_FEE = 150;
async function paid(n, buyer, price) {
  await run(liveItemSql({ id: I(n), seller: SELLER, title: `Part item ${n}`, price, floor: Math.min(price, 100) }));
  await me(buyer, `SELECT public.declutter_buy_now('${I(n)}', ${price})`);
  const o = (await me(buyer, `SELECT * FROM public.declutter_start_checkout('${SELLER}', 'pickup_home')`))?.[0] ?? {};
  await svc(`SELECT public.declutter_mark_order_paid('${o.order_id}', 'pi_part_${n}', ${o.total_cents}, now(), ${CARD_FEE})`);
  return o;
}
const gotIt = (buyer, id) => me(buyer, `SELECT public.declutter_confirm_handover('${id}', 'buyer', NULL) AS r`);
const req = async (id) => (await svc(`SELECT * FROM public.declutter_refund_requests WHERE order_id = '${id}'`))?.[0] ?? {};
const decide = (pid, decision, fault, part = "NULL", falseReport = false) =>
  me(ADMIN, `SELECT public.declutter_admin_decide_problem(p_problem_id => '${pid}', p_decision => '${decision}', p_fault => '${fault}',
    p_strike => false, p_note => 'proof', p_false_report => ${falseReport}, p_part_cents => ${part}) AS r`);

// 1. The seller offered $5, the buyer sent it to Louisiana Helpr; Louisiana Helpr refunds $5.
const A = await paid(1, BUYER, 2000);
await gotIt(BUYER, A.order_id);
await me(BUYER, `SELECT public.declutter_ask_refund('${A.order_id}', 'damaged', 'A corner is chipped.')`);
let r = await req(A.order_id);
await me(SELLER, `SELECT public.declutter_answer_refund('${r.id}', 'part', 500)`);
await me(BUYER, `SELECT public.declutter_answer_refund_offer('${r.id}', false)`);
r = await req(A.order_id);
ok(r.status === "to_admin" && r.offer_cents === 500 && !!r.problem_id, "fixture: a $5 offer turned down, sent to Louisiana Helpr");
{
  const card = (await me(ADMIN, `SELECT * FROM public.declutter_admin_open_problems(true)`)) ?? [];
  const row = Array.isArray(card) ? card.find((x) => x.problem_id === r.problem_id) : null;
  ok(row?.refund_offer_cents === 500, "the admin card reads the seller's last offer ($5) to pre-fill the part refund");
  ok(refused(await decide(r.problem_id, "refund_part", "none", 2000), /invalid_amount/), "a part refund of the whole item price is refused (that is Refund the buyer)");
  ok(refused(await decide(r.problem_id, "refund_part", "none", 0), /invalid_amount/), "a part refund of $0 is refused");
  ok(refused(await decide(r.problem_id, "refund_part", "none"), /invalid_decision/), "a part refund with no amount is refused");
  ok(refused(await decide(r.problem_id, "refund_buyer", "none", 500), /invalid_decision/), "an amount on a full refund is refused");
  ok(refused(await decide(r.problem_id, "refund_part", "buyer", 500, true), /false_report_mismatch/), "a false report never ends in a part refund");
  const d = await decide(r.problem_id, "refund_part", "none", 500);
  ok(Array.isArray(d), `Louisiana Helpr refunds $5${Array.isArray(d) ? "" : `: ${d?.error}`}`);
  const refund = (await svc(`SELECT * FROM public.declutter_refunds WHERE order_id = '${A.order_id}'`))?.[0] ?? {};
  ok(refund.refund_cents === 500 && refund.fee_policy === "agreed_part" && refund.card_fee_cents === 0, "  exactly $5 back, as a part refund (no card fee kept)");
  const p = (await svc(`SELECT * FROM public.declutter_problems WHERE id = '${r.problem_id}'`))?.[0] ?? {};
  ok(p.decision === "refund_part" && p.status === "decided", "  the problem is decided as a part refund");
  const after = await req(A.order_id);
  ok(after.status === "agreed" && after.refund_id === refund.id && !!after.settled_at, "  the request closes as agreed, with that refund");
  const pay = (await svc(`SELECT * FROM public.declutter_payouts WHERE order_id = '${A.order_id}'`))?.[0] ?? {};
  ok(pay.refunded_cents === 500, "  the seller's payout is rebooked by $5");
  const item = one(await svc(`SELECT status FROM public.declutter_items WHERE id = '${I(1)}'`));
  ok(item === "completed", "  the buyer keeps the item (the listing stays sold, not withdrawn)");
  const bn = (await svc(`SELECT message FROM public.notifications WHERE user_id = '${BUYER}' AND title = 'Louisiana Helpr decided' ORDER BY created_at DESC LIMIT 1`))?.[0]?.message ?? "";
  ok(/refunding you part of the price, and you keep the item/.test(bn), "  the buyer is told it is part, and they keep the item");
  const sn = (await svc(`SELECT message FROM public.notifications WHERE user_id = '${SELLER}' AND title = 'Louisiana Helpr decided' ORDER BY created_at DESC LIMIT 1`))?.[0]?.message ?? "";
  ok(/part of the price; it comes out of your payout/.test(sn), "  the seller is told it comes out of their payout");
}

// 2. Before the handover there is no part refund.
{
  const B = await paid(2, BUYER2, 1500);
  const pid = one(await me(BUYER2, `SELECT public.declutter_report_problem('${B.order_id}', 'not_received', 'Nobody came out.', NULL) AS r`));
  ok(refused(await decide(pid, "refund_part", "seller", 500), /part_refund_after_handover_only/), "a part refund before the handover is refused");
  // The six old named arguments (an installed admin screen) still decide.
  const d = await me(ADMIN, `SELECT public.declutter_admin_decide_problem(p_problem_id => '${pid}', p_decision => 'refund_buyer', p_fault => 'seller',
    p_strike => false, p_note => 'old screen', p_false_report => false) AS r`);
  ok(Array.isArray(d), `the six old named arguments still decide${Array.isArray(d) ? "" : `: ${d?.error}`}`);
}

// 3. One decide function, grants as before.
{
  ok(Number(one(await svc(`SELECT count(*) FROM pg_proc WHERE proname = 'declutter_admin_decide_problem'`))) === 1, "one declutter_admin_decide_problem, no leftover 6-argument overload");
  const acl = async (role, fn) => one(await svc(`SELECT has_function_privilege('${role}', '${fn}', 'EXECUTE')`));
  ok(await acl("anon", "public.declutter_admin_decide_problem(uuid, text, text, boolean, text, boolean, integer)") === false
     && await acl("anon", "public.declutter_admin_open_problems(boolean)") === false, "anon reaches neither");
  ok(refused(await me(BUYER3, `SELECT * FROM public.declutter_admin_open_problems(true)`), /not_admin/), "a member cannot read the admin card");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
