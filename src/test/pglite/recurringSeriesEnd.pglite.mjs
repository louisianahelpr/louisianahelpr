#!/usr/bin/env node
/**
 * PGlite proof for 20260925052841_recurring_series_end (docs/OPEN.md, recurring
 * series end + schedule lock).
 *
 *   node src/test/pglite/recurringSeriesEnd.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR). Client seat = `SET ROLE authenticated` with
 * request.jwt.claim.sub = the user; the server seat is the superuser with no
 * sub, or service_role.
 *
 * OLD STATE (Q357 lock from 20260924053706 verbatim + the helper whitelist from
 * its newest prior definition, 20260915101102): the poster's PATCH of
 * recurrence_weeks / date_needed / start_time on a HIRED series parent lands,
 * and end_recurring_series does not exist. Printed as "OLD STATE RED".
 *
 * NEW STATE (migration verbatim, applied 3x): those PATCHes are refused;
 * series_ended_on is never client-writable; end_recurring_series works for the
 * poster and the standing Helpr, refuses a stranger and a non-series, is
 * idempotent, ends on the latest of visit one / today (Chicago) / the last
 * created visit, and notifies the other party; once ended, ANY new visit is
 * refused on insert, a gap dated on or before the end included; a pre-hire date edit and an
 * unrelated edit still work; anon cannot execute the RPC.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const repo = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const read = (f) => readFileSync(repo + f, "utf8");

const MIGRATION = read("20260925052841_recurring_series_end.sql");
const Q357 = read("20260924053706_jobs_series_columns_client_lock.sql");
const oldWhitelistSrc = read("20260915101102_null_uid_is_not_server.sql");
const OLD_WHITELIST = (() => {
  const start = oldWhitelistSrc.indexOf("CREATE OR REPLACE FUNCTION public.enforce_helper_jobs_column_whitelist()");
  const end = oldWhitelistSrc.indexOf("$function$;", start);
  if (start < 0 || end < 0) throw new Error("old enforce_helper_jobs_column_whitelist not found");
  return oldWhitelistSrc.slice(start, end + "$function$;".length);
})();

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const P = "11111111-1111-1111-1111-111111111111"; // poster
const H = "22222222-2222-2222-2222-222222222222"; // standing Helpr
const X = "33333333-3333-3333-3333-333333333333"; // stranger
const J = (n) => `a0000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;

const SETUP = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  grant usage on schema auth to authenticated, anon, service_role;
  create function public.is_server_context() returns boolean language sql stable as
    $f$ select auth.uid() is null and current_user::text not in ('anon', 'authenticated') $f$;
  create type public.job_status as enum ('open','accepted','in_progress','completed','cancelled','revision_requested','disputed','pending_approval');
  create table public.jobs (
    id uuid primary key default gen_random_uuid(), title text, customer_id uuid, helper_id uuid,
    recurring_helper_id uuid, status public.job_status not null default 'open',
    date_needed date, start_time time, recurrence_days smallint[], recurrence_weeks smallint,
    recurrence_end_date date, parent_job_id uuid references public.jobs(id), updated_at timestamptz default now());
  create table public.notifications (id serial primary key, user_id uuid not null, job_id uuid,
    title text not null, message text not null, type text not null default 'info', link text);
  grant usage on schema public to authenticated, anon, service_role;
  create function public.sync_jobs_select_grants() returns void language sql as $f$ select $f$;
  grant select, insert, update on public.jobs to authenticated, service_role;
  grant select on public.notifications to authenticated;
  grant select, insert on public.notifications to service_role;
  ${Q357}
  ${OLD_WHITELIST}
  create trigger trg_helper_jobs_column_whitelist before update on public.jobs
    for each row execute function public.enforce_helper_jobs_column_whitelist();
`;

const d = (n) => `(current_date + ${n})`;
// Seeded as the server (no sub, superuser).
const SEED = `
  insert into public.jobs (id, title, customer_id, helper_id, recurring_helper_id, status, date_needed, start_time, recurrence_days, recurrence_weeks, recurrence_end_date)
  values
    ('${J(1)}', 'hired series', '${P}', '${H}', '${H}', 'accepted', ${d(10)}, '09:00', '{1,3}', 4, ${d(31)}),
    ('${J(2)}', 'unhired series', '${P}', null, null, 'open', ${d(10)}, '09:00', '{2}', 4, ${d(31)}),
    ('${J(3)}', 'hired series, completed, no visits', '${P}', '${H}', '${H}', 'completed', ${d(-2)}, '09:00', '{4}', 8, ${d(47)}),
    ('${J(4)}', 'one-off', '${P}', '${H}', null, 'accepted', ${d(5)}, '09:00', null, null, null),
    ('${J(5)}', 'series whose hired Helpr moved on', '${P}', '${X}', '${H}', 'accepted', ${d(10)}, '09:00', '{5}', 4, ${d(31)});
`;

async function as(db, role, uid, sql) {
  try {
    await db.exec(`set request.jwt.claim.sub = '${uid ?? ""}'; set role ${role};`);
    const out = await db.query(sql);
    await db.exec(`reset role; reset request.jwt.claim.sub;`);
    return { ok: true, rows: out.rows, affected: out.affectedRows };
  } catch (e) {
    await db.exec("reset role; reset request.jwt.claim.sub;");
    return { ok: false, err: String(e.message).split("\n")[0] };
  }
}
const server = (db, sql) => as(db, "service_role", null, sql);
const job = async (db, id) => (await db.query(`select * from public.jobs where id='${id}'`)).rows[0];

// ── OLD STATE ──────────────────────────────────────────────────────────────
{
  const db = new PGlite();
  await db.exec(SETUP);
  await db.exec(SEED);
  const weeks = await as(db, "authenticated", P, `update public.jobs set recurrence_weeks = 52 where id='${J(1)}'`);
  const date = await as(db, "authenticated", P, `update public.jobs set date_needed = date_needed + 21, start_time = '06:00' where id='${J(1)}'`);
  const rpc = await as(db, "authenticated", P, `select public.end_recurring_series('${J(1)}')`);
  const row = await job(db, J(1));
  const red = weeks.ok && weeks.affected === 1 && date.ok && row.recurrence_weeks === 52 && !rpc.ok;
  console.log(`-- OLD STATE ${red ? "RED" : "NOT RED"}: weeks=${JSON.stringify(weeks)} date=${JSON.stringify(date)} rpc=${rpc.err ?? "exists"}`);
  if (!red) failures++;
  await db.close();
}

// ── NEW STATE ──────────────────────────────────────────────────────────────
const db = new PGlite();
await db.exec(SETUP);
for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
await db.exec(SEED);

const refused = (r, re) => !r.ok && re.test(r.err);
const L = /series_locked/;

let r = await as(db, "authenticated", P, `update public.jobs set recurrence_weeks = 52 where id='${J(1)}'`);
check("poster cannot extend a hired series (recurrence_weeks)", refused(r, L), r.err);
r = await as(db, "authenticated", P, `update public.jobs set date_needed = date_needed + 21 where id='${J(1)}'`);
check("poster cannot move a hired series (date_needed)", refused(r, L), r.err);
r = await as(db, "authenticated", P, `update public.jobs set start_time = '06:00' where id='${J(1)}'`);
check("poster cannot move a hired series (start_time)", refused(r, L), r.err);
r = await as(db, "authenticated", P, `update public.jobs set recurrence_end_date = recurrence_end_date + 100 where id='${J(1)}'`);
check("poster cannot change recurrence_end_date on a hired series", refused(r, L), r.err);
r = await as(db, "authenticated", P, `update public.jobs set series_ended_on = current_date where id='${J(1)}'`);
check("poster cannot write series_ended_on directly", refused(r, L), r.err);
r = await as(db, "authenticated", H, `update public.jobs set series_ended_on = current_date where id='${J(1)}'`);
check("Helpr cannot write series_ended_on directly", !r.ok, r.err);
r = await as(db, "authenticated", P, `insert into public.jobs (title, customer_id, series_ended_on) values ('x', '${P}', current_date)`);
check("client insert with series_ended_on is refused", refused(r, L), r.err);
r = await as(db, "authenticated", P, `update public.jobs set title = 'renamed' where id='${J(1)}'`);
check("poster can still edit an unrelated column", r.ok && r.affected === 1, r.err);
r = await as(db, "authenticated", P, `update public.jobs set date_needed = date_needed + 7, recurrence_weeks = 6 where id='${J(2)}'`);
check("pre-hire series edit still works", r.ok && r.affected === 1, r.err);
r = await as(db, "authenticated", P, `update public.jobs set date_needed = date_needed + 1 where id='${J(4)}'`);
check("one-off hired job date is not touched by this lock (out of scope, Q-owner)", r.ok && r.affected === 1, r.err);

r = await as(db, "authenticated", X, `select public.end_recurring_series('${J(1)}') as v`);
check("stranger cannot end a series", refused(r, /not_authorized/), r.err);
r = await as(db, "authenticated", H, `select public.end_recurring_series('${J(5)}') as v`);
check("a stale recurring_helper_id (no longer the hired helper_id) cannot end the series", refused(r, /not_authorized/), r.err);
r = await as(db, "authenticated", P, `select public.end_recurring_series('${J(4)}') as v`);
check("a one-off job is not a series", refused(r, /not_a_series/), r.err);
r = await as(db, "anon", null, `select public.end_recurring_series('${J(1)}') as v`);
check("anon cannot execute end_recurring_series", refused(r, /permission denied/), r.err);

r = await server(db, `insert into public.jobs (title, customer_id, helper_id, status, date_needed, parent_job_id) values ('visit', '${P}', '${H}', 'accepted', ${d(12)}, '${J(1)}')`);
check("server creates a visit while the series runs", r.ok, r.err);
r = await server(db, `insert into public.jobs (title, customer_id, helper_id, status, date_needed, parent_job_id) values ('cancelled visit', '${P}', '${H}', 'cancelled', ${d(13)}, '${J(1)}')`);
check("server records a cancelled visit (it must not extend the end)", r.ok, r.err);

r = await as(db, "authenticated", H, `select public.end_recurring_series('${J(1)}') as v`);
const endedByHelper = r.ok ? r.rows[0].v : null;
const expectEnd = (await db.query(`select ${d(12)}::text as e`)).rows[0].e;
check("standing Helpr can end the series", r.ok && endedByHelper.action === "ended", r.err ?? JSON.stringify(endedByHelper));
check("end date = last created non-cancelled visit (latest of visit one, today, created visits)", endedByHelper?.ended_on === expectEnd, `${endedByHelper?.ended_on} vs ${expectEnd}`);
check("booked visits are counted", endedByHelper?.booked_visits_remaining === 1, JSON.stringify(endedByHelper));
let n = (await db.query(`select user_id, link from public.notifications where job_id='${J(1)}'`)).rows;
check("the poster is told the Helpr ended it", n.length === 1 && n[0].user_id === P && n[0].link === `/posts?job=${J(1)}`, JSON.stringify(n));

r = await as(db, "authenticated", P, `select public.end_recurring_series('${J(1)}') as v`);
check("ending again is idempotent", r.ok && r.rows[0].v.action === "already_ended" && r.rows[0].v.ended_on === expectEnd, r.err ?? JSON.stringify(r.rows?.[0]));
n = (await db.query(`select count(*)::int c from public.notifications where job_id='${J(1)}'`)).rows[0].c;
check("idempotent call sends nothing", n === 1, String(n));

r = await server(db, `insert into public.jobs (title, customer_id, helper_id, status, date_needed, parent_job_id) values ('visit', '${P}', '${H}', 'accepted', ${d(14)}, '${J(1)}')`);
check("server cannot create a visit after the end", refused(r, /series_ended/), r.err);
r = await server(db, `insert into public.jobs (title, customer_id, helper_id, status, date_needed, parent_job_id) values ('visit', '${P}', '${H}', 'accepted', ${d(11)}, '${J(1)}')`);
check("a GAP dated on or before the end is refused too (review 2026-09-25: no new visit once ended)", refused(r, /series_ended/), r.err);

r = await as(db, "authenticated", P, `select public.end_recurring_series('${J(3)}') as v`);
const today = (await db.query(`select (now() at time zone 'America/Chicago')::date::text as t`)).rows[0].t;
check("poster can end a series whose first visit is COMPLETED", r.ok && r.rows[0].v.action === "ended", r.err);
check("completed series with no visits ends today (Chicago)", r.ok && r.rows[0].v.ended_on === today, JSON.stringify(r.rows?.[0]));
n = (await db.query(`select user_id, link from public.notifications where job_id='${J(3)}'`)).rows;
check("the Helpr is told the poster ended it", n.length === 1 && n[0].user_id === H && n[0].link === `/jobs?job=${J(3)}`, JSON.stringify(n));

r = await server(db, `update public.jobs set series_ended_on = null where id='${J(3)}'`);
check("service_role is not client-locked", r.ok, r.err);

await db.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
