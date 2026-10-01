#!/usr/bin/env node
/**
 * PGlite proof for 20260927012806_recurring_split_days (docs/OPEN.md Q407 (4),
 * (5), (6) and the pick-up addendum).
 *
 *   PGLITE_DIR=~/.lh-pglite-probe node src/test/pglite/recurringSplitDays.pglite.mjs
 *
 * World: src/test/pglite/seriesWorld.mjs (the real trigger chain on jobs, read
 * from the newest migrations). The migration chain under test,
 * 20260927012804, 20260927012805 and 20260927012806, is applied verbatim
 * THREE times.
 *
 * OLD STATE (052841 only): a one-person series has no per-date holder, the
 * poster's split choice does not exist, a visit is created for whoever the
 * cron names, and a Helpr cannot give a date back (their end_recurring_series
 * ends the POSTER's series). Printed as "OLD STATE RED".
 *
 * NEW STATE: series_visit_dates matches recurringVisitDates on 400 random
 * schedules; the split choice is client-set at posting and locked after hire;
 * hire seeds holds (one person) or an offer (split); claim / offer / give-up /
 * pick-up / leave follow the owner's rules; the two-claimers race has exactly
 * one winner; a visit can only be inserted for the date's holder; the strike
 * lands only within 24 hours; the browse view carries the terms.
 */
import { recurringVisitDates } from "../../lib/recurringSchedule.ts";
import { PGlite, readMigration, baseSchema, as, checker, refused, USERS, newestFunctionSql } from "./seriesWorld.mjs";

const END = readMigration("20260927012804_recurring_series_end.sql");
const LOCK = readMigration("20260927012805_hired_job_schedule_lock.sql");
const SPLIT = readMigration("20260927012806_recurring_split_days.sql");
// Discovery surfaces restated with `parent_job_id IS NULL` (authz HIGH). Its
// LANGUAGE sql bodies read prod tables this world does not model, so it is
// applied with check_function_bodies off; prod validates them on deploy.
const VIS = readMigration("20260927015010_recurring_vacated_visit_private.sql");
// series_visit_dates redefined: N weeks FROM the start (owner, 2026-10-01). The
// TypeScript authority moved with it, so the parity check below needs it too;
// its own proof is recurringSeriesWeeksFromStart.pglite.mjs.
const FROM_START = readMigration("20261001215555_recurring_series_weeks_from_start.sql");
const { P, A, B, C, X } = USERS;
const { check, failures, fail } = checker();

