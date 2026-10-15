/**
 * Q1424 PGlite proof: run_missed_cron_catch_up keeps its clock edges on a
 * fixed clock (./lib/fixedClock.mjs, the newest CREATE of the function).
 *   grace       a missed slot is a candidate once now - slot >= 10 min, not 1 ms before
 *   max_late    a catch-up-safe slot is re-run while now - slot <= max_late; 1 ms past
 *               it is alerted as too late
 *   health      the database counts as healthy only with a success in the last 15 min
 *               (a success exactly 15 min old does not count: the slot waits)
 *
 * The state is the catch-up chain as cronCatchUpOneScan.pglite.mjs applies it
 * (its five migrations plus 20260925155322), then the newest body on the probe
 * clock, 3x. Each case builds its fixture and calls the function in ONE
 * transaction, rolled back after.
 *
 *   node src/test/pglite/cronCatchUpClock.pglite.mjs
 *   CATCH_UP_EDGES_MOVED=1 node src/test/pglite/cronCatchUpClock.pglite.mjs   # RED: each edge moved by one
 *
 * pglite is loaded from ~/.lh-pglite (CLAUDE.md). Registered in
 * src/test/clockFunctionsProven.test.ts.
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { installClock, newestFunction, onFixedClock, setClock } from "./lib/fixedClock.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const CHAIN = ["20260923133021_cron_missed_slot_catch_up.sql", "20260923145516_catch_up_too_late_wording.sql",
  "20260923163407_catch_up_schedule_proof_and_timeouts.sql", "20260923170422_cron_http_request_ids.sql",
  "20260923172145_cron_catch_up_http_outcome_and_untagged.sql", "20260925155322_catch_up_candidates_one_scan.sql"];

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
const q = async (sql, params) => (await db.query(sql, params)).rows;
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
SET TIME ZONE 'UTC';
CREATE TABLE public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seq bigserial, severity text,
  message text, tags jsonb, context jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE public.cron_work_expectations (jobname text PRIMARY KEY, candidate_key text,
  disposition_keys text[] DEFAULT ARRAY[]::text[], min_streak int NOT NULL DEFAULT 2,
  note text NOT NULL DEFAULT '', expected_max_gap interval, registered_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.effects (seq bigserial, jobname text);
CREATE FUNCTION public.fx(p text) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.effects (jobname) VALUES (p) $$;
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text,
  username text DEFAULT current_user, database text DEFAULT current_database(), active boolean DEFAULT true);
CREATE TABLE cron.job_run_details (runid bigserial, jobid bigint, status text, return_message text,
  start_time timestamptz, end_time timestamptz);
CREATE FUNCTION cron.schedule(p_name text, p_sched text, p_cmd text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_sched, p_cmd)
  ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command
  RETURNING jobid $$;
`);
for (const f of CHAIN) await db.exec(mig(f));
await installClock(db);

const MOVED = Boolean(process.env.CATCH_UP_EDGES_MOVED);
if (MOVED) console.log("CATCH_UP_EDGES_MOVED=1: each clock edge moved by one (expect FAILs)");
const EDGE_MOVES = [
  ["AND public._probe_now() - s.slot >= v_grace", "AND public._probe_now() - s.slot > v_grace"],
  ["ELSIF public._probe_now() - r.slot > r.max_late THEN", "ELSIF public._probe_now() - r.slot >= r.max_late THEN"],
  ["WHERE d.start_time > public._probe_now() - interval '15 minutes'", "WHERE d.start_time >= public._probe_now() - interval '15 minutes'"],
];
{
  const { file, stmt } = newestFunction("run_missed_cron_catch_up");
  let fixed = onFixedClock(stmt);
  check(`run_missed_cron_catch_up: every clock read is on the fixed clock (${file})`, !/\bnow\s*\(\s*\)/i.test(fixed) && /_probe_now\(\)/.test(fixed));
  const missing = EDGE_MOVES.filter(([from]) => !fixed.includes(from)).map(([from]) => from);
  check("every edge this probe moves is in the newest body", missing.length === 0, missing.join(" | "));
  if (MOVED) for (const [from, to] of EDGE_MOVES) fixed = fixed.replaceAll(from, to);
  for (let i = 0; i < 3; i++) await db.exec(fixed); // replay-safe: applies 3x
}

const iso = (ms) => new Date(ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
// A daily job at 11:50 UTC on the fall-back Sunday (2026-11-01); it ran at the
// previous day's slot, so the proof that it is on this schedule holds.
const SLOT = Date.UTC(2026, 10, 1, 11, 50, 0);

/** One tick at `clockMs` with a success `healthAgoMs` before it; returns the job's decision (or null) and `waiting`. */
async function tick(clockMs, { healthAgoMs = 2 * MIN, maxLate = "2 hours" } = {}) {
  await db.exec("BEGIN");
  try {
    await setClock(db, iso(clockMs));
    await db.exec(`INSERT INTO cron.job (jobname, schedule, command) VALUES ('probe-daily', '50 11 * * *', 'SELECT public.fx(''probe-daily'');')`);
    await q(`INSERT INTO cron.job_run_details (jobid, status, return_message, start_time, end_time)
             SELECT jobid, 'succeeded', '1 row', $1::timestamptz, $1::timestamptz + interval '5 seconds' FROM cron.job WHERE jobname = 'probe-daily'`, [iso(SLOT - DAY)]);
    // The health signal: a success by some other job (jobid 999999, no cron.job row).
    await q(`INSERT INTO cron.job_run_details (jobid, status, return_message, start_time, end_time) VALUES (999999, 'succeeded', '1 row', $1, $1)`, [iso(clockMs - healthAgoMs)]);
    await q(`INSERT INTO public.cron_catchup_policy (jobname, catch_up, max_late, reason)
             VALUES ('probe-daily', true, $1::interval, 'probe: safe to run late, it only records a row')`, [maxLate]);
    const r = (await q(`SELECT public.run_missed_cron_catch_up() r`))[0].r;
    const mine = (r.decided ?? []).find((d) => d.job === "probe-daily");
    return { action: mine?.action ?? null, waiting: r.waiting, healthy: r.healthy, raw: JSON.stringify(r) };
  } finally {
    await db.exec("ROLLBACK");
  }
}

let t = await tick(SLOT + 10 * MIN);
check("grace: a slot missed by exactly 10 min is caught up", t.action === "caught_up", t.raw);
t = await tick(SLOT + 10 * MIN - 1);
check("grace: 1 ms short of 10 min it is not a candidate yet", t.action === null && t.waiting === 0, t.raw);

t = await tick(SLOT + 2 * HOUR);
check("max_late: exactly max_late (2 h) after the slot it is still re-run", t.action === "caught_up", t.raw);
t = await tick(SLOT + 2 * HOUR + 1);
check("max_late: 1 ms past max_late it is alerted as too late", t.action === "alerted_too_late", t.raw);

t = await tick(SLOT + 20 * MIN, { healthAgoMs: 15 * MIN - 1 });
check("health: a success 1 ms inside 15 min makes the tick healthy (caught up)", t.healthy === true && t.action === "caught_up", t.raw);
t = await tick(SLOT + 20 * MIN, { healthAgoMs: 15 * MIN });
check("health: a success exactly 15 min old does not count (unhealthy: the slot waits)", t.healthy === false && t.action === null && t.waiting === 1, t.raw);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exitCode = failures ? 1 : 0;
