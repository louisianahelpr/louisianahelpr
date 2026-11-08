#!/usr/bin/env node
/**
 * PGlite proof for 20261108160000_continue_day_resumes_checks_in_and_new_photos (owner 11-08, Yusef's job 7b1da54b:
 * every fix of ~/.lh-shots/handoffs-1108/b5-jobs-notify-audit.md picked).
 *
 *   node src/test/pglite/continueDayResumes.pglite.mjs                     # the migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/continueDayResumes.pglite.mjs  # RED: the chain before it
 *   PLANT=<name> node src/test/pglite/continueDayResumes.pglite.mjs        # a planted defect (expect FAILs):
 *     old_photos_count   Mark done on the new day passes on day 1's photos again
 *     photo_any_time     a photo added the night before counts as the new day's
 *     no_tracker_reset   agreeing a day leaves the tracker on 'done'
 *     check_in_transit   the new day's check-ins are filed under the transit switch
 *     no_evening         the evening check-in is not sent
 *     in_app_gated       "Helpr on the way" off skips the in-app row again
 *     no_email           continue-day notices stop emailing
 *
 * World: posterContinueDayAsksTheHelpr.pglite.mjs's (seriesWorld.mjs + 20261101231015 + 20261102102402, the real
 * completion triggers and rpc_helper_mark_done), plus job_tracking, job_completion_nudges, notification_logs and the
 * status-notice trigger as prod binds it. Stubbed, and said so: auth.uid()/auth.role(), has_role, are_users_blocked,
 * member_display_name ("First L."), get_supabase_url/get_service_role_key (fixed strings) and net.http_post (records
 * each call in net_calls; the real one queues an HTTP request to send-notification-email).
 */
import { PGlite, readMigration, baseSchema, newestFunctionSql, as, checker, refused, USERS } from "./seriesWorld.mjs";

const CHAIN = ["20261101231015_job_continue_another_day.sql", "20261102102402_poster_continue_day_goes_to_the_helpr.sql"];
const FIX_FILE = "20261108160000_continue_day_resumes_checks_in_and_new_photos.sql";
const BEFORE = CHAIN[0].slice(0, 14);
const MODE = process.env.NEW_MIGRATION ?? "";
const PLANT = process.env.PLANT ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: the chain before the fix (expect FAILs)`);
if (PLANT) console.log(`PLANT=${PLANT}: a planted defect (expect FAILs)`);
const { P, A } = USERS; // P posts, A is the hired Helpr (Yusef)
const { check, failures } = checker();
const J = (n) => `e0000000-0000-0000-0000-0000000003${String(n).padStart(2, "0")}`;
const fn = (n) => newestFunctionSql(n, BEFORE).sql;

const db = new PGlite();
const q = async (sql, params) => (await db.query(sql, params)).rows;
await db.exec(baseSchema(BEFORE).replace("auto_suspended_until timestamptz);", "auto_suspended_until timestamptz, under_13_blocked_at timestamptz);"));
await db.exec(`
  alter table public.jobs
    add column if not exists poster_completed_at timestamptz, add column if not exists payout_scheduled_at timestamptz,
    add column if not exists poster_confirmed_arrival_at timestamptz, add column if not exists helper_arrival_verified_at timestamptz,
    add column if not exists helper_arrived_at timestamptz, add column if not exists poster_confirmed_working_at timestamptz,
    add column if not exists helper_on_the_way_at timestamptz,
    add column if not exists proof_before_urls text[], add column if not exists proof_after_urls text[];
  create function public.sell_for_me_listings_sent(uuid) returns boolean language sql stable as $f$ select true $f$;
  create or replace function public.member_display_name(p_full_name text, p_fallback text) returns text language sql immutable as
    $f$ select coalesce(nullif(split_part(btrim(p_full_name), ' ', 1), '') || coalesce(' ' || left(nullif(split_part(btrim(p_full_name), ' ', 2), ''), 1) || '.', ''), p_fallback) $f$;
  update public.profiles set full_name = 'Dana Poster' where user_id = '${P}';
  update public.profiles set full_name = 'Yusef Helpr' where user_id = '${A}';
  create table public.job_tracking (id uuid primary key default gen_random_uuid(), job_id uuid, helper_id uuid, status text,
    latitude numeric, longitude numeric, created_at timestamptz default now(), updated_at timestamptz default now());
  grant select, insert, update on public.job_tracking to authenticated;
  create table public.job_completion_nudges (job_id uuid primary key, first_sent_at timestamptz, second_sent_at timestamptz,
    escalated_at timestamptz, resolved_at timestamptz, resolved_by uuid, created_at timestamptz default now());
  create table public.notification_preferences (user_id uuid primary key, transit_updates boolean default true, work_status boolean default true);
  insert into public.notification_preferences (user_id, transit_updates) values ('${P}', false);
  create table public.notification_logs (user_id uuid, category text, channel text, status text, subject text, job_id uuid, error_message text);
  create function public.log_notification(_user_id uuid, _category text, _channel text, _status text, _subject text default null,
    _job_id uuid default null, _error text default null, _message_id text default null) returns void language sql as
    $f$ insert into public.notification_logs values (_user_id, _category, _channel, _status, _subject, _job_id, _error) $f$;
  create function public.get_supabase_url() returns text language sql stable as $f$ select 'https://x.supabase.co' $f$;
  create function public.get_service_role_key() returns text language sql stable as $f$ select 'service-key' $f$;
  create schema net;
  create table public.net_calls (id serial primary key, url text, body jsonb);
  create function net.http_post(url text, headers jsonb, body jsonb) returns bigint language sql as
    $f$ insert into public.net_calls (url, body) values (url, body) returning id::bigint $f$;
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
for (const f of CHAIN) await db.exec(readMigration(f));
// The poster's status notices as prod binds them (trg_notify_poster_status, 20260418215317), at the definition the
// fix restates (newest before it) so the RED run reads the old body.
await db.exec(newestFunctionSql("notify_poster_on_status_change", FIX_FILE.slice(0, 14)).sql);
await db.exec(`create trigger trg_notify_poster_status after update on public.jobs for each row execute function public.notify_poster_on_status_change();`);

