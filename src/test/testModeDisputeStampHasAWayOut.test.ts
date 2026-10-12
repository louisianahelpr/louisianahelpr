/**
 * Q1280: a decided dispute whose split execute-dispute-split refused because
 * the stamped transfer is a Stripe TEST-mode object had no way out:
 * rpc_supersede_dispute_decision reads any execution_transfer_id as "money
 * moved". rpc_clear_test_mode_dispute_stamp (20261005173719) is the hand path.
 *
 * Behaviour is proved in PGlite by
 * src/test/pglite/testModeDisputeStampClears.pglite.mjs (21 PASS with the
 * migration applied 3x; 17 FAIL without it, supersede refusing). This guard
 * keeps the two halves joined in CI, read from the NEWEST definitions:
 *   - the edge function still refuses a test-mode stamp and NAMES the way
 *     out, and the RPC it names exists;
 *   - the RPC keeps its money gates (admin, not a party, compare-and-set on
 *     the named stamp, ledger refusal, settlement-claim refusal, escrow held,
 *     audit row before the write);
 *   - supersede still treats a stamp as money moved (so clearing is the ONE
 *     way past it, never a silent edit of supersede).
 *
 * @mutate supabase/migrations/20261005173719_clear_test_mode_dispute_transfer_stamp.sql |   IF _d.execution_transfer_id IS DISTINCT FROM btrim(_transfer_id) THEN |   IF false THEN
 * @mutate supabase/migrations/20261005173719_clear_test_mode_dispute_transfer_stamp.sql |   IF NOT public.has_role(_uid, 'admin') THEN |   IF false THEN
 * @mutate supabase/migrations/20261005173719_clear_test_mode_dispute_transfer_stamp.sql |      OR _d.execution_status NOT IN ('failed', 'executing') THEN |      OR false THEN
 * @mutate supabase/migrations/20261005173719_clear_test_mode_dispute_transfer_stamp.sql |   IF EXISTS (SELECT 1 FROM public.payout_transfers t |   IF false AND EXISTS (SELECT 1 FROM public.payout_transfers t
 * @mutate supabase/functions/execute-dispute-split/index.ts |             { error: "a prior execution ran in Stripe test mode; nothing moved now, decide by hand (an admin clears the checked stamps with rpc_clear_test_mode_dispute_stamp and, for a refund stamp, rpc_clear_test_mode_dispute_refund_stamp, then supersedes)" }, |             { error: "a prior execution ran in Stripe test mode; nothing moved now, decide by hand" },
 *
 * Q1383 (lh-authz-rls review of Q1280): the REFUND-side twin,
 * rpc_clear_test_mode_dispute_refund_stamp (20261012194318_clear_test_mode_dispute_refund_stamp.sql), because markFailed stamps
 * both legs and supersede reads execution_refund_id as money moved too.
 * Behaviour: src/test/pglite/testModeDisputeRefundStampClears.pglite.mjs (27
 * PASS with the migration applied 3x; 21 FAIL without it, supersede refusing).
 *
 * @mutate supabase/migrations/20261012194318_clear_test_mode_dispute_refund_stamp.sql |   IF _d.execution_refund_id IS DISTINCT FROM btrim(_refund_id) THEN |   IF false THEN
 * @mutate supabase/migrations/20261012194318_clear_test_mode_dispute_refund_stamp.sql |   IF NOT public.has_role(_uid, 'admin') THEN |   IF false THEN
 * @mutate supabase/migrations/20261012194318_clear_test_mode_dispute_refund_stamp.sql |      OR _d.execution_status NOT IN ('failed', 'executing') THEN |      OR false THEN
 * @mutate supabase/migrations/20261012194318_clear_test_mode_dispute_refund_stamp.sql |   IF EXISTS (SELECT 1 FROM public.payment_refunds r WHERE r.job_id = _d.job_id) THEN |   IF false THEN
 * @mutate supabase/migrations/20261012194318_clear_test_mode_dispute_refund_stamp.sql |             OR c.money_step_at IS NOT NULL) |             )
 * @mutate supabase/migrations/20261012194318_clear_test_mode_dispute_refund_stamp.sql |      AND COALESCE(_d.execution_started_at, now()) >= now() - public.dispute_settlement_claim_ttl() THEN |      AND false THEN
 * @mutate supabase/migrations/20261005173719_clear_test_mode_dispute_transfer_stamp.sql |             OR c.money_step_at IS NOT NULL) |             )
 * @mutate supabase/migrations/20261005173719_clear_test_mode_dispute_transfer_stamp.sql |      AND COALESCE(_d.execution_started_at, now()) >= now() - public.dispute_settlement_claim_ttl() THEN |      AND false THEN
 * @mutate supabase/migrations/20261012194318_clear_test_mode_dispute_refund_stamp.sql |   IF _uid = _customer OR _uid = _helper THEN |   IF false THEN
 * @mutate supabase/migrations/20261012194318_clear_test_mode_dispute_refund_stamp.sql | REVOKE ALL ON FUNCTION public.rpc_clear_test_mode_dispute_refund_stamp(uuid, text, text) FROM PUBLIC, anon; | REVOKE ALL ON FUNCTION public.rpc_clear_test_mode_dispute_refund_stamp(uuid, text, text) FROM anon;
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments, blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const defs = effectiveDefs(resolve(ROOT, "supabase/migrations"));
const code = (name: string) => {
  const d = defs.get(name);
  expect(d, `${name} has a migration definition`).toBeDefined();
  return blankSqlComments(d!.stmt).replace(/\s+/g, " ");
};

describe("Q1280: a test-mode dispute stamp has a hand path out", () => {
  it("reads the real definitions (floor)", () => {
    expect(defs.size).toBeGreaterThan(200);
  });

  it("the edge refusal names the way out, and that RPC exists", () => {
    const edge = blankComments(readFileSync(resolve(ROOT, "supabase/functions/execute-dispute-split/index.ts"), "utf8"));
    expect(edge).toMatch(/isTestObjectUnderLiveKey\(e\)/);
    expect(edge).toMatch(/rpc_clear_test_mode_dispute_stamp/);
    expect(defs.has("rpc_clear_test_mode_dispute_stamp")).toBe(true);
  });

  it("the clearing RPC keeps every money gate", () => {
    const c = code("rpc_clear_test_mode_dispute_stamp");
    expect(c).toMatch(/SECURITY DEFINER/i);
    expect(c).toMatch(/IF NOT public\.has_role\(_uid, 'admin'\) THEN RAISE/);
    expect(c).toMatch(/IF _uid = _customer OR _uid = _helper THEN RAISE/);
    expect(c).toMatch(/IF _d\.execution_transfer_id IS DISTINCT FROM btrim\(_transfer_id\) THEN RAISE/);
    expect(c).toMatch(/IF EXISTS \(SELECT 1 FROM public\.payout_transfers t WHERE t\.job_id = _d\.job_id AND t\.stripe_transfer_id = _d\.execution_transfer_id\) THEN RAISE/);
    expect(c).toMatch(/dispute_settlement_claims/);
    // Both settlement-claim gates, not only the table name (money review of Q1383, note C).
    expect(c).toMatch(/OR c\.money_step_at IS NOT NULL\)/);
    expect(c).toMatch(/AND COALESCE\(_d\.execution_started_at, now\(\)\) >= now\(\) - public\.dispute_settlement_claim_ttl\(\) THEN RAISE EXCEPTION 'dispute_settlement_in_progress'/);
    // Only a resume re-reads Stripe before paying (lh-authz-rls review, LOW 3).
    expect(c).toMatch(/OR _d\.execution_status NOT IN \('failed', 'executing'\) THEN RAISE/);
    expect(c).toMatch(/NOT IN \('escrow', 'payout_pending'\) THEN RAISE/);
    // The audit row is written before the stamp is cleared.
    expect(c.indexOf("INSERT INTO public.admin_audit_log")).toBeGreaterThan(0);
    expect(c.indexOf("INSERT INTO public.admin_audit_log")).toBeLessThan(c.indexOf("SET execution_transfer_id = NULL"));
  });

  it("Q1383: the refund-stamp clear keeps every money gate, and the edge refusal names it", () => {
    const c = code("rpc_clear_test_mode_dispute_refund_stamp");
    expect(c).toMatch(/SECURITY DEFINER/i);
    expect(c).toMatch(/IF NOT public\.has_role\(_uid, 'admin'\) THEN RAISE/);
    expect(c).toMatch(/IF _uid = _customer OR _uid = _helper THEN RAISE/);
    expect(c).toMatch(/IF _d\.execution_refund_id IS DISTINCT FROM btrim\(_refund_id\) THEN RAISE/);
    expect(c).toMatch(/IF EXISTS \(SELECT 1 FROM public\.payment_refunds r WHERE r\.job_id = _d\.job_id\) THEN RAISE/);
    expect(c).toMatch(/dispute_settlement_claims/);
    expect(c).toMatch(/OR c\.money_step_at IS NOT NULL\)/);
    expect(c).toMatch(/AND COALESCE\(_d\.execution_started_at, now\(\)\) >= now\(\) - public\.dispute_settlement_claim_ttl\(\) THEN RAISE EXCEPTION 'dispute_settlement_in_progress'/);
    expect(c).toMatch(/OR _d\.execution_status NOT IN \('failed', 'executing'\) THEN RAISE/);
    expect(c).toMatch(/NOT IN \('escrow', 'payout_pending'\) THEN RAISE/);
    expect(c.indexOf("INSERT INTO public.admin_audit_log")).toBeGreaterThan(0);
    expect(c.indexOf("INSERT INTO public.admin_audit_log")).toBeLessThan(c.indexOf("SET execution_refund_id = NULL"));
    // It clears the refund stamp only; the transfer stamp keeps its own path.
    expect(c).not.toMatch(/execution_transfer_id = NULL/);
    const edge = blankComments(readFileSync(resolve(ROOT, "supabase/functions/execute-dispute-split/index.ts"), "utf8"));
    expect(edge).toMatch(/rpc_clear_test_mode_dispute_refund_stamp/);
    // supersede reads the refund stamp as money moved: that is why this path exists.
    expect(code("rpc_supersede_dispute_decision")).toMatch(/OR _d\.execution_refund_id IS NOT NULL/);
    const mig = blankSqlComments(readFileSync(resolve(ROOT, "supabase/migrations/20261012194318_clear_test_mode_dispute_refund_stamp.sql"), "utf8"));
    expect(mig).toMatch(/REVOKE ALL ON FUNCTION public\.rpc_clear_test_mode_dispute_refund_stamp\(uuid, text, text\) FROM PUBLIC, anon;/);
  });

  it("supersede still reads a stamp as money moved", () => {
    expect(code("rpc_supersede_dispute_decision")).toMatch(/_moved := _d\.execution_transfer_id IS NOT NULL/);
  });

  it("anon and PUBLIC cannot execute the clearing RPC", () => {
    const mig = readFileSync(resolve(ROOT, "supabase/migrations/20261005173719_clear_test_mode_dispute_transfer_stamp.sql"), "utf8");
    expect(blankSqlComments(mig)).toMatch(/REVOKE ALL ON FUNCTION public\.rpc_clear_test_mode_dispute_stamp\(uuid, text, text\) FROM PUBLIC, anon;/);
  });
});
