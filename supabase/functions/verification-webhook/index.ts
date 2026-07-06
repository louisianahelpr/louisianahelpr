import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// Per-vendor webhook signing secrets. A missing secret means that vendor is not
// configured yet — we fail closed (reject) so a forged callback can never mark
// an identity / background check "passed". No vendor is live today, so rejecting
// unsigned or unconfigured callers costs nothing and closes the forge-a-POST hole.
const CHECKR_WEBHOOK_SECRET = Deno.env.get("CHECKR_WEBHOOK_SECRET");
const CERTIFICIAL_WEBHOOK_SECRET = Deno.env.get("CERTIFICIAL_WEBHOOK_SECRET");
const STRIPE_IDV_WEBHOOK_SECRET = Deno.env.get("STRIPE_IDV_WEBHOOK_SECRET");
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");

const encoder = new TextEncoder();

// Constant-time hex comparison — a plain === short-circuits on the first
// mismatched char, leaking (via timing) how much of a forged signature matched.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

// HMAC-SHA256 of the raw request body, hex-encoded — the scheme Checkr and
// Certificial use to sign webhook callbacks.
async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const vendor = req.headers.get("x-vendor") ?? "unknown";

  // Read the RAW body first — HMAC and Stripe signatures are computed over the
  // exact bytes the vendor sent, so we must verify before JSON.parse (parsing
  // and re-serialising would change the bytes and break every signature).
  const rawBody = await req.text();

  // ---- Per-vendor signature verification (fail closed) ----
  let stripeEvent: Stripe.Event | null = null;
  if (vendor === "stripe_identity") {
    const sig = req.headers.get("stripe-signature");
    if (!STRIPE_SECRET_KEY || !STRIPE_IDV_WEBHOOK_SECRET || !sig) {
      console.error("[verification-webhook] stripe_identity: missing key/secret/signature — rejecting");
      return new Response("Unauthorized", { status: 401 });
    }
    try {
      const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2025-08-27.basil" });
      stripeEvent = await stripe.webhooks.constructEventAsync(rawBody, sig, STRIPE_IDV_WEBHOOK_SECRET);
    } catch (err) {
      console.error("[verification-webhook] stripe_identity signature verification failed:", err);
      return new Response("Unauthorized", { status: 401 });
    }
  } else if (vendor === "checkr" || vendor === "certificial") {
    const secret = vendor === "checkr" ? CHECKR_WEBHOOK_SECRET : CERTIFICIAL_WEBHOOK_SECRET;
    // Checkr signs with X-Checkr-Signature; generic fallback x-webhook-signature.
    const provided = (
      req.headers.get("x-checkr-signature") ??
      req.headers.get("x-webhook-signature") ?? ""
    ).trim().toLowerCase();
    if (!secret || !provided) {
      console.error(`[verification-webhook] ${vendor}: missing secret or signature — rejecting`);
      return new Response("Unauthorized", { status: 401 });
    }
    const expected = await hmacSha256Hex(secret, rawBody);
    if (!timingSafeEqual(provided, expected)) {
      console.error(`[verification-webhook] ${vendor} HMAC signature mismatch — rejecting`);
      return new Response("Unauthorized", { status: 401 });
    }
  } else {
    // Unknown vendor — accept without processing (don't error; vendor retries
    // are expensive). Nothing is mutated on this path.
    console.warn("Unknown vendor:", vendor, "body:", rawBody.slice(0, 200));
    return new Response(JSON.stringify({ received: true }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  }

  // Signature verified — safe to parse. For Stripe the verified event object
  // already carries the parsed payload (same { data: { object } } shape).
  let body: Record<string, unknown>;
  try {
    body = stripeEvent
      ? (stripeEvent as unknown as Record<string, unknown>)
      : JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // ---- Replay dedupe ----
  // Vendors retry on any non-2xx/timeout (and Stripe can replay from the
  // dashboard). Key the shared webhook-event ledger by "<vendor>:<event id>" so
  // a re-delivered callback can't re-apply a status change or spawn a duplicate
  // exception row. The vendor prefix also keeps a stripe_identity event.id from
  // colliding with the same id deduped bare by stripe-idv-webhook.
  const rawEventId =
    stripeEvent?.id ??
    (body.id as string | undefined) ??
    (body.event_id as string | undefined) ??
    null;
  if (rawEventId) {
    const { error: idemErr } = await supabase
      .from("stripe_webhook_events")
      .insert({ event_id: `${vendor}:${rawEventId}`, event_type: `verification.${vendor}` });
    if (idemErr) {
      if ((idemErr as { code?: string }).code === "23505") {
        console.log("[verification-webhook] Duplicate event — skipping:", `${vendor}:${rawEventId}`);
        return new Response(JSON.stringify({ received: true, duplicate: true }), {
          status: 200, headers: { "Content-Type": "application/json" }
        });
      }
      // Any other DB error (not a duplicate): the dedupe table is unhealthy.
      // Fail CLOSED — processing without a dedupe row means a later retry would
      // re-apply this verification result (double status flip / double notify).
      // Return 500 so the vendor retries once the DB recovers, rather than
      // settling identity state un-deduped.
      console.error("[verification-webhook] Idempotency insert failed — asking vendor to retry:", idemErr);
      postSlackOpsAlert({
        kind: "stripe_webhook_error",
        severity: "critical",
        title: "Verification webhook idempotency insert failed",
        message: `Could not record dedupe row for \`verification.${vendor}\` (DB error, not a duplicate) — returning 500 so the vendor retries rather than processing un-deduped.`,
        fields: {
          Vendor: vendor,
          "Event ID": String(rawEventId),
          Error: String((idemErr as { message?: string }).message ?? idemErr).slice(0, 200),
        },
      });
      return new Response("Failed to record verification result", { status: 500 });
    }
  }

  // Route by vendor
  let checkId: string | null = null;
  let newStatus: string | null = null;
  let failureReason: string | null = null;
  let expiresAt: string | null = null;

  if (vendor === "checkr") {
    // Checkr sends: { data: { object: { id, status, ... } } }
    const report = (body.data as any)?.object;
    checkId = report?.id;
    newStatus = report?.status === "clear" ? "passed"
               : report?.status === "consider" ? "manual_review"
               : "failed";
    failureReason = report?.status !== "clear" ? report?.status : null;
  } else if (vendor === "stripe_identity") {
    // Stripe Identity sends: { data: { object: { id, status, last_error } } }
    const verification = (body.data as any)?.object;
    checkId = verification?.id;
    newStatus = verification?.status === "verified" ? "passed"
               : verification?.status === "requires_input" ? "failed"
               : "pending";
    failureReason = (verification?.last_error as any)?.reason ?? null;
  } else if (vendor === "certificial") {
    // Certificial sends policy status updates
    const policy = body as any;
    checkId = policy.certificate_id;
    newStatus = policy.status === "active" ? "passed"
               : policy.status === "expired" || policy.status === "cancelled" ? "expired"
               : "failed";
    expiresAt = policy.expiration_date ?? null;
  }
  // No `else` is reachable here: the signature-verification block above already
  // 401/200-returns every vendor that isn't one of these three, so vendor is
  // guaranteed to be checkr | stripe_identity | certificial at this point.

  if (!checkId) {
    return new Response(JSON.stringify({ received: true, note: "no check_id" }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  }

  // Find the verification_check by vendor_check_id
  const { data: check, error } = await supabase
    .from("verification_checks")
    .select("id, credential_id, user_id")
    .eq("vendor_check_id", checkId)
    .eq("vendor", vendor)
    .single();

  if (error || !check) {
    console.warn("Check not found for vendor_check_id:", checkId);
    return new Response(JSON.stringify({ received: true, note: "check not found" }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  }

  // Roll back the idempotency row we inserted above, so the vendor's retry
  // re-processes this event instead of hitting the dedupe wall and 200-skipping
  // (which would strand the status un-synced forever). Called only on the failure
  // paths below, where returning 500 asks the vendor to redeliver.
  const rollbackIdempotency = async () => {
    if (!rawEventId) return;
    const { error: delErr } = await supabase
      .from("stripe_webhook_events")
      .delete()
      .eq("event_id", `${vendor}:${rawEventId}`);
    if (delErr) {
      console.error("[verification-webhook] Failed to roll back idempotency row:", delErr);
    }
  };

  // Update the check status (trigger fires to sync credential). Never drop the
  // error: a silent failure here would 200-ACK the vendor while the identity /
  // background-check status is quietly lost — surface it and let the retry fix it.
  const { error: updateErr } = await supabase
    .from("verification_checks")
    .update({
      status: newStatus,
      raw_result: body,
      failure_reason: failureReason,
      completed_at: new Date().toISOString(),
      expires_at: expiresAt,
    })
    .eq("id", check.id);
  if (updateErr) {
    console.error("[verification-webhook] Failed to update verification_checks status:", updateErr);
    await rollbackIdempotency();
    return new Response("Failed to record verification result", { status: 500 });
  }

  // If manual_review needed → create exception. This row is the signal an
  // operator acts on for adverse-action review, so a dropped insert can't be
  // swallowed — 500 (after rolling back idempotency) so the retry recreates it.
  if (newStatus === "manual_review") {
    const { error: exceptionErr } = await supabase.from("verification_exceptions").insert({
      check_id: check.id,
      credential_id: check.credential_id,
      user_id: check.user_id,
      exception_type: "adverse_action",
      notes: `Vendor ${vendor} flagged for manual review. raw: ${JSON.stringify(body).slice(0, 500)}`,
    });
    if (exceptionErr) {
      console.error("[verification-webhook] Failed to insert verification_exception:", exceptionErr);
      await rollbackIdempotency();
      return new Response("Failed to record manual-review exception", { status: 500 });
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200, headers: { "Content-Type": "application/json" }
  });
});
