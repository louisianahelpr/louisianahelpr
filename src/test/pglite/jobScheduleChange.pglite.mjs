#!/usr/bin/env node
/**
 * PGlite proof for 20260927012807_job_schedule_change_requests (owner decision
 * Q407 (8), finalised 2026-09-25).
 *
 *   PGLITE_DIR=~/.lh-pglite-probe node src/test/pglite/jobScheduleChange.pglite.mjs
 *
 * World: seriesWorld.mjs (the real jobs trigger chain from the newest
 * migrations, the helper column whitelist included). Chain under test:
 * 20260927012804, 20260927012805, 20260927012806, 20260927012807,
 * 20261002060514 (Q736 clash check), 20261004004707 (Q925 accept re-check), 3x.
 *
 * OLD STATE (20260927012804 only): the poster moves a booked one-time job's
 * date with a plain PATCH (rows=1) and there is no request flow. "OLD STATE RED".
 * NEW STATE: the PATCH is refused; either side can ask; only the OTHER side
 * answers; accept moves the job (a Helpr accepting passes their own column
 * whitelist); decline and expiry leave it; one pending request per job, a new
 * one replaces the old and the other party is told; scope is one-time jobs.
 */
import { PGlite, readMigration, baseSchema, newestFunctionSql, as, checker, refused, USERS } from "./seriesWorld.mjs";

const CHAIN = [
  "20260927012804_recurring_series_end.sql",
  "20260927012805_hired_job_schedule_lock.sql",
  "20260927012806_recurring_split_days.sql",
  "20260927012807_job_schedule_change_requests.sql",
  "20261002060514_schedule_change_refuses_helpr_clash.sql",
  "20261004004707_schedule_change_accept_rechecks_clash.sql",
  "20261005064336_schedule_clash_declines_with_notice.sql",
].map(readMigration);
// The chain as it stood before Q925 (the OLD STATE of the accept re-check).
const PRE_Q925 = CHAIN.slice(0, -2);
// Q1262(2): the chain before the clash declined the request (prod 2026-10-05).
const PRE_Q1262 = CHAIN.slice(0, -1);
const { P, A, X } = USERS;
const { check, failures, fail } = checker();
const J = (n) => `c0000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const server = (db, sql) => as(db, "service_role", null, sql);
const SEED = `
  insert into public.jobs (id, title, customer_id, helper_id, status, date_needed, start_time, helper_confirmed_at)
  values ('${J(1)}', 'Paint the fence', '${P}', '${A}', 'accepted', current_date + 5, '09:00', now()),
         ('${J(2)}', 'Mow', '${P}', '${A}', 'accepted', current_date + 6, '10:00', now()),
         ('${J(3)}', 'Series parent', '${P}', '${A}', 'accepted', current_date + 6, '10:00', now());
  update public.jobs set recurrence_days = '{1}', recurrence_weeks = 2 where id = '${J(3)}';
`;
const job = async (db, id) => (await db.query(`select date_needed::text d, start_time::text t from public.jobs where id='${id}'`)).rows[0];

{
  const db = new PGlite();
  await db.exec(baseSchema("20260927012804"));
  await db.exec(CHAIN[0]);
  await db.exec(SEED);
  const patch = await as(db, "authenticated", P, `update public.jobs set date_needed = date_needed + 2 where id='${J(1)}'`);
  const rpc = await as(db, "authenticated", P, `select public.request_job_schedule_change('${J(1)}', current_date + 8, '09:00')`);
  const red = patch.ok && patch.affected === 1 && !rpc.ok;
  console.log(`-- OLD STATE ${red ? "RED" : "NOT RED"}: poster PATCH of a booked job's date rows=${patch.affected}; request flow=${rpc.ok ? "exists" : "absent"}`);
  if (!red) fail();
  await db.close();
}

const db = new PGlite();
await db.exec(baseSchema("20260927012804"));
for (let i = 0; i < 3; i++) for (const m of CHAIN) await db.exec(m);
await db.exec(SEED);
check("migration chain applies 3x (replay-safe)", true);

let r = await as(db, "authenticated", P, `update public.jobs set date_needed = date_needed + 2 where id='${J(1)}'`);
check("a direct change of a booked job's date is refused", refused(r, /schedule_locked/), r.err);

