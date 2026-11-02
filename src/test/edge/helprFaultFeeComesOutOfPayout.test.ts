/**
 * Q2082 (b), owner 2026-10-18 ("J4"): a Helpr ruled at fault owes the card
 * cost of the poster's full refund, and it comes out of their NEXT job payout
 * (migration 20261019015303: take_helpr_fault_fee / restore_helpr_fault_fee,
 * edge helper _shared/helprFaultFee.ts). Both single-Helpr payout paths
 * (release-payout and process-scheduled-payouts) must:
 *   - ask for the debt under the job's payout ref, capped so $1 stays,
 *   - send the whole-dollar payout less EXACTLY what it took (Q2165, owner
 *     2026-10-19: the debt comes off in exact cents, so a payout may carry
 *     cents and what it withholds is what the deduction rows book),
 *   - record it on the ledger row as its own line (never as rounding),
 *   - refuse to pay when the debt cannot be read (fails closed),
 *   - give it back when the transfer fails before money moved.
 *
 * @mutate supabase/functions/release-payout/index.ts |       payoutCents = roundPayoutDownCents(unroundedPayoutCents - onboardingFeeDeductedCents) - helprFaultFeeCents; |       payoutCents = roundPayoutDownCents(unroundedPayoutCents - onboardingFeeDeductedCents);
 * @mutate supabase/functions/release-payout/index.ts |       payoutCents = roundPayoutDownCents(unroundedPayoutCents - onboardingFeeDeductedCents) - helprFaultFeeCents; |       payoutCents = roundPayoutDownCents(unroundedPayoutCents - onboardingFeeDeductedCents - helprFaultFeeCents);
 * @mutate supabase/functions/release-payout/index.ts | if (helprFaultFeeCents > 0 && !opts.transferMayExist && !opts.keepHelprFaultFee) await restoreHelprFaultFee(supabaseAdmin, job.helper_id, job.id, "release-payout"); | if (helprFaultFeeCents < 0 && !opts.transferMayExist && !opts.keepHelprFaultFee) await restoreHelprFaultFee(supabaseAdmin, job.helper_id, job.id, "release-payout");
 * @mutate supabase/functions/release-payout/index.ts |      return jsonResponse({ error: "could not read the Helpr's card-fee debt — retry. Nothing was moved." }, 500); |      console.error("ignored");
 * @mutate supabase/functions/process-scheduled-payouts/index.ts |           payoutCents = roundPayoutDownCents(unroundedPayoutCents - (owesOnboardingFee ? onboardingFeeCents : 0)) - helprFaultFeeCents; |           payoutCents = roundPayoutDownCents(unroundedPayoutCents - (owesOnboardingFee ? onboardingFeeCents : 0));
 * @mutate supabase/functions/process-scheduled-payouts/index.ts |           payoutCents = roundPayoutDownCents(unroundedPayoutCents - (owesOnboardingFee ? onboardingFeeCents : 0)) - helprFaultFeeCents; |           payoutCents = roundPayoutDownCents(unroundedPayoutCents - (owesOnboardingFee ? onboardingFeeCents : 0) - helprFaultFeeCents);
 * @mutate supabase/functions/process-scheduled-payouts/index.ts |          helperPayout = (roundPayoutDownCents(unroundedPayoutCents - (owesOnboardingFee ? onboardingFeeCents : 0)) - helprFaultFeeCents) / 100; |          helperPayout = helperPayout + 0;
 * @mutate supabase/functions/process-scheduled-payouts/index.ts |          continue;\n        }\n        if (take.cents > 0) { |        }\n        if (take.cents > 0) {
 * @mutate supabase/functions/_shared/money.ts |    ...(fault > 0 ? { helpr_fault_fee_cents: fault } : {}), |    ...({}),
 * @mutate supabase/functions/_shared/helprFaultFee.ts |  const v = roundPayoutDownCents(Number(unroundedAfterOtherFeesCents)) - 100; |  const v = roundPayoutDownCents(Number(unroundedAfterOtherFeesCents));
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock, PAYABLE_CONNECT_ACCOUNT } from "./mocks/stripe";
import { scenario, resetSupabaseMock, type SupabaseScenario } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

const CRON_SECRET = "cron-secret-xyz";

async function load(name: "release-payout" | "process-scheduled-payouts"): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc",
    CRON_SECRET,
  });
  return loadEdgeFunction(name);
}

function capturedCentsFor(job: Record<string, unknown>): number {
  return Math.round((Number(job.budget ?? 0) + Number(job.urgent_fee ?? 0)) * 100 * 1.12);
}

/** release-payout: $100 job, 12% free tier, onboarding fee already paid -> $88. */
function seedRelease(s: SupabaseScenario) {
  const job = {
    id: "job-1", title: "Mow the lawn", status: "completed", payment_status: "payout_pending",
    helper_id: "helper-1", customer_id: "poster-1", budget: 100, urgent_fee: 0,
    dispute_status: null, disputed_at: null, is_group_job: false, helpers_needed: null,
    stripe_payment_intent_id: "pi_1", stripe_session_id: null,
  };
  s.reads.jobs = { rows: [job] };
  s.reads.gift_cards = { rows: [] };
  s.rpc.restore_gift_card_for_job = { outcome: "would_restore", applied_cents: capturedCentsFor(job) };
  stripeMock.paymentIntents.retrieve.mockResolvedValue({
    id: "pi_1", status: "succeeded", amount: capturedCentsFor(job), amount_received: capturedCentsFor(job),
  });
  s.reads.profiles = { rows: [{ stripe_account_id: "acct_helper", full_name: "Helpful Helper", onboarding_fee_paid: true }] };
  s.reads.platform_settings = { rows: [{ helper_fee_percent: 10, onboarding_fee_cents: 200 }] };
  s.reads.payout_transfers = { rows: [] };
  stripeMock.accounts.retrieve.mockResolvedValue({ id: "acct_helper", payouts_enabled: true, charges_enabled: true, capabilities: { transfers: "active" } });
  stripeMock.transfers.create.mockResolvedValue({ id: "tr_1", transfer_group: "job_job-1" });
}

