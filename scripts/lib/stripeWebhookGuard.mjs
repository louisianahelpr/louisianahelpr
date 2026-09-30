/**
 * Pure grading logic for scripts/check-stripe-webhook-events.mjs (issue #1586),
 * split out so src/test/stripeWebhookGuard.test.ts can prove every branch red
 * without a key or a network.
 *
 * LIVE MODE. Stripe went live on prod on 2026-09-27, so the test-mode endpoint
 * on .../functions/v1/stripe-webhook is disabled on purpose and the guard reads
 * the LIVE account. It does so through the edge function
 * supabase/functions/stripe-webhook-config-check, which holds the live key in
 * its own env (STRIPE_SECRET_KEY) and returns only {id, url, status, livemode,
 * enabled_events} per endpoint plus `keyIsLive` (owner decision 2026-09-30,
 * "Allow the function", instead of a separate GitHub key). No Stripe key is in
 * GitHub or in this script.
 */

/**
 * Grade the stripe-webhook-config-check response body: the function's key must
 * be a LIVE key (else the read graded the retired sandbox), and the endpoints
 * are then graded exactly like a /v1/webhook_endpoints list.
 */
export function gradeConfigCheckResponse(body, handlers, url) {
  if (!body || typeof body !== "object") {
    return { failures: ["stripe-webhook-config-check returned no JSON object. Refusing to grade."], notes: [] };
  }
  if (body.keyIsLive !== true) {
    return {
      failures: [
        "stripe-webhook-config-check reports keyIsLive != true: the edge function's STRIPE_SECRET_KEY is not a live key, " +
          "so this read graded test mode. Stripe is live on prod; refusing to call a test-mode read a pass.",
      ],
      notes: [],
    };
  }
  if (!Array.isArray(body.endpoints)) {
    return { failures: ["stripe-webhook-config-check returned no `endpoints` array. Refusing to grade."], notes: [] };
  }
  return gradeLiveEndpoints({ data: body.endpoints }, handlers, url);
}

/** Lowercased host + path with trailing slashes stripped; query and hash dropped.
 *  An unparseable url maps to a tagged copy of itself, so it never collides with ours. */
export function endpointKey(u) {
  if (typeof u !== "string") return null;
  try {
    const p = new URL(u);
    return `${p.protocol}//${p.host.toLowerCase()}${p.pathname.replace(/\/+$/, "")}`;
  } catch {
    return `unparseable:${u}`;
  }
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
  // Compare by normalised host + path (#1586 review, 2026-09-30): a duplicate
  // added as ".../stripe-webhook/" or ".../stripe-webhook?x=1" reaches the same
  // function, so exact string equality would not count it and the guard would
  // pass with two live endpoints delivering every event twice.
  const target = endpointKey(url);
  const ours = list.data.filter((e) => endpointKey(e.url) === target);
  // A live key cannot return test objects; assert it anyway so a test key that
  // slipped past the keyIsLive check can never grade the retired sandbox and
  // call it live.
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
          .map((e) => `     ${e.id} ${e.url} (${(e.enabled_events ?? []).length} events)`)
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
