/**
 * Q1915 (owner decided 2026-10-21): when a crew member's account is deleted,
 * their share of a late-cancellation fee goes BACK TO THE POSTER, on both the
 * card and the gift paths, and the alert carries a oncePerDayKey.
 *
 * Before: crewCancellationFee totalled every share, including one whose
 * member was deleted (helper_id NULL), so the poster was charged it; then
 * payCrewCancellationFees only alerted on that share (paid to nobody), and
 * Part D re-alerted it every run with no oncePerDayKey.
 *
 * Money-path properties proved here, on the REAL function source:
 *   - a share leaves the fee only once it is 'void' (returnsToPoster);
 *   - before any money moved (Part A), a deleted member's unpaid share is
 *     voided FIRST: the card refund includes it, and a gift-funded crew's gift
 *     keeps none of it; every share gone means no fee is stamped at all;
 *   - Part A never voids once a cancel refund is on the ledger (the share was
 *     withheld from it; Part D returns it), nor over a transfer Stripe already
 *     shows for the share (lh-money-escrow review #1, #2);
 *   - a share PAID before its member was deleted still counts;
 *   - after the job settled (Part D), the card path refunds the share plus the
 *     sales tax kept on it, once (a refund Stripe shows is not repeated; a
 *     failed one is retried under a new key; a refund that did not go through
 *     never voids the share), records it on payment_refunds, voids it,
 *     restates the job's fee from the ledger and tells the poster
 *     (review #3, #5, #6, #7);
 *   - after a gift-funded crew settled, the share stays put and admins are
 *     told once a day to give it back by hand (no automatic gift credit);
 *   - every alert on such a share has a oncePerDayKey.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock, PAYABLE_CONNECT_ACCOUNT } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";
import { crewCancellationFee } from "../../../supabase/functions/_shared/crewShares";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankSqlComments } from "../helpers/blankNonCode";
import { migrationFiles } from "../helpers/effectiveFunctionDefs";

const CRON_SECRET = "cron-secret-void-crew-deleted";

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

/** $300 crew of 3, cancelled 1 hour before a 10:00 Central start: each committed share is $50.00. */
const crewJob = (over: Record<string, unknown> = {}) => ({
  id: "job-crew",
  title: "Move a piano",
  stripe_session_id: null,
  stripe_payment_intent_id: "pi_crew",
  budget: 300,
  customer_fee_amount: 30,
  cancellation_fee: 150,
  date_needed: "2024-06-25",
  start_time: "10:00:00",
  cancelled_at: "2024-06-25T14:00:00Z",
  helper_id: null,
  helper_confirmed_at: null,
  customer_id: "poster-1",
  helper_fee_percent: 10,
  is_group_job: true,
  helpers_needed: 3,
  parent_job_id: null,
  recurrence_days: null,
  ...over,
});

const share = (n: number, helper: string | null, over: Record<string, unknown> = {}) => ({
  id: `share-${n}`, job_id: "job-crew", helper_id: helper, committed: true, share_basis_cents: 10000, share_amount: "50.00", status: "pending", stripe_transfer_id: null, ...over,
});

/** Member C deleted their account: helper_id was set NULL by the FK. */
const SHARES_ONE_DELETED = () => [share(1, "member-a"), share(2, "member-b"), share(3, null)];

const feeTransfers = () =>
  stripeMock.transfers.create.mock.calls
    .filter(([p]) => (p as { metadata?: { type?: string } }).metadata?.type === "cancellation_fee")
    .map(([p]) => (p as { metadata: { helper_id: string } }).metadata.helper_id);
const shareFlips = () =>
  scenario.writes
    .filter((w) => w.table === "crew_cancellation_fee_shares" && w.op === "update")
    .map((w) => w.payload as Record<string, unknown>);
const deletedMemberAlerts = () =>
  (slackAlerts as Array<Record<string, unknown>>).filter((a) => /no recipient|deleted/i.test(String(a.title)));
