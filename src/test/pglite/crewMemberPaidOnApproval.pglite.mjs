#!/usr/bin/env node
/**
 * PGlite proof for 20261101044659_crew_member_paid_on_approval (JOBS-3, owner
 * 2026-10-31 ~9:35 PM: crew members are paid individually once the poster
 * confirms they worked; a no-show member gets nothing + a strike; the others
 * are never held up).
 *
 *   npx tsx src/test/pglite/crewMemberPaidOnApproval.pglite.mjs [--replay] [--before]
 *
 * The world is the EFFECTIVE definitions before this migration
 * (src/test/helpers/effectiveFunctionDefs.ts): has_role, the dispute claim
 * TTL, the roster's server-owned column guard (zza trigger) and the old
 * rpc_decide_crew_dispute. notifications carries prod's newest
 * notifications_type_check. --before leaves the migration out: the RED checks
 * must FAIL (count asserted).
 *
 * A booked, funded ($90, escrow) crew of three, shares 3000 each: M1 and M2
 * marked their part done, M3 has not.
 *   A1 the poster confirms M1: stamped, M1 told the day (financial_alerts) RED before
 *   A2 only the poster: M1 himself, M2 and a stranger are refused       RED before
 *   A3 a member not done, already approved, or off the roster (a no-show's
 *      closed spot) is refused; a client PATCH of the stamp is refused   RED before
 *   A4 not on a disputed / unfunded / finished job                      RED before
 *   D1 the due list is empty until 3 days after the approval, then holds
 *      exactly M1                                                       RED before
 *   D2 ...and drops M1 once a pending, paid or reversed transfer exists;
 *      a dispute or a refund row on the job drops it too                RED before
 *   D3 a completed job: M1 stays due while the job-wide payout is not due,
 *      and leaves the list once it is (the normal pass pays everyone)   RED before
 *   D4 service_role only: a signed-in member cannot read the due list   RED before
 *   X1 DISPUTE: an admin can NEVER refund a member the poster approved,
 *      paid or not (crew_dispute_member_already_paid)                   RED before
 *   X2 DISPUTE after M1 was paid early: the decision is allowed, M1 is
 *      'pay', and pay_cents counts M1's share, so the fan-out's one refund
 *      (budget minus paid shares) never returns M1's money             RED before
 *   X3 a transfer to a member the poster did NOT approve still refuses
 *      (money moved), as before                                         control
 *   P1 crew_member_payout_delay() is 3 days (escrowTiming parity is in
 *      src/test/crewMemberPaidOnApproval.test.ts)                       RED before
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { effectiveDefs, migrationFiles } from "../helpers/effectiveFunctionDefs.ts";
import { blankSqlComments } from "../helpers/blankNonCode.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261101044659_crew_member_paid_on_approval.sql";
const MIGRATION = readFileSync(DIR + THIS, "utf8");
const REPLAY = process.argv.includes("--replay");
const BEFORE = process.argv.includes("--before");

const BEFORE_DEFS = effectiveDefs(DIR, { before: THIS });
function fnStmt(name) {
  const d = BEFORE_DEFS.get(name);
  if (!d) throw new Error(`no migration before ${THIS} defines ${name}`);
  const open = /\bAS\s+(\$\w*\$)/i.exec(d.stmt);
  const end = d.stmt.indexOf(open[1], open.index + open[0].length);
  return `${d.stmt.slice(0, end + open[1].length)};`;
}
function triggerStmt(name) {
  let found = null;
  for (const f of migrationFiles(DIR)) {
    if (f >= THIS) break;
    const raw = readFileSync(DIR + f, "utf8");
    for (const m of blankSqlComments(raw).matchAll(new RegExp(`CREATE\\s+TRIGGER\\s+${name}\\b[^;]*;`, "gi"))) {
      found = raw.slice(m.index, m.index + m[0].length);
    }
  }
  if (!found) throw new Error(`no migration before ${THIS} creates trigger ${name}`);
  return found;
}
function notificationTypeCheck() {
  let found = null;
  for (const f of migrationFiles(DIR)) {
    if (f >= THIS) break;
    const sql = blankSqlComments(readFileSync(DIR + f, "utf8"));
    for (const m of sql.matchAll(/ADD\s+CONSTRAINT\s+notifications_type_check\s+(CHECK\s*\([\s\S]*?\)\s*\));/gi)) found = m[1];
  }
  if (!found) throw new Error(`no migration before ${THIS} sets notifications_type_check`);
  return `ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check ${found};`;
}

const FNS = ["is_server_context", "has_role", "dispute_settlement_claim_ttl", "enforce_group_member_lifecycle_server_owned", "rpc_decide_crew_dispute"];
const TRIGGERS = ["zza_group_member_lifecycle_server_owned"];

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const POSTER = U(1), M1 = U(2), M2 = U(3), M3 = U(4), STRANGER = U(5), ADMIN = U(6), CREW = U(101);

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TYPE public.app_role AS ENUM ('admin', 'customer', 'helper');
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, role public.app_role);
CREATE TYPE public.job_status AS ENUM ('open','pending_approval','accepted','in_progress','revision_requested','completed','cancelled','disputed');
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, title text,
  status public.job_status NOT NULL DEFAULT 'open', is_group_job boolean DEFAULT false, helpers_needed integer DEFAULT 1,
  budget numeric, payment_status text DEFAULT 'unpaid', payout_scheduled_at timestamptz,
  disputed_at timestamptz, dispute_status text, dispute_resolved_at timestamptz, is_seed boolean DEFAULT false);
CREATE TABLE public.group_job_helpers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  helper_id uuid, status text NOT NULL DEFAULT 'accepted', slot_no integer, share_cents integer,
  helper_confirmed_at timestamptz, helper_dayof_confirmed_at timestamptz, helper_on_the_way_at timestamptz,
  helper_arrived_at timestamptz, helper_arrival_verified_at timestamptz, helper_arrival_near_miss_at timestamptz,
  helper_arrival_near_miss_ft integer, poster_confirmed_arrival_at timestamptz, poster_confirmed_working_at timestamptz,
  helper_completed_at timestamptz, poster_confirmed_completion_at timestamptz, proof_before_urls text[], proof_after_urls text[],
  response_deadline timestamptz, UNIQUE (job_id, helper_id));
CREATE TABLE public.disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  opener_id uuid, reason text NOT NULL DEFAULT 'x', status text NOT NULL DEFAULT 'open', created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz, decided_by uuid, decision_text text, payout_split jsonb, execution_status text);
CREATE TABLE public.crew_dispute_member_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dispute_id uuid NOT NULL, job_id uuid NOT NULL, helper_id uuid,
  slot_no integer NOT NULL, share_cents integer NOT NULL, member_outcome text NOT NULL CHECK (member_outcome IN ('pay', 'refund')),
  decided_by uuid, decided_at timestamptz NOT NULL DEFAULT now(), UNIQUE (dispute_id, helper_id));
CREATE TABLE public.dispute_settlement_claims (job_id uuid PRIMARY KEY, action text, claimed_at timestamptz DEFAULT now(), money_step_at timestamptz);
CREATE TABLE public.payout_transfers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, status text, amount_cents integer);
CREATE TABLE public.payment_refunds (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, source text);
CREATE TABLE public.admin_audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admin_id uuid, action text, target_id uuid, target_type text, details jsonb);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text, message text, type text, link text, job_id uuid);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;

${notificationTypeCheck()}

${FNS.map(fnStmt).join("\n\n")}

${TRIGGERS.map(triggerStmt).join("\n")}
`;

const db = new PGlite();
const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const all = async (sql, p) => (await db.query(sql, p)).rows;
async function as(role, uid, sql) {
  await db.exec(`SET ROLE ${role}; SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false);
    SELECT set_config('request.jwt.claim.role', '${role}', false);`);
  try {
    return { ok: true, rows: (await db.query(sql)).rows };
  } catch (e) {
    return { ok: false, error: String(e.message ?? e) };
  } finally {
    await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false); SELECT set_config('request.jwt.claim.role', '', false);`);
  }
}
const approve = (uid, member) => as("authenticated", uid, `SELECT public.rpc_poster_approve_member('${CREW}', '${member}') AS r`);
const due = async () => {
  const r = await as("service_role", null, `SELECT job_id, helper_id FROM public.crew_members_due_early_payout()`);
  return r.ok ? r.rows.map((x) => x.helper_id) : null;
};
const stamp = async (m) => (await one(`SELECT poster_confirmed_completion_at AS t FROM public.group_job_helpers WHERE job_id = $1 AND helper_id = $2`, [CREW, m]))?.t ?? null;
/** Move M's approval back by `days` (the server clock is not under test). */
const ageApproval = (m, days) =>
  db.exec(`UPDATE public.group_job_helpers SET poster_confirmed_completion_at = poster_confirmed_completion_at - interval '${days} days' WHERE job_id = '${CREW}' AND helper_id = '${m}'`);

