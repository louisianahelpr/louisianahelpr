#!/usr/bin/env node
/**
 * PGlite proof for 20261015023613_declutter_buyer_fee_f1 (owner decision F1,
 * docs/specs/louisiana-hub-roadmap.md: the Declutter buyer's fee is 5% of the
 * item total + 70c, card cost inside it, once per seller checkout), on top of
 * slices 1-3b and the $1,000 cap.
 *
 *   node src/test/pglite/declutterFeeF1.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/declutterFeeF1.pglite.mjs     # RED: the F1 checks fail
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterFeeF1.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { setupStatements, liveItemSql, CARDS_SQL, USERS, FEE_F1_FILE } from "../../../scripts/declutter/slice3Harness.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const { SELLER, BUYER, BUYER2, BUYER3, SELLER2 } = USERS;
const skip = process.env.NEW_MIGRATION === "skip";
const F1 = readFileSync(process.env.MIGRATION_PATH ?? new URL(`../../../supabase/migrations/${FEE_F1_FILE}`, import.meta.url).pathname, "utf8");

const db = new PGlite();
for (const sql of setupStatements({ times: 1, times3b: 1 })) await db.exec(sql);
await db.exec(CARDS_SQL);
await db.exec(`CREATE OR REPLACE FUNCTION public.log_cron_defect(a text, b text, c text) RETURNS void LANGUAGE plpgsql AS $f$ BEGIN RAISE WARNING 'cron defect % % %', a, b, c; END $f$;`);

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const svc = async (sql) => { try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e), code: e.code }; } };
async function me(uid, sql) {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${uid}'; SET ROLE authenticated;`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  }
}
const refused = (r, re) => !Array.isArray(r) && re.test(r.error);
const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);
const I = (n) => `44444444-0000-0000-0000-${String(n).padStart(12, "0")}`;
const item = (n, seller, price) => db.exec(liveItemSql({ id: I(n), seller, title: `Fee item ${n}`, price, floor: Math.min(price, 100) }));
const buy = (uid, n, cents) => me(uid, `SELECT public.declutter_buy_now('${I(n)}', ${cents})`);
const checkout = async (uid, seller) => (await me(uid, `SELECT * FROM public.declutter_start_checkout('${seller}', 'porch')`))[0];

// A legacy order frozen under the OLD rule before F1 lands (15%, $1 minimum).
await item(1, SELLER2, 4000);
await buy(BUYER3, 1, 4000);
const legacy = await checkout(BUYER3, SELLER2);
ok(legacy?.premium_cents === 600 && legacy.total_cents === 4600, "before F1: a $40 order froze the old 15% = $6 fee");

if (!skip) for (let i = 0; i < 3; i++) await db.exec(F1);

const legacyRow = (await svc(`SELECT fee_rule, premium_cents, total_cents FROM public.declutter_orders WHERE id = '${legacy?.order_id}'`))[0];
ok(legacyRow?.fee_rule === "premium15" && legacyRow.total_cents === 4600, "the order frozen before F1 keeps its number (marked premium15, never rewritten)");
ok(one(await svc(`SELECT public.declutter_mark_order_paid('${legacy?.order_id}', 'pi_legacy', 4600, now(), 163) AS r`))?.result === "paid",
  "and it can still be paid at the amount the buyer was shown");

// F1 numbers, each its own buyer/seller pair (one open order per pair).
const cases = [
  { n: 10, buyer: BUYER, seller: SELLER, prices: [1000], fee: 120, total: 1120, label: "$10 order: fee 50c + 70c = $1.20, total $11.20" },
  { n: 11, buyer: BUYER2, seller: SELLER, prices: [5000], fee: 320, total: 5320, label: "$50 order: fee $2.50 + 70c = $3.20, total $53.20" },
  { n: 12, buyer: BUYER3, seller: SELLER, prices: [20000], fee: 1070, total: 21070, label: "$200 order: fee $10 + 70c = $10.70, total $210.70" },
  { n: 13, buyer: BUYER, seller: SELLER2, prices: [100], fee: 75, total: 175, label: "$1 order: fee 5c + 70c = 75c, total $1.75" },
  { n: 14, buyer: BUYER2, seller: SELLER2, prices: [200], fee: 80, total: 280, label: "$2 order: fee 10c + 70c = 80c, total $2.80" },
];
for (const c of cases) {
  let k = c.n * 10;
  for (const p of c.prices) { await item(k, c.seller, p); await buy(c.buyer, k, p); k++; }
  const o = await checkout(c.buyer, c.seller);
  ok(o?.premium_cents === c.fee && o.total_cents === c.total, c.label);
  const est = Number(one(await svc(`SELECT public.declutter_card_fee_estimate(${o?.total_cents ?? 0})`)));
  ok(o?.premium_cents - est > 0, `  card cost on that charge is ${est}c, the platform keeps ${o?.premium_cents - est}c (never below zero)`);
  if (o?.order_id) await svc(`SELECT public.declutter_mark_order_paid('${o.order_id}', 'pi_f1_${c.n}', ${o.total_cents}, now(), NULL)`);
}
// Several items, one 70c (row 38).
await item(150, SELLER2, 300); await item(151, SELLER2, 400);
await buy(BUYER3, 150, 300); await buy(BUYER3, 151, 400);
const multi = await checkout(BUYER3, SELLER2);
ok(multi?.items_cents === 700 && multi.premium_cents === 105 && multi.total_cents === 805, "two items ($3 + $4) from one seller: one fee, 35c + 70c = $1.05");
ok(one(await svc(`SELECT fee_rule FROM public.declutter_orders WHERE id = '${multi?.order_id}'`)) === "f1", "new orders are on F1");

// The table holds every row to its rule; no caller can pick the old one.
ok(refused(await svc(`INSERT INTO public.declutter_orders (buyer_id, seller_id, handover, items_cents, premium_cents, total_cents, fee_rule)
                      VALUES ('${BUYER}', '${SELLER2}', 'porch', 4000, 600, 4600, 'premium15')`), /declutter_orders_premium_rule/),
  "a new order cannot be written under the old 15% rule (the trigger forces F1, the CHECK refuses $6)");
ok(refused(await svc(`INSERT INTO public.declutter_orders (buyer_id, seller_id, handover, items_cents, premium_cents, total_cents)
                      VALUES ('${BUYER}', '${SELLER2}', 'porch', 4000, 269, 4269)`), /declutter_orders_premium_rule/),
  "the table refuses an F1 fee off by one cent");
// The change below satisfies every CHECK (720c of items -> 36c + 70c = $1.06, total
// $8.26), so ONLY the amounts-frozen trigger can refuse it (red with the trigger removed).
ok(Number(one(await svc(`SELECT count(*) FROM public.declutter_orders WHERE id = '${multi?.order_id}'
                         AND premium_cents + 1 = round((items_cents + 20) * 0.05)::integer + 70`))) === 1,
  "  (the planted change below is a valid F1 row: the CHECKs alone would accept it)");
ok(refused(await svc(`UPDATE public.declutter_orders SET items_cents = items_cents + 20, premium_cents = premium_cents + 1,
                      total_cents = total_cents + 21 WHERE id = '${multi?.order_id}'`), /order_amounts_frozen/),
  "an order's amounts cannot be changed after checkout froze them");
// Money review 1.1: the freeze itself names tax_cents (before the fix the total CHECK refused it with a
// different error, so this regex is red without the tax line in the trigger).
ok(refused(await svc(`UPDATE public.declutter_orders SET tax_cents = tax_cents + 1 WHERE id = '${multi?.order_id}'`), /order_amounts_frozen/),
  "an order's tax line cannot be changed after checkout froze it");
ok(refused(await svc(`UPDATE public.declutter_orders SET fee_rule = 'premium15' WHERE id = '${multi?.order_id}'`), /order_amounts_frozen/),
  "an order cannot be moved to the other fee rule");
ok(Number(one(await me(BUYER, `SELECT public.declutter_buyer_fee_cents(1000)`))) === 120, "members can preview the fee with the server's own function");
ok(refused(await db.query(`SET ROLE anon`).then(() => db.query(`SELECT public.declutter_buyer_fee_cents(1000)`)).then((r) => r.rows, (e) => ({ error: String(e.message) })).finally(() => db.exec("RESET ROLE")), /permission denied/),
  "anon cannot call it (REVOKE ... FROM PUBLIC, anon)");

console.log(`\n${pass} passed, ${fail} failed${skip ? " (NEW_MIGRATION=skip: RED baseline)" : ""}`);
process.exit(fail ? 1 : 0);
