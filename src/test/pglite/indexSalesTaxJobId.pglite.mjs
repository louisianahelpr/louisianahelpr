#!/usr/bin/env node
/**
 * PGlite proof for 20261105044114_index_sales_tax_adjustments_job_id: before it, the job_id -> jobs key that
 * 20261105021744_sales_tax_adjustments adds has no covering index (the one unindexed_foreign_keys finding
 * get_advisors read on prod 2026-11-05 04:40Z, db-drift-detect 41968943315); after it the key has one, and a
 * second and third run are no-ops. The table is cut down to its key and its two existing indexes.
 *
 *   node src/test/pglite/indexSalesTaxJobId.pglite.mjs
 */
import { readFileSync } from "node:fs";
import os from "node:os";
const { PGlite } = await import(`${process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`}/node_modules/@electric-sql/pglite/dist/index.js`);
const NEW = readFileSync(new URL("../../../supabase/migrations/20261105044114_index_sales_tax_adjustments_job_id.sql", import.meta.url).pathname, "utf8");
let failures = 0;
const check = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  (${d})` : ""}`); if (!ok) failures++; };
const db = new PGlite();
await db.exec(`
CREATE TABLE public.jobs (id uuid PRIMARY KEY);
CREATE TABLE public.sales_tax_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  stripe_payment_intent_id text NOT NULL,
  occurred_at timestamptz NOT NULL
);
CREATE INDEX sales_tax_adjustments_occurred_idx ON public.sales_tax_adjustments (occurred_at);
CREATE INDEX sales_tax_adjustments_pi_idx ON public.sales_tax_adjustments (stripe_payment_intent_id);
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
check("before: sales_tax_adjustments.job_id is the one unindexed key", before.join() === "sales_tax_adjustments.job_id", before.join(" "));
for (let run = 1; run <= 3; run++) {
  await db.exec(NEW);
  const after = (await db.query(UNINDEXED)).rows.map((r) => r.fk);
  check(`run ${run}: no unindexed foreign key left`, after.length === 0, after.join(" "));
}
const idx = (await db.query(`SELECT count(*)::int AS n FROM pg_indexes WHERE tablename = 'sales_tax_adjustments' AND indexname = 'sales_tax_adjustments_job_id_idx'`)).rows[0].n;
check("exactly one sales_tax_adjustments_job_id_idx (no duplicate from the replays)", idx === 1, `${idx}`);
console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