const jobSettles = () =>
  scenario.writes.filter((w) => w.table === "jobs" && w.op === "update" && "payment_status" in (w.payload as Record<string, unknown>)).map((w) => w.payload as Record<string, unknown>);

function seedCard(shares = SHARES_ONE_DELETED()) {
  scenario.reads.jobs = {
    selectOverrides: [
      { includes: "cancelled_at", result: { rows: [crewJob()] } },
      { includes: "cancellation_fee_status", result: { rows: [] } },
    ],
    rows: [],
  };
  scenario.reads.crew_cancellation_fee_shares = { rows: shares };
  scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_member", subscription_tier: null }] };
  stripeMock.paymentIntents.retrieve.mockResolvedValue({
    id: "pi_crew", status: "succeeded", amount: 33000, amount_received: 33000, latest_charge: "ch_crew",
  });
  stripeMock.refunds.create.mockResolvedValue({ id: "re_crew", amount: 20000, status: "succeeded" });
  stripeMock.transfers.create.mockImplementation(async (params: { metadata: { helper_id: string } }) => ({ id: `tr_${params.metadata.helper_id}` }));
}

const APPLIED = 33000;
function seedGift(shares = SHARES_ONE_DELETED()) {
  seedCard(shares);
  (scenario.reads.jobs as { selectOverrides: Array<{ result: { rows: Array<Record<string, unknown>> } }> })
    .selectOverrides[0].result.rows[0].stripe_payment_intent_id = null;
  scenario.reads.gift_cards = { rows: [{ payment_status: "paid" }] };
  scenario.rpc.restore_gift_card_for_job = (args?: unknown) => {
    const a = (args ?? {}) as { p_dry_run?: boolean; p_share_bps?: number };
    if (a.p_dry_run) return { outcome: "would_restore", credit_id: "gift-1", applied_cents: APPLIED, restore_cents: APPLIED };
    const bps = a.p_share_bps ?? 10000;
    return { outcome: "restored", credit_id: "gift-2", recipient_id: "poster-1", applied_cents: APPLIED, restore_cents: Math.floor((APPLIED * bps) / 10000) };
  };
}
const giftRestoredCents = () => {
  const m = (scenario.rpcCalls ?? [])
    .filter((c) => c.name === "restore_gift_card_for_job")
    .map((c) => c.args as Record<string, unknown>)
    .find((c) => !c.p_dry_run);
  return m ? Math.floor((APPLIED * Number(m.p_share_bps ?? 10000)) / 10000) : null;
};

describe("crewCancellationFee: only a VOID share leaves the poster's fee (Q1915)", () => {
  const job = { budget: 300, date_needed: "2024-06-25", start_time: "10:00:00", cancelled_at: "2024-06-25T14:00:00Z" };

  // @mutate supabase/functions/_shared/crewShares.ts |     if (!returnsToPoster(s)) totalCents += storedCents; |     totalCents += storedCents;
  it("leaves a void share out of the total", () => {
    expect(crewCancellationFee(job, [share(1, "a"), share(2, "b"), share(3, null, { status: "void" })])).toEqual({ total: 100, mismatch: null });
  });

  // @mutate supabase/functions/_shared/crewShares.ts |   return s.status === "void"; |   return s.status === "void" \|\| !s.helper_id;
  it("still counts a deleted member's share until it is voided (it was withheld), and one PAID before the deletion", () => {
    expect(crewCancellationFee(job, [share(1, "a"), share(2, "b"), share(3, null)])).toEqual({ total: 150, mismatch: null });
    expect(crewCancellationFee(job, [share(1, "a"), share(2, "b"), share(3, null, { status: "paid", stripe_transfer_id: "tr_c" })])).toEqual({ total: 150, mismatch: null });
  });

  it("control: a whole crew still totals every share", () => {
    expect(crewCancellationFee(job, [share(1, "a"), share(2, "b"), share(3, "c")])).toEqual({ total: 150, mismatch: null });
  });
});