async function seed({ status = "in_progress", payment = "escrow" } = {}) {
  await db.exec(`
    DELETE FROM public.notifications; DELETE FROM public.admin_audit_log; DELETE FROM public.crew_dispute_member_outcomes;
    DELETE FROM public.payout_transfers; DELETE FROM public.payment_refunds; DELETE FROM public.disputes;
    DELETE FROM public.group_job_helpers; DELETE FROM public.jobs;
    INSERT INTO public.jobs (id, customer_id, title, status, is_group_job, helpers_needed, budget, payment_status)
      VALUES ('${CREW}', '${POSTER}', 'Move a piano', '${status}', true, 3, 90, '${payment}');
    INSERT INTO public.group_job_helpers (job_id, helper_id, slot_no, share_cents, helper_confirmed_at, helper_completed_at) VALUES
      ('${CREW}', '${M1}', 0, 3000, now() - interval '1 day', now() - interval '1 hour'),
      ('${CREW}', '${M2}', 1, 3000, now() - interval '1 day', now() - interval '1 hour'),
      ('${CREW}', '${M3}', 2, 3000, now() - interval '1 day', NULL);
  `);
}
const openDispute = () =>
  db.exec(`UPDATE public.jobs SET status = 'disputed', disputed_at = now(), dispute_status = 'open' WHERE id = '${CREW}';
           INSERT INTO public.disputes (job_id, opener_id) VALUES ('${CREW}', '${POSTER}');`);