/** process-scheduled-payouts: $100 job, pro tier 10%, onboarding fee already paid. */
function seedScheduled(s: SupabaseScenario) {
  const job = {
    id: "job-1", title: "Mow the lawn", helper_id: "helper-1", customer_id: "poster-1", budget: 100,
    platform_fee_amount: 10, helper_fee_percent: 10, urgent_fee: 0, stripe_session_id: "cs_1",
    stripe_payment_intent_id: "pi_1", status: "completed", payment_status: "payout_pending",
    is_group_job: false, helpers_needed: 1, sales_tax_rate: 0,
  };
  s.reads.jobs = { rows: [job] };
  s.reads.platform_settings = { rows: [{ onboarding_fee_cents: 200 }] };
  s.reads.profiles = {
    rows: [{ stripe_account_id: "acct_helper", onboarding_fee_paid: true, subscription_tier: "pro", subscription_expires_at: null }],
  };
  s.reads.payout_transfers = { rows: [] };
  s.reads.user_roles = { rows: [] };
  s.writeSelectRows.profiles = [{ user_id: "helper-1" }];
  stripeMock.paymentIntents.retrieve.mockResolvedValue({
    id: "pi_1", status: "succeeded", latest_charge: "ch_1", amount: capturedCentsFor(job), amount_received: capturedCentsFor(job),
  });
  stripeMock.transfers.create.mockResolvedValue({ id: "tr_1" });
}

const takeCalls = () => (scenario.rpcCalls ?? []).filter((c) => c.name === "take_helpr_fault_fee");
const restoreCalls = () => (scenario.rpcCalls ?? []).filter((c) => c.name === "restore_helpr_fault_fee");
/** The un-claim of the one-time setup fee (profiles.onboarding_fee_paid back to false). */
const onboardingUnclaims = () =>
  scenario.writes.filter((w) => w.table === "profiles" && w.op === "update" && (w.payload as { onboarding_fee_paid?: unknown })?.onboarding_fee_paid === false);
