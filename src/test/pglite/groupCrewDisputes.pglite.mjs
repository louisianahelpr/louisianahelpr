#!/usr/bin/env node
/**
 * PGlite proof for 20260925234055_group_crew_disputes (docs/OPEN.md Q409 and
 * the SQL half of Q396(c); owner rules Q407: a crew has no lead, every hired
 * member is equal, each member's share is frozen in cents at hire).
 *
 *   PGLITE_DIR=~/.lh-pglite-probe node --experimental-strip-types \
 *     --import <a resolver for extensionless .ts imports> \
 *     src/test/pglite/groupCrewDisputes.pglite.mjs [--replay]
 *   (or `npx tsx src/test/pglite/groupCrewDisputes.pglite.mjs`)
 *
 * Every function and trigger in the path is read from its EFFECTIVE definition
 * in the migrations before this one (src/test/helpers/effectiveFunctionDefs.ts:
 * any dollar tag, comments blanked, later in-place rewrites applied), never a
 * pinned file. The group job's NULL helper_id is held by the REAL
 * trg_group_job_has_no_lead; every jobs write runs the real dispute-marker,
 * status-transition, deadline and money-lock triggers; the disputes writes run
 * the real opener column whitelist. Stubs (not under test): is_caller_banned,
 * check_dispute_velocity, notify_ops_dispute_filed.
 *
 * RED-BEFORE (the effective definitions, this migration NOT applied):
 *   R1  an outsider (no role on the job) opens a dispute on a booked crew and
 *       freezes it: `_uid <> NULL` is NULL, so the party check never fires.
 *   R2  an outsider escalates a crew's dispute (same NULL comparison).
 *   R3  a crew member cannot read the dispute holding their pay.
 *   R4  rpc_decide_dispute records a 50/50 split on a crew: decided, execution
 *       'pending', job completed with the escrow still held: a decision that
 *       execute-dispute-split refuses for every group job, stranded.
 *   R5  there is no per-member decision at all.
 * AFTER: A1..A16 below; --replay applies the migration 3x first.
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { effectiveDefs, migrationFiles } from "../helpers/effectiveFunctionDefs.ts";
import { blankSqlComments } from "../helpers/blankNonCode.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20260925234055_group_crew_disputes.sql";
const read = (f) => readFileSync(DIR + f, "utf8");
const MIGRATION = process.env.NEW_MIGRATION_FILE ? readFileSync(process.env.NEW_MIGRATION_FILE, "utf8") : read(THIS);
const REPLAY = process.argv.includes("--replay");

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
    const raw = read(f);
    for (const m of blankSqlComments(raw).matchAll(new RegExp(`CREATE\\s+TRIGGER\\s+${name}\\b[^;]*;`, "gi"))) {
      found = raw.slice(m.index, m.index + m[0].length);
    }
  }
  if (!found) throw new Error(`no migration before ${THIS} creates trigger ${name}`);
  return found;
}

const FNS = [
  "is_server_context", "has_role", "dispute_settlement_claim_ttl", "dispute_evidence_url_ok",
  "enforce_group_job_has_no_lead", "enforce_dispute_markers_server_owned", "enforce_job_status_transition",
  "set_dispute_deadline", "enforce_poster_jobs_money_lock", "enforce_dispute_opener_column_whitelist",
  "open_dispute_as", "rpc_open_dispute", "rpc_escalate_dispute", "rpc_decide_dispute", "rpc_withdraw_dispute",
  "rpc_supersede_dispute_decision",
];
const TRIGGERS = [
  "trg_group_job_has_no_lead", "trg_dispute_markers_server_owned", "trg_enforce_job_status_transition",
  "trg_set_dispute_deadline", "trg_poster_jobs_money_lock", "trg_enforce_dispute_opener_column_whitelist",
];

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const POSTER = U(1), M1 = U(2), M2 = U(3), M3 = U(4), OUTSIDER = U(5), ADMIN = U(6), ADMIN2 = U(7), SOLO = U(8);
const CREW = U(101), SINGLE = U(102);

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TYPE public.app_role AS ENUM ('admin', 'customer', 'helper');
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, role public.app_role);
CREATE TYPE public.job_status AS ENUM ('open','pending_approval','accepted','in_progress','revision_requested','completed','cancelled','disputed');
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, title text,
  status public.job_status NOT NULL DEFAULT 'open', is_group_job boolean DEFAULT false, helpers_needed integer DEFAULT 1,
  budget numeric, urgent_fee numeric, payment_status text DEFAULT 'unpaid', stripe_session_id text, stripe_payment_intent_id text,
  offered_to_helper_id uuid, poster_completed_at timestamptz, payout_scheduled_at timestamptz,
  disputed_by uuid, disputed_at timestamptz, dispute_reason text, dispute_status text, dispute_evidence_urls text[],
  dispute_deadline timestamptz, dispute_resolved_at timestamptz, updated_at timestamptz DEFAULT now());
CREATE TABLE public.group_job_helpers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  helper_id uuid, status text NOT NULL DEFAULT 'accepted', slot_no integer, share_cents integer, UNIQUE (job_id, helper_id));
CREATE TABLE public.disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  opener_id uuid, reason text NOT NULL, evidence_urls text[] NOT NULL DEFAULT '{}'::text[],
  status text NOT NULL DEFAULT 'open', created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz, decided_by uuid, decision_text text, payout_split jsonb,
  execution_status text, execution_started_at timestamptz, executed_at timestamptz,
  execution_transfer_id text, execution_refund_id text, execution_helper_cents integer,
  execution_refund_cents integer, execution_error text);
ALTER TABLE public.disputes ADD CONSTRAINT disputes_execution_status_check
  CHECK (execution_status IS NULL OR execution_status IN ('pending', 'executing', 'executed', 'failed'));
CREATE UNIQUE INDEX disputes_one_open_per_job_idx ON public.disputes (job_id) WHERE status = 'open';
CREATE TABLE public.dispute_settlement_claims (job_id uuid PRIMARY KEY, action text, claimed_at timestamptz DEFAULT now(), money_step_at timestamptz);
CREATE TABLE public.payout_transfers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, status text, amount_cents integer);
CREATE TABLE public.payment_refunds (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, source text);
CREATE TABLE public.admin_audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admin_id uuid, action text, target_id uuid, target_type text, details jsonb);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text, message text, type text, link text, job_id uuid, read boolean DEFAULT false);
CREATE TABLE public.fraud_flags (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, job_id uuid, flag_type text, details text, resolved boolean DEFAULT false);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;

-- Stubs (not under test).
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.check_dispute_velocity(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.notify_ops_dispute_filed(uuid, text, text, uuid, boolean) RETURNS void LANGUAGE sql AS $$ SELECT $$;

${FNS.map(fnStmt).join("\n\n")}

${TRIGGERS.map(triggerStmt).join("\n")}

-- The disputes RLS as live (20260609140000): opener, the job's two parties, admins.
ALTER TABLE public.disputes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "disputes opener select" ON public.disputes FOR SELECT TO authenticated USING (auth.uid() = opener_id);
CREATE POLICY "disputes job parties select" ON public.disputes FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = disputes.job_id AND (j.customer_id = auth.uid() OR j.helper_id = auth.uid())));
CREATE POLICY "disputes admin all" ON public.disputes FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
`;

const db = new PGlite();
const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const all = async (sql, p) => (await db.query(sql, p)).rows;
async function as(role, uid, sql) {
  await db.exec(`SET ROLE ${role}; SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false);
    SELECT set_config('request.jwt.claim.role', '${role}', false);`);
  try {
    const r = await db.query(sql);
    return { ok: true, rows: r.rows };
  } catch (e) {
    return { ok: false, error: String(e.message ?? e) };
  } finally {
    await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false); SELECT set_config('request.jwt.claim.role', '', false);`);
  }
}
const asUser = (uid, sql) => as("authenticated", uid, sql);
const REASON = "The crew left half the furniture in the truck.";

/** A booked, funded crew of three on $100 (frozen 3334/3333/3333) and a single job. */
async function seed({ status = "in_progress", payment = "escrow", shares = true } = {}) {
  await db.exec(`
    DELETE FROM public.notifications; DELETE FROM public.admin_audit_log; DELETE FROM public.dispute_settlement_claims;
    DELETE FROM public.payout_transfers; DELETE FROM public.payment_refunds;
    ${hasOutcomes ? "DELETE FROM public.crew_dispute_member_outcomes;" : ""}
    DELETE FROM public.disputes; DELETE FROM public.group_job_helpers; DELETE FROM public.jobs;
    INSERT INTO public.jobs (id, customer_id, title, status, is_group_job, helpers_needed, budget, payment_status, stripe_session_id)
      VALUES ('${CREW}', '${POSTER}', 'Move a piano', 'accepted', true, 3, 100, '${payment}', 'cs_1');
    INSERT INTO public.jobs (id, customer_id, helper_id, title, status, budget, payment_status, stripe_session_id)
      VALUES ('${SINGLE}', '${POSTER}', '${SOLO}', 'Mow a lawn', 'accepted', 80, 'escrow', 'cs_2');
    INSERT INTO public.group_job_helpers (job_id, helper_id, slot_no, share_cents) VALUES
      ('${CREW}', '${M1}', ${shares ? "0, 3334" : "NULL, NULL"}), ('${CREW}', '${M2}', 1, 3333), ('${CREW}', '${M3}', 2, 3333);
    UPDATE public.jobs SET status = '${status}' WHERE id IN ('${CREW}', '${SINGLE}') AND '${status}' <> 'accepted';
  `);
}
let hasOutcomes = false;
const openAs = (uid, job = CREW) => asUser(uid, `SELECT public.rpc_open_dispute('${job}', '${REASON}', '{}') AS id`);
const disputeId = async (job = CREW) => (await one(`SELECT id FROM public.disputes WHERE job_id = $1 ORDER BY created_at DESC LIMIT 1`, [job]))?.id;
const jobRow = (id = CREW) => one(`SELECT status::text AS status, payment_status, dispute_status, disputed_at, disputed_by, payout_scheduled_at FROM public.jobs WHERE id = $1`, [id]);
const told = async (uid, title) => (await all(`SELECT 1 FROM public.notifications WHERE user_id = $1 AND title = $2`, [uid, title])).length;
const decideCrew = async (uid, refund) =>
  asUser(uid, `SELECT public.rpc_decide_crew_dispute('${await disputeId()}', 'Two of three did the work.', ARRAY[${refund.map((r) => `'${r}'`).join(",")}]::uuid[]) AS r`);

