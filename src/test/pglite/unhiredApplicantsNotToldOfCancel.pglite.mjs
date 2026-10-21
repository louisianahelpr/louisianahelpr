#!/usr/bin/env node
/**
 * PGlite proof for 20261021072502_unhired_applicants_not_told_of_cancel.sql (owner decision 2026-10-21).
 *
 *   node src/test/pglite/unhiredApplicantsNotToldOfCancel.pglite.mjs
 *
 * Q274's close trigger (20260923205811) then this migration, 3x. A cancelled job with three applicants: the
 * offered Helpr (jobs.helper_id, application pending) is still told (bell + email); an unhired applicant is
 * closed 'job_cancelled' and told NOTHING (no bell, no email); the hired Helpr's accepted row is untouched.
 * A person's decline still notifies. LH_PROOF_REVERT=1 drops the new early return and the proof fails.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const repo = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
let mig = readFileSync(repo + "20261021072502_unhired_applicants_not_told_of_cancel.sql", "utf8");
if (process.env.LH_PROOF_REVERT) mig = mig.replace("IF NEW.closed_reason = 'job_cancelled' AND NEW.helper_id IS DISTINCT FROM job_helper THEN", "IF false THEN");
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth; create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
create schema vault; create table vault.decrypted_secrets(name text, decrypted_secret text);
create schema net; create table net.calls(body jsonb);
create function net.http_post(url text, headers jsonb, body jsonb) returns bigint language plpgsql as $$ begin insert into net.calls values (body); return 1; end $$;
create type public.job_status as enum ('open','accepted','in_progress','completed','cancelled','revision_requested','disputed','pending_approval');
create type public.application_status as enum ('pending','accepted','rejected');
create table public.jobs(id uuid primary key default gen_random_uuid(), title text, customer_id uuid, helper_id uuid, status public.job_status not null default 'open');
create table public.applications(id uuid primary key default gen_random_uuid(), job_id uuid not null references public.jobs(id), helper_id uuid not null, status public.application_status not null default 'pending', decline_reason text, updated_at timestamptz default now());
create table public.notifications(id serial primary key, user_id uuid, title text, message text, type text, link text);
create table public.notification_preferences(user_id uuid primary key, email_job_applications boolean default true);
create table public.profiles(user_id uuid primary key, email text, full_name text);
`);
await db.exec(readFileSync(repo + "20260923205811_close_pending_applications_on_job_cancel.sql", "utf8"));
for (let i = 0; i < 3; i++) await db.exec(mig);
// The trigger as prod has it (created by an older migration; CREATE OR REPLACE FUNCTION keeps it).
await db.exec(`CREATE TRIGGER on_application_change AFTER INSERT OR UPDATE ON public.applications FOR EACH ROW EXECUTE FUNCTION public.notify_on_application();`);

let fails = 0, n = 0;
const check = (name, ok, got) => { n++; if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  got ${JSON.stringify(got)}`}`); };
const U = (k) => `00000000-0000-4000-8000-${String(k).padStart(12, "0")}`;
const P = U(1), UNHIRED = U(2), OFFERED = U(3), HIRED = U(4);

const { rows: [j] } = await db.query(`insert into public.jobs(title, customer_id, helper_id) values ('Rake leaves', $1, $2) returning id`, [P, OFFERED]);
await db.query(`insert into public.applications(job_id, helper_id) values ($1,$2),($1,$3)`, [j.id, UNHIRED, OFFERED]);
const { rows: [j2] } = await db.query(`insert into public.jobs(title, customer_id, helper_id, status) values ('Paint fence', $1, $2, 'accepted') returning id`, [P, HIRED]);
await db.query(`insert into public.applications(job_id, helper_id, status) values ($1,$2,'accepted'),($1,$3,'pending')`, [j2.id, HIRED, UNHIRED]);
await db.exec(`delete from public.notifications; delete from net.calls;`);
await db.query(`update public.jobs set status='cancelled' where id in ($1, $2)`, [j.id, j2.id]);

const notes = (await db.query(`select user_id, message from public.notifications order by id`)).rows;
const mails = (await db.query(`select body->>'user_id' as u from net.calls`)).rows.map((r) => r.u);
const apps = (await db.query(`select job_id, helper_id, status::text, closed_reason from public.applications order by job_id, helper_id`)).rows;
check("unhired applicants: closed 'job_cancelled'", apps.filter((a) => a.helper_id === UNHIRED).every((a) => a.status === "rejected" && a.closed_reason === "job_cancelled"), apps);
check("unhired applicants: no bell item", !notes.some((x) => x.user_id === UNHIRED), notes);
check("unhired applicants: no email", !mails.includes(UNHIRED), mails);
check("the offered Helpr is still told (bell + email)", notes.some((x) => x.user_id === OFFERED && /was cancelled/.test(x.message)) && mails.includes(OFFERED), { notes, mails });
check("the hired Helpr's accepted application is untouched", apps.some((a) => a.helper_id === HIRED && a.status === "accepted" && a.closed_reason === null), apps);

// A person's decline still notifies.
const { rows: [j3] } = await db.query(`insert into public.jobs(title, customer_id) values ('Mow', $1) returning id`, [P]);
await db.query(`insert into public.applications(job_id, helper_id) values ($1,$2)`, [j3.id, UNHIRED]);
await db.exec(`delete from public.notifications`);
await db.query(`update public.applications set status='rejected' where job_id=$1`, [j3.id]);
check("a decline still says not selected", (await db.query(`select message from public.notifications where user_id=$1`, [UNHIRED])).rows.some((r) => /not selected/.test(r.message)));

console.log(`\n${n - fails}/${n} passed (3x applied)`);
process.exit(fails ? 1 : 0);
