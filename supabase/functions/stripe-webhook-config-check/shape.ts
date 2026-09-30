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
// READ ONLY: the one request is GET /v1/webhook_endpoints. The key never leaves
// this module except in the Authorization header of that request.

/** The ONLY fields that leave this function, per endpoint. Anything else Stripe
 *  returns (secret, metadata, api_version, application, description, ...) is
 *  dropped by construction: shapeEndpoint builds a new object from this list. */
export const RETURNED_ENDPOINT_FIELDS = ["id", "url", "status", "livemode", "enabled_events"] as const;

export interface ShapedEndpoint {
  id: string;
  url: string;
  status: string;
  livemode: boolean;
  enabled_events: string[];
}

interface ConfigCheckBody {
  keyIsLive: boolean;
  endpoints: ShapedEndpoint[];
}

export const STRIPE_WEBHOOK_ENDPOINTS_URL = "https://api.stripe.com/v1/webhook_endpoints?limit=100";

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

/** Live-ness from the key's prefix, computed here so the key itself is never returned. */
function keyIsLive(key: string): boolean {
  return /^(sk|rk)_live_/.test(key);
}

/** Replace anything shaped like a Stripe key or signing secret with [redacted]. */
function redactKeyShapes(s: string): string {
  return s.replace(/\b(?:sk|rk|pk)_(?:live|test)_\S*|\bwhsec_\S*/g, "[redacted]");
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export type ConfigCheckResult =
  | { ok: true; body: ConfigCheckBody }
  | { ok: false; status: number; error: string };

/**
 * Read and shape the webhook config. Every failure is a non-200 result with a
 * message that never contains the key — never an empty list, because an empty
 * list would grade as "no endpoint" and hide WHY (or, worse, a caller that
 * treats empty as fine would pass having read nothing).
 */
export async function readWebhookConfig(
  key: string | undefined,
  fetchImpl: FetchFn,
  timeoutMs = 15000,
): Promise<ConfigCheckResult> {
  if (!key) {
    return { ok: false, status: 500, error: "STRIPE_SECRET_KEY is not set in the edge-function env" };
  }
  let res: Response;
  try {
    res = await fetchImpl(STRIPE_WEBHOOK_ENDPOINTS_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    return { ok: false, status: 502, error: `Stripe request failed: ${e instanceof Error ? e.name : "error"}` };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, status: 502, error: `Stripe answered HTTP ${res.status} with a non-JSON body` };
  }
  if (!res.ok) {
    // Stripe's "Invalid API Key provided: sk_live_****1234" echoes a masked
    // fragment of the key, so any key- or secret-shaped token is redacted.
    const msg = (body as { error?: { message?: unknown } } | null)?.error?.message;
    const safe = typeof msg === "string" ? redactKeyShapes(msg) : "unknown error";
    return { ok: false, status: 502, error: `Stripe answered HTTP ${res.status}: ${safe}` };
  }
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) {
    return { ok: false, status: 502, error: "Stripe's webhook_endpoints response had no data array" };
  }
  if ((body as { has_more?: unknown }).has_more === true) {
    // More than 100 endpoints: grading a partial page could miss the duplicate.
    return { ok: false, status: 502, error: "Stripe returned more than 100 webhook endpoints; the check reads one page only" };
  }
  return {
    ok: true,
    body: {
      keyIsLive: keyIsLive(key),
      endpoints: data.map((e) => shapeEndpoint((e ?? {}) as Record<string, unknown>)),
    },
  };
}
