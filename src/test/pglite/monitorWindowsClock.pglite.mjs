/**
 * Q1424 PGlite proof: the ops monitors that count rows in a trailing window
 * count a row 1 ms inside the window and not a row AT its edge, on a fixed clock
 * (./lib/fixedClock.mjs, newest CREATE of each function).
 *   check_seed_boundary_failures   notification_logs.created_at > now - 24 h
 *   check_error_log_throttle       drops in the last 10 COMPLETE minutes [m-10, m) (m = this
 *                                  minute), raised again only after 15 min, its drop rows
 *                                  pruned past 14 days
 *   check_push_token_health        tokens updated / native users seen in the last 14 days,
 *                                  no-device skips in the last 7, one report a UTC day
 *   send_ops_daily_digest          error_logs and CSP reports of the last 24 h (its Slack post
 *                                  fails here, no pg_net, and it says so: posted false)
 *
 *   node src/test/pglite/monitorWindowsClock.pglite.mjs
 *   MONITOR_INCLUSIVE=1 node src/test/pglite/monitorWindowsClock.pglite.mjs   # RED: `>` made `>=`
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
CREATE TABLE public.notification_logs (id serial, channel text, status text, error_message text, created_at timestamptz);
CREATE TABLE public.push_tokens (id serial, user_id uuid, updated_at timestamptz);
CREATE TABLE public.profiles (user_id uuid, is_seed boolean);
CREATE TABLE public.analytics_events (id serial, user_id uuid, platform text, created_at timestamptz);
CREATE TABLE public.error_log_throttle_drops (minute timestamptz, drop_kind text, dropped int);
CREATE TABLE public.error_logs (id serial, severity text, message text, tags jsonb DEFAULT '{}'::jsonb, context jsonb, created_at timestamptz DEFAULT public._probe_now());
`);
if (process.env.MONITOR_INCLUSIVE) console.log("MONITOR_INCLUSIVE=1: each window edge moved by one (expect FAILs)");
for (const name of ["check_seed_boundary_failures", "check_error_log_throttle", "check_push_token_health", "send_ops_daily_digest"]) {
  const { file, stmt } = newestFunction(name);
  let fixed = onFixedClock(stmt);
  check(`${name}: every clock read is on the fixed clock (${file})`, !/\bnow\s*\(\s*\)/i.test(fixed) && /_probe_now\(\)/.test(fixed));
  if (process.env.MONITOR_INCLUSIVE) {
    fixed = fixed
      .replace("l.created_at > public._probe_now() - interval '24 hours'", "l.created_at >= public._probe_now() - interval '24 hours'")
      .replaceAll("AND d.minute < v_now_min", "AND d.minute <= v_now_min")
      .replace("e.created_at > public._probe_now() - interval '15 minutes'", "e.created_at >= public._probe_now() - interval '15 minutes'")
      .replace("WHERE minute < public._probe_now() - interval '14 days'", "WHERE minute <= public._probe_now() - interval '14 days'")
      .replace("t.updated_at > public._probe_now() - interval '14 days'", "t.updated_at >= public._probe_now() - interval '14 days'")
      .replace("e.created_at > date_trunc('day', public._probe_now())", "e.created_at >= date_trunc('day', public._probe_now())")
      .replaceAll("WHERE e.created_at > public._probe_now() - interval '24 hours'", "WHERE e.created_at >= public._probe_now() - interval '24 hours'");
  }
  for (let i = 0; i < 3; i++) await db.exec(fixed); // replay-safe: applies 3x
}

const NOW = Date.UTC(2026, 10, 1, 12, 0, 0); // the fall-back day: 24 h of UTC, 25 of Central wall clock
const iso = (ms) => new Date(ms).toISOString();
await setClock(db, iso(NOW));
async function counted(createdMs) {
  await db.exec(`DELETE FROM public.notification_logs; DELETE FROM public.error_logs;`);
  await q(`INSERT INTO public.notification_logs (error_message, created_at) VALUES ('seed boundary check failed: x', $1)`, [iso(createdMs)]);
  const [{ r }] = await q(`SELECT public.check_seed_boundary_failures() AS r`);
  return Number(r.failed_24h);
}
const EDGE = NOW - 24 * 3_600_000;
check("check_seed_boundary_failures: a failure exactly 24 h old is out of the window", (await counted(EDGE)) === 0);
check("check_seed_boundary_failures: 1 ms inside the window is counted (and reported)", (await counted(EDGE + 1)) === 1 && (await q(`SELECT count(*)::int n FROM public.error_logs`))[0].n === 1);

{
  // check_error_log_throttle, at a minute boundary so `this minute` is NOW itself.
  const MIN = 60_000;
  const M = Date.UTC(2026, 10, 1, 12, 0, 0);
  await setClock(db, iso(M));
  const drops = async (...mins) => {
    await db.exec(`DELETE FROM public.error_log_throttle_drops; DELETE FROM public.error_logs;`);
    for (const m of mins) await q(`INSERT INTO public.error_log_throttle_drops VALUES ($1, 'rate', 5)`, [iso(m)]);
  };
  const run = async () => (await q(`SELECT public.check_error_log_throttle() AS r`))[0].r;
  await drops(M - 10 * MIN, M - 1 * MIN);
  let r = await run();
  check("check_error_log_throttle: drops in the oldest (m-10) and newest (m-1) complete minutes count: 2 minutes, raised", r.minutes === 2 && r.raised === true, JSON.stringify(r));
  await drops(M - 11 * MIN, M);
  r = await run();
  check("check_error_log_throttle: m-11 (too old) and m (not complete) do not count", r.minutes === 0 && r.raised === false, JSON.stringify(r));
  // Raised again only once the last report is MORE than 15 minutes old.
  await drops(M - 2 * MIN, M - 1 * MIN);
  await q(`INSERT INTO public.error_logs (message, tags, created_at) VALUES ('x', '{"source":"error-log-throttled"}', $1)`, [iso(M - 15 * MIN + 1)]);
  r = await run();
  check("check_error_log_throttle: a report 15 min - 1 ms old holds the next one", r.raised === false, JSON.stringify(r));
  await drops(M - 2 * MIN, M - 1 * MIN);
  await q(`INSERT INTO public.error_logs (message, tags, created_at) VALUES ('x', '{"source":"error-log-throttled"}', $1)`, [iso(M - 15 * MIN)]);
  r = await run();
  check("check_error_log_throttle: a report exactly 15 min old does not", r.raised === true, JSON.stringify(r));
  // Its drop rows: kept AT 14 days, deleted 1 ms past.
  await drops(M - 14 * 24 * 60 * MIN, M - 14 * 24 * 60 * MIN - 1);
  await run();
  const left = (await q(`SELECT count(*)::int n FROM public.error_log_throttle_drops`))[0].n;
  check("check_error_log_throttle: a drop row exactly 14 days old is kept, 1 ms older is pruned", left === 1, String(left));
}

{
  // check_push_token_health on the fall-back day at noon UTC.
  const DAY = 24 * 3_600_000;
  const N = Date.UTC(2026, 10, 1, 12, 0, 0);
  await setClock(db, iso(N));
  const U = (k) => `00000000-0000-0000-0000-00000000000${k}`;
  await db.exec(`DELETE FROM public.push_tokens; DELETE FROM public.analytics_events; DELETE FROM public.notification_logs; DELETE FROM public.error_logs;`);
  await q(`INSERT INTO public.push_tokens (user_id, updated_at) VALUES ($1, $2), ($3, $4)`, [U(1), iso(N - 14 * DAY), U(2), iso(N - 14 * DAY + 1)]);
  await q(`INSERT INTO public.analytics_events (user_id, platform, created_at) VALUES ($1, 'ios', $2), ($3, 'android', $4)`, [U(1), iso(N - 14 * DAY), U(2), iso(N - 14 * DAY + 1)]);
  await q(`INSERT INTO public.notification_logs (channel, status, error_message, created_at) VALUES
           ('push', 'skipped', 'no_registered_devices', $1), ('push', 'skipped', 'no_registered_devices', $2)`, [iso(N - 7 * DAY), iso(N - 7 * DAY + 1)]);
  let r = (await q(`SELECT public.check_push_token_health() AS r`))[0].r;
  check("check_push_token_health: each trailing window counts 1 ms inside, not its edge (14 d tokens, 14 d native users, 7 d skips)",
    r.registered_14d === 1 && r.native_users_14d === 1 && r.skipped_no_device_7d === 1, JSON.stringify(r));
  // No tokens: one report a UTC day. A report AT UTC midnight is yesterday's; 1 ms after is today's.
  await db.exec(`DELETE FROM public.push_tokens; DELETE FROM public.error_logs;`);
  const midnight = Date.UTC(2026, 10, 1, 0, 0, 0);
  await q(`INSERT INTO public.error_logs (message, tags, created_at) VALUES ('x', '{"source":"push-tokens-empty"}', $1)`, [iso(midnight)]);
  await q(`SELECT public.check_push_token_health()`);
  const afterEdge = (await q(`SELECT count(*)::int n FROM public.error_logs`))[0].n;
  await db.exec(`DELETE FROM public.error_logs;`);
  await q(`INSERT INTO public.error_logs (message, tags, created_at) VALUES ('x', '{"source":"push-tokens-empty"}', $1)`, [iso(midnight + 1)]);
  await q(`SELECT public.check_push_token_health()`);
  const afterToday = (await q(`SELECT count(*)::int n FROM public.error_logs`))[0].n;
  check("check_push_token_health: a report at UTC midnight is yesterday's (reported again), 1 ms after is today's (not)", afterEdge === 2 && afterToday === 1, `${afterEdge}, ${afterToday}`);
}

{
  // send_ops_daily_digest: the last 24 h, edge excluded, for the event count and the CSP count.
  const N = Date.UTC(2026, 10, 1, 12, 0, 0);
  await setClock(db, iso(N));
  const EDGE = N - 24 * 3_600_000;
  await db.exec(`DELETE FROM public.error_logs;`);
  await q(`INSERT INTO public.error_logs (severity, message, tags, created_at) VALUES
           ('error', 'edge', '{"source":"app"}', $1), ('error', 'inside', '{"source":"app"}', $2),
           ('warning', 'csp edge', '{"source":"csp","directive":"img-src","blocked":"https://x.test/a"}', $1),
           ('warning', 'csp inside', '{"source":"csp","directive":"img-src","blocked":"https://x.test/a"}', $2)`, [iso(EDGE), iso(EDGE + 1)]);
  const r = (await q(`SELECT public.send_ops_daily_digest() AS r`))[0].r;
  check("send_ops_daily_digest: counts the events and CSP reports 1 ms inside its 24 h, not the edge", r.total === 2 && r.csp === 1 && r.posted === false, JSON.stringify(r));
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exitCode = failures ? 1 : 0;
