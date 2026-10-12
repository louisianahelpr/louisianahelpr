#!/usr/bin/env node
/**
 * PGlite proof for 20261012215235_clear_test_mode_dispute_ledger (Q1732, owner
 * decision 2026-10-12: an admin button un-sticks a dispute whose Stripe
 * test-mode refund or transfer is already recorded in our books).
 *
 *   node src/test/pglite/testModeDisputeLedgerClears.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/testModeDisputeLedgerClears.pglite.mjs   # RED: the state on main
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * The defect: a test-mode run that wrote its payment_refunds / payout_transfers
 * row and then failed leaves a ledger row rpc_supersede_dispute_decision reads
 * as money moved, and both stamp clears (Q1280, Q1383) refuse on a ledger row.
 * Fixture: the tables the functions read; rpc_supersede_dispute_decision and
 * the two stamp clears as the NEWEST migrations before this one define them
 * (prod's bodies). Proven: before, the dispute is stuck (both clears and
 * supersede refuse); the new function's gates each refuse what they must;
 * after it clears the checked set, supersede re-opens the dispute; pressed
 * again it does nothing. The migration is applied 3x.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW = "20261012215235_clear_test_mode_dispute_ledger.sql";
const FIX = readFileSync(`${MIG_DIR}${NEW}`, "utf8");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the state on main (expect FAILs)`);

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
const DISPUTE = "20000000-0000-0000-0000-000000000001";
const TR = "tr_test_1QLedgerFromTestMode";
const RE = "re_test_1QLedgerFromTestMode";

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
  CREATE TABLE public.payout_transfers(id uuid DEFAULT gen_random_uuid(), job_id uuid, stripe_transfer_id text,
    status text, amount_cents int);
  CREATE TABLE public.payment_refunds(id uuid DEFAULT gen_random_uuid(), job_id uuid, stripe_refund_id text,
    amount_cents int);
  CREATE TABLE public.gift_cards(id uuid DEFAULT gen_random_uuid(), restored_from_job_id uuid);
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
await db.exec(priorDefinition("rpc_clear_test_mode_dispute_refund_stamp"));

// The usual test-mode failure: the refund leg's ledger row AND stamp written,
// the transfer leg's ledger row written, then a later step failed.
async function seed(poster = POSTER) {
  await db.exec(`
    DELETE FROM public.jobs; DELETE FROM public.disputes; DELETE FROM public.dispute_settlement_claims;
    DELETE FROM public.payout_transfers; DELETE FROM public.payment_refunds; DELETE FROM public.admin_audit_log;
    DELETE FROM public.gift_cards;
    INSERT INTO public.jobs VALUES ('${JOB}', 'completed', 'escrow', '${poster}', '${HELPR}', 'T', 'decided', now(), now());
    INSERT INTO public.disputes(id, job_id, opener_id, reason, status, decided_at, decided_by, payout_split,
      execution_status, execution_error, execution_transfer_id, execution_refund_id)
    VALUES ('${DISPUTE}', '${JOB}', '${poster}', 'r', 'decided', now(), '${ADMIN}', '{"helper": 50, "poster": 50}',
      'failed', 'a prior execution ran in Stripe test mode', NULL, '${RE}');
    INSERT INTO public.payment_refunds(job_id, stripe_refund_id, amount_cents) VALUES ('${JOB}', '${RE}', 5000);
    INSERT INTO public.payout_transfers(job_id, stripe_transfer_id, status, amount_cents) VALUES ('${JOB}', '${TR}', 'paid', 4000);
  `);
}
async function as(uid, sql) {
  await db.exec(`SELECT set_config('test.uid', '${uid}', false)`);
  try {
    const r = await db.query(sql);
    return r.rows[0] ? Object.values(r.rows[0])[0] ?? "ok" : "ok";
  } catch (e) {
    return String(e.message);
  }
}
const REASON = "checked at Stripe: both are test-mode objects";
const clearLedger = (admin = ADMIN, refunds = [RE], transfers = [TR], reason = REASON) =>
  `SELECT public.clear_test_mode_dispute_ledger('${admin}', '${DISPUTE}', ARRAY[${refunds.map((x) => `'${x}'`).join(",")}]::text[], ARRAY[${transfers.map((x) => `'${x}'`).join(",")}]::text[], '${reason}')`;
const supersede = `SELECT public.rpc_supersede_dispute_decision('${DISPUTE}', 'the split can never execute under the live key')`;
const errOf = (r) => (typeof r === "string" ? r : JSON.stringify(r));

// ── Before: stuck. Both stamp clears refuse on the ledger row; supersede refuses. ──
await seed();
check("before: the refund stamp clear refuses on the ledger row (Q1383 by design)",
  /clear_stamp_ledger_has_refund/.test(errOf(await as(ADMIN, `SELECT public.rpc_clear_test_mode_dispute_refund_stamp('${DISPUTE}', '${RE}', '${REASON}')`))));
check("before: supersede refuses (money moved)", /supersede_money_moved/.test(errOf(await as(ADMIN, supersede))));

if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(FIX);

// ── Gates (the edge function calls as service_role; the admin is a parameter) ──
await seed();
check("a non-admin is refused", /admin only/.test(errOf(await as("", clearLedger(USER)))));
check("no admin named is refused", /admin only/.test(errOf(await as("", `SELECT public.clear_test_mode_dispute_ledger(NULL, '${DISPUTE}', ARRAY['${RE}'], ARRAY['${TR}'], '${REASON}')`))));
check("a short reason is refused", /clear_ledger_needs_reason/.test(errOf(await as("", clearLedger(ADMIN, [RE], [TR], "test")))));
check("a set missing the transfer is refused (compare-and-set on the whole set)", /clear_ledger_changed/.test(errOf(await as("", clearLedger(ADMIN, [RE], [])))));
check("a set missing the refund is refused", /clear_ledger_changed/.test(errOf(await as("", clearLedger(ADMIN, [], [TR])))));
check("an extra id is refused", /clear_ledger_changed/.test(errOf(await as("", clearLedger(ADMIN, [RE, "re_extra"], [TR])))));
await db.exec(`INSERT INTO public.payment_refunds(job_id, stripe_refund_id) VALUES ('${JOB}', 're_live_added_since')`);
check("a ledger row added after the Stripe check is refused", /clear_ledger_changed/.test(errOf(await as("", clearLedger()))));
await seed();
await db.exec(`UPDATE public.disputes SET execution_transfer_id = 'tr_stamp_only'`);
check("a transfer stamp not in the checked set is refused", /clear_ledger_changed/.test(errOf(await as("", clearLedger()))));
await seed();
await db.exec(`INSERT INTO public.payout_transfers(job_id, stripe_transfer_id, status) VALUES ('${JOB}', NULL, 'pending')`);
check("a money-moving transfer row with no Stripe id is refused (cannot be checked)", /clear_ledger_unverifiable/.test(errOf(await as("", clearLedger()))));
await seed();
await db.exec(`INSERT INTO public.gift_cards(restored_from_job_id) VALUES ('${JOB}')`);
check("a gift card restored from the job is refused", /clear_ledger_gift_restored/.test(errOf(await as("", clearLedger()))));
await seed();
await db.exec(`INSERT INTO public.dispute_settlement_claims VALUES ('${JOB}', now(), NULL)`);
check("a live settlement claim is refused", /dispute_settlement_in_progress/.test(errOf(await as("", clearLedger()))));
await seed();
await db.exec(`INSERT INTO public.dispute_settlement_claims VALUES ('${JOB}', now() - interval '1 day', now() - interval '1 day')`);
check("a stamped (money-step) claim is refused", /dispute_settlement_in_progress/.test(errOf(await as("", clearLedger()))));
await seed();
await db.exec(`UPDATE public.disputes SET execution_status = 'executing', execution_started_at = now()`);
check("a run still executing inside the claim TTL is refused", /dispute_settlement_in_progress/.test(errOf(await as("", clearLedger()))));
await seed();
await db.exec(`UPDATE public.jobs SET payment_status = 'refunded'`);
check("escrow no longer held is refused", /clear_ledger_escrow_not_held/.test(errOf(await as("", clearLedger()))));
await seed(ADMIN2);
check("an admin who is a party is refused", /admin_is_party/.test(errOf(await as("", clearLedger(ADMIN2)))));
for (const st of ["executed", "pending", null]) {
  await seed();
  await db.query(`UPDATE public.disputes SET execution_status = $1`, [st]);
  check(`a ${st ?? "NULL"} execution status is refused`, /clear_ledger_not_decided/.test(errOf(await as("", clearLedger()))));
}
await seed();
check("nothing changed by any refusal: both ledger rows and the stamp still there",
  (await db.query(`SELECT (SELECT count(*) FROM public.payment_refunds) + (SELECT count(*) FROM public.payout_transfers) AS n`)).rows[0].n == 2);

// ── The path: clear the checked set, then supersede re-opens the dispute ──
await seed();
await db.exec(`INSERT INTO public.payout_transfers(job_id, stripe_transfer_id, status) VALUES ('${JOB}', 'tr_failed_kept', 'failed')`);
const r = await as("", clearLedger());
check("the checked test-mode set is cleared", r?.action === "cleared" && r.refunds_removed === 1 && r.transfers_removed === 1, errOf(r));
const left = (await db.query(`SELECT (SELECT count(*) FROM public.payment_refunds)::int AS refunds, (SELECT string_agg(stripe_transfer_id, ',') FROM public.payout_transfers) AS transfers`)).rows[0];
check("the ledger rows are gone; a failed transfer row (never money moved) is kept", left.refunds === 0 && left.transfers === "tr_failed_kept", JSON.stringify(left));
const d = (await db.query(`SELECT execution_refund_id, execution_transfer_id, execution_error FROM public.disputes WHERE id = '${DISPUTE}'`)).rows[0];
check("both stamps are cleared and the reason is on the dispute",
  d.execution_refund_id === null && d.execution_transfer_id === null && /test-mode records cleared by an admin/.test(d.execution_error ?? ""), JSON.stringify(d));
const audit = (await db.query(`SELECT admin_id, details FROM public.admin_audit_log WHERE action = 'clear_test_mode_dispute_ledger'`)).rows;
check("one audit row, by the admin, with every removed row in full",
  audit.length === 1 && audit[0].admin_id === ADMIN && audit[0].details.removed_payment_refunds?.[0]?.amount_cents === 5000
    && audit[0].details.removed_payout_transfers?.[0]?.stripe_transfer_id === TR, JSON.stringify(audit));
const again = await as("", clearLedger(ADMIN, [], []));
check("pressed again before supersede: nothing_to_clear, no second audit row",
  again?.action === "nothing_to_clear" && (await db.query(`SELECT count(*)::int n FROM public.admin_audit_log`)).rows[0].n === 1, errOf(again));
const s = await as(ADMIN, supersede);
check("then supersede re-opens the dispute", typeof s === "string" && /^[0-9a-f-]{36}$/.test(s), errOf(s));
const after = (await db.query(`SELECT status FROM public.disputes WHERE job_id = '${JOB}' ORDER BY status`)).rows.map((x) => x.status);
check("the old decision is superseded and a new dispute is open", JSON.stringify(after) === JSON.stringify(["open", "superseded"]), JSON.stringify(after));
const done = await as("", clearLedger(ADMIN, [], []));
check("pressed after it went through: already_superseded (idempotent)", done?.action === "already_superseded", errOf(done));

// ── Grants ────────────────────────────────────────────────────────────────
if (MODE !== "skip") {
  const sig = "public.clear_test_mode_dispute_ledger(uuid, uuid, text[], text[], text)";
  const can = async (role) => (await db.query(`SELECT has_function_privilege('${role}', '${sig}', 'EXECUTE') x`)).rows[0].x;
  check("anon cannot execute", !(await can("anon")));
  check("authenticated cannot execute (the Stripe check lives in the edge function)", !(await can("authenticated")));
  check("PUBLIC cannot execute", !(await db.query(`SELECT bool_or(a.grantee = 0) x FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = '${sig}'::regprocedure`)).rows[0].x);
  check("service_role can execute", await can("service_role"));
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
