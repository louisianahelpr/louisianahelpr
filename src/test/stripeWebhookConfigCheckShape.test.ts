// @mutate supabase/functions/stripe-webhook-config-check/shape.ts |       endpoints: endpoints.data.map((e) => shapeEndpoint((e ?? {}) as Record<string, unknown>)), |       endpoints: endpoints.data as ShapedEndpoint[],
// @mutate supabase/functions/stripe-webhook-config-check/shape.ts |   if (!res.ok) { |   if (false) {
// @mutate supabase/functions/stripe-webhook-config-check/shape.ts |   if (!key) { |   if (false) {
// @mutate supabase/functions/stripe-webhook-config-check/shape.ts |   if (!Array.isArray(data)) { |   if (false) {
// @mutate supabase/functions/stripe-webhook-config-check/shape.ts |   return s.replace(/\b(?:sk\|rk\|pk)_(?:live\|test)_\S*\|\bwhsec_\S*/g, "[redacted]"); |   return s;
// @mutate supabase/functions/stripe-webhook-config-check/shape.ts |   const shaped = events.data.map((e) => shapeEvent((e ?? {}) as Record<string, unknown>)); |   const shaped = events.data as ShapedEvent[];
// @mutate supabase/functions/stripe-webhook-config-check/shape.ts |   if (!events.ok) return events; |   if (!events.ok) return { ok: true, body: { keyIsLive: keyIsLive(key), endpoints: [], undelivered: { since, until, count: 0, truncated: false, events: [] } } };
// @mutate supabase/functions/stripe-webhook-config-check/shape.ts |     delivery_success: "false", |     delivery_success: "true",
// @mutate supabase/functions/stripe-webhook-config-check/shape.ts | truncated: events.hasMore, | truncated: false,
// @mutate supabase/functions/stripe-webhook-config-check/shape.ts |   const since = until - UNDELIVERED_WINDOW_S; |   const since = 0;
import { describe, expect, it } from "vitest";
import {
  RETURNED_TAX_FIELDS,
  STRIPE_TAX_REGISTRATIONS_URL,
  shapeTaxRegistration,
  RETURNED_ENDPOINT_FIELDS,
  RETURNED_EVENT_FIELDS,
  STRIPE_WEBHOOK_ENDPOINTS_URL,
  UNDELIVERED_GRACE_S,
  UNDELIVERED_WINDOW_S,
  readWebhookConfig,
  shapeEndpoint,
  shapeEvent,
  undeliveredEventsUrl,
} from "../../supabase/functions/stripe-webhook-config-check/shape.ts";

/**
 * Q853 / #1966: stripe-webhook-config-check reads the LIVE Stripe webhook config
 * with the edge function's own STRIPE_SECRET_KEY and returns it to GitHub
 * Actions. Pins that the response carries ONLY the whitelisted fields (never a
 * signing secret or the key) and that every failure is a non-200, never an
 * empty list that would grade as "no endpoint".
 *
 * Q854: the second read, GET /v1/events?delivery_success=false, returns only a
 * count plus {id, type} per event (never the payload), and any Stripe error on
 * it is a non-200, never a zero count that would grade as "all delivered".
 */

// Fake, key-shaped values only (never a real key).
const FAKE_LIVE_KEY = "rk_live_FAKEFAKEFAKE000";
const FAKE_SECRET = "whsec_FAKEFAKEFAKE000";
const NOW = 1_790_000_000;

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

const rawEvent = {
  id: "evt_1FAKE",
  object: "event",
  type: "checkout.session.expired",
  created: NOW - 7200,
  livemode: true,
  pending_webhooks: 1,
  account: "acct_FAKE",
  request: { id: "req_FAKE", idempotency_key: "idem_FAKE" },
  data: { object: { id: "cs_FAKE", customer_email: "person@example.com", metadata: { note: FAKE_SECRET } } },
};

type FakeInit = { method?: string; headers?: Record<string, string> };
type Call = { url: string; init?: FakeInit };
type Reply = { status: number; body: unknown };
const list = (data: unknown[], has_more = false): Reply => ({ status: 200, body: { object: "list", data, has_more } });

