/**
 * PGlite proof for 20260923133021_cron_missed_slot_catch_up (docs/OPEN.md Q30).
 *
 *   node src/test/pglite/cronCatchUp.pglite.mjs
 *   SKIP_MIGRATION=1 node src/test/pglite/cronCatchUp.pglite.mjs   # the state before: RED
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * A pg_cron stand-in (cron.job + cron.job_run_details, schedules computed from
 * the clock so a slot is always "1 hour ago") with failed runs simulated the
 * way 2026-09-22 left them ("job startup timeout"). Proves: applies 3x; the
 * slot arithmetic for daily/weekly and nothing else; a catch-up-safe job whose
 * slot failed is run ONCE and never again however often the sweep runs; an
 * unsafe (money) job, an unclassified job and a too-late job are NOT run and
 * each writes one 'cron-missed-slot' error; a job that succeeded, a job with
 * no evidence it existed, and an hourly job are left alone; an unhealthy DB
 * defers the catch-up without claiming the slot, and it runs once healthy; a
 * catch-up that raises is recorded as failed, alerted, and not retried; the
 * ledger close rule for 'cron-caught-up'; cron + liveness registered once;
 * anon/authenticated can execute nothing and read nothing.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
// 20260923145516 (Q189) redefines the function with the corrected too-late
// wording; both apply in order, exactly as on prod.
// 20260923163407 (Q207) restates it again: schedule proof, the job's own
// lock_timeout, query_canceled caught per command.
// 20260923172145 (Q207 part 2) restates it once more, keeping the request id
// of a caught-up HTTP job (needs Q174's cron_http_requests, 20260923170422);
// its own proof is cronCatchUpHttpOutcome.pglite.mjs.
// 20260925155322 (Q397) reads the run history in one pass; every check below
// runs against that newest body. Old-vs-new equivalence: cronCatchUpOneScan.pglite.mjs.
const MIGRATION = ["20260923133021_cron_missed_slot_catch_up.sql", "20260923145516_catch_up_too_late_wording.sql",
  "20260923163407_catch_up_schedule_proof_and_timeouts.sql", "20260923170422_cron_http_request_ids.sql",
  "20260923172145_cron_catch_up_http_outcome_and_untagged.sql", "20260925155322_catch_up_candidates_one_scan.sql"]
  .map((f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8"))
  .join("\n");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
const q = async (sql) => (await db.query(sql)).rows;
const one = async (sql) => (await q(sql))[0];

await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
CREATE TABLE public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text,
  message text, tags jsonb, context jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE public.cron_work_expectations (jobname text PRIMARY KEY, candidate_key text,
  disposition_keys text[] DEFAULT ARRAY[]::text[], min_streak int NOT NULL DEFAULT 2,
  note text NOT NULL DEFAULT '', expected_max_gap interval, registered_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.side_effects (kind text PRIMARY KEY, n int NOT NULL DEFAULT 0);
INSERT INTO public.side_effects VALUES ('digest', 0), ('charge', 0), ('other', 0), ('resched', 0), ('cancel', 0);
-- Q207(3): the lock_timeout each executed job saw, and the one in force for
-- each error_logs write (the tick's own writes, after the job).
CREATE TABLE public.lock_seen (who text, lock_timeout text);
CREATE FUNCTION public.fake_lockjob() RETURNS void LANGUAGE sql AS
  $$ INSERT INTO public.lock_seen VALUES ('job', current_setting('lock_timeout')) $$;
CREATE FUNCTION public.log_lock_seen() RETURNS trigger LANGUAGE plpgsql AS
  $$ BEGIN INSERT INTO public.lock_seen VALUES ('alert:' || coalesce(NEW.tags->>'job', '?'), current_setting('lock_timeout')); RETURN NEW; END $$;
CREATE TRIGGER error_logs_lock_seen BEFORE INSERT ON public.error_logs FOR EACH ROW EXECUTE FUNCTION public.log_lock_seen();
CREATE FUNCTION public.fake_resched() RETURNS void LANGUAGE sql AS
  $$ UPDATE public.side_effects SET n = n + 1 WHERE kind = 'resched' $$;
-- Q207(4): what a statement_timeout looks like inside the EXECUTE.
CREATE FUNCTION public.fake_cancel() RETURNS void LANGUAGE plpgsql AS
  $$ BEGIN UPDATE public.side_effects SET n = n + 1 WHERE kind = 'cancel';
            RAISE EXCEPTION 'canceling statement due to statement timeout' USING ERRCODE = 'query_canceled'; END $$;
CREATE FUNCTION public.fake_digest() RETURNS void LANGUAGE sql AS
  $$ UPDATE public.side_effects SET n = n + 1 WHERE kind = 'digest' $$;
CREATE FUNCTION public.fake_charge() RETURNS void LANGUAGE sql AS
  $$ UPDATE public.side_effects SET n = n + 1 WHERE kind = 'charge' $$;
CREATE FUNCTION public.fake_other() RETURNS void LANGUAGE sql AS
  $$ UPDATE public.side_effects SET n = n + 1 WHERE kind = 'other' $$;
CREATE FUNCTION public.boom() RETURNS void LANGUAGE plpgsql AS
  $$ BEGIN UPDATE public.side_effects SET n = n + 100 WHERE kind = 'other'; RAISE EXCEPTION 'boom'; END $$;
-- pg_cron stand-in: the columns run_missed_cron_catch_up reads.
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

if (process.env.SKIP_MIGRATION) {
  console.log("SKIP_MIGRATION set: running the checks against the state BEFORE the migration");
} else {
  for (let i = 1; i <= 3; i++) {
    try {
      await db.exec(MIGRATION);
      check(`apply pass #${i}`, true);
    } catch (e) {
      check(`apply pass #${i}`, false, e.message);
    }
  }
}

const safeq = async (label, fn) => {
  try { return await fn(); } catch (e) { check(label, false, e.message.split("\n")[0]); return undefined; }
};

// ── slot arithmetic ─────────────────────────────────────────────────────────
const slot = async (sched, at) =>
  safeq(`last_slot(${sched})`, () => q(`SELECT to_char(slot AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') || '+00' s, period::text p FROM public.cron_catchup_last_slot('${sched}', '${at}'::timestamptz)`));
let s = await slot("40 14 * * *", "2026-09-23 13:00:00+00");
check("daily slot before today's time = yesterday's", s?.[0]?.s === "2026-09-22 14:40:00+00" && s[0].p === "1 day", JSON.stringify(s));
s = await slot("40 14 * * *", "2026-09-23 15:00:00+00");
check("daily slot after today's time = today's", s?.[0]?.s === "2026-09-23 14:40:00+00", JSON.stringify(s));
s = await slot("19 14 * * 1", "2026-09-23 13:00:00+00"); // a Wednesday
check("weekly (Mon) slot = last Monday", s?.[0]?.s === "2026-09-21 14:19:00+00" && s[0].p === "7 days", JSON.stringify(s));
s = await slot("19 14 * * 3", "2026-09-23 13:00:00+00"); // Wednesday, before 14:19
check("weekly slot later today = a week ago", s?.[0]?.s === "2026-09-16 14:19:00+00", JSON.stringify(s));
for (const sched of ["*/5 * * * *", "15 */6 * * *", "0 * * * *", "4-59/10 * * * *", "0 9 1 * *"]) {
  s = await slot(sched, "2026-09-23 13:00:00+00");
  check(`'${sched}' is not daily/weekly (no slot)`, Array.isArray(s) && s.length === 0, JSON.stringify(s));
}

