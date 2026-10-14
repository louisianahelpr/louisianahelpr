#!/usr/bin/env node
/**
 * PGlite proof for 20261014230342_declutter_price_cap_1000 (owner row 70: the
 * highest price per item is $1,000; floor, offers, cart lines within it), on
 * top of slices 1-3 and 3b, applied 3x.
 *
 *   node src/test/pglite/declutterPriceCap.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/declutterPriceCap.pglite.mjs   # RED: the cap checks fail
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterPriceCap.pglite.mjs
 *
 * Existing rows: listings over the cap are written BEFORE the migration runs
 * (slices 1-3b applied, cap not yet), then the cap migration is applied.
 */
import os from "node:os";
import { setupStatements, liveItemSql, CARDS_SQL, USERS } from "../../../scripts/declutter/slice3Harness.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const { readFileSync } = await import("node:fs");
const { SELLER, BUYER } = USERS;
const skip = process.env.NEW_MIGRATION === "skip";
const capSql = readFileSync(process.env.MIGRATION_PATH
  ?? new URL("../../../supabase/migrations/20261014230342_declutter_price_cap_1000.sql", import.meta.url).pathname, "utf8");

let pass = 0;
let fail = 0;
const ok = (cond, label) => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
};
const I = (n) => `55555555-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;

async function fresh() {
  const db = new PGlite();
  for (const sql of setupStatements({ times: 1, times3b: 1, timesCap: 0 })) await db.exec(sql);
  await db.exec(CARDS_SQL);
  return db;
}
const q = async (db, sql) => { try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e) }; } };
const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);
const refused = (r, re) => !Array.isArray(r) && re.test(r.error);

// --- Existing listings over the cap (written before the cap existed)
const db = await fresh();
await db.exec(liveItemSql({ id: I(1), title: "Grand piano lid", price: 500000, floor: 300000 }));
await db.exec(liveItemSql({ id: I(2), title: "Antique desk", price: 200000, floor: 50000 }));
await db.exec(liveItemSql({ id: I(3), title: "Small lamp here", price: 4000, floor: 2000 }));
await db.exec(`${liveItemSql({ id: I(4), title: "Draft sofa big", price: 150000, floor: 150000 })}
  UPDATE public.declutter_items SET status = 'draft', live_at = NULL WHERE id = '${I(4)}';`);
if (!skip) for (let i = 0; i < 3; i++) await db.exec(capSql);

const item = async (id) => (await q(db, `SELECT i.status, i.price_cents, i.current_price_cents, p.floor_price_cents, p.drop_stop_cents
  FROM public.declutter_items i JOIN public.declutter_item_private p ON p.item_id = i.id WHERE i.id = '${id}'`))[0];
const i1 = await item(I(1));
ok(i1?.status === "withdrawn" && i1.price_cents === 100000 && i1.current_price_cents === 100000 && i1.floor_price_cents === 100000,
  "a live listing over $1,000 is taken down and brought to the cap (floor never above the price)");
ok(i1?.drop_stop_cents > i1?.floor_price_cents, "its price-drop stop point is re-picked above the new floor");
const i2 = await item(I(2));
ok(i2?.status === "withdrawn" && i2.price_cents === 100000 && i2.floor_price_cents === 50000, "a floor already under the cap is kept");
ok(Number(one(await q(db, `SELECT count(*) FROM public.notifications WHERE user_id = '${SELLER}' AND title = 'Listing taken down: price over $1,000'`))) === 2,
  "each seller whose live listing came down is told why (once, though the migration ran 3x)");
const i3 = await item(I(3));
ok(i3?.status === "live" && i3.price_cents === 4000, "a listing under the cap is untouched");
const i4 = await item(I(4));
ok(i4?.status === "draft" && i4.price_cents === 100000, "a draft over the cap stays a draft, at the cap");
ok(Number(one(await q(db, `SELECT count(*) FROM public.declutter_items WHERE price_cents > 100000 OR current_price_cents > 100000`))) === 0
   && Number(one(await q(db, `SELECT count(*) FROM public.declutter_item_private WHERE floor_price_cents > 100000`))) === 0,
  "afterwards no listing exceeds $1,000");

// --- Nothing new can exceed it
ok(refused(await q(db, `UPDATE public.declutter_items SET price_cents = 100001, current_price_cents = 100001 WHERE id = '${I(3)}'`), /price_cap/),
  "a price over $1,000 is refused by the table (every RPC writes through it)");
ok(refused(await q(db, `UPDATE public.declutter_item_private SET floor_price_cents = 100001 WHERE item_id = '${I(3)}'`), /floor_cap/),
  "a floor over $1,000 is refused");
ok(Array.isArray(await q(db, `UPDATE public.declutter_items SET price_cents = 100000, current_price_cents = 100000 WHERE id = '${I(3)}'`)),
  "exactly $1,000 is allowed");
await db.exec(`SET request.jwt.claim.sub = '${SELLER}'; SET ROLE authenticated;`);
const created = await q(db, `SELECT public.declutter_create_item('Big wardrobe', 'Solid oak.', 'furniture', 4, 'large', 100001, 50000,
  'Mid-City, Baton Rouge', '1234 Example St, Baton Rouge, LA 70806', 30.45, -91.15)`);
const createdOk = await q(db, `SELECT public.declutter_create_item('Big wardrobe', 'Solid oak.', 'furniture', 4, 'large', 100000, 50000,
  'Mid-City, Baton Rouge', '1234 Example St, Baton Rouge, LA 70806', 30.45, -91.15) AS id`);
await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
ok(refused(created, /price_cap|check constraint/), "creating a listing at $1,000.01 is refused");
ok(typeof one(createdOk) === "string", "creating a listing at $1,000 works");
ok(refused(await q(db, `INSERT INTO public.declutter_offers (item_id, buyer_id, seller_id, amount_cents, awaiting, respond_by)
                        VALUES ('${I(3)}', '${BUYER}', '${SELLER}', 100001, 'seller', now() + interval '1 day')`), /amount_cap/),
  "an offer over $1,000 is refused");
ok(refused(await q(db, `INSERT INTO public.declutter_cart_items (item_id, buyer_id, seller_id, price_cents, source, checkout_by)
                        VALUES ('${I(3)}', '${BUYER}', '${SELLER}', 100001, 'buy', now() + interval '2 days')`), /price_cap/),
  "a cart line over $1,000 is refused");

// --- An agreed sale over the cap stops the migration (never a quiet rewrite of money)
const db2 = await fresh();
await db2.exec(liveItemSql({ id: I(9), title: "Pricey cabinet", price: 300000, floor: 200000 }));
await db2.exec(`UPDATE public.declutter_items SET status = 'reserved' WHERE id = '${I(9)}';
  INSERT INTO public.declutter_cart_items (item_id, buyer_id, seller_id, price_cents, source, checkout_by)
  VALUES ('${I(9)}', '${BUYER}', '${SELLER}', 300000, 'buy', now() + interval '2 days');`);
let stopped = null;
if (!skip) { try { await db2.exec(capSql); } catch (e) { stopped = String(e.message); } }
ok(stopped !== null && /declutter_price_cap: 2 agreed sale/.test(stopped)
   && Number(one(await q(db2, `SELECT price_cents FROM public.declutter_cart_items WHERE item_id = '${I(9)}'`))) === 300000,
  "a reserved sale / cart line over $1,000 stops the migration with a count, and nothing is rewritten");

console.log(`\n${pass} PASS, ${fail} FAIL${skip ? " (NEW_MIGRATION=skip)" : ""}`);
process.exit(fail === 0 ? 0 : 1);
