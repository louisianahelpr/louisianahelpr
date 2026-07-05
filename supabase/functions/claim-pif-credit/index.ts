// claim-pif-credit: attach a directed Pay-It-Forward gift to the signed-in
// caller. The donor named a recipient by email and we mailed them a claim
// link carrying an opaque `claim_token`. When the recipient signs up / logs
// in and opens that link, the client calls this function to bind the credit
// to their account (`recipient_id`), after which only they can redeem it.
//
// Why an edge function (not a client write): the directed-gift migration
// revoked every client INSERT/UPDATE on pif_credits (a client UPDATE let a
// recipient inflate `amount` before redeeming = theft), so the ONLY writer
// is the service role. This function is that writer for the claim step.
//
// Body: { claim_token: string }
//
// Idempotent: a second click by the same user returns success, not an error.
// Security: a leaked token can't be claimed by a stranger — if the gift names
// a recipient_email, the caller's email must match it.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const json = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status,
    });

  // Throttle: claiming is cheap but token-guessing shouldn't be free.
  const rl = await checkRateLimit(req, {
    windowMs: 60_000,
    maxRequests: 10,
    keyPrefix: "claim-pif-credit",
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 60, corsHeaders);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(401, { error: "Please sign in to claim this gift." });

    const supabaseAnon = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")) ?? "",
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: userData } = await supabaseAnon.auth.getUser(token);
    const user = userData.user;
    if (!user?.id || !user.email) {
      return json(401, { error: "Your session expired — sign in again to claim this gift." });
    }

    const body = await req.json().catch(() => ({}));
    const claimToken = typeof body?.claim_token === "string" ? body.claim_token.trim() : "";
    if (!claimToken) return json(400, { error: "This claim link is missing its code." });

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? "",
    );

    // Look up the gift by its token. A failed READ must fail closed — never
    // fall through to "invalid" and hide a transient outage as a bad link.
    const { data: credit, error: readErr } = await supabaseAdmin
      .from("pif_credits")
      .select("id, recipient_id, recipient_email, status, expires_at")
      .eq("claim_token", claimToken)
      .maybeSingle();
    if (readErr) {
      console.error("[claim-pif-credit] read failed:", readErr);
      return json(500, { error: "Couldn't look up this gift — please try again." });
    }
    if (!credit) {
      return json(404, { error: "This gift link is invalid or has already been used." });
    }

    // Already bound to this caller → idempotent success (double-clicked link).
    if (credit.recipient_id === user.id) {
      return json(200, { ok: true, credit_id: credit.id, already_claimed: true });
    }
    // Bound to a different account → refuse; it's not this caller's to take.
    if (credit.recipient_id) {
      return json(409, { error: "This gift has already been claimed by another account." });
    }

    // Check availability BEFORE identity so an expired/consumed link gives the
    // same answer no matter who opens it (an attacker cycling emails learns
    // nothing extra), and a genuinely expired gift always reads as expired.
    if (credit.status === "expired") {
      return json(410, { error: "This gift has expired." });
    }
    if (credit.status !== "sent" && credit.status !== "available") {
      return json(409, { error: "This gift is no longer available to claim." });
    }
    if (credit.expires_at && new Date(credit.expires_at) < new Date()) {
      return json(410, { error: "This gift has expired." });
    }

    // Directed gift: the caller's email must match the named recipient so a
    // leaked token can't be redirected to a stranger's account. Fail CLOSED if
    // the gift names no recipient — a bearer-only token that anyone could claim
    // is never valid for a directed gift, so refuse rather than binding it to
    // whoever presents the token first.
    if (!credit.recipient_email) {
      console.error("[claim-pif-credit] refusing token-only claim: gift has no recipient_email", { credit_id: credit.id });
      return json(403, { error: "This gift can't be claimed from this link. Please contact support." });
    }
    if (credit.recipient_email.toLowerCase() !== user.email.toLowerCase()) {
      return json(403, {
        error: "This gift was sent to a different email address. Sign in with that email to claim it.",
      });
    }

    // Atomic claim: bind recipient_id only if still unclaimed. The WHERE guard
    // makes two simultaneous claims resolve to exactly one winner — the loser
    // gets no row back and is re-checked below.
    const { data: claimed, error: claimErr } = await supabaseAdmin
      .from("pif_credits")
      .update({ recipient_id: user.id })
      .eq("id", credit.id)
      .is("recipient_id", null)
      .select("id")
      .maybeSingle();
    if (claimErr) {
      console.error("[claim-pif-credit] claim update failed:", claimErr);
      return json(500, { error: "Couldn't claim this gift — please try again." });
    }
    if (!claimed) {
      // Lost a race between the read and the update. Re-read to report the
      // truth: if the winner was this same caller it's still a success.
      const { data: after } = await supabaseAdmin
        .from("pif_credits")
        .select("recipient_id")
        .eq("id", credit.id)
        .maybeSingle();
      if (after?.recipient_id === user.id) {
        return json(200, { ok: true, credit_id: credit.id, already_claimed: true });
      }
      return json(409, { error: "This gift has already been claimed by another account." });
    }

    return json(200, { ok: true, credit_id: credit.id, already_claimed: false });
  } catch (error) {
    console.error("[claim-pif-credit] error:", error);
    return json(500, { error: "Something went wrong claiming your gift. Please try again." });
  }
});
