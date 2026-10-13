/**
 * Q1424 PGlite proof: the cron jobs that DELETE rows by age delete a row 1 ms
 * past its retention edge and keep the row AT the edge and 1 ms inside it,
 * with the clock fixed (./lib/fixedClock.mjs, newest CREATE of each function).
 * A delete one tick early is data lost for good, so each `<` is held exactly.
 *
 *   node src/test/pglite/pruneRetentionClock.pglite.mjs
 *   PRUNE_INCLUSIVE=1 node src/test/pglite/pruneRetentionClock.pglite.mjs   # RED: every `< now() - x` made `<=`
 *
 * pglite is loaded from ~/.lh-pglite (CLAUDE.md). The edge is computed by PG
 * itself (`fixed now - interval`), so month and leap-year arithmetic is PG's.
 * Registered in src/test/clockFunctionsProven.test.ts.
 */
import os from "node:os";
import { installClock, newestFunction, onFixedClock, setClock } from "./lib/fixedClock.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
const q = async (sql, params) => (await db.query(sql, params)).rows;
await installClock(db);
await db.exec(`
SET TIME ZONE 'UTC';
CREATE SCHEMA cron;
CREATE TABLE cron.job_run_details (id serial, tag text, end_time timestamptz);
CREATE TABLE public.cron_run_log (id serial, tag text, occurred_at timestamptz);
CREATE TABLE public.cron_http_requests (id serial, tag text, created_at timestamptz);
CREATE TABLE public.edge_rate_limit_log (id serial, tag text, created_at timestamptz);
CREATE TABLE public.error_logs (id serial, tag text, created_at timestamptz);
CREATE TABLE public.analytics_events (id serial, tag text, created_at timestamptz);
CREATE TABLE public.stripe_webhook_events (id serial, tag text, processed_at timestamptz);
CREATE TABLE public.login_history (id serial, tag text, user_id uuid, created_at timestamptz);
CREATE TABLE public.notification_logs (id serial, tag text, created_at timestamptz);
CREATE TABLE public.profile_views (id serial, tag text, viewed_at timestamp);
CREATE TABLE public.job_views (id serial, tag text, first_viewed_at timestamptz);
CREATE TABLE public.application_rate_log (id serial, tag text, created_at timestamptz);
CREATE TABLE public.profile_search_rate_log (id serial, tag text, created_at timestamptz);
CREATE TABLE public.helper_w9_records (id serial, tag text, signed_at timestamptz);
CREATE FUNCTION public.log_cron_defect(text, text, text, jsonb) RETURNS void LANGUAGE sql AS $f$ SELECT $f$;
`);

/** function -> the [schema.table, column, retention interval] each of its DELETEs uses. */
const CASES = {
  prune_cron_run_log: [["public.cron_run_log", "occurred_at", "45 days"]],
  prune_cron_run_details: [["cron.job_run_details", "end_time", "7 days"]],
  prune_cron_http_requests: [["public.cron_http_requests", "created_at", "2 days"]],
  prune_edge_rate_limit_log: [["public.edge_rate_limit_log", "created_at", "1 day"]],
  cleanup_observability_tables: [["public.error_logs", "created_at", "30 days"], ["public.analytics_events", "created_at", "90 days"]],
  cleanup_stripe_webhook_events: [["public.stripe_webhook_events", "processed_at", "30 days"]],
  prune_retention_tables: [
    // login_history: only a row with no user, or one the same user has a newer row than (here: no user).
    ["public.login_history", "created_at", "365 days"],
    ["public.notification_logs", "created_at", "180 days"],
    ["public.profile_views", "viewed_at", "180 days"],
    ["public.job_views", "first_viewed_at", "365 days"],
    ["public.application_rate_log", "created_at", "7 days"],
    ["public.profile_search_rate_log", "created_at", "7 days"],
    ["public.helper_w9_records", "signed_at", "4 years"],
  ],
};

for (const name of Object.keys(CASES)) {
  const { file, stmt } = newestFunction(name);
  let fixed = onFixedClock(stmt);
  check(`${name}: every clock read is on the fixed clock (${file})`, !/\bnow\s*\(\s*\)|\blocaltimestamp\b/i.test(fixed) && /_probe_now\(\)/.test(fixed));
  if (process.env.PRUNE_INCLUSIVE) fixed = fixed.replace(/<\s*(public\._probe_now\(\)|\(public\._probe_now\(\)\)::timestamp)/g, "<= $1");
  const drop = /^create\s+function/i.test(stmt) ? `DROP FUNCTION IF EXISTS public.${name}();` : "";
  for (let i = 0; i < 3; i++) await db.exec(drop + fixed); // replay-safe: applies 3x
}
if (process.env.PRUNE_INCLUSIVE) console.log("PRUNE_INCLUSIVE=1: every age edge made `<=` (expect FAILs)");

// A fixed instant on a leap day, so the year intervals cross one.
const NOW = "2028-02-29T12:00:00.000Z";
await setClock(db, NOW);
for (const [name, tables] of Object.entries(CASES)) {
  for (const [table, col] of tables) await db.exec(`DELETE FROM ${table};`);
  for (const [table, col, ival] of tables) {
    // The edge, computed by PG. A timestamp column (profile_views) holds the UTC wall clock, as LOCALTIMESTAMP reads it here.
    const cast = table === "public.profile_views" ? "::timestamp" : "";
    for (const [tag, off] of [["past", "-1 millisecond"], ["edge", "0"], ["inside", "1 millisecond"]]) {
      await q(`INSERT INTO ${table} (tag, ${col}) VALUES ($1, (($2::timestamptz - $3::interval) + $4::interval)${cast})`, [tag, NOW, ival, off === "0" ? "0" : off]);
    }
  }
  await db.exec(`SELECT public.${name}()`);
  for (const [table, , ival] of tables) {
    const left = (await q(`SELECT tag FROM ${table} ORDER BY tag`)).map((r) => r.tag).join(",");
    check(`${name}: ${table} (${ival}) deletes the row 1 ms past the edge, keeps the edge and 1 ms inside`, left === "edge,inside", left);
  }
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exitCode = failures ? 1 : 0;
