/**
 * The PayPal HTTP client (supabase/functions/_shared/payments/paypalClient.ts),
 * PayPal Plan A phase 1. Sandbox only; every write idempotent; the secret never
 * leaves the token call.
 *
 * @mutate supabase/functions/_shared/payments/paypalClient.ts | export const PAYPAL_LIVE_ALLOWED = false; | export const PAYPAL_LIVE_ALLOWED = true;
 * @mutate supabase/functions/_shared/payments/paypalClient.ts | if ((method === "POST" \|\| method === "PATCH") && !opts.idempotencyKey) { | if (false) {
 * @mutate supabase/functions/_shared/payments/paypalClient.ts | if (opts.idempotencyKey) headers["PayPal-Request-Id"] = opts.idempotencyKey; | if (opts.idempotencyKey) headers["X-Request-Id"] = opts.idempotencyKey;
 * @mutate supabase/functions/_shared/payments/paypalClient.ts | if (this.token && this.now() < this.token.expiresAt) return this.token.value; | if (false) return this.token!.value;
 */
import { describe, expect, it } from "vitest";
import { PAYPAL_LIVE_ALLOWED, PayPalClient } from "../../supabase/functions/_shared/payments/paypalClient.ts";
import { ProviderApiError } from "../../supabase/functions/_shared/payments/types.ts";

const SECRET = "sk-test-SECRET-never-in-errors";

interface Call { url: string; init: RequestInit }

