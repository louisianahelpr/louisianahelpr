/**
 * PGlite proof for 20260925155322_catch_up_candidates_one_scan (docs/OPEN.md Q397).
 *
 *   node src/test/pglite/cronCatchUpOneScan.pglite.mjs
 *   MUTATE=1 node src/test/pglite/cronCatchUpOneScan.pglite.mjs   # a wrong bound in the new body: RED
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * run_missed_cron_catch_up() drives real catch-up runs, so the rewrite must
 * pick exactly the slots the old body picked. The state before is the Q30
 * chain as cronCatchUp.pglite.mjs applies it (newest body: 20260923172145);
 * the new migration then applies 3x. Every comparison builds its fixture and
 * calls the function inside ONE transaction, once with the old body and once
 * with the new, rolled back in between, and requires identical results: the
 * returned jsonb (decided list in order, ran, waiting, healthy), every
 * cron_catchup_runs row (job, slot, action, detail, request_id), every
 * error_logs row (severity, message, tags, context, in order), the
 * cron_catchup_schedules rows and the side effects of the commands it ran.
 *
 * Two policy modes per fixture: with no policy rows every candidate is
 * claimed and alerted, so `decided` is the whole candidate set; with every job
 * catch-up-safe, the first 3 by slot are RUN and the rest wait.
 *
 * Fixtures: (1) named edge cases: never ran, never ran but seen on schedule,
 * failed at the slot (and at each edge of the 1-minute/grace window), ran late
 * (failed / succeeded / still running), a slot missed twice (with and without
 * the previous miss claimed), a slot already claimed, disabled jobs, a changed
 * schedule (with and without a run at the new time one period earlier), the
 * same schedule seen before the slot, inside grace, hourly, weekly, the newest
 * of several runs quoted, NULL status / message / start_time. (2) a seeded
 * random history for JOBS jobs x ROUNDS rounds, every run placed on or one
 * second either side of a boundary the query tests. Then: the new body's tie
 * order on a shared slot is (slot, jobid); two runs with the same start_time
 * change only which is quoted; anon/authenticated cannot execute.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const PRIOR = ["20260923133021_cron_missed_slot_catch_up.sql", "20260923145516_catch_up_too_late_wording.sql",
  "20260923163407_catch_up_schedule_proof_and_timeouts.sql", "20260923170422_cron_http_request_ids.sql",
  "20260923172145_cron_catch_up_http_outcome_and_untagged.sql"].map(mig).join("\n");
// The previous body, verbatim from its newest definition before this migration.
const OLD = /CREATE OR REPLACE FUNCTION public\.run_missed_cron_catch_up\(\)[\s\S]*?\n\$fn\$;/.exec(
  mig("20260923172145_cron_catch_up_http_outcome_and_untagged.sql"))[0];
let NEW = mig("20260925155322_catch_up_candidates_one_scan.sql");
if (process.env.MUTATE) {
  // A bound off by one second: the at-slot failure window closes 1s later.
  const before = NEW;
  NEW = NEW.replace("AND d.start_time <  u.slot + v_grace", "AND d.start_time <= u.slot + v_grace");
  console.log(`MUTATE set: the new body's at-slot window is inclusive of slot + grace (${before !== NEW ? "planted" : "NOT FOUND"})`);
}
const ROUNDS = Number(process.env.ROUNDS ?? 150);
const JOBS = 60; // random jobs per round

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
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
CREATE TABLE public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seq bigserial, severity text,
  message text, tags jsonb, context jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE public.cron_work_expectations (jobname text PRIMARY KEY, candidate_key text,
  disposition_keys text[] DEFAULT ARRAY[]::text[], min_streak int NOT NULL DEFAULT 2,
  note text NOT NULL DEFAULT '', expected_max_gap interval, registered_at timestamptz NOT NULL DEFAULT now());
-- What each caught-up command did, in order.
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

// Fixture helpers, all relative to the calling transaction's now().
// A daily (or weekly) schedule whose last slot is p_ago minutes ago.
await db.exec(`
CREATE FUNCTION public._sched(p_ago int, p_kind text) RETURNS text LANGUAGE sql AS $$
  SELECT CASE p_kind
    WHEN 'daily'  THEN format('%s %s * * *', extract(minute FROM t)::int, extract(hour FROM t)::int)
    WHEN 'weekly' THEN format('%s %s * * %s', extract(minute FROM t)::int, extract(hour FROM t)::int, extract(dow FROM t)::int)
    WHEN 'hourly' THEN format('%s * * * *', extract(minute FROM t)::int)
  END FROM (SELECT (now() - make_interval(mins => p_ago)) AT TIME ZONE 'UTC' t) x $$;
CREATE FUNCTION public._job(p_name text, p_ago int, p_kind text, p_active boolean DEFAULT true) RETURNS bigint
  LANGUAGE sql AS $$
  INSERT INTO cron.job (jobname, schedule, command, active)
  VALUES (p_name, public._sched(p_ago, p_kind), format('SELECT public.fx(%L);', p_name), p_active)
  RETURNING jobid $$;
CREATE FUNCTION public._slot(p_name text) RETURNS TABLE (slot timestamptz, period interval) LANGUAGE sql AS $$
  SELECT s.slot, s.period FROM cron.job j,
         public.cron_catchup_last_slot(j.schedule, now()) s WHERE j.jobname = p_name $$;
-- A run at slot + k periods + delta (NULL delta = NULL start_time).
CREATE FUNCTION public._run(p_name text, p_k int, p_delta interval, p_status text, p_msg text) RETURNS void
  LANGUAGE sql AS $$
  INSERT INTO cron.job_run_details (jobid, status, return_message, start_time, end_time)
  SELECT j.jobid, p_status, p_msg, s.slot + p_k * s.period + p_delta, s.slot + p_k * s.period + p_delta + interval '5 seconds'
    FROM cron.job j, public._slot(p_name) s WHERE j.jobname = p_name $$;
-- A run at an absolute offset from now (for jobs with no slot).
CREATE FUNCTION public._run_ago(p_name text, p_ago interval, p_status text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO cron.job_run_details (jobid, status, return_message, start_time, end_time)
  SELECT jobid, p_status, '1 row', now() - p_ago, now() - p_ago + interval '1 second' FROM cron.job WHERE jobname = p_name $$;
-- What a tick saw: 'same' (this schedule, since p_since_ago before now), 'other' (a different schedule),
-- 'paused' (this schedule, inactive).
CREATE FUNCTION public._seen(p_name text, p_how text, p_since_ago interval) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.cron_catchup_schedules (jobid, jobname, schedule, active, since)
  SELECT jobid, jobname, CASE WHEN p_how = 'other' THEN '0 3 * * *' ELSE schedule END,
         CASE WHEN p_how = 'paused' THEN false ELSE active END, now() - p_since_ago
    FROM cron.job WHERE jobname = p_name
  ON CONFLICT (jobid) DO UPDATE SET schedule = EXCLUDED.schedule, active = EXCLUDED.active, since = EXCLUDED.since $$;
-- A claim at slot + k periods.
CREATE FUNCTION public._claim(p_name text, p_k int) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.cron_catchup_runs (jobname, slot, action, detail)
  SELECT p_name, s.slot + p_k * s.period, 'alerted_unsafe', 'fixture' FROM public._slot(p_name) s
  ON CONFLICT DO NOTHING $$;
-- A healthy database: a recent success, no recent failures.
CREATE FUNCTION public._healthy() RETURNS void LANGUAGE sql AS $$
  INSERT INTO cron.job (jobname, schedule, command) VALUES ('healthbeat', '*/5 * * * *', 'SELECT 1')
  ON CONFLICT (jobname) DO NOTHING;
  SELECT public._run_ago('healthbeat', interval '2 minutes', 'succeeded') $$;
