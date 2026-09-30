// @mutate scripts/lib/stripeWebhookGuard.mjs |   if (/^sk_/.test(key)) { |   if (false) {
// @mutate scripts/lib/stripeWebhookGuard.mjs |   if (!/^rk_live_/.test(key)) { |   if (false) {
// @mutate scripts/lib/stripeWebhookGuard.mjs |   if (enabled.length > 1) { |   if (enabled.length > 2) {
// @mutate scripts/lib/stripeWebhookGuard.mjs |   if (ours.some((e) => e.livemode !== true)) { |   if (false) {
// @mutate scripts/lib/stripeWebhookGuard.mjs |   const notSubscribed = handlers.filter((e) => !subscribed.includes(e)); |   const notSubscribed = [];
// @mutate scripts/lib/stripeWebhookGuard.mjs |   const noHandler = subscribed.filter((e) => !handlers.includes(e)); |   const noHandler = [];
// @mutate .github/workflows/stripe-webhook-guard.yml | STRIPE_LIVE_READ_KEY: ${{ secrets.STRIPE_LIVE_READ_KEY }} | STRIPE_LIVE_READ_KEY: ${{ secrets.STRIPE_TEST_SECRET_KEY }}
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  gradeLiveEndpoints,
  liveReadKeyProblem,
  type WebhookEndpoint,
} from "../../scripts/lib/stripeWebhookGuard.mjs";

/**
 * #1966 / Q839: Stripe went live on prod 2026-09-27, the test-mode endpoint is
 * disabled on purpose, and the webhook guard now reads the LIVE account with a
 * restricted read-only key (owner decision 2026-09-30). Pins the comparison
 * logic: exactly one enabled live endpoint on the webhook url whose
 * enabled_events equal EVENT_HANDLERS in both directions, and a key shape that
 * refuses sk_ (write-capable) and test keys before any request.
 */

const ROOT = join(__dirname, "..", "..");
// scripts/stripe-webhook-events.mjs resolves its paths from import.meta.url,
// which is not a file: URL under jsdom, so read it the way the sandbox script
// does: run it and take its output (the EVENT_HANDLERS keys, one per line).
const handlers = execFileSync(process.execPath, [join(ROOT, "scripts/stripe-webhook-events.mjs")], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);
const WEBHOOK_URL = readFileSync(join(ROOT, "scripts/stripe-webhook-events.mjs"), "utf8").match(
  /export const WEBHOOK_URL =\s*"([^"]+)"/,
)?.[1] as string;

function ep(over: Partial<WebhookEndpoint> = {}): WebhookEndpoint {
  return {
    id: "we_live_1",
    url: WEBHOOK_URL,
    status: "enabled",
    livemode: true,
    created: 1_790_000_000,
    enabled_events: [...handlers],
    ...over,
  };
}

describe("handler map floor", () => {
  it("EVENT_HANDLERS declares the 15 handled event types", () => {
    expect(handlers.length).toBe(15);
    expect(new Set(handlers).size).toBe(15);
  });
});

