/**
 * What a Stripe webhook function answers when it could NOT verify a delivery
 * (docs/OPEN.md Q156). Shared by stripe-webhook and stripe-idv-webhook.
 * ZERO imports on purpose, so the edge test harness runs the real module.
 *
 * ── The policy: refuse with a non-2xx, never acknowledge ─────────────────────
 * Both functions used to answer 200 to a bad signature, a missing signing
 * secret or a missing Stripe key, "to stop Stripe retrying". A 200 tells Stripe
 * the event was delivered, so Stripe never sends it again and its dashboard
 * shows a success. The event is simply gone. On 2026-09-23 12:43:27Z one
 * delivery failed signature verification that way and nothing could bring it
 * back.
 *
 * A non-2xx is the only answer that keeps a genuine event alive:
 *   - Stripe retries it (live mode: exponential backoff for up to 3 days;
 *     sandbox: a few times over a few hours), so fixing the secret inside that
 *     window lets the retry land;
 *   - Stripe's dashboard marks the delivery failed, and Stripe emails the
 *     account owner about an endpoint that keeps failing.
 *
 * Why this cannot become a retry storm: Stripe retries PER EVENT on a fixed,
 * bounded schedule. One bad delivery is at most one retry sequence, never an
 * amplification. A caller that is not Stripe does not retry at all. Forged
 * requests learn nothing from a 400 they would not learn from a 200.
 *
 * The one cost: an endpoint that fails for days may be disabled by Stripe. A
 * LIVE-mode endpoint pointed at this URL while the project runs on the sandbox
 * key fails every live event, so check that the live endpoint is enabled on
 * launch day (docs/OPEN.md launch checklist). That is still better than the
 * old behaviour, which dropped those same events with no trace at all.
 *
 * Statuses: 500 for our own misconfiguration (retry once it is fixed), 400 for
 * a request we refuse (no signature header, or one that does not verify).
 */

export type WebhookRejectReason =
  | "stripe_key_not_configured"
  | "webhook_secret_not_configured"
  | "supabase_not_configured"
  | "missing_signature_header"
  | "signature_verification_failed";

export const WEBHOOK_REJECT_STATUS: Readonly<Record<WebhookRejectReason, number>> = {
  stripe_key_not_configured: 500,
  webhook_secret_not_configured: 500,
  supabase_not_configured: 500,
  missing_signature_header: 400,
  signature_verification_failed: 400,
};

/** The response for a delivery we did not verify. Never 2xx. */
export function webhookRejectResponse(
  reason: WebhookRejectReason,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ received: false, error: reason }), {
    status: WEBHOOK_REJECT_STATUS[reason],
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

export interface UnverifiedDelivery {
  /** What the body CLAIMS. Unverified: used only to name the event in an alert. */
  claimedId: string | null;
  claimedType: string | null;
  claimedLivemode: boolean | null;
  /** Signature schemes in the header, e.g. ["t","v1","v0"]. Stripe adds v0 only to test-mode events. */
  schemes: string[];
  bodyBytes: number;
}

/** Keep attacker-supplied text short and inert before it reaches Slack. */
const inert = (v: unknown): string | null =>
  typeof v === "string" ? v.replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 80) || null : null;

/**
 * Describe a delivery that failed verification, so the alert names the event
 * and it can be found in the Stripe dashboard and resent. Nothing here is
 * trusted and nothing here is ever processed.
 */
export function describeUnverifiedDelivery(body: string, sigHeader: string): UnverifiedDelivery {
  let claimedId: string | null = null;
  let claimedType: string | null = null;
  let claimedLivemode: boolean | null = null;
  try {
    const j = JSON.parse(body) as Record<string, unknown> | null;
    if (j && typeof j === "object") {
      claimedId = inert(j.id);
      claimedType = inert(j.type);
      claimedLivemode = typeof j.livemode === "boolean" ? j.livemode : null;
    }
  } catch {
    // Not JSON: nothing to claim. The alert still fires.
  }
  const schemes = [
    ...new Set(
      sigHeader
        .split(",")
        .map((p) => p.split("=")[0].trim())
        .filter((s) => /^[a-z0-9]{1,8}$/.test(s)),
    ),
  ];
  return { claimedId, claimedType, claimedLivemode, schemes, bodyBytes: new TextEncoder().encode(body).length };
}

/**
 * The ops alert for a signature failure. Critical, so it opens (or bumps) an
 * ops_alert_ledger item via postSlackOpsAlert. Posted to Slack once per UTC day
 * per function: a refused event is retried by Stripe, and every retry would
 * otherwise page again.
 */
export function signatureFailureAlert(p: {
  fn: string;
  title: string;
  secretEnv: string;
  keyMode: string;
  err: unknown;
  delivery: UnverifiedDelivery;
}) {
  const d = p.delivery;
  return {
    kind: "stripe_webhook_error" as const,
    severity: "critical" as const,
    title: p.title,
    message:
      `Signature verification failed, so the delivery was REFUSED (${WEBHOOK_REJECT_STATUS.signature_verification_failed}) and nothing was processed. ` +
      `Stripe will retry it. If it is a real event for this endpoint, fix \`${p.secretEnv}\` and the retry lands. ` +
      `If its livemode differs from the key mode, a webhook endpoint in the other mode points at this URL.`,
    fields: {
      Function: p.fn,
      "Claimed event (unverified)": d.claimedId ?? "none",
      "Claimed type (unverified)": d.claimedType ?? "none",
      "Claimed livemode (unverified)": d.claimedLivemode === null ? "unknown" : String(d.claimedLivemode),
      "Key mode": p.keyMode,
      "Signature schemes": d.schemes.join(",") || "none",
      "Body bytes": d.bodyBytes,
      Error: String(p.err).slice(0, 200),
    },
    oncePerDayKey: `${p.fn}:signature_verification_failed`,
  };
}

/** TEST / LIVE / UNKNOWN from a Stripe secret key prefix. Never returns the key. */
export function stripeKeyMode(key: string | undefined | null): "TEST" | "LIVE" | "UNKNOWN" {
  if (!key) return "UNKNOWN";
  if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) return "LIVE";
  if (key.startsWith("sk_test_") || key.startsWith("rk_test_")) return "TEST";
  return "UNKNOWN";
}