`);

// ── the new migration applies 3x on top of the old chain ────────────────────
for (let i = 1; i <= 3; i++) {
  try { await db.exec(NEW); check(`apply pass #${i}`, true); } catch (e) { check(`apply pass #${i}`, false, e.message); }
}

// Keep a pair of runs inside one wall-clock minute: the alert text quotes now() as HH24:MI.
const sameMinute = async () => {
  const s = new Date().getUTCSeconds();
  if (s >= 55) await new Promise((r) => setTimeout(r, (61 - s) * 1000));
};

// Build the fixture and call the function with `body` in one transaction; roll back.
async function runWith(body, fixtureSql, policy) {
  await db.exec("BEGIN");
  try {
    // Sequences do not roll back: start both bodies' fixtures at the same jobid.
    await db.exec(`SELECT setval('cron.job_jobid_seq', 1000, false)`);
    await db.exec(body);
    await db.exec(fixtureSql);
    if (policy === "safe") {
      await db.exec(`INSERT INTO public.cron_catchup_policy (jobname, catch_up, max_late, reason)
                     SELECT jobname, true, interval '2 days', 'fixture: safe to run late' FROM cron.job
                     ON CONFLICT (jobname) DO NOTHING`);
    }
    const ret = (await q(`SELECT public.run_missed_cron_catch_up() r`))[0].r;
    const runs = await q(`SELECT jobname, slot, action, detail, request_id FROM public.cron_catchup_runs
                           WHERE detail IS DISTINCT FROM 'fixture' ORDER BY jobname, slot`);
    const logs = await q(`SELECT severity, message, tags, context FROM public.error_logs ORDER BY seq`);
    const sched = await q(`SELECT jobid, jobname, schedule, active, since = now() AS reset FROM public.cron_catchup_schedules ORDER BY jobid`);
    const fx = await q(`SELECT jobname FROM public.effects ORDER BY seq`);
    return JSON.parse(JSON.stringify({ ret, runs, logs, sched, fx }));
  } finally {
    await db.exec("ROLLBACK");
  }
}