/** Routes by URL: webhook_endpoints vs events, so each read can fail on its own. */
const rawLaRegistration = {
  id: "taxreg_FAKE",
  object: "tax.registration",
  country: "US",
  country_options: { us: { state: "LA", type: "state_sales_tax" } },
  status: "active",
  active_from: 1756700000,
  livemode: true,
};

function stub(endpoints: Reply, events: Reply = list([]), calls: Call[] = [], tax: Reply = list([rawLaRegistration])) {
  return async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init as FakeInit });
    const r = url.startsWith("https://api.stripe.com/v1/events?")
      ? events
      : url === STRIPE_TAX_REGISTRATIONS_URL
        ? tax
        : endpoints;
    return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status });
  };
}

describe("tax registrations (Q441)", () => {
  it("shapes a registration to exactly country, state and status", () => {
    const shaped = shapeTaxRegistration(rawLaRegistration);
    expect(Object.keys(shaped).sort()).toEqual([...RETURNED_TAX_FIELDS].sort());
    expect(shaped).toEqual({ country: "US", state: "LA", status: "active" });
    expect(shapeTaxRegistration({ country: "CA", status: "active" })).toEqual({ country: "CA", state: null, status: "active" });
  });

  it("a failed or partial tax read is a non-200, never an empty list", async () => {
    const failed = await readWebhookConfig(FAKE_LIVE_KEY, stub(list([rawEndpoint]), list([]), [], { status: 500, body: { error: { message: "boom" } } }), 15000, NOW);
    expect(failed.ok).toBe(false);
    const partial = await readWebhookConfig(FAKE_LIVE_KEY, stub(list([rawEndpoint]), list([]), [], list([rawLaRegistration], true)), 15000, NOW);
    expect(partial.ok).toBe(false);
  });
});

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

describe("shapeEvent", () => {
  it("returns only id and type, never the payload", () => {
    const shaped = shapeEvent(rawEvent);
    expect(Object.keys(shaped).sort()).toEqual([...RETURNED_EVENT_FIELDS].sort());
    expect(shaped).toEqual({ id: "evt_1FAKE", type: "checkout.session.expired" });
  });
});

describe("undeliveredEventsUrl", () => {
  it("uses Stripe's documented delivery_success=false filter with a bounded window and limit", () => {
    const u = new URL(undeliveredEventsUrl(100, 200));
    expect(u.origin + u.pathname).toBe("https://api.stripe.com/v1/events");
    expect(u.searchParams.get("delivery_success")).toBe("false");
    expect(u.searchParams.get("limit")).toBe("100");
    expect(u.searchParams.get("created[gte]")).toBe("100");
    expect(u.searchParams.get("created[lte]")).toBe("200");
  });
});

