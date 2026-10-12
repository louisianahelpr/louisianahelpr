/**
 * Q1383: a dispute stuck on a Stripe TEST-mode REFUND stamp had no way out.
 * rpc_clear_test_mode_dispute_stamp (Q1280) clears only the transfer stamp,
 * while rpc_supersede_dispute_decision reads execution_refund_id AND any
 * payment_refunds row on the job as "money moved".
 * rpc_clear_test_mode_dispute_refund_stamp (20261012195118) is the hand path.
 *
 * Behaviour is proved in PGlite by
 * src/test/pglite/testModeDisputeRefundStampClears.pglite.mjs (31 PASS with the
 * migration applied 3x; 24 FAIL without it). This guard keeps it joined in CI,
 * read from the NEWEST definitions:
 *   - the RPC keeps its money gates (admin, not a party, compare-and-set on the
 *     named refund, refusal of any OTHER refund row, settlement-claim refusal,
 *     escrow held, audit row before any write);
 *   - it retires ONLY the split's own ledger row for that refund id;
 *   - supersede still treats a refund stamp and a refund row as money moved,
 *     so clearing is the one way past them.
 *
 * @mutate supabase/migrations/20261012195118_clear_test_mode_dispute_refund_stamp.sql |   IF _d.execution_refund_id IS DISTINCT FROM _rid THEN |   IF false THEN
 * @mutate supabase/migrations/20261012195118_clear_test_mode_dispute_refund_stamp.sql |   IF NOT public.has_role(_uid, 'admin') THEN |   IF false THEN
 * @mutate supabase/migrations/20261012195118_clear_test_mode_dispute_refund_stamp.sql |             AND r.metadata->>'dispute_id' = _d.id::text) IS NOT TRUE | AND r.metadata->>'dispute_id' = _d.id::text) IS FALSE
 * @mutate supabase/migrations/20261012195118_clear_test_mode_dispute_refund_stamp.sql |   IF _deleted <> jsonb_array_length(_ledger) THEN |   IF false THEN
 * @mutate supabase/migrations/20261012195118_clear_test_mode_dispute_refund_stamp.sql |      AND r.metadata->>'dispute_id' = _d.id::text;\n  -- Every row the audit row |      AND true;\n  -- Every row the audit row
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const MIG = "supabase/migrations/20261012195118_clear_test_mode_dispute_refund_stamp.sql";
const defs = effectiveDefs(resolve(ROOT, "supabase/migrations"));
const code = (name: string) => {
  const d = defs.get(name);
  expect(d, `${name} has a migration definition`).toBeDefined();
  return blankSqlComments(d!.stmt).replace(/\s+/g, " ");
};

describe("Q1383: a test-mode dispute REFUND stamp has a hand path out", () => {
  it("reads the real definitions (floor)", () => {
    expect(defs.size).toBeGreaterThan(200);
  });

  it("the clearing RPC keeps every money gate", () => {
    const c = code("rpc_clear_test_mode_dispute_refund_stamp");
    expect(c).toMatch(/SECURITY DEFINER/i);
    expect(c).toMatch(/IF NOT public\.has_role\(_uid, 'admin'\) THEN RAISE/);
    expect(c).toMatch(/IF _uid = _customer OR _uid = _helper THEN RAISE/);
    expect(c).toMatch(/IF _d\.execution_refund_id IS DISTINCT FROM _rid THEN RAISE/);
    expect(c).toMatch(/OR _d\.execution_status NOT IN \('failed', 'executing'\) THEN RAISE/);
    expect(c).toMatch(/NOT IN \('escrow', 'payout_pending'\) THEN RAISE/);
    expect(c).toMatch(/dispute_settlement_claims/);
    // Any refund row that is not this split's own row for this refund refuses.
    // IS NOT TRUE, so a row with a NULL source or dispute id also refuses.
    expect(c).toMatch(
      /AND \(r\.stripe_refund_id = _rid AND r\.source = 'dispute_split' AND r\.metadata->>'dispute_id' = _d\.id::text\) IS NOT TRUE \) THEN RAISE EXCEPTION 'clear_stamp_other_refunds'/,
    );
    // The rows deleted must be the rows the audit row lists.
    expect(c).toMatch(/GET DIAGNOSTICS _deleted = ROW_COUNT; IF _deleted <> jsonb_array_length\(_ledger\) THEN RAISE/);
  });

  it("retires only the split's own row for the named refund, after the audit row", () => {
    const c = code("rpc_clear_test_mode_dispute_refund_stamp");
    const del = /DELETE FROM public\.payment_refunds r WHERE r\.job_id = _d\.job_id AND r\.stripe_refund_id = _rid AND r\.source = 'dispute_split' AND r\.metadata->>'dispute_id' = _d\.id::text;/;
    expect(c).toMatch(del);
    // Exactly one DELETE, and nothing else is written to the ledger.
    expect(c.match(/DELETE FROM public\.payment_refunds/g)?.length).toBe(1);
    expect(c).not.toMatch(/UPDATE public\.payment_refunds/);
    const audit = c.indexOf("INSERT INTO public.admin_audit_log");
    expect(audit).toBeGreaterThan(0);
    expect(audit).toBeLessThan(c.search(del));
    expect(audit).toBeLessThan(c.indexOf("SET execution_refund_id = NULL"));
    expect(c).toMatch(/'retired_ledger_rows', _ledger/);
  });

  it("supersede still reads a refund stamp and a refund row as money moved", () => {
    const s = code("rpc_supersede_dispute_decision");
    expect(s).toMatch(/OR _d\.execution_refund_id IS NOT NULL/);
    expect(s).toMatch(/OR EXISTS \(SELECT 1 FROM public\.payment_refunds r WHERE r\.job_id = _d\.job_id\)/);
  });

  it("anon and PUBLIC cannot execute the clearing RPC", () => {
    expect(blankSqlComments(readFileSync(resolve(ROOT, MIG), "utf8"))).toMatch(
      /REVOKE ALL ON FUNCTION public\.rpc_clear_test_mode_dispute_refund_stamp\(uuid, text, text\) FROM PUBLIC, anon;/,
    );
  });
});
