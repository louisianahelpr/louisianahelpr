import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeadersFull as corsHeaders } from "../_shared/cors.ts";
import { getAppUrl, buildRedirectUrl, isNativeRequest } from "../_shared/appUrl.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // First of two guards, and the weaker one. This helper is an in-process,
  // IP-keyed Map that resets on cold start — a spam damper, not a billing cap.
  // The real cost cap is `claim_idv_attempt` below, which is durable and keyed
  // to the user; this just keeps a burst from reaching it.
  const rl = await checkRateLimit(req, {
    windowMs: 60_000,
    maxRequests: 3,
    keyPrefix: "stripe-idv-start",
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 60, corsHeaders);

  // Expected, user-facing refusals carry their own status and a human message.
  // Everything here used to 500 with a raw error string, so a user who simply
  // owed the setup fee saw "Edge Function returned a non-2xx status code".
  const fail = (status: number, message: string, extra: Record<string, unknown> = {}) =>
    new Response(JSON.stringify({ error: message, ...extra }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status,
    });

  try {
    // Read once: native callers get a return URL the app can intercept.
    const isNative = isNativeRequest(await req.json().catch(() => ({})));
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")) ?? ""
    );
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? ""
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail(401, "Please sign in first.");
    const token = authHeader.replace("Bearer ", "");
    const { data: userData } = await supabaseClient.auth.getUser(token);
    const user = userData.user;
    if (!user) return fail(401, "Your session expired — sign in again.");

    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("profiles")
      // NO `role`: `profiles.role` was DROPPED when accounts were unified
      // (2026-05, see migrations 20260504142454 / 20260505230500) — this app
      // has no poster/helper roles, and admin lives in `user_roles`. Selecting
      // it made PostgREST 400 the whole SELECT, which tripped the profileErr
      // guard below and 500'd the function on EVERY attempt. The user saw
      // "Edge Function returned a non-2xx status code" and identity
      // verification was completely dead.
      .select("idv_status, idv_session_id, full_name")
      .eq("user_id", user.id)
      .maybeSingle();

    // A dropped error here silently bypasses the "already verified" guard below
    // and — critically — can overwrite idv_status:"verified" with "pending" if
    // the SELECT fails but the subsequent UPDATE succeeds (brief DB read fault).
    if (profileErr) {
      throw new Error("Could not load your account right now. Please try again.");
    }

    // Already verified — short-circuit
    if (profile?.idv_status === "verified") {
      return new Response(JSON.stringify({ alreadyVerified: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    // Reuse existing pending session if it exists and is still usable
    if (profile?.idv_session_id && (profile.idv_status === "processing" || profile.idv_status === "pending")) {
      try {
        const existing = await stripe.identity.verificationSessions.retrieve(profile.idv_session_id);
        if (existing.status === "requires_input" && existing.url) {
          return new Response(JSON.stringify({ url: existing.url, sessionId: existing.id }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          });
        }
      } catch (_e) {
        // fall through to create a new session
      }
    }

    // ── COST GATE ──────────────────────────────────────────────────────────
    // Everything past this line spends platform money: Stripe bills the
    // platform for each VerificationSession. Nothing above it does — the reuse
    // path returns an EXISTING session's URL and is free, which is why the
    // claim sits here and not at the top: reusing a session must not burn an
    // attempt.
    //
    // The claim is atomic (single conditional UPDATE), so concurrent calls
    // cannot both take the last attempt, and it is durable, so a cold start
    // cannot reset it. It also enforces that the account has settled the $2
    // "identity verification & account setup fee" that pays for this, is not
    // banned, and has attempts left.
    const { data: claimRaw, error: claimErr } = await supabaseAdmin.rpc("claim_idv_attempt", {
      p_user_id: user.id,
    });
    if (claimErr) {
      // Fail CLOSED. An unreadable claim is not permission to spend.
      console.error("[stripe-idv-start] claim_idv_attempt failed:", claimErr.message);
      return fail(503, "We couldn't start verification just now. Please try again in a moment.");
    }
    const claim = (claimRaw ?? {}) as {
      claimed?: boolean;
      reason?: string | null;
      attempt?: number;
      max_attempts?: number;
    };
    if (!claim.claimed) {
      switch (claim.reason) {
        case "already_verified":
          return new Response(JSON.stringify({ alreadyVerified: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          });
        case "onboarding_fee_unpaid":
          // The one refusal with a way out, so it says so explicitly and the
          // client turns `needsOnboardingFee` into a pay-now button.
          return fail(
            402,
            "Your one-time account setup fee covers this check. Settle it and verification opens up — it's the same $2 you'd otherwise pay on your first job post or first payout, never both.",
            { needsOnboardingFee: true },
          );
        case "attempt_limit_reached":
          return fail(
            429,
            "You've used all your identity checks. Get in touch and we'll take a look.",
            { attemptLimitReached: true },
          );
        case "account_restricted":
          return fail(403, "This account can't start verification right now.");
        case "attempt_race_lost":
          return fail(409, "A verification is already starting — give it a second and refresh.");
        case "profile_not_found":
          return fail(404, "We couldn't find your account.");
        default:
          return fail(503, "We couldn't start verification just now. Please try again.");
      }
    }

    const session = await stripe.identity.verificationSessions.create({
      type: "document",
      provided_details: { email: user.email ?? undefined },
      metadata: {
        user_id: user.id,
        full_name: profile?.full_name ?? "",
      },
      options: {
        document: {
          require_matching_selfie: true,
          require_live_capture: true,
          allowed_types: ["driving_license", "passport", "id_card"],
        },
      },
      return_url: buildRedirectUrl(`/profile?idv=complete`, isNative),
    }, {
      // Keyed on the claimed attempt number, so a retry of THIS request (a
      // dropped response, a native handoff that bounced) reuses the same
      // session instead of billing for a second one. A genuinely new attempt
      // carries a new number and so gets a new session.
      idempotencyKey: `idv:${user.id}:${claim.attempt}`,
    });

    // `idv_status` and `idv_attempted_at` were already set by the claim above;
    // only the session id is left, and it matters more than it used to. Without
    // it the reuse guard is blind, so the user's NEXT tap creates a second
    // billable session — which now also burns a second attempt. Logged rather
    // than thrown because the money is already spent and the IDV webhook still
    // resolves the final status from metadata.user_id.
    const { error: updateErr } = await supabaseAdmin
      .from("profiles")
      .update({ idv_session_id: session.id } as any)
      .eq("user_id", user.id);
    if (updateErr) {
      console.error("[stripe-idv-start] Failed to store IDV session on profile:", updateErr);
    }

    return new Response(JSON.stringify({ url: session.url, sessionId: session.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    console.error("stripe-idv-start error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
