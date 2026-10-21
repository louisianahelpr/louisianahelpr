/**
 * Q1905 (owner decided 2026-10-21): a REAL gift card can NOT pay for a test
 * job. Q1750 kept a real buyer's gift LIVE even when its recipient is a test
 * account, so a test poster could spend live money on a test-mode job: the
 * job then paid out on the TEST key while the buyer's live money sat in the
 * platform's live balance with no real person paid.
 *
 * A gift carries its Stripe mode on the root of its tree (the donation row's
 * stripe_session_id: cs_live_ / cs_test_; a leftover, a sent credit or a
 * restore points at its parent). create-payment refuses a gift whose mode is
 * not the job's, before redeem_gift_card moves anything, BOTH ways (the
 * lh-money-escrow review of Q1905 #1: a sandbox leftover or restored credit
 * of an account later un-enrolled must not fund a real payout either); an
 * unreadable gift fails closed, and a gift that is not the caller's is
 * refused without saying anything about it (review #4).
 *
 * Runs the REAL create-payment source through the edge harness.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

const AUTH = { Authorization: "Bearer test-jwt" };
const POSTER = "11111111-1111-4111-8111-111111111111";

function env() {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_live_real_money",
    STRIPE_TEST_SECRET_KEY: "sk_test_sandbox",
  });
}

/** Enrol the poster as a TEST ACCOUNT (test_accounts row AND profiles.is_seed). */
function enrolPoster() {
  scenario.reads.test_accounts = { rows: [{ user_id: POSTER }] };
  scenario.reads.profiles = {
    rows: [{ user_id: POSTER, onboarding_fee_paid: true, email: "poster@example.com" }],
    selectOverrides: [{ includes: "user_id, is_seed", result: { rows: [{ user_id: POSTER, is_seed: true }] } }],
  };
}

/** A sent credit ("gift-child") whose root donation was bought on `rootSession`. */
function seedGift(rootSession: string | null, opts: { readError?: boolean; recipient?: string } = {}) {
  scenario.reads.gift_cards = {
    rows: [],
    eqOverrides: opts.readError
      ? [{ column: "id", value: "gift-child", result: { error: { message: "gift read boom" } } }]
      : [
        { column: "id", value: "gift-child", result: { rows: [{ id: "gift-child", parent_credit_id: "gift-root", stripe_session_id: null, recipient_id: opts.recipient ?? POSTER }] } },
        { column: "id", value: "gift-root", result: { rows: [{ id: "gift-root", parent_credit_id: null, stripe_session_id: rootSession }] } },
      ],
  };
}

function seedJob() {
  scenario.authUser = { id: POSTER, email: "poster@example.com" };
  stripeMock.customers.list.mockResolvedValue({ data: [{ id: "cus_existing" }] });
  scenario.reads.jobs = {
    rows: [{ id: "job-1", customer_id: POSTER, helper_id: null, budget: 100, category: "cleaning", title: "Clean my house", payment_status: "unpaid", status: "open" }],
  };
  scenario.reads.group_job_helpers = { rows: [] };
  scenario.rpc.redeem_gift_card = { outcome: "settled" };
  scenario.writeSelectRows.jobs = [{ id: "job-1" }];
}

const redeemed = () => (scenario.rpcCalls ?? []).some((c) => c.name === "redeem_gift_card");

async function payWithGift(): Promise<{ status: number; body: Record<string, unknown> }> {
  const fn = await loadEdgeFunction("create-payment");
  const res = await fn.fetch(fn.request({ headers: AUTH, body: { action: "escrow", jobId: "job-1", giftCardId: "gift-child" } }));
  return { status: res.status, body: JSON.parse(await res.text()) };
}

describe("create-payment: a real gift card can't pay for a test job (Q1905)", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetStripeMock();
    resetSharedMocks();
    env();
  });

  // @mutate supabase/functions/create-payment/index.ts |         if (!gift.ok \|\| gift.mode !== stripeMode) { |         if (false) {
  // @mutate supabase/functions/_shared/stripeMode.ts |     const mode = sessionIdMode(row.stripe_session_id); |     const mode = "test" as const;
  it("refuses a LIVE gift on a test job before anything is redeemed", async () => {
    enrolPoster();
    seedJob();
    seedGift("cs_live_abc");
    const { status, body } = await payWithGift();
    expect(status).toBeGreaterThanOrEqual(400);
    expect(String(body.error)).toMatch(/real money can't pay for a test job/);
    expect(redeemed()).toBe(false);
  });

  // @mutate supabase/functions/_shared/stripeMode.ts |     if (error) return { ok: false, reason: "unreadable" }; |     if (error) return { ok: true, mode: "test" };
  it("an unreadable gift on a test job fails closed", async () => {
    enrolPoster();
    seedJob();
    seedGift(null, { readError: true });
    const { status } = await payWithGift();
    expect(status).toBeGreaterThanOrEqual(400);
    expect(redeemed()).toBe(false);
  });

  it("a gift whose tree names no mode at all fails closed on a test job", async () => {
    enrolPoster();
    seedJob();
    seedGift(null);
    const { status } = await payWithGift();
    expect(status).toBeGreaterThanOrEqual(400);
    expect(redeemed()).toBe(false);
  });

  it("control: a TEST gift pays for a test job", async () => {
    enrolPoster();
    seedJob();
    seedGift("cs_test_abc");
    const { status } = await payWithGift();
    expect(status).toBe(200);
    expect(redeemed()).toBe(true);
  });

  it("control: a LIVE gift pays for a real job", async () => {
    scenario.reads.test_accounts = { rows: [] };
    scenario.reads.profiles = { rows: [{ user_id: POSTER, onboarding_fee_paid: true, email: "poster@example.com" }] };
    seedJob();
    seedGift("cs_live_abc");
    const { status } = await payWithGift();
    expect(status).toBe(200);
    expect(redeemed()).toBe(true);
  });

  it("review #1: a TEST gift can't pay for a real job either", async () => {
    scenario.reads.test_accounts = { rows: [] };
    scenario.reads.profiles = { rows: [{ user_id: POSTER, onboarding_fee_paid: true, email: "poster@example.com" }] };
    seedJob();
    seedGift("cs_test_abc");
    const { status, body } = await payWithGift();
    expect(status).toBeGreaterThanOrEqual(400);
    expect(String(body.error)).toMatch(/test gift card can't pay for a real job/);
    expect(redeemed()).toBe(false);
  });

  // @mutate supabase/functions/_shared/stripeMode.ts |     if (hop === 0 && row.recipient_id !== callerId) return { ok: false, reason: "not_yours" }; |     if (false) return { ok: false, reason: "not_yours" };
  it("review #4: someone else's gift is refused with redeem's own wording, saying nothing about its mode", async () => {
    enrolPoster();
    seedJob();
    seedGift("cs_test_abc", { recipient: "someone-else" });
    const { status, body } = await payWithGift();
    expect(status).toBeGreaterThanOrEqual(400);
    expect(String(body.error)).toBe("This gift is not yours to redeem");
    expect(redeemed()).toBe(false);
  });
});
