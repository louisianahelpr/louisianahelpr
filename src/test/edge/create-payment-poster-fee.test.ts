/**
 * Jobs poster fee, slice 3 (owner 2026-10-18): create-payment's escrow
 * checkout, behind the ONE server switch `jobs_poster_fee` (created OFF).
 *
 * - Switch OFF (today, and on any switch read error): the flat model exactly
 *   as before (no service fee line, the Helpr stamp 70c / 5%).
 * - Switch ON: the poster pays round(5% x (budget + bonus)) + 70c on its own
 *   "Service fee" line (9% + 70c for Pay in 4), taxed like the job's labor
 *   (tax memo), and the job is stamped poster-fee with the Helpr side 0/0.
 * - Stale-client protection: on the poster-fee model a request without the
 *   app's quote, or with any amount that differs, is refused before Stripe
 *   is called. A present quote must match on the flat model too.
 * - Every job checkout names its payment methods (card, Link, ACH; Pay in 4 =
 *   Klarna + Afterpay only) and turns Adaptive Pricing off.
 * - Gift-funded and recurring checkouts stay flat until their slice lands.
 *
 * @mutate supabase/functions/create-payment/index.ts |                 poster_fee_flat_cents: POSTER_JOB_FEE_CENTS,\n                platform_fee_percent: posterFeePercent, |                 platform_fee_percent: posterFeePercent,
 * @mutate supabase/functions/create-payment/index.ts |       if (isPosterFee && posterFeeCents > 0) { |       if (false) {
 * @mutate supabase/functions/create-payment/index.ts |       if (quoteRefusal) { |       if (false) {
 * @mutate supabase/functions/create-payment/index.ts |         payment_method_types: payInFour ? payInFourMethods : [...JOB_CHECKOUT_PAYMENT_METHOD_TYPES], |         payment_method_types: payInFour ? payInFourMethods : undefined,
 * @mutate supabase/functions/create-payment/index.ts |       if (payInFour && job.recurrence_days != null) throw | if (false) throw
 * @mutate supabase/functions/create-payment/index.ts |               tax_code: laborTaxable ? laborTaxCode(job.category) : NONTAXABLE_TAX_CODE, |               tax_code: NONTAXABLE_TAX_CODE,
 * @mutate supabase/functions/_shared/jobCheckout.ts |   return i.switchOn ? "poster" : "flat"; |   return "poster";
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { STALE_FEE_QUOTE_MESSAGE, buildFeeQuote } from "../../../supabase/functions/_shared/jobCheckout";
import { TAXABLE_CATEGORIES, TAXABLE_LABOR_TAX_CODE, NONTAXABLE_TAX_CODE } from "../../../supabase/functions/_shared/salesTax";

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

type Switch = boolean | "error";

function seed(opts: { budget?: number; category?: string; switchOn?: Switch; extra?: Record<string, unknown> } = {}) {
  resetSupabaseMock();
  stripeMock.checkout.sessions.create.mockClear();
  scenario.authUser = POSTER;
  stripeMock.customers.list.mockResolvedValue({ data: [{ id: "cus_existing" }] });
  scenario.reads.jobs = {
    rows: [{
      id: "job-pf", customer_id: POSTER.id, budget: opts.budget ?? 100, category: opts.category ?? "cleaning",
      title: "Poster fee job", status: "open", payment_status: "unpaid", ...(opts.extra ?? {}),
    }],
  };
  scenario.reads.platform_settings = { rows: [{ customer_fee_percent: 10, helper_fee_percent: 12, onboarding_fee_cents: 200 }] };
  scenario.reads.profiles = { rows: [{ onboarding_fee_paid: true, subscription_tier: null, subscription_expires_at: null }] };
  // Q1905: the poster's own gift, bought LIVE, so it may pay for this real job
  // (create-payment refuses a gift of another Stripe mode). Read only when a
  // giftCardId is sent.
  scenario.reads.gift_cards = { rows: [{ id: "gift-1", parent_credit_id: null, stripe_session_id: "cs_live_gift", recipient_id: POSTER.id }] };
  if (opts.switchOn === "error") {
    scenario.rpcErrors = { feature_enabled_for_user: { message: "switch read boom" } };
  } else {
    // Scoped to this file's switch: card_hold_at_post (Q2399) answers off here.
    scenario.rpc.feature_enabled_for_user = (a?: unknown) => opts.switchOn === true && (a as { p_key?: string } | undefined)?.p_key === "jobs_poster_fee";
  }
  stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_pf", url: "https://checkout.stripe.test/cs_pf" });
}

async function escrow(body: Record<string, unknown> = {}) {
  const fn = await load();
  const res = await fn.fetch(fn.request({ headers: AUTH, body: { action: "escrow", jobId: "job-pf", ...body } }));
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

const quote = (jobPriceCents: number, payInFour = false) =>
  buildFeeQuote({ switchOn: true, jobPriceCents, payInFour });

describe("create-payment escrow: jobs poster fee behind the switch (owner 2026-10-18)", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  for (const sw of [false, "error"] as const) {
    it(`switch ${sw === false ? "OFF" : "read error"}: the flat model, unchanged, with no quote needed (an older app)`, async () => {
      seed({ switchOn: sw });
      const { res, args, key, modelStamp, sessionStamp } = await escrow();
      expect(res.status).toBe(200);
      expect(lineNamed(args, "Service fee")).toBeUndefined();
      expect(modelStamp).toMatchObject({ helper_fee_flat_cents: 70, helper_fee_percent: 5, platform_fee_percent: 0, customer_fee_amount: 0 });
      expect(sessionStamp).toMatchObject({ customer_fee_amount: 0, helper_fee_flat_cents: 70 });
      // A job with no poster stamp never names the column (deploy order: this
      // works before 20261017230824 is live; review of slice 3a #6).
      expect(modelStamp).not.toHaveProperty("poster_fee_flat_cents");
      expect(sessionStamp).not.toHaveProperty("poster_fee_flat_cents");
      expect(key).toMatch(/-mflat-/);
    });
  }

  it("every job checkout names card, Link and ACH and turns Adaptive Pricing off", async () => {
    seed({ switchOn: false });
    const { args } = await escrow();
    expect(args?.payment_method_types).toEqual(["card", "link", "us_bank_account"]);
    expect(args?.adaptive_pricing).toEqual({ enabled: false });
  });

  it("switch ON: a $100 job charges a $5.70 service fee and stamps the poster-fee model, Helpr 0/0", async () => {
    seed({ switchOn: true, budget: 100 });
    const { res, args, key, modelStamp, sessionStamp } = await escrow({ feeQuote: quote(10_000) });
    expect(res.status).toBe(200);
    expect(lineNamed(args, "Service fee")?.price_data.unit_amount).toBe(570);
    const total = (args?.line_items ?? []).reduce((t: number, li: any) => t + li.price_data.unit_amount, 0);
    expect(total).toBe(10_570);
    const P = { poster_fee_flat_cents: 70, platform_fee_percent: 5, customer_fee_amount: 5.7, helper_fee_flat_cents: 0, helper_fee_percent: 0, platform_fee_amount: 0 };
    expect(modelStamp).toMatchObject(P);
    expect(sessionStamp).toMatchObject(P);
    expect(args?.payment_intent_data.metadata).toMatchObject({ fee_model: "poster", service_fee_cents: "570", helper_fee_flat_cents: "0", customer_fee_percent: "5" });
    expect(key).toMatch(/-mposter-/);
  });

  it("switch ON: the fee covers the urgent bonus too (5% of budget + bonus, + 70c)", async () => {
    seed({ switchOn: true, budget: 100, extra: { is_urgent: true, urgent_fee: 20 } });
    const { res, args } = await escrow({ feeQuote: quote(12_000) });
    expect(res.status).toBe(200);
    expect(lineNamed(args, "Service fee")?.price_data.unit_amount).toBe(670);
  });

  it("the service fee is taxed like the job's labor: the labor code on a taxable category, non-taxable otherwise (tax memo)", async () => {
    const taxable = [...TAXABLE_CATEGORIES][0];
    expect(taxable).toBeTruthy();
    seed({ switchOn: true, category: taxable });
    let r = await escrow({ feeQuote: quote(10_000) });
    expect(r.res.status).toBe(200);
    expect(lineNamed(r.args, "Service fee")?.price_data.product_data.tax_code).toBe(TAXABLE_LABOR_TAX_CODE);
    seed({ switchOn: true, category: "cleaning" });
    r = await escrow({ feeQuote: quote(10_000) });
    expect(lineNamed(r.args, "Service fee")?.price_data.product_data.tax_code).toBe(NONTAXABLE_TAX_CODE);
  });

  const STALE: Array<[string, unknown]> = [
    ["no quote (an app built before the change)", undefined],
    ["a flat quote", buildFeeQuote({ switchOn: false, jobPriceCents: 10_000 })],
    ["a fee 1c low", { ...quote(10_000), serviceFeeCents: 569 }],
    ["a fee 1c high", { ...quote(10_000), serviceFeeCents: 571 }],
    ["an old price", quote(9_000)],
    ["a junk quote", "poster"],
  ];
  for (const [label, q] of STALE) {
    it(`switch ON: ${label} is refused before Stripe is called`, async () => {
      seed({ switchOn: true });
      const { res, payload } = await escrow(q === undefined ? {} : { feeQuote: q });
      expect(res.status).not.toBe(200);
      expect(payload.error).toBe(STALE_FEE_QUOTE_MESSAGE);
      expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    });
  }

  it("switch OFF: an app quoting the poster fee is refused (it showed a total the flat checkout would not charge)", async () => {
    seed({ switchOn: false });
    const { res, payload } = await escrow({ feeQuote: quote(10_000) });
    expect(res.status).not.toBe(200);
    expect(payload.error).toBe(STALE_FEE_QUOTE_MESSAGE);
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("a screen that shows no total (quote booking) sends the model only and is charged the poster fee", async () => {
    seed({ switchOn: true });
    const { res, args } = await escrow({ feeQuote: buildFeeQuote({ switchOn: true }) });
    expect(res.status).toBe(200);
    expect(lineNamed(args, "Service fee")?.price_data.unit_amount).toBe(570);
  });

  it("Pay in 4: 9% + 70c, Klarna and Afterpay only, no card options, no saved card", async () => {
    seed({ switchOn: true, budget: 100 });
    const { res, args, sessionStamp } = await escrow({ feeQuote: quote(10_000, true), payInFour: true, saveCardForFuture: true });
    expect(res.status).toBe(200);
    expect(lineNamed(args, "Service fee")?.price_data.unit_amount).toBe(970);
    expect(args?.payment_method_types).toEqual(["klarna", "afterpay_clearpay"]);
    expect(args?.payment_method_types).not.toContain("affirm");
    expect(args?.payment_method_options).toBeUndefined();
    expect(args?.payment_intent_data.setup_future_usage).toBeUndefined();
    expect(sessionStamp).toMatchObject({ platform_fee_percent: 9, customer_fee_amount: 9.7, poster_fee_flat_cents: 70 });
  });

  it("Pay in 4 is refused on the flat model (switch off)", async () => {
    seed({ switchOn: false });
    const { res, payload } = await escrow({ payInFour: true });
    expect(res.status).not.toBe(200);
    expect(payload.error).toBe(STALE_FEE_QUOTE_MESSAGE);
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("switch ON: a recurring series is on the poster-fee model (this checkout pays the first visit + its fee)", async () => {
    seed({ switchOn: true, extra: { recurrence_days: [1], recurrence_weeks: 4 } });
    const { res, args, modelStamp } = await escrow({ saveCardForFuture: true, feeQuote: quote(10_000) });
    expect(res.status).toBe(200);
    expect(lineNamed(args, "Service fee")?.price_data.unit_amount).toBe(570);
    expect(modelStamp).toMatchObject({ poster_fee_flat_cents: 70, platform_fee_percent: 5, helper_fee_flat_cents: 0, helper_fee_percent: 0 });
  });

  it("Pay in 4 is never offered on a recurring series (later visits need a saved card)", async () => {
    seed({ switchOn: true, extra: { recurrence_days: [1], recurrence_weeks: 4 } });
    const { res, payload, modelStamp } = await escrow({ saveCardForFuture: true, payInFour: true, feeQuote: quote(10_000, true) });
    expect(res.status).not.toBe(200);
    expect(String(payload.error)).toMatch(/Pay in 4 isn't available for a repeating job/);
    expect(modelStamp).toBeUndefined();
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  // Recurring review #4: the series check above reads the job once; a job
  // turned into a series after that read must not take a 9% stamp. The model
  // stamp re-asserts recurrence_days IS NULL on a Pay-in-4 checkout only.
  // @mutate supabase/functions/create-payment/index.ts | const oneOffWhenPayInFour = (q: any) => payInFour ? q.is("recurrence_days", null) : q; | const oneOffWhenPayInFour = (q: any) => q;
  it("a Pay-in-4 model stamp re-asserts the one-off shape it read (a series made meanwhile is not stamped 9%)", async () => {
    const stampFilters = () => scenario.writes
      .filter((w) => w.table === "jobs" && w.op === "update" && "helper_fee_flat_cents" in (w.payload as object) && !("stripe_session_id" in (w.payload as object)))
      .map((w) => w.filters);
    seed({ switchOn: true, budget: 100 });
    let r = await escrow({ feeQuote: quote(10_000, true), payInFour: true });
    expect(r.res.status).toBe(200);
    expect(stampFilters()[0]).toContainEqual(expect.objectContaining({ op: "is", column: "recurrence_days", value: null }));
    seed({ switchOn: true, budget: 100 });
    r = await escrow({ feeQuote: quote(10_000) });
    expect(r.res.status).toBe(200);
    expect(stampFilters()[0]).not.toContainEqual(expect.objectContaining({ column: "recurrence_days" }));
  });

  // Slice 4 refunds (owner-approved wording 2026-10-18: "the poster gets back
  // what they paid (tax included) less the card-processing cost"): a poster's
  // cancel of a paid poster-fee job keeps Stripe's card cost only, never the
  // whole 5% + 70c (posterCancelKeptFeeCents).
  // @mutate supabase/functions/create-payment/index.ts |           const serviceFeeCents = posterCancelKeptFeeCents(job); |           const serviceFeeCents = Math.round(Number(job.customer_fee_amount ?? 0) * 100);
  // @mutate supabase/functions/create-payment/index.ts | const serviceKept = isPosterFeeJob(job) \|\| cardCostFeeCents(job) > 0 ? 0 : Math.min(serviceFeeCents, feeKept); | const serviceKept = feeKept;
  it("cancel_escrow on a paid poster-fee job returns $105.70 less Stripe's card cost ($3.37), not less the $5.70 fee", async () => {
    resetSupabaseMock();
    scenario.authUser = POSTER;
    stripeMock.customers.list.mockResolvedValue({ data: [{ id: "cus_existing" }] });
    scenario.reads.jobs = {
      rows: [{
        id: "job-pf", customer_id: POSTER.id, status: "open", payment_status: "escrow", stripe_payment_intent_id: "pi_pf",
        budget: 100, customer_fee_amount: 5.7, poster_fee_flat_cents: 70, platform_fee_percent: 5, helper_fee_flat_cents: 0, helper_fee_percent: 0,
      }],
    };
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_pf", status: "succeeded", amount: 10_570, amount_received: 10_570 });
    stripeMock.refunds.create.mockResolvedValue({ id: "re_pf" });
    scenario.writeSelectRows.jobs = [{ id: "job-pf" }];
    const fn = await load();
    const res = await fn.fetch(fn.request({ headers: AUTH, body: { action: "cancel_escrow", jobId: "job-pf" } }));
    expect(res.status).toBe(200);
    // 2.9% of $105.70 + $0.30 = $3.37 kept; $102.33 back.
    expect(stripeMock.refunds.create).toHaveBeenCalledWith({ payment_intent: "pi_pf", amount: 10_233 }, { idempotencyKey: "cancel-escrow-job-pf" });
    // The ledger names what was kept: the card processing fee, not a service fee.
    const ledger = scenario.writes.find((w) => w.table === "payment_refunds");
    expect((ledger?.payload as { reason?: string } | undefined)?.reason).toBe("escrow cancellation refund (minus $3.37 card processing fee)");
  });

  // lh-money-escrow review 2026-10-25 #2: a flat-model job (platform_fee_percent
  // 0) paid its card cost as customer_fee_amount; the ledger and the notice
  // name it the card processing fee, never a service fee.
  // @mutate supabase/functions/create-payment/index.ts | const serviceKept = isPosterFeeJob(job) \|\| cardCostFeeCents(job) > 0 ? 0 : Math.min(serviceFeeCents, feeKept); | const serviceKept = isPosterFeeJob(job) ? 0 : Math.min(serviceFeeCents, feeKept);
  it("cancel_escrow on a flat-model job keeps its $1.06 card cost and calls it the card processing fee", async () => {
    resetSupabaseMock();
    scenario.authUser = POSTER;
    stripeMock.customers.list.mockResolvedValue({ data: [{ id: "cus_existing" }] });
    scenario.reads.jobs = {
      rows: [{
        id: "job-flat", customer_id: POSTER.id, status: "open", payment_status: "escrow", stripe_payment_intent_id: "pi_flat",
        budget: 25, customer_fee_amount: 1.06, platform_fee_percent: 0, helper_fee_flat_cents: 70, helper_fee_percent: 5, poster_fee_flat_cents: null,
      }],
    };
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_flat", status: "succeeded", amount: 2_606, amount_received: 2_606 });
    stripeMock.refunds.create.mockResolvedValue({ id: "re_flat", amount: 2_500 });
    scenario.writeSelectRows.jobs = [{ id: "job-flat" }];
    const fn = await load();
    const res = await fn.fetch(fn.request({ headers: AUTH, body: { action: "cancel_escrow", jobId: "job-flat" } }));
    expect(res.status).toBe(200);
    expect(stripeMock.refunds.create).toHaveBeenCalledWith({ payment_intent: "pi_flat", amount: 2_500 }, { idempotencyKey: "cancel-escrow-job-flat" });
    const ledger = scenario.writes.find((w) => w.table === "payment_refunds");
    expect((ledger?.payload as { reason?: string } | undefined)?.reason).toBe("escrow cancellation refund (minus $1.06 card processing fee)");
  });

  // Gift first (owner 2026-10-18; redeem_gift_card 20261018031451 prices the
  // stamped fee): a gift-funded checkout is on the poster-fee model too.
  it("switch ON: a fully gift-funded job is stamped on the poster-fee model before the gift pays (fee included)", async () => {
    seed({ switchOn: true });
    scenario.rpc.redeem_gift_card = { outcome: "settled" };
    const { res, payload, modelStamp } = await escrow({ giftCardId: "gift-1", feeQuote: quote(10_000) });
    expect(res.status).toBe(200);
    expect(String(payload.url)).toMatch(/payment-success/);
    expect(modelStamp).toMatchObject({ poster_fee_flat_cents: 70, platform_fee_percent: 5, customer_fee_amount: 5.7, helper_fee_flat_cents: 0, helper_fee_percent: 0 });
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  // @mutate supabase/functions/create-payment/index.ts | { customer_fee_amount: redeemFeeCents / 100 }); | { customer_fee_amount: 0 });
  it("switch ON: a gift shortfall keeps the fee stamp and says the rest includes the service fee", async () => {
    seed({ switchOn: true });
    // $100 job + $5.70 fee, $90 gift: $15.70 by card.
    scenario.rpc.redeem_gift_card = { outcome: "needs_payment", difference_cents: 1570, applied_cents: 9000, fee_cents: 570 };
    const { res, args, sessionStamp } = await escrow({ giftCardId: "gift-1", feeQuote: quote(10_000) });
    expect(res.status).toBe(200);
    expect(args?.line_items).toHaveLength(1);
    expect(args?.line_items[0].price_data.unit_amount).toBe(1570);
    expect(args?.line_items[0].price_data.product_data.description).toMatch(/including the service fee \(5% \+ \$0\.70/);
    expect(args?.payment_method_types).toEqual(["card", "link", "us_bank_account"]);
    expect(sessionStamp).toMatchObject({ customer_fee_amount: 5.7 });
  });

  // @mutate supabase/functions/create-payment/index.ts |         if (redeemFeeCents !== (isPosterFee ? posterFeeCents : 0)) { |         if (false) {
  it("a shortfall whose redeem priced another fee (a flat re-stamp, or the RPC before 20261018031451) is refused before Stripe", async () => {
    for (const fee_cents of [undefined, 0, 571]) {
      seed({ switchOn: true });
      scenario.rpc.redeem_gift_card = { outcome: "needs_payment", difference_cents: 1570, applied_cents: 9000, ...(fee_cents === undefined ? {} : { fee_cents }) };
      const { res, payload } = await escrow({ giftCardId: "gift-1", feeQuote: quote(10_000) });
      expect(res.status).not.toBe(200);
      expect(String(payload.error)).toMatch(/changed while checkout was opening/);
      expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    }
  });

  it("switch ON: a flat-quoting (stale) app redeeming a gift is refused before any write", async () => {
    seed({ switchOn: true });
    scenario.rpc.redeem_gift_card = { outcome: "settled" };
    const { res, payload, modelStamp } = await escrow({
      giftCardId: "gift-1",
      feeQuote: buildFeeQuote({ switchOn: false, jobPriceCents: 10_000 }),
    });
    expect(res.status).not.toBe(200);
    expect(payload.error).toBe(STALE_FEE_QUOTE_MESSAGE);
    expect(modelStamp).toBeUndefined();
  });

  // @mutate supabase/functions/create-payment/index.ts |       if (payInFour && giftCardId) throw | if (false) throw
  it("Pay in 4 is never combined with a gift card", async () => {
    seed({ switchOn: true });
    scenario.rpc.redeem_gift_card = { outcome: "needs_payment", difference_cents: 1970, applied_cents: 9000 };
    const { res, payload, modelStamp } = await escrow({ giftCardId: "gift-1", payInFour: true, feeQuote: quote(10_000, true) });
    expect(res.status).not.toBe(200);
    expect(String(payload.error)).toMatch(/Pay in 4 can't be combined with a gift card/);
    expect(modelStamp).toBeUndefined();
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("switch OFF: the new app's flat quote (urgent bonus included) is charged; a flat quote at another price is refused (review #7b)", async () => {
    seed({ switchOn: false, budget: 100, extra: { is_urgent: true, urgent_fee: 20 } });
    const flat = (jobPriceCents: number) => buildFeeQuote({ switchOn: false, jobPriceCents });
    let r = await escrow({ feeQuote: flat(12_000) });
    expect(r.res.status).toBe(200);
    expect(lineNamed(r.args, "Service fee")).toBeUndefined();
    seed({ switchOn: false, budget: 100, extra: { is_urgent: true, urgent_fee: 20 } });
    r = await escrow({ feeQuote: flat(10_000) });
    expect(r.res.status).not.toBe(200);
    expect(r.payload.error).toBe(STALE_FEE_QUOTE_MESSAGE);
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  // @mutate supabase/functions/create-payment/index.ts |                 ...(job.poster_fee_flat_cents != null ? { poster_fee_flat_cents: null } : {}), |                 ...({}),
  it("switch OFF after an unpaid poster-fee attempt: the flat re-mint clears the poster stamp and the poster side (review #4, #6)", async () => {
    seed({ switchOn: false, extra: { poster_fee_flat_cents: 70, helper_fee_flat_cents: 0, helper_fee_percent: 0, platform_fee_percent: 5, customer_fee_amount: 5.7 } });
    const { res, modelStamp, sessionStamp } = await escrow();
    expect(res.status).toBe(200);
    expect(modelStamp).toMatchObject({ poster_fee_flat_cents: null, helper_fee_flat_cents: 70, helper_fee_percent: 5, platform_fee_percent: 0, customer_fee_amount: 0 });
    expect(sessionStamp).toMatchObject({ poster_fee_flat_cents: null, helper_fee_flat_cents: 70, customer_fee_amount: 0 });
  });

  // @mutate supabase/functions/create-payment/index.ts |           .or(previousSessionId\n            ? `stripe_session_id.is.null,stripe_session_id.eq.${previousSessionId}`\n            : "stripe_session_id.is.null") |           .or("payment_status.is.null")
  it("the model stamp is guarded on the checkout this request read (review #1)", async () => {
    seed({ switchOn: true });
    await escrow({ feeQuote: quote(10_000) });
    const w = scenario.writes.find((x) => x.table === "jobs" && x.op === "update" && "helper_fee_flat_cents" in (x.payload as object) && !("stripe_session_id" in (x.payload as object)));
    expect(JSON.stringify(w?.filters)).toContain("stripe_session_id.is.null");
  });

  // @mutate supabase/functions/create-payment/index.ts |           if (!sameModel) throw new PublicError("This job changed while checkout was opening."); |
  it("a concurrent tap on the SAME model goes on (one session); one on the OTHER model is refused (review #1)", async () => {
    for (const [held, ok] of [[{ poster_fee_flat_cents: 70, helper_fee_flat_cents: 0 }, true], [{ poster_fee_flat_cents: null, helper_fee_flat_cents: 70 }, false]] as const) {
      seed({ switchOn: true });
      scenario.reads.jobs = {
        ...scenario.reads.jobs,
        selectOverrides: [{ includes: "status, payment_status", result: { rows: [{ id: "job-pf", status: "open", payment_status: "unpaid", budget: 100, urgent_fee: null, is_urgent: false, ...held }] } }],
      };
      scenario.writeOverrides = [{ table: "jobs", op: "update", when: (p: Record<string, unknown>) => "helper_fee_flat_cents" in p && !("stripe_session_id" in p), rows: [] }];
      const { res, payload } = await escrow({ feeQuote: quote(10_000) });
      if (ok) {
        expect(res.status, JSON.stringify(payload)).toBe(200);
      } else {
        expect(res.status).not.toBe(200);
        expect(String(payload.error)).toMatch(/changed while checkout was opening/);
        expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
      }
    }
  });

  it("Pay in 4 on a $300+ job: still no card options (3D Secure would apply to a card checkout) (review #7a)", async () => {
    seed({ switchOn: true, budget: 400 });
    const { res, args } = await escrow({ feeQuote: quote(40_000, true), payInFour: true });
    expect(res.status).toBe(200);
    expect(args?.payment_method_options).toBeUndefined();
    seed({ switchOn: true, budget: 400 });
    const card = await escrow({ feeQuote: quote(40_000) });
    expect(card.args?.payment_method_options).toEqual({ card: { request_three_d_secure: "any" } });
  });

  // @mutate supabase/functions/create-payment/index.ts |             + (isPosterFee && laborTaxable ? salesTaxCeilingCents(posterFeeCents, job.category) : 0) |             + 0
  it("the 3D Secure ceiling counts the tax on a taxable job's service fee (review #7d)", async () => {
    const taxable = [...TAXABLE_CATEGORIES][0];
    // A budget whose lines + labor-tax ceiling sit under $300 and cross it only with the fee's tax.
    const fee = (b: number) => Math.round(b * 5) + 70;
    const ceil15 = (c: number) => Math.ceil(c * 0.15);
    const budget = Array.from({ length: 100 }, (_, i) => 200 + i).find((b) => {
      const c = b * 100;
      return c + fee(b) + ceil15(c) < 30_000 && c + fee(b) + ceil15(c) + ceil15(fee(b)) >= 30_000;
    });
    expect(budget).toBeDefined();
    seed({ switchOn: true, category: taxable, budget });
    const { res, args } = await escrow({ feeQuote: quote(budget! * 100) });
    expect(res.status).toBe(200);
    expect(args?.payment_method_options).toEqual({ card: { request_three_d_secure: "any" } });
  });
});
