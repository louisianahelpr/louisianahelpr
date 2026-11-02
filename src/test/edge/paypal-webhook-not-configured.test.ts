// @mutate supabase/functions/paypal-webhook/index.ts |   if (!PAYPAL_TRANSMISSION_HEADERS.every((h) => req.headers.get(h))) { |   if (false) {
// @mutate supabase/functions/paypal-webhook/index.ts | const PAYPAL_TRANSMISSION_HEADERS = ["paypal-transmission-id", "paypal-transmission-time", "paypal-transmission-sig", "paypal-cert-url", "paypal-auth-algo"]; | const PAYPAL_TRANSMISSION_HEADERS = ["paypal-transmission-id"];
/**
 * paypal-webhook with the PAYPAL_* secrets unset (Q2525, ledger 4ac3e9488b48).
 *
 * PayPal payments are not switched on, so no secrets are set. On 2026-10-24
 * 01:12Z one POST reached the function and paged "PayPal webhook not
 * configured" (paypal_env_invalid: null). A request with none of PayPal's
 * transmission headers cannot be a PayPal delivery (PayPal signs every one,
 * paypalWebhookVerify.ts), so it is refused 400 and pages nobody. A request
 * that DOES carry them is answered 503 (PayPal redelivers) and pages, as before.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { resetSupabaseMock } from "./mocks/supabase";
import { slackAlerts, resetSharedMocks } from "./mocks/shared";

const PAYPAL_HEADERS = {
  "paypal-transmission-id": "tx-1",
  "paypal-transmission-time": "2026-10-24T01:12:48Z",
  "paypal-transmission-sig": "c2ln",
  "paypal-cert-url": "https://api.paypal.com/v1/notifications/certs/CERT-1",
  "paypal-auth-algo": "SHA256withRSA",
};

async function post(headers: Record<string, string>) {
  setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key" });
  const fn = await loadEdgeFunction("paypal-webhook");
  return fn.fetch(fn.request({ method: "POST", rawBody: "{}", headers: { "content-type": "application/json", ...headers } }));
}
const notConfiguredPages = () => (slackAlerts as Array<{ title?: string }>).filter((a) => /PayPal webhook not configured/.test(a.title ?? ""));

describe("paypal-webhook with PayPal not configured (Q2525)", () => {
  beforeEach(() => { resetEnv(); resetSupabaseMock(); resetSharedMocks(); });

  it("a POST with no PayPal transmission headers is refused 400 and pages nobody", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "not_from_paypal" });
    expect(notConfiguredPages()).toHaveLength(0);
  });

  it("a POST missing one of the five headers is refused the same way", async () => {
    const four: Record<string, string> = { ...PAYPAL_HEADERS };
    delete four["paypal-auth-algo"];
    const res = await post(four);
    expect(res.status).toBe(400);
    expect(notConfiguredPages()).toHaveLength(0);
  });

  it("a POST carrying PayPal's transmission headers is answered 503 and pages, so PayPal redelivers once it is set up", async () => {
    const res = await post(PAYPAL_HEADERS);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "not_configured" });
    expect(notConfiguredPages()).toHaveLength(1);
  });
});
