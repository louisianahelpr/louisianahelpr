#!/usr/bin/env node
/**
 * PGlite proof for 20261107032744_index_declutter_swap_offer_lines: before it, the buyer_line_id and
 * seller_line_id -> declutter_cart_items keys that 20261106163703_declutter_trades adds have no covering
 * index (the two unindexed_foreign_keys findings db-drift-detect 42333880707 read on prod 2026-11-07 03:25Z;
 * pg_constraint the same hour); after it each has one, and a second and third run are no-ops. The table is
 * cut down to its keys and its existing non-unique indexes.
 *
 *   node src/test/pglite/indexSwapOfferLines.pglite.mjs
 */
import { readFileSync } from "node:fs";
import os from "node:os";
const { PGlite } = await import(`${process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`}/node_modules/@electric-sql/pglite/dist/index.js`);
const NEW = readFileSync(new URL("../../../supabase/migrations/20261107032744_index_declutter_swap_offer_lines.sql", import.meta.url).pathname, "utf8");
let failures = 0;
const check = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  (${d})` : ""}`); if (!ok) failures++; };
const db = new PGlite();
await db.exec(`
CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY);
CREATE TABLE public.declutter_swap_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id uuid NOT NULL,
  seller_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  buyer_line_id uuid REFERENCES public.declutter_cart_items(id) ON DELETE SET NULL,
  seller_line_id uuid REFERENCES public.declutter_cart_items(id) ON DELETE SET NULL
);
CREATE INDEX declutter_swap_offers_buyer_idx ON public.declutter_swap_offers (buyer_id, created_at);
CREATE INDEX declutter_swap_offers_seller_idx ON public.declutter_swap_offers (seller_id, status);
`);
// The advisor's test: a public FK whose columns are not the leading columns of any index.
const UNINDEXED = `
SELECT c.conrelid::regclass::text || '.' || (SELECT string_agg(a.attname, ',') FROM unnest(c.conkey) k
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k) AS fk
FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
WHERE c.contype = 'f' AND n.nspname = 'public'
  AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid
    AND (i.indkey::int2[])[0:cardinality(c.conkey) - 1] @> c.conkey
    AND c.conkey @> (i.indkey::int2[])[0:cardinality(c.conkey) - 1])
ORDER BY 1`;
const before = (await db.query(UNINDEXED)).rows.map((r) => r.fk);
check("before: the two swap-offer line keys are the unindexed ones", before.join() === "declutter_swap_offers.buyer_line_id,declutter_swap_offers.seller_line_id", before.join(" "));
for (let run = 1; run <= 3; run++) {
  await db.exec(NEW);
  const after = (await db.query(UNINDEXED)).rows.map((r) => r.fk);
  check(`run ${run}: no unindexed foreign key left`, after.length === 0, after.join(" "));
}
const idx = (await db.query(`SELECT count(*)::int AS n FROM pg_indexes WHERE tablename = 'declutter_swap_offers' AND indexname IN ('declutter_swap_offers_buyer_line_id_idx', 'declutter_swap_offers_seller_line_id_idx')`)).rows[0].n;
check("exactly the two new indexes (no duplicate from the replays)", idx === 2, `${idx}`);
console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
