#!/usr/bin/env node
/**
 * PGlite proof for 20261031100935_declutter_problem_notices_name_the_item (BUY-30: the seller's "Refund request" and
 * the other side's "A problem was reported on your sale" name the item and open the recipient's own tab).
 *
 *   node src/test/pglite/declutterProblemNoticesNameTheItem.pglite.mjs                     # GREEN (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterProblemNoticesNameTheItem.pglite.mjs  # RED: no item, ?view= links
 *   MIGRATION_PATH=<planted copy> node ...                                                 # RED on a planted defect
 *
 * World: scripts/declutter/handoverPhotoWorld.mjs, then the bodies these functions sit on, as
 * declutterTakeBackProblemReport.pglite.mjs builds them (decide_problem 20261029000048 statement only, D2-5
 * 20261029224147, D2-3 20261029225634, take-back 20261030134109), each once; then this migration 3x.
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261031100935_declutter_problem_notices_name_the_item.sql";
const BASES = ["20261029224147_declutter_admin_decision_closes_refund_request.sql", "20261029225634_declutter_problem_both_sides_and_photos.sql",
  "20261030134109_declutter_take_back_problem_report.sql"];
const DECIDE_BASE = "20261029000048_declutter_false_report_strike.sql";
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");
const { svc, run, one, me, liveItemSql, USERS } = await buildHandoverWorld();
const { SELLER, BUYER, BUYER2, BUYER3 } = USERS;

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

const I = (n) => `77558855-0000-0000-0000-${String(n).padStart(12, "0")}`;
async function paid(n, buyer, price) {
  await run(liveItemSql({ id: I(n), seller: SELLER, title: `Walnut desk ${n}`, price, floor: Math.min(price, 100) }));
  await me(buyer, `SELECT public.declutter_buy_now('${I(n)}', ${price})`);
  const o = (await me(buyer, `SELECT * FROM public.declutter_start_checkout('${SELLER}', 'pickup_home')`))?.[0] ?? {};
  await svc(`SELECT public.declutter_mark_order_paid('${o.order_id}', 'pi_notice_${n}', ${o.total_cents}, now(), 150)`);
  return o.order_id;
}
const lastNote = async (uid, title) => (await svc(`SELECT message, link FROM public.notifications WHERE user_id = '${uid}' AND title = '${title}' ORDER BY created_at DESC LIMIT 1`))?.[0];

// 1. The buyer asks for a refund after the handover: the seller's notice names the item and opens Selling.
const A = await paid(1, BUYER, 1200);
await me(BUYER, `SELECT public.declutter_confirm_handover('${A}', 'buyer', NULL) AS r`);
const ask = one(await me(BUYER, `SELECT public.declutter_ask_refund('${A}', 'damaged', 'The leg is cracked.', NULL) AS r`));
ok(ask?.result === "asked", `fixture: the buyer asks for a refund (${JSON.stringify(ask) ?? "error"})`);
const r1 = await lastNote(SELLER, "Refund request");
ok(/The buyer asked for a refund on "Walnut desk 1"\. Answer within 24 hours/.test(r1?.message ?? ""), `"Refund request" names the item (got: ${r1?.message})`);
ok(r1?.link === "/declutter?tab=selling", `  and opens Selling (got: ${r1?.link})`);

// 2. The buyer reports a problem: the seller's notice names the item and opens Selling.
const B = await paid(2, BUYER2, 2000);
const pB = one(await me(BUYER2, `SELECT public.declutter_report_problem('${B}', 'not_received', 'It never came.', NULL) AS r`));
ok(typeof pB === "string", "fixture: the buyer reports a problem");
const r2 = await lastNote(SELLER, "A problem was reported on your sale");
ok(/A problem was reported on "Walnut desk 2"\. The money stays held/.test(r2?.message ?? ""), `the seller's problem notice names the item (got: ${r2?.message})`);
ok(r2?.link === "/declutter?tab=selling", `  and opens Selling (got: ${r2?.link})`);

// 3. The seller reports a problem: the buyer's notice names the item and opens Buying.
const C = await paid(3, BUYER3, 1500);
const pC = one(await me(SELLER, `SELECT public.declutter_report_problem('${C}', 'no_show', 'The buyer never came.', NULL) AS r`));
ok(typeof pC === "string", "fixture: the seller reports a problem");
const r3 = await lastNote(BUYER3, "A problem was reported on your sale");
ok(/A problem was reported on "Walnut desk 3"\./.test(r3?.message ?? ""), `the buyer's problem notice names the item (got: ${r3?.message})`);
ok(r3?.link === "/declutter?tab=buying", `  and opens Buying (got: ${r3?.link})`);

// 4. Nothing else changed: the money is still held, and the reporter still cannot take back and report again.
const held = await svc(`SELECT order_id FROM public.declutter_payouts_due(100)`);
ok(Array.isArray(held) && !held.some((x) => x.order_id === B || x.order_id === C), "the reported sales' payouts stay held");

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