await db.exec(SCHEMA);
await db.exec(`INSERT INTO auth.users (id) VALUES ${[POSTER, M1, M2, M3, OUTSIDER, ADMIN, ADMIN2, SOLO].map((u) => `('${u}')`).join(",")};
  INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin'), ('${ADMIN2}', 'admin'), ('${M3}', 'admin');`);
console.log(`world: ${FNS.length} functions, ${TRIGGERS.length} triggers from their effective definitions before ${THIS}`);

// ════════════════════════════════════════════════════════════════════════════
console.log("\n── RED-BEFORE (this migration NOT applied) ──────────────────────");
await seed();
let lead = "allowed";
try { await db.exec(`UPDATE public.jobs SET helper_id = '${M1}' WHERE id = '${CREW}'`); } catch (e) { lead = String(e.message); }
check("world: the real trg_group_job_has_no_lead holds the crew's helper_id at NULL", /group_job_has_no_lead/.test(lead), lead.slice(0, 80));

const r1 = await openAs(OUTSIDER);
const r1j = await jobRow();
check("R1 an outsider opens a dispute on a booked crew and freezes it", r1.ok && r1j.status === "disputed" && r1j.disputed_by === OUTSIDER, r1.error ?? `status=${r1j.status}`);

await seed();
await openAs(POSTER);
const r2 = await asUser(OUTSIDER, `SELECT public.rpc_escalate_dispute('${CREW}') AS id`);
check("R2 an outsider escalates a crew's dispute", r2.ok && (await jobRow()).dispute_status === "escalated", r2.error ?? "");