let mig = readMigration(FIX_FILE);
const plant = (from, to) => {
  if (!mig.includes(from)) throw new Error(`plant ${PLANT}: anchor not found`);
  mig = mig.replace(from, to);
};
if (PLANT === "old_photos_count") plant("AND COALESCE(NEW.require_photo_proof, true) AND v_new_photo IS NULL THEN", "AND false THEN");
if (PLANT === "photo_any_time") plant("     AND now() >= ((c.new_date + c.new_start_time) AT TIME ZONE 'America/Chicago') - interval '2 hours';", "     ;");
if (PLANT === "no_tracker_reset") plant("     SET status = 'job_confirmed', updated_at = now()", "     SET updated_at = now()");
if (PLANT === "check_in_transit") plant("VALUES (v_job.customer_id, NEW.job_id, v_title, v_msg, 'job_updates',", "VALUES (v_job.customer_id, NEW.job_id, v_title, v_msg, 'transit_updates',");
if (PLANT === "no_evening") mig = mig.replaceAll("THEN 'evening_not_done_poster' END)", "THEN NULL END)").replaceAll("THEN 'evening_not_done_helpr' END),", "THEN NULL END),");
if (PLANT === "in_app_gated") plant("  INSERT INTO public.notifications (user_id, title, message, type, link, job_id)\n  VALUES (NEW.customer_id, v_title, v_msg, v_category, v_link, NEW.id);",
  "  IF v_category = 'transit_updates' THEN RETURN NEW; END IF;\n  INSERT INTO public.notifications (user_id, title, message, type, link, job_id)\n  VALUES (NEW.customer_id, v_title, v_msg, v_category, v_link, NEW.id);");
