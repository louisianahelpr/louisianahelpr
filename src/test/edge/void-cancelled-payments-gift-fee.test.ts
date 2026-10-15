/**
 * Q1806: a FULLY gift-funded job has no PaymentIntent, so a late cancellation
 * settles on void-cancelled-payments' "no payment found" branch. That branch
 * priced the Helpr's (or the crew's) late-cancellation fee and then dropped it:
 * the whole gift came back to the poster and nobody paid the fee. Parts D/E
 * could not retry it either, because both skip a job with no PaymentIntent and
 * only read 'refunded' jobs.
 *
 * Money-path properties proved here, on the REAL function source:
 *   - the fee is put on its ledger and sent BEFORE the gift is restored, from
 *     the platform balance the gift paid into (no source_transaction);
 *   - the gift comes back LESS the fee (never a cent of it), and the poster's
 *     notice says what the gift paid;
 *   - the job is marked charged with the fee, so Parts D/E retry a fee that
 *     could not go yet, on the 'cancelled' job with no PaymentIntent;
 *   - no gift and no card: no fee is paid from the platform's own money;
 *   - an unreadable gift, a failed ledger claim, or a gift smaller than the
 *     fees settles nothing (fails closed);
 *   - a gift an earlier run gave back WHOLE funds no fee (already_restored),
 *     and neither does a gift whose donation was refunded or charged back:
 *     the job settles without the fee and a person is told (review #1, #6);
 *   - a re-run after "fee paid, restore failed" pays nothing twice.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";

const CRON_SECRET = "cron-secret-void-gift-fee";

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_void",
    CRON_SECRET,
  });
  return loadEdgeFunction("void-cancelled-payments");
}

const cronReq = () =>
  new Request("https://x/functions/v1/void-cancelled-payments", {
    method: "POST",
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });

/** $300 single-Helpr job, paid in full by a $330 gift, cancelled 1 hour before a 10:00 Central start: 50%, a $150 fee. */
const giftJob = (over: Record<string, unknown> = {}) => ({
  id: "job-1",
  title: "Mow the lawn",
  stripe_session_id: null,
  stripe_payment_intent_id: null,
  budget: 300,
  customer_fee_amount: 30,
  cancellation_fee: 150,
  date_needed: "2024-06-25",
  start_time: "10:00:00",
  cancelled_at: "2024-06-25T14:00:00Z",
  helper_id: "helper-1",
  helper_confirmed_at: "2024-06-20T00:00:00Z",
  customer_id: "poster-1",
  helper_fee_percent: 10,
  is_group_job: false,
  helpers_needed: 1,
  parent_job_id: null,
  recurrence_days: null,
  ...over,
});

const APPLIED = 33000;
const FEE = 15000;

/** The gift RPC: a dry run reports what the gift paid; a mint restores applied * bps. */
function giftRpc(dry: Record<string, unknown> = { outcome: "would_restore", credit_id: "gift-1", applied_cents: APPLIED, restore_cents: APPLIED }) {
  scenario.rpc.restore_gift_card_for_job = (args?: unknown) => {
    const a = (args ?? {}) as { p_dry_run?: boolean; p_share_bps?: number };
    if (a.p_dry_run) return dry;
    if (dry.outcome !== "would_restore") return dry;
    const bps = a.p_share_bps ?? 10000;
    return { outcome: "restored", credit_id: "gift-2", recipient_id: "poster-1", applied_cents: APPLIED, restore_cents: Math.floor((APPLIED * bps) / 10000) };
  };
}

function seedSingle(job = giftJob()) {
  scenario.reads.jobs = {
    selectOverrides: [
      { includes: "cancelled_at", result: { rows: [job] } },
      { includes: "cancellation_fee_status", result: { rows: [] } },
    ],
    rows: [],
  };
  scenario.reads.cancellation_fee_transfers = {
    selectOverrides: [
      { includes: "job_id, helper_id, fee_amount", result: { rows: [] } },
      { includes: "commission_percent", result: { rows: [] } },
    ],
    rows: [],
  };
  scenario.writeSelectRows["cancellation_fee_transfers:insert"] = [{
    id: "fee-1", job_id: "job-1", helper_id: "helper-1", status: "pending", stripe_transfer_id: null,
    created_at: new Date().toISOString(), fee_amount: 150, commission_percent: 12, platform_cut: 18, helper_amount: 132,
  }];
  scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_helper", subscription_tier: null }] };
  stripeMock.transfers.create.mockResolvedValue({ id: "tr_fee" });
  // The spent gift row giftFeeFunding reads: its donation is paid.
  scenario.reads.gift_cards = { rows: [{ payment_status: "paid" }] };
  giftRpc();
}

