// stripe-webhook-config-check — the pure half (no Deno, no env), so vitest can
// import it directly and prove the response carries no secret.
//
// WHY THIS EXISTS: the live half of scripts/check-stripe-webhook-events.mjs
// (the issue #1586 guard: one enabled live endpoint, events == EVENT_HANDLERS)
// needs a LIVE Stripe key. The only live key is the edge-function env var
// STRIPE_SECRET_KEY; the owner chose (2026-09-30, "Allow the function") to read
// the config HERE, where the key already is, instead of adding a separate
// GitHub secret. The workflow calls this function with the service-role key.
//
// READ ONLY: four GETs, all lists (Q1820 added the fourth: the TEST-mode
// webhook_endpoints, read with STRIPE_TEST_SECRET_KEY). GET /v1/webhook_endpoints (Q853), and
// GET /v1/events?delivery_success=false (Q854, a second read the owner allowed
// 2026-09-30 by pop-up) for events whose webhook delivery is still pending or
// has failed. The key never leaves this module except in the Authorization
// header of its requests (the live key on three, the test key on one). From events only {id, type} and a count leave;
// never an event's data/payload.

/** The ONLY fields that leave this function, per endpoint. Anything else Stripe
 *  returns (secret, metadata, api_version, application, description, ...) is
 *  dropped by construction: shapeEndpoint builds a new object from this list. */
export const RETURNED_ENDPOINT_FIELDS = ["id", "url", "status", "livemode", "enabled_events"] as const;

/** The ONLY fields that leave this function, per undelivered event. The event's
 *  `data` (the customer/charge/payout payload), `request`, `account` etc. are
 *  dropped by construction: shapeEvent builds a new object from this list. */
export const RETURNED_EVENT_FIELDS = ["id", "type"] as const;

export interface ShapedEndpoint {
  id: string;
  url: string;
  status: string;
  livemode: boolean;
  enabled_events: string[];
}

export interface ShapedEvent {
  id: string;
  type: string;
}

interface UndeliveredEvents {
  /** Unix seconds; the window read is [since, until]. */
  since: number;
  until: number;
  /** Events in the window Stripe reports as not delivered (pending or failed). */
  count: number;
  /** true when Stripe had more than one page: count is then a floor, not a total. */
  truncated: boolean;
  events: ShapedEvent[];
}

/** The ONLY fields that leave this function per tax registration (Q441). */
export const RETURNED_TAX_FIELDS = ["country", "state", "status"] as const;

export interface ShapedTaxRegistration {
  country: string | null;
  /** The US state for a US registration (country_options.us.state), else null. */
  state: string | null;
  status: string | null;
}

interface ConfigCheckBody {
  keyIsLive: boolean;
  endpoints: ShapedEndpoint[];
  undelivered: UndeliveredEvents;
  /** Active Stripe Tax registrations (Q441): checkout charges Louisiana sales tax only when one is active.
   *  null when the read failed (then `taxError` says why); the guard grades null as red, but the
   *  endpoint and undelivered checks are still returned and graded the same night. */
  taxRegistrations: ShapedTaxRegistration[] | null;
  taxError?: string;
  /** Q1820: the TEST-mode webhook endpoints, read with STRIPE_TEST_SECRET_KEY
   *  (the shared test accounts pay on the test key since 2026-10-12, so their
   *  webhooks arrive only through a test-mode endpoint). null when the read
   *  failed or the key is missing (then `testError` says why); graded red. */
  testEndpoints: ShapedEndpoint[] | null;
  testError?: string;
  /** true only when the test key really is a test key (sk_test_/rk_test_). */
  testKeyIsTest: boolean;
}

export const STRIPE_TAX_REGISTRATIONS_URL = "https://api.stripe.com/v1/tax/registrations?status=active&limit=100";

