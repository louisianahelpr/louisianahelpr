#!/usr/bin/env node
/**
 * PGlite proof for 20261019043251_helpr_fault_restore_on_job_end (a Helpr-fault
 * deduction is given back when the job ends with no payout that kept it;
 * restore_helpr_fault_fee no longer blocked by a fully reversed row).
 *
 *   npx tsx src/test/pglite/helprFaultRestoreOnJobEnd.pglite.mjs [--before]
 *
 * Applies the ruling (20261019015301) and deduction (20261019015303) migrations,
 * then this one and 20261019043252 3x each (skipped with --before, where the
 * new checks fail). Exit 0 only when every check passes.
 */
import os from "node:os";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MDIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const BEFORE = process.argv.includes("--before");
const MIGS = [
  "20261019015301_helpr_fault_ruling.sql",
  "20261019015303_helpr_fault_payout_deduction.sql",
  ...(BEFORE ? [] : ["20261019043251_helpr_fault_restore_on_job_end.sql", "20261019043252_helpr_fault_fee_true_up.sql"]),
].map((f) => MDIR + f);
import { readFileSync } from "node:fs";
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth; create table auth.users (id uuid primary key);
create type app_role as enum ('admin','user');
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true),'')::uuid $$;
create table public.user_roles (user_id uuid, role app_role);
create function public.has_role(u uuid, r app_role) returns boolean language sql as $$ select exists(select 1 from public.user_roles where user_id=u and role=r) $$;
create table public.jobs (id uuid primary key, title text, helper_id uuid, payment_status text, is_seed boolean default false,
  budget numeric, customer_fee_amount numeric, sales_tax_amount numeric, urgent_fee numeric, onboarding_fee_amount numeric);
