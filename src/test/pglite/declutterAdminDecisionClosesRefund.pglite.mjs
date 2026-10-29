#!/usr/bin/env node
/**
 * PGlite proof for 20261029224147_declutter_admin_decision_closes_refund_request (Declutter audit 1b #5, #12, and
 * the "arrange it in Messages" notices): Louisiana Helpr's decision on a problem ends the refund request it came
 * with (a refund: 'agreed' with the refund; paying the seller: 'declined'), the view says Louisiana Helpr decided,
 * a refund that kept the card fee says why in the notice, and no refund notice sends anyone to Messages.
 *
 *   node src/test/pglite/declutterAdminDecisionClosesRefund.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterAdminDecisionClosesRefund.pglite.mjs  # RED: the bodies before it
 *   MIGRATION_PATH=<planted copy> node ...                                                 # RED on a planted defect
 *
 * World: scripts/declutter/handoverPhotoWorld.mjs (slices 1-4, the refund requests 20261026155251, seller delivery
 * 20261027153244 with its declutter_refund_after_handover, ...), then the newest declutter_admin_decide_problem
 * before this migration (20261029000048, its function statement only: its other callees are stubbed below when
 * the world lacks them), then this migration 3x.
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261029224147_declutter_admin_decision_closes_refund_request.sql";
const DECIDE_BASE = "20261029000048_declutter_false_report_strike.sql";
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");
const { svc, run, one, me, liveItemSql, USERS } = await buildHandoverWorld();
const { SELLER, BUYER, BUYER2, BUYER3, ADMIN } = USERS;

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };

// The newest declutter_admin_decide_problem before this migration, statement and grants only.
{
  const s = readFileSync(`${MIG_DIR}${DECIDE_BASE}`, "utf8");
  const at = s.indexOf("DROP FUNCTION IF EXISTS public.declutter_admin_decide_problem(");
  const r = await run(s.slice(at));
  ok(!r?.error, `base ${DECIDE_BASE} (decide_problem) applies${r?.error ? `: ${r.error}` : ""}`);
}
// Callees the world lacks (each is on prod; only what the decision's notices need).
await run(`DO $$ BEGIN
  IF to_regprocedure('public.declutter_order_items_named(uuid)') IS NULL THEN
    CREATE FUNCTION public.declutter_order_items_named(p_order uuid) RETURNS text LANGUAGE sql STABLE AS
      $f$ SELECT '"' || string_agg(i.title, '", "') || '"' FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id WHERE c.order_id = p_order $f$;
  END IF;
END $$;`);
if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}

const I = (n) => `22442244-0000-0000-0000-${String(n).padStart(12, "0")}`;
const CARD_FEE = 150;
async function handedOver(n, buyer, price) {
  await run(liveItemSql({ id: I(n), seller: SELLER, title: `Decided item ${n}`, price, floor: Math.min(price, 100) }));
  await me(buyer, `SELECT public.declutter_buy_now('${I(n)}', ${price})`);
  const o = (await me(buyer, `SELECT * FROM public.declutter_start_checkout('${SELLER}', 'pickup_home')`))?.[0] ?? {};
  await svc(`SELECT public.declutter_mark_order_paid('${o.order_id}', 'pi_d25_${n}', ${o.total_cents}, now(), ${CARD_FEE})`);
  const h = one(await me(buyer, `SELECT public.declutter_confirm_handover('${o.order_id}', 'buyer', NULL) AS r`));
  ok(h?.result === "handed_over", `fixture ${n}: a paid sale, handed over`);
  return o;
}
const req = async (id) => (await svc(`SELECT * FROM public.declutter_refund_requests WHERE order_id = '${id}'`))?.[0] ?? {};
const toAdmin = async (buyer, id) => {
  await me(buyer, `SELECT public.declutter_ask_refund('${id}', 'not_as_described', 'The shade is torn and the photos hid it.')`);
  const r = await req(id);
  const p = one(await svc(`SELECT public.declutter_refund_request_to_admin('${r.id}', 'The seller did not answer in 24 hours.')`));
  return { r: await req(id), problem: p };
};
const decide = (problem, decision, fault) =>
  me(ADMIN, `SELECT public.declutter_admin_decide_problem('${problem}', '${decision}', '${fault}', false, 'Decided in the proof', false) AS r`);
const view = async (uid, id) => one(await me(uid, `SELECT public.declutter_refund_request_view('${id}') AS v`));
const lastNotice = async (uid, title) =>
  (await svc(`SELECT message FROM public.notifications WHERE user_id = '${uid}' AND title = '${title}' ORDER BY created_at DESC LIMIT 1`))?.[0]?.message ?? "";

// 1. A request sent to Louisiana Helpr, decided as a no-fault refund: agreed, with the refund.
{
  const o = await handedOver(1, BUYER, 1200);
  const { r, problem } = await toAdmin(BUYER, o.order_id);
  ok(r.status === "to_admin" && !!problem, "fixture: the request went to Louisiana Helpr with a problem");
  const d = await decide(problem, "refund_buyer", "none");
  ok(Array.isArray(d), `the admin refunds the buyer${Array.isArray(d) ? "" : `: ${d?.error}`}`);
  const after = await req(o.order_id);
  const refund = (await svc(`SELECT id FROM public.declutter_refunds WHERE order_id = '${o.order_id}'`))?.[0]?.id;
  ok(after.status === "agreed", "  the request is closed as agreed (was to_admin)");
  ok(!!refund && after.refund_id === refund && !!after.settled_at, "  with the refund it settled on, and when");
  const vb = await view(BUYER, o.order_id);
  const vs = await view(SELLER, o.order_id);
  ok(vb?.request?.status === "agreed" && vb?.request?.admin_decided === true, "  the buyer's view: agreed, decided by Louisiana Helpr");
  ok(vs?.request?.admin_decided === true, "  the seller's view says the same");
  const n = await lastNotice(BUYER, "Refund on its way");
  ok(/the card network kept for the payment, which it doesn't give back/.test(n), "  the no-fault refund notice says why it is less than was paid (#12)");
  ok(/message the seller from your order/.test(n) && !/Messages/.test(n), "  and sends the buyer to the order, not to Messages");
  ok(/message the buyer from your order/.test(await lastNotice(SELLER, "Buyer refunded")), "  the seller's notice too");
}

// 2. Decided for the seller: declined.
{
  const o = await handedOver(2, BUYER2, 2000);
  const { problem } = await toAdmin(BUYER2, o.order_id);
  const d = await decide(problem, "pay_seller", "buyer");
  ok(Array.isArray(d), `the admin pays the seller${Array.isArray(d) ? "" : `: ${d?.error}`}`);
  const after = await req(o.order_id);
  ok(after.status === "declined" && !!after.declined_at && after.refund_id === null, "  the request is closed as declined, nothing refunded");
  ok((await view(BUYER2, o.order_id))?.request?.admin_decided === true, "  the buyer's view: decided by Louisiana Helpr (not the seller's no)");
  ok(one(await svc(`SELECT public.declutter_sale_final('${o.order_id}')`)) === true, "  and the sale is final");
}

// 3. A seller-fault refund keeps nothing back, so no card-network line; a seller's own "no" is not an admin decision.
{
  const o = await handedOver(3, BUYER3, 1500);
  const { problem } = await toAdmin(BUYER3, o.order_id);
  await decide(problem, "refund_buyer", "seller");
  ok((await req(o.order_id)).status === "agreed", "a seller-fault refund closes the request as agreed too");
  ok(!/card network/.test(await lastNotice(BUYER3, "Refund on its way")), "  and its notice has no card-network line (everything came back)");
}
{
  const o = await handedOver(4, BUYER, 1100);
  await me(BUYER, `SELECT public.declutter_ask_refund('${o.order_id}', 'damaged', 'A leg is cracked.')`);
  const r = await req(o.order_id);
  await me(SELLER, `SELECT public.declutter_answer_refund('${r.id}', 'decline', NULL)`);
  const v = await view(BUYER, o.order_id);
  ok(v?.request?.status === "declined" && v?.request?.admin_decided === false, "a seller's own no reads as not decided by Louisiana Helpr");
}

// 4. The seller agrees to a full refund: the notice sends the buyer to the order, not to Messages.
{
  const o = await handedOver(5, BUYER2, 1300);
  await me(BUYER2, `SELECT public.declutter_ask_refund('${o.order_id}', 'damaged', 'Cracked.')`);
  const r = await req(o.order_id);
  await me(SELLER, `SELECT public.declutter_answer_refund('${r.id}', 'full', NULL)`);
  const n = await lastNotice(BUYER2, "The seller agreed to a full refund");
  ok(/message the seller from your order/.test(n) && !/Messages/.test(n), "the full-refund-agreed notice sends the buyer to the order");
}

// 5. A problem on a paid (not handed-over) sale still decides as before.
{
  await run(liveItemSql({ id: I(6), seller: SELLER, title: "Decided item 6", price: 900, floor: 100 }));
  await me(BUYER3, `SELECT public.declutter_buy_now('${I(6)}', 900)`);
  const o = (await me(BUYER3, `SELECT * FROM public.declutter_start_checkout('${SELLER}', 'pickup_home')`))?.[0] ?? {};
  await svc(`SELECT public.declutter_mark_order_paid('${o.order_id}', 'pi_d25_6', ${o.total_cents}, now(), ${CARD_FEE})`);
  const p = one(await me(BUYER3, `SELECT public.declutter_report_problem('${o.order_id}', 'not_received', 'The seller never came out.', NULL) AS r`));
  const d = await decide(p, "refund_buyer", "seller");
  ok(Array.isArray(d) && one(await svc(`SELECT status FROM public.declutter_orders WHERE id = '${o.order_id}'`)) === "refunded",
    `a problem before the handover still refunds and cancels the order${Array.isArray(d) ? "" : `: ${d?.error}`}`);
}

// 6. Grants as their newest definitions.
{
  const acl = async (role, fn) => one(await svc(`SELECT has_function_privilege('${role}', '${fn}', 'EXECUTE')`));
  ok(await acl("anon", "public.declutter_admin_decide_problem(uuid, text, text, boolean, text, boolean)") === false
     && await acl("anon", "public.declutter_refund_request_view(uuid)") === false
     && await acl("anon", "public.declutter_answer_refund(uuid, text, integer)") === false
     && await acl("authenticated", "public.declutter_refund_after_handover(uuid, text, integer)") === false,
    "anon reaches none of them; refund_after_handover stays service-only");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
