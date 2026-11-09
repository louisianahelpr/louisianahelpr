#!/usr/bin/env node
/**
 * PGlite proof for 20261108202000_no_show_notice_server_side (Jobs audit 11-08 #7, #12).
 *
 *   node src/test/pglite/noShowNoticeServerSide.pglite.mjs                    # GREEN (the migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/noShowNoticeServerSide.pglite.mjs # RED (20261102100421's body)
 *   MUTANT=<name> node src/test/pglite/noShowNoticeServerSide.pglite.mjs      # a planted defect: must FAIL
 *
 * Minimal schema (noShowClosesTheApplication.pglite.mjs's, plus parent_job_id, notifications with the live exact-
 * duplicate suppressor, and a series_release_dates stub that records its call). apply_consequence_ladder is stubbed
 * to answer the rung the test sets.
 *   N1 a poster's solo no-show report writes the Helpr's notice in the same transaction (RED before: none)
 *   N2 its words, type and link are exactly create-notification 'no_show_reported''s, so an older app's second call
 *      is suppressed as an exact duplicate (one row)
 *   N3 the second report (pending_ban_review) writes the restriction notice, type 'warning'
 *   N4 a recurring visit's date goes back to the series for that Helpr (series_release_dates called once, after the
 *      reopen); a one-off job calls nothing
 *   N5 a non-poster is refused and nothing is written
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const THIS = "20261108202000_no_show_notice_server_side.sql";
const skip = process.env.NEW_MIGRATION === "skip";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // The notice is written and then thrown away (nothing reaches the Helpr).
  noNotice: ["    '/profile?tab=warnings',\n    p_job_id\n  );", "    '/profile?tab=warnings',\n    p_job_id\n  ); DELETE FROM public.notifications WHERE user_id = v_helper_id AND link = '/profile?tab=warnings';"],
  words: ["'You received a no-show warning for \"'", "'You got a no-show warning for \"'"],
  noRelease: ["  IF v_parent_job_id IS NOT NULL THEN\n    v_released", "  IF false THEN\n    v_released"],
  wrongHelper: ["public.series_release_dates(v_parent_job_id, v_helper_id,", "public.series_release_dates(v_parent_job_id, auth.uid(),"],
  // The no-show release reads as "gave up".
  gaveUp: ["                    WHEN p_reason = 'no_show'\n", "                    WHEN false\n"],
};
if (MUTANT && !MUTANTS[MUTANT]) throw new Error(`unknown MUTANT ${MUTANT}`);

const cutFn = (file, name) => {
  const sql = mig(file);
  const m = [...sql.matchAll(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`, "g"))].at(-1);
  const open = /\bAS\s+(\$\w*\$)/i.exec(sql.slice(m.index));
  const start = m.index + open.index + open[0].length;
  return sql.slice(m.index, sql.indexOf(open[1], start) + open[1].length) + ";";
};
const P = "00000000-0000-0000-0000-00000000000a", A = "00000000-0000-0000-0000-00000000000b", X = "00000000-0000-0000-0000-00000000000e";
const J = "00000000-0000-0000-0000-0000000000f1", SERIES = "00000000-0000-0000-0000-0000000000f9";

const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true),'')::uuid $$;
create table public.jobs (id uuid primary key, customer_id uuid, helper_id uuid, title text, payment_status text, date_needed date, start_time time,
  helper_arrived_at timestamptz, helper_completed_at timestamptz, helper_arrival_near_miss_at timestamptz, helper_confirmed_at timestamptz, status text,
  response_deadline timestamptz, helper_dayof_confirmed_at timestamptz, dayof_confirm_reminder_sent_at timestamptz,
  dayof_unanswered_poster_alert_sent_at timestamptz, start_reminder_sent_at timestamptz, parent_job_id uuid);
create table public.applications (id serial primary key, job_id uuid, helper_id uuid, status text, closed_reason text);
create table public.user_violations (id serial primary key, user_id uuid, violation_type text, description text, job_id uuid, action_taken text, reported_by uuid);
create table public.rung (action text);
insert into public.rung values ('warning');
create function public.apply_consequence_ladder(p_user uuid, p_violation_type text, p_description text, p_job_id uuid, p_prior_count integer, p_rungs text[], p_effects text[], p_copy jsonb, p_permanent_requires_review boolean, p_suspension_days integer, p_clamp_to_worse_status boolean, p_admin_message_format text, p_ban_reason text)
 returns jsonb language plpgsql as $$ begin insert into public.user_violations (user_id, violation_type, description, job_id, action_taken) values (p_user,p_violation_type,p_description,p_job_id,'warning'); return jsonb_build_object('action',(select action from public.rung),'prior_count',p_prior_count); end $$;
create table public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid, title text not null, message text not null, type text, link text,
  job_id uuid, created_at timestamptz not null default now());
create table public.notification_dedupe_suppressions (user_id uuid, type text, title text, link text);
create table public.profiles (user_id uuid primary key, full_name text);
insert into public.profiles values ('${A}', 'Eli Robichaux');
create function public.member_display_name(n text, f text) returns text language sql immutable as $$ select coalesce(split_part(n, ' ', 1) || ' ' || left(split_part(n, ' ', 2), 1) || '.', f) $$;
create table public.series_visit_holds (parent_job_id uuid, helper_id uuid, visit_date date);
create table public.recurring_visit_releases (parent_job_id uuid, helper_id uuid, visit_date date, reason text, created_at timestamptz default now(),
  unique (parent_job_id, visit_date));
`);
await db.exec(cutFn("20260912045624_suppress_exact_duplicate_notifications.sql", "suppress_exact_duplicate_notification"));
await db.exec(`create trigger suppress_dup before insert on public.notifications for each row execute function public.suppress_exact_duplicate_notification();`);
await db.exec(cutFn("20261102100421_no_start_time_job_is_due_at_the_end_of_its_day.sql", "report_helper_no_show"));
await db.exec(cutFn("20261104050109_notices_name_the_person.sql", "series_release_dates"));
if (!skip) {
  let sql = mig(THIS);
  if (MUTANT) {
    const [find, repl] = MUTANTS[MUTANT];
    if (!sql.includes(find)) throw new Error(`MUTANT ${MUTANT}: text not found`);
    sql = sql.replace(find, repl);
  }
  for (let i = 0; i < 3; i++) await db.exec(sql);
  console.log("migration applied 3x");
} else console.log("NEW_MIGRATION=skip: 20261102100421's report_helper_no_show");

let failed = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  ${extra}`}`); if (!cond) failed++; };
const rows = async (q) => (await db.query(q)).rows;
const seed = (parent = null, title = "Mow and Weed Eat") => db.exec(`
  delete from public.notifications; delete from public.recurring_visit_releases; delete from public.series_visit_holds;
  insert into public.series_visit_holds values ('${SERIES}', '${A}', current_date - 2); delete from public.applications; delete from public.user_violations; delete from public.jobs;
  insert into public.jobs (id, customer_id, helper_id, title, payment_status, date_needed, start_time, helper_confirmed_at, status, parent_job_id)
    values ('${J}','${P}','${A}','${title}','escrow',current_date - 2,'09:00', now() - interval '3 days','in_progress', ${parent ? `'${parent}'` : "null"});
  insert into public.applications (job_id, helper_id, status) values ('${J}','${A}','accepted');`);
const call = async (uid) => {
  await db.exec(`select set_config('test.uid','${uid}',false)`);
  try { await db.query(`select public.report_helper_no_show('${J}')`); return "ok"; } catch (e) { return e.message; }
};
const told = () => rows(`select title, message, type, link, job_id from public.notifications where user_id = '${A}'`);

// N1/N2: the warning.
await seed();
ok("N1 the report succeeds", (await call(P)) === "ok");
const n1 = await told();
ok("N1 the Helpr's notice is written by the RPC", n1.length === 1, JSON.stringify(n1));
// The template's build, transcribed: create-notification 'no_show_reported' for a warning.
const want = { title: "⚠️ No-show warning", message: 'You received a no-show warning for "Mow and Weed Eat".', type: "job_updates", link: "/profile?tab=warnings" };
ok("N2 its words, type and link are the template's", n1.length === 1 && Object.entries(want).every(([k, v]) => n1[0][k] === v) && n1[0].job_id === J, JSON.stringify(n1));
await db.query(`insert into public.notifications (user_id, title, message, type, link, job_id) values ($1,$2,$3,$4,$5,$6)`, [A, want.title, want.message, want.type, want.link, J]);
ok("N2 an older app's identical call is suppressed (still one row)", (await told()).length === 1);

// N3: the restriction.
await seed();
await db.exec(`update public.rung set action = 'pending_ban_review'`);
await call(P);
const n3 = await told();
ok("N3 the second report writes the restriction notice as 'warning'", n3.length === 1 && n3[0].title === "⛔ Account restricted for 7 days" && n3[0].type === "warning", JSON.stringify(n3));
await db.exec(`update public.rung set action = 'warning'`);

// N4: series.
await seed(SERIES);
await call(P);
const r4 = await rows(`select helper_id, reason from public.recurring_visit_releases`);
ok("N4 a recurring visit's date is released for the no-show Helpr (after the reopen: a vacated visit)", r4.length === 1 && r4[0].helper_id === A && r4[0].reason === "no_show" && (await rows(`select 1 from public.series_visit_holds`)).length === 0, JSON.stringify(r4));
const n4 = await rows(`select message from public.notifications where user_id = '${P}' and job_id = '${SERIES}'`);
ok("N4 the poster reads that the Helpr didn't show up, not that they gave the date up", n4.length === 1 && /Eli R\. didn't show up for /.test(n4[0].message) && !/gave up/.test(n4[0].message), JSON.stringify(n4));
await seed();
await call(P);
ok("N4 a one-off job releases nothing", (await rows(`select 1 from public.recurring_visit_releases`)).length === 0);

// N5: a non-poster.
await seed();
ok("N5 a non-poster is refused", (await call(X)) === "not_authorized");
ok("N5 nothing written", (await told()).length === 0 && (await rows(`select status from public.jobs`))[0].status === "in_progress");

if (!skip) {
  const acl = (await rows(`select proacl::text as acl, prosecdef from pg_proc where proname = 'report_helper_no_show'`))[0];
  ok("grants: definer; authenticated + service_role, not anon", acl.prosecdef && /authenticated=X/.test(acl.acl) && !/(^|[{,])anon=/.test(acl.acl), acl.acl);
}
console.log(failed ? `\n${failed} FAILED` : "\nall PASS");
process.exit(failed ? 1 : 0);
