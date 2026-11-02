#!/usr/bin/env node
/**
 * PGlite proof for 20261102052443_delivery_tip_hold_redrive (Q2459).
 *
 *   node src/test/pglite/deliveryTipHoldRedrive.pglite.mjs            # the proof
 *   node src/test/pglite/deliveryTipHoldRedrive.pglite.mjs --skip     # without the migration: must fail
 *
 * Applies 20261004220059 (the table), emulates Supabase's default grants to anon/authenticated, inserts a
 * job-tip row as prod holds, then applies the new migration 3x (replay-safe) and exits 1 unless:
 *   - the existing row reads tip_source 'job' and keeps its FK to tips (RESTRICT);
 *   - a delivery row whose tip_id is a helpr_task_tips id is accepted;
 *   - a delivery row whose tip_id is NOT a helpr_task_tips id (a tips id, or nothing) is refused (23503);
 *   - a job row whose tip_id is a helpr_task_tips id is refused (23503);
 *   - deleting a helpr_task_tips row a redrive row holds is refused (23001, RESTRICT), and so is a tips row;
 *   - an unknown tip_source is refused (23514);
 *   - one row per tip id still (23505);
 *   - anon and authenticated hold no privilege on the table; service_role has select/insert/update;
 *   - exactly one FK points at tips and one at helpr_task_tips.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(fileURLToPath(new URL(`../../../supabase/migrations/${f}`, import.meta.url)), "utf8");
const BASE = mig("20261004220059_tip_held_payout_redrive.sql");
const NEW = mig("20261102052443_delivery_tip_hold_redrive.sql");
const SKIP = process.argv.includes("--skip");

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create table public.tips(id uuid primary key, helper_id uuid);
  create table public.helpr_task_tips(id uuid primary key, helpr_id uuid);
  create table public.chargeback_clawbacks(id uuid primary key, status text, failure_reason text);
  create function public.attach_unconfirmed_email_gate() returns void language sql as $$ select $$;
`);
await db.exec(BASE);
// Supabase's default privileges hand every new table to anon and authenticated; the migration must take them away.
await db.exec(`grant all on public.tip_hold_redrives to anon, authenticated;`);

const J1 = "00000000-0000-4000-8000-000000000001"; // a job tip already held (prod-shaped)
const J2 = "00000000-0000-4000-8000-000000000002"; // a job tip
const D1 = "00000000-0000-4000-8000-0000000000d1"; // a delivery tip
const D2 = "00000000-0000-4000-8000-0000000000d2"; // a delivery tip
const NONE = "00000000-0000-4000-8000-0000000000ff";
const H = "00000000-0000-4000-8000-0000000000b1";
await db.exec(`
  insert into public.tips values ('${J1}', '${H}'), ('${J2}', '${H}');
  insert into public.helpr_task_tips values ('${D1}', '${H}'), ('${D2}', '${H}');
  insert into public.tip_hold_redrives(tip_id, helper_id, transfer_id, amount_cents) values ('${J1}', '${H}', 'tr_j1', 1500);
`);

if (!SKIP) for (let i = 0; i < 3; i++) await db.exec(NEW);

const fails = [];
let passes = 0;
const check = (ok, what) => { if (ok) passes++; else fails.push(what); };
const code = async (sql) => {
  try { await db.exec(sql); return null; } catch (e) { return e.code ?? String(e.message); }
};
const ins = (id, src, tr) =>
  `insert into public.tip_hold_redrives(tip_id, helper_id, transfer_id, amount_cents${src ? ", tip_source" : ""}) values ('${id}', '${H}', '${tr}', 500${src ? `, '${src}'` : ""})`;

const hasCol = (await db.query(`select 1 from information_schema.columns where table_name = 'tip_hold_redrives' and column_name = 'tip_source'`)).rows.length === 1;
check(hasCol, "no tip_source column");
if (hasCol) {
  const src = (await db.query(`select tip_source from public.tip_hold_redrives where tip_id = '${J1}'`)).rows[0]?.tip_source;
  check(src === "job", `the existing row reads tip_source ${src}, not 'job'`);
}
check((await code(ins(D1, "delivery", "tr_d1"))) === null, "a delivery tip's redrive row was refused");
check((await code(ins(J2, "delivery", "tr_x1"))) === "23503", "a delivery row naming a job tip id was accepted");
check((await code(ins(NONE, "delivery", "tr_x2"))) === "23503", "a delivery row naming no tip at all was accepted");
check((await code(ins(D2, "job", "tr_x3"))) === "23503", "a job row naming a delivery tip id was accepted");
check((await code(ins(D2, null, "tr_x4"))) === "23503", "a row with no tip_source naming a delivery tip id was accepted (default must be 'job')");
check((await code(ins(J2, null, "tr_j2"))) === null, "a job tip's redrive row (default source) was refused");
check((await code(ins(D2, "gift", "tr_x5"))) === "23514", "an unknown tip_source was accepted");
check((await code(ins(D1, "delivery", "tr_x6"))) === "23505", "a second row for the same delivery tip was accepted");
check((await code(`delete from public.helpr_task_tips where id = '${D1}'`)) === "23001", "a held delivery tip could be deleted under its redrive row");
check((await code(`delete from public.tips where id = '${J1}'`)) === "23001", "a held job tip could be deleted under its redrive row");
check((await code(`delete from public.helpr_task_tips where id = '${D2}'`)) === null, "a delivery tip with no redrive row could not be deleted");

const fks = (await db.query(`select confrelid::regclass::text t, confdeltype d from pg_constraint
                              where conrelid = 'public.tip_hold_redrives'::regclass and contype = 'f' order by 1`)).rows;
check(fks.length === 2 && fks.every((f) => f.d === "r") &&
      fks.some((f) => f.t === "tips") && fks.some((f) => f.t === "helpr_task_tips"),
      `foreign keys are ${JSON.stringify(fks)}, not one RESTRICT each to tips and helpr_task_tips`);

for (const role of ["anon", "authenticated"]) {
  const privs = (await db.query(`select privilege_type from information_schema.role_table_grants
                                  where table_name = 'tip_hold_redrives' and grantee = '${role}'`)).rows;
  check(privs.length === 0, `${role} still holds ${privs.map((p) => p.privilege_type).join(",")}`);
}
const svc = (await db.query(`select privilege_type p from information_schema.role_table_grants
                              where table_name = 'tip_hold_redrives' and grantee = 'service_role'`)).rows.map((r) => r.p).sort();
check(JSON.stringify(svc) === JSON.stringify(["INSERT", "SELECT", "UPDATE"]), `service_role holds ${svc.join(",")}`);
check((await db.query(`select relrowsecurity r from pg_class where oid = 'public.tip_hold_redrives'::regclass`)).rows[0].r === true, "RLS is off");

console.log(`${SKIP ? "SKIP (no migration)" : "WITH migration"}: ${passes} pass, ${fails.length} fail`);
for (const f of fails) console.error(`  FAIL: ${f}`);
process.exit(fails.length ? 1 : 0);
