/**
 * Q1910: a payout cron that read a job just before an admin closed its dispute
 * as a TEST (rpc_close_test_mode_dispute, 20261015061949) passed the dispute
 * gate (the close stamps execution_status 'executed'), sent the job's test
 * money, then paged a false CRITICAL when its payment_status flip matched 0
 * rows (the close moved the job to 'cancelled'). checkUnsettledDispute now
 * blocks a test-closed dispute as an outcome (`testClosed`), and
 * process-scheduled-payouts skips it with no transfer and no page.
 *
 * @mutate supabase/functions/_shared/unsettledDispute.ts |     if (c) return { blocked: true, testClosed: { id: c.id } }; |     if (c) return { blocked: false };
 * @mutate supabase/functions/process-scheduled-payouts/index.ts |         if (settlement.testClosed) { |         if (false) {
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "../helpers/blankNonCode";
import { checkUnsettledDispute, TEST_MODE_CLOSE_PREFIX } from "../../../supabase/functions/_shared/unsettledDispute.ts";

const ROOT = resolve(__dirname, "../../..");

/** A client whose `disputes` reads answer in order (decided-unexecuted read, then the test-close read). */
function client(answers: Array<{ data: unknown; error: unknown }>, claims: unknown[] = []) {
  const queue = [...answers];
  return {
    from: (t: string) => {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "or", "ilike"]) b[m] = () => b;
      b.limit = () => Promise.resolve(t === "disputes" ? queue.shift() : { data: claims, error: null });
      return b;
    },
  };
}

describe("Q1910: a dispute closed as a test blocks payout as an outcome", () => {
  it("the close's own words match the migration and the admin card", () => {
    const sql = readFileSync(resolve(ROOT, "supabase/migrations/20261015061949_close_test_mode_dispute.sql"), "utf8");
    expect(sql).toContain(`'${TEST_MODE_CLOSE_PREFIX}, no real money moved: '`);
    const card = readFileSync(resolve(ROOT, "src/components/disputeCloseReason.ts"), "utf8");
    expect(card).toContain(TEST_MODE_CLOSE_PREFIX);
  });

  it("blocks with testClosed (not a dispute hold, not a read error) when the close landed after the select", async () => {
    const r = await checkUnsettledDispute(
      client([{ data: [], error: null }, { data: [{ id: "d-7", execution_error: `${TEST_MODE_CLOSE_PREFIX}, no real money moved: test` }], error: null }]),
      "job-1",
    );
    expect(r).toEqual({ blocked: true, testClosed: { id: "d-7" } });
  });

  it("an executed real split (any other execution_error) does not block", async () => {
    const r = await checkUnsettledDispute(
      client([{ data: [], error: null }, { data: [{ id: "d-8", execution_error: null }], error: null }]),
      "job-1",
    );
    expect(r.blocked).toBe(false);
  });

  it("a failed test-close read is a refusal", async () => {
    const r = await checkUnsettledDispute(client([{ data: [], error: null }, { data: null, error: { message: "reset", code: "08006" } }]), "job-1");
    expect(r).toEqual({ blocked: true, readError: "reset" });
  });

  it("process-scheduled-payouts skips a test-closed job before the CRITICAL page and before any transfer", () => {
    const src = blankComments(readFileSync(resolve(ROOT, "supabase/functions/process-scheduled-payouts/index.ts"), "utf8"));
    const gate = src.indexOf("const settlement = await checkUnsettledDispute(");
    expect(gate).toBeGreaterThan(0);
    const skip = src.indexOf("if (settlement.testClosed) {", gate);
    const page = src.indexOf("Scheduled payout refused", gate);
    const transfer = src.indexOf("transfers.create", gate);
    expect(skip).toBeGreaterThan(gate);
    expect(skip).toBeLessThan(page);
    expect(skip).toBeLessThan(transfer);
    expect(src.slice(skip, page)).toMatch(/status: "dispute_closed_as_test"[\s\S]*?continue;/);
  });
});