// ── fixture jobs: every slot is exactly 1 hour ago ──────────────────────────
const { m, h, dow } = await one(`SELECT extract(minute FROM t)::int m, extract(hour FROM t)::int h, extract(dow FROM t)::int dow
                                   FROM (SELECT (now() - interval '1 hour') AT TIME ZONE 'UTC' t) x`);
const daily = `${m} ${h} * * *`;
const weekly = `${m} ${h} * * ${dow}`;
const jobs = [
  // name,           schedule,       command,                    runs
  ["digest-a",       daily,          "SELECT public.fake_digest();", ["prev-ok", "failed"]],
  ["weekly-h",       weekly,         "SELECT public.fake_digest()",  ["failed"]],
  ["charge-b",       daily,          "SELECT public.fake_charge();", ["prev-ok", "failed"]],
  ["unclassified-c", daily,          "SELECT public.fake_other();",  ["prev-ok", "failed"]],
  ["ok-d",           daily,          "SELECT public.fake_other();",  ["prev-ok", "ok"]],
  ["new-e",          daily,          "SELECT public.fake_other();",  []],
  ["late-f",         daily,          "SELECT public.fake_other();",  ["prev-ok", "failed"]],
  ["hourly-g",       `${m} * * * *`, "SELECT public.fake_other();",  ["prev-ok", "failed"]],
  ["boom-j",         daily,          "SELECT public.boom();",        ["prev-ok", "failed"]],
  ["healthbeat",     "*/5 * * * *",  "SELECT 1",                     ["recent-ok"]],
];
for (const [name, sched, cmd, runs] of jobs) {
  const { jobid } = await one(`INSERT INTO cron.job (jobname, schedule, command) VALUES ('${name}', '${sched}', $$${cmd}$$) RETURNING jobid`);
  for (const r of runs) {
    const [status, at, msg] = {
      "prev-ok":   ["succeeded", "now() - interval '25 hours'", "1 row"],
      failed:      ["failed",    "now() - interval '1 hour'",   "job startup timeout"],
      ok:          ["succeeded", "now() - interval '1 hour'",   "1 row"],
      "recent-ok": ["succeeded", "now() - interval '2 minutes'", "1 row"],
    }[r];
    await db.exec(`INSERT INTO cron.job_run_details (jobid, status, return_message, start_time, end_time)
                   VALUES (${jobid}, '${status}', '${msg}', ${at}, ${at} + interval '10 seconds')`);
  }
}
await safeq("fixture policy rows", () => db.exec(`
  INSERT INTO public.cron_catchup_policy (jobname, catch_up, max_late, reason) VALUES
    ('digest-a', true,  interval '6 hours',    'fixture: a digest, safe to run late'),
    ('weekly-h', true,  interval '6 hours',    'fixture: a weekly digest, safe late'),
    ('charge-b', false, interval '1 hour',     'fixture: CHARGES MONEY, never re-run'),
    ('ok-d',     true,  interval '6 hours',    'fixture: succeeded, nothing to do'),
    ('new-e',    true,  interval '6 hours',    'fixture: no evidence it existed then'),
    ('late-f',   true,  interval '30 minutes', 'fixture: safe but only within 30 min'),
    ('hourly-g', true,  interval '6 hours',    'fixture: hourly, self-heals, ignored'),
    ('boom-j',   true,  interval '6 hours',    'fixture: safe, but the command raises')`));

