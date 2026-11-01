#!/usr/bin/env node
/**
 * PGlite proof for 20261101183017_unread_message_reminders (owner 11-01: unread messages remind).
 *
 *   PGLITE_DIR=~/.lh-pglite node src/test/pglite/unreadMessageReminders.pglite.mjs
 *   NEW_MIGRATION=skip ... runs the checks with no sweep at all (RED: nothing is ever reminded).
 *
 * The migration runs verbatim, 3x. Stubbed, and said so: member_display_name (first word + initial), the
 * messages / thread_mutes / profiles / notifications tables (only the columns the sweep reads), no cron schema
 * (the DO block skips cron.schedule), no cron_work_expectations.
 */
import { PGlite, readMigration, checker } from "./seriesWorld.mjs";
import { installClock, newestFunction, onFixedClock, setClock } from "./lib/fixedClock.mjs";

const FIX = "20261101183017_unread_message_reminders.sql";
const SKIP = process.env.NEW_MIGRATION === "skip";
const { check, failures } = checker();
const P = "11111111-1111-1111-1111-111111111111"; // poster (recipient)
const H = "22222222-2222-2222-2222-222222222222"; // Helpr (sender)
const J = "33333333-3333-3333-3333-333333333333";
const J2 = "44444444-4444-4444-4444-444444444444";

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create table auth.users (id uuid primary key);
  insert into auth.users values ('${P}'), ('${H}');
  create table public.profiles (user_id uuid primary key, full_name text);
  insert into public.profiles values ('${P}', 'Lexi Lombas'), ('${H}', 'Hallie Hebert');
  create table public.messages (id uuid primary key default gen_random_uuid(), job_id uuid, sender_id uuid, receiver_id uuid,
    content text, read boolean not null default false, created_at timestamptz not null default now(),
    flagged_hidden boolean default false, is_system boolean default false, team_thread_user_id uuid);
  create table public.thread_mutes (user_id uuid, job_id uuid, other_user_id uuid, mute_until timestamptz);
  create table public.notifications (id serial primary key, user_id uuid, title text, message text, type text, link text, job_id uuid);
  create function public.member_display_name(text, text) returns text language sql immutable as
    $f$ select coalesce(split_part($1, ' ', 1) || ' ' || left(split_part($1, ' ', 2), 1) || '.', $2) $f$;