describe("void-cancelled-payments Part A: a deleted crew member's share goes back to the poster (Q1915)", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetStripeMock(); stripeMock.accounts.retrieve.mockResolvedValue(PAYABLE_CONNECT_ACCOUNT);
    resetSharedMocks();
  });

  // @mutate supabase/functions/void-cancelled-payments/index.ts |         if (!(await voidDeletedMemberShares(job, (shareRows ?? []) as CrewShare[], stripe))) { |         if (false) {
  it("card path: the share is voided first and the poster's refund includes it", async () => {
    seedCard();
    const h = await load();
    await h.fetch(cronReq());
    expect(feeTransfers()).toEqual(["member-a", "member-b"]);
    // $330 paid, less the $100 the two remaining members are owed, less the $30 service fee.
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_crew", amount: 33000 - 10000 - 3000 },
      { idempotencyKey: "cancel-refund-job-crew" },
    );
    expect(shareFlips()).toContainEqual(expect.objectContaining({ status: "void" }));
    const stamp = jobSettles().find((p) => p.cancellation_fee_status === "charged");
    expect(stamp?.cancellation_fee).toBe(100);
  });

  // @mutate supabase/functions/void-cancelled-payments/index.ts |           oncePerDayKey: `crew-fee-share-deleted-member:${row.id}`, |           oncePerDayKey: undefined,
  it("card path: the alert carries a oncePerDayKey", async () => {
    seedCard();
    const h = await load();
    await h.fetch(cronReq());
    const alerts = deletedMemberAlerts();
    expect(alerts.length).toBeGreaterThan(0);
    for (const a of alerts) expect(a.oncePerDayKey).toEqual(expect.stringContaining("share-3"));
  });

  it("a failed void write moves NO money this run (the job stays in escrow)", async () => {
    seedCard();
    scenario.writeErrors = { ...(scenario.writeErrors ?? {}), crew_cancellation_fee_shares: { message: "boom" } };
    const h = await load();
    await h.fetch(cronReq());
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
  });

  // @mutate supabase/functions/void-cancelled-payments/index.ts |       if ((refunded ?? []).length > 0) return true; |       if (false) return true;
  it("review #1: once a cancel refund is on the ledger, the share is NOT voided (it was withheld; Part D returns it)", async () => {
    seedCard();
    scenario.reads.payment_refunds = { rows: [{ stripe_refund_id: "re_earlier" }] };
    const h = await load();
    await h.fetch(cronReq());
    expect(shareFlips().some((p) => p.status === "void")).toBe(false);
    // Settled on the status alone: no second refund.
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
  });

  // @mutate supabase/functions/void-cancelled-payments/index.ts |         if (shareTransferInStripe(transfers, row)) continue; |         if (false) continue;
  it("review #2: a share Stripe already shows a transfer for is not voided; the ledger is repaired to paid", async () => {
    seedCard();
    stripeMock.transfers.list.mockResolvedValue({ data: [{ id: "tr_gone", metadata: { type: "cancellation_fee", share_id: "share-3", job_id: "job-crew" }, reversed: false, amount: 4400 }] });
    const h = await load();
    await h.fetch(cronReq());
    expect(shareFlips().some((p) => p.status === "void")).toBe(false);
    expect(shareFlips()).toContainEqual(expect.objectContaining({ status: "paid", stripe_transfer_id: "tr_gone" }));
    // The poster still pays the whole $150: that share went out.
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_crew", amount: 33000 - 15000 - 3000 },
      { idempotencyKey: "cancel-refund-job-crew" },
    );
  });

  it("gift path: a fully gift-funded crew's gift keeps only the remaining members' $100", async () => {
    seedGift();
    const h = await load();
    await h.fetch(cronReq());
    expect(feeTransfers()).toEqual(["member-a", "member-b"]);
    const restored = giftRestoredCents()!;
    expect(restored).toBeLessThanOrEqual(APPLIED - 10000);
    expect(restored).toBeGreaterThan(APPLIED - 10000 - 5);
    expect(shareFlips()).toContainEqual(expect.objectContaining({ status: "void" }));
  });

  // @mutate supabase/functions/void-cancelled-payments/index.ts |             : crewShareReturned ? { payment_status: "cancelled", cancellation_fee_status: null, cancellation_fee: 0 } : { payment_status: "cancelled" }, |             : { payment_status: "cancelled" },
  it("review #4: a gift crew whose every share went back is stamped with no fee", async () => {
    seedGift([share(1, null), share(2, null), share(3, null)]);
    const h = await load();
    await h.fetch(cronReq());
    expect(feeTransfers()).toEqual([]);
    expect(jobSettles()).toEqual([{ payment_status: "cancelled", cancellation_fee_status: null, cancellation_fee: 0 }]);
  });

  // @mutate supabase/functions/void-cancelled-payments/index.ts |             const settledVoid = await settleCancelledJob(job, crewShareReturned |             const settledVoid = await settleCancelledJob(job, false
  it("review #4: an uncaptured hold whose every share went back is released and stamped with no fee", async () => {
    seedCard([share(1, null), share(2, null), share(3, null)]);
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_crew", status: "requires_capture", amount: 33000, amount_capturable: 33000, latest_charge: null });
    stripeMock.paymentIntents.cancel.mockResolvedValue({ id: "pi_crew", status: "canceled" });
    const h = await load();
    await h.fetch(cronReq());
    expect(stripeMock.paymentIntents.capture).not.toHaveBeenCalled();
    expect(jobSettles()).toEqual([{ payment_status: "cancelled", cancellation_fee_status: null, cancellation_fee: 0 }]);
  });

  it("a share PAID before its member was deleted is still withheld (no double refund)", async () => {
    seedCard([share(1, "member-a"), share(2, "member-b"), share(3, null, { status: "paid", stripe_transfer_id: "tr_c" })]);
    const h = await load();
    await h.fetch(cronReq());
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_crew", amount: 33000 - 15000 - 3000 },
      { idempotencyKey: "cancel-refund-job-crew" },
    );
    expect(shareFlips().some((p) => p.status === "void")).toBe(false);
  });
});

