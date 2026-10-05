#!/usr/bin/env node
/**
 * PGlite proof for 20261004220059_tip_held_payout_redrive (Q1222).
 *
 *   node src/test/pglite/tipHoldRedrive.pglite.mjs
 *
 * pglite is loaded from ~/.lh-pglite (override with PGLITE_DIR). OLD STATE RED:
 * before the migration there is no claim row a held-back tip can be recorded
 * in, so the re-drive has nothing to read (the table does not exist). Then the
 * migration is applied 3x (replay-safe) and the proof exits 1 unless:
 *   - one claim row per tip (a second insert for the same tip is 23505);
 *   - the status set is closed (an unknown status is refused, 23514);
 *   - the claim is a compare-and-set: 'reversed' -> 'repaying' matches once,
 *     a second copy matches no row;
 *   - one re-pay transfer id is never recorded on two rows (23505);
 *   - a non-positive amount is refused;
 *   - RLS is on and anon/authenticated hold no privilege; service_role can
 *     select/insert/update.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const NEW = readFileSync(fileURLToPath(new URL("../../../supabase/migrations/20261004220059_tip_held_payout_redrive.sql", import.meta.url)), "utf8");

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create table public.tips(id uuid primary key, helper_id uuid);
  create table public.chargeback_clawbacks(id uuid primary key, status text, failure_reason text);
  -- Q807's gate (20260927234313) is not part of this proof: stubbed.
  create function public.attach_unconfirmed_email_gate() returns void language sql as $$ select $$;
  grant select on public.tips to authenticated;
  insert into public.tips values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000b1'),
                                 ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000b1');
`);
const T1 = "00000000-0000-4000-8000-000000000001";
const T2 = "00000000-0000-4000-8000-000000000002";
const H = "00000000-0000-4000-8000-0000000000b1";

const before = (await db.query(`select to_regclass('public.tip_hold_redrives') r`)).rows[0].r;
if (before === null) {
  console.log("OLD STATE RED: no tip_hold_redrives table, so a tip paid to a held Helpr has nowhere to record what is owed");
} else {
  console.error("unexpected old state");
  process.exit(1);
}

for (let i = 0; i < 3; i++) await db.exec(NEW);
const fails = [];
const code = async (sql) => {
  try { await db.exec(sql); return null; } catch (e) { return e.code; }
};

if (await code(`insert into public.tip_hold_redrives(tip_id, helper_id, transfer_id, amount_cents) values ('${T1}', '${H}', 'tr_1', 1500)`)) fails.push("first claim row refused");
if ((await code(`insert into public.tip_hold_redrives(tip_id, helper_id, transfer_id, amount_cents) values ('${T1}', '${H}', 'tr_1', 1500)`)) !== "23505") fails.push("a second claim row for the same tip was accepted");
if ((await code(`update public.tip_hold_redrives set status = 'paid' where tip_id = '${T1}'`)) !== "23514") fails.push("an unknown status was accepted");
if ((await code(`insert into public.tip_hold_redrives(tip_id, helper_id, transfer_id, amount_cents) values ('${T2}', '${H}', 'tr_2', 0)`)) !== "23514") fails.push("a zero amount was accepted");

await db.exec(`update public.tip_hold_redrives set status = 'reversed', reversal_id = 'trr_1' where tip_id = '${T1}'`);
const first = await db.query(`update public.tip_hold_redrives set status = 'repaying' where tip_id = '${T1}' and status = 'reversed' returning tip_id`);
const second = await db.query(`update public.tip_hold_redrives set status = 'repaying' where tip_id = '${T1}' and status = 'reversed' returning tip_id`);
if (first.rows.length !== 1 || second.rows.length !== 0) fails.push(`claim CAS matched ${first.rows.length} then ${second.rows.length}`);

await db.exec(`update public.tip_hold_redrives set status = 'repaid', repay_transfer_id = 'tr_repay' where tip_id = '${T1}'`);
await db.exec(`insert into public.tip_hold_redrives(tip_id, helper_id, transfer_id, amount_cents) values ('${T2}', '${H}', 'tr_2', 900)`);
if ((await code(`update public.tip_hold_redrives set repay_transfer_id = 'tr_repay' where tip_id = '${T2}'`)) !== "23505") fails.push("one re-pay transfer id was recorded on two rows");

const rls = (await db.query(`select relrowsecurity r from pg_class where oid = 'public.tip_hold_redrives'::regclass`)).rows[0].r;
if (!rls) fails.push("RLS is off");
const priv = (await db.query(`select
  has_table_privilege('anon', 'public.tip_hold_redrives', 'select') a_s,
  has_table_privilege('authenticated', 'public.tip_hold_redrives', 'select') u_s,
  has_table_privilege('authenticated', 'public.tip_hold_redrives', 'update') u_u,
  has_table_privilege('service_role', 'public.tip_hold_redrives', 'select,insert,update') s_all`)).rows[0];
if (priv.a_s || priv.u_s || priv.u_u) fails.push(`a client role holds a privilege: ${JSON.stringify(priv)}`);
if (!priv.s_all) fails.push("service_role cannot select/insert/update");
const col = (await db.query(`select count(*)::int n from information_schema.columns where (table_name = 'chargeback_clawbacks' and column_name in ('held_repay_owed_at', 'held_repay_first_attempt_at')) or (table_name = 'tip_hold_redrives' and column_name = 'first_repay_attempt_at')`)).rows[0].n;
if (col !== 3) fails.push(`the re-drive's stamp columns: ${col} of 3 (held_repay_owed_at, held_repay_first_attempt_at, first_repay_attempt_at)`);

if (fails.length) {
  console.error("FAIL\n- " + fails.join("\n- "));
  process.exit(1);
}
console.log("NEW STATE GREEN (applied 3x): one claim row per tip, closed status set, CAS claim matches once, unique re-pay transfer, RLS on, no client privileges");
