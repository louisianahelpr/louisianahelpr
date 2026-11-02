#!/usr/bin/env node
/**
 * PGlite proof for 20261101231015_job_continue_another_day (owner 2026-11-01: "Yusef couldn't finish today so he
 * will go back Thursday ... so if this happens again we can move the day").
 *
 *   node src/test/pglite/jobContinueDay.pglite.mjs                       # AFTER: the migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/jobContinueDay.pglite.mjs    # RED: the chain before it
 *   PLANT=<name> node src/test/pglite/jobContinueDay.pglite.mjs          # a planted defect (expect FAILs):
 *     no_party_check   the propose RPC forgets "only the job's two people"
 *     no_clear_flag    the completion trigger keeps refusing the clear (Yusef's done stays, the clock runs)
 *     no_block_check   a blocked pair can still set a day
 *     reminder_old_day the reminder sweep reads the job's original day
 *
 * World: seriesWorld.mjs (the real jobs column locks, ban gate, is_caller_banned, is_server_context), plus the
 * NEWEST definitions of enforce_job_completion_server_owned, enforce_helper_completion_gates and rpc_helper_mark_done
 * from the migrations, not retyped. Stubbed, and said so: auth.uid()/auth.role() (the JWT claims), has_role (no
 * admins), are_users_blocked (a table), sell_for_me_listings_sent (true).
 */
import { PGlite, readMigration, baseSchema, newestFunctionSql, as, checker, refused, USERS } from "./seriesWorld.mjs";
import { installClock, newestFunction, onFixedClock, setClock } from "./lib/fixedClock.mjs";

const FIX_FILE = "20261101231015_job_continue_another_day.sql";
const BEFORE = FIX_FILE.slice(0, 14);
const MODE = process.env.NEW_MIGRATION ?? "";
const PLANT = process.env.PLANT ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running the chain before the fix (expect FAILs)`);
if (PLANT) console.log(`PLANT=${PLANT}: a planted defect (expect FAILs)`);
const { P, A, B, X } = USERS; // P posts, A is the hired Helpr (Yusef), B a stranger Helpr, X another stranger
const { check, failures } = checker();
const J = (n) => `e0000000-0000-0000-0000-0000000001${String(n).padStart(2, "0")}`;
const fn = (n) => newestFunctionSql(n, BEFORE).sql;

const db = new PGlite();
const q = async (sql, params) => (await db.query(sql, params)).rows;
// is_caller_banned, as of this migration, also reads the under-13 lock (prod column).
await db.exec(baseSchema(BEFORE).replace("auto_suspended_until timestamptz);", "auto_suspended_until timestamptz, under_13_blocked_at timestamptz);"));
await db.exec(`
  alter table public.jobs
    add column if not exists poster_completed_at timestamptz, add column if not exists payout_scheduled_at timestamptz,
    add column if not exists poster_confirmed_arrival_at timestamptz, add column if not exists helper_arrival_verified_at timestamptz,
    add column if not exists helper_arrived_at timestamptz, add column if not exists poster_confirmed_working_at timestamptz,
    add column if not exists proof_before_urls text[], add column if not exists proof_after_urls text[];
  create function public.sell_for_me_listings_sent(uuid) returns boolean language sql stable as $f$ select true $f$;
  -- Stub of member_display_name (20261021131322 shape: "First L."); the notices take its first word.
  create or replace function public.member_display_name(p_full_name text, p_fallback text) returns text language sql immutable as
    $f$ select coalesce(nullif(split_part(btrim(p_full_name), ' ', 1), '') || coalesce(' ' || left(nullif(split_part(btrim(p_full_name), ' ', 2), ''), 1) || '.', ''), p_fallback) $f$;
  update public.profiles set full_name = 'Dana Poster' where user_id = '${P}';
  update public.profiles set full_name = 'Yusef Helpr' where user_id = '${A}';
`);
for (const n of ["enforce_job_completion_server_owned", "enforce_helper_completion_gates", "enforce_completion_on_live_job", "rpc_helper_mark_done"]) {
  await db.exec(fn(n));
}
await db.exec(`
  create trigger trg_helper_completion_gates before update of helper_completed_at, status on public.jobs
    for each row execute function public.enforce_helper_completion_gates();
  create trigger zz_jobs_completion_server_owned before insert or update of status, helper_completed_at on public.jobs
    for each row execute function public.enforce_job_completion_server_owned();
  create trigger trg_completion_on_live_job before update of helper_completed_at on public.jobs
    for each row execute function public.enforce_completion_on_live_job();