/** The setup fee is still owed, and this payout wins the atomic claim. */
function owesSetupFee(s: SupabaseScenario) {
  s.reads.profiles = { rows: [{ ...(s.reads.profiles?.rows?.[0] as Record<string, unknown>), onboarding_fee_paid: false }] };
  s.writeSelectRows.profiles = [{ user_id: "helper-1" }];
}
/** Stripe holds a transfer for job-1 that payout_transfers does not record (the 'conflict' exit). */
function unrecordedTransferAtStripe() {
  stripeMock.transfers.list.mockResolvedValue({
    data: [{ id: "tr_orphan", amount: 8431, amount_reversed: 0, created: 1, destination: "acct_helper", transfer_group: "job_job-1", metadata: { job_id: "job-1" } }],
    has_more: false,
  });
}
const claimMeta = () =>
  (scenario.writes.find((w) => w.table === "payout_transfers" && w.op === "insert")?.payload as { metadata?: Record<string, unknown> } | undefined)?.metadata;
/** Q2172 (c): the stamp that records the taken fee on the fresh claim (an update carrying amount_cents and claim: true). */
const claimStamp = () =>
  scenario.writes.find((w) => w.table === "payout_transfers" && w.op === "update" &&
    (w.payload as { metadata?: { claim?: unknown } })?.metadata?.claim === true)?.payload as
    { amount_cents?: number; metadata?: Record<string, unknown> } | undefined;
const clampCalls = () => (scenario.rpcCalls ?? []).filter((c) => c.name === "clamp_helpr_fault_fee");
const claimInserted = () => scenario.writes.some((w) => w.table === "payout_transfers" && w.op === "insert");