describe("void-cancelled-payments Part D: a member deleted AFTER the crew settled (Q1915)", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetStripeMock(); stripeMock.accounts.retrieve.mockResolvedValue(PAYABLE_CONNECT_ACCOUNT);
    resetSharedMocks();
  });

  const settledJob = (pi: string | null) => ({
    id: "job-crew", title: "Move a piano", helper_fee_percent: 10, customer_id: "poster-1",
    payment_status: pi ? "refunded" : "cancelled", cancellation_fee_status: "charged", stripe_payment_intent_id: pi,
  });
  /** `after`: what the ledger re-read returns once the refund voided the share. */
  const seedSettled = (pi: string | null, owed = [share(3, null, { status: "failed" })], after = [share(1, "member-a", { status: "paid" }), share(2, "member-b", { status: "paid" }), share(3, null, { status: "void" })]) => {
    scenario.reads.jobs = {
      selectOverrides: [
        { includes: "cancelled_at", result: { rows: [] } },
        { includes: "cancellation_fee_status", result: { rows: [settledJob(pi)] } },
      ],
      rows: [],
    };
    scenario.reads.crew_cancellation_fee_shares = {
      rows: owed,
      selectOverrides: [{ includes: "status, share_amount", result: { rows: after } }],
    };
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      id: "pi_crew", status: "succeeded", amount: 33000, amount_received: 33000,
      latest_charge: { id: "ch_crew", amount: 33000, amount_refunded: 18000 },
    });
    stripeMock.refunds.create.mockResolvedValue({ id: "re_share", amount: 5000, status: "succeeded" });
  };
  const ledgerRows = () => scenario.writes.filter((w) => w.table === "payment_refunds").map((w) => w.payload as Record<string, unknown>);

  // @mutate supabase/functions/void-cancelled-payments/index.ts |           if (job.crew_share_retry === true) await returnShareToPoster(share, shareAmount); |           if (false) await returnShareToPoster(share, shareAmount);
  it("card path: refunds the $50 share, records it, voids it, restates the fee from the ledger and tells the poster", async () => {
    seedSettled("pi_crew");
    const h = await load();
    await h.fetch(cronReq());
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    const [params, opts] = stripeMock.refunds.create.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];
    expect(params).toMatchObject({ payment_intent: "pi_crew", amount: 5000, metadata: { crew_share_id: "share-3", type: "crew_fee_share_returned" } });
    expect(opts).toEqual({ idempotencyKey: "crew-share-returned-share-3" });
    expect(ledgerRows()).toEqual([expect.objectContaining({ stripe_refund_id: "re_share", source: "void_cancelled_payments_crew_share", amount_cents: 5000 })]);
    expect(shareFlips()).toContainEqual(expect.objectContaining({ status: "void" }));
    const stamp = scenario.writes.find((w) => w.table === "jobs" && "cancellation_fee" in (w.payload as Record<string, unknown>));
    expect(stamp?.payload).toEqual({ cancellation_fee: 100, cancellation_fee_status: "charged" });
    expect(scenario.writes.some((w) => w.table === "notifications" && (w.payload as Record<string, unknown>).user_id === "poster-1")).toBe(true);
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    for (const a of deletedMemberAlerts()) expect(a.oncePerDayKey).toBeTruthy();
  });

  // @mutate supabase/functions/void-cancelled-payments/index.ts |               withheldCents: cents, keptTaxCents, capturedCents, refundedCents: Math.round(Number(charge?.amount_refunded ?? 0)), |               withheldCents: cents, keptTaxCents: 0, capturedCents, refundedCents: Math.round(Number(charge?.amount_refunded ?? 0)),
  it("review #5: a taxed charge whose cancel refund kept tax refunds the share AND the sales tax kept on it", async () => {
    seedSettled("pi_crew");
    scenario.reads.payment_refunds = { rows: [{ stripe_refund_id: "re_cancel" }] };
    // $330 charge holding $30 tax: the $50 share kept ceil(5000 * 3000 / 30000) = 500c of tax.
    stripeMock.checkout.sessions.list.mockResolvedValue({ data: [{ total_details: { amount_tax: 3000 } }] });
    const h = await load();
    await h.fetch(cronReq());
    expect((stripeMock.refunds.create.mock.calls[0][0] as { amount: number }).amount).toBe(5500);
  });

  // @mutate supabase/functions/void-cancelled-payments/index.ts |             if ((cancelRefund ?? []).length > 0) { |             if (true) {
  it("re-review #1: a taxed crew that settled through a HOLD capture (no tax kept) gets the share back without tax", async () => {
    seedSettled("pi_crew");
    // The hold captured only the $150 fee: no cancel refund row, no tax kept.
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      id: "pi_crew", status: "succeeded", amount: 33000, amount_received: 15000,
      latest_charge: { id: "ch_crew", amount: 33000, amount_captured: 15000, amount_refunded: 0 },
    });
    stripeMock.checkout.sessions.list.mockResolvedValue({ data: [{ total_details: { amount_tax: 3000 } }] });
    const h = await load();
    await h.fetch(cronReq());
    expect((stripeMock.refunds.create.mock.calls[0][0] as { amount: number }).amount).toBe(5000);
  });

  it("review #3: the stamp is restated from the ledger, and every share gone clears the fee status", async () => {
    seedSettled("pi_crew", [share(2, null, { status: "failed" }), share(3, null, { status: "failed" })], [share(1, null, { status: "void" }), share(2, null, { status: "void" }), share(3, null, { status: "void" })]);
    const h = await load();
    await h.fetch(cronReq());
    const stamps = scenario.writes.filter((w) => w.table === "jobs" && "cancellation_fee" in (w.payload as Record<string, unknown>)).map((w) => w.payload);
    expect(stamps.length).toBe(2);
    expect(stamps[stamps.length - 1]).toEqual({ cancellation_fee: 0, cancellation_fee_status: null });
  });

  // @mutate supabase/functions/void-cancelled-payments/index.ts |           const live = mine.find((r) => r.status === "succeeded" \|\| r.status === "pending" \|\| r.status === "requires_action"); |           const live = undefined;
  it("a refund Stripe already shows for the share is not repeated; the ledger is repaired", async () => {
    seedSettled("pi_crew");
    stripeMock.refunds.list.mockResolvedValue({ data: [{ id: "re_old", amount: 5000, status: "succeeded", metadata: { crew_share_id: "share-3" } }] });
    const h = await load();
    await h.fetch(cronReq());
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(shareFlips()).toContainEqual(expect.objectContaining({ status: "void" }));
  });

  // @mutate supabase/functions/void-cancelled-payments/index.ts |               { idempotencyKey: `crew-share-returned-${share.id}${lastFailed ? `-after-${lastFailed.id}` : ""}` }, |               { idempotencyKey: `crew-share-returned-${share.id}` },
  // @mutate supabase/functions/void-cancelled-payments/index.ts |         if (refund.status !== "succeeded" && refund.status !== "pending") { |         if (false) {
  it("review #6: a failed refund is retried under a NEW key, and a refund that did not go through never voids the share", async () => {
    seedSettled("pi_crew");
    stripeMock.refunds.list.mockResolvedValue({ data: [{ id: "re_failed", amount: 5000, status: "failed", metadata: { crew_share_id: "share-3" } }] });
    stripeMock.refunds.create.mockResolvedValue({ id: "re_again", amount: 5000, status: "failed" });
    const h = await load();
    await h.fetch(cronReq());
    expect(stripeMock.refunds.create.mock.calls[0][1]).toEqual({ idempotencyKey: "crew-share-returned-share-3-after-re_failed" });
    expect(shareFlips().some((p) => p.status === "void")).toBe(false);
  });

  // @mutate supabase/functions/void-cancelled-payments/index.ts |           const sent = shareTransferInStripe(groupTransfers, share); |           const sent = undefined;
  it("review #2: a transfer Stripe already shows for the share repairs it to paid; nothing is refunded", async () => {
    seedSettled("pi_crew");
    stripeMock.transfers.list.mockResolvedValue({ data: [{ id: "tr_gone", metadata: { type: "cancellation_fee", share_id: "share-3", job_id: "job-crew" }, reversed: false, amount: 4400 }] });
    const h = await load();
    await h.fetch(cronReq());
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(shareFlips()).toContainEqual(expect.objectContaining({ status: "paid", stripe_transfer_id: "tr_gone" }));
  });

  it("gift path: nothing moves automatically; admins are told once a day to give it back by hand", async () => {
    seedSettled(null);
    const h = await load();
    await h.fetch(cronReq());
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    const alerts = deletedMemberAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].oncePerDayKey).toEqual(expect.stringContaining("share-3"));
    expect(String(alerts[0].message)).toMatch(/gift/i);
  });
});