if (PLANT === "no_email") plant("  PERFORM public.send_notice_email(NEW.user_id, NEW.title, NEW.message, NEW.type, NEW.link);\n  RETURN NULL;", "  RETURN NULL;");
// Yusef's live job as it stands before the fix: a day agreed (set) for 2 days ago, tracker still 'done' from day 1.
await db.exec(`
  insert into public.jobs (id, title, budget, customer_id, helper_id, status, payment_status, date_needed, start_time,
                           helper_confirmed_at, poster_confirmed_arrival_at, helper_arrived_at, proof_before_urls, proof_after_urls, require_photo_proof)
  values ('${J(6)}', 'Mow and Weed Eat (live)', 40, '${P}', '${A}', 'in_progress', 'escrow', current_date - 7, '09:00',
          now() - interval '9 days', now() - interval '7 days', now() - interval '7 days', '{b.jpg}', '{a.jpg}', true);
  insert into public.job_continue_days (job_id, proposed_by, new_date, new_start_time, status) values ('${J(6)}', '${A}', current_date - 2, '15:15', 'set');
  insert into public.job_tracking (job_id, helper_id, status) values ('${J(6)}', '${A}', 'done');
`);
if (!MODE) for (let i = 0; i < 3; i++) await db.exec(mig); // replay-safe: applied 3x

// Jobs, all $40, Helpr A hired, money held, under way since yesterday, arrival confirmed, day-1 photos in.
//  1 Yusef's: A marked done on day 1      2 a day agreed, photos not required      3 a day 3 days out (stays out)
//  4 the evening check-in                 5 a fresh accepted job (on the way / done notices)
await db.exec(`
  insert into public.jobs (id, title, budget, customer_id, helper_id, status, payment_status, date_needed, start_time,
                           helper_confirmed_at, poster_confirmed_arrival_at, helper_arrived_at, proof_before_urls, proof_after_urls,
                           helper_completed_at, require_photo_proof)
  values ('${J(1)}', 'Mow and Weed Eat', 40, '${P}', '${A}', 'in_progress', 'escrow', current_date - 1, '09:00',
          now() - interval '3 days', now() - interval '30 hours', now() - interval '30 hours', '{b1.jpg,b2.jpg}', '{a1.jpg}', now() - interval '26 hours', true),
         ('${J(2)}', 'Paint the fence', 40, '${P}', '${A}', 'in_progress', 'escrow', current_date - 1, '09:00',
          now() - interval '3 days', now() - interval '30 hours', now() - interval '30 hours', null, null, null, false),
         ('${J(3)}', 'Move a couch', 40, '${P}', '${A}', 'in_progress', 'escrow', current_date - 1, '09:00',
          now() - interval '3 days', now() - interval '30 hours', now() - interval '30 hours', '{b.jpg}', '{a.jpg}', null, true),
         ('${J(4)}', 'Rake leaves', 40, '${P}', '${A}', 'in_progress', 'escrow', current_date - 1, '09:00',
          now() - interval '3 days', now() - interval '30 hours', now() - interval '30 hours', '{b.jpg}', '{a.jpg}', null, true),
         ('${J(5)}', 'Wash the car', 40, '${P}', '${A}', 'accepted', 'escrow', current_date, '09:00',
          now() - interval '3 days', null, null, '{b.jpg}', '{a.jpg}', null, true);
  insert into public.job_tracking (job_id, helper_id, status) values ('${J(1)}', '${A}', 'done'), ('${J(3)}', '${A}', 'working');
  insert into public.job_completion_nudges (job_id, first_sent_at) values ('${J(1)}', now() - interval '20 hours');
  insert into public.job_completion_nudges (job_id, first_sent_at, escalated_at) values ('${J(3)}', now() - interval '60 hours', now() - interval '10 hours');
`);
const DAY = (await q(`select ((now() at time zone 'America/Chicago')::date + 3)::text as d`))[0].d;
const call = (uid, sql) => as(db, "authenticated", uid, sql);
const propose = (uid, job, time = "09:00") => call(uid, `select public.propose_job_continue_day('${job}', '${DAY}'::date, '${time}'::time, null) as r`);
const answer = (uid, id, accept) => call(uid, `select public.answer_job_continue_day('${id}', ${accept}) as r`);
const active = async (job) => (await q(`select * from public.job_continue_days where job_id = $1 and status in ('proposed','set')`, [job]))[0] ?? null;
const jobRow = async (job) => (await q(`select * from public.jobs where id = $1`, [job]))[0];
const notes = async (uid, job) => q(`select title, message, type, link from public.notifications where user_id = $1 and job_id = $2 order by id`, [uid, job]);
const events = async (job) => (await q(`select action from public.job_continue_events where job_id = $1 order by created_at, action`, [job])).map((r) => r.action);
const emails = async () => (await q(`select body from public.net_calls order by id`)).map((r) => r.body);
const tracking = async (job) => (await q(`select status from public.job_tracking where job_id = $1`, [job]))[0]?.status ?? null;
const track = (job, status) => call(A, `update public.job_tracking set status = '${status}' where job_id = '${job}' and helper_id = '${A}'`);
const markDone = (job) => call(A, `select public.rpc_helper_mark_done('${job}') as r`);
const addAfter = (job, path) => call(A, `update public.jobs set proof_after_urls = coalesce(proof_after_urls, '{}') || '{${path}}'::text[] where id = '${job}'`);
/** The day's time has come: move the agreed day to start `mins` minutes ago (Central), as time passing would. */
const dayIsNow = (job, mins = 30) => db.exec(`
  update public.job_continue_days set new_date = ((now() - interval '${mins} minutes') at time zone 'America/Chicago')::date,
    new_start_time = ((now() - interval '${mins} minutes') at time zone 'America/Chicago')::time
   where job_id = '${job}' and status = 'set'`);

