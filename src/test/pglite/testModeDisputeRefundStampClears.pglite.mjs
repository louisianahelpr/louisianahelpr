#!/usr/bin/env node
/**
 * PGlite proof for 20261012195118_clear_test_mode_dispute_refund_stamp (Q1383).
 *
 *   node src/test/pglite/testModeDisputeRefundStampClears.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/testModeDisputeRefundStampClears.pglite.mjs   # RED: live state
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * The defect: a decided dispute whose split got a Stripe TEST-mode refund out
 * carries the refund id in execution_refund_id AND the split's own
 * payment_refunds row; rpc_supersede_dispute_decision reads both as "money
 * moved", and rpc_clear_test_mode_dispute_stamp (Q1280) clears only the
 * transfer stamp. Fixture: the tables these functions read, and supersede plus
 * the Q1280 transfer path as the NEWEST migration before this one defines
 * them. Proven: before, supersede refuses (even after the transfer path); the
 * new RPC's gates each refuse what they must; after an admin clears the refund
 * stamp, the ledger row is retired (copied into the audit row) and supersede
 * closes the decision. The migration is applied 3x.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW = "20261012195118_clear_test_mode_dispute_refund_stamp.sql";
const FIX = readFileSync(`${MIG_DIR}${NEW}`, "utf8");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the LIVE (unfixed) state (expect FAILs)`);

/** A function as the newest migration before NEW defines it (any dollar tag). */
function priorDefinition(name) {
  const files = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql") && f < NEW).sort();
  let body = null;
  for (const f of files) {
    const sql = readFileSync(MIG_DIR + f, "utf8");
    const re = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`, "gi");
    let at = -1;
    for (const m of sql.matchAll(re)) at = m.index;
    if (at < 0) continue;
    const tag = sql.slice(at).match(/AS\s+(\$[A-Za-z_]*\$)/)[1];
    const open = sql.indexOf(tag, at);
    const close = sql.indexOf(tag, open + tag.length);
    body = sql.slice(at, close + tag.length) + ";";
  }
  if (!body) throw new Error(`no prior definition of ${name}`);
  return body;
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const ADMIN = "00000000-0000-0000-0000-0000000000a1";
const ADMIN2 = "00000000-0000-0000-0000-0000000000a2"; // also the poster when seeded so
const USER = "00000000-0000-0000-0000-0000000000b1";
const POSTER = "00000000-0000-0000-0000-0000000000c1";
const HELPR = "00000000-0000-0000-0000-0000000000d1";
const JOB = "10000000-0000-0000-0000-000000000001";
const JOB2 = "10000000-0000-0000-0000-000000000002";
const DISPUTE = "20000000-0000-0000-0000-000000000001";
const RE = "re_test_1QRefundFromTestMode";

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  -- Prod's pg_default_acl: new functions get EXECUTE for anon and
  -- authenticated explicitly, so the migration's REVOKE must name anon.
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
    AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
  CREATE TABLE public.user_roles(user_id uuid, role text);
  CREATE FUNCTION public.has_role(u uuid, r text) RETURNS boolean LANGUAGE sql STABLE
    AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = u AND role = r) $$;
  CREATE TABLE public.jobs(id uuid PRIMARY KEY, status text, payment_status text, customer_id uuid,
    helper_id uuid, title text, dispute_status text, dispute_resolved_at timestamptz, disputed_at timestamptz);
  CREATE TABLE public.disputes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, opener_id uuid,
    reason text, evidence_urls text[], status text DEFAULT 'open', decided_at timestamptz, decided_by uuid,
    decision_text text, payout_split jsonb, execution_status text, execution_started_at timestamptz,
    execution_error text, execution_transfer_id text, execution_refund_id text);
  CREATE TABLE public.dispute_settlement_claims(job_id uuid, claimed_at timestamptz, money_step_at timestamptz);
  CREATE TABLE public.payout_transfers(id uuid DEFAULT gen_random_uuid(), job_id uuid, stripe_transfer_id text, status text);
  -- The real ledger's shape (20260704120000_payment_refunds_ledger.sql).
  CREATE TABLE public.payment_refunds(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid,
    customer_id uuid, stripe_refund_id text UNIQUE NOT NULL, stripe_payment_intent_id text,
    amount_cents integer NOT NULL, currency text NOT NULL DEFAULT 'usd', is_partial boolean NOT NULL DEFAULT false,
    reason text, source text NOT NULL, initiated_by_user_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb);
  CREATE TABLE public.admin_audit_log(id uuid DEFAULT gen_random_uuid(), admin_id uuid, action text,
    target_type text, target_id uuid, details jsonb);
  CREATE TABLE public.notifications(id uuid DEFAULT gen_random_uuid(), user_id uuid, title text, message text,
    type text, link text);
  CREATE FUNCTION public.dispute_settlement_claim_ttl() RETURNS interval LANGUAGE sql IMMUTABLE
    AS $$ SELECT interval '10 minutes' $$;
  INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin'), ('${ADMIN2}', 'admin');
`);
await db.exec(priorDefinition("rpc_supersede_dispute_decision"));
await db.exec(priorDefinition("rpc_clear_test_mode_dispute_stamp"));

async function seed(poster = POSTER) {
  await db.exec(`
    DELETE FROM public.jobs; DELETE FROM public.disputes; DELETE FROM public.dispute_settlement_claims;
    DELETE FROM public.payout_transfers; DELETE FROM public.payment_refunds; DELETE FROM public.admin_audit_log;
    INSERT INTO public.jobs VALUES ('${JOB}', 'disputed', 'escrow', '${poster}', '${HELPR}', 'T', 'decided', now(), now());
    INSERT INTO public.jobs VALUES ('${JOB2}', 'completed', 'released', '${POSTER}', '${HELPR}', 'T2', NULL, NULL, NULL);
    INSERT INTO public.disputes(id, job_id, opener_id, reason, status, decided_at, decided_by, payout_split,
      execution_status, execution_error, execution_refund_id)
    VALUES ('${DISPUTE}', '${JOB}', '${poster}', 'r', 'decided', now(), '${ADMIN}', '{"helper": 50, "poster": 50}',
      'failed', 'this escrow was paid in Stripe test mode, so there is no real money behind it', '${RE}');
    INSERT INTO public.payment_refunds(job_id, customer_id, stripe_refund_id, amount_cents, is_partial, source, metadata)
    VALUES ('${JOB}', '${poster}', '${RE}', 2500, true, 'dispute_split', '{"dispute_id": "${DISPUTE}"}');
  `);
}
async function as(uid, sql) {
  await db.exec(`SELECT set_config('test.uid', '${uid}', false)`);
  try {
    await db.query(sql);
    return "ok";
  } catch (e) {
    return String(e.message);
  }
}
const clear = (re = RE, reason = "checked in Stripe test mode: re_test object") =>
  `SELECT public.rpc_clear_test_mode_dispute_refund_stamp('${DISPUTE}', '${re}', '${reason}')`;
const supersede = `SELECT public.rpc_supersede_dispute_decision('${DISPUTE}', 'the split can never execute under the live key')`;

// ── Before: the dispute cannot close, and the Q1280 path does not reach it ─
await seed();
check("before: supersede refuses the test-mode refund as money moved", /supersede_money_moved/.test(await as(ADMIN, supersede)));
check(
  "before: the Q1280 transfer path cannot clear a refund stamp",
  /clear_stamp_mismatch/.test(await as(ADMIN, `SELECT public.rpc_clear_test_mode_dispute_stamp('${DISPUTE}', '${RE}', 'checked in Stripe test mode')`)),
);

if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(FIX);

// ── Gates ─────────────────────────────────────────────────────────────────
await seed();
check("a non-admin cannot clear the stamp", /admin only/.test(await as(USER, clear())));
check("signed out cannot clear the stamp", /not authenticated/.test(await as("", clear())));
check("a short reason is refused", /clear_stamp_needs_reason/.test(await as(ADMIN, clear(RE, "test"))));
check("an empty refund id is refused", /clear_stamp_needs_refund_id/.test(await as(ADMIN, clear("  "))));
check("a different refund id is refused (compare-and-set)", /clear_stamp_mismatch/.test(await as(ADMIN, clear("re_other_123"))));
await db.exec(`INSERT INTO public.dispute_settlement_claims VALUES ('${JOB}', now(), NULL)`);
check("a live settlement claim is refused", /dispute_settlement_in_progress/.test(await as(ADMIN, clear())));
await seed();
await db.exec(`INSERT INTO public.dispute_settlement_claims VALUES ('${JOB}', now() - interval '1 day', now() - interval '1 day')`);
check("a stamped (money-step) claim is refused", /dispute_settlement_in_progress/.test(await as(ADMIN, clear())));
await seed();
await db.exec(`UPDATE public.disputes SET execution_status = 'executing', execution_started_at = now()`);
check("a split executing right now is refused", /dispute_settlement_in_progress/.test(await as(ADMIN, clear())));
await seed();
await db.exec(`UPDATE public.jobs SET payment_status = 'refunded' WHERE id = '${JOB}'`);
check("escrow no longer held is refused", /clear_stamp_escrow_not_held/.test(await as(ADMIN, clear())));
await seed(ADMIN2);
check("an admin who is a party is refused", /admin_is_party/.test(await as(ADMIN2, clear())));
await seed();
await db.exec(`UPDATE public.disputes SET execution_status = 'executed'`);
check("an executed split is refused", /clear_stamp_not_decided/.test(await as(ADMIN, clear())));
for (const st of ["pending", null]) {
  await seed();
  await db.query(`UPDATE public.disputes SET execution_status = $1`, [st]);
  check(`a ${st ?? "NULL"} execution status is refused`, /clear_stamp_not_decided/.test(await as(ADMIN, clear())));
}
await seed();
await db.exec(`INSERT INTO public.payment_refunds(job_id, stripe_refund_id, amount_cents, source) VALUES ('${JOB}', 're_quick_1', 500, 'quick_refund')`);
check("another refund on the job is refused (reconciled by hand)", /clear_stamp_other_refunds/.test(await as(ADMIN, clear())));
check("…and nothing was retired", (await db.query(`SELECT count(*)::int n FROM public.payment_refunds WHERE job_id = '${JOB}'`)).rows[0].n === 2);
await seed();
await db.exec(`UPDATE public.payment_refunds SET metadata = '{"dispute_id": "20000000-0000-0000-0000-0000000000ff"}'`);
check("a split row of ANOTHER dispute is refused", /clear_stamp_other_refunds/.test(await as(ADMIN, clear())));
await seed();
await db.exec(`UPDATE public.payment_refunds SET metadata = '{}'::jsonb`);
check("the named refund's row with NO dispute id is refused, not half-cleared", /clear_stamp_other_refunds/.test(await as(ADMIN, clear())));
check(
  "…and the stamp and the row are both still there",
  (await db.query(`SELECT count(*)::int n FROM public.payment_refunds`)).rows[0].n === 1 &&
    (await db.query(`SELECT execution_refund_id FROM public.disputes WHERE id = '${DISPUTE}'`)).rows[0].execution_refund_id === RE,
);
await seed();
await db.exec(`UPDATE public.payment_refunds SET job_id = '${JOB2}'`);
check("the refund id recorded on another job is refused", /clear_stamp_other_refunds/.test(await as(ADMIN, clear())));
check("…and that job's row is untouched", (await db.query(`SELECT count(*)::int n FROM public.payment_refunds WHERE job_id = '${JOB2}'`)).rows[0].n === 1);

// ── The path: clear, then the decision closes ─────────────────────────────
await seed();
const r = await as(ADMIN, clear());
check("an admin clears the named test-mode refund stamp", r === "ok", r);
const d = (await db.query(`SELECT execution_refund_id, execution_error FROM public.disputes WHERE id = '${DISPUTE}'`)).rows[0];
check("the stamp is gone and the reason is on the dispute", d.execution_refund_id === null && /refund stamp .* cleared by an admin/.test(d.execution_error ?? ""), JSON.stringify(d));
check("the split's own ledger row is retired", (await db.query(`SELECT count(*)::int n FROM public.payment_refunds`)).rows[0].n === 0);
const audit = (await db.query(`SELECT details FROM public.admin_audit_log WHERE action = 'clear_test_mode_dispute_refund_stamp'`)).rows;
check(
  "one audit row names the refund and carries the retired ledger row whole",
  audit.length === 1 && audit[0].details.cleared_refund_id === RE &&
    audit[0].details.retired_ledger_rows.length === 1 && audit[0].details.retired_ledger_rows[0].amount_cents === 2500,
  JSON.stringify(audit),
);
const s = await as(ADMIN, supersede);
check("after clearing, supersede closes the decision", s === "ok", s);
const after = (await db.query(`SELECT status FROM public.disputes WHERE job_id = '${JOB}' ORDER BY status`)).rows.map((x) => x.status);
check("the old decision is superseded and a new dispute is open", JSON.stringify(after) === JSON.stringify(["open", "superseded"]), JSON.stringify(after));

// A stamp with no ledger row (the split's best-effort ledger write failed) clears too.
await seed();
await db.exec(`DELETE FROM public.payment_refunds`);
const r2 = await as(ADMIN, clear());
check("a stamp whose ledger row was never written still clears", r2 === "ok", r2);

// ── Grants ────────────────────────────────────────────────────────────────
if (MODE !== "skip") {
  const sig = "public.rpc_clear_test_mode_dispute_refund_stamp(uuid, text, text)";
  check("anon cannot execute", !(await db.query(`SELECT has_function_privilege('anon', '${sig}', 'EXECUTE') x`)).rows[0].x);
  check("authenticated can execute (admin-gated inside)", (await db.query(`SELECT has_function_privilege('authenticated', '${sig}', 'EXECUTE') x`)).rows[0].x);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
