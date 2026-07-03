import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const vendor = req.headers.get("x-vendor") ?? "unknown";
  const signature = req.headers.get("x-webhook-signature");

  // Signature verification placeholder — each vendor uses a different scheme.
  // Checkr: HMAC-SHA256 of body with webhook secret.
  // Stripe: stripe-signature header verified with stripe.webhooks.constructEvent.
  // Certificial / Certemy: vendor-specific header.
  // TODO: implement per-vendor signature verification when API keys are configured.
  // Fail closed: an unsigned request can never mutate verification status. No
  // real vendor is live yet, so rejecting unsigned callers costs nothing and
  // closes the window where a forged POST could mark an identity check passed.
  if (!signature) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
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
  } else {
    // Unknown vendor — log and accept (don't error, vendor retries are expensive)
    console.warn("Unknown vendor:", vendor, "body:", JSON.stringify(body).slice(0, 200));
    return new Response(JSON.stringify({ received: true }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  }

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

  // Update the check status (trigger fires to sync credential)
  await supabase
    .from("verification_checks")
    .update({
      status: newStatus,
      raw_result: body,
      failure_reason: failureReason,
      completed_at: new Date().toISOString(),
      expires_at: expiresAt,
    })
    .eq("id", check.id);

  // If manual_review needed → create exception
  if (newStatus === "manual_review") {
    await supabase.from("verification_exceptions").insert({
      check_id: check.id,
      credential_id: check.credential_id,
      user_id: check.user_id,
      exception_type: "adverse_action",
      notes: `Vendor ${vendor} flagged for manual review. raw: ${JSON.stringify(body).slice(0, 500)}`,
    });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200, headers: { "Content-Type": "application/json" }
  });
});
