/**
 * PayPal refund reads (PayPal Plan A, phase 5): what PAYMENT.CAPTURE.REFUNDED's reconcile and the
 * refund amount trust, re-read from PayPal instead of the event body. Shapes are the sandbox's own
 * replies (~/.lh-shots/paypal-design/02-refund-partial.json, 01-order-card-capture.json; and this
 * phase's ~/.lh-shots/paypal-p5/journey-*.json).
 *
 * @mutate supabase/functions/_shared/payments/paypalReads.ts | const up = r.links?.find((l) => l.rel === "up")?.href ?? ""; | const up = r.links?.find((l) => l.rel === "self")?.href ?? "";
 * @mutate supabase/functions/_shared/payments/paypalReads.ts |   if (!status) throw new Error(`paypal refund ${r.id} has an unknown status ${r.status}`); |   if (!status) return { id: r.id, status: "completed", amountCents: 0, captureId: "", customId: null };
 * @mutate supabase/functions/_shared/payments/paypalReads.ts | if (m.currency_code !== "USD") throw new Error(`paypal ${what} is ${m.currency_code}, not USD`); | void m.currency_code;
 */
import { describe, expect, it } from "vitest";
import { PayPalClient } from "../../supabase/functions/_shared/payments/paypalClient.ts";
import { readCapture, readRefund } from "../../supabase/functions/_shared/payments/paypalReads.ts";

function client(body: unknown, status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith("/v1/oauth2/token")) return new Response(JSON.stringify({ access_token: "t", expires_in: 30000 }), { status: 200 });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { calls, c: new PayPalClient({ env: "sandbox", clientId: "id", clientSecret: "s", fetchImpl }) };
}

// ~/.lh-shots/paypal-design/02-refund-partial.json
const REFUND = {
  id: "7SV12871VE8231131", amount: { currency_code: "USD", value: "26.43" }, status: "COMPLETED",
  custom_id: "0b3c9d8e-1f2a-4b5c-8d7e-6f5a4b3c2d1e",
  links: [
    { href: "https://api.sandbox.paypal.com/v2/payments/refunds/7SV12871VE8231131", rel: "self", method: "GET" },
    { href: "https://api.sandbox.paypal.com/v2/payments/captures/54X10121KX896733B", rel: "up", method: "GET" },
  ],
};

describe("readRefund: the refund as PayPal holds it", () => {
  it("parses status, amount, its capture (the up link) and our row id (custom_id), with a GET", async () => {
    const { c, calls } = client(REFUND);
    expect(await readRefund(c, "7SV12871VE8231131")).toEqual({
      id: "7SV12871VE8231131", status: "completed", amountCents: 2643, captureId: "54X10121KX896733B", customId: "0b3c9d8e-1f2a-4b5c-8d7e-6f5a4b3c2d1e",
    });
    const get = calls.find((x) => x.url.includes("/v2/payments/refunds/"))!;
    expect(get.init.method).toBe("GET");
    expect((get.init.headers as Record<string, string>)["PayPal-Request-Id"]).toBeUndefined();
  });
  it("maps every PayPal refund status; refuses an unknown one, a foreign currency and a missing capture link", async () => {
    for (const [pp, ours] of [["PENDING", "pending"], ["FAILED", "failed"], ["CANCELLED", "cancelled"]] as const) {
      expect((await readRefund(client({ ...REFUND, status: pp }).c, REFUND.id)).status).toBe(ours);
    }
    await expect(readRefund(client({ ...REFUND, status: "DENIED" }).c, REFUND.id)).rejects.toThrow(/unknown status/);
    await expect(readRefund(client({ ...REFUND, amount: { currency_code: "EUR", value: "1.00" } }).c, REFUND.id)).rejects.toThrow(/not USD/);
    await expect(readRefund(client({ ...REFUND, links: [REFUND.links[0]] }).c, REFUND.id)).rejects.toThrow(/does not link to its capture/);
    await expect(readRefund(client({ ...REFUND, id: "OTHER" }).c, REFUND.id)).rejects.toThrow(/returned OTHER/);
    expect((await readRefund(client({ ...REFUND, custom_id: "job_123" }).c, REFUND.id)).customId).toBeNull();
    await expect(readRefund(client(REFUND).c, "../x")).rejects.toThrow(/not a PayPal refund id/);
  });
});

describe("readCapture: PayPal's fee, which every refund keeps", () => {
  it("returns the capture's amount and PayPal fee (01-order-card-capture: $105.70, fee $3.23)", async () => {
    const cap = { id: "54X10121KX896733B", status: "PARTIALLY_REFUNDED", amount: { currency_code: "USD", value: "105.70" }, seller_receivable_breakdown: { paypal_fee: { currency_code: "USD", value: "3.23" } } };
    expect(await readCapture(client(cap).c, cap.id)).toEqual({ id: cap.id, status: "PARTIALLY_REFUNDED", amountCents: 10570, feeCents: 323 });
    expect((await readCapture(client({ ...cap, seller_receivable_breakdown: undefined }).c, cap.id)).feeCents).toBeNull();
  });
});
