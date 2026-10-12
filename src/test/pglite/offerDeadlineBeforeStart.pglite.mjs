#!/usr/bin/env node
/**
 * PGlite proof for 20261005184940_offer_deadline_before_start: a hire offer's
 * answer-by time (jobs.response_deadline) is never after the job's start.
 *
 *   node src/test/pglite/offerDeadlineBeforeStart.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/offerDeadlineBeforeStart.pglite.mjs # RED: the state on main
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR). The fixture is the minimum accept_application
 * reads: jobs + applications, auth.uid() from the JWT claim, are_users_blocked
 * stubbed false. accept_application on main is cut from its newest migration
 * before this one (20260924023314), which is what prod runs (pg_get_functiondef
 * read 2026-10-05).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const MIGDIR = "../../../supabase/migrations/";
const NEW = read(`${MIGDIR}20261005184940_offer_deadline_before_start.sql`);
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the state on main (expect FAILs)`);

function cut(file, name) {
  const sql = read(MIGDIR + file);
  const m = [...sql.matchAll(new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi"))].at(-1);
  const open = /\bAS\s+(\$\w*\$)/i.exec(sql.slice(m.index));
  const bodyStart = m.index + open.index + open[0].length;
  const close = sql.indexOf(open[1], bodyStart);
  return sql.slice(m.index, sql.indexOf(";", close) + 1);
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const HELPER = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, status text,
  date_needed date, start_time time, response_deadline timestamptz,
  helper_confirmed_at timestamptz
);
CREATE TABLE public.applications (
  id uuid PRIMARY KEY, job_id uuid, helper_id uuid, status text, offer_message text
);
CREATE FUNCTION public.are_users_blocked(a uuid, b uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
-- What expire_unanswered_offers touches, minimally. A strike is a row in
-- strikes, so "was the Helpr struck" is a count.
ALTER TABLE public.jobs ADD COLUMN title text, ADD COLUMN is_seed boolean DEFAULT true;
ALTER TABLE public.applications ADD COLUMN closed_reason text;
CREATE TABLE public.profiles (user_id uuid, is_seed boolean DEFAULT true);
CREATE TABLE public.job_accept_pending (job_id uuid, helper_id uuid);
-- The restated expire_unanswered_offers / accept_group_application also run a
-- crew pass (Q729): an empty roster table keeps that pass a no-op here.
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS is_group_job boolean DEFAULT false, ADD COLUMN IF NOT EXISTS helpers_needed int DEFAULT 1;
CREATE TABLE public.group_job_helpers (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, job_id uuid, helper_id uuid, slot_no int, share_cents int, helper_confirmed_at timestamptz, response_deadline timestamptz);
CREATE TABLE public.notifications (user_id uuid, title text, message text, type text, link text, job_id uuid);
CREATE TABLE public.error_logs (severity text, message text, tags jsonb, context jsonb);
CREATE TABLE public.strikes (helper_id uuid, job_id uuid, why text);
CREATE FUNCTION public.helper_accept_block_reason(u uuid) RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$;
CREATE FUNCTION public.apply_job_denial_consequence(h uuid, j uuid, why text) RETURNS text LANGUAGE sql AS $$ INSERT INTO public.strikes VALUES (h, j, why) RETURNING 'warning' $$;
GRANT USAGE ON SCHEMA public TO authenticated;
`);
await db.exec(cut("20260924023314_hire_refused_across_block.sql", "accept_application"));
await db.exec(cut("20261004184021_expired_offer_says_it_expired.sql", "expire_unanswered_offers"));
if (!MODE) for (let i = 0; i < 3; i++) await db.exec(NEW);

// A job and its pending application, starting `startSql` (a timestamptz
// expression, or NULL for a date-only job on `dateSql`).
async function seed(n, dateSql, timeSql) {
  await db.exec(`
    INSERT INTO public.jobs (id, customer_id, status, date_needed, start_time)
    VALUES ('${id(n)}', '${POSTER}', 'open', ${dateSql}, ${timeSql});
    INSERT INTO public.applications (id, job_id, helper_id, status)
    VALUES ('${id(100 + n)}', '${id(n)}', '${HELPER}', 'pending');`);
}
// Chicago wall clock for an instant, as the two job columns.
const chicago = (expr) => [`((${expr}) AT TIME ZONE 'America/Chicago')::date`, `((${expr}) AT TIME ZONE 'America/Chicago')::time`];

async function hire(n, deadlineSql) {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${POSTER}'; SELECT public.accept_application('${id(100 + n)}', ${deadlineSql}, NULL);`);
    const r = await db.query(`SELECT response_deadline, (SELECT public_cutoff FROM (SELECT ((date_needed + coalesce(start_time, '00:00'))::timestamp AT TIME ZONE 'America/Chicago') + CASE WHEN start_time IS NULL THEN interval '1 day' ELSE interval '0' END AS public_cutoff) c) AS cutoff, status FROM public.jobs WHERE id = '${id(n)}'`);
    return { ok: true, row: r.rows[0] };
  } catch (e) {
    return { ok: false, err: e.message };
  }
}

// 1. The owner's case: starts in 30 min, poster picks the default 24 h.
await seed(1, ...chicago(`now() + interval '30 minutes'`));
let r = await hire(1, `now() + interval '24 hours'`);
check("starts in 30 min, 24 h chosen: answer-by is the start, not 24 h out", r.ok && new Date(r.row.response_deadline) <= new Date(r.row.cutoff), r.ok ? `${r.row.response_deadline} vs start ${r.row.cutoff}` : r.err);

// 2. Far-off job: the poster's window stands.
await seed(2, ...chicago(`now() + interval '10 days'`));
r = await hire(2, `now() + interval '4 hours'`);
check("starts in 10 days, 4 h chosen: the 4 h stands", r.ok && Math.abs(new Date(r.row.response_deadline) - (Date.now() + 4 * 3600e3)) < 120e3, r.ok ? String(r.row.response_deadline) : r.err);

// 3. A client cannot hand the Helpr more than 48 h, nor "never" (NULL).
await seed(3, ...chicago(`now() + interval '30 days'`));
r = await hire(3, `now() + interval '365 days'`);
check("a year-out deadline is capped at 48 h", r.ok && new Date(r.row.response_deadline) <= new Date(Date.now() + 48 * 3600e3 + 60e3), r.ok ? String(r.row.response_deadline) : r.err);
await seed(4, ...chicago(`now() + interval '30 days'`));
r = await hire(4, `NULL`);
check("a NULL deadline (never expires) becomes 48 h", r.ok && r.row.response_deadline != null, r.ok ? String(r.row.response_deadline) : r.err);

// 4. Starts in 5 minutes / already started: refused, nothing written.
await seed(5, ...chicago(`now() + interval '5 minutes'`));
r = await hire(5, `now() + interval '24 hours'`);
check("starts in 5 min: hire refused job_starts_too_soon", !r.ok && /job_starts_too_soon/.test(r.err), r.ok ? `hired, deadline ${r.row.response_deadline}` : r.err);
const st5 = (await db.query(`SELECT status FROM public.jobs WHERE id = '${id(5)}'`)).rows[0].status;
check("  and the job is still open", st5 === "open", st5);
await seed(6, ...chicago(`now() - interval '1 hour'`));
r = await hire(6, `now() + interval '1 hour'`);
check("started an hour ago: hire refused", !r.ok && /job_starts_too_soon/.test(r.err), r.ok ? "hired" : r.err);

// 5. Date-only job (no start_time) today: runs to the end of its day.
await seed(7, `(now() AT TIME ZONE 'America/Chicago')::date + 1`, `NULL`);
r = await hire(7, `now() + interval '48 hours'`);
check("date-only job tomorrow: answer-by is the end of that day at the latest", r.ok && new Date(r.row.response_deadline) <= new Date(r.row.cutoff), r.ok ? `${r.row.response_deadline} vs ${r.row.cutoff}` : r.err);

// 6. The start moving EARLIER under a live offer pulls the answer-by with it.
await seed(8, ...chicago(`now() + interval '3 days'`));
r = await hire(8, `now() + interval '48 hours'`);
await db.exec(`UPDATE public.jobs SET date_needed = ((now() + interval '2 hours') AT TIME ZONE 'America/Chicago')::date, start_time = ((now() + interval '2 hours') AT TIME ZONE 'America/Chicago')::time WHERE id = '${id(8)}'`);
const moved = (await db.query(`SELECT response_deadline, ((date_needed + start_time)::timestamp AT TIME ZONE 'America/Chicago') AS start FROM public.jobs WHERE id = '${id(8)}'`)).rows[0];
check("start moved to 2 h from now: answer-by follows it", new Date(moved.response_deadline) <= new Date(moved.start), `${moved.response_deadline} vs ${moved.start}`);

// 6b. A window that WAS the start follows the start LATER too (review finding 3):
// hired 1 h before the start, then moved to 3 days out -> not still today.
await seed(9, ...chicago(`now() + interval '1 hour'`));
await hire(9, `now() + interval '24 hours'`);
await db.exec(`UPDATE public.jobs SET date_needed = ((now() + interval '3 days') AT TIME ZONE 'America/Chicago')::date WHERE id = '${id(9)}'`);
const later = (await db.query(`SELECT response_deadline FROM public.jobs WHERE id = '${id(9)}'`)).rows[0].response_deadline;
check("start moved 3 days later: answer-by moves with it (to the 48 h cap)", new Date(later) > new Date(Date.now() + 47 * 3600e3), String(later));

// 6c. No strike when it was the START that ended the window (review finding 1);
// a strike still lands for an ordinary expired window (can fail).
await db.exec(`
  INSERT INTO public.jobs (id, customer_id, helper_id, status, title, date_needed, start_time, response_deadline)
  VALUES ('${id(10)}', '${POSTER}', '${HELPER}', 'accepted', 'capped',
          ((now() - interval '2 minutes') AT TIME ZONE 'America/Chicago')::date,
          ((now() - interval '2 minutes') AT TIME ZONE 'America/Chicago')::time,
          date_trunc('second', now() - interval '2 minutes')),
         ('${id(11)}', '${POSTER}', '${HELPER}', 'accepted', 'ordinary',
          ((now() + interval '5 days') AT TIME ZONE 'America/Chicago')::date, '09:00', now() - interval '2 minutes');
  UPDATE public.jobs SET response_deadline = ((date_needed + start_time)::timestamp AT TIME ZONE 'America/Chicago') WHERE id = '${id(10)}';
  SELECT public.expire_unanswered_offers();`);
const struck = async (n) => Number((await db.query(`SELECT count(*)::int AS c FROM public.strikes WHERE job_id = '${id(n)}'`)).rows[0].c);
const reopened = (await db.query(`SELECT count(*)::int AS c FROM public.jobs WHERE id IN ('${id(10)}', '${id(11)}') AND status = 'open'`)).rows[0].c;
check("both expired offers reopened", reopened === 2, String(reopened));
check("window ended by the job's start: no strike", (await struck(10)) === 0, `${await struck(10)} strikes`);
check("  an ordinary expired window still strikes (can fail)", (await struck(11)) === 1, `${await struck(11)} strikes`);

// 8. Q1404 (lh-money-escrow review of Q1398): the clamp runs inside the LIVE
// jobs trigger chain, driven by respond_job_schedule_change as the Helpr.
// The chain is the 2026-09-14 live fixture (scripts/probes/fixtures/
// dispute-table-door.live.sql) with the trigger functions this path touches
// brought to their newest migration (Helpr column whitelist, hired-job
// schedule lock). zzzz_ sorts after every one of them; measured on prod
// 2026-10-12 (pg_trigger on public.jobs, BEFORE UPDATE): the only later ones
// are zzzzz_jobs_route_notes and zzzzzz_jobs_location_clears_coords, which
// fire on notes and location only.
{
  const LIVE = read("../../../scripts/probes/fixtures/dispute-table-door.live.sql");
  const live = new PGlite();
  await live.exec(LIVE);
  await live.exec(`
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS series_ended_on date,
  ADD COLUMN IF NOT EXISTS series_split_ok boolean,
  ADD COLUMN IF NOT EXISTS helper_arrival_near_miss_at timestamptz,
  ADD COLUMN IF NOT EXISTS helper_arrival_near_miss_ft numeric,
  ADD COLUMN IF NOT EXISTS materials_note text,
  ADD COLUMN IF NOT EXISTS access_notes text;
CREATE TABLE public.group_job_helpers (job_id uuid, helper_id uuid, status text);
CREATE TABLE public.job_schedule_change_requests (
  id uuid PRIMARY KEY, job_id uuid, requested_by uuid, responder_id uuid, status text,
  old_date date, old_start_time time, new_date date, new_start_time time,
  expires_at timestamptz, decided_at timestamptz
);
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.notify_schedule_change_expired(uuid, text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
`);
  await live.exec(cut("20260915101102_null_uid_is_not_server.sql", "is_server_context") + ";");
  await live.exec(cut("20261007113957_booked_job_detail_change_request.sql", "enforce_helper_jobs_column_whitelist"));
  await live.exec(cut("20260927012805_hired_job_schedule_lock.sql", "enforce_series_columns_client_lock"));
  await live.exec(`CREATE TRIGGER trg_enforce_series_columns_client_lock BEFORE INSERT OR UPDATE OF parent_job_id, recurrence_days, recurrence_weeks, date_needed, start_time, recurrence_end_date, series_ended_on, series_split_ok ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.enforce_series_columns_client_lock();`);
  await live.exec(cut("20261005184940_offer_deadline_before_start.sql", "job_offer_cutoff"));
  await live.exec(cut("20261005184940_offer_deadline_before_start.sql", "offer_deadline_follows_start"));
  if (MODE !== "skip") {
    // The CREATE TRIGGER statement itself, cut from the migration that defines
    // it (review of this section: a later rename must turn this red).
    const migSql = read(`${MIGDIR}20261005184940_offer_deadline_before_start.sql`);
    const trig = /CREATE TRIGGER\s+(\w+)\s+BEFORE UPDATE OF date_needed, start_time ON public\.jobs\s+FOR EACH ROW EXECUTE FUNCTION public\.offer_deadline_follows_start\(\);/.exec(migSql);
    check("live chain: the migration still defines the clamp trigger", Boolean(trig));
    if (trig) await live.exec(trig[0]);
  }
  await live.exec(cut("20261008183640_schedule_change_lead_time_and_expiry_notice.sql", "respond_job_schedule_change"));
  await live.exec(`GRANT EXECUTE ON FUNCTION public.respond_job_schedule_change(uuid, boolean) TO authenticated;`);

  const JOB = id(40);
  const REQ = id(41);
  // Hired, offer not answered yet (helper_confirmed_at NULL), answer-by in 40 h,
  // job in 3 days; the POSTER asked to move it to 3 h from now and the Helpr accepts.
  await live.exec(`
INSERT INTO public.jobs (id, customer_id, helper_id, title, status, payment_status, budget, date_needed, start_time, response_deadline, helper_confirmed_at)
VALUES ('${JOB}', '${POSTER}', '${HELPER}', 'live chain', 'accepted', 'escrow', 100,
        ((now() + interval '3 days') AT TIME ZONE 'America/Chicago')::date, '09:00', now() + interval '40 hours', NULL);
INSERT INTO public.job_schedule_change_requests (id, job_id, requested_by, responder_id, status, old_date, old_start_time, new_date, new_start_time, expires_at)
SELECT '${REQ}', id, '${POSTER}', '${HELPER}', 'pending', date_needed, start_time,
       ((now() + interval '3 hours') AT TIME ZONE 'America/Chicago')::date,
       date_trunc('minute', ((now() + interval '3 hours') AT TIME ZONE 'America/Chicago')::time),
       now() + interval '2 days'
  FROM public.jobs WHERE id = '${JOB}';
`);
  await live.exec(`SELECT set_config('request.uid', '${HELPER}', false); SELECT set_config('request.jwt.claim.role', 'authenticated', false); SET ROLE authenticated;`);
  let res;
  try {
    res = { ok: true, row: (await live.query(`SELECT public.respond_job_schedule_change('${REQ}', true) AS r`)).rows[0].r };
  } catch (e) {
    res = { ok: false, err: e.message };
  } finally {
    await live.exec("RESET ROLE");
  }
  check("live chain: the Helpr's accept of the poster's new time passes every trigger before the clamp", res.ok && res.row?.status === "accepted", res.ok ? JSON.stringify(res.row) : res.err);
  const after = (await live.query(`SELECT response_deadline, ((date_needed + start_time)::timestamp AT TIME ZONE 'America/Chicago') AS start FROM public.jobs WHERE id = '${JOB}'`)).rows[0];
  check("live chain: the answer-by follows the new, earlier start", new Date(after.response_deadline) <= new Date(after.start), `${after.response_deadline} vs start ${after.start}`);
  const order = (await live.query(`SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.jobs'::regclass AND NOT tgisinternal ORDER BY tgname`)).rows.map((r) => r.tgname);
  if (MODE !== "skip") {
    const clamp = order.find((n) => /offer_deadline_follows_start$/.test(n));
    check("live chain: the clamp trigger fires after every column check in the chain (sorts after the Helpr whitelist)",
      order.at(-1) === clamp && clamp > "trg_helper_jobs_column_whitelist", order.join(", "));
  }
}

// 7. Grants: never anon.
if (!MODE) {
  const acl = (await db.query(`SELECT proname, proacl::text AS acl FROM pg_proc WHERE proname IN ('accept_application', 'job_offer_cutoff', 'offer_deadline_follows_start', 'expire_unanswered_offers')`)).rows;
  for (const a of acl) check(`${a.proname}: no anon / PUBLIC execute`, !/(^|[{,])(anon)?=X/.test(a.acl ?? ""), a.acl);
}

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
