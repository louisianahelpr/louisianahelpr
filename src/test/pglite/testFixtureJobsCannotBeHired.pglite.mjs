#!/usr/bin/env node
/**
 * PGlite proof for 20261007122020_test_fixture_jobs_cannot_be_hired
 * (docs/OPEN.md Q946): a job listed in test_fixture_jobs can stay open, take
 * ordinary edits and end, but is never hired, offered or moved into the money
 * path, by any role; an unlisted job is untouched. Applied 3x for replay.
 *
 *   node src/test/pglite/testFixtureJobsCannotBeHired.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/testFixtureJobsCannotBeHired.pglite.mjs   # RED before
 *
 * jobs carries prod's types for the columns the trigger reads (job_status enum
 * read live 2026-10-07: open, accepted, in_progress, completed, cancelled,
 * revision_requested, disputed, pending_approval).
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url), "utf8");
const SKIP = process.env.NEW_MIGRATION === "skip";
let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create type public.job_status as enum ('open','accepted','in_progress','completed','cancelled','revision_requested','disputed','pending_approval');
  create table public.jobs (
    id uuid primary key, status public.job_status not null default 'open', payment_status text,
    helper_id uuid, offered_to_helper_id uuid, date_needed date, title text, is_seed boolean default false);
  grant select, update on public.jobs to authenticated, service_role;
`);
if (!SKIP) for (let k = 0; k < 3; k++) await db.exec(MIG("20261007122020_test_fixture_jobs_cannot_be_hired.sql"));

const FIX = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", REAL = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const H = "11111111-1111-1111-1111-111111111111";
const reset = async () => {
  await db.exec(`delete from public.jobs;`);
  await db.exec(`insert into public.jobs (id, status, payment_status, date_needed, is_seed) values
    ('${FIX}', 'open', 'escrow', current_date + 7, true), ('${REAL}', 'open', 'escrow', current_date + 7, false);`);
  if (!SKIP) await db.exec(`insert into public.test_fixture_jobs (job_id, purpose) values ('${FIX}', 'browse-apply') on conflict do nothing;`);
};
const upd = async (role, id, set) => {
  try {
    await db.exec(`set role ${role};`);
    await db.query(`update public.jobs set ${set} where id = $1`, [id]);
    return "ok";
  } catch (e) { return String(e.message).split("\n")[0]; } finally { await db.exec(`reset role;`); }
};

for (const role of ["service_role", "authenticated", "postgres"]) {
  await reset();
  const hire = await upd(role, FIX, `helper_id = '${H}', status = 'accepted'`);
  check(/cannot be hired/.test(hire), `[fix] ${role}: the fixture cannot be hired (${hire})`);
  await reset();
  const offer = await upd(role, FIX, `offered_to_helper_id = '${H}'`);
  check(/direct offer/.test(offer), `[fix] ${role}: the fixture cannot get a direct offer (${offer})`);
  await reset();
  const prog = await upd(role, FIX, `status = 'in_progress'`);
  check(/only stay open or end/.test(prog), `[fix] ${role}: the fixture cannot move to in_progress (${prog})`);
  await reset();
  const pay = await upd(role, FIX, `payment_status = 'released'`);
  check(/keeps its payment_status/.test(pay), `[fix] ${role}: an open fixture's payment_status cannot move (${pay})`);
}
await reset();
check((await upd("service_role", FIX, `date_needed = current_date + 14, title = 'moved on'`)) === "ok", "[keep] the fixture still takes ordinary edits (date_needed, title)");
await reset();
check((await upd("service_role", FIX, `status = 'cancelled', payment_status = 'cancelled'`)) === "ok", "[keep] the fixture can still end (cancelled)");
await reset();
check((await upd("authenticated", REAL, `helper_id = '${H}', status = 'accepted'`)) === "ok", "[keep] an unlisted job is hired as before");

if (!SKIP) {
  const g = (await db.query(`select grantee, privilege_type from information_schema.role_table_grants where table_name = 'test_fixture_jobs' order by 1, 2`)).rows;
  check(!g.some((r) => ["anon", "authenticated", "PUBLIC"].includes(r.grantee)), `[authz] test_fixture_jobs: no anon/authenticated/PUBLIC grant (${g.map((r) => r.grantee + ":" + r.privilege_type).join(", ")})`);
  const rls = (await db.query(`select relrowsecurity from pg_class where relname = 'test_fixture_jobs'`)).rows[0].relrowsecurity;
  check(rls === true, "[authz] test_fixture_jobs has RLS on");
  const trg = (await db.query(`select count(*)::int n from pg_trigger where tgname = 'trg_jobs_test_fixture_never_hired'`)).rows[0].n;
  check(trg === 1, `[replay] exactly one trigger after 3 applications (${trg})`);
}
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
