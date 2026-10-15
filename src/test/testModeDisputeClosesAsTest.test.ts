/**
 * Q1769 (owner decision 2026-10-15): a decided dispute on a Stripe TEST-mode
 * payment between TEST ACCOUNTS closes as "test, no money moved"; a real
 * dispute is never closed this way.
 *
 * WHAT WAS MISSING: rpc_settle_dispute_without_payment refuses any job with a
 * checkout on file ("dispute_has_payment"), so a decided dispute on a
 * test-mode payment could only be split (in test mode, on the TEST key, since
 * Stripe test mode for test accounts). The owner wants such a dispute closed
 * as a test with nothing moved, and a real dispute never closed this way.
 *
 * Behaviour (every refusal, the close, the after-state, the grants) is proven
 * by src/test/pglite/closeTestModeDispute.pglite.mjs, red before the migration
 * and red on each of eight planted defects. This guard keeps the pieces that
 * proof cannot see wired together:
 *   - the NEWEST definition of rpc_close_test_mode_dispute keeps each rule the
 *     owner set (admin only, cs_test_ session, every party a test account by
 *     test_accounts AND profiles.is_seed, no live gift money, the job's payment
 *     closed and owed crew block fees voided), and its EXECUTE is revoked from
 *     PUBLIC and anon;
 *   - every code it raises has admin-facing words in ADMIN_RPC_ERROR_COPY, and no
 *     word is kept for a code it does not raise (inventory, both ways);
 *   - the admin card offers the button only on an unsettled dispute whose job
 *     was paid in test mode, and the handler calls the RPC behind the
 *     biometric gate.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { ADMIN_RPC_ERROR_COPY } from "@/components/admin/adminRpcErrorCopy";

// Shown able to fail: each line alone reds this test.
// @mutate supabase/migrations/20261015061949_close_test_mode_dispute.sql | IF _job.stripe_session_id IS NULL OR left(_job.stripe_session_id, 8) <> 'cs_test_' THEN | IF _job.stripe_session_id IS NULL THEN
// @mutate supabase/migrations/20261015061949_close_test_mode_dispute.sql |               AND pr.is_seed IS TRUE); |               );
// @mutate supabase/migrations/20261015061949_close_test_mode_dispute.sql |        SET payment_status = 'cancelled' |        SET payment_status = payment_status
// @mutate supabase/migrations/20261015061949_close_test_mode_dispute.sql | REVOKE ALL ON FUNCTION public.rpc_close_test_mode_dispute(uuid, text) FROM PUBLIC, anon; | REVOKE ALL ON FUNCTION public.rpc_close_test_mode_dispute(uuid, text) FROM PUBLIC;
// @mutate supabase/migrations/20261015061949_close_test_mode_dispute.sql |     RAISE EXCEPTION 'dispute_has_live_gift' |     RAISE EXCEPTION 'dispute_has_live_gift_x'
// @mutate src/components/admin/adminDisputes/DisputeCard.tsx | const paidInTestMode = unsettled && (job.stripe_session_id ?? "").startsWith("cs_test_"); | const paidInTestMode = unsettled;
// @mutate src/components/admin/adminDisputes/settlementEscapes.ts | const ok = await requireBiometric("Confirm closing this test-mode dispute");\n    if (!ok) return; | const ok = true;
// @mutate src/components/admin/AdminDisputes.tsx |               {...escapes} |               closeWithoutPayment={escapes.closeWithoutPayment}

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase/migrations");
const FN = "rpc_close_test_mode_dispute";
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("Q1769: a test-mode dispute between test accounts closes as a test, and only that", () => {
  const def = effectiveDefs(MIG_DIR).get(FN);
  const body = blankSqlComments(def?.stmt ?? "").replace(/\s+/g, " ");

  it("the newest definition keeps every rule the owner set", () => {
    expect(def?.file, "rpc_close_test_mode_dispute is defined by a migration").toBeTruthy();
    expect(body.length).toBeGreaterThan(3000);
    expect(body).toContain("IF NOT public.has_role(_uid, 'admin') THEN RAISE EXCEPTION 'admin only'");
    // Test-mode money only.
    expect(body).toContain("IF _job.stripe_session_id IS NULL OR left(_job.stripe_session_id, 8) <> 'cs_test_' THEN RAISE EXCEPTION 'dispute_not_test_mode'");
    // Every party a test account: enrolled AND is_seed, a missing poster refused.
    expect(body).toContain("IF _job.customer_id IS NULL OR to_regclass('public.test_accounts') IS NULL THEN RAISE EXCEPTION 'dispute_not_test_accounts'");
    expect(body).toMatch(/FROM public\.test_accounts t JOIN public\.profiles pr ON pr\.user_id = t\.user_id WHERE t\.user_id = p\.user_id AND pr\.is_seed IS TRUE\)/);
    expect(body).toContain("IF _real > 0 THEN RAISE EXCEPTION 'dispute_not_test_accounts'");
    expect(body).toMatch(/FROM public\.group_job_helpers g WHERE g\.job_id = _job\.id/);
    // Gift cards run on the live key.
    expect(body).toContain("RAISE EXCEPTION 'dispute_has_live_gift'");
    // Nothing moves the job's money after the close.
    expect(body).toMatch(/UPDATE public\.jobs SET payment_status = 'cancelled' WHERE id = _job\.id/);
    expect(body).toMatch(/UPDATE public\.crew_block_fees SET status = 'void'/);
    expect(body).toContain("'closed by an admin, Stripe test mode between test accounts, no real money moved: ' || _note_clean");
  });

  it("EXECUTE is revoked from PUBLIC and anon in the defining migration", () => {
    const sql = blankSqlComments(readFileSync(join(MIG_DIR, def?.file ?? "missing"), "utf8"));
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.rpc_close_test_mode_dispute\(uuid, text\) FROM PUBLIC, anon;/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.rpc_close_test_mode_dispute\(uuid, text\) TO authenticated;/);
  });

  it("every code it raises has admin-facing words, and none is kept for a code it does not raise", () => {
    // Codes only: 'admin only', 'not authenticated' and 'dispute not found' are prose.
    const codes = new Set([...body.matchAll(/RAISE EXCEPTION '([a-z]+_[a-z_]+)'/g)].map((m) => m[1]));
    expect(codes.size).toBeGreaterThan(8);
    const copy = Object.keys(ADMIN_RPC_ERROR_COPY[FN]).sort();
    expect(copy).toEqual([...codes].sort());
  });

  it("the admin card offers it only on an unsettled test-mode dispute, behind the biometric gate", () => {
    const card = blankComments(read("src/components/admin/adminDisputes/DisputeCard.tsx"));
    expect(card).toContain(`const paidInTestMode = unsettled && (job.stripe_session_id ?? "").startsWith("cs_test_");`);
    expect(card).toMatch(/\{paidInTestMode && closeAsTest && \(/);
    expect(card).toContain("onClick={() => closeAsTest(job, testCloseNote)}");
    const esc = blankComments(read("src/components/admin/adminDisputes/settlementEscapes.ts"));
    const start = esc.indexOf("const closeAsTest = async");
    expect(start).toBeGreaterThan(0);
    const handler = esc.slice(start, esc.indexOf("return { closeWithoutPayment", start));
    const gate = handler.indexOf(`const ok = await requireBiometric("Confirm closing this test-mode dispute");`);
    const rpc = handler.indexOf(`"rpc_close_test_mode_dispute"`);
    expect(gate).toBeGreaterThan(0);
    expect(rpc).toBeGreaterThan(gate);
    expect(handler.slice(gate, rpc)).toContain("if (!ok) return;");
    expect(esc).toContain("return { closeWithoutPayment, clearTestModeRecords, closeAsTest };");
    const page = blankComments(read("src/components/admin/AdminDisputes.tsx"));
    expect(page).toContain("const escapes = settlementEscapes({ disputeRecords, setRetrying, loadDisputes });");
    expect(page).toContain("{...escapes}");
  });
});
