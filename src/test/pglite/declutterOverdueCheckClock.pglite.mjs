/**
 * Q1424 PGlite proof: declutter_alert_overdue_checks' 45-minute windows, on a fixed clock (./lib/fixedClock.mjs,
 * newest CREATE of the function). declutterCheckSweep.pglite.mjs rewrites the timestamps relative to now(); this one
 * moves the clock and reads each edge 1 ms either side:
 *   on sale 45 min   i.live_at < now - 45 min                 (exactly 45 min: no alert; 45 min + 1 ms: alerted)
 *   cleared retry    ai_check_cleared_at < now - 45 min       (a check cleared exactly 45 min ago still waits;
 *                    45 min + 1 ms ago: alerted again, since the earlier alert predates the clear)
 *   once             ai_check_overdue_alerted_at = the clock; the next run does not alert it again.
 *
 *   node src/test/pglite/declutterOverdueCheckClock.pglite.mjs
 *   OVERDUE_LIVE_INCLUSIVE=1 node src/test/pglite/declutterOverdueCheckClock.pglite.mjs     # RED: alerted at exactly 45 min
 *   OVERDUE_CLEARED_INCLUSIVE=1 node src/test/pglite/declutterOverdueCheckClock.pglite.mjs  # RED: the cleared edge made inclusive
 *
 * is_test_subject is stubbed false (the probe's listings are ordinary). pglite is loaded from ~/.lh-pglite
 * (CLAUDE.md). Registered in src/test/clockFunctionsProven.test.ts.
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
CREATE ROLE service_role;
CREATE ROLE authenticated;
CREATE ROLE anon;
CREATE TABLE public.user_roles (user_id uuid, role text);
INSERT INTO public.user_roles VALUES ('33333333-3333-4333-8333-333333333333', 'admin');
CREATE TABLE public.declutter_items (
  id int PRIMARY KEY, seller_id uuid DEFAULT gen_random_uuid(), title text DEFAULT 'Oak chair', status text DEFAULT 'live',
  live_at timestamptz, admin_approved_at timestamptz, is_seed boolean DEFAULT false);
CREATE TABLE public.declutter_item_private (
  item_id int PRIMARY KEY, ai_checked_at timestamptz, ai_check_cleared_at timestamptz, ai_check_overdue_alerted_at timestamptz);
CREATE TABLE public.notifications (user_id uuid, title text, message text, type text, link text, read boolean DEFAULT false);
CREATE FUNCTION public.is_test_subject(u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
`);
const { file, stmt } = newestFunction("declutter_alert_overdue_checks");
const base = onFixedClock(stmt);
let fixed = base;
check(`every clock read is on the fixed clock (${file})`, !/\bnow\s*\(\s*\)/i.test(fixed) && /_probe_now\(\)/.test(fixed));
const mutations = {
  OVERDUE_LIVE_INCLUSIVE: ["AND i.live_at < public._probe_now() - interval '45 minutes'", "AND i.live_at <= public._probe_now() - interval '45 minutes'"],
  OVERDUE_CLEARED_INCLUSIVE: ["pv.ai_check_cleared_at < public._probe_now() - interval '45 minutes'", "pv.ai_check_cleared_at <= public._probe_now() - interval '45 minutes'"],
};
let mutated = false;
for (const [env, [from, to]] of Object.entries(mutations)) {
  if (!process.env[env]) continue;
  console.log(`${env}=1 (expect FAILs)`);
  check(`${env}: the text to change is in the newest body`, fixed.includes(from));
  fixed = fixed.replace(from, to);
  mutated = true;
}
check("the mutation (if any) applied", !mutated || fixed !== base);
// Replay-safe: applies 3x (the REVOKE/GRANT tail needs the three roles created above).
for (let i = 0; i < 3; i++) await db.exec(fixed);

const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
const MIN = 60_000;
const seed = async ({ liveAt, clearedAt = null, alertedAt = null }) => {
  await db.exec(`DELETE FROM public.notifications; DELETE FROM public.declutter_item_private; DELETE FROM public.declutter_items;`);
  await q(`INSERT INTO public.declutter_items (id, live_at) VALUES (1, $1)`, [iso(liveAt)]);
  await q(`INSERT INTO public.declutter_item_private (item_id, ai_check_cleared_at, ai_check_overdue_alerted_at) VALUES (1, $1, $2)`, [iso(clearedAt), iso(alertedAt)]);
};
const sweep = async (nowMs) => {
  await setClock(db, iso(nowMs));
  const n = (await q(`SELECT public.declutter_alert_overdue_checks() AS n`))[0].n;
  const [{ alerted }] = await q(`SELECT ai_check_overdue_alerted_at::text alerted FROM public.declutter_item_private WHERE item_id = 1`);
  const notes = (await q(`SELECT count(*)::int c FROM public.notifications`))[0].c;
  return { n, alerted, notes };
};

const N = Date.UTC(2026, 6, 15, 20, 7, 0); // a :07 run, as the cron schedules it
{
  await seed({ liveAt: N - 45 * MIN });
  const r = await sweep(N);
  check("on sale exactly 45 min, no check: not alerted yet", r.n === 0 && r.alerted === null && r.notes === 0, JSON.stringify(r));
  await seed({ liveAt: N - 45 * MIN - 1 });
  const r2 = await sweep(N);
  check("45 min + 1 ms: alerted, stamped with the clock, the admin told", r2.n === 1 && r2.alerted === "2026-07-15 20:07:00+00" && r2.notes === 1, JSON.stringify(r2));
  const again = await sweep(N + 15 * MIN);
  check("the next run: not alerted again", again.n === 0, JSON.stringify(again));
}
{
  // Alerted before, then an admin cleared the check (it retries); the new 45 minutes count from the clear.
  const liveAt = N - 5 * 60 * MIN;
  await seed({ liveAt, alertedAt: N - 4 * 60 * MIN, clearedAt: N - 45 * MIN });
  const r = await sweep(N);
  check("cleared exactly 45 min ago: still waiting", r.n === 0, JSON.stringify(r));
  await seed({ liveAt, alertedAt: N - 4 * 60 * MIN, clearedAt: N - 45 * MIN - 1 });
  const r2 = await sweep(N);
  check("cleared 45 min + 1 ms ago: alerted again (the old alert predates the clear)", r2.n === 1 && r2.alerted === "2026-07-15 20:07:00+00", JSON.stringify(r2));
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