// A candidate list is a set; the order is only defined up to ties on slot in the old body.
const bySlotThenJob = (d) => [...d].sort((a, b) => (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : a.job.localeCompare(b.job)));

async function compare(label, fixtureSql, { exactOrder = true } = {}) {
  const out = {};
  for (const policy of ["none", "safe"]) {
    await sameMinute();
    const a = await runWith(OLD, fixtureSql, policy);
    const b = await runWith(NEW, fixtureSql, policy);
    if (!exactOrder) {
      for (const x of [a, b]) {
        x.ret.decided = bySlotThenJob(x.ret.decided);
        x.logs.sort((p, r) => (p.message < r.message ? -1 : 1));
        x.fx.sort((p, r) => p.jobname.localeCompare(r.jobname));
      }
    }
    const same = JSON.stringify(a) === JSON.stringify(b);
    const diff = same ? [] : Object.keys(a).filter((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]));
    out[policy] = { a, b, same, diff };
  }
  return out;
}

// ── (1) named edge cases ────────────────────────────────────────────────────
// Each job gets its own slot (60 + 3k minutes ago) so no two tie on slot and
// the old body's order is fully defined.
const cases = [];
let k = 0;
const add = (name, kind, sql, expect, { active = true, ago } = {}) => {
  const a = ago ?? 60 + 3 * k++;
  cases.push({ name, expect, sql: `SELECT public._job('${name}', ${a}, '${kind}', ${active});\n${sql.replaceAll("$J", `'${name}'`)}` });
};
const I = (s) => `interval '${s}'`;
// expect: true = a candidate (decided), false = not.
add("never-ran",            "daily", ``, false);
add("never-ran-seen",       "daily", `SELECT public._seen($J, 'same', ${I("3 days")});`, false);
add("failed-at-slot",       "daily", `SELECT public._run($J, 0, ${I("30 seconds")}, 'failed', 'job startup timeout');`, true);
add("failed-at-minus-1m",   "daily", `SELECT public._run($J, 0, ${I("-1 minute")}, 'failed', 'edge: slot - 1 minute');`, true);
add("failed-before-window", "daily", `SELECT public._run($J, 0, ${I("-61 seconds")}, 'failed', 'edge: slot - 61s');`, false);
add("failed-at-grace-1s",   "daily", `SELECT public._run($J, 0, ${I("9 minutes 59 seconds")}, 'failed', 'edge: slot + grace - 1s');`, true);
add("ran-late-failed",      "daily", `SELECT public._run($J, 0, ${I("10 minutes")}, 'failed', 'ran late: slot + grace');`, false);
add("ran-late-failed-prev", "daily", `SELECT public._run($J, -1, ${I("5 seconds")}, 'succeeded', '1 row');
                                      SELECT public._run($J, 0, ${I("25 minutes")}, 'failed', 'ran late and failed');`, true);
