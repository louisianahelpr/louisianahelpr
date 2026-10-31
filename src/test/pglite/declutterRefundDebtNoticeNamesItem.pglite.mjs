#!/usr/bin/env node
/**
 * PGlite proof for 20261031105148_declutter_refund_debt_notice_names_the_item (BUY-30 rest): "You owe from a refund"
 * names the item and opens Selling by its tab address; everything else declutter_record_refund does is unchanged
 * (the debt row, once per refund, nothing owed means no notice, service-only).
 *
 *   node src/test/pglite/declutterRefundDebtNoticeNamesItem.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterRefundDebtNoticeNamesItem.pglite.mjs  # RED: the 20261029232103 body
 *   MIGRATION_PATH=<planted copy> node ...                                                # RED on a planted defect
 *
 * World: scripts/declutter/handoverPhotoWorld.mjs, then 20261029232103 (the body before this one) once and
 * declutter_order_items_named if the world lacks it (as declutterTakeBackProblemReport.pglite.mjs does); this
 * migration 3x.
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261031105148_declutter_refund_debt_notice_names_the_item.sql";
const BEFORE = "20261029232103_declutter_refund_debt_notice.sql";
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");
const { svc, run, one, me, liveItemSql, USERS } = await buildHandoverWorld();
const { SELLER, BUYER, BUYER2 } = USERS;

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };

{
  const r = await run(readFileSync(`${MIG_DIR}${BEFORE}`, "utf8"));
  ok(!r?.error, `base ${BEFORE} applies${r?.error ? `: ${r.error}` : ""}`);
}
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

const I = (n) => `66996699-0000-0000-0000-${String(n).padStart(12, "0")}`;
async function paid(n, buyer, price) {
  await run(liveItemSql({ id: I(n), seller: SELLER, title: `Debt item ${n}`, price, floor: Math.min(price, 100) }));
  await me(buyer, `SELECT public.declutter_buy_now('${I(n)}', ${price})`);
  const o = (await me(buyer, `SELECT * FROM public.declutter_start_checkout('${SELLER}', 'pickup_home')`))?.[0] ?? {};
  await svc(`SELECT public.declutter_mark_order_paid('${o.order_id}', 'pi_debt_${n}', ${o.total_cents}, now(), 69)`);
  return o;
}
const notices = async () => (await svc(`SELECT message, link FROM public.notifications WHERE user_id = '${SELLER}' AND title = 'You owe from a refund' ORDER BY created_at`)) ?? [];

// 1. The seller's fault: a debt, and the seller is told once, naming the item.
{
  const o = await paid(1, BUYER, 2000);
  const r1 = one(await svc(`SELECT public.declutter_record_refund('${o.order_id}', 'pi_debt_1', 'seller_backed_out', ${o.total_cents}, 69)`));
  ok(typeof r1 === "string", "fixture: a refund for a seller who backed out is recorded");
  const debt = (await svc(`SELECT amount_cents, remaining_cents FROM public.declutter_seller_fee_debts WHERE refund_id = '${r1}'`))?.[0];
  ok(debt?.amount_cents === 69 && debt?.remaining_cents === 69, "the debt row is unchanged: $0.69 owed");
  const n = await notices();
  ok(n.length === 1, "the seller is told once");
  ok(n[0]?.message === "This refund on \"Debt item 1\" leaves you owing $0.69. It comes out of your next Declutter sale's payout.",
    `  naming the item, with the amount (${n[0]?.message})`);
  ok(!/fee/i.test(n[0]?.message ?? "x fee"), "  and no fee words");
  ok(n[0]?.link === "/declutter?tab=selling", `  opening Selling (${n[0]?.link})`);
  await svc(`SELECT public.declutter_record_refund('${o.order_id}', 'pi_debt_1', 'seller_backed_out', ${o.total_cents}, 69)`);
  ok((await notices()).length === 1, "a replayed refund records no second debt and sends no second notice");
}

// 2. Nobody's fault: nothing owed, no notice.
{
  const o = await paid(2, BUYER2, 1500);
  await svc(`SELECT public.declutter_record_refund('${o.order_id}', 'pi_debt_2', 'buyer_cancelled', ${o.total_cents}, 69)`);
  ok((await notices()).length === 1, "a refund that leaves nothing owed sends no debt notice");
}

// 3. Grants unchanged.
{
  const acl = async (role) => one(await svc(`SELECT has_function_privilege('${role}', 'public.declutter_record_refund(uuid, text, text, integer, integer)', 'EXECUTE')`));
  ok(await acl("anon") === false && await acl("authenticated") === false && await acl("service_role") === true, "record_refund stays service-only");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