const decide = async (refund) => {
  const id = (await one(`SELECT id FROM public.disputes WHERE job_id = $1 AND status = 'open'`, [CREW]))?.id;
  return as("authenticated", ADMIN, `SELECT public.rpc_decide_crew_dispute('${id}', 'M3 did not finish.', ARRAY[${refund.map((r) => `'${r}'`).join(",")}]::uuid[]) AS r`);
};

await db.exec(SCHEMA);
await db.exec(`INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin')`);
if (!BEFORE) {
  for (let i = 1; i <= (REPLAY ? 3 : 1); i++) {
    try {
      await db.exec(MIGRATION);
      console.log(`applied ${THIS} (run ${i})`);
    } catch (e) {
      check(`migration applies (run ${i})`, false, e.message);
    }
  }
} else {
  console.log(`--before: ${THIS} NOT applied (the RED checks must FAIL)`);
}

// A1
await seed();
const a1 = await approve(POSTER, M1);
const n1 = await all(`SELECT title, message, type, job_id FROM public.notifications WHERE user_id = $1`, [M1]);
check("A1 the poster confirms M1: stamped, M1 told the payout day",
  a1.ok && (await stamp(M1)) !== null && (await stamp(M2)) === null && n1.length === 1 && n1[0].type === "financial_alerts"
    && /confirmed your work\. You'll be paid on [A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}\.$/.test(n1[0].message) && n1[0].job_id === CREW,
  a1.ok ? JSON.stringify(n1) : a1.error);