`);
if (!SKIP) {
  for (let i = 0; i < 3; i++) await db.exec(readMigration(FIX));
  check("the migration applies 3x (replay-safe)", true);
} else {
  console.log("-- NEW_MIGRATION=skip: no sweep (expect FAIL lines)");
  await db.exec(`create function public.sweep_unread_message_reminders(p_now timestamptz) returns integer language sql as $f$ select 0 $f$;`);
}
const q = async (s) => (await db.query(s)).rows;
const sweep = async (at) => (await q(`select public.sweep_unread_message_reminders('${at}'::timestamptz) n`))[0].n;
const notes = async () => q(`select * from public.notifications order by id`);
// 2026-11-02 is a Monday; CST = UTC-6.
const msg = async (at, job = J, extra = "") =>
  (await q(`insert into public.messages (job_id, sender_id, receiver_id, content, created_at${extra ? ", " + extra.split("=")[0] : ""})
            values ('${job}', '${H}', '${P}', 'Are you home?', '${at}'${extra ? ", " + extra.split("=")[1] : ""}) returning id`))[0].id;

// TIMING. A message at 10:00 AM CST (16:00Z).
const m1 = await msg("2026-11-02T16:00:00Z");
check("10 minutes old: nothing yet", (await sweep("2026-11-02T16:10:00Z")) === 0);
check("15 minutes old: one reminder", (await sweep("2026-11-02T16:15:00Z")) === 1);
const n1 = (await notes())[0];
check("it goes to the recipient, as a message notice (push + text kind 'message')", n1?.user_id === P && n1?.type === "message", JSON.stringify(n1));
check("it names the sender and says the next step", n1?.message === "Hallie H. is waiting on your reply. Next: open the message and reply.", n1?.message);
check("it carries the thread link that marks it read with the thread", n1?.link === `/messages?jobId=${J}&userId=${H}`, n1?.link);
check("no second reminder before 2 hours", (await sweep("2026-11-02T17:00:00Z")) === 0);
check("at 2 hours, one more", (await sweep("2026-11-02T18:00:00Z")) === 1);
check("...in different words (never dropped as an exact duplicate)", (await notes())[1]?.message.startsWith("Hallie H. is still waiting"), (await notes())[1]?.message);
check("never a third for the same message", (await sweep("2026-11-02T21:00:00Z")) === 0);

// READ stops it.
const m2 = await msg("2026-11-02T16:00:00Z", J2);
await q(`update public.messages set read = true where id = '${m2}'`);
check("a read message is never reminded", (await sweep("2026-11-02T16:30:00Z")) === 0);

// CAP: 2 per conversation per day. A new unread message in the same thread the same day gets nothing more.
const m3 = await msg("2026-11-02T19:00:00Z");
await q(`update public.messages set read = true where id = '${m1}'`);
check("cap: a third reminder in one conversation the same day is not sent", (await sweep("2026-11-02T19:20:00Z")) === 0);
check("...the next Louisiana day it is", (await sweep("2026-11-03T14:05:00Z")) === 1); // 8:05 AM CST

// QUIET HOURS: 9 PM to 8 AM Central, queued to 8 AM.
await q(`update public.messages set read = true`);
const m4 = await msg("2026-11-04T03:00:00Z", J2); // 9:00 PM CST Nov 3
check("9:20 PM: nothing (quiet)", (await sweep("2026-11-04T03:20:00Z")) === 0);
check("7:55 AM: nothing (quiet)", (await sweep("2026-11-04T13:55:00Z")) === 0);
check("8:00 AM: the queued reminder goes", (await sweep("2026-11-04T14:00:00Z")) === 1);
check("8:05 AM: not its 2-hour one in the next run (an hour after the first, at least)", (await sweep("2026-11-04T14:05:00Z")) === 0);
check("9:00 AM: the 2-hour one", (await sweep("2026-11-04T15:00:00Z")) === 1);

// SKIPS: muted thread, hidden, system, team thread.
await q(`update public.messages set read = true`);
await msg("2026-11-05T16:00:00Z", J);
await q(`insert into public.thread_mutes values ('${P}', '${J}', '${H}', null)`);
await msg("2026-11-05T16:00:00Z", J2, "flagged_hidden=true");
check("a muted thread and a hidden message are not reminded", (await sweep("2026-11-05T16:20:00Z")) === 0);

// FIXED CLOCK (Q1357): the cron call passes no time, so the sweep reads now() (its DEFAULT). The newest
// "sweep_unread_message_reminders" is reloaded with now() pointed at a fixed instant either side of 15 minutes.
if (!SKIP) {
  await installClock(db);
  await db.exec(onFixedClock(newestFunction("sweep_unread_message_reminders").stmt));
  await q(`update public.messages set read = true`);
  await q(`delete from public.thread_mutes`);
  await msg("2026-11-06T16:00:00Z", J2);
  await setClock(db, "2026-11-06T16:14:59Z");
  check("fixed clock: 1 s before 15 minutes, the no-argument sweep sends nothing", (await q(`select public.sweep_unread_message_reminders() n`))[0].n === 0);
  await setClock(db, "2026-11-06T16:15:00Z");
  check("fixed clock: at 15 minutes, the no-argument sweep sends one", (await q(`select public.sweep_unread_message_reminders() n`))[0].n === 1);
}

const acl = (await q(`select proacl::text a from pg_proc where proname = 'sweep_unread_message_reminders'`))[0]?.a ?? "";
check("no EXECUTE for PUBLIC, anon or authenticated", SKIP || !/(^|[{,])=X|anon=X|authenticated=X/.test(acl), acl);
void m3; void m4;
process.exit(failures() ? 1 : 0);
