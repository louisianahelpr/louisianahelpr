// @mutate scripts/lib/stripeWebhookGuard.mjs |   if (body.keyIsLive !== true) { |   if (false) {
// @mutate scripts/lib/stripeWebhookGuard.mjs |   if (!enabled.length) { |   if (false) {
// @mutate scripts/lib/stripeWebhookGuard.mjs |   const unhandled = subscribed.filter((e) => !expected.includes(e)); |   const unhandled = subscribed.filter((e) => !handlers.includes(e));
// @mutate scripts/lib/stripeWebhookGuard.mjs |   if (enabled.length >= 2) { |   if (false) {
// @mutate scripts/lib/stripeWebhookGuard.mjs |   if (!Array.isArray(list)) { |   if (false) {
// @mutate scripts/lib/stripeWebhookGuard.mjs |   if (body.testKeyIsTest !== true) { |   if (false) {
// @mutate scripts/lib/stripeWebhookGuard.mjs |   const missing = expected.filter((e) => !subscribed.includes(e)); |   const missing = [];
// @mutate scripts/lib/stripeWebhookGuard.mjs |     ? gradeTestEndpoints(body, handlers, testModeEvents, url) |     ? { failures: [], notes: [] }
// @mutate scripts/lib/stripeWebhookGuard.mjs |   if (!Array.isArray(body.endpoints)) { |   if (false) {
// @mutate scripts/lib/stripeWebhookGuard.mjs |   if (enabled.length > 1) { |   if (enabled.length > 2) {
// @mutate scripts/lib/stripeWebhookGuard.mjs |   if (ours.some((e) => e.livemode !== true)) { |   if (false) {
// @mutate scripts/lib/stripeWebhookGuard.mjs |   const notSubscribed = handlers.filter((e) => !subscribed.includes(e)); |   const notSubscribed = [];
// @mutate scripts/lib/stripeWebhookGuard.mjs |   const noHandler = subscribed.filter((e) => !handlers.includes(e)); |   const noHandler = [];
// @mutate scripts/lib/stripeWebhookGuard.mjs |   const ours = list.data.filter((e) => endpointKey(e.url) === target); |   const ours = list.data.filter((e) => e.url === url);
// @mutate .github/workflows/stripe-webhook-guard.yml | CRON_SECRET: ${{ secrets.CRON_SECRET }} | CRON_SECRET: ${{ secrets.STRIPE_TEST_SECRET_KEY }}
// @mutate scripts/lib/stripeWebhookGuard.mjs |   if (!undelivered \|\| typeof undelivered !== "object") { |   if (!undelivered) return { failures, notes }; if (typeof undelivered !== "object") {
// @mutate scripts/lib/stripeWebhookGuard.mjs |   if (!Number.isInteger(count) \|\| count < 0 \|\| !Array.isArray(events)) { |   if (!Array.isArray(events)) {
// @mutate scripts/lib/stripeWebhookGuard.mjs |   if (count > 0 \|\| truncated === true) { |   if (count > 1) {
// @mutate scripts/lib/stripeWebhookGuard.mjs |     failures: [...config.failures, ...undelivered.failures, ...tax.failures, ...test.failures], |     failures: [...config.failures, ...undelivered.failures, ...test.failures],
// @mutate scripts/lib/stripeWebhookGuard.mjs |   const la = regs.some((r) => r?.country === "US" && r?.state === "LA" && r?.status === "active"); |   const la = regs.length > 0;
// @mutate scripts/lib/stripeWebhookGuard.mjs |   if (!Array.isArray(regs)) { |   if (false) {
// @mutate scripts/lib/stripeWebhookGuard.mjs |   if (!Number.isInteger(since) \|\| !Number.isInteger(until) \|\| since >= until) { |   if (false) {
// @mutate scripts/lib/stripeWebhookGuard.mjs |   if (count !== events.length) { |   if (false) {
// @mutate scripts/lib/stripeWebhookGuard.mjs |   if (typeof truncated !== "boolean") { |   if (false) {
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  gradeConfigCheckResponse,
  gradeLiveEndpoints,
  gradeTaxRegistrations,
  gradeTestEndpoints,
  gradeUndelivered,
  type WebhookEndpoint,
} from "../../scripts/lib/stripeWebhookGuard.mjs";

