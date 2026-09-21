/**
 * release-payout must not send a transfer when Stripe already holds one for the
 * job that the ledger does not record.
 *
 * Split out of release-payout.test.ts so the fixture-vs-schema guard can
 * attribute these payout_transfers literals without the job-status literals of
 * the main file in scope.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import {
  scenario,
  resetSupabaseMock,
  type SupabaseScenario,
} from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";

const CRON_SECRET = "cron-secret-xyz";

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc",
    CRON_SECRET,
  });
  return loadEdgeFunction("release-payout");
}


/**
 * The poster-side charge for a seeded job, in cents — what Stripe captured
 * into escrow. Budget + urgent fee + the 12% customer fee.
 *
 * Deliberately the POSTER total, not the helper payout: the cap asserts
 * payout <= captured, and capturing exactly the payout would satisfy that for
 * the wrong reason and stop catching a post-checkout budget raise.
 */
function capturedCentsFor(job: Record<string, unknown>): number {
  const budget = Number(job.budget ?? 0);
  const urgent = Number(job.urgent_fee ?? 0);
  return Math.round((budget + urgent) * 100 * 1.12);
}

/**
 * Seed a fully-payable job: completed, payout_pending, helper with an
 * active Connect account, no dispute, no existing transfer.
 */
function seedPayableJob(s: SupabaseScenario, overrides: Record<string, unknown> = {}) {
  const job = {
    id: "job-1",
    title: "Mow the lawn",
    status: "completed",
    payment_status: "payout_pending",
    helper_id: "helper-1",
    customer_id: "poster-1",
    budget: 100,
    urgent_fee: 0,
    dispute_status: null,
    disputed_at: null,
    is_group_job: false,
    helpers_needed: null,
    stripe_payment_intent_id: "pi_1",
    stripe_session_id: null,
    ...overrides,
  };
  s.reads.jobs = { rows: [job] };
  // Not a gift-card-funded job by default, and the escrow charge captured.
  //
  // The amount matters as much as the status. This mock carried only a status
  // until the payout cap started reading the figure — a succeeded
  // PaymentIntent with no amount is not a thing Stripe returns, and modelling
  // one meant every payout here was asserted against $0 of escrow.
  s.reads.gift_cards = { rows: [] };
  // A gift-funded job has no Stripe charge, so its escrow is valued through the
  // same dry-run RPC the other payout paths use. Seeded by default rather than
  // per-test: a test flips a job to gift-card-funded by seeding `gift_cards`,
  // and without this the valuation would fail and the payout 503 for a reason
  // that has nothing to do with what the test is asserting. A test that WANTS
  // the valuation to fail sets `scenario.rpcErrors`, which wins over this.
  s.rpc.restore_gift_card_for_job = {
    outcome: "would_restore",
    applied_cents: capturedCentsFor(job),
  };
  stripeMock.paymentIntents.retrieve.mockResolvedValue({
    id: "pi_1",
    status: "succeeded",
    amount: capturedCentsFor(job),
    amount_received: capturedCentsFor(job),
  });
  s.reads.profiles = {
    rows: [
      {
        stripe_account_id: "acct_helper",
        full_name: "Helpful Helper",
        onboarding_fee_paid: true,
      },
    ],
  };
  s.reads.platform_settings = {
    rows: [{ helper_fee_percent: 10, onboarding_fee_cents: 200 }],
  };
  s.reads.payout_transfers = { rows: [] };
  stripeMock.accounts.retrieve.mockResolvedValue({
    id: "acct_helper",
    payouts_enabled: true,
    charges_enabled: true,
  });
  stripeMock.transfers.create.mockResolvedValue({
    id: "tr_1",
    transfer_group: "job_job-1",
  });
}

