/**
 * Q2725 / Q2726 / Q2732 (live alerts 11-04; root cause measured read-only on prod): the Stripe TEST-mode tax checks
 * (throwaway ci/ workflows, PaymentIntents with metadata job_id "l59-test-mw1lqwzr" / "b109-test-mw253rpx") reached
 * stripe-webhook, and three paths paged the owner about money that was never a member's:
 *   - charge.refunded tried the refund notice ("job read: invalid input syntax for type uuid") and booked a
 *     payment_refunds row with no job and no member (Q2725);
 *   - void-cancelled-payments' hourly untold-refund sweep re-paged that row every hour as no_recipient (Q2726);
 *   - payment_intent.succeeded's job-site tax commit paged its idempotency clash as money at risk (Q2732).
 * isTestModeOrphan marks a TEST-mode event naming a job_id that is not ours; live events and test events with no
 * job_id (gift cards, Declutter) or a real test job are untouched. The sweep skips a row that names nobody.
 *
 * @mutate supabase/functions/stripe-webhook/handlers/_testSubject.ts |   if (livemode !== false \|\| !jobId) return false; |   if (!jobId) return false;
 * @mutate supabase/functions/stripe-webhook/handlers/_testSubject.ts |   if (!UUID_RE.test(jobId)) return true; |   if (!UUID_RE.test(jobId)) return false;
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts |     if (await isTestModeOrphan(supabase, event.livemode, testJobId, logStep)) { |     if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/paymentIntentSucceeded.ts | seed: taxJob?.is_seed === true \|\| testOrphan, supabase }); | seed: taxJob?.is_seed === true, supabase });
 * @mutate supabase/functions/void-cancelled-payments/index.ts |             if (!r.customer_id && !r.job_id) { |             if (false) {
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { isTestModeOrphan } from "../../supabase/functions/stripe-webhook/handlers/_testSubject";

const read = (p: string) => blankComments(readFileSync(join(process.cwd(), p), "utf8"));
const JOB = "11111111-2222-3333-4444-555555555555";
const db = (row: unknown, error: { message: string } | null = null) => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error }) }) }) }),
});
const log = () => {};

describe("isTestModeOrphan", () => {
  it("a TEST-mode job_id that is not a uuid, or names no job, is a test script's payment", async () => {
    expect(await isTestModeOrphan(db(null), false, "b109-test-mw253rpx", log)).toBe(true);
    expect(await isTestModeOrphan(db(null), false, JOB, log)).toBe(true);
  });
  it("a live event, a test event with no job_id, a real test job or a failed read is ours", async () => {
    expect(await isTestModeOrphan(db(null), true, "b109-test-mw253rpx", log)).toBe(false);
    expect(await isTestModeOrphan(db(null), undefined, "x", log)).toBe(false);
    expect(await isTestModeOrphan(db(null), false, null, log)).toBe(false);
    expect(await isTestModeOrphan(db({ id: JOB }), false, JOB, log)).toBe(false);
    expect(await isTestModeOrphan(db(null, { message: "down" }), false, JOB, log)).toBe(false);
  });
});

describe("the three paging paths treat a test-mode orphan as test data", () => {
  it("charge.refunded returns before any job, ledger row or notice", () => {
    const src = read("supabase/functions/stripe-webhook/handlers/chargeRefunded.ts");
    const at = src.indexOf("if (await isTestModeOrphan(supabase, event.livemode, testJobId, logStep)) {");
    expect(at).toBeGreaterThan(0);
    expect(src.slice(at, at + 300)).toMatch(/return;/);
    expect(at).toBeLessThan(src.indexOf('.from("payment_refunds")'));
    expect(at).toBeLessThan(src.indexOf("sendRefundNotice(supabase, {"));
  });
  it("the job-site tax commit marks it seed (digest only, never paged)", () => {
    const src = read("supabase/functions/stripe-webhook/handlers/paymentIntentSucceeded.ts");
    expect(src).toContain("const testOrphan = await isTestModeOrphan(supabase, pi.livemode, (pi.metadata ?? {}).job_id, logStep);");
    expect(src).toContain("seed: taxJob?.is_seed === true || testOrphan, supabase });");
  });
  it("the untold-refund sweep skips a ledger row that names nobody, before it sends or pages", () => {
    const src = read("supabase/functions/void-cancelled-payments/index.ts");
    const skip = src.indexOf("if (!r.customer_id && !r.job_id) {");
    expect(skip).toBeGreaterThan(0);
    const page = src.indexOf('title: "Money went back to a poster who was not fully told",', skip);
    expect(page).toBeGreaterThan(skip);
    expect(src.slice(skip, page)).toContain("sendRefundNotice(supabaseAdmin, {");
  });
});
