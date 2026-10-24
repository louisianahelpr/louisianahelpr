/**
 * PayPal phase 3: create-payment routes `escrow` by the paypal_payments switch, and the PayPal
 * path (supabase/functions/create-payment/paypalEscrow.ts) opens a PayPal order instead of a
 * Stripe Checkout Session.
 *
 *  - switch OFF (as created) or unreadable: the Stripe path, exactly as before.
 *  - switch ON: no Stripe call; the job is stamped 8% + $0.70 (lead 2026-10-23, pp-phase5) with
 *    the poster paying the job price; the order is POSTed with a key that names the job, the
 *    amount and the attempt; the answer is PayPal's approve link.
 *  - refused on PayPal, before any PayPal call: a taxable category (no tax rate source yet,
 *    option A), a gift card, Pay in 4, a repeating job, a job carrying a Stripe payment.
 *  - `paypal_capture` (the return page) is 403 with the switch off, and only the poster's.
 *
 * @mutate supabase/functions/create-payment/index.ts |       : action === "escrow" && await payPalPaymentsOn(supabaseAdmin, user) ? "escrow" : null; |       : null;
 * @mutate supabase/functions/create-payment/paypalEscrow.ts |   if (!tax.ok) throw new PublicError(PAYPAL_TAXABLE_CATEGORY_MESSAGE); |   void tax;
 * @mutate supabase/functions/create-payment/paypalEscrow.ts |   if (giftCardId) throw new PublicError | if (false) throw new PublicError
 * @mutate supabase/functions/create-payment/paypalEscrow.ts |   if (job.recurrence_days != null) throw | if (false) throw
 * @mutate supabase/functions/create-payment/paypalEscrow.ts |   if (job.stripe_payment_intent_id) { |   if (false) {
 * @mutate supabase/functions/create-payment/paypalEscrow.ts |   const refused = await requireFeature(db, PAYPAL_SWITCH, user, corsHeaders);\n  if (refused) return refused; |   const refused = null;
 * @mutate supabase/functions/create-payment/paypalEscrow.ts |     : { helper_fee_flat_cents: PAYPAL_HELPR_FEE_CENTS, helper_fee_percent: PAYPAL_HELPR_FEE_PERCENT }; |     : { helper_fee_flat_cents: 70, helper_fee_percent: 5 };
 * @mutate supabase/functions/create-payment/paypalEscrow.ts |   if (job.customer_id !== user.id) throw new PublicError("Not authorized");\n  const review | const review
 * @mutate supabase/functions/create-payment/paypalEscrow.ts |   if (!current && state?.captured_any !== true) return null; |   if (!current) return null;
 * @mutate supabase/functions/create-payment/paypalEscrow.ts |   if (!(await mayAskAboutJob(db, user, action, jobId))) throw new PublicError("Not authorized"); |
 * @mutate supabase/functions/create-payment/paypalEscrow.ts |       actualFeeCents: paypalFeeCents, |       actualFeeCents: 0,
 * @mutate supabase/functions/create-payment/paypalEscrow.ts |     if (e instanceof ProviderApiError && (e.retryable \|\| e.issue === "PREVIOUS_REQUEST_IN_PROGRESS")) { |     if (false) {
 * @mutate supabase/functions/create-payment/paypalEscrow.ts |     if ((error as { code?: string }).code === "PGRST202") return null; |     return null;
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { PAYPAL_TAXABLE_CATEGORY_MESSAGE } from "../../../supabase/functions/_shared/jobSalesTax";
import { posterCancelSplit } from "../../../supabase/functions/_shared/posterCancelSplit";

const AUTH = { Authorization: "Bearer test-jwt" };
const POSTER = { id: "poster-1", email: "poster@test.com" };

interface PayPalCall { method: string; url: string; requestId: string | null; body: any }
let paypal: PayPalCall[] = [];
const realFetch = globalThis.fetch;

function installPayPal() {
  paypal = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.includes("paypal.com")) return realFetch(input, init);
    const h = new Headers(init?.headers);
    const body = typeof init?.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : init?.body;
    paypal.push({ method: init?.method ?? "GET", url, requestId: h.get("PayPal-Request-Id"), body });
    if (url.endsWith("/v1/oauth2/token")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
    if (url.endsWith("/v2/checkout/orders") && init?.method === "POST") {
      return new Response(JSON.stringify({ id: "ORDERPP1", status: "PAYER_ACTION_REQUIRED", links: [{ rel: "payer-action", href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDERPP1" }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ name: "RESOURCE_NOT_FOUND" }), { status: 404 });
  }) as typeof fetch;
}

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc123",
    PAYPAL_ENV: "sandbox",
    PAYPAL_CLIENT_ID: "client-id",
    PAYPAL_CLIENT_SECRET: "client-secret",
  });
  return loadEdgeFunction("create-payment");
}

function seed(opts: { switchOn?: boolean | "error"; job?: Record<string, unknown>; onboardingPaid?: boolean } = {}) {
  resetSupabaseMock();
  scenario.authUser = POSTER;
  stripeMock.customers.list.mockResolvedValue({ data: [{ id: "cus_existing" }] });
  stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_x", url: "https://checkout.stripe.test/cs_x" });
  scenario.reads.jobs = {
    rows: [{ id: "5a5a5a5a-0000-4000-8000-0000000000aa", customer_id: POSTER.id, budget: 100, category: "cleaning", title: "PayPal job", status: "open", payment_status: "unpaid", ...(opts.job ?? {}) }],
  };
  scenario.reads.platform_settings = { rows: [{ customer_fee_percent: 10, helper_fee_percent: 12, onboarding_fee_cents: 200 }] };
  scenario.reads.profiles = { rows: [{ onboarding_fee_paid: opts.onboardingPaid ?? true }] };
  if (opts.switchOn === "error") scenario.rpcErrors = { feature_enabled_for_user: { message: "boom" } };
  else scenario.rpc.feature_enabled_for_user = (a?: unknown) => opts.switchOn === true && (a as { p_key?: string })?.p_key === "paypal_payments";
  scenario.rpc.paypal_job_payment_state = { attempts: 0, current: null };
  scenario.rpc.paypal_job_order_open = (a?: unknown) => {
    const x = a as Record<string, unknown>;
    return { id: "pp-1", subject_id: x.p_job_id, payer_id: x.p_payer_id, env: x.p_env, status: "created", provider_order_id: x.p_order_id, provider_capture_id: null, amount_cents: x.p_amount_cents, idempotency_key: x.p_idempotency_key, breakdown: x.p_breakdown };
  };
}

async function call(body: Record<string, unknown>) {
  const fn = await load();
  const res = await fn.fetch(fn.request({ headers: AUTH, body }));
  const payload = JSON.parse(await res.text()) as Record<string, unknown>;
  const jobUpdates = scenario.writes.filter((w) => w.table === "jobs" && w.op === "update").map((w) => w.payload as Record<string, unknown>);
  const orderPost = paypal.find((c) => c.method === "POST" && c.url.endsWith("/v2/checkout/orders"));
  return { res, payload, jobUpdates, orderPost };
}
const escrow = (extra: Record<string, unknown> = {}) => call({ action: "escrow", jobId: "5a5a5a5a-0000-4000-8000-0000000000aa", ...extra });

describe("create-payment escrow routed by paypal_payments (PayPal phase 3)", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
    installPayPal();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  for (const sw of [false, "error"] as const) {
    it(`switch ${sw === false ? "OFF" : "unreadable"}: the Stripe path, no PayPal call`, async () => {
      seed({ switchOn: sw });
      const { res, payload } = await escrow();
      expect(res.status).toBe(200);
      expect(payload.url).toBe("https://checkout.stripe.test/cs_x");
      expect(stripeMock.checkout.sessions.create).toHaveBeenCalledTimes(1);
      expect(paypal).toEqual([]);
    });
  }

  it("switch ON: a PayPal order, no Stripe call, the approve link back", async () => {
    seed({ switchOn: true });
    const { res, payload, orderPost, jobUpdates } = await escrow();
    expect(res.status).toBe(200);
    expect(payload).toEqual({ url: "https://www.sandbox.paypal.com/checkoutnow?token=ORDERPP1", provider: "paypal" });
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    expect(orderPost?.requestId).toBe("lh:job:5a5a5a5a-0000-4000-8000-0000000000aa:checkout:amt10000:a1");
    expect(orderPost?.body.intent).toBe("CAPTURE");
    expect(orderPost?.body.purchase_units[0].amount).toEqual({
      currency_code: "USD", value: "100.00",
      breakdown: { item_total: { currency_code: "USD", value: "100.00" }, tax_total: { currency_code: "USD", value: "0.00" } },
    });
    expect(orderPost?.body.purchase_units[0].custom_id).toBe("job_5a5a5a5a-0000-4000-8000-0000000000aa");
    expect(orderPost?.body.payment_source.paypal.experience_context.return_url).toMatch(/\/payment-success\?job_id=5a5a5a5a-0000-4000-8000-0000000000aa&provider=paypal$/);
    expect(orderPost?.body.payment_source.paypal.experience_context).toMatchObject({ payment_method_preference: "IMMEDIATE_PAYMENT_REQUIRED", brand_name: "Louisiana Helpr" });
    // The Helpr pays 8% + 70c; the poster pays the job price.
    expect(jobUpdates[0]).toMatchObject({ helper_fee_flat_cents: 70, helper_fee_percent: 8, customer_fee_amount: 0, platform_fee_amount: 8.7 });
    const open = scenario.rpcCalls?.find((c) => c.name === "paypal_job_order_open")?.args as Record<string, any>;
    expect(open).toMatchObject({ p_job_id: "5a5a5a5a-0000-4000-8000-0000000000aa", p_payer_id: POSTER.id, p_order_id: "ORDERPP1", p_amount_cents: 10000, p_env: "sandbox" });
    expect(open.p_breakdown).toMatchObject({ item_cents: 10000, tax_cents: 0, helper_fee_percent: 8, helper_fee_flat_cents: 70 });
  });

  it("switch ON: a job already stamped by the PayPal post keeps its stamp", async () => {
    seed({ switchOn: true, job: { helper_fee_flat_cents: 70, helper_fee_percent: 8 } });
    const { jobUpdates } = await escrow();
    expect(jobUpdates[0]).not.toHaveProperty("helper_fee_flat_cents");
    expect(jobUpdates[0]).toMatchObject({ platform_fee_amount: 8.7, customer_fee_amount: 0 });
  });

  it("switch ON: a Stripe-era poster-fee stamp is replaced by 8/70 (the PayPal path has no poster fee)", async () => {
    seed({ switchOn: true, job: { poster_fee_flat_cents: 70, helper_fee_flat_cents: 0, helper_fee_percent: 0 } });
    const { jobUpdates } = await escrow();
    expect(jobUpdates[0]).toMatchObject({ poster_fee_flat_cents: null, helper_fee_flat_cents: 70, helper_fee_percent: 8, customer_fee_amount: 0 });
  });

  it("switch ON: the one-time setup fee is part of the order on a first job", async () => {
    seed({ switchOn: true, onboardingPaid: false });
    const { orderPost } = await escrow();
    expect(orderPost?.requestId).toBe("lh:job:5a5a5a5a-0000-4000-8000-0000000000aa:checkout:amt10200:a1");
    expect(orderPost?.body.purchase_units[0].amount.value).toBe("102.00");
  });

  const refusals: Array<[string, Parameters<typeof seed>[0], Record<string, unknown>, RegExp]> = [
    ["a taxable category (no tax rate source yet)", { job: { category: "assembly" } }, {}, new RegExp(PAYPAL_TAXABLE_CATEGORY_MESSAGE.slice(0, 40))],
    ["a gift card", {}, { giftCardId: "gift-1" }, /Gift cards can't be used with PayPal/],
    ["Pay in 4", {}, { payInFour: true }, /Pay in 4 isn't available with PayPal/],
    ["a repeating job", { job: { recurrence_days: [1, 3] } }, {}, /Repeating jobs can't be paid with PayPal/],
    ["a job carrying a Stripe payment", { job: { stripe_payment_intent_id: "pi_123" } }, {}, /previous payment processor/],
    ["someone else's job", { job: { customer_id: "other" } }, {}, /Not authorized/],
    ["a closed job", { job: { status: "completed" } }, {}, /closed/],
    ["a funded job", { job: { payment_status: "escrow" } }, {}, /already been processed/],
  ];
  for (const [label, s, body, re] of refusals) {
    it(`switch ON: refuses ${label} before any PayPal call`, async () => {
      seed({ switchOn: true, ...s, job: { ...(s?.job ?? {}) } });
      const { payload } = await escrow(body);
      expect(String(payload.error)).toMatch(re);
      expect(paypal.filter((c) => c.url.includes("/v2/"))).toEqual([]);
      expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    });
  }

  it("paypal_capture is 403 with the switch off and never reaches PayPal", async () => {
    seed({ switchOn: false });
    const { res, payload } = await call({ action: "paypal_capture", jobId: "5a5a5a5a-0000-4000-8000-0000000000aa" });
    expect(res.status).toBe(403);
    expect(payload).toEqual({ error: "feature_disabled" });
    expect(paypal).toEqual([]);
  });

  it("paypal_capture is the poster's only", async () => {
    seed({ switchOn: true, job: { customer_id: "other" } });
    const { payload } = await call({ action: "paypal_capture", jobId: "5a5a5a5a-0000-4000-8000-0000000000aa" });
    expect(String(payload.error)).toMatch(/Not authorized/);
    expect(paypal).toEqual([]);
  });

  for (const action of ["cancel_escrow", "release", "tip", "admin_refund_general", "escrow", "request_revision"]) {
    it(`a Stripe-era ${action} on a job with a PayPal payment is refused before it runs`, async () => {
      seed({ switchOn: false });
      scenario.rpc.paypal_job_payment_state = { attempts: 1, current: { status: "captured" } };
      const { res, payload } = await call({ action, jobId: "5a5a5a5a-0000-4000-8000-0000000000aa" });
      expect(res.status).toBe(409);
      expect(String(payload.error)).toMatch(/payment is through PayPal/);
      expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    });
  }

  it("cancel_quote on a PayPal-paid job quotes from the PayPal capture by the same split (PayPal keeps its fee)", async () => {
    seed({ switchOn: true, job: { payment_status: "escrow", date_needed: "2099-01-01", start_time: "10:00", helper_fee_flat_cents: 70, helper_fee_percent: 8 } });
    const row = { id: "pp-1", status: "captured", amount_cents: 10000, breakdown: { paypal_fee_cents: 398, tax_cents: 0 } };
    scenario.rpc.paypal_job_payment_state = { attempts: 1, current: row };
    scenario.reads.provider_refunds = { rows: [] };
    const { res, payload } = await call({ action: "cancel_quote", jobId: "5a5a5a5a-0000-4000-8000-0000000000aa" });
    expect(res.status).toBe(200);
    const expected = posterCancelSplit({
      job: scenario.reads.jobs!.rows![0] as never, sellerFault: false, cancellationFeeCents: 0, blockFeeCents: 0,
      charge: { state: "captured", capturedCents: 10000, actualFeeCents: 398, alreadyRefundedCents: 0, taxCents: 0 },
    });
    expect(payload).toMatchObject({ can_cancel: true, fee_cents: 0, unquoted_reason: null, charge_state: "captured", back_to_you_cents: (expected as { backCents: number }).backCents });
    expect(payload.back_to_you_cents).toBeGreaterThan(0);
    expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(paypal).toEqual([]);
  });

  it("cancel_quote on a PayPal job without PayPal's fee on record shows no number", async () => {
    seed({ switchOn: true, job: { payment_status: "escrow", date_needed: "2099-01-01" } });
    scenario.rpc.paypal_job_payment_state = { attempts: 1, current: { id: "pp-1", status: "captured", amount_cents: 10000, breakdown: {} } };
    const { payload } = await call({ action: "cancel_quote", jobId: "5a5a5a5a-0000-4000-8000-0000000000aa" });
    expect(payload).toMatchObject({ can_cancel: true, back_to_you_cents: null, unquoted_reason: "unreadable" });
  });

  it("a NON-party naming a PayPal job gets the actions' own 'Not authorized', never the PayPal answer (no tester oracle)", async () => {
    seed({ switchOn: false, job: { customer_id: "someone-else", helper_id: null } });
    scenario.rpc.paypal_job_payment_state = { attempts: 1, current: { status: "captured" } };
    const { payload } = await call({ action: "request_revision", jobId: "5a5a5a5a-0000-4000-8000-0000000000aa" });
    expect(String(payload.error)).toMatch(/Not authorized/);
    expect(String(payload.error)).not.toMatch(/PayPal/);
  });

  it("a job whose only PayPal money is an orphan capture is still refused for Stripe-era actions", async () => {
    seed({ switchOn: false });
    scenario.rpc.paypal_job_payment_state = { attempts: 1, current: null, captured_any: true };
    const { res } = await call({ action: "cancel_escrow", jobId: "5a5a5a5a-0000-4000-8000-0000000000aa" });
    expect(res.status).toBe(409);
  });

  it("the PayPal check failing refuses the Stripe action; a missing function (before the migration) lets it run", async () => {
    seed({ switchOn: false });
    scenario.rpcErrors = { paypal_job_payment_state: { message: "boom" } };
    expect((await call({ action: "cancel_escrow", jobId: "5a5a5a5a-0000-4000-8000-0000000000aa" })).res.status).toBe(503);
    seed({ switchOn: false });
    scenario.rpcErrors = { paypal_job_payment_state: { message: "not found", code: "PGRST202" } };
    expect((await escrow()).res.status).toBe(200);
  });

  it("paypal_capture while PayPal is busy with the same capture answers processing (the webhook finishes it)", async () => {
    seed({ switchOn: true });
    scenario.rpc.paypal_job_payment_state = { attempts: 1, current: { id: "pp-1", subject_id: "5a5a5a5a-0000-4000-8000-0000000000aa", payer_id: POSTER.id, env: "sandbox", status: "created", provider_order_id: "ORDERPP1", provider_capture_id: null, amount_cents: 10000, idempotency_key: "k", breakdown: null } };
    scenario.rpc.paypal_job_capture_claim = { ok: true, reason: "claimed" };
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/oauth2/token")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
      if (url.endsWith("/capture")) return new Response(JSON.stringify({ name: "RESOURCE_CONFLICT", details: [{ issue: "PREVIOUS_REQUEST_IN_PROGRESS" }] }), { status: 409 });
      if (init?.method === undefined || init.method === "GET") return new Response(JSON.stringify({ id: "ORDERPP1", status: "APPROVED", purchase_units: [{ amount: { currency_code: "USD", value: "100.00" } }] }), { status: 200 });
      return realFetch(input, init);
    }) as typeof fetch;
    const { res, payload } = await call({ action: "paypal_capture", jobId: "5a5a5a5a-0000-4000-8000-0000000000aa" });
    expect(res.status).toBe(200);
    expect(payload).toEqual({ status: "processing" });
  });

  it("paypal_capture with no PayPal payment on the job says so", async () => {
    seed({ switchOn: true });
    const { res, payload } = await call({ action: "paypal_capture", jobId: "5a5a5a5a-0000-4000-8000-0000000000aa" });
    expect(res.status).toBe(200);
    expect(payload).toEqual({ status: "none" });
  });
});