`);

let mig = readMigration(FIX_FILE);
const plant = (from, to) => {
  if (!mig.includes(from)) throw new Error(`plant ${PLANT}: anchor not found`);
  mig = mig.replace(from, to);
};
if (PLANT === "no_party_check") plant("IF v_uid IS DISTINCT FROM v_job.customer_id AND v_uid IS DISTINCT FROM v_job.helper_id THEN", "IF false THEN");
if (PLANT === "no_clear_flag") plant("AND COALESCE(current_setting('app.continue_day_rpc', true), '') <> '1' THEN", "THEN");
if (PLANT === "no_block_check") mig = mig.replaceAll("IF public.are_users_blocked(v_job.customer_id, v_job.helper_id) THEN", "IF false THEN");
if (PLANT === "reminder_old_day") plant("((c.new_date + c.new_start_time) AT TIME ZONE 'America/Chicago') AS starts_at", "((j.date_needed + j.start_time) AT TIME ZONE 'America/Chicago') AS starts_at");
if (!MODE) for (let i = 0; i < 3; i++) await db.exec(mig); // replay-safe: applied 3x

// Jobs. All $40, Helpr A hired, money held, in progress since yesterday 10 AM, arrival confirmed, photos in.
//  1 Yusef's (7b1da54b-shaped): A marked done 5 h ago      2 not yet marked done (A proposes)
//  3 a blocked pair                                         4 accepted, not started
//  5 X's job (the poster is a stranger to A)                6 approved by the poster while a day is set
await db.exec(`
  insert into public.jobs (id, title, budget, customer_id, helper_id, status, payment_status, date_needed, start_time,
                           helper_confirmed_at, poster_confirmed_arrival_at, helper_arrived_at, proof_before_urls, proof_after_urls,
                           helper_completed_at, require_photo_proof)
  values ('${J(1)}', 'Clean out the garage', 40, '${P}', '${A}', 'in_progress', 'escrow', current_date - 1, '10:00',
          now() - interval '3 days', now() - interval '30 hours', now() - interval '30 hours', '{b.jpg}', '{a.jpg}', now() - interval '5 hours', true),
         ('${J(2)}', 'Paint the fence', 40, '${P}', '${A}', 'in_progress', 'escrow', current_date - 1, '10:00',
          now() - interval '3 days', now() - interval '30 hours', now() - interval '30 hours', '{b.jpg}', '{a.jpg}', null, true),
         ('${J(3)}', 'Move a couch', 40, '${P}', '${A}', 'in_progress', 'escrow', current_date - 1, '10:00',
          now() - interval '3 days', now() - interval '30 hours', now() - interval '30 hours', '{b.jpg}', '{a.jpg}', null, true),
         ('${J(4)}', 'Hang shelves', 40, '${P}', '${A}', 'accepted', 'escrow', current_date + 2, '10:00',
          now() - interval '3 days', null, null, null, null, null, true),
         ('${J(6)}', 'Rake leaves', 40, '${P}', '${A}', 'in_progress', 'escrow', current_date - 1, '10:00',
          now() - interval '3 days', now() - interval '30 hours', now() - interval '30 hours', '{b.jpg}', '{a.jpg}', null, true);
  insert into public.user_blocks values ('${P}', '${B}');
