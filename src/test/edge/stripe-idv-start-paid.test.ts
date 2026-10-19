/**
 * The paid ID check (owner 2026-10-19: "BOTH WAYS, BUT THEY HAVE TO PAY FOR
 * THEIR OWN ID"): stripe-idv-start { action: "checkout" | "start" }.
 *
 * ORDERING: a VerificationSession (billed to the platform) is created ONLY for
 * a webhook-confirmed 'paid' idv_fee_payments row. IDEMPOTENCY: the create is
 * keyed to that row, so a retry or a double tap gets the same session, and a
 * row already holding a session is never given a second one. REFUND: a create
 * that fails refunds the payment in full. The price is the one config value
 * in _shared/idvFee.ts, charged with no fee left for the platform to absorb.
 */
// @mutate supabase/functions/stripe-idv-start/index.ts |   if (!row) return needsFee( |   if (false) return needsFee(
// @mutate supabase/functions/stripe-idv-start/index.ts | }, { idempotencyKey: `idv-fee:${row.id}` }); | });
// @mutate supabase/functions/stripe-idv-start/index.ts | return await refundInFull(ctx, stripe, row, String((err as Error)?.message ?? err).slice(0, 120)); | throw err;
// @mutate supabase/functions/stripe-idv-start/index.ts |   if (!Array.isArray(claimed) \|\| claimed.length === 0) { |   if (false) {
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { IDV_FEE_CENTS, STRIPE_IDENTITY_CHECK_CENTS } from "../../../supabase/functions/_shared/idvFee";
import { stripeProcessingCostCents } from "../../../supabase/functions/_shared/stripeFees";

const AUTH = { Authorization: "Bearer test-jwt" };
const USER = { id: "landlord-1", email: "landlord@test.com" };

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_live_abc123",
  });
  return loadEdgeFunction("stripe-idv-start");
}
const json = async (res: Response) => JSON.parse(await res.text()) as Record<string, unknown>;
const call = async (body: Record<string, unknown>) => {
  const fn = await load();
  return fn.fetch(fn.request({ headers: AUTH, body }));
};

/** The owner's real shape on 2026-10-19: legacy 'pending', no verdict. */
function landlord(profile: Record<string, unknown> = {}) {
  scenario.authUser = USER;
  scenario.reads.profiles = {
    rows: [{ idv_status: "pending", idv_session_id: null, full_name: "Lee L", stripe_identity_verified: false, ...profile }],
  };
}
const payments = (rows: Array<Record<string, unknown>>) => {
  scenario.reads.idv_fee_payments = { rows };
};
const PAID = { id: "pay-1", status: "paid", stripe_verification_session_id: null, stripe_payment_intent_id: "pi_1", stripe_livemode: true, updated_at: "2026-10-19T02:00:00.000000+00:00" };
const updates = () => scenario.writes.filter((w) => w.table === "idv_fee_payments" && w.op === "update");
const updateTo = (status: string) => updates().find((w) => (w.payload as { status?: string }).status === status);

describe("the price", () => {
  it("nets exactly Stripe Identity's cost after the card fee: the platform absorbs nothing", () => {
    expect(STRIPE_IDENTITY_CHECK_CENTS).toBe(150);
    expect(IDV_FEE_CENTS).toBe(185);
    expect(IDV_FEE_CENTS - stripeProcessingCostCents(IDV_FEE_CENTS)).toBeGreaterThanOrEqual(STRIPE_IDENTITY_CHECK_CENTS);
    // and it is the smallest such charge (we never over-charge either)
    expect(IDV_FEE_CENTS - 1 - stripeProcessingCostCents(IDV_FEE_CENTS - 1)).toBeLessThan(STRIPE_IDENTITY_CHECK_CENTS);
  });
});

