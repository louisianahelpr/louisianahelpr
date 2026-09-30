// @mutate supabase/functions/stripe-webhook-config-check/shape.ts |       endpoints: data.map((e) => shapeEndpoint((e ?? {}) as Record<string, unknown>)), |       endpoints: data as ShapedEndpoint[],
// @mutate supabase/functions/stripe-webhook-config-check/shape.ts |   if (!res.ok) { |   if (false) {
// @mutate supabase/functions/stripe-webhook-config-check/shape.ts |   if (!key) { |   if (false) {
// @mutate supabase/functions/stripe-webhook-config-check/shape.ts |   if (!Array.isArray(data)) { |   if (false) {
// @mutate supabase/functions/stripe-webhook-config-check/shape.ts |   return s.replace(/\b(?:sk\|rk\|pk)_(?:live\|test)_\S*\|\bwhsec_\S*/g, "[redacted]"); |   return s;
import { describe, expect, it } from "vitest";
import {
  RETURNED_ENDPOINT_FIELDS,
  STRIPE_WEBHOOK_ENDPOINTS_URL,
  readWebhookConfig,
  shapeEndpoint,
} from "../../supabase/functions/stripe-webhook-config-check/shape.ts";

/**
 * Q853 / #1966: stripe-webhook-config-check reads the LIVE Stripe webhook config
 * with the edge function's own STRIPE_SECRET_KEY and returns it to GitHub
 * Actions. Pins that the response carries ONLY the whitelisted fields (never a
 * signing secret or the key) and that every failure is a non-200, never an
 * empty list that would grade as "no endpoint".
 */

// Fake, key-shaped values only (never a real key).
const FAKE_LIVE_KEY = "rk_live_FAKEFAKEFAKE000";
const FAKE_SECRET = "whsec_FAKEFAKEFAKE000";

const rawEndpoint = {
  id: "we_live_1",
  object: "webhook_endpoint",
  url: "https://fncmgoasalhdgfwzhsqa.supabase.co/functions/v1/stripe-webhook",
  status: "enabled",
  livemode: true,
  enabled_events: ["charge.refunded", "payment_intent.succeeded"],
  secret: FAKE_SECRET,
  metadata: { note: FAKE_SECRET },
  api_version: "2024-06-20",
  application: null,
  description: "prod",
  created: 1_790_000_000,
};

type FakeInit = { method?: string; headers?: Record<string, string> };
function stub(status: number, body: unknown, calls: Array<{ url: string; init?: FakeInit }> = []) {
  return async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init as FakeInit });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
}

describe("shapeEndpoint", () => {
  it("returns exactly the whitelisted fields and drops the signing secret", () => {
    const shaped = shapeEndpoint(rawEndpoint);
    expect(Object.keys(shaped).sort()).toEqual([...RETURNED_ENDPOINT_FIELDS].sort());
    expect(JSON.stringify(shaped)).not.toContain("whsec_");
  });

  it("treats a missing or non-boolean livemode as test mode", () => {
    expect(shapeEndpoint({ ...rawEndpoint, livemode: undefined }).livemode).toBe(false);
    expect(shapeEndpoint({ ...rawEndpoint, livemode: "true" }).livemode).toBe(false);
  });
});

describe("readWebhookConfig", () => {
  it("makes one GET to webhook_endpoints and returns no secret field and no key", async () => {
    const calls: Array<{ url: string; init?: FakeInit }> = [];
    const r = await readWebhookConfig(
      FAKE_LIVE_KEY,
      stub(200, { object: "list", data: [rawEndpoint], has_more: false }, calls),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(STRIPE_WEBHOOK_ENDPOINTS_URL);
    expect(calls[0].init?.method).toBe("GET");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.body).sort()).toEqual(["endpoints", "keyIsLive"]);
    expect(r.body.keyIsLive).toBe(true);
    for (const e of r.body.endpoints) {
      expect(Object.keys(e).sort()).toEqual([...RETURNED_ENDPOINT_FIELDS].sort());
    }
    const json = JSON.stringify(r.body);
    expect(json).not.toContain("whsec_");
    expect(json).not.toContain(FAKE_LIVE_KEY);
    expect(json).not.toMatch(/"secret"|"metadata"|"api_version"/);
  });

  it("reports keyIsLive false for a test key", async () => {
    const r = await readWebhookConfig("rk_test_FAKE", stub(200, { data: [], has_more: false }));
    expect(r.ok && r.body.keyIsLive).toBe(false);
  });

  it("is non-200 when the key is missing, without making a request", async () => {
    const calls: Array<{ url: string; init?: FakeInit }> = [];
    const r = await readWebhookConfig(undefined, stub(200, { data: [] }, calls));
    expect(r).toMatchObject({ ok: false, status: 500 });
    expect(calls).toHaveLength(0);
  });

  it("is non-200 on a Stripe error, and redacts a key fragment Stripe echoes", async () => {
    const r = await readWebhookConfig(
      FAKE_LIVE_KEY,
      stub(401, { error: { message: "Invalid API Key provided: rk_live_****F000" } }),
    );
    expect(r).toMatchObject({ ok: false, status: 502 });
    if (r.ok) return;
    expect(r.error).toMatch(/HTTP 401/);
    expect(r.error).not.toMatch(/rk_live_/);
  });

  it("is non-200 on a non-JSON body, a missing data array, has_more, and a thrown fetch", async () => {
    expect(await readWebhookConfig(FAKE_LIVE_KEY, stub(200, "<html>"))).toMatchObject({ ok: false, status: 502 });
    expect(await readWebhookConfig(FAKE_LIVE_KEY, stub(200, { object: "list" }))).toMatchObject({ ok: false, status: 502 });
    expect(await readWebhookConfig(FAKE_LIVE_KEY, stub(200, { data: [rawEndpoint], has_more: true }))).toMatchObject({
      ok: false,
      status: 502,
    });
    const thrown = await readWebhookConfig(FAKE_LIVE_KEY, async () => {
      throw new TypeError(`network down for ${FAKE_LIVE_KEY}`);
    });
    expect(thrown).toMatchObject({ ok: false, status: 502 });
    if (!thrown.ok) expect(thrown.error).not.toContain(FAKE_LIVE_KEY);
  });
});