`);
await db.exec(`insert into auth.users values ('66666666-6666-6666-6666-666666666666') on conflict do nothing;`);

// Thursday-like: 3 days out at 9 AM Central.
const DAY = (await q(`select ((now() at time zone 'America/Chicago')::date + 3)::text as d`))[0].d;
const call = (uid, sql) => as(db, "authenticated", uid, sql);
const propose = (uid, job, date = DAY, time = "09:00", note = null) =>
  call(uid, `select public.propose_job_continue_day('${job}', '${date}'::date, '${time}'::time, ${note ? `'${note}'` : "null"}) as r`);
const active = async (job) => (await q(`select * from public.job_continue_days where job_id = $1 and status in ('proposed','set')`, [job]))[0] ?? null;
const jobRow = async (job) => (await q(`select * from public.jobs where id = $1`, [job]))[0];
const events = async (job) => (await q(`select action from public.job_continue_events where job_id = $1 order by created_at, action`, [job])).map((r) => r.action);
const notes = async (uid, job) => (await q(`select title, message, link from public.notifications where user_id = $1 and job_id = $2 order by id`, [uid, job]));

// 1. Strangers are refused: X and B on job 1.
const strangerX = await propose(X, J(1));
check("a stranger (X) cannot set a day on someone else's job", refused(strangerX, /not_authorized/), strangerX.err ?? "ran");
const anon = await as(db, "anon", null, `select public.propose_job_continue_day('${J(1)}', '${DAY}'::date, '09:00'::time, null)`);
check("anon cannot call it at all", refused(anon, /permission denied|not_authenticated/), anon.err ?? "ran");

// 2. Yusef's exact case: he marked done 5 h ago; the poster sets Thursday 9 AM.
const before1 = await jobRow(J(1));
check("job 1 starts as marked done, in progress, money held", !!before1.helper_completed_at && before1.status === "in_progress" && before1.payment_status === "escrow");
const set1 = await propose(P, J(1), DAY, "09:00", "Finish the back shelves");
check("the poster sets a day on a job the Helpr already marked done", set1.ok && set1.rows[0]?.r?.status === "set", set1.err ?? JSON.stringify(set1.rows?.[0]));
const after1 = await jobRow(J(1));
check("...the Helpr's earlier done is cleared (the approval clock stops)", after1?.helper_completed_at === null, String(after1?.helper_completed_at));
check("...the job stays in progress and the money stays held", after1.status === "in_progress" && after1.payment_status === "escrow");
check("...the original day is kept (date_needed not moved)", String(after1.date_needed) === String(before1.date_needed));
const row1 = await active(J(1));
check("...one active row, set, with the cleared stamp recorded", row1?.status === "set" && !!row1?.cleared_done_at);
const yNotes = await notes(A, J(1));
check("...Yusef is told who set which day and the next step",
  yNotes.some((n) => /^Dana set \w{3} \d+\/\d+ at 9 AM to finish "Clean out the garage"\. Next: confirm you'll be there\.$/.test(n.message)),
  JSON.stringify(yNotes.map((n) => n.message)));
check("...the change is logged", (await events(J(1))).includes("set"));

// 3. A direct client clear is still refused (the door is only the RPC's flag).
await db.exec(`update public.jobs set helper_completed_at = now() - interval '1 hour' where id = '${J(2)}'`);
const directClear = await call(P, `update public.jobs set helper_completed_at = null where id = '${J(2)}'`);
check("a direct client clear of done is still refused", !directClear.ok, directClear.err ?? "ran");
let setFlag;
try {
  await db.exec(`begin; set local request.jwt.claim.sub = '${P}'; set local request.jwt.claim.role = 'authenticated'; set local role authenticated;
    select set_config('app.continue_day_rpc', '1', true); update public.jobs set helper_completed_at = null where id = '${J(2)}'; commit;`);
  setFlag = { ok: true };
} catch (e) {
  await db.exec("rollback");
  setFlag = { ok: false, err: String(e.message).split("\n")[0] };
}
check("...even with the flag set by hand (the column lock still refuses a client write)", refused(setFlag, /helper_completed_at is stamped by the server/), setFlag.err ?? "ran");
await db.exec(`update public.jobs set helper_completed_at = null where id = '${J(2)}'`);
const clearFn = await call(P, `select public.continue_day_clear_done('${J(1)}')`);
check("the clearing helper is not callable by a client", refused(clearFn, /permission denied/), clearFn.err ?? "ran");

// 4. The Helpr proposes on job 2; the poster confirms with one tap.
const prop2 = await propose(A, J(2), DAY, "13:30", "Need paint to dry");
check("the Helpr proposes another day", prop2.ok && prop2.rows[0]?.r?.status === "proposed", prop2.err);
check("...the poster is told, in server-built words (the Helpr's first name, no note)", (await notes(P, J(2))).some((n) => /^Yusef asked to finish "Paint the fence" on \w{3} \d+\/\d+ at 1:30 PM\. Next: confirm the new day\.$/.test(n.message)));
const row2 = await active(J(2));
const helprAnswers = await call(A, `select public.answer_job_continue_day('${row2?.id}', true)`);
check("the Helpr cannot confirm their own proposal", refused(helprAnswers, /not_authorized/), helprAnswers.err ?? "ran");
const strangerAnswers = await call(X, `select public.answer_job_continue_day('${row2?.id}', true)`);
check("a stranger cannot confirm it", refused(strangerAnswers, /not_authorized/), strangerAnswers.err ?? "ran");
const ok2 = await call(P, `select public.answer_job_continue_day('${row2?.id}', true) as r`);
check("the poster confirms with one tap", ok2.ok && ok2.rows[0]?.r?.status === "set", ok2.err);
const again2 = await call(P, `select public.answer_job_continue_day('${row2?.id}', true) as r`);
check("a second tap changes nothing (replay)", again2.ok && again2.rows[0]?.r?.changed === false, again2.err);

// 5. Mark done before the new day is refused; a second day replaces the first.
await db.exec(`update public.jobs set helper_completed_at = null where id = '${J(2)}'`);
const early = await call(A, `select public.rpc_helper_mark_done('${J(2)}')`);
check("the Helpr cannot mark it done before the continue day", refused(early, /continue_day_ahead/), early.err ?? "ran");
const second = await propose(P, J(2), DAY, "15:00");
check("a second continue day is allowed (replaces the first)", second.ok && second.rows[0]?.r?.replaced === true, second.err);
const all2 = await q(`select status from public.job_continue_days where job_id = $1 order by created_at`, [J(2)]);
check("...exactly one active row, the earlier one kept as replaced", all2.filter((r) => ["proposed", "set"].includes(r.status)).length === 1 && all2.some((r) => r.status === "replaced"), JSON.stringify(all2));

// 6. Blocked pair and not-in-progress refused.
await db.exec(`insert into public.user_blocks values ('${P}', '${A}')`);
const blocked = await propose(P, J(3));
check("a blocked pair cannot set a day", refused(blocked, /users_blocked/), blocked.err ?? "ran");
await db.exec(`delete from public.user_blocks where a = '${P}' and b = '${A}'`);
const notStarted = await propose(A, J(4));
check("a job not under way is refused", refused(notStarted, /continue_day_not_in_progress/), notStarted.err ?? "ran");
const past = await propose(P, J(3), "2020-01-01");
check("a day in the past is refused", refused(past, /continue_day_too_soon/), past.err ?? "ran");

// 7. Banned caller refused.
await db.exec(`update public.profiles set ban_status = 'banned' where user_id = '${A}'`);
const banned = await propose(A, J(3));
check("a banned account is refused", refused(banned, /account_restricted|banned|restricted/), banned.err ?? "ran");
await db.exec(`update public.profiles set ban_status = 'active' where user_id = '${A}'`);

// 8. The poster's approval (server write) closes the active row as finished.
await propose(P, J(6));
await as(db, "service_role", null, `update public.jobs set poster_completed_at = now() where id = '${J(6)}'`);
check("the poster's approval closes the continue day as finished", (await active(J(6))) === null &&
  (await q(`select status from public.job_continue_days where job_id = $1`, [J(6)]))[0]?.status === "finished");

// 9. The auto-release reader: what _shared/continueDay.ts selects (active rows) holds jobs 1 and 2, not 6.
const held = (await q(`select job_id from public.job_continue_days where status in ('proposed','set')`)).map((r) => r.job_id).sort();
check("the auto-release skip set holds the continuing jobs only", JSON.stringify(held) === JSON.stringify([J(1), J(2)].sort()), JSON.stringify(held));

// 10. Reminders aim at the NEW day, never the original.
const startsAt = (await q(`select ((new_date + new_start_time) at time zone 'America/Chicago') as t from public.job_continue_days where job_id = $1 and status = 'set'`, [J(1)]))[0]?.t;
const sweep = async (t) => (await as(db, "service_role", null, `select public.sweep_job_continue_day_reminders('${t}'::timestamptz) as n`));
const origStart = (await q(`select ((date_needed + start_time) at time zone 'America/Chicago') as t from public.jobs where id = $1`, [J(1)]))[0].t;
const atOld = await sweep(new Date(new Date(origStart).getTime() + 40 * 60_000).toISOString());
check("no reminder or not-confirmed alert on the original day", atOld.ok && atOld.rows[0]?.n === 0, atOld.err ?? `sent ${atOld.rows?.[0]?.n}`);
const twoBefore = new Date(new Date(startsAt).getTime() - 115 * 60_000).toISOString();
const r2 = await sweep(twoBefore);
check("2 hours before the new start: reminders go out", r2.ok && r2.rows[0]?.n >= 2, r2.err ?? `sent ${r2.rows?.[0]?.n}`);
check("...Yusef: back on your job; the poster: your Helpr is back",
  (await notes(A, J(1))).some((n) => n.title === "Back on your job in 2 hours") && (await notes(P, J(1))).some((n) => n.title === "Your Helpr is back in 2 hours"));
const r2again = await sweep(twoBefore);
check("...a second run sends nothing (replay)", r2again.ok && r2again.rows[0]?.n === 0, `sent ${r2again.rows?.[0]?.n}`);
const late = await sweep(new Date(new Date(startsAt).getTime() + 40 * 60_000).toISOString());
check("30+ minutes past the new start, unconfirmed: the poster is alerted", late.ok && (await notes(P, J(1))).some((n) => n.title === "Your Helpr hasn't confirmed today"), late.err);
const conf = await call(A, `select public.confirm_job_continue_day('${(await active(J(1)))?.id}') as r`);
check("the Helpr confirms the new day", conf.ok && conf.rows[0]?.r?.changed === true, conf.err);
const confX = await call(X, `select public.confirm_job_continue_day('${(await active(J(1)))?.id}')`);
check("a stranger cannot confirm it", refused(confX, /not_authorized/), confX.err ?? "ran");

// 10b. The same sweep on the FIXED clock (no p_now: its own now() is the probe clock), job 2's set day at 3 PM:
// the 2-hour reminder opens exactly 2 hours before the new start, never a minute earlier.
await installClock(db);
const { stmt: sweepStmt } = newestFunction("sweep_job_continue_day_reminders");
if (!MODE) await db.exec(onFixedClock(sweepStmt));
const start2 = (await q(`select ((new_date + new_start_time) at time zone 'America/Chicago') as t from public.job_continue_days where job_id = $1 and status = 'set'`, [J(2)]))[0]?.t;
const twoHourSent = async () => (await q(`select count(*)::int as n from public.job_continue_reminder_sends s join public.job_continue_days c on c.id = s.continue_id where c.job_id = $1 and s.kind = 'two_hours_helpr'`, [J(2)]))[0].n;
await setClock(db, new Date(new Date(start2).getTime() - 2 * 3600e3 - 60_000).toISOString());
await as(db, "service_role", null, `select public.sweep_job_continue_day_reminders()`);
check("fixed clock: 2 h 1 min before the new start, no 2-hour reminder yet", (await twoHourSent()) === 0);
await setClock(db, new Date(new Date(start2).getTime() - 2 * 3600e3).toISOString());
await as(db, "service_role", null, `select public.sweep_job_continue_day_reminders()`);
check("fixed clock: exactly 2 h before the new start, the 2-hour reminder goes out", (await twoHourSent()) === 1);

// 11. On the new day the Helpr marks done: the row finishes, the clock starts from now.
await db.exec(`update public.job_continue_days set new_date = (now() at time zone 'America/Chicago')::date where job_id = '${J(1)}' and status = 'set'`);
const done = await call(A, `select public.rpc_helper_mark_done('${J(1)}') as r`);
check("on the new day the Helpr marks it done", done.ok && done.rows[0]?.r?.already_done === false, done.err);
check("...the continue day closes as finished and is logged", (await active(J(1))) === null && (await events(J(1))).includes("finished"));
check("...the approval clock starts again from the new done", !!(await jobRow(J(1))).helper_completed_at);

// 12. Clients cannot write the tables.
const ins = await call(P, `insert into public.job_continue_days (job_id, new_date, new_start_time, status) values ('${J(3)}', '${DAY}', '09:00', 'set')`);
check("a client cannot insert a continue day directly", !ins.ok, ins.err ?? "ran");
const readStranger = await call(X, `select count(*)::int as n from public.job_continue_days`);
check("a stranger reads no continue days", readStranger.ok && readStranger.rows[0].n === 0, readStranger.err);
const readPoster = await call(P, `select count(*)::int as n from public.job_continue_days`);
check("the poster reads their job's continue days", readPoster.ok && readPoster.rows[0].n > 0, readPoster.err);

console.log(failures() ? `\n${failures()} FAILED` : "\nALL PASS");
process.exit(failures() ? 1 : 0);
