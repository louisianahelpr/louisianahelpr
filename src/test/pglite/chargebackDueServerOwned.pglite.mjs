#!/usr/bin/env node
/**
 * PGlite proof for 20260924081103_chargeback_due_server_owned (AM-002).
 *
 *   node src/test/pglite/chargebackDueServerOwned.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/chargebackDueServerOwned.pglite.mjs   # RED: no trigger
 *
 * Fixture: prod's jobs grant shape (authenticated holds TABLE-level UPDATE,
 * measured 2026-09-24 via information_schema.table_privileges), has_role and
 * auth.uid() stubs. Both AM-002 migrations applied 3x (replay-safe); then the
 * service role sets the deadline, a poster can neither change it nor insert
 * one, a poster's other edits still pass, an admin can change it.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const M = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const FILES = ["20260924080301_chargeback_evidence_due_by.sql"];
if (process.env.NEW_MIGRATION !== "skip") FILES.push("20260924081103_chargeback_due_server_owned.sql");
let failures = 0;
const db = new PGlite();
await db.exec(`
create schema auth; create table auth.cur(uid uuid);
create function auth.uid() returns uuid language sql as $f$ select uid from auth.cur limit 1 $f$;
create type app_role as enum ('admin','user');
create table public.user_roles(user_id uuid, role app_role);
create function public.has_role(u uuid, r app_role) returns boolean language sql security definer as $f$ select exists(select 1 from public.user_roles where user_id=u and role=r) $f$;
create role authenticated; create role anon;
create table public.jobs(id uuid primary key, title text);
grant select (id, title), insert, update on public.jobs to authenticated;
grant usage on schema auth to authenticated; grant select on auth.cur to authenticated;
insert into public.jobs values ('11111111-1111-1111-1111-111111111111','t');
insert into public.user_roles values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','admin');
`);
await db.exec("create function public.sync_jobs_select_grants() returns void language sql as $f$ select $f$;");
for (const f of FILES) { const sql = M(f); for (let i = 0; i < 3; i++) await db.exec(sql); }
const J = "'11111111-1111-1111-1111-111111111111'";
const run = async (name, role, uid, q, expectOk) => {
  await db.exec(`delete from auth.cur; ${uid ? `insert into auth.cur values ('${uid}');` : ""}`);
  let ok = true, msg = "";
  try { await db.exec(`set role ${role}; ${q}; reset role;`); } catch (e) { ok = false; msg = e.message; await db.exec("reset role"); }
  if (ok !== expectOk) failures++;
  console.log(`${ok === expectOk ? "PASS" : "FAIL"} ${name}${msg ? " — " + msg : ""}`);
};
await run("service (postgres) sets due_by", "postgres", null, `update public.jobs set chargeback_evidence_due_by=now() where id=${J}`, true);
await run("poster cannot change due_by", "authenticated", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", `update public.jobs set chargeback_evidence_due_by=now()+interval '9 days' where id=${J}`, false);
await run("poster can still edit title", "authenticated", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", `update public.jobs set title='x' where id=${J}`, true);
await run("admin can change due_by", "authenticated", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", `update public.jobs set chargeback_evidence_due_by=null where id=${J}`, true);
await run("poster insert with due_by is cleared", "authenticated", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", `insert into public.jobs(id,title,chargeback_evidence_due_by) values ('22222222-2222-2222-2222-222222222222','n',now())`, true);
const r = await db.query(`select chargeback_evidence_due_by from public.jobs where id='22222222-2222-2222-2222-222222222222'`);
if (r.rows[0].chargeback_evidence_due_by !== null) failures++;
console.log(r.rows[0].chargeback_evidence_due_by === null ? "PASS insert cleared" : "FAIL insert kept value");
console.log(failures ? `${failures} FAIL` : "all PASS");
process.exit(failures ? 1 : 0);
