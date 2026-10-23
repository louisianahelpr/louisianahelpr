/**
 * PayPal provider adapters (PayPal Plan A phase 1): money-in (paypalCheckout.ts)
 * and the SEPARATE money-out seam (paypalPayouts.ts; owner 2026-10-23: live
 * PayPal Payouts was denied, so the payout leg must be swappable on its own).
 * Response shapes are the ones the sandbox returned on 2026-10-23
 * (~/.lh-shots/paypal-design/).
 *
 * @mutate supabase/functions/_shared/payments/paypalPayouts.ts | if (e instanceof ProviderApiError && e.httpStatus === 400 && /sender_batch_id already exists/i.test(e.message)) { | if (false) {
 * @mutate supabase/functions/_shared/payments/paypalPayouts.ts | const MAX_ITEMS = 1; | const MAX_ITEMS = 2;
 * @mutate supabase/functions/_shared/payments/paypalPayouts.ts | if (!original) throw new Error(`paypal_duplicate_batch_unlinked: ${batchKey}`); | if (!original) return { providerBatchId: "", batchStatus: "DUPLICATE", duplicate: true };
 * @mutate supabase/functions/_shared/payments/paypalCheckout.ts | if (!key.split(":").includes(`amt${amountCents}`)) { | if (!key.includes(String(amountCents))) {
 * @mutate supabase/functions/_shared/payments/paypalCheckout.ts | if (cap.status !== "COMPLETED" && cap.status !== "PENDING") { | if (false) {
 * @mutate supabase/functions/_shared/payments/registry.ts | if (id === "stripe") throw new Error("provider_retired: stripe");\n  throw new Error(`unknown_payment_provider: ${id}`); | throw new Error(`unknown_payment_provider: ${id}`);
 * @mutate supabase/functions/_shared/payments/types.ts | return Number(whole) * 100 + Number((frac + "00").slice(0, 2)); | return Math.round(Number(value) * 100) + 1;
 */
import { describe, expect, it } from "vitest";
import { PayPalClient } from "../../supabase/functions/_shared/payments/paypalClient.ts";
import { captureFromOrder, createPayPalCheckoutProvider } from "../../supabase/functions/_shared/payments/paypalCheckout.ts";
import { createPayPalPayoutsProvider, isValidBatchKey } from "../../supabase/functions/_shared/payments/paypalPayouts.ts";
import { parseProviderEnv, paymentProviderFor, payoutProviderFor } from "../../supabase/functions/_shared/payments/registry.ts";
import { centsToDollars, dollarsToCents } from "../../supabase/functions/_shared/payments/types.ts";

