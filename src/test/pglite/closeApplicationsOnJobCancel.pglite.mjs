#!/usr/bin/env node
/**
 * PGlite proof for 20260923205811_close_pending_applications_on_job_cancel
 * (docs/OPEN.md Q274).
 *
 *   node src/test/pglite/closeApplicationsOnJobCancel.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR). Prints "OLD STATE RED" for the state before the
 * migration (notify_on_application from its newest prior definition,
 * 20260903012715, and no close trigger), then applies the migration 3x and
 * exits 1 unless the new state is green: the cancelled job's pending
 * application is rejected with closed_reason='job_cancelled', its notice says
 * the job was cancelled (never "not selected"), the hired Helpr's accepted row
 * is untouched, the backfill sends nothing, and a person's decline still reads
 * "not selected: <reason>". Stubs: net.http_post records calls; vault is a table.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const repo = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth; create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.uid', true),'')::uuid $$;
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
// OLD state: notify_on_application from its newest definition before this change.
const prev = readFileSync(repo + "20260903012715_notification_preferences_always_exist.sql", "utf8");
const fn = prev.match(/CREATE OR REPLACE FUNCTION public\.notify_on_application\(\)[\s\S]*?\n\$function\$;/)[0];
await db.exec(fn + `\nCREATE TRIGGER on_application_change AFTER INSERT OR UPDATE ON public.applications FOR EACH ROW EXECUTE FUNCTION public.notify_on_application();`);

const P = "00000000-0000-0000-0000-00000000000p".replace("p","1"), H1 = "00000000-0000-0000-0000-0000000000a1", H2 = "00000000-0000-0000-0000-0000000000a2";
async function scenario(label) {
  await db.exec(`delete from public.notifications; delete from public.applications; delete from public.jobs;`);
  const { rows: [j] } = await db.query(`insert into public.jobs(title, customer_id) values ('Rake leaves', $1) returning id`, [P]);
  await db.query(`insert into public.applications(job_id, helper_id) values ($1,$2),($1,$3)`, [j.id, H1, H2]);
  await db.query(`update public.applications set status='accepted' where helper_id=$1`, [H2]);
  await db.exec(`delete from public.notifications`);
  await db.query(`update public.jobs set status='cancelled' where id=$1`, [j.id]);
  const apps = (await db.query(`select helper_id, status::text, ${label === "OLD" ? "null as closed_reason" : "closed_reason"} from public.applications order by helper_id`)).rows;
  const notes = (await db.query(`select user_id, message from public.notifications`)).rows;
  console.log(`[${label}] after cancel: apps=${JSON.stringify(apps)} notifications=${JSON.stringify(notes)}`);
  return { apps, notes };
}
const old = await scenario("OLD");
console.log(old.apps.find((a) => a.helper_id === H1).status === "pending" ? "OLD STATE RED: pending application left open on cancelled job" : "old state unexpectedly closed it");

// Backfill fixture: a pending app on an already-cancelled job, created in the OLD state.
const { rows: [cj] } = await db.query(`insert into public.jobs(title, customer_id, status) values ('Old cancelled', $1, 'cancelled') returning id`, [P]);
await db.query(`insert into public.applications(job_id, helper_id) values ($1,$2)`, [cj.id, H1]);
await db.exec(`delete from public.notifications`);

const mig = readFileSync(repo + "20260923205811_close_pending_applications_on_job_cancel.sql", "utf8");
for (let i = 1; i <= 3; i++) { await db.exec(mig); console.log(`migration applied (${i}/3)`); }
const bf = (await db.query(`select status::text, closed_reason from public.applications where job_id=$1`, [cj.id])).rows;
const bfNotes = (await db.query(`select count(*)::int n from public.notifications`)).rows[0].n;
console.log(`backfill: ${JSON.stringify(bf)} notifications sent=${bfNotes}`);
await db.exec(`delete from public.applications where job_id='${cj.id}'; delete from public.jobs where id='${cj.id}'`);

const nu = await scenario("NEW");
const h1 = nu.apps.find((a) => a.helper_id === H1), h2 = nu.apps.find((a) => a.helper_id === H2);
const ok = h1.status === "rejected" && h1.closed_reason === "job_cancelled" && h2.status === "accepted" && h2.closed_reason === null
  && nu.notes.length === 1 && /was cancelled, so your application is closed/.test(nu.notes[0].message) && !/not selected/.test(nu.notes[0].message)
  && bf[0].status === "rejected" && bf[0].closed_reason === "job_cancelled" && bfNotes === 0;
// A person's decline is unchanged.
const { rows: [j2] } = await db.query(`insert into public.jobs(title, customer_id) values ('Paint', $1) returning id`, [P]);
await db.query(`insert into public.applications(job_id, helper_id) values ($1,$2)`, [j2.id, H1]);
await db.exec(`delete from public.notifications`);
await db.query(`update public.applications set status='rejected', decline_reason='found someone closer' where job_id=$1`, [j2.id]);
const dec = (await db.query(`select message from public.notifications`)).rows;
console.log(`decline by a person: ${JSON.stringify(dec)}`);
const ok2 = dec.length === 1 && /was not selected: found someone closer/.test(dec[0].message);
// Constraint.
let rejected = false; try { await db.query(`update public.applications set closed_reason='whatever' where job_id=$1`, [j2.id]); } catch { rejected = true; }
console.log(`closed_reason check constraint rejects junk: ${rejected}`);
const green = ok && ok2 && rejected;
console.log(green ? "NEW STATE GREEN" : "NEW STATE FAILED");
process.exit(green ? 0 : 1);
