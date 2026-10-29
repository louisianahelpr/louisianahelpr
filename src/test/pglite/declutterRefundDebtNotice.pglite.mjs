#!/usr/bin/env node
/**
 * PGlite proof for 20261029232103_declutter_refund_debt_notice (Declutter audit 1b #6): when a refund leaves the seller
 * owing money (fee policy full_seller_pays_fee records a declutter_seller_fee_debts row), the seller is told once, in
 * words with no fee name; a refund that leaves nothing owed tells them nothing new.
 *
 *   node src/test/pglite/declutterRefundDebtNotice.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterRefundDebtNotice.pglite.mjs  # RED: the body before it
 *   MIGRATION_PATH=<planted copy> node ...                                        # RED on a planted defect
 *
 * World: scripts/declutter/handoverPhotoWorld.mjs (declutter_record_refund at its newest, 20261026155251); this
 * migration 3x.
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261029232103_declutter_refund_debt_notice.sql";
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");
const { svc, run, one, me, liveItemSql, USERS } = await buildHandoverWorld();
const { SELLER, BUYER, BUYER2 } = USERS;

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };

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
const notices = async () => (await svc(`SELECT message FROM public.notifications WHERE user_id = '${SELLER}' AND title = 'You owe from a refund' ORDER BY created_at`)) ?? [];

// 1. The seller's fault: a debt, and the seller is told once (a replay records nothing new and says nothing new).
{
  const o = await paid(1, BUYER, 2000);
  const r1 = one(await svc(`SELECT public.declutter_record_refund('${o.order_id}', 'pi_debt_1', 'seller_backed_out', ${o.total_cents}, 69)`));
  ok(typeof r1 === "string", "fixture: a refund for a seller who backed out is recorded");
  const debt = (await svc(`SELECT amount_cents, remaining_cents FROM public.declutter_seller_fee_debts WHERE refund_id = '${r1}'`))?.[0];
  ok(debt?.amount_cents === 69, "fixture: it leaves the seller owing $0.69");
  const n = await notices();
  ok(n.length === 1, "the seller is told once");
  ok(n[0]?.message === "This refund leaves you owing $0.69. It comes out of your next Declutter sale's payout.", "  in plain words, with the amount");
  ok(!/fee/i.test(n[0]?.message ?? "x fee"), "  and no fee words");
  await svc(`SELECT public.declutter_record_refund('${o.order_id}', 'pi_debt_1', 'seller_backed_out', ${o.total_cents}, 69)`);
  ok((await notices()).length === 1, "a replayed refund records no second debt and sends no second notice");
}

// 2. Nobody's fault: the card fee is kept from the buyer's refund, nothing owed, no notice.
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
