/**
 * Pure grading logic for scripts/check-stripe-webhook-events.mjs (issue #1586),
 * split out so src/test/stripeWebhookGuard.test.ts can prove every branch red
 * without a key or a network.
 *
 * LIVE MODE (owner decision 2026-09-30). Stripe went live on prod on
 * 2026-09-27, so the test-mode endpoint on .../functions/v1/stripe-webhook is
 * disabled on purpose and the guard now reads the LIVE account. It does so only
 * with a restricted, read-only key (rk_live_, "Webhook Endpoints: Read") held in
 * the STRIPE_LIVE_READ_KEY repo secret, and only ever issues GET requests.
 */

/**
 * The key shape the live half accepts: a LIVE-mode RESTRICTED key. A key's
 * permissions cannot be read from its prefix, but its shape can rule out the
 * ones that are certainly write-capable: sk_ (a full secret key) is refused
 * outright, as is any test-mode key (the test endpoint is retired) and anything
 * else. Returns null when the key is acceptable, else the reason it is not.
 * Never includes the key itself in the message.
 */
export function liveReadKeyProblem(key) {
  if (!key) return "STRIPE_LIVE_READ_KEY is not set";
  if (/^sk_/.test(key)) {
    return "STRIPE_LIVE_READ_KEY is a full secret key (sk_), which can write. Refusing to make any request: use a restricted rk_live_ key with only \"Webhook Endpoints: Read\"";
  }
  if (/^rk_test_/.test(key)) {
    return "STRIPE_LIVE_READ_KEY is a test-mode key (rk_test_). The guard reads the LIVE account; use a restricted rk_live_ key with only \"Webhook Endpoints: Read\"";
  }
  if (!/^rk_live_/.test(key)) {
    return "STRIPE_LIVE_READ_KEY is not a restricted live key (expected the rk_live_ prefix). Refusing to make any request";
  }
  return null;
}

/**
 * Grade a /v1/webhook_endpoints list against the handler map.
 * Returns { failures, notes }; the caller decides the exit code.
 *
 * Asserts, for endpoints on `url`: every one is a live-mode object, exactly one
 * is enabled, and that one's enabled_events equal `handlers` in both directions.
 */
export function gradeLiveEndpoints(list, handlers, url) {
  const failures = [];
  const notes = [];
  const fail = (m) => failures.push(m);
  if (!Array.isArray(handlers) || handlers.length === 0) {
    fail("The EVENT_HANDLERS list is empty, so there is nothing to compare against. Refusing to grade.");
    return { failures, notes };
  }
  if (!Array.isArray(list?.data)) {
    fail("The webhook_endpoints response has no `data` array. Refusing to grade a read that returned nothing.");
    return { failures, notes };
  }
  const ours = list.data.filter((e) => e.url === url);
  // A live key cannot return test objects; assert it anyway so a mis-scoped key
  // (or a test key that slipped past the prefix check) can never grade the
  // retired sandbox and call it live.
  if (ours.some((e) => e.livemode !== true)) {
    fail("A test-mode webhook endpoint came back from the live read. This guard grades live mode only. Refusing to grade.");
    return { failures, notes };
  }
  const enabled = ours.filter((e) => e.status === "enabled");
  notes.push(`Stripe live mode: ${ours.length} endpoint(s) on ${url}, ${enabled.length} enabled.`);

  // B1. Exactly one enabled endpoint. Two means every event is delivered twice.
  if (enabled.length > 1) {
    fail(
      `${enabled.length} ENABLED live webhook endpoints point at ${url}:\n` +
        enabled
          .map((e) => `     ${e.id} (created ${new Date(e.created * 1000).toISOString()}, ${(e.enabled_events ?? []).length} events)`)
          .join("\n") +
        `\n   Every event is delivered once per endpoint, and the edge function accepts a comma-separated STRIPE_WEBHOOK_SECRET, so both copies verify and BOTH are processed. This is issue #1586.\n` +
        `   Disable or delete all but one in the Stripe dashboard (LIVE mode).`,
    );
    return { failures, notes };
  }
  if (enabled.length === 0) {
    // FAIL, not a note (Q52): an empty list is a deleted/disabled endpoint or a
    // broken read, and Stripe is live, so nothing would reach stripe-webhook.
    fail(
      `No enabled live-mode endpoint on ${url} (${list.data.length} endpoint(s) listed in total). ` +
        "Stripe is live, so zero means no payment event reaches stripe-webhook, or the read is broken. " +
        "Check the endpoint in the Stripe dashboard (LIVE mode) and the key's scope.",
    );
    return { failures, notes };
  }

  // B2. The kept endpoint's subscription must match the handler map both ways.
  const kept = enabled[0];
  const subscribed = [...new Set(kept.enabled_events ?? [])].sort();
  if (subscribed.includes("*")) {
    fail(`${kept.id} subscribes to "*" (all events). Subscribe to the handled set, not everything.`);
    return { failures, notes };
  }
  const noHandler = subscribed.filter((e) => !handlers.includes(e));
  const notSubscribed = handlers.filter((e) => !subscribed.includes(e));
  if (noHandler.length) {
    fail(
      `${kept.id} is subscribed to ${noHandler.length} event(s) with NO handler in EVENT_HANDLERS: ${noHandler.join(", ")}.\n` +
        `   These are delivered and silently dropped ("Unhandled event type"). Either add a handler or unsubscribe.`,
    );
  }
  if (notSubscribed.length) {
    fail(
      `${kept.id} does NOT subscribe to ${notSubscribed.length} handled event(s): ${notSubscribed.join(", ")}.\n` +
        `   Those handlers can never run. Add them to the endpoint in the Stripe dashboard (LIVE mode); \`node scripts/stripe-webhook-events.mjs\` prints the list.`,
    );
  }
  if (!noHandler.length && !notSubscribed.length) {
    notes.push(`${kept.id} subscribes to exactly the ${handlers.length} handled events.`);
  }
  return { failures, notes };
}