describe("Q2082 (b): a Helpr-fault card fee comes out of the next payout", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock(); stripeMock.accounts.retrieve.mockResolvedValue(PAYABLE_CONNECT_ACCOUNT);
    resetSupabaseMock();
    resetSharedMocks();
    scenario.rpcCalls = [];
  });
  afterEach(() => {
    resetEnv();
  });

  describe("release-payout", () => {
    const run = async () => {
      const fn = await load("release-payout");
      return fn.fetch(fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: { job_id: "job-1" } }));
    };

    it("no debt: the payout is untouched and no fee line is written", async () => {
      seedRelease(scenario);
      const res = await run();
      expect(res.status).toBe(200);
      expect(stripeMock.transfers.create.mock.calls[0][0].amount).toBe(8800);
      expect(stripeMock.transfers.create.mock.calls[0][0].metadata.helpr_fault_fee_cents).toBe("0");
      expect(claimMeta()).not.toHaveProperty("helpr_fault_fee_cents");
    });

    it("withholds the debt (capped so $1 stays) and records it as its own line", async () => {
      seedRelease(scenario);
      scenario.rpc.take_helpr_fault_fee = 369;
      const res = await run();
      expect(res.status).toBe(200);
      expect(takeCalls()).toHaveLength(1);
      expect(takeCalls()[0].args).toEqual({ p_helper_id: "helper-1", p_payout_ref: "job_payout_job-1", p_max_cents: 8700 });
      // Q2165: $88 less EXACTLY 369c = 8431 (the old floor100(8800 - 369)
      // sent 8400: 400 withheld, 369 booked).
      expect(stripeMock.transfers.create.mock.calls[0][0].amount).toBe(8431);
      expect(stripeMock.transfers.create.mock.calls[0][0].metadata.helpr_fault_fee_cents).toBe("369");
      // Q2172 (c): the claim is written before the take, then stamped with what the transfer withholds.
      expect(claimMeta()).not.toHaveProperty("helpr_fault_fee_cents");
      expect(claimStamp()?.amount_cents).toBe(8431);
      expect(claimStamp()?.metadata).toEqual(expect.objectContaining({ helpr_fault_fee_cents: 369, rounding_remainder_cents: 0, onboarding_fee_cents: 0, claim: true }));
    });

    it("an unreadable debt pays nothing (fails closed)", async () => {
      seedRelease(scenario);
      scenario.rpcErrors = { take_helpr_fault_fee: { message: "connection reset" } };
      const res = await run();
      expect(res.status).toBe(500);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    });

    // Q2204: only a DEFINITE refusal (Stripe answered, no transfer exists) gives the debt back. A timeout may have
    // created the transfer with the fee held back; restored, the next payout would take the debt again.
    // @mutate supabase/functions/release-payout/index.ts | await rollBackOnboardingFeeClaim({ transferMayExist: !isDefiniteStripeRefusal(err) }); | await rollBackOnboardingFeeClaim();
    it("a transfer Stripe REFUSED gives the withheld debt back; a timed-out one keeps it (Q2204)", async () => {
      seedRelease(scenario);
      scenario.rpc.take_helpr_fault_fee = 369;
      stripeMock.transfers.create.mockRejectedValue(Object.assign(new Error("insufficient funds"), { type: "StripeInvalidRequestError" }));
      const res = await run();
      expect(res.status).toBe(502);
      expect(restoreCalls()).toHaveLength(1);
      expect(restoreCalls()[0].args).toEqual({ p_helper_id: "helper-1", p_job_id: "job-1" });

      resetStripeMock(); stripeMock.accounts.retrieve.mockResolvedValue(PAYABLE_CONNECT_ACCOUNT);
      resetSupabaseMock(); scenario.rpcCalls = [];
      seedRelease(scenario);
      scenario.rpc.take_helpr_fault_fee = 369;
      stripeMock.transfers.create.mockRejectedValue(Object.assign(new Error("Request timed out"), { type: "StripeConnectionError" }));
      const res2 = await run();
      expect(res2.status).toBe(502);
      expect(restoreCalls()).toHaveLength(0);
    });

    // Q2172 (a): a transfer at Stripe with no ledger row may be an earlier run's, sent with the deduction held back
    // (take_helpr_fault_fee answers per job). The refusal keeps the deduction.
    // Q2172 (c): that exit now comes before the claim, so this run took nothing and gives nothing back.
    // @mutate supabase/functions/release-payout/index.ts |    await rollBackOnboardingFeeClaim({ keepHelprFaultFee: true }); |    await rollBackOnboardingFeeClaim({ keepHelprFaultFee: true }); await restoreHelprFaultFee(supabaseAdmin, job.helper_id, job.id, "x");
    it("a transfer at Stripe with no ledger row: refused, and the deduction is kept (Q2172 a)", async () => {
      seedRelease(scenario);
      scenario.rpc.take_helpr_fault_fee = 369;
      unrecordedTransferAtStripe();
      expect((await run()).status).toBe(409);
      expect(takeCalls()).toHaveLength(0);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      expect(restoreCalls()).toHaveLength(0);
    });

    // Lead 11-02 (B151 handoff item 0): the one-time $2 setup fee is un-claimed ONLY on a definite refusal, the
    // same as Q2204. A timed-out transfer Stripe did create held the $2 back; un-claimed, the next payout takes it again.
    // @mutate supabase/functions/release-payout/index.ts |    if (onboardingFeeDeductedCents <= 0 \|\| opts.transferMayExist) return; |    if (onboardingFeeDeductedCents <= 0) return;
    it("a REFUSED transfer un-claims the $2 setup fee; a timed-out one keeps it claimed", async () => {
      seedRelease(scenario);
      owesSetupFee(scenario);
      stripeMock.transfers.create.mockRejectedValue(Object.assign(new Error("insufficient funds"), { type: "StripeInvalidRequestError" }));
      expect((await run()).status).toBe(502);
      expect(stripeMock.transfers.create.mock.calls[0][0].amount).toBe(8600);
      expect(onboardingUnclaims()).toHaveLength(1);

      resetStripeMock(); stripeMock.accounts.retrieve.mockResolvedValue(PAYABLE_CONNECT_ACCOUNT);
      resetSupabaseMock(); scenario.rpcCalls = [];
      seedRelease(scenario);
      owesSetupFee(scenario);
      stripeMock.transfers.create.mockRejectedValue(Object.assign(new Error("Request timed out"), { type: "StripeConnectionError" }));
      expect((await run()).status).toBe(502);
      expect(stripeMock.transfers.create.mock.calls[0][0].amount).toBe(8600);
      expect(onboardingUnclaims()).toHaveLength(0);
    });
  });

  describe("process-scheduled-payouts", () => {
    const run = async () => {
      const fn = await load("process-scheduled-payouts");
      return fn.fetch(fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }));
    };

    it("withholds the debt from the scheduled payout and records it", async () => {
      seedScheduled(scenario);
      const baseline = await run();
      expect(baseline.status).toBe(200);
      const fullCents = stripeMock.transfers.create.mock.calls[0][0].amount as number;
      expect(fullCents).toBeGreaterThan(1000);
      expect(stripeMock.transfers.create.mock.calls[0][0].metadata.helpr_fault_fee_cents).toBe("0");

      resetStripeMock(); stripeMock.accounts.retrieve.mockResolvedValue(PAYABLE_CONNECT_ACCOUNT);
      resetSupabaseMock();
      scenario.rpcCalls = [];
      seedScheduled(scenario);
      scenario.rpc.take_helpr_fault_fee = 369;
      const res = await run();
      expect(res.status).toBe(200);
      expect(takeCalls()).toHaveLength(1);
      expect(takeCalls()[0].args).toEqual(expect.objectContaining({ p_helper_id: "helper-1", p_payout_ref: "job_payout_job-1" }));
      const sent = stripeMock.transfers.create.mock.calls[0][0];
      // Q2165: the whole-dollar payout less EXACTLY the debt; the claim row,
      // the transfer and the Helpr's notice carry the same cents.
      expect(fullCents % 100).toBe(0);
      expect(sent.amount).toBe(fullCents - 369);
      expect(sent.metadata.helpr_fault_fee_cents).toBe("369");
      const claim = scenario.writes.find((w) => w.table === "payout_transfers" && w.op === "insert")?.payload as { amount_cents?: number } | undefined;
      expect(claim?.amount_cents).toBe(fullCents);
      expect(claimStamp()?.amount_cents).toBe(fullCents - 369);
      expect(claimStamp()?.metadata).toEqual(expect.objectContaining({ helpr_fault_fee_cents: 369, claim: true }));
      const note = scenario.writes.find((w) => w.table === "notifications" && JSON.stringify(w.payload).includes("Payout sent!"));
      expect(JSON.stringify(note?.payload)).toContain(`$${((fullCents - 369) / 100).toFixed(2)} for`);
    });

    it("an unreadable debt pays nothing (fails closed)", async () => {
      seedScheduled(scenario);
      scenario.rpcErrors = { take_helpr_fault_fee: { message: "connection reset" } };
      await run();
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    });

    // @mutate supabase/functions/process-scheduled-payouts/index.ts | await rollBackOnboardingFeeClaim({ transferMayExist: !isDefiniteStripeRefusal(e) }); | await rollBackOnboardingFeeClaim();
    it("a transfer Stripe REFUSED gives the withheld debt back; a timed-out one keeps it (Q2204)", async () => {
      seedScheduled(scenario);
      scenario.rpc.take_helpr_fault_fee = 369;
      stripeMock.transfers.create.mockRejectedValue(Object.assign(new Error("No such destination"), { type: "StripeInvalidRequestError" }));
      await run();
      expect(restoreCalls()).toHaveLength(1);

      resetStripeMock(); stripeMock.accounts.retrieve.mockResolvedValue(PAYABLE_CONNECT_ACCOUNT);
      resetSupabaseMock(); scenario.rpcCalls = [];
      seedScheduled(scenario);
      scenario.rpc.take_helpr_fault_fee = 369;
      stripeMock.transfers.create.mockRejectedValue(Object.assign(new Error("Request timed out"), { type: "StripeConnectionError" }));
      await run();
      expect(stripeMock.transfers.create).toHaveBeenCalled();
      expect(restoreCalls()).toHaveLength(0);
    });

    // @mutate supabase/functions/process-scheduled-payouts/index.ts |        await rollBackOnboardingFeeClaim({ keepHelprFaultFee: true }); |        await rollBackOnboardingFeeClaim({ keepHelprFaultFee: true }); await restoreHelprFaultFee(supabaseAdmin, helperId, job.id, "x");
    it("a transfer at Stripe with no ledger row: refused, and the deduction is kept (Q2172 a)", async () => {
      seedScheduled(scenario);
      scenario.rpc.take_helpr_fault_fee = 369;
      unrecordedTransferAtStripe();
      const res = await run();
      expect(JSON.stringify(await res.json())).toContain("unrecorded_transfer_at_stripe");
      expect(takeCalls()).toHaveLength(0);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      expect(restoreCalls()).toHaveLength(0);
    });

    // @mutate supabase/functions/process-scheduled-payouts/index.ts |        if (!owesOnboardingFee \|\| opts.transferMayExist) return; |        if (!owesOnboardingFee) return;
    it("a REFUSED transfer un-claims the $2 setup fee; a timed-out one keeps it claimed", async () => {
      seedScheduled(scenario);
      owesSetupFee(scenario);
      stripeMock.transfers.create.mockRejectedValue(Object.assign(new Error("No such destination"), { type: "StripeInvalidRequestError" }));
      await run();
      expect(stripeMock.transfers.create).toHaveBeenCalled();
      expect(onboardingUnclaims()).toHaveLength(1);

      resetStripeMock(); stripeMock.accounts.retrieve.mockResolvedValue(PAYABLE_CONNECT_ACCOUNT);
      resetSupabaseMock(); scenario.rpcCalls = [];
      seedScheduled(scenario);
      owesSetupFee(scenario);
      stripeMock.transfers.create.mockRejectedValue(Object.assign(new Error("Request timed out"), { type: "StripeConnectionError" }));
      await run();
      expect(stripeMock.transfers.create).toHaveBeenCalled();
      expect(onboardingUnclaims()).toHaveLength(0);
    });
  });


  // Q2172 (c)/(d), lead 11-02 (C1 + the clamp): the debt is taken only by a run that holds the claim; a run that
  // resumes or adopts another run's claim reads what it recorded and clamps the booking to it; a retry whose cap
  // shrank clamps instead of refusing forever.
  describe("Q2172 (c)/(d): take after the claim; a resumed claim reads its own record", () => {
    /** An orphaned claim (older than the in-flight window) another run left, recording `fee` withheld. */
    const orphanClaim = (fee: number | null, amount: number) => ({
      id: "claim-old", job_id: "job-1", helper_id: "helper-1", stripe_transfer_id: null, status: "pending",
      created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(), amount_cents: amount,
      metadata: fee === null ? { source: "release-payout", claim: true } : { source: "release-payout", claim: true, helpr_fault_fee_cents: fee },
    });
    const runRelease = async () => {
      const fn = await load("release-payout");
      return fn.fetch(fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: { job_id: "job-1" } }));
    };
    const runScheduled = async () => {
      const fn = await load("process-scheduled-payouts");
      return fn.fetch(fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }));
    };

    // @mutate supabase/functions/release-payout/index.ts |    const take = claim.resumed\n      ? await resumedClaimHelprFaultFee(supabaseAdmin, job.helper_id, job.id, claim.claimId)\n      : await takeHelprFaultFee( |    const take = false\n      ? await resumedClaimHelprFaultFee(supabaseAdmin, job.helper_id, job.id, claim.claimId)\n      : await takeHelprFaultFee(
    it("release-payout takes the debt only once its claim exists", async () => {
      seedRelease(scenario);
      let claimedFirst: boolean | null = null;
      scenario.rpc.take_helpr_fault_fee = () => { claimedFirst = claimInserted(); return 369; };
      expect((await runRelease()).status).toBe(200);
      expect(claimedFirst).toBe(true);
    });

    it("release-payout resuming a claim never takes again: it clamps to the claim's own 369 and sends what the claim recorded", async () => {
      seedRelease(scenario);
      scenario.reads.payout_transfers = { rows: [orphanClaim(369, 8431)] };
      scenario.rpc.take_helpr_fault_fee = 999; // a debt billed in between: must not be taken
      scenario.rpc.clamp_helpr_fault_fee = 369;
      expect((await runRelease()).status).toBe(200);
      expect(takeCalls()).toHaveLength(0);
      expect(clampCalls()).toHaveLength(1);
      expect(clampCalls()[0].args).toEqual({ p_helper_id: "helper-1", p_job_id: "job-1", p_cents: 369 });
      expect(stripeMock.transfers.create.mock.calls[0][0].amount).toBe(8431);
      expect(stripeMock.transfers.create.mock.calls[0][0].metadata.helpr_fault_fee_cents).toBe("369");
    });

    // @mutate supabase/functions/_shared/helprFaultFee.ts |  const raw = row.metadata?.helpr_fault_fee_cents ?? 0; |  const raw = row.metadata?.helpr_fault_fee_cents ?? 369;
    it("a resumed claim that recorded no fee clamps the booking to 0 (a bill in between is never read as collected)", async () => {
      seedRelease(scenario);
      scenario.reads.payout_transfers = { rows: [orphanClaim(null, 8800)] };
      scenario.rpc.take_helpr_fault_fee = 369;
      scenario.rpc.clamp_helpr_fault_fee = 0;
      expect((await runRelease()).status).toBe(200);
      expect(takeCalls()).toHaveLength(0);
      expect(clampCalls()[0].args).toEqual(expect.objectContaining({ p_cents: 0 }));
      expect(stripeMock.transfers.create.mock.calls[0][0].amount).toBe(8800);
    });

    // @mutate supabase/functions/_shared/helprFaultFee.ts |  if (clamped.cents !== stored) { |  if (clamped.cents > stored) {
    it("a resumed claim with fewer cents booked than it withholds pays nothing (fails closed)", async () => {
      seedRelease(scenario);
      scenario.reads.payout_transfers = { rows: [orphanClaim(369, 8431)] };
      scenario.rpc.clamp_helpr_fault_fee = 200;
      expect((await runRelease()).status).toBe(500);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    });

    // @mutate supabase/functions/_shared/helprFaultFee.ts |    return clampHelprFaultFee(supabaseAdmin, helperId, jobId, cap); |    return { error: "over cap" };
    it("(d) a retry whose cap shrank clamps to the current cap instead of refusing forever", async () => {
      seedRelease(scenario);
      scenario.rpc.take_helpr_fault_fee = 9000; // the first, larger answer
      scenario.rpc.clamp_helpr_fault_fee = 8700;
      expect((await runRelease()).status).toBe(200);
      expect(clampCalls()[0].args).toEqual({ p_helper_id: "helper-1", p_job_id: "job-1", p_cents: 8700 });
      expect(stripeMock.transfers.create.mock.calls[0][0].amount).toBe(100);
    });

    // @mutate supabase/functions/_shared/helprFaultFee.ts |  await restoreHelprFaultFee(supabaseAdmin, helperId, jobId, source);\n} |  void restoreHelprFaultFee;\n}
    it("a fee that cannot be stamped on the claim: the claim is released, the deduction given back, nothing sent", async () => {
      seedRelease(scenario);
      scenario.rpc.take_helpr_fault_fee = 369;
      scenario.writeOverrides = [{
        table: "payout_transfers", op: "update",
        when: (p) => (p as { metadata?: { claim?: unknown } }).metadata?.claim === true && p.amount_cents !== undefined,
        rows: [],
      }];
      expect((await runRelease()).status).toBe(500);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      const released = scenario.writes.find((w) => w.table === "payout_transfers" && w.op === "update" && (w.payload as { status?: string }).status === "canceled");
      expect(released).toBeTruthy();
      expect(restoreCalls()).toHaveLength(1);
    });

    // @mutate supabase/functions/process-scheduled-payouts/index.ts |        const take = claim.resumed\n          ? await resumedClaimHelprFaultFee(supabaseAdmin, helperId, job.id, claim.claimId) |        const take = false\n          ? await resumedClaimHelprFaultFee(supabaseAdmin, helperId, job.id, claim.claimId)
    it("process-scheduled-payouts: takes after its claim, and a resumed claim clamps to its record instead", async () => {
      seedScheduled(scenario);
      let claimedFirst: boolean | null = null;
      scenario.rpc.take_helpr_fault_fee = () => { claimedFirst = claimInserted(); return 369; };
      await runScheduled();
      expect(claimedFirst).toBe(true);
      const fullCents = (stripeMock.transfers.create.mock.calls[0][0].amount as number) + 369;

      resetStripeMock(); stripeMock.accounts.retrieve.mockResolvedValue(PAYABLE_CONNECT_ACCOUNT);
      resetSupabaseMock(); scenario.rpcCalls = [];
      seedScheduled(scenario);
      scenario.reads.payout_transfers = { rows: [orphanClaim(250, fullCents - 250)] };
      scenario.rpc.take_helpr_fault_fee = 999;
      scenario.rpc.clamp_helpr_fault_fee = 250;
      await runScheduled();
      expect(takeCalls()).toHaveLength(0);
      expect(clampCalls()[0].args).toEqual(expect.objectContaining({ p_cents: 250 }));
      expect(stripeMock.transfers.create.mock.calls[0][0].amount).toBe(fullCents - 250);
    });
  });

  it("inventory floor: every single-Helpr payout path takes the debt", async () => {
    const { readFileSync } = await import("node:fs");
    const { blankComments } = await import("../helpers/blankNonCode");
    // release-payout, the scheduled sweep, the Quick Release (create-payment
    // transferToHelper) and the decided split's Helpr leg (execute-dispute-split).
    const files = [
      "supabase/functions/release-payout/index.ts",
      "supabase/functions/process-scheduled-payouts/index.ts",
      "supabase/functions/create-payment/index.ts",
      "supabase/functions/execute-dispute-split/index.ts",
    ];
    const n = files.filter((f) => /takeHelprFaultFee\(/.test(blankComments(readFileSync(f, "utf8")))).length;
    expect(n).toBe(files.length);
    expect(n).toBeGreaterThan(3);
  });

  // The earnings export adds the withheld fee back, so its gross is what the
  // Helpr earned (NEWEST get_helper_earnings_export; PGlite proof:
  // src/test/pglite/helprFaultEarningsExport.pglite.mjs).
  // @mutate supabase/migrations/20261102152453_q2083_job_tax_kind.sql | this payout kept back.\n                        + GREATEST(0, COALESCE((p.metadata->>'helpr_fault_fee_cents')::bigint, 0)) | this payout kept back.\n                        + 0
  it("the earnings export adds the Helpr-fault fee back in both ledger laterals", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { blankSqlComments } = await import("../helpers/blankNonCode");
    const dir = "supabase/migrations";
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    let newest = "";
    for (const f of files) {
      const sql = blankSqlComments(readFileSync(`${dir}/${f}`, "utf8"));
      const m = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.get_helper_earnings_export\s*\([\s\S]*?\bAS\s+(\$\w*\$)([\s\S]*?)\1/i.exec(sql);
      if (m) newest = m[2];
    }
    expect(newest.length).toBeGreaterThan(1000);
    const hits = newest.match(/metadata->>'helpr_fault_fee_cents'/g) ?? [];
    expect(hits.length).toBe(2);
  });
});
