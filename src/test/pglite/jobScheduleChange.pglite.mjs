#!/usr/bin/env node
/**
 * PGlite proof for 20260925165200_job_schedule_change_requests (owner decision
 * Q407 (8), finalised 2026-09-25).
 *
 *   PGLITE_DIR=~/.lh-pglite-probe node src/test/pglite/jobScheduleChange.pglite.mjs
 *
 * World: seriesWorld.mjs (the real jobs trigger chain from the newest
 * migrations, the helper column whitelist included). Chain under test:
 * 20260925052841, 20260925160644, 20260925160645, 20260925165200, 3x.
 *
 * OLD STATE (20260925052841 only): the poster moves a booked one-time job's
 * date with a plain PATCH (rows=1) and there is no request flow. "OLD STATE RED".
 * NEW STATE: the PATCH is refused; either side can ask; only the OTHER side
 * answers; accept moves the job (a Helpr accepting passes their own column
 * whitelist); decline and expiry leave it; one pending request per job, a new
 * one replaces the old and the other party is told; scope is one-time jobs.
 */
import { PGlite, readMigration, baseSchema, newestFunctionSql, as, checker, refused, USERS } from "./seriesWorld.mjs";

const CHAIN = [
  "20260925052841_recurring_series_end.sql",
  "20260925160644_hired_job_schedule_lock.sql",
  "20260925160645_recurring_split_days.sql",
  "20260925165200_job_schedule_change_requests.sql",
].map(readMigration);
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
  await db.exec(baseSchema("20260925052841"));
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
await db.exec(baseSchema("20260925052841"));
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

// ── The Q423 poster lock (20260925231810) and the accept carve-out ────────
// (20260925233954). The poster lock's locked_when_booked judged the POSTER'S
// accept of a change the Helpr asked for like a bare PATCH.
{
  const CARVE = "20260925233954_poster_lock_lets_accepted_schedule_change.sql";
  const pdb = new PGlite();
  await pdb.exec(baseSchema("20260925052841"));
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
  // The poster lock alone (the series client lock, 20260925160644, refuses
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