add("ran-late-succeeded",   "daily", `SELECT public._run($J, -1, ${I("5 seconds")}, 'succeeded', '1 row');
                                      SELECT public._run($J, 0, ${I("25 minutes")}, 'succeeded', '1 row');`, false);
add("ran-late-running",     "daily", `SELECT public._run($J, -1, ${I("5 seconds")}, 'succeeded', '1 row');
                                      SELECT public._run($J, 0, ${I("20 minutes")}, 'running', NULL);`, false);
add("starting-at-slot",     "daily", `SELECT public._run($J, -1, ${I("5 seconds")}, 'succeeded', '1 row');
                                      SELECT public._run($J, 0, ${I("1 second")}, 'starting', NULL);`, false);
add("missed-prev-period",   "daily", `SELECT public._run($J, -1, ${I("5 seconds")}, 'succeeded', '1 row');`, true);
add("prev-edge-minus-1m",   "daily", `SELECT public._run($J, -1, ${I("-1 minute")}, 'succeeded', '1 row');`, true);
add("prev-edge-minus-61s",  "daily", `SELECT public._run($J, -1, ${I("-61 seconds")}, 'succeeded', '1 row');`, false);
add("prev-edge-grace",      "daily", `SELECT public._run($J, -1, ${I("10 minutes")}, 'succeeded', '1 row');`, false);
add("prev-edge-grace-1s",   "daily", `SELECT public._run($J, -1, ${I("9 minutes 59 seconds")}, 'failed', 'x');`, true);
add("missed-twice-claimed", "daily", `SELECT public._run($J, -3, ${I("5 seconds")}, 'succeeded', '1 row');
                                      SELECT public._claim($J, -1);`, true);
add("missed-twice-unclaimed","daily", `SELECT public._run($J, -3, ${I("5 seconds")}, 'succeeded', '1 row');`, false);
add("missed-twice-seen",    "daily", `SELECT public._run($J, -3, ${I("5 seconds")}, 'succeeded', '1 row');
                                      SELECT public._seen($J, 'same', ${I("3 days")});`, true);
add("already-claimed",      "daily", `SELECT public._run($J, 0, ${I("5 seconds")}, 'failed', 'x');
                                      SELECT public._claim($J, 0);`, false);
add("disabled",             "daily", `SELECT public._run($J, 0, ${I("5 seconds")}, 'failed', 'x');
                                      SELECT public._run($J, -1, ${I("5 seconds")}, 'succeeded', '1 row');`, false, { active: false });
add("disabled-seen-active", "daily", `SELECT public._run($J, -1, ${I("5 seconds")}, 'succeeded', '1 row');
                                      SELECT public._seen($J, 'same', ${I("3 days")});`, false, { active: false });
add("resumed-after-pause",  "daily", `SELECT public._run($J, -3, ${I("5 seconds")}, 'succeeded', '1 row');
                                      SELECT public._seen($J, 'paused', ${I("3 days")});`, false);
add("schedule-changed",     "daily", `SELECT public._run($J, -3, ${I("5 seconds")}, 'succeeded', '1 row');
                                      SELECT public._seen($J, 'other', ${I("3 days")});`, false);
add("schedule-changed-prev","daily", `SELECT public._run($J, -1, ${I("5 seconds")}, 'succeeded', '1 row');
                                      SELECT public._seen($J, 'other', ${I("3 days")});`, true);
