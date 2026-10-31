/**
 * Review of 9c498193ff #1 (the hourly half): an instant cash-out's fee owed back
 * (its payout failed, or the bank returned it) went back only when the Helpr
 * opened cash-out again, and while memberships are off nobody can. The hourly
 * process-scheduled-payouts run now returns it, on the same returnInstantFee
 * path, so a run and a cash-out at once never reverse twice. A test account's
 * stuck fee is a seed defect (the digest), a real Helpr's is a defect (pages).
 *
 * @mutate supabase/functions/process-scheduled-payouts/index.ts |     const feeRedrive = await redriveInstantFeeReturns(supabaseAdmin, async (helperId) => { |     const feeRedrive = await (async (_db: unknown, _f: unknown) => ({ returned: 0, kept: 0, not_taken: 0, owed: 0, defects: [] as string[], seedDefects: [] as string[] }))(supabaseAdmin, async (helperId: string) => {
 * @mutate supabase/functions/_shared/instantPayoutFeeReturn.ts |       (seed ? out.seedDefects : out.defects).push( |       (out.defects).push(
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

const CRON_SECRET = "cron-secret-xyz";

async function runCron(expectStatus = 200): Promise<Record<string, unknown>> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc",
    STRIPE_TEST_SECRET_KEY: "sk_test_tst",
    CRON_SECRET,
  });
  const fn = await loadEdgeFunction("process-scheduled-payouts");
  const res = await fn.fetch(fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }));
  expect(res.status).toBe(expectStatus);
  return JSON.parse(await res.text());
}

const owed = (over: Record<string, unknown> = {}) => ({
  id: "ip-0", helper_id: "helper-1", created_at: "2026-10-31T00:00:00Z", fee_amount: 3, fee_state: "taken",
  fee_transfer_id: "tr_fee", status: "failed", error_message: null, ...over,
});
const feeWrites = () =>
  scenario.writes.filter((w) => w.table === "instant_payouts" && w.op === "update").map((w) => w.payload as Record<string, unknown>);

beforeEach(() => {
  resetEnv(); resetSupabaseMock(); resetSharedMocks(); resetStripeMock();
  scenario.reads.jobs = { rows: [] };
  scenario.reads.platform_settings = { rows: [{ onboarding_fee_cents: 200 }] };
  scenario.reads.payout_transfers = { rows: [] };
  scenario.reads.chargeback_clawbacks = { rows: [] };
  scenario.reads.tip_hold_redrives = { rows: [] };
  scenario.reads.payout_holds = { rows: [] };
  scenario.reads.test_accounts = { rows: [] };
  scenario.reads.profiles = { rows: [{ user_id: "helper-1", stripe_account_id: "acct_helper", is_seed: false }] };
  stripeMock.transfers.createReversal.mockResolvedValue({ id: "trr_hourly" });
});

describe("the hourly run returns an instant cash-out's owed fee", () => {
  it("an owed fee goes back on the Helpr's own account, once, under the attempt's fixed key", async () => {
    scenario.reads.instant_payouts = { rows: [owed()] };
    const body = await runCron();
    expect(stripeMock.transfers.createReversal).toHaveBeenCalledTimes(1);
    const [tid, , opts] = stripeMock.transfers.createReversal.mock.calls[0];
    expect(tid).toBe("tr_fee");
    expect(opts).toEqual({ stripeAccount: "acct_helper", idempotencyKey: "instant-payout-fee-return-ip-0" });
    expect(feeWrites()[0]).toMatchObject({ fee_state: "returned", fee_reversal_id: "trr_hourly" });
    expect(body.heldRedrive).toMatchObject({ instant_fees_returned: 1, instant_fees_owed: 0 });
  });

  it("nothing owed: no Stripe call", async () => {
    scenario.reads.instant_payouts = { rows: [] };
    await runCron();
    expect(stripeMock.transfers.createReversal).not.toHaveBeenCalled();
    expect(stripeMock.transfers.listReversals).not.toHaveBeenCalled();
  });

  it("a return that fails is a defect for a real Helpr and a seed defect for a test account", async () => {
    stripeMock.transfers.createReversal.mockRejectedValue(new Error("stripe is down"));
    scenario.reads.instant_payouts = { rows: [owed()] };
    // A real Helpr's: the run says it dropped work (500, defectReasons), which pages.
    const real = await runCron(500);
    expect(JSON.stringify(real.defectReasons)).toMatch(/ip-0.*fee not returned/);
    expect((real.heldRedrive as Record<string, number>).instant_fees_owed).toBe(1);

    resetSupabaseMock();
    scenario.reads.jobs = { rows: [] };
    scenario.reads.platform_settings = { rows: [{ onboarding_fee_cents: 200 }] };
    scenario.reads.payout_transfers = { rows: [] };
    scenario.reads.chargeback_clawbacks = { rows: [] };
    scenario.reads.tip_hold_redrives = { rows: [] };
    scenario.reads.payout_holds = { rows: [] };
    scenario.reads.test_accounts = { rows: [{ user_id: "helper-1" }] };
    scenario.reads.profiles = { rows: [{ user_id: "helper-1", stripe_account_id: "acct_helper", is_seed: true }] };
    scenario.reads.instant_payouts = { rows: [owed()] };
    // A test account's: the digest only (seedDefects); the run is clean.
    const test = await runCron(200);
    expect(JSON.stringify(test.seedDefects)).toMatch(/ip-0.*fee not returned/);
    expect(test.defects).toBe(0);
  });
});
