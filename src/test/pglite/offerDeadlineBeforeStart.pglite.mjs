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

// 7. Grants: never anon.
if (!MODE) {
  const acl = (await db.query(`SELECT proname, proacl::text AS acl FROM pg_proc WHERE proname IN ('accept_application', 'job_offer_cutoff', 'offer_deadline_follows_start', 'expire_unanswered_offers')`)).rows;
  for (const a of acl) check(`${a.proname}: no anon / PUBLIC execute`, !/(^|[{,])(anon)?=X/.test(a.acl ?? ""), a.acl);
}

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
