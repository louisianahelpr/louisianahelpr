#!/usr/bin/env node
/**
 * PGlite proof for 20260924082243_funded_category_tax_class_lock (ME-010).
 *
 *   node src/test/pglite/fundedCategoryTaxClass.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/fundedCategoryTaxClass.pglite.mjs   # RED: no trigger
 *
 * Migration applied 3x (replay-safe). A poster's funded job cannot move
 * between taxed and untaxed categories; moves within a class, unfunded jobs
 * and server writes still pass.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const sql = readFileSync(new URL("../../../supabase/migrations/20260924082243_funded_category_tax_class_lock.sql", import.meta.url).pathname, "utf8");
let failures = 0;
const db = new PGlite();
const POSTER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
await db.exec(`
create schema auth; create table auth.cur(uid uuid);
create function auth.uid() returns uuid language sql as $f$ select uid from auth.cur limit 1 $f$;
create function public.is_server_context() returns boolean language sql as $f$ select current_user = 'postgres' $f$;
create role authenticated; create role anon;
create table public.jobs(id int primary key, customer_id uuid, category text, payment_status text, stripe_session_id text);
grant select, update on public.jobs to authenticated;
grant usage on schema auth to authenticated; grant select on auth.cur to authenticated;
insert into public.jobs values
  (1,'${POSTER}','cleaning','escrow',null),
  (2,'${POSTER}','assembly','escrow',null),
  (3,'${POSTER}','cleaning','unpaid',null),
  (4,'${POSTER}','cleaning','unpaid','cs_open'),
  (5,'${POSTER}','cleaning','escrow',null);
insert into auth.cur values ('${POSTER}');
`);
if (process.env.NEW_MIGRATION !== "skip") for (let i = 0; i < 3; i++) await db.exec(sql);
const run = async (name, role, q, expectOk) => {
  let ok = true, msg = "";
  try { await db.exec(`set role ${role}; ${q}; reset role;`); } catch (e) { ok = false; msg = e.message; await db.exec("reset role"); }
  if (ok !== expectOk) failures++;
  console.log(`${ok === expectOk ? "PASS" : "FAIL"} ${name}${msg ? " — " + msg : ""}`);
};
await run("funded exempt -> taxable refused", "authenticated", "update public.jobs set category='assembly' where id=1", false);
await run("funded taxable -> exempt refused", "authenticated", "update public.jobs set category='cleaning' where id=2", false);
await run("checkout opened (session id) refused", "authenticated", "update public.jobs set category='handyman' where id=4", false);
await run("funded within exempt class allowed", "authenticated", "update public.jobs set category='organizing' where id=5", true);
await run("unfunded job can change class", "authenticated", "update public.jobs set category='assembly' where id=3", true);
await run("server write allowed", "postgres", "update public.jobs set category='assembly' where id=1", true);
console.log(failures ? `${failures} FAIL` : "all PASS");
process.exit(failures ? 1 : 0);