const effects = async () => Object.fromEntries((await q(`SELECT kind, n FROM public.side_effects`)).map((r) => [r.kind, r.n]));
const runsTable = async () => Object.fromEntries(
  (await safeq("read cron_catchup_runs", () => q(`SELECT jobname, action FROM public.cron_catchup_runs`)) ?? []).map((r) => [r.jobname, r.action]));
const logs = async (source) => (await one(`SELECT count(*)::int n FROM public.error_logs WHERE tags->>'source' = '${source}'`)).n;
const sweep = async () => (await safeq("run_missed_cron_catch_up()", () => one(`SELECT public.run_missed_cron_catch_up() r`)))?.r;

// ── tick 1 ──────────────────────────────────────────────────────────────────
let r = await sweep();
let e = await effects();
let runs = await runsTable();
check("tick 1: healthy", r?.healthy === true, JSON.stringify(r));
check("tick 1: the two catch-up-safe missed slots ran ONCE (daily + weekly)", e.digest === 2 && runs["digest-a"] === "caught_up" && runs["weekly-h"] === "caught_up", JSON.stringify({ e, runs }));
check("tick 1: the MONEY job was NOT run, alerted_unsafe", e.charge === 0 && runs["charge-b"] === "alerted_unsafe", JSON.stringify({ e, runs }));
check("tick 1: a job with no policy row is NOT run, alerted_unclassified", runs["unclassified-c"] === "alerted_unclassified", JSON.stringify(runs));
check("tick 1: a safe job past max_late is NOT run, alerted_too_late", runs["late-f"] === "alerted_too_late", JSON.stringify(runs));
check("tick 1: a raising catch-up is recorded catch_up_failed and its effects rolled back", runs["boom-j"] === "catch_up_failed" && e.other === 0, JSON.stringify({ e, runs }));
check("tick 1: succeeded / never-existed / hourly jobs untouched",
  !("ok-d" in runs) && !("new-e" in runs) && !("hourly-g" in runs) && !("healthbeat" in runs), JSON.stringify(runs));
