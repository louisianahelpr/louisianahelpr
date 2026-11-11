#!/usr/bin/env node
/**
 * PGlite proof for 20261111195156_declutter_block_closes_open_offers.sql (whole-app audit 11-10 F359h, owner 11-11
 * ~2:10 PM): blocking someone closes the OPEN Declutter offers and trade offers between the two, either direction.
 * Accepted ones, offers with other members, and paid orders are not touched; a failing close never stops the block.
 *
 *   node src/test/pglite/declutterBlockClosesOpenOffers.pglite.mjs                    # GREEN (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterBlockClosesOpenOffers.pglite.mjs # RED: offers stay open
 *   MIGRATION_PATH=<planted copy> node ...                                             # RED on a planted defect
 *
 * World: scripts/declutter/slice3Harness.mjs (slices 1-3b: declutter_offers, the minimal user_blocks). Added, and said
 * so: declutter_swap_offers (the columns this trigger reads, no FKs), error_logs (the columns the trigger writes) and
 * declutter_offers.voided_by_line (a later column; the close clears it so declutter_reopen_voided_offers cannot reopen).
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setupStatements, liveItemSql, USERS } from "../../../scripts/declutter/slice3Harness.mjs";

const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const NEW_FILE = "20261111195156_declutter_block_closes_open_offers.sql";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const { SELLER, BUYER, BUYER2, SELLER2 } = USERS;
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");

const db = new PGlite();
for (const sql of setupStatements({ times: 1, times3b: 1 })) await db.exec(sql);
await db.exec(`
  CREATE TABLE IF NOT EXISTS public.declutter_swap_offers (
    id uuid PRIMARY KEY, item_id uuid NOT NULL, offered_item_id uuid NOT NULL, buyer_id uuid NOT NULL, seller_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'open', respond_by timestamptz NOT NULL DEFAULT now() + interval '2 days',
    updated_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz);
  ALTER TABLE public.declutter_offers ADD COLUMN IF NOT EXISTS voided_by_line uuid;
  CREATE TABLE IF NOT EXISTS public.error_logs (id bigserial PRIMARY KEY, severity text, message text, tags jsonb, context jsonb);
`);
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
const rows = async (sql) => (await db.query(sql)).rows;
const I = (n) => `55555555-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const O = (n) => `66666666-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const S = (n) => `77777777-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const offer = (id, item, buyer, seller, status = "open") => db.exec(`INSERT INTO public.declutter_offers (id, item_id, buyer_id, seller_id, amount_cents, awaiting, status, respond_by)
  VALUES ('${id}', '${item}', '${buyer}', '${seller}', 1000, 'seller', '${status}', now() + interval '1 day')`);
const swap = (id, item, offered, buyer, seller, status = "open") => db.exec(`INSERT INTO public.declutter_swap_offers (id, item_id, offered_item_id, buyer_id, seller_id, status)
  VALUES ('${id}', '${item}', '${offered}', '${buyer}', '${seller}', '${status}')`);
const status = async (table, id) => (await rows(`SELECT status, closed_at FROM public.${table} WHERE id = '${id}'`))[0];

for (let n = 1; n <= 6; n++) await db.exec(liveItemSql({ id: I(n), title: `Item ${n}` }));

// The pair: SELLER blocks BUYER. Open offer BUYER -> SELLER (1), open offer SELLER -> BUYER on BUYER's item (2),
// an accepted offer between them (3), an open offer from someone else (4), open trades both ways (S1, S2),
// an accepted trade (S3), and an open trade with someone else (S4).
await offer(O(1), I(1), BUYER, SELLER);
await db.exec(`UPDATE public.declutter_offers SET voided_by_line = '${O(9)}' WHERE id = '${O(1)}'`);
await offer(O(2), I(2), SELLER, BUYER);
await offer(O(3), I(3), BUYER, SELLER, "accepted");
await offer(O(4), I(1), BUYER2, SELLER);
await swap(S(1), I(1), I(2), BUYER, SELLER);
await swap(S(2), I(2), I(4), SELLER, BUYER);
await swap(S(3), I(3), I(5), BUYER, SELLER, "accepted");
await swap(S(4), I(1), I(6), SELLER2, SELLER);

await db.exec(`INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES ('${SELLER}', '${BUYER}')`);
ok((await rows(`SELECT count(*)::int AS n FROM public.user_blocks`))[0].n === 1, "the block itself is saved");

const o1 = await status("declutter_offers", O(1));
ok(o1.status === "voided" && o1.closed_at !== null, `the blocked buyer's open offer to the blocker closes (${o1.status})`);
ok((await rows(`SELECT voided_by_line FROM public.declutter_offers WHERE id = '${O(1)}'`))[0].voided_by_line === null, "its stale voided_by_line is cleared (no reopen by an old line)");
ok((await status("declutter_offers", O(2))).status === "voided", "an open offer the other way (blocker as buyer) closes too");
ok((await status("declutter_offers", O(3))).status === "accepted", "an accepted offer between them is not touched");
ok((await status("declutter_offers", O(4))).status === "open", "an open offer from another member stays open");
const s1 = await status("declutter_swap_offers", S(1));
ok(s1.status === "voided" && s1.closed_at !== null, `an open trade offer between them closes (${s1.status})`);
ok((await status("declutter_swap_offers", S(2))).status === "voided", "an open trade offer the other way closes too");
ok((await status("declutter_swap_offers", S(3))).status === "accepted", "an accepted trade between them is not touched");
ok((await status("declutter_swap_offers", S(4))).status === "open", "an open trade with another member stays open");

if (!skip) {
  // A failing close never stops the block: the error goes to error_logs.
  await db.exec(`ALTER TABLE public.declutter_swap_offers RENAME TO declutter_swap_offers_gone`);
  await offer(O(5), I(4), BUYER2, SELLER2);
  let blocked = true;
  try { await db.exec(`INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES ('${SELLER2}', '${BUYER2}')`); } catch { blocked = false; }
  ok(blocked, "a block still saves when closing the offers fails");
  const logged = await rows(`SELECT count(*)::int AS n FROM public.error_logs WHERE tags->>'source' = 'declutter_close_offers_across_block'`);
  ok(logged[0].n === 1, "the failure is written to error_logs");
  await db.exec(`ALTER TABLE public.declutter_swap_offers_gone RENAME TO declutter_swap_offers`);
  // Members cannot call the trigger function.
  const acl = await rows(`SELECT has_function_privilege('authenticated', 'public.declutter_close_offers_across_block()', 'EXECUTE') AS a,
    has_function_privilege('anon', 'public.declutter_close_offers_across_block()', 'EXECUTE') AS b`);
  ok(acl[0].a === false && acl[0].b === false, "anon and authenticated cannot execute the trigger function");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