// Poster asks; the Helpr accepts.
r = await as(db, "authenticated", P, `select public.request_job_schedule_change('${J(1)}', current_date + 8, '14:30') as v`);
check("the person who posted it can ask", r.ok, r.err);
const req1 = r.rows?.[0]?.v?.request_id;
let n = (await db.query(`select user_id, message from public.notifications where job_id='${J(1)}' and title='New date or time requested'`)).rows;
check("the Helpr is told, role-neutrally", n.length === 1 && n[0].user_id === A && /The person who posted it asked to move/.test(n[0].message), JSON.stringify(n));
check("nothing changes before it is accepted", (await job(db, J(1))).t === "09:00:00");
r = await as(db, "authenticated", P, `select public.respond_job_schedule_change('${req1}', true) as v`);
check("the asker cannot accept their own request", refused(r, /not_authorized/), r.err);
r = await as(db, "authenticated", X, `select public.respond_job_schedule_change('${req1}', true) as v`);
check("a stranger cannot accept it", refused(r, /not_authorized/), r.err);
r = await as(db, "authenticated", A, `select public.respond_job_schedule_change('${req1}', true) as v`);
const moved = await job(db, J(1));
const want = (await db.query(`select (current_date + 8)::text d`)).rows[0].d;
check("the Helpr accepts: the job moves (through their own column whitelist)", r.ok && r.rows[0].v.status === "accepted" && moved.d === want && moved.t === "14:30:00", r.err ?? JSON.stringify(moved));
n = (await db.query(`select user_id from public.notifications where job_id='${J(1)}' and title='New date or time accepted'`)).rows;
check("the asker is told it was accepted", n.length === 1 && n[0].user_id === P, JSON.stringify(n));
r = await as(db, "authenticated", A, `select public.respond_job_schedule_change('${req1}', false) as v`);
check("answering again changes nothing", r.ok && r.rows[0].v.status === "accepted", r.err);

// The Helpr asks; a newer ask replaces it; the poster declines.
r = await as(db, "authenticated", A, `select public.request_job_schedule_change('${J(2)}', current_date + 9, '10:00') as v`);
const req2 = r.rows?.[0]?.v?.request_id;
check("the hired Helpr can ask", r.ok, r.err);
r = await as(db, "authenticated", A, `select public.request_job_schedule_change('${J(2)}', current_date + 10, '11:00') as v`);
const req3 = r.rows?.[0]?.v?.request_id;
n = (await db.query(`select status from public.job_schedule_change_requests where id='${req2}'`)).rows[0].status;
check("a new request replaces the old one", r.ok && r.rows[0].v.replaced === 1 && n === "replaced", `${r.err ?? ""} ${n}`);
n = (await db.query(`select count(*)::int c from public.job_schedule_change_requests where job_id='${J(2)}' and status='pending'`)).rows[0].c;
check("one pending request per job", n === 1, String(n));
n = (await db.query(`select message from public.notifications where job_id='${J(2)}' and title='New date or time requested' order by id desc limit 1`)).rows[0].message;
check("the other party is told it replaces the earlier one", /This replaces their earlier request/.test(n) && /The Helpr doing it asked/.test(n), n);
r = await server(db, `insert into public.job_schedule_change_requests (job_id, requested_by, responder_id, old_date, new_date, expires_at) values ('${J(2)}', '${A}', '${P}', current_date, current_date + 1, now() + interval '1 day')`);
check("the database refuses a second pending request", refused(r, /duplicate key|unique/), r.err);
r = await as(db, "authenticated", P, `select public.respond_job_schedule_change('${req3}', false) as v`);
check("the person who posted it declines", r.ok && r.rows[0].v.status === "declined", r.err);
check("declined: the original date and time stay", (await job(db, J(2))).t === "10:00:00");
n = (await db.query(`select message from public.notifications where job_id='${J(2)}' and title='New date or time declined'`)).rows;
check("the asker is told, with the cancellation rules unchanged", n.length === 1 && /usual cancellation rules apply/.test(n[0].message), JSON.stringify(n));