export function shapeTaxRegistration(raw: Record<string, unknown>): ShapedTaxRegistration {
  const country = typeof raw.country === "string" ? raw.country : null;
  const options = (raw.country_options ?? {}) as Record<string, unknown>;
  const local = (country ? options[country.toLowerCase()] : undefined) as Record<string, unknown> | undefined;
  return {
    country,
    state: typeof local?.state === "string" ? local.state : null,
    status: typeof raw.status === "string" ? raw.status : null,
  };
}

export const STRIPE_WEBHOOK_ENDPOINTS_URL = "https://api.stripe.com/v1/webhook_endpoints?limit=100";

/** Window of events read: created in [now - GRACE - WINDOW, now - GRACE].
 *  The grace hour leaves Stripe's first retries time to land, so a delivery
 *  that is merely in flight is not red; 26h covers a daily cadence with overlap. */
export const UNDELIVERED_WINDOW_S = 26 * 3600;
export const UNDELIVERED_GRACE_S = 3600;
const UNDELIVERED_EVENTS_LIMIT = 100;

/** Stripe's documented list filter (docs.stripe.com/api/events/list):
 *  delivery_success=false returns "events which are still pending or have
 *  failed all delivery attempts to a webhook endpoint". */
export function undeliveredEventsUrl(since: number, until: number): string {
  const q = new URLSearchParams({
    delivery_success: "false",
    limit: String(UNDELIVERED_EVENTS_LIMIT),
    "created[gte]": String(since),
    "created[lte]": String(until),
  });
  return `https://api.stripe.com/v1/events?${q.toString()}`;
}

/** Whitelist copy — never a spread, so a new Stripe field cannot ride along. */
export function shapeEndpoint(raw: Record<string, unknown>): ShapedEndpoint {
  return {
    id: String(raw.id ?? ""),
    url: String(raw.url ?? ""),
    status: String(raw.status ?? ""),
    // Strict: only a literal true is live. A missing field grades as test mode.
    livemode: raw.livemode === true,
    enabled_events: Array.isArray(raw.enabled_events) ? raw.enabled_events.map(String) : [],
  };
}

/** Whitelist copy of an event: id and type only, never its data. */
export function shapeEvent(raw: Record<string, unknown>): ShapedEvent {
  return {
    id: String(raw.id ?? ""),
    type: String(raw.type ?? ""),
  };
}

/** Live-ness from the key's prefix, computed here so the key itself is never returned. */
function keyIsLive(key: string): boolean {
  return /^(sk|rk)_live_/.test(key);
}

/** Test-ness from the key's prefix (Q1820). */
function keyIsTest(key: string | undefined): boolean {
  return typeof key === "string" && /^(sk|rk)_test_/.test(key);
}

/** Replace anything shaped like a Stripe key or signing secret with [redacted]. */
function redactKeyShapes(s: string): string {
  return s.replace(/\b(?:sk|rk|pk)_(?:live|test)_\S*|\bwhsec_\S*/g, "[redacted]");
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export type ConfigCheckResult =
  | { ok: true; body: ConfigCheckBody }
  | { ok: false; status: number; error: string };

type ListResult =
  | { ok: true; data: unknown[]; hasMore: boolean }
  | { ok: false; status: number; error: string };

/** One GET of a Stripe list. Every failure is a non-200 whose message never
 *  contains the key. */
async function getStripeList(
  url: string,
  what: string,
  key: string,
  fetchImpl: FetchFn,
  timeoutMs: number,
): Promise<ListResult> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    return { ok: false, status: 502, error: `Stripe ${what} request failed: ${e instanceof Error ? e.name : "error"}` };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, status: 502, error: `Stripe ${what} answered HTTP ${res.status} with a non-JSON body` };
  }
  if (!res.ok) {
    // Stripe's "Invalid API Key provided: sk_live_****1234" echoes a masked
    // fragment of the key, so any key- or secret-shaped token is redacted.
    const msg = (body as { error?: { message?: unknown } } | null)?.error?.message;
    const safe = typeof msg === "string" ? redactKeyShapes(msg) : "unknown error";
    return { ok: false, status: 502, error: `Stripe ${what} answered HTTP ${res.status}: ${safe}` };
  }
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) {
    return { ok: false, status: 502, error: `Stripe's ${what} response had no data array` };
  }
  return { ok: true, data, hasMore: (body as { has_more?: unknown }).has_more === true };
}