add("schedule-changed-failed-at-slot", "daily", `SELECT public._run($J, 0, ${I("5 seconds")}, 'failed', 'x');
                                      SELECT public._seen($J, 'other', ${I("3 days")});`, true);
add("seen-after-slot",      "daily", `SELECT public._run($J, -3, ${I("5 seconds")}, 'succeeded', '1 row');
                                      SELECT public._seen($J, 'same', ${I("1 minute")});`, false);
add("inside-grace",         "daily", `SELECT public._run($J, 0, ${I("5 seconds")}, 'failed', 'x');
                                      SELECT public._run($J, -1, ${I("5 seconds")}, 'succeeded', '1 row');`, false, { ago: 5 });
add("hourly",               "hourly", `SELECT public._run($J, 0, ${I("5 seconds")}, 'failed', 'x');`, false, { ago: 30 });
add("weekly-failed",        "weekly", `SELECT public._run($J, 0, ${I("5 seconds")}, 'failed', 'weekly startup timeout');`, true);
add("weekly-prev-week",     "weekly", `SELECT public._run($J, -1, ${I("5 seconds")}, 'succeeded', '1 row');`, true);
add("weekly-prev-day-only", "weekly", `SELECT public._run($J, 0, ${I("-1 day")}, 'succeeded', '1 row');`, false);
add("newest-quoted",        "daily", `SELECT public._run($J, 0, ${I("5 seconds")}, 'failed', 'OLDER message');
                                      SELECT public._run($J, 0, ${I("3 minutes")}, 'failed', 'NEWEST message');`, true);
add("null-message",         "daily", `SELECT public._run($J, 0, ${I("5 seconds")}, 'failed', NULL);`, true);
add("null-status",          "daily", `SELECT public._run($J, -1, ${I("5 seconds")}, 'succeeded', '1 row');
                                      SELECT public._run($J, 0, ${I("5 seconds")}, NULL, NULL);`, true);
add("null-start",           "daily", `SELECT public._run($J, 0, NULL, 'succeeded', '1 row');
                                      SELECT public._run($J, -1, ${I("5 seconds")}, 'succeeded', '1 row');`, true);
add("failed-then-ok",       "daily", `SELECT public._run($J, 0, ${I("5 seconds")}, 'failed', 'x');
                                      SELECT public._run($J, 0, ${I("4 minutes")}, 'succeeded', '1 row');`, false);
const named = `SELECT public._healthy();\n${cases.map((c) => c.sql).join("\n")}`;
const res = await compare("named", named);
for (const policy of ["none", "safe"]) {
  const { a, b, same } = res[policy];
  check(`named edge cases, policy ${policy}: old and new bodies give identical results`, same,
    same ? `${a.ret.decided.length} decided, ${a.fx.length} run` : `differs in ${res[policy].diff.join(", ")}: ${JSON.stringify(res[policy].diff.map((key) => [a[key], b[key]])).slice(0, 600)}`);
}
// The fixture really reaches what it names (so "identical" is not "both empty").
const decided = new Set(res.none.b.ret.decided.map((d) => d.job));
const wrong = cases.filter((c) => decided.has(c.name) !== c.expect).map((c) => `${c.name}: expected ${c.expect ? "" : "NOT "}a candidate`);
check(`every named case is (not) a candidate as named (${cases.filter((c) => c.expect).length} yes, ${cases.filter((c) => !c.expect).length} no)`,
  wrong.length === 0, wrong.join("; "));
const quoted = res.none.b.logs.find((l) => l.tags.job === "newest-quoted")?.message ?? "";
check("the alert quotes the newest run since the slot", quoted.includes("NEWEST message") && !quoted.includes("OLDER"), quoted.slice(0, 120));
const nullMsg = res.none.b.logs.find((l) => l.tags.job === "null-message")?.message ?? "";
check("a run with no message is quoted by its status", nullMsg.includes("(failed)"), nullMsg.slice(0, 120));
check("policy safe: 3 run (cap), the rest wait, same in both",
  res.safe.b.ret.ran === 3 && res.safe.b.fx.length === 3 && res.safe.b.ret.waiting === decided.size - 3,
  JSON.stringify({ ran: res.safe.b.ret.ran, waiting: res.safe.b.ret.waiting, fx: res.safe.b.fx }));