// Expiry at the ORIGINAL start.
r = await as(db, "authenticated", P, `select public.request_job_schedule_change('${J(2)}', current_date + 12, '10:00') as v`);
const req4 = r.rows?.[0]?.v?.request_id;
const exp = (await db.query(`select (expires_at = ((current_date + 6 + time '10:00') at time zone 'America/Chicago')) ok from public.job_schedule_change_requests where id='${req4}'`)).rows[0].ok;
check("a request expires at the job's original start", exp === true);
await server(db, `update public.job_schedule_change_requests set expires_at = now() - interval '1 second' where id='${req4}'`);
r = await as(db, "authenticated", A, `select public.respond_job_schedule_change('${req4}', true) as v`);
n = (await db.query(`select status from public.job_schedule_change_requests where id='${req4}'`)).rows[0].status;
check("an expired request cannot be accepted, and is marked expired", r.ok && r.rows[0].v.status === "expired" && n === "expired", r.err ?? n);
check("expired: the job did not move", (await job(db, J(2))).t === "10:00:00");

// Scope and grants.
r = await as(db, "authenticated", P, `select public.request_job_schedule_change('${J(3)}', current_date + 9, '10:00') as v`);
check("a series is not changed through this flow", refused(r, /schedule_change_not_one_time/), r.err);
r = await as(db, "authenticated", X, `select public.request_job_schedule_change('${J(1)}', current_date + 9, '10:00') as v`);
check("a stranger cannot ask", refused(r, /not_authorized/), r.err);
r = await as(db, "authenticated", P, `select public.request_job_schedule_change('${J(1)}', current_date - 1, '10:00') as v`);
check("a date in the past is refused", refused(r, /schedule_change_in_past/), r.err);
r = await as(db, "anon", null, `select public.request_job_schedule_change('${J(1)}', current_date + 9, '10:00')`);
check("anon cannot execute the request RPC", refused(r, /permission denied/), r.err);
r = await as(db, "authenticated", P, `insert into public.job_schedule_change_requests (job_id, requested_by, responder_id, old_date, new_date, expires_at) values ('${J(1)}', '${P}', '${A}', current_date, current_date + 1, now())`);
check("clients cannot write requests directly", refused(r, /permission denied/), r.err);
r = await as(db, "authenticated", X, `select count(*)::int c from public.job_schedule_change_requests`);
check("a stranger reads no requests", r.ok && r.rows[0].c === 0, r.err);
r = await as(db, "authenticated", A, `update public.jobs set date_needed = date_needed + 1 where id='${J(1)}'`);
check("the Helpr's own PATCH of the date is still refused", !r.ok, r.err);

await db.close();

// ── Q736: a proposed start that overlaps another booking the Helpr holds ──
// OLD STATE: the chain without 20261002060514 accepts the clashing request.
{
  const K = J(30), L = J(31), M = J(32), C = J(33);
  const seed = `
    insert into public.jobs (id, title, customer_id, helper_id, status, date_needed, start_time, helper_confirmed_at, estimated_hours)
    values ('${K}', 'Move me', '${P}', '${A}', 'accepted', current_date + 5, '09:00', now(), 2),
           ('${L}', 'Already booked', '${X}', '${A}', 'accepted', current_date + 9, '13:00', now(), 3),
           ('${M}', 'Done one', '${X}', '${A}', 'accepted', current_date + 11, '13:00', now(), 3),
           ('${C}', 'Crew job', '${X}', '${X}', 'accepted', current_date + 12, '08:00', now(), 4);
    update public.jobs set helper_completed_at = now() where id = '${M}';
    update public.jobs set is_group_job = true where id = '${C}';
    insert into public.group_job_helpers (job_id, helper_id, status) values ('${C}', '${A}', 'accepted');`;
  const ask = (dbx, who, days, time) => as(dbx, "authenticated", who, `select public.request_job_schedule_change('${K}', current_date + ${days}, ${time === null ? "null" : `'${time}'`}) as v`);

  const old = new PGlite();
  await old.exec(baseSchema("20260927012804"));
  for (const m of CHAIN.slice(0, -3)) await old.exec(m);
  await old.exec(seed);
  const o = await ask(old, P, 9, "14:00");
  console.log(`-- Q736 OLD STATE ${o.ok ? "RED" : "NOT RED"}: a request onto the Helpr's 13:00-16:00 booking -> ${o.ok ? "accepted as a request" : o.err}`);
  if (!o.ok) fail();
  await old.close();

  const cdb = new PGlite();
  await cdb.exec(baseSchema("20260927012804"));
  for (let i = 0; i < 3; i++) for (const m of CHAIN) await cdb.exec(m);
  await cdb.exec(seed);
  let q = await ask(cdb, P, 9, "14:00");
  check("Q736: the poster cannot ask for a time inside the Helpr's other booking", refused(q, /schedule_change_clash/), q.err);
  q = await ask(cdb, A, 9, "12:00");
  check("Q736: nor the Helpr, when the new job's 2 hours run into it", refused(q, /schedule_change_clash/), q.err);
  q = await ask(cdb, P, 12, "10:00");
  check("Q736: a crew seat the Helpr holds counts as booked", refused(q, /schedule_change_clash/), q.err);
  q = await ask(cdb, P, 9, "16:00");
  check("Q736: a start right when the other booking ends is allowed", q.ok, q.err);
  q = await ask(cdb, P, 9, "11:00");
  check("Q736: a start whose 2 hours end right when it begins is allowed", q.ok, q.err);
  q = await ask(cdb, P, 11, "14:00");
  check("Q736: a booking the Helpr has finished does not clash", q.ok, q.err);
  q = await ask(cdb, P, 9, null);
  check("Q736: an any-time-that-day request does not clash", q.ok, q.err);
  q = await ask(cdb, P, 10, "14:00");
  check("Q736: another day is allowed", q.ok, q.err);
  await cdb.close();
}