describe("the crew fee ledger can hold a void share (Q1915)", () => {
  const root = resolve(__dirname, "../../..");
  const dir = resolve(root, "supabase/migrations");
  // @mutate supabase/migrations/20261021130729_crew_fee_share_void_for_deleted_member.sql |       CHECK (status IN ('pending', 'paid', 'failed', 'void')); |       CHECK (status IN ('pending', 'paid', 'failed'));
  it("the NEWEST status CHECK on crew_cancellation_fee_shares allows 'void', and the PGlite proof exists", () => {
    const files = migrationFiles(dir);
    const hits = files.filter((f) => /crew_cancellation_fee_shares_status_check|CREATE TABLE IF NOT EXISTS public\.crew_cancellation_fee_shares/.test(blankSqlComments(readFileSync(resolve(dir, f), "utf8"))));
    expect(hits.length).toBeGreaterThan(1);
    const newest = blankSqlComments(readFileSync(resolve(dir, hits[hits.length - 1]), "utf8"));
    expect(newest).toMatch(/ADD CONSTRAINT crew_cancellation_fee_shares_status_check\s+CHECK \(status IN \('pending', 'paid', 'failed', 'void'\)\)/);
    const proof = readFileSync(resolve(root, "src/test/pglite/crewFeeShareVoid.pglite.mjs"), "utf8");
    for (const c of ["V1 a deleted member's unpaid share can be voided", "V2 an unknown status", "V3 'paid' with no transfer id", "V4 a share already paid", "RED as expected"]) {
      expect(proof).toContain(c);
    }
  });
});