/**
 * #1966 / Q839: Stripe went live on prod 2026-09-27, the test-mode endpoint is
 * disabled on purpose, and the webhook guard now reads the LIVE account through
 * the stripe-webhook-config-check edge function (owner decision 2026-09-30,
 * "Allow the function"). Pins the comparison logic: the function's key is live,
 * exactly one enabled live endpoint on the webhook url, and its enabled_events
 * equal EVENT_HANDLERS in both directions.
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
  it("EVENT_HANDLERS declares the 16 handled event types", () => {
    expect(handlers.length).toBe(16);
    expect(new Set(handlers).size).toBe(16);
  });
});

describe("gradeLiveEndpoints", () => {
  it("passes one enabled live endpoint subscribed to exactly the handled events", () => {
    const r = gradeLiveEndpoints({ data: [ep()] }, handlers, WEBHOOK_URL);
    expect(r.failures).toEqual([]);
    expect(r.notes.join("\n")).toMatch(/exactly the 16 handled events/);
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

  it("is RED on a second enabled endpoint whose url differs only by a trailing slash, query or host case (#1586)", () => {
    const u = new URL(WEBHOOK_URL);
    for (const variant of [
      `${WEBHOOK_URL}/`,
      `${WEBHOOK_URL}?x=1`,
      `${u.protocol}//${u.host.toUpperCase()}${u.pathname}`,
    ]) {
      const r = gradeLiveEndpoints({ data: [ep(), ep({ id: "we_live_2", url: variant })] }, handlers, WEBHOOK_URL);
      expect(r.failures).toHaveLength(1);
      expect(r.failures[0]).toMatch(/2 ENABLED live webhook endpoints/);
    }
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

describe("gradeConfigCheckResponse (the edge function's body)", () => {
  // Built through a helper: a { status: "active" } literal reads as a DB row to fixtureSchemaContract.
  const reg = (country: string, state: string, st: string) => ({ country, state, ["status"]: st });
  const body = (over: Record<string, unknown> = {}) => ({
    keyIsLive: true,
    endpoints: [ep()],
    undelivered: { since: 1_790_000_000, until: 1_790_093_600, count: 0, truncated: false, events: [] },
    taxRegistrations: [reg("US", "LA", "active")],
    ...over,
  });

  it("Q441: is RED with no active US/LA tax registration, or none read at all", () => {
    expect(gradeConfigCheckResponse(body(), handlers, WEBHOOK_URL).failures).toEqual([]);
    const none = gradeConfigCheckResponse(body({ taxRegistrations: [] }), handlers, WEBHOOK_URL).failures;
    expect(none.join("\n")).toMatch(/No ACTIVE United States \/ Louisiana Stripe Tax registration/);
    const otherState = gradeTaxRegistrations([reg("US", "TX", "active")]).failures;
    expect(otherState[0]).toMatch(/US\/TX active/);
    expect(gradeTaxRegistrations([reg("US", "LA", "scheduled")]).failures).toHaveLength(1);
    expect(gradeTaxRegistrations(undefined).failures[0]).toMatch(/no `taxRegistrations` array/);
    expect(gradeTaxRegistrations(null, "Stripe tax/registrations answered HTTP 500").failures[0]).toMatch(/could not read the Stripe Tax registrations \(Stripe tax\/registrations answered HTTP 500\)/);
    // A failed tax read still lets the endpoint check report (it is graded alongside, not instead).
    const both = gradeConfigCheckResponse(body({ taxRegistrations: null, taxError: "boom", endpoints: [] }), handlers, WEBHOOK_URL).failures;
    expect(both.some((f) => /could not read the Stripe Tax/.test(f))).toBe(true);
    expect(both.length).toBeGreaterThan(1);
    expect(gradeTaxRegistrations([reg("US", "LA", "active")])).toEqual({
      failures: [],
      notes: ["Stripe Tax: Louisiana registration is active (active registrations: US/LA active)."],
    });
  });

  it("passes a live key with one enabled endpoint on exactly the handled events", () => {
    const r = gradeConfigCheckResponse(body(), handlers, WEBHOOK_URL);
    expect(r.failures).toEqual([]);
    expect(r.notes.join("\n")).toMatch(/exactly the 16 handled events/);
  });

  it("is RED when the function's key is not live", () => {
    for (const k of [false, undefined, "true", 1]) {
      const r = gradeConfigCheckResponse(body({ keyIsLive: k }), handlers, WEBHOOK_URL);
      expect(r.failures).toHaveLength(1);
      expect(r.failures[0]).toMatch(/keyIsLive != true/);
    }
  });

  it("is RED on a missing endpoints array or a non-object body", () => {
    expect(gradeConfigCheckResponse(body({ endpoints: undefined }), handlers, WEBHOOK_URL).failures[0]).toMatch(
      /no `endpoints` array/,
    );
    expect(gradeConfigCheckResponse(null, handlers, WEBHOOK_URL).failures[0]).toMatch(/no JSON object/);
  });

  it("is RED on a missing event, a second enabled endpoint, and a test-mode endpoint", () => {
    expect(
      gradeConfigCheckResponse(body({ endpoints: [ep({ enabled_events: handlers.slice(1) })] }), handlers, WEBHOOK_URL)
        .failures[0],
    ).toMatch(/does NOT subscribe to 1 handled event/);
    expect(
      gradeConfigCheckResponse(body({ endpoints: [ep(), ep({ id: "we_live_2", created: undefined })] }), handlers, WEBHOOK_URL)
        .failures[0],
    ).toMatch(/2 ENABLED live webhook endpoints/);
    expect(
      gradeConfigCheckResponse(body({ endpoints: [ep({ livemode: false })] }), handlers, WEBHOOK_URL).failures[0],
    ).toMatch(/test-mode webhook endpoint/);
    expect(gradeConfigCheckResponse(body({ endpoints: [] }), handlers, WEBHOOK_URL).failures[0]).toMatch(
      /No enabled live-mode endpoint/,
    );
  });
});

describe("gradeUndelivered (Q854: GET /v1/events?delivery_success=false)", () => {
  const u = (over: Record<string, unknown> = {}) => ({
    since: 1_790_000_000,
    until: 1_790_093_600,
    count: 0,
    truncated: false,
    events: [],
    ...over,
  });
  const evts = [
    { id: "evt_A", type: "checkout.session.completed" },
    { id: "evt_B", type: "charge.refunded" },
  ];

  it("passes zero undelivered events and says which window it read", () => {
    const r = gradeUndelivered(u());
    expect(r.failures).toEqual([]);
    expect(r.notes.join("\n")).toMatch(/0 undelivered platform-account events created 2026-09-21T14:13:20\.000Z \.\. 2026-09-22T16:13:20\.000Z/);
  });

  it("is RED on one undelivered event, and on two, naming each id and type", () => {
    const one = gradeUndelivered(u({ count: 1, events: evts.slice(0, 1) }));
    expect(one.failures).toHaveLength(1);
    expect(one.failures[0]).toMatch(/^1 live Stripe platform-account event\(s\) .* are NOT delivered/);
    const two = gradeUndelivered(u({ count: 2, events: evts }));
    expect(two.failures[0]).toMatch(/^2 live Stripe platform-account event/);
    expect(two.failures[0]).toContain("evt_A checkout.session.completed");
    expect(two.failures[0]).toContain("evt_B charge.refunded");
  });

  it("is RED when Stripe had more than one page (the count is only a floor)", () => {
    const r = gradeUndelivered(u({ count: 0, truncated: true }));
    expect(r.failures[0]).toMatch(/0\+ \(more than one page\)/);
  });

  it("is RED, never zero, when the block is missing or malformed", () => {
    for (const bad of [undefined, null, "0", 0]) {
      expect(gradeUndelivered(bad).failures[0]).toMatch(/no `undelivered` object/);
    }
    for (const over of [{ count: undefined }, { count: -1 }, { count: 1.5 }, { count: "0" }, { events: undefined }]) {
      expect(gradeUndelivered(u(over)).failures[0]).toMatch(/malformed `undelivered` block/);
    }
  });

  it("is RED on a block not tied to a real, consistent read (lh-money-escrow review)", () => {
    for (const over of [{ since: undefined }, { until: undefined }, { since: 1_790_093_600 }, { since: 1_790_093_601 }]) {
      expect(gradeUndelivered(u(over)).failures[0]).toMatch(/no valid window/);
    }
    expect(gradeUndelivered(u({ count: 0, events: evts })).failures[0]).toMatch(/inconsistent `undelivered` block \(count 0, 2 event/);
    expect(gradeUndelivered(u({ count: 2, events: [] })).failures[0]).toMatch(/inconsistent/);
    for (const truncated of [undefined, "true", 1]) {
      expect(gradeUndelivered(u({ truncated })).failures[0]).toMatch(/no boolean `truncated`/);
    }
  });

  it("gradeConfigCheckResponse reports undelivered events alongside a clean config, and a missing block", () => {
    const body = { keyIsLive: true, endpoints: [ep()], taxRegistrations: [{ country: "US", state: "LA", ["status"]: "active" }] };
    const withEvents = gradeConfigCheckResponse({ ...body, undelivered: u({ count: 2, events: evts }) }, handlers, WEBHOOK_URL);
    expect(withEvents.failures).toHaveLength(1);
    expect(withEvents.failures[0]).toMatch(/NOT delivered/);
    expect(gradeConfigCheckResponse(body, handlers, WEBHOOK_URL).failures[0]).toMatch(/no `undelivered` object/);
  });

  it("the committed fixture is red for undelivered events", () => {
    const fx = JSON.parse(
      readFileSync(join(ROOT, "scripts/fixtures/stripe-webhook-endpoints/undelivered-events.json"), "utf8"),
    );
    expect(gradeUndelivered(fx.undelivered).failures[0]).toMatch(/^2 live Stripe platform-account event\(s\) .* NOT delivered/);
  });
});

describe("workflow wiring", () => {
  const yml = readFileSync(join(ROOT, ".github/workflows/stripe-webhook-guard.yml"), "utf8");

  it("the live job and the secret-present job read CRON_SECRET, never a Stripe key", () => {
    expect(yml).toContain("CRON_SECRET: ${{ secrets.CRON_SECRET }}");
    expect(yml).toContain("KEY: ${{ secrets.CRON_SECRET }}");
    expect(yml).not.toMatch(/STRIPE_TEST_SECRET_KEY|STRIPE_SECRET_KEY|STRIPE_LIVE_READ_KEY/);
  });

  it("the live job never grades a --fixture (fixture mode skips the keyIsLive check)", () => {
    const live = yml.slice(yml.indexOf("\n  live:\n"), yml.indexOf("\n  notify:\n"));
    expect(live).toContain("check-stripe-webhook-events.mjs");
    expect(live).not.toMatch(/--(events-|test-)?fixture/);
  });

  it("the static job proves the undelivered-events half red on the committed fixture", () => {
    const stat = yml.slice(yml.indexOf("\n  static:\n"), yml.indexOf("\n  live-secret-present:\n"));
    expect(stat).toContain("--events-fixture scripts/fixtures/stripe-webhook-endpoints/undelivered-events.json");
    expect(stat).toContain('grep -q "NOT delivered"');
  });

  it("a push never cancels the scheduled run", () => {
    expect(yml).toContain("cancel-in-progress: ${{ github.event_name != 'schedule' }}");
  });

  it("the script makes no request other than GET", () => {
    const src = readFileSync(join(ROOT, "scripts/check-stripe-webhook-events.mjs"), "utf8");
    const methods = [...src.matchAll(/method:\s*"([A-Z]+)"/g)].map((m) => m[1]);
    expect(methods).toEqual(["GET"]);
    expect(src.match(/fetch\(/g)).toHaveLength(1);
    // The script holds no Stripe key: its one request goes to the edge function.
    expect(src).toContain("stripe-webhook-config-check");
    expect(src).not.toContain("api.stripe.com");
  });
});

describe("gradeTestEndpoints (Q1820: the TEST-mode webhook endpoint)", () => {
  // The webhook's own test-mode set, read from its source (the script module
  // cannot be imported under jsdom; see `handlers` above).
  const setSrc = readFileSync(join(ROOT, "supabase/functions/stripe-webhook/index.ts"), "utf8")
    .match(/const TEST_MODE_EVENT_TYPES = new Set\(\[([^\]]*)\]\)/)?.[1] ?? "";
  const expected = [...setSrc.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const tep = (over: Record<string, unknown> = {}) => ({
    id: "we_test_1", url: WEBHOOK_URL, status: "enabled", livemode: false, enabled_events: [...expected], ...over,
  });
  const body = (endpoints: unknown, extra: Record<string, unknown> = {}) => ({ testKeyIsTest: true, testEndpoints: endpoints, ...extra });
  const fx = (name: string) =>
    JSON.parse(readFileSync(join(ROOT, `scripts/fixtures/stripe-webhook-endpoints/${name}`), "utf8"));

  it("reads a real handler set (floor)", () => {
    expect(expected.length).toBeGreaterThan(10);
  });

  it("is red on the committed 2026-10-12 state (every test endpoint disabled or mis-pointed)", () => {
    const r = gradeTestEndpoints(fx("test-mode-2026-10-12-all-disabled.json"), handlers, expected, WEBHOOK_URL);
    expect(r.failures[0]).toMatch(/No enabled TEST-mode webhook endpoint/);
  });

  it("is green on the committed 2026-10-15 state (we_1UNfFl enabled with the 14 events)", () => {
    const r = gradeTestEndpoints(fx("test-mode-2026-10-15-enabled.json"), handlers, expected, WEBHOOK_URL);
    expect(r.failures).toEqual([]);
  });

  it("is red when the block is missing, says why when the function reported an error", () => {
    expect(gradeTestEndpoints({}, handlers, expected, WEBHOOK_URL).failures[0]).toMatch(/no `testEndpoints` array/);
    expect(gradeTestEndpoints({ testEndpoints: null, testError: "STRIPE_TEST_SECRET_KEY is not set" }, handlers, expected, WEBHOOK_URL).failures[0])
      .toMatch(/could not read the TEST-mode webhook endpoints \(STRIPE_TEST_SECRET_KEY is not set\)/);
  });

  it("is red when the key is not a test key, or a live endpoint comes back", () => {
    expect(gradeTestEndpoints(body([tep()], { testKeyIsTest: false }), handlers, expected, WEBHOOK_URL).failures).toHaveLength(1);
    expect(gradeTestEndpoints(body([tep({ livemode: true })]), handlers, expected, WEBHOOK_URL).failures[0]).toMatch(/live-mode endpoint/);
  });

  it("is red on two enabled test endpoints (#1586 in test mode)", () => {
    const r = gradeTestEndpoints(body([tep(), tep({ id: "we_test_2" })]), handlers, expected, WEBHOOK_URL);
    expect(r.failures[0]).toMatch(/2 ENABLED TEST-mode webhook endpoints/);
  });

  it("is red when a needed event is missing, or an event has no handler", () => {
    const missing = gradeTestEndpoints(body([tep({ enabled_events: expected.slice(1) })]), handlers, expected, WEBHOOK_URL);
    expect(missing.failures[0]).toMatch(/does NOT subscribe to 1 event/);
    const extra = gradeTestEndpoints(body([tep({ enabled_events: [...expected, "customer.subscription.updated"] })]), handlers, expected, WEBHOOK_URL);
    expect(extra.failures[0]).toMatch(/drops in test mode \(not in TEST_MODE_EVENT_TYPES\): customer.subscription.updated/);
  });

  it("gradeConfigCheckResponse grades the test half when the caller names the test-mode events", () => {
    const live = {
      keyIsLive: true,
      endpoints: [ep()],
      undelivered: { since: 1, until: 2, count: 0, truncated: false, events: [] },
      taxRegistrations: [{ country: "US", state: "LA", status: "active" }],
    };
    const r = gradeConfigCheckResponse({ ...live, testKeyIsTest: true, testEndpoints: [] }, handlers, WEBHOOK_URL, expected);
    expect(r.failures.join("\n")).toMatch(/No enabled TEST-mode webhook endpoint/);
  });

  it("the script grades the test half on every live run", () => {
    const src = readFileSync(join(ROOT, "scripts/check-stripe-webhook-events.mjs"), "utf8");
    expect(src).toContain("record(gradeConfigCheckResponse(body, handlers, WEBHOOK_URL, testModeEventTypes(handlers)));");
  });

  it("the static job proves the test half red on the committed fixture", () => {
    const yml = readFileSync(join(ROOT, ".github/workflows/stripe-webhook-guard.yml"), "utf8");
    expect(yml).toContain("--test-fixture scripts/fixtures/stripe-webhook-endpoints/test-mode-2026-10-12-all-disabled.json");
    expect(yml).toContain('grep -q "No enabled TEST-mode webhook endpoint"');
  });
});
