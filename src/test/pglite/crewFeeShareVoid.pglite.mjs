#!/usr/bin/env node
/**
 * PGlite proof for 20261021130729_crew_fee_share_void_for_deleted_member.sql
 * (docs/OPEN.md Q1915, owner decided 2026-10-21): a deleted crew member's
 * late-cancellation share goes back to the poster, so void-cancelled-payments
 * marks it 'void'. The ledger's status CHECK must allow that, and nothing
 * else new.
 *
 *   npx tsx src/test/pglite/crewFeeShareVoid.pglite.mjs [--replay] [--before]
 *
 * The table is built from its REAL CREATE TABLE in 20260925154606 (FK targets
 * stubbed). --before leaves the migration out and V1 must FAIL; without it the
 * migration is applied (3x with --replay) and every check must PASS.
 *
 *   V1 a deleted member's unpaid share (helper_id NULL) can be set 'void'
 *      with the edge function's own guarded update
 *   V2 (control) an unknown status is still refused
 *   V3 (control) 'paid' with no transfer id is still refused
 *   V4 (control) a share already 'paid' is not voided by the guarded update
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261021130729_crew_fee_share_void_for_deleted_member.sql";
const MIGRATION = readFileSync(DIR + THIS, "utf8");
const REPLAY = process.argv.includes("--replay");
const BEFORE = process.argv.includes("--before");

const created = readFileSync(DIR + "20260925154606_group_crew_has_no_lead.sql", "utf8");
const m = /CREATE TABLE IF NOT EXISTS public\.crew_cancellation_fee_shares \([\s\S]*?\n\);/.exec(created);
if (!m) throw new Error("could not find the crew_cancellation_fee_shares CREATE TABLE in 20260925154606");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const tryq = async (db, sql) => {
  try {
    await db.query(sql);
    return null;
  } catch (e) {
    return String(e?.message ?? e);
  }
};

const db = new PGlite();
await db.exec(`
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TABLE public.jobs (id uuid PRIMARY KEY);
${m[0]}
INSERT INTO public.jobs VALUES ('00000000-0000-4000-8000-000000000101');
INSERT INTO public.crew_cancellation_fee_shares (id, job_id, helper_id, committed, share_basis_cents, fee_percent, share_amount, status)
VALUES
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', NULL, true, 10000, 50, 50.00, 'pending'),
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000101', NULL, true, 10000, 50, 50.00, 'pending');
UPDATE public.crew_cancellation_fee_shares SET status = 'paid', stripe_transfer_id = 'tr_x'
 WHERE id = '00000000-0000-4000-8000-000000000003';
`);

if (!BEFORE) {
  for (let i = 0; i < (REPLAY ? 3 : 1); i++) await db.exec(MIGRATION);
}

// The edge function's own guarded flip (voidDeletedMemberShares).
const voidSql = (id) => `UPDATE public.crew_cancellation_fee_shares SET status = 'void'
  WHERE id = '${id}' AND helper_id IS NULL AND status IN ('pending', 'failed') RETURNING id`;

const v1err = await tryq(db, voidSql("00000000-0000-4000-8000-000000000001"));
const v1 = await db.query(`SELECT status FROM public.crew_cancellation_fee_shares WHERE id = '00000000-0000-4000-8000-000000000001'`);
check("V1 a deleted member's unpaid share can be voided", !v1err && v1.rows[0]?.status === "void", v1err ?? v1.rows[0]?.status);

const v2err = await tryq(db, `UPDATE public.crew_cancellation_fee_shares SET status = 'bogus' WHERE id = '00000000-0000-4000-8000-000000000001'`);
check("V2 an unknown status is still refused", !!v2err && /check constraint/i.test(v2err), v2err ?? "accepted");

await db.exec(`INSERT INTO public.jobs VALUES ('00000000-0000-4000-8000-000000000102')`);
const v3err = await tryq(db, `INSERT INTO public.crew_cancellation_fee_shares (job_id, helper_id, committed, share_basis_cents, fee_percent, share_amount, status)
  VALUES ('00000000-0000-4000-8000-000000000102', NULL, true, 10000, 50, 50.00, 'paid')`);
check("V3 'paid' with no transfer id is still refused", !!v3err && /paid_has_transfer/.test(v3err), v3err ?? "accepted");

const v4 = await db.query(voidSql("00000000-0000-4000-8000-000000000003"));
const v4row = await db.query(`SELECT status FROM public.crew_cancellation_fee_shares WHERE id = '00000000-0000-4000-8000-000000000003'`);
check("V4 a share already paid is not voided", v4.rows.length === 0 && v4row.rows[0]?.status === "paid", v4row.rows[0]?.status);

if (BEFORE) {
  console.log(failures > 0 ? `RED as expected (${failures} failing before the migration)` : "UNEXPECTED: all passed before the migration");
  process.exit(failures > 0 ? 0 : 1);
}
console.log(failures === 0 ? `ALL PASS${REPLAY ? " (applied 3x)" : ""}` : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
