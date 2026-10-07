/**
 * Q1383: a decided dispute whose split ran under the Stripe TEST key and got
 * its refund leg out (execution_refund_id plus its own split payment_refunds
 * row) could never be superseded; the Q1280 clearer handles the transfer leg
 * only. rpc_clear_test_mode_dispute_refund_stamp (20261007140515) is the
 * refund-side hand path.
 *
 * Behaviour (real Postgres): src/test/pglite/testModeDisputeRefundStampClears.pglite.mjs
 * (28 PASS applied 3x; NEW_MIGRATION=skip -> 25 FAILED, supersede refusing).
 * This keeps the gates in CI, read from the NEWEST definitions, and keeps
 * supersede treating a refund stamp and any refund row as money moved (so
 * clearing is the ONE way past it).
 *
 * @mutate supabase/migrations/20261007140515_clear_test_mode_dispute_refund_stamp.sql |   IF _d.execution_refund_id IS DISTINCT FROM btrim(_refund_id) THEN |   IF false THEN
 * @mutate supabase/migrations/20261007140515_clear_test_mode_dispute_refund_stamp.sql |   IF NOT public.has_role(_uid, 'admin') THEN |   IF false THEN
 * @mutate supabase/migrations/20261007140515_clear_test_mode_dispute_refund_stamp.sql |             OR r.source IS DISTINCT FROM 'dispute_split' |             OR false
 * @mutate supabase/migrations/20261007140515_clear_test_mode_dispute_refund_stamp.sql |   IF _uid = _customer OR _uid = _helper THEN |   IF false THEN
 * @mutate supabase/migrations/20261007140515_clear_test_mode_dispute_refund_stamp.sql |   IF _d.execution_transfer_id IS NOT NULL\n     OR EXISTS |   IF false\n     AND EXISTS
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
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
    expect(c).toMatch(/IF _d\.execution_refund_id IS DISTINCT FROM btrim\(_refund_id\) THEN RAISE/);
    expect(c).toMatch(/OR _d\.execution_status NOT IN \('failed', 'executing'\) THEN RAISE/);
    expect(c).toMatch(/dispute_settlement_claims/);
    expect(c).toMatch(/NOT IN \('escrow', 'payout_pending'\) THEN RAISE EXCEPTION 'clear_stamp_escrow_not_held'/);
    // Only this dispute's own split refund under the named id may be removed.
    expect(c).toMatch(
      /r\.stripe_refund_id IS DISTINCT FROM _d\.execution_refund_id OR r\.source IS DISTINCT FROM 'dispute_split' OR \(r\.metadata ->> 'dispute_id'\) IS DISTINCT FROM _d\.id::text\) \) THEN RAISE EXCEPTION 'clear_stamp_other_refunds'/,
    );
    // Only when it frees the decision (lh-money-escrow review must-fix): a
    // transfer leg or a gift restore keeps supersede refusing, so refuse first.
    expect(c).toMatch(/IF _d\.execution_transfer_id IS NOT NULL OR EXISTS \(SELECT 1 FROM public\.payout_transfers t WHERE t\.job_id = _d\.job_id AND t\.status IN \('pending', 'paid', 'reversed'\)\) OR \(to_regclass\('public\.gift_cards'\) IS NOT NULL AND EXISTS \(SELECT 1 FROM public\.gift_cards g WHERE g\.restored_from_job_id = _d\.job_id\)\) THEN RAISE EXCEPTION 'clear_stamp_transfer_leg_remains'/);
    expect(c.indexOf("clear_stamp_transfer_leg_remains")).toBeLessThan(c.indexOf("DELETE FROM public.payment_refunds"));
    // The trail before the writes.
    expect(c.indexOf("INSERT INTO public.admin_audit_log")).toBeGreaterThan(0);
    expect(c.indexOf("INSERT INTO public.admin_audit_log")).toBeLessThan(c.indexOf("DELETE FROM public.payment_refunds"));
    expect(c.indexOf("INSERT INTO public.admin_audit_log")).toBeLessThan(c.indexOf("UPDATE public.disputes"));
  });

  it("supersede still reads a refund stamp and any refund row as money moved", () => {
    const s = code("rpc_supersede_dispute_decision");
    expect(s).toMatch(/OR _d\.execution_refund_id IS NOT NULL/);
    expect(s).toMatch(/OR EXISTS \(SELECT 1 FROM public\.payment_refunds r WHERE r\.job_id = _d\.job_id\)/);
  });

  it("grants: authenticated + service_role only (admin-gated inside)", () => {
    const mig = readFileSync(resolve(ROOT, "supabase/migrations/20261007140515_clear_test_mode_dispute_refund_stamp.sql"), "utf8");
    expect(blankSqlComments(mig)).toMatch(/REVOKE ALL ON FUNCTION public\.rpc_clear_test_mode_dispute_refund_stamp\(uuid, text, text\) FROM PUBLIC, anon;/);
    expect(blankSqlComments(mig)).toMatch(/GRANT EXECUTE ON FUNCTION public\.rpc_clear_test_mode_dispute_refund_stamp\(uuid, text, text\) TO authenticated, service_role;/);
  });
});