/**
 * Read and shape the webhook config and the undelivered-event count. Every
 * failure is a non-200 result with a message that never contains the key —
 * never an empty list or a zero count, because empty grades as "no endpoint"
 * and zero grades as "all delivered": either would hide WHY (or pass having
 * read nothing).
 */
export async function readWebhookConfig(
  key: string | undefined,
  fetchImpl: FetchFn,
  timeoutMs = 15000,
  nowSec = Math.floor(Date.now() / 1000),
  testKey?: string,
  /** Why there is no test key (from _shared/stripeMode.ts testModeKeyForConfigCheck). */
  testKeyError?: string,
): Promise<ConfigCheckResult> {
  if (!key) {
    return { ok: false, status: 500, error: "STRIPE_SECRET_KEY is not set in the edge-function env" };
  }
  const endpoints = await getStripeList(STRIPE_WEBHOOK_ENDPOINTS_URL, "webhook_endpoints", key, fetchImpl, timeoutMs);
  if (!endpoints.ok) return endpoints;
  if (endpoints.hasMore) {
    // More than 100 endpoints: grading a partial page could miss the duplicate.
    return { ok: false, status: 502, error: "Stripe returned more than 100 webhook endpoints; the check reads one page only" };
  }

  const until = nowSec - UNDELIVERED_GRACE_S;
  const since = until - UNDELIVERED_WINDOW_S;
  const events = await getStripeList(undeliveredEventsUrl(since, until), "events", key, fetchImpl, timeoutMs);
  if (!events.ok) return events;
  const shaped = events.data.map((e) => shapeEvent((e ?? {}) as Record<string, unknown>));

  // A failed tax read must not hide the endpoint/undelivered result (lh-money-escrow, 2026-10-06):
  // it comes back as taxRegistrations: null + taxError, which the guard grades red.
  const tax = await getStripeList(STRIPE_TAX_REGISTRATIONS_URL, "tax/registrations", key, fetchImpl, timeoutMs);
  const taxError = !tax.ok
    ? tax.error
    : tax.hasMore
      ? "Stripe returned more than 100 active tax registrations; the check reads one page only"
      : undefined;

  // Q1820: the TEST-mode endpoints, read with the test key. Like the tax read,
  // a failure never hides the live result: it is null + testError, graded red.
  let testEndpoints: ShapedEndpoint[] | null = null;
  let testError: string | undefined;
  if (!testKey) {
    testError = testKeyError ?? "the test-mode Stripe key is not set in the edge-function env";
  } else {
    const test = await getStripeList(STRIPE_WEBHOOK_ENDPOINTS_URL, "test-mode webhook_endpoints", testKey, fetchImpl, timeoutMs);
    if (!test.ok) testError = test.error;
    else if (test.hasMore) testError = "Stripe returned more than 100 test-mode webhook endpoints; the check reads one page only";
    else testEndpoints = test.data.map((e) => shapeEndpoint((e ?? {}) as Record<string, unknown>));
  }

  return {
    ok: true,
    body: {
      keyIsLive: keyIsLive(key),
      endpoints: endpoints.data.map((e) => shapeEndpoint((e ?? {}) as Record<string, unknown>)),
      undelivered: { since, until, count: shaped.length, truncated: events.hasMore, events: shaped },
      taxRegistrations: taxError || !tax.ok ? null : tax.data.map((r) => shapeTaxRegistration((r ?? {}) as Record<string, unknown>)),
      ...(taxError ? { taxError } : {}),
      testEndpoints,
      ...(testError ? { testError } : {}),
      testKeyIsTest: keyIsTest(testKey),
    },
  };
}
