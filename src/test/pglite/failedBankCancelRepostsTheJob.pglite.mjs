#!/usr/bin/env node
/**
 * PGlite proof for 20261103010231_failed_bank_cancel_reposts_the_job.sql (Q2076): the poster's "Bank payment failed,
 * job cancelled" notice links to /post-job?rebook=<job id> (the Repost prefill) and says so, and NOTHING else the
 * function does moves: the same outcome, the same job row, the same Helpr notice, on the same scenarios, as prod's
 * definition.
 *
 *   node src/test/pglite/failedBankCancelRepostsTheJob.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/failedBankCancelRepostsTheJob.pglite.mjs  # RED (prod's definition)
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/failedBankCancelRepostsTheJob.pglite.mjs
 *
 * World: two databases. BASE = prod's live definition, which is 20261102055222's text (its md5 is printed and must
 * equal prod's 86ce284576a117adcf461aa63f9039d5, read 2026-11-02). NEW = the same base, then this migration 3x.
 * Each runs the same scenarios; every column of every job row and every Helpr notice must match, and only the
 * poster notice's last sentence and link may differ. pglite from ~/.lh-pglite.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const root = new URL("../../../", import.meta.url).pathname;
const BASE_MIG = `${root}supabase/migrations/20261102055222_payout_moving_blocks_failed_bank_cancel.sql`;
const MIG = `${root}supabase/migrations/20261103010231_failed_bank_cancel_reposts_the_job.sql`;
const NEW = process.env.MIGRATION_PATH ?? MIG;
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running on prod's definition only (expect FAILs)");

const PROD_MD5 = "86ce284576a117adcf461aa63f9039d5";
const baseText = readFileSync(BASE_MIG, "utf8");
const BASE = baseText.slice(baseText.indexOf("CREATE OR REPLACE FUNCTION"));

const P = "11111111-1111-1111-1111-111111111111"; // poster
const H = "22222222-2222-2222-2222-222222222222"; // confirmed Helpr
const H2 = "33333333-3333-3333-3333-333333333333"; // second crew Helpr
const SCHEMA = `
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
CREATE TABLE public.notifications (seq serial, id uuid primary key default gen_random_uuid(), user_id uuid, job_id uuid, title text, message text, type text, link text);
`;

async function world(applyNew) {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(BASE);
  const md5 = (await db.query(`select md5(pg_get_functiondef('public.cancel_job_after_failed_bank_payment(uuid,text,uuid)'::regprocedure)) m`)).rows[0].m;
  if (applyNew) {
    const sql = readFileSync(NEW, "utf8");
    for (let i = 1; i <= 3; i++) { await db.exec(sql); console.log("apply", i, "ok"); }
  }
  return { db, md5 };
}

const SCENARIOS = [
  { name: "hired, confirmed Helpr, accepted", status: "accepted", hired: true, confirmed: true },
  { name: "hired, Helpr not confirmed", status: "accepted", hired: true, confirmed: false },
  { name: "in progress", status: "in_progress", hired: true, confirmed: true },
  { name: "crew of two confirmed", status: "accepted", crew: true },
  { name: "nobody hired (not_hired, no write)", status: "open", hired: false },
  { name: "a payout row (payout_moving, no write)", status: "accepted", hired: true, confirmed: true, transfer: "pending" },
  { name: "untitled job", status: "accepted", hired: true, confirmed: true, title: null },
];

async function run(db) {
  const q = async (s, p = []) => (await db.query(s, p)).rows;
  const out = [];
  for (const [i, s] of SCENARIOS.entries()) {
    const J = `00000000-0000-0000-0000-${String(i + 1).padStart(12, "0")}`;
    await q(`insert into jobs (id, title, customer_id, helper_id, helper_confirmed_at, status, payment_status, stripe_payment_intent_id, stripe_session_id, is_group_job)
             values ($1, $2, $3, $4, $5, $6::job_status, 'escrow', 'pi_x', 'cs_x', $7)`,
      [J, "title" in s ? s.title : "Mow the yard", P, s.hired ? H : null, s.hired && s.confirmed ? "2026-11-01T12:00:00Z" : null, s.status, !!s.crew]);
    if (s.crew) {
      await q(`insert into group_job_helpers (job_id, helper_id, helper_confirmed_at) values ($1, $2, '2026-11-01T12:00:00Z'), ($1, $3, '2026-11-01T12:00:00Z')`, [J, H, H2]);
    }
    if (s.transfer) await q(`insert into payout_transfers (job_id, status) values ($1, $2)`, [J, s.transfer]);
    await db.exec(`SET ROLE service_role`);
    const r = (await q(`select public.cancel_job_after_failed_bank_payment($1, 'pi_x', null) v`, [J]))[0].v;
    await db.exec(`RESET ROLE`);
    const job = (await q(`select status::text, payment_status, stripe_session_id, cancelled_by, cancellation_reason, late_cancellation,
                                 cancellation_fee, cancellation_fee_status, direct_offer_status, direct_offer_expires_at,
                                 (cancelled_at is not null) cancelled
                            from jobs where id = $1`, [J]))[0];
    const poster = await q(`select title, message, type, link from notifications where job_id = $1 and user_id = $2 order by seq`, [J, P]);
    const helprs = await q(`select user_id, title, message, type, link from notifications where job_id = $1 and user_id <> $2 order by seq`, [J, P]);
    out.push({ J, s, r, job, poster, helprs });
  }
  return out;
}

const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(ok ? "PASS" : "FAIL", name, ok ? "" : (detail ?? "")); };

const base = await world(false);
console.log("base md5", base.md5, base.md5 === PROD_MD5 ? "(= prod)" : "(NOT prod's)");
check("base is prod's live definition (md5)", base.md5 === PROD_MD5, base.md5);
const neu = await world(!skip);
const A = await run(base.db);
const B = await run(neu.db);

const SENTENCE = " Tap here to post it again with the details filled in.";
let posterNotices = 0;
for (let i = 0; i < SCENARIOS.length; i++) {
  const a = A[i], b = B[i];
  const name = a.s.name;
  check(`${name}: same outcome`, JSON.stringify(a.r) === JSON.stringify(b.r), `${JSON.stringify(a.r)} vs ${JSON.stringify(b.r)}`);
  check(`${name}: same job row`, JSON.stringify(a.job) === JSON.stringify(b.job), `${JSON.stringify(a.job)} vs ${JSON.stringify(b.job)}`);
  check(`${name}: same Helpr notices`, JSON.stringify(a.helprs) === JSON.stringify(b.helprs), `${JSON.stringify(a.helprs)} vs ${JSON.stringify(b.helprs)}`);
  check(`${name}: same number of poster notices`, a.poster.length === b.poster.length && b.poster.length <= 1, `${a.poster.length} vs ${b.poster.length}`);
  if (b.poster.length === 1) {
    posterNotices += 1;
    const pa = a.poster[0], pb = b.poster[0];
    check(`${name}: poster notice links to the Repost prefill of THIS job`, pb.link === `/post-job?rebook=${b.J}`, pb.link);
    check(`${name}: poster notice says the details come filled in, never "any time"`,
      pb.message.endsWith(SENTENCE) && !/any time/.test(pb.message), pb.message);
    check(`${name}: poster notice otherwise unchanged (title, type, the rest of the sentence)`,
      pa.title === pb.title && pa.type === pb.type
        && pa.message.replace(/ You can post it again any time\.$/, "") === pb.message.slice(0, -SENTENCE.length),
      `${JSON.stringify(pa)} vs ${JSON.stringify(pb)}`);
  }
}
// Inventory floor: the cancelling scenarios really wrote a poster notice (5 cancel, 2 do not write).
check("poster notices written in the cancelling scenarios", posterNotices === 5, String(posterNotices));

const acl = (await neu.db.query(`select has_function_privilege('anon', 'public.cancel_job_after_failed_bank_payment(uuid,text,uuid)', 'EXECUTE') a,
                             has_function_privilege('authenticated', 'public.cancel_job_after_failed_bank_payment(uuid,text,uuid)', 'EXECUTE') u,
                             has_function_privilege('service_role', 'public.cancel_job_after_failed_bank_payment(uuid,text,uuid)', 'EXECUTE') s`)).rows[0];
check("grants: anon and authenticated cannot execute; service_role can", skip || (!acl.a && !acl.u && acl.s), JSON.stringify(acl));

const failed = results.filter((x) => !x).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