// ── Q925: accepting re-checks the clash ────────────────────────────────────
// The request-time check is an unlocked read, and the Helpr can be booked
// elsewhere while a request sits pending. OLD STATE (the chain without
// 20261004004707): the accept moves the job onto the Helpr's other booking.
{
  const K = J(40), L = J(41), M = J(42), C = J(43);
  const seed = `
    insert into public.jobs (id, title, customer_id, helper_id, status, date_needed, start_time, helper_confirmed_at, estimated_hours)
    values ('${K}', 'Move me', '${P}', '${A}', 'accepted', current_date + 5, '09:00', now(), 2);`;
  // The Helpr is hired elsewhere AFTER the request was filed (the race).
  const later = `
    insert into public.jobs (id, title, customer_id, helper_id, status, date_needed, start_time, helper_confirmed_at, estimated_hours)
    values ('${L}', 'Booked meanwhile', '${X}', '${A}', 'accepted', current_date + 9, '13:00', now(), 3),
           ('${M}', 'Finished meanwhile', '${X}', '${A}', 'accepted', current_date + 11, '13:00', now(), 3);
    update public.jobs set helper_completed_at = now() where id = '${M}';`;
  const laterCrew = `
    insert into public.jobs (id, title, customer_id, helper_id, status, date_needed, start_time, helper_confirmed_at, estimated_hours)
    values ('${C}', 'Crew job', '${X}', '${X}', 'accepted', current_date + 12, '08:00', now(), 4);
    update public.jobs set is_group_job = true where id = '${C}';
    insert into public.group_job_helpers (job_id, helper_id, status) values ('${C}', '${A}', 'accepted');`;
  const ask = async (dbx, who, days, time) => {
    const q = await as(dbx, "authenticated", who, `select public.request_job_schedule_change('${K}', current_date + ${days}, ${time === null ? "null" : `'${time}'`}) as v`);
    return q.ok ? q.rows[0].v.request_id : null;
  };
  const accept = (dbx, who, id) => as(dbx, "authenticated", who, `select public.respond_job_schedule_change('${id}', true) as v`);
  const pending = async (dbx, id) => (await dbx.query(`select status from public.job_schedule_change_requests where id='${id}'`)).rows[0].status;
  const scenario = async (chain, reps) => {
    const dbx = new PGlite();
    await dbx.exec(baseSchema("20260927012804"));
    for (let i = 0; i < reps; i++) for (const m of chain) await dbx.exec(m);
    await dbx.exec(seed);
    return dbx;
  };

  const old = await scenario(PRE_Q925, 1);
  const oid = await ask(old, P, 9, "14:00");
  await old.exec(later);
  const o = await accept(old, A, oid);
  const oj = await job(old, K);
  const red = o.ok && o.rows[0].v.status === "accepted" && oj.t === "14:00:00";
  console.log(`-- Q925 OLD STATE ${red ? "RED" : "NOT RED"}: accepting a request that now overlaps the Helpr's 13:00-16:00 booking -> ${o.ok ? o.rows[0].v.status + " at " + oj.t : o.err}`);
  if (!red) fail();
  await old.close();

  // Q1262(2) OLD STATE (prod 2026-10-05): the clash raised, rolled back, and
  // left the request pending with nobody told.
  {
    const pdb = await scenario(PRE_Q1262, 1);
    const pid = await ask(pdb, P, 9, "14:00");
    await pdb.exec(later);
    const pq = await accept(pdb, A, pid);
    const stuck = !pq.ok && /schedule_change_clash/.test(pq.err) && (await pending(pdb, pid)) === "pending";
    console.log(`-- Q1262(2) OLD STATE ${stuck ? "RED" : "NOT RED"}: a clash at accept -> ${pq.ok ? JSON.stringify(pq.rows[0].v) : pq.err}; request ${await pending(pdb, pid)}`);
    if (!stuck) fail();
    await pdb.close();
  }
  const ndb = await scenario(CHAIN, 3);
  check("Q925: the chain with the re-check applies 3x (replay-safe)", true);
  const id1 = await ask(ndb, P, 9, "14:00");
  check("Q925: the request was fine when filed (no overlap yet)", !!id1);
  await ndb.exec(later);
  const clashed = (q) => q.ok && q.rows[0].v.status === "declined" && q.rows[0].v.reason === "schedule_change_clash";
  const notices = async (dbx, who) => Number((await dbx.query(`select count(*)::int n from public.notifications where user_id = '${who}' and title = 'New date or time not possible'`)).rows[0].n);
  let q = await accept(ndb, A, id1);
  check("Q925: the Helpr cannot accept onto a booking made after the request (Q1262: declined as a clash)", clashed(q), q.ok ? JSON.stringify(q.rows[0].v) : q.err);
  let jj = await job(ndb, K);
  check("Q925: ...the job did not move", jj.t === "09:00:00" && jj.d === (await ndb.query(`select (current_date + 5)::text d`)).rows[0].d, JSON.stringify(jj));
  check("Q1262(2): ...the request is declined, not left pending", (await pending(ndb, id1)) === "declined");
  check("Q1262(2): ...and whoever asked is told", (await notices(ndb, P)) === 1, `${await notices(ndb, P)} notice(s)`);
  // A crew seat the Helpr holds counts, and the poster accepting the Helpr's request is checked too.
  const id3 = await ask(ndb, A, 12, "10:00");
  await ndb.exec(laterCrew);
  q = await accept(ndb, P, id3);
  check("Q925: the poster accepting the Helpr's request is refused when it overlaps a crew seat (declined as a clash)", clashed(q), q.ok ? JSON.stringify(q.rows[0].v) : q.err);
  check("Q1262(2): ...and the Helpr who asked is told", (await notices(ndb, A)) === 1, `${await notices(ndb, A)} notice(s)`);
  // Boundaries and exemptions, each accepted.
  for (const [label, days, time] of [
    ["a start right when the other booking ends", 9, "16:00"],
    ["a start whose 2 hours end right when the other begins", 9, "11:00"],
    ["a booking the Helpr has finished", 11, "14:00"],
    ["an any-time-that-day request", 9, null],
    ["another day", 10, "14:00"],
  ]) {
    const rid = await ask(ndb, P, days, time);
    q = await accept(ndb, A, rid);
    jj = await job(ndb, K);
    check(`Q925: accept lands for ${label}`, q.ok && q.rows[0].v.status === "accepted" && (time === null ? jj.t === null : jj.t === `${time}:00`), q.err ?? JSON.stringify(jj));
    await server(ndb, `update public.jobs set date_needed = current_date + 5, start_time = '09:00' where id='${K}'`);
  }
  await ndb.close();
}

