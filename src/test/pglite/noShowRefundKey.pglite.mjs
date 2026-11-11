#!/usr/bin/env node
/**
 * PGlite proof for F272 (owner 11-11 ~2:50 PM): a no-show job's refund is FULL.
 *
 *   node src/test/pglite/noShowRefundKey.pglite.mjs                 # GREEN
 *   MUTANT=<name> node src/test/pglite/noShowRefundKey.pglite.mjs   # a planted defect: must FAIL
 *
 * void-cancelled-payments refunds a cancelled job in full when the job carries a recorded no-show and no confirmed
 * Helpr now (noShowFullRefund: user_violations job_id + violation_type 'no_show', jobs.helper_confirmed_at IS NULL,
 * not a crew); create-payment cancel_quote reads the same key. The sweep is an edge function (its arithmetic is proved
 * in src/test/edge/void-cancelled-payments.noShowFullRefund.test.ts); this proves the DATABASE half: that the REAL
 * report_helper_no_show (the newest migration body) and the REAL apply_consequence_ladder leave exactly that key
 * behind, and that nothing else does.
 *   K1 after a poster's no-show report the key reads TRUE (a 'no_show' row on the job, helper_confirmed_at cleared)
 *   K2 a job reopened any other way (an unanswered offer expiry, a Helpr's own cancel) reads FALSE
 *   K3 a no-show job that later hires and confirms a new Helpr reads FALSE (today's rule applies)
 *   K4 another job of the same Helpr's no-show does not leak: the key is per job
 */
import os from "node:os";
import { installClock, newestFunction, onFixedClock, setClock } from "./lib/fixedClock.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MUTANT = process.env.MUTANT ?? "";
// Each plants a defect in the report body (the DB half of the key) or in the key itself.
const MUTANTS = {
  // The ladder row is written with no job (the key could never find it).
  noJobOnRow: ["    p_job_id                    => p_job_id,", "    p_job_id                    => NULL,"],
  // The reopen keeps the departed Helpr's confirmation.
  keepsConfirm: ["         helper_confirmed_at = NULL,\n", ""],
};
if (MUTANT && !MUTANTS[MUTANT] && MUTANT !== "keyIgnoresConfirm") throw new Error(`unknown MUTANT ${MUTANT}`);

const P = "00000000-0000-0000-0000-00000000000a", A = "00000000-0000-0000-0000-00000000000b", B = "00000000-0000-0000-0000-00000000000c";
const J = "00000000-0000-0000-0000-0000000000f1", J2 = "00000000-0000-0000-0000-0000000000f2";

const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true),'')::uuid $$;
create table public.jobs (id uuid primary key, customer_id uuid, helper_id uuid, title text, payment_status text, date_needed date, start_time time,
  helper_arrived_at timestamptz, helper_completed_at timestamptz, helper_arrival_near_miss_at timestamptz, helper_confirmed_at timestamptz, status text,
  response_deadline timestamptz, helper_dayof_confirmed_at timestamptz, dayof_confirm_reminder_sent_at timestamptz,
  dayof_unanswered_poster_alert_sent_at timestamptz, start_reminder_sent_at timestamptz, parent_job_id uuid, is_group_job boolean default false);
create table public.applications (id serial primary key, job_id uuid, helper_id uuid, status text, closed_reason text);
create table public.user_violations (id serial primary key, user_id uuid, violation_type text, description text, job_id uuid, action_taken text,
  reported_by uuid, created_at timestamptz default now());
create table public.profiles (user_id uuid primary key, full_name text, email text, ban_status text, auto_suspended_until timestamptz);
insert into public.profiles (user_id, full_name) values ('${A}', 'Eli Robichaux'), ('${B}', 'Bea Thibodeaux');
create table public.user_bans (user_id uuid, ban_type text, reason text, banned_by uuid);
create table public.user_roles (user_id uuid, role text);
create table public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid, title text not null, message text not null, type text, link text,
  job_id uuid, read boolean default false, created_at timestamptz not null default now());
create function public.series_release_dates(p_parent uuid, p_helper uuid, p_dates date[], p_reason text, p_title text, p_customer uuid)
 returns date[] language sql as $$ select array[]::date[] $$;
`);
await installClock(db);
await db.exec(newestFunction("apply_consequence_ladder").stmt);
const report = newestFunction("report_helper_no_show");
let body = report.stmt;
if (MUTANTS[MUTANT]) {
  const [find, repl] = MUTANTS[MUTANT];
  if (!body.includes(find)) throw new Error(`MUTANT ${MUTANT}: text not found`);
  body = body.split(find).join(repl);
}
for (let i = 0; i < 3; i++) await db.exec(onFixedClock(body));
console.log(`report_helper_no_show from ${report.file} (applied 3x), the real apply_consequence_ladder`);

// THE key, exactly as void-cancelled-payments and create-payment cancel_quote read it.
const keySql = MUTANT === "keyIgnoresConfirm"
  ? `select exists (select 1 from public.user_violations v where v.job_id = j.id and v.violation_type = 'no_show') as k from public.jobs j where j.id = $1`
  : `select (j.is_group_job is not true and j.helper_confirmed_at is null
            and exists (select 1 from public.user_violations v where v.job_id = j.id and v.violation_type = 'no_show')) as k
       from public.jobs j where j.id = $1`;
const key = async (id) => (await db.query(keySql, [id])).rows[0].k;

let failed = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  ${extra}`}`); if (!cond) failed++; };
const seed = (id, helper) => db.exec(`
  insert into public.jobs (id, customer_id, helper_id, title, payment_status, date_needed, start_time, helper_confirmed_at, status)
    values ('${id}','${P}','${helper}','Mow and Weed Eat','escrow','2026-11-12','09:00', '2026-11-01T00:00:00Z','in_progress');
  insert into public.applications (job_id, helper_id, status) values ('${id}','${helper}','accepted');`);

await setClock(db, "2026-11-12T16:00:00Z"); // 10:00 AM Central, past 9:30
await seed(J, A);
await seed(J2, A);
ok("K2 a booked job before any report: key FALSE", (await key(J)) === false);

await db.exec(`select set_config('test.uid','${P}',false)`);
let err = "";
try { await db.query(`select public.report_helper_no_show('${J}')`); } catch (e) { err = e.message; }
ok("K1 the report succeeds", err === "", err);
ok("K1 after the report the key reads TRUE (full refund on cancel)", (await key(J)) === true);
ok("K4 the same Helpr's other job does not read the key", (await key(J2)) === false);

// K2: a reopen with no report (the shape auto-expire-jobs' step 1 / an offer expiry leaves).
await db.exec(`update public.jobs set status = 'open', helper_id = null, helper_confirmed_at = null where id = '${J2}'`);
ok("K2 a job reopened with no no-show report: key FALSE (today's rule)", (await key(J2)) === false);

// K3: the poster picks a new date and a new Helpr confirms.
await db.exec(`update public.jobs set status = 'accepted', helper_id = '${B}', helper_confirmed_at = '2026-11-12T17:00:00Z' where id = '${J}'`);
ok("K3 a new Helpr confirmed on the no-show job: key FALSE (today's rule)", (await key(J)) === false);

console.log(failed ? `\n${failed} FAIL` : "\nALL PASS");
process.exit(failed ? 1 : 0);