const J = (n) => `a0000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const server = (db, sql) => as(db, "service_role", null, sql);
const d = (n) => `(current_date + ${n})`;

// Series fixtures: every weekday, 3 weeks, visit one 3 days out, so every date
// after it is a visit date and the calendar is independent of today's weekday.
const SERIES = (id, split, title) => `
  insert into public.jobs (id, title, customer_id, status, date_needed, start_time, recurrence_days, recurrence_weeks, series_split_ok)
  values ('${id}', '${title}', '${P}', 'open', ${d(3)}, '09:00', '{0,1,2,3,4,5,6}', 3, ${split});`;
const HIRE = (id, who) => `update public.jobs set helper_id = '${who}', status = 'accepted', helper_confirmed_at = now() where id = '${id}'`;
const dates = async (db, id) => (await db.query(`select h.visit_date::text d, h.helper_id from public.series_visit_holds h where parent_job_id='${id}' order by 1`)).rows;
const dateAt = async (db, n) => (await db.query(`select ${d(n)}::text as v`)).rows[0].v;

// ── OLD STATE ──────────────────────────────────────────────────────────────
{
  const db = new PGlite();
  await db.exec(baseSchema("20260927012804"));
  await db.exec(END);
  const hasSplit = (await db.query(`select 1 from information_schema.columns where table_name='jobs' and column_name='series_split_ok'`)).rows.length > 0;
  await db.exec(`insert into public.jobs (id, title, customer_id, status, date_needed, start_time, recurrence_days, recurrence_weeks)
                 values ('${J(1)}', 'old', '${P}', 'open', ${d(3)}, '09:00', '{0,1,2,3,4,5,6}', 3)`);
  await server(db, HIRE(J(1), A));
  const strangerVisit = await server(db, `insert into public.jobs (title, customer_id, helper_id, status, date_needed, parent_job_id) values ('v', '${P}', '${X}', 'accepted', ${d(5)}, '${J(1)}')`);
  const leave = await as(db, "authenticated", A, `select public.end_recurring_series('${J(1)}') as v`);
  const ended = (await db.query(`select series_ended_on from public.jobs where id='${J(1)}'`)).rows[0].series_ended_on;
  const red = !hasSplit && strangerVisit.ok && leave.ok && ended !== null;
  console.log(`-- OLD STATE ${red ? "RED" : "NOT RED"}: split column=${hasSplit}; visit for a non-holder inserted=${strangerVisit.ok}; the Helpr's end_recurring_series ended the POSTER's series=${ended !== null}`);
  if (!red) fail();
  await db.close();
}

// ── LOW-1 / LOW-8: series ALREADY RUNNING when 20260927012806 deploys ───────
{
  let r, n;
  const bdb = new PGlite();
  await bdb.exec(baseSchema("20260927012804"));
  await bdb.exec(END);
  await bdb.exec(LOCK);
  const RUN = J(70), BOOKED = J(71), ODD = J(72);
  await bdb.exec(`insert into public.jobs (id, title, customer_id, status, date_needed, start_time, recurrence_days, recurrence_weeks)
    values ('${RUN}', 'Running', '${P}', 'open', ${d(1)}, '09:00', '{0,1,2,3,4,5,6}', 2),
           ('${ODD}', 'Mismatched', '${P}', 'open', ${d(1)}, '09:00', '{0,1,2,3,4,5,6}', 2)`);
  await server(bdb, HIRE(RUN, A));
  await server(bdb, HIRE(ODD, A));
  // A pre-deploy booked visit (the cron made it before holds existed).
  r = await server(bdb, `insert into public.jobs (id, title, customer_id, helper_id, status, date_needed, start_time, parent_job_id, payment_status)
    values ('${BOOKED}', 'Running', '${P}', '${A}', 'accepted', ${d(4)}, '09:00', '${RUN}', 'escrow')`);
  check("LOW-1 fixture: a visit booked before holds existed", r.ok, r.err);
  await bdb.exec(`insert into public.applications (job_id, helper_id, status) values ('${BOOKED}', '${A}', 'accepted')`);
  // LOW-8: a running series whose standing Helpr is not the one hired on the
  // parent (legacy data): the backfill cannot tell who holds its dates.
  await bdb.exec(`alter table public.jobs disable trigger user; update public.jobs set recurring_helper_id = '${B}' where id = '${ODD}'; alter table public.jobs enable trigger user;`);
  for (let i = 0; i < 3; i++) await bdb.exec(SPLIT);
  const held = (await bdb.query(`select helper_id from public.series_visit_holds where parent_job_id='${RUN}' and visit_date = ${d(4)}`)).rows;
  check("LOW-1 the backfill gives a pre-deploy booked visit's date to its Helpr", held.length === 1 && held[0].helper_id === A, JSON.stringify(held));
  r = await as(bdb, "authenticated", A, `select public.helper_cancel_booking('${BOOKED}') as v`);
  n = (await bdb.query(`select count(*)::int c from public.notifications where user_id='${P}' and job_id='${RUN}' and title='A visit date is open again'`)).rows[0].c;
  const rel = (await bdb.query(`select helper_id from public.recurring_visit_releases where parent_job_id='${RUN}' and visit_date = ${d(4)}`)).rows;
  check("LOW-1 cancelling that visit tells the poster and opens it to the series", r.ok && n === 1 && rel.length === 1 && rel[0].helper_id === A, `${r.err ?? ""} n=${n} rel=${JSON.stringify(rel)}`);
  // Nothing to release (the Helpr held no hold on the date): the poster still hears.
  const BARE = J(73);
  await server(bdb, `insert into public.series_visit_holds (parent_job_id, visit_date, helper_id) values ('${RUN}', ${d(6)}, '${A}') on conflict do nothing`);
  await server(bdb, `insert into public.jobs (id, title, customer_id, helper_id, status, date_needed, start_time, parent_job_id, payment_status)
    values ('${BARE}', 'Running', '${P}', '${A}', 'accepted', ${d(6)}, '09:00', '${RUN}', 'escrow')`);
  await bdb.exec(`delete from public.series_visit_holds where parent_job_id='${RUN}' and visit_date = ${d(6)}`);
  r = await as(bdb, "authenticated", A, `select public.helper_cancel_booking('${BARE}') as v`);
  n = (await bdb.query(`select message from public.notifications where user_id='${P}' and title='Your Helpr cancelled' and job_id='${RUN}'`)).rows;
  check("LOW-1 a series visit with nothing to release still tells the poster, with the series copy", r.ok && n.length === 1 && /offer the date/.test(n[0].message), `${r.err ?? ""} ${JSON.stringify(n)}`);
  const logs = (await bdb.query(`select severity, context from public.error_logs where context->>'parent_job_id' = '${ODD}'`)).rows;
  check("LOW-8 a running series the backfill cannot seed is logged for a person (not silently unfunded)", logs.length === 1 && logs[0].severity === "error", JSON.stringify(logs));
  const oddHolds = (await bdb.query(`select count(*)::int c from public.series_visit_holds where parent_job_id='${ODD}'`)).rows[0].c;
  check("LOW-8 ... and gets no guessed holds", oddHolds === 0, String(oddHolds));
  await bdb.close();
}

// ── NEW STATE ──────────────────────────────────────────────────────────────
const db = new PGlite();
await db.exec(baseSchema("20260927012804"));
// get_ranked_open_jobs' RETURNS TABLE names the prod enum.
await db.exec(`create type public.job_category as enum ('other')`);
for (let i = 0; i < 3; i++) {
  await db.exec(END);
  await db.exec(LOCK);
  await db.exec(SPLIT);
  await db.exec(`set check_function_bodies = off; ${VIS}; set check_function_bodies = on;`);
  await db.exec(FROM_START);
}
// PROOF_BEFORE_015010=1 puts back the discovery gates as they were before
// 20260927015010, so the vacated-visit checks below print red.
if (process.env.PROOF_BEFORE_015010) {
  for (const f of ["job_announceable_to", "notify_saved_searches_on_new_job", "deliver_saved_search_alert"]) {
    await db.exec(`set check_function_bodies = off; ${newestFunctionSql(f, "20260927015010").sql}; set check_function_bodies = on;`);
  }
}
// Just enough of the saved-search world for its funded-UPDATE trigger: X has
// a catch-all saved search, so any job that becomes open + funded queues X.
await db.exec(`
  alter table public.profiles add column email_verified boolean default true, add column latitude numeric,
    add column longitude numeric, add column parish text;
  create table public.saved_searches (id uuid primary key default gen_random_uuid(), user_id uuid, name text default 's',
    created_at timestamptz default now(), notify_enabled boolean default true, category text, parish text,
    max_budget numeric, min_budget numeric, query text, location_keyword text, radius_miles numeric, last_notified_at timestamptz);
  create table public.notification_preferences (user_id uuid primary key, job_matches boolean, match_digest_mode boolean);
  create table public.match_digest_queue (user_id uuid, job_id uuid, unique (user_id, job_id));
  create table public.saved_search_alert_queue (user_id uuid, job_id uuid, notify_at timestamptz, search_name text,
    matched_search_ids uuid[], unique (user_id, job_id));
  create function public.early_access_visible_at(uuid, timestamptz) returns timestamptz language sql stable as $f$ select now() $f$;
  create function public.miles_between(numeric, numeric, numeric, numeric) returns numeric language sql immutable as $f$ select 0::numeric $f$;
  create function public.get_user_credential_tier(uuid) returns int language sql stable as $f$ select 0 $f$;
  insert into public.saved_searches (user_id) values ('${USERS.X}');
  grant all on public.saved_searches, public.notification_preferences, public.match_digest_queue,
    public.saved_search_alert_queue to service_role;
  -- Prod: service_role=X on deliver_saved_search_alert (proacl, 2026-09-27).
  grant execute on function public.deliver_saved_search_alert(uuid, uuid, text, uuid[]) to service_role;
  create trigger trg_notify_saved_searches_funded_update after update on public.jobs for each row
    when (new.status = 'open' and new.payment_status in ('escrow','payout_pending','released')
          and (old.status is distinct from 'open' or old.payment_status is distinct from new.payment_status))
    execute function public.notify_saved_searches_on_new_job();
