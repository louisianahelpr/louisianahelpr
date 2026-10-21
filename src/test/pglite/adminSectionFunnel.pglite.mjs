#!/usr/bin/env node
/**
 * PGlite proof for 20261021091636_admin_section_funnel (board 191).
 *   node src/test/pglite/adminSectionFunnel.pglite.mjs
 * World: seriesWorld.mjs's jobs/profiles/applications, plus the columns and
 * tables the funnel reads (stubbed shapes, said so). has_role is replaced so
 * U A is an admin. The query bodies were also run read-only on prod 2026-10-21.
 */
import { PGlite, baseSchema, readMigration, USERS, as as asRole, checker } from "./seriesWorld.mjs";
const THIS = "20261021091636_admin_section_funnel.sql";
const { check: c, failures } = checker();
const { P: POSTER, A: ADMIN, B: HELPR, C: OTHER } = USERS;
const db = new PGlite();
await db.exec(baseSchema(THIS));
await db.exec(`
  alter table public.profiles add column is_seed boolean default false;
  alter table public.jobs add column accepted_at timestamptz, add column completed_at timestamptz, add column removed_at timestamptz;
  alter table public.applications add column created_at timestamptz default now();
  create table public.reviews (id serial primary key, job_id uuid);
  create table public.analytics_events_real (user_id uuid, event text, created_at timestamptz default now());
  create table public.declutter_items (id uuid primary key default gen_random_uuid(), live_at timestamptz, is_seed boolean default false);
  create table public.declutter_offers (item_id uuid, created_at timestamptz default now(), is_seed boolean default false);
  create table public.declutter_orders (id uuid primary key default gen_random_uuid(), paid_at timestamptz, handed_over_at timestamptz, items_cents int, is_seed boolean default false);
  create table public.declutter_cart_items (item_id uuid, order_id uuid);
  create table public.declutter_reviews (order_id uuid);
  create or replace function public.has_role(uuid, public.app_role) returns boolean language sql stable as $f$ select $1 = '${ADMIN}'::uuid $f$;
  insert into public.analytics_events_real (user_id, event) values ('${POSTER}', 'post_job_entry_choice'), ('${OTHER}', 'post_job_entry_choice');
  insert into public.jobs (id, customer_id, title, status, payment_status, parish, created_at, helper_id, accepted_at, completed_at) values
    ('00000000-0000-0000-0000-0000000000a1', '${POSTER}', 'Mow', 'completed', 'released', 'Iberia', now() - interval '3 days', '${HELPR}', now() - interval '2 days', now() - interval '1 day'),
    ('00000000-0000-0000-0000-0000000000a2', '${POSTER}', 'Rake', 'open', 'escrow', 'Iberia', now() - interval '2 days', null, null, null),
    ('00000000-0000-0000-0000-0000000000a3', '${OTHER}', 'Draft', 'open', 'unpaid', 'Vermilion', now() - interval '1 day', null, null, null);
  update public.jobs set budget = 60 where id = '00000000-0000-0000-0000-0000000000a1';
  insert into public.applications (job_id, helper_id, created_at) values ('00000000-0000-0000-0000-0000000000a1', '${HELPR}', now() - interval '3 days' + interval '30 minutes');
  insert into public.reviews (job_id) values ('00000000-0000-0000-0000-0000000000a1');
  grant select on all tables in schema public to authenticated;
`);
for (let i = 0; i < 3; i++) await db.exec(readMigration(THIS));

const no = await asRole(db, "authenticated", POSTER, `select public.admin_section_funnel('jobs', 30, null) r`);
c("[fix] F1: a non-admin is refused", !no.ok && /not_authorized/.test(no.err), no.err);
const bad = await asRole(db, "authenticated", ADMIN, `select public.admin_section_funnel('jobs', 14, null) r`);
c("[fix] F2: only 7/30/90 days", !bad.ok && /invalid_window/.test(bad.err), bad.err);
const r = await asRole(db, "authenticated", ADMIN, `select public.admin_section_funnel('jobs', 30, null) r`);
const j = r.ok ? r.rows[0].r : null;
const counts = j && Object.fromEntries(j.stages.map((s) => [s.key, Number(s.count)]));
c("[fix] F3: stages counted from rows (started 5 member-days: 3 job days + 2 entry events today, posted 2, applicant 1, hired 1, done 1, reviewed 1)",
  JSON.stringify(counts) === JSON.stringify({ started: 5, posted: 2, applicant: 1, hired: 1, done: 1, reviewed: 1 }), JSON.stringify(counts ?? r.err));
c("[fix] F4: released is the released job's budget in cents", j && Number(j.released_cents) === 6000, j && j.released_cents);
c("[fix] F5: median minutes to first applicant", j && Math.round(j.first_response_minutes) === 30, j && j.first_response_minutes);
const par = await asRole(db, "authenticated", ADMIN, `select public.admin_section_funnel('jobs', 30, 'Vermilion') r`);
const pc = par.ok && Object.fromEntries(par.rows[0].r.stages.map((s) => [s.key, Number(s.count)]));
c("[fix] F6: a parish narrows jobs, and drops event-only starts", pc && pc.posted === 0 && pc.started === 1, JSON.stringify(pc ?? par.err));
const dec = await asRole(db, "authenticated", ADMIN, `select public.admin_section_funnel('declutter', 7, null) r`);
c("[fix] F7: Declutter answers its own stages", dec.ok && dec.rows[0].r.stages.map((s) => s.key).join() === "listed,offer,sold,handed_over,reviewed", dec.err);
if (failures()) { console.log(`\n${failures()} FAILED`); process.exit(1); }
console.log("\nall checks passed");
