#!/usr/bin/env node
/**
 * PGlite proof for 20261029180706_application_closed_by_no_show (audit 2026-10-29 A2-B14 follow-up).
 *
 *   PGLITE_DIR=~/.lh-pglite node src/test/pglite/noShowClosesTheApplication.pglite.mjs
 *
 * A minimal schema (the columns report_helper_no_show reads and writes; applications_closed_reason_check as
 * of 20261008205730), then:
 *   OLD STATE: the newest body before this migration (20261029154727) closes the struck Helpr's application
 *   'rejected' with closed_reason NULL (printed, RED by design: it reads "Declined" / "You weren't picked").
 *   NEW STATE: the migration is applied 3x (replay-safe): the poster's report closes it with closed_reason
 *   'no_show'; a non-poster is refused and changes nothing; the constraint still refuses an unknown reason;
 *   one SECURITY DEFINER definition; anon/PUBLIC cannot run it, authenticated and service_role can.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const prior = mig("20261029154727_no_show_closes_struck_application.sql");
const mig2 = mig("20261029180706_application_closed_by_no_show.sql");
const P = "00000000-0000-0000-0000-00000000000a", A = "00000000-0000-0000-0000-00000000000b", X = "00000000-0000-0000-0000-00000000000e";
const J = "00000000-0000-0000-0000-0000000000f1";
const fresh = async () => {
  const db = new PGlite();
  await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true),'')::uuid $$;
create table public.jobs (id uuid primary key, customer_id uuid, helper_id uuid, title text, payment_status text, date_needed date, start_time time,
  helper_arrived_at timestamptz, helper_completed_at timestamptz, helper_arrival_near_miss_at timestamptz, helper_confirmed_at timestamptz, status text,
  response_deadline timestamptz, helper_dayof_confirmed_at timestamptz, dayof_confirm_reminder_sent_at timestamptz,
  dayof_unanswered_poster_alert_sent_at timestamptz, start_reminder_sent_at timestamptz);
create table public.applications (id serial primary key, job_id uuid, helper_id uuid, status text, closed_reason text);
-- constraint as of 20261008205730 (newest before 20261029180706)
alter table public.applications add constraint applications_closed_reason_check
  check (closed_reason is null or closed_reason in ('job_cancelled', 'party_blocked', 'offer_expired', 'not_confirmed'));
create table public.user_violations (id serial primary key, user_id uuid, violation_type text, description text, job_id uuid, action_taken text, reported_by uuid);
create function public.apply_consequence_ladder(p_user uuid, p_violation_type text, p_description text, p_job_id uuid, p_prior_count integer, p_rungs text[], p_effects text[], p_copy jsonb, p_permanent_requires_review boolean, p_suspension_days integer, p_clamp_to_worse_status boolean, p_admin_message_format text, p_ban_reason text)
 returns jsonb language plpgsql as $$ begin insert into public.user_violations (user_id, violation_type, description, job_id, action_taken) values (p_user,p_violation_type,p_description,p_job_id,'warning'); return jsonb_build_object('action','warning','prior_count',p_prior_count); end $$;
`);
  await db.exec(prior);
  return db;
};
const seed = async (db) => db.exec(`
insert into jobs (id, customer_id, helper_id, title, payment_status, date_needed, start_time, helper_confirmed_at, status)
  values ('${J}','${P}','${A}','t','escrow',current_date - 2,'09:00', now() - interval '3 days','in_progress');
insert into applications (job_id, helper_id, status) values ('${J}','${A}','accepted');`);
const call = async (db, uid) => {
  await db.exec(`select set_config('test.uid','${uid}',false)`);
  try { await db.query(`select public.report_helper_no_show('${J}')`); return "ok"; } catch (e) { return e.message; }
};
const app = async (db) => (await db.query(`select status, closed_reason from applications order by id limit 1`)).rows[0];
let fail = 0;
const check = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++; console.log(`${ok ? "PASS" : "FAIL"} ${label}: ${JSON.stringify(got)}${ok ? "" : ` (want ${JSON.stringify(want)})`}`); };

// Phase A: prior body only (the defect)
{
  const db = await fresh(); await seed(db);
  check("A prior body: report ok", await call(db, P), "ok");
  const a = await app(db);
  console.log(`A prior body: application = ${JSON.stringify(a)} -> ${a.closed_reason === "no_show" ? "UNEXPECTED (defect absent)" : "RED as expected: closed_reason NULL reads Declined / You weren't picked"}`);
}
// Phase B: new migration 3x
{
  const db = await fresh();
  for (let i = 0; i < 3; i++) await db.exec(mig2);
  console.log("B applied new migration 3x: no error");
  await seed(db);
  check("B non-poster refused", await call(db, X), "not_authorized");
  check("B non-poster left application alone", await app(db), { status: "accepted", closed_reason: null });
  check("B poster report ok", await call(db, P), "ok");
  check("B application closed as no-show", await app(db), { status: "rejected", closed_reason: "no_show" });
  check("B job reopened", (await db.query(`select status, helper_id from jobs`)).rows[0], { status: "open", helper_id: null });
  let bogus; try { await db.exec(`insert into applications (job_id, helper_id, status, closed_reason) values ('${J}','${X}','rejected','bogus')`); bogus = "accepted"; } catch { bogus = "refused"; }
  check("B constraint still refuses an unknown reason", bogus, "refused");
  const acl = (await db.query(`select proacl::text as acl, prosecdef from pg_proc where proname = 'report_helper_no_show'`)).rows;
  check("B one definition", acl.length, 1);
  check("B security definer", acl[0].prosecdef, true);
  check("B anon/PUBLIC have no EXECUTE", /(^|[{,])anon=/.test(acl[0].acl) || /(^|[{,])=X/.test(acl[0].acl), false);
  check("B authenticated + service_role EXECUTE", /authenticated=X/.test(acl[0].acl) && /service_role=X/.test(acl[0].acl), true);
  console.log("B proacl:", acl[0].acl);
}
console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