// A2
await seed();
const a2 = [await approve(M1, M1), await approve(M2, M1), await approve(STRANGER, M1)];
check("A2 only the poster: the member himself, another member and a stranger are refused",
  !BEFORE && a2.every((r) => !r.ok && /not_authorized/.test(r.error)) && (await stamp(M1)) === null,
  a2.map((r) => r.error).join(" | "));

// A3
await seed();
const a3NotDone = await approve(POSTER, M3);
await approve(POSTER, M1);
const a3Twice = await approve(POSTER, M1);
await db.exec(`DELETE FROM public.group_job_helpers WHERE job_id = '${CREW}' AND helper_id = '${M2}'`);
const a3Gone = await approve(POSTER, M2);
const a3Patch = await as("authenticated", POSTER,
  `UPDATE public.group_job_helpers SET poster_confirmed_completion_at = now() WHERE job_id = '${CREW}' AND helper_id = '${M3}'`);
check("A3 not done / already approved / off the roster (a no-show's closed spot) refused; a client PATCH of the stamp refused",
  !BEFORE && /helper_not_done/.test(a3NotDone.error ?? "") && /already_approved/.test(a3Twice.error ?? "")
    && /not_on_this_crew/.test(a3Gone.error ?? "") && !a3Patch.ok && (await stamp(M3)) === null,
  [a3NotDone.error, a3Twice.error, a3Gone.error, a3Patch.error].join(" | "));

// A4
const a4 = [];
await seed(); await openDispute(); a4.push(await approve(POSTER, M1));
await seed({ payment: "held" }); a4.push(await approve(POSTER, M1));
await seed({ status: "completed", payment: "payout_pending" }); a4.push(await approve(POSTER, M1));
check("A4 refused on a disputed, unfunded or finished job",
  !BEFORE && /job_not_active/.test(a4[0].error ?? "") && /job_not_funded/.test(a4[1].error ?? "") && /job_not_active/.test(a4[2].error ?? ""),
  a4.map((r) => r.error).join(" | "));

// D1
await seed();
await approve(POSTER, M1);
await approve(POSTER, M2);
const d1Fresh = await due();
await ageApproval(M1, 3);
const d1Aged = await due();
check("D1 nobody is due until 3 days after their approval; then exactly M1",
  Array.isArray(d1Fresh) && d1Fresh.length === 0 && Array.isArray(d1Aged) && d1Aged.length === 1 && d1Aged[0] === M1,
  `fresh=${JSON.stringify(d1Fresh)} aged=${JSON.stringify(d1Aged)}`);

// D2
const d2 = {};
for (const st of ["pending", "paid", "reversed", "failed"]) {
  await db.exec(`DELETE FROM public.payout_transfers; INSERT INTO public.payout_transfers (job_id, helper_id, status, amount_cents) VALUES ('${CREW}', '${M1}', '${st}', 2700)`);
  d2[st] = await due();
}
await db.exec(`DELETE FROM public.payout_transfers; INSERT INTO public.payment_refunds (job_id, source) VALUES ('${CREW}', 'x')`);
d2.refund = await due();
await db.exec(`DELETE FROM public.payment_refunds; INSERT INTO public.disputes (job_id, opener_id) VALUES ('${CREW}', '${POSTER}')`);
d2.openDispute = await due();
await db.exec(`DELETE FROM public.disputes`);
d2.clear = await due();
check("D2 a live transfer (pending/paid/reversed), a refund row or an open dispute drops M1; a failed attempt does not",
  ["pending", "paid", "reversed"].every((s) => d2[s]?.length === 0) && d2.failed?.length === 1
    && d2.refund?.length === 0 && d2.openDispute?.length === 0 && d2.clear?.length === 1,
  JSON.stringify(d2));

// D3
await db.exec(`UPDATE public.jobs SET status = 'completed', payment_status = 'payout_pending', payout_scheduled_at = now() + interval '1 day' WHERE id = '${CREW}'`);
const d3Early = await due();
await db.exec(`UPDATE public.jobs SET payout_scheduled_at = now() - interval '1 minute' WHERE id = '${CREW}'`);
const d3Main = await due();
check("D3 completed job: M1 due while the job-wide payout is not due yet; off the list once it is (the normal pass pays all)",
  d3Early?.length === 1 && d3Main?.length === 0, `early=${JSON.stringify(d3Early)} main=${JSON.stringify(d3Main)}`);