const restoreCalls = () =>
  (scenario.rpcCalls ?? []).filter((c) => c.name === "restore_gift_card_for_job").map((c) => c.args as Record<string, unknown>);
const mints = () => restoreCalls().filter((c) => !c.p_dry_run);
const restoredCents = () => {
  const m = mints()[0];
  return m ? Math.floor((APPLIED * Number(m.p_share_bps ?? 10000)) / 10000) : null;
};
const feeTransferCalls = () =>
  stripeMock.transfers.create.mock.calls.filter(([p]) => (p as { metadata?: { type?: string } }).metadata?.type === "cancellation_fee");
const jobSettles = () =>
  scenario.writes.filter((w) => w.table === "jobs" && w.op === "update" && "payment_status" in (w.payload as Record<string, unknown>));

describe("void-cancelled-payments: a fully gift-funded job's late-cancellation fee is paid from the gift (Q1806)", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetStripeMock();
    resetSharedMocks();
  });

  // @mutate supabase/functions/void-cancelled-payments/index.ts |         if (giftFeeCents > 0 && !(await payCancellationFee(jobCancellationFee, null))) { |         if (false) {
  // @mutate supabase/functions/void-cancelled-payments/index.ts |           giftFeeCents + giftBlockCents, |           giftBlockCents,
  it("pays the Helpr's fee first from the platform balance, then restores the gift less the fee", async () => {
    seedSingle();
    let mintsAtTransfer = -1;
    stripeMock.transfers.create.mockImplementation(async () => {
      mintsAtTransfer = mints().length;
      return { id: "tr_fee" };
    });
    const h = await load();
    await h.fetch(cronReq());

    const calls = feeTransferCalls();
    expect(calls).toHaveLength(1);
    const params = calls[0][0] as Record<string, unknown> & { amount: number; metadata: Record<string, unknown> };
    // $150 less the 12% free-tier commission, whole dollars: $132.
    expect(params.amount).toBe(13200);
    expect(params.metadata).toMatchObject({ type: "cancellation_fee", job_id: "job-1", helper_id: "helper-1", fee_transfer_id: "fee-1" });
    // No card was charged, so there is no charge to link.
    expect(params.source_transaction).toBeUndefined();
    // Sent before the gift was given back.
    expect(mintsAtTransfer).toBe(0);
    // The gift comes back less the $150, never a cent of it.
    expect(restoredCents()).toBeLessThanOrEqual(APPLIED - FEE);
    expect(restoredCents()).toBeGreaterThan(APPLIED - FEE - 5);
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled();
  });

  // @mutate supabase/functions/void-cancelled-payments/index.ts |             ? { payment_status: "cancelled", cancellation_fee_status: "charged", cancellation_fee: jobCancellationFee } |             ? { payment_status: "cancelled" }
  it("marks the job charged with the fee, so Part E can retry a fee that could not go yet", async () => {
    seedSingle();
    const h = await load();
    await h.fetch(cronReq());
    const settles = jobSettles();
    expect(settles).toHaveLength(1);
    expect(settles[0].payload).toEqual({ payment_status: "cancelled", cancellation_fee_status: "charged", cancellation_fee: 150 });
  });

  // @mutate supabase/functions/void-cancelled-payments/index.ts |           giftFeeCents > 0 ? `the cancellation fee for your ${crewShares ? "crew" : "Helpr"}` : null, |           null,
  it("the poster's gift notice says the gift paid the Helpr's cancellation fee", async () => {
    seedSingle();
    const h = await load();
    await h.fetch(cronReq());
    const note = scenario.writes.find((w) => w.table === "notifications" && (w.payload as Record<string, unknown>).title === "Your gift is back");
    expect(String((note?.payload as Record<string, unknown>)?.message)).toMatch(/\$150 of it paid the cancellation fee for your Helpr\./);
  });

  // @mutate supabase/functions/void-cancelled-payments/index.ts |           if (funding.cents === 0 && !funding.restored) { |           if (false) {
  it("no gift and no card: no fee is paid from the platform's own money, and the job settles as before", async () => {
    seedSingle();
    giftRpc({ outcome: "no_credit" });
    const h = await load();
    await h.fetch(cronReq());
    expect(feeTransferCalls()).toHaveLength(0);
    expect(scenario.writes.filter((w) => w.table === "cancellation_fee_transfers")).toHaveLength(0);
    expect(jobSettles().map((w) => w.payload)).toEqual([{ payment_status: "cancelled" }]);
  });

  // @mutate supabase/functions/void-cancelled-payments/index.ts |           if (funding === null) { |           if (false) {
  it("an unreadable gift settles nothing this run (fails closed)", async () => {
    seedSingle();
    scenario.rpcErrors = { restore_gift_card_for_job: { message: "boom" } };
    const h = await load();
    const res = await h.fetch(cronReq());
    expect(feeTransferCalls()).toHaveLength(0);
    expect(mints()).toEqual([]);
    expect(jobSettles()).toHaveLength(0);
    // Named as unreadable (a defect), never mistaken for a gift too small.
    const body = (await res.json()) as { results?: Array<{ status?: string }>; defectReasons?: string[] };
    expect(body.results?.map((r) => r.status)).toEqual(["gift_fee_funding_unreadable"]);
    expect((body.defectReasons ?? []).some((r) => /gift fee funding read job-1/.test(r))).toBe(true);
    expect((slackAlerts as Array<{ title: string }>).some((a) => /owes more in fees/.test(String(a.title)))).toBe(false);
  });

  // @mutate supabase/functions/void-cancelled-payments/index.ts |           } else if (funding.cents < giftFeeCents + blockCentsNow) { |           } else if (false) {
  it("a gift smaller than the fee settles nothing and pages, never paying the gap from the platform", async () => {
    seedSingle();
    giftRpc({ outcome: "would_restore", credit_id: "gift-1", applied_cents: 10000, restore_cents: 10000 });
    const h = await load();
    await h.fetch(cronReq());
    expect(feeTransferCalls()).toHaveLength(0);
    expect(jobSettles()).toHaveLength(0);
    expect((slackAlerts as Array<{ title: string }>).some((a) => /owes more in fees than its gift paid/.test(String(a.title)))).toBe(true);
  });

  // @mutate supabase/functions/void-cancelled-payments/index.ts |           return false;\n        }\n        row = claimed as FeeRow; |           return true;\n        }\n        row = claimed as FeeRow;
  it("a failed ledger claim keeps the job in escrow: the gift is not restored and nothing settles", async () => {
    seedSingle();
    scenario.writeErrors.cancellation_fee_transfers = { message: "permission denied", code: "42501" };
    const h = await load();
    await h.fetch(cronReq());
    expect(feeTransferCalls()).toHaveLength(0);
    expect(mints()).toEqual([]);
    expect(jobSettles()).toHaveLength(0);
  });

  // @mutate supabase/functions/void-cancelled-payments/index.ts |           : Math.max(0, Math.floor(Number(d.applied_cents)) - Math.floor(Number(d.restore_cents ?? 0))); |           : Math.max(0, Math.floor(Number(d.applied_cents)));
  it("a gift an earlier run gave back WHOLE funds no fee (already_restored)", async () => {
    seedSingle();
    giftRpc({ outcome: "already_restored", credit_id: "gift-2", applied_cents: APPLIED, restore_cents: APPLIED });
    const h = await load();
    await h.fetch(cronReq());
    expect(feeTransferCalls()).toHaveLength(0);
    // Settled without the fee (the gift is already back), never stuck in escrow, and a person is told.
    // @mutate supabase/functions/void-cancelled-payments/index.ts |           } else if (funding.donationReversed \|\| (funding.restored && funding.cents < giftFeeCents + blockCentsNow)) { |           } else if (funding.donationReversed) {
    expect(jobSettles().map((w) => w.payload)).toEqual([{ payment_status: "cancelled" }]);
    expect((slackAlerts as Array<{ title: string }>).some((a) => /Cancellation fee not paid on a gift-funded job/.test(String(a.title)))).toBe(true);
  });

  // Review of Q1806 #1: revoke_gift_card_for_refund keeps a spent gift 'redeemed'
  // and flips its payment_status; the dry run still values it.
  // @mutate supabase/functions/void-cancelled-payments/index.ts |       return { cents, restored, donationReversed: spentRow.payment_status !== "paid" }; |       return { cents, restored, donationReversed: false };
  it("a gift whose donation was refunded funds no fee: no transfer, settled without the fee, a person is told", async () => {
    seedSingle();
    scenario.reads.gift_cards = { rows: [{ payment_status: "refunded" }] };
    const h = await load();
    await h.fetch(cronReq());
    expect(feeTransferCalls()).toHaveLength(0);
    expect(scenario.writes.filter((w) => w.table === "cancellation_fee_transfers")).toHaveLength(0);
    expect(jobSettles().map((w) => w.payload)).toEqual([{ payment_status: "cancelled" }]);
    expect((slackAlerts as Array<{ title: string }>).some((a) => /Cancellation fee not paid on a gift-funded job/.test(String(a.title)))).toBe(true);
  });

  // @mutate supabase/functions/void-cancelled-payments/index.ts |       if (!spentRow) return null; |       if (!spentRow) return { cents, restored, donationReversed: false };
  it("no spent gift row back settles nothing this run (fails closed, re-review nit 1)", async () => {
    seedSingle();
    scenario.reads.gift_cards = { rows: [] };
    const h = await load();
    await h.fetch(cronReq());
    expect(feeTransferCalls()).toHaveLength(0);
    expect(mints()).toEqual([]);
    expect(jobSettles()).toHaveLength(0);
  });

  it("an unreadable gift row settles nothing this run (fails closed)", async () => {
    seedSingle();
    scenario.reads.gift_cards = { error: { message: "gift read boom" } } as never;
    const h = await load();
    await h.fetch(cronReq());
    expect(feeTransferCalls()).toHaveLength(0);
    expect(mints()).toEqual([]);
    expect(jobSettles()).toHaveLength(0);
  });

  it("a re-run after 'fee paid, restore failed' sends nothing twice and restores the gift less the fee", async () => {
    seedSingle();
    scenario.reads.cancellation_fee_transfers = {
      selectOverrides: [
        { includes: "job_id, helper_id, fee_amount", result: { rows: [] } },
        { includes: "commission_percent", result: { rows: [{
          id: "fee-1", job_id: "job-1", helper_id: "helper-1", status: "paid", stripe_transfer_id: "tr_fee",
          created_at: "2024-06-25T15:00:00Z", fee_amount: 150, commission_percent: 12, platform_cut: 18, helper_amount: 132,
        }] } },
      ],
      rows: [],
    };
    const h = await load();
    await h.fetch(cronReq());
    expect(feeTransferCalls()).toHaveLength(0);
    expect(scenario.writes.filter((w) => w.table === "cancellation_fee_transfers")).toHaveLength(0);
    expect(restoredCents()).toBeLessThanOrEqual(APPLIED - FEE);
    expect(jobSettles().map((w) => w.payload)).toEqual([{ payment_status: "cancelled", cancellation_fee_status: "charged", cancellation_fee: 150 }]);
  });

  it("a gift an earlier run restored LESS the fee (flip failed) pays the fee and settles charged", async () => {
    seedSingle();
    giftRpc({ outcome: "already_restored", credit_id: "gift-2", applied_cents: APPLIED, restore_cents: APPLIED - FEE });
    const h = await load();
    await h.fetch(cronReq());
    expect(feeTransferCalls()).toHaveLength(1);
    expect(jobSettles().map((w) => w.payload)).toEqual([{ payment_status: "cancelled", cancellation_fee_status: "charged", cancellation_fee: 150 }]);
  });

  it("a fee of $0 (cancelled 24h+ out) restores the whole gift exactly as before", async () => {
    seedSingle(giftJob({ cancelled_at: "2024-06-23T14:00:00Z", cancellation_fee: 0 }));
    const h = await load();
    await h.fetch(cronReq());
    expect(feeTransferCalls()).toHaveLength(0);
    expect(restoreCalls()).toEqual([{ p_job_id: "job-1" }]);
    expect(jobSettles().map((w) => w.payload)).toEqual([{ payment_status: "cancelled" }]);
  });
});

