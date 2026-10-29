#!/usr/bin/env node
/**
 * PGlite proof for 20261029144850_index_unindexed_foreign_keys_1029: before it, the nine foreign keys the
 * performance advisor named (db-drift-detect run 40748951301, nightly-red #3743; re-read on prod 2026-10-29)
 * have no covering index; after it each has one, and a second and third run are no-ops.
 * The tables are cut down to the key columns (their FKs as on prod: pg_constraint.confrelid, 2026-10-29).
 *
 *   node src/test/pglite/indexUnindexedFks1029.pglite.mjs
 */
import { readFileSync } from "node:fs";
import os from "node:os";
const { PGlite } = await import(`${process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`}/node_modules/@electric-sql/pglite/dist/index.js`);
const NEW = readFileSync(new URL("../../../supabase/migrations/20261029144850_index_unindexed_foreign_keys_1029.sql", import.meta.url).pathname, "utf8");
let failures = 0;
const check = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  (${d})` : ""}`); if (!ok) failures++; };
const db = new PGlite();
await db.exec(`
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TABLE public.jobs (id uuid PRIMARY KEY);
CREATE TABLE public.job_guarantee_claims (id uuid PRIMARY KEY, job_id uuid UNIQUE REFERENCES public.jobs(id),
  helper_id uuid REFERENCES auth.users(id) ON DELETE SET NULL, poster_id uuid REFERENCES auth.users(id) ON DELETE SET NULL);
CREATE TABLE public.declutter_meetup_spots (id uuid PRIMARY KEY, created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL);
CREATE TABLE public.declutter_meetup_choices (id uuid PRIMARY KEY,
  seller_id uuid REFERENCES auth.users(id) ON DELETE CASCADE, spot_id uuid REFERENCES public.declutter_meetup_spots(id) ON DELETE CASCADE);
CREATE TABLE public.declutter_order_meetups (id uuid PRIMARY KEY, spot_id uuid REFERENCES public.declutter_meetup_spots(id) ON DELETE SET NULL);
CREATE TABLE public.declutter_donation_partners (id uuid PRIMARY KEY, created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL);
CREATE TABLE public.declutter_donations (id uuid PRIMARY KEY, partner_id uuid REFERENCES public.declutter_donation_partners(id) ON DELETE SET NULL);
CREATE TABLE public.declutter_handover_talks (id uuid PRIMARY KEY, opened_by uuid REFERENCES auth.users(id) ON DELETE CASCADE);
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
check("before: the nine advisor findings are unindexed", before.length === 9, before.join(" "));
for (let run = 1; run <= 3; run++) {
  await db.exec(NEW);
  const after = (await db.query(UNINDEXED)).rows.map((r) => r.fk);
  check(`run ${run}: no unindexed foreign key left`, after.length === 0, after.join(" "));
}
const idx = (await db.query(`SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE '%\\_idx' ESCAPE '\\'`)).rows[0].n;
check("exactly nine new indexes (no duplicates from the replays)", idx === 9, `${idx}`);
console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
