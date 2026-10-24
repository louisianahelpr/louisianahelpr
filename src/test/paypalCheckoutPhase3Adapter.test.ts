/**
 * PayPal phase 3 additions to the checkout adapter (supabase/functions/_shared/payments/paypalCheckout.ts):
 *  - every order asks PayPal for immediate funding only (no eCheck-style PENDING capture) and
 *    names us "Louisiana Helpr" on PayPal's page (lead 2026-10-23);
 *  - getOrder re-reads an order: 404 = GONE (nothing to capture), COMPLETED carries its capture,
 *    a DECLINED capture throws typed, the amount is read in cents.
 *
 * @mutate supabase/functions/_shared/payments/paypalCheckout.ts |                 payment_method_preference: "IMMEDIATE_PAYMENT_REQUIRED", |                 payment_method_preference: "UNRESTRICTED",
 * @mutate supabase/functions/_shared/payments/paypalCheckout.ts |                 brand_name: PAYPAL_BRAND_NAME, |
 * @mutate supabase/functions/_shared/payments/paypalCheckout.ts |         if (e instanceof ProviderApiError && e.httpStatus === 404) { |         if (false) {
 * @mutate supabase/functions/_shared/payments/paypalCheckout.ts |         capture: order.status === "COMPLETED" ? captureFromOrder(order) : null, |         capture: null,
 */
import { describe, expect, it } from "vitest";
import { PayPalClient } from "../../supabase/functions/_shared/payments/paypalClient.ts";
import { PAYPAL_BRAND_NAME, createPayPalCheckoutProvider } from "../../supabase/functions/_shared/payments/paypalCheckout.ts";
import { ProviderApiError } from "../../supabase/functions/_shared/payments/types.ts";

function provider(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith("/v1/oauth2/token")) return new Response(JSON.stringify({ access_token: "t", expires_in: 30000 }), { status: 200 });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected ${url}`);
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as unknown as typeof fetch;
  return { calls, p: createPayPalCheckoutProvider(new PayPalClient({ env: "sandbox", clientId: "id", clientSecret: "s", fetchImpl })) };
}
const unit = (status: string, captures?: unknown[]) => ({ amount: { currency_code: "USD", value: "25.00" }, ...(captures ? { payments: { captures } } : {}) });

describe("PayPal checkout adapter, phase 3", () => {
  it("every order asks for immediate funding only and carries our name", async () => {
    const { calls, p } = provider([{ status: 201, body: { id: "ORDER1", status: "PAYER_ACTION_REQUIRED", links: [{ rel: "payer-action", href: "https://x/approve" }] } }]);
    await p.createCheckout({ idempotencyKey: "lh:job:j:checkout:amt2500:a1", referenceId: "job_j", amountCents: 2500, returnUrl: "https://a/r", cancelUrl: "https://a/c" });
    const ctx = JSON.parse(String(calls.find((c) => c.url.endsWith("/v2/checkout/orders"))!.init.body)).payment_source.paypal.experience_context;
    expect(ctx.payment_method_preference).toBe("IMMEDIATE_PAYMENT_REQUIRED");
    expect(ctx.brand_name).toBe("Louisiana Helpr");
    expect(PAYPAL_BRAND_NAME).toBe("Louisiana Helpr");
  });

  it("getOrder: 404 is GONE (an expired order)", async () => {
    const { calls, p } = provider([{ status: 404, body: { name: "RESOURCE_NOT_FOUND" } }]);
    expect(await p.getOrder("ORDER1")).toEqual({ providerOrderId: "ORDER1", status: "GONE", amountCents: null, approveUrl: null, capture: null });
    expect(calls[calls.length - 1].init.method).toBe("GET");
  });

  it("getOrder: an approved order has no capture yet; a completed one carries it", async () => {
    const { p } = provider([
      { status: 200, body: { id: "ORDER1", status: "APPROVED", purchase_units: [unit("APPROVED")], links: [] } },
      { status: 200, body: { id: "ORDER1", status: "COMPLETED", purchase_units: [unit("COMPLETED", [{ id: "CAP1", status: "COMPLETED", amount: { currency_code: "USD", value: "25.00" } }])] } },
    ]);
    expect(await p.getOrder("ORDER1")).toMatchObject({ status: "APPROVED", amountCents: 2500, capture: null });
    expect((await p.getOrder("ORDER1")).capture).toMatchObject({ providerCaptureId: "CAP1", settled: true, amountCents: 2500 });
  });

  it("getOrder: a declined capture throws typed (the caller marks the payment failed)", async () => {
    const { p } = provider([{ status: 200, body: { id: "ORDER1", status: "COMPLETED", purchase_units: [unit("COMPLETED", [{ id: "CAP1", status: "DECLINED", amount: { currency_code: "USD", value: "25.00" } }])] } }]);
    await expect(p.getOrder("ORDER1")).rejects.toMatchObject({ issue: "DECLINED" });
    await expect(provider([]).p.getOrder("not-an-id")).rejects.toThrow(/not a PayPal order id/);
    expect(ProviderApiError).toBeTypeOf("function");
  });
});