describe("stripe-idv-start paid ID check", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  it("checkout: opens a card/Link Checkout for the configured price and records it awaiting payment, creating no session", async () => {
    landlord();
    payments([]);
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_1", url: "https://checkout.stripe.com/cs_1" });
    const res = await call({ action: "checkout", native: true });

    expect(res.status).toBe(200);
    expect((await json(res)).url).toBe("https://checkout.stripe.com/cs_1");
    const args = stripeMock.checkout.sessions.create.mock.calls[0][0];
    expect(args.line_items[0].price_data.unit_amount).toBe(IDV_FEE_CENTS);
    expect(args.payment_method_types).toEqual(["card", "link"]);
    expect(args.metadata).toEqual({ kind: "idv_fee", user_id: USER.id });
    expect(args.success_url).toContain("/rentals?idv=paid");
    expect(args.success_url).toContain("native=1");
    const ins = scenario.writes.find((w) => w.table === "idv_fee_payments" && w.op === "insert");
    expect(ins?.payload).toMatchObject({ user_id: USER.id, stripe_checkout_session_id: "cs_1", amount_cents: IDV_FEE_CENTS, status: "awaiting_payment" });
    expect(stripeMock.identity.verificationSessions.create).not.toHaveBeenCalled();
  });

  it("checkout: an account verified by Stripe Connect only is already verified; nothing is sold", async () => {
    landlord({ stripe_identity_verified: true });
    const res = await call({ action: "checkout" });
    expect((await json(res)).alreadyVerified).toBe(true);
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("checkout: a paid, unused check is not sold twice", async () => {
    landlord();
    payments([{ ...PAID, stripe_checkout_session_id: "cs_0" }]);
    const res = await call({ action: "checkout" });
    expect((await json(res)).paid).toBe(true);
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("start: with NO webhook-confirmed payment there is no session (402 needsIdvFee), legacy 'pending' or not", async () => {
    landlord();
    payments([]);
    const res = await call({ action: "start" });
    expect(res.status).toBe(402);
    const body = await json(res);
    expect(body.needsIdvFee).toBe(true);
    expect(body.feeCents).toBe(IDV_FEE_CENTS);
    expect(stripeMock.identity.verificationSessions.create).not.toHaveBeenCalled();
    // and the legacy one-attempt claim is not what decides it
    expect(scenario.rpcCalls?.some((c) => c.name === "claim_idv_attempt")).toBeFalsy();
  });

  it("start: a paid row gets exactly one session, keyed to the payment, returning to Homes", async () => {
    landlord();
    payments([PAID]);
    stripeMock.identity.verificationSessions.create.mockResolvedValue({ id: "vs_1", url: "https://verify.stripe.com/vs_1" });
    const res = await call({ action: "start", native: true });

    expect(res.status).toBe(200);
    expect((await json(res)).url).toBe("https://verify.stripe.com/vs_1");
    expect(stripeMock.identity.verificationSessions.create).toHaveBeenCalledTimes(1);
    const [args, opts] = stripeMock.identity.verificationSessions.create.mock.calls[0];
    expect(opts.idempotencyKey).toBe("idv-fee:pay-1");
    expect(args.metadata.idv_fee_payment_id).toBe("pay-1");
    expect(args.options.document.require_matching_selfie).toBe(true);
    expect(args.return_url).toContain("/rentals?idv=complete");
    // the row is CLAIMED (paid -> starting) before Stripe is called, then records the session
    expect(updates().map((w) => (w.payload as { status: string }).status)).toEqual(["starting", "session_started"]);
    expect(updateTo("starting")?.filters).toEqual(expect.arrayContaining([expect.objectContaining({ op: "eq", column: "status", value: "paid" })]));
    expect(updateTo("session_started")?.payload).toMatchObject({ stripe_verification_session_id: "vs_1" });
  });

  it("start: a double tap that loses the claim creates NO second session and refunds nothing", async () => {
    landlord();
    payments([PAID]);
    scenario.writeOverrides = [{ table: "idv_fee_payments", op: "update", when: (p) => p.status === "starting", rows: [] }];
    const res = await call({ action: "start" });
    expect(res.status).toBe(409);
    expect(stripeMock.identity.verificationSessions.create).not.toHaveBeenCalled();
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
  });

  it("start: a row another tap is still starting answers 409 without calling Stripe", async () => {
    landlord();
    payments([{ ...PAID, status: "starting", updated_at: new Date().toISOString() }]);
    const res = await call({ action: "start" });
    expect(res.status).toBe(409);
    expect(stripeMock.identity.verificationSessions.create).not.toHaveBeenCalled();
  });

  it("start: a Stripe idempotency conflict is never refunded (the session may be live)", async () => {
    landlord();
    payments([PAID]);
    stripeMock.identity.verificationSessions.create.mockRejectedValue(
      Object.assign(new Error("Keys for idempotent requests can only be used with the same parameters"), { type: "StripeIdempotencyError" }),
    );
    const res = await call({ action: "start" });
    expect(res.status).toBe(409);
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
  });

  it("checkout/start: a banned account is not sold a check", async () => {
    landlord({ ban_status: "permanently_banned" });
    payments([]);
    const res = await call({ action: "checkout" });
    expect(res.status).toBe(403);
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("start again: a session that was never submitted is handed back, not re-created (Stripe bills completed checks only)", async () => {
    landlord();
    payments([{ ...PAID, status: "session_started", stripe_verification_session_id: "vs_1" }]);
    stripeMock.identity.verificationSessions.retrieve.mockResolvedValue({
      id: "vs_1", status: "requires_input", last_error: null, url: "https://verify.stripe.com/vs_1",
    });
    const res = await call({ action: "start" });
    expect((await json(res)).sessionId).toBe("vs_1");
    expect(stripeMock.identity.verificationSessions.create).not.toHaveBeenCalled();
  });

  it("start after a FAILED check: the payment is used up and a retry needs a new payment", async () => {
    landlord({ idv_status: "failed" });
    payments([{ ...PAID, status: "session_started", stripe_verification_session_id: "vs_1" }]);
    stripeMock.identity.verificationSessions.retrieve.mockResolvedValue({
      id: "vs_1", status: "requires_input", last_error: { code: "document_expired", reason: "The document is expired." }, url: null,
    });
    const res = await call({ action: "start" });
    expect(res.status).toBe(402);
    expect((await json(res)).needsIdvFee).toBe(true);
    expect(stripeMock.identity.verificationSessions.create).not.toHaveBeenCalled();
    expect(updateTo("used")).toBeTruthy();
  });

  it("start: when our side cannot create the session, the payment is refunded IN FULL", async () => {
    landlord();
    payments([PAID]);
    stripeMock.identity.verificationSessions.create.mockRejectedValue(new Error("stripe down"));
    stripeMock.refunds.create.mockResolvedValue({ id: "re_1" });
    const res = await call({ action: "start" });

    expect(res.status).toBe(503);
    expect((await json(res)).refunded).toBe(true);
    const [refundArgs, refundOpts] = stripeMock.refunds.create.mock.calls[0];
    expect(refundArgs.payment_intent).toBe("pi_1");
    expect(refundArgs.amount).toBeUndefined(); // no amount = the whole charge, card fee included
    expect(refundOpts.idempotencyKey).toBe("idv-fee-refund:pay-1");
    expect(updateTo("refunded")?.payload).toMatchObject({ stripe_refund_id: "re_1" });
    // only our claimed row is refunded, never one holding a session
    expect(updateTo("refunded")?.filters).toEqual(expect.arrayContaining([expect.objectContaining({ op: "eq", column: "status", value: "starting" })]));
  });
});