// ── (2) seeded random histories around every boundary ─────────────────────
let seed = 397;
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
// [k periods, delta]: on and one second either side of each bound the query tests.
const SPOTS = [
  [-1, "-61 seconds"], [-1, "-60 seconds"], [-1, "-59 seconds"], [-1, "0 seconds"], [-1, "9 minutes 59 seconds"], [-1, "10 minutes"],
  [0, "-61 seconds"], [0, "-60 seconds"], [0, "-59 seconds"], [0, "0 seconds"], [0, "9 minutes 59 seconds"], [0, "10 minutes"],
  [0, "12 minutes"], [-2, "0 seconds"], [-3, "5 seconds"], [0, "-1 day"], [0, null],
];
const STATUSES = ["failed", "failed", "succeeded", "running", "starting", null];
const MSGS = ["job startup timeout", "ERROR:  boom", null, "1 row"];
let identical = 0, candidates = 0, runs = 0, nonCandidates = 0;
const firstDiff = [];
for (let round = 0; round < ROUNDS; round++) {
  const lines = ["SELECT public._healthy();"];
  const agos = new Set();
  for (let j = 0; j < JOBS; j++) {
    const name = `r${round}-j${j}`;
    let ago;
    do { ago = 11 + Math.floor(rand() * 1400); } while (agos.has(ago)); // unique slot, past grace, < 1 day
    agos.add(ago);
    const kind = rand() < 0.2 ? "weekly" : "daily";
    lines.push(`SELECT public._job('${name}', ${ago}, '${kind}', ${rand() < 0.9});`);
    const nRuns = Math.floor(rand() * 5);
    const used = new Set();
    for (let r = 0; r < nRuns; r++) {
      const spot = pick(SPOTS);
      // Two runs of one job never share a start_time here: which of two tied
      // rows the old body quoted was up to the plan (see the tie check below).
      if (spot[1] !== null && used.has(spot.join())) continue;
      used.add(spot.join());
      const [kk, delta] = spot;
      const st = pick(STATUSES), msg = pick(MSGS);
      lines.push(`SELECT public._run('${name}', ${kk}, ${delta === null ? "NULL" : `interval '${delta}'`}, ${st ? `'${st}'` : "NULL"}, ${msg ? `'${msg}'` : "NULL"});`);
    }
    const seen = rand();
    if (seen < 0.2) lines.push(`SELECT public._seen('${name}', 'same', interval '3 days');`);
    else if (seen < 0.3) lines.push(`SELECT public._seen('${name}', 'same', interval '1 minute');`);
    else if (seen < 0.4) lines.push(`SELECT public._seen('${name}', 'other', interval '3 days');`);
    else if (seen < 0.45) lines.push(`SELECT public._seen('${name}', 'paused', interval '3 days');`);
    const claim = rand();
    if (claim < 0.1) lines.push(`SELECT public._claim('${name}', 0);`);
    else if (claim < 0.25) lines.push(`SELECT public._claim('${name}', -1);`);
  }
  const r = await compare(`round ${round}`, lines.join("\n"));
  if (r.none.same && r.safe.same) identical++;
  else if (firstDiff.length < 2) {
    // Pair the differing alerts by job: what the old body said vs the new.
    const byJob = (logs) => Object.fromEntries(logs.map((l) => [l.tags.job, l.context.last_failure ?? null]));
    const o = byJob(r.none.a.logs), n = byJob(r.none.b.logs);
    firstDiff.push({ round, none: r.none.diff, safe: r.safe.diff,
      jobs: Object.keys({ ...o, ...n }).filter((j) => o[j] !== n[j]).map((j) => ({ job: j, old: o[j], new: n[j] })) });
  }
  candidates += r.none.b.ret.decided.length;
  nonCandidates += JOBS + 1 - r.none.b.ret.decided.length; // + the healthbeat job
  runs += r.safe.b.fx.length;
}
check(`random histories: old and new identical in ${identical}/${ROUNDS} rounds (${JOBS} jobs each, both policies)`,
  identical === ROUNDS, JSON.stringify(firstDiff).slice(0, 800));