interface Call { url: string; init: RequestInit }
function client(responses: Array<{ status: number; body: unknown }>) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith("/v1/oauth2/token")) return new Response(JSON.stringify({ access_token: "t", expires_in: 30000 }), { status: 200 });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected ${url}`);
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as unknown as typeof fetch;
  return { calls, c: new PayPalClient({ env: "sandbox", clientId: "id", clientSecret: "s", fetchImpl }) };
}
const body = (c: Call) => JSON.parse(String(c.init.body));
const header = (c: Call, k: string) => (c.init.headers as Record<string, string>)[k];

// Shape of ~/.lh-shots/paypal-design/01-order-card-capture.json
const CAPTURED_ORDER = {
  id: "8TW12390J27733006", status: "COMPLETED",
  purchase_units: [{ payments: { captures: [{
    id: "54X10121KX896733B", status: "COMPLETED", amount: { currency_code: "USD", value: "105.70" },
    seller_receivable_breakdown: { paypal_fee: { currency_code: "USD", value: "3.23" } },
  }] } }],
};

describe("money helpers", () => {
  it("cents <-> dollars are exact", () => {
    expect(dollarsToCents("105.70")).toBe(10570);
    expect(dollarsToCents("0.07")).toBe(7);
    expect(dollarsToCents("3")).toBe(300);
    expect(centsToDollars(10570)).toBe("105.70");
    expect(centsToDollars(7)).toBe("0.07");
    expect(() => dollarsToCents("1.234")).toThrow();
    expect(() => centsToDollars(1.5)).toThrow();
  });
});

describe("paypal_checkout (money in)", () => {
  it("createCheckout: CAPTURE intent, our reference echoed, breakdown must add up, keyed write", async () => {
    const { calls, c } = client([{ status: 200, body: { id: "O9", status: "PAYER_ACTION_REQUIRED", links: [{ rel: "payer-action", href: "https://www.sandbox.paypal.com/checkoutnow?token=O9" }] } }]);
    const p = createPayPalCheckoutProvider(c);
    const r = await p.createCheckout({
      idempotencyKey: "lh:job:J1:checkout:amt10570:a1", referenceId: "job_J1", amountCents: 10570, itemTotalCents: 10000, taxTotalCents: 570,
      returnUrl: "https://louisianahelpr.com/payment-success?job_id=J1", cancelUrl: "https://louisianahelpr.com/posts",
    });
    expect(r).toEqual({ providerOrderId: "O9", approveUrl: "https://www.sandbox.paypal.com/checkoutnow?token=O9", status: "PAYER_ACTION_REQUIRED" });
    const b = body(calls[1]);
    expect(b.intent).toBe("CAPTURE");
    expect(b.purchase_units[0]).toMatchObject({ reference_id: "job_J1", custom_id: "job_J1", amount: { currency_code: "USD", value: "105.70" } });
    expect(b.purchase_units[0].amount.breakdown).toEqual({ item_total: { currency_code: "USD", value: "100.00" }, tax_total: { currency_code: "USD", value: "5.70" } });
    expect(header(calls[1], "PayPal-Request-Id")).toBe("lh:job:J1:checkout:amt10570:a1");
    // A key that does not name the amount could replay an old price: refused before any request.
    await expect(p.createCheckout({ idempotencyKey: "lh:job:J1:checkout:10570:1", referenceId: "job_J1", amountCents: 10570, returnUrl: "x", cancelUrl: "y" })).rejects.toThrow(/must name the amount/);
    // amount 1, attempt 1: a bare "1" part must not pass for the amount
    await expect(p.createCheckout({ idempotencyKey: "lh:job:J1:checkout:1", referenceId: "job_J1", amountCents: 1, returnUrl: "x", cancelUrl: "y" })).rejects.toThrow(/must name the amount/);
    await expect(p.createCheckout({ idempotencyKey: "lh:job:J1:checkout:amt105700:a1", referenceId: "job_J1", amountCents: 10570, returnUrl: "x", cancelUrl: "y" })).rejects.toThrow(/must name the amount/);
    await expect(p.createCheckout({ idempotencyKey: "k:amt100", referenceId: "r", amountCents: 100, itemTotalCents: 90, returnUrl: "x", cancelUrl: "y" })).rejects.toThrow(/must equal/);
    await expect(p.createCheckout({ idempotencyKey: "k", referenceId: "r", amountCents: 0, returnUrl: "x", cancelUrl: "y" })).rejects.toThrow(/positive/);
  });

  it("capture reads the capture id, cents and PayPal's fee from the sandbox shape", async () => {
    expect(captureFromOrder(CAPTURED_ORDER as never)).toEqual({
      providerOrderId: "8TW12390J27733006", providerCaptureId: "54X10121KX896733B", status: "COMPLETED",
      settled: true, amountCents: 10570, feeCents: 323, vaultId: null,
    });
    // A 201 is not a payment: DECLINED throws; PENDING is not settled (not funded).
    const declined = structuredClone(CAPTURED_ORDER);
    declined.purchase_units[0].payments.captures[0].status = "DECLINED";
    expect(() => captureFromOrder(declined as never)).toThrow(/capture_not_successful/);
    try { captureFromOrder(declined as never); } catch (e) { expect(e).toMatchObject({ errorName: "CAPTURE_NOT_SUCCESSFUL", issue: "DECLINED", retryable: false }); }
    const pending = structuredClone(CAPTURED_ORDER);
    pending.status = "PENDING" as never;
    pending.purchase_units[0].payments.captures[0].status = "PENDING";
    expect(captureFromOrder(pending as never)).toMatchObject({ status: "PENDING", settled: false });
    const orderNotDone = structuredClone(CAPTURED_ORDER);
    orderNotDone.status = "APPROVED";
    expect(() => captureFromOrder(orderNotDone as never)).toThrow(/while its capture is COMPLETED/);
    expect(() => captureFromOrder({ id: "O", status: "CREATED" } as never)).toThrow(/0 purchase units/);
    expect(() => captureFromOrder({ id: "O", status: "CREATED", purchase_units: [{}] } as never)).toThrow(/0 captures/);
    const { c } = client([]);
    await expect(createPayPalCheckoutProvider(c).capture("k", "../admin")).rejects.toThrow(/not a PayPal order id/);
  });

  it("chargeSaved is a merchant-initiated card charge (the sandbox needed payment_type)", async () => {
    const { calls, c } = client([{ status: 201, body: CAPTURED_ORDER }]);
    await createPayPalCheckoutProvider(c).chargeSaved({ idempotencyKey: "lh:visit:V1:charge:amt4000:a1", referenceId: "visit_V1", vaultId: "6pa37340nx108405w", amountCents: 4000 });
    expect(body(calls[1]).payment_source.card).toEqual({
      vault_id: "6pa37340nx108405w",
      stored_credential: { payment_initiator: "MERCHANT", payment_type: "UNSCHEDULED", usage: "SUBSEQUENT" },
    });
  });

  it("refund sends cents as dollars on the capture, keyed", async () => {
    const { calls, c } = client([{ status: 201, body: { id: "7SV12871VE8231131", status: "COMPLETED", amount: { currency_code: "USD", value: "26.43" } } }]);
    const r = await createPayPalCheckoutProvider(c).refund({ idempotencyKey: "lh:refund:R1", providerCaptureId: "54X10121KX896733B", amountCents: 2643 });
    expect(r).toEqual({ providerRefundId: "7SV12871VE8231131", status: "COMPLETED", settled: true, amountCents: 2643 });
    expect(new URL(calls[1].url).pathname).toBe("/v2/payments/captures/54X10121KX896733B/refund");
    expect(body(calls[1]).amount).toEqual({ currency_code: "USD", value: "26.43" });
  });
});

describe("paypal_payouts (money out, its own seam)", () => {
  const item = { senderItemId: "pp_1", destination: { kind: "paypal_payer_id" as const, value: "ABCDEFG123" }, amountCents: 9255, note: "Job payout" };

  it("pays by payer id; sender_batch_id and PayPal-Request-Id both come from our batch key", async () => {
    const { calls, c } = client([{ status: 201, body: { batch_header: { payout_batch_id: "6599JFXMUPUSC", batch_status: "PENDING" } } }]);
    const r = await createPayPalPayoutsProvider(c).payHelprs("lh_pt_0001", [item], "You got paid");
    expect(r).toEqual({ providerBatchId: "6599JFXMUPUSC", batchStatus: "PENDING", duplicate: false });
    const b = body(calls[1]);
    expect(b.sender_batch_header.sender_batch_id).toBe("lh_pt_0001");
    expect(b.items[0]).toMatchObject({ recipient_type: "PAYPAL_ID", recipient_wallet: "PAYPAL", receiver: "ABCDEFG123", amount: { value: "92.55", currency: "USD" }, sender_item_id: "pp_1" });
    expect(header(calls[1], "PayPal-Request-Id")).toBe("lh:payout:lh_pt_0001");
  });

  it("a replayed batch id is reported as a duplicate, not a second payment (sandbox 400 shape, with the original batch linked)", async () => {
    const { c } = client([{ status: 400, body: { name: "USER_BUSINESS_ERROR", message: "User business error.", details: [{ field: "SENDER_BATCH_ID", location: "body", issue: "Batch with given sender_batch_id already exists", link: [{ href: "https://api.sandbox.paypal.com/v1/payments/payouts/6599JFXMUPUSC", rel: "self", method: "GET" }] }] } }]);
    expect(await createPayPalPayoutsProvider(c).payHelprs("lh_pt_0001", [item], "s")).toEqual({ providerBatchId: "6599JFXMUPUSC", batchStatus: "DUPLICATE", duplicate: true });
  });

  it("a 2xx without a batch id is a typed, non-retryable error (PayPal may have sent money)", async () => {
    const { c } = client([{ status: 201, body: { links: [] } }]);
    const e = await createPayPalPayoutsProvider(c).payHelprs("lh_pt_0010", [item], "s").catch((x: unknown) => x as { errorName?: string; retryable?: boolean });
    expect(e).toMatchObject({ errorName: "PAYOUT_RESPONSE_SHAPE", retryable: false });
  });

  it("a duplicate with no linked original is NOT reported as sent", async () => {
    const { c } = client([{ status: 400, body: { name: "USER_BUSINESS_ERROR", details: [{ issue: "Batch with given sender_batch_id already exists" }] } }]);
    await expect(createPayPalPayoutsProvider(c).payHelprs("lh_pt_0009", [item], "s")).rejects.toThrow(/duplicate_batch_unlinked/);
    const { c: c2 } = client([{ status: 400, body: { name: "USER_BUSINESS_ERROR", details: [{ issue: "Batch with given sender_batch_id already exists", link: [{ href: "https://api.sandbox.paypal.com/v1/payments/payouts/ABC123/?x=1" }] }] } }]);
    expect((await createPayPalPayoutsProvider(c2).payHelprs("lh_pt_0009", [item], "s")).providerBatchId).toBe("ABC123");
  });

  it("refuses bad batches before any request", async () => {
    const { calls, c } = client([]);
    const p = createPayPalPayoutsProvider(c);
    await expect(p.payHelprs("short", [item], "s")).rejects.toThrow(/batch key/);
    await expect(p.payHelprs("lh_pt_0002", [], "s")).rejects.toThrow(/exactly 1/);
    // One payout per batch: the batch key is the payout row's own UNIQUE key.
    await expect(p.payHelprs("lh_pt_0002", [item, { ...item, senderItemId: "pp_2" }], "s")).rejects.toThrow(/exactly 1/);
    await expect(p.payHelprs("lh_pt_0002", [{ ...item, amountCents: 0 }], "s")).rejects.toThrow(/positive/);
    expect(calls.length).toBe(0);
    expect(isValidBatchKey("lh_pt_0001")).toBe(true);
    expect(isValidBatchKey("lh pt")).toBe(false);
  });

  it("venmo handles go to the Venmo wallet", async () => {
    const { calls, c } = client([{ status: 201, body: { batch_header: { payout_batch_id: "B", batch_status: "PENDING" } } }]);
    await createPayPalPayoutsProvider(c).payHelprs("lh_pt_0003", [{ ...item, destination: { kind: "venmo_handle", value: "@helpr" } }], "s");
    expect(body(calls[1]).items[0]).toMatchObject({ recipient_type: "USER_HANDLE", recipient_wallet: "VENMO" });
  });

  it("cancelUnclaimed posts to the item's cancel endpoint, keyed", async () => {
    const { calls, c } = client([{ status: 200, body: {} }]);
    await createPayPalPayoutsProvider(c).cancelUnclaimed("8AELMXH8UB2P8");
    expect(new URL(calls[1].url).pathname).toBe("/v1/payments/payouts-item/8AELMXH8UB2P8/cancel");
    expect(header(calls[1], "PayPal-Request-Id")).toBe("lh:payout-cancel:8AELMXH8UB2P8");
  });
});

describe("registry", () => {
  const cfg = { paypal: { env: "sandbox" as const, clientId: "id", clientSecret: "s" } };
  it("builds by stamped id; Stripe is retired; unknown ids refused", () => {
    expect(paymentProviderFor("paypal_checkout", cfg).id).toBe("paypal_checkout");
    expect(payoutProviderFor("paypal_payouts", cfg).id).toBe("paypal_payouts");
    expect(() => paymentProviderFor("stripe", cfg)).toThrow(/provider_retired/);
    expect(() => payoutProviderFor("stripe", cfg)).toThrow(/provider_retired/);
    expect(() => paymentProviderFor("trolley", cfg)).toThrow(/unknown_payment_provider/);
    // The manual launch path has no API: nothing may "send" through it.
    expect(() => payoutProviderFor("manual_paypal", cfg)).toThrow(/manual_payout/);
  });
  it("PAYPAL_ENV must be exactly sandbox or live", () => {
    expect(parseProviderEnv("sandbox")).toBe("sandbox");
    for (const bad of [undefined, null, "", "Sandbox", "sandbox ", "prod"]) expect(() => parseProviderEnv(bad)).toThrow(/paypal_env_invalid/);
  });
});