describe("money-reconciliation agrees: a crew's fee is priced without a share that went back (Q1915)", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetSharedMocks();
  });

  const reconFindings = async (shares: Array<Record<string, unknown>>, stamped: number): Promise<string[]> => {
    resetSupabaseMock();
    setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key", CRON_SECRET: "cron-secret" });
    scenario.reads.jobs = {
      rows: [{
        id: "job-crew", is_seed: false, status: "cancelled", payment_status: "refunded",
        budget: 100, urgent_fee: 0, date_needed: "2024-06-25", start_time: "10:00:00", cancelled_at: "2024-06-25T14:00:00Z",
        helper_id: null, helper_confirmed_at: null, cancellation_fee: stamped, cancellation_fee_status: "charged",
        late_cancellation: false, platform_fee_amount: 12, helper_fee_percent: 12, is_group_job: true,
        helpers_needed: 2, has_active_dispute: false, dispute_status: null, poster_completed_at: null,
        helper_completed_at: null, payout_scheduled_at: null, updated_at: "2024-06-25T15:00:00Z", stripe_payment_intent_id: null,
        customer_fee_amount: 0,
      }],
    };
    scenario.reads.group_job_helpers = { rows: [] };
    scenario.reads.payout_transfers = { rows: [] };
    scenario.reads.profiles = { rows: [] };
    scenario.reads.disputes = { rows: [] };
    scenario.reads.gift_cards = { rows: [] };
    scenario.reads.crew_cancellation_fee_shares = { rows: shares };
    const fn = await loadEdgeFunction("money-reconciliation");
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer cron-secret" } }));
    const b = JSON.parse(await res.text()) as { findings?: Array<{ check: string }> };
    return (b.findings ?? []).map((f) => f.check);
  };
  const s = (helper: string | null, status: string) => ({ job_id: "job-crew", helper_id: helper, committed: true, share_basis_cents: 5000, share_amount: "25.00", status });

  // @mutate supabase/functions/money-reconciliation/index.ts | .select("job_id, helper_id, committed, share_basis_cents, share_amount, status") | .select("job_id, helper_id, committed, share_basis_cents, share_amount")
  it("a void share is left out (stamp $25 agrees), and a share paid before deletion still counts (stamp $50 agrees)", async () => {
    expect(await reconFindings([s("m1", "paid"), s(null, "void")], 25)).not.toContain("cancellation_fee_mismatch");
    expect(await reconFindings([s("m1", "paid"), s(null, "paid")], 50)).not.toContain("cancellation_fee_mismatch");
    // Control: a stamp that disagrees is still flagged.
    expect(await reconFindings([s("m1", "paid"), s(null, "void")], 50)).toContain("cancellation_fee_mismatch");
    // The mock returns every seeded column, so pin that the real read asks for status.
    const read = (scenario.readQueries ?? []).find((q) => q.table === "crew_cancellation_fee_shares");
    expect(read?.cols.split(",").map((c) => c.trim())).toContain("status");
  });
});