check("random histories reach both outcomes (not vacuous)", candidates > ROUNDS * 5 && nonCandidates > ROUNDS * 20 && runs === ROUNDS * 3,
  `${candidates} candidates, ${nonCandidates} not, ${runs} runs`);

// ── ties: two jobs on the same slot run in jobid order in the new body ─────
const ties = `SELECT public._healthy();
  SELECT public._job('tie-b', 90, 'daily'); SELECT public._job('tie-a', 90, 'daily');
  SELECT public._run('tie-b', 0, interval '5 seconds', 'failed', 'x');
  SELECT public._run('tie-a', 0, interval '5 seconds', 'failed', 'x');`;
const t = await compare("ties", ties, { exactOrder: false });
check("tied slots: old and new decide the same set", t.none.same && t.safe.same, JSON.stringify([t.none.diff, t.safe.diff]));
const tieOrder = (await runWith(NEW, ties, "none")).ret.decided.map((d) => d.job);
check("tied slots: the new body orders them by jobid (created first, runs first)",
  JSON.stringify(tieOrder) === JSON.stringify(["tie-b", "tie-a"]), JSON.stringify(tieOrder));

// ── ties: two runs of one job with the same start_time ─────────────────────
// The old body quoted `ORDER BY start_time DESC LIMIT 1`, so which of two tied
// rows it quoted was up to the plan; the new body quotes the later runid. Only
// the quoted text can differ: the decision, the claim and the run are the same.
const sameStart = `SELECT public._healthy();
  SELECT public._job('same-start', 90, 'daily');
  SELECT public._run('same-start', 0, interval '5 seconds', 'failed', 'FIRST row');
  SELECT public._run('same-start', 0, interval '5 seconds', 'failed', 'SECOND row');`;
for (const policy of ["none", "safe"]) {
  const a = await runWith(OLD, sameStart, policy), b = await runWith(NEW, sameStart, policy);
  const strip = (x) => JSON.stringify({ ret: x.ret, runs: x.runs, fx: x.fx, sched: x.sched,
    logs: x.logs.map((l) => ({ ...l, message: l.message.replace(/\((FIRST|SECOND) row\)/, "(?)"),
                               context: { ...l.context, last_failure: "?" } })) });
  const oldQ = a.logs[0]?.context.last_failure, newQ = b.logs[0]?.context.last_failure;
  check(`same start_time, policy ${policy}: same decision, claim and run; old quoted one of the tied rows, new the later runid`,
    strip(a) === strip(b) && ["FIRST row", "SECOND row"].includes(oldQ) && newQ === "SECOND row",
    JSON.stringify({ old: oldQ, new: newQ, decided: b.ret.decided.length }));
}

// ── the run history is read once: no correlated subquery left ──────────────
const def = (await q(`SELECT pg_get_functiondef('public.run_missed_cron_catch_up()'::regprocedure) d`))[0].d;
const correlated = [...def.matchAll(/from\s+cron\.job_run_details\s+(?:as\s+)?(\w+)\s+where\s[^;]*?\b\1\.jobid\s*=\s*(\w+)\.jobid/gi)].length;
check("the live body correlates no cron.job_run_details subquery on jobid", correlated === 0, `${correlated} found`);

// ── access ──────────────────────────────────────────────────────────────────
for (const role of ["anon", "authenticated"]) {
  const ok = (await q(`SELECT has_function_privilege('${role}', 'public.run_missed_cron_catch_up()', 'EXECUTE') ok`))[0].ok;
  check(`${role} cannot execute run_missed_cron_catch_up()`, ok === false);
}
const svc = (await q(`SELECT has_function_privilege('service_role', 'public.run_missed_cron_catch_up()', 'EXECUTE') ok`))[0].ok;
check("service_role can execute it", svc === true);

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
