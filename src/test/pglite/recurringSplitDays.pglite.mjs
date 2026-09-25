#!/usr/bin/env node
/**
 * PGlite proof for 20260925160645_recurring_split_days (docs/OPEN.md Q407 (4),
 * (5), (6) and the pick-up addendum).
 *
 *   PGLITE_DIR=~/.lh-pglite-probe node src/test/pglite/recurringSplitDays.pglite.mjs
 *
 * World: src/test/pglite/seriesWorld.mjs (the real trigger chain on jobs, read
 * from the newest migrations). The migration chain under test,
 * 20260925052841, 20260925160644 and 20260925160645, is applied verbatim
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
import { PGlite, readMigration, baseSchema, as, checker, refused, USERS } from "./seriesWorld.mjs";

const END = readMigration("20260925052841_recurring_series_end.sql");
const LOCK = readMigration("20260925160644_hired_job_schedule_lock.sql");
const SPLIT = readMigration("20260925160645_recurring_split_days.sql");
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
  await db.exec(baseSchema("20260925052841"));
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

// ── NEW STATE ──────────────────────────────────────────────────────────────
const db = new PGlite();
await db.exec(baseSchema("20260925052841"));
for (let i = 0; i < 3; i++) {
  await db.exec(END);
  await db.exec(LOCK);
  await db.exec(SPLIT);
}
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
await db.exec(`update public.jobs set date_needed = current_date,
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
  check("a client cannot apply to the booked visit (the claim's flag is not theirs)", refused(r, /job_not_open/), r.err);
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
  n = (await db.query(`select count(*)::int c from public.notifications where user_id='${P}' and title='Your Helpr cancelled'`)).rows[0].c;
  check("... and the poster of a one-time job gets the single-job notice", n === 2, String(n));
}

// 10c. An uncreated date the cron can no longer fund is not claimable.
{
  const tooSoon = (await db.query(`select (current_date + 1) < ((now() at time zone 'UTC')::date + case when (now() at time zone 'UTC')::time < '05:30' then 1 else 2 end) as x`)).rows[0].x;
  await server(db, `insert into public.applications (job_id, helper_id) values ('${J(4)}', '${B}') on conflict do nothing`);
  await as(db, "authenticated", P, `select public.offer_series_dates('${J(4)}', '${B}')`);
  await server(db, `delete from public.series_visit_holds where parent_job_id='${J(4)}' and visit_date = current_date + 1`);
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
await db.exec(SERIES(J(5), true, "ban series"));
await server(db, HIRE(J(5), A));
await db.exec(`update public.profiles set ban_status = 'permanently_banned' where user_id = '${A}'`);
r = await as(db, "authenticated", A, `select public.claim_series_dates('${J(5)}', array[${d(5)}]) as v`);
check("a banned Helpr cannot claim", refused(r, /account_restricted/), r.err);

await db.close();
console.log(failures() ? `\n${failures()} FAILED` : "\nALL PASS");
process.exit(failures() ? 1 : 0);
