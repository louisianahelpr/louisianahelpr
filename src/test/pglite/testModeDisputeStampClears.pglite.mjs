#!/usr/bin/env node
/**
 * PGlite proof for 20261005173719_clear_test_mode_dispute_transfer_stamp (Q1280).
 *
 *   node src/test/pglite/testModeDisputeStampClears.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/testModeDisputeStampClears.pglite.mjs   # RED: live state
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * The defect: a decided dispute whose stamped execution_transfer_id is a
 * Stripe test-mode object can never close. execute-dispute-split refuses it
 * (409, decide by hand) and rpc_supersede_dispute_decision reads the stamp as
 * "money moved". Fixture: the tables both functions read, and
 * rpc_supersede_dispute_decision as the NEWEST migration before this one
 * defines it. Proven: before, supersede refuses; the new RPC's gates each
 * refuse what they must; after an admin clears the stamp, supersede closes
 * the decision and re-opens the dispute. The migration is applied 3x.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW = "20261005173719_clear_test_mode_dispute_transfer_stamp.sql";
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
const ADMIN2 = "00000000-0000-0000-0000-0000000000a2"; // also the poster on job 2
const USER = "00000000-0000-0000-0000-0000000000b1";
const POSTER = "00000000-0000-0000-0000-0000000000c1";
const HELPR = "00000000-0000-0000-0000-0000000000d1";
const JOB = "10000000-0000-0000-0000-000000000001";
const DISPUTE = "20000000-0000-0000-0000-000000000001";
const TR = "tr_test_1QStampFromTestMode";

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
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
  CREATE TABLE public.payment_refunds(id uuid DEFAULT gen_random_uuid(), job_id uuid);
  CREATE TABLE public.admin_audit_log(id uuid DEFAULT gen_random_uuid(), admin_id uuid, action text,
    target_type text, target_id uuid, details jsonb);
  CREATE TABLE public.notifications(id uuid DEFAULT gen_random_uuid(), user_id uuid, title text, message text,
    type text, link text);
  CREATE FUNCTION public.dispute_settlement_claim_ttl() RETURNS interval LANGUAGE sql IMMUTABLE
    AS $$ SELECT interval '10 minutes' $$;
  INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin'), ('${ADMIN2}', 'admin');
`);
await db.exec(priorDefinition("rpc_supersede_dispute_decision"));

async function seed(poster = POSTER) {
  await db.exec(`
    DELETE FROM public.jobs; DELETE FROM public.disputes; DELETE FROM public.dispute_settlement_claims;
    DELETE FROM public.payout_transfers; DELETE FROM public.admin_audit_log;
    INSERT INTO public.jobs VALUES ('${JOB}', 'disputed', 'escrow', '${poster}', '${HELPR}', 'T', 'decided', now(), now());
    INSERT INTO public.disputes(id, job_id, opener_id, reason, status, decided_at, decided_by, payout_split,
      execution_status, execution_error, execution_transfer_id)
    VALUES ('${DISPUTE}', '${JOB}', '${poster}', 'r', 'decided', now(), '${ADMIN}', '{"helper": 50, "poster": 50}',
      'failed', 'a prior execution ran in Stripe test mode; nothing moved now, decide by hand', '${TR}');
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
const clear = (tr = TR, reason = "checked in Stripe test mode: tr_test object") =>
  `SELECT public.rpc_clear_test_mode_dispute_stamp('${DISPUTE}', '${tr}', '${reason}')`;
const supersede = `SELECT public.rpc_supersede_dispute_decision('${DISPUTE}', 'the split can never execute under the live key')`;

// ── Before: the dispute cannot close ─────────────────────────────────────
await seed();
check("before: supersede refuses the test-mode stamp as money moved", /supersede_money_moved/.test(await as(ADMIN, supersede)));

if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(FIX);

// ── Gates ─────────────────────────────────────────────────────────────────
await seed();
check("a non-admin cannot clear the stamp", /admin only/.test(await as(USER, clear())));
check("signed out cannot clear the stamp", /not authenticated/.test(await as("", clear())));
check("a short reason is refused", /clear_stamp_needs_reason/.test(await as(ADMIN, clear(TR, "test"))));
check("a different transfer id is refused (compare-and-set)", /clear_stamp_mismatch/.test(await as(ADMIN, clear("tr_other_123"))));
await db.exec(`INSERT INTO public.payout_transfers(job_id, stripe_transfer_id, status) VALUES ('${JOB}', '${TR}', 'paid')`);
check("a ledger row on that transfer is refused (reconciled by hand)", /clear_stamp_ledger_has_transfer/.test(await as(ADMIN, clear())));
await seed();
await db.exec(`INSERT INTO public.dispute_settlement_claims VALUES ('${JOB}', now(), NULL)`);
check("a live settlement claim is refused", /dispute_settlement_in_progress/.test(await as(ADMIN, clear())));
await seed();
await db.exec(`INSERT INTO public.dispute_settlement_claims VALUES ('${JOB}', now() - interval '1 day', now() - interval '1 day')`);
check("a stamped (money-step) claim is refused", /dispute_settlement_in_progress/.test(await as(ADMIN, clear())));
await seed();
await db.exec(`UPDATE public.jobs SET payment_status = 'released'`);
check("escrow no longer held is refused", /clear_stamp_escrow_not_held/.test(await as(ADMIN, clear())));
await seed(ADMIN2);
check("an admin who is a party is refused", /admin_is_party/.test(await as(ADMIN2, clear())));
await seed();
await db.exec(`UPDATE public.disputes SET execution_status = 'executed'`);
check("an executed split is refused", /clear_stamp_not_decided/.test(await as(ADMIN, clear())));
for (const st of ["pending", null]) {
  await seed();
  await db.query(`UPDATE public.disputes SET execution_status = $1`, [st]);
  check(`a ${st ?? "NULL"} execution status is refused (the next run would not be a resume)`, /clear_stamp_not_decided/.test(await as(ADMIN, clear())));
}

// ── The path: clear, then the decision closes ─────────────────────────────
await seed();
const r = await as(ADMIN, clear());
check("an admin clears the named test-mode stamp", r === "ok", r);
const d = (await db.query(`SELECT execution_transfer_id, execution_error, status FROM public.disputes WHERE id = '${DISPUTE}'`)).rows[0];
check("the stamp is gone and the reason is on the dispute", d.execution_transfer_id === null && /cleared by an admin/.test(d.execution_error ?? ""), JSON.stringify(d));
const audit = (await db.query(`SELECT details FROM public.admin_audit_log WHERE action = 'clear_test_mode_dispute_stamp'`)).rows;
check("one audit row names the cleared transfer", audit.length === 1 && audit[0].details.cleared_transfer_id === TR, JSON.stringify(audit));
const s = await as(ADMIN, supersede);
check("after clearing, supersede closes the decision", s === "ok", s);
const after = (await db.query(`SELECT status FROM public.disputes WHERE job_id = '${JOB}' ORDER BY status`)).rows.map((x) => x.status);
check("the old decision is superseded and a new dispute is open", JSON.stringify(after) === JSON.stringify(["open", "superseded"]), JSON.stringify(after));

// ── Grants ────────────────────────────────────────────────────────────────
if (MODE !== "skip") {
  const sig = "public.rpc_clear_test_mode_dispute_stamp(uuid, text, text)";
  check("anon cannot execute", !(await db.query(`SELECT has_function_privilege('anon', '${sig}', 'EXECUTE') x`)).rows[0].x);
  check("authenticated can execute (admin-gated inside)", (await db.query(`SELECT has_function_privilege('authenticated', '${sig}', 'EXECUTE') x`)).rows[0].x);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