// D4
const d4 = await as("authenticated", M1, `SELECT * FROM public.crew_members_due_early_payout()`);
check("D4 a signed-in member cannot read the due list", !BEFORE && !d4.ok && /permission denied/.test(d4.error), d4.error);

// X1: refund of an approved member is refused, paid or not. The stamp is
// written as the server (not through the approve RPC) so the dispute RPC is
// proven on its own, before and after.
await seed();
await db.exec(`UPDATE public.group_job_helpers SET poster_confirmed_completion_at = now() - interval '4 days' WHERE job_id = '${CREW}' AND helper_id = '${M1}'`);
await openDispute();
const x1Unpaid = await decide([M1]);
await db.exec(`INSERT INTO public.payout_transfers (job_id, helper_id, status, amount_cents) VALUES ('${CREW}', '${M1}', 'paid', 2700)`);
const x1Paid = await decide([M1]);
const x1Outcomes = (await one(`SELECT count(*)::int AS n FROM public.crew_dispute_member_outcomes`)).n;
check("X1 an admin can NEVER refund a member the poster approved, paid or not",
  /crew_dispute_member_already_paid/.test(x1Unpaid.error ?? "") && /crew_dispute_member_already_paid/.test(x1Paid.error ?? "") && x1Outcomes === 0,
  `unpaid=${x1Unpaid.ok ? JSON.stringify(x1Unpaid.rows) : x1Unpaid.error} paid=${x1Paid.ok ? JSON.stringify(x1Paid.rows) : x1Paid.error}`);

// X2: dispute decided after M1 was paid early: M1 'pay', pay_cents counts M1.
await seed();
await db.exec(`UPDATE public.group_job_helpers SET poster_confirmed_completion_at = now() - interval '4 days' WHERE job_id = '${CREW}' AND helper_id = '${M1}'`);
await openDispute();
await db.exec(`INSERT INTO public.payout_transfers (job_id, helper_id, status, amount_cents) VALUES ('${CREW}', '${M1}', 'paid', 2700)`);
const x2 = await decide([M3]);
const x2Out = await all(`SELECT helper_id, member_outcome FROM public.crew_dispute_member_outcomes ORDER BY slot_no`);
const x2Res = x2.ok ? x2.rows[0].r : null;
check("X2 dispute after M1's early payout: allowed, M1 'pay', pay_cents 6000 (M1+M2), refund 3000 (M3 only)",
  x2.ok && x2Out.map((o) => o.member_outcome).join(",") === "pay,pay,refund"
    && Number(x2Res.pay_cents) === 6000 && Number(x2Res.refund_share_cents) === 3000,
  x2.ok ? `${JSON.stringify(x2Out)} ${JSON.stringify(x2Res)}` : x2.error);

// X3 control: a transfer to a member the poster did not approve still refuses.
await seed();
await openDispute();
await db.exec(`INSERT INTO public.payout_transfers (job_id, helper_id, status, amount_cents) VALUES ('${CREW}', '${M2}', 'paid', 2700)`);
const x3 = await decide([M3]);
check("X3 control: a transfer to an UNapproved member still refuses (money moved)", /crew_dispute_money_moved/.test(x3.error ?? ""), x3.error);

// P1
const p1 = await as("service_role", null, `SELECT public.crew_member_payout_delay()::text AS d`);
check("P1 crew_member_payout_delay() is 3 days", p1.ok && p1.rows[0].d === "3 days", p1.ok ? p1.rows[0].d : p1.error);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
if (BEFORE) {
  // Only X3 (the control) holds without the migration.
  const expected = 11;
  console.log(failures === expected ? `RED as expected (${failures}/${expected})` : `NOT RED: ${failures}/${expected} failed`);
  process.exit(failures === expected ? 0 : 1);
}
process.exit(failures ? 1 : 0);
