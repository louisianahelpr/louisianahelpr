#!/usr/bin/env node
/**
 * PGlite proof for 20261029225235_declutter_seller_cancel_words.sql (audit 1028 part 2, D2-16 and D2-10): the seller's "Cancel sale" tells the buyer
 * "Nothing was charged" (it only ever cancels an unpaid sale), and the strike says "after accepting it" only when
 * the seller accepted an offer, never after a Buy now.
 *
 *   node src/test/pglite/declutterSellerCancelWords.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterSellerCancelWords.pglite.mjs # RED: the old words
 *   MIGRATION_PATH=<planted copy> node ...                                        # RED on a planted defect
 *
 * World: scripts/declutter/slice3Harness.mjs (slices 1-3b, where the function was last defined), then this
 * migration 3x (replay-safe). pglite is loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { setupStatements, liveItemSql, CARDS_SQL, USERS } from "../../../scripts/declutter/slice3Harness.mjs";

const NEW_FILE = "20261029225235_declutter_seller_cancel_words.sql";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const { SELLER, BUYER2, BUYER3, OUTSIDER } = USERS;
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");

const db = new PGlite();
const extra = skip ? [] : [{ file: process.env.MIGRATION_PATH ? undefined : NEW_FILE, path: process.env.MIGRATION_PATH, times: 3 }];
for (const sql of setupStatements({ times: 1, times3b: 1, extra })) await db.exec(sql);
await db.exec(CARDS_SQL);

let pass = 0;
let fail = 0;
const ok = (cond, label) => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
};
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
const I = (n) => `44444444-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const lastNote = async (uid) => one(await svc(`SELECT message FROM public.notifications WHERE user_id = '${uid}' AND title = 'The seller cancelled' ORDER BY created_at DESC LIMIT 1`));
const strikeRow = async (item) => (await svc(`SELECT * FROM public.declutter_strikes WHERE item_id = '${item}' AND user_id = '${SELLER}'`))[0];
// The strike's words open the seller's "You got a Declutter strike" notice (declutter_give_strike's p_why).
const strikeWords = async (title) => {
  const m = one(await svc(`SELECT message FROM public.notifications WHERE user_id = '${SELLER}' AND title = 'You got a Declutter strike'
                             AND message LIKE '%"${title}"%' ORDER BY created_at DESC LIMIT 1`));
  return typeof m === "string" ? m.split(" You have ")[0] : undefined;
};

await db.exec(liveItemSql({ id: I(1), title: "Buy now lamp" }));
await db.exec(liveItemSql({ id: I(2), title: "Offer rocking chair" }));

// 1. A Buy now line, then the seller cancels it.
await me(BUYER2, `SELECT public.declutter_buy_now('${I(1)}', 4000)`);
ok(one(await svc(`SELECT source FROM public.declutter_cart_items WHERE item_id = '${I(1)}'`)) === "buy", "setup: the Buy now line's source is 'buy'");
const r1 = await me(SELLER, `SELECT public.declutter_seller_cancel_sale('${I(1)}') AS n`);
ok(Array.isArray(r1), `the seller cancels the Buy now sale (${Array.isArray(r1) ? "ok" : r1.error})`);
const n1 = await lastNote(BUYER2);
ok(n1 === 'The seller cancelled the sale of "Buy now lamp". Nothing was charged.', `D2-16: the buyer is told nothing was charged (got: ${n1})`);
ok(!/already paid|every cent/.test(n1 ?? ""), "D2-16: no 'if you already paid' on an unpaid cancel");
const s1 = await strikeRow(I(1));
const s1Words = await strikeWords("Buy now lamp");
ok(s1Words === 'You cancelled the sale of "Buy now lamp".', `D2-10: a Buy now strike does not say "after accepting it" (got: ${s1Words})`);
ok(s1?.reason === "cancelled_after_offers", "the strike kind is unchanged");

// 2. An accepted offer, then the seller cancels it.
const offerId = one(await me(BUYER3, `SELECT public.declutter_make_offer('${I(2)}', 3000) AS id`));
const acc = await me(SELLER, `SELECT public.declutter_respond_offer('${offerId}', 'accept', NULL) AS r`);
ok(Array.isArray(acc) && one(await svc(`SELECT source FROM public.declutter_cart_items WHERE item_id = '${I(2)}'`)) === "offer",
  `setup: the accepted offer's line has source 'offer' (${Array.isArray(acc) ? "ok" : acc.error})`);
await me(SELLER, `SELECT public.declutter_seller_cancel_sale('${I(2)}')`);
ok((await lastNote(BUYER3)) === 'The seller cancelled the sale of "Offer rocking chair". Nothing was charged.', "D2-16: same words after an offer");
const s2Words = await strikeWords("Offer rocking chair");
ok(s2Words === 'You cancelled the sale of "Offer rocking chair" after accepting it.', `D2-10: an accepted offer keeps "after accepting it" (got: ${s2Words})`);

// 3. Nothing else moved: the item comes down, a stranger is still refused, the grants are as before.
ok(one(await svc(`SELECT status FROM public.declutter_items WHERE id = '${I(1)}'`)) === "withdrawn", "the listing still comes down (withdrawn)");
await db.exec(liveItemSql({ id: I(3), title: "Stool" }));
await me(BUYER2, `SELECT public.declutter_buy_now('${I(3)}', 4000)`);
const stranger = await me(OUTSIDER, `SELECT public.declutter_seller_cancel_sale('${I(3)}')`);
ok(!Array.isArray(stranger) && /item_not_found/.test(stranger.error), "someone else's sale: item_not_found, as before");
const acl = (await svc(`SELECT has_function_privilege('anon', 'public.declutter_seller_cancel_sale(uuid)', 'EXECUTE') AS a,
                               has_function_privilege('authenticated', 'public.declutter_seller_cancel_sale(uuid)', 'EXECUTE') AS m`))[0];
ok(acl?.a === false && acl?.m === true, "anon cannot run it; members can (grants restated as they were)");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
