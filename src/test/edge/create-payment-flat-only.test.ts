/**
 * Every job checkout is the flat model (owner 2026-10-23, #3556: the poster-fee
 * model and Pay in 4 are removed from the app entirely; neither was ever
 * switched on and no job was funded on them).
 *
 * - The poster pays the job price (budget + urgent bonus); no "Service fee"
 *   line; the job is stamped on the flat model (the Helpr pays 5% + 70c).
 * - Stale-client protection: a request that carries a quote must quote the
 *   flat model and the job price the server reads; anything else (a poster-fee
 *   quote from an app built while that model existed, Pay in 4, an old price)
 *   is refused before Stripe is called. No quote at all is accepted.
 * - Every job checkout names card, Link and ACH and turns Adaptive Pricing off.
 *
 * @mutate supabase/functions/_shared/jobCheckout.ts |   if (q.model !== "flat") return STALE_FEE_QUOTE_MESSAGE; |
 * @mutate supabase/functions/_shared/jobCheckout.ts |   if (q.payInFour === true) return STALE_FEE_QUOTE_MESSAGE; |
 * @mutate supabase/functions/create-payment/index.ts |       if (payInFour) throw new PublicError(STALE_FEE_QUOTE_MESSAGE); |
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { STALE_FEE_QUOTE_MESSAGE, buildFeeQuote } from "../../../supabase/functions/_shared/jobCheckout";

const AUTH = { Authorization: "Bearer test-jwt" };
const POSTER = { id: "poster-1", email: "poster@test.com" };

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc123",
  });
  return loadEdgeFunction("create-payment");
}

function seed(opts: { budget?: number; extra?: Record<string, unknown> } = {}) {
  resetSupabaseMock();
  stripeMock.checkout.sessions.create.mockClear();
  scenario.authUser = POSTER;
  stripeMock.customers.list.mockResolvedValue({ data: [{ id: "cus_existing" }] });
  scenario.reads.jobs = {
    rows: [{
      id: "job-ff", customer_id: POSTER.id, budget: opts.budget ?? 100, category: "cleaning",
      title: "Flat job", status: "open", payment_status: "unpaid", ...(opts.extra ?? {}),
    }],
  };
  scenario.reads.platform_settings = { rows: [{ customer_fee_percent: 10, helper_fee_percent: 12, onboarding_fee_cents: 200 }] };
  scenario.reads.profiles = { rows: [{ onboarding_fee_paid: true, subscription_tier: null, subscription_expires_at: null }] };
  stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_ff", url: "https://checkout.stripe.test/cs_ff" });
}

async function escrow(body: Record<string, unknown> = {}) {
  const fn = await load();
  const res = await fn.fetch(fn.request({ headers: AUTH, body: { action: "escrow", jobId: "job-ff", ...body } }));
  const payload = JSON.parse(await res.text()) as Record<string, unknown>;
  const call = stripeMock.checkout.sessions.create.mock.calls[0];
  const jobUpdates = scenario.writes.filter((w) => w.table === "jobs" && w.op === "update").map((w) => w.payload as Record<string, unknown>);
  return {
    res, payload,
    args: call?.[0] as Record<string, any> | undefined,
    key: call?.[1]?.idempotencyKey as string | undefined,
    modelStamp: jobUpdates.find((p) => "helper_fee_flat_cents" in p && !("stripe_session_id" in p)),
    sessionStamp: jobUpdates.find((p) => "stripe_session_id" in p),
  };
}

const lineNamed = (args: Record<string, any> | undefined, name: string) =>
  (args?.line_items ?? []).find((li: any) => li.price_data.product_data.name === name);

describe("create-payment escrow: every job checkout is the flat model (owner 2026-10-23)", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  it("no quote (an older app): the flat model, no service fee line, stamped flat", async () => {
    seed();
    const { res, args, key, modelStamp, sessionStamp } = await escrow();
    expect(res.status).toBe(200);
    expect(lineNamed(args, "Service fee")).toBeUndefined();
    expect(modelStamp).toMatchObject({ helper_fee_flat_cents: 70, helper_fee_percent: 5, platform_fee_percent: 0, customer_fee_amount: 0 });
    expect(sessionStamp).toMatchObject({ customer_fee_amount: 0, helper_fee_flat_cents: 70 });
    expect(modelStamp).not.toHaveProperty("poster_fee_flat_cents");
    expect(sessionStamp).not.toHaveProperty("poster_fee_flat_cents");
    expect(key).toMatch(/-mflat-/);
  });

  it("every job checkout names card, Link and ACH and turns Adaptive Pricing off", async () => {
    seed();
    const { args } = await escrow();
    expect(args?.payment_method_types).toEqual(["card", "link", "us_bank_account"]);
    expect(args?.adaptive_pricing).toEqual({ enabled: false });
  });

  it("the app's flat quote (urgent bonus included) is charged; a flat quote at another price is refused", async () => {
    seed({ budget: 100, extra: { is_urgent: true, urgent_fee: 20 } });
    let r = await escrow({ feeQuote: buildFeeQuote({ jobPriceCents: 12_000 }) });
    expect(r.res.status).toBe(200);
    expect(lineNamed(r.args, "Service fee")).toBeUndefined();
    seed({ budget: 100, extra: { is_urgent: true, urgent_fee: 20 } });
    r = await escrow({ feeQuote: buildFeeQuote({ jobPriceCents: 10_000 }) });
    expect(r.res.status).not.toBe(200);
    expect(r.payload.error).toBe(STALE_FEE_QUOTE_MESSAGE);
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("a screen that shows no total (quote booking) sends the model only and is charged the job price", async () => {
    seed();
    const { res, args } = await escrow({ feeQuote: buildFeeQuote() });
    expect(res.status).toBe(200);
    expect(lineNamed(args, "Service fee")).toBeUndefined();
  });

  const REFUSED: Array<[string, Record<string, unknown>]> = [
    ["a poster-fee quote (an app built while that model existed)", { feeQuote: { model: "poster", payInFour: false, totalShown: true, jobPriceCents: 10_000, serviceFeeCents: 570 } }],
    ["Pay in 4 asked in the body", { payInFour: true }],
    ["Pay in 4 asked in the quote", { feeQuote: { model: "flat", payInFour: true, totalShown: false } }],
    ["a flat quote showing a service fee", { feeQuote: { model: "flat", payInFour: false, totalShown: true, jobPriceCents: 10_000, serviceFeeCents: 570 } }],
    ["a junk quote", { feeQuote: "poster" }],
  ];
  for (const [label, body] of REFUSED) {
    it(`${label} is refused before Stripe is called`, async () => {
      seed();
      const { res, payload, modelStamp } = await escrow(body);
      expect(res.status).not.toBe(200);
      expect(payload.error).toBe(STALE_FEE_QUOTE_MESSAGE);
      expect(modelStamp).toBeUndefined();
      expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    });
  }
});