check("F3: a day agreed BEFORE the fix (Yusef's live job) gets the tracker reset once", (await tracking(J(6))) === "job_confirmed", String(await tracking(J(6))));

// 1. A day is agreed on Yusef's job (poster asks, Yusef accepts): F3 and the ladder restart.
const p1 = await propose(P, J(1));
check("the poster asks for another day", p1.ok, p1.err);
const a1 = await answer(A, (await active(J(1)))?.id, true);
check("...Yusef accepts it", a1.ok && a1.rows[0]?.r?.status === "set", a1.err);
check("...his day-1 done is cleared (as before)", (await jobRow(J(1))).helper_completed_at === null);
check("F3: the tracker no longer says 'done': it is back before On my way", (await tracking(J(1))) === "job_confirmed", String(await tracking(J(1))));
check("F1: the un-escalated stalled-nudge row is cleared, so the ladder starts over from the new day",
  (await q(`select 1 from public.job_completion_nudges where job_id = $1`, [J(1)])).length === 0);
const p3 = await propose(P, J(3));
await answer(A, (await active(J(3)))?.id, true);
check("F1: an ESCALATED row stays (a person already has it)", (await q(`select 1 from public.job_completion_nudges where job_id = $1`, [J(3)])).length === 1, p3.err);
check("F3: a tracker on 'working' is also reset", (await tracking(J(3))) === "job_confirmed", String(await tracking(J(3))));

// F4: the continue-day notices email (send-notification-email reads the switch, the master switch, test recipients).
const sent = await emails();
check("F4: 'New day to finish' (to Yusef) is emailed", sent.some((b) => b.title === "New day to finish" && b.user_id === A && b.type === "job_updates"));
check("F4: 'New day accepted' (to the poster) is emailed", sent.some((b) => b.title === "New day accepted" && b.user_id === P));

// 2. Check-ins before the day opens are refused (On my way turns on 2 hours before the start).
const early = await track(J(3), "on_the_way");
check("F2: On my way 3 days early is refused", refused(early, /continue_day_not_yet/), early.err ?? "ran");

// 3. The day has come: On my way, I've arrived, Start working each tell the poster once, as job_updates.
await dayIsNow(J(1));
for (const s of ["on_the_way", "arrived", "working"]) {
  const r = await track(J(1), s);
  check(`F2: the tracker step '${s}' is accepted on the new day`, r.ok, r.err);
}
const n1 = await notes(P, J(1));
check("F2: 'Yusef is on the way back' reaches the poster as job_updates (not the transit switch they turned off)",
  n1.some((n) => n.title === "Yusef is on the way back" && n.type === "job_updates" && n.link === `/posts?job=${J(1)}`), JSON.stringify(n1.map((n) => [n.title, n.type])));
check("F2: 'Yusef is back at the job' too", n1.some((n) => n.title === "Yusef is back at the job" && n.type === "job_updates"));
check("F2: 'Yusef started working again' too", n1.some((n) => n.title === "Yusef started working again" && n.type === "job_updates"));
const ev1 = await events(J(1));
check("F2: each check-in is in job_continue_events", ["helpr_on_the_way", "helpr_arrived", "helpr_started"].every((a) => ev1.includes(a)), ev1.join(","));
await track(J(1), "arrived");
await track(J(1), "working");
check("F2: a repeated step is not announced twice", (await notes(P, J(1))).filter((n) => n.title === "Yusef started working again").length === 1);

