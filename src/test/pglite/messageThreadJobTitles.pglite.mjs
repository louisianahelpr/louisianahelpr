#!/usr/bin/env node
/**
 * PGlite proof for 20261101014031_message_thread_job_titles.sql (NOID-20 "a job" label, lead 2026-10-31).
 *
 *   node src/test/pglite/messageThreadJobTitles.pglite.mjs                    # AFTER: applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/messageThreadJobTitles.pglite.mjs # RED: without it
 *
 * Row security hides the job (as on prod for someone with no role on it any more); the function returns the title
 * to a participant of a conversation on that job (sender or receiver) and NOTHING to anyone else: a non-participant,
 * the poster of another job, anon, or a call with no uid. It never widens jobs RLS.
 */
import { PGlite, readMigration, as } from "./seriesWorld.mjs";

const FIX = readMigration("20261101014031_message_thread_job_titles.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: no title read (expect FAILs)`);
const POSTER = "11111111-1111-1111-1111-111111111111";
const APPLICANT = "22222222-2222-2222-2222-222222222222";
const STRANGER = "33333333-3333-3333-3333-333333333333";
const OTHER_POSTER = "44444444-4444-4444-4444-444444444444";
const J1 = "aaaaaaaa-0000-4000-8000-000000000001";
const J2 = "aaaaaaaa-0000-4000-8000-000000000002";

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  grant usage on schema auth to authenticated, anon, service_role;
  grant usage on schema public to authenticated, anon, service_role;
  -- As on prod (Supabase's default privileges): a new public function is executable by anon and authenticated
  -- unless the migration revokes it, so the REVOKE ... FROM PUBLIC, anon is what N3 tests.
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  create table public.jobs (id uuid primary key, customer_id uuid, title text);
  alter table public.jobs enable row level security;
  -- Stand-in for prod's jobs RLS: only the poster reads the row (the applicant who was not picked does not).
  create policy jobs_poster on public.jobs for select to authenticated using (customer_id = auth.uid());
  grant select on public.jobs to authenticated, anon;
  create table public.messages (id serial primary key, job_id uuid, sender_id uuid, receiver_id uuid, content text);
  alter table public.messages enable row level security;
  create policy messages_party on public.messages for select to authenticated using (sender_id = auth.uid() or receiver_id = auth.uid());
  grant select on public.messages to authenticated;
  insert into public.jobs values ('${J1}', '${POSTER}', 'Move a couch'), ('${J2}', '${OTHER_POSTER}', 'Paint the fence');
  insert into public.messages (job_id, sender_id, receiver_id, content) values
    ('${J1}', '${APPLICANT}', '${POSTER}', 'Can I help?'),
    ('${J2}', '${OTHER_POSTER}', '${POSTER}', 'Hi');
`);
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(FIX);

let fails = 0, n = 0;
const check = (name, ok, got) => { n++; if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  got ${JSON.stringify(got)}`}`); };
const titles = (role, uid, ids = [J1, J2]) =>
  as(db, role, uid, `select job_id::text, title from public.get_message_thread_job_titles(array[${ids.map((i) => `'${i}'`).join(",")}]::uuid[]) order by title`);

const rls = await as(db, "authenticated", APPLICANT, `select title from public.jobs where id = '${J1}'`);
check("setup: row security hides the job from the applicant (the 'a job' case)", rls.ok && rls.rows.length === 0, rls);

const a = await titles("authenticated", APPLICANT);
check("P1: the applicant (sender on J1) gets J1's title, and only J1's", a.ok && JSON.stringify(a.rows) === JSON.stringify([{ job_id: J1, title: "Move a couch" }]), a);
const p = await titles("authenticated", POSTER);
check("P2: the poster (receiver on both) gets both titles, including the job they did not post", p.ok && p.rows.length === 2, p);
const s = await titles("authenticated", STRANGER);
check("N1: a non-participant gets nothing", s.ok && s.rows.length === 0, s);
const o = await titles("authenticated", OTHER_POSTER, [J1]);
check("N2: another poster with no message on J1 gets nothing for J1", o.ok && o.rows.length === 0, o);
const anon = await titles("anon", null);
check("N3: anon cannot call it", !anon.ok && /permission denied/.test(anon.err), anon);
const nouid = await titles("authenticated", null);
check("N4: an authenticated call with no uid gets nothing", nouid.ok && nouid.rows.length === 0, nouid);
const rls2 = await as(db, "authenticated", APPLICANT, `select title from public.jobs where id = '${J1}'`);
check("N5: jobs RLS is unchanged afterwards (the function widens nothing)", rls2.ok && rls2.rows.length === 0, rls2);
const acl = await db.query(`select coalesce(proacl::text, '') as acl, prosecdef, provolatile from pg_proc where proname = 'get_message_thread_job_titles'`);
const row = acl.rows[0] ?? {};
check("G1: SECURITY DEFINER, STABLE, no PUBLIC/anon grant, authenticated granted",
  row.prosecdef === true && row.provolatile === "s" && !/(^|[{,])=X/.test(row.acl) && !/anon=X/.test(row.acl) && /authenticated=X/.test(row.acl), row);
console.log(`\n${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);