describe("readWebhookConfig", () => {
  it("makes three GETs (webhook_endpoints, undelivered events, active tax registrations) and returns no secret, key or payload", async () => {
    const calls: Call[] = [];
    const r = await readWebhookConfig(
      FAKE_LIVE_KEY,
      stub(list([rawEndpoint]), list([rawEvent]), calls),
      15000,
      NOW,
    );
    expect(calls).toHaveLength(3);
    expect(calls[2].url).toBe(STRIPE_TAX_REGISTRATIONS_URL);
    expect(calls[0].url).toBe(STRIPE_WEBHOOK_ENDPOINTS_URL);
    const until = NOW - UNDELIVERED_GRACE_S;
    expect(calls[1].url).toBe(undeliveredEventsUrl(until - UNDELIVERED_WINDOW_S, until));
    for (const c of calls) expect(c.init?.method).toBe("GET");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.body).sort()).toEqual(["endpoints", "keyIsLive", "taxRegistrations", "undelivered"]);
    expect(r.body.taxRegistrations).toEqual([{ country: "US", state: "LA", status: "active" }]);
    expect(r.body.keyIsLive).toBe(true);
    for (const e of r.body.endpoints) {
      expect(Object.keys(e).sort()).toEqual([...RETURNED_ENDPOINT_FIELDS].sort());
    }
    expect(r.body.undelivered).toEqual({
      since: until - UNDELIVERED_WINDOW_S,
      until,
      count: 1,
      truncated: false,
      events: [{ id: "evt_1FAKE", type: "checkout.session.expired" }],
    });
    const json = JSON.stringify(r.body);
    expect(json).not.toContain("whsec_");
    expect(json).not.toContain(FAKE_LIVE_KEY);
    expect(json).not.toMatch(/"secret"|"metadata"|"api_version"/);
    expect(json).not.toMatch(/cs_FAKE|person@example\.com|acct_FAKE|req_FAKE|pending_webhooks|taxreg_FAKE/);
  });

  it("reports zero undelivered only when Stripe returned an empty list", async () => {
    const r = await readWebhookConfig(FAKE_LIVE_KEY, stub(list([rawEndpoint]), list([])), 15000, NOW);
    expect(r.ok && r.body.undelivered.count).toBe(0);
  });

  it("marks a second page as truncated (the count is then a floor)", async () => {
    const r = await readWebhookConfig(FAKE_LIVE_KEY, stub(list([rawEndpoint]), list([rawEvent], true)), 15000, NOW);
    expect(r.ok && r.body.undelivered.truncated).toBe(true);
  });

  it("reports keyIsLive false for a test key", async () => {
    const r = await readWebhookConfig("rk_test_FAKE", stub(list([])));
    expect(r.ok && r.body.keyIsLive).toBe(false);
  });

  it("is non-200 when the key is missing, without making a request", async () => {
    const calls: Call[] = [];
    const r = await readWebhookConfig(undefined, stub(list([]), list([]), calls));
    expect(r).toMatchObject({ ok: false, status: 500 });
    expect(calls).toHaveLength(0);
  });

  it("is non-200 on a Stripe error, and redacts a key fragment Stripe echoes", async () => {
    const r = await readWebhookConfig(
      FAKE_LIVE_KEY,
      stub({ status: 401, body: { error: { message: "Invalid API Key provided: rk_live_****F000" } } }),
    );
    expect(r).toMatchObject({ ok: false, status: 502 });
    if (r.ok) return;
    expect(r.error).toMatch(/HTTP 401/);
    expect(r.error).not.toMatch(/rk_live_/);
  });

  it("is non-200 on a non-JSON body, a missing data array, has_more, and a thrown fetch", async () => {
    expect(await readWebhookConfig(FAKE_LIVE_KEY, stub({ status: 200, body: "<html>" }))).toMatchObject({ ok: false, status: 502 });
    expect(await readWebhookConfig(FAKE_LIVE_KEY, stub({ status: 200, body: { object: "list" } }))).toMatchObject({
      ok: false,
      status: 502,
    });
    expect(await readWebhookConfig(FAKE_LIVE_KEY, stub(list([rawEndpoint], true)))).toMatchObject({
      ok: false,
      status: 502,
    });
    const thrown = await readWebhookConfig(FAKE_LIVE_KEY, async () => {
      throw new TypeError(`network down for ${FAKE_LIVE_KEY}`);
    });
    expect(thrown).toMatchObject({ ok: false, status: 502 });
    if (!thrown.ok) expect(thrown.error).not.toContain(FAKE_LIVE_KEY);
  });

  it("is non-200, never a zero count, when the events read fails in any way", async () => {
    const bad: Reply[] = [
      { status: 403, body: { error: { message: "The provided key 'rk_live_****F000' does not have access to events" } } },
      { status: 500, body: "<html>" },
      { status: 200, body: { object: "list" } },
    ];
    for (const events of bad) {
      const r = await readWebhookConfig(FAKE_LIVE_KEY, stub(list([rawEndpoint]), events), 15000, NOW);
      expect(r).toMatchObject({ ok: false, status: 502 });
      if (r.ok) continue;
      expect(r.error).toMatch(/events/);
      expect(r.error).not.toMatch(/rk_live_/);
    }
    let n = 0;
    const throwsOnSecond = async (url: string) => {
      if (n++ === 0) return new Response(JSON.stringify(list([rawEndpoint]).body), { status: 200 });
      throw new TypeError(`timeout reading ${url}`);
    };
    expect(await readWebhookConfig(FAKE_LIVE_KEY, throwsOnSecond, 15000, NOW)).toMatchObject({ ok: false, status: 502 });
  });
});