describe("void-cancelled-payments: a fully gift-funded CREW's fee shares are paid from the gift (Q1806)", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetStripeMock();
    resetSharedMocks();
  });

  const MEMBERS = ["member-a", "member-b", "member-c"];
  function seedCrew() {
    scenario.reads.jobs = {
      selectOverrides: [
        { includes: "cancelled_at", result: { rows: [giftJob({ id: "job-crew", title: "Move a piano", helper_id: null, helper_confirmed_at: null, is_group_job: true, helpers_needed: 3 })] } },
        { includes: "cancellation_fee_status", result: { rows: [] } },
      ],
      rows: [],
    };
    scenario.reads.crew_cancellation_fee_shares = {
      rows: MEMBERS.map((m, i) => ({
        id: `share-${i + 1}`, helper_id: m, committed: true, share_basis_cents: 10000, share_amount: "50.00", status: "pending", stripe_transfer_id: null,
      })),
    };
    scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_member", subscription_tier: null }] };
    stripeMock.transfers.create.mockImplementation(async (params: { metadata: { helper_id: string } }) => ({ id: `tr_${params.metadata.helper_id}` }));
    scenario.reads.gift_cards = { rows: [{ payment_status: "paid" }] };
    giftRpc();
  }

  // @mutate supabase/functions/void-cancelled-payments/index.ts |       pi: Stripe.PaymentIntent \| null,\n      /** The client of this job's Stripe mode (owner 2026-10-12). */\n      stripe: Stripe,\n    ) => {\n      const owed = | pi: Stripe.PaymentIntent \| null,\n      /** The client of this job's Stripe mode (owner 2026-10-12). */\n      stripe: Stripe,\n    ) => {\n      if (!pi) return;\n      const owed =
  it("pays every member their share from the platform balance and restores the gift less the $150", async () => {
    seedCrew();
    const h = await load();
    await h.fetch(cronReq());
    const calls = feeTransferCalls();
    expect(calls.map(([p]) => (p as { metadata: { helper_id: string } }).metadata.helper_id)).toEqual(MEMBERS);
    for (const [p] of calls) {
      expect((p as { amount: number }).amount).toBe(4400);
      expect((p as Record<string, unknown>).source_transaction).toBeUndefined();
    }
    expect(restoredCents()).toBeLessThanOrEqual(APPLIED - FEE);
    expect(restoredCents()).toBeGreaterThan(APPLIED - FEE - 5);
    expect(jobSettles().map((w) => w.payload)).toEqual([{ payment_status: "cancelled", cancellation_fee_status: "charged", cancellation_fee: 150 }]);
    const note = scenario.writes.find((w) => w.table === "notifications" && (w.payload as Record<string, unknown>).title === "Your gift is back");
    expect(String((note?.payload as Record<string, unknown>)?.message)).toMatch(/\$150 of it paid the cancellation fee for your crew\./);
  });

  it("the crew's fee AND a block fee are both kept from the gift, and the notice names both", async () => {
    seedCrew();
    scenario.reads.crew_block_fees = { rows: [{ id: "bf-1", job_id: "job-crew", helper_id: "member-d", slot_no: 3, share_basis_cents: 10000, fee_percent: 25, fee_cents: 2500, status: "owed", stripe_transfer_id: null }] };
    const h = await load();
    await h.fetch(cronReq());
    expect(feeTransferCalls()).toHaveLength(3);
    expect(restoredCents()).toBeLessThanOrEqual(APPLIED - FEE - 2500);
    expect(restoredCents()).toBeGreaterThan(APPLIED - FEE - 2500 - 5);
    const note = scenario.writes.find((w) => w.table === "notifications" && (w.payload as Record<string, unknown>).title === "Your gift is back");
    expect(String((note?.payload as Record<string, unknown>)?.message)).toMatch(/\$175 of it paid the cancellation fee for your crew and the cancellation fee for the crew spots you closed\./);
  });
});

