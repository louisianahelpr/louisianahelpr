#!/usr/bin/env node
/**
 * PGlite proof for 20261102055222_payout_moving_blocks_failed_bank_cancel.sql (Q1978): a bank-payment failure that
 * lands while the Helpr's payout is already moving (any payout_transfers row but 'failed', or a held
 * dispute_settlement_claims row) is answered 'payout_moving' under the job's row lock, and NOTHING is written: the job
 * stays funded, nobody is told. With neither, the function cancels exactly as before.
 *
 *   node src/test/pglite/payoutMovingBlocksFailedBankCancel.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/payoutMovingBlocksFailedBankCancel.pglite.mjs  # RED (prod's definition)
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/payoutMovingBlocksFailedBankCancel.pglite.mjs
 *
 * World: the BASE is prod's live definition, which is this migration's text with the Q1978 block removed (the repo's
 * 20261017205845 is stale; the base md5 is printed and must equal prod's 917e544995f7f1ce5895243c96fb5f68), granted to
 * anon/authenticated the way Supabase's default privileges do. Then this migration 3x. pglite from ~/.lh-pglite.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const root = new URL("../../../", import.meta.url).pathname;
const MIG = `${root}supabase/migrations/20261102055222_payout_moving_blocks_failed_bank_cancel.sql`;
const NEW = process.env.MIGRATION_PATH ?? MIG;
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running on prod's definition only (expect FAILs)");

const PROD_MD5 = "917e544995f7f1ce5895243c96fb5f68";
const migText = readFileSync(MIG, "utf8");
const fnStart = migText.indexOf("CREATE OR REPLACE FUNCTION");
const fnEnd = migText.indexOf("$function$;") + "$function$;".length;
const fn = migText.slice(fnStart, fnEnd);
const b0 = fn.indexOf("  -- Q1978: the Helpr");
const b1 = fn.indexOf("  v_crew := v_job.is_group_job");
if (b0 < 0 || b1 < b0) throw new Error("could not find the Q1978 block to build prod's base");
const BASE = fn.slice(0, b0) + fn.slice(b1);

const P = "11111111-1111-1111-1111-111111111111"; // poster
const H = "22222222-2222-2222-2222-222222222222"; // confirmed Helpr
const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TYPE job_status AS ENUM ('open','accepted','in_progress','completed','cancelled','disputed');
CREATE TABLE public.jobs (
  id uuid primary key, title text, customer_id uuid, helper_id uuid, helper_confirmed_at timestamptz,
  helper_completed_at timestamptz, status job_status, payment_status text, stripe_payment_intent_id text,
  stripe_session_id text, is_group_job boolean default false, offered_to_helper_id uuid, direct_offer_status text,
  direct_offer_expires_at timestamptz, recurrence_days int[], parent_job_id uuid, cancelled_by uuid,
  cancelled_at timestamptz, cancellation_reason text, late_cancellation boolean, cancellation_fee numeric,
  cancellation_fee_status text);
CREATE TABLE public.group_job_helpers (job_id uuid, helper_id uuid, helper_confirmed_at timestamptz, helper_completed_at timestamptz);
CREATE TABLE public.payout_transfers (id uuid primary key default gen_random_uuid(), job_id uuid, status text);
CREATE TABLE public.dispute_settlement_claims (job_id uuid primary key, action text);
CREATE TABLE public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid, job_id uuid, title text, message text, type text, link text);
`);
await db.exec(BASE);
await db.exec(`GRANT EXECUTE ON FUNCTION public.cancel_job_after_failed_bank_payment(uuid, text, uuid) TO anon, authenticated, service_role;`);
const baseMd5 = (await db.query(`select md5(pg_get_functiondef('public.cancel_job_after_failed_bank_payment(uuid,text,uuid)'::regprocedure)) m`)).rows[0].m;
console.log("base md5", baseMd5, baseMd5 === PROD_MD5 ? "(= prod)" : "(NOT prod's)");
if (!skip) {
  const sql = readFileSync(NEW, "utf8");
  for (let i = 1; i <= 3; i++) { await db.exec(sql); console.log("apply", i, "ok"); }
}

const q = async (s, p = []) => (await db.query(s, p)).rows;
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(ok ? "PASS" : "FAIL", name, ok ? "" : (detail ?? "")); };
check("base is prod's live definition (md5)", baseMd5 === PROD_MD5, baseMd5);

let n = 0;
async function scenario({ hired = true, transfer = null, claim = null }) {
  n += 1;
  const J = `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  await q(`insert into jobs (id, title, customer_id, helper_id, helper_confirmed_at, status, payment_status, stripe_payment_intent_id, stripe_session_id)
           values ($1, 'Mow the yard', $2, $3, $4, 'accepted', 'escrow', 'pi_x', 'cs_x')`,
    [J, P, hired ? H : null, hired ? new Date().toISOString() : null]);
  if (transfer) await q(`insert into payout_transfers (job_id, status) values ($1, $2)`, [J, transfer]);
  if (claim) await q(`insert into dispute_settlement_claims (job_id, action) values ($1, $2)`, [J, claim]);
  const before = Number((await q(`select count(*)::int c from notifications`))[0].c);
  await db.exec(`SET ROLE service_role`);
  const out = (await q(`select public.cancel_job_after_failed_bank_payment($1, 'pi_x', null) v`, [J]))[0].v;
  await db.exec(`RESET ROLE`);
  const job = (await q(`select status::text, payment_status, stripe_session_id from jobs where id = $1`, [J]))[0];
  const told = Number((await q(`select count(*)::int c from notifications`))[0].c) - before;
  return { out, job, told };
}

for (const status of ["pending", "paid", "reversed"]) {
  const r = await scenario({ transfer: status });
  check(`payout_transfers '${status}': payout_moving, job untouched, nobody told`,
    r.out?.outcome === "payout_moving" && r.job.status === "accepted" && r.job.payment_status === "escrow" && r.job.stripe_session_id === "cs_x" && r.told === 0,
    JSON.stringify(r));
}
{
  const r = await scenario({ claim: "split" });
  check("a held settlement claim: payout_moving, job untouched, nobody told",
    r.out?.outcome === "payout_moving" && r.job.payment_status === "escrow" && r.told === 0, JSON.stringify(r));
}
{
  const r = await scenario({ hired: false, transfer: "pending" });
  check("nobody hired but a payout row: payout_moving (decided before not_hired)", r.out?.outcome === "payout_moving", JSON.stringify(r));
}
{
  const r = await scenario({ transfer: "failed" });
  check("control: a 'failed' payout row (money never left) still cancels",
    r.out?.outcome === "cancelled" && r.job.status === "cancelled" && r.job.payment_status === "failed" && r.told === 2, JSON.stringify(r));
}
{
  const r = await scenario({});
  check("control: no payout row, no claim: cancels as before (poster + confirmed Helpr told)",
    r.out?.outcome === "cancelled" && r.job.payment_status === "failed" && r.told === 2, JSON.stringify(r));
}
const acl = (await q(`select has_function_privilege('anon', 'public.cancel_job_after_failed_bank_payment(uuid,text,uuid)', 'EXECUTE') a,
                             has_function_privilege('authenticated', 'public.cancel_job_after_failed_bank_payment(uuid,text,uuid)', 'EXECUTE') u,
                             has_function_privilege('service_role', 'public.cancel_job_after_failed_bank_payment(uuid,text,uuid)', 'EXECUTE') s`))[0];
check("grants: anon and authenticated cannot execute; service_role can", !acl.a && !acl.u && acl.s, JSON.stringify(acl));

const failed = results.filter((x) => !x).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
