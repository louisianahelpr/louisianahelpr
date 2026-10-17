#!/usr/bin/env node
/**
 * PGlite proof for 20261017055504_declutter_porch_default (spec row 101,
 * owner 2026-10-16: porch pickup is the default; the seller can turn porch off
 * per item; the server refuses a porch checkout when any line's item has it
 * off), on top of slices 1-4, the $1,000 cap and F1. Applied 3 times.
 *
 *   node src/test/pglite/declutterPorchDefault.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/declutterPorchDefault.pglite.mjs   # RED: the migration absent
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterPorchDefault.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { setupStatements, liveItemSql, CARDS_SQL, USERS, FEE_F1_FILE, SLICE4_FILE } from "../../../scripts/declutter/slice3Harness.mjs";

const PORCH_FILE = "20261017055504_declutter_porch_default.sql";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const { SELLER, SELLER2, BUYER, BUYER2, BUYER3, OUTSIDER } = USERS;
const skip = process.env.NEW_MIGRATION === "skip";

const db = new PGlite();
const extra = [{ file: FEE_F1_FILE, times: 1 }, { file: SLICE4_FILE, times: 1 }];
if (!skip) extra.push(process.env.MIGRATION_PATH ? { path: process.env.MIGRATION_PATH, times: 3 } : { file: PORCH_FILE, times: 3 });
for (const sql of setupStatements({ times: 1, times3b: 1, extra })) await db.exec(sql);
await db.exec(CARDS_SQL);

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
const I = (n) => `66666666-0000-0000-0000-${String(n).padStart(12, "0")}`;
const item = (n, seller, price = 2000) => db.exec(liveItemSql({ id: I(n), seller, title: `Porch item ${n}`, price, floor: Math.min(price, 100) }));
const buy = (uid, n, cents = 2000) => me(uid, `SELECT public.declutter_buy_now('${I(n)}', ${cents})`);
// A listed item whose seller turned porch off while it was a draft (the trigger
// refuses the change once listed, so the fixture flips it through draft).
const porchOffListed = async (n) => {
  await svc(`UPDATE public.declutter_items SET status = 'draft' WHERE id = '${I(n)}'`);
  await svc(`UPDATE public.declutter_items SET porch_ok = false WHERE id = '${I(n)}'`);
  await svc(`UPDATE public.declutter_items SET status = 'live' WHERE id = '${I(n)}'`);
};
const checkout = (uid, seller, handover) => me(uid, `SELECT * FROM public.declutter_start_checkout('${seller}', '${handover}')`);

// 1. The column: every listing allows porch unless its seller says otherwise.
ok(one(await svc(`SELECT column_default FROM information_schema.columns
                  WHERE table_name = 'declutter_items' AND column_name = 'porch_ok' AND is_nullable = 'NO'`)) === "true",
  "declutter_items.porch_ok exists, NOT NULL, DEFAULT true (porch is the default)");

// 2. The seller's switch: own draft only.
const draft = one(await me(SELLER, `SELECT public.declutter_create_item('Glass lamp', 'Fragile.', 'other', 4, 'small', 3000, 1000,
  'Mid-City, Baton Rouge', '1234 Example St, Baton Rouge, LA 70806', 30.451234, -91.154321)`));
ok(typeof draft === "string", "a seller creates a draft");
ok(one(await svc(`SELECT porch_ok FROM public.declutter_items WHERE id = '${draft}'`)) === true, "a new draft allows porch");
ok(one(await me(SELLER, `SELECT public.declutter_set_porch_ok('${draft}', false)`)) === false
  && one(await svc(`SELECT porch_ok FROM public.declutter_items WHERE id = '${draft}'`)) === false,
  "the seller turns porch off on their draft");
ok(one(await me(SELLER, `SELECT public.declutter_set_porch_ok('${draft}', true)`)) === true
  && one(await svc(`SELECT porch_ok FROM public.declutter_items WHERE id = '${draft}'`)) === true,
  "and back on");
ok(refused(await me(BUYER, `SELECT public.declutter_set_porch_ok('${draft}', false)`), /item_not_found/)
  && one(await svc(`SELECT porch_ok FROM public.declutter_items WHERE id = '${draft}'`)) === true,
  "another member cannot change someone else's item (item_not_found, nothing changed)");
ok(refused(await me(SELLER, `SELECT public.declutter_set_porch_ok('${draft}', NULL)`), /invalid_porch_choice/),
  "a NULL choice is refused, never stored or read as yes");
ok(refused(await me(OUTSIDER, `SELECT public.declutter_set_porch_ok('${draft}', false)`), /feature_disabled/),
  "an account the switch is off for is refused (require_feature)");
ok(refused(await db.query(`SET ROLE anon`).then(() => db.query(`SELECT public.declutter_set_porch_ok('${draft}', false)`)).then((r) => r.rows, (e) => ({ error: String(e.message) })).finally(() => db.exec("RESET ROLE")), /permission denied/),
  "anon cannot call it (REVOKE ... FROM PUBLIC, anon)");
await item(1, SELLER);
ok(refused(await me(SELLER, `SELECT public.declutter_set_porch_ok('${I(1)}', false)`), /item_not_editable/)
  && one(await svc(`SELECT porch_ok FROM public.declutter_items WHERE id = '${I(1)}'`)) === true,
  "a LISTED item's porch choice is frozen (item_not_editable): no order is paid under a changed choice");

ok(refused(await svc(`UPDATE public.declutter_items SET porch_ok = false WHERE id = '${I(1)}'`), /item_not_editable/),
  "even a service-role write cannot change porch_ok on a listed item (the table trigger)");
ok(one(await svc(`UPDATE public.declutter_items SET porch_ok = false WHERE id = '${draft}' RETURNING porch_ok`)) === false,
  "  while a draft's can still be changed by its writer");

// 3. Checkout: porch refused when any line has porch off.
await item(2, SELLER);
await porchOffListed(2);
await buy(BUYER, 1); await buy(BUYER, 2);
const mixedPorch = await checkout(BUYER, SELLER, "porch");
ok(refused(mixedPorch, /porch_unavailable/), "two lines, one with porch off: a porch checkout is refused (porch_unavailable)");
ok(Number(one(await svc(`SELECT count(*) FROM public.declutter_orders WHERE buyer_id = '${BUYER}'`))) === 0, "  and no order was created");
const mixedHome = (await checkout(BUYER, SELLER, "pickup_home"))[0];
ok(mixedHome?.order_id && mixedHome.items_cents === 4000, "the same cart checks out as pickup at the seller's home");
ok(refused(await checkout(BUYER, SELLER, "porch"), /porch_unavailable/),
  "switching that open order to porch is refused too (the check runs before the idempotent return)");
ok(one(await svc(`SELECT status FROM public.declutter_orders WHERE id = '${mixedHome?.order_id}'`)) === "awaiting_payment",
  "  and the open pickup-at-home order is untouched");

await item(3, SELLER2);
await buy(BUYER2, 3);
const allPorch = (await checkout(BUYER2, SELLER2, "porch"))[0];
ok(allPorch?.order_id && one(await svc(`SELECT handover FROM public.declutter_orders WHERE id = '${allPorch.order_id}'`)) === "porch",
  "every line allows porch: a porch checkout goes through");

await item(4, SELLER2);
await porchOffListed(4);
await buy(BUYER3, 4);
ok(refused(await checkout(BUYER3, SELLER2, "porch"), /porch_unavailable/), "one line with porch off: porch refused");

// 4. The cart tells the app which lines allow porch.
const cart = await me(BUYER, `SELECT item_id, porch_ok FROM public.declutter_my_cart() WHERE my_side = 'buyer' ORDER BY item_id`);
ok(Array.isArray(cart) && cart.length === 2 && cart[0].porch_ok === true && cart[1].porch_ok === false,
  "declutter_my_cart returns porch_ok per line (true, false)");
ok(refused(await db.query(`SET ROLE anon`).then(() => db.query(`SELECT * FROM public.declutter_my_cart()`)).then((r) => r.rows, (e) => ({ error: String(e.message) })).finally(() => db.exec("RESET ROLE")), /permission denied/),
  "anon still cannot read a cart after the restatement");
ok(refused(await db.query(`SET ROLE anon`).then(() => db.query(`SELECT * FROM public.declutter_start_checkout('${SELLER}', 'porch')`)).then((r) => r.rows, (e) => ({ error: String(e.message) })).finally(() => db.exec("RESET ROLE")), /permission denied/),
  "anon still cannot start a checkout after the restatement");

console.log(`\n${pass} passed, ${fail} failed${skip ? " (NEW_MIGRATION=skip: RED baseline)" : ""}`);
process.exit(fail ? 1 : 0);