const r3 = await asUser(M1, `SELECT id FROM public.disputes WHERE job_id = '${CREW}'`);
check("R3 a crew member cannot read the dispute holding their pay", r3.ok && r3.rows.length === 0, JSON.stringify(r3.rows ?? r3.error));

await seed();
await openAs(POSTER);
const r4 = await asUser(ADMIN, `SELECT public.rpc_decide_dispute('${await disputeId()}', 'Half each.', '{"poster":0.5,"helper":0.5}')`);
const r4d = await one(`SELECT status, execution_status FROM public.disputes WHERE id = $1`, [await disputeId()]);
const r4j = await jobRow();
check(
  "R4 rpc_decide_dispute records a 50/50 split on a crew: decided, execution pending, job completed with the escrow held (execute-dispute-split refuses every group job)",
  r4.ok && r4d.status === "decided" && r4d.execution_status === "pending" && r4j.status === "completed" && r4j.payment_status === "escrow",
  r4.error ?? JSON.stringify({ ...r4d, job: r4j.status, pay: r4j.payment_status }),
);
const r5 = (await one(`SELECT to_regprocedure('public.rpc_decide_crew_dispute(uuid,text,uuid[])') AS p`)).p;
check("R5 there is no per-member crew decision", r5 === null, String(r5));