// ── The Q423 poster lock (20260925231810) and the accept carve-out ────────
// (20260927012809). The poster lock's locked_when_booked judged the POSTER'S
// accept of a change the Helpr asked for like a bare PATCH.
{
  const CARVE = "20260927012809_poster_lock_lets_accepted_schedule_change.sql";
  const pdb = new PGlite();
  await pdb.exec(baseSchema("20260927012804"));
  for (const m of CHAIN) await pdb.exec(m);
  const lock = newestFunctionSql("enforce_poster_jobs_money_lock", CARVE);
  check(`the poster lock before the carve-out is 20260925231810's (${lock.file})`, lock.file === "20260925231810_poster_cannot_move_fee_inputs.sql");
  await pdb.exec(lock.sql);
  await pdb.exec(`create trigger trg_poster_jobs_money_lock before update on public.jobs for each row execute function public.enforce_poster_jobs_money_lock();`);
  const F = J(20), G = J(21);
  await pdb.exec(`insert into public.jobs (id, title, customer_id, helper_id, status, date_needed, start_time, helper_confirmed_at, payment_status)
    values ('${F}', 'Funded booking', '${P}', '${A}', 'accepted', current_date + 5, '09:00', now(), 'escrow'),
           ('${G}', 'Funded booking 2', '${P}', '${A}', 'accepted', current_date + 5, '09:00', now(), 'escrow')`);
  const ask = async (dbx, job, days) => {
    const q = await as(dbx, "authenticated", A, `select public.request_job_schedule_change('${job}', current_date + ${days}, '11:00') as v`);
    return (await dbx.query(`select id from public.job_schedule_change_requests where job_id='${job}' and status='pending'`)).rows[0]?.id ?? q.err;
  };
  let q = await as(pdb, "authenticated", P, `select public.respond_job_schedule_change('${await ask(pdb, F, 7)}', true) as v`);
  const redAccept = !q.ok && /Posters may not move jobs\.(date_needed|start_time)/.test(q.err);
  console.log(`-- 231810 ALONE ${redAccept ? "RED" : "NOT RED"}: the poster accepting the Helpr's request on a funded booking -> ${q.err ?? JSON.stringify(q.rows)}`);
  if (!redAccept) fail();
  for (let i = 0; i < 3; i++) await pdb.exec(readMigration(CARVE));
  check("the carve-out migration applies 3x (replay-safe)", true);
  q = await as(pdb, "authenticated", P, `select public.respond_job_schedule_change('${await ask(pdb, F, 7)}', true) as v`);
  const moved = await job(pdb, F);
  check("the poster accepting the Helpr's request on a funded booking moves it", q.ok && q.rows[0].v.status === "accepted" && moved.t === "11:00:00", `${q.err ?? JSON.stringify(q.rows)} ${JSON.stringify(moved)}`);
  // The poster lock alone (the series client lock, 20260927012805, refuses
  // these too; switched off here so this proves the carve-out opened nothing).
  await pdb.exec(`alter table public.jobs disable trigger trg_enforce_series_columns_client_lock`);
  q = await as(pdb, "authenticated", P, `update public.jobs set date_needed = date_needed + 3 where id='${G}'`);
  check("a bare poster PATCH of a booked job's date is still refused by the poster lock", !q.ok && /Posters may not move jobs\.date_needed/.test(q.err), q.err);
  q = await as(pdb, "authenticated", P, `update public.jobs set start_time = '20:00' where id='${G}'`);
  check("... and of its start time", !q.ok && /Posters may not move jobs\.start_time/.test(q.err), q.err);
  // A client's own request is ONE statement (PostgREST); a flag set in an
  // earlier statement with is_local = true is gone by the next.
  q = await as(pdb, "authenticated", P, `select set_config('app.schedule_change_rpc', '1', true) as f`);
  const after = await as(pdb, "authenticated", P, `update public.jobs set date_needed = date_needed + 3 where id='${G}'`);
  check("a flag the poster sets in an earlier statement does not unlock the date", q.ok && !after.ok && /Posters may not move/.test(after.err), after.err);
  q = await as(pdb, "authenticated", P, `update public.jobs set helper_confirmed_at = null where id='${G}'`);
  check("the carve-out opens nothing else (helper_confirmed_at stays locked)", !q.ok && /helper_confirmed_at/.test(q.err), q.err);
  await pdb.close();
}

console.log(failures() ? `\n${failures()} FAILED` : "\nALL PASS");
process.exit(failures() ? 1 : 0);