// 4. Q2: Mark done on the new day needs a photo from the new day; day 1's photos stay.
const done0 = await markDone(J(1));
check("Q2: Mark done on day 1's photos is refused on the new day", refused(done0, /continue_day_needs_new_after_photo/), done0.err ?? "ran");
const up = await addAfter(J(1), "a2.jpg");
check("Q2: the Helpr adds a new after photo", up.ok, up.err);
check("Q2: ...it is stamped as the new day's photo", !!(await active(J(1)))?.new_after_photo_at);
const done1 = await markDone(J(1));
check("Q2: ...then Mark done goes through", done1.ok, done1.err);
const j1 = await jobRow(J(1));
check("Q2: day 1's photos stay on the job as history", JSON.stringify(j1.proof_after_urls) === JSON.stringify(["a1.jpg", "a2.jpg"]) && j1.proof_before_urls.length === 2, JSON.stringify(j1.proof_after_urls));
check("F6: 'marked the job complete' emails the poster under Work status",
  (await emails()).some((b) => b.user_id === P && b.type === "work_status" && /marked the job complete/.test(b.title)));

// 5. A photo added BEFORE the day's window does not count.
const up3 = await addAfter(J(3), "early.jpg");
check("Q2: a photo added before the new day's window is not the new day's", up3.ok && !(await active(J(3)))?.new_after_photo_at, up3.err);

// 6. A job the poster excused from photos: no new photo needed.
await propose(P, J(2));
await answer(A, (await active(J(2)))?.id, true);
await dayIsNow(J(2));
const done2 = await markDone(J(2));
check("Q2: a job that needs no photos is marked done on the new day without one", done2.ok, done2.err);

// 7. The evening check-in (both sides), once.
await propose(P, J(4));
await answer(A, (await active(J(4)))?.id, true);
await dayIsNow(J(4), 60);
const eve = (await q(`select (greatest((c.new_date + time '19:00') at time zone 'America/Chicago',
                              ((c.new_date + c.new_start_time) at time zone 'America/Chicago') + interval '2 hours') + interval '5 minutes')::text as t
                       from public.job_continue_days c where c.job_id = $1 and c.status = 'set'`, [J(4)]))[0].t;
await q(`select public.sweep_job_continue_day_reminders($1::timestamptz)`, [eve]);
await q(`select public.sweep_job_continue_day_reminders($1::timestamptz)`, [eve]);
const h4 = await notes(A, J(4));
const p4 = await notes(P, J(4));
check("F1: the evening check-in asks Yusef 'Did you finish today?'", h4.filter((n) => n.title === "Did you finish today?").length === 1, JSON.stringify(h4.map((n) => n.title)));
check("F1: ...and tells the poster 'Not marked done yet'", p4.filter((n) => n.title === "Not marked done yet").length === 1, JSON.stringify(p4.map((n) => n.title)));
check("F4: the evening check-in is emailed", (await emails()).some((b) => b.title === "Not marked done yet" && b.user_id === P));

// 8. F5: "Helpr on the way" off no longer hides the in-app row; the email switch is real.
const otw = await as(db, "postgres", null, `update public.jobs set helper_on_the_way_at = now(), status = 'in_progress' where id = '${J(5)}'`);
check("a fresh job: the Helpr sets out", otw.ok, otw.err);
const n5 = await notes(P, J(5));
check("F5: the poster's in-app row is written although 'Helpr on the way' is off", n5.some((n) => n.title === "Yusef H. is on the way" && n.type === "transit_updates"), JSON.stringify(n5.map((n) => n.title)));
check("F5: ...and the email goes to send-notification-email as transit_updates (it reads email_transit_updates)",
  (await emails()).some((b) => b.user_id === P && b.type === "transit_updates" && b.title === "Yusef H. is on the way"));

console.log(failures() ? `\n${failures()} FAILED` : "\nALL PASS");
process.exit(failures() ? 1 : 0);