check("tick 1: 2 'cron-caught-up' warnings", (await logs("cron-caught-up")) === 2);
const sev = await q(`SELECT DISTINCT severity FROM public.error_logs WHERE tags->>'source' = 'cron-caught-up'`);
check("caught-up rows are warnings with the job tag", sev.length === 1 && sev[0].severity === "warning"
  && (await one(`SELECT count(*)::int n FROM public.error_logs WHERE tags->>'job' = 'digest-a'`)).n === 1, JSON.stringify(sev));
check("tick 1: 4 'cron-missed-slot' errors (unsafe, unclassified, too late, failed)", (await logs("cron-missed-slot")) === 4);
const lateMsg = (await one(`SELECT message FROM public.error_logs WHERE tags->>'job' = 'late-f'`))?.message ?? "";
check("too-late alert states the rule (older than its window), not a guess about DB health (Q189)",
  lateMsg.includes("older than its") && !lateMsg.includes("not healthy again"), lateMsg.slice(0, 160));

// ── tick 2 and 3: never twice ───────────────────────────────────────────────
await sweep();
r = await sweep();
e = await effects();
check("ticks 2-3: nothing re-ran (digest still 2, charge 0, boom not retried)", e.digest === 2 && e.charge === 0 && e.other === 0, JSON.stringify({ e, r }));
check("ticks 2-3: no new alerts", (await logs("cron-caught-up")) === 2 && (await logs("cron-missed-slot")) === 4);
check("ticks 2-3: decided nothing new", Array.isArray(r?.decided) && r.decided.length === 0, JSON.stringify(r));

// ── unhealthy DB defers without claiming; healthy again runs once ──────────
const { jobid: iid } = await one(`INSERT INTO cron.job (jobname, schedule, command) VALUES ('digest-i', '${daily}', 'SELECT public.fake_digest()') RETURNING jobid`);
await db.exec(`INSERT INTO cron.job_run_details (jobid, status, return_message, start_time) VALUES
  (${iid}, 'succeeded', '1 row', now() - interval '25 hours'), (${iid}, 'failed', 'job startup timeout', now() - interval '1 hour')`);
await safeq("policy digest-i", () => db.exec(`INSERT INTO public.cron_catchup_policy VALUES ('digest-i', true, interval '6 hours', 'fixture: deferred while unhealthy')`));
const { jobid: hb } = await one(`SELECT jobid FROM cron.job WHERE jobname = 'healthbeat'`);
await db.exec(`INSERT INTO cron.job_run_details (jobid, status, return_message, start_time)
  SELECT ${hb}, 'failed', 'job startup timeout', now() - interval '1 minute' FROM generate_series(1, 3)`);