// ════════════════════════════════════════════════════════════════════════════
for (let i = 1; i <= (REPLAY ? 3 : 1); i++) {
  try {
    await db.exec(MIGRATION);
    console.log(`\napply #${i}: OK`);
  } catch (e) {
    console.log(`\napply #${i}: FAILED — ${e.message ?? e}`);
    failures++;
  }
}
hasOutcomes = !!(await one(`SELECT to_regclass('public.crew_dispute_member_outcomes') AS t`)).t;
console.log("\n── AFTER (migration applied) ────────────────────────────────────");

await seed();
const a1 = await openAs(OUTSIDER);
const a1j = await jobRow();
check("A1 an outsider cannot open a dispute on a crew; the job is untouched", !a1.ok && /not authorized/.test(a1.error) && a1j.status === "in_progress" && a1j.disputed_at === null, a1.error ?? "allowed");

const a2 = await openAs(M2);
const a2j = await jobRow();
check(
  "A2 a hired crew member opens a dispute as the Helpr side; the poster and the two OTHER members are told, the filer is not",
  a2.ok && a2j.status === "disputed" && a2j.disputed_by === M2 &&
    (await told(POSTER, "A dispute was opened")) === 1 && (await told(M1, "A dispute was opened")) === 1 &&
    (await told(M3, "A dispute was opened")) === 1 && (await told(M2, "A dispute was opened")) === 0,
  a2.error ?? JSON.stringify({ poster: await told(POSTER, "A dispute was opened"), m2: await told(M2, "A dispute was opened") }),
);
const a3 = await asUser(OUTSIDER, `SELECT public.rpc_escalate_dispute('${CREW}') AS id`);
const a3b = await asUser(M1, `SELECT public.rpc_escalate_dispute('${CREW}') AS id`);
check(
  "A3 an outsider cannot escalate a crew's dispute; a member can, and the poster and other members are told",
  !a3.ok && /not authorized/.test(a3.error) && a3b.ok && (await jobRow()).dispute_status === "escalated" &&
    (await told(POSTER, "Dispute escalated to an admin")) === 1 && (await told(M2, "Dispute escalated to an admin")) === 1 &&
    (await told(M1, "Dispute escalated to an admin")) === 0,
  `${a3.error ?? "allowed"} | ${a3b.error ?? "ok"}`,
);
const seen = async (u) => (await asUser(u, `SELECT id FROM public.disputes WHERE job_id = '${CREW}'`)).rows?.length ?? -1;
check("A4 every crew member reads the dispute; an outsider does not", (await seen(M1)) === 1 && (await seen(M3)) === 1 && (await seen(OUTSIDER)) === 0,
  JSON.stringify({ m1: await seen(M1), m3: await seen(M3), outsider: await seen(OUTSIDER) }));

await seed();
const a5 = await openAs(POSTER);
check("A5 the poster opens a dispute on a crew: every member is told", a5.ok &&
  (await told(M1, "A dispute was opened")) + (await told(M2, "A dispute was opened")) + (await told(M3, "A dispute was opened")) === 3, a5.error ?? "");

const a6 = await asUser(ADMIN, `SELECT public.rpc_decide_dispute('${await disputeId()}', 'Half each.', '{"poster":0.5,"helper":0.5}')`);
const a6d = await one(`SELECT status, execution_status FROM public.disputes WHERE id = $1`, [await disputeId()]);
check(
  "A6 rpc_decide_dispute refuses a crew before any write (the dispute stays open, the job disputed)",
  !a6.ok && /group_dispute_needs_crew_decision/.test(a6.error) && a6d.status === "open" && a6d.execution_status === null && (await jobRow()).status === "disputed",
  a6.error ?? "allowed",
);

