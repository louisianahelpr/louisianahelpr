#!/usr/bin/env node
/**
 * PGlite proof for 20261105025801_index_unindexed_foreign_keys_1104: before it, the 26 foreign keys the
 * performance advisor named (get_advisors on prod 2026-11-04 ~02:58Z, nightly-red #3743; pg_constraint the
 * same minute) have no covering index; after it each has one, and a second and third run are no-ops.
 * The tables are cut down to the key columns (their FKs as on prod: pg_constraint.confrelid, 2026-11-04).
 *
 *   node src/test/pglite/indexUnindexedFks1104.pglite.mjs
 */
import { readFileSync } from "node:fs";
import os from "node:os";
const { PGlite } = await import(`${process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`}/node_modules/@electric-sql/pglite/dist/index.js`);
const NEW = readFileSync(new URL("../../../supabase/migrations/20261105025801_index_unindexed_foreign_keys_1104.sql", import.meta.url).pathname, "utf8");
let failures = 0;
const check = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  (${d})` : ""}`); if (!ok) failures++; };
const db = new PGlite();
await db.exec(`
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY);
CREATE TABLE public.declutter_payouts (id uuid PRIMARY KEY);
CREATE TABLE public.jobs (id uuid PRIMARY KEY);
CREATE TABLE public.messages (id uuid PRIMARY KEY);
CREATE TABLE public.declutter_manager_grants (id uuid PRIMARY KEY, ended_by uuid REFERENCES auth.users(id));
CREATE TABLE public.job_continue_days (id uuid PRIMARY KEY, decided_by uuid REFERENCES auth.users(id), proposed_by uuid REFERENCES auth.users(id));
CREATE TABLE public.declutter_bundle_request_items (id uuid PRIMARY KEY, line_id uuid REFERENCES public.declutter_cart_items(id));
CREATE TABLE public.declutter_free_requests (id uuid PRIMARY KEY, seller_id uuid REFERENCES auth.users(id));
CREATE TABLE public.declutter_manager_actions (id uuid PRIMARY KEY, manager_id uuid REFERENCES auth.users(id), seller_id uuid REFERENCES auth.users(id));
CREATE TABLE public.declutter_manager_messages (id uuid PRIMARY KEY, grant_id uuid REFERENCES public.declutter_manager_grants(id), manager_id uuid REFERENCES auth.users(id), seller_id uuid REFERENCES auth.users(id));
CREATE TABLE public.declutter_manager_payouts (id uuid PRIMARY KEY, grant_id uuid REFERENCES public.declutter_manager_grants(id), manager_id uuid REFERENCES auth.users(id), seller_id uuid REFERENCES auth.users(id), seller_payout_id uuid REFERENCES public.declutter_payouts(id));
CREATE TABLE public.declutter_manager_submissions (id uuid PRIMARY KEY, grant_id uuid REFERENCES public.declutter_manager_grants(id), manager_id uuid REFERENCES auth.users(id));
CREATE TABLE public.declutter_offers (id uuid PRIMARY KEY, voided_by_line uuid REFERENCES public.declutter_cart_items(id));
CREATE TABLE public.declutter_order_manager_shares (id uuid PRIMARY KEY, grant_id uuid REFERENCES public.declutter_manager_grants(id), manager_id uuid REFERENCES auth.users(id), seller_id uuid REFERENCES auth.users(id));
CREATE TABLE public.helpr_card_fee_debts (id uuid PRIMARY KEY, job_id uuid REFERENCES public.jobs(id));
CREATE TABLE public.helpr_tasks (id uuid PRIMARY KEY, released_helpr_id uuid REFERENCES auth.users(id));
CREATE TABLE public.instant_book_declines (id uuid PRIMARY KEY, helper_id uuid REFERENCES auth.users(id));
CREATE TABLE public.job_continue_events (id uuid PRIMARY KEY, actor_id uuid REFERENCES auth.users(id), continue_id uuid REFERENCES public.job_continue_days(id));
CREATE TABLE public.unread_message_reminder_sends (id uuid PRIMARY KEY, message_id uuid REFERENCES public.messages(id));
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
check("before: the 26 advisor findings are unindexed", before.length === 26, before.join(" "));
for (let run = 1; run <= 3; run++) {
  await db.exec(NEW);
  const after = (await db.query(UNINDEXED)).rows.map((r) => r.fk);
  check(`run ${run}: no unindexed foreign key left`, after.length === 0, after.join(" "));
}
const idx = (await db.query(`SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE '%\\_idx' ESCAPE '\\'`)).rows[0].n;
check("exactly 26 new indexes (no duplicates from the replays)", idx === 26, `${idx}`);
console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
