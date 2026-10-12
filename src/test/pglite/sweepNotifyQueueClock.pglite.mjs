/**
 * Q1357 PGlite proof: the notification-queue sweeps judge a row 1 ms inside
 * their window and leave one exactly AT its edge, at a Central midnight and on
 * both 2026 DST nights.
 *
 *   node src/test/pglite/sweepNotifyQueueClock.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite.
 *
 * Sweeps (newest CREATE across the migrations, clock reads pointed at a fixed
 * instant by ./lib/fixedClock.mjs):
 *   sweep_daily_job_digest          jobs posted in the last 24 h; no second digest within 23 h;
 *                                   a job counts once its early-access hold has passed
 *   sweep_saved_search_alert_queue  a saved-search or parish alert goes once its hold has
 *                                   passed; a failed parish alert waits out retry_after
 *   sweep_job_match_queue           a queued match goes once its hold and retry_after pass;
 *                                   a failure backs off 5 min * 2^attempts from now
 * The early-access hold is stubbed as created_at + 10 minutes (a pure function of
 * its inputs, so the sweep's own `<= now()` is what is on the clock); the
 * delivery functions are stubs that succeed, or raise for a job titled 'boom'.
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
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text, status text, parish text, budget numeric,
  is_seed boolean, customer_id uuid, created_at timestamptz);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, parish text, email_verified boolean, ban_status text, is_seed boolean);
CREATE TABLE public.notification_preferences (user_id uuid, job_matches boolean);
CREATE TABLE public.applications (helper_id uuid);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, type text, title text,
  message text, link text, read boolean, created_at timestamptz DEFAULT public._probe_now());
CREATE TABLE public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text, message text, tags jsonb,
  context jsonb, created_at timestamptz DEFAULT public._probe_now());
CREATE TABLE public.saved_search_alert_queue (id bigserial PRIMARY KEY, user_id uuid, job_id uuid, search_name text, matched_search_ids uuid[]);
CREATE TABLE public.parish_match_alert_queue (id bigserial PRIMARY KEY, user_id uuid, job_id uuid, attempts int DEFAULT 0, retry_after timestamptz);
CREATE TABLE public.job_match_queue (id bigserial PRIMARY KEY, user_id uuid, job_id uuid, attempts int DEFAULT 0, status text DEFAULT 'queued',
  retry_after timestamptz, drop_reason text, settled_at timestamptz);
CREATE TABLE public._sent (what text, job_id uuid);
CREATE FUNCTION public.seed_jobs_hidden_publicly() RETURNS boolean LANGUAGE sql AS $f$ SELECT false $f$;
CREATE FUNCTION public.job_announceable_to(j public.jobs, u uuid) RETURNS boolean LANGUAGE sql AS $f$ SELECT true $f$;
CREATE FUNCTION public.early_access_visible_at(u uuid, created timestamptz) RETURNS timestamptz LANGUAGE sql IMMUTABLE
  AS $f$ SELECT created + interval '10 minutes' $f$;
CREATE FUNCTION public.log_cron_defect(text, text, text, jsonb) RETURNS void LANGUAGE sql AS $f$ SELECT $f$;
CREATE FUNCTION public._deliver(what text, job uuid) RETURNS boolean LANGUAGE plpgsql AS $f$
BEGIN
  IF (SELECT title FROM public.jobs WHERE id = job) = 'boom' THEN RAISE EXCEPTION 'probe delivery failure'; END IF;
  INSERT INTO public._sent VALUES (what, job); RETURN true;
END $f$;
CREATE FUNCTION public.deliver_saved_search_alert(u uuid, j uuid, n text, ids uuid[]) RETURNS boolean LANGUAGE sql AS $f$ SELECT public._deliver('saved', j) $f$;
CREATE FUNCTION public.deliver_parish_match_alert(u uuid, j uuid) RETURNS boolean LANGUAGE sql AS $f$ SELECT public._deliver('parish', j) $f$;
CREATE FUNCTION public.deliver_job_match(qid bigint) RETURNS boolean LANGUAGE sql
  AS $f$ SELECT public._deliver('match', (SELECT job_id FROM public.job_match_queue WHERE id = qid)) $f$;
`);

const SWEEPS = ["sweep_daily_job_digest", "sweep_saved_search_alert_queue", "sweep_job_match_queue"];
for (const name of SWEEPS) {
  const { file, stmt } = newestFunction(name);
  const fixed = onFixedClock(stmt);
  check(`${name}: every clock read is on the fixed clock (${file})`, !/\bnow\s*\(\s*\)/i.test(fixed) && /_probe_now\(\)/.test(fixed));
  for (let i = 0; i < 3; i++) await db.exec(fixed); // replay-safe: applies 3x
}

const USER = "00000000-0000-0000-0000-0000000000a1";
const POSTER = "00000000-0000-0000-0000-0000000000b2";
const fresh = () => db.exec(`DELETE FROM public.jobs; DELETE FROM public.profiles; DELETE FROM public.applications;
  DELETE FROM public.notifications; DELETE FROM public.error_logs; DELETE FROM public.saved_search_alert_queue;
  DELETE FROM public.parish_match_alert_queue; DELETE FROM public.job_match_queue; DELETE FROM public._sent;
  INSERT INTO public.profiles VALUES ('${USER}', 'Orleans', true, NULL, false);
  INSERT INTO public.applications VALUES ('${USER}');`);
const iso = (ms) => new Date(ms).toISOString();
const MIN = 60_000, HOUR = 60 * MIN;
const HOLD = 10 * MIN;
const job = async (created, title = "j") =>
  (await q(`INSERT INTO public.jobs (title, status, parish, budget, is_seed, customer_id, created_at) VALUES ($1, 'open', 'Orleans', 80, false, $2, $3) RETURNING id`, [title, POSTER, iso(created)]))[0].id;
const sent = async (what) => Number((await q(`SELECT count(*)::int AS n FROM public._sent WHERE what = $1`, [what]))[0].n);

// A Central midnight (00:00 CDT), the fall-back night (01:30 CST, the repeated
// hour's second pass) and the spring-forward night (03:30 CDT, just after the gap).
const INSTANTS = ["2026-10-12T05:00:00Z", "2026-11-01T07:30:00Z", "2026-03-08T08:30:00Z"];

for (const at of INSTANTS) {
  const now = Date.parse(at);

  // sweep_daily_job_digest: a job posted exactly 24 h ago is out of today's digest; 1 ms later it is in.
  for (const [label, created, want] of [["posted AT now-24h", now - 24 * HOUR, 0], ["posted 1 ms inside 24 h", now - 24 * HOUR + 1, 1]]) {
    await fresh(); await setClock(db, at);
    await job(created);
    const n = (await q(`SELECT public.sweep_daily_job_digest() AS n`))[0].n;
    check(`${at} sweep_daily_job_digest: ${label} -> sent ${want}`, n === want, `sent ${n}`);
  }
  // ...a job still inside its early-access hold is not announced yet; at the hold's end it is.
  for (const [label, created, want] of [["hold ends AT now", now - HOLD, 1], ["hold ends 1 ms from now", now - HOLD + 1, 0]]) {
    await fresh(); await setClock(db, at);
    await job(created);
    const n = (await q(`SELECT public.sweep_daily_job_digest() AS n`))[0].n;
    check(`${at} sweep_daily_job_digest: ${label} -> sent ${want}`, n === want, `sent ${n}`);
  }
  // ...and a digest sent exactly 23 h ago no longer holds the next one; 1 ms later it does.
  for (const [label, prev, want] of [["last digest AT now-23h", now - 23 * HOUR, 1], ["last digest 1 ms inside 23 h", now - 23 * HOUR + 1, 0]]) {
    await fresh(); await setClock(db, at);
    await job(now - HOUR);
    await q(`INSERT INTO public.notifications (user_id, type, title, created_at) VALUES ($1, 'job_match', 'New jobs in Orleans', $2)`, [USER, iso(prev)]);
    const n = (await q(`SELECT public.sweep_daily_job_digest() AS n`))[0].n;
    check(`${at} sweep_daily_job_digest: ${label} -> sent ${want}`, n === want, `sent ${n}`);
  }

  // sweep_saved_search_alert_queue: both queues wait for the early-access hold (`<= now()`).
  for (const [label, created, want] of [["hold ends AT now", now - HOLD, 1], ["hold ends 1 ms from now", now - HOLD + 1, 0]]) {
    await fresh(); await setClock(db, at);
    const j = await job(created);
    await q(`INSERT INTO public.saved_search_alert_queue (user_id, job_id, search_name) VALUES ($1, $2, 'yard')`, [USER, j]);
    await q(`INSERT INTO public.parish_match_alert_queue (user_id, job_id) VALUES ($1, $2)`, [USER, j]);
    await q(`SELECT public.sweep_saved_search_alert_queue()`);
    check(`${at} sweep_saved_search_alert_queue: ${label} -> saved ${want}, parish ${want}`, (await sent("saved")) === want && (await sent("parish")) === want, `saved ${await sent("saved")} parish ${await sent("parish")}`);
  }
  // ...a parish alert in backoff goes when retry_after is reached, not 1 ms before.
  for (const [label, retry, want] of [["retry_after AT now", now, 1], ["retry_after 1 ms from now", now + 1, 0]]) {
    await fresh(); await setClock(db, at);
    const j = await job(now - HOUR);
    await q(`INSERT INTO public.parish_match_alert_queue (user_id, job_id, attempts, retry_after) VALUES ($1, $2, 1, $3)`, [USER, j, iso(retry)]);
    await q(`SELECT public.sweep_saved_search_alert_queue()`);
    check(`${at} sweep_saved_search_alert_queue: parish ${label} -> sent ${want}`, (await sent("parish")) === want);
  }
  // ...and a failed parish alert is put back 5 min * 2^attempts from the sweep's own now.
  {
    await fresh(); await setClock(db, at);
    const j = await job(now - HOUR, "boom");
    await q(`INSERT INTO public.parish_match_alert_queue (user_id, job_id, attempts) VALUES ($1, $2, 2)`, [USER, j]);
    await q(`SELECT public.sweep_saved_search_alert_queue()`);
    const r = (await q(`SELECT attempts, retry_after FROM public.parish_match_alert_queue`))[0];
    check(`${at} sweep_saved_search_alert_queue: a failed parish alert retries at now + 20 min`, r?.attempts === 3 && new Date(r.retry_after).getTime() === now + 20 * MIN, JSON.stringify(r));
  }

  // sweep_job_match_queue: the hold and retry_after are both `<= now()`.
  for (const [label, created, retry, want] of [
    ["hold ends AT now", now - HOLD, null, 1], ["hold ends 1 ms from now", now - HOLD + 1, null, 0],
    ["retry_after AT now", now - HOUR, now, 1], ["retry_after 1 ms from now", now - HOUR, now + 1, 0],
  ]) {
    await fresh(); await setClock(db, at);
    const j = await job(created);
    await q(`INSERT INTO public.job_match_queue (user_id, job_id, retry_after) VALUES ($1, $2, $3)`, [USER, j, retry === null ? null : iso(retry)]);
    const n = (await q(`SELECT public.sweep_job_match_queue() AS n`))[0].n;
    check(`${at} sweep_job_match_queue: ${label} -> sent ${want}`, n === want, `sent ${n}`);
  }
  // ...a failure backs off from the sweep's now; the fifth is dropped and settled at now.
  for (const [attempts, wantRetry] of [[0, now + 5 * MIN], [3, now + 40 * MIN], [4, null]]) {
    await fresh(); await setClock(db, at);
    const j = await job(now - HOUR, "boom");
    await q(`INSERT INTO public.job_match_queue (user_id, job_id, attempts) VALUES ($1, $2, $3)`, [USER, j, attempts]);
    await q(`SELECT public.sweep_job_match_queue()`);
    const r = (await q(`SELECT status, retry_after, settled_at FROM public.job_match_queue`))[0];
    const ok = wantRetry === null
      ? r.status === "dropped" && new Date(r.settled_at).getTime() === now
      : r.status === "queued" && new Date(r.retry_after).getTime() === wantRetry;
    check(`${at} sweep_job_match_queue: failure after ${attempts} attempt(s) -> ${wantRetry === null ? "dropped, settled now" : `retry at now + ${(wantRetry - now) / MIN} min`}`, ok, JSON.stringify(r));
  }
}

console.log(failures ? `\n${failures} FAIL` : "\nall PASS");
process.exit(failures ? 1 : 0);