r = await sweep();
e = await effects();
runs = await runsTable();
check("unhealthy (3 failures in 15 min): not run, slot NOT claimed, counted as waiting",
  r?.healthy === false && e.digest === 2 && !("digest-i" in runs) && r.waiting >= 1, JSON.stringify({ r, e }));
await db.exec(`DELETE FROM cron.job_run_details WHERE jobid = ${hb} AND status = 'failed'`);
r = await sweep();
await sweep();
e = await effects();
runs = await runsTable();
check("healthy again: runs once, then never again", e.digest === 3 && runs["digest-i"] === "caught_up", JSON.stringify({ r, e }));

// ── Q207(1): a rescheduled job is not a missed slot ─────────────────────────
// Old schedule: 3 hours ago daily; it ran at that time yesterday and today.
// Then moved to the slot 1 hour ago (later than today's run), after a tick saw
// the old schedule. Nothing ran at the new slot, and nothing should: today's
// run already happened. Before Q207 the money job filed a 'cron-missed-slot'
// ERROR and the safe one was run a second time today.
const { m3, h3 } = await one(`SELECT extract(minute FROM t)::int m3, extract(hour FROM t)::int h3
                               FROM (SELECT (now() - interval '3 hours') AT TIME ZONE 'UTC' t) x`);
const oldDaily = `${m3} ${h3} * * *`;
const logsFor = async (job) => (await one(`SELECT count(*)::int n FROM public.error_logs WHERE tags->>'job' = '${job}'`)).n;
const addJob = async (name, sched, cmd, runAts) => {
  const { jobid } = await one(`INSERT INTO cron.job (jobname, schedule, command) VALUES ('${name}', '${sched}', $$${cmd}$$) RETURNING jobid`);
  for (const at of runAts) {
    await db.exec(`INSERT INTO cron.job_run_details (jobid, status, return_message, start_time, end_time)
                   VALUES (${jobid}, 'succeeded', '1 row', ${at}, ${at} + interval '10 seconds')`);
  }
  return jobid;
};
await addJob("resched-charge-k", oldDaily, "SELECT public.fake_resched();", ["now() - interval '27 hours'", "now() - interval '3 hours'"]);
await addJob("resched-safe-q", oldDaily, "SELECT public.fake_resched();", ["now() - interval '27 hours'", "now() - interval '3 hours'"]);
// Controls, both with NO run recorded at their slot (pg_cron never started them):
// proof by a run exactly one period earlier ...
await addJob("silent-l", daily, "SELECT public.fake_resched();", ["now() - interval '25 hours'"]);
// ... and proof by a tick having seen the job on this schedule before the slot.
const mid = await addJob("seen-m", daily, "SELECT public.fake_resched();", ["now() - interval '30 hours'"]);
await safeq("policy resched", () => db.exec(`INSERT INTO public.cron_catchup_policy VALUES
  ('resched-charge-k', false, interval '1 hour',  'fixture: CHARGES MONEY, rescheduled today'),
  ('resched-safe-q',   true,  interval '6 hours', 'fixture: safe, rescheduled today'),
  ('silent-l',         true,  interval '6 hours', 'fixture: no run at slot, ran one period earlier'),
  ('seen-m',           true,  interval '6 hours', 'fixture: no run at slot, schedule seen before it')`));
await sweep(); // a tick sees the old schedules
await safeq("seen-m observed before its slot", () => db.exec(
  `UPDATE public.cron_catchup_schedules SET since = now() - interval '2 hours' WHERE jobid = ${mid}`));
await db.exec(`SELECT cron.schedule('resched-charge-k', '${daily}', 'SELECT public.fake_resched();'),
                      cron.schedule('resched-safe-q',   '${daily}', 'SELECT public.fake_resched();')`);
r = await sweep();
await sweep();
e = await effects();
runs = await runsTable();
check("Q207(1) rescheduled MONEY job: no 'missed slot' alert for a day it already ran",
  !("resched-charge-k" in runs) && (await logsFor("resched-charge-k")) === 0, JSON.stringify({ runs, r }));