describe("void-cancelled-payments: Parts D/E retry a gift-funded job's fee with no PaymentIntent (Q1806)", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetStripeMock();
    resetSharedMocks();
  });

  const settledGiftJob = (id: string, title: string) => ({
    id, title, helper_fee_percent: 10, payment_status: "cancelled", cancellation_fee_status: "charged", stripe_payment_intent_id: null,
  });
  const settledQueryStatus = () =>
    (scenario.readQueries ?? [])
      .filter((q) => q.table === "jobs" && q.filters.some((f) => f.column === "cancellation_fee_status"))
      .map((q) => q.filters.find((f) => f.column === "payment_status")?.value);

  // @mutate supabase/functions/void-cancelled-payments/index.ts |         if (job.payment_status === "cancelled" ? !!job.stripe_payment_intent_id : !job.stripe_payment_intent_id) {\n          defects.record(`cancellation fee retry | if (!job.stripe_payment_intent_id) {\n          defects.record(`cancellation fee retry
  it("Part E pays a failed single-Helpr fee on a 'cancelled' gift job from the platform balance", async () => {
    const failed = {
      id: "fee-1", job_id: "job-1", helper_id: "helper-1", status: "failed", stripe_transfer_id: null,
      created_at: "2024-06-25T15:00:00Z", fee_amount: 150, commission_percent: 12, platform_cut: 18, helper_amount: 132,
    };
    scenario.reads.jobs = {
      selectOverrides: [
        { includes: "cancelled_at", result: { rows: [] } },
        { includes: "cancellation_fee_status", result: { rows: [settledGiftJob("job-1", "Mow the lawn")] } },
      ],
      rows: [],
    };
    scenario.reads.cancellation_fee_transfers = {
      selectOverrides: [
        { includes: "job_id, helper_id, fee_amount", result: { rows: [failed] } },
        { includes: "commission_percent", result: { rows: [failed] } },
      ],
      rows: [],
    };
    scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_helper", subscription_tier: null }] };
    stripeMock.transfers.create.mockResolvedValue({ id: "tr_fee" });
    const h = await load();
    await h.fetch(cronReq());
    const calls = feeTransferCalls();
    expect(calls).toHaveLength(1);
    expect((calls[0][0] as { amount: number }).amount).toBe(13200);
    expect((calls[0][0] as Record<string, unknown>).source_transaction).toBeUndefined();
    expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled();
    // The settled-job sweep reads 'cancelled' (gift-funded) jobs as well as 'refunded' ones.
    // @mutate supabase/functions/void-cancelled-payments/index.ts |           .in("payment_status", ["refunded", "cancelled"])\n          .eq("cancellation_fee_status", "charged");\n        if (feeJobsErr) { |           .in("payment_status", ["refunded"])\n          .eq("cancellation_fee_status", "charged");\n        if (feeJobsErr) {
    expect(settledQueryStatus()).toContainEqual(["refunded", "cancelled"]);
  });

  // @mutate supabase/functions/void-cancelled-payments/index.ts |         if (job.payment_status === "cancelled" ? !!job.stripe_payment_intent_id : !job.stripe_payment_intent_id) {\n          defects.record(`crew share retry | if (!job.stripe_payment_intent_id) {\n          defects.record(`crew share retry
  // @mutate supabase/functions/void-cancelled-payments/index.ts |           .in("payment_status", ["refunded", "cancelled"])\n          .eq("cancellation_fee_status", "charged");\n        if (settledErr) { |           .in("payment_status", ["refunded"])\n          .eq("cancellation_fee_status", "charged");\n        if (settledErr) {
  it("Part D pays a failed crew share on a 'cancelled' gift crew from the platform balance", async () => {
    scenario.reads.jobs = {
      selectOverrides: [
        { includes: "cancelled_at", result: { rows: [] } },
        { includes: "cancellation_fee_status", result: { rows: [settledGiftJob("job-crew", "Move a piano")] } },
      ],
      rows: [],
    };
    scenario.reads.crew_cancellation_fee_shares = {
      rows: [{ id: "share-2", job_id: "job-crew", helper_id: "member-b", committed: true, share_basis_cents: 10000, share_amount: "50.00", status: "failed", stripe_transfer_id: null }],
    };
    scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_member", subscription_tier: null }] };
    stripeMock.transfers.create.mockImplementation(async (params: { metadata: { helper_id: string } }) => ({ id: `tr_${params.metadata.helper_id}` }));
    const h = await load();
    await h.fetch(cronReq());
    const calls = feeTransferCalls();
    expect(calls).toHaveLength(1);
    expect((calls[0][0] as { amount: number }).amount).toBe(4400);
    expect((calls[0][0] as Record<string, unknown>).source_transaction).toBeUndefined();
    expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(settledQueryStatus()).toContainEqual(["refunded", "cancelled"]);
  });

  // Review of Q1806 #5: a 'cancelled' job WITH a PaymentIntent is a voided hold.
  // @mutate supabase/functions/void-cancelled-payments/index.ts |         if (job.payment_status === "cancelled" ? !!job.stripe_payment_intent_id : !job.stripe_payment_intent_id) {\n          defects.record(`cancellation fee retry | if (!job.stripe_payment_intent_id && job.payment_status !== "cancelled") {\n          defects.record(`cancellation fee retry
  it("a 'cancelled' job WITH a PaymentIntent (a voided hold) is refused, never paid from the platform balance", async () => {
    const failed = {
      id: "fee-1", job_id: "job-1", helper_id: "helper-1", status: "failed", stripe_transfer_id: null,
      created_at: "2024-06-25T15:00:00Z", fee_amount: 150, commission_percent: 12, platform_cut: 18, helper_amount: 132,
    };
    scenario.reads.jobs = {
      selectOverrides: [
        { includes: "cancelled_at", result: { rows: [] } },
        { includes: "cancellation_fee_status", result: { rows: [{ ...settledGiftJob("job-1", "Mow the lawn"), stripe_payment_intent_id: "pi_void" }] } },
      ],
      rows: [],
    };
    scenario.reads.cancellation_fee_transfers = {
      selectOverrides: [
        { includes: "job_id, helper_id, fee_amount", result: { rows: [failed] } },
        { includes: "commission_percent", result: { rows: [failed] } },
      ],
      rows: [],
    };
    scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_helper", subscription_tier: null }] };
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_void", status: "canceled", latest_charge: null });
    stripeMock.transfers.create.mockResolvedValue({ id: "tr_fee" });
    const h = await load();
    await h.fetch(cronReq());
    expect(feeTransferCalls()).toHaveLength(0);
  });

  it("a 'refunded' job with no PaymentIntent is still refused (nothing behind the fee)", async () => {
    const failed = {
      id: "fee-1", job_id: "job-1", helper_id: "helper-1", status: "failed", stripe_transfer_id: null,
      created_at: "2024-06-25T15:00:00Z", fee_amount: 150, commission_percent: 12, platform_cut: 18, helper_amount: 132,
    };
    scenario.reads.jobs = {
      selectOverrides: [
        { includes: "cancelled_at", result: { rows: [] } },
        { includes: "cancellation_fee_status", result: { rows: [{ ...settledGiftJob("job-1", "Mow the lawn"), payment_status: "refunded" }] } },
      ],
      rows: [],
    };
    scenario.reads.cancellation_fee_transfers = {
      selectOverrides: [
        { includes: "job_id, helper_id, fee_amount", result: { rows: [failed] } },
        { includes: "commission_percent", result: { rows: [failed] } },
      ],
      rows: [],
    };
    const h = await load();
    await h.fetch(cronReq());
    expect(feeTransferCalls()).toHaveLength(0);
  });
});
