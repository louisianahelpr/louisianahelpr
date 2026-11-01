#!/usr/bin/env node
/**
 * PGlite proof for 20261101180708_direct_offer_notice_next_step (audit 11-01 JA-58, owner 11-01 next-step rule).
 *
 *   PGLITE_DIR=~/.lh-pglite node src/test/pglite/directOfferNoticeNextStep.pglite.mjs
 *   NEW_MIGRATION=skip ... runs the same checks on the pre-fix function (RED).
 *
 * notify_helper_on_direct_offer is read from the migrations (the newest definition before the fix), never
 * retyped; the fix then runs verbatim on top, 3x. Stubbed, and said so: job_payment_is_listed (escrow = listed),
 * job_offer_cutoff (a day out), quote_job_offered_to_quoter (false), member_display_name (first word + initial).
 */
import { PGlite, readMigration, newestFunctionSql, checker, USERS } from "./seriesWorld.mjs";

const FIX_FILE = "20261101180708_direct_offer_notice_next_step.sql";
const SKIP = process.env.NEW_MIGRATION === "skip";
const { P, A } = USERS;
const { check, failures } = checker();

const pre = newestFunctionSql("notify_helper_on_direct_offer", FIX_FILE.slice(0, 14)).sql;
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create type public.job_status as enum ('open','accepted','cancelled');
  create table public.profiles (user_id uuid primary key, full_name text);
  insert into public.profiles values ('${P}', 'Dana Smith'), ('${A}', 'Yusef Ali');
  create table public.notifications (id serial primary key, user_id uuid, title text, message text, type text, link text, job_id uuid);
  create table public.jobs (id uuid primary key default gen_random_uuid(), title text, budget numeric default 120,
    customer_id uuid, status public.job_status not null default 'open', payment_status text default 'escrow',
    offered_to_helper_id uuid, direct_offer_status text, direct_offer_expires_at timestamptz,
    instant_decline_until timestamptz, date_needed date, start_time time);
  create function public.job_payment_is_listed(text) returns boolean language sql immutable as $f$ select $1 = 'escrow' $f$;
  create function public.job_offer_cutoff(date, time) returns timestamptz language sql stable as $f$ select now() + interval '1 day' $f$;
  create function public.quote_job_offered_to_quoter(uuid, uuid) returns boolean language sql stable as $f$ select false $f$;
  create function public.member_display_name(text, text) returns text language sql immutable as
    $f$ select coalesce(split_part($1, ' ', 1) || ' ' || left(split_part($1, ' ', 2), 1) || '.', $2) $f$;
  ${pre}
  create trigger trg_notify_helper_on_direct_offer after insert or update of offered_to_helper_id on public.jobs
    for each row execute function public.notify_helper_on_direct_offer();
`);
if (!SKIP) {
  for (let i = 0; i < 3; i++) await db.exec(readMigration(FIX_FILE));
  check("the fix applies 3x (replay-safe)", true);
} else console.log("-- NEW_MIGRATION=skip: checking the PRE-FIX function (expect FAIL lines)");

const q = async (sql) => (await db.query(sql)).rows;
// Sat Nov 7 2026 15:00Z = 9:00 AM in Louisiana (CST).
const j = (await q(`insert into public.jobs (title, customer_id, offered_to_helper_id, direct_offer_status, direct_offer_expires_at)
  values ('Move a couch', '${P}', '${A}', 'pending', '2099-11-07T15:00:00Z') returning id`))[0].id;
const n = (await q(`select * from public.notifications where job_id = '${j}'`))[0];
check("the Helpr is told", n?.user_id === A, JSON.stringify(n));
check("the title still keys the offer text (sms_kind_for)", n?.title === "You got a direct job offer!", n?.title);
check("no dollar figure (the budget is not the take-home)", !/\$/.test(n?.message ?? ""), n?.message);
check("names the poster and the next step with its deadline", /^Dana S\. offered you "Move a couch"\. Next: accept by Sat 9 AM, or the offer expires\./.test(n?.message ?? ""), n?.message);
check("opens the job page, not the list", n?.link === `/jobs/${j}`, n?.link);

const j2 = (await q(`insert into public.jobs (title, customer_id, offered_to_helper_id, direct_offer_status, direct_offer_expires_at)
  values ('Rake leaves', '${P}', '${A}', 'pending', null) returning id`))[0].id;
const n2 = (await q(`select message from public.notifications where job_id = '${j2}'`))[0];
check("no expiry stored: 'accept soon', never a blank time", /Next: accept soon, or the offer expires\./.test(n2?.message ?? ""), n2?.message);

const acl = (await q(`select proacl::text as a from pg_proc where proname = 'notify_helper_on_direct_offer'`))[0]?.a ?? "";
check("no EXECUTE for PUBLIC or anon", !SKIP ? !/(^|[{,])=X|anon=X/.test(acl) : true, acl);

process.exit(failures() ? 1 : 0);