check("Q207(1) rescheduled safe job: not run a second time today",
  !("resched-safe-q" in runs) && (await logsFor("resched-safe-q")) === 0, JSON.stringify(runs));
check("Q207(1) no run at the slot but ran one period earlier: still caught up",
  runs["silent-l"] === "caught_up", JSON.stringify(runs));
check("Q207(1) no run at the slot but seen on this schedule before it: still caught up",
  runs["seen-m"] === "caught_up", JSON.stringify(runs));
check("Q207(1) side effects: exactly the two proven slots ran", e.resched === 2, JSON.stringify(e));

// ── Q207(3)(4): the job's own lock_timeout; a cancel fails one command ──────
await db.exec(`DELETE FROM public.lock_seen`);
const session = (await one(`SELECT current_setting('lock_timeout') t`)).t;
await addJob("lockjob-n", daily, "SELECT public.fake_lockjob();", ["now() - interval '25 hours'"]);
// cancel-p's slot is an hour earlier, so the tick reaches it first.
const { m2, h2 } = await one(`SELECT extract(minute FROM t)::int m2, extract(hour FROM t)::int h2
                               FROM (SELECT (now() - interval '2 hours') AT TIME ZONE 'UTC' t) x`);
await addJob("cancel-p", `${m2} ${h2} * * *`, "SELECT public.fake_cancel();", ["now() - interval '26 hours'"]);
await safeq("policy lock/cancel", () => db.exec(`INSERT INTO public.cron_catchup_policy VALUES
  ('lockjob-n', true, interval '6 hours', 'fixture: records the lock_timeout it runs with'),
  ('cancel-p',  true, interval '6 hours', 'fixture: hits statement_timeout (query_canceled)')`));
r = await sweep();
e = await effects();
runs = await runsTable();
check("Q207(4) a query_canceled job does not abort the tick: recorded catch_up_failed",
  r?.checked === true && runs["cancel-p"] === "catch_up_failed", JSON.stringify({ r, runs }));
check("Q207(4) after a cancel nothing else runs this tick (no timer left): the next slot waits, unclaimed",
  !("lockjob-n" in runs) && r?.waiting >= 1 && (await q(`SELECT 1 FROM public.lock_seen WHERE who = 'job'`)).length === 0, JSON.stringify({ r, runs }));
const cancelMsg = (await one(`SELECT message FROM public.error_logs WHERE tags->>'job' = 'cancel-p'`))?.message ?? "";
check("Q207(4) ... its effects rolled back and it is alerted as a failed catch-up",
  e.cancel === 0 && cancelMsg.includes("FAILED") && cancelMsg.includes("statement timeout"), JSON.stringify({ e, cancelMsg: cancelMsg.slice(0, 160) }));
r = await sweep();
e = await effects();
runs = await runsTable();
check("Q207(4) ... the cancelled slot is never retried; the waiting one runs on the next tick",
  e.cancel === 0 && runs["lockjob-n"] === "caught_up" && r?.decided?.length === 1, JSON.stringify({ e, r }));
const seen = await q(`SELECT who, lock_timeout FROM public.lock_seen`);
const jobSeen = seen.filter((x) => x.who === "job");
check("Q207(3) the executed job runs with the session's lock_timeout, not the tick's 200ms",
  jobSeen.length === 1 && jobSeen[0].lock_timeout === session && session !== "200ms", JSON.stringify({ session, seen }));
const alertSeen = seen.filter((x) => x.who.startsWith("alert:"));
check("Q207(3) the tick's own writes after the job are back under 200ms",
  alertSeen.length >= 2 && alertSeen.every((x) => x.lock_timeout === "200ms"), JSON.stringify(seen));

// ── Q207 review: a paused-then-resumed job's first slot is not a miss ───────
const pid = await addJob("paused-r", daily, "SELECT public.fake_resched();", ["now() - interval '30 hours'"]);
await safeq("policy paused", () => db.exec(`INSERT INTO public.cron_catchup_policy VALUES
  ('paused-r', false, interval '1 hour', 'fixture: paused over its slot, then resumed')`));