function fakeFetch(responses: Array<{ status: number; body?: unknown } | Error>) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected call ${url}`);
    if (next instanceof Error) throw next;
    return new Response(next.body === undefined ? "" : JSON.stringify(next.body), { status: next.status });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

const TOKEN = { status: 200, body: { access_token: "A21AA-token", expires_in: 32000 } };
async function caught(p: Promise<unknown>): Promise<ProviderApiError> {
  try {
    await p;
  } catch (e) {
    return e as ProviderApiError;
  }
  throw new Error("expected the request to fail");
}
const header = (c: Call, k: string) => (c.init.headers as Record<string, string>)[k];

describe("PayPalClient", () => {
  it("live PayPal is refused in this build (owner 2026-10-23: sandbox only)", () => {
    expect(PAYPAL_LIVE_ALLOWED).toBe(false);
    expect(() => new PayPalClient({ env: "live", clientId: "id", clientSecret: SECRET })).toThrow(/paypal_live_refused/);
    expect(() => new PayPalClient({ env: "prod" as never, clientId: "id", clientSecret: SECRET })).toThrow(/paypal_env_invalid/);
    expect(() => new PayPalClient({ env: "sandbox", clientId: "", clientSecret: SECRET })).toThrow(/credentials_missing/);
    expect(new PayPalClient({ env: "sandbox", clientId: "id", clientSecret: SECRET }).baseUrl).toBe("https://api-m.sandbox.paypal.com");
  });

  it("a write without an idempotency key throws before any request", async () => {
    const f = fakeFetch([]);
    const c = new PayPalClient({ env: "sandbox", clientId: "id", clientSecret: SECRET, fetchImpl: f.impl });
    await expect(c.request("POST", "/v2/checkout/orders", { body: {} })).rejects.toThrow(/idempotency_key_required/);
    await expect(c.request("PATCH", "/v2/checkout/orders/X", { body: [] })).rejects.toThrow(/idempotency_key_required/);
    expect(f.calls.length).toBe(0);
  });

  it("sends the key as PayPal-Request-Id, caches the token, and keeps the secret out of API calls", async () => {
    const f = fakeFetch([TOKEN, { status: 201, body: { id: "O1" } }, { status: 200, body: { id: "O1" } }]);
    const c = new PayPalClient({ env: "sandbox", clientId: "id", clientSecret: SECRET, fetchImpl: f.impl });
    await c.request("POST", "/v2/checkout/orders", { body: { a: 1 }, idempotencyKey: "lh:job:1:create" });
    await c.request("GET", "/v2/checkout/orders/O1");
    expect(f.calls.map((x) => new URL(x.url).pathname)).toEqual(["/v1/oauth2/token", "/v2/checkout/orders", "/v2/checkout/orders/O1"]);
    expect(header(f.calls[1], "PayPal-Request-Id")).toBe("lh:job:1:create");
    expect(header(f.calls[1], "Authorization")).toBe("Bearer A21AA-token");
    expect(header(f.calls[2], "PayPal-Request-Id")).toBeUndefined();
    for (const call of f.calls.slice(1)) expect(JSON.stringify(call.init)).not.toContain(btoa(`id:${SECRET}`));
  });

  it("a 401 refreshes the token once and retries with the SAME key", async () => {
    const f = fakeFetch([TOKEN, { status: 401, body: { name: "AUTHENTICATION_FAILURE" } }, TOKEN, { status: 201, body: { id: "R1" } }]);
    const c = new PayPalClient({ env: "sandbox", clientId: "id", clientSecret: SECRET, fetchImpl: f.impl });
    await c.request("POST", "/v2/payments/captures/C1/refund", { body: {}, idempotencyKey: "lh:refund:9" });
    expect(f.calls.length).toBe(4);
    expect(header(f.calls[1], "PayPal-Request-Id")).toBe("lh:refund:9");
    expect(header(f.calls[3], "PayPal-Request-Id")).toBe("lh:refund:9");
  });

  it("maps PayPal errors to ProviderApiError with the issue code; transport failure is retryable", async () => {
    const f = fakeFetch([
      TOKEN,
      { status: 422, body: { name: "UNPROCESSABLE_ENTITY", debug_id: "d1", details: [{ issue: "REFUND_AMOUNT_EXCEEDED", description: "too much" }] } },
      new Error("socket hang up"),
    ]);
    const c = new PayPalClient({ env: "sandbox", clientId: "id", clientSecret: SECRET, fetchImpl: f.impl });
    const e1 = await caught(c.request("POST", "/v2/payments/captures/C1/refund", { body: {}, idempotencyKey: "k1" }));
    expect(e1).toBeInstanceOf(ProviderApiError);
    expect(e1.issue).toBe("REFUND_AMOUNT_EXCEEDED");
    expect(e1.httpStatus).toBe(422);
    expect(e1.retryable).toBe(false);
    const e2 = await caught(c.request("GET", "/v2/checkout/orders/O1"));
    expect(e2.httpStatus).toBe(0);
    expect(e2.retryable).toBe(true);
  });

  it("a failed token call never carries the secret into the error", async () => {
    const f = fakeFetch([{ status: 401, body: { error: "invalid_client", error_description: "Client Authentication failed" } }]);
    const c = new PayPalClient({ env: "sandbox", clientId: "id", clientSecret: SECRET, fetchImpl: f.impl });
    const e = await caught(c.request("GET", "/v1/notifications/webhooks"));
    expect(e).toBeInstanceOf(ProviderApiError);
    expect(e.message).toMatch(/paypal token: 401 invalid_client/);
    expect(e.message).not.toContain(SECRET);
    expect(e.message).not.toContain(btoa(`id:${SECRET}`));
  });

  it("rawJsonBody is sent byte for byte", async () => {
    const raw = '{"webhook_event":{"b":1,"a":2}}';
    const f = fakeFetch([TOKEN, { status: 200, body: { verification_status: "SUCCESS" } }]);
    const c = new PayPalClient({ env: "sandbox", clientId: "id", clientSecret: SECRET, fetchImpl: f.impl });
    await c.request("POST", "/v1/notifications/verify-webhook-signature", { rawJsonBody: raw, idempotencyKey: "k" });
    expect(f.calls[1].init.body).toBe(raw);
    await expect(c.request("POST", "/v1/x", { rawJsonBody: raw, body: {}, idempotencyKey: "k" })).rejects.toThrow(/ambiguous/);
  });
});