// ── The per-member decision ─────────────────────────────────────────────────
const refusals = {
  poster: await decideCrew(POSTER, [M3]),
  memberAdmin: await decideCrew(M3, [M1]),
  all: await decideCrew(ADMIN, [M1, M2, M3]),
  unknown: await decideCrew(ADMIN, [OUTSIDER]),
};
check(
  "A7 refused: a non-admin, an admin who is on the crew, refunding every member (that is Full refund), a member not on the crew",
  /admin only/.test(refusals.poster.error ?? "") && /admin_is_party/.test(refusals.memberAdmin.error ?? "") &&
    /crew_dispute_all_refunded/.test(refusals.all.error ?? "") && /crew_dispute_unknown_member/.test(refusals.unknown.error ?? ""),
  JSON.stringify(Object.fromEntries(Object.entries(refusals).map(([k, v]) => [k, (v.error ?? "allowed").slice(0, 40)]))),
);
await db.exec(`INSERT INTO public.dispute_settlement_claims (job_id, action) VALUES ('${CREW}', 'refund')`);
const a8 = await decideCrew(ADMIN, [M3]);
await db.exec(`DELETE FROM public.dispute_settlement_claims`);
check("A8 refused while a settlement claim holds the escrow", !a8.ok && /dispute_settlement_in_progress/.test(a8.error), a8.error ?? "allowed");

const a9 = await decideCrew(ADMIN, [M3]);
const out = await all(`SELECT helper_id, slot_no, share_cents, outcome FROM public.crew_dispute_member_outcomes WHERE dispute_id = $1 ORDER BY slot_no`, [await disputeId()]);
const a9d = await one(`SELECT status, execution_status, payout_split FROM public.disputes WHERE id = $1`, [await disputeId()]);
const a9j = await jobRow();
const hold = (new Date(a9j.payout_scheduled_at).getTime() - Date.now()) / 3600e3;
check(
  "A9 admin decides M1, M2 paid and M3 refunded on $100: outcomes 3334 pay / 3333 pay / 3333 refund, pay 6667 + refund 3333 = the budget; decided 'crew_fanout'; job completed + payout_pending after a ~24h hold",
  a9.ok && out.map((o) => `${o.share_cents}:${o.outcome}`).join(",") === "3334:pay,3333:pay,3333:refund" &&
    a9.rows[0].r.pay_cents === 6667 && a9.rows[0].r.refund_share_cents === 3333 &&
    a9d.status === "decided" && a9d.execution_status === "crew_fanout" && a9d.payout_split.crew === true &&
    a9j.status === "completed" && a9j.payment_status === "payout_pending" && a9j.dispute_status === "resolved" && hold > 23.9 && hold < 24.1,
  a9.error ?? JSON.stringify({ out: out.map((o) => `${o.share_cents}:${o.outcome}`), r: a9.rows[0].r, d: a9d.execution_status, job: a9j, hold }),
);
const msgs = await all(`SELECT user_id, message FROM public.notifications WHERE title = 'Dispute resolved' ORDER BY user_id`);
const msgFor = (u) => msgs.find((m) => m.user_id === u)?.message ?? "";
check(
  "A10 each member is told their own outcome, the poster that a share is coming back",
  /Your share will be paid out/.test(msgFor(M1)) && /Your share will be paid out/.test(msgFor(M2)) &&
    /Your share goes back to the poster/.test(msgFor(M3)) && /1 Helpr is being returned to you/.test(msgFor(POSTER)),
  JSON.stringify(msgs.map((m) => `${m.user_id.slice(-2)}:${m.message.slice(-40)}`)),
);

