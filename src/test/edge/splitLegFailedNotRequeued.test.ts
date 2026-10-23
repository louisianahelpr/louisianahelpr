/**
 * Q2357: a job a dispute split settled is never paid in full after the split's transfer fails.
 *
 * Before: transfer.failed / transfer.canceled reset any 'released' job with no live dispute to payout_pending
 * (a 'resolved' dispute counts as settled), get_payout_batches then listed it, and the admin's "Send Payout"
 * (release-payout) paid the FULL job amount on top of the poster's split refund (its escrow cap ignores
 * refunds). RELEASE_PAYOUT_AUTO is "1" on prod (measured 2026-10-23 by the secret digest).
 * Now: the webhook leaves a split leg's job alone and re-opens its dispute (execution_status 'failed') so the
 * split is re-run; release-payout refuses a job carrying a split leg.
 */
// @mutate supabase/functions/stripe-webhook/handlers/transferFailed.ts |   if (failedLedger?.job_id && isDisputeSplitLeg((failedLedger as { metadata?: unknown }).metadata)) { |   if (false) {
// @mutate supabase/functions/release-payout/index.ts |   if (splitLeg) { |   if (false) {
// @mutate supabase/functions/stripe-webhook/handlers/transferCanceled.ts |   if (canceledLedger?.job_id && isDisputeSplitLeg((canceledLedger as { metadata?: unknown }).metadata)) { |   if (false) {
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";

const CRON_SECRET = "cron-secret-xyz";
/** jobs.status of a settled job (a named value: these rows are jobs, not disputes). */
const JOB_DONE = "completed";
const DISPUTE = "dddddddd-3333-4ddd-8ddd-dddddddddddd";
const SPLIT_LEG = { source: "execute_dispute_split", dispute_id: DISPUTE, helper_share: "60" };

type W = { table: string; op: string; payload: unknown; filters: Array<{ op: string; column: string; value: unknown }> };
const writesTo = (t: string) => (scenario.writes as W[]).filter((w) => w.table === t);

describe("Q2357: a failed dispute-split transfer is re-run as the split, never paid in full", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  async function webhook(): Promise<EdgeHarness> {
    setEnv({
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-key",
      STRIPE_SECRET_KEY: "sk_test_abc",
      STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
    });
    return loadEdgeFunction("stripe-webhook");
  }
  function deliver(fn: EdgeHarness, type: string, object: Record<string, unknown>) {
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({ id: `evt_q2357_${type}`, type, data: { object } });
    return fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=abc", "content-type": "application/json" } }));
  }

  for (const type of ["transfer.failed", "transfer.canceled"]) {
    it(`${type}: the split leg's job is NOT re-queued; its dispute goes back to 'failed' for a re-run`, async () => {
      const fn = await webhook();
      scenario.reads.notifications = { rows: [] };
      scenario.writeSelectRows.payout_transfers = [{ job_id: "job-1", helper_id: "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa", amount_cents: 5280, metadata: SPLIT_LEG }];
      scenario.writeSelectRows.disputes = [{ id: DISPUTE }];
      scenario.reads.jobs = { rows: [{ id: "job-1", status: JOB_DONE, payment_status: "released", dispute_status: "resolved", disputed_at: "2026-10-20T00:00:00Z" }] };
      const res = await deliver(fn, type, { id: "tr_split", amount: 5280, destination: "acct_helper", failure_message: "closed", metadata: { job_id: "job-1", dispute_id: DISPUTE } });
      expect(res.status).toBe(200);
      expect(writesTo("jobs")).toEqual([]);
      const d = writesTo("disputes");
      expect(d).toHaveLength(1);
      expect(d[0].payload).toMatchObject({ execution_status: "failed" });
      expect(d[0].filters).toEqual(expect.arrayContaining([
        expect.objectContaining({ op: "eq", column: "id", value: DISPUTE }),
        expect.objectContaining({ op: "eq", column: "execution_status", value: "executed" }),
      ]));
      expect(slackAlerts.some((a) => /Dispute split transfer did not settle/.test(String((a as { title?: string }).title)))).toBe(true);
    });
  }

  it("control: an ordinary payout's failed transfer is still re-queued", async () => {
    const fn = await webhook();
    scenario.reads.notifications = { rows: [] };
    scenario.writeSelectRows.payout_transfers = [{ job_id: "job-1", helper_id: "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa", amount_cents: 5280, metadata: { source: "release-payout" } }];
    scenario.reads.jobs = { rows: [{ id: "job-1", status: JOB_DONE, payment_status: "released", dispute_status: null, disputed_at: null }] };
    scenario.writeSelectRows.jobs = [{ id: "job-1", status: JOB_DONE, is_group_job: false, disputed_at: null, dispute_status: null }];
    await deliver(fn, "transfer.failed", { id: "tr_plain", amount: 5280, destination: "acct_helper", failure_message: "closed", metadata: { job_id: "job-1" } });
    expect(writesTo("jobs").some((w) => (w.payload as Record<string, unknown>).payment_status === "payout_pending")).toBe(true);
    expect(writesTo("disputes")).toEqual([]);
  });

  it("release-payout refuses a job a dispute split settled: no transfer, 409", async () => {
    setEnv({
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_ANON_KEY: "anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-key",
      STRIPE_SECRET_KEY: "sk_test_abc",
      CRON_SECRET,
    });
    const fn = await loadEdgeFunction("release-payout");
    scenario.reads.jobs = { rows: [{
      id: "job-1", title: "Split job", status: JOB_DONE, payment_status: "payout_pending", helper_id: "helper-1",
      customer_id: "poster-1", budget: 100, urgent_fee: 0, dispute_status: "resolved", disputed_at: "2026-10-20T00:00:00Z",
      is_group_job: false, helpers_needed: null, stripe_payment_intent_id: "pi_1", stripe_session_id: null,
    }] };
    scenario.reads.disputes = { rows: [] };
    scenario.reads.gift_cards = { rows: [] };
    scenario.reads.payout_transfers = { rows: [{ id: "pt-1", stripe_transfer_id: "tr_split", status: "failed", created_at: "2026-10-21T00:00:00Z", amount_cents: 5280, metadata: SPLIT_LEG }] };
    scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_helper", full_name: "H", onboarding_fee_paid: true }] };
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_1", status: "succeeded", amount: 11200, amount_received: 11200 });
    stripeMock.accounts.retrieve.mockResolvedValue({ id: "acct_helper", payouts_enabled: true, charges_enabled: true });
    const res = await fn.fetch(fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: { job_id: "job-1" } }));
    expect(res.status).toBe(409);
    expect(String((JSON.parse(await res.text()) as { error?: string }).error)).toMatch(/dispute split/);
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
  });
});
