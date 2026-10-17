/**
 * Q1424 PGlite proof: check_ops_alert_pending's two clock windows, on a fixed
 * clock (./lib/fixedClock.mjs, newest CREATE of the function):
 *   stale       ops_alert_pending.queued_at < now - 2 h  (a row exactly 2 h old
 *               is not stale yet; 1 ms older is)
 *   once a day  no new 'ops-alert-pending-stale' report while one exists with
 *               created_at > date_trunc('day', now)  (a report AT UTC midnight
 *               is yesterday's, so today's is filed; 1 ms after is today's)
 *
 *   node src/test/pglite/opsAlertPendingClock.pglite.mjs
 *   OPS_PENDING_INCLUSIVE=1 node src/test/pglite/opsAlertPendingClock.pglite.mjs   # RED: each edge moved by one
 *
 * pglite is loaded from ~/.lh-pglite (CLAUDE.md). Registered in
 * src/test/clockFunctionsProven.test.ts.
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
CREATE TABLE public.ops_alert_pending (id serial, queued_at timestamptz);
CREATE TABLE public.error_logs (id serial, severity text, message text, tags jsonb DEFAULT '{}'::jsonb, context jsonb, created_at timestamptz DEFAULT public._probe_now());
-- The fold is out of scope here (opsAlertPendingWatchdog.pglite.mjs proves it): it folds nothing.
CREATE FUNCTION public.ops_alert_fold_pending() RETURNS int LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION public.log_cron_defect(text, text, text, jsonb) RETURNS void LANGUAGE sql AS $$ SELECT $$;
`);
const { file, stmt } = newestFunction("check_ops_alert_pending");
let fixed = onFixedClock(stmt);
check(`every clock read is on the fixed clock (${file})`, !/\bnow\s*\(\s*\)/i.test(fixed) && /_probe_now\(\)/.test(fixed));
if (process.env.OPS_PENDING_INCLUSIVE) {
  console.log("OPS_PENDING_INCLUSIVE=1: each window edge moved by one (expect FAILs)");
  fixed = fixed
    .replace("WHERE queued_at < public._probe_now() - interval '2 hours'", "WHERE queued_at <= public._probe_now() - interval '2 hours'")
    .replace("e.created_at > date_trunc('day', public._probe_now())", "e.created_at >= date_trunc('day', public._probe_now())");
}
for (let i = 0; i < 3; i++) await db.exec(fixed); // replay-safe: applies 3x

const iso = (ms) => new Date(ms).toISOString();
const N = Date.UTC(2026, 10, 1, 12, 0, 0); // the fall-back day: 24 h of UTC, 25 of Central wall clock
await setClock(db, iso(N));
const run = async () => (await q(`SELECT public.check_ops_alert_pending() AS r`))[0].r;
const reports = async () => (await q(`SELECT count(*)::int n FROM public.error_logs WHERE tags->>'source' = 'ops-alert-pending-stale'`))[0].n;

{
  const EDGE = N - 2 * 3_600_000;
  await db.exec(`DELETE FROM public.ops_alert_pending; DELETE FROM public.error_logs;`);
  await q(`INSERT INTO public.ops_alert_pending (queued_at) VALUES ($1)`, [iso(EDGE)]);
  let r = await run();
  check("a row queued exactly 2 h ago is not stale yet", r.ok === true && Number(r.queued) === 1 && (await reports()) === 0, JSON.stringify(r));
  await db.exec(`DELETE FROM public.ops_alert_pending;`);
  await q(`INSERT INTO public.ops_alert_pending (queued_at) VALUES ($1)`, [iso(EDGE - 1)]);
  r = await run();
  check("a row queued 2 h + 1 ms ago is stale and reported", r.ok === false && Number(r.stale) === 1 && (await reports()) === 1, JSON.stringify(r));
}

{
  // One report a UTC day: an existing report AT midnight is yesterday's; 1 ms after is today's.
  const midnight = Date.UTC(2026, 10, 1, 0, 0, 0);
  const seed = async (createdMs) => {
    await db.exec(`DELETE FROM public.ops_alert_pending; DELETE FROM public.error_logs;`);
    await q(`INSERT INTO public.ops_alert_pending (queued_at) VALUES ($1)`, [iso(N - 3 * 3_600_000)]);
    await q(`INSERT INTO public.error_logs (severity, message, tags, created_at) VALUES ('error', 'x', '{"source":"ops-alert-pending-stale","area":"ops"}', $1)`, [iso(createdMs)]);
    await run();
    return reports();
  };
  const atEdge = await seed(midnight);
  const after = await seed(midnight + 1);
  check("a report at UTC midnight is yesterday's (today's is filed), 1 ms after is today's (not)", atEdge === 2 && after === 1, `${atEdge}, ${after}`);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exitCode = failures ? 1 : 0;
