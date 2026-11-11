#!/usr/bin/env node
/**
 * PGlite proof for 20261111191033_declutter_seller_counter_declined_words.sql (whole-app audit 11-10 F359m): when the
 * buyer says no to the seller's counter, the SELLER reads "The buyer said no to your $X price on "<title>". Your
 * listing is still up." instead of "Your offer ... was declined. Nothing was charged." The buyer's words (a seller
 * declining the buyer's offer), the title, the link, the status change and the grants are unchanged.
 *
 *   node src/test/pglite/declutterSellerCounterDeclinedWords.pglite.mjs                    # GREEN (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterSellerCounterDeclinedWords.pglite.mjs # RED: the old words
 *   MIGRATION_PATH=<planted copy> node ...                                                 # RED on a planted defect
 *
 * World: scripts/declutter/slice3Harness.mjs (slices 1-3b; the newest helpers, declutter_notify included), then the
 * previous body (20261110202142) once, then this migration 3x. Offers are inserted as rows (the decline path reads
 * only the offer and the item). Added, and said so: declutter_items.accepts_offers (a later column the body selects).
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setupStatements, liveItemSql, USERS } from "../../../scripts/declutter/slice3Harness.mjs";

const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const NEW_FILE = "20261111191033_declutter_seller_counter_declined_words.sql";
const PREV_FILE = "20261110202142_notice_titles_by_outcome_plain_words.sql";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const { SELLER, BUYER2, BUYER3 } = USERS;
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");

/** One CREATE FUNCTION statement out of a migration file, any dollar tag. */
function fnFrom(file, name) {
  const sql = readFileSync(MIG_DIR + file, "utf8");
  const start = sql.search(new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.${name}\s*\(`, "i"));
  const tag = /\bAS\s+(\$\w*\$)/g;
  tag.lastIndex = start;
  const t = tag.exec(sql);
  return `${sql.slice(start, sql.indexOf(t[1], t.index + t[0].length) + t[1].length)};`;
}

const db = new PGlite();
for (const sql of setupStatements({ times: 1, times3b: 1 })) await db.exec(sql);
await db.exec(`ALTER TABLE public.declutter_items ADD COLUMN IF NOT EXISTS accepts_offers boolean NOT NULL DEFAULT true;`);
await db.exec(fnFrom(PREV_FILE, "declutter_respond_offer"));
if (!skip) {
  const mig = readFileSync(process.env.MIGRATION_PATH ?? MIG_DIR + NEW_FILE, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(mig);
}

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
    await db.exec(`SET request.jwt.claim.sub = '${uid}'; SET ROLE authenticated;`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  }
}
const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);
const I = (n) => `55555555-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const O = (n) => `66666666-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const offer = (id, item, buyer, awaiting, cents) => svc(`INSERT INTO public.declutter_offers (id, item_id, buyer_id, seller_id, amount_cents, awaiting, status, respond_by)
  VALUES ('${id}', '${item}', '${buyer}', '${SELLER}', ${cents}, '${awaiting}', 'open', now() + interval '1 day')`);
const note = async (uid) => (await svc(`SELECT title, message, link FROM public.notifications WHERE user_id = '${uid}' AND title = 'Offer declined' ORDER BY created_at DESC LIMIT 1`))[0];

await db.exec(liveItemSql({ id: I(1), title: "Wooden step stool" }));
await db.exec(liveItemSql({ id: I(2), title: "Brass lamp" }));

// 1. The seller countered at $14; the buyer says no. The seller made no offer and is never charged.
const o1 = await offer(O(1), I(1), BUYER2, "buyer", 1400);
ok(Array.isArray(o1), `setup: an open offer waiting on the buyer (${Array.isArray(o1) ? "ok" : o1.error})`);
const r1 = await me(BUYER2, `SELECT public.declutter_respond_offer('${O(1)}', 'decline', NULL) AS r`);
ok(one(r1) === "declined", `the buyer says no (${Array.isArray(r1) ? one(r1) : r1.error})`);
const n1 = await note(SELLER);
ok(n1?.message === 'The buyer said no to your $14.00 price on "Wooden step stool". Your listing is still up.', `F359m: the seller's words (got: ${n1?.message})`);
ok(!/Nothing was charged|Your offer/.test(n1?.message ?? ""), "F359m: no 'Your offer' and no 'Nothing was charged' for the seller");
ok(n1?.link === "/declutter?tab=selling", `the link is unchanged (${n1?.link})`);
ok(one(await svc(`SELECT status FROM public.declutter_offers WHERE id = '${O(1)}'`)) === "declined", "the offer is declined, as before");

// 2. The buyer's offer, the seller says no: the buyer's words are unchanged.
await offer(O(2), I(2), BUYER3, "seller", 900);
const r2 = await me(SELLER, `SELECT public.declutter_respond_offer('${O(2)}', 'decline', NULL) AS r`);
ok(one(r2) === "declined", `the seller says no (${Array.isArray(r2) ? one(r2) : r2.error})`);
const n2 = await note(BUYER3);
ok(n2?.message === 'Your offer on "Brass lamp" was declined. Nothing was charged.', `the buyer's words are unchanged (got: ${n2?.message})`);
ok(n2?.link === `/declutter/item/${I(2)}`, "the buyer's link is unchanged");

// 3. A listing no longer up: the seller is not told it is.
await db.exec(liveItemSql({ id: I(3), title: "Rug" }));
await offer(O(3), I(3), BUYER2, "buyer", 2000);
await svc(`UPDATE public.declutter_items SET status = 'withdrawn' WHERE id = '${I(3)}'`);
await me(BUYER2, `SELECT public.declutter_respond_offer('${O(3)}', 'decline', NULL)`);
const n3 = await note(SELLER);
ok(n3?.message === 'The buyer said no to your $20.00 price on "Rug".', `F359m: no "still up" once the listing is down (got: ${n3?.message})`);

const acl = (await svc(`SELECT has_function_privilege('anon', 'public.declutter_respond_offer(uuid, text, integer)', 'EXECUTE') AS a,
                               has_function_privilege('authenticated', 'public.declutter_respond_offer(uuid, text, integer)', 'EXECUTE') AS m`))[0];
ok(acl?.m === true, "members can still run it (CREATE OR REPLACE kept the grants)");
console.log(`anon EXECUTE in this world: ${acl?.a} (unchanged by a CREATE OR REPLACE)`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
