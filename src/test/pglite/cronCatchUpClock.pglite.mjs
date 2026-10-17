/**
 * Q1424 PGlite proof: run_missed_cron_catch_up's clock edges, on a fixed clock
 * (./lib/fixedClock.mjs, newest CREATE of the function):
 *   grace       a slot is due only once now - slot >= 10 min (exactly 10 min:
 *               due; 1 ms less: not yet)
 *   max_late    a catch-up-safe job is run while now - slot <= max_late
 *               (exactly max_late: caught up; 1 ms more: alerted_too_late)
 *   healthy     it runs only if a run SUCCEEDED in the last 15 min,
 *               start_time > now - 15 min (one exactly 15 min old does not
 *               count, so it waits; 1 ms younger: caught up)
 * The state is the Q30 chain as cronCatchUpOneScan.pglite.mjs applies it, then
 * the newest body on the fixed clock, 3x. A daily job at 12:00 UTC whose
 * pg_cron run at the slot FAILED (its proof that it was on this schedule).
 *
 *   node src/test/pglite/cronCatchUpClock.pglite.mjs
 *   CATCHUP_EDGES_MOVED=1 node src/test/pglite/cronCatchUpClock.pglite.mjs   # RED: each edge moved by one
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
const PRIOR = ["20260923133021_cron_missed_slot_catch_up.sql", "20260923145516_catch_up_too_late_wording.sql",
  "20260923163407_catch_up_schedule_proof_and_timeouts.sql", "20260923170422_cron_http_request_ids.sql",
  "20260923172145_cron_catch_up_http_outcome_and_untagged.sql"].map(mig).join("\n");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
const q = async (sql, params) => (await db.query(sql, params)).rows;
await db.exec(`
SET TIME ZONE 'UTC';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
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
await db.exec(PRIOR);
await installClock(db);
const { file, stmt } = newestFunction("run_missed_cron_catch_up");
let fixed = onFixedClock(stmt);
check(`every clock read is on the fixed clock (${file})`, !/\bnow\s*\(\s*\)/i.test(fixed) && /_probe_now\(\)/.test(fixed));
if (process.env.CATCHUP_EDGES_MOVED) {
  console.log("CATCHUP_EDGES_MOVED=1: each edge moved by one (expect FAILs)");
  const before = fixed;
  fixed = fixed
    .replace("AND public._probe_now() - s.slot >= v_grace", "AND public._probe_now() - s.slot > v_grace")
    .replace("ELSIF public._probe_now() - r.slot > r.max_late THEN", "ELSIF public._probe_now() - r.slot >= r.max_late THEN")
    .replace("WHERE d.start_time > public._probe_now() - interval '15 minutes'", "WHERE d.start_time >= public._probe_now() - interval '15 minutes'");
  console.log(before === fixed ? "NOTHING PLANTED" : "planted");
}
for (let i = 0; i < 3; i++) await db.exec(fixed); // replay-safe: applies 3x

const iso = (ms) => new Date(ms).toISOString();
const MIN = 60_000;
const SLOT = Date.UTC(2026, 10, 1, 12, 0, 0); // a daily 12:00 UTC slot on the fall-back day
await db.exec(`INSERT INTO cron.job (jobname, schedule, command) VALUES ('probe-job', '0 12 * * *', 'SELECT public.fx(''probe-job'');');`);

/** One tick at `nowMs`; returns this job's claim action for the slot, or 'waiting' / 'not due'. */
async function tick(nowMs, { safe = false, maxLateMin = 60, okRunAgoMs = null } = {}) {
  await db.exec(`DELETE FROM public.cron_catchup_runs; DELETE FROM cron.job_run_details; DELETE FROM public.cron_catchup_policy; DELETE FROM public.effects;`);
  // pg_cron started it AT the slot and it failed: the proof it was on this schedule.
  await q(`INSERT INTO cron.job_run_details (jobid, status, return_message, start_time, end_time)
           SELECT jobid, 'failed', 'boom', $1, $1 FROM cron.job WHERE jobname = 'probe-job'`, [iso(SLOT + 5000)]);
  if (okRunAgoMs !== null) {
    // Another job's run that succeeded, for the 15-minute health window.
    await q(`INSERT INTO cron.job_run_details (jobid, status, start_time, end_time) VALUES (999, 'succeeded', $1, $1)`, [iso(nowMs - okRunAgoMs)]);
  }
  if (safe) {
    await q(`INSERT INTO public.cron_catchup_policy (jobname, catch_up, max_late, reason)
             VALUES ('probe-job', true, make_interval(mins => $1), 'probe: safe to run late within the window')`, [maxLateMin]);
  }
  await setClock(db, iso(nowMs));
  const r = (await q(`SELECT public.run_missed_cron_catch_up() AS r`))[0].r;
  const claim = (await q(`SELECT action FROM public.cron_catchup_runs WHERE jobname = 'probe-job'`))[0]?.action;
  return claim ?? (Number(r.waiting) > 0 ? "waiting" : "not due");
}

check("exactly 10 min after the slot it is due (unclassified: alerted)", (await tick(SLOT + 10 * MIN)) === "alerted_unclassified");
check("10 min - 1 ms after the slot it is not due yet", (await tick(SLOT + 10 * MIN - 1)) === "not due");
check("a safe job exactly max_late after its slot is caught up", (await tick(SLOT + 60 * MIN, { safe: true, okRunAgoMs: MIN })) === "caught_up");
check("1 ms past max_late it is alerted_too_late", (await tick(SLOT + 60 * MIN + 1, { safe: true, okRunAgoMs: MIN })) === "alerted_too_late");
check("a success exactly 15 min old does not make the tick healthy (it waits)", (await tick(SLOT + 20 * MIN, { safe: true, okRunAgoMs: 15 * MIN })) === "waiting");
check("a success 15 min - 1 ms old does (caught up)", (await tick(SLOT + 20 * MIN, { safe: true, okRunAgoMs: 15 * MIN - 1 })) === "caught_up");

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exitCode = failures ? 1 : 0;