create table public.user_violations (id uuid primary key default gen_random_uuid(), user_id uuid not null, violation_type text not null, description text, job_id uuid references public.jobs(id), reported_by uuid, action_taken text not null, created_at timestamptz default now());
create table public.admin_audit_log (id uuid primary key default gen_random_uuid(), admin_id uuid, action text, target_type text, target_id text, details jsonb, created_at timestamptz default now());
create table public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid, title text, message text, type text, link text);
create table public.payout_transfers (id uuid primary key default gen_random_uuid(), job_id uuid, helper_id uuid, status text, metadata jsonb not null default '{}'::jsonb);
create table public.defects (fn text, k text, msg text);
create function public.log_cron_defect(a text, b text, c text) returns void language sql as $$ insert into public.defects values (a,b,c) $$;
`);
const ADMIN="00000000-0000-0000-0000-0000000000ad", H="00000000-0000-0000-0000-0000000000a1", H2="00000000-0000-0000-0000-0000000000a2", J="00000000-0000-0000-0000-0000000000f1", J2="00000000-0000-0000-0000-0000000000f2", J3="00000000-0000-0000-0000-0000000000f3";
await db.exec(`insert into auth.users values ('${ADMIN}'),('${H}'),('${H2}'); insert into user_roles values ('${ADMIN}','admin');
insert into jobs values ('${J}','Mow',null,'escrow',false,100,5.7,0,0,0),('${J2}','Paint','${H2}','escrow',true,50,0,0,0,0),('${J3}','Unpaid','${H}','unpaid',false,10,0,0,0,0);
insert into user_violations (user_id, violation_type, job_id, action_taken) values ('${H}','no_show','${J}','warning');`);
for (const m of MIGS) for (let i = 0; i < 3; i++) await db.exec(readFileSync(m, "utf8"));
const as = (u) => db.exec(`select set_config('test.uid','${u}',false)`);
const q = async (sql) => { try { return (await db.query(sql)).rows; } catch (e) { return "ERR " + e.message; } };
const results = [];
const check = (name, ok, got) => { results.push(ok); console.log((ok ? "PASS " : "FAIL ") + name + "  " + JSON.stringify(got)); };
await as(ADMIN);
await q(`select public.admin_rule_helpr_fault('${J}','${H}','no_show','did not come')`);
await q(`select public.admin_rule_helpr_fault('${J2}','${H2}','backout','withdrew')`);
await as("");
await q(`select public.bill_helpr_fault_card_fee('${J}', 369, 're_1')`);
await q(`select public.bill_helpr_fault_card_fee('${J2}', 150, 're_2')`);
const rem = async (j) => (await q(`select card_fee_remaining_cents v from job_helpr_fault_rulings where job_id='${j}'`))[0]?.v;
let r = await q(`select public.take_helpr_fault_fee('${H}','job_payout_00000000-0000-0000-0000-00000000000a', 200) v`);
check("takes at most the cap (200 of 369)", Array.isArray(r) && r[0].v === 200, r);
check("remaining 169", (await rem(J)) === 169, await rem(J));
r = await q(`select public.take_helpr_fault_fee('${H}','job_payout_00000000-0000-0000-0000-00000000000a', 5000) v`);
check("same payout twice: first answer, nothing more taken", Array.isArray(r) && r[0].v === 200 && true, r);
check("remaining still 169", (await rem(J)) === 169, await rem(J));
r = await q(`select public.take_helpr_fault_fee('${H}','job_payout_00000000-0000-0000-0000-00000000000b', 5000) v`);
check("next payout takes only what is owed (169)", Array.isArray(r) && r[0].v === 169, r);
check("remaining 0, never below", (await rem(J)) === 0, await rem(J));
r = await q(`select public.take_helpr_fault_fee('${H}','job_payout_00000000-0000-0000-0000-00000000000c', 5000) v`);
check("nothing owed: 0", Array.isArray(r) && r[0].v === 0, r);
r = await q(`select public.take_helpr_fault_fee('${H2}','job_payout_00000000-0000-0000-0000-00000000000a', -5) v`);
check("negative cap takes 0; another Helpr's debt untouched", Array.isArray(r) && r[0].v === 0 && true, r);
check("H2 remaining 150", (await rem(J2)) === 150, await rem(J2));
r = await q(`select public.restore_helpr_fault_fee('${H}','00000000-0000-0000-0000-00000000000b') v`);
check("restore gives back 169", Array.isArray(r) && r[0].v === 169, r);
check("remaining back to 169", (await rem(J)) === 169, await rem(J));
r = await q(`select public.restore_helpr_fault_fee('${H}','00000000-0000-0000-0000-00000000000b') v`);
check("restore twice: 0", Array.isArray(r) && r[0].v === 0, r);
r = await q(`select public.take_helpr_fault_fee('${H}','job_payout_00000000-0000-0000-0000-00000000000b', 5000) v`);
check("retry after restore takes again (169)", Array.isArray(r) && r[0].v === 169, r);
r = await q(`select public.take_helpr_fault_fee('${H2}','job_payout_00000000-0000-0000-0000-00000000000b', 100) v`);
check("group job: H2 takes on the same payout ref", Array.isArray(r) && r[0].v === 100, r);
r = await q(`select public.restore_helpr_fault_fee('${H}','00000000-0000-0000-0000-00000000000b') v`);
check("restoring H leaves H2's deduction alone", Array.isArray(r) && r[0].v === 169 && true, r);
check("H2 remaining 50", (await rem(J2)) === 50, await rem(J2));
await q(`select public.take_helpr_fault_fee('${H}','job_payout_00000000-0000-0000-0000-00000000000b', 5000)`);
check("re-taken before the live-row check (remaining 0)", (await rem(J)) === 0, await rem(J));
await db.exec(`insert into payout_transfers (job_id, helper_id, status) values ('${"00000000-0000-0000-0000-00000000000b"}','${H}','pending')`);
r = await q(`select public.restore_helpr_fault_fee('${H}','00000000-0000-0000-0000-00000000000b') v`);
check("a live payout row for the job: restore refused (0)", Array.isArray(r) && r[0].v === 0, r);
check("debt stays taken (remaining 0)", (await rem(J)) === 0, await rem(J));
await db.exec(`update payout_transfers set status='failed'`);
r = await q(`select public.take_helpr_fault_fee(null,'x',1)`);
check("null Helpr refused", typeof r === "string" && r.includes("invalid_payout"), r);
r = await q(`select has_function_privilege('authenticated','public.take_helpr_fault_fee(uuid,text,integer)','execute') a, has_function_privilege('anon','public.restore_helpr_fault_fee(uuid,uuid)','execute') b, has_function_privilege('service_role','public.take_helpr_fault_fee(uuid,text,integer)','execute') c, has_table_privilege('authenticated','public.job_helpr_fault_fee_deductions','select') d`);
check("grants: service_role only", Array.isArray(r) && r[0].a === false && r[0].b === false && r[0].c === true && r[0].d === false, r);

// ---- job-end give-back (restore_helpr_fault_fee_for_job) ----
await db.exec(`delete from payout_transfers`);
await db.exec(`update job_helpr_fault_rulings set card_fee_remaining_cents = card_fee_cents; delete from job_helpr_fault_fee_deductions`);
// J (H's ruling job) pays H via job J3's payout ref: take 300 on job_payout_J3.
r = await q(`select public.take_helpr_fault_fee('${H}','job_payout_${J3}', 300) v`);
check("J3 payout takes 300", Array.isArray(r) && r[0].v === 300, r);
await db.exec(`insert into payout_transfers (job_id, helper_id, status) values ('${J3}','${H}','failed')`);
r = await q(`select public.restore_helpr_fault_fee_for_job('${J3}') v`);
check("job not ended (unpaid): nothing given back", Array.isArray(r) && r[0].v === 0, r);
check("remaining 69", (await rem(J)) === 69, await rem(J));
await db.exec(`update jobs set payment_status='refunded' where id='${J3}'`);
await db.exec(`insert into payout_transfers (job_id, helper_id, status) values ('${J3}','${H}','pending')`);
r = await q(`select public.restore_helpr_fault_fee_for_job('${J3}') v`);
check("refunded but a live pending claim: refused (0)", Array.isArray(r) && r[0].v === 0, r);
await db.exec(`update payout_transfers set status='failed', metadata='{"helpr_fault_fee_kept_cents":300}' where status='pending'`);
r = await q(`select public.restore_helpr_fault_fee_for_job('${J3}') v`);
check("refunded but an UNCLEAR failed attempt (kept_cents stamp): stands down (0)", Array.isArray(r) && r[0].v === 0, r);
await db.exec(`update payout_transfers set status='canceled', metadata='{}' where status='failed' and metadata ? 'helpr_fault_fee_kept_cents'`);
r = await q(`select public.restore_helpr_fault_fee_for_job('${J3}') v`);
check("refunded, no paid row: gives back 300", Array.isArray(r) && r[0].v === 300, r);
check("remaining 369", (await rem(J)) === 369, await rem(J));
r = await q(`select public.restore_helpr_fault_fee_for_job('${J3}') v`);
check("twice: 0", Array.isArray(r) && r[0].v === 0, r);
// Full reversal on a released job.
await db.exec(`update jobs set payment_status='released' where id='${J3}'; delete from payout_transfers`);
r = await q(`select public.take_helpr_fault_fee('${H}','job_payout_${J3}', 300) v`);
await db.exec(`insert into payout_transfers (job_id, helper_id, status, metadata) values ('${J3}','${H}','reversed','{"fully_reversed":false,"amount_reversed_cents":100}')`);
r = await q(`select public.restore_helpr_fault_fee_for_job('${J3}') v`);
check("partial reversal: kept (0)", Array.isArray(r) && r[0].v === 0, r);
r = await q(`select public.restore_helpr_fault_fee('${H}','${J3}') v`);
check("partial reversal blocks the plain restore too", Array.isArray(r) && r[0].v === 0, r);
await db.exec(`update payout_transfers set metadata='{"fully_reversed":true}'`);
r = await q(`select public.restore_helpr_fault_fee_for_job('${J3}') v`);
check("full reversal: gives back 300", Array.isArray(r) && r[0].v === 300, r);
r = await q(`select public.take_helpr_fault_fee('${H}','job_payout_${J3}', 300) v`);
r = await q(`select public.restore_helpr_fault_fee('${H}','${J3}') v`);
check("older fully reversed row no longer blocks a later failed attempt's restore", Array.isArray(r) && r[0].v === 300, r);
await db.exec(`update payout_transfers set status='paid', metadata='{}'`);
await db.exec(`update jobs set payment_status='refunded' where id='${J3}'`);
r = await q(`select public.take_helpr_fault_fee('${H}','job_payout_${J3}', 300) v`);
r = await q(`select public.restore_helpr_fault_fee_for_job('${J3}') v`);
check("a paid transfer keeps it even on a refunded job", Array.isArray(r) && r[0].v === 0, r);
r = await q(`select public.restore_helpr_fault_fee_for_job(null)`);
check("null job refused", typeof r === "string" && r.includes("invalid_payout"), r);
r = await q(`select has_function_privilege('authenticated','public.restore_helpr_fault_fee_for_job(uuid)','execute') a, has_function_privilege('anon','public.restore_helpr_fault_fee_for_job(uuid)','execute') b, has_function_privilege('service_role','public.restore_helpr_fault_fee_for_job(uuid)','execute') c, has_function_privilege('authenticated','public.restore_helpr_fault_fee(uuid,uuid)','execute') d`);
check("for_job grants: service_role only", Array.isArray(r) && r[0].a === false && r[0].b === false && r[0].c === true && r[0].d === false, r);
const pass = results.every(Boolean);
console.log(pass ? "ALL PASS" : "SOME FAIL", results.filter(Boolean).length + "/" + results.length);
process.exit(pass ? 0 : 1);