describe("gradeLiveEndpoints", () => {
  it("passes one enabled live endpoint subscribed to exactly the handled events", () => {
    const r = gradeLiveEndpoints({ data: [ep()] }, handlers, WEBHOOK_URL);
    expect(r.failures).toEqual([]);
    expect(r.notes.join("\n")).toMatch(/exactly the 15 handled events/);
  });

  it("ignores disabled endpoints and endpoints on other urls", () => {
    const r = gradeLiveEndpoints(
      {
        data: [
          ep(),
          ep({ id: "we_old", status: "disabled", enabled_events: ["invoice.paid"] }),
          ep({ id: "we_other", url: "https://example.com/hook", enabled_events: ["*"] }),
        ],
      },
      handlers,
      WEBHOOK_URL,
    );
    expect(r.failures).toEqual([]);
  });

  it("is RED when a handled event is missing from the subscription", () => {
    const r = gradeLiveEndpoints(
      { data: [ep({ enabled_events: handlers.slice(1) })] },
      handlers,
      WEBHOOK_URL,
    );
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toMatch(/does NOT subscribe to 1 handled event/);
    expect(r.failures[0]).toContain(handlers[0]);
  });

  it("is RED when the endpoint subscribes to an event with no handler", () => {
    const r = gradeLiveEndpoints(
      { data: [ep({ enabled_events: [...handlers, "invoice.paid"] })] },
      handlers,
      WEBHOOK_URL,
    );
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toMatch(/1 event\(s\) with NO handler.*invoice\.paid/);
  });

  it("is RED on a second enabled endpoint on the webhook url (#1586)", () => {
    const r = gradeLiveEndpoints(
      { data: [ep(), ep({ id: "we_live_2" })] },
      handlers,
      WEBHOOK_URL,
    );
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toMatch(/2 ENABLED live webhook endpoints/);
  });

  it("is RED when a test-mode endpoint comes back", () => {
    const r = gradeLiveEndpoints({ data: [ep({ livemode: false })] }, handlers, WEBHOOK_URL);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toMatch(/test-mode webhook endpoint/);
  });

  it("is RED when no endpoint on the url is enabled", () => {
    const r = gradeLiveEndpoints(
      { data: [ep({ status: "disabled" })] },
      handlers,
      WEBHOOK_URL,
    );
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toMatch(/No enabled live-mode endpoint/);
  });

  it("is RED on an empty list, a missing data array, and an empty handler map", () => {
    expect(gradeLiveEndpoints({ data: [] }, handlers, WEBHOOK_URL).failures[0]).toMatch(
      /No enabled live-mode endpoint/,
    );
    expect(gradeLiveEndpoints({}, handlers, WEBHOOK_URL).failures[0]).toMatch(/no `data` array/);
    expect(gradeLiveEndpoints(null, handlers, WEBHOOK_URL).failures[0]).toMatch(/no `data` array/);
    expect(gradeLiveEndpoints({ data: [ep()] }, [], WEBHOOK_URL).failures[0]).toMatch(
      /EVENT_HANDLERS list is empty/,
    );
  });

  it('is RED on a "*" subscription', () => {
    const r = gradeLiveEndpoints({ data: [ep({ enabled_events: ["*"] })] }, handlers, WEBHOOK_URL);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toMatch(/"\*"/);
  });
});

describe("liveReadKeyProblem", () => {
  it("accepts a restricted live key", () => {
    expect(liveReadKeyProblem("rk_live_abc123")).toBeNull();
  });

  it.each([
    ["sk_live_abc", /full secret key \(sk_\), which can write/],
    ["sk_test_abc", /full secret key \(sk_\), which can write/],
    ["rk_test_abc", /test-mode key \(rk_test_\)/],
    ["pk_live_abc", /expected the rk_live_ prefix/],
    ["whsec_abc", /expected the rk_live_ prefix/],
    ["", /is not set/],
    [undefined, /is not set/],
  ])("refuses %s", (key, re) => {
    const p = liveReadKeyProblem(key);
    expect(p).toMatch(re);
    if (key) expect(p).not.toContain(key);
  });
});

describe("workflow wiring", () => {
  const yml = readFileSync(join(ROOT, ".github/workflows/stripe-webhook-guard.yml"), "utf8");

  it("the live job and the secret-present job read STRIPE_LIVE_READ_KEY, never a test key", () => {
    expect(yml).toContain("STRIPE_LIVE_READ_KEY: ${{ secrets.STRIPE_LIVE_READ_KEY }}");
    expect(yml).toContain("KEY: ${{ secrets.STRIPE_LIVE_READ_KEY }}");
    expect(yml).not.toMatch(/STRIPE_TEST_SECRET_KEY|STRIPE_SECRET_KEY/);
  });

  it("the script makes no request other than GET", () => {
    const src = readFileSync(join(ROOT, "scripts/check-stripe-webhook-events.mjs"), "utf8");
    const methods = [...src.matchAll(/method:\s*"([A-Z]+)"/g)].map((m) => m[1]);
    expect(methods).toEqual(["GET"]);
    expect(src.match(/fetch\(/g)).toHaveLength(1);
  });
});