await sweep(); // seen active
await safeq("paused-r seen before its slot", () => db.exec(
  `UPDATE public.cron_catchup_schedules SET since = now() - interval '2 hours' WHERE jobid = ${pid}`));
await db.exec(`UPDATE cron.job SET active = false WHERE jobid = ${pid}`);
await sweep(); // seen paused
await db.exec(`UPDATE cron.job SET active = true WHERE jobid = ${pid}`);
await sweep();
runs = await runsTable();
check("Q207 paused over its slot then resumed: no 'missed slot' alert", !("paused-r" in runs) && (await logsFor("paused-r")) === 0, JSON.stringify(runs));

// ── a second concurrent sweep never waits ───────────────────────────────────
// (PGlite is single-connection; the advisory lock is taken per transaction.
// Holding it in an open transaction and calling again in the SAME session
// re-enters, so this only proves the call shape. The real non-wait is
// pg_try_advisory_xact_lock, asserted structurally by the vitest.)

// ── ledger close rule ───────────────────────────────────────────────────────
const cond = async (src, job, since) => safeq(`ops_alert_condition(${src})`, () =>
  one(`SELECT public.ops_alert_condition('${src}', '{"job":"${job}"}'::jsonb, ${since}, false) c,
              public.ops_alert_condition('${src}', '{"job":"${job}"}'::jsonb, ${since}, true) p`));
let c = await cond("cron-caught-up", "digest-a", "now() - interval '5 minutes'");
check("'cron-caught-up' is still failing until a regular run succeeds; probe true", c?.c === true && c?.p === true, JSON.stringify(c));
const { jobid: aid } = await one(`SELECT jobid FROM cron.job WHERE jobname = 'digest-a'`);
await db.exec(`INSERT INTO cron.job_run_details (jobid, status, return_message, start_time) VALUES (${aid}, 'succeeded', '1 row', now())`);
c = await cond("cron-caught-up", "digest-a", "now() - interval '5 minutes'");
check("'cron-caught-up' clears when the next regular run succeeds", c?.c === false, JSON.stringify(c));
c = await cond("cron-missed-slot", "charge-b", "now() - interval '5 minutes'");
check("'cron-missed-slot' has no automatic close (manual: a person decides)", c?.c === null && c?.p === null, JSON.stringify(c));

// ── registration + access ───────────────────────────────────────────────────
const cronRows = await q(`SELECT schedule, command FROM cron.job WHERE jobname = 'cron-missed-slot-catch-up'`);
check("cron registered once, every 10 minutes", cronRows.length === 1 && cronRows[0].schedule === "9-59/10 * * * *", JSON.stringify(cronRows));
const exp = await q(`SELECT expected_max_gap::text g FROM public.cron_work_expectations WHERE jobname = 'cron-missed-slot-catch-up'`);
check("liveness expectation registered (1 h)", exp.length === 1 && exp[0].g === "01:00:00", JSON.stringify(exp));
for (const role of ["anon", "authenticated"]) {
  for (const fn of ["public.run_missed_cron_catch_up()", "public.cron_catchup_last_slot(text, timestamptz)"]) {
    const ok = await safeq(`privilege ${role} ${fn}`, () => one(`SELECT has_function_privilege('${role}', '${fn}', 'EXECUTE') ok`));
    check(`${role} cannot execute ${fn}`, ok?.ok === false);
  }
  for (const t of ["public.cron_catchup_policy", "public.cron_catchup_runs", "public.cron_catchup_schedules"]) {
    const ok = await safeq(`privilege ${role} ${t}`, () => one(`SELECT has_table_privilege('${role}', '${t}', 'SELECT') OR has_table_privilege('${role}', '${t}', 'INSERT') ok`));
    check(`${role} can neither read nor write ${t}`, ok?.ok === false);
  }
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