`);
check("migration chain applies 3x (replay-safe)", true);

// 1. Schedule parity with the TypeScript authority.
{
  let bad = 0;
  let sample = "";
  let seed = 20260925;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let i = 0; i < 400; i++) {
    const start = new Date(Date.UTC(2026, rnd(12), 1 + rnd(28), 12)).toISOString().slice(0, 10);
    const days = [...new Set(Array.from({ length: 1 + rnd(7) }, () => rnd(7)))];
    const weeks = 1 + rnd(56); // past the 52 cap on purpose
    const ts = recurringVisitDates(start, days, weeks);
    const sql = (await db.query(`select coalesce(array_agg(d::text order by d), '{}') a from public.series_visit_dates('${start}', '{${days.join(",")}}'::smallint[], ${weeks}) d`)).rows[0].a;
    if (JSON.stringify(ts) !== JSON.stringify(sql)) { bad++; sample ||= `${start} ${days} ${weeks}: ${ts.length} vs ${sql.length}`; }
  }
  check("series_visit_dates matches recurringVisitDates on 400 random schedules", bad === 0, sample);
}

// 2. The choice at posting, locked after hire.
let r = await as(db, "authenticated", P, `insert into public.jobs (id, title, customer_id, date_needed, start_time, recurrence_days, recurrence_weeks, series_split_ok)
  values ('${J(2)}', 'split series', '${P}', ${d(3)}, '09:00', '{0,1,2,3,4,5,6}', 3, true)`);
check("the poster chooses split days at posting (client insert)", r.ok, r.err);
r = await as(db, "authenticated", P, `update public.jobs set series_split_ok = false where id='${J(2)}'`);
check("the poster can change the choice before anyone is hired", r.ok && r.affected === 1, r.err);
await as(db, "authenticated", P, `update public.jobs set series_split_ok = true where id='${J(2)}'`);
r = await server(db, HIRE(J(2), A));
check("server hire of the first Helpr", r.ok, r.err);
r = await as(db, "authenticated", P, `update public.jobs set series_split_ok = false where id='${J(2)}'`);
check("the choice is locked once a Helpr is hired", refused(r, /series_locked/), r.err);
r = await as(db, "authenticated", X, `select series_split_ok, recurrence_days, recurrence_weeks from public.open_jobs_browse limit 1`);
check("open_jobs_browse projects series_split_ok, recurrence_days, recurrence_weeks", r.ok, r.err);

// 3. Hire: split -> an offer for the first Helpr; one person -> every future date.
let n = (await db.query(`select count(*)::int c from public.series_date_offers where parent_job_id='${J(2)}' and helper_id='${A}'`)).rows[0].c;
check("split: the first hired Helpr gets an offer to pick dates", n === 1, String(n));
check("split: no dates are held until picked", (await dates(db, J(2))).length === 0);
n = (await db.query(`select count(*)::int c from public.notifications where user_id='${A}' and job_id='${J(2)}' and title='Pick your visit dates'`)).rows[0].c;
check("split: the first Helpr is told to pick dates", n === 1, String(n));

await db.exec(SERIES(J(3), false, "one-person series"));
await server(db, HIRE(J(3), A));
const expectAll = (await db.query(`select count(*)::int c from public.series_visit_dates(${d(3)}, '{0,1,2,3,4,5,6}', 3) d where d > ${d(3)}`)).rows[0].c;
let held = await dates(db, J(3));
check("one person: the hired Helpr holds every date after visit one", held.length === expectAll && held.every((h) => h.helper_id === A), `${held.length} of ${expectAll}`);

// 4. The first Helpr picks dates.
const D5 = await dateAt(db, 5), D6 = await dateAt(db, 6), D7 = await dateAt(db, 7), D8 = await dateAt(db, 8), D9 = await dateAt(db, 9);
r = await as(db, "authenticated", A, `select public.claim_series_dates('${J(2)}', array[${d(5)}, ${d(6)}, ${d(-1)}, ${d(3)}]) as v`);
check("the first Helpr claims open dates; a past date and visit one are refused",
  r.ok && JSON.stringify(r.rows[0].v.claimed) === JSON.stringify([D5, D6]) && r.rows[0].v.refused.length === 2, r.err ?? JSON.stringify(r.rows?.[0]));
n = (await db.query(`select message from public.notifications where user_id='${P}' and job_id='${J(2)}' and title like 'Visit dates were picked up'`)).rows;
check("the poster is told who took which dates", n.length === 1 && /User 2 took/.test(n[0].message), JSON.stringify(n));

// LOW-6: a double tap reports the caller's own dates as theirs, not "taken".
r = await as(db, "authenticated", A, `select public.claim_series_dates('${J(2)}', array[${d(5)}, ${d(6)}]) as v`);
check("a second claim of your own dates says already_yours, not taken",
  r.ok && JSON.stringify(r.rows[0].v.already_yours) === JSON.stringify([D5, D6]) && r.rows[0].v.taken.length === 0 && r.rows[0].v.claimed.length === 0,
  r.err ?? JSON.stringify(r.rows?.[0]));

// 5. The poster offers the rest to someone who applied.
r = await as(db, "authenticated", P, `select public.offer_series_dates('${J(2)}', '${B}') as v`);
check("an offer needs a pending application", refused(r, /not_an_applicant/), r.err);
await server(db, `insert into public.applications (job_id, helper_id) values ('${J(2)}', '${B}'), ('${J(2)}', '${C}')`);
r = await as(db, "authenticated", A, `select public.offer_series_dates('${J(2)}', '${B}') as v`);
check("only the poster offers dates", refused(r, /not_authorized/), r.err);
r = await as(db, "authenticated", P, `select public.offer_series_dates('${J(2)}', '${B}') as v`);
check("the poster offers the open dates to B", r.ok && r.rows[0].v.open_dates > 0, r.err);
n = (await db.query(`select count(*)::int c from public.notifications where user_id='${B}' and title='Visit dates offered to you'`)).rows[0].c;
check("B is told about the offer", n === 1, String(n));
r = await as(db, "authenticated", X, `select public.claim_series_dates('${J(2)}', array[${d(7)}]) as v`);
check("a stranger (no offer, no dates) cannot claim", refused(r, /not_authorized/), r.err);
r = await as(db, "authenticated", B, `select public.claim_series_dates('${J(2)}', array[${d(5)}, ${d(7)}, ${d(8)}]) as v`);
check("B gets the open dates; A's date is taken", r.ok && JSON.stringify(r.rows[0].v.claimed) === JSON.stringify([D7, D8]) && JSON.stringify(r.rows[0].v.taken) === JSON.stringify([D5]), r.err ?? JSON.stringify(r.rows?.[0]));

// 6. Give up, and the pick-up rule (owner addendum).
await server(db, `insert into public.jobs (id, title, customer_id, status, date_needed, start_time, recurrence_days, recurrence_weeks, series_split_ok) values ('${J(9)}', 'no', '${X}', 'open', ${d(3)}, '09:00', '{1}', 3, true)`);
r = await as(db, "authenticated", A, `select public.give_up_series_dates('${J(2)}', array[${d(7)}]) as v`);
check("a Helpr cannot give up someone else's date", refused(r, /not_your_dates/), r.err);
r = await as(db, "authenticated", A, `select public.give_up_series_dates('${J(2)}', array[${d(6)}]) as v`);
check("A gives up a date more than 24h out: released, no strike", r.ok && JSON.stringify(r.rows[0].v.released) === JSON.stringify([D6]) && r.rows[0].v.strike === false, r.err ?? JSON.stringify(r.rows?.[0]));
n = (await db.query(`select count(*)::int c from public.strikes where user_id='${A}'`)).rows[0].c;
check("no strike recorded", n === 0, String(n));
n = (await db.query(`select helper_id from public.recurring_visit_releases where parent_job_id='${J(2)}' and visit_date=${d(6)}`)).rows;
check("the release is recorded (who gave it up)", n.length === 1 && n[0].helper_id === A, JSON.stringify(n));
n = (await db.query(`select user_id, title from public.notifications where job_id='${J(2)}' and title in ('A visit date is open again', 'A date opened up — pick it up') order by user_id`)).rows;
check("the poster is told, and the other Helpr on the series gets 'A date opened up — pick it up'",
  n.length === 2 && n.some((x) => x.user_id === P) && n.some((x) => x.user_id === B && x.title === "A date opened up — pick it up"), JSON.stringify(n));
r = await as(db, "authenticated", A, `select public.claim_series_dates('${J(2)}', array[${d(6)}]) as v`);
check("the one who gave it up cannot take it back", r.ok && r.rows[0].v.claimed.length === 0 && r.rows[0].v.refused.length === 1, r.err ?? JSON.stringify(r.rows?.[0]));
// C is on the series only through an offer; make C a date-holding Helpr via an offer + claim first.
await as(db, "authenticated", P, `select public.offer_series_dates('${J(2)}', '${C}')`);
r = await as(db, "authenticated", C, `select public.claim_series_dates('${J(2)}', array[${d(9)}]) as v`);
check("C (offered) claims a date", r.ok && r.rows[0].v.claimed.length === 1, r.err ?? JSON.stringify(r.rows?.[0]));

// THE TWO-CLAIMERS RACE: B and C both on the series, both go for the released
// date. claim_series_dates locks the parent FOR UPDATE and the hold is the
// primary key, so the first to commit wins and the second gets `taken`
// (PGlite is one backend: the two calls serialise here exactly as the row lock
// serialises them on Postgres).
const first = await as(db, "authenticated", B, `select public.claim_series_dates('${J(2)}', array[${d(6)}]) as v`);
const second = await as(db, "authenticated", C, `select public.claim_series_dates('${J(2)}', array[${d(6)}]) as v`);
held = (await dates(db, J(2))).filter((h) => h.d === D6);
check("race: exactly one winner holds the date", held.length === 1 && held[0].helper_id === B, JSON.stringify(held));
check("race: the loser is told `taken`, not an error", second.ok && JSON.stringify(second.rows[0].v.taken) === JSON.stringify([D6]) && first.rows[0].v.claimed.length === 1, second.err ?? JSON.stringify(second.rows?.[0]));
n = (await db.query(`select count(*)::int c from public.recurring_visit_releases where parent_job_id='${J(2)}' and visit_date=${d(6)}`)).rows[0].c;
check("a picked-up date is no longer released", n === 0, String(n));
r = await server(db, `insert into public.series_visit_holds (parent_job_id, visit_date, helper_id) values ('${J(2)}', ${d(6)}, '${C}')`);
check("the hold is a primary key: a second holder cannot exist", refused(r, /duplicate key|unique/), r.err);

// 7. The charge follows the holder.
r = await server(db, `insert into public.jobs (title, customer_id, helper_id, status, date_needed, parent_job_id) values ('v', '${P}', '${A}', 'accepted', ${d(6)}, '${J(2)}')`);
check("a visit for someone who does not hold the date is refused", refused(r, /series_date_unheld/), r.err);
r = await server(db, `insert into public.jobs (title, customer_id, helper_id, status, date_needed, parent_job_id) values ('v', '${P}', '${B}', 'accepted', ${d(6)}, '${J(2)}')`);
check("a visit for the holder inserts", r.ok, r.err);
r = await server(db, `insert into public.jobs (title, customer_id, helper_id, status, date_needed, parent_job_id) values ('v', '${P}', '${A}', 'accepted', ${d(4)}, '${J(2)}')`);
check("an unheld date gets no visit (not charged)", refused(r, /series_date_unheld/), r.err);
r = await as(db, "authenticated", B, `select public.give_up_series_dates('${J(2)}', array[${d(6)}]) as v`);
check("a date with a visit already created is not given up here (cancel it from its card)", refused(r, /not_your_dates/), r.err);

// 8. The 24-hour strike. Visit one today; the series' start time two hours
// BEFORE now (Chicago), so tomorrow's visit starts in ~22 hours (00:00 when
// now is before 02:00, still under 24 hours).
await db.exec(SERIES(J(4), false, "tomorrow series"));
// Chicago's today, not the server's (UTC) current_date: from 18:00 CST /
// 19:00 CDT they differ and "tomorrow" was two days out.
await db.exec(`update public.jobs set date_needed = (now() at time zone 'America/Chicago')::date,
  start_time = case when extract(hour from (now() at time zone 'America/Chicago')) >= 2
                    then ((now() at time zone 'America/Chicago') - interval '2 hours')::time else '00:00'::time end
  where id='${J(4)}'`);
await server(db, HIRE(J(4), C));
const tomorrow = (await db.query(`select min(visit_date)::text d from public.series_visit_holds where parent_job_id='${J(4)}'`)).rows[0].d;
const startsIn = Number((await db.query(`select extract(epoch from ((('${tomorrow}'::date + j.start_time) at time zone 'America/Chicago') - now()))/3600 h from public.jobs j where j.id='${J(4)}'`)).rows[0].h);
r = await as(db, "authenticated", C, `select public.give_up_series_dates('${J(4)}', array['${tomorrow}'::date]) as v`);
check("giving up a date that starts within 24 hours is a strike", startsIn < 24 && r.ok && r.rows[0].v.strike === true, `${r.err ?? JSON.stringify(r.rows?.[0])}; starts in ${startsIn.toFixed(1)}h`);
n = (await db.query(`select count(*)::int c from public.strikes where user_id='${C}'`)).rows[0].c;
check("exactly one strike recorded through the existing ladder", n === 1, String(n));
const later = (await db.query(`select min(visit_date)::text d from public.series_visit_holds where parent_job_id='${J(4)}' and helper_id='${C}' and visit_date > current_date + 2`)).rows[0].d;
r = await as(db, "authenticated", C, `select public.give_up_series_dates('${J(4)}', array['${later}'::date]) as v`);
n = (await db.query(`select count(*)::int c from public.strikes where user_id='${C}'`)).rows[0].c;
check("a date more than 24 hours out is no strike", r.ok && r.rows[0].v.strike === false && n === 1, r.err ?? JSON.stringify(r.rows?.[0]));

// 9. A Helpr leaving the series: their dates go back, the poster's series runs on.
r = await as(db, "authenticated", B, `select public.end_recurring_series('${J(2)}') as v`);
check("a Helpr's end_recurring_series LEAVES (hands dates back)", r.ok && r.rows[0].v.action === "left" && r.rows[0].v.released.length >= 1, r.err ?? JSON.stringify(r.rows?.[0]));
n = (await db.query(`select series_ended_on from public.jobs where id='${J(2)}'`)).rows[0].series_ended_on;
check("... and does not end the poster's series", n === null, String(n));
held = (await dates(db, J(2))).filter((h) => h.helper_id === B && h.d > D6);
check("... B holds no future uncreated date any more", held.length === 0, JSON.stringify(held));
r = await as(db, "authenticated", X, `select public.end_recurring_series('${J(2)}') as v`);
check("a stranger cannot end or leave", refused(r, /not_authorized/), r.err);

// 10. The standing Helpr leaving the parent (visit one) hands back their dates.
await server(db, `update public.jobs set helper_id = null, status = 'open', helper_confirmed_at = null where id='${J(3)}'`);
held = await dates(db, J(3));
n = (await db.query(`select count(*)::int c from public.recurring_visit_releases where parent_job_id='${J(3)}'`)).rows[0].c;
check("the one-person Helpr leaving the parent releases every future date", held.length === 0 && n === expectAll, `${held.length} held, ${n} released`);
await server(db, HIRE(J(3), B));
held = await dates(db, J(3));
n = (await db.query(`select count(*)::int c from public.recurring_visit_releases where parent_job_id='${J(3)}'`)).rows[0].c;
check("a new one-person hire takes every open date back", held.length === expectAll && held.every((h) => h.helper_id === B) && n === 0, `${held.length} held, ${n} released`);

// 10b. A booked (funded) visit given up from its card goes back to the SERIES.
{
  const V = J(20);
  const D12 = await dateAt(db, 12);
  r = await server(db, `insert into public.jobs (id, title, customer_id, helper_id, status, date_needed, start_time, parent_job_id, payment_status)
    values ('${V}', 'one-person series', '${P}', '${B}', 'accepted', ${d(12)}, '09:00', '${J(3)}', 'escrow')`);
  check("the cron's visit insert for the holder", r.ok, r.err);
  await server(db, `insert into public.applications (job_id, helper_id, status) values ('${V}', '${B}', 'accepted')`);
  r = await as(db, "authenticated", B, `select public.helper_cancel_booking('${V}') as v`);
  check("the Helpr cancels a series visit more than 24h out: no strike", r.ok && r.rows[0].v.action === "none", r.err ?? JSON.stringify(r.rows?.[0]));
  n = (await db.query(`select count(*)::int c from public.strikes where user_id='${B}'`)).rows[0].c;
  check("... nothing recorded on the ladder", n === 0, String(n));
  const vrow = (await db.query(`select status::text, helper_id from public.jobs where id='${V}'`)).rows[0];
  check("the visit row is vacated (still funded)", vrow.status === "open" && vrow.helper_id === null, JSON.stringify(vrow));
  n = (await db.query(`select helper_id from public.series_visit_holds where parent_job_id='${J(3)}' and visit_date=${d(12)}`)).rows;
  check("the Helpr's hold on that date is released", n.length === 0, JSON.stringify(n));
  n = (await db.query(`select count(*)::int c from public.notifications where user_id='${P}' and job_id='${J(3)}' and title='A visit date is open again'`)).rows[0].c;
  check("the poster is told the date is back on the series (not 'open to everyone')", n >= 1, String(n));
  r = await as(db, "authenticated", X, `select count(*)::int c from public.open_jobs_browse where id='${V}'`);
  check("a vacated series visit is not in the public browse view", r.ok && r.rows[0].c === 0, r.err ?? JSON.stringify(r.rows?.[0]));
  // authz HIGH / scheduling MEDIUM-1: the vacated visit is not public work on
  // any surface, and nobody but the series' own claim can take it.
  r = await server(db, `select public.job_announceable_to(j, '${X}') as v from public.jobs j where j.id='${V}'`);
  check("HIGH a vacated series visit is not announceable (parish match, digest, instant match)", r.ok && r.rows[0].v === false, r.err ?? JSON.stringify(r.rows?.[0]));
  n = (await db.query(`select count(*)::int c from public.saved_search_alert_queue where job_id='${V}'`)).rows[0].c;
  check("HIGH a vacated series visit queues no saved-search alert (the funded-UPDATE trigger fired)", n === 0, String(n));
  // Control: the same trigger DOES queue a plain one-time job that reopens.
  const PLAIN = J(40);
  await server(db, `insert into public.jobs (id, title, customer_id, helper_id, status, date_needed, start_time, payment_status)
    values ('${PLAIN}', 'plain', '${P}', '${A}', 'accepted', ${d(30)}, '09:00', 'escrow')`);
  await server(db, `update public.jobs set helper_id = null, status = 'open' where id='${PLAIN}'`);
  n = (await db.query(`select count(*)::int c from public.saved_search_alert_queue where job_id='${PLAIN}' and user_id='${X}'`)).rows[0].c;
  check("control: a one-time job reopening while funded does queue the saved search", n === 1, String(n));
  r = await server(db, `select public.deliver_saved_search_alert('${X}', '${V}', 's', array(select id from public.saved_searches where user_id='${X}')) as v`);
  check("HIGH ... and an alert already queued for it is dropped at send time", r.ok && r.rows[0].v === false, r.err ?? JSON.stringify(r.rows?.[0]));
  r = await as(db, "authenticated", X, `insert into public.applications (job_id, helper_id) values ('${V}', '${X}')`);
  check("HIGH a client cannot apply to a vacated series visit", refused(r, /series_visit_not_open/), r.err);
  r = await server(db, `update public.jobs set helper_id='${X}', status='accepted' where id='${V}'`);
  check("HIGH even a server write cannot put a non-holder on a series visit", refused(r, /series_date_unheld/), r.err);
  await server(db, `insert into public.applications (job_id, helper_id) values ('${J(3)}', '${C}')`);
  r = await as(db, "authenticated", P, `select public.offer_series_dates('${J(3)}', '${C}') as v`);
  check("the poster can offer the vacated date", r.ok && r.rows[0].v.open_dates >= 1, r.err ?? JSON.stringify(r.rows?.[0]));
  r = await as(db, "authenticated", C, `select public.claim_series_dates('${J(3)}', array[${d(12)}]) as v`);
  check("the offered Helpr takes the vacated visit", r.ok && JSON.stringify(r.rows[0].v.claimed) === JSON.stringify([D12]), r.err ?? JSON.stringify(r.rows?.[0]));
  const taken = (await db.query(`select status::text, helper_id from public.jobs where id='${V}'`)).rows[0];
  check("... the funded visit row is reassigned to them (escrow and payout follow helper_id)", taken.status === "accepted" && taken.helper_id === C, JSON.stringify(taken));
  n = (await db.query(`select status from public.applications where job_id='${V}' and helper_id='${C}'`)).rows;
  check("... with an accepted application row", n.length === 1 && n[0].status === "accepted", JSON.stringify(n));
  // MEDIUM-1: the takeover's application bypass is the claim's alone.
  r = await as(db, "authenticated", X, `insert into public.applications (job_id, helper_id) values ('${V}', '${X}')`);
  check("a client cannot apply to the booked visit (the claim's flag is not theirs)", refused(r, /series_visit_not_open/), r.err);
  // Within 24 hours: the strike applies to a series visit too.
  const W = J(21);
  await server(db, `insert into public.series_visit_holds (parent_job_id, visit_date, helper_id) values ('${J(4)}', current_date + 20, '${C}') on conflict do nothing`);
  r = await server(db, `insert into public.jobs (id, title, customer_id, helper_id, status, date_needed, start_time, parent_job_id)
    values ('${W}', 'soon visit', '${P}', '${C}', 'accepted', current_date + 20, '09:00', '${J(4)}')`);
  await server(db, `update public.jobs set date_needed = (now() at time zone 'America/Chicago' + interval '3 hours')::date,
    start_time = (now() at time zone 'America/Chicago' + interval '3 hours')::time where id='${W}'`);
  const before = (await db.query(`select count(*)::int c from public.strikes where user_id='${C}'`)).rows[0].c;
  r = await as(db, "authenticated", C, `select public.helper_cancel_booking('${W}') as v`);
  n = (await db.query(`select count(*)::int c from public.strikes where user_id='${C}'`)).rows[0].c;
  check("cancelling a series visit within 24h IS a strike", r.ok && n === before + 1, r.err ?? `${before} -> ${n}`);
  // A one-time job: the same 24-hour rule (owner decision Q407 (11)).
  const O = J(22);
  await server(db, `insert into public.jobs (id, title, customer_id, helper_id, status, date_needed, start_time) values ('${O}', 'one-off', '${P}', '${A}', 'accepted', current_date + 20, '09:00')`);
  await db.exec(`update public.profiles set ban_status = 'active' where user_id = '${A}'`);
  const aBefore = (await db.query(`select count(*)::int c from public.strikes where user_id='${A}'`)).rows[0].c;
  r = await as(db, "authenticated", A, `select public.helper_cancel_booking('${O}') as v`);
  n = (await db.query(`select count(*)::int c from public.strikes where user_id='${A}'`)).rows[0].c;
  check("a one-time job cancelled 20 days out is NO strike (Q407 11)", r.ok && n === aBefore && r.rows[0].v.action === "none", r.err ?? `${aBefore} -> ${n}`);
  const O2 = J(23);
  await server(db, `insert into public.jobs (id, title, customer_id, helper_id, status, date_needed, start_time) values ('${O2}', 'one-off soon', '${P}', '${A}', 'accepted',
    (now() at time zone 'America/Chicago' + interval '3 hours')::date, (now() at time zone 'America/Chicago' + interval '3 hours')::time)`);
  r = await as(db, "authenticated", A, `select public.helper_cancel_booking('${O2}') as v`);
  n = (await db.query(`select count(*)::int c from public.strikes where user_id='${A}'`)).rows[0].c;
  check("a one-time job cancelled within 24h IS a strike", r.ok && n === aBefore + 1, r.err ?? `${aBefore} -> ${n}`);
  n = (await db.query(`select count(*)::int c from public.notifications where user_id='${P}' and title='Your Helpr cancelled' and message like '%open to everyone again%'`)).rows[0].c;
  check("... and the poster of a one-time job gets the single-job notice", n === 2, String(n));
}

// 10c. An uncreated date the cron can no longer fund is not claimable.
{
  const tooSoon = (await db.query(`select (current_date + 1) < ((now() at time zone 'UTC')::date + case when (now() at time zone 'UTC')::time < '05:30' then 1 else 2 end) as x`)).rows[0].x;
  await server(db, `insert into public.applications (job_id, helper_id) values ('${J(4)}', '${B}') on conflict do nothing`);
  await as(db, "authenticated", P, `select public.offer_series_dates('${J(4)}', '${B}')`);
  await server(db, `delete from public.series_visit_holds where parent_job_id='${J(4)}' and visit_date = current_date + 1`);
  // 10b's "soon visit" W lands on this date when Chicago's now + 3h crosses
  // midnight; this check is about a date with NO visit row, so clear it.
  await db.exec(`delete from public.applications where job_id in (select id from public.jobs where parent_job_id='${J(4)}' and date_needed = current_date + 1)`);
  await db.exec(`delete from public.jobs where parent_job_id='${J(4)}' and date_needed = current_date + 1`);
  r = await as(db, "authenticated", B, `select public.claim_series_dates('${J(4)}', array[current_date + 1]) as v`);
  check(`an uncreated date past its last funding run is refused (tooSoon=${tooSoon})`,
    r.ok && (tooSoon ? r.rows[0].v.refused.length === 1 : r.rows[0].v.claimed.length === 1), r.err ?? JSON.stringify(r.rows?.[0]));
}

// 11. The poster ends: everyone on the series is told; no new visit.
r = await as(db, "authenticated", P, `select public.end_recurring_series('${J(2)}') as v`);
check("the poster ends the split series", r.ok && r.rows[0].v.action === "ended", r.err);
n = (await db.query(`select distinct user_id from public.notifications where job_id='${J(2)}' and title='Recurring series ended'`)).rows.map((x) => x.user_id).sort();
// B left but still holds the date whose visit was created (booked), so B is on
// the series and is told too.
check("every Helpr still on the series is told (a booked visit counts)", JSON.stringify(n) === JSON.stringify([A, B, C].sort()), JSON.stringify(n));
r = await as(db, "authenticated", C, `select public.claim_series_dates('${J(2)}', array[${d(10)}]) as v`);
check("no claim after the series ended", refused(r, /series_ended/), r.err);

// 11b. Authz review LOW: a non-party is refused before the row lock, with one
// answer whether the id is a series, a visit, or nothing at all.
for (const fn of ["claim_series_dates('ID', array[current_date + 5])", "give_up_series_dates('ID', array[current_date + 5])", "end_recurring_series('ID')"]) {
  for (const [label, id] of [["an unknown id", "a0000000-0000-0000-0000-00000000ffff"], ["someone else's visit", J(20)], ["someone else's series", J(3)]]) {
    r = await as(db, "authenticated", X, `select public.${fn.replace("ID", id)} as v`);
    check(`LOW a non-party calling ${fn.split("(")[0]} on ${label} gets not_authorized`, refused(r, /not_authorized/) && !/job_not_found|not_a_series/.test(r.err ?? ""), r.err);
  }
}

// 11c. Authz review MEDIUM: a split series whose visit-one Helpr left still has
// Helprs holding dates; its schedule is theirs too, though the parent's
// helper_id is null.
{
  await db.exec(SERIES(J(6), true, "split, visit-one Helpr gone"));
  await server(db, `insert into public.series_visit_holds (parent_job_id, visit_date, helper_id) values ('${J(6)}', ${d(8)}, '${B}')`);
  for (const [col, val] of [["recurrence_weeks", "5"], ["date_needed", d(4)], ["series_split_ok", "false"], ["recurrence_days", "'{1,3}'"]]) {
    r = await as(db, "authenticated", P, `update public.jobs set ${col} = ${val} where id='${J(6)}'`);
    check(`MEDIUM the poster cannot change ${col} while a Helpr holds a date (parent helper_id null)`, refused(r, /series_locked/), r.err ?? `affected ${r.affected}`);
  }
  await db.exec(SERIES(J(7), true, "split, nobody yet"));
  r = await as(db, "authenticated", P, `update public.jobs set recurrence_weeks = 5 where id='${J(7)}'`);
  check("control: with no hold and no hire the poster can still change the schedule", r.ok && r.affected === 1, r.err);
}

// 11d. Scheduling review MEDIUM-2: a vacated visit is judged by its own local
// start, not the calendar day.
{
  const hourNow = Number((await db.query(`select extract(hour from (now() at time zone 'America/Chicago'))::int h`)).rows[0].h);
  const mk = async (id, child, startExpr) => {
    await db.exec(`insert into public.jobs (id, title, customer_id, status, date_needed, start_time, recurrence_days, recurrence_weeks, series_split_ok)
      values ('${id}', 'same-day', '${P}', 'open', (now() at time zone 'America/Chicago')::date - 7, '09:00', '{0,1,2,3,4,5,6}', 3, true)`);
    // Booked for its holder, then vacated (as helper_cancel_booking leaves it).
    await server(db, `insert into public.series_visit_holds (parent_job_id, visit_date, helper_id) values ('${id}', (now() at time zone 'America/Chicago')::date, '${A}')`);
    let ins = await server(db, `insert into public.jobs (id, title, customer_id, helper_id, status, date_needed, start_time, parent_job_id, payment_status)
      values ('${child}', 'same-day', '${P}', '${A}', 'accepted', (now() at time zone 'America/Chicago')::date, ${startExpr}, '${id}', 'escrow')`);
    if (ins.ok) ins = await server(db, `update public.jobs set helper_id = null, status = 'open' where id='${child}'`);
    if (ins.ok) ins = await server(db, `delete from public.series_visit_holds where parent_job_id='${id}'`);
    check(`MEDIUM-2 fixture: the vacated same-day visit ${child.slice(-2)} exists`, ins.ok, ins.err);
    await server(db, `insert into public.applications (job_id, helper_id) values ('${id}', '${B}')`);
    await as(db, "authenticated", P, `select public.offer_series_dates('${id}', '${B}')`);
    return as(db, "authenticated", B, `select public.claim_series_dates('${id}', array[(now() at time zone 'America/Chicago')::date]) as v`);
  };
  // Later today: now + 3h, capped at 23:59 so it stays on today's date.
  const lateOk = (await db.query(`select (now() at time zone 'America/Chicago')::time < '23:55' as x`)).rows[0].x;
  if (lateOk) {
    r = await mk(J(30), J(31), `least((now() at time zone 'America/Chicago') + interval '3 hours',
      date_trunc('day', now() at time zone 'America/Chicago') + interval '23 hours 59 minutes')::time`);
    check("MEDIUM-2 a visit vacated today with a start later today can be picked up", r.ok && r.rows[0].v.claimed.length === 1, r.err ?? JSON.stringify(r.rows?.[0]));
  } else check("MEDIUM-2 later-today case skipped after 23:55 Chicago (no later start exists today)", true);
  if (hourNow >= 3) {
    r = await mk(J(32), J(33), `((now() at time zone 'America/Chicago') - interval '2 hours')::time`);
    check("MEDIUM-2 a vacated visit whose start has passed cannot", r.ok && r.rows[0].v.claimed.length === 0 && r.rows[0].v.refused.length === 1, r.err ?? JSON.stringify(r.rows?.[0]));
  } else check("MEDIUM-2 passed-start case skipped before 03:00 Chicago", true);
}

// 12. Grants and ban.
r = await as(db, "authenticated", A, `insert into public.series_visit_holds (parent_job_id, visit_date, helper_id) values ('${J(2)}', ${d(12)}, '${A}')`);
check("clients cannot write holds directly", refused(r, /permission denied/), r.err);
r = await as(db, "authenticated", A, `insert into public.recurring_visit_releases (parent_job_id, visit_date, helper_id) values ('${J(2)}', ${d(12)}, '${A}')`);
check("clients cannot write releases directly any more", refused(r, /permission denied/), r.err);
r = await as(db, "authenticated", X, `select count(*)::int c from public.series_visit_holds where parent_job_id='${J(2)}'`);
check("a stranger reads no holds (RLS)", r.ok && r.rows[0].c === 0, r.err ?? JSON.stringify(r.rows?.[0]));
r = await as(db, "authenticated", P, `select count(*)::int c from public.series_visit_holds where parent_job_id='${J(2)}'`);
check("the poster reads the holds", r.ok && r.rows[0].c > 0, r.err ?? JSON.stringify(r.rows?.[0]));
for (const fn of ["claim_series_dates('${J(2)}', array[current_date])", "offer_series_dates('${J(2)}', '${B}')", "give_up_series_dates('${J(2)}', array[current_date])"]) {
  r = await as(db, "anon", null, `select public.${fn.replaceAll("${J(2)}", J(2)).replaceAll("${B}", B)}`);
  check(`anon cannot execute ${fn.split("(")[0]}`, refused(r, /permission denied/), r.err);
}
for (const fn of ["series_release_dates(uuid, uuid, date[], text, text, uuid)", "series_give_up_strike(uuid, uuid, date[])"]) {
  r = await as(db, "authenticated", A, `select has_function_privilege('authenticated', 'public.${fn}', 'execute') as x`);
  check(`authenticated cannot execute the internal ${fn.split("(")[0]}`, r.ok && r.rows[0].x === false, r.err);
}
// LOW-2: no client can ask whether SOMEONE ELSE is on a series or crew.
r = await as(db, "authenticated", X, `select to_regprocedure('public.is_series_party(uuid,uuid)') is null as gone`);
check("is_series_party takes no caller-chosen user (the 2-arg probe is gone)", r.ok && r.rows[0].gone === true, r.err ?? JSON.stringify(r.rows));
r = await as(db, "authenticated", X, `select public.is_series_party('${J(2)}') as v`);
check("... a stranger asking about a series gets false", r.ok && r.rows[0].v === false, r.err ?? JSON.stringify(r.rows));
r = await as(db, "authenticated", P, `select public.is_series_party('${J(2)}') as v`);
check("... its poster gets true (the RLS policies still work)", r.ok && r.rows[0].v === true, r.err ?? JSON.stringify(r.rows));
await server(db, `insert into public.jobs (id, title, customer_id, status, date_needed, is_group_job, helpers_needed) values ('${J(60)}', 'crew', '${P}', 'open', current_date + 9, true, 2)`);
await db.exec(`insert into public.group_job_helpers (job_id, helper_id) values ('${J(60)}', '${A}')`);
r = await as(db, "authenticated", X, `select public.job_has_crew('${J(60)}') as v`);
check("job_has_crew tells a stranger nothing about someone else's job", r.ok && r.rows[0].v === false, r.err ?? JSON.stringify(r.rows));
r = await as(db, "authenticated", P, `select public.job_has_crew('${J(60)}') as v`);
check("... its poster (whose writes the schedule lock judges) gets the answer", r.ok && r.rows[0].v === true, r.err ?? JSON.stringify(r.rows));

await db.exec(SERIES(J(5), true, "ban series"));
await server(db, HIRE(J(5), A));
await db.exec(`update public.profiles set ban_status = 'permanently_banned' where user_id = '${A}'`);
r = await as(db, "authenticated", A, `select public.claim_series_dates('${J(5)}', array[${d(5)}]) as v`);
check("a banned Helpr cannot claim", refused(r, /account_restricted/), r.err);

await db.close();
console.log(failures() ? `\n${failures()} FAILED` : "\nALL PASS");
process.exit(failures() ? 1 : 0);
