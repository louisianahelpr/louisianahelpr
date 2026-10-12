#!/usr/bin/env node
/**
 * PGlite proof for 20261012195747_unfilled_series_visit_reminder (Q417 e).
 *
 *   node src/test/pglite/unfilledSeriesVisitReminder.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/unfilledSeriesVisitReminder.pglite.mjs # RED: the state on main
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR). Fixture: jobs, notifications and
 * job_payment_is_funded (cut from its newest migration). On main nothing tells
 * the poster, so the "told" checks fail.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import { installClock, newestFunction, onFixedClock, setClock } from "./lib/fixedClock.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW = readFileSync(`${MIG}20261012195747_unfilled_series_visit_reminder.sql`, "utf8");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the state on main (expect FAILs)`);

function newestFn(name) {
  let out = null;
  for (const f of readdirSync(MIG).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = readFileSync(MIG + f, "utf8");
    const m = [...sql.matchAll(new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi"))].at(-1);
    if (!m) continue;
    const open = /\bAS\s+(\$\w*\$)/i.exec(sql.slice(m.index));
    const close = sql.indexOf(open[1], m.index + open.index + open[0].length);
    out = sql.slice(m.index, sql.indexOf(";", close) + 1);
  }
  return out;
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const POSTER = "00000000-0000-0000-0000-0000000000c1";
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SERIES = id(1);

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.jobs(id uuid PRIMARY KEY, title text, customer_id uuid, helper_id uuid, parent_job_id uuid,
    date_needed date, status text, payment_status text, series_ended_on date);
  CREATE TABLE public.notifications(user_id uuid, job_id uuid, title text, message text, type text, link text);
`);
await db.exec(newestFn("job_payment_is_funded"));
if (!MODE) for (let i = 0; i < 3; i++) await db.exec(NEW);

// Q1357 (sweepClockProofs): the sweep runs on a FIXED clock, its newest body
// with every now()/current_date pointed at public._probe_now(). 10:00 Central.
await installClock(db);
await setClock(db, "2031-06-10T15:00:00Z");
if (!MODE) await db.exec(onFixedClock(newestFunction("sweep_unfilled_series_visit_reminders").stmt));
const tomorrow = `(public._probe_now() AT TIME ZONE 'America/Chicago')::date + 1`;
await db.exec(`
  INSERT INTO public.jobs VALUES
    ('${SERIES}', 'Weekly lawn', '${POSTER}', NULL, NULL, ${tomorrow} - 14, 'completed', 'released', NULL),
    ('${id(8)}', 'Pool', '${POSTER}', NULL, NULL, ${tomorrow} - 14, 'completed', 'released', ${tomorrow} - 1),
    ('${id(9)}', 'Pool', '${POSTER}', NULL, '${id(8)}', ${tomorrow}, 'open', 'escrow', NULL),          -- vacated, but its series ENDED: not told
    ('${id(2)}', 'Weekly lawn', '${POSTER}', NULL, '${SERIES}', ${tomorrow}, 'open', 'escrow', NULL),        -- vacated, tomorrow: told
    ('${id(3)}', 'Weekly lawn', '${POSTER}', NULL, '${SERIES}', ${tomorrow} + 1, 'open', 'escrow', NULL),    -- in two days: not yet
    ('${id(4)}', 'Weekly lawn', '${POSTER}', '00000000-0000-0000-0000-0000000000d1', '${SERIES}', ${tomorrow}, 'accepted', 'escrow', NULL), -- filled
    ('${id(5)}', 'Weekly lawn', NULL, NULL, '${SERIES}', ${tomorrow}, 'open', 'escrow', NULL),               -- poster deleted
    ('${id(6)}', 'Weekly lawn', '${POSTER}', NULL, '${SERIES}', ${tomorrow}, 'open', 'pending', NULL),       -- not funded
    ('${id(7)}', 'One-off', '${POSTER}', NULL, NULL, ${tomorrow}, 'open', 'escrow', NULL);                   -- not a series visit
`);

const run = async () => {
  try {
    return (await db.query(`SELECT public.sweep_unfilled_series_visit_reminders() AS n`)).rows[0].n;
  } catch (e) {
    return e.message;
  }
};
const first = await run();
const told = (await db.query(`SELECT job_id, user_id, message, link FROM public.notifications`)).rows;
check("the vacated visit dated tomorrow tells its poster once", first === 1 && told.length === 1 && told[0].job_id === id(2) && told[0].user_id === POSTER, `${first} / ${JSON.stringify(told.map((t) => t.job_id))}`);
check("  the notice names tomorrow and what happens if it stays empty", /tomorrow/.test(told[0]?.message ?? "") && /cancelled when the day passes and refunded/.test(told[0]?.message ?? ""), told[0]?.message);
check("  it links to the series on My Posts", told[0]?.link === `/posts?job=${SERIES}`, told[0]?.link);
const second = await run();
check("a second run tells nobody again", second === 0 && (await db.query(`SELECT count(*)::int n FROM public.notifications`)).rows[0].n === 1, String(second));
// One day later on the same clock the visit that was two days out is tomorrow: it is told.
await setClock(db, "2031-06-11T15:00:00Z");
const nextDay = await run();
const toldNext = (await db.query(`SELECT job_id FROM public.notifications ORDER BY job_id`)).rows.map((r) => r.job_id);
check("the next day, the visit now dated tomorrow is told (fixed clock moved one day)", nextDay === 1 && toldNext.includes(id(3)), `${nextDay} / ${JSON.stringify(toldNext)}`);

if (!MODE) {
  const priv = async (role) => (await db.query(`SELECT has_function_privilege('${role}', 'public.sweep_unfilled_series_visit_reminders()', 'EXECUTE') x`)).rows[0].x;
  check("service_role only", !(await priv("anon")) && !(await priv("authenticated")) && (await priv("service_role")));
}

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