// ── Only the fan-out closes it ──────────────────────────────────────────────
const direct = await asUser(ADMIN, `UPDATE public.disputes SET execution_status = 'executed' WHERE id = '${await disputeId()}'`);
const rewrite = await asUser(ADMIN, `UPDATE public.disputes SET payout_split = '{"poster":0,"helper":1}' WHERE id = '${await disputeId()}'`);
const markAuth = await asUser(ADMIN, `SELECT public.mark_crew_dispute_executed('${await disputeId()}', 6000, 3333, 're_1') AS ok`);
check(
  "A11 an admin cannot mark a crew decision executed or rewrite its split directly, nor call the fan-out's close",
  !direct.ok && /crew_fanout_settled_by_payout_run/.test(direct.error) && !rewrite.ok && /crew_fanout_decision_fixed/.test(rewrite.error) &&
    !markAuth.ok && /permission denied/.test(markAuth.error),
  JSON.stringify({ direct: direct.error?.slice(0, 50), rewrite: rewrite.error?.slice(0, 50), mark: markAuth.error?.slice(0, 50) }),
);
const sup = await asUser(ADMIN2, `SELECT public.rpc_supersede_dispute_decision('${await disputeId()}', 'Wrong member refunded; re-deciding.') AS id`);
check("A12 inside the 24h hold an admin may still supersede the crew decision", sup.ok && (await jobRow()).status === "disputed", sup.error ?? "");
const a12b = await decideCrew(ADMIN, [M2]);
check("A12b the superseded dispute is decided again from payout_pending (the escrow is still held)", a12b.ok, a12b.error ?? "");
await db.exec(`UPDATE public.jobs SET payout_scheduled_at = now() + interval '5 minutes' WHERE id = '${CREW}'`);
const a13 = await asUser(ADMIN2, `SELECT public.rpc_supersede_dispute_decision('${await disputeId()}', 'Too late to change this.') AS id`);
check("A13 once the fan-out is due it can no longer be superseded", !a13.ok && /crew_fanout_due/.test(a13.error), a13.error ?? "allowed");
const svc = await as("service_role", null, `SELECT public.mark_crew_dispute_executed('${await disputeId()}', 6000, 3334, 're_1') AS ok`);
const svcD = await one(`SELECT execution_status, execution_refund_cents, execution_refund_id FROM public.disputes WHERE id = $1`, [await disputeId()]);
const svc2 = await as("service_role", null, `SELECT public.mark_crew_dispute_executed('${await disputeId()}', 1, 1, 're_2') AS ok`);
check(
  "A14 the fan-out (service_role) closes it once: executed with its cents; a second close matches nothing",
  svc.ok && svc.rows[0].ok === true && svcD.execution_status === "executed" && svcD.execution_refund_cents === 3334 && svcD.execution_refund_id === "re_1" &&
    svc2.ok && svc2.rows[0].ok === false,
  JSON.stringify({ svc: svc.error ?? svc.rows[0].ok, svcD, again: svc2.rows?.[0]?.ok }),
);

await seed({ shares: false });
await openAs(POSTER);
const a15 = await decideCrew(ADMIN, [M2]);
await seed();
await openAs(SOLO, SINGLE);
const a15s = await asUser(ADMIN, `SELECT public.rpc_decide_crew_dispute('${await disputeId(SINGLE)}', 'x', ARRAY[]::uuid[])`);
check(
  "A15 refused: a member with no frozen share (never re-derived); a single-Helpr job (that is rpc_decide_dispute)",
  !a15.ok && /crew_share_not_frozen/.test(a15.error) && !a15s.ok && /not_a_crew_job/.test(a15s.error),
  `${a15.error ?? "allowed"} | ${a15s.error ?? "allowed"}`,
);
const a16o = await openAs(OUTSIDER, SINGLE);
const a16d = await asUser(ADMIN, `SELECT public.rpc_decide_dispute('${await disputeId(SINGLE)}', 'Pay the Helpr.', '{"poster":0,"helper":1}')`);
check("A16 single-Helpr jobs unchanged: the Helpr files, an outsider cannot, rpc_decide_dispute decides it", !a16o.ok && a16d.ok, `${a16o.error ?? "allowed"} | ${a16d.error ?? "ok"}`);

await seed();
await openAs(M1);
const a17 = await asUser(M1, `SELECT public.rpc_withdraw_dispute('${CREW}')`);
const a17j = await jobRow();
check(
  "A17 the member who filed withdraws it; the job keeps disputed_at with dispute_status 'resolved' (Q396(c): the payout fan-out now admits exactly that shape)",
  a17.ok && a17j.status === "in_progress" && a17j.disputed_at !== null && a17j.dispute_status === "resolved",
  a17.error ?? JSON.stringify(a17j),
);

const grants = await one(`SELECT
  has_function_privilege('anon', 'public.rpc_decide_crew_dispute(uuid,text,uuid[])', 'EXECUTE') AS anon_decide,
  has_function_privilege('authenticated', 'public.mark_crew_dispute_executed(uuid,integer,integer,text)', 'EXECUTE') AS auth_mark,
  has_function_privilege('anon', 'public.mark_crew_dispute_executed(uuid,integer,integer,text)', 'EXECUTE') AS anon_mark,
  has_function_privilege('authenticated', 'public.open_dispute_as(uuid,uuid,text,text[])', 'EXECUTE') AS auth_open_as,
  has_table_privilege('authenticated', 'public.crew_dispute_member_outcomes', 'INSERT') AS auth_ins,
  has_table_privilege('authenticated', 'public.crew_dispute_member_outcomes', 'UPDATE') AS auth_upd,
  has_table_privilege('anon', 'public.crew_dispute_member_outcomes', 'SELECT') AS anon_sel`);
check("A18 grants: no anon EXECUTE, the fan-out close and open_dispute_as are service-only, the outcomes are read-only to clients", Object.values(grants).every((v) => v === false), JSON.stringify(grants));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