describe("release-payout — a transfer at Stripe with no ledger row", () => {
  const req = () => ({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: { job_id: "job-1" } });

  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  // Round-5 money review, HIGH: release-payout and process-scheduled-payouts
  // share the claim row but not the idempotency key. A claim orphaned by one
  // (older than the 2-minute in-flight window) was resumed by the OTHER under
  // ITS key — a second real transfer. An orphaned claim no longer exempts the
  // Stripe check: one matching unrecorded transfer is adopted, anything else
  // refuses.
  it("an orphaned claim + a MATCHING unrecorded transfer: adopts it, no transfers.create", async () => {
    // The amount this job pays, observed from a clean run.
    seedPayableJob(scenario);
    await (await load()).fetch((await load()).request(req()));
    const amount = stripeMock.transfers.create.mock.calls[0][0].amount as number;
    resetSupabaseMock(); resetStripeMock(); resetSharedMocks();

    seedPayableJob(scenario);
    scenario.reads.payout_transfers = { rows: [{ id: "led-orphan", helper_id: "helper-1", stripe_transfer_id: null, status: "pending", created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() }] };
    stripeMock.transfers.list.mockResolvedValue({
      data: [{ id: "tr_sched", amount, amount_reversed: 0, destination: "acct_helper", metadata: { job_id: "job-1", helper_id: "helper-1" } }],
    });
    const fn = await load();
    const res = await fn.fetch(fn.request(req()));
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    const settle = scenario.writes.find((w) => w.table === "payout_transfers" && w.op === "update");
    expect((settle?.payload as Record<string, unknown>)?.stripe_transfer_id).toBe("tr_sched");
  });

  it("an orphaned claim + a NON-matching unrecorded transfer: 409, page, no transfers.create", async () => {
    seedPayableJob(scenario);
    scenario.reads.payout_transfers = { rows: [{ id: "led-orphan", helper_id: "helper-1", stripe_transfer_id: null, status: "pending", created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() }] };
    stripeMock.transfers.list.mockResolvedValue({
      data: [{ id: "tr_other", amount: 1234, amount_reversed: 0, destination: "acct_someone_else", metadata: { job_id: "job-1" } }],
    });
    const fn = await load();
    const res = await fn.fetch(fn.request(req()));
    expect(res.status).toBe(409);
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect((slackAlerts as Array<{ severity?: string }>).some((a) => a.severity === "critical")).toBe(true);
  });

  it("finds an UNGROUPED transfer for this job by destination + metadata.job_id (transfer_group is not a guarantee)", async () => {
    // A transfer created without `transfer_group` — every create-payment
    // Quick Release before 20260915034822 — is invisible to a group list. The
    // check also lists the Helpr's destination account and matches the job
    // id in metadata, so it cannot fail open on one.
    seedPayableJob(scenario);
    const legacy = { id: "tr_legacy", amount: 8800, amount_reversed: 0, destination: "acct_helper", transfer_group: null, metadata: { job_id: "job-1" } };
    stripeMock.transfers.list.mockImplementation(async (p: Record<string, string | undefined>) => {
      const hit = p.destination === "acct_helper" ? [legacy] : [];
      return { data: hit };
    });
    const fn = await load();
    const res = await fn.fetch(fn.request(req()));
    expect(res.status).toBe(409);
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
  });

  it("fails CLOSED when the Stripe transfer list cannot be read", async () => {
    seedPayableJob(scenario);
    stripeMock.transfers.list.mockRejectedValue(new Error("stripe down"));
    const fn = await load();
    const res = await fn.fetch(fn.request(req()));
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
  });

  it("control: a fully reversed transfer does not block the payout", async () => {
    seedPayableJob(scenario);
    stripeMock.transfers.list.mockResolvedValue({
      data: [{ id: "tr_back", amount: 11200, amount_reversed: 11200, transfer_group: "job_job-1" }],
    });
    const fn = await load();
    const res = await fn.fetch(fn.request(req()));
    expect(res.status).toBe(200);
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
  });
});

// Proof this guard can fail: make the Stripe transfer-list read fail OPEN and an
// unverifiable payout is sent instead of deferred — the exact double-transfer
// this file's `fails CLOSED when the Stripe transfer list cannot be read` covers.
// @mutate supabase/functions/_shared/payoutClaim.ts | return { kind: "error", message: `Stripe transfer list failed: ${(e as Error).message}` }; | return { kind: "clear" };
