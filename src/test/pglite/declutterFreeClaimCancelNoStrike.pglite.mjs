#!/usr/bin/env node
/**
 * PGlite proof for 20261030132149_declutter_free_claim_cancel_no_strike.sql (owner 2026-10-30: no strike for a giver
 * who cancels a free claim). A free line cancelled by its giver: no strike, the item goes back up, the person who
 * claimed it is told so. A paid line keeps its strike and its words, and the listing still comes down.
 *
 *   node src/test/pglite/declutterFreeClaimCancelNoStrike.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterFreeClaimCancelNoStrike.pglite.mjs # RED: the old strike
 *   MIGRATION_PATH=<planted copy> node ...                                               # RED on a planted defect
 *
 * World: scripts/declutter/slice3Harness.mjs (slices 1-3b), then the predecessor 20261029225235 (the effective prod
 * body), then this migration 3x (replay-safe). pglite is loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { setupStatements, liveItemSql, CARDS_SQL, USERS } from "../../../scripts/declutter/slice3Harness.mjs";

const PREV_FILE = "20261029225235_declutter_seller_cancel_words.sql";
const NEW_FILE = "20261030132149_declutter_free_claim_cancel_no_strike.sql";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const { SELLER, SELLER2, BUYER2, BUYER3, OUTSIDER } = USERS;
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");

const db = new PGlite();
const extra = [{ file: PREV_FILE, times: 1 }];
if (!skip) extra.push({ file: process.env.MIGRATION_PATH ? undefined : NEW_FILE, path: process.env.MIGRATION_PATH, times: 3 });
for (const sql of setupStatements({ times: 1, times3b: 1, extra })) await db.exec(sql);
await db.exec(CARDS_SQL);

let pass = 0;
let fail = 0;
const ok = (cond, label) => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
};
const svcExec = async (sql) => { try { await db.exec(sql); return null; } catch (e) { return { error: String(e.message ?? e) }; } };
const svc = async (sql) => { try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e), code: e.code }; } };
async function me(uid, sql) {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${uid ?? ""}'; SET ROLE authenticated;`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  }
}
const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);
const I = (n) => `55555555-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const L = (n) => `55555555-1111-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const strikes = async (uid) => Number(one(await svc(`SELECT count(*) FROM public.declutter_strikes WHERE user_id = '${uid}'`)));
const status = async (item) => one(await svc(`SELECT status FROM public.declutter_items WHERE id = '${item}'`));
const lastNote = async (uid) => (await svc(`SELECT title, message, link FROM public.notifications WHERE user_id = '${uid}' ORDER BY created_at DESC, id DESC LIMIT 1`))[0];

// A claimed free item as the claim leaves it: the item reserved, one in_cart line at $0 with 48 hours to choose a
// pickup (declutter_take_item(item, buyer, 0, 'buy', NULL), which both the old claim and the Free change's pick use).
// The $0 CHECKs exactly as 20261027170717_declutter_free_section.sql has them (this world predates the free section).
await db.exec(`
  ALTER TABLE public.declutter_items DROP CONSTRAINT IF EXISTS declutter_items_price_cap;
  ALTER TABLE public.declutter_items ADD CONSTRAINT declutter_items_price_cap CHECK (price_cents = 0 OR price_cents BETWEEN 100 AND 100000);
  ALTER TABLE public.declutter_items DROP CONSTRAINT IF EXISTS declutter_items_current_price_cap;
  ALTER TABLE public.declutter_items ADD CONSTRAINT declutter_items_current_price_cap CHECK (current_price_cents = 0 OR current_price_cents BETWEEN 100 AND 100000);
  ALTER TABLE public.declutter_cart_items DROP CONSTRAINT IF EXISTS declutter_cart_items_price_cap;
  ALTER TABLE public.declutter_cart_items ADD CONSTRAINT declutter_cart_items_price_cap CHECK (price_cents = 0 OR price_cents BETWEEN 100 AND 100000);`);

async function freeClaim({ item, line, title, seller = SELLER, buyer = BUYER2 }) {
  await db.exec(liveItemSql({ id: item, seller, title }));
  const r = await svcExec(`
    UPDATE public.declutter_items SET status = 'reserved', price_cents = 0, current_price_cents = 0 WHERE id = '${item}';
    INSERT INTO public.declutter_cart_items (id, item_id, buyer_id, seller_id, price_cents, source, status, checkout_by)
    VALUES ('${line}', '${item}', '${buyer}', '${seller}', 0, 'buy', 'in_cart', now() + interval '48 hours');`);
  if (r?.error) console.log(`setup error: ${r.error}`);
  ok(one(await svc(`SELECT status FROM public.declutter_cart_items WHERE id = '${line}'`)) === "in_cart" && (await status(item)) === "reserved",
    `setup: "${title}" is claimed (free line in_cart, item reserved)`);
}

// 1. The giver cancels a free claim: no strike, back up, the claimer told.
await freeClaim({ item: I(1), line: L(1), title: "Free lamp" });
const before = await strikes(SELLER);
const r1 = await me(SELLER, `SELECT public.declutter_seller_cancel_sale('${I(1)}') AS n`);
ok(Array.isArray(r1), `the giver cancels the free claim (${Array.isArray(r1) ? "ok" : r1.error})`);
ok((await strikes(SELLER)) === before, `no strike for cancelling a free claim (strikes ${before} -> ${await strikes(SELLER)})`);
ok(Number(one(r1)) === before, `it returns the giver's unchanged strike count (got ${one(r1)})`);
ok((await status(I(1))) === "live", `the free item goes back up (status ${await status(I(1))})`);
ok(one(await svc(`SELECT status FROM public.declutter_cart_items WHERE id = '${L(1)}'`)) === "cancelled_by_seller", "the claim line is closed as cancelled_by_seller");
const n1 = await lastNote(BUYER2);
ok(n1?.message === 'The giver cancelled your claim on "Free lamp", so it went back up. Nothing was charged and you get no strike.',
  `the person who claimed it is told it went back up (got: ${n1?.message})`);
ok(n1?.link === `/declutter/item/${I(1)}`, `the notice opens the item (got: ${n1?.link})`);
ok(!/strike/.test(String((await lastNote(SELLER))?.title ?? "")), "the giver gets no 'You got a Declutter strike' notice");

// 2. A paid line keeps its strike, words and the listing coming down.
await db.exec(liveItemSql({ id: I(2), title: "Paid lamp" }));
await me(BUYER3, `SELECT public.declutter_buy_now('${I(2)}', 4000)`);
const b2 = await strikes(SELLER);
const r2 = await me(SELLER, `SELECT public.declutter_seller_cancel_sale('${I(2)}') AS n`);
ok(Array.isArray(r2) && (await strikes(SELLER)) === b2 + 1, `a paid sale still gives the seller a strike (${Array.isArray(r2) ? "ok" : r2.error})`);
ok((await status(I(2))) === "withdrawn", "a cancelled paid sale still comes down (withdrawn)");
ok((await lastNote(BUYER3))?.message === 'The seller cancelled the sale of "Paid lamp". Nothing was charged.', "the paid buyer's words are unchanged");

// 3. A giver who is out of Declutter: no strike still, but the item comes down (an out seller has no live listing).
await freeClaim({ item: I(3), line: L(3), title: "Free stool", seller: SELLER2 });
await svc(`INSERT INTO public.declutter_strikes (user_id, offender_side, reason, item_id, given_at, expires_at)
           SELECT '${SELLER2}', 'seller', 'cancelled_after_offers', '${I(3)}', now(), now() + interval '1 year' FROM generate_series(1, 3)`);
const outNow = one(await svc(`SELECT public.declutter_seller_out('${SELLER2}')`));
const b3 = await strikes(SELLER2);
const r3 = await me(SELLER2, `SELECT public.declutter_seller_cancel_sale('${I(3)}') AS n`);
ok(outNow === true, `setup: the second giver is out of Declutter (${outNow})`);
ok(Array.isArray(r3) && (await strikes(SELLER2)) === b3, `an out giver cancelling a free claim gets no new strike (${Array.isArray(r3) ? "ok" : r3.error})`);
ok((await status(I(3))) === "withdrawn", `an out giver's free item comes down instead of going back up (status ${await status(I(3))})`);
ok((await lastNote(BUYER2))?.message === 'The giver cancelled your claim on "Free stool". Nothing was charged and you get no strike.',
  "the claimer is told the claim was cancelled, with no 'went back up'");

// 4. Nothing else moved: a stranger is refused, a booked free pickup still refuses, the grants are as before.
await freeClaim({ item: I(4), line: L(4), title: "Free rug" });
const stranger = await me(OUTSIDER, `SELECT public.declutter_seller_cancel_sale('${I(4)}')`);
ok(!Array.isArray(stranger) && /item_not_found/.test(stranger.error), "someone else's claim: item_not_found, as before");
await svc(`UPDATE public.declutter_cart_items SET status = 'paid' WHERE id = '${L(4)}'`);
const booked = await me(SELLER, `SELECT public.declutter_seller_cancel_sale('${I(4)}')`);
ok(!Array.isArray(booked) && /sale_already_paid/.test(booked.error), "a booked free pickup (line paid) still raises sale_already_paid");
const acl = (await svc(`SELECT has_function_privilege('anon', 'public.declutter_seller_cancel_sale(uuid)', 'EXECUTE') AS a,
                               has_function_privilege('authenticated', 'public.declutter_seller_cancel_sale(uuid)', 'EXECUTE') AS m`))[0];
ok(acl?.a === false && acl?.m === true, "anon cannot run it; members can (grants restated as they were)");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
